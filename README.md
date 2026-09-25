# SideNotes

SideNotes adds paragraph-linked sidebar notes, media and exports. This AAG-maintained continuation preserves the historical plugin ID `context-aware-paragraph-notes`.

SideNotes is an Obsidian plugin for writing sidebar notes that stay connected to the paragraph you are reading or editing.

SideNotes stores notes separately in `_SideNotes` and links them to the exact paragraph that matters. Move through your document, and the sidebar follows your cursor, showing only the notes that belong to the current paragraph. You can also switch to a file-wide view to review every note saved for the current file.

## What's New in 0.2.0

- Added selected-note export to Markdown. The export button now exports only the notes selected in the current view.
- Selected exports work from the current paragraph view, current file view, orphaned notes view, and all-vault view.
- Selected exports are grouped by file name, `SideNotesID`, and `BlockID`, with a blank line between notes in the same block.
- Added `Shift+Enter` in the new-note editor to add a note quickly.
- After adding a note, focus returns to the new-note editor so you can keep writing.
- Switching between sidebar views now clears the current selection, preventing selected notes from one view from carrying into another.
- Improved `.sidenotes` transfer behavior, including linked vault attachments, non-destructive imports, and duplicate `SideNotesID` protection.

## Features

- Add notes to the paragraph under your cursor
- View notes for the current paragraph, the current file, orphaned files, or the whole vault
- Keep notes in a sidebar, separate from the Markdown text
- Collapse and expand notes for cleaner reading
- Edit, delete, cut, paste, and bulk-select notes
- Use Markdown inside notes
- Choose note direction: automatic, right-to-left, or left-to-right
- Choose note font and note font size
- Store a stable `SideNotesID` in file properties
- Recover note connections using paragraph fingerprints and stored anchors
- Export Markdown files together with their SideNotes
- Import `.sidenotes` transfer files into another vault
- Include linked vault attachments, such as images and PDFs, in transfer files

## Transfer Files With SideNotes

SideNotes can export a Markdown file together with its saved notes into a `.sidenotes` transfer file.

The transfer file includes the Markdown content, the file identity, the saved paragraph notes, paragraph anchors, fingerprints, line metadata, and linked non-Markdown vault attachments. This is useful when you want to move a note to another computer or another vault while keeping its SideNotes attached.

When importing, SideNotes avoids overwriting existing Markdown files. If a file already exists, the imported file gets a free name such as `File imported.md`. If the imported `SideNotesID` is already used in the target vault, the imported file receives a new unused `SideNotesID`, so two files do not share the same note identity.

## How Notes Are Stored

SideNotes stores note data inside the vault:

```text
_SideNotes/side-notes-data.json
```

Each Markdown file can also receive a `SideNotesID` property. This ID is used as the stable identity of the file, so notes can stay connected even when file paths change.

The plugin does not store your notes on an external server. Everything stays inside your Obsidian vault.

## Installation

Requires Obsidian `1.13.0` or newer.

### Manual Install

Download or build the plugin files, then copy these files into:

```text
.obsidian/plugins/aag-sidenotes
```

Required files:

```text
main.js
manifest.json
styles.css
```

Then open Obsidian, go to `Settings -> Community plugins`, enable community plugins if needed, and enable `SideNotes`.

### Build From Source

Clone this repository, install dependencies, and build:

```bash
npm install
npm run build
```

The generated `main.js` file is the file Obsidian loads.

## Privacy And Safety

Do not publish your personal vault data with the plugin source.

Files such as `_SideNotes/side-notes-data.json`, `.sidenotes` exports, `.obsidian`, and local plugin `data.json` may contain private information and should stay out of public repositories.

## Disclosures

- SideNotes does not use telemetry, analytics, ads, accounts, or external network services.
- SideNotes stores its data locally inside your Obsidian vault.
- When exporting `.sidenotes` files, the plugin reads linked non-Markdown vault attachments so they can be included in the transfer file.
- The plugin may open the system Save As dialog when exporting transfer files.
- The note font dropdown may request the local font list through the browser font access API when that API is available.

## Status

This plugin is in active development. It is already usable, but please keep backups of important vaults when testing new versions.

## License

MIT


## 0.2.1 safety and continuity

This continuation is based on [AAG's existing MIT SideNotes source](https://github.com/adirgalon-dev/Obsidian-Plugin-Side-Notes), whose public release is 0.2.0. The original MIT copyright notice is retained. This repository contains a clean source history; it does not claim to transfer ownership of the original repository or its Community listing.

Keep only one SideNotes installation enabled. The historical ID remains `context-aware-paragraph-notes`; do not also enable a local `aag-sidenotes` installation. See [migration and rollback](docs/migration.md). Minimum tested development host is Obsidian 1.13.7. Mobile, theme and live migration acceptance are not claimed by the synthetic test suite.

Corrupt stores stop loading without replacement. Store saves verify a temporary file before adapter rename. Imports preflight paths and binary data, preserve existing files through unique names, and keep a recovery journal. Multi-file imports are **not globally atomic**: a crash can leave newly imported files and media. On interruption, loading and further saves stop to preserve recovery evidence. See [import recovery](docs/import-recovery.md); do not delete an unexplained journal or replace valid notes with empty data.

## Installation and updates

Download `main.js`, `manifest.json` and `styles.css` from [release 0.2.1](https://github.com/aagprojectsteam-max/aag-obsidian-sidenotes/releases/tag/0.2.1). With both SideNotes identities disabled and a consistent backup made, place the files under `.obsidian/plugins/context-aware-paragraph-notes/`. Preserve your existing `data.json`. Test a disposable copy before using migration or restore on valuable notes.

For BRAT, use `aagprojectsteam-max/aag-obsidian-sidenotes`. Remove the old repository tracking entry after backup if it points to the same plugin identity; do not let two tracked repositories alternate versions. This release has not been submitted as a new Community entry.

## Privacy and development

Notes, IDs and attachments are stored in your vault. Commands can write Markdown frontmatter/anchors, import files and access the clipboard or user-selected media; linked images or external links may use their destinations when displayed/opened. No telemetry, accounts or paid service is required. Local font/audio/clipboard features depend on host permissions. No automatic updater is included.

Run `npm ci --ignore-scripts`, then `npm run verify`. Build output stays under `dist/build`; release packaging allowlists three runtime assets and never includes local settings. TypeScript and host Obsidian/CodeMirror packages are development/external dependencies, not copied implementations in the plugin bundle.

## 0.2.2 hardening

Version 0.2.2 keeps the historical public plugin ID and adds stricter store failure handling, verified queued saves, duplicate-identity protection, safer orphan export behavior, serialized imports, media/export failure reporting, recording lifecycle guards, URL policy centralization, and transaction-preserving block-ID protection.

Before release, the exact three-file 0.2.2 candidate must pass a real Obsidian load and UI acceptance test; the user's current GOLDEN installation is intentionally not replaced by this preview branch.
