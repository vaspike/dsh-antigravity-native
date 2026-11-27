import { Readable, Writable } from 'node:stream'
import { client, methods, ndJsonStream } from '@agentclientprotocol/sdk'
import { AntigravityError } from './errors.js'

/** One agy acp subprocess and its single ACP connection. */
export class AcpProcess {
  #child
  #connection
  #config
  #disposal
  #onExit
  initializeResult

  constructor(child, connection, config, onExit) {
    this.#child = child
    this.#connection = connection
    this.#config = config
    this.#onExit = onExit
    void child.done.then(
      () => {
        connection.close()
        this.#onExit()
      },
      () => {
        connection.close()
        this.#onExit()
      },
    )
  }

  static async start({ runtime, config, cwd, onUpdate, onPermission, onExit }) {
    const executable = await runtime.resolveExecutable(config.binaryPath)
    const args = ['acp']
    if (config.sandbox) args.push('--sandbox')
    const child = runtime.spawn({
      argv: [executable, ...args],
      cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: config.stopGraceMs,
    })
    if (!child.stdin || !child.stdout) {
      child.terminate()
      await child.waitForExit()
      throw new AntigravityError('ACP_STDIO_UNAVAILABLE', 'Antigravity did not expose ACP standard streams.')
    }
    child.stderr?.resume()
    let connection
    try {
      const app = client({ name: 'dsh-antigravity-panel' })
        .onNotification(methods.client.session.update, ({ params }) => {
          onUpdate(params)
        })
        .onRequest(methods.client.session.requestPermission, ({ params }) => onPermission(params))
      connection = app.connect(
        ndJsonStream(
          Writable.toWeb(child.stdin),
          Readable.toWeb(child.stdout),
        ),
      )
      const process = new AcpProcess(child, connection, config, onExit)
      process.initializeResult = await process.#request(
        methods.agent.initialize,
        {
          protocolVersion: 1,
          clientInfo: { name: 'dsh-antigravity-panel', version: '0.1.0' },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        },
        config.requestTimeoutMs,
      )
      return process
    } catch (error) {
      connection?.close()
      child.stdin.end()
      try {
        await child.waitForExit(AbortSignal.timeout(config.stopGraceMs))
      } catch {
        child.terminate()
        await child.waitForExit()
      } finally {
        child.stderr?.removeAllListeners()
      }
      throw error
    }
  }

  async #request(method, params, timeoutMs, signal) {
    let timer
    let onAbort
    const interruption = new Promise((_, reject) => {
      if (timeoutMs) {
        timer = setTimeout(() => reject(new AntigravityError('ACP_TIMEOUT', 'The Antigravity operation timed out.')), timeoutMs)
      }
      if (signal) {
        onAbort = () => reject(new AntigravityError('ACP_CANCELLED', 'The Antigravity operation was cancelled.'))
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      }
    })
    try {
      return await Promise.race([this.#connection.agent.request(method, params), interruption])
    } finally {
      clearTimeout(timer)
      if (onAbort) signal?.removeEventListener('abort', onAbort)
    }
  }

  newSession(cwd) {
    return this.#request(methods.agent.session.new, { cwd, mcpServers: [] }, this.#config.requestTimeoutMs)
  }

  resumeSession(sessionId, cwd) {
    return this.#request(
      methods.agent.session.resume,
      { sessionId, cwd, mcpServers: [] },
      this.#config.requestTimeoutMs,
    )
  }

  loadSession(sessionId, cwd) {
    return this.#request(
      methods.agent.session.load,
      { sessionId, cwd, mcpServers: [] },
      this.#config.requestTimeoutMs,
    )
  }

  listSessions(cwd) {
    return this.#request(methods.agent.session.list, { cwd }, this.#config.requestTimeoutMs)
  }

  setConfigOption(sessionId, configId, value) {
    return this.#request(
      methods.agent.session.setConfigOption,
      { sessionId, configId, value },
      this.#config.requestTimeoutMs,
    )
  }

  prompt(sessionId, text, signal) {
    return this.#request(
      methods.agent.session.prompt,
      { sessionId, prompt: [{ type: 'text', text }] },
      undefined,
      signal,
    )
  }

  async cancel(sessionId) {
    await this.#connection.agent.notify(methods.agent.session.cancel, { sessionId })
  }

  async dispose() {
    this.#disposal ??= (async () => {
      this.#connection.close()
      this.#child.stdin?.end()
      let exited = false
      try {
        exited = await this.#child.waitForExit(AbortSignal.timeout(this.#config.stopGraceMs))
      } finally {
        if (!exited) {
          this.#child.terminate()
          await this.#child.waitForExit()
        }
      }
    })()
    return this.#disposal
  }
}
