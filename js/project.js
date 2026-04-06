/* ============================================================
   SkinApex - Project
   Represents one opened skin pack (ZIP/mcpack/mcaddon).
   Handles parsing manifest.json, skins.json, geometry files,
   file tree construction, and texture/blob extraction.
   ============================================================ */

(function () {
    'use strict';

    class Project {
        constructor(fileName, zip) {
            this.fileName = fileName;
            this.zip = zip;
            this.name = '';
            this.manifest = null;
            this.header = null;
            this.skins = [];
            this.skinsJsonFormat = null; // 'object' | 'array' | 'skins-array'
            this._skinsJsonRaw = null;
            this.fileTree = null;
            this.geometries = {};
            this.geometryList = [];
            this._geometrySources = new Map(); // geometry id -> source json path
            this._blobUrls = new Map();
            this.encryptionState = 'plain';
            this._encryptionCheckCache = new Map(); // path -> bool
            this._hasEncryptedFilesCache = null;
            this._hasContentsJsonCache = null;
            this._encryptedPathSetPromise = null;
            this._officialAnimations = null;
            this._officialAnimationLoad = null;
            this._officialAnimationFileIndex = null; // { filename: [animId, ...] }
            this._officialAnimationIdToFile = null;  // { animId: filename }
            this._officialAnimationFileCache = {};   // { filename: { animId: data } }
            this._officialAnimationSlotLoad = null;
            this._officialAnimationSlots = [];
        }

        /**
         * Factory: create a Project from a File object
         */
        static async fromFile(file) {
            const zip = await JSZip.loadAsync(file);
            const project = new Project(file.name, zip);
            await project.parse();
            return project;
        }

        /**
         * Factory: create a Project from a JSZip instance
         * Used when opening from a folder (files are collected into a zip).
         */
        static async fromZip(zip, name) {
            const project = new Project(name || 'SkinPack', zip);
            await project.parse();
            return project;
        }

        /**
         * Parse all pack data: manifest, skins, file tree, geometries
         */
        async parse() {
            // Check encryption state FIRST - before parsing any JSON files
            try {
                this.encryptionState = await this.hasEncryptedFiles() ? 'encrypted' : 'plain';
            } catch (e) {
                this.encryptionState = 'unknown';
            }
            
            // If encrypted, skip JSON parsing - just build file tree
            if (this.encryptionState === 'encrypted') {
                this._parseManifest();  // manifest should still be readable
                this._buildFileTree();
                // Don't try to parse encrypted JSON files
                return;
            }
            
            // Plain project - parse normally
            this._parseManifest();
            await this._parseSkins();
            this._buildFileTree();
            await this._loadGeometries();
        }

        // ---- Manifest ----

        _parseManifest() {
            const mf = this.zip.file('manifest.json');
            if (!mf) {
                this.name = this.fileName.replace(SkinApex.ACCEPTED_EXTENSIONS, '');
                return;
            }
            // Fallback name
            this.name = this.fileName.replace(SkinApex.ACCEPTED_EXTENSIONS, '');
            mf.async('string').then(str => {
                try {
                    this.manifest = JSON.parse(str);
                    if (this.manifest && this.manifest.header && this.manifest.header.name) {
                        this.header = this.manifest.header;
                        this.name = this.header.name;
                    }
                } catch (e) { /* ignore */ }
            }).catch(() => {});
        }

        // ---- Skins ----

        async _parseSkins() {
            const sf = this.zip.file('skins.json');
            if (!sf) return;

            try {
                const str = await sf.async('string');
                const data = JSON.parse(str);
                this._skinsJsonRaw = data;
                this._parseSkinsData(data);
            } catch (e) {
                console.warn('Failed to parse skins.json:', e);
            }
        }

        _parseSkinsData(data) {
            if (Array.isArray(data)) {
                this.skinsJsonFormat = 'array';
                data.forEach((skin, i) => {
                    this.skins.push(this._makeSkinEntry(
                        skin.geometry || ('skin_' + i),
                        skin,
                        'Skin ' + (i + 1)
                    ));
                });
            } else if (typeof data === 'object') {
                if (data.skins && Array.isArray(data.skins)) {
                    this.skinsJsonFormat = 'skins-array';
                    data.skins.forEach((skin, i) => {
                        this.skins.push(this._makeSkinEntry(
                            skin.geometry || skin.localization_name || ('skin_' + i),
                            skin,
                            'Skin ' + (i + 1)
                        ));
                    });
                } else {
                    this.skinsJsonFormat = 'object';
                    for (const [key, skin] of Object.entries(data)) {
                        if (typeof skin === 'object' && skin !== null) {
                            this.skins.push(this._makeSkinEntry(key, skin, key));
                        }
                    }
                }
            }
        }

        _makeSkinEntry(id, skinData, fallbackName) {
            return {
                id: id,
                name: skinData.localization_name || skinData.name || fallbackName,
                geometry: skinData.geometry || null,
                texturePath: skinData.texture_path || skinData.texture || null,
                type: skinData.type || 'skin',
                animations: skinData.animations || {},
                data: skinData,
            };
        }

        /**
         * Load the lightweight index.json and return the list of all
         * official animation IDs (for autocomplete / picker).
         * No animation file bodies are fetched at this stage.
         */
        async getOfficialAnimationIndex() {
            if (this._officialAnimationLoad) return this._officialAnimationLoad;

            this._officialAnimationLoad = (async () => {
                try {
                    var indexRes = await fetch('vendor/official-animations/index.json');
                    if (!indexRes.ok) {
                        throw new Error('index.json (' + indexRes.status + ')');
                    }
                    var fileIndex = await indexRes.json();
                    if (!fileIndex || typeof fileIndex !== 'object' || Object.keys(fileIndex).length === 0) {
                        throw new Error('index.json is empty or invalid');
                    }
                    this._officialAnimationFileIndex = fileIndex;

                    // Build reverse map: animationId -> filename
                    var idToFile = {};
                    Object.keys(fileIndex).forEach(function (filename) {
                        var ids = fileIndex[filename];
                        if (Array.isArray(ids)) {
                            ids.forEach(function (id) { idToFile[id] = filename; });
                        }
                    });
                    this._officialAnimationIdToFile = idToFile;
                    this._officialAnimations = idToFile; // keep compat: truthy object

                    return idToFile;
                } catch (err) {
                    this._officialAnimations = {};
                    this._officialAnimationLoad = null;
                    throw new Error('Official animation index file could not be loaded: ' + (err && err.message ? err.message : 'request failed'));
                }
            })();

            return this._officialAnimationLoad;
        }

        /**
         * Return the list of all official animation IDs (strings).
         * Requires getOfficialAnimationIndex() to have completed.
         */
        getOfficialAnimationIds() {
            return this._officialAnimationIdToFile ? Object.keys(this._officialAnimationIdToFile) : [];
        }

        async getOfficialAnimationSlots() {
            if (this._officialAnimationSlotLoad) return this._officialAnimationSlotLoad;

            this._officialAnimationSlotLoad = (async () => {
                try {
                    var res = await fetch('vendor/official-animations/slot-index.json');
                    if (!res.ok) {
                        throw new Error('slot-index.json (' + res.status + ')');
                    }
                    var slots = await res.json();
                    if (!Array.isArray(slots)) {
                        throw new Error('slot-index.json is invalid');
                    }
                    this._officialAnimationSlots = slots;
                    return slots;
                } catch (err) {
                    this._officialAnimationSlotLoad = null;
                    throw new Error('Official animation slot index could not be loaded: ' + (err && err.message ? err.message : 'request failed'));
                }
            })();

            return this._officialAnimationSlotLoad;
        }

        getLoadedOfficialAnimationSlots() {
            return Array.isArray(this._officialAnimationSlots) ? this._officialAnimationSlots.slice() : [];
        }

        /**
         * Lazily load & cache a single animation file body, then return
         * the animation data object for the requested animationId.
         * Returns null if the ID is unknown or the file fails to load.
         */
        async getOfficialAnimation(animationId) {
            if (!this._officialAnimationIdToFile) return null;
            var filename = this._officialAnimationIdToFile[animationId];
            if (!filename) return null;

            // Already cached?
            if (this._officialAnimationFileCache[filename]) {
                return this._officialAnimationFileCache[filename][animationId] || null;
            }

            // Fetch & cache all animations in that file
            try {
                var res = await fetch('vendor/official-animations/' + filename);
                if (!res.ok) return null;
                var raw = await res.text();
                var cleaned = raw.replace(/\/\/.*$/gm, '').replace(/,\s*([\]}])/g, '$1');
                var json = JSON.parse(cleaned);
                var anims = json && json.animations ? json.animations : {};
                this._officialAnimationFileCache[filename] = anims;
                return anims[animationId] || null;
            } catch (err) {
                console.warn('Failed to load animation file:', filename, err);
                this._officialAnimationFileCache[filename] = {};
                return null;
            }
        }

        /**
         * Batch-load animation data for a set of animation IDs.
         * Returns { animationId: data } for all IDs that resolved.
         */
        async getOfficialAnimations(animationIds) {
            if (!Array.isArray(animationIds) || !this._officialAnimationIdToFile) return {};

            // Group by filename to avoid fetching the same file multiple times
            var fileGroups = {};
            animationIds.forEach((id) => {
                var filename = this._officialAnimationIdToFile[id];
                if (!filename) return;
                if (!fileGroups[filename]) fileGroups[filename] = [];
                fileGroups[filename].push(id);
            });

            // Fetch all needed files in parallel
            var filenames = Object.keys(fileGroups);
            await Promise.all(filenames.map((filename) => {
                if (this._officialAnimationFileCache[filename]) return Promise.resolve();
                return fetch('vendor/official-animations/' + filename)
                    .then((res) => res.ok ? res.text() : '')
                    .then((raw) => {
                        if (!raw) { this._officialAnimationFileCache[filename] = {}; return; }
                        var cleaned = raw.replace(/\/\/.*$/gm, '').replace(/,\s*([\]}])/g, '$1');
                        var json = JSON.parse(cleaned);
                        this._officialAnimationFileCache[filename] = json && json.animations ? json.animations : {};
                    })
                    .catch(() => { this._officialAnimationFileCache[filename] = {}; });
            }));

            var result = {};
            animationIds.forEach((id) => {
                var filename = this._officialAnimationIdToFile[id];
                if (filename && this._officialAnimationFileCache[filename] && this._officialAnimationFileCache[filename][id]) {
                    result[id] = this._officialAnimationFileCache[filename][id];
                }
            });
            return result;
        }

        // ---- File Tree ----

        _buildFileTree() {
            const root = { name: this.name || this.fileName, type: 'folder', children: {}, path: '' };
            this.zip.forEach((relativePath, file) => {
                if (file.dir) return;
                const parts = relativePath.split('/');
                let current = root;
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    if (!part) continue;
                    if (i === parts.length - 1) {
                        current.children[part] = {
                            name: part,
                            type: 'file',
                            path: relativePath,
                            zipEntry: file,
                        };
                    } else {
                        if (!current.children[part]) {
                            current.children[part] = {
                                name: part,
                                type: 'folder',
                                children: {},
                                path: parts.slice(0, i + 1).join('/'),
                            };
                        }
                        current = current.children[part];
                    }
                }
            });
            this.fileTree = root;
        }

        // ---- Geometries ----

        /**
         * Remove JS-style comments from JSON strings
         * Handles // line comments and /* block comments *\/
         * Preserves strings that contain comment-like sequences
         */
        _removeComments(jsonStr) {
            // Remove block comments
            var cleaned = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '');
            // Remove line comments (but not inside strings)
            cleaned = cleaned.replace(/(".*?")|(\/\/.*)/g, function(match, str) {
                return str || '';
            });
            // Remove blank lines left behind
            cleaned = cleaned.replace(/^\s*[\r\n]/gm, '');
            return cleaned.trim();
        }

        /**
         * Fix common JSON syntax issues:
         * - Trailing commas before } or ]
         * - Unquoted property names
         * - Single quotes instead of double quotes
         */
        _fixJsonSyntax(jsonStr) {
            var fixed = jsonStr;
            // Remove block comments
            fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');
            // Remove line comments
            fixed = fixed.replace(/\/\/.*$/gm, '');
            // Remove trailing commas before } or ]
            fixed = fixed.replace(/,\s*([}\]])/g, '$1');
            // Remove blank lines
            fixed = fixed.replace(/^\s*\n/gm, '');
            return fixed;
        }

        /**
         * Remove "geometry.null": {} entries (common in non-standard packs)
         */
        _removeGeometryNull(jsonStr) {
            return jsonStr
                .replace(/,\s*"geometry\.null"\s*:\s*\{\s*\}/g, '')
                .replace(/"geometry\.null"\s*:\s*\{\s*\},?/g, '');
        }

        /**
         * Parse geometry data from a JSON object
         * Handles both standard minecraft:geometry array format
         * and direct geometry.xxx key format (some non-standard packs)
         */
        _parseGeometryData(data) {
            const result = {};

            // Standard format: { "minecraft:geometry": [ { description: { identifier: "geometry.xxx" }, bones: [...] }, ... ] }
            if (data['minecraft:geometry'] && Array.isArray(data['minecraft:geometry'])) {
                data['minecraft:geometry'].forEach(function(item) {
                    if (item.description && item.description.identifier) {
                        result[item.description.identifier] = item;
                    } else {
                        // Some packs nest geometry.xxx inside the array items
                        Object.entries(item).forEach(function(entry) {
                            var key = entry[0], value = entry[1];
                            if (key.indexOf('geometry.') === 0) {
                                result[key] = value;
                            }
                        });
                    }
                });
            }

            // Non-standard format: { "geometry.humanoid.custom": { bones: [...] }, ... }
            Object.entries(data).forEach(function(entry) {
                var key = entry[0], value = entry[1];
                if (key.indexOf('geometry.') === 0 && !result[key]) {
                    result[key] = value;
                }
            });

            return result;
        }

        async _loadGeometries() {
            const geoFiles = [];
            this.zip.forEach((path, file) => {
                if (!file.dir && path.toLowerCase().includes('geometry') && path.toLowerCase().endsWith('.json')) {
                    geoFiles.push(file);
                }
            });

            for (const gf of geoFiles) {
                try {
                    let str = await gf.async('string');

                    // Pre-process: remove comments and fix common issues
                    let cleaned = this._removeComments(str);
                    cleaned = this._removeGeometryNull(cleaned);

                    let data;
                    try {
                        data = JSON.parse(cleaned);
                    } catch (e1) {
                        // If first parse fails, try more aggressive fixing
                        console.warn('Geometry parse failed, retrying with aggressive fix:', gf.name);
                        try {
                            data = JSON.parse(this._fixJsonSyntax(cleaned));
                        } catch (e2) {
                            console.warn('Could not parse geometry file:', gf.name, e2.message);
                            continue;
                        }
                    }

                    // Parse geometry entries (handles both standard and non-standard formats)
                    const parsed = this._parseGeometryData(data);

                    for (const [id, geo] of Object.entries(parsed)) {
                        this.geometries[id] = geo;
                        this._geometrySources.set(id, gf.name);
                        this.geometryList.push({
                            id: id,
                            visibleBounds: (geo.description && geo.description.visible_bounds_width) || 0,
                            boneCount: (geo.bones || []).length,
                            textureWidth: (geo.description && geo.description.texture_width) || 0,
                            textureHeight: (geo.description && geo.description.texture_height) || 0,
                        });
                    }
                } catch (e) {
                    console.warn('Failed to load geometry file:', gf.name, e.message);
                }
            }

            // Inject built-in Mojang geometries for skins that reference them
            // but the pack doesn't include its own definition
            this._injectBuiltinGeometries();
        }

        /**
         * Inject built-in Mojang geometry definitions for skins that reference
         * standard geometries (e.g. geometry.humanoid.custom) but the pack
         * doesn't include its own geometry.json file.
         */
        _injectBuiltinGeometries() {
            var builtins = SkinApex.BUILTIN_GEOMETRIES;
            if (!builtins) return;

            var referencedIds = new Set();
            for (var i = 0; i < this.skins.length; i++) {
                if (this.skins[i].geometry) {
                    referencedIds.add(this.skins[i].geometry);
                }
            }

            for (var id of referencedIds) {
                if (!this.geometries[id] && builtins[id]) {
                    var geo = builtins[id];
                    this.geometries[id] = geo;
                    this._geometrySources.set(id, null);
                    this.geometryList.push({
                        id: id,
                        visibleBounds: (geo.description && geo.description.visible_bounds_width) || 0,
                        boneCount: (geo.bones || []).length,
                        textureWidth: (geo.description && geo.description.texture_width) || 0,
                        textureHeight: (geo.description && geo.description.texture_height) || 0,
                        builtin: true
                    });
                }
            }
        }

        // ---- Blob Extraction (cached) ----

        async getTextureBlobUrl(texturePath) {
            if (!texturePath) return null;
            if (this._blobUrls.has(texturePath)) return this._blobUrls.get(texturePath);

            const file = this.zip.file(texturePath) ||
                         this.zip.file(texturePath.replace(/^\//, ''));
            if (!file) return null;

            try {
                const blob = await file.async('blob');
                const url = URL.createObjectURL(blob);
                this._blobUrls.set(texturePath, url);
                return url;
            } catch (e) {
                return null;
            }
        }

        async getFileText(path) {
            const f = this.zip.file(path);
            if (!f) return null;
            try {
                return await f.async('string');
            } catch (e) {
                return null;
            }
        }

        async getFileBlobUrl(path) {
            if (this._blobUrls.has(path)) return this._blobUrls.get(path);
            const f = this.zip.file(path);
            if (!f) return null;
            try {
                const blob = await f.async('blob');
                const url = URL.createObjectURL(blob);
                this._blobUrls.set(path, url);
                return url;
            } catch (e) {
                return null;
            }
        }

        // ---- File Operations ----

        _joinPath(parentPath, name) {
            var p = (parentPath || '').replace(/^\/+|\/+$/g, '');
            var n = (name || '').replace(/^\/+|\/+$/g, '');
            if (!p) return n;
            if (!n) return p;
            return p + '/' + n;
        }

        _collectEntriesUnder(folderPath) {
            var prefix = folderPath.replace(/\/+$/g, '') + '/';
            var list = [];
            this.zip.forEach(function (path, file) {
                if (!file.dir && path.indexOf(prefix) === 0) {
                    list.push(path);
                }
            });
            return list;
        }

        async createFile(parentPath, name, content) {
            var filePath = this._joinPath(parentPath, name);
            if (!filePath) throw new Error('Invalid file path');
            this.zip.file(filePath, content || '');
            this._buildFileTree();
            return filePath;
        }

        async createFolder(parentPath, name) {
            var folderPath = this._joinPath(parentPath, name);
            if (!folderPath) throw new Error('Invalid folder path');
            this.zip.folder(folderPath);
            this._buildFileTree();
            return folderPath;
        }

        async deletePath(path, type) {
            if (!path) return;
            if (type === 'folder') {
                this.zip.remove(path);
            } else {
                this.zip.remove(path);
            }
            this._buildFileTree();
        }

        async copyPath(path, type, targetParentPath) {
            if (!path) return;
            var baseName = path.split('/').pop();
            var outPath = this._joinPath(targetParentPath, baseName);

            if (type === 'folder') {
                var entries = this._collectEntriesUnder(path);
                for (var i = 0; i < entries.length; i++) {
                    var oldPath = entries[i];
                    var rel = oldPath.slice(path.replace(/\/+$/g, '').length + 1);
                    var newPath = this._joinPath(outPath, rel);
                    var data = await this.zip.file(oldPath).async('uint8array');
                    this.zip.file(newPath, data);
                }
            } else {
                var f = this.zip.file(path);
                if (!f) throw new Error('Source file not found');
                var fileData = await f.async('uint8array');
                this.zip.file(outPath, fileData);
            }

            this._buildFileTree();
            return outPath;
        }

        async renamePath(path, type, newName) {
            var parent = '';
            var idx = path.lastIndexOf('/');
            if (idx >= 0) parent = path.slice(0, idx);
            return await this.movePath(path, type, parent, newName);
        }

        async movePath(path, type, targetParentPath, forcedName) {
            if (!path) return;
            var baseName = forcedName || path.split('/').pop();
            var newRootPath = this._joinPath(targetParentPath, baseName);

            if (type === 'folder') {
                var entries = this._collectEntriesUnder(path);
                for (var i = 0; i < entries.length; i++) {
                    var oldPath = entries[i];
                    var rel = oldPath.slice(path.replace(/\/+$/g, '').length + 1);
                    var newPath = this._joinPath(newRootPath, rel);
                    var data = await this.zip.file(oldPath).async('uint8array');
                    this.zip.file(newPath, data);
                }
                this.zip.remove(path);
            } else {
                var f = this.zip.file(path);
                if (!f) throw new Error('Source file not found');
                var fileData = await f.async('uint8array');
                this.zip.file(newRootPath, fileData);
                this.zip.remove(path);
            }

            this._buildFileTree();
            return newRootPath;
        }

        /**
         * Remove a skin entry from the list
         */
        removeSkin(index) {
            if (index >= 0 && index < this.skins.length) {
                this.skins.splice(index, 1);
            }
        }

        /**
         * Free all cached blob URLs to release memory
         */
        cleanup() {
            for (const url of this._blobUrls.values()) {
                URL.revokeObjectURL(url);
            }
            this._blobUrls.clear();
            this._encryptionCheckCache.clear();
            this._hasEncryptedFilesCache = null;
            this._hasContentsJsonCache = null;
            this._encryptedPathSetPromise = null;
        }

        _normalizePath(path) {
            return String(path || '')
                .replace(/\\/g, '/')
                .replace(/^\/+/, '')
                .replace(/\/+/g, '/');
        }

        _resolveZipFile(path) {
            var normalized = this._normalizePath(path);
            var direct = this.zip.file(normalized) || this.zip.file('/' + normalized);
            if (direct) return direct;

            var found = null;
            this.zip.forEach(function (zipPath, file) {
                if (found || file.dir) return;
                if (zipPath === normalized) {
                    found = file;
                    return;
                }
                // Fallback for path nesting differences (e.g. dropped folder roots)
                if (zipPath.endsWith('/' + normalized) || normalized.endsWith('/' + zipPath)) {
                    found = file;
                }
            });
            return found;
        }

        async isPathEncrypted(path) {
            if (!path) return false;
            var normalized = this._normalizePath(path);
            if (this._encryptionCheckCache.has(normalized)) return this._encryptionCheckCache.get(normalized);
            var encryptedSet = await this._getEncryptedPathSet();
            var result = encryptedSet.has(normalized);
            this._encryptionCheckCache.set(normalized, result);
            return result;
        }

        async hasEncryptedFiles() {
            if (this._hasEncryptedFilesCache !== null) return this._hasEncryptedFilesCache;
            var set = await this._getEncryptedPathSet();
            this._hasEncryptedFilesCache = set.size > 0;
            return this._hasEncryptedFilesCache;
        }

        async hasContentsJson() {
            if (this._hasContentsJsonCache !== null) return this._hasContentsJsonCache;

            var has = !!(this.zip.file('contents.json') || this.zip.file('/contents.json'));
            if (!has) {
                this.zip.forEach(function (p, f) {
                    if (has || f.dir) return;
                    if (p.toLowerCase().endsWith('/contents.json')) has = true;
                });
            }
            this._hasContentsJsonCache = has;
            return has;
        }

        _detectDecryptedByHeader(name, data) {
            var lower = String(name || '').toLowerCase();
            if (lower.endsWith('.png')) {
                return this._startsWithBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            }
            if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
                return this._startsWithBytes(data, [0xff, 0xd8, 0xff]);
            }
            if (lower.endsWith('.gif')) {
                return this._startsWithText(data, 'GIF87a') || this._startsWithText(data, 'GIF89a');
            }
            if (lower.endsWith('.bmp')) {
                return this._startsWithText(data, 'BM');
            }
            if (lower.endsWith('.lang')) {
                var text = this._safeTextHead(data, 256);
                if (/\S+\s*=\s*.+/.test(text)) return true;
                return null;
            }
            if (lower.endsWith('.json') || lower.endsWith('.mcmeta')) {
                var text2 = this._safeTextHead(data, 128).replace(/^\uFEFF/, '').trimStart();
                return text2.startsWith('{') || text2.startsWith('[');
            }
            return null;
        }

        _startsWithBytes(data, bytes) {
            if (!data || data.length < bytes.length) return false;
            for (var i = 0; i < bytes.length; i++) {
                if (data[i] !== bytes[i]) return false;
            }
            return true;
        }

        _startsWithText(data, text) {
            return this._safeTextHead(data, text.length) === text;
        }

        _safeTextHead(data, max) {
            try {
                return new TextDecoder().decode(data.subarray(0, max));
            } catch (e) {
                return '';
            }
        }

        _isEncryptedContentsBinary(data) {
            if (!data || data.length < 0x20) return false;
            try {
                var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
                var version = view.getUint32(0, true);
                var magic = view.getUint32(4, true);
                return version === 0 && magic === 0x9bcfb9fc;
            } catch (e) {
                return false;
            }
        }

        async _getEncryptedPathSet() {
            if (this._encryptedPathSetPromise) return this._encryptedPathSetPromise;

            var self = this;
            this._encryptedPathSetPromise = (async function () {
                var encrypted = new Set();

                var contentsPath = null;
                if (self.zip.file('contents.json')) contentsPath = 'contents.json';
                else if (self.zip.file('/contents.json')) contentsPath = '/contents.json';
                else {
                    self.zip.forEach(function (p, f) {
                        if (!contentsPath && !f.dir && p.toLowerCase().endsWith('/contents.json')) contentsPath = p;
                    });
                }

                // 1) Use contents.json hints when available (mcpts-style)
                if (contentsPath) {
                    try {
                        var contentsFile = self.zip.file(contentsPath);
                        var bytes = await contentsFile.async('uint8array');

                        // Encrypted contents.json itself
                        if (self._isEncryptedContentsBinary(bytes)) {
                            encrypted.add(self._normalizePath(contentsPath));

                            // Unknown key state: run header heuristics on all files
                            var all = [];
                            self.zip.forEach(function (p, f) { if (!f.dir) all.push(p); });
                            for (var ai = 0; ai < all.length; ai++) {
                                var ap = self._normalizePath(all[ai]);
                                if (ap.endsWith('manifest.json') || ap.endsWith('pack_icon.png')) continue;
                                var af = self.zip.file(all[ai]);
                                if (!af) continue;
                                var ad = await af.async('uint8array');
                                var status = self._detectDecryptedByHeader(ap.split('/').pop(), ad);
                                if (status === false) encrypted.add(ap);
                            }
                        } else {
                            // Plain contents.json: parse key-bearing entries and apply header heuristics
                            var text = new TextDecoder().decode(bytes);
                            var parsed = JSON.parse(text);
                            var keyPaths = [];
                            if (parsed && Array.isArray(parsed.content)) {
                                for (var ci = 0; ci < parsed.content.length; ci++) {
                                    var entry = parsed.content[ci];
                                    if (!entry || !entry.key || !entry.path) continue;
                                    var pp = self._normalizePath(String(entry.path).replace(/^\.\//, ''));
                                    if (!pp.endsWith('/')) keyPaths.push(pp);
                                }
                            }

                            for (var ki = 0; ki < keyPaths.length; ki++) {
                                var kp = keyPaths[ki];
                                var kf = self._resolveZipFile(kp);
                                if (!kf) continue;
                                var kd = await kf.async('uint8array');
                                var kstatus = self._detectDecryptedByHeader(kp.split('/').pop(), kd);
                                if (kstatus === false) encrypted.add(kp);
                            }
                        }
                    } catch (e) {
                        // Ignore contents parsing failures; fallback to marker scan
                    }
                }

                // 2) Fallback marker scan for files not already decided
                var files = [];
                self.zip.forEach(function (p, f) {
                    if (!f.dir) files.push(p);
                });
                for (var i = 0; i < files.length; i++) {
                    var np = self._normalizePath(files[i]);
                    if (encrypted.has(np)) continue;
                    var ff = self.zip.file(files[i]);
                    if (!ff) continue;
                    var fd = await ff.async('uint8array');
                    if (fd && fd.length >= (1 + 12 + 16) && fd[0] === 0x01) {
                        encrypted.add(np);
                    }
                }

                return encrypted;
            })();

            return this._encryptedPathSetPromise;
        }

        // ---- Export / Save ----

        _serializeSkinsJson() {
            var skinObjs = this.skins.map(function (skin) {
                var out = Object.assign({}, skin.data || {});
                if (skin.geometry) out.geometry = skin.geometry;
                if (skin.texturePath) {
                    if (out.texture_path !== undefined) out.texture_path = skin.texturePath;
                    else out.texture = skin.texturePath;
                }
                if (skin.name) {
                    if (out.localization_name !== undefined) out.localization_name = skin.name;
                    else if (out.name !== undefined) out.name = skin.name;
                }
                return out;
            });

            if (this.skinsJsonFormat === 'array') {
                return skinObjs;
            }

            if (this.skinsJsonFormat === 'skins-array') {
                var base = (this._skinsJsonRaw && typeof this._skinsJsonRaw === 'object' && !Array.isArray(this._skinsJsonRaw))
                    ? Object.assign({}, this._skinsJsonRaw)
                    : {};
                base.skins = skinObjs;
                return base;
            }

            // object map format
            var map = {};
            for (var i = 0; i < this.skins.length; i++) {
                var key = this.skins[i].id || ('skin_' + i);
                map[key] = skinObjs[i];
            }
            return map;
        }

        _serializeGeometryJson(ids) {
            var list = [];
            for (var i = 0; i < ids.length; i++) {
                var id = ids[i];
                var geo = this.geometries[id];
                if (!geo) continue;
                var entry = JSON.parse(JSON.stringify(geo));
                if (!entry.description) entry.description = {};
                if (!entry.description.identifier) entry.description.identifier = id;
                list.push(entry);
            }
            return {
                format_version: '1.12.0',
                'minecraft:geometry': list
            };
        }

        async exportBlob() {
            // Keep original encrypted skins.json intact if parsing never produced editable skin data.
            if (this.skins.length > 0 || this._skinsJsonRaw) {
                var skinsOut = this._serializeSkinsJson();
                this.zip.file('skins.json', JSON.stringify(skinsOut));
            }
            // If skins is empty and parsing never succeeded, keep the original file as-is.

            // Group geometries by their source file path
            var groups = new Map(); // path -> [geoId]
            for (const id of Object.keys(this.geometries)) {
                var src = this._geometrySources.has(id) ? this._geometrySources.get(id) : null;
                var path = src || 'geometry.json';
                if (!groups.has(path)) groups.set(path, []);
                groups.get(path).push(id);
            }

            for (const [path, ids] of groups.entries()) {
                var geoOut = this._serializeGeometryJson(ids);
                this.zip.file(path, JSON.stringify(geoOut));
            }

            return await this.zip.generateAsync({ type: 'blob' });
        }
    }

    window.SkinApex.Project = Project;
})();
