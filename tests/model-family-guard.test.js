import assert from 'node:assert/strict'
import test from 'node:test'
import { PROVIDER } from '../src/host/adapter.js'
import { ModelFamilyGuard } from '../src/host/model-family-guard.js'

function fixture(initialProvider, initialModel) {
  const initial = { provider: initialProvider, model: initialModel }
  const events = [{ type: 'model/selection', data: initial }]
  const selected = []
  const warnings = []
  const saved = []
  const listeners = {}
  const agent = {
    id: 'session-1',
    options: initial,
    session: {
      snapshotEvents: () => events,
      requestHeader: () => undefined,
    },
    model: {
      select(selection) {
        selected.push(selection)
        events.push({ type: 'model/selection', data: selection })
      },
    },
    inject: message => warnings.push(message),
    ctx: {
      on: (name, listener) => {
        listeners[name] = listener
        return () => {}
      },
      effect: callback => {
        callback()
        return () => {}
      },
    },
  }
  let created
  const ctx = {
    agentDefaultModel: {
      saveSelection: async selection => { saved.push(selection) },
    },
    logger: { warn: () => {} },
    on: (name, listener) => {
      if (name === 'agent/created') created = listener
      return () => {}
    },
    effect: callback => callback(),
  }
  new ModelFamilyGuard(ctx).install()
  created({ agent })
  return { agent, listeners, selected, warnings, saved }
}

test('restores a DSH-native Session after an invalid Antigravity selection and blocks its use', async () => {
  const { agent, listeners, selected, warnings, saved } = fixture('deepseek', 'deepseek-chat')
  listeners['session/event'](agent.session, {
    type: 'model/selection',
    data: { provider: PROVIDER, model: 'model-a' },
  })
  assert.equal(selected.at(-1).provider, 'deepseek')
  assert.equal(selected.at(-1).model, 'deepseek-chat')
  assert.equal(saved.at(-1).provider, 'deepseek')
  assert.equal(warnings.length, 1)
  assert.throws(
    () => listeners['agent/pre-step']({ modelSelection: { provider: PROVIDER, model: 'model-a' } }, async () => ({ kind: 'enter', messages: [] })),
    error => error.code === 'ACP_MODEL_FAMILY_LOCKED',
  )
})

test('allows model changes within Antigravity and rejects a native model on the same Session', async () => {
  const { agent, listeners, selected, warnings } = fixture(PROVIDER, 'model-a')
  listeners['session/event'](agent.session, {
    type: 'model/selection',
    data: { provider: PROVIDER, model: 'model-b' },
  })
  assert.equal(selected.length, 0)
  assert.equal(warnings.length, 0)
  const decision = await listeners['agent/pre-step'](
    { modelSelection: { provider: PROVIDER, model: 'model-b' } },
    async () => ({ kind: 'enter', messages: [] }),
  )
  assert.equal(decision.kind, 'enter')
  assert.throws(
    () => listeners['agent/pre-step']({ modelSelection: { provider: 'deepseek', model: 'deepseek-chat' } }, async () => ({ kind: 'enter', messages: [] })),
    error => error.code === 'ACP_MODEL_FAMILY_LOCKED',
  )
})
