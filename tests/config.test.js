import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConfig, resolveDiscoveryWorkspace } from '../src/host/config.js'

test('leaves discoveryWorkspace unset by default and resolves the fallback explicitly', () => {
  const config = resolveConfig()
  assert.equal(config.discoveryWorkspace, undefined)
  assert.equal(resolveDiscoveryWorkspace(config), process.cwd())
})

test('honors an explicit discoveryWorkspace and rejects a blank override', () => {
  const config = resolveConfig({ discoveryWorkspace: '/tmp/custom-workspace' })
  assert.equal(resolveDiscoveryWorkspace(config), '/tmp/custom-workspace')
  assert.throws(() => resolveConfig({ discoveryWorkspace: '   ' }), /must not be empty when configured/)
})
