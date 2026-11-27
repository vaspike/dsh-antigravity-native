import { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import { PROVIDER } from './adapter.js'

function familyOf(selection) {
  return selection.provider === PROVIDER ? 'antigravity' : 'dsh'
}

function initialSelection(agent) {
  const events = agent.session.snapshotEvents()
  const selection = events.find(event => event.type === 'model/selection')
  if (selection) return selection.data
  const header = agent.session.requestHeader()
  if (header) return header.config
  return {
    provider: agent.options.provider,
    model: agent.options.model,
    ...(agent.options.reasoningEffort === undefined ? {} : { reasoningEffort: agent.options.reasoningEffort }),
  }
}

/** Restores illegal cross-family selections and rejects them before every model step. */
export class ModelFamilyGuard {
  constructor(ctx) {
    this.ctx = ctx
    this.states = new Map()
  }

  install() {
    this.ctx.on('agent/created', ({ agent }) => {
      const state = { family: undefined, lastValid: undefined }
      this.states.set(agent.id, state)
      const dispose = agent.ctx.effect(() => {
        agent.ctx.on('session/event', (session, event) => {
          if (session !== agent.session || event.type !== 'model/selection') return
          const initial = initialSelection(agent)
          state.family ??= familyOf(initial)
          state.lastValid ??= initial
          const selected = event.data
          if (familyOf(selected) !== state.family) {
            const restored = state.lastValid
            agent.model.select(restored)
            state.lastValid = restored
            void this.ctx.agentDefaultModel.saveSelection(restored).catch(error => {
              this.ctx.logger.warn(`antigravity-native: failed to restore the default model: ${String(error)}`)
            })
            agent.inject(createUserMessage({
              content: [{
                type: 'text',
                text: `This Session is bound to ${state.family === 'antigravity' ? 'Antigravity' : 'DSH-native models'}. Restored ${restored.provider}/${restored.model}. Start a new Session to use ${familyOf(selected) === 'antigravity' ? 'Antigravity' : 'a DSH-native model'}.`,
              }],
              source: { kind: 'antigravity-native' },
            }))
            return
          }
          state.lastValid = selected
        })
        agent.ctx.on('agent/pre-step', ({ modelSelection }, next) => {
          const initial = initialSelection(agent)
          state.family ??= familyOf(initial)
          state.lastValid ??= initial
          if (familyOf(modelSelection) !== state.family) {
            const restored = state.lastValid
            agent.model.select(restored)
            void this.ctx.agentDefaultModel.saveSelection(restored).catch(error => {
              this.ctx.logger.warn(`antigravity-native: failed to restore the default model: ${String(error)}`)
            })
            throw new LlmError(
              `This Session is bound to ${state.family === 'antigravity' ? 'Antigravity' : 'DSH-native models'}; restored ${restored.provider}/${restored.model}. Start a new Session to use another model family.`,
              'ACP_MODEL_FAMILY_LOCKED',
            )
          }
          return next()
        })
        agent.ctx.on('agent/disposed', () => {
          this.states.delete(agent.id)
        })
      })
      this.ctx.effect(() => () => dispose())
    })
  }
}
