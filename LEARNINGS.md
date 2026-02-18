# LEARNINGS

- For Tokscale automation, treat `tokscale graph --no-spinner` as the canonical machine payload interface and `tokscale submit` as a transport wrapper. This avoids brittle parsing of terminal output and keeps compatibility with Tokscale's server contract.
