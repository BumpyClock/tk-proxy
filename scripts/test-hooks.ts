import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'pre-push-fixtures-'))
const log = join(temporary, 'commands')
const bin = join(temporary, 'bin')
const home = join(temporary, 'home')
mkdirSync(bin)
mkdirSync(home)
const manager = (JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as { packageManager: string }).packageManager
const version = manager.replace('bun@', '')
const scripts = ['typecheck', 'test']
let assertions = 0
const env = {
  ...process.env,
  HOME: home,
  GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  PATH: `${bin}:${process.env.PATH ?? ''}`,
  REAL_BUN: process.execPath,
  HOOK_TEST_VERSION: version,
  HOOK_TEST_COMMANDS: log,
  HOOK_TEST_FAIL: '',
}
writeFileSync(join(bin, 'bun'), `#!/bin/sh
if [ "$1" = --version ]; then printf '%s\\n' "$HOOK_TEST_VERSION"; exit; fi
if [ "$1" = run ] && [ "$2" = scripts/pre-push.ts ]; then shift; exec "$REAL_BUN" "$@"; fi
printf '%s\\n' "$2" >> "$HOOK_TEST_COMMANDS"
if [ "$2" = "$HOOK_TEST_FAIL" ]; then exit 17; fi
`, { mode: 0o755 })

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function fixture(name: string): string {
  const root = join(temporary, name)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, '.githooks'))
  for (const file of ['scripts/pre-push.ts', 'scripts/install-hooks.ts', '.githooks/pre-push']) {
    copyFileSync(join(source, file), join(root, file))
  }
  chmodSync(join(root, '.githooks/pre-push'), 0o755)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: manager }))
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(root, 'file with spaces.ts'), 'export const value = 1\n')
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Hook Fixture')
  git(root, 'config', 'user.email', 'hook-fixture@example.invalid')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'fixture')
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true })
  for (const tool of ['tsc']) writeFileSync(join(root, `node_modules/.bin/${tool}`), '')
  return root
}

function install(root: string, expected: number): void {
  const result = spawnSync(process.execPath, [join(root, 'scripts/install-hooks.ts')], { cwd: root, env, encoding: 'utf8' })
  assert.equal(result.status, expected, result.stderr)
  assertions++
}

function hook(root: string, input: string, expected: number, commands: string[] = scripts, extra = {}): void {
  writeFileSync(log, '')
  const result = spawnSync(join(root, '.githooks/pre-push'), ['origin', 'unused'], {
    cwd: root, env: { ...env, ...extra }, input, encoding: 'utf8',
  })
  assert.equal(result.status, expected, result.stderr)
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').filter(Boolean), commands, result.stderr)
  assertions++
}

try {
  const root = fixture('checkout with spaces')
  install(root, 0)
  install(root, 0)
  assert.equal(git(root, 'config', '--local', '--get', 'core.hooksPath'), '.githooks')
  const first = git(root, 'rev-parse', 'HEAD')
  const zero = '0'.repeat(40)
  let head = first
  const input = () => `refs/heads/main ${head} refs/heads/main ${zero}\n`
  hook(root, input(), 0)
  hook(root, '', 0)
  hook(root, input() + input(), 0)
  hook(root, input() + `refs/heads/gone ${zero} refs/heads/gone ${first}\n`, 0)
  hook(root, `refs/heads/gone ${zero} refs/heads/gone ${first}\n`, 0, [])
  hook(root, `refs/heads/main ${head} refs/heads/main ${'f'.repeat(40)}\n`, 0)
  hook(root, 'malformed\n', 1, [])
  hook(root, `refs/heads/main invalid refs/heads/main ${zero}\n`, 1, [])
  writeFileSync(join(root, 'file with spaces.ts'), 'dirty\n')
  hook(root, input(), 1, [])
  git(root, 'checkout', '--', 'file with spaces.ts')
  writeFileSync(join(root, 'untracked file.ts'), 'untracked\n')
  hook(root, input(), 1, [])
  rmSync(join(root, 'untracked file.ts'))
  git(root, 'mv', 'file with spaces.ts', 'renamed file.ts')
  git(root, 'commit', '-qm', 'rename')
  head = git(root, 'rev-parse', 'HEAD')
  hook(root, input(), 0)
  hook(root, `refs/heads/old ${first} refs/heads/old ${zero}\n`, 1, [])
  hook(root, input() + `refs/heads/old ${first} refs/heads/old ${zero}\n`, 1, [])
  git(root, 'rm', 'renamed file.ts')
  git(root, 'commit', '-qm', 'delete')
  head = git(root, 'rev-parse', 'HEAD')
  hook(root, input(), 0)
  writeFileSync(join(root, 'shared.config.json'), '{}\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'shared config')
  head = git(root, 'rev-parse', 'HEAD')
  hook(root, input(), 0)
  git(root, 'tag', '-am', 'fixture tag', 'v-fixture')
  hook(root, `refs/tags/v-fixture ${git(root, 'rev-parse', 'v-fixture')} refs/tags/v-fixture ${zero}\n`, 0)
  hook(root, input(), 17, [scripts[0]], { HOOK_TEST_FAIL: scripts[0] })
  hook(root, input(), 17, scripts, { HOOK_TEST_FAIL: scripts[1] })
  hook(root, input(), 1, [], { HOOK_TEST_VERSION: '0.0.0' })
  writeFileSync(join(bin, 'node'), '#!/bin/sh\nprintf "v16.0.0\\n"\n', { mode: 0o755 })
  hook(root, input(), 1, [])
  rmSync(join(bin, 'node'))
  rmSync(join(root, 'node_modules/.bin/tsc'))
  hook(root, input(), 1, [])

  const configured = fixture('unrelated config')
  git(configured, 'config', '--local', 'core.hooksPath', 'custom hooks')
  install(configured, 1)
  assert.equal(git(configured, 'config', '--get', 'core.hooksPath'), 'custom hooks')
  const occupied = fixture('active hooks')
  const activeHook = join(occupied, '.git/hooks/pre-commit')
  writeFileSync(activeHook, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  install(occupied, 1)
  assert.equal(readFileSync(activeHook, 'utf8'), '#!/bin/sh\nexit 0\n')
  const worktree = join(temporary, 'linked checkout')
  git(occupied, 'worktree', 'add', '--detach', worktree, 'HEAD')
  install(worktree, 1)
  rmSync(activeHook)
  install(worktree, 0)
  console.log(`PASS: ${assertions} executable hook/installer cases. Commands stubbed; no outbound push.`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
