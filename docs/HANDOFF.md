# Engineering Handoff — SideNotes

## Purpose

This handoff ties together SideNotes architecture, identity/migration behavior, import recovery, transaction safety, testing and publication so a future maintainer can change the plugin without corrupting note associations.

## Project role

SideNotes provides context-aware paragraph/side-note behavior in Obsidian. Its core difficulty is not drawing a side panel; it is maintaining a stable semantic relationship between a note/paragraph context and its side-note data while documents evolve, plugins reload and older data formats migrate.

## Identity model

Identity handling is a first-class subsystem and is covered by `tests/identity.test.cjs` plus the identity planning script. Do not replace semantic identity with transient editor DOM positions. Any identity change must define migration behavior for existing users and must be deterministic across reloads.

## Transaction safety

Side-note updates can touch persistent plugin/note state. `tests/transaction.test.cjs` exists to protect transactional behavior. A failed operation should not leave half-migrated or half-written associations. Recovery must prefer preserving user data over silently normalizing an ambiguous state.

## Migration and import recovery

`docs/migration.md` documents data migration and `docs/import-recovery.md` documents recovery from import problems. `scripts/recover-import.cjs` is a deliberate recovery tool, not a normal startup shortcut. Future schema changes should add an explicit version/migration path and regression fixtures rather than mutating old data opportunistically.

## Architecture and source

`main.ts` is the TypeScript source and `main.js` the built runtime. `docs/architecture.md` describes the major components. `docs/engineering-symbols.json` provides a generated engineering inventory useful when reviewing the large source. Keep source and built artifact synchronized through the project build/release process.

## Testing

The repository has identity, regression and transaction suites with a shared harness. CI runs from `.github/workflows/ci.yml`. Publication gates are scripted. Changes to actual Obsidian editor/layout integration should additionally receive real-app acceptance because test harnesses cannot fully reproduce Obsidian rendering/event timing.

## Publication

Release automation is in `.github/workflows/release.yml` and `scripts/release.cjs`; `publication-files.json` and `publication-status.json` define/record publication state. The public release line reached **0.2.1**. `docs/releases.md` and `docs/release-notes.md` preserve release history.

## Repository map

- `README.md` — user documentation.
- `DEVELOPMENT.md` — developer workflow.
- `docs/architecture.md` — design.
- `docs/migration.md` — persistent-data migration.
- `docs/import-recovery.md` — recovery procedure.
- `docs/engineering-symbols.json` — source inventory.
- `main.ts` / `main.js` — source/built runtime.
- `tests/` — identity/regression/transaction coverage.
- `scripts/` — identity, recovery, tests, publication and release.
- `.github/workflows/` — CI/release.

## Maintenance procedure

For a data/identity change: checkpoint the current release; document the old and new schema/identity; implement a one-way deterministic migration with rollback/recovery plan; add old-data fixtures; test interruption/failure; run identity/regression/transaction suites; build; test real Obsidian reload/edit/move scenarios; verify import recovery; run publication gates; update migration/release notes/handoff; publish and verify assets.

## Historical integrity rule

Do not “fix” an old association by guessing which paragraph the user intended. Ambiguous recovery should be surfaced or conservatively preserved. Keep migration/recovery evidence because it explains why identity and transaction code is intentionally defensive.

## Current handoff status

As of 2026-09-15, SideNotes has architecture, migration/import-recovery and development documentation, identity/transaction/regression tests, engineering symbol inventory, CI/release tooling, publication metadata and this handoff.