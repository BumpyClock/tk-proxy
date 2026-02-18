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

## Dependency check (TypeScript toolchain)

- `typescript@5.9.3` (registry metadata: modified 2026-02-18).
- `@types/node@25.2.3` (registry metadata: modified 2026-02-10).
- Both are actively maintained and standard choices for Node TypeScript CLIs.
