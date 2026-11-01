import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

function fail(message: string): never {
  console.error(`pre-push: ${message}`)
  process.exit(1)
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

try {
  const input = readFileSync(0, 'utf8').trim()
  const updates = input ? input.split(/\r?\n/) : []
  let validatesCheckout = updates.length === 0
  for (const update of updates) {
    const fields = update.trim().split(/\s+/)
    if (fields.length !== 4) fail('malformed pre-push input; no refs validated')
    const [, localSha, , remoteSha] = fields
    if (![localSha, remoteSha].every((sha) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))) {
      fail('invalid object ID in pre-push input')
    }
    if (/^0+$/.test(localSha)) continue
    if (git('rev-parse', '--verify', `${localSha}^{commit}`) !== git('rev-parse', 'HEAD')) {
      fail('pushed ref is not checked-out HEAD; use a clean checkout of each pushed commit')
    }
    validatesCheckout = true
  }
  if (!validatesCheckout) process.exit(0)
  if (git('status', '--porcelain', '--untracked-files=all')) {
    fail('checkout must be clean, including untracked files; commit or move your work explicitly')
  }

  const { packageManager } = JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager: string }
  const version = packageManager.replace(/^bun@/, '')
  const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' })
  if (bun.status !== 0 || bun.stdout.trim() !== version) {
    fail(`Bun ${version} required; prepare that toolchain, then bun install --frozen-lockfile`)
  }
  const node = spawnSync('node', ['--version'], { encoding: 'utf8' })
  const nodeMajor = Number(node.stdout?.trim().match(/^v(\d+)\./)?.[1])
  if (node.status !== 0 || !(nodeMajor >= 18)) {
    fail('Node >=18 required for the emitted node:test suite; prepare Node before pushing')
  }
  for (const tool of ['tsc']) {
    if (!existsSync(`node_modules/.bin/${tool}`)) {
      fail(`missing local ${tool}; run bun install --frozen-lockfile before pushing`)
    }
  }
  // Full scopes cover shared config, dependencies, renames, deletes and unknown bases.
  for (const script of ['typecheck', 'test']) {
    const result = spawnSync('bun', ['run', script], { stdio: 'inherit' })
    if (result.error) fail(result.error.message)
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
