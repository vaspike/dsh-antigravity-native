import { AcpProcess } from './acp-process.js'
import { EventMapper, finishReason } from './event-mapper.js'
import { optionValues } from './model-utils.js'

const cancelledPermission = { outcome: { outcome: 'cancelled' } }

/** One persistent agy session bound to a native DSH Session. */
export class NativeAcpSession {
  constructor({ runtime, config, agent, approval, session, process, cwd }) {
    this.runtime = runtime
    this.config = config
    this.agent = agent
    this.approval = approval
    this.sessionId = session.sessionId
    this.cwd = cwd
    this.configOptions = session.configOptions ?? []
    this.process = process
    this.disconnected = undefined
    this.activeUpdate = undefined
  }

  static async start({ runtime, config, agent, approval, cwd, sessionId }) {
    let session
    const process = await AcpProcess.start({
      runtime,
      config,
      cwd,
      onUpdate: params => session?.handleUpdate(params),
      onPermission: params => session ? session.onPermission(params) : cancelledPermission,
      onExit: () => {
        if (session) session.disconnected = new Error('Antigravity disconnected')
      },
    })
    const response = sessionId
      ? await process.resumeSession(sessionId, cwd)
      : await process.newSession(cwd)
    session = new NativeAcpSession({ runtime, config, agent, approval, session: response, process, cwd })
    return session
  }

  handleUpdate(params) {
    if (params.sessionId === this.sessionId) this.activeUpdate?.(params)
  }

  async onPermission(request) {
    if (!this.approval) return cancelledPermission
    try {
      const outcome = await this.approval.request({
        agent: this.agent,
        toolName: request.toolCall.kind || 'antigravity',
        callId: request.toolCall.toolCallId,
        reason: request.toolCall.title,
        signal: this.promptSignal,
      })
      if (outcome === 'allowed-once') {
        const allow = request.options.find(option => option.kind === 'allow_once')
        if (allow) return { outcome: { outcome: 'selected', optionId: allow.optionId } }
      }
    } catch {
      return cancelledPermission
    }
    return cancelledPermission
  }

  async applySelection(model, effort) {
    if (model) {
      const option = this.configOptions.find(candidate => candidate.id === 'model')
      if (!option || !optionValues(option).includes(model)) {
        throw new Error(`Antigravity model is unavailable: ${model}`)
      }
      if (option.currentValue !== model) {
        const result = await this.process.setConfigOption(this.sessionId, option.id, model)
        this.configOptions = result.configOptions ?? this.configOptions
      }
    }
    if (effort) {
      const option = this.configOptions.find(candidate => candidate.category === 'thought_level')
      if (!option || !optionValues(option).includes(effort)) {
        throw new Error(`Antigravity thinking level is unavailable: ${effort}`)
      }
      if (option.currentValue !== effort) {
        const result = await this.process.setConfigOption(this.sessionId, option.id, effort)
        this.configOptions = result.configOptions ?? this.configOptions
      }
    }
  }

  async *prompt(text, signal) {
    if (!this.process) throw new Error('Antigravity process is unavailable')
    if (this.promptSignal) throw new Error('Antigravity prompt is already running')
    const mapper = new EventMapper()
    const queue = []
    let wake
    let done = false
    let stop = ''
    let failure
    this.promptSignal = signal
    this.activeUpdate = params => {
      if (params.sessionId !== this.sessionId || done) return
      queue.push(...mapper.update(params.update))
      wake?.()
    }
    const pending = this.process.prompt(this.sessionId, text, signal).then(
      result => {
        stop = result.stopReason
        done = true
        wake?.()
      },
      error => {
        failure = error
        done = true
        wake?.()
      },
    )
    try {
      while (!done || queue.length) {
        while (queue.length) {
          if (signal?.aborted) throw new Error('Antigravity generation was interrupted')
          yield queue.shift()
        }
        if (this.disconnected) throw this.disconnected
        if (!done) {
          await new Promise(resolve => { wake = resolve })
          wake = undefined
        }
      }
      if (failure) throw failure
      await pending
      if (!mapper.hasText && stop === 'end_turn') throw new Error('Antigravity returned an empty response')
      yield* mapper.end()
      yield { type: 'finish', reason: finishReason(stop) }
    } finally {
      this.activeUpdate = undefined
      this.promptSignal = undefined
      if (!done) {
        const process = this.process
        if (process) {
          await process.cancel(this.sessionId).catch(error => { this.disconnected ??= error })
          await this.close()
        }
      }
    }
  }

  async close() {
    const process = this.process
    this.process = undefined
    if (process) await process.dispose()
  }
}
