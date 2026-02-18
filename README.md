# tk-proxy

Simple proxy wrapper around `tokscale` to:

1. Capture `tokscale submit` command output and canonical payload into JSON.
2. Combine multiple machine payloads into one merged report.
3. Submit the merged report to Tokscale.


I use agents across multiple machines and want to see my combined usage. 

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
