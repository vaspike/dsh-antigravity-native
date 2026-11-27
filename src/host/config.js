import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  binaryPath: z.string().default('agy'),
  discoveryWorkspace: z.string(),
  sandbox: z.boolean().default(true),
  requestTimeoutMs: z.natural().default(30000),
  stopGraceMs: z.natural().default(5000),
  contextWindow: z.natural().default(110000),
  maxPromptBytes: z.natural().default(180000),
})

export function resolveConfig(input = {}) {
  const config = Config(input)
  for (const key of ['requestTimeoutMs', 'stopGraceMs', 'contextWindow', 'maxPromptBytes']) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0 || config[key] > 2147483647) {
      throw new Error(`${key} must be a positive integer no greater than 2147483647`)
    }
  }
  if (!config.binaryPath.trim()) throw new Error('binaryPath must not be empty')
  if (config.discoveryWorkspace !== undefined && !config.discoveryWorkspace.trim()) {
    throw new Error('discoveryWorkspace must not be empty when configured')
  }
  return config
}

/** Resolve the fallback explicitly; ordinary Sessions use their own DSH workspace. */
export function resolveDiscoveryWorkspace(config) {
  return config.discoveryWorkspace ?? process.cwd()
}
