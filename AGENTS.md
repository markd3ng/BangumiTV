# BangumiTV Subagent Constraints

## Documentation Sync

**Rule:** [`docs/rules/docs-sync.md`](docs/rules/docs-sync.md)

Commit and push after every atomic change. Docs update with code. Release requires full doc audit — no speculative or unimplemented content in user-facing docs.

## Comet Phase Guard

**Rule:** [`.claude/rules/comet-phase-guard.md`](.claude/rules/comet-phase-guard.md)

Check phase state before any operation that could violate workflow boundaries.
