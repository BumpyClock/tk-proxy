# tk-proxy

Simple proxy wrapper around `tokscale` to:

1. Capture `tokscale submit` command output and canonical payload into JSON.
2. Combine multiple machine payloads into one merged report.
3. Submit the merged report to Tokscale.
4. Run a central server that accepts captures from multiple clients.
5. Run periodic clients that upload machine captures to the server.

## Install locally

```bash
bun install
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

- `POST /v1/captures` (auth required): receive client payloads
- `GET /status` (auth required): server state + client list
- `GET /healthz` (no auth): liveness check

### Server storage layout

- `./.tk-proxy/clients/<clientId>.json` (latest payload per client)
- `./.tk-proxy/state.json` (last submit status)
- `./.tk-proxy/submissions/<yyyy-mm-dd>.json` (daily combined payload + submit response)

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
