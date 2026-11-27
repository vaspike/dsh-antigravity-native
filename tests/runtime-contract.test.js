import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
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

test('works through the native LlmRuntime model and stream contracts', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-antigravity-native-runtime-'))
  const ctx = new Context()
  const sessionId = 'runtime-session'
  const agent = { id: sessionId, session: { id: sessionId } }
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    const adapter = new AntigravityNativeAdapter(resolveConfig({
      binaryPath: process.execPath,
      discoveryWorkspace: cwd,
      stopGraceMs: 1000,
    }), {
      subprocess: new TestSubprocessRuntime(fakeServer),
      agents: { get: () => agent },
      workingDirectory: { get: () => cwd },
      get: () => undefined,
    }, new MemoryStore())
    ctx.llm.registerAdapter([PROVIDER], adapter)
    ctx.effect(() => () => adapter.dispose())
    const models = await ctx.llm.listModels(PROVIDER)
    assert.equal(models.length, 2)
    const chunks = []
    for await (const chunk of ctx.llm.stream({
      provider: PROVIDER,
      model: 'model-a',
      reasoningEffort: 'low',
      sessionId,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'remember this token' }] }],
    })) chunks.push(chunk)
    assert(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'text'))
    assert.equal(chunks.at(-1).type, 'finish')
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  } finally {
    await ctx.fiber.dispose()
    await rm(cwd, { recursive: true, force: true })
  }
})
