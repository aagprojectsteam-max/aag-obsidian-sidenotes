# Development

main.ts is authoritative source; styles.css is authored CSS. Run `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run build`, or `npm run verify`. The engineering build now emits dist/build/main.js without embedded source maps and leaves root main.js untouched (the staged candidate, not the original development runtime). The historical `npm run dev` still watches/emits the root runtime; do not use it against an active vault without deliberate deployment approval.

Tests transpile the actual main.ts and invoke its functions/methods against guarded synthetic filesystem adapters. They cover corrupt-store preservation, import path validation, settings/property migration, collisions, attachment remapping, export round trips, rename/orphan preservation and Unicode. The adapter simulates Obsidian frontmatter/cache integration; this is not a real GUI or host transaction test.

Two source fixes are prepared: failure to parse/read the existing store now aborts loading rather than saving empty defaults; imported paths cannot retain dot traversal, absolute/drive paths or enter default/custom vault configuration folders. Existing data is never edited by the tests. Source output differs from the installed bundle for these intentional fixes; do not claim byte equivalence to the installed bundle.

Plugin identity is not decided by the build. Working manifest remains aag-sidenotes 0.2.0 while historical distribution used context-aware-paragraph-notes. Do not publish or auto-migrate until the root SIDENOTES-IDENTITY-DECISION.md is resolved. Preserve the existing MIT license and dependency notices. Release workflow reconstruction must never reuse the historical overwriting/deleting workflow.
