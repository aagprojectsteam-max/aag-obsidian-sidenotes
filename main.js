"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const state_1 = require("@codemirror/state");
const view_1 = require("@codemirror/view");
const VIEW_TYPE_SIDE_NOTES = "context-aware-paragraph-notes-view";
const BLOCK_ID_PATTERN = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/;
const SIDE_NOTES_FOLDER = "_SideNotes";
const SIDE_NOTES_DATA_PATH = `${SIDE_NOTES_FOLDER}/side-notes-data.json`;
const SIDE_NOTES_IMAGES_FOLDER = `${SIDE_NOTES_FOLDER}/images`;
const SIDE_NOTES_AUDIO_FOLDER = `${SIDE_NOTES_FOLDER}/audio`;
const SIDE_NOTES_VIDEO_FOLDER = `${SIDE_NOTES_FOLDER}/video`;
const SIDE_NOTES_FILES_FOLDER = `${SIDE_NOTES_FOLDER}/files`;
const SIDE_NOTES_ID_PROPERTY = "SideNotesID";
const LEGACY_SIDE_NOTE_ID_PROPERTY = "SideNoteID";
const SIDE_NOTES_ID_PREFIX = "SideNotesID";
const LEGACY_SIDE_NOTE_ID_PREFIX = "SideNoteID";
const SIDE_NOTES_BUNDLE_TYPE = "side-notes-transfer-bundle";
const SIDE_NOTES_BUNDLE_VERSION = 1;
const SIDE_NOTES_BUNDLE_MIME_TYPE = "application/x-sidenotes";
const DEFAULT_NOTE_FONT_LABEL = "Obsidian default";
const FALLBACK_NOTE_FONT_FAMILIES = [
    "Arial",
    "Calibri",
    "Cambria",
    "Consolas",
    "Courier New",
    "David",
    "Georgia",
    "Miriam",
    "Narkisim",
    "Segoe UI",
    "Tahoma",
    "Times New Roman",
    "Verdana"
];
const DEFAULT_SETTINGS = {
    anchorStorage: "internal",
    autoInsertBlockIds: true,
    blockIdPrefix: "side-note",
    confirmBeforeDelete: true,
    defaultNotesExpanded: false,
    exportBlankLineBetweenNotes: true,
    hidePluginBlockIds: true,
    headerCollapsed: false,
    headerFontSizePx: 13,
    includeOrphanedInFullExport: false,
    noteFontFamily: "",
    noteFontSizePx: 16,
    noteEditorFontSizePx: 16,
    notePreviewFontSizePx: 16,
    noteOpenFontSizePx: 16,
    buttonSizePx: 28,
    noteDirection: "auto",
    showAllVaultNotesButton: false,
    storeSideNoteIDInProperties: true,
    updateOnSelectionChange: true,
    updateDebounceMs: 150
};
const DEFAULT_DATA = {
    files: {},
    sideNoteIds: {},
    filesBySideNoteId: {}
};
const DRAFT_UNDO_LIMIT = 100;
const IMPORT_JOURNAL = "_SideNotes/.import-pending.json";
const SIDE_NOTES_OWNER = Symbol.for("aag.sidenotes.store-owner");
class SideNotesPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.currentContext = null;
        this.lastMarkdownView = null;
        this.suppressContextRefreshUntil = 0;
        this.importInProgress = false;
        this.importCreated = null;
        this.storeSaveQueue = Promise.resolve();
    }
    acquireStoreOwnership() {
        var _a, _b;
        const host = this.app;
        const installed = (_b = (_a = this.app.plugins) === null || _a === void 0 ? void 0 : _a.plugins) !== null && _b !== void 0 ? _b : {};
        for (const id of ["context-aware-paragraph-notes", "aag-sidenotes"]) {
            if (installed[id] && installed[id] !== this)
                throw new Error("Disable the other SideNotes installation before enabling this plugin.");
        }
        if (host[SIDE_NOTES_OWNER] && host[SIDE_NOTES_OWNER] !== this)
            throw new Error("Another SideNotes instance owns this vault store.");
        host[SIDE_NOTES_OWNER] = this;
    }
    assertStoreOwnership() {
        var _a, _b;
        const installed = (_b = (_a = this.app.plugins) === null || _a === void 0 ? void 0 : _a.plugins) !== null && _b !== void 0 ? _b : {};
        for (const id of ["context-aware-paragraph-notes", "aag-sidenotes"]) {
            if (installed[id] && installed[id] !== this)
                throw new Error("Disable the other SideNotes installation before writing notes.");
        }
        const host = this.app;
        if (host[SIDE_NOTES_OWNER] && host[SIDE_NOTES_OWNER] !== this)
            throw new Error("Another SideNotes instance owns this vault store.");
    }
    async onload() {
        this.acquireStoreOwnership();
        try {
            await this.loadSettings();
            await this.loadSideNotesData();
        }
        catch (error) {
            this.onunload();
            throw error;
        }
        void this.migrateLegacySideNotesIDProperties();
        this.debouncedRefresh = (0, obsidian_1.debounce)(() => this.refreshContext(), this.settings.updateDebounceMs, true);
        this.registerView(VIEW_TYPE_SIDE_NOTES, (leaf) => new SideNotesView(leaf, this));
        if (this.settings.hidePluginBlockIds) {
            this.registerEditorExtension(createBlockIdHiderExtension(this.settings.blockIdPrefix, this.usesMarkdownBlockIds()));
        }
        this.addRibbonIcon("sticky-note", "Open paragraph notes", () => {
            void this.activateView();
        });
        this.addCommand({
            id: "open-paragraph-notes",
            name: "Open sidebar",
            callback: () => {
                void this.activateView();
            }
        });
        this.addCommand({
            id: "toggle-new-note-composer",
            name: "Toggle new note",
            callback: () => {
                void this.toggleNewNoteComposer();
            }
        });
        this.addCommand({
            id: "import-sidenotes-bundle",
            name: "Import transfer file",
            callback: () => {
                void this.importSideNotesBundleFromDisk();
            }
        });
        this.addCommand({
            id: "export-full-sidenotes-backup",
            name: "Export full backup",
            callback: () => {
                void this.exportAllSideNotesBundle(true);
            }
        });
        this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
            this.addSideNotesExportMenuItem(menu, [file]);
        }));
        this.registerEvent(this.app.workspace.on("files-menu", (menu, files) => {
            this.addSideNotesExportMenuItem(menu, files);
        }));
        this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.handleActiveLeafChange(leaf)));
        this.registerEvent(this.app.workspace.on("editor-change", () => this.debouncedRefresh()));
        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
            void this.handleRename(file, oldPath);
        }));
        this.registerEvent(this.app.vault.on("delete", (file) => {
            void this.handleDelete(file);
        }));
        this.registerEvent(this.app.vault.on("modify", (file) => {
            void this.restoreSideNoteIDPropertyForFile(file);
        }));
        if (this.settings.updateOnSelectionChange) {
            this.registerDomEvent(activeDocument, "selectionchange", () => {
                this.debouncedRefresh();
            });
        }
        this.registerInterval(window.setInterval(() => this.debouncedRefresh(), 500));
        this.addSettingTab(new SideNotesSettingTab(this.app, this));
    }
    onunload() {
        const host = this.app;
        if (host[SIDE_NOTES_OWNER] === this)
            delete host[SIDE_NOTES_OWNER];
        // Keep the sidebar leaf in place so Obsidian preserves the user's layout.
    }
    handleActiveLeafChange(leaf) {
        var _a;
        const markdownView = (leaf === null || leaf === void 0 ? void 0 : leaf.view) instanceof obsidian_1.MarkdownView ? leaf.view : null;
        const nextFile = markdownView === null || markdownView === void 0 ? void 0 : markdownView.file;
        if (!markdownView || !nextFile) {
            this.debouncedRefresh();
            return;
        }
        this.lastMarkdownView = markdownView;
        if (((_a = this.currentContext) === null || _a === void 0 ? void 0 : _a.filePath) === nextFile.path) {
            this.refreshContext({ force: true });
            return;
        }
        this.currentContext = null;
        for (const sideNotesLeaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDE_NOTES)) {
            const view = sideNotesLeaf.view;
            if (view instanceof SideNotesView) {
                view.resetForFileChange();
            }
        }
        window.requestAnimationFrame(() => {
            this.refreshContext({ force: true });
        });
    }
    async activateView() {
        const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDE_NOTES)[0];
        this.refreshContext({ force: true });
        if (existingLeaf) {
            await this.app.workspace.revealLeaf(existingLeaf);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        await (leaf === null || leaf === void 0 ? void 0 : leaf.setViewState({
            type: VIEW_TYPE_SIDE_NOTES,
            active: true
        }));
        if (leaf) {
            await this.app.workspace.revealLeaf(leaf);
        }
        this.refreshViews({ preserveScroll: true });
    }
    async toggleNewNoteComposer() {
        this.refreshContext({ force: true });
        const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDE_NOTES)[0];
        if (!existingLeaf) {
            await this.activateView();
            const newLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDE_NOTES)[0];
            const view = newLeaf === null || newLeaf === void 0 ? void 0 : newLeaf.view;
            if (view instanceof SideNotesView) {
                view.showComposer();
            }
            return;
        }
        await this.app.workspace.revealLeaf(existingLeaf);
        const view = existingLeaf.view;
        if (view instanceof SideNotesView) {
            view.toggleComposer();
        }
    }
    async loadSettings() {
        this.settings = getSideNotesSettingsFromPluginData(await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
    async loadSideNotesData() {
        this.assertStoreOwnership();
        if (await this.app.vault.adapter.exists(IMPORT_JOURNAL)) {
            throw new Error("An interrupted SideNotes import needs recovery. Preserve the journal, store and imported files before recovery; no data was changed on load.");
        }
        const externalData = await this.loadExternalSideNotesData();
        if (externalData) {
            this.sideNotesData = this.normalizeSideNotesData(externalData);
            await this.saveSideNotesData();
            return;
        }
        const legacyData = getPluginDataRecord(await this.loadData());
        this.sideNotesData = this.normalizeSideNotesData(Object.assign({}, DEFAULT_DATA, {
            files: getSideNotesFilesRecord(legacyData.files)
        }));
        if (Object.keys(this.sideNotesData.files).length > 0) {
            await this.saveSideNotesData();
        }
    }
    async savePluginState() {
        await this.saveSettings();
        await this.saveSideNotesData();
    }
    getSideNoteIDFromProperties(file) {
        var _a, _b;
        const frontmatter = (_a = this.app.metadataCache.getFileCache(file)) === null || _a === void 0 ? void 0 : _a.frontmatter;
        const value = (_b = getFrontmatterStringValue(frontmatter, SIDE_NOTES_ID_PROPERTY)) !== null && _b !== void 0 ? _b : getFrontmatterStringValue(frontmatter, LEGACY_SIDE_NOTE_ID_PROPERTY);
        return value ? normalizeSideNotesId(value) : null;
    }
    isSideNotesIDInUse(sideNoteId) {
        const normalizedSideNoteId = normalizeSideNotesId(sideNoteId);
        if (this.sideNotesData.filesBySideNoteId[normalizedSideNoteId]) {
            return true;
        }
        for (const mappedSideNoteId of Object.values(this.sideNotesData.sideNoteIds)) {
            if (normalizeSideNotesId(mappedSideNoteId) === normalizedSideNoteId) {
                return true;
            }
        }
        for (const file of this.app.vault.getMarkdownFiles()) {
            if (this.getSideNoteIDFromProperties(file) === normalizedSideNoteId) {
                return true;
            }
        }
        return false;
    }
    makeUnusedSideNotesID() {
        let sideNoteId = makeSideNotesId();
        while (this.isSideNotesIDInUse(sideNoteId)) {
            sideNoteId = makeSideNotesId();
        }
        return sideNoteId;
    }
    async ensureSideNoteIDProperty(file, sideNoteId, force = false) {
        var _a;
        this.assertStoreOwnership();
        if (!force && !this.settings.storeSideNoteIDInProperties) {
            return;
        }
        const frontmatter = (_a = this.app.metadataCache.getFileCache(file)) === null || _a === void 0 ? void 0 : _a.frontmatter;
        const current = getFrontmatterStringValue(frontmatter, SIDE_NOTES_ID_PROPERTY);
        if (current === sideNoteId) {
            return;
        }
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            frontmatter[SIDE_NOTES_ID_PROPERTY] = sideNoteId;
            delete frontmatter[LEGACY_SIDE_NOTE_ID_PROPERTY];
        });
    }
    async restoreSideNoteIDPropertyForFile(file) {
        if (!this.settings.storeSideNoteIDInProperties || !(file instanceof obsidian_1.TFile) || file.extension !== "md") {
            return;
        }
        const storedFile = this.getStoredFileNotes(file);
        if (!storedFile) {
            return;
        }
        await this.ensureSideNoteIDProperty(file, storedFile.SideNoteID);
    }
    async migrateLegacySideNotesIDProperties() {
        var _a;
        if (!this.settings.storeSideNoteIDInProperties) {
            return;
        }
        for (const file of this.app.vault.getMarkdownFiles()) {
            const frontmatter = (_a = this.app.metadataCache.getFileCache(file)) === null || _a === void 0 ? void 0 : _a.frontmatter;
            const sideNotesValue = getFrontmatterStringValue(frontmatter, SIDE_NOTES_ID_PROPERTY);
            const legacyValue = getFrontmatterStringValue(frontmatter, LEGACY_SIDE_NOTE_ID_PROPERTY);
            const value = sideNotesValue !== null && sideNotesValue !== void 0 ? sideNotesValue : legacyValue;
            if (!value) {
                continue;
            }
            const normalizedValue = normalizeSideNotesId(value);
            if (sideNotesValue === normalizedValue && !legacyValue) {
                continue;
            }
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter[SIDE_NOTES_ID_PROPERTY] = normalizedValue;
                delete frontmatter[LEGACY_SIDE_NOTE_ID_PROPERTY];
            });
        }
    }
    async loadExternalSideNotesData() {
        var _a, _b, _c, _d, _e;
        if (!(await this.app.vault.adapter.exists(SIDE_NOTES_DATA_PATH))) {
            return null;
        }
        try {
            const raw = await this.app.vault.adapter.read(SIDE_NOTES_DATA_PATH);
            const parsed = JSON.parse(raw);
            if (!isRecord(parsed) || [parsed.files, parsed.sideNoteIds, parsed.filesBySideNoteId, parsed.fileIds, parsed.filesById]
                .some(value => value !== undefined && !isRecord(value))) {
                throw new Error("Invalid SideNotes data structure");
            }
            return Object.assign({}, DEFAULT_DATA, {
                files: (_a = parsed.files) !== null && _a !== void 0 ? _a : {},
                sideNoteIds: (_b = parsed.sideNoteIds) !== null && _b !== void 0 ? _b : {},
                filesBySideNoteId: (_c = parsed.filesBySideNoteId) !== null && _c !== void 0 ? _c : {},
                fileIds: (_d = parsed.fileIds) !== null && _d !== void 0 ? _d : {},
                filesById: (_e = parsed.filesById) !== null && _e !== void 0 ? _e : {}
            });
        }
        catch (error) {
            console.error("Failed to load side notes data", error);
            new obsidian_1.Notice("Could not load _SideNotes data file.");
            // Abort loading instead of letting loadSideNotesData overwrite unreadable data.
            throw new Error("SideNotes data could not be read; the original file was preserved.");
        }
    }
    async saveSideNotesData(importCommit = false) {
        this.assertStoreOwnership();
        if (this.importInProgress && !importCommit)
            throw new Error("Store save paused during import.");
        const serialized = JSON.stringify(this.sideNotesData, null, 2);
        const run = this.storeSaveQueue.then(async () => {
            this.assertStoreOwnership();
            if (!importCommit && await this.app.vault.adapter.exists(IMPORT_JOURNAL))
                throw new Error("Recover the interrupted import before saving.");
            if (!(await this.app.vault.adapter.exists(SIDE_NOTES_FOLDER))) {
                await this.app.vault.createFolder(SIDE_NOTES_FOLDER);
            }
            const temporary = `${SIDE_NOTES_DATA_PATH}.${crypto.randomUUID()}.pending`;
            try {
                await this.app.vault.adapter.write(temporary, serialized);
                if (await this.app.vault.adapter.read(temporary) !== serialized)
                    throw new Error("SideNotes staged store verification failed.");
                // Adapter rename is a single filesystem operation on supported desktop adapters.
                // Failure preserves the existing store; never truncate it in place.
                await this.app.vault.adapter.rename(temporary, SIDE_NOTES_DATA_PATH);
            }
            catch (error) {
                if (await this.app.vault.adapter.exists(temporary))
                    await this.app.vault.adapter.remove(temporary);
                throw error;
            }
        });
        this.storeSaveQueue = run.catch(() => { });
        return run;
    }
    normalizeSideNotesData(data) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const normalized = {
            files: (_a = data.files) !== null && _a !== void 0 ? _a : {},
            sideNoteIds: {},
            filesBySideNoteId: {}
        };
        for (const [path, sideNoteId] of Object.entries((_b = data.sideNoteIds) !== null && _b !== void 0 ? _b : {})) {
            normalized.sideNoteIds[path] = normalizeSideNotesId(sideNoteId);
        }
        for (const [sideNoteId, storedFile] of Object.entries((_c = data.filesBySideNoteId) !== null && _c !== void 0 ? _c : {})) {
            const normalizedSideNoteId = normalizeSideNotesId((_d = storedFile.SideNoteID) !== null && _d !== void 0 ? _d : sideNoteId);
            normalized.filesBySideNoteId[normalizedSideNoteId] = {
                SideNoteID: normalizedSideNoteId,
                path: storedFile.path,
                name: storedFile.name,
                blocks: (_e = storedFile.blocks) !== null && _e !== void 0 ? _e : {}
            };
        }
        for (const [path, legacyId] of Object.entries((_f = data.fileIds) !== null && _f !== void 0 ? _f : {})) {
            normalized.sideNoteIds[path] = (_g = normalized.sideNoteIds[path]) !== null && _g !== void 0 ? _g : normalizeSideNotesId(legacyId);
        }
        for (const [legacyId, legacyFile] of Object.entries((_h = data.filesById) !== null && _h !== void 0 ? _h : {})) {
            const sideNoteId = normalizeSideNotesId((_k = (_j = legacyFile.SideNoteID) !== null && _j !== void 0 ? _j : legacyFile.id) !== null && _k !== void 0 ? _k : legacyId);
            normalized.filesBySideNoteId[sideNoteId] = {
                SideNoteID: sideNoteId,
                path: legacyFile.path,
                name: legacyFile.name,
                blocks: (_l = legacyFile.blocks) !== null && _l !== void 0 ? _l : {}
            };
        }
        for (const [sideNoteId, storedFile] of Object.entries(normalized.filesBySideNoteId)) {
            storedFile.SideNoteID = normalizeSideNotesId((_m = storedFile.SideNoteID) !== null && _m !== void 0 ? _m : sideNoteId);
        }
        for (const [path, blocks] of Object.entries(normalized.files)) {
            if (!normalized.sideNoteIds[path]) {
                const sideNoteId = makeSideNotesId();
                normalized.sideNoteIds[path] = sideNoteId;
                normalized.filesBySideNoteId[sideNoteId] = {
                    SideNoteID: sideNoteId,
                    path,
                    name: getFileNameFromPath(path),
                    blocks
                };
            }
            else {
                const sideNoteId = normalizeSideNotesId(normalized.sideNoteIds[path]);
                normalized.sideNoteIds[path] = sideNoteId;
                const storedFile = normalized.filesBySideNoteId[sideNoteId];
                if (storedFile) {
                    storedFile.SideNoteID = normalizeSideNotesId((_o = storedFile.SideNoteID) !== null && _o !== void 0 ? _o : sideNoteId);
                }
            }
        }
        return normalized;
    }
    refreshContext(options = {}) {
        var _a, _b, _c, _d;
        if (!options.force && this.currentContext && (this.isContextRefreshSuppressed() || this.isSideNotesViewActive() || this.isActiveElementInsideSideNotesView())) {
            return;
        }
        const context = this.getCurrentParagraphContext();
        const sameContext = (context === null || context === void 0 ? void 0 : context.filePath) === ((_a = this.currentContext) === null || _a === void 0 ? void 0 : _a.filePath) &&
            (context === null || context === void 0 ? void 0 : context.fromLine) === ((_b = this.currentContext) === null || _b === void 0 ? void 0 : _b.fromLine) &&
            (context === null || context === void 0 ? void 0 : context.toLine) === ((_c = this.currentContext) === null || _c === void 0 ? void 0 : _c.toLine) &&
            (context === null || context === void 0 ? void 0 : context.blockId) === ((_d = this.currentContext) === null || _d === void 0 ? void 0 : _d.blockId);
        this.currentContext = context;
        this.syncCurrentBlockIdentity(context);
        if (!sameContext) {
            this.refreshViews({ preserveScroll: true });
        }
    }
    isActiveElementInsideSideNotesView() {
        const activeElement = activeDocument.activeElement;
        return activeElement instanceof HTMLElement && activeElement.closest(".side-notes-view") !== null;
    }
    isSideNotesViewActive() {
        return this.app.workspace.getActiveViewOfType(SideNotesView) !== null;
    }
    suppressContextRefreshBriefly() {
        this.suppressContextRefreshUntil = Date.now() + 2500;
    }
    isContextRefreshSuppressed() {
        return Date.now() < this.suppressContextRefreshUntil;
    }
    refreshViews(options = {}) {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDE_NOTES)) {
            const view = leaf.view;
            if (view instanceof SideNotesView) {
                void view.render(options);
            }
        }
    }
    focusLastMarkdownEditor() {
        var _a;
        const markdownView = (_a = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView)) !== null && _a !== void 0 ? _a : this.lastMarkdownView;
        markdownView === null || markdownView === void 0 ? void 0 : markdownView.editor.focus();
    }
    usesMarkdownBlockIds() {
        return this.settings.anchorStorage === "block-id";
    }
    syncCurrentBlockIdentity(context) {
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return;
        }
        const storedFile = this.getStoredFileNotes(context.file);
        const blockNotes = storedFile === null || storedFile === void 0 ? void 0 : storedFile.blocks[context.blockId];
        if (!blockNotes) {
            return;
        }
        const changed = blockNotes.fingerprint !== context.fingerprint ||
            blockNotes.fromLine !== context.fromLine ||
            blockNotes.toLine !== context.toLine;
        if (!changed) {
            return;
        }
        blockNotes.fingerprint = context.fingerprint;
        blockNotes.fromLine = context.fromLine;
        blockNotes.toLine = context.toLine;
        void this.saveSideNotesData();
    }
    getCurrentParagraphContext() {
        const markdownView = this.getCurrentMarkdownView();
        if (!(markdownView === null || markdownView === void 0 ? void 0 : markdownView.file)) {
            return null;
        }
        const editor = markdownView.editor;
        const cursor = editor.getCursor();
        const directParagraphRange = findParagraphRange(editor, cursor.line, this.settings.blockIdPrefix);
        const paragraphRange = directParagraphRange !== null && directParagraphRange !== void 0 ? directParagraphRange : findPreviousParagraphRangeFromBlankLine(editor, cursor.line, this.settings.blockIdPrefix);
        if (!paragraphRange) {
            return null;
        }
        const lines = [];
        for (let line = paragraphRange.fromLine; line <= paragraphRange.toLine; line++) {
            lines.push(editor.getLine(line));
        }
        const text = lines.join("\n");
        const blockIdInFile = getBlockId(text, this.settings.blockIdPrefix);
        const fingerprint = getParagraphFingerprint(text, this.settings.blockIdPrefix);
        const storedBlockId = this.findBlockIdForParagraph(markdownView.file, fingerprint, paragraphRange);
        const blockId = this.usesMarkdownBlockIds()
            ? blockIdInFile !== null && blockIdInFile !== void 0 ? blockIdInFile : storedBlockId
            : storedBlockId !== null && storedBlockId !== void 0 ? storedBlockId : blockIdInFile;
        if (!directParagraphRange && !blockId) {
            return null;
        }
        return {
            file: markdownView.file,
            filePath: markdownView.file.path,
            fileName: markdownView.file.basename,
            fromLine: paragraphRange.fromLine,
            toLine: paragraphRange.toLine,
            text,
            fingerprint,
            hasBlockIdInFile: this.usesMarkdownBlockIds() && blockIdInFile !== null && blockId === blockIdInFile,
            blockId
        };
    }
    getNotesForCurrentContext() {
        var _a, _b, _c;
        const context = this.currentContext;
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return [];
        }
        return (_c = (_b = (_a = this.getStoredFileNotes(context.file)) === null || _a === void 0 ? void 0 : _a.blocks[context.blockId]) === null || _b === void 0 ? void 0 : _b.notes) !== null && _c !== void 0 ? _c : [];
    }
    getNoteGroupsForCurrentFile() {
        var _a, _b, _c, _d, _e;
        const file = (_b = (_a = this.currentContext) === null || _a === void 0 ? void 0 : _a.file) !== null && _b !== void 0 ? _b : (_c = this.lastMarkdownView) === null || _c === void 0 ? void 0 : _c.file;
        if (!file) {
            return [];
        }
        const fileNotes = (_e = (_d = this.getStoredFileNotes(file)) === null || _d === void 0 ? void 0 : _d.blocks) !== null && _e !== void 0 ? _e : {};
        return Object.entries(fileNotes)
            .map(([blockId, blockNotes]) => ({
            blockId,
            notes: blockNotes.notes,
            fingerprint: blockNotes.fingerprint
        }))
            .filter((group) => group.notes.length > 0)
            .sort((a, b) => a.blockId.localeCompare(b.blockId));
    }
    async getOrphanedFileNotes() {
        const orphanedFiles = [];
        for (const storedFile of Object.values(this.sideNotesData.filesBySideNoteId)) {
            const groups = Object.entries(storedFile.blocks)
                .map(([blockId, blockNotes]) => ({
                blockId,
                notes: blockNotes.notes,
                fingerprint: blockNotes.fingerprint
            }))
                .filter((group) => group.notes.length > 0)
                .sort((a, b) => a.blockId.localeCompare(b.blockId));
            if (groups.length === 0 || this.isStoredFileAttached(storedFile)) {
                continue;
            }
            orphanedFiles.push({
                SideNoteID: storedFile.SideNoteID,
                path: storedFile.path,
                name: storedFile.name,
                groups
            });
        }
        return orphanedFiles.sort((a, b) => a.SideNoteID.localeCompare(b.SideNoteID) || a.path.localeCompare(b.path));
    }
    getAllStoredFileNotes() {
        return Object.values(this.sideNotesData.filesBySideNoteId)
            .map((storedFile) => {
            const groups = Object.entries(storedFile.blocks)
                .map(([blockId, blockNotes]) => ({
                blockId,
                notes: blockNotes.notes,
                fingerprint: blockNotes.fingerprint
            }))
                .filter((group) => group.notes.length > 0)
                .sort((a, b) => a.blockId.localeCompare(b.blockId));
            return {
                SideNoteID: storedFile.SideNoteID,
                path: storedFile.path,
                name: storedFile.name,
                groups,
                orphaned: !this.isStoredFileAttached(storedFile)
            };
        })
            .filter((file) => file.groups.length > 0)
            .sort((a, b) => a.SideNoteID.localeCompare(b.SideNoteID) || a.path.localeCompare(b.path));
    }
    getCurrentFileInfo() {
        var _a, _b, _c;
        const file = (_b = (_a = this.currentContext) === null || _a === void 0 ? void 0 : _a.file) !== null && _b !== void 0 ? _b : (_c = this.lastMarkdownView) === null || _c === void 0 ? void 0 : _c.file;
        if (!file) {
            return null;
        }
        return {
            path: file.path,
            name: file.basename
        };
    }
    addSideNotesExportMenuItem(menu, files) {
        const exportableFiles = this.getExportableSideNotesFiles(files);
        if (exportableFiles.length === 0) {
            return;
        }
        menu.addItem((item) => {
            item
                .setTitle(exportableFiles.length === 1 ? "Export with SideNotes" : "Export selected files with SideNotes")
                .setIcon("package")
                .onClick(() => {
                void this.exportSideNotesBundle(exportableFiles);
            });
        });
    }
    getExportableSideNotesFiles(files) {
        const seenPaths = new Set();
        const exportableFiles = [];
        for (const file of files) {
            if (!(file instanceof obsidian_1.TFile) || file.extension !== "md" || seenPaths.has(file.path) || !this.getSideNoteIDFromProperties(file)) {
                continue;
            }
            seenPaths.add(file.path);
            exportableFiles.push(file);
        }
        return exportableFiles;
    }
    async exportSideNotesBundle(files) {
        if (files.length === 0) {
            new obsidian_1.Notice("No files with SideNotesID selected.");
            return;
        }
        try {
            const transferFiles = [];
            for (const file of files) {
                const storedFile = this.getStoredFileNotes(file);
                if (!storedFile) {
                    continue;
                }
                transferFiles.push(await this.createTransferFileForAttachedFile(file, storedFile.SideNoteID, storedFile.blocks));
            }
            if (transferFiles.length === 0) {
                new obsidian_1.Notice("No files with attached SideNotes selected.");
                return;
            }
            const bundle = {
                type: SIDE_NOTES_BUNDLE_TYPE,
                version: SIDE_NOTES_BUNDLE_VERSION,
                exportedAt: Date.now(),
                files: transferFiles
            };
            const bundleText = JSON.stringify(bundle, null, 2);
            const suggestedName = this.getSideNotesBundleFileName(files);
            await this.saveSideNotesBundleWithPicker(bundleText, suggestedName, files);
        }
        catch (error) {
            console.error("SideNotes export failed", error);
            new obsidian_1.Notice("SideNotes export was cancelled because all requested data could not be read.");
        }
    }
    async exportAllSideNotesBundle(includeOrphaned) {
        const storedFiles = this.getAllStoredFileNotes()
            .filter((storedFile) => includeOrphaned || !storedFile.orphaned);
        if (storedFiles.length === 0) {
            new obsidian_1.Notice(includeOrphaned ? "No side notes to export." : "No attached files with side notes to export.");
            return;
        }
        try {
            const attachedFiles = [];
            const transferFiles = [];
            for (const storedFileSummary of storedFiles) {
                const sideNoteId = normalizeSideNotesId(storedFileSummary.SideNoteID);
                const storedFile = this.sideNotesData.filesBySideNoteId[sideNoteId];
                if (!storedFile || !Object.values(storedFile.blocks).some((block) => block.notes.length > 0)) {
                    continue;
                }
                if (storedFileSummary.orphaned) {
                    if (includeOrphaned) {
                        transferFiles.push(await this.createTransferFileForOrphanedFile(storedFile));
                    }
                    continue;
                }
                const file = this.app.vault.getAbstractFileByPath(storedFile.path);
                if (!(file instanceof obsidian_1.TFile)) {
                    if (includeOrphaned) {
                        transferFiles.push(await this.createTransferFileForOrphanedFile(storedFile));
                    }
                    continue;
                }
                attachedFiles.push(file);
                transferFiles.push(await this.createTransferFileForAttachedFile(file, sideNoteId, storedFile.blocks));
            }
            if (transferFiles.length === 0) {
                new obsidian_1.Notice(includeOrphaned ? "No side notes to export." : "No attached files with side notes to export.");
                return;
            }
            const bundle = {
                type: SIDE_NOTES_BUNDLE_TYPE,
                version: SIDE_NOTES_BUNDLE_VERSION,
                exportedAt: Date.now(),
                files: transferFiles
            };
            const bundleText = JSON.stringify(bundle, null, 2);
            const suggestedName = "SideNotes all" + (includeOrphaned ? " with orphaned" : "") + " " + getSafeTimestamp() + ".sidenotes";
            await this.saveSideNotesBundleWithPicker(bundleText, suggestedName, attachedFiles);
        }
        catch (error) {
            console.error("SideNotes full export failed", error);
            new obsidian_1.Notice("SideNotes export was cancelled because all requested data could not be read.");
        }
    }
    async createTransferFileForAttachedFile(file, sideNoteId, blocks) {
        sideNoteId = normalizeSideNotesId(sideNoteId);
        // Export is deliberately read-only. Identity repair belongs to an explicit
        // attach/repair operation, never to a backup/export command.
        const content = await this.app.vault.read(file);
        const attachments = await this.getTransferAttachmentsForFile(file, content, blocks);
        return {
            path: file.path,
            name: file.name,
            basename: file.basename,
            content,
            SideNotesID: sideNoteId,
            blocks: cloneBlockNotesRecord(blocks),
            attachments
        };
    }
    async createTransferFileForOrphanedFile(storedFile) {
        const path = storedFile.path || `${storedFile.name || "Imported side notes"}.md`;
        const name = getLeafFileName(path) || `${storedFile.name || "Imported side notes"}.md`;
        return {
            path,
            name,
            basename: storedFile.name || getFileNameFromPath(path),
            content: "",
            SideNotesID: normalizeSideNotesId(storedFile.SideNoteID),
            blocks: cloneBlockNotesRecord(storedFile.blocks),
            attachments: await this.getTransferAttachmentsForSideNoteMedia(storedFile.blocks)
        };
    }
    async getTransferAttachmentsForFile(file, content, blocks = {}) {
        const attachmentFiles = [
            ...this.getLinkedAttachmentFiles(file, content),
            ...this.getSideNoteMediaFiles(blocks)
        ];
        return this.getTransferAttachmentsForFiles(attachmentFiles);
    }
    async getTransferAttachmentsForSideNoteMedia(blocks) {
        return this.getTransferAttachmentsForFiles(this.getSideNoteMediaFiles(blocks));
    }
    async getTransferAttachmentsForFiles(attachmentFiles) {
        const attachments = [];
        const seenPaths = new Set();
        for (const attachmentFile of attachmentFiles) {
            if (seenPaths.has(attachmentFile.path)) {
                continue;
            }
            seenPaths.add(attachmentFile.path);
            try {
                const data = await this.app.vault.readBinary(attachmentFile);
                attachments.push({
                    path: attachmentFile.path,
                    name: attachmentFile.name,
                    data: arrayBufferToBase64(data)
                });
            }
            catch (error) {
                console.error("Could not read SideNotes export attachment", attachmentFile.path, error);
                throw new Error("Could not read attachment: " + attachmentFile.path);
            }
        }
        return attachments;
    }
    getSideNoteMediaFiles(blocks) {
        var _a;
        const files = [];
        const seenPaths = new Set();
        for (const blockNotes of Object.values(blocks)) {
            for (const note of (_a = blockNotes.notes) !== null && _a !== void 0 ? _a : []) {
                const mediaPath = getSideNoteMediaPath(note);
                if (!mediaPath || seenPaths.has(mediaPath)) {
                    continue;
                }
                const file = this.app.vault.getAbstractFileByPath(mediaPath);
                if (file instanceof obsidian_1.TFile) {
                    seenPaths.add(file.path);
                    files.push(file);
                }
            }
        }
        return files;
    }
    getLinkedAttachmentFiles(file, content) {
        var _a, _b, _c;
        const seenPaths = new Set();
        const attachmentFiles = [];
        const addLinkedFile = (linkedFile) => {
            if (!linkedFile || linkedFile.path === file.path || linkedFile.extension === "md" || seenPaths.has(linkedFile.path)) {
                return;
            }
            seenPaths.add(linkedFile.path);
            attachmentFiles.push(linkedFile);
        };
        const resolvedLinks = (_a = this.app.metadataCache.resolvedLinks[file.path]) !== null && _a !== void 0 ? _a : {};
        for (const linkedPath of Object.keys(resolvedLinks)) {
            const linkedFile = this.app.vault.getAbstractFileByPath(linkedPath);
            if (linkedFile instanceof obsidian_1.TFile) {
                addLinkedFile(linkedFile);
            }
        }
        const cache = this.app.metadataCache.getFileCache(file);
        const references = [...((_b = cache === null || cache === void 0 ? void 0 : cache.links) !== null && _b !== void 0 ? _b : []), ...((_c = cache === null || cache === void 0 ? void 0 : cache.embeds) !== null && _c !== void 0 ? _c : [])];
        for (const reference of references) {
            const linkPath = getInternalLinkPath(reference.link);
            if (linkPath) {
                addLinkedFile(this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path));
            }
        }
        for (const linkPath of extractInternalLinkPaths(content)) {
            addLinkedFile(this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path));
        }
        return attachmentFiles;
    }
    getSideNotesBundleFileName(files) {
        return files.length === 1
            ? `${sanitizeFileName(files[0].basename) || "SideNotes export"}.sidenotes`
            : `SideNotes export ${getSafeTimestamp()}.sidenotes`;
    }
    async getAvailableSideNotesBundlePath(files, suggestedName = this.getSideNotesBundleFileName(files)) {
        var _a, _b;
        const folder = getFolderPath((_b = (_a = files[0]) === null || _a === void 0 ? void 0 : _a.path) !== null && _b !== void 0 ? _b : "");
        return this.getAvailableVaultPath(joinVaultPath(folder, suggestedName));
    }
    async saveSideNotesBundleWithPicker(bundleText, suggestedName, files) {
        const pickerWindow = window;
        if (typeof pickerWindow.showSaveFilePicker === "function") {
            try {
                const handle = await pickerWindow.showSaveFilePicker({
                    suggestedName: removeSideNotesBundleExtension(suggestedName),
                    excludeAcceptAllOption: false,
                    types: [{
                            description: "sidenotes",
                            accept: {
                                [SIDE_NOTES_BUNDLE_MIME_TYPE]: [".sidenotes"]
                            }
                        }]
                });
                const writable = await handle.createWritable();
                await writable.write(bundleText);
                await writable.close();
                new obsidian_1.Notice("SideNotes export saved.");
                return;
            }
            catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") {
                    return;
                }
                console.error(error);
                new obsidian_1.Notice("Save dialog was not available. Saving inside the vault instead.");
            }
        }
        const exportPath = await this.getAvailableSideNotesBundlePath(files, suggestedName);
        await this.app.vault.create(exportPath, bundleText);
        new obsidian_1.Notice(`Created ${exportPath}`);
    }
    async importSideNotesBundleFromDisk() {
        const input = activeDocument.createElement("input");
        input.type = "file";
        input.accept = ".sidenotes";
        input.addEventListener("change", async () => {
            var _a;
            const file = (_a = input.files) === null || _a === void 0 ? void 0 : _a[0];
            if (!file) {
                return;
            }
            try {
                const result = await this.importSideNotesBundleText(await file.text());
                const attachmentText = result.attachmentCount > 0
                    ? ` and ${result.attachmentCount} attachment${result.attachmentCount === 1 ? "" : "s"}`
                    : "";
                new obsidian_1.Notice(`Imported ${result.fileCount} file${result.fileCount === 1 ? "" : "s"} with ${result.noteCount} side note${result.noteCount === 1 ? "" : "s"}${attachmentText}.`);
            }
            catch (error) {
                console.error(error);
                new obsidian_1.Notice("Could not import this .sidenotes file.");
            }
        });
        input.click();
    }
    async writeImportJournal(serialized) {
        const temporary = `${IMPORT_JOURNAL}.${crypto.randomUUID()}.pending`;
        try {
            await this.app.vault.adapter.write(temporary, serialized);
            if (await this.app.vault.adapter.read(temporary) !== serialized)
                throw new Error("Import journal verification failed.");
            await this.app.vault.adapter.rename(temporary, IMPORT_JOURNAL);
        }
        catch (error) {
            if (await this.app.vault.adapter.exists(temporary))
                await this.app.vault.adapter.remove(temporary);
            throw error;
        }
    }
    async importSideNotesBundleText(rawBundle) {
        var _a;
        this.assertStoreOwnership();
        if (this.importInProgress) {
            throw new Error("A SideNotes import is already running.");
        }
        // Reserve the in-process writer synchronously, before parsing or awaiting
        // filesystem state. The durable journal is the separate crash/restart guard.
        this.importInProgress = true;
        const created = [];
        this.importCreated = created;
        try {
            const bundle = parseSideNotesTransferBundle(rawBundle);
            // Complete path and attachment preflight before the first filesystem mutation.
            const attachmentBytes = new Map();
            for (const file of bundle.files) {
                for (const value of [file.path, ...file.attachments.map((attachment) => attachment.path)]) {
                    const safe = sanitizeOptionalVaultPath(value, this.app.vault.configDir);
                    if (!safe ||
                        safe === SIDE_NOTES_DATA_PATH ||
                        safe === IMPORT_JOURNAL) {
                        throw new Error("Unsafe import path.");
                    }
                }
                for (const attachment of file.attachments) {
                    base64ToArrayBuffer(attachment.data);
                    if (attachmentBytes.has(attachment.path) &&
                        attachmentBytes.get(attachment.path) !== attachment.data) {
                        throw new Error("Conflicting attachment bytes.");
                    }
                    attachmentBytes.set(attachment.path, attachment.data);
                }
            }
            if (await this.app.vault.adapter.exists(IMPORT_JOURNAL)) {
                throw new Error("Recover the previous interrupted import first.");
            }
            const before = JSON.stringify(this.sideNotesData);
            let committed = false;
            try {
                await this.ensureVaultFolder(SIDE_NOTES_FOLDER);
                const journal = JSON.stringify({
                    version: 1,
                    state: "pending",
                    before: JSON.parse(before),
                    bundle
                });
                await this.writeImportJournal(journal);
                if (await this.app.vault.adapter.read(IMPORT_JOURNAL) !== journal) {
                    throw new Error("Import journal verification failed.");
                }
                await this.storeSaveQueue;
                let noteCount = 0;
                let attachmentCount = 0;
                const importedAttachmentPaths = new Map();
                for (const transferFile of bundle.files) {
                    const result = await this.importSideNotesTransferFile(transferFile, importedAttachmentPaths);
                    noteCount += result.noteCount;
                    attachmentCount += result.attachmentCount;
                    await this.writeImportJournal(JSON.stringify({
                        version: 1,
                        state: "pending",
                        before: JSON.parse(before),
                        completed: this.sideNotesData,
                        createdPaths: created.map((file) => file.path),
                        bundle
                    }));
                }
                await this.saveSideNotesData(true);
                committed = true;
                await this.app.vault.adapter.remove(IMPORT_JOURNAL);
                this.refreshViews();
                return { fileCount: bundle.files.length, noteCount, attachmentCount };
            }
            catch (error) {
                if (!committed) {
                    const previous = JSON.parse(before);
                    const paths = new Set(created.map((file) => file.path));
                    for (const filePath of paths) {
                        const id = this.sideNotesData.sideNoteIds[filePath];
                        if (!previous.sideNoteIds[filePath]) {
                            delete this.sideNotesData.sideNoteIds[filePath];
                        }
                        if (id &&
                            !previous.filesBySideNoteId[id] &&
                            ((_a = this.sideNotesData.filesBySideNoteId[id]) === null || _a === void 0 ? void 0 : _a.path) === filePath) {
                            delete this.sideNotesData.filesBySideNoteId[id];
                        }
                    }
                    // Created files and the recovery journal stay in place intentionally:
                    // host events, sync, or the user may already have touched them.
                }
                throw error;
            }
        }
        finally {
            this.importCreated = null;
            this.importInProgress = false;
        }
    }
    async importSideNotesTransferFile(transferFile, importedAttachmentPaths = new Map()) {
        var _a, _b, _c;
        const requestedPath = sanitizeVaultPath(transferFile.path || transferFile.name || "Imported side notes.md");
        const importPath = await this.getAvailableImportedMarkdownPath(requestedPath);
        await this.ensureVaultFolder(getFolderPath(importPath));
        let sideNoteId = normalizeSideNotesId(transferFile.SideNotesID);
        if (!sideNoteId || this.isSideNotesIDInUse(sideNoteId)) {
            sideNoteId = this.makeUnusedSideNotesID();
        }
        const blocks = cloneBlockNotesRecord((_a = transferFile.blocks) !== null && _a !== void 0 ? _a : {});
        const mediaPaths = getSideNoteMediaPathsFromBlocks(blocks);
        const importedAttachments = await this.importSideNotesTransferAttachments(transferFile.attachments, mediaPaths, importedAttachmentPaths);
        remapSideNoteMediaPaths(blocks, importedAttachments.pathMap);
        const importedFile = await this.app.vault.create(importPath, (_b = transferFile.content) !== null && _b !== void 0 ? _b : "");
        (_c = this.importCreated) === null || _c === void 0 ? void 0 : _c.push(importedFile);
        await this.ensureSideNoteIDProperty(importedFile, sideNoteId, true);
        this.sideNotesData.sideNoteIds[importedFile.path] = sideNoteId;
        this.sideNotesData.filesBySideNoteId[sideNoteId] = {
            SideNoteID: sideNoteId,
            path: importedFile.path,
            name: importedFile.basename,
            blocks
        };
        delete this.sideNotesData.files[importedFile.path];
        return { noteCount: getBlockNotesCount(blocks), attachmentCount: importedAttachments.attachmentCount };
    }
    async importSideNotesTransferAttachments(attachments, sideNoteMediaPaths = new Set(), importedAttachmentPaths = new Map()) {
        var _a;
        let attachmentCount = 0;
        const seenPaths = new Set();
        const pathMap = new Map();
        for (const attachment of attachments) {
            const attachmentPath = sanitizeOptionalVaultPath(attachment.path);
            if (!attachmentPath || seenPaths.has(attachmentPath)) {
                continue;
            }
            seenPaths.add(attachmentPath);
            const importedPath = importedAttachmentPaths.get(attachmentPath);
            if (importedPath) {
                pathMap.set(attachmentPath, importedPath);
                continue;
            }
            let targetPath = attachmentPath;
            try {
                if (await this.app.vault.adapter.exists(targetPath)) {
                    if (!sideNoteMediaPaths.has(attachmentPath)) {
                        continue;
                    }
                    targetPath = await this.getAvailableVaultPath(attachmentPath);
                }
                await this.ensureVaultFolder(getFolderPath(targetPath));
                const created = await this.app.vault.createBinary(targetPath, base64ToArrayBuffer(attachment.data));
                (_a = this.importCreated) === null || _a === void 0 ? void 0 : _a.push(created);
                pathMap.set(attachmentPath, targetPath);
                importedAttachmentPaths.set(attachmentPath, targetPath);
                attachmentCount += 1;
            }
            catch (error) {
                throw new Error("SideNotes attachment import failed; recovery data was preserved.");
            }
        }
        return { attachmentCount, pathMap };
    }
    async getAvailableImportedMarkdownPath(path) {
        var _a;
        const normalizedPath = ensureMarkdownExtension(sanitizeVaultPath(path || "Imported side notes.md"));
        if (!(await this.app.vault.adapter.exists(normalizedPath))) {
            return normalizedPath;
        }
        const folder = getFolderPath(normalizedPath);
        const fileName = (_a = normalizedPath.split("/").pop()) !== null && _a !== void 0 ? _a : "Imported side notes.md";
        const baseName = fileName.replace(/\.md$/i, "");
        return this.getAvailableVaultPath(joinVaultPath(folder, `${baseName} imported.md`));
    }
    async getAvailableVaultPath(path) {
        var _a, _b;
        const folder = getFolderPath(path);
        const fileName = (_a = path.split("/").pop()) !== null && _a !== void 0 ? _a : "SideNotes export.sidenotes";
        const extensionMatch = fileName.match(/(\.[^.]+)$/);
        const extension = (_b = extensionMatch === null || extensionMatch === void 0 ? void 0 : extensionMatch[1]) !== null && _b !== void 0 ? _b : "";
        const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
        let candidate = joinVaultPath(folder, `${baseName}${extension}`);
        let index = 2;
        while (await this.app.vault.adapter.exists(candidate)) {
            candidate = joinVaultPath(folder, `${baseName} ${index}${extension}`);
            index++;
        }
        return candidate;
    }
    async ensureVaultFolder(folder) {
        if (folder.split("/")[0].toLowerCase() === this.app.vault.configDir.toLowerCase() || folder.split("/")[0].toLowerCase() === ".git") {
            throw new Error("SideNotes cannot import into vault configuration directories.");
        }
        if (!folder) {
            return;
        }
        const parts = folder.split("/").filter(Boolean);
        let currentPath = "";
        for (const part of parts) {
            currentPath = joinVaultPath(currentPath, part);
            if (!(await this.app.vault.adapter.exists(currentPath))) {
                await this.app.vault.createFolder(currentPath);
            }
        }
    }
    async exportCurrentNotes(mode) {
        var _a, _b;
        const context = this.currentContext;
        const file = (_a = context === null || context === void 0 ? void 0 : context.file) !== null && _a !== void 0 ? _a : (_b = this.lastMarkdownView) === null || _b === void 0 ? void 0 : _b.file;
        if (!file) {
            new obsidian_1.Notice("No active file to export notes for.");
            return;
        }
        const storedFile = this.ensureStoredFileNotes(file);
        const groups = mode === "paragraph"
            ? this.getParagraphExportGroups(context)
            : this.getNoteGroupsForCurrentFile();
        if (groups.length === 0) {
            new obsidian_1.Notice("No side notes to export.");
            return;
        }
        const title = `SideNotes (${storedFile.SideNoteID}) (${file.basename})`;
        const exportPath = await this.getAvailableExportPath(title);
        const content = this.buildExportMarkdown(title, file, storedFile, groups, mode);
        const createdFile = await this.app.vault.create(exportPath, content);
        await this.app.workspace.getLeaf(true).openFile(createdFile);
    }
    async exportSelectedNotesToFile(noteRefs, viewMode) {
        if (noteRefs.length === 0) {
            new obsidian_1.Notice("Select one or more side notes to export.");
            return;
        }
        const files = this.getSelectedExportFiles(noteRefs);
        if (files.length === 0) {
            new obsidian_1.Notice("Could not find the selected side notes to export.");
            return;
        }
        const title = this.getSelectedExportTitle(viewMode, files);
        const exportPath = await this.getAvailableExportPath(title);
        const content = this.buildSelectedExportMarkdown(title, files);
        const createdFile = await this.app.vault.create(exportPath, content);
        await this.app.workspace.getLeaf(true).openFile(createdFile);
    }
    async copySelectedNotesToClipboard(noteRefs) {
        if (noteRefs.length === 0) {
            new obsidian_1.Notice("Select one or more side notes to copy.");
            return;
        }
        const files = this.getSelectedExportFiles(noteRefs);
        const notes = files.flatMap((file) => file.groups.flatMap((group) => group.notes));
        const noteTexts = notes
            .map((note) => getNotePlainCopyText(note))
            .filter((text) => text.length > 0);
        if (notes.length === 0) {
            new obsidian_1.Notice("Could not find selected side notes to copy.");
            return;
        }
        try {
            const richHtml = await buildSideNotesClipboardHtml(this.app, notes);
            const selectedImages = notes.filter(isImageNote);
            const nativeImage = selectedImages.length === 1
                ? await getSideNoteImageClipboardBlob(this.app, selectedImages[0])
                : null;
            await copyRichContentToClipboard(noteTexts.join("\n\n"), richHtml, nativeImage);
            new obsidian_1.Notice(`${notes.length} note${notes.length === 1 ? "" : "s"} copied.`);
        }
        catch (error) {
            console.error(error);
            if (noteTexts.length > 0) {
                try {
                    await copyTextToClipboard(noteTexts.join("\n\n"));
                    new obsidian_1.Notice("Text copied, but the media could not be copied.");
                    return;
                }
                catch (fallbackError) {
                    console.error(fallbackError);
                }
            }
            new obsidian_1.Notice("Could not copy notes to clipboard.");
        }
    }
    getSelectedExportFiles(noteRefs) {
        const files = [];
        const filesBySideNoteId = new Map();
        const groupsByFile = new Map();
        for (const noteRef of noteRefs) {
            const storedFile = this.getStoredFileNotesFromSource(noteRef.sourcePath, noteRef.sourceSideNoteId);
            const blockNotes = storedFile === null || storedFile === void 0 ? void 0 : storedFile.blocks[noteRef.blockId];
            const note = blockNotes === null || blockNotes === void 0 ? void 0 : blockNotes.notes.find((item) => item.id === noteRef.noteId);
            if (!storedFile || !blockNotes || !note) {
                continue;
            }
            const sideNoteId = normalizeSideNotesId(storedFile.SideNoteID);
            let exportFile = filesBySideNoteId.get(sideNoteId);
            if (!exportFile) {
                exportFile = {
                    SideNoteID: sideNoteId,
                    path: storedFile.path,
                    name: storedFile.name,
                    groups: [],
                    orphaned: !this.isStoredFileAttached(storedFile)
                };
                filesBySideNoteId.set(sideNoteId, exportFile);
                groupsByFile.set(sideNoteId, new Map());
                files.push(exportFile);
            }
            const fileGroups = groupsByFile.get(sideNoteId);
            if (!fileGroups) {
                continue;
            }
            let exportGroup = fileGroups.get(noteRef.blockId);
            if (!exportGroup) {
                exportGroup = {
                    blockId: noteRef.blockId,
                    notes: [],
                    fingerprint: blockNotes.fingerprint
                };
                fileGroups.set(noteRef.blockId, exportGroup);
                exportFile.groups.push(exportGroup);
            }
            exportGroup.notes.push(note);
        }
        return files.filter((file) => file.groups.some((group) => group.notes.length > 0));
    }
    getSelectedExportTitle(viewMode, files) {
        if (files.length === 1) {
            return `SideNotes selected (${files[0].SideNoteID}) (${files[0].name})`;
        }
        return `SideNotes selected (${getCurrentViewModeLabel(viewMode)}) ${getSafeTimestamp()}`;
    }
    async openStoredFile(path) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof obsidian_1.TFile)) {
            new obsidian_1.Notice("This file no longer exists.");
            return;
        }
        await this.app.workspace.getLeaf(true).openFile(file);
    }
    async openSideNoteFile(note) {
        try {
            if (isStoredFileNote(note)) {
                const file = this.app.vault.getAbstractFileByPath(note.filePath);
                if (!(file instanceof obsidian_1.TFile)) {
                    new obsidian_1.Notice("This file no longer exists.");
                    return;
                }
                await openFilePathExternally(this.getFullVaultFilePath(file.path), this.app.vault.getResourcePath(file));
                return;
            }
            if (isExternalFileNote(note)) {
                await openFilePathExternally(note.fileExternalPath);
                return;
            }
            new obsidian_1.Notice("Could not find a file path for this note.");
        }
        catch (error) {
            console.error(error);
            new obsidian_1.Notice("Could not open this file.");
        }
    }
    async openSideNoteUrl(note) {
        if (!isUrlNote(note)) {
            new obsidian_1.Notice("Could not find a URL for this note.");
            return;
        }
        const safeUrl = normalizeSideNoteUrl(note.url);
        if (!safeUrl) {
            new obsidian_1.Notice("This URL uses an unsupported or unsafe protocol.");
            return;
        }
        try {
            await openUrlExternally(safeUrl);
        }
        catch (error) {
            console.error(error);
            new obsidian_1.Notice("Could not open this URL.");
        }
    }
    getFullVaultFilePath(path) {
        const adapter = this.app.vault.adapter;
        if (typeof adapter.getFullPath === "function") {
            return adapter.getFullPath(path);
        }
        if (typeof adapter.getFilePath === "function") {
            return adapter.getFilePath(path);
        }
        return path;
    }
    async openFileAtBlock(path, blockId) {
        var _a, _b;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof obsidian_1.TFile)) {
            new obsidian_1.Notice("This file no longer exists.");
            return;
        }
        const blockLine = await this.findBlockLine(file, blockId);
        if (blockLine === null) {
            new obsidian_1.Notice("Could not find this paragraph block in the file.");
            return;
        }
        const leaf = (_b = (_a = this.lastMarkdownView) === null || _a === void 0 ? void 0 : _a.leaf) !== null && _b !== void 0 ? _b : this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
        await this.app.workspace.revealLeaf(leaf);
        const markdownView = leaf.view instanceof obsidian_1.MarkdownView ? leaf.view : this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
        if (!markdownView) {
            return;
        }
        markdownView.editor.setCursor({ line: blockLine, ch: 0 });
        markdownView.editor.scrollIntoView({ from: { line: blockLine, ch: 0 }, to: { line: blockLine, ch: 0 } }, true);
        this.lastMarkdownView = markdownView;
        this.refreshContext();
    }
    async findBlockLine(file, blockId) {
        var _a;
        const content = await this.app.vault.read(file);
        const lines = content.split(/\r?\n/);
        const blockPattern = new RegExp(`(?:^|\\s)\\^${escapeRegExp(blockId)}[^\\r\\n]*$`);
        for (let line = 0; line < lines.length; line++) {
            if (blockPattern.test(lines[line])) {
                return findParagraphStartLine(lines, line, this.settings.blockIdPrefix);
            }
        }
        const storedBlock = (_a = this.getStoredFileNotes(file)) === null || _a === void 0 ? void 0 : _a.blocks[blockId];
        if (storedBlock === null || storedBlock === void 0 ? void 0 : storedBlock.fingerprint) {
            const fingerprintLine = findParagraphStartLineByFingerprint(lines, storedBlock.fingerprint, this.settings.blockIdPrefix);
            if (fingerprintLine !== null) {
                return fingerprintLine;
            }
        }
        if ((storedBlock === null || storedBlock === void 0 ? void 0 : storedBlock.fromLine) !== undefined && storedBlock.fromLine >= 0 && storedBlock.fromLine < lines.length) {
            const line = lines[storedBlock.fromLine];
            if (line.trim().length > 0 && !isFenceLine(line)) {
                return storedBlock.fromLine;
            }
        }
        return null;
    }
    getParagraphExportGroups(context) {
        var _a;
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return [];
        }
        const blockNotes = (_a = this.getStoredFileNotes(context.file)) === null || _a === void 0 ? void 0 : _a.blocks[context.blockId];
        if (!blockNotes || blockNotes.notes.length === 0) {
            return [];
        }
        return [{
                blockId: context.blockId,
                notes: blockNotes.notes,
                fingerprint: blockNotes.fingerprint
            }];
    }
    async getAvailableExportPath(title) {
        const safeName = sanitizeFileName(title);
        let path = `${safeName}.md`;
        let index = 2;
        while (await this.app.vault.adapter.exists(path)) {
            path = `${safeName} ${index}.md`;
            index++;
        }
        return path;
    }
    buildExportMarkdown(title, file, storedFile, groups, mode) {
        const lines = [
            `# ${title}`,
            ""
        ];
        for (const group of groups) {
            lines.push(`## BlockID: ^${group.blockId}`, "");
            group.notes.forEach((note, index) => {
                lines.push(getNoteExportMarkdown(note));
                const isLastNoteInGroup = index === group.notes.length - 1;
                if (this.settings.exportBlankLineBetweenNotes || isLastNoteInGroup) {
                    lines.push("");
                }
            });
        }
        return lines.join("\n");
    }
    buildSelectedExportMarkdown(title, files) {
        const lines = [
            `# ${title}`,
            ""
        ];
        for (const file of files) {
            lines.push(`## ${file.name}`, `SideNotesID: ${file.SideNoteID}`, file.orphaned ? `Old path: ${file.path}` : `Path: ${file.path}`, "");
            for (const group of file.groups) {
                lines.push(`### BlockID: ^${group.blockId}`, "");
                for (const note of group.notes) {
                    lines.push(getNoteExportMarkdown(note));
                    lines.push("");
                }
            }
        }
        return lines.join("\n");
    }
    async addNoteForCurrentContext(text, refreshViews = true) {
        const trimmedText = text.trim();
        if (!trimmedText) {
            new obsidian_1.Notice("Write a note first.");
            return false;
        }
        const context = await this.ensureCurrentContextHasBlockId();
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return false;
        }
        const notes = this.ensureBlockNotes(context.file, context.blockId, context.fingerprint, context.fromLine, context.toLine);
        const now = Date.now();
        notes.push({
            id: makeId("note"),
            text: trimmedText,
            createdAt: now,
            updatedAt: now
        });
        await this.savePluginState();
        if (refreshViews) {
            this.refreshViews();
        }
        return true;
    }
    async addImageNoteForCurrentContext(file, refreshViews = true) {
        if (!isAcceptedImageFile(file.name, file.type)) {
            new obsidian_1.Notice("Choose an image file.");
            return false;
        }
        const context = await this.ensureCurrentContextHasBlockId();
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return false;
        }
        await this.ensureVaultFolder(SIDE_NOTES_IMAGES_FOLDER);
        const imagePath = await this.getAvailableVaultPath(joinVaultPath(SIDE_NOTES_IMAGES_FOLDER, getSafeImageFileName(file.name, file.type)));
        await this.app.vault.createBinary(imagePath, await file.arrayBuffer());
        const notes = this.ensureBlockNotes(context.file, context.blockId, context.fingerprint, context.fromLine, context.toLine);
        const now = Date.now();
        notes.push({
            id: makeId("note"),
            type: "image",
            text: "",
            imagePath,
            imageName: file.name,
            imageMime: file.type,
            imageZoom: 1,
            imagePanX: 0,
            imagePanY: 0,
            createdAt: now,
            updatedAt: now
        });
        await this.savePluginState();
        if (refreshViews) {
            this.refreshViews();
        }
        return true;
    }
    async addAudioNoteForCurrentContext(file, refreshViews = true) {
        const context = await this.ensureCurrentContextHasBlockId();
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return false;
        }
        return this.addAudioNoteForContext(file, context, refreshViews);
    }
    async addAudioNoteForContext(file, context, refreshViews = true) {
        if (!isAcceptedAudioFile(file.name, file.type)) {
            new obsidian_1.Notice("Choose an audio file.");
            return false;
        }
        if (!context.blockId) {
            new obsidian_1.Notice("Place the cursor inside a paragraph first.");
            return false;
        }
        await this.restoreMissingBlockIdIfNeeded(context, context.blockId);
        await this.ensureVaultFolder(SIDE_NOTES_AUDIO_FOLDER);
        const audioPath = await this.getAvailableVaultPath(joinVaultPath(SIDE_NOTES_AUDIO_FOLDER, getSafeAudioFileName(file.name, file.type)));
        await this.app.vault.createBinary(audioPath, await file.arrayBuffer());
        const notes = this.ensureBlockNotes(context.file, context.blockId, context.fingerprint, context.fromLine, context.toLine);
        const now = Date.now();
        notes.push({
            id: makeId("note"),
            type: "audio",
            text: "",
            audioPath,
            audioName: file.name,
            audioMime: file.type,
            createdAt: now,
            updatedAt: now
        });
        await this.savePluginState();
        if (refreshViews) {
            this.refreshViews();
        }
        return true;
    }
    async addVideoNoteForCurrentContext(file, refreshViews = true) {
        if (!isAcceptedVideoFile(file.name, file.type)) {
            new obsidian_1.Notice("Choose a video file.");
            return false;
        }
        const context = await this.ensureCurrentContextHasBlockId();
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return false;
        }
        await this.ensureVaultFolder(SIDE_NOTES_VIDEO_FOLDER);
        const videoPath = await this.getAvailableVaultPath(joinVaultPath(SIDE_NOTES_VIDEO_FOLDER, getSafeVideoFileName(file.name, file.type)));
        await this.app.vault.createBinary(videoPath, await file.arrayBuffer());
        const notes = this.ensureBlockNotes(context.file, context.blockId, context.fingerprint, context.fromLine, context.toLine);
        const now = Date.now();
        notes.push({
            id: makeId("note"),
            type: "video",
            text: "",
            videoPath,
            videoName: file.name,
            videoMime: file.type,
            createdAt: now,
            updatedAt: now
        });
        await this.savePluginState();
        if (refreshViews) {
            this.refreshViews();
        }
        return true;
    }
    async addFileNoteForCurrentContext(file, refreshViews = true) {
        const context = await this.ensureCurrentContextHasBlockId();
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return false;
        }
        await this.ensureVaultFolder(SIDE_NOTES_FILES_FOLDER);
        const filePath = await this.getAvailableVaultPath(joinVaultPath(SIDE_NOTES_FILES_FOLDER, getSafeGenericFileName(file.name)));
        await this.app.vault.createBinary(filePath, await file.arrayBuffer());
        const notes = this.ensureBlockNotes(context.file, context.blockId, context.fingerprint, context.fromLine, context.toLine);
        const now = Date.now();
        notes.push({
            id: makeId("note"),
            type: "file",
            text: "",
            filePath,
            fileName: file.name,
            fileMime: file.type,
            createdAt: now,
            updatedAt: now
        });
        await this.savePluginState();
        if (refreshViews) {
            this.refreshViews();
        }
        return true;
    }
    async addFilePathNoteForCurrentContext(path, refreshViews = true) {
        const trimmedPath = path.trim();
        if (!trimmedPath) {
            new obsidian_1.Notice("Enter a file path first.");
            return false;
        }
        const context = await this.ensureCurrentContextHasBlockId();
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return false;
        }
        const notes = this.ensureBlockNotes(context.file, context.blockId, context.fingerprint, context.fromLine, context.toLine);
        const now = Date.now();
        notes.push({
            id: makeId("note"),
            type: "file",
            text: "",
            fileExternalPath: trimmedPath,
            fileName: getLeafFileName(trimmedPath) || trimmedPath,
            createdAt: now,
            updatedAt: now
        });
        await this.savePluginState();
        if (refreshViews) {
            this.refreshViews();
        }
        return true;
    }
    async addUrlNoteForCurrentContext(rawUrl, refreshViews = true) {
        const url = normalizeSideNoteUrl(rawUrl);
        if (!url) {
            new obsidian_1.Notice("Enter a valid URL first.");
            return false;
        }
        const context = await this.ensureCurrentContextHasBlockId();
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return false;
        }
        const notes = this.ensureBlockNotes(context.file, context.blockId, context.fingerprint, context.fromLine, context.toLine);
        const now = Date.now();
        notes.push({
            id: makeId("note"),
            type: "url",
            text: "",
            url,
            urlTitle: getUrlDisplayName(url),
            createdAt: now,
            updatedAt: now
        });
        await this.savePluginState();
        if (refreshViews) {
            this.refreshViews();
        }
        return true;
    }
    async updateNote(blockId, noteId, text, sourcePath, sourceSideNoteId, renderOptions = {}) {
        var _a, _b, _c, _d, _e;
        const context = this.currentContext;
        const filePath = (_a = sourcePath !== null && sourcePath !== void 0 ? sourcePath : context === null || context === void 0 ? void 0 : context.filePath) !== null && _a !== void 0 ? _a : (_c = (_b = this.lastMarkdownView) === null || _b === void 0 ? void 0 : _b.file) === null || _c === void 0 ? void 0 : _c.path;
        if (!filePath && !sourceSideNoteId) {
            return;
        }
        if (context && context.blockId === blockId) {
            await this.restoreMissingBlockIdIfNeeded(context, blockId);
        }
        const notes = (_e = (_d = this.getStoredFileNotesFromSource(filePath, sourceSideNoteId)) === null || _d === void 0 ? void 0 : _d.blocks[blockId]) === null || _e === void 0 ? void 0 : _e.notes;
        const note = notes === null || notes === void 0 ? void 0 : notes.find((item) => item.id === noteId);
        if (!note) {
            return;
        }
        note.text = text;
        if (context && context.blockId === blockId) {
            this.ensureBlockNotes(context.file, blockId, context.fingerprint, context.fromLine, context.toLine);
        }
        note.updatedAt = Date.now();
        await this.savePluginState();
        this.refreshViews(renderOptions);
    }
    async updateImageNoteZoom(blockId, noteId, zoom, sourcePath, sourceSideNoteId, renderOptions = {}) {
        var _a, _b, _c, _d, _e;
        const context = this.currentContext;
        const filePath = (_a = sourcePath !== null && sourcePath !== void 0 ? sourcePath : context === null || context === void 0 ? void 0 : context.filePath) !== null && _a !== void 0 ? _a : (_c = (_b = this.lastMarkdownView) === null || _b === void 0 ? void 0 : _b.file) === null || _c === void 0 ? void 0 : _c.path;
        if (!filePath && !sourceSideNoteId) {
            return;
        }
        const notes = (_e = (_d = this.getStoredFileNotesFromSource(filePath, sourceSideNoteId)) === null || _d === void 0 ? void 0 : _d.blocks[blockId]) === null || _e === void 0 ? void 0 : _e.notes;
        const note = notes === null || notes === void 0 ? void 0 : notes.find((item) => item.id === noteId);
        if (!note || !isImageNote(note)) {
            return;
        }
        const nextZoom = clampImageZoom(zoom);
        note.imageZoom = nextZoom;
        if (nextZoom <= 1) {
            note.imagePanX = 0;
            note.imagePanY = 0;
        }
        note.updatedAt = Date.now();
        await this.savePluginState();
        this.refreshViews(renderOptions);
    }
    async updateImageNoteViewport(blockId, noteId, zoom, frameHeightPx, frameScale, sourcePath, sourceSideNoteId, renderOptions = {}) {
        var _a, _b, _c, _d, _e;
        const context = this.currentContext;
        const filePath = (_a = sourcePath !== null && sourcePath !== void 0 ? sourcePath : context === null || context === void 0 ? void 0 : context.filePath) !== null && _a !== void 0 ? _a : (_c = (_b = this.lastMarkdownView) === null || _b === void 0 ? void 0 : _b.file) === null || _c === void 0 ? void 0 : _c.path;
        if (!filePath && !sourceSideNoteId) {
            return;
        }
        const notes = (_e = (_d = this.getStoredFileNotesFromSource(filePath, sourceSideNoteId)) === null || _d === void 0 ? void 0 : _d.blocks[blockId]) === null || _e === void 0 ? void 0 : _e.notes;
        const note = notes === null || notes === void 0 ? void 0 : notes.find((item) => item.id === noteId);
        if (!note || !isImageNote(note)) {
            return;
        }
        const nextZoom = clampImageZoom(zoom);
        note.imageZoom = nextZoom;
        if (typeof frameHeightPx === "number") {
            note.imageFrameHeightPx = clampImageFrameHeight(frameHeightPx);
        }
        if (typeof frameScale === "number") {
            note.imageFrameScale = clampImageFrameScale(frameScale);
        }
        if (nextZoom <= 1) {
            note.imagePanX = 0;
            note.imagePanY = 0;
        }
        note.updatedAt = Date.now();
        await this.savePluginState();
        this.refreshViews(renderOptions);
    }
    async updateImageNoteRotation(blockId, noteId, rotation, sourcePath, sourceSideNoteId, renderOptions = {}) {
        var _a, _b, _c, _d, _e;
        const context = this.currentContext;
        const filePath = (_a = sourcePath !== null && sourcePath !== void 0 ? sourcePath : context === null || context === void 0 ? void 0 : context.filePath) !== null && _a !== void 0 ? _a : (_c = (_b = this.lastMarkdownView) === null || _b === void 0 ? void 0 : _b.file) === null || _c === void 0 ? void 0 : _c.path;
        if (!filePath && !sourceSideNoteId) {
            return;
        }
        const notes = (_e = (_d = this.getStoredFileNotesFromSource(filePath, sourceSideNoteId)) === null || _d === void 0 ? void 0 : _d.blocks[blockId]) === null || _e === void 0 ? void 0 : _e.notes;
        const note = notes === null || notes === void 0 ? void 0 : notes.find((item) => item.id === noteId);
        if (!note || !isImageNote(note)) {
            return;
        }
        note.imageRotation = normalizeImageRotation(rotation);
        note.updatedAt = Date.now();
        await this.savePluginState();
        this.refreshViews(renderOptions);
    }
    async updateImageNotePan(blockId, noteId, panX, panY, sourcePath, sourceSideNoteId, renderOptions = {}) {
        var _a, _b, _c, _d, _e;
        const context = this.currentContext;
        const filePath = (_a = sourcePath !== null && sourcePath !== void 0 ? sourcePath : context === null || context === void 0 ? void 0 : context.filePath) !== null && _a !== void 0 ? _a : (_c = (_b = this.lastMarkdownView) === null || _b === void 0 ? void 0 : _b.file) === null || _c === void 0 ? void 0 : _c.path;
        if (!filePath && !sourceSideNoteId) {
            return;
        }
        const notes = (_e = (_d = this.getStoredFileNotesFromSource(filePath, sourceSideNoteId)) === null || _d === void 0 ? void 0 : _d.blocks[blockId]) === null || _e === void 0 ? void 0 : _e.notes;
        const note = notes === null || notes === void 0 ? void 0 : notes.find((item) => item.id === noteId);
        if (!note || !isImageNote(note)) {
            return;
        }
        note.imagePanX = clampImagePanOffset(panX);
        note.imagePanY = clampImagePanOffset(panY);
        note.updatedAt = Date.now();
        await this.savePluginState();
        this.refreshViews(renderOptions);
    }
    async deleteNote(blockId, noteId, sourcePath, sourceSideNoteId) {
        var _a, _b, _c, _d;
        const context = this.currentContext;
        const filePath = (_a = sourcePath !== null && sourcePath !== void 0 ? sourcePath : context === null || context === void 0 ? void 0 : context.filePath) !== null && _a !== void 0 ? _a : (_c = (_b = this.lastMarkdownView) === null || _b === void 0 ? void 0 : _b.file) === null || _c === void 0 ? void 0 : _c.path;
        if (!filePath && !sourceSideNoteId) {
            return;
        }
        const blockNotes = (_d = this.getStoredFileNotesFromSource(filePath, sourceSideNoteId)) === null || _d === void 0 ? void 0 : _d.blocks[blockId];
        if (!blockNotes) {
            return;
        }
        blockNotes.notes = blockNotes.notes.filter((note) => note.id !== noteId);
        await this.savePluginState();
        this.refreshViews();
    }
    async moveNoteWithinBlock(blockId, noteId, direction, sourcePath, sourceSideNoteId) {
        var _a, _b, _c, _d, _e;
        const context = this.currentContext;
        const filePath = (_a = sourcePath !== null && sourcePath !== void 0 ? sourcePath : context === null || context === void 0 ? void 0 : context.filePath) !== null && _a !== void 0 ? _a : (_c = (_b = this.lastMarkdownView) === null || _b === void 0 ? void 0 : _b.file) === null || _c === void 0 ? void 0 : _c.path;
        if (!filePath && !sourceSideNoteId) {
            return false;
        }
        const notes = (_e = (_d = this.getStoredFileNotesFromSource(filePath, sourceSideNoteId)) === null || _d === void 0 ? void 0 : _d.blocks[blockId]) === null || _e === void 0 ? void 0 : _e.notes;
        if (!notes || notes.length < 2) {
            return false;
        }
        const noteIndex = notes.findIndex((note) => note.id === noteId);
        const nextIndex = noteIndex + direction;
        if (noteIndex === -1 || nextIndex < 0 || nextIndex >= notes.length) {
            return false;
        }
        [notes[noteIndex], notes[nextIndex]] = [notes[nextIndex], notes[noteIndex]];
        await this.savePluginState();
        this.refreshViews({ preserveScroll: true });
        return true;
    }
    async mergeSelectedNotesWithinBlock(noteRefs) {
        if (noteRefs.length < 2) {
            return 0;
        }
        const firstNoteRef = noteRefs[0];
        const sourceFile = this.getStoredFileNotesFromSource(firstNoteRef.sourcePath, firstNoteRef.sourceSideNoteId);
        if (!sourceFile) {
            return 0;
        }
        for (const noteRef of noteRefs) {
            const noteSourceFile = this.getStoredFileNotesFromSource(noteRef.sourcePath, noteRef.sourceSideNoteId);
            if (!noteSourceFile || noteSourceFile.SideNoteID !== sourceFile.SideNoteID || noteRef.blockId !== firstNoteRef.blockId) {
                return 0;
            }
        }
        const blockNotes = sourceFile.blocks[firstNoteRef.blockId];
        if (!blockNotes) {
            return 0;
        }
        const selectedNoteIds = new Set(noteRefs.map((noteRef) => noteRef.noteId));
        const selectedNotesInOrder = blockNotes.notes.filter((note) => selectedNoteIds.has(note.id));
        if (selectedNotesInOrder.length < 2) {
            return 0;
        }
        if (selectedNotesInOrder.some((note) => !isTextNote(note))) {
            return 0;
        }
        const [topNote, ...lowerNotes] = selectedNotesInOrder;
        topNote.text = joinMergedNoteTexts(selectedNotesInOrder.map((note) => note.text));
        topNote.updatedAt = Date.now();
        const lowerNoteIds = new Set(lowerNotes.map((note) => note.id));
        blockNotes.notes = blockNotes.notes.filter((note) => !lowerNoteIds.has(note.id));
        await this.savePluginState();
        this.refreshViews({ preserveScroll: true });
        return selectedNotesInOrder.length;
    }
    async deleteSelectedNotes(noteRefs) {
        if (noteRefs.length === 0) {
            return 0;
        }
        let deletedCount = 0;
        for (const noteRef of noteRefs) {
            const sourceFile = this.getStoredFileNotesFromSource(noteRef.sourcePath, noteRef.sourceSideNoteId);
            const sourceBlock = sourceFile === null || sourceFile === void 0 ? void 0 : sourceFile.blocks[noteRef.blockId];
            if (!sourceFile || !sourceBlock) {
                continue;
            }
            const beforeCount = sourceBlock.notes.length;
            sourceBlock.notes = sourceBlock.notes.filter((note) => note.id !== noteRef.noteId);
            if (sourceBlock.notes.length === beforeCount) {
                continue;
            }
            deletedCount++;
            if (sourceBlock.notes.length === 0) {
                delete sourceFile.blocks[noteRef.blockId];
            }
        }
        if (deletedCount > 0) {
            await this.savePluginState();
            this.refreshViews();
        }
        return deletedCount;
    }
    async moveNotesToCurrentParagraph(noteRefs) {
        if (noteRefs.length === 0) {
            return 0;
        }
        const context = await this.ensureCurrentContextHasBlockId();
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return 0;
        }
        const destinationFile = this.ensureStoredFileNotes(context.file);
        const destinationNotes = this.ensureBlockNotes(context.file, context.blockId, context.fingerprint, context.fromLine, context.toLine);
        let movedCount = 0;
        for (const noteRef of noteRefs) {
            const sourceFile = this.getStoredFileNotesFromSource(noteRef.sourcePath, noteRef.sourceSideNoteId);
            const sourceBlock = sourceFile === null || sourceFile === void 0 ? void 0 : sourceFile.blocks[noteRef.blockId];
            if (!sourceFile || !sourceBlock) {
                continue;
            }
            if (sourceFile.SideNoteID === destinationFile.SideNoteID && noteRef.blockId === context.blockId) {
                continue;
            }
            const noteIndex = sourceBlock.notes.findIndex((note) => note.id === noteRef.noteId);
            if (noteIndex === -1) {
                continue;
            }
            const [note] = sourceBlock.notes.splice(noteIndex, 1);
            destinationNotes.push(note);
            movedCount++;
            if (sourceBlock.notes.length === 0) {
                delete sourceFile.blocks[noteRef.blockId];
            }
        }
        if (movedCount > 0) {
            await this.savePluginState();
            this.refreshViews();
        }
        return movedCount;
    }
    async deleteAllNotesForSideNoteId(sideNoteId, removeStoredFile = true) {
        sideNoteId = normalizeSideNotesId(sideNoteId);
        const storedFile = this.sideNotesData.filesBySideNoteId[sideNoteId];
        if (!storedFile) {
            return;
        }
        if (removeStoredFile) {
            delete this.sideNotesData.sideNoteIds[storedFile.path];
            delete this.sideNotesData.files[storedFile.path];
            delete this.sideNotesData.filesBySideNoteId[sideNoteId];
        }
        else {
            storedFile.blocks = {};
            this.sideNotesData.files[storedFile.path] = {};
        }
        await this.savePluginState();
        this.refreshViews();
    }
    async ensureCurrentContextHasBlockId() {
        var _a;
        const context = this.getCurrentParagraphContext();
        if (!context) {
            new obsidian_1.Notice("Place the cursor inside a paragraph first.");
            return null;
        }
        if (context.blockId && context.hasBlockIdInFile) {
            this.currentContext = context;
            return context;
        }
        if (context.blockId && !this.usesMarkdownBlockIds()) {
            this.currentContext = context;
            return context;
        }
        if (!this.usesMarkdownBlockIds()) {
            const blockId = this.makeUniqueInternalBlockId(context.file);
            const updatedContext = {
                ...context,
                hasBlockIdInFile: false,
                blockId
            };
            this.currentContext = updatedContext;
            return updatedContext;
        }
        if (!this.settings.autoInsertBlockIds) {
            new obsidian_1.Notice("This paragraph has no block ID. Enable automatic block IDs in settings.");
            return null;
        }
        const markdownView = this.getCurrentMarkdownView();
        if (!markdownView) {
            return null;
        }
        const blockId = await this.appendBlockId(markdownView.editor, context, (_a = context.blockId) !== null && _a !== void 0 ? _a : undefined);
        const updatedContext = {
            ...context,
            text: `${context.text} ^${blockId}`,
            hasBlockIdInFile: true,
            blockId
        };
        this.currentContext = updatedContext;
        return updatedContext;
    }
    makeUniqueInternalBlockId(file) {
        var _a;
        let blockId = makeId(sanitizeBlockPrefix(this.settings.blockIdPrefix));
        while ((_a = this.getStoredFileNotes(file)) === null || _a === void 0 ? void 0 : _a.blocks[blockId]) {
            blockId = makeId(sanitizeBlockPrefix(this.settings.blockIdPrefix));
        }
        return blockId;
    }
    getCurrentMarkdownView() {
        var _a;
        const activeMarkdownView = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
        if (activeMarkdownView === null || activeMarkdownView === void 0 ? void 0 : activeMarkdownView.file) {
            this.lastMarkdownView = activeMarkdownView;
            return activeMarkdownView;
        }
        if ((_a = this.lastMarkdownView) === null || _a === void 0 ? void 0 : _a.file) {
            return this.lastMarkdownView;
        }
        return null;
    }
    async appendBlockId(editor, context, preferredBlockId) {
        var _a;
        let blockId = preferredBlockId !== null && preferredBlockId !== void 0 ? preferredBlockId : makeId(sanitizeBlockPrefix(this.settings.blockIdPrefix));
        while (!preferredBlockId && ((_a = this.getStoredFileNotes(context.file)) === null || _a === void 0 ? void 0 : _a.blocks[blockId])) {
            blockId = makeId(sanitizeBlockPrefix(this.settings.blockIdPrefix));
        }
        if (preferredBlockId) {
            this.removeExistingBlockIdFromEditor(editor, preferredBlockId);
        }
        const lastLine = editor.getLine(context.toLine);
        const suffix = lastLine.trim().length > 0 ? ` ^${blockId}` : `^${blockId}`;
        editor.replaceRange(suffix, {
            line: context.toLine,
            ch: lastLine.length
        });
        return blockId;
    }
    removeExistingBlockIdFromEditor(editor, blockId) {
        const blockIdTailPattern = new RegExp(`[ \\t\\u00a0]*\\^${escapeRegExp(blockId)}\\s*$`);
        for (let line = editor.lineCount() - 1; line >= 0; line--) {
            const lineText = editor.getLine(line);
            const match = lineText.match(blockIdTailPattern);
            if (!match || match.index === undefined) {
                continue;
            }
            editor.replaceRange("", { line, ch: match.index }, { line, ch: lineText.length });
        }
    }
    async restoreMissingBlockIdIfNeeded(context, blockId) {
        if (!this.usesMarkdownBlockIds()) {
            return;
        }
        if (context.hasBlockIdInFile || context.blockId !== blockId || !this.settings.autoInsertBlockIds) {
            return;
        }
        const markdownView = this.getCurrentMarkdownView();
        if (!markdownView) {
            return;
        }
        await this.appendBlockId(markdownView.editor, context, blockId);
        context.hasBlockIdInFile = true;
    }
    ensureBlockNotes(file, blockId, fingerprint, fromLine, toLine) {
        const storedFile = this.ensureStoredFileNotes(file);
        if (!storedFile.blocks[blockId]) {
            storedFile.blocks[blockId] = { notes: [] };
        }
        if (fingerprint) {
            storedFile.blocks[blockId].fingerprint = fingerprint;
        }
        if (fromLine !== undefined) {
            storedFile.blocks[blockId].fromLine = fromLine;
        }
        if (toLine !== undefined) {
            storedFile.blocks[blockId].toLine = toLine;
        }
        return storedFile.blocks[blockId].notes;
    }
    findBlockIdForParagraph(file, fingerprint, range) {
        const storedFile = this.getStoredFileNotes(file);
        if (!storedFile) {
            return null;
        }
        const chooseUniqueBest = (entries) => {
            if (entries.length === 0) {
                return null;
            }
            const exact = entries.filter(([, blockNotes]) => blockNotes.fromLine === range.fromLine && blockNotes.toLine === range.toLine);
            if (exact.length === 1) {
                return exact[0][0];
            }
            if (exact.length > 1) {
                return null;
            }
            const scored = entries
                .map(([blockId, blockNotes]) => ({ blockId, score: getLineRangeMatchScore(blockNotes, range) }))
                .filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score || a.blockId.localeCompare(b.blockId));
            if (scored.length === 0 ||
                (scored.length > 1 && scored[0].score === scored[1].score)) {
                return null;
            }
            return scored[0].blockId;
        };
        if (fingerprint) {
            const fingerprintMatches = Object.entries(storedFile.blocks)
                .filter(([, blockNotes]) => blockNotes.fingerprint === fingerprint);
            if (fingerprintMatches.length === 1) {
                return fingerprintMatches[0][0];
            }
            if (fingerprintMatches.length > 1) {
                return chooseUniqueBest(fingerprintMatches);
            }
        }
        return chooseUniqueBest(Object.entries(storedFile.blocks));
    }
    isSideNoteIdOwnedByDifferentExistingFile(file, sideNoteId) {
        var _a;
        const normalizedId = normalizeSideNotesId(sideNoteId);
        const storedFile = this.sideNotesData.filesBySideNoteId[normalizedId];
        if (!storedFile || storedFile.path === file.path) {
            return false;
        }
        const owner = this.app.vault.getAbstractFileByPath(storedFile.path);
        if (!(owner instanceof obsidian_1.TFile)) {
            // The old path disappeared: this can be a rename/move. Let the normal
            // rename/path recovery flow retain the existing identity.
            return false;
        }
        const ownerPropertyId = this.getSideNoteIDFromProperties(owner);
        return ownerPropertyId === normalizedId ||
            normalizeSideNotesId((_a = this.sideNotesData.sideNoteIds[storedFile.path]) !== null && _a !== void 0 ? _a : "") === normalizedId;
    }
    makeFreshStoredFileNotes(file) {
        const sideNoteId = this.makeUnusedSideNotesID();
        const storedFile = {
            SideNoteID: sideNoteId,
            path: file.path,
            name: file.basename,
            blocks: {}
        };
        this.sideNotesData.sideNoteIds[file.path] = sideNoteId;
        this.sideNotesData.filesBySideNoteId[sideNoteId] = storedFile;
        void this.ensureSideNoteIDProperty(file, sideNoteId, true);
        return storedFile;
    }
    ensureStoredFileNotes(file) {
        const propertySideNoteId = this.getSideNoteIDFromProperties(file);
        if (propertySideNoteId && this.isSideNoteIdOwnedByDifferentExistingFile(file, propertySideNoteId)) {
            const pathMappedId = this.sideNotesData.sideNoteIds[file.path];
            if (pathMappedId && this.sideNotesData.filesBySideNoteId[pathMappedId]) {
                return this.sideNotesData.filesBySideNoteId[pathMappedId];
            }
            const storedFile = this.makeFreshStoredFileNotes(file);
            new obsidian_1.Notice("This copied file had a SideNotesID already used by another file. " +
                "A new identity was assigned; existing SideNotes were not copied.");
            return storedFile;
        }
        if (propertySideNoteId && this.sideNotesData.filesBySideNoteId[propertySideNoteId]) {
            const storedFile = this.sideNotesData.filesBySideNoteId[propertySideNoteId];
            storedFile.SideNoteID = propertySideNoteId;
            storedFile.path = file.path;
            storedFile.name = file.basename;
            this.sideNotesData.sideNoteIds[file.path] = propertySideNoteId;
            return storedFile;
        }
        const existing = this.getStoredFileNotes(file);
        if (existing) {
            existing.path = file.path;
            existing.name = file.basename;
            this.sideNotesData.sideNoteIds[file.path] = existing.SideNoteID;
            void this.ensureSideNoteIDProperty(file, existing.SideNoteID);
            return existing;
        }
        return this.makeFreshStoredFileNotes(file);
    }
    getStoredFileNotes(file) {
        var _a;
        const propertySideNoteId = this.getSideNoteIDFromProperties(file);
        if (propertySideNoteId &&
            !this.isSideNoteIdOwnedByDifferentExistingFile(file, propertySideNoteId) &&
            this.sideNotesData.filesBySideNoteId[propertySideNoteId]) {
            const storedFile = this.sideNotesData.filesBySideNoteId[propertySideNoteId];
            storedFile.SideNoteID = propertySideNoteId;
            this.sideNotesData.sideNoteIds[file.path] = propertySideNoteId;
            return storedFile;
        }
        const sideNoteId = this.sideNotesData.sideNoteIds[file.path];
        if (sideNoteId && this.sideNotesData.filesBySideNoteId[sideNoteId]) {
            const storedFile = this.sideNotesData.filesBySideNoteId[sideNoteId];
            storedFile.SideNoteID = (_a = storedFile.SideNoteID) !== null && _a !== void 0 ? _a : sideNoteId;
            return storedFile;
        }
        return null;
    }
    getStoredFileNotesByPath(path) {
        var _a, _b;
        const sideNoteId = this.sideNotesData.sideNoteIds[path];
        if (sideNoteId && this.sideNotesData.filesBySideNoteId[sideNoteId]) {
            const storedFile = this.sideNotesData.filesBySideNoteId[sideNoteId];
            storedFile.SideNoteID = (_a = storedFile.SideNoteID) !== null && _a !== void 0 ? _a : sideNoteId;
            return storedFile;
        }
        for (const [storedSideNoteId, storedFile] of Object.entries(this.sideNotesData.filesBySideNoteId)) {
            if (storedFile.path === path) {
                storedFile.SideNoteID = (_b = storedFile.SideNoteID) !== null && _b !== void 0 ? _b : storedSideNoteId;
                return storedFile;
            }
        }
        const legacyBlocks = this.sideNotesData.files[path];
        if (legacyBlocks) {
            const sideNoteId = makeSideNotesId();
            const storedFile = {
                SideNoteID: sideNoteId,
                path,
                name: getFileNameFromPath(path),
                blocks: legacyBlocks
            };
            this.sideNotesData.sideNoteIds[path] = sideNoteId;
            this.sideNotesData.filesBySideNoteId[sideNoteId] = storedFile;
            return storedFile;
        }
        return null;
    }
    getStoredFileNotesFromSource(path, sideNoteId) {
        sideNoteId = sideNoteId ? normalizeSideNotesId(sideNoteId) : undefined;
        if (sideNoteId && this.sideNotesData.filesBySideNoteId[sideNoteId]) {
            return this.sideNotesData.filesBySideNoteId[sideNoteId];
        }
        return path ? this.getStoredFileNotesByPath(path) : null;
    }
    isStoredFileAttached(storedFile) {
        const file = this.app.vault.getAbstractFileByPath(storedFile.path);
        if (!(file instanceof obsidian_1.TFile)) {
            return false;
        }
        const propertySideNoteId = this.getSideNoteIDFromProperties(file);
        if (propertySideNoteId) {
            return propertySideNoteId === storedFile.SideNoteID;
        }
        return this.sideNotesData.sideNoteIds[storedFile.path] === storedFile.SideNoteID;
    }
    async handleDelete(file) {
        var _a, _b;
        if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") {
            this.refreshViews();
            return;
        }
        const sideNoteId = this.sideNotesData.sideNoteIds[file.path];
        const storedFile = sideNoteId ? this.sideNotesData.filesBySideNoteId[sideNoteId] : this.getStoredFileNotesByPath(file.path);
        delete this.sideNotesData.sideNoteIds[file.path];
        delete this.sideNotesData.files[file.path];
        if (storedFile) {
            storedFile.SideNoteID = (_b = (_a = storedFile.SideNoteID) !== null && _a !== void 0 ? _a : sideNoteId) !== null && _b !== void 0 ? _b : makeSideNotesId();
            storedFile.path = file.path;
            storedFile.name = file.basename;
        }
        await this.savePluginState();
        this.refreshContext();
    }
    async handleRename(file, oldPath) {
        var _a, _b;
        if (!(file instanceof obsidian_1.TFile) || file.extension !== "md") {
            return;
        }
        const sideNoteId = this.sideNotesData.sideNoteIds[oldPath];
        const storedFile = sideNoteId ? this.sideNotesData.filesBySideNoteId[sideNoteId] : this.getStoredFileNotesByPath(oldPath);
        if (!storedFile) {
            return;
        }
        delete this.sideNotesData.sideNoteIds[oldPath];
        storedFile.SideNoteID = (_b = (_a = storedFile.SideNoteID) !== null && _a !== void 0 ? _a : sideNoteId) !== null && _b !== void 0 ? _b : makeSideNotesId();
        this.sideNotesData.sideNoteIds[file.path] = storedFile.SideNoteID;
        storedFile.path = file.path;
        storedFile.name = file.basename;
        await this.savePluginState();
        this.refreshContext();
    }
}
exports.default = SideNotesPlugin;
class SideNotesView extends obsidian_1.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.draft = "";
        this.composerCollapsed = false;
        this.headerCollapsed = false;
        this.readingMode = false;
        this.collapsedNotes = new Set();
        this.editingNotes = new Set();
        this.expandedNotes = new Set();
        this.expandedFileCards = new Set();
        this.selectedNotes = new Map();
        this.cutNotes = [];
        this.composerSlotEl = null;
        this.draftLastValue = "";
        this.draftSelectionEnd = 0;
        this.draftSelectionStart = 0;
        this.draftUndoStack = [];
        this.draftRevision = 0;
        this.draftSaveInProgress = false;
        this.editDrafts = new Map();
        this.editNoteToFocus = null;
        this.orphanedNoteIds = [];
        this.orphanedNoteRefs = [];
        this.vaultNoteIds = [];
        this.vaultNoteRefs = [];
        this.viewMode = "paragraph";
        this.viewControlsEl = null;
        this.viewControlNotes = [];
        this.viewControlSelectableNoteRefs = [];
        this.viewControlStats = { noteCount: 0 };
        this.headerFileStatsEl = null;
        this.headerNoteStatsEl = null;
        this.shouldFocusComposer = false;
        this.audioRecordingPanelVisible = false;
        this.audioRecordingCancelButton = null;
        this.audioRecordingChunks = [];
        this.audioRecordingContext = null;
        this.audioRecordingElapsedEl = null;
        this.audioRecordingMediaRecorder = null;
        this.audioRecordingSaving = false;
        this.audioRecordingShouldSaveOnStop = false;
        this.audioRecordingStartButton = null;
        this.audioRecordingStartedAt = 0;
        this.audioRecordingStatusEl = null;
        this.audioRecordingStopButton = null;
        this.audioRecordingStream = null;
        this.audioRecordingTimerId = null;
        this.audioRecordingRequestGeneration = 0;
        this.audioRecordingRequesting = false;
        this.plugin = plugin;
        this.headerCollapsed = plugin.settings.headerCollapsed;
    }
    getViewType() {
        return VIEW_TYPE_SIDE_NOTES;
    }
    getDisplayText() {
        return "AAG - Side Notes";
    }
    getIcon() {
        return "sticky-note";
    }
    resetForFileChange() {
        this.selectedNotes.clear();
        this.editingNotes.clear();
        this.editDrafts.clear();
        this.editNoteToFocus = null;
        this.viewControlNotes = [];
        this.viewControlSelectableNoteRefs = [];
        this.viewControlStats = { noteCount: 0 };
        void this.render();
    }
    showComposer() {
        const wasParagraphView = this.viewMode === "paragraph";
        this.viewMode = "paragraph";
        this.composerCollapsed = false;
        this.shouldFocusComposer = true;
        if (wasParagraphView && this.composerSlotEl) {
            this.renderComposerSlot();
            this.refreshViewControls();
            return;
        }
        void this.render({ preserveScroll: true });
    }
    toggleComposer() {
        if (this.viewMode !== "paragraph") {
            this.showComposer();
            return;
        }
        const shouldShowComposer = this.composerCollapsed;
        if (!shouldShowComposer) {
            this.saveComposerDraftFromDom();
        }
        this.composerCollapsed = !this.composerCollapsed;
        if (shouldShowComposer) {
            this.shouldFocusComposer = true;
        }
        if (this.composerSlotEl) {
            this.renderComposerSlot();
            this.refreshViewControls();
            return;
        }
        void this.render({ preserveScroll: true });
    }
    async onOpen() {
        this.registerDomEvent(this.contentEl, "pointerdown", () => {
            this.plugin.suppressContextRefreshBriefly();
        }, { capture: true });
        this.registerDomEvent(this.contentEl, "keydown", () => {
            this.plugin.suppressContextRefreshBriefly();
        }, { capture: true });
        this.plugin.refreshContext();
        await this.render();
    }
    async onClose() {
        this.cancelAudioRecording(true);
    }
    async render(options = {}) {
        var _a, _b;
        const { contentEl } = this;
        const scrollState = options.preserveScroll ? this.captureScrollState(options.anchorNoteKey) : null;
        try {
            contentEl.empty();
            this.composerSlotEl = null;
            contentEl.addClass("side-notes-view");
            contentEl.classList.toggle("side-notes-reading-mode", this.readingMode);
            contentEl.setCssProps({
                "--side-notes-header-font-size": `${this.plugin.settings.headerFontSizePx}px`,
                "--side-notes-note-font-family": getNoteFontFamilyCssValue(this.plugin.settings.noteFontFamily),
                "--side-notes-editor-font-size": `${this.plugin.settings.noteEditorFontSizePx}px`,
                "--side-notes-preview-font-size": `${this.plugin.settings.notePreviewFontSizePx}px`,
                "--side-notes-open-font-size": `${this.plugin.settings.noteOpenFontSizePx}px`,
                "--side-notes-button-size": `${this.plugin.settings.buttonSizePx}px`
            });
            const context = this.plugin.currentContext;
            const fileInfo = this.plugin.getCurrentFileInfo();
            this.renderHeader(contentEl, context, fileInfo);
            if (!context && this.viewMode !== "orphaned" && this.viewMode !== "vault" && (this.viewMode !== "file" || !fileInfo)) {
                contentEl.createDiv({
                    cls: "side-notes-empty",
                    text: "Place the cursor inside a paragraph in a Markdown note."
                });
                return;
            }
            const notes = context ? this.plugin.getNotesForCurrentContext() : [];
            if (this.viewMode === "file") {
                const groups = this.plugin.getNoteGroupsForCurrentFile();
                const fileNoteRefs = this.getGroupNoteReferences(groups, (_a = fileInfo === null || fileInfo === void 0 ? void 0 : fileInfo.path) !== null && _a !== void 0 ? _a : "");
                this.renderViewControls(contentEl, notes, fileNoteRefs, {
                    fileCount: fileInfo ? 1 : 0,
                    fileSelectionGroups: fileNoteRefs.length > 0 ? [fileNoteRefs] : [],
                    noteCount: fileNoteRefs.length
                });
                await this.renderFileNotes(contentEl, fileInfo, groups);
                return;
            }
            if (this.viewMode === "orphaned") {
                const orphanedFiles = await this.plugin.getOrphanedFileNotes();
                this.orphanedNoteIds = orphanedFiles.flatMap((file) => file.groups.flatMap((group) => group.notes.map((note) => note.id)));
                this.orphanedNoteRefs = orphanedFiles.flatMap((file) => this.getGroupNoteReferences(file.groups, file.path, file.SideNoteID));
                this.renderViewControls(contentEl, notes, this.orphanedNoteRefs, {
                    fileCount: orphanedFiles.length,
                    fileSelectionGroups: orphanedFiles.map((file) => this.getGroupNoteReferences(file.groups, file.path, file.SideNoteID)),
                    orphanedFileCount: orphanedFiles.length,
                    noteCount: this.orphanedNoteRefs.length
                });
                await this.renderOrphanedNotes(contentEl, orphanedFiles);
                return;
            }
            if (this.viewMode === "vault") {
                const storedFiles = this.plugin.getAllStoredFileNotes();
                this.vaultNoteIds = storedFiles.flatMap((file) => file.groups.flatMap((group) => group.notes.map((note) => note.id)));
                this.vaultNoteRefs = storedFiles.flatMap((file) => this.getGroupNoteReferences(file.groups, file.path, file.SideNoteID));
                this.renderViewControls(contentEl, notes, this.vaultNoteRefs, {
                    fileCount: storedFiles.length,
                    fileSelectionGroups: storedFiles.map((file) => this.getGroupNoteReferences(file.groups, file.path, file.SideNoteID)),
                    orphanedFileCount: storedFiles.filter((file) => file.orphaned).length,
                    noteCount: this.vaultNoteRefs.length
                });
                await this.renderVaultNotes(contentEl, storedFiles);
                return;
            }
            const paragraphNoteRefs = this.getCurrentParagraphNoteReferences(notes);
            this.renderViewControls(contentEl, notes, paragraphNoteRefs, {
                fileCount: context ? 1 : 0,
                fileSelectionGroups: paragraphNoteRefs.length > 0 ? [paragraphNoteRefs] : [],
                noteCount: paragraphNoteRefs.length
            });
            if (!context) {
                return;
            }
            this.composerSlotEl = contentEl.createDiv({ cls: "side-notes-composer-slot" });
            this.renderComposerSlot();
            if (notes.length === 0) {
                contentEl.createDiv({
                    cls: "side-notes-empty",
                    text: "No notes for this paragraph yet."
                });
                return;
            }
            const listEl = contentEl.createDiv({ cls: "side-notes-list" });
            for (const note of notes) {
                await this.renderNote(listEl, context.filePath, (_b = context.blockId) !== null && _b !== void 0 ? _b : "", note);
            }
        }
        finally {
            if (scrollState) {
                this.restoreScrollState(scrollState);
            }
        }
    }
    captureScrollState(anchorNoteKey) {
        var _a;
        const listEl = this.contentEl.querySelector(".side-notes-list");
        const viewContentEl = this.getViewContentEl();
        const anchorEl = anchorNoteKey ? this.findNoteCardEl(anchorNoteKey) : null;
        return {
            anchorNoteKey,
            contentAnchorTop: anchorEl ? getElementTopRelativeTo(this.contentEl, anchorEl) : undefined,
            contentTop: this.contentEl.scrollTop,
            listAnchorTop: anchorEl && listEl instanceof HTMLElement ? getElementTopRelativeTo(listEl, anchorEl) : undefined,
            listTop: listEl instanceof HTMLElement ? listEl.scrollTop : 0,
            viewContentAnchorTop: anchorEl && viewContentEl ? getElementTopRelativeTo(viewContentEl, anchorEl) : undefined,
            viewContentTop: (_a = viewContentEl === null || viewContentEl === void 0 ? void 0 : viewContentEl.scrollTop) !== null && _a !== void 0 ? _a : 0
        };
    }
    restoreScrollState(scrollState) {
        const listEl = this.contentEl.querySelector(".side-notes-list");
        const viewContentEl = this.getViewContentEl();
        const restore = () => {
            this.contentEl.scrollTop = scrollState.contentTop;
            if (listEl instanceof HTMLElement) {
                listEl.scrollTop = scrollState.listTop;
            }
            if (viewContentEl) {
                viewContentEl.scrollTop = scrollState.viewContentTop;
            }
            const anchorEl = scrollState.anchorNoteKey ? this.findNoteCardEl(scrollState.anchorNoteKey) : null;
            if (anchorEl) {
                restoreElementTopRelativeTo(this.contentEl, anchorEl, scrollState.contentAnchorTop);
                if (listEl instanceof HTMLElement) {
                    restoreElementTopRelativeTo(listEl, anchorEl, scrollState.listAnchorTop);
                }
                if (viewContentEl) {
                    restoreElementTopRelativeTo(viewContentEl, anchorEl, scrollState.viewContentAnchorTop);
                }
            }
        };
        restore();
        window.requestAnimationFrame(() => {
            restore();
            window.requestAnimationFrame(restore);
        });
    }
    getViewContentEl() {
        const viewContentEl = this.contentEl.closest(".view-content");
        return viewContentEl instanceof HTMLElement ? viewContentEl : null;
    }
    findNoteCardEl(noteRefKey) {
        var _a;
        const cardEls = this.contentEl.querySelectorAll(".side-notes-card");
        return (_a = Array.from(cardEls).find((cardEl) => cardEl.dataset.noteRefKey === noteRefKey)) !== null && _a !== void 0 ? _a : null;
    }
    renderHeader(parent, context, fileInfo) {
        var _a, _b;
        this.headerFileStatsEl = null;
        this.headerNoteStatsEl = null;
        const headerEl = parent.createDiv({ cls: "side-notes-header" });
        if (this.headerCollapsed) {
            headerEl.addClass("side-notes-header-collapsed");
        }
        const headerTopEl = headerEl.createDiv({ cls: "side-notes-header-top" });
        const headerPrimaryEl = headerTopEl.createDiv({ cls: "side-notes-header-primary" });
        const readingModeButtonEl = headerPrimaryEl.createEl("button", {
            cls: "side-notes-reading-toggle",
            attr: {
                "aria-label": this.readingMode ? "Exit reading mode" : "Reading mode",
                "aria-pressed": String(this.readingMode),
                title: this.readingMode ? "Exit reading mode" : "Reading mode",
                type: "button"
            }
        });
        if (this.readingMode) {
            readingModeButtonEl.addClass("side-notes-reading-toggle-active");
        }
        (0, obsidian_1.setIcon)(readingModeButtonEl, "book-open");
        readingModeButtonEl.addEventListener("click", () => {
            const enteringReadingMode = !this.readingMode;
            this.readingMode = enteringReadingMode;
            if (enteringReadingMode && !this.headerCollapsed) {
                this.headerCollapsed = true;
                this.plugin.settings.headerCollapsed = true;
                void this.plugin.saveSettings();
            }
            void this.render({ preserveScroll: true });
        });
        const headerToggleEl = headerPrimaryEl.createEl("button", {
            cls: "side-notes-header-toggle",
            attr: {
                "aria-expanded": String(!this.headerCollapsed),
                title: this.headerCollapsed ? "Show Side Notes details" : "Hide Side Notes details",
                type: "button"
            }
        });
        headerToggleEl.addEventListener("click", () => {
            this.headerCollapsed = !this.headerCollapsed;
            this.plugin.settings.headerCollapsed = this.headerCollapsed;
            void this.plugin.saveSettings();
            void this.render({ preserveScroll: true });
        });
        headerToggleEl.createSpan({ cls: "side-notes-title", text: "AAG - SideNotes" });
        headerPrimaryEl.insertBefore(headerToggleEl, readingModeButtonEl);
        const modeBadgeEl = headerTopEl.createDiv({
            cls: "side-notes-mode-badge",
            attr: {
                "aria-label": getCurrentViewModeLabel(this.viewMode),
                title: getCurrentViewModeLabel(this.viewMode)
            }
        });
        const modeIconEl = modeBadgeEl.createSpan({ cls: "side-notes-mode-icon" });
        (0, obsidian_1.setIcon)(modeIconEl, getCurrentViewModeIcon(this.viewMode));
        modeBadgeEl.createSpan({ cls: "side-notes-mode-label", text: getCurrentViewModeLabel(this.viewMode) });
        if (this.headerCollapsed) {
            return;
        }
        if (!context && !fileInfo && this.viewMode !== "orphaned" && this.viewMode !== "vault") {
            headerEl.createDiv({ cls: "side-notes-meta", text: "No paragraph selected" });
            return;
        }
        const headerDetailsEl = headerEl.createDiv({ cls: "side-notes-header-details" });
        const fileRowEl = headerDetailsEl.createDiv({ cls: "side-notes-header-detail-row" });
        fileRowEl.createDiv({
            cls: "side-notes-meta",
            text: this.viewMode === "orphaned" || this.viewMode === "vault" ? "Vault notes" : (_b = (_a = context === null || context === void 0 ? void 0 : context.fileName) !== null && _a !== void 0 ? _a : fileInfo === null || fileInfo === void 0 ? void 0 : fileInfo.name) !== null && _b !== void 0 ? _b : ""
        });
        this.headerFileStatsEl = fileRowEl.createDiv({ cls: "side-notes-count-indicator side-notes-count-line" });
        const detailRowEl = headerDetailsEl.createDiv({ cls: "side-notes-header-detail-row" });
        if (this.viewMode === "orphaned") {
            detailRowEl.createDiv({ cls: "side-notes-meta", text: "Orphaned notes" });
        }
        else if (this.viewMode === "vault") {
            detailRowEl.createDiv({ cls: "side-notes-meta", text: "All notes in all files" });
        }
        else if (context) {
            detailRowEl.createDiv({
                cls: "side-notes-meta",
                text: getBlockLabel(context, this.plugin.usesMarkdownBlockIds())
            });
        }
        else {
            detailRowEl.createDiv({ cls: "side-notes-meta", text: "All file notes" });
        }
        this.headerNoteStatsEl = detailRowEl.createDiv({ cls: "side-notes-count-indicator side-notes-count-line" });
    }
    renderViewControls(parent, notes, selectableNoteRefs = [], stats = { noteCount: selectableNoteRefs.length }) {
        const controlsEl = parent.createDiv({ cls: "side-notes-view-controls" });
        this.viewControlsEl = controlsEl;
        this.viewControlNotes = notes;
        this.viewControlSelectableNoteRefs = selectableNoteRefs;
        this.viewControlStats = stats;
        this.renderHeaderStats(selectableNoteRefs, stats);
        this.renderViewControlsContent(controlsEl, notes, selectableNoteRefs);
    }
    refreshViewControls() {
        if (!this.viewControlsEl) {
            void this.render({ preserveScroll: true });
            return;
        }
        const scrollState = this.captureScrollState();
        this.viewControlsEl.empty();
        this.renderHeaderStats(this.viewControlSelectableNoteRefs, this.viewControlStats);
        this.renderViewControlsContent(this.viewControlsEl, this.viewControlNotes, this.viewControlSelectableNoteRefs);
        this.restoreScrollState(scrollState);
    }
    renderViewControlsContent(controlsEl, notes, selectableNoteRefs = []) {
        this.renderViewModeSelect(controlsEl);
        const selectionControlsEl = controlsEl.createDiv({ cls: "side-notes-selection-controls" });
        if (this.selectedNotes.size === 0) {
            this.renderSelectionToggleButton(selectionControlsEl, selectableNoteRefs, getSelectAllTooltip(this.viewMode), getClearAllTooltip(this.viewMode));
        }
        else {
            const selectedNoteRefs = this.getSelectedNoteRefsForView(selectableNoteRefs);
            const selectedCount = selectedNoteRefs.length;
            const canMergeSelectedNotes = this.canMergeSelectedNotes(selectedNoteRefs);
            markClearSelectionButton(addIconButton(selectionControlsEl, "square-minus", `Clear ${selectedCount} selected note${selectedCount === 1 ? "" : "s"}`, () => {
                this.selectedNotes.clear();
                this.syncRenderedSelectionCheckboxes();
                this.refreshViewControls();
            }));
            markDeleteButton(addIconButton(selectionControlsEl, "trash-2", `Delete ${selectedCount} selected note${selectedCount === 1 ? "" : "s"}`, async () => {
                if (this.plugin.settings.confirmBeforeDelete) {
                    const confirmed = await confirmInObsidian(this.plugin.app, `Delete ${selectedCount} selected side note${selectedCount === 1 ? "" : "s"}?`);
                    if (!confirmed) {
                        return;
                    }
                }
                this.selectedNotes.clear();
                blurActiveElement();
                const deletedCount = await this.plugin.deleteSelectedNotes(selectedNoteRefs);
                new obsidian_1.Notice(`${deletedCount} note${deletedCount === 1 ? "" : "s"} deleted.`);
                if (deletedCount === 0) {
                    void this.render({ preserveScroll: true });
                }
            }));
            addIconButton(selectionControlsEl, "git-merge", canMergeSelectedNotes ? `Merge ${selectedCount} selected notes` : "Select at least two text notes in the same paragraph to merge", async () => {
                if (!this.canMergeSelectedNotes(selectedNoteRefs)) {
                    new obsidian_1.Notice("Select at least two text notes in the same paragraph to merge.");
                    return;
                }
                blurActiveElement();
                const mergedCount = await this.plugin.mergeSelectedNotesWithinBlock(selectedNoteRefs);
                if (mergedCount === 0) {
                    new obsidian_1.Notice("Could not merge the selected notes.");
                    void this.render({ preserveScroll: true });
                    return;
                }
                this.selectedNotes.clear();
                new obsidian_1.Notice(`${mergedCount} notes merged into one.`);
            }).setDisabled(!canMergeSelectedNotes);
            addIconButton(selectionControlsEl, "copy", `Copy ${selectedCount} selected note${selectedCount === 1 ? "" : "s"}`, async () => {
                blurActiveElement();
                await this.plugin.copySelectedNotesToClipboard(selectedNoteRefs);
            }).setDisabled(selectedCount === 0);
            addIconButton(selectionControlsEl, "scissors", `Cut ${selectedCount} selected note${selectedCount === 1 ? "" : "s"}`, () => {
                this.cutNotes = selectedNoteRefs;
                this.selectedNotes.clear();
                new obsidian_1.Notice(`${this.cutNotes.length} note${this.cutNotes.length === 1 ? "" : "s"} ready to paste.`);
                void this.render({ preserveScroll: true });
            });
        }
        if (this.viewMode === "paragraph") {
            addIconButton(controlsEl, this.composerCollapsed ? "plus" : "minus", this.composerCollapsed ? "Show new note" : "Hide new note", () => this.toggleComposer());
        }
        if (selectableNoteRefs.length > 0) {
            addIconButton(controlsEl, "file-output", "Export notes to file", async () => {
                await this.plugin.exportSelectedNotesToFile(this.getSelectedNoteRefsForView(selectableNoteRefs), this.viewMode);
            });
        }
        if (this.cutNotes.length > 0 && this.viewMode === "paragraph") {
            addIconButton(controlsEl, "clipboard-paste", `Paste ${this.cutNotes.length} cut note${this.cutNotes.length === 1 ? "" : "s"} here`, async () => {
                const movedCount = await this.plugin.moveNotesToCurrentParagraph(this.cutNotes);
                if (movedCount > 0) {
                    this.cutNotes = [];
                    this.selectedNotes.clear();
                }
                new obsidian_1.Notice(`${movedCount} note${movedCount === 1 ? "" : "s"} moved.`);
                void this.render();
            }).setCta();
        }
        if (this.cutNotes.length > 0) {
            addIconButton(controlsEl, "x", "Cancel cut notes", () => {
                this.cutNotes = [];
                void this.render();
            });
        }
        addIconButton(controlsEl, "chevrons-down", "Open all notes", () => {
            this.openNotes(this.getVisibleNoteIds(notes));
            void this.render();
        });
        addIconButton(controlsEl, "chevrons-up", "Close all notes", () => {
            this.closeNotes(this.getVisibleNoteIds(notes));
            void this.render();
        });
    }
    renderHeaderStats(selectableNoteRefs, stats) {
        var _a, _b, _c, _d;
        if (!this.headerFileStatsEl || !this.headerNoteStatsEl) {
            return;
        }
        const selectedNoteCount = this.getSelectedNoteRefsForView(selectableNoteRefs).length;
        const fileCount = (_a = stats.fileCount) !== null && _a !== void 0 ? _a : 0;
        const selectedFileCount = this.getSelectedFileCount((_b = stats.fileSelectionGroups) !== null && _b !== void 0 ? _b : []);
        const orphanedText = ((_c = stats.orphanedFileCount) !== null && _c !== void 0 ? _c : 0) > 0
            ? ` (${formatCount((_d = stats.orphanedFileCount) !== null && _d !== void 0 ? _d : 0, "orphaned file")})`
            : "";
        this.headerFileStatsEl.textContent = `Files: ${fileCount}${orphanedText} | ${selectedFileCount} selected`;
        this.headerNoteStatsEl.textContent = `Notes: ${stats.noteCount} | ${selectedNoteCount} selected`;
    }
    getSelectedFileCount(fileSelectionGroups) {
        return fileSelectionGroups.filter((noteRefs) => noteRefs.length > 0 && noteRefs.every((noteRef) => this.selectedNotes.has(this.getNoteReferenceKey(noteRef)))).length;
    }
    renderViewModeSelect(parent) {
        const selectEl = parent.createEl("select", {
            cls: "side-notes-view-mode-select",
            attr: {
                "aria-label": "Choose notes view",
                title: "Choose notes view"
            }
        });
        const modes = this.getAvailableViewModes();
        for (const mode of modes) {
            const optionEl = selectEl.createEl("option", { text: getCurrentViewModeLabel(mode) });
            optionEl.value = mode;
        }
        selectEl.value = modes.includes(this.viewMode) ? this.viewMode : "paragraph";
        selectEl.addEventListener("change", () => {
            const selectedMode = selectEl.value;
            if (selectedMode === this.viewMode || !modes.includes(selectedMode)) {
                return;
            }
            this.selectedNotes.clear();
            this.viewMode = selectedMode;
            void this.render({ preserveScroll: true });
        });
    }
    getAvailableViewModes() {
        return ["paragraph", "file", "orphaned", "vault"];
    }
    renderSelectionToggleButton(parent, noteRefs, selectTooltip, clearTooltip) {
        const selectableNoteRefs = noteRefs.filter((noteRef) => !this.isNoteCut(noteRef));
        if (selectableNoteRefs.length === 0) {
            return;
        }
        const allSelected = this.areAllNoteRefsSelected(selectableNoteRefs);
        addIconButton(parent, allSelected ? "square-minus" : "check-square", allSelected ? clearTooltip : selectTooltip, () => {
            this.toggleNoteRefsSelection(selectableNoteRefs);
            this.syncRenderedSelectionCheckboxes();
            this.refreshViewControls();
        });
    }
    areAllNoteRefsSelected(noteRefs) {
        return noteRefs.length > 0 && noteRefs.every((noteRef) => this.selectedNotes.has(this.getNoteReferenceKey(noteRef)));
    }
    toggleNoteRefsSelection(noteRefs) {
        if (this.areAllNoteRefsSelected(noteRefs)) {
            for (const noteRef of noteRefs) {
                this.selectedNotes.delete(this.getNoteReferenceKey(noteRef));
            }
            return;
        }
        for (const noteRef of noteRefs) {
            this.selectedNotes.set(this.getNoteReferenceKey(noteRef), noteRef);
        }
    }
    setNoteRefsSelection(noteRefs, selected) {
        for (const noteRef of noteRefs) {
            const noteRefKey = this.getNoteReferenceKey(noteRef);
            if (selected) {
                this.selectedNotes.set(noteRefKey, noteRef);
            }
            else {
                this.selectedNotes.delete(noteRefKey);
            }
        }
    }
    getSelectedNoteRefsForView(noteRefs) {
        return noteRefs.filter((noteRef) => this.selectedNotes.has(this.getNoteReferenceKey(noteRef)));
    }
    syncRenderedSelectionCheckboxes() {
        const checkboxEls = this.contentEl.querySelectorAll(".side-notes-note-checkbox");
        Array.from(checkboxEls).forEach((checkboxEl) => {
            const noteRefKey = checkboxEl.dataset.noteRefKey;
            if (noteRefKey) {
                checkboxEl.checked = this.selectedNotes.has(noteRefKey);
            }
        });
        const bulkCheckboxEls = this.contentEl.querySelectorAll(".side-notes-bulk-checkbox");
        Array.from(bulkCheckboxEls).forEach((checkboxEl) => {
            const noteRefKeys = getDatasetList(checkboxEl.dataset.noteRefKeys);
            const selectedCount = noteRefKeys.filter((noteRefKey) => this.selectedNotes.has(noteRefKey)).length;
            checkboxEl.checked = noteRefKeys.length > 0 && selectedCount === noteRefKeys.length;
            checkboxEl.indeterminate = selectedCount > 0 && selectedCount < noteRefKeys.length;
        });
    }
    setRenderedNoteSelection(noteRefKey, noteRef, checked, checkboxEl) {
        const scrollState = this.captureScrollState();
        this.plugin.suppressContextRefreshBriefly();
        if (checked) {
            this.selectedNotes.set(noteRefKey, noteRef);
        }
        else {
            this.selectedNotes.delete(noteRefKey);
        }
        checkboxEl.checked = checked;
        this.syncRenderedSelectionCheckboxes();
        this.refreshViewControls();
        this.restoreScrollState(scrollState);
    }
    renderSelectionCheckbox(parent, noteRefs, label) {
        const selectableNoteRefs = noteRefs.filter((noteRef) => !this.isNoteCut(noteRef));
        if (selectableNoteRefs.length === 0) {
            return;
        }
        const checkboxEl = parent.createEl("input", {
            type: "checkbox",
            cls: "side-notes-bulk-checkbox side-notes-file-checkbox",
            attr: {
                "aria-label": label,
                title: label
            }
        });
        checkboxEl.dataset.noteRefKeys = selectableNoteRefs.map((noteRef) => this.getNoteReferenceKey(noteRef)).join("\n");
        const selectedCount = selectableNoteRefs.filter((noteRef) => this.selectedNotes.has(this.getNoteReferenceKey(noteRef))).length;
        checkboxEl.checked = selectedCount === selectableNoteRefs.length;
        checkboxEl.indeterminate = selectedCount > 0 && selectedCount < selectableNoteRefs.length;
        checkboxEl.addEventListener("pointerdown", () => {
            this.plugin.suppressContextRefreshBriefly();
        });
        checkboxEl.addEventListener("click", (event) => {
            event.stopPropagation();
        });
        checkboxEl.addEventListener("change", () => {
            const scrollState = this.captureScrollState();
            this.plugin.suppressContextRefreshBriefly();
            this.setNoteRefsSelection(selectableNoteRefs, checkboxEl.checked);
            this.syncRenderedSelectionCheckboxes();
            this.refreshViewControls();
            this.restoreScrollState(scrollState);
        });
    }
    canMergeSelectedNotes(noteRefs) {
        if (noteRefs.length < 2) {
            return false;
        }
        const firstNoteRef = noteRefs[0];
        const sourceKey = this.getNoteSourceKey(firstNoteRef);
        return noteRefs.every((noteRef) => {
            var _a, _b;
            if (noteRef.blockId !== firstNoteRef.blockId || this.getNoteSourceKey(noteRef) !== sourceKey) {
                return false;
            }
            const note = (_b = (_a = this.plugin.getStoredFileNotesFromSource(noteRef.sourcePath, noteRef.sourceSideNoteId)) === null || _a === void 0 ? void 0 : _a.blocks[noteRef.blockId]) === null || _b === void 0 ? void 0 : _b.notes.find((item) => item.id === noteRef.noteId);
            return !!note && isTextNote(note);
        });
    }
    getNoteSourceKey(noteRef) {
        var _a;
        const sourceSideNoteId = (_a = noteRef.sourceSideNoteId) !== null && _a !== void 0 ? _a : this.plugin.sideNotesData.sideNoteIds[noteRef.sourcePath];
        return sourceSideNoteId ? normalizeSideNotesId(sourceSideNoteId) : noteRef.sourcePath;
    }
    async renderFileNotes(parent, fileInfo, groups = this.plugin.getNoteGroupsForCurrentFile()) {
        var _a, _b;
        if (groups.length === 0) {
            parent.createDiv({
                cls: "side-notes-empty",
                text: "No notes saved for this file yet."
            });
            return;
        }
        const listEl = parent.createDiv({ cls: "side-notes-list" });
        for (const group of groups) {
            const groupEl = listEl.createDiv({ cls: "side-notes-group" });
            const groupHeaderEl = groupEl.createDiv({ cls: "side-notes-group-header" });
            groupHeaderEl.createDiv({
                cls: "side-notes-group-title",
                text: `^${group.blockId}`
            });
            this.renderSelectionToggleButton(groupHeaderEl, this.getGroupNoteReferences([group], (_a = fileInfo === null || fileInfo === void 0 ? void 0 : fileInfo.path) !== null && _a !== void 0 ? _a : ""), "Select all notes in this paragraph", "Clear selection in this paragraph");
            if (group.fingerprint) {
                groupEl.createDiv({
                    cls: "side-notes-group-meta",
                    text: group.fingerprint
                });
            }
            for (const note of group.notes) {
                await this.renderNote(groupEl, (_b = fileInfo === null || fileInfo === void 0 ? void 0 : fileInfo.path) !== null && _b !== void 0 ? _b : "", group.blockId, note, undefined, true);
            }
        }
    }
    async renderOrphanedNotes(parent, orphanedFiles) {
        orphanedFiles = orphanedFiles !== null && orphanedFiles !== void 0 ? orphanedFiles : await this.plugin.getOrphanedFileNotes();
        const storedFileCount = Object.values(this.plugin.sideNotesData.filesBySideNoteId)
            .filter((file) => Object.values(file.blocks).some((block) => block.notes.length > 0))
            .length;
        if (orphanedFiles.length === 0) {
            parent.createDiv({
                cls: "side-notes-empty",
                text: `No orphaned notes found. Files with saved notes: ${storedFileCount}.`
            });
            return;
        }
        const listEl = parent.createDiv({ cls: "side-notes-list" });
        for (const orphanedFile of orphanedFiles) {
            const fileCardKey = getFileCardKey("orphaned", orphanedFile.SideNoteID);
            const isExpanded = this.readingMode || this.expandedFileCards.has(fileCardKey);
            const fileEl = listEl.createDiv({ cls: "side-notes-orphaned-file" });
            const fileHeaderEl = fileEl.createDiv({ cls: "side-notes-file-header" });
            addIconButton(fileHeaderEl, isExpanded ? "chevron-up" : "chevron-down", isExpanded ? "Close file notes" : "Open file notes", () => {
                this.toggleFileCard(fileCardKey);
                void this.render();
            });
            fileHeaderEl.createDiv({
                cls: "side-notes-group-title",
                text: `Missing file: ${orphanedFile.name}`
            });
            this.renderSelectionToggleButton(fileHeaderEl, this.getGroupNoteReferences(orphanedFile.groups, orphanedFile.path, orphanedFile.SideNoteID), "Select all notes in this file", "Clear selection in this file");
            markDeleteButton(addIconButton(fileHeaderEl, "trash-2", "Delete all notes for this missing file", async () => {
                const confirmed = await confirmInObsidian(this.plugin.app, `Delete all side notes for missing file "${orphanedFile.name}"?`);
                if (!confirmed) {
                    return;
                }
                await this.plugin.deleteAllNotesForSideNoteId(orphanedFile.SideNoteID);
            }));
            fileEl.createDiv({
                cls: "side-notes-group-meta",
                text: `SideNotesID: ${orphanedFile.SideNoteID}`
            });
            fileEl.createDiv({
                cls: "side-notes-group-meta",
                text: `Old path: ${orphanedFile.path}`
            });
            fileEl.createDiv({
                cls: "side-notes-group-meta",
                text: `${getFileNoteCount(orphanedFile.groups)} notes`
            });
            if (!isExpanded) {
                continue;
            }
            for (const group of orphanedFile.groups) {
                const groupEl = fileEl.createDiv({ cls: "side-notes-group" });
                const groupHeaderEl = groupEl.createDiv({ cls: "side-notes-group-header" });
                groupHeaderEl.createDiv({
                    cls: "side-notes-group-title",
                    text: `^${group.blockId}`
                });
                this.renderSelectionToggleButton(groupHeaderEl, this.getGroupNoteReferences([group], orphanedFile.path, orphanedFile.SideNoteID), "Select all notes in this paragraph", "Clear selection in this paragraph");
                if (group.fingerprint) {
                    groupEl.createDiv({
                        cls: "side-notes-group-meta",
                        text: group.fingerprint
                    });
                }
                for (const note of group.notes) {
                    await this.renderNote(groupEl, orphanedFile.path, group.blockId, note, orphanedFile.SideNoteID);
                }
            }
        }
    }
    async renderVaultNotes(parent, storedFiles = this.plugin.getAllStoredFileNotes()) {
        if (storedFiles.length === 0) {
            parent.createDiv({
                cls: "side-notes-empty",
                text: "No side notes saved in the vault yet."
            });
            return;
        }
        const listEl = parent.createDiv({ cls: "side-notes-list" });
        for (const storedFile of storedFiles) {
            const fileCardKey = getFileCardKey("vault", storedFile.SideNoteID);
            const isExpanded = this.readingMode || this.expandedFileCards.has(fileCardKey);
            const fileEl = listEl.createDiv({ cls: "side-notes-orphaned-file" });
            const fileHeaderEl = fileEl.createDiv({ cls: "side-notes-file-header" });
            addIconButton(fileHeaderEl, isExpanded ? "chevron-up" : "chevron-down", isExpanded ? "Close file notes" : "Open file notes", () => {
                this.toggleFileCard(fileCardKey);
                void this.render();
            });
            this.renderSelectionCheckbox(fileHeaderEl, this.getGroupNoteReferences(storedFile.groups, storedFile.path, storedFile.SideNoteID), "Select all notes in this file");
            fileHeaderEl.createDiv({
                cls: "side-notes-group-title",
                text: storedFile.orphaned ? `Missing file: ${storedFile.name}` : storedFile.name
            });
            if (!storedFile.orphaned) {
                addIconButton(fileHeaderEl, "folder-open", "Open file", async () => {
                    await this.plugin.openStoredFile(storedFile.path);
                });
            }
            markDeleteButton(addIconButton(fileHeaderEl, "trash-2", "Delete all notes for this file", async () => {
                const confirmed = await confirmInObsidian(this.plugin.app, `Delete all side notes for "${storedFile.name}"?`);
                if (!confirmed) {
                    return;
                }
                await this.plugin.deleteAllNotesForSideNoteId(storedFile.SideNoteID, storedFile.orphaned);
            }));
            fileEl.createDiv({
                cls: "side-notes-group-meta",
                text: `SideNotesID: ${storedFile.SideNoteID}`
            });
            fileEl.createDiv({
                cls: "side-notes-group-meta",
                text: storedFile.orphaned ? `Old path: ${storedFile.path}` : `Path: ${storedFile.path}`
            });
            fileEl.createDiv({
                cls: "side-notes-group-meta",
                text: `${getFileNoteCount(storedFile.groups)} notes`
            });
            if (!isExpanded) {
                continue;
            }
            for (const group of storedFile.groups) {
                const groupEl = fileEl.createDiv({ cls: "side-notes-group" });
                const groupHeaderEl = groupEl.createDiv({ cls: "side-notes-group-header" });
                groupHeaderEl.createDiv({
                    cls: "side-notes-group-title",
                    text: `^${group.blockId}`
                });
                this.renderSelectionToggleButton(groupHeaderEl, this.getGroupNoteReferences([group], storedFile.path, storedFile.SideNoteID), "Select all notes in this paragraph", "Clear selection in this paragraph");
                if (group.fingerprint) {
                    groupEl.createDiv({
                        cls: "side-notes-group-meta",
                        text: group.fingerprint
                    });
                }
                for (const note of group.notes) {
                    await this.renderNote(groupEl, storedFile.path, group.blockId, note, storedFile.SideNoteID);
                }
            }
        }
    }
    getVisibleNoteIds(currentParagraphNotes) {
        if (this.viewMode === "paragraph") {
            return currentParagraphNotes.map((note) => note.id);
        }
        if (this.viewMode === "orphaned") {
            return this.orphanedNoteIds;
        }
        if (this.viewMode === "vault") {
            return this.vaultNoteIds;
        }
        return this.plugin
            .getNoteGroupsForCurrentFile()
            .flatMap((group) => group.notes.map((note) => note.id));
    }
    getCurrentParagraphNoteReferences(notes) {
        const context = this.plugin.currentContext;
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return [];
        }
        return notes.map((note) => { var _a; return this.getNoteReference(context.filePath, (_a = context.blockId) !== null && _a !== void 0 ? _a : "", note); });
    }
    getGroupNoteReferences(groups, sourcePath, sourceSideNoteId) {
        return groups.flatMap((group) => group.notes.map((note) => this.getNoteReference(sourcePath, group.blockId, note, sourceSideNoteId)));
    }
    renderComposerSlot() {
        if (!this.composerSlotEl) {
            return;
        }
        this.composerSlotEl.empty();
        if (this.composerCollapsed) {
            this.composerSlotEl.addClass("side-notes-composer-slot-hidden");
            return;
        }
        this.composerSlotEl.removeClass("side-notes-composer-slot-hidden");
        this.renderComposer(this.composerSlotEl);
    }
    saveComposerDraftFromDom() {
        var _a;
        const textarea = (_a = this.composerSlotEl) === null || _a === void 0 ? void 0 : _a.querySelector(".side-notes-textarea");
        if (!textarea) {
            return;
        }
        this.draft = textarea.value;
        this.draftLastValue = textarea.value;
        this.captureDraftSelection(textarea);
    }
    renderComposer(parent) {
        const composerEl = parent.createDiv({ cls: "side-notes-composer" });
        const textarea = composerEl.createEl("textarea", {
            cls: "side-notes-textarea",
            attr: {
                placeholder: "Write a Markdown note..."
            }
        });
        applyNoteDirection(textarea, this.plugin.settings.noteDirection);
        applyNoteEditorStyles(textarea, this.plugin.settings);
        enableMarkdownListContinuation(textarea);
        textarea.value = this.draft;
        this.draftLastValue = this.draft;
        this.captureDraftSelection(textarea);
        enableTextareaAutoResize(textarea);
        if (this.shouldFocusComposer) {
            this.shouldFocusComposer = false;
            window.requestAnimationFrame(() => {
                textarea.focus();
                textarea.selectionStart = textarea.value.length;
                textarea.selectionEnd = textarea.value.length;
                this.captureDraftSelection(textarea);
            });
        }
        textarea.addEventListener("beforeinput", () => {
            this.captureDraftSelection(textarea);
        });
        textarea.addEventListener("select", () => {
            this.captureDraftSelection(textarea);
        });
        textarea.addEventListener("input", () => {
            this.recordDraftInput(textarea);
        });
        textarea.addEventListener("paste", (event) => {
            const media = getClipboardMediaFile(event);
            if (!media) {
                return;
            }
            event.preventDefault();
            void this.addPastedMediaNote(media);
        });
        textarea.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z") {
                if (this.undoDraft(textarea)) {
                    event.preventDefault();
                }
                return;
            }
            this.captureDraftSelection(textarea);
            if (event.key !== "Enter" || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
                return;
            }
            event.preventDefault();
            this.draft = textarea.value;
            void this.addDraftNote();
        });
        this.renderToolbar(composerEl, textarea);
        const composerActionsEl = composerEl.createDiv({ cls: "side-notes-composer-actions" });
        const addNoteButton = new obsidian_1.ButtonComponent(composerActionsEl)
            .setButtonText("Add note")
            .setCta()
            .onClick(() => {
            void this.addDraftNote();
        });
        addNoteButton.buttonEl.addClass("side-notes-add-note-button");
        const mediaButton = new obsidian_1.ButtonComponent(composerActionsEl)
            .setButtonText("Add media note")
            .setIcon("paperclip")
            .onClick((event) => {
            this.showMediaNoteMenu(event);
        });
        mediaButton.buttonEl.addClass("side-notes-add-media-button");
        this.renderAudioRecordingPanel(composerEl);
    }
    async addDraftNote() {
        if (this.draftSaveInProgress) {
            return;
        }
        const submittedDraft = this.draft;
        const submittedRevision = this.draftRevision;
        this.draftSaveInProgress = true;
        try {
            const noteAdded = await this.plugin.addNoteForCurrentContext(submittedDraft, false);
            if (noteAdded &&
                this.draftRevision === submittedRevision &&
                this.draft === submittedDraft) {
                this.draft = "";
                this.draftRevision++;
                this.clearDraftUndoHistory();
            }
        }
        finally {
            this.draftSaveInProgress = false;
            this.shouldFocusComposer = true;
            void this.render({ preserveScroll: true });
        }
    }
    chooseImageNoteFile() {
        const input = activeDocument.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", async () => {
            var _a;
            const file = (_a = input.files) === null || _a === void 0 ? void 0 : _a[0];
            if (!file) {
                return;
            }
            const imageAdded = await this.plugin.addImageNoteForCurrentContext(file, false);
            if (imageAdded) {
                this.shouldFocusComposer = true;
                void this.render({ preserveScroll: true });
            }
        });
        input.click();
    }
    async addPastedMediaNote(media) {
        let mediaAdded = false;
        if (media.kind === "image") {
            mediaAdded = await this.plugin.addImageNoteForCurrentContext(media.file, false);
        }
        else if (media.kind === "audio") {
            mediaAdded = await this.plugin.addAudioNoteForCurrentContext(media.file, false);
        }
        else {
            mediaAdded = await this.plugin.addVideoNoteForCurrentContext(media.file, false);
        }
        if (!mediaAdded) {
            return;
        }
        const mediaLabel = media.kind === "image" ? "Image" : media.kind === "audio" ? "Audio" : "Video";
        new obsidian_1.Notice(`${mediaLabel} note added.`);
        this.shouldFocusComposer = true;
        await this.render({ preserveScroll: true });
    }
    showMediaNoteMenu(event) {
        const menu = new obsidian_1.Menu();
        menu.addItem((item) => {
            item
                .setTitle("Image")
                .setIcon("image-plus")
                .onClick(() => this.chooseImageNoteFile());
        });
        menu.addItem((item) => {
            item
                .setTitle("Audio file")
                .setIcon("volume-2")
                .onClick(() => this.chooseAudioNoteFile());
        });
        menu.addItem((item) => {
            item
                .setTitle("Record audio")
                .setIcon("mic")
                .onClick(() => {
                void this.recordAudioNote();
            });
        });
        menu.addItem((item) => {
            item
                .setTitle("Video")
                .setIcon("video")
                .onClick(() => this.chooseVideoNoteFile());
        });
        menu.addItem((item) => {
            item
                .setTitle("File")
                .setIcon("file-plus")
                .onClick(() => this.chooseGenericNoteFile());
        });
        menu.addItem((item) => {
            item
                .setTitle("Add path")
                .setIcon("folder-open")
                .onClick(() => {
                void this.addPathNote();
            });
        });
        menu.showAtMouseEvent(event);
    }
    chooseAudioNoteFile() {
        const input = activeDocument.createElement("input");
        input.type = "file";
        input.accept = "audio/*";
        input.addEventListener("change", async () => {
            var _a;
            const file = (_a = input.files) === null || _a === void 0 ? void 0 : _a[0];
            if (!file) {
                return;
            }
            const audioAdded = await this.plugin.addAudioNoteForCurrentContext(file, false);
            if (audioAdded) {
                this.shouldFocusComposer = true;
                void this.render({ preserveScroll: true });
            }
        });
        input.click();
    }
    chooseVideoNoteFile() {
        const input = activeDocument.createElement("input");
        input.type = "file";
        input.accept = "video/*";
        input.addEventListener("change", async () => {
            var _a;
            const file = (_a = input.files) === null || _a === void 0 ? void 0 : _a[0];
            if (!file) {
                return;
            }
            const videoAdded = await this.plugin.addVideoNoteForCurrentContext(file, false);
            if (videoAdded) {
                this.shouldFocusComposer = true;
                void this.render({ preserveScroll: true });
            }
        });
        input.click();
    }
    chooseGenericNoteFile() {
        const input = activeDocument.createElement("input");
        input.type = "file";
        input.addEventListener("change", async () => {
            var _a;
            const file = (_a = input.files) === null || _a === void 0 ? void 0 : _a[0];
            if (!file) {
                return;
            }
            const fileAdded = await this.plugin.addFileNoteForCurrentContext(file, false);
            if (fileAdded) {
                this.shouldFocusComposer = true;
                void this.render({ preserveScroll: true });
            }
        });
        input.click();
    }
    async addPathNote() {
        const path = await promptTextInObsidian(this.app, "Add path", "File path, https://, anki://, obsidian://...");
        if (path === null) {
            return;
        }
        const noteAdded = looksLikeSideNoteUrl(path)
            ? await this.plugin.addUrlNoteForCurrentContext(path, false)
            : await this.plugin.addFilePathNoteForCurrentContext(path, false);
        if (noteAdded) {
            this.shouldFocusComposer = true;
            void this.render({ preserveScroll: true });
        }
    }
    async recordAudioNote() {
        const context = await this.plugin.ensureCurrentContextHasBlockId();
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            return;
        }
        this.audioRecordingContext = context;
        this.audioRecordingPanelVisible = true;
        this.composerCollapsed = false;
        if (this.viewMode !== "paragraph") {
            this.viewMode = "paragraph";
            void this.render({ preserveScroll: true });
            return;
        }
        this.renderComposerSlot();
        this.refreshViewControls();
    }
    renderAudioRecordingPanel(parent) {
        this.audioRecordingStatusEl = null;
        this.audioRecordingElapsedEl = null;
        this.audioRecordingStartButton = null;
        this.audioRecordingStopButton = null;
        this.audioRecordingCancelButton = null;
        if (!this.audioRecordingPanelVisible) {
            return;
        }
        const panelEl = parent.createDiv({ cls: "side-notes-recording-panel" });
        const headerEl = panelEl.createDiv({ cls: "side-notes-recording-header" });
        headerEl.createDiv({ cls: "side-notes-recording-title", text: "Audio recording" });
        this.audioRecordingElapsedEl = headerEl.createDiv({
            cls: "side-notes-recording-time",
            text: this.getAudioRecordingElapsedText()
        });
        this.audioRecordingStatusEl = panelEl.createDiv({
            cls: "side-notes-recording-status",
            text: this.getAudioRecordingStatusText()
        });
        const actionsEl = panelEl.createDiv({ cls: "side-notes-recording-actions" });
        this.audioRecordingStartButton = new obsidian_1.ButtonComponent(actionsEl)
            .setButtonText("Start")
            .setIcon("mic")
            .setCta()
            .onClick(() => {
            void this.startAudioRecording();
        });
        this.audioRecordingStopButton = new obsidian_1.ButtonComponent(actionsEl)
            .setButtonText("Stop and add")
            .setIcon("square")
            .onClick(() => this.stopAudioRecordingAndSave());
        this.audioRecordingCancelButton = new obsidian_1.ButtonComponent(actionsEl)
            .setButtonText("Cancel")
            .setIcon("x")
            .onClick(() => this.cancelAudioRecording());
        this.updateAudioRecordingUi();
    }
    async startAudioRecording() {
        var _a, _b;
        if (this.audioRecordingRequesting ||
            (this.audioRecordingMediaRecorder && this.audioRecordingMediaRecorder.state !== "inactive")) {
            return;
        }
        if (!((_a = this.audioRecordingContext) === null || _a === void 0 ? void 0 : _a.blockId)) {
            const context = await this.plugin.ensureCurrentContextHasBlockId();
            if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
                return;
            }
            this.audioRecordingContext = context;
        }
        if (!((_b = navigator.mediaDevices) === null || _b === void 0 ? void 0 : _b.getUserMedia)) {
            new obsidian_1.Notice("Audio recording is not available in this Obsidian window.");
            return;
        }
        const requestGeneration = ++this.audioRecordingRequestGeneration;
        this.audioRecordingRequesting = true;
        this.updateAudioRecordingUi();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const requestIsCurrent = requestGeneration === this.audioRecordingRequestGeneration &&
                this.audioRecordingPanelVisible &&
                this.contentEl.isConnected;
            if (!requestIsCurrent) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            this.stopAudioRecordingStream();
            this.audioRecordingStream = stream;
            const mimeType = getPreferredAudioRecordingMimeType();
            this.audioRecordingMediaRecorder = new MediaRecorder(this.audioRecordingStream, mimeType ? { mimeType } : undefined);
            this.audioRecordingChunks = [];
            this.audioRecordingMediaRecorder.addEventListener("dataavailable", (event) => {
                if (event.data.size > 0) {
                    this.audioRecordingChunks.push(event.data);
                }
            });
            this.audioRecordingMediaRecorder.addEventListener("stop", () => {
                this.stopAudioRecordingTimer();
                this.stopAudioRecordingStream();
                if (this.audioRecordingShouldSaveOnStop) {
                    void this.saveAudioRecording();
                }
            });
            this.audioRecordingShouldSaveOnStop = false;
            this.audioRecordingSaving = false;
            this.audioRecordingStartedAt = Date.now();
            this.audioRecordingMediaRecorder.start();
            this.startAudioRecordingTimer();
            this.plugin.focusLastMarkdownEditor();
        }
        catch (error) {
            if (requestGeneration !== this.audioRecordingRequestGeneration) {
                return;
            }
            console.error(error);
            new obsidian_1.Notice("Could not start audio recording.");
            this.stopAudioRecordingStream();
        }
        finally {
            if (requestGeneration === this.audioRecordingRequestGeneration) {
                this.audioRecordingRequesting = false;
                this.updateAudioRecordingUi();
            }
        }
    }
    stopAudioRecordingAndSave() {
        if (!this.audioRecordingMediaRecorder || this.audioRecordingMediaRecorder.state === "inactive") {
            return;
        }
        this.audioRecordingShouldSaveOnStop = true;
        this.audioRecordingSaving = true;
        this.updateAudioRecordingUi();
        this.audioRecordingMediaRecorder.stop();
    }
    cancelAudioRecording(silent = false) {
        this.audioRecordingRequestGeneration++;
        this.audioRecordingRequesting = false;
        this.audioRecordingShouldSaveOnStop = false;
        if (this.audioRecordingMediaRecorder && this.audioRecordingMediaRecorder.state !== "inactive") {
            this.audioRecordingMediaRecorder.stop();
        }
        this.resetAudioRecordingState();
        if (!silent) {
            this.renderComposerSlot();
        }
    }
    async saveAudioRecording() {
        var _a;
        if (this.audioRecordingChunks.length === 0) {
            new obsidian_1.Notice("No audio was recorded.");
            this.resetAudioRecordingState();
            this.renderComposerSlot();
            return;
        }
        const context = this.audioRecordingContext;
        if (!(context === null || context === void 0 ? void 0 : context.blockId)) {
            new obsidian_1.Notice("Could not find the paragraph for this recording.");
            this.resetAudioRecordingState();
            this.renderComposerSlot();
            return;
        }
        const type = ((_a = this.audioRecordingMediaRecorder) === null || _a === void 0 ? void 0 : _a.mimeType) || "audio/webm";
        const blob = new Blob(this.audioRecordingChunks, { type });
        const file = new File([blob], `SideNotes recording ${getSafeTimestamp()}${getAudioExtension("", type)}`, { type });
        const audioAdded = await this.plugin.addAudioNoteForContext(file, context, false);
        this.resetAudioRecordingState();
        if (audioAdded) {
            void this.render({ preserveScroll: true });
            return;
        }
        this.renderComposerSlot();
    }
    resetAudioRecordingState() {
        this.stopAudioRecordingTimer();
        this.stopAudioRecordingStream();
        this.audioRecordingRequestGeneration++;
        this.audioRecordingRequesting = false;
        this.audioRecordingPanelVisible = false;
        this.audioRecordingChunks = [];
        this.audioRecordingContext = null;
        this.audioRecordingMediaRecorder = null;
        this.audioRecordingSaving = false;
        this.audioRecordingShouldSaveOnStop = false;
        this.audioRecordingStartedAt = 0;
        this.audioRecordingStatusEl = null;
        this.audioRecordingElapsedEl = null;
        this.audioRecordingStartButton = null;
        this.audioRecordingStopButton = null;
        this.audioRecordingCancelButton = null;
    }
    startAudioRecordingTimer() {
        this.stopAudioRecordingTimer();
        this.updateAudioRecordingTimer();
        this.audioRecordingTimerId = window.setInterval(() => this.updateAudioRecordingTimer(), 250);
    }
    stopAudioRecordingTimer() {
        if (this.audioRecordingTimerId !== null) {
            window.clearInterval(this.audioRecordingTimerId);
            this.audioRecordingTimerId = null;
        }
    }
    updateAudioRecordingTimer() {
        var _a;
        (_a = this.audioRecordingElapsedEl) === null || _a === void 0 ? void 0 : _a.setText(this.getAudioRecordingElapsedText());
    }
    stopAudioRecordingStream() {
        var _a;
        (_a = this.audioRecordingStream) === null || _a === void 0 ? void 0 : _a.getTracks().forEach((track) => track.stop());
        this.audioRecordingStream = null;
    }
    updateAudioRecordingUi() {
        var _a, _b, _c, _d, _e;
        const isRecording = this.isAudioRecordingActive();
        (_a = this.audioRecordingStatusEl) === null || _a === void 0 ? void 0 : _a.setText(this.getAudioRecordingStatusText());
        (_b = this.audioRecordingElapsedEl) === null || _b === void 0 ? void 0 : _b.setText(this.getAudioRecordingElapsedText());
        (_c = this.audioRecordingStartButton) === null || _c === void 0 ? void 0 : _c.setDisabled(isRecording || this.audioRecordingSaving || this.audioRecordingRequesting);
        (_d = this.audioRecordingStopButton) === null || _d === void 0 ? void 0 : _d.setDisabled(!isRecording || this.audioRecordingSaving || this.audioRecordingRequesting);
        (_e = this.audioRecordingCancelButton) === null || _e === void 0 ? void 0 : _e.setDisabled(this.audioRecordingSaving);
    }
    isAudioRecordingActive() {
        return !!this.audioRecordingMediaRecorder && this.audioRecordingMediaRecorder.state !== "inactive";
    }
    getAudioRecordingElapsedText() {
        const elapsedSeconds = this.audioRecordingStartedAt ? (Date.now() - this.audioRecordingStartedAt) / 1000 : 0;
        return formatDuration(elapsedSeconds);
    }
    getAudioRecordingStatusText() {
        var _a;
        if (this.audioRecordingSaving) {
            return "Saving recording...";
        }
        if (this.audioRecordingRequesting) {
            return "Waiting for microphone permission...";
        }
        if (this.isAudioRecordingActive()) {
            return "Recording. You can keep working in the document.";
        }
        const fileName = (_a = this.audioRecordingContext) === null || _a === void 0 ? void 0 : _a.fileName;
        return fileName ? `Ready to record for ${fileName}.` : "Ready to record.";
    }
    captureDraftSelection(textarea) {
        this.draftSelectionStart = textarea.selectionStart;
        this.draftSelectionEnd = textarea.selectionEnd;
    }
    recordDraftInput(textarea) {
        const currentValue = textarea.value;
        if (currentValue !== this.draftLastValue) {
            this.draftUndoStack.push({
                value: this.draftLastValue,
                selectionStart: Math.min(this.draftSelectionStart, this.draftLastValue.length),
                selectionEnd: Math.min(this.draftSelectionEnd, this.draftLastValue.length)
            });
            if (this.draftUndoStack.length > DRAFT_UNDO_LIMIT) {
                this.draftUndoStack.shift();
            }
        }
        this.draft = currentValue;
        this.draftLastValue = currentValue;
        this.draftRevision++;
        this.captureDraftSelection(textarea);
    }
    undoDraft(textarea) {
        const previousState = this.draftUndoStack.pop();
        if (!previousState) {
            return false;
        }
        textarea.value = previousState.value;
        textarea.selectionStart = previousState.selectionStart;
        textarea.selectionEnd = previousState.selectionEnd;
        this.draft = previousState.value;
        this.draftLastValue = previousState.value;
        this.captureDraftSelection(textarea);
        resizeTextarea(textarea);
        return true;
    }
    clearDraftUndoHistory() {
        this.draftUndoStack = [];
        this.draftLastValue = this.draft;
        this.draftSelectionStart = 0;
        this.draftSelectionEnd = 0;
    }
    getNoteReference(sourcePath, blockId, note, sourceSideNoteId) {
        return {
            sourcePath,
            sourceSideNoteId,
            blockId,
            noteId: note.id
        };
    }
    getNoteReferenceKey(noteRef) {
        var _a;
        const sourceId = noteRef.sourceSideNoteId
            ? normalizeSideNotesId(noteRef.sourceSideNoteId)
            : (_a = this.plugin.sideNotesData.sideNoteIds[noteRef.sourcePath]) !== null && _a !== void 0 ? _a : noteRef.sourcePath;
        return `${sourceId}:${noteRef.blockId}:${noteRef.noteId}`;
    }
    isNoteCut(noteRef) {
        const noteRefKey = this.getNoteReferenceKey(noteRef);
        return this.cutNotes.some((cutNote) => this.getNoteReferenceKey(cutNote) === noteRefKey);
    }
    async renderNote(parent, sourcePath, blockId, note, sourceSideNoteId, showJumpButton = false) {
        var _a, _b, _c;
        const cardEl = parent.createDiv({ cls: "side-notes-card" });
        const noteRef = this.getNoteReference(sourcePath, blockId, note, sourceSideNoteId);
        const noteRefKey = this.getNoteReferenceKey(noteRef);
        const noteId = note.id;
        const noteText = note.text;
        cardEl.dataset.noteRefKey = noteRefKey;
        const isCut = this.isNoteCut(noteRef);
        if (isCut) {
            cardEl.addClass("side-notes-card-cut");
        }
        const selectRowEl = cardEl.createDiv({ cls: "side-notes-card-select-row" });
        const selectInputEl = selectRowEl.createEl("input", {
            type: "checkbox",
            cls: "side-notes-note-checkbox",
            attr: {
                "aria-label": "Select note",
                "data-note-ref-key": noteRefKey,
                title: "Select note"
            }
        });
        selectInputEl.checked = this.selectedNotes.has(noteRefKey);
        selectInputEl.disabled = isCut;
        selectInputEl.addEventListener("pointerdown", () => {
            this.plugin.suppressContextRefreshBriefly();
        });
        selectInputEl.addEventListener("click", (event) => {
            event.stopPropagation();
        });
        selectInputEl.addEventListener("change", () => {
            this.setRenderedNoteSelection(noteRefKey, noteRef, selectInputEl.checked, selectInputEl);
        });
        selectInputEl.addEventListener("keydown", (event) => {
            this.plugin.suppressContextRefreshBriefly();
            if (event.key === "Enter") {
                event.preventDefault();
                selectInputEl.checked = !selectInputEl.checked;
                this.setRenderedNoteSelection(noteRefKey, noteRef, selectInputEl.checked, selectInputEl);
            }
        });
        const isImage = isImageNote(note);
        const isAudio = isAudioNote(note);
        const isVideo = isVideoNote(note);
        const isFile = isFileNote(note);
        const isUrl = isUrlNote(note);
        const isTextEditable = !isImage && !isAudio && !isVideo && !isFile && !isUrl;
        const isEditing = !this.readingMode && isTextEditable && this.editingNotes.has(noteId);
        if (isEditing) {
            const textarea = cardEl.createEl("textarea", {
                cls: "side-notes-textarea side-notes-edit-textarea"
            });
            applyNoteDirection(textarea, this.plugin.settings.noteDirection);
            applyNoteEditorStyles(textarea, this.plugin.settings);
            enableMarkdownListContinuation(textarea);
            textarea.value = (_a = this.editDrafts.get(noteRefKey)) !== null && _a !== void 0 ? _a : noteText;
            setEditTextareaInitialHeight(textarea);
            if (this.editNoteToFocus === noteRefKey) {
                this.editNoteToFocus = null;
                window.requestAnimationFrame(() => {
                    textarea.focus({ preventScroll: true });
                    textarea.setSelectionRange(0, 0);
                    textarea.scrollTop = 0;
                    window.requestAnimationFrame(() => {
                        textarea.scrollTop = 0;
                        window.requestAnimationFrame(() => {
                            textarea.scrollIntoView({ block: "start", inline: "nearest" });
                            textarea.scrollTop = 0;
                        });
                    });
                });
            }
            textarea.addEventListener("input", () => {
                this.editDrafts.set(noteRefKey, textarea.value);
            });
            textarea.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" || event.isComposing || textarea.selectionEnd !== textarea.value.length) {
                    return;
                }
                window.requestAnimationFrame(() => {
                    textarea.scrollTop = textarea.scrollHeight;
                });
            });
            this.renderToolbar(cardEl, textarea);
            const actionsEl = cardEl.createDiv({ cls: "side-notes-actions" });
            const editActionsEl = actionsEl.createDiv({ cls: "side-notes-action-group" });
            addIconButton(editActionsEl, "x", "Cancel", () => {
                this.editingNotes.delete(noteId);
                this.editDrafts.delete(noteRefKey);
                void this.render({ preserveScroll: true, anchorNoteKey: noteRefKey });
            });
            addIconButton(editActionsEl, "save", "Save", async () => {
                this.editingNotes.delete(noteId);
                this.editDrafts.delete(noteRefKey);
                await this.plugin.updateNote(blockId, noteId, textarea.value.trim(), sourcePath, sourceSideNoteId, {
                    preserveScroll: true,
                    anchorNoteKey: noteRefKey
                });
            }).setCta();
            const moveActionsEl = actionsEl.createDiv({ cls: "side-notes-action-group side-notes-move-actions" });
            this.renderNoteMoveButtons(moveActionsEl, sourcePath, blockId, note, sourceSideNoteId);
        }
        else {
            const isExpanded = this.readingMode || this.isNoteExpanded(noteId);
            if (isExpanded) {
                if (isImage) {
                    this.renderImageNotePreview(cardEl, sourcePath, blockId, note, sourceSideNoteId, noteRefKey);
                }
                else if (isAudio) {
                    this.renderAudioNotePreview(cardEl, note);
                }
                else if (isVideo) {
                    this.renderVideoNotePreview(cardEl, note);
                }
                else if (isFile) {
                    this.renderFileNotePreview(cardEl, note);
                }
                else if (isUrl) {
                    this.renderUrlNotePreview(cardEl, note);
                }
                else {
                    const previewEl = cardEl.createDiv({ cls: "side-notes-preview markdown-rendered" });
                    const openFontSize = `${this.plugin.settings.noteOpenFontSizePx}px`;
                    previewEl.style.setProperty("--font-text-size", openFontSize);
                    previewEl.style.setProperty("font-size", openFontSize, "important");
                    applyNoteDirection(previewEl, this.plugin.settings.noteDirection);
                    await obsidian_1.MarkdownRenderer.render(this.plugin.app, noteText, previewEl, sourcePath, this);
                    previewEl.querySelectorAll("p, li, blockquote, table, th, td, a, span, em, strong, del, code").forEach((element) => {
                        element.style.setProperty("font-size", "inherit", "important");
                    });
                }
            }
            else {
                const summaryEl = cardEl.createDiv({
                    cls: "side-notes-summary",
                    text: getSideNoteSummaryText(note)
                });
                applyNoteDirection(summaryEl, this.plugin.settings.noteDirection);
            }
            const actionsEl = cardEl.createDiv({ cls: "side-notes-actions" });
            const noteActionsEl = actionsEl.createDiv({ cls: "side-notes-action-group" });
            addIconButton(noteActionsEl, isExpanded ? "chevron-up" : "chevron-down", isExpanded ? "Close" : "Open", () => {
                if (isExpanded) {
                    this.closeNotes([noteId]);
                }
                else {
                    this.openNotes([noteId]);
                }
                void this.render({ preserveScroll: true, anchorNoteKey: noteRefKey });
            });
            if (showJumpButton) {
                addIconButton(noteActionsEl, "locate-fixed", "Jump to paragraph", async () => {
                    await this.plugin.openFileAtBlock(sourcePath, blockId);
                });
            }
            if (isImage && isExpanded) {
                const zoom = clampImageZoom((_b = note.imageZoom) !== null && _b !== void 0 ? _b : 1);
                const rotation = normalizeImageRotation((_c = note.imageRotation) !== null && _c !== void 0 ? _c : 0);
                addIconButton(noteActionsEl, "zoom-out", "Zoom out", async () => {
                    await this.plugin.updateImageNoteZoom(blockId, noteId, zoom - 0.25, sourcePath, sourceSideNoteId, {
                        preserveScroll: true,
                        anchorNoteKey: noteRefKey
                    });
                });
                addIconButton(noteActionsEl, "zoom-in", "Zoom in", async () => {
                    await this.plugin.updateImageNoteZoom(blockId, noteId, zoom + 0.25, sourcePath, sourceSideNoteId, {
                        preserveScroll: true,
                        anchorNoteKey: noteRefKey
                    });
                });
                addIconButton(noteActionsEl, "maximize", "Reset zoom", async () => {
                    await this.plugin.updateImageNoteZoom(blockId, noteId, 1, sourcePath, sourceSideNoteId, {
                        preserveScroll: true,
                        anchorNoteKey: noteRefKey
                    });
                });
                addIconButton(noteActionsEl, "rotate-cw", "Rotate image", async () => {
                    await this.plugin.updateImageNoteRotation(blockId, noteId, rotation + 90, sourcePath, sourceSideNoteId, {
                        preserveScroll: true,
                        anchorNoteKey: noteRefKey
                    });
                });
            }
            if (isTextEditable) {
                addIconButton(noteActionsEl, "pencil", "Edit", () => {
                    this.editingNotes.add(noteId);
                    this.editNoteToFocus = noteRefKey;
                    void this.render({ preserveScroll: true, anchorNoteKey: noteRefKey });
                });
            }
            markDeleteButton(addIconButton(noteActionsEl, "trash-2", "Delete", async () => {
                if (this.plugin.settings.confirmBeforeDelete) {
                    const confirmed = await confirmInObsidian(this.plugin.app, "Delete this side note?");
                    if (!confirmed) {
                        return;
                    }
                }
                blurActiveElement();
                await this.plugin.deleteNote(blockId, noteId, sourcePath, sourceSideNoteId);
            }));
            const moveActionsEl = actionsEl.createDiv({ cls: "side-notes-action-group side-notes-move-actions" });
            this.renderNoteMoveButtons(moveActionsEl, sourcePath, blockId, note, sourceSideNoteId);
        }
        cardEl.createDiv({
            cls: "side-notes-timestamp",
            text: `Updated ${new Date(note.updatedAt).toLocaleString()}`
        });
    }
    renderImageNotePreview(parent, sourcePath, blockId, note, sourceSideNoteId, noteRefKey) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const previewEl = parent.createDiv({ cls: "side-notes-image-preview" });
        const frameEl = previewEl.createDiv({ cls: "side-notes-image-frame" });
        const zoom = clampImageZoom((_a = note.imageZoom) !== null && _a !== void 0 ? _a : 1);
        const frameHeight = typeof note.imageFrameHeightPx === "number"
            ? clampImageFrameHeight(note.imageFrameHeightPx)
            : null;
        const frameScale = getImageFrameScale(note, frameHeight, (_c = (_b = previewEl.ownerDocument.defaultView) === null || _b === void 0 ? void 0 : _b.innerHeight) !== null && _c !== void 0 ? _c : window.innerHeight);
        const rotation = normalizeImageRotation((_d = note.imageRotation) !== null && _d !== void 0 ? _d : 0);
        const panX = zoom > 1 ? clampImagePanOffset((_e = note.imagePanX) !== null && _e !== void 0 ? _e : 0) : 0;
        const panY = zoom > 1 ? clampImagePanOffset((_f = note.imagePanY) !== null && _f !== void 0 ? _f : 0) : 0;
        frameEl.setCssProps({
            "--side-notes-image-zoom": String(zoom),
            "--side-notes-image-rotation": `${rotation}deg`,
            "--side-notes-image-pan-x": `${panX}px`,
            "--side-notes-image-pan-y": `${panY}px`
        });
        if (frameHeight !== null) {
            frameEl.setCssProps({ "--side-notes-image-frame-height": `${frameHeight}px` });
        }
        const imagePath = (_g = note.imagePath) !== null && _g !== void 0 ? _g : "";
        const imageFile = this.plugin.app.vault.getAbstractFileByPath(imagePath);
        if (!(imageFile instanceof obsidian_1.TFile)) {
            frameEl.createDiv({
                cls: "side-notes-image-missing",
                text: `Image not found: ${imagePath || "unknown image"}`
            });
            return;
        }
        frameEl.createEl("img", {
            cls: "side-notes-image",
            attr: {
                alt: (_h = note.imageName) !== null && _h !== void 0 ? _h : imageFile.name,
                src: this.plugin.app.vault.getResourcePath(imageFile)
            }
        });
        previewEl.createDiv({
            cls: "side-notes-image-caption",
            text: `${(_j = note.imageName) !== null && _j !== void 0 ? _j : imageFile.name} (${Math.round(zoom * frameScale * 100)}%${rotation ? `, ${rotation} deg` : ""})`
        });
        this.enableImageFrameGestures(frameEl, sourcePath, blockId, note, sourceSideNoteId, noteRefKey);
    }
    renderAudioNotePreview(parent, note) {
        var _a, _b;
        const previewEl = parent.createDiv({ cls: "side-notes-audio-preview" });
        const audioPath = (_a = note.audioPath) !== null && _a !== void 0 ? _a : "";
        const audioFile = this.plugin.app.vault.getAbstractFileByPath(audioPath);
        if (!(audioFile instanceof obsidian_1.TFile)) {
            previewEl.createDiv({
                cls: "side-notes-audio-missing",
                text: `Audio not found: ${audioPath || "unknown audio"}`
            });
            return;
        }
        const audioEl = previewEl.createEl("audio", {
            cls: "side-notes-audio-element",
            attr: {
                preload: "metadata",
                src: this.plugin.app.vault.getResourcePath(audioFile)
            }
        });
        const controlsEl = previewEl.createDiv({ cls: "side-notes-audio-controls" });
        const playButtonEl = controlsEl.createEl("button", {
            attr: {
                "aria-label": "Play audio",
                title: "Play"
            }
        });
        (0, obsidian_1.setIcon)(playButtonEl, "play");
        const stopButtonEl = controlsEl.createEl("button", {
            attr: {
                "aria-label": "Stop audio",
                title: "Stop"
            }
        });
        (0, obsidian_1.setIcon)(stopButtonEl, "square");
        const progressEl = controlsEl.createEl("input", {
            type: "range",
            cls: "side-notes-audio-progress",
            attr: {
                "aria-label": "Audio position",
                min: "0",
                max: "0",
                step: "0.01",
                value: "0"
            }
        });
        const timeEl = controlsEl.createDiv({
            cls: "side-notes-audio-time",
            text: "0:00 / 0:00"
        });
        const updatePlayIcon = () => {
            playButtonEl.empty();
            (0, obsidian_1.setIcon)(playButtonEl, audioEl.paused ? "play" : "pause");
            playButtonEl.setAttribute("aria-label", audioEl.paused ? "Play audio" : "Pause audio");
            playButtonEl.setAttribute("title", audioEl.paused ? "Play" : "Pause");
        };
        const updateProgress = () => {
            const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
            progressEl.max = String(duration);
            if (activeDocument.activeElement !== progressEl) {
                progressEl.value = String(audioEl.currentTime || 0);
            }
            timeEl.setText(`${formatDuration(audioEl.currentTime || 0)} / ${formatDuration(duration)}`);
        };
        playButtonEl.addEventListener("click", (event) => {
            event.preventDefault();
            if (audioEl.paused) {
                void audioEl.play().catch((error) => {
                    console.error(error);
                    new obsidian_1.Notice("Could not play this audio file.");
                });
            }
            else {
                audioEl.pause();
            }
        });
        stopButtonEl.addEventListener("click", (event) => {
            event.preventDefault();
            audioEl.pause();
            audioEl.currentTime = 0;
            updatePlayIcon();
            updateProgress();
        });
        progressEl.addEventListener("input", () => {
            audioEl.currentTime = Number(progressEl.value) || 0;
            updateProgress();
        });
        audioEl.addEventListener("loadedmetadata", updateProgress);
        audioEl.addEventListener("timeupdate", updateProgress);
        audioEl.addEventListener("play", updatePlayIcon);
        audioEl.addEventListener("pause", updatePlayIcon);
        audioEl.addEventListener("ended", () => {
            audioEl.currentTime = 0;
            updatePlayIcon();
            updateProgress();
        });
        previewEl.createDiv({
            cls: "side-notes-audio-caption",
            text: (_b = note.audioName) !== null && _b !== void 0 ? _b : audioFile.name
        });
    }
    renderVideoNotePreview(parent, note) {
        var _a, _b;
        const previewEl = parent.createDiv({ cls: "side-notes-video-preview" });
        const videoPath = (_a = note.videoPath) !== null && _a !== void 0 ? _a : "";
        const videoFile = this.plugin.app.vault.getAbstractFileByPath(videoPath);
        if (!(videoFile instanceof obsidian_1.TFile)) {
            previewEl.createDiv({
                cls: "side-notes-video-missing",
                text: `Video not found: ${videoPath || "unknown video"}`
            });
            return;
        }
        previewEl.createEl("video", {
            cls: "side-notes-video",
            attr: {
                controls: "true",
                preload: "metadata",
                src: this.plugin.app.vault.getResourcePath(videoFile)
            }
        });
        previewEl.createDiv({
            cls: "side-notes-video-caption",
            text: (_b = note.videoName) !== null && _b !== void 0 ? _b : videoFile.name
        });
    }
    renderFileNotePreview(parent, note) {
        var _a;
        const previewEl = parent.createDiv({ cls: "side-notes-link-preview" });
        const title = (_a = note.fileName) !== null && _a !== void 0 ? _a : getFileNoteDisplayPath(note);
        const storedFile = isStoredFileNote(note) ? this.plugin.app.vault.getAbstractFileByPath(note.filePath) : null;
        const missingStoredFile = isStoredFileNote(note) && !(storedFile instanceof obsidian_1.TFile);
        const titleEl = previewEl.createDiv({ cls: "side-notes-link-title" });
        (0, obsidian_1.setIcon)(titleEl.createSpan({ cls: "side-notes-link-icon" }), "file");
        titleEl.createSpan({ text: title || "File" });
        previewEl.createDiv({
            cls: missingStoredFile ? "side-notes-link-missing" : "side-notes-link-target",
            text: missingStoredFile ? `File not found: ${note.filePath}` : getFileNoteDisplayPath(note)
        });
        const actionsEl = previewEl.createDiv({ cls: "side-notes-link-actions" });
        addIconButton(actionsEl, "external-link", "Open file", async () => {
            await this.plugin.openSideNoteFile(note);
        }).setDisabled(missingStoredFile);
    }
    renderUrlNotePreview(parent, note) {
        var _a, _b, _c;
        const previewEl = parent.createDiv({ cls: "side-notes-link-preview" });
        const titleEl = previewEl.createDiv({ cls: "side-notes-link-title" });
        (0, obsidian_1.setIcon)(titleEl.createSpan({ cls: "side-notes-link-icon" }), "link");
        titleEl.createSpan({ text: (_a = note.urlTitle) !== null && _a !== void 0 ? _a : getUrlDisplayName((_b = note.url) !== null && _b !== void 0 ? _b : "") });
        previewEl.createDiv({
            cls: "side-notes-link-target",
            text: (_c = note.url) !== null && _c !== void 0 ? _c : ""
        });
        const actionsEl = previewEl.createDiv({ cls: "side-notes-link-actions" });
        addIconButton(actionsEl, "external-link", "Open URL", async () => {
            await this.plugin.openSideNoteUrl(note);
        });
    }
    resizeContainingSidePanel(requestedFactor) {
        var _a, _b, _c, _d, _e;
        const panelEl = this.containerEl.closest(".workspace-split.mod-left-split, .workspace-split.mod-right-split");
        if (!panelEl) {
            return 1;
        }
        const currentWidth = panelEl.getBoundingClientRect().width;
        if (currentWidth <= 0) {
            return 1;
        }
        const parentWidth = (_d = (_b = (_a = panelEl.parentElement) === null || _a === void 0 ? void 0 : _a.getBoundingClientRect().width) !== null && _b !== void 0 ? _b : (_c = this.containerEl.ownerDocument.defaultView) === null || _c === void 0 ? void 0 : _c.innerWidth) !== null && _d !== void 0 ? _d : currentWidth;
        const minimumPanelWidth = 240;
        const maximumPanelWidth = Math.max(minimumPanelWidth, Math.min(1600, parentWidth - 320));
        const nextWidth = Math.max(minimumPanelWidth, Math.min(maximumPanelWidth, Math.round(currentWidth * requestedFactor)));
        if (Math.abs(nextWidth - currentWidth) < 1) {
            return 1;
        }
        const widthValue = `${nextWidth}px`;
        panelEl.setCssProps({
            width: widthValue,
            "flex-basis": widthValue
        });
        const panelWindow = (_e = this.containerEl.ownerDocument.defaultView) !== null && _e !== void 0 ? _e : window;
        panelWindow.requestAnimationFrame(() => {
            this.leaf.onResize();
            void this.app.workspace.requestSaveLayout();
        });
        return nextWidth / currentWidth;
    }
    enableImageFrameGestures(frameEl, sourcePath, blockId, note, sourceSideNoteId, noteRefKey) {
        var _a, _b, _c, _d, _e;
        const activePointers = new Map();
        const savedZoom = clampImageZoom((_a = note.imageZoom) !== null && _a !== void 0 ? _a : 1);
        const savedPanX = savedZoom > 1 ? clampImagePanOffset((_b = note.imagePanX) !== null && _b !== void 0 ? _b : 0) : 0;
        const savedPanY = savedZoom > 1 ? clampImagePanOffset((_c = note.imagePanY) !== null && _c !== void 0 ? _c : 0) : 0;
        const savedFrameHeight = typeof note.imageFrameHeightPx === "number"
            ? clampImageFrameHeight(note.imageFrameHeightPx)
            : null;
        const savedFrameScale = getImageFrameScale(note, savedFrameHeight, (_e = (_d = frameEl.ownerDocument.defaultView) === null || _d === void 0 ? void 0 : _d.innerHeight) !== null && _e !== void 0 ? _e : window.innerHeight);
        let pinchActive = false;
        let panActive = false;
        let startDistance = 0;
        let startZoom = savedZoom;
        let currentZoom = savedZoom;
        let currentFrameHeight = savedFrameHeight;
        let currentFrameScale = savedFrameScale;
        let currentPanX = savedPanX;
        let currentPanY = savedPanY;
        let panStartX = 0;
        let panStartY = 0;
        let pointerStartX = 0;
        let pointerStartY = 0;
        let touchTapStart = null;
        let lastTouchTapAt = 0;
        let lastTouchTapX = 0;
        let lastTouchTapY = 0;
        let wheelFrameSizeChanged = false;
        let wheelSaveTimerId = null;
        const getDistance = () => {
            const pointers = Array.from(activePointers.values());
            if (pointers.length < 2) {
                return 0;
            }
            return Math.hypot(pointers[0].clientX - pointers[1].clientX, pointers[0].clientY - pointers[1].clientY);
        };
        const setPreviewZoom = (zoom) => {
            currentZoom = clampImageZoom(zoom);
            if (currentZoom <= 1) {
                currentPanX = 0;
                currentPanY = 0;
            }
            frameEl.setCssProps({
                "--side-notes-image-zoom": String(currentZoom),
                "--side-notes-image-pan-x": `${currentPanX}px`,
                "--side-notes-image-pan-y": `${currentPanY}px`
            });
        };
        const setPreviewPan = (panX, panY) => {
            if (currentZoom <= 1) {
                currentPanX = 0;
                currentPanY = 0;
            }
            else {
                currentPanX = clampImagePanOffset(panX);
                currentPanY = clampImagePanOffset(panY);
            }
            frameEl.setCssProps({
                "--side-notes-image-pan-x": `${currentPanX}px`,
                "--side-notes-image-pan-y": `${currentPanY}px`
            });
        };
        const setPreviewFrameHeight = (height) => {
            currentFrameHeight = clampImageFrameHeight(height);
            frameEl.setCssProps({ "--side-notes-image-frame-height": `${currentFrameHeight}px` });
        };
        const scheduleWheelSave = (frameSizeChanged) => {
            wheelFrameSizeChanged = wheelFrameSizeChanged || frameSizeChanged;
            if (wheelSaveTimerId !== null) {
                window.clearTimeout(wheelSaveTimerId);
            }
            wheelSaveTimerId = window.setTimeout(() => {
                wheelSaveTimerId = null;
                const frameHeightToSave = wheelFrameSizeChanged ? currentFrameHeight !== null && currentFrameHeight !== void 0 ? currentFrameHeight : undefined : undefined;
                const frameScaleToSave = wheelFrameSizeChanged ? currentFrameScale : undefined;
                wheelFrameSizeChanged = false;
                void this.plugin.updateImageNoteViewport(blockId, note.id, currentZoom, frameHeightToSave, frameScaleToSave, sourcePath, sourceSideNoteId, {
                    preserveScroll: true,
                    anchorNoteKey: noteRefKey
                });
            }, 180);
        };
        const resetImageView = () => {
            const hasExternalZoom = Math.abs(currentFrameScale - 1) >= 0.01;
            if (currentZoom === 1 && currentPanX === 0 && currentPanY === 0 && !hasExternalZoom) {
                return;
            }
            if (wheelSaveTimerId !== null) {
                window.clearTimeout(wheelSaveTimerId);
                wheelSaveTimerId = null;
            }
            wheelFrameSizeChanged = false;
            if (hasExternalZoom) {
                const frameHeight = currentFrameHeight !== null && currentFrameHeight !== void 0 ? currentFrameHeight : clampImageFrameHeight(frameEl.getBoundingClientRect().height);
                const appliedFactor = this.resizeContainingSidePanel(1 / currentFrameScale);
                setPreviewFrameHeight(frameHeight * appliedFactor);
                currentFrameScale = clampImageFrameScale(currentFrameScale * appliedFactor);
                if (Math.abs(currentFrameScale - 1) < 0.01) {
                    currentFrameScale = 1;
                }
            }
            setPreviewZoom(1);
            if (hasExternalZoom) {
                void this.plugin.updateImageNoteViewport(blockId, note.id, 1, currentFrameHeight !== null && currentFrameHeight !== void 0 ? currentFrameHeight : undefined, currentFrameScale, sourcePath, sourceSideNoteId, {
                    preserveScroll: true,
                    anchorNoteKey: noteRefKey
                });
            }
            else {
                void this.plugin.updateImageNoteZoom(blockId, note.id, 1, sourcePath, sourceSideNoteId, {
                    preserveScroll: true,
                    anchorNoteKey: noteRefKey
                });
            }
        };
        const finishPinch = () => {
            if (!pinchActive || activePointers.size >= 2) {
                return;
            }
            pinchActive = false;
            if (Math.abs(currentZoom - savedZoom) < 0.01 && Math.abs(currentPanX - savedPanX) < 1 && Math.abs(currentPanY - savedPanY) < 1) {
                return;
            }
            void this.plugin.updateImageNoteZoom(blockId, note.id, currentZoom, sourcePath, sourceSideNoteId, {
                preserveScroll: true,
                anchorNoteKey: noteRefKey
            });
        };
        const finishPan = () => {
            if (!panActive || activePointers.size > 0) {
                return;
            }
            panActive = false;
            if (Math.abs(currentPanX - savedPanX) < 1 && Math.abs(currentPanY - savedPanY) < 1) {
                return;
            }
            void this.plugin.updateImageNotePan(blockId, note.id, currentPanX, currentPanY, sourcePath, sourceSideNoteId, {
                preserveScroll: true,
                anchorNoteKey: noteRefKey
            });
        };
        frameEl.addEventListener("wheel", (event) => {
            if (!event.ctrlKey && !event.shiftKey) {
                return;
            }
            const wheelDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
            if (wheelDelta === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const direction = wheelDelta < 0 ? 1 : -1;
            if (event.shiftKey) {
                const frameHeight = currentFrameHeight !== null && currentFrameHeight !== void 0 ? currentFrameHeight : clampImageFrameHeight(frameEl.getBoundingClientRect().height);
                const requestedFactor = direction > 0 ? 1.12 : 1 / 1.12;
                const heightLimitFactor = clampImageFrameHeight(frameHeight * requestedFactor) / frameHeight;
                const requestedPanelFactor = direction > 0
                    ? Math.min(requestedFactor, heightLimitFactor)
                    : Math.max(requestedFactor, heightLimitFactor);
                const appliedFactor = this.resizeContainingSidePanel(requestedPanelFactor);
                if (Math.abs(appliedFactor - 1) < 0.001) {
                    return;
                }
                currentFrameScale = clampImageFrameScale(currentFrameScale * appliedFactor);
                setPreviewFrameHeight(frameHeight * appliedFactor);
                scheduleWheelSave(true);
                return;
            }
            setPreviewZoom(currentZoom + direction * 0.15);
            scheduleWheelSave(false);
        }, { passive: false });
        frameEl.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "mouse" && event.button !== 0) {
                return;
            }
            activePointers.set(event.pointerId, event);
            frameEl.setPointerCapture(event.pointerId);
            if (event.pointerType === "touch") {
                touchTapStart = activePointers.size === 1
                    ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startedAt: Date.now() }
                    : null;
                if (activePointers.size > 1) {
                    lastTouchTapAt = 0;
                }
            }
            if (activePointers.size === 2) {
                panActive = false;
                pinchActive = true;
                startDistance = getDistance();
                startZoom = currentZoom;
                return;
            }
            if (activePointers.size === 1 && currentZoom > 1) {
                panActive = true;
                panStartX = currentPanX;
                panStartY = currentPanY;
                pointerStartX = event.clientX;
                pointerStartY = event.clientY;
            }
        });
        frameEl.addEventListener("pointermove", (event) => {
            if (!activePointers.has(event.pointerId)) {
                return;
            }
            activePointers.set(event.pointerId, event);
            if ((touchTapStart === null || touchTapStart === void 0 ? void 0 : touchTapStart.pointerId) === event.pointerId &&
                Math.hypot(event.clientX - touchTapStart.x, event.clientY - touchTapStart.y) > 12) {
                touchTapStart = null;
                lastTouchTapAt = 0;
            }
            if (!pinchActive && !panActive) {
                return;
            }
            event.preventDefault();
            if (pinchActive && activePointers.size >= 2 && startDistance > 0) {
                setPreviewZoom(startZoom * (getDistance() / startDistance));
                return;
            }
            if (panActive && activePointers.size === 1) {
                setPreviewPan(panStartX + event.clientX - pointerStartX, panStartY + event.clientY - pointerStartY);
            }
        });
        const isTouchDoubleTap = (event) => {
            if (event.pointerType !== "touch" || (touchTapStart === null || touchTapStart === void 0 ? void 0 : touchTapStart.pointerId) !== event.pointerId) {
                return false;
            }
            const tap = touchTapStart;
            touchTapStart = null;
            const now = Date.now();
            if (now - tap.startedAt > 400) {
                lastTouchTapAt = 0;
                return false;
            }
            const isDoubleTap = lastTouchTapAt > 0 &&
                now - lastTouchTapAt <= 450 &&
                Math.hypot(event.clientX - lastTouchTapX, event.clientY - lastTouchTapY) <= 36;
            if (isDoubleTap) {
                lastTouchTapAt = 0;
                return true;
            }
            lastTouchTapAt = now;
            lastTouchTapX = event.clientX;
            lastTouchTapY = event.clientY;
            return false;
        };
        const endPointer = (event) => {
            const shouldResetImage = isTouchDoubleTap(event);
            activePointers.delete(event.pointerId);
            if (shouldResetImage) {
                event.preventDefault();
                pinchActive = false;
                panActive = false;
                resetImageView();
                return;
            }
            finishPinch();
            finishPan();
        };
        frameEl.addEventListener("dblclick", (event) => {
            event.preventDefault();
            resetImageView();
        });
        frameEl.addEventListener("pointerup", endPointer);
        frameEl.addEventListener("pointercancel", endPointer);
        frameEl.addEventListener("lostpointercapture", endPointer);
    }
    renderNoteMoveButtons(parent, sourcePath, blockId, note, sourceSideNoteId) {
        var _a, _b, _c;
        const siblingNotes = (_c = (_b = (_a = this.plugin.getStoredFileNotesFromSource(sourcePath, sourceSideNoteId)) === null || _a === void 0 ? void 0 : _a.blocks[blockId]) === null || _b === void 0 ? void 0 : _b.notes) !== null && _c !== void 0 ? _c : [];
        const noteIndex = siblingNotes.findIndex((item) => item.id === note.id);
        addIconButton(parent, "arrow-up", "Move note up", async () => {
            await this.plugin.moveNoteWithinBlock(blockId, note.id, -1, sourcePath, sourceSideNoteId);
        }).setDisabled(noteIndex <= 0);
        addIconButton(parent, "arrow-down", "Move note down", async () => {
            await this.plugin.moveNoteWithinBlock(blockId, note.id, 1, sourcePath, sourceSideNoteId);
        }).setDisabled(noteIndex === -1 || noteIndex >= siblingNotes.length - 1);
    }
    renderToolbar(parent, textarea) {
        const toolbarEl = parent.createDiv({ cls: "side-notes-toolbar" });
        addToolbarButton(toolbarEl, "Bullet list", "-", () => {
            applyBulletList(textarea);
        });
        addToolbarButton(toolbarEl, "Numbered list", "1.", () => {
            applyNumberedList(textarea);
        });
        addToolbarButton(toolbarEl, "Checkbox", "[ ]", () => {
            applyTaskList(textarea);
        });
        addToolbarButton(toolbarEl, "Indent", ">>", () => {
            indentSelectedLines(textarea);
        });
        addToolbarButton(toolbarEl, "Outdent", "<<", () => {
            outdentSelectedLines(textarea);
        });
        addToolbarButton(toolbarEl, "Bold", "B", () => {
            wrapSelection(textarea, "**", "**");
        });
        addToolbarButton(toolbarEl, "Italic", "I", () => {
            wrapSelection(textarea, "*", "*");
        });
        addToolbarButton(toolbarEl, "Inline code", "`", () => {
            wrapSelection(textarea, "`", "`");
        });
        addToolbarButton(toolbarEl, "Obsidian link", "[[", () => {
            wrapSelection(textarea, "[[", "]]");
        });
    }
    isNoteExpanded(noteId) {
        if (this.plugin.settings.defaultNotesExpanded) {
            return !this.collapsedNotes.has(noteId);
        }
        return this.expandedNotes.has(noteId);
    }
    openNotes(noteIds) {
        for (const noteId of noteIds) {
            this.expandedNotes.add(noteId);
            this.collapsedNotes.delete(noteId);
        }
    }
    closeNotes(noteIds) {
        for (const noteId of noteIds) {
            this.expandedNotes.delete(noteId);
            this.collapsedNotes.add(noteId);
        }
    }
    toggleFileCard(fileCardKey) {
        if (this.expandedFileCards.has(fileCardKey)) {
            this.expandedFileCards.delete(fileCardKey);
            return;
        }
        this.expandedFileCards.add(fileCardKey);
    }
}
class ConfirmModal extends obsidian_1.Modal {
    constructor(app, message, resolve) {
        super(app);
        this.resolved = false;
        this.message = message;
        this.resolve = resolve;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        new obsidian_1.Setting(contentEl)
            .setName("Confirm delete")
            .setHeading();
        contentEl.createEl("p", { text: this.message });
        const actionsEl = contentEl.createDiv({ cls: "side-notes-modal-actions" });
        new obsidian_1.ButtonComponent(actionsEl)
            .setButtonText("Cancel")
            .onClick(() => this.finish(false));
        markDeleteButton(new obsidian_1.ButtonComponent(actionsEl)
            .setButtonText("Delete"))
            .onClick(() => this.finish(true));
    }
    onClose() {
        if (!this.resolved) {
            this.finish(false);
        }
    }
    finish(confirmed) {
        if (this.resolved) {
            return;
        }
        this.resolved = true;
        this.resolve(confirmed);
        this.close();
    }
}
function confirmInObsidian(app, message) {
    return new Promise((resolve) => {
        new ConfirmModal(app, message, resolve).open();
    });
}
class TextPromptModal extends obsidian_1.Modal {
    constructor(app, title, placeholder, resolve) {
        super(app);
        this.resolved = false;
        this.title = title;
        this.placeholder = placeholder;
        this.resolve = resolve;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        new obsidian_1.Setting(contentEl)
            .setName(this.title)
            .setHeading();
        const inputEl = contentEl.createEl("input", {
            cls: "side-notes-prompt-input",
            attr: {
                placeholder: this.placeholder,
                type: "text"
            }
        });
        const actionsEl = contentEl.createDiv({ cls: "side-notes-modal-actions" });
        new obsidian_1.ButtonComponent(actionsEl)
            .setButtonText("Cancel")
            .onClick(() => this.finish(null));
        new obsidian_1.ButtonComponent(actionsEl)
            .setButtonText("Add")
            .setCta()
            .onClick(() => this.finish(inputEl.value));
        inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                this.finish(inputEl.value);
            }
            if (event.key === "Escape") {
                event.preventDefault();
                this.finish(null);
            }
        });
        window.requestAnimationFrame(() => inputEl.focus());
    }
    onClose() {
        if (!this.resolved) {
            this.finish(null);
        }
    }
    finish(value) {
        if (this.resolved) {
            return;
        }
        this.resolved = true;
        this.resolve(value);
        this.close();
    }
}
function promptTextInObsidian(app, title, placeholder) {
    return new Promise((resolve) => {
        new TextPromptModal(app, title, placeholder, resolve).open();
    });
}
class SideNotesSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        new obsidian_1.Setting(containerEl)
            .setName("AAG - Side Notes")
            .setHeading();
        new obsidian_1.Setting(containerEl)
            .setName("Paragraph anchor storage")
            .setDesc("Choose whether paragraph anchors stay internal to the plugin data or are written as Obsidian Block IDs in Markdown.")
            .addDropdown((dropdown) => {
            dropdown
                .addOption("internal", "Internal anchors")
                .addOption("block-id", "Markdown Block IDs")
                .setValue(this.plugin.settings.anchorStorage)
                .onChange(async (value) => {
                this.plugin.settings.anchorStorage = value;
                await this.plugin.saveSettings();
                new obsidian_1.Notice("Reload Obsidian to apply paragraph anchor storage.");
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Automatically add block IDs")
            .setDesc("Only applies when paragraph anchor storage is set to Markdown Block IDs.")
            .addToggle((toggle) => {
            toggle
                .setValue(this.plugin.settings.autoInsertBlockIds)
                .onChange(async (value) => {
                this.plugin.settings.autoInsertBlockIds = value;
                await this.plugin.saveSettings();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Block ID prefix")
            .setDesc("Used for internal anchors and for Markdown Block IDs when that storage mode is enabled.")
            .addText((text) => {
            text
                .setPlaceholder("side-note")
                .setValue(this.plugin.settings.blockIdPrefix)
                .onChange(async (value) => {
                this.plugin.settings.blockIdPrefix = sanitizeBlockPrefix(value);
                await this.plugin.saveSettings();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Hide plugin block IDs in editor")
            .setDesc("Hides generated side-note Block IDs in the editor. In internal-anchor mode this only hides old Block IDs already present in the Markdown.")
            .addToggle((toggle) => {
            toggle
                .setValue(this.plugin.settings.hidePluginBlockIds)
                .onChange(async (value) => {
                this.plugin.settings.hidePluginBlockIds = value;
                await this.plugin.saveSettings();
                new obsidian_1.Notice("Reload Obsidian to apply block ID hiding.");
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Confirm before deleting notes")
            .setDesc("Ask for confirmation before deleting a side note.")
            .addToggle((toggle) => {
            toggle
                .setValue(this.plugin.settings.confirmBeforeDelete)
                .onChange(async (value) => {
                this.plugin.settings.confirmBeforeDelete = value;
                await this.plugin.saveSettings();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Open notes by default")
            .setDesc("When enabled, notes are shown open by default. When disabled, notes are shown collapsed by default.")
            .addToggle((toggle) => {
            toggle
                .setValue(this.plugin.settings.defaultNotesExpanded)
                .onChange(async (value) => {
                this.plugin.settings.defaultNotesExpanded = value;
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Blank line between exported notes")
            .setDesc("When exporting, add an empty line between notes that belong to the same paragraph or BlockID.")
            .addToggle((toggle) => {
            toggle
                .setValue(this.plugin.settings.exportBlankLineBetweenNotes)
                .onChange(async (value) => {
                this.plugin.settings.exportBlankLineBetweenNotes = value;
                await this.plugin.saveSettings();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Store SideNotesID in file properties")
            .setDesc("Adds a SideNotesID property to Markdown files and restores it if it is removed or changed.")
            .addToggle((toggle) => {
            toggle
                .setValue(this.plugin.settings.storeSideNoteIDInProperties)
                .onChange(async (value) => {
                this.plugin.settings.storeSideNoteIDInProperties = value;
                await this.plugin.saveSettings();
                const file = this.app.workspace.getActiveFile();
                if (value && file) {
                    const storedFile = this.plugin.ensureStoredFileNotes(file);
                    await this.plugin.ensureSideNoteIDProperty(file, storedFile.SideNoteID);
                    await this.plugin.savePluginState();
                }
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Import .sidenotes file")
            .setDesc("Import Markdown files, SideNotes, and bundled media from a .sidenotes transfer file.")
            .addButton((button) => {
            button
                .setButtonText("Import")
                .setCta()
                .onClick(() => {
                void this.plugin.importSideNotesBundleFromDisk();
            });
        });
        const fullExportFiles = this.plugin.getAllStoredFileNotes();
        const fullExportFileCount = fullExportFiles.filter((file) => !file.orphaned || this.plugin.settings.includeOrphanedInFullExport).length;
        const fullExportNoteCount = fullExportFiles
            .filter((file) => !file.orphaned || this.plugin.settings.includeOrphanedInFullExport)
            .reduce((count, file) => count + getFileNoteCount(file.groups), 0);
        const orphanedExportFileCount = fullExportFiles.filter((file) => file.orphaned).length;
        const orphanedExportNoteCount = fullExportFiles
            .filter((file) => file.orphaned)
            .reduce((count, file) => count + getFileNoteCount(file.groups), 0);
        new obsidian_1.Setting(containerEl)
            .setName("Export all files with SideNotes")
            .setDesc(`Create a .sidenotes transfer file for ${formatCount(fullExportFileCount, "file")} with ${formatCount(fullExportNoteCount, "note")}, including SideNotes images, audio, and video.`)
            .addButton((button) => {
            button
                .setButtonText("Export all")
                .setCta()
                .onClick(() => {
                void this.plugin.exportAllSideNotesBundle(this.plugin.settings.includeOrphanedInFullExport);
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Export full backup")
            .setDesc("Create a complete .sidenotes backup with all notes, orphaned notes, and media from _SideNotes.")
            .addButton((button) => {
            button
                .setButtonText("Export backup")
                .setCta()
                .onClick(() => {
                void this.plugin.exportAllSideNotesBundle(true);
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Include orphaned notes in full export")
            .setDesc(`Used by Export all. Currently found ${formatCount(orphanedExportFileCount, "orphaned file")} with ${formatCount(orphanedExportNoteCount, "note")}.`)
            .addToggle((toggle) => {
            toggle
                .setValue(this.plugin.settings.includeOrphanedInFullExport)
                .onChange(async (value) => {
                this.plugin.settings.includeOrphanedInFullExport = value;
                await this.plugin.saveSettings();
                this.update();
            });
        });
        let noteFontDropdown = null;
        new obsidian_1.Setting(containerEl)
            .setName("Note font")
            .setDesc("Choose the font family for note editing and note previews. Use refresh if the installed font list does not load automatically.")
            .addDropdown((dropdown) => {
            noteFontDropdown = dropdown;
            this.populateNoteFontDropdown(dropdown, []);
            dropdown.onChange(async (value) => {
                this.plugin.settings.noteFontFamily = value;
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            });
            void this.loadInstalledFontsIntoDropdown(dropdown);
        })
            .addButton((button) => {
            button
                .setIcon("refresh-cw")
                .setTooltip("Load installed fonts")
                .onClick(() => {
                if (noteFontDropdown) {
                    void this.loadInstalledFontsIntoDropdown(noteFontDropdown, true);
                }
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Editor font size")
            .setDesc("Controls the text size for the new-note editor and note editing.")
            .addSlider((slider) => {
            slider
                .setLimits(12, 56, 1)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.noteEditorFontSizePx)
                .onChange(async (value) => {
                this.plugin.settings.noteEditorFontSizePx = value;
                this.plugin.settings.noteFontSizePx = value;
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Preview font size")
            .setDesc("Controls the text size for collapsed note previews.")
            .addSlider((slider) => {
            slider
                .setLimits(12, 56, 1)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.notePreviewFontSizePx)
                .onChange(async (value) => {
                this.plugin.settings.notePreviewFontSizePx = value;
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Open note font size")
            .setDesc("Controls the text size of side notes while they are open.")
            .addSlider((slider) => {
            slider
                .setLimits(12, 56, 1)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.noteOpenFontSizePx)
                .onChange(async (value) => {
                this.plugin.settings.noteOpenFontSizePx = value;
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Top area font size")
            .setDesc("Controls the text size for the upper file/context details and note counters.")
            .addSlider((slider) => {
            slider
                .setLimits(10, 28, 1)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.headerFontSizePx)
                .onChange(async (value) => {
                this.plugin.settings.headerFontSizePx = value;
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Button size")
            .setDesc("Controls the size of sidebar icon buttons.")
            .addSlider((slider) => {
            slider
                .setLimits(22, 56, 1)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.buttonSizePx)
                .onChange(async (value) => {
                this.plugin.settings.buttonSizePx = value;
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Note text direction")
            .setDesc("Choose the writing direction for notes in the sidebar.")
            .addDropdown((dropdown) => {
            dropdown
                .addOption("auto", "Auto")
                .addOption("rtl", "Right to left")
                .addOption("ltr", "Left to right")
                .setValue(this.plugin.settings.noteDirection)
                .onChange(async (value) => {
                this.plugin.settings.noteDirection = value;
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Update on selection changes")
            .setDesc("Refresh the sidebar as the editor selection changes.")
            .addToggle((toggle) => {
            toggle
                .setValue(this.plugin.settings.updateOnSelectionChange)
                .onChange(async (value) => {
                this.plugin.settings.updateOnSelectionChange = value;
                await this.plugin.saveSettings();
                new obsidian_1.Notice("Reload Obsidian to apply this listener setting.");
            });
        });
        new obsidian_1.Setting(containerEl)
            .setName("Update debounce")
            .setDesc("Delay before refreshing the sidebar, in milliseconds.")
            .addText((text) => {
            text
                .setPlaceholder("150")
                .setValue(String(this.plugin.settings.updateDebounceMs))
                .onChange(async (value) => {
                const parsed = Number.parseInt(value, 10);
                if (!Number.isNaN(parsed) && parsed >= 0) {
                    this.plugin.settings.updateDebounceMs = parsed;
                    await this.plugin.saveSettings();
                }
            });
        });
    }
    populateNoteFontDropdown(dropdown, installedFontFamilies) {
        const currentFontFamily = this.plugin.settings.noteFontFamily.trim();
        const fontFamilies = getUniqueFontFamilies([
            currentFontFamily,
            ...installedFontFamilies,
            ...FALLBACK_NOTE_FONT_FAMILIES
        ]);
        dropdown.selectEl.textContent = "";
        dropdown.addOption("", DEFAULT_NOTE_FONT_LABEL);
        for (const fontFamily of fontFamilies) {
            dropdown.addOption(fontFamily, fontFamily);
        }
        dropdown.setValue(this.plugin.settings.noteFontFamily);
    }
    async loadInstalledFontsIntoDropdown(dropdown, showNotice = false) {
        const installedFontFamilies = await getInstalledFontFamilies();
        if (installedFontFamilies.length === 0) {
            if (showNotice) {
                new obsidian_1.Notice("Installed fonts could not be loaded. Showing fallback fonts.");
            }
            return;
        }
        this.populateNoteFontDropdown(dropdown, installedFontFamilies);
        if (showNotice) {
            new obsidian_1.Notice(`${installedFontFamilies.length} installed font families loaded.`);
        }
    }
}
function findParagraphRange(editor, cursorLine, pluginBlockPrefix) {
    const lineCount = editor.lineCount();
    if (cursorLine < 0 || cursorLine >= lineCount) {
        return null;
    }
    const currentLine = editor.getLine(cursorLine);
    if (currentLine.trim().length === 0 || isFenceLine(currentLine)) {
        return null;
    }
    let fromLine = cursorLine;
    while (fromLine > 0) {
        const previousLine = editor.getLine(fromLine - 1);
        if (previousLine.trim().length === 0 || isFenceLine(previousLine) || lineEndsWithBlockId(previousLine, pluginBlockPrefix)) {
            break;
        }
        fromLine--;
    }
    let toLine = cursorLine;
    while (toLine < lineCount - 1) {
        const currentRangeLine = editor.getLine(toLine);
        if (lineEndsWithBlockId(currentRangeLine, pluginBlockPrefix)) {
            break;
        }
        const nextLine = editor.getLine(toLine + 1);
        if (nextLine.trim().length === 0 || isFenceLine(nextLine)) {
            break;
        }
        toLine++;
    }
    return { fromLine, toLine };
}
function findPreviousParagraphRangeFromBlankLine(editor, cursorLine, pluginBlockPrefix) {
    if (cursorLine <= 0 || cursorLine >= editor.lineCount()) {
        return null;
    }
    const currentLine = editor.getLine(cursorLine);
    if (currentLine.trim().length > 0 || isFenceLine(currentLine)) {
        return null;
    }
    const previousLine = editor.getLine(cursorLine - 1);
    if (previousLine.trim().length === 0 || isFenceLine(previousLine)) {
        return null;
    }
    return findParagraphRange(editor, cursorLine - 1, pluginBlockPrefix);
}
function lineEndsWithBlockId(line, pluginBlockPrefix) {
    return getBlockId(line, pluginBlockPrefix) !== null;
}
function findParagraphStartLine(lines, blockLine, pluginBlockPrefix) {
    let fromLine = blockLine;
    while (fromLine > 0) {
        const previousLine = lines[fromLine - 1];
        if (previousLine.trim().length === 0 || isFenceLine(previousLine) || lineEndsWithBlockId(previousLine, pluginBlockPrefix)) {
            break;
        }
        fromLine--;
    }
    return fromLine;
}
function findParagraphStartLineByFingerprint(lines, fingerprint, pluginBlockPrefix) {
    if (!fingerprint) {
        return null;
    }
    for (let line = 0; line < lines.length; line++) {
        const currentLine = lines[line];
        if (currentLine.trim().length === 0 || isFenceLine(currentLine)) {
            continue;
        }
        let toLine = line;
        while (toLine < lines.length - 1) {
            if (lineEndsWithBlockId(lines[toLine], pluginBlockPrefix)) {
                break;
            }
            const nextLine = lines[toLine + 1];
            if (nextLine.trim().length === 0 || isFenceLine(nextLine)) {
                break;
            }
            toLine++;
        }
        const paragraphText = lines.slice(line, toLine + 1).join("\n");
        if (getParagraphFingerprint(paragraphText, pluginBlockPrefix) === fingerprint) {
            return line;
        }
        line = toLine;
    }
    return null;
}
function getLineRangeMatchScore(blockNotes, range) {
    if (blockNotes.fromLine === undefined || blockNotes.toLine === undefined) {
        return 0;
    }
    const overlapFrom = Math.max(blockNotes.fromLine, range.fromLine);
    const overlapTo = Math.min(blockNotes.toLine, range.toLine);
    if (overlapFrom > overlapTo) {
        return 0;
    }
    const overlapLines = overlapTo - overlapFrom + 1;
    const currentContainsStored = range.fromLine <= blockNotes.fromLine && range.toLine >= blockNotes.toLine;
    const storedContainsCurrent = blockNotes.fromLine <= range.fromLine && blockNotes.toLine >= range.toLine;
    const startDistance = Math.abs(blockNotes.fromLine - range.fromLine);
    const endDistance = Math.abs(blockNotes.toLine - range.toLine);
    const containmentBonus = currentContainsStored || storedContainsCurrent ? 100 : 0;
    return containmentBonus + overlapLines * 10 - startDistance - endDistance;
}
function getBlockId(text, pluginBlockPrefix) {
    const match = text.match(BLOCK_ID_PATTERN);
    if (match === null || match === void 0 ? void 0 : match[1]) {
        return match[1];
    }
    return getGeneratedPluginBlockId(text, pluginBlockPrefix);
}
function getParagraphFingerprint(text, pluginBlockPrefix) {
    return stripBlockId(text, pluginBlockPrefix)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .slice(0, 500);
}
function stripBlockId(text, pluginBlockPrefix) {
    const stripped = text.replace(BLOCK_ID_PATTERN, "").trim();
    if (stripped !== text.trim()) {
        return stripped;
    }
    const generatedPattern = getGeneratedPluginBlockTailPattern(pluginBlockPrefix);
    return generatedPattern ? text.replace(generatedPattern, "").trim() : stripped;
}
function getGeneratedPluginBlockId(text, pluginBlockPrefix) {
    var _a;
    const pattern = getGeneratedPluginBlockTailPattern(pluginBlockPrefix);
    const match = pattern ? text.match(pattern) : null;
    return (_a = match === null || match === void 0 ? void 0 : match[1]) !== null && _a !== void 0 ? _a : null;
}
function getGeneratedPluginBlockTailPattern(pluginBlockPrefix) {
    if (!pluginBlockPrefix) {
        return null;
    }
    const safePrefix = escapeRegExp(sanitizeBlockPrefix(pluginBlockPrefix));
    return new RegExp(`(?:^|\\s)\\^(${safePrefix}-[A-Za-z0-9]{6,64})[^\\r\\n]*$`);
}
function parseSideNotesTransferBundle(rawBundle) {
    const parsed = JSON.parse(rawBundle);
    if (!isRecord(parsed) || parsed.type !== SIDE_NOTES_BUNDLE_TYPE || parsed.version !== SIDE_NOTES_BUNDLE_VERSION || !Array.isArray(parsed.files)) {
        throw new Error("Invalid SideNotes transfer bundle.");
    }
    const files = parsed.files.map((file) => {
        if (!isRecord(file) || typeof file.content !== "string") {
            throw new Error("Invalid SideNotes transfer file.");
        }
        return {
            path: typeof file.path === "string" ? file.path : "Imported side notes.md",
            name: typeof file.name === "string" ? file.name : getFileNameFromPath(typeof file.path === "string" ? file.path : "Imported side notes.md"),
            basename: typeof file.basename === "string" ? file.basename : getFileNameFromPath(typeof file.path === "string" ? file.path : "Imported side notes.md"),
            content: file.content,
            SideNotesID: typeof file.SideNotesID === "string" ? normalizeSideNotesId(file.SideNotesID) : makeSideNotesId(),
            blocks: isRecord(file.blocks) ? cloneBlockNotesRecord(file.blocks) : {},
            attachments: parseSideNotesTransferAttachments(file.attachments)
        };
    });
    return {
        type: SIDE_NOTES_BUNDLE_TYPE,
        version: SIDE_NOTES_BUNDLE_VERSION,
        exportedAt: typeof parsed.exportedAt === "number" ? parsed.exportedAt : Date.now(),
        files
    };
}
function parseSideNotesTransferAttachments(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const attachments = [];
    for (const attachment of value) {
        if (!isRecord(attachment) || typeof attachment.path !== "string" || typeof attachment.data !== "string") {
            throw new Error("Invalid SideNotes attachment.");
        }
        const path = sanitizeOptionalVaultPath(attachment.path);
        if (!path) {
            throw new Error("Unsafe SideNotes attachment path.");
        }
        attachments.push({
            path,
            name: typeof attachment.name === "string" ? attachment.name : getLeafFileName(path),
            data: attachment.data
        });
    }
    return attachments;
}
function getSideNotesSettingsFromPluginData(rawData) {
    const data = getPluginDataRecord(rawData);
    const noteFontSizePx = getNumberValue(data.noteFontSizePx, DEFAULT_SETTINGS.noteFontSizePx);
    return {
        anchorStorage: data.anchorStorage === "block-id" ? "block-id" : "internal",
        autoInsertBlockIds: getBooleanValue(data.autoInsertBlockIds, DEFAULT_SETTINGS.autoInsertBlockIds),
        blockIdPrefix: getStringValue(data.blockIdPrefix, DEFAULT_SETTINGS.blockIdPrefix),
        confirmBeforeDelete: getBooleanValue(data.confirmBeforeDelete, DEFAULT_SETTINGS.confirmBeforeDelete),
        defaultNotesExpanded: getBooleanValue(data.defaultNotesExpanded, DEFAULT_SETTINGS.defaultNotesExpanded),
        exportBlankLineBetweenNotes: getBooleanValue(data.exportBlankLineBetweenNotes, DEFAULT_SETTINGS.exportBlankLineBetweenNotes),
        hidePluginBlockIds: getBooleanValue(data.hidePluginBlockIds, DEFAULT_SETTINGS.hidePluginBlockIds),
        headerCollapsed: getBooleanValue(data.headerCollapsed, DEFAULT_SETTINGS.headerCollapsed),
        headerFontSizePx: getNumberValue(data.headerFontSizePx, DEFAULT_SETTINGS.headerFontSizePx),
        includeOrphanedInFullExport: getBooleanValue(data.includeOrphanedInFullExport, DEFAULT_SETTINGS.includeOrphanedInFullExport),
        noteFontFamily: getStringValue(data.noteFontFamily, DEFAULT_SETTINGS.noteFontFamily),
        noteFontSizePx,
        noteEditorFontSizePx: getNumberValue(data.noteEditorFontSizePx, noteFontSizePx),
        notePreviewFontSizePx: getNumberValue(data.notePreviewFontSizePx, noteFontSizePx),
        noteOpenFontSizePx: getNumberValue(data.noteOpenFontSizePx, getNumberValue(data.notePreviewFontSizePx, noteFontSizePx)),
        buttonSizePx: getNumberValue(data.buttonSizePx, DEFAULT_SETTINGS.buttonSizePx),
        noteDirection: getNoteDirectionValue(data.noteDirection, DEFAULT_SETTINGS.noteDirection),
        showAllVaultNotesButton: getBooleanValue(data.showAllVaultNotesButton, DEFAULT_SETTINGS.showAllVaultNotesButton),
        storeSideNoteIDInProperties: getBooleanValue(data.storeSideNoteIDInProperties, DEFAULT_SETTINGS.storeSideNoteIDInProperties),
        updateOnSelectionChange: getBooleanValue(data.updateOnSelectionChange, DEFAULT_SETTINGS.updateOnSelectionChange),
        updateDebounceMs: getNumberValue(data.updateDebounceMs, DEFAULT_SETTINGS.updateDebounceMs)
    };
}
function getPluginDataRecord(rawData) {
    return isRecord(rawData) ? rawData : {};
}
function getSideNotesFilesRecord(value) {
    return isRecord(value) ? value : {};
}
function getFrontmatterStringValue(frontmatter, key) {
    if (!isRecord(frontmatter)) {
        return null;
    }
    const value = frontmatter[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function getBooleanValue(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function getNumberValue(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function getStringValue(value, fallback) {
    return typeof value === "string" ? value : fallback;
}
function getNoteDirectionValue(value, fallback) {
    return value === "auto" || value === "rtl" || value === "ltr" ? value : fallback;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cloneBlockNotesRecord(blocks) {
    var _a;
    const clonedBlocks = {};
    for (const [blockId, blockNotes] of Object.entries(blocks)) {
        clonedBlocks[blockId] = {
            notes: ((_a = blockNotes.notes) !== null && _a !== void 0 ? _a : []).map((note) => ({ ...note })),
            fingerprint: blockNotes.fingerprint,
            fromLine: blockNotes.fromLine,
            toLine: blockNotes.toLine
        };
    }
    return clonedBlocks;
}
function getBlockNotesCount(blocks) {
    return Object.values(blocks).reduce((count, blockNotes) => { var _a, _b; return count + ((_b = (_a = blockNotes.notes) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0); }, 0);
}
function getFolderPath(path) {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
}
function joinVaultPath(folder, name) {
    return [folder, name].filter((part) => part.length > 0).join("/");
}
function sanitizeVaultPath(path) {
    var _a;
    return (_a = sanitizeOptionalVaultPath(path)) !== null && _a !== void 0 ? _a : "Imported side notes.md";
}
function sanitizeOptionalVaultPath(path, protectedConfigDir) {
    var _a;
    const normalizedPath = path.replace(/\\/g, "/");
    if (/^[\/]|^[A-Za-z]:|[\x00-\x1f\x7f]/.test(normalizedPath))
        return null;
    const parts = normalizedPath.split("/").filter((part) => part.length > 0);
    if (parts.some(part => part.trim() === "." || part.trim() === ".." || part !== part.trim() || part.endsWith(".")) ||
        ((_a = parts[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === ".git")
        return null;
    if (protectedConfigDir) {
        const configPath = protectedConfigDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
        const candidate = parts.join("/").toLowerCase();
        if (configPath && (candidate === configPath || candidate.startsWith(`${configPath}/`)))
            return null;
    }
    const sanitizedParts = parts.map((part) => sanitizeFileName(part)).filter((part) => part.length > 0);
    return sanitizedParts.join("/") || null;
}
function ensureMarkdownExtension(path) {
    return path.toLowerCase().endsWith(".md") ? path : `${path}.md`;
}
function removeSideNotesBundleExtension(name) {
    return name.replace(/\.sidenotes$/i, "");
}
function getSafeTimestamp() {
    return new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", " ")
        .replace("Z", "");
}
function getFileNameFromPath(path) {
    const fileName = getLeafFileName(path);
    return fileName.replace(/\.md$/i, "");
}
function getLeafFileName(path) {
    var _a;
    return (_a = path.split("/").pop()) !== null && _a !== void 0 ? _a : path;
}
function sanitizeFileName(name) {
    return name
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}
function extractInternalLinkPaths(content) {
    const linkPaths = [];
    const addLinkPath = (rawLink) => {
        const linkPath = getInternalLinkPath(rawLink);
        if (linkPath) {
            linkPaths.push(linkPath);
        }
    };
    const wikiLinkPattern = /\[\[([^\]]+)\]\]/g;
    let wikiLinkMatch;
    while ((wikiLinkMatch = wikiLinkPattern.exec(content)) !== null) {
        addLinkPath(wikiLinkMatch[1]);
    }
    const markdownLinkPattern = /!?\[[^\]]*\]\(([^)\r\n]+)\)/g;
    let markdownLinkMatch;
    while ((markdownLinkMatch = markdownLinkPattern.exec(content)) !== null) {
        addLinkPath(markdownLinkMatch[1]);
    }
    return linkPaths;
}
function getInternalLinkPath(rawLink) {
    let link = stripMarkdownLinkDestination(rawLink);
    if (!link || isExternalOrSpecialLink(link)) {
        return null;
    }
    const aliasIndex = link.indexOf("|");
    if (aliasIndex !== -1) {
        link = link.slice(0, aliasIndex);
    }
    const subpathIndex = link.search(/[?#]/);
    if (subpathIndex !== -1) {
        link = link.slice(0, subpathIndex);
    }
    link = decodeUriSafely(link.trim());
    return link && !isExternalOrSpecialLink(link) ? link : null;
}
function stripMarkdownLinkDestination(rawLink) {
    let link = rawLink.trim();
    if (link.startsWith("<")) {
        const closeIndex = link.indexOf(">");
        if (closeIndex !== -1) {
            return link.slice(1, closeIndex).trim();
        }
    }
    const titleIndex = link.search(/\s+["']/);
    if (titleIndex !== -1) {
        link = link.slice(0, titleIndex).trim();
    }
    if ((link.startsWith("\"") && link.endsWith("\"")) || (link.startsWith("'") && link.endsWith("'"))) {
        link = link.slice(1, -1).trim();
    }
    return link;
}
function isExternalOrSpecialLink(link) {
    return link.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(link);
}
function decodeUriSafely(value) {
    try {
        return decodeURI(value);
    }
    catch (error) {
        return value;
    }
}
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
}
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
}
function getFirstNoteLine(text) {
    const firstLine = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    return firstLine !== null && firstLine !== void 0 ? firstLine : "Empty note";
}
function getBlockLabel(context, usesMarkdownBlockIds) {
    if (!context.blockId) {
        return usesMarkdownBlockIds
            ? "Block ID will be added when you create a note"
            : "Internal anchor will be created when you create a note";
    }
    if (!context.hasBlockIdInFile) {
        return usesMarkdownBlockIds
            ? `Recovered block: ^${context.blockId}. It will be restored when you add or edit a note.`
            : `Internal anchor: ${context.blockId}`;
    }
    return `Block: ^${context.blockId}`;
}
function getCurrentViewModeIcon(viewMode) {
    if (viewMode === "paragraph") {
        return "pilcrow";
    }
    if (viewMode === "file") {
        return "file-text";
    }
    if (viewMode === "vault") {
        return "library";
    }
    return "archive";
}
function getCurrentViewModeLabel(viewMode) {
    if (viewMode === "paragraph") {
        return "Current paragraph";
    }
    if (viewMode === "file") {
        return "All notes in file";
    }
    if (viewMode === "vault") {
        return "All notes in vault";
    }
    return "Orphaned notes";
}
function getSelectAllTooltip(viewMode) {
    if (viewMode === "paragraph") {
        return "Select all notes in this paragraph";
    }
    if (viewMode === "file") {
        return "Select all notes in this file";
    }
    if (viewMode === "vault") {
        return "Select all notes in all files";
    }
    return "Select all orphaned notes";
}
function getClearAllTooltip(viewMode) {
    if (viewMode === "paragraph") {
        return "Clear selection in this paragraph";
    }
    if (viewMode === "file") {
        return "Clear selection in this file";
    }
    if (viewMode === "vault") {
        return "Clear selection in all files";
    }
    return "Clear selection in orphaned notes";
}
function getFileCardKey(viewMode, sideNoteId) {
    return `${viewMode}:${sideNoteId}`;
}
function getFileNoteCount(groups) {
    return groups.reduce((count, group) => count + group.notes.length, 0);
}
function formatCount(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}
function isImageNote(note) {
    return note.type === "image" && typeof note.imagePath === "string" && note.imagePath.length > 0;
}
function isAudioNote(note) {
    return note.type === "audio" && typeof note.audioPath === "string" && note.audioPath.length > 0;
}
function isVideoNote(note) {
    return note.type === "video" && typeof note.videoPath === "string" && note.videoPath.length > 0;
}
function isFileNote(note) {
    return note.type === "file" && ((typeof note.filePath === "string" && note.filePath.length > 0) ||
        (typeof note.fileExternalPath === "string" && note.fileExternalPath.length > 0));
}
function isStoredFileNote(note) {
    return note.type === "file" && typeof note.filePath === "string" && note.filePath.length > 0;
}
function isExternalFileNote(note) {
    return note.type === "file" && typeof note.fileExternalPath === "string" && note.fileExternalPath.length > 0;
}
function isUrlNote(note) {
    return note.type === "url" && typeof note.url === "string" && note.url.length > 0;
}
function isTextNote(note) {
    return !isImageNote(note) && !isAudioNote(note) && !isVideoNote(note) && !isFileNote(note) && !isUrlNote(note);
}
function getSideNoteMediaPath(note) {
    if (isImageNote(note)) {
        return note.imagePath;
    }
    if (isAudioNote(note)) {
        return note.audioPath;
    }
    if (isVideoNote(note)) {
        return note.videoPath;
    }
    if (isStoredFileNote(note)) {
        return note.filePath;
    }
    return null;
}
function getSideNoteMediaPathsFromBlocks(blocks) {
    var _a;
    const mediaPaths = new Set();
    for (const blockNotes of Object.values(blocks)) {
        for (const note of (_a = blockNotes.notes) !== null && _a !== void 0 ? _a : []) {
            const mediaPath = getSideNoteMediaPath(note);
            const sanitizedPath = mediaPath ? sanitizeOptionalVaultPath(mediaPath) : null;
            if (sanitizedPath) {
                mediaPaths.add(sanitizedPath);
            }
        }
    }
    return mediaPaths;
}
function remapSideNoteMediaPaths(blocks, pathMap) {
    var _a;
    if (pathMap.size === 0) {
        return;
    }
    for (const blockNotes of Object.values(blocks)) {
        for (const note of (_a = blockNotes.notes) !== null && _a !== void 0 ? _a : []) {
            if (isImageNote(note)) {
                note.imagePath = getRemappedSideNoteMediaPath(note.imagePath, pathMap);
            }
            else if (isAudioNote(note)) {
                note.audioPath = getRemappedSideNoteMediaPath(note.audioPath, pathMap);
            }
            else if (isVideoNote(note)) {
                note.videoPath = getRemappedSideNoteMediaPath(note.videoPath, pathMap);
            }
            else if (isStoredFileNote(note)) {
                note.filePath = getRemappedSideNoteMediaPath(note.filePath, pathMap);
            }
        }
    }
}
function getRemappedSideNoteMediaPath(path, pathMap) {
    var _a;
    const sanitizedPath = sanitizeOptionalVaultPath(path);
    if (!sanitizedPath) {
        return path;
    }
    return (_a = pathMap.get(sanitizedPath)) !== null && _a !== void 0 ? _a : path;
}
function getSideNoteSummaryText(note) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const noteText = note.text;
    if (isImageNote(note)) {
        return `Image: ${(_a = note.imageName) !== null && _a !== void 0 ? _a : getLeafFileName((_b = note.imagePath) !== null && _b !== void 0 ? _b : "")}`;
    }
    if (isAudioNote(note)) {
        return `Audio: ${(_c = note.audioName) !== null && _c !== void 0 ? _c : getLeafFileName((_d = note.audioPath) !== null && _d !== void 0 ? _d : "")}`;
    }
    if (isVideoNote(note)) {
        return `Video: ${(_e = note.videoName) !== null && _e !== void 0 ? _e : getLeafFileName((_f = note.videoPath) !== null && _f !== void 0 ? _f : "")}`;
    }
    if (isFileNote(note)) {
        return `File: ${(_g = note.fileName) !== null && _g !== void 0 ? _g : getFileNoteDisplayPath(note)}`;
    }
    if (isUrlNote(note)) {
        return `URL: ${(_h = note.urlTitle) !== null && _h !== void 0 ? _h : getUrlDisplayName(note.url)}`;
    }
    return getFirstNoteLine(noteText);
}
function clampImageZoom(zoom) {
    return Math.max(0.25, Math.min(4, Math.round(zoom * 100) / 100));
}
function clampImageFrameHeight(height) {
    return Math.max(160, Math.min(1600, Math.round(height)));
}
function clampImageFrameScale(scale) {
    return Math.max(0.25, Math.min(4, Math.round(scale * 1000) / 1000));
}
function getImageFrameScale(note, frameHeight, viewportHeight) {
    if (typeof note.imageFrameScale === "number") {
        return clampImageFrameScale(note.imageFrameScale);
    }
    if (frameHeight === null) {
        return 1;
    }
    const defaultFrameHeight = Math.max(180, Math.min(420, viewportHeight * 0.42));
    return clampImageFrameScale(frameHeight / defaultFrameHeight);
}
function clampImagePanOffset(offset) {
    return Math.max(-5000, Math.min(5000, Math.round(offset)));
}
function normalizeImageRotation(rotation) {
    return ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
}
function getClipboardMediaFile(event) {
    const clipboardData = event.clipboardData;
    if (!clipboardData) {
        return null;
    }
    for (const item of Array.from(clipboardData.items)) {
        if (item.kind !== "file") {
            continue;
        }
        const file = item.getAsFile();
        if (!file) {
            continue;
        }
        const mimeType = file.type || item.type;
        const kind = getClipboardMediaKind(file.name, mimeType);
        if (kind) {
            return {
                kind,
                file: normalizeClipboardMediaFile(file, mimeType, kind)
            };
        }
    }
    for (const file of Array.from(clipboardData.files)) {
        const kind = getClipboardMediaKind(file.name, file.type);
        if (kind) {
            return { kind, file };
        }
    }
    return null;
}
function getClipboardMediaKind(fileName, mimeType) {
    if (isAcceptedImageFile(fileName, mimeType)) {
        return "image";
    }
    if (isAcceptedAudioFile(fileName, mimeType)) {
        return "audio";
    }
    if (isAcceptedVideoFile(fileName, mimeType)) {
        return "video";
    }
    return null;
}
function normalizeClipboardMediaFile(file, mimeType, kind) {
    if (file.name && (file.type || !mimeType)) {
        return file;
    }
    return new File([file], file.name || `clipboard-${kind}`, {
        type: file.type || mimeType,
        lastModified: file.lastModified
    });
}
function isAcceptedImageFile(fileName, mimeType) {
    return mimeType.startsWith("image/") || /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(fileName);
}
function getSafeImageFileName(fileName, mimeType) {
    const sanitizedName = sanitizeFileName(fileName || "side-note-image");
    const extension = getImageExtension(sanitizedName, mimeType);
    const baseName = extension && sanitizedName.toLowerCase().endsWith(extension)
        ? sanitizedName.slice(0, -extension.length)
        : sanitizedName.replace(/\.[^.]+$/, "");
    return `${baseName || "side-note-image"} ${getSafeTimestamp()}${extension || ".png"}`;
}
function getImageExtension(fileName, mimeType) {
    var _a;
    const extensionMatch = fileName.match(/\.[A-Za-z0-9]+$/);
    if (extensionMatch) {
        return extensionMatch[0].toLowerCase();
    }
    if (mimeType === "image/jpeg") {
        return ".jpg";
    }
    if (mimeType === "image/svg+xml") {
        return ".svg";
    }
    const subtype = (_a = mimeType.match(/^image\/([A-Za-z0-9.+-]+)$/)) === null || _a === void 0 ? void 0 : _a[1];
    return subtype ? `.${subtype.replace(/[^A-Za-z0-9]/g, "")}` : ".png";
}
function isAcceptedAudioFile(fileName, mimeType) {
    return mimeType.startsWith("audio/") || /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|webm|wma)$/i.test(fileName);
}
function isAcceptedVideoFile(fileName, mimeType) {
    return mimeType.startsWith("video/") || /\.(?:avi|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)$/i.test(fileName);
}
function getSafeAudioFileName(fileName, mimeType) {
    const sanitizedName = sanitizeFileName(fileName || "side-note-audio");
    const extension = getAudioExtension(sanitizedName, mimeType);
    const baseName = extension && sanitizedName.toLowerCase().endsWith(extension)
        ? sanitizedName.slice(0, -extension.length)
        : sanitizedName.replace(/\.[^.]+$/, "");
    return `${baseName || "side-note-audio"} ${getSafeTimestamp()}${extension || ".mp3"}`;
}
function getAudioExtension(fileName, mimeType) {
    var _a;
    const extensionMatch = fileName.match(/\.[A-Za-z0-9]+$/);
    if (extensionMatch) {
        return extensionMatch[0].toLowerCase();
    }
    if (mimeType === "audio/mpeg") {
        return ".mp3";
    }
    if (mimeType === "audio/mp4" || mimeType === "audio/x-m4a") {
        return ".m4a";
    }
    const subtype = (_a = mimeType.match(/^audio\/([A-Za-z0-9.+-]+)$/)) === null || _a === void 0 ? void 0 : _a[1];
    return subtype ? `.${subtype.replace(/[^A-Za-z0-9]/g, "")}` : ".mp3";
}
function getSafeVideoFileName(fileName, mimeType) {
    const sanitizedName = sanitizeFileName(fileName || "side-note-video");
    const extension = getVideoExtension(sanitizedName, mimeType);
    const baseName = extension && sanitizedName.toLowerCase().endsWith(extension)
        ? sanitizedName.slice(0, -extension.length)
        : sanitizedName.replace(/\.[^.]+$/, "");
    return `${baseName || "side-note-video"} ${getSafeTimestamp()}${extension || ".mp4"}`;
}
function getVideoExtension(fileName, mimeType) {
    var _a;
    const extensionMatch = fileName.match(/\.[A-Za-z0-9]+$/);
    if (extensionMatch) {
        return extensionMatch[0].toLowerCase();
    }
    if (mimeType === "video/quicktime") {
        return ".mov";
    }
    const subtype = (_a = mimeType.match(/^video\/([A-Za-z0-9.+-]+)$/)) === null || _a === void 0 ? void 0 : _a[1];
    return subtype ? `.${subtype.replace(/[^A-Za-z0-9]/g, "")}` : ".mp4";
}
function getSafeGenericFileName(fileName) {
    var _a;
    const sanitizedName = sanitizeFileName(fileName || "side-note-file");
    const extensionMatch = sanitizedName.match(/\.[A-Za-z0-9]+$/);
    const extension = (_a = extensionMatch === null || extensionMatch === void 0 ? void 0 : extensionMatch[0]) !== null && _a !== void 0 ? _a : "";
    const baseName = extension ? sanitizedName.slice(0, -extension.length) : sanitizedName;
    return `${baseName || "side-note-file"} ${getSafeTimestamp()}${extension}`;
}
function getFileNoteDisplayPath(note) {
    if (isStoredFileNote(note)) {
        return note.filePath;
    }
    if (isExternalFileNote(note)) {
        return note.fileExternalPath;
    }
    return "";
}
const SIDE_NOTES_ALLOWED_URL_PROTOCOLS = new Set([
    "http:",
    "https:",
    "mailto:",
    "anki:",
    "obsidian:"
]);
function normalizeSideNoteUrl(rawUrl) {
    const trimmedUrl = rawUrl.trim();
    if (!trimmedUrl) {
        return null;
    }
    const candidate = looksLikeSideNoteUrl(trimmedUrl)
        ? trimmedUrl
        : "https://" + trimmedUrl;
    try {
        const parsed = new URL(candidate);
        return SIDE_NOTES_ALLOWED_URL_PROTOCOLS.has(parsed.protocol.toLowerCase())
            ? candidate
            : null;
    }
    catch (_a) {
        return null;
    }
}
function looksLikeSideNoteUrl(value) {
    const trimmedValue = value.trim();
    if (/^[A-Za-z]:[\\/]/.test(trimmedValue) || trimmedValue.startsWith("\\\\")) {
        return false;
    }
    return /^[a-z][a-z0-9+.-]*:/i.test(trimmedValue);
}
function getUrlDisplayName(url) {
    if (!url) {
        return "URL";
    }
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === "anki:") {
            return "Anki link";
        }
        if (parsedUrl.hostname) {
            return parsedUrl.hostname;
        }
    }
    catch (_a) {
        // Custom app protocols may not parse cleanly in every environment.
    }
    return url;
}
async function openUrlExternally(url) {
    const safeUrl = normalizeSideNoteUrl(url);
    if (!safeUrl) {
        throw new Error("Unsafe URL protocol.");
    }
    const openedWindow = window.open(safeUrl, "_blank", "noopener,noreferrer");
    if (!openedWindow) {
        throw new Error("External URL window was blocked.");
    }
}
async function openFilePathExternally(path, fallbackUrl) {
    var _a;
    const url = (_a = pathToFileUrl(path)) !== null && _a !== void 0 ? _a : fallbackUrl;
    if (!url) {
        throw new Error("Missing file path.");
    }
    await openUrlExternally(url);
}
function pathToFileUrl(path) {
    const trimmedPath = path.trim();
    if (!trimmedPath) {
        return null;
    }
    if (looksLikeSideNoteUrl(trimmedPath)) {
        return trimmedPath;
    }
    if (trimmedPath.startsWith("\\\\")) {
        return `file://${encodeURI(trimmedPath.replace(/^\\\\/, "").replace(/\\/g, "/"))}`;
    }
    if (/^[A-Za-z]:[\\/]/.test(trimmedPath)) {
        return `file:///${encodeURI(trimmedPath.replace(/\\/g, "/"))}`;
    }
    if (trimmedPath.startsWith("/")) {
        return `file://${encodeURI(trimmedPath)}`;
    }
    return encodeURI(trimmedPath.replace(/\\/g, "/"));
}
function getPreferredAudioRecordingMimeType() {
    var _a;
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
        return "";
    }
    const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4"
    ];
    return (_a = mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType))) !== null && _a !== void 0 ? _a : "";
}
function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
function makeId(prefix) {
    return `${prefix}-${makeRandomIdPart(24)}`;
}
function makeSideNotesId() {
    return makeId(SIDE_NOTES_ID_PREFIX);
}
function normalizeSideNotesId(sideNoteId) {
    const trimmedSideNoteId = sideNoteId.trim();
    const legacyPrefix = `${LEGACY_SIDE_NOTE_ID_PREFIX}-`;
    if (trimmedSideNoteId.startsWith(legacyPrefix)) {
        return `${SIDE_NOTES_ID_PREFIX}-${trimmedSideNoteId.slice(legacyPrefix.length)}`;
    }
    return trimmedSideNoteId;
}
function makeRandomIdPart(length) {
    let value = "";
    while (value.length < length) {
        value += Math.random().toString(36).slice(2);
    }
    return value.slice(0, length);
}
function sanitizeBlockPrefix(prefix) {
    return (prefix || "side-note")
        .trim()
        .replace(/^\^+/, "")
        .replace(/[^A-Za-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "side-note";
}
function isFenceLine(line) {
    return line.trim().startsWith("```");
}
function addToolbarButton(parent, label, text, onClick) {
    const button = parent.createEl("button", {
        text,
        attr: {
            "aria-label": label,
            title: label
        }
    });
    button.addEventListener("click", (event) => {
        event.preventDefault();
        onClick();
    });
    button.addEventListener("mousedown", (event) => {
        event.preventDefault();
    });
}
function addToolbarIconButton(parent, label, icon, onClick) {
    const button = parent.createEl("button", {
        attr: {
            "aria-label": label,
            title: label
        }
    });
    (0, obsidian_1.setIcon)(button, icon);
    button.addEventListener("click", (event) => {
        event.preventDefault();
        onClick(event);
    });
    button.addEventListener("mousedown", (event) => {
        event.preventDefault();
    });
}
function addIconButton(parent, icon, label, onClick) {
    return new obsidian_1.ButtonComponent(parent)
        .setIcon(icon)
        .setTooltip(label)
        .onClick(() => {
        void onClick();
    });
}
function markDeleteButton(button) {
    button.buttonEl.addClass("side-notes-delete-button");
    return button;
}
function markClearSelectionButton(button) {
    button.buttonEl.addClass("side-notes-clear-selection-button");
    return button;
}
function blurActiveElement() {
    const activeElement = activeDocument.activeElement;
    if (activeElement instanceof HTMLElement) {
        activeElement.blur();
    }
}
async function copyTextToClipboard(text) {
    var _a;
    if ((_a = navigator.clipboard) === null || _a === void 0 ? void 0 : _a.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = activeDocument.createElement("textarea");
    textarea.value = text;
    textarea.addClass("side-notes-clipboard-textarea");
    textarea.setAttribute("readonly", "true");
    activeDocument.body.appendChild(textarea);
    textarea.select();
    try {
        const copied = activeDocument.execCommand("copy");
        if (!copied) {
            throw new Error("Clipboard copy command failed.");
        }
    }
    finally {
        textarea.remove();
    }
}
async function copyRichContentToClipboard(plainText, html, nativeImage = null) {
    var _a;
    if (((_a = navigator.clipboard) === null || _a === void 0 ? void 0 : _a.write) && typeof ClipboardItem !== "undefined") {
        const clipboardRepresentations = {
            "text/plain": new Blob([plainText], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" })
        };
        if (nativeImage) {
            clipboardRepresentations["image/png"] = nativeImage;
        }
        await navigator.clipboard.write([
            new ClipboardItem(clipboardRepresentations)
        ]);
        return;
    }
    const textarea = activeDocument.createElement("textarea");
    textarea.value = plainText || " ";
    textarea.addClass("side-notes-clipboard-textarea");
    textarea.setAttribute("readonly", "true");
    activeDocument.body.appendChild(textarea);
    textarea.select();
    let clipboardDataSet = false;
    const handleCopy = (event) => {
        if (!event.clipboardData) {
            return;
        }
        event.preventDefault();
        event.clipboardData.setData("text/plain", plainText);
        event.clipboardData.setData("text/html", html);
        clipboardDataSet = true;
    };
    activeDocument.addEventListener("copy", handleCopy, { once: true });
    try {
        const copied = activeDocument.execCommand("copy");
        if (!copied || !clipboardDataSet) {
            throw new Error("Rich clipboard copy command failed.");
        }
    }
    finally {
        activeDocument.removeEventListener("copy", handleCopy);
        textarea.remove();
    }
}
async function getSideNoteImageClipboardBlob(app, note) {
    const file = app.vault.getAbstractFileByPath(note.imagePath);
    if (!(file instanceof obsidian_1.TFile)) {
        return null;
    }
    try {
        const data = await app.vault.readBinary(file);
        const mimeType = note.imageMime || getMediaMimeTypeFromPath(file.path) || "image/png";
        const sourceBlob = new Blob([data], { type: mimeType });
        if (mimeType.split(";", 1)[0].toLowerCase() === "image/png") {
            return sourceBlob;
        }
        return await convertImageBlobToPng(sourceBlob);
    }
    catch (error) {
        console.error(error);
        return null;
    }
}
async function convertImageBlobToPng(sourceBlob) {
    const objectUrl = URL.createObjectURL(sourceBlob);
    try {
        const imageEl = activeDocument.createElement("img");
        await new Promise((resolve, reject) => {
            imageEl.addEventListener("load", () => resolve(), { once: true });
            imageEl.addEventListener("error", () => reject(new Error("Could not decode image for clipboard.")), { once: true });
            imageEl.src = objectUrl;
        });
        if (imageEl.naturalWidth < 1 || imageEl.naturalHeight < 1) {
            throw new Error("Clipboard image has invalid dimensions.");
        }
        const canvasEl = activeDocument.createElement("canvas");
        canvasEl.width = imageEl.naturalWidth;
        canvasEl.height = imageEl.naturalHeight;
        const context = canvasEl.getContext("2d");
        if (!context) {
            throw new Error("Could not create clipboard image canvas.");
        }
        context.drawImage(imageEl, 0, 0);
        return await new Promise((resolve, reject) => {
            canvasEl.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                }
                else {
                    reject(new Error("Could not encode clipboard image."));
                }
            }, "image/png");
        });
    }
    finally {
        URL.revokeObjectURL(objectUrl);
    }
}
async function buildSideNotesClipboardHtml(app, notes) {
    const noteHtml = [];
    for (const note of notes) {
        noteHtml.push(await getNoteRichCopyHtml(app, note));
    }
    return `<div class="aag-side-notes-clipboard">${noteHtml.join("")}</div>`;
}
async function getNoteRichCopyHtml(app, note) {
    var _a, _b, _c, _d;
    if (isImageNote(note)) {
        const name = (_a = note.imageName) !== null && _a !== void 0 ? _a : getLeafFileName(note.imagePath);
        const dataUrl = await getSideNoteMediaDataUrl(app, note.imagePath, note.imageMime, "image/png");
        if (!dataUrl) {
            return getClipboardTextBlockHtml(`Image not found: ${name}`);
        }
        return `<figure style="margin:0 0 12px 0"><img src="${escapeHtmlAttribute(dataUrl)}" alt="${escapeHtmlAttribute(name)}" style="display:block;max-width:100%;height:auto"><figcaption>${escapeHtml(name)}</figcaption></figure>`;
    }
    if (isAudioNote(note)) {
        const name = (_b = note.audioName) !== null && _b !== void 0 ? _b : getLeafFileName(note.audioPath);
        const dataUrl = await getSideNoteMediaDataUrl(app, note.audioPath, note.audioMime, "audio/mpeg");
        if (!dataUrl) {
            return getClipboardTextBlockHtml(`Audio not found: ${name}`);
        }
        return `<figure style="margin:0 0 12px 0"><audio controls src="${escapeHtmlAttribute(dataUrl)}">${escapeHtml(name)}</audio><figcaption>${escapeHtml(name)}</figcaption></figure>`;
    }
    if (isVideoNote(note)) {
        const name = (_c = note.videoName) !== null && _c !== void 0 ? _c : getLeafFileName(note.videoPath);
        const dataUrl = await getSideNoteMediaDataUrl(app, note.videoPath, note.videoMime, "video/mp4");
        if (!dataUrl) {
            return getClipboardTextBlockHtml(`Video not found: ${name}`);
        }
        return `<figure style="margin:0 0 12px 0"><video controls src="${escapeHtmlAttribute(dataUrl)}" style="display:block;max-width:100%;height:auto">${escapeHtml(name)}</video><figcaption>${escapeHtml(name)}</figcaption></figure>`;
    }
    if (isUrlNote(note)) {
        const label = (_d = note.urlTitle) !== null && _d !== void 0 ? _d : getUrlDisplayName(note.url);
        return `<div style="margin:0 0 12px 0"><a href="${escapeHtmlAttribute(note.url)}">${escapeHtml(label)}</a></div>`;
    }
    return getClipboardTextBlockHtml(getNotePlainCopyText(note));
}
async function getSideNoteMediaDataUrl(app, path, storedMimeType, fallbackMimeType) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof obsidian_1.TFile)) {
        return null;
    }
    try {
        const data = await app.vault.readBinary(file);
        const mimeType = storedMimeType || getMediaMimeTypeFromPath(file.path) || fallbackMimeType;
        return `data:${mimeType};base64,${arrayBufferToBase64(data)}`;
    }
    catch (error) {
        console.error(error);
        return null;
    }
}
function getClipboardTextBlockHtml(text) {
    const escapedText = escapeHtml(text).replace(/\r?\n/g, "<br>");
    return `<div style="margin:0 0 12px 0;white-space:pre-wrap">${escapedText}</div>`;
}
function getMediaMimeTypeFromPath(path) {
    var _a, _b, _c;
    const extension = (_b = (_a = path.match(/\.([A-Za-z0-9]+)$/)) === null || _a === void 0 ? void 0 : _a[1]) === null || _b === void 0 ? void 0 : _b.toLowerCase();
    if (!extension) {
        return null;
    }
    const mimeTypes = {
        aac: "audio/aac",
        aif: "audio/aiff",
        aiff: "audio/aiff",
        avi: "video/x-msvideo",
        avif: "image/avif",
        bmp: "image/bmp",
        flac: "audio/flac",
        gif: "image/gif",
        ico: "image/x-icon",
        jpeg: "image/jpeg",
        jpg: "image/jpeg",
        m4a: "audio/mp4",
        m4v: "video/mp4",
        mkv: "video/x-matroska",
        mov: "video/quicktime",
        mp3: "audio/mpeg",
        mp4: "video/mp4",
        mpeg: "video/mpeg",
        mpg: "video/mpeg",
        oga: "audio/ogg",
        ogg: "audio/ogg",
        ogv: "video/ogg",
        opus: "audio/opus",
        png: "image/png",
        svg: "image/svg+xml",
        wav: "audio/wav",
        webm: "video/webm",
        webp: "image/webp",
        wma: "audio/x-ms-wma",
        wmv: "video/x-ms-wmv"
    };
    return (_c = mimeTypes[extension]) !== null && _c !== void 0 ? _c : null;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function escapeHtmlAttribute(text) {
    return escapeHtml(text);
}
function applyNoteDirection(element, direction) {
    element.setAttribute("dir", direction);
    if (direction === "rtl") {
        element.setCssProps({ "text-align": "right" });
    }
    else if (direction === "ltr") {
        element.setCssProps({ "text-align": "left" });
    }
    else {
        element.setCssProps({ "text-align": "start" });
    }
}
function applyNoteEditorStyles(textarea, settings) {
    textarea.setCssProps({
        "font-family": settings.noteFontFamily || "",
        "font-size": `${settings.noteEditorFontSizePx}px`,
        "line-height": "1.5",
        "white-space": "pre-wrap",
        "overflow-wrap": "anywhere",
        "word-break": "break-word"
    });
}
function enableTextareaAutoResize(textarea) {
    textarea.addEventListener("input", () => resizeTextarea(textarea));
    window.requestAnimationFrame(() => resizeTextarea(textarea));
}
function resizeTextarea(textarea) {
    textarea.setCssProps({ height: "auto" });
    textarea.setCssProps({ height: `${textarea.scrollHeight}px` });
}
function setEditTextareaInitialHeight(textarea) {
    window.requestAnimationFrame(() => {
        const maxInitialHeight = Math.min(360, Math.round(window.innerHeight * 0.45));
        const initialHeight = Math.max(120, Math.min(textarea.scrollHeight, maxInitialHeight));
        textarea.setCssProps({ height: `${initialHeight}px` });
    });
}
function getElementTopRelativeTo(containerEl, elementEl) {
    return elementEl.getBoundingClientRect().top - containerEl.getBoundingClientRect().top;
}
function restoreElementTopRelativeTo(containerEl, elementEl, previousTop) {
    if (previousTop === undefined) {
        return;
    }
    const currentTop = getElementTopRelativeTo(containerEl, elementEl);
    containerEl.scrollTop += currentTop - previousTop;
}
function getDatasetList(value) {
    return value ? value.split("\n").filter((item) => item.length > 0) : [];
}
function joinMergedNoteTexts(texts) {
    return texts
        .map((text) => trimOuterBlankLines(text))
        .filter((text) => text.length > 0)
        .join("\n\n");
}
function trimOuterBlankLines(text) {
    return text
        .replace(/^(?:[ \t]*\r?\n)+/, "")
        .replace(/(?:\r?\n[ \t]*)+$/, "");
}
function getNoteExportMarkdown(note) {
    var _a, _b, _c;
    const noteText = note.text;
    if (isImageNote(note)) {
        return `![[${note.imagePath}]]`;
    }
    if (isAudioNote(note)) {
        return `![[${note.audioPath}]]`;
    }
    if (isVideoNote(note)) {
        return `![[${note.videoPath}]]`;
    }
    if (isStoredFileNote(note)) {
        return `![[${note.filePath}]]`;
    }
    if (isExternalFileNote(note)) {
        const label = (_a = note.fileName) !== null && _a !== void 0 ? _a : getFileNoteDisplayPath(note);
        return `[${escapeMarkdownLinkText(label)}](${(_b = pathToFileUrl(note.fileExternalPath)) !== null && _b !== void 0 ? _b : note.fileExternalPath})`;
    }
    if (isUrlNote(note)) {
        return `[${escapeMarkdownLinkText((_c = note.urlTitle) !== null && _c !== void 0 ? _c : getUrlDisplayName(note.url))}](${note.url})`;
    }
    return noteText;
}
function getNotePlainCopyText(note) {
    var _a, _b;
    const noteText = note.text;
    if (isImageNote(note) || isAudioNote(note) || isVideoNote(note)) {
        return "";
    }
    if (isFileNote(note)) {
        return `[File: ${(_a = note.fileName) !== null && _a !== void 0 ? _a : getFileNoteDisplayPath(note)}] ${getFileNoteDisplayPath(note)}`;
    }
    if (isUrlNote(note)) {
        return `[URL: ${(_b = note.urlTitle) !== null && _b !== void 0 ? _b : getUrlDisplayName(note.url)}] ${note.url}`;
    }
    return trimOuterBlankLines(noteText);
}
function escapeMarkdownLinkText(text) {
    return text.replace(/[[\]]/g, "\\$&");
}
function getNoteFontFamilyCssValue(fontFamily) {
    const trimmedFontFamily = fontFamily.trim();
    return trimmedFontFamily ? JSON.stringify(trimmedFontFamily) : "inherit";
}
function getUniqueFontFamilies(fontFamilies) {
    const seen = new Set();
    const uniqueFontFamilies = [];
    for (const fontFamily of fontFamilies) {
        const trimmedFontFamily = fontFamily.trim();
        const normalizedFontFamily = trimmedFontFamily.toLocaleLowerCase();
        if (!trimmedFontFamily || seen.has(normalizedFontFamily)) {
            continue;
        }
        seen.add(normalizedFontFamily);
        uniqueFontFamilies.push(trimmedFontFamily);
    }
    return uniqueFontFamilies.sort((a, b) => a.localeCompare(b));
}
async function getInstalledFontFamilies() {
    const fontAccessApi = window;
    if (typeof fontAccessApi.queryLocalFonts !== "function") {
        return [];
    }
    try {
        const localFonts = await fontAccessApi.queryLocalFonts();
        return getUniqueFontFamilies(localFonts.map((font) => font.family));
    }
    catch (_a) {
        return [];
    }
}
function enableMarkdownListContinuation(textarea) {
    textarea.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
            return;
        }
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const currentLine = value.slice(lineStart, start);
        const match = currentLine.match(/^(\s*)((?:[-*+]\s+\[[ xX]\]\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))(.*)$/);
        if (!match) {
            return;
        }
        event.preventDefault();
        const indent = match[1];
        const marker = match[2];
        const content = match[3];
        if (content.trim().length === 0) {
            replaceTextareaRange(textarea, lineStart, start, indent);
            return;
        }
        replaceTextareaRange(textarea, start, end, `\n${indent}${getNextListMarker(marker)}`);
    });
}
function getNextListMarker(marker) {
    const numbered = marker.match(/^(\d+)([.)])\s+$/);
    if (numbered) {
        return `${Number(numbered[1]) + 1}${numbered[2]} `;
    }
    const checkbox = marker.match(/^([-*+]\s+)\[[ xX]\]\s+$/);
    if (checkbox) {
        return `${checkbox[1]}[ ] `;
    }
    return marker;
}
function replaceTextareaRange(textarea, start, end, replacement) {
    textarea.value = textarea.value.slice(0, start) + replacement + textarea.value.slice(end);
    const cursor = start + replacement.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    textarea.focus();
    textarea.dispatchEvent(new Event("input"));
}
function wrapSelection(textarea, before, after) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    textarea.value =
        textarea.value.slice(0, start) +
            before +
            selected +
            after +
            textarea.value.slice(end);
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = end + before.length;
    textarea.focus();
    textarea.dispatchEvent(new Event("input"));
}
function applyBulletList(textarea) {
    applyLinePrefixes(textarea, () => "- ");
}
function applyTaskList(textarea) {
    applyLinePrefixes(textarea, () => "- [ ] ");
}
function applyNumberedList(textarea) {
    applyLinePrefixes(textarea, (index) => `${index + 1}. `);
}
function indentSelectedLines(textarea) {
    transformSelectedLines(textarea, (line) => `  ${line}`);
}
function outdentSelectedLines(textarea) {
    transformSelectedLines(textarea, (line) => {
        if (line.startsWith("\t")) {
            return line.slice(1);
        }
        if (line.startsWith("  ")) {
            return line.slice(2);
        }
        if (line.startsWith(" ")) {
            return line.slice(1);
        }
        return line;
    });
}
function transformSelectedLines(textarea, transformLine) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const adjustedEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const lineEnd = value.indexOf("\n", adjustedEnd);
    const selectionEnd = lineEnd === -1 ? value.length : lineEnd;
    const selectedBlock = value.slice(lineStart, selectionEnd);
    const transformed = selectedBlock.split("\n").map(transformLine).join("\n");
    textarea.value = value.slice(0, lineStart) + transformed + value.slice(selectionEnd);
    textarea.selectionStart = lineStart;
    textarea.selectionEnd = lineStart + transformed.length;
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
function applyLinePrefixes(textarea, getPrefix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const adjustedEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const lineEnd = value.indexOf("\n", adjustedEnd);
    const selectionEnd = lineEnd === -1 ? value.length : lineEnd;
    const selectedBlock = value.slice(lineStart, selectionEnd);
    const lines = selectedBlock.split("\n");
    const shouldPrefixEmptyLine = lines.length === 1;
    let prefixedLineIndex = 0;
    const prefixed = lines
        .map((line) => {
        if (line.trim().length === 0 && !shouldPrefixEmptyLine) {
            return line;
        }
        const lineParts = getLineWithoutListMarker(line);
        const prefix = getPrefix(prefixedLineIndex);
        prefixedLineIndex++;
        return `${lineParts.indent}${prefix}${lineParts.content}`;
    })
        .join("\n");
    textarea.value = value.slice(0, lineStart) + prefixed + value.slice(selectionEnd);
    if (shouldPrefixEmptyLine && selectedBlock.trim().length === 0) {
        const cursor = lineStart + prefixed.length;
        textarea.selectionStart = cursor;
        textarea.selectionEnd = cursor;
    }
    else {
        textarea.selectionStart = lineStart;
        textarea.selectionEnd = lineStart + prefixed.length;
    }
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
function getLineWithoutListMarker(line) {
    var _a, _b;
    const existingMarker = line.match(/^(\s*)(?:(?:[-*+]\s+\[[ xX]\]\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))(.*)$/);
    if (existingMarker) {
        return {
            indent: existingMarker[1],
            content: existingMarker[2]
        };
    }
    const indent = (_b = (_a = line.match(/^\s*/)) === null || _a === void 0 ? void 0 : _a[0]) !== null && _b !== void 0 ? _b : "";
    return {
        indent,
        content: line.slice(indent.length)
    };
}
function createBlockIdHiderExtension(prefix, protectBlockIds) {
    const safePrefix = escapeRegExp(sanitizeBlockPrefix(prefix));
    const blockIdRegex = new RegExp(`[ \\t\\u00a0]*\\^${safePrefix}-[^\\r\\n]*(?=\\s*$)`, "gm");
    const hider = view_1.ViewPlugin.fromClass(class {
        constructor(view) {
            this.decorations = buildBlockIdDecorations(view, blockIdRegex);
        }
        update(update) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = buildBlockIdDecorations(update.view, blockIdRegex);
            }
        }
    }, {
        decorations: (value) => value.decorations,
        provide: (plugin) => view_1.EditorView.atomicRanges.of((view) => { var _a, _b; return (_b = (_a = view.plugin(plugin)) === null || _a === void 0 ? void 0 : _a.decorations) !== null && _b !== void 0 ? _b : view_1.Decoration.none; })
    });
    const protector = state_1.EditorState.transactionFilter.of((transaction) => {
        if (!transaction.docChanged) {
            return transaction;
        }
        const protectedRanges = getProtectedBlockIdRanges(transaction.startState.doc, blockIdRegex);
        if (protectedRanges.length === 0) {
            return transaction;
        }
        const rewrittenChanges = [];
        const hasSelection = transaction.startState.selection.ranges.some((range) => !range.empty);
        let rewritten = false;
        let blockChange = false;
        transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            if (inserted.length === 0 && fromA < toA) {
                const touchedRanges = protectedRanges.filter((range) => changeTouchesProtectedRange(fromA, toA, range));
                if (touchedRanges.length > 0) {
                    if (hasSelection &&
                        touchedRanges.every((range) => fromA <= range.from && toA >= range.to)) {
                        // An explicit selection that fully includes the protected token may
                        // intentionally remove it. Preserve the entire original change.
                        rewrittenChanges.push({ from: fromA, to: toA, insert: inserted });
                        return;
                    }
                    rewritten = true;
                    for (const deletionRange of getUnprotectedDeletionRanges(fromA, toA, protectedRanges)) {
                        rewrittenChanges.push({
                            from: deletionRange.from,
                            to: deletionRange.to,
                            insert: ""
                        });
                    }
                    return;
                }
            }
            const standaloneRangeMove = getStandaloneProtectedRangeMoveAfterParagraphBreak(transaction.startState.doc, fromA, toA, inserted, protectedRanges);
            if (standaloneRangeMove) {
                rewritten = true;
                rewrittenChanges.push(...standaloneRangeMove.changes);
                return;
            }
            const redirectedRange = protectedRanges.find((range) => changeCanBeRedirectedAroundProtectedRange(fromA, toA, inserted, range));
            if (redirectedRange) {
                rewritten = true;
                const insertAt = getProtectedRangeInsertPosition(inserted, redirectedRange);
                rewrittenChanges.push({
                    from: insertAt,
                    to: insertAt,
                    insert: inserted
                });
                return;
            }
            if (changeTouchesProtectedRanges(fromA, toA, protectedRanges)) {
                blockChange = true;
                return;
            }
            // Keep ordinary changes from the same transaction. This is essential for
            // multi-cursor edits and transactions emitted by other editor extensions.
            rewrittenChanges.push({ from: fromA, to: toA, insert: inserted });
        });
        if (blockChange) {
            return [];
        }
        if (!rewritten) {
            return transaction;
        }
        const rewrittenChangeSet = state_1.ChangeSet.of(rewrittenChanges, transaction.startState.doc.length);
        // Map the original resulting selection/effects from the original final
        // document into the rewritten final document. This preserves unrelated
        // editor/plugin state while changing only the protected ranges.
        const originalToRewritten = transaction.changes.invertedDesc.composeDesc(rewrittenChangeSet);
        const userEvent = transaction.annotation(state_1.Transaction.userEvent);
        const addToHistory = transaction.annotation(state_1.Transaction.addToHistory);
        const remote = transaction.annotation(state_1.Transaction.remote);
        const time = transaction.annotation(state_1.Transaction.time);
        return {
            changes: rewrittenChangeSet,
            selection: transaction.newSelection.map(originalToRewritten),
            effects: state_1.StateEffect.mapEffects(transaction.effects, originalToRewritten),
            annotations: [
                ...(addToHistory === undefined ? [] : [state_1.Transaction.addToHistory.of(addToHistory)]),
                ...(remote === undefined ? [] : [state_1.Transaction.remote.of(remote)]),
                ...(time === undefined ? [] : [state_1.Transaction.time.of(time)])
            ],
            ...(userEvent === undefined ? {} : { userEvent }),
            scrollIntoView: transaction.scrollIntoView
        };
    });
    return protectBlockIds ? [hider, protector] : [hider];
}
function buildBlockIdDecorations(view, blockIdRegex) {
    const builder = new state_1.RangeSetBuilder();
    for (const range of view.visibleRanges) {
        const text = view.state.doc.sliceString(range.from, range.to);
        blockIdRegex.lastIndex = 0;
        for (let match = blockIdRegex.exec(text); match; match = blockIdRegex.exec(text)) {
            const from = range.from + match.index;
            const to = from + match[0].length;
            builder.add(from, to, view_1.Decoration.replace({ inclusive: true }));
        }
    }
    return builder.finish();
}
function getProtectedBlockIdRanges(doc, blockIdRegex) {
    const text = doc.toString();
    const ranges = [];
    blockIdRegex.lastIndex = 0;
    for (let match = blockIdRegex.exec(text); match; match = blockIdRegex.exec(text)) {
        ranges.push({
            from: match.index,
            to: match.index + match[0].length
        });
    }
    return ranges;
}
function changeTouchesProtectedRanges(from, to, ranges) {
    return ranges.some((range) => changeTouchesProtectedRange(from, to, range));
}
function changeTouchesProtectedRange(from, to, range) {
    if (from === to) {
        return from > range.from && from <= range.to;
    }
    return from < range.to && to > range.from;
}
function getUnprotectedDeletionRanges(from, to, protectedRanges) {
    const deletionRanges = [];
    let cursor = from;
    for (const range of protectedRanges) {
        if (range.to <= cursor || range.from >= to) {
            continue;
        }
        if (cursor < range.from) {
            deletionRanges.push({
                from: cursor,
                to: Math.min(range.from, to)
            });
        }
        cursor = Math.max(cursor, range.to);
    }
    if (cursor < to) {
        deletionRanges.push({ from: cursor, to });
    }
    return deletionRanges.filter((range) => range.from < range.to);
}
function getStandaloneProtectedRangeMoveAfterParagraphBreak(doc, from, to, inserted, protectedRanges) {
    const insertedText = inserted.toString();
    if (from !== to || !insertedText.includes("\n")) {
        return null;
    }
    const protectedRange = protectedRanges.find((range) => from === range.from);
    if (!protectedRange) {
        return null;
    }
    const currentLine = doc.lineAt(protectedRange.from);
    const textBeforeBlockId = doc.sliceString(currentLine.from, protectedRange.from);
    const textAfterBlockId = doc.sliceString(protectedRange.to, currentLine.to);
    if (textBeforeBlockId.trim().length > 0 || textAfterBlockId.trim().length > 0 || currentLine.from === 0) {
        return null;
    }
    const previousLine = doc.lineAt(currentLine.from - 1);
    const previousLineText = doc.sliceString(previousLine.from, previousLine.to);
    if (previousLineText.trim().length === 0 || isFenceLine(previousLineText)) {
        return null;
    }
    const protectedText = doc.sliceString(protectedRange.from, protectedRange.to);
    const existingLineBreakLength = currentLine.from - previousLine.to;
    return {
        changes: [
            {
                from: previousLine.to,
                to: previousLine.to,
                insert: `${protectedText}${insertedText}`
            },
            {
                from: protectedRange.from,
                to: protectedRange.to,
                insert: ""
            }
        ],
        selectionAnchor: previousLine.to + protectedText.length + insertedText.length + existingLineBreakLength
    };
}
function changeCanBeRedirectedAroundProtectedRange(from, to, inserted, range) {
    if (inserted.length === 0) {
        return false;
    }
    if (from === to && (from === range.from || from === range.to)) {
        return true;
    }
    return from >= range.from && to <= range.to;
}
function getProtectedRangeInsertPosition(inserted, range) {
    return range.from;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
