# BangumiTV Development Constraints

## Documentation Sync

**Rule:** [`docs/rules/docs-sync.md`](docs/rules/docs-sync.md)

Every fix/refactor/feat must be committed and pushed immediately. Documentation updates ship in the same or immediately following commit. Before release, a full documentation audit is required — no forward-looking or unimplemented content allowed in docs.

## Comet Phase Guard

**Rule:** [`.claude/rules/comet-phase-guard.md`](.claude/rules/comet-phase-guard.md)

Phase-aware workflow enforcement. When a `.comet.yaml` exists, the current phase determines which operations are permitted.
