# Architecture and data continuity

`SideNotesPlugin` coordinates settings, paragraph context, persistence, import/export and host events. `SideNotesView` extends ItemView, registered as context-aware-paragraph-notes-view; the view identity is intentionally independent of the currently edited manifest ID. ConfirmModal and TextPromptModal gate destructive/user-text actions; SideNotesSettingTab exposes the configuration.

Four commands: open-paragraph-notes, toggle-new-note-composer (Shift+PageUp), import-sidenotes-bundle, export-full-sidenotes-backup. Sidebar modes are paragraph, file, orphaned and vault. File-menu/files-menu export hooks and ribbon access supplement commands. No custom protocol handler is registered.

## Persistence

Plugin-scoped settings use loadData/saveData. Actual notes are in `_SideNotes/side-notes-data.json`, with images/audio/video/files in corresponding subdirectories. Data maps are `files` (legacy), `sideNoteIds` (path → identity), and `filesBySideNoteId` (identity → path/name/blocks). Each block stores notes, fingerprint and optional line range; each note retains its ID/timestamps, text/type and optional media URL/path/display transforms. Legacy fileIds/filesById are normalized. SideNotesID frontmatter is preferred; SideNoteID and its prefix remain migration inputs. Renames retain identities; deletes remove live path mappings while keeping orphan notes for later review/export.

`loadSideNotesData` prefers external storage and migrates legacy plugin data only if external storage is absent. Corrupt/unreadable external data aborts without overwrite. `savePluginState` writes settings then the external store; writes are not yet a multi-file transaction. An interrupted multi-file import may leave partial content. Back up the store and attachments before deployment/migration.

## Anchors and editing

Internal anchor mode stores paragraph fingerprints/line ranges without inserting Markdown IDs. Optional block-id mode inserts IDs with the configured prefix (default side-note), can hide owned IDs, and protects their ranges using CodeMirror decorations/transaction filtering. Helpers find paragraph/fence/list ranges, detect foreign markers and redirect protected deletions. Existing file properties can be restored on modify; migration runs on load when enabled. Whole-vault property mutation and host undo behavior need GUI acceptance.

## Transfer and backup

A `.sidenotes` JSON envelope has type side-notes-transfer-bundle, version 1, exportedAt and files. Files include Markdown content, identity, blocks and base64 attachments. Import picks available Markdown names and new IDs on collision; media paths remap when existing referenced attachments would collide. Generic linked attachments may reuse existing files. Full export can include orphan notes. File pickers and fallback vault export are separate host paths. The regression harness checks content preservation and binary bytes using synthetic data only.

Settings include anchor storage/insertion/prefix/hiding/protection, confirmation, collapsed/expanded controls, export spacing/orphans, note font family and sizes, button/header sizing, auto/RTL/LTR direction, file identity properties, selection updates and debounce. See engineering-symbols.json for complete method and setting indexes.

Runtime imports are host-provided Obsidian and CodeMirror state/view. TypeScript is a development compiler. Audio recording, clipboard/media/file/font access, external file URLs, Markdown rendering and sidebar geometry require host/platform tests. No external network service is configured by this plugin.
