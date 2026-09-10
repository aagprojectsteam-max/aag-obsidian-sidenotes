# Release preparation

This is not an authorized public release stream. Run npm run verify, npm run release:stage and npm run release:check to create/check only the three runtime assets. No upload workflow, remote creation or version-tag automation is enabled.

Before publication, resolve identity (SideNotes), companion coordination/installability (AnkiBridge), redistribution rights and privacy/history gates. Confirm the supported minimum host/platforms. Select an unused release version only after checking the intended distribution. Use a new clean source-export Git history, retain notices, run hosted CI, inspect a draft and compare anonymous asset hashes. Never restore historical asset-deletion or clobber workflows.
