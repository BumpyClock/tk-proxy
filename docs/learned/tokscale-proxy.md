# Tokscale Proxy Notes

## What `tokscale submit` sends

- In `@tokscale/cli` (`src/submit.ts`), submit sends `TokenContributionData` to:
  - `POST ${TOKSCALE_API_URL || "https://tokscale.ai"}/api/submit`
  - Header: `Authorization: Bearer <token>`
- Token comes from `~/.config/tokscale/credentials.json`.

## Best payload source for proxying

- `tokscale submit --dry-run` is human-readable text, not machine JSON.
- `tokscale graph --no-spinner` outputs the same contribution payload shape required by submit.
- Proxy should derive canonical data from graph output and not parse submit text.

## Merge strategy

- Merge at row granularity:
  - key: `date + source + modelId + providerId`
- Recompute per-day totals, summary, and year aggregates from merged rows.

## Distribution

- For single-file distribution, compile directly with Bun:
  - `bun build ./src/cli.ts --compile --outfile ./bin/tk-proxy`
- On Windows this produces `bin/tk-proxy.exe`.

## Server/client topology

- Server mode accepts machine payload uploads over HTTP and stores only the latest payload per client.
- Daily combined submit should run in UTC and gate on a persisted `lastSubmittedDate` so restart does not cause duplicate submits.
- A practical client cadence is base `4h` plus jitter `1h` so clients spread over the 4-5h target window.
- Keep auth simple with a shared bearer token over Tailscale/private network.
- For operator ergonomics, server can auto-generate and print a bearer token if none is provided.
- Add `--no-auth` for trusted-network setups or local debugging.

## Persistence contract

- `clients/<clientId>.json`: latest uploaded payload and metadata (`capturedAt`, `receivedAt`, `sourceHost`).
- `state.json`: `lastSubmittedDate`, `lastSubmittedAt`, `lastSubmitError`, `lastSubmissionId`.
- `submissions/<yyyy-mm-dd>.json`: combined payload plus submit response for auditability and replay/debug.

## Dependency check (TypeScript toolchain)

- `typescript@5.9.3` (registry metadata: modified 2026-02-18).
- `@types/node@25.2.3` (registry metadata: modified 2026-02-10).
- Both are actively maintained and standard choices for Node TypeScript CLIs.
