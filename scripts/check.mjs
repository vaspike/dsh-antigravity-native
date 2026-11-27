import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('../', import.meta.url).pathname
const walk = directory => readdirSync(directory).flatMap(entry => {
  const path = join(directory, entry)
  return statSync(path).isDirectory() ? walk(path) : [path]
})
for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'tests')), ...walk(join(root, 'scripts'))]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${file}: ${result.stderr}`)
  assert(readFileSync(file, 'utf8').endsWith('\n'), `${file} must end with a newline`)
}
const host = walk(join(root, 'src', 'host')).map(file => readFileSync(file, 'utf8')).join('\n')
for (const forbidden of [
  /\bauthenticate\s*\(/,
  '--login',
  'logout',
  'oauth-personal',
  'GEMINI_HOME',
  'GEMINI_API_KEY',
  'ctx.credentials',
  'agent-default-model: antigravity',
  '.loadSession(',
]) {
  const present = forbidden instanceof RegExp ? forbidden.test(host) : host.includes(forbidden)
  assert(!present, `Forbidden integration: ${forbidden}`)
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
for (const file of pkg.files) assert(existsSync(join(root, file)), `Missing packaged file: ${file}`)
for (const locale of ['en', 'zh']) {
  const dictionary = JSON.parse(readFileSync(join(root, 'locale', `${locale}.json`), 'utf8'))
  assert(dictionary.meta.title && dictionary.meta.description)
}
const icon = readFileSync(join(root, 'icon.svg'), 'utf8')
assert(icon.includes('width="36"') && icon.includes('viewBox="0 0 36 36"'))
for (const forbidden of ['<script', '<style', '<image', '<text', 'foreignObject']) {
  assert(!icon.includes(forbidden), `Unsupported icon content: ${forbidden}`)
}
console.log('Native package, authentication boundary and metadata checks passed.')
