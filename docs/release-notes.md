# AAG - SideNotes 0.2.2

This release keeps the public plugin identity `context-aware-paragraph-notes` while adopting the AAG - SideNotes display name.

Highlights:
- Preserves unreadable/corrupt SideNotes stores instead of replacing them.
- Keeps import recovery journals and duplicate-writer guards.
- Fixes copied-file SideNotesID collisions and orphan-export identity handling.
- Preserves unrelated editor changes in protected block-ID transactions.
- Serializes imports before the first asynchronous preflight step.
- Cancels incomplete full exports when an attachment cannot be read.
- Tightens URL handling and draft/save concurrency.
- Removes the default hotkey so users can choose their own shortcut.
- Protects the actual configured Obsidian config directory instead of assuming `.obsidian`.
- Avoids rewriting the SideNotes store merely because the plugin started.
- Uses Obsidian `Vault.process()` for updates to the existing SideNotes store, with the previous staged-write path retained as a compatibility/test fallback.

Acceptance:
- TypeScript typecheck: PASS.
- Automated tests and publication gates: PASS.
- Clean-build reproducibility: PASS.
- Real Obsidian 1.13.7 acceptance: PASS with the existing user store (32 SideNotes IDs / 46 stored file records); Command Palette and sidebar both load.
- Existing 16-file `_SideNotes` tree remained intact throughout acceptance.

Release assets remain exactly `main.js`, `manifest.json`, and `styles.css`.
