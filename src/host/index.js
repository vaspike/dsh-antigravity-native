import { Config, resolveConfig } from './config.js'
import { BindingStore } from './binding-store.js'
import { AntigravityNativeAdapter, PROVIDER } from './adapter.js'
import { ModelFamilyGuard } from './model-family-guard.js'

export const name = 'antigravity-native'
export const inject = [
  'llm',
  'subprocess',
  'workingDirectory',
  'agentDefaultModel',
  'storageDomain',
  'approval',
  'agents',
]
export { Config }

export async function apply(ctx, input) {
  const config = resolveConfig(input)
  const store = await BindingStore.open(ctx)
  const adapter = new AntigravityNativeAdapter(config, ctx, store)
  try {
    ctx.llm.registerAdapter([PROVIDER], adapter)
    const guard = new ModelFamilyGuard(ctx)
    guard.install()
    ctx.effect(() => () => adapter.dispose(), 'antigravity-native: sessions and binding store')
  } catch (error) {
    await store.close()
    throw error
  }
}
