import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const sessionId = 'session-1'
const options = [
  { id: 'model', category: 'model', type: 'select', currentValue: 'model-a', options: [
    { value: 'model-a', name: 'Model A' }, { value: 'model-b', name: 'Model B' },
  ] },
  { id: 'thinking', category: 'thought_level', type: 'select', currentValue: 'medium', options: [
    { value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' },
  ] },
]
const pending = new Map()
let permissionResponse
const remembered = new Map()
const reader = createInterface({ input: process.stdin })
const write = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const update = update => write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })

reader.on('line', line => {
  const request = JSON.parse(line)
  if (request.id === 'permission-1') {
    permissionResponse?.()
    return
  }
  if (!request.method) return
  if (process.env.FAKE_AGY_LOG) appendFileSync(process.env.FAKE_AGY_LOG, `${request.method}\n`)
  if (request.method === 'session/cancel') {
    pending.get(request.params.sessionId)?.({ stopReason: 'cancelled' })
    return
  }
  const { id } = request
  if (request.method === 'initialize') {
    return write({ jsonrpc: '2.0', id, result: {
      protocolVersion: 1,
      agentInfo: { name: 'Fake Antigravity', version: '1.0.0' },
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, resume: {} } },
    } })
  }
  if (request.method === 'session/new' || request.method === 'session/resume') {
    return write({ jsonrpc: '2.0', id, result: { sessionId, title: 'Fake session', configOptions: structuredClone(options) } })
  }
  if (request.method === 'session/set_config_option') {
    const option = options.find(item => item.id === request.params.configId)
    option.currentValue = request.params.value
    return write({ jsonrpc: '2.0', id, result: { configOptions: structuredClone(options) } })
  }
  if (request.method === 'session/prompt') {
    const text = request.params.prompt[0].text
    const respond = result => {
      pending.delete(request.params.sessionId)
      write({ jsonrpc: '2.0', id, result })
    }
    pending.set(request.params.sessionId, respond)
    if (process.env.FAKE_AGY_PROMPT_LOG) appendFileSync(process.env.FAKE_AGY_PROMPT_LOG, `${text}\n---\n`)
    if (text.includes('permission')) {
      permissionResponse = () => {
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'allowed' } })
        respond({ stopReason: 'end_turn' })
      }
      write({ jsonrpc: '2.0', id: 'permission-1', method: 'session/request_permission', params: {
        sessionId,
        toolCall: { toolCallId: 'tool-1', title: 'Run fake tool', status: 'pending', kind: 'execute' },
        options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow once' }, { optionId: 'deny', kind: 'reject_once', name: 'Deny' }],
      } })
      return
    }
    if (text.includes('remember')) remembered.set('token', 'NATIVE_OCEAN_42')
    const responseText = text.includes('what token') ? remembered.get('token') : text.includes('second') ? 'second response' : 'first response'
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: responseText } })
    return respond({ stopReason: 'end_turn' })
  }
  if (request.method === 'authenticate') {
    return write({ jsonrpc: '2.0', id, error: { code: -1, message: 'Authentication must not be called' } })
  }
  write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown method' } })
})
