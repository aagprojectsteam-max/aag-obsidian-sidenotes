# Interrupted import recovery

The plugin retains `_SideNotes/.import-pending.json` when an import cannot finish. Preserve it, the current store, imported Markdown/media and plugin settings in a consistent backup before recovery. Previously saved store bytes are preserved if staging or rename fails. Newly created files may remain and are never blindly deleted.

With SideNotes disabled, run `node scripts/recover-import.cjs JOURNAL_PATH NEW_EXPORT_PATH` on a **copy** of the journal outside the working vault. The destination must not exist. This exports the original store, completed file mappings, created paths and the complete transfer payload; it does not modify the vault or remove evidence.

Review `store` against actual imported files and current valid notes. `before` is the pre-import state; it does not contain subsequent work. `uncompletedTransferBundle` retains notes/media for entries that failed or were interrupted. Do not overwrite newer valid notes with either snapshot. Reconcile in a disposable vault and test notes, orphaned entries, frontmatter IDs and media before copying any reviewed result back. Keep all backups. Remove the live journal only after the reconciled store and existing files are verified with SideNotes disabled.

A journal after a successful store commit but failed cleanup can already match the current store. Compare the data before changing it. Adapter rename is a single filesystem operation on the tested desktop filesystem; sync and multiple running Obsidian processes are not a distributed transaction.
