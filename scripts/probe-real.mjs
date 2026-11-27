import { AntigravityNativeAdapter, PROVIDER } from '../src/host/adapter.js'
import { resolveConfig } from '../src/host/config.js'
import { TestSubprocessRuntime } from '../tests/runtime.js'

const cwd = process.argv[2]
if (!cwd) throw new Error('Usage: node scripts/probe-real.mjs /absolute/workspace')
class MemoryStore {
  constructor() { this.values = new Map() }
  get(id) { return this.values.get(id) }
  async put(id, value) { this.values.set(id, value) }
  async close() {}
}
const sessionId = 'native-real-session'
const agent = { id: sessionId, session: { id: sessionId } }
const ctx = {
  subprocess: new TestSubprocessRuntime(),
  agents: { get: id => id === sessionId ? agent : undefined },
  workingDirectory: { get: () => cwd },
  get: () => undefined,
}
const adapter = new AntigravityNativeAdapter(resolveConfig({
  binaryPath: process.env.AGY_BIN || '/Users/river/.local/bin/agy',
  discoveryWorkspace: cwd,
}), ctx, new MemoryStore())

async function prompt(messages) {
  const models = await adapter.listModels(PROVIDER)
  const model = models[0]
  const effort = model.reasoning.efforts.find(item => item.id === 'low')?.id ?? model.reasoning.efforts[0].id
  const chunks = []
  for await (const chunk of adapter.stream({
    provider: PROVIDER,
    model: model.id,
    reasoningEffort: effort,
    sessionId,
    messages,
  })) chunks.push(chunk)
  return chunks
}

try {
  const models = await adapter.listModels(PROVIDER)
  console.log('MODELS_OK', models.length, models[0].reasoning.efforts.map(item => item.id))
  const first = await prompt([{ role: 'user', content: [{ type: 'text', text: 'Remember NATIVE_OCEAN_42. Reply with exactly STORED and do not use tools.' }] }])
  console.log('FIRST_OK', first.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''))
  const second = await prompt([
    { role: 'user', content: [{ type: 'text', text: 'Remember NATIVE_OCEAN_42. Reply with exactly STORED and do not use tools.' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'STORED' }] },
    { role: 'user', content: [{ type: 'text', text: 'What token did I ask you to remember? Reply with only that token and do not use tools.' }] },
  ])
  const answer = second.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
  console.log('FOLLOWUP_MEMORY_OK', answer.includes('NATIVE_OCEAN_42'))
  try {
    await prompt([
      { role: 'user', content: [{ type: 'text', text: 'Remember NATIVE_OCEAN_42. Reply with exactly STORED and do not use tools.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'STORED' }] },
      { role: 'user', content: [{ type: 'text', text: 'What token did I ask you to remember? Reply with only that token and do not use tools.' }] },
    ])
    throw new Error('Duplicate prompt was not rejected')
  } catch (error) {
    console.log('DUPLICATE_REJECTED', error.code)
  }
} finally {
  await adapter.dispose()
}
