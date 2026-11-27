import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { RequestError } from '@agentclientprotocol/sdk'
import { AcpProcess } from './acp-process.js'
import { NativeAcpSession } from './native-session.js'
import {
  isHumanMessage,
  messageSignature,
  messageText,
  reasoningMetadata,
  utilityPrompt,
} from './model-utils.js'

export const PROVIDER = 'antigravity-native'

function failure(message, code) {
  return new LlmError(message, code)
}

function classify(error) {
  if (error instanceof LlmError) return error
  if (error instanceof RequestError) {
    if (error.code === -32000) {
      return failure('Sign in with the official agy outside DSH, then retry. This plugin never starts authentication.', 'ACP_AUTH_REQUIRED')
    }
    return failure(`Antigravity rejected the ACP request (${error.code}).`, 'ACP_RPC_ERROR')
  }
  return failure('Antigravity disconnected. Reopen the Session and check the agy history before retrying.', 'ACP_DISCONNECTED')
}

/** Native DSH model adapter backed by persistent, append-only agy sessions. */
export class AntigravityNativeAdapter extends LlmAdapter {
  constructor(config, ctx, store) {
    super()
    this.config = config
    this.ctx = ctx
    this.store = store
    this.sessions = new Map()
    this.catalog = undefined
    this.discovery = undefined
    this.disposed = false
  }

  providerInfo(provider) {
    return { id: provider, name: 'Antigravity ACP' }
  }

  async discover() {
    if (this.catalog) return this.catalog
    this.discovery ??= (async () => {
      const session = await NativeAcpSession.start({
        runtime: this.ctx.subprocess,
        config: this.config,
        agent: undefined,
        approval: undefined,
        cwd: this.config.discoveryWorkspace,
      })
      try {
        const modelOption = session.configOptions.find(option => option.id === 'model')
        const thinkingOption = session.configOptions.find(option => option.category === 'thought_level')
        const reasoning = reasoningMetadata(thinkingOption)
        const models = (modelOption?.options ?? []).flatMap(entry =>
          'value' in entry ? [entry] : (entry.options ?? []),
        ).map(model => ({
          id: model.value,
          name: model.name || model.value,
          description: 'Antigravity ACP with agy-native history and tools',
          inputModalities: ['text'],
          reasoning,
        }))
        this.catalog = { models, reasoning }
        return this.catalog
      } finally {
        await session.close()
      }
    })()
    try {
      return await this.discovery
    } catch (error) {
      this.discovery = undefined
      throw classify(error)
    }
  }

  async listModels(provider) {
    const { models } = await this.discover()
    return models.map(model => ({ ...model, provider }))
  }

  async resolveModel(provider, model) {
    const { models, reasoning } = await this.discover()
    const selected = models.find(candidate => candidate.id === model)
    return {
      provider,
      id: model,
      name: selected?.name ?? model,
      inputModalities: ['text'],
      context: { contextWindow: this.config.contextWindow },
      reasoning,
    }
  }

  async *utility(options) {
    const session = await NativeAcpSession.start({
      runtime: this.ctx.subprocess,
      config: this.config,
      agent: undefined,
      approval: undefined,
      cwd: this.config.discoveryWorkspace,
    })
    try {
      await session.applySelection(options.model, options.reasoningEffort)
      const prompt = utilityPrompt(options)
      if (Buffer.byteLength(prompt, 'utf8') > this.config.maxPromptBytes) {
        throw failure('The Antigravity utility request is too large. Shorten the conversation or utility input.', 'ACP_PROMPT_TOO_LARGE')
      }
      yield* session.prompt(prompt, options.signal)
    } finally {
      await session.close()
    }
  }

  async *stream(options) {
    if (this.disposed) throw failure('Antigravity adapter has been disposed.', 'ACP_DISPOSED')
    if (options.purpose === 'compaction') {
      throw failure('DSH compaction is not supported for an Antigravity-bound Session. Start a new Session instead.', 'ACP_UNSUPPORTED_PURPOSE')
    }
    if (options.purpose !== undefined || options.sessionId === undefined) {
      yield* this.utility(options)
      return
    }
    const sessionId = options.sessionId
    const agent = this.ctx.agents.get(sessionId)
    if (!agent) throw failure('The DSH Session is not active. Reopen it before using Antigravity.', 'ACP_SESSION_UNAVAILABLE')
    const cwd = this.ctx.workingDirectory.get(agent.session)
    const userMessages = options.messages.filter(isHumanMessage)
    let binding = await this.store.get(sessionId)
    let session = this.sessions.get(sessionId)
    if (!binding && userMessages.length !== 1) {
      throw failure('An existing DSH Session cannot switch to Antigravity. Start a new Session instead.', 'ACP_MODEL_FAMILY_LOCKED')
    }
    if (!session) {
      session = await NativeAcpSession.start({
        runtime: this.ctx.subprocess,
        config: this.config,
        agent,
        approval: this.ctx.get('approval'),
        cwd,
        sessionId: binding?.agySessionId,
      })
      this.sessions.set(sessionId, session)
    }
    if (binding && binding.cwd !== cwd) {
      throw failure('The workspace of an Antigravity-bound Session cannot change. Start a new Session in the other directory.', 'ACP_WORKSPACE_CHANGED')
    }
    const previousCount = binding?.forwardedUserCount ?? 0
    if (userMessages.length < previousCount) {
      throw failure('Editing, forking, regeneration and compaction are disabled for Antigravity-bound Sessions.', 'ACP_HISTORY_DIVERGED')
    }
    if (previousCount > 0 && messageSignature(userMessages[previousCount - 1]) !== binding.lastUserSignature) {
      throw failure('The DSH history no longer matches the agy history. Start a new Antigravity Session instead.', 'ACP_HISTORY_DIVERGED')
    }
    if (userMessages.length === previousCount) {
      throw failure('This message was already sent to Antigravity. Retry is disabled to prevent duplicate tool execution.', 'ACP_DUPLICATE_PROMPT')
    }
    const text = userMessages.slice(previousCount).map(messageText).filter(Boolean).join('\n\n')
    if (!text.trim()) throw failure('Enter a text message before using Antigravity.', 'ACP_EMPTY_PROMPT')
    try {
      await session.applySelection(options.model, options.reasoningEffort)
      binding = {
        agySessionId: session.sessionId,
        cwd,
        forwardedUserCount: userMessages.length,
        lastUserSignature: messageSignature(userMessages.at(-1)),
      }
      await this.store.put(sessionId, binding)
      yield* session.prompt(text, options.signal)
    } catch (error) {
      throw classify(error)
    }
  }

  async dispose() {
    this.disposed = true
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(sessions.map(session => session.close()))
    await this.store.close()
  }
}
