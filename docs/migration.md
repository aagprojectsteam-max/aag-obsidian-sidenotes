# SideNotes identity decision — 2026-09-10

CANONICAL_ID=context-aware-paragraph-notes
DECISION=PRESERVE_PUBLIC_INSTALLED_CONTINUITY

The public [original repository](https://github.com/adirgalon-dev/Obsidian-Plugin-Side-Notes) and its [0.2.0 release](https://github.com/adirgalon-dev/Obsidian-Plugin-Side-Notes/releases/tag/0.2.0) use `context-aware-paragraph-notes`, matching historical manifests and the existing view type. The public LICENSE is MIT, copyright 2026 AAG, byte-identical to the existing local license. A local rename to `aag-sidenotes` is not an installed migration.

Under the explicit instruction to favor continuity, retain the historical ID. The original local manifest/runtime is preserved; the publication candidate uses the canonical ID. Keep `_SideNotes`, attachments, Markdown anchors, SideNotesID/legacy SideNoteID values and the view type in place. A new repository URL must not imply a new plugin ID or a second active installation.

The candidate refuses loading when either other identity is already loaded; a shared per-vault owner token also prevents duplicate candidate instances. Every store save rechecks loaded identities, including a legacy plugin enabled later. It cannot modify an already-distributed legacy plugin, so both identities must be disabled during installation/migration. Cross-process Obsidian instances and sync are not coordinated by this in-process guard.

The read-only identity planner now selects historical settings if present, otherwise copies the complete renamed installation settings. If both settings files differ, it refuses an automatic merge. No data is deleted and no migration is performed against an existing vault.

## Acceptance and rollback

1. Disable both identities. Back up both plugin directories/settings, `_SideNotes`, attachments and Markdown as one consistent set.
2. Keep or restore the historical plugin directory. If only the renamed settings exist, copy the complete settings file after backup; if both differ, reconcile them explicitly.
3. Install candidate assets in `context-aware-paragraph-notes`; keep only that identity enabled. Update BRAT's repository entry without installing a duplicate identity.
4. Check paragraph/file/orphan notes, IDs, anchors, Hebrew/English directions, media, export and re-enable/reload in a disposable copy first.
5. Roll back with both plugins disabled: restore the matching runtime/settings and consistent data backup; enable only the previous working identity.

A consistent backup and a disposable-vault acceptance test are required before a production migration.
