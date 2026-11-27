import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AntigravityNativeAdapter, PROVIDER } from '../src/host/adapter.js'
import { resolveConfig } from '../src/host/config.js'
import { TestSubprocessRuntime } from './runtime.js'

const fakeServer = new URL('./fake-acp-server.js', import.meta.url).pathname

class MemoryStore {
  constructor() { this.values = new Map() }
  get(id) { return this.values.get(id) }
  async put(id, value) { this.values.set(id, value) }
  async close() {}
}

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-antigravity-native-test-'))
  const promptLog = join(cwd, 'prompts.log')
  process.env.FAKE_AGY_PROMPT_LOG = promptLog
  const sessionId = 'native-session'
  const agent = { id: sessionId, session: { id: sessionId } }
  const ctx = {
    subprocess: new TestSubprocessRuntime(fakeServer),
    agents: { get: id => id === sessionId ? agent : undefined },
    workingDirectory: { get: () => cwd },
    get: () => undefined,
  }
  const adapter = new AntigravityNativeAdapter(resolveConfig({
    binaryPath: process.execPath,
    discoveryWorkspace: cwd,
    stopGraceMs: 1000,
  }), ctx, new MemoryStore())
  return { cwd, promptLog, adapter, sessionId }
}

async function collect(adapter, options) {
  const chunks = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}

function options(sessionId, messages, extra = {}) {
  return { provider: PROVIDER, model: 'model-a', reasoningEffort: 'low', sessionId, messages, ...extra }
}

test('registers native model metadata and streams append-only follow-ups', async () => {
  const { cwd, promptLog, adapter, sessionId } = await fixture()
  try {
    const models = await adapter.listModels(PROVIDER)
    assert.equal(models.length, 2)
    assert.equal(models[0].reasoning.efforts.length, 3)
    const resolved = await adapter.resolveModel(PROVIDER, 'model-a')
    assert.equal(resolved.context.contextWindow, 110000)
    const first = await collect(adapter, options(sessionId, [
      { role: 'user', content: [{ type: 'text', text: 'remember this token' }] },
    ]))
    assert(first.some(chunk => chunk.type === 'block-start' && chunk.blockType === 'text'))
    assert.equal(first.at(-1).type, 'finish')
    const second = await collect(adapter, options(sessionId, [
      { role: 'user', content: [{ type: 'text', text: 'remember this token' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'first response' }] },
      { role: 'user', content: [{ type: 'text', text: 'second message' }] },
    ], { model: 'model-b' }))
    assert(second.some(chunk => chunk.type === 'text-delta' && chunk.text === 'second response'))
    await assert.rejects(() => collect(adapter, options(sessionId, [
      { role: 'user', content: [{ type: 'text', text: 'remember this token' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'first response' }] },
      { role: 'user', content: [{ type: 'text', text: 'second message' }] },
    ])), error => error.code === 'ACP_DUPLICATE_PROMPT')
    const prompts = await readFile(promptLog, 'utf8')
    assert(!prompts.includes('remember this token\nsecond message'))
    assert(prompts.includes('second message'))
  } finally {
    await adapter.dispose()
    await rm(cwd, { recursive: true, force: true })
    delete process.env.FAKE_AGY_PROMPT_LOG
  }
})

test('rejects compaction and diverged history without calling a model', async () => {
  const { cwd, adapter, sessionId } = await fixture()
  try {
    await assert.rejects(() => collect(adapter, options(sessionId, [], { purpose: 'compaction' })), error => error.code === 'ACP_UNSUPPORTED_PURPOSE')
    await assert.rejects(() => collect(adapter, options(sessionId, [
      { role: 'user', content: [{ type: 'text', text: 'old one' }] },
      { role: 'user', content: [{ type: 'text', text: 'old two' }] },
    ])), error => error.code === 'ACP_MODEL_FAMILY_LOCKED')
  } finally {
    await adapter.dispose()
    await rm(cwd, { recursive: true, force: true })
    delete process.env.FAKE_AGY_PROMPT_LOG
  }
})
