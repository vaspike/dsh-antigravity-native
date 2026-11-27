import { spawn } from 'node:child_process'

/** Minimal local runtime with the SubprocessRuntime surface used by AcpProcess. */
export class TestSubprocessRuntime {
  constructor(fakeServerPath) {
    this.fakeServerPath = fakeServerPath
  }

  async resolveExecutable(command) {
    return command
  }

  spawn(spec) {
    const argv = this.fakeServerPath
      ? [process.execPath, this.fakeServerPath, ...spec.argv.slice(2)]
      : spec.argv
    const child = spawn(argv[0], argv.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
    })
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      done,
      terminate: () => child.kill('SIGTERM'),
      waitForExit: async signal => {
        if (child.exitCode !== null || child.signalCode !== null) return true
        if (signal?.aborted) throw new Error('aborted')
        return new Promise((resolve, reject) => {
          const onExit = () => {
            signal?.removeEventListener('abort', onAbort)
            resolve(true)
          }
          const onAbort = () => {
            child.removeListener('exit', onExit)
            reject(new Error('aborted'))
          }
          child.once('exit', onExit)
          signal?.addEventListener('abort', onAbort, { once: true })
        })
      },
    }
  }
}
