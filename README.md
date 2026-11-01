# tk-proxy

Simple proxy wrapper around `tokscale` to:

1. Capture `tokscale submit` command output and canonical payload into JSON.
2. Combine multiple machine payloads into one merged report.
3. Submit the merged report to Tokscale.
4. Run a central server that accepts captures from multiple clients.
5. Run periodic clients that upload machine captures to the server.

## Install locally

```bash
bun install --frozen-lockfile
bun link
```

Then run `tk-proxy`.

## Capture

```bash
tk-proxy --capture -- tokscale submit --dry-run
```

This writes a capture file like:

```text
tk-capture-<hostname>-<timestamp>.json
```

If the command is `tokscale submit ...`, capture also attempts:

```text
tokscale graph --no-spinner [matching filters]
```

and stores that JSON as `submitPayload`.

## Combine

```bash
tk-proxy --combine -i host-a.json host-b.json -o combined.json
```

Input files may be:

- `tk-proxy` capture files containing `submitPayload`
- direct `tokscale graph --no-spinner` JSON payloads

## Submit

```bash
tk-proxy --submit -i combined.json
```

Uses the same credentials and endpoint strategy as tokscale CLI:

- Credentials: `~/.config/tokscale/credentials.json`
- API base URL: `TOKSCALE_API_URL` or `https://tokscale.ai`
- Endpoint: `POST /api/submit`

Dry-run mode:

```bash
tk-proxy --submit -i combined.json --dry-run
```

## Distributed Mode

Run one central server:

```bash
tk-proxy --server --host 0.0.0.0 --port 8787 --auth-token <shared-token>
```

Run clients on each machine:

```bash
tk-proxy --client http://<server-ip>:8787 --auth-token <shared-token>
```

Default client cadence is 4h plus up to 1h jitter, so uploads happen every 4-5 hours.

The server stores latest payload per client and submits a combined payload once per UTC day.

If auth is enabled and no token is provided, server auto-generates one at startup and prints it for client use.

Quick start with auto-generated token:

```powershell
.\bin\tk-proxy.exe --server
# copy token from startup output and set for client shell:
$env:TK_PROXY_AUTH_TOKEN = "<printed-token>"
.\bin\tk-proxy.exe --client http://<server-ip>:8787
```

For stable long-running deployments, set a fixed token instead of relying on auto-generation each restart.

### Server options

- `--host` (default `0.0.0.0`)
- `--port` (default `8787`)
- `--data-dir` (default `./.tk-proxy`)
- `--submit-hour-utc` (default `2`, range `0-23`)
- `--check-interval` (default `10m`)
- `--auth-token` (or `TK_PROXY_AUTH_TOKEN`)
- `--no-auth` (disable HTTP auth; for trusted/local networks only)
- `--dry-run-submit` (combine and persist daily output without calling Tokscale)

### Client options

- `--client-id` (default hostname)
- `--interval` (default `4h`)
- `--jitter` (default `1h`)
- `--request-timeout` (default `30s`)
- `--auth-token` (or `TK_PROXY_AUTH_TOKEN`)
- `--no-auth` (connect to a server started with `--no-auth`)
- `--once` (single capture/upload cycle)

### HTTP endpoints

- `POST /v1/captures` (auth unless `--no-auth`): receive client payloads
- `GET /status` (auth unless `--no-auth`): server state + client list
- `GET /healthz` (no auth): liveness check

### Server storage layout

- `./.tk-proxy/clients/<clientId>.json` (latest payload per client)
- `./.tk-proxy/state.json` (last submit status)
- `./.tk-proxy/submissions/<yyyy-mm-dd>.json` (daily combined payload + submit response)

## Optional local pre-push checks

Prepare Bun 1.3.3 (`package.json#packageManager`), a Node version satisfying
`engines.node`, and `bun install --frozen-lockfile`. Opt in with
`bun run hooks:install`. No installation occurs automatically. The installer
refuses unrelated `core.hooksPath` settings and active default hooks. Repeating
installation is safe. Repository-local `.githooks` applies to linked worktrees,
which must contain these tracked files.

The hook runs full-project `bun run typecheck`, then `bun run test`. Tests still
compile TypeScript before running Node on emitted `dist/test/*.test.js`; only
ignored build outputs are written. No capture, submit, scheduling, server,
credentials, downloads, or dependency installation occurs. No formatter or linter
policy exists here; this gate does not claim format/lint coverage.

Each non-deleted pushed ref, including peeled tags, must point to checked-out HEAD.
Tracked and untracked changes block validation. Use a separate clean checkout
for each different pushed commit. Full scopes handle new branches, unavailable
remote bases, renames, deletions and shared configs without filename skips.
Deletion-only pushes skip project checks; empty stdin runs full checks. Tool
failure exit codes propagate without stashing or switching the checkout.

`bun run test:hooks` runs actual hook/installer fixtures with stub commands and no
outbound push. It is separate from the real Node runtime suite. Windows hook
execution still requires matching Git/Bun/Node host validation; a Linux harness
is not native Windows acceptance. No CI is activated.

## Test

```bash
bun run test
```

## Build Executable

Create a self-contained executable for the current platform:

```bash
bun run build
```

Output path:

- Windows: `bin/tk-proxy.exe`
- macOS/Linux: `bin/tk-proxy`
