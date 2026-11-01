import { execFileSync, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

try {
  if (git('rev-parse', '--show-toplevel') !== root) throw new Error('installer must belong to this checkout')
  const existing = spawnSync('git', ['config', '--get-all', 'core.hooksPath'], { encoding: 'utf8' })
  if (existing.error || ![0, 1].includes(existing.status ?? -1)) throw new Error('cannot inspect core.hooksPath')
  const configured = existing.stdout.trim().split('\n').filter(Boolean)
  if (configured.some((value) => value !== '.githooks')) throw new Error('existing core.hooksPath is unrelated; no configuration changed')
  if (configured.length === 0) {
    const hooks = resolve(root, git('rev-parse', '--git-path', 'hooks'))
    if (existsSync(hooks)) {
      for (const name of readdirSync(hooks)) {
        if (name.endsWith('.sample')) continue
        const hook = resolve(hooks, name)
        if (!statSync(hook).isFile()) continue
        try {
          accessSync(hook, constants.X_OK)
        } catch {
          continue
        }
        throw new Error(`existing active hook ${name}; migrate it explicitly before installation`)
      }
    }
  }
  accessSync(resolve(root, '.githooks/pre-push'), constants.X_OK)
  git('config', '--local', 'core.hooksPath', '.githooks')
  console.log('Installed .githooks for this repository. Linked worktrees share this local setting.')
} catch (error) {
  console.error(`install-hooks: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
