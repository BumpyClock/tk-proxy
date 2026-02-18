# LEARNINGS

- For Tokscale automation, treat `tokscale graph --no-spinner` as the canonical machine payload interface and `tokscale submit` as a transport wrapper. This avoids brittle parsing of terminal output and keeps compatibility with Tokscale's server contract.
- For local CLI portability, keep TypeScript sources in `src/` and compile to `dist/` with `tsc`; point the package `bin` to compiled JS so users don't need runtime transpilers.
- Pin Bun in `packageManager` and keep a `bun.lock` so contributor environments resolve tooling consistently.
- Bun can produce a self-contained platform binary directly from `src/cli.ts` via `bun build --compile`; keep the output under `bin/` and ignore it in git.
- For multi-machine aggregation, persist only each client's latest payload and gate daily submission on a persisted UTC date (`lastSubmittedDate`) to avoid double submits across server restarts.
- For CLI ops UX, auth-enabled server startup can auto-generate a shared token and print/export hints; pair with explicit `--no-auth` when running only on trusted networks.
