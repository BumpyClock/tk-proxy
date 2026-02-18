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
