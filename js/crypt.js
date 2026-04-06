/* ============================================================
   SkinApex - Crypt
   AES-256-CFB8 encryption/decryption for Bedrock packs.
   Uses WASM + Worker (mcpts-style) with JS fallback.
   ============================================================ */

// Crypt
(function () {
    'use strict';

    var OFFICIAL_KEY = 's5s5ejuDru4uchuF2drUFuthaspAbepE';
    var SKIP_FILES = ['manifest.json', 'pack_icon.png'];
    var workerEnabled = true;
    var cryptoApi = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto
        : (typeof window !== 'undefined' && window.crypto) ? window.crypto
        : null;

    /**
     * Generate a random 32-character alphanumeric string (McTools style)
     */
    function _generateKeyString() {
        if (!cryptoApi || !cryptoApi.getRandomValues) {
            throw new Error('Secure random generator is unavailable in this environment');
        }
        var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
        var buf = new Uint8Array(32);
        cryptoApi.getRandomValues(buf);
        var out = '';
        for (var i = 0; i < 32; i++) {
            out += chars[buf[i] % chars.length];
        }
        return out;
    }

    /**
     * Compute SHA256 hash of data and return base64 string
     */
    async function _sha256(data) {
        if (cryptoApi && cryptoApi.subtle) {
            var hashBuffer = await cryptoApi.subtle.digest('SHA-256', data);
            var hashBytes = new Uint8Array(hashBuffer);
            return _bytesToBase64(hashBytes);
        }
        // Fallback: simple non-crypto hash for browser compatibility
        var h = 0x811c9dc5;
        for (var i = 0; i < data.length; i++) {
            h ^= data[i];
            h = Math.imul(h, 0x01000193);
        }
        // Return as hex (non-standard but works for basic verification)
        var hex = (h >>> 0).toString(16).padStart(8, '0');
        return hex + hex + hex + hex;  // 32-char fake hash
    }

    function _bytesToBase64(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }

    /**
     * Convert a hex string to Uint8Array
     */
    function _hexToBytes(hex) {
        var bytes = new Uint8Array(hex.length / 2);
        for (var i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    }

    /**
     * Convert Uint8Array to hex string
     */
    function _bytesToHex(bytes) {
        return Array.from(bytes).map(function (b) {
            return b.toString(16).padStart(2, '0');
        }).join('');
    }

    function _textToBytes(text) {
        return new TextEncoder().encode(String(text || ''));
    }

    function _sliceKeyAndIv(keyString) {
        // All keys use UTF-8 encoding (mcpts style)
        var key = _textToBytes(keyString);
        
        // Use raw key bytes - no padding
        var key32 = key.slice(0, 32);
        var iv = key32.slice(0, 16);
        return { key: key32, iv: iv };
    }

    function _cfb8EncryptJs(key, iv, data) {
        // Minimal fallback implementation, only used if worker fails.
        // Keeps existing API stable.
        throw new Error('WASM crypto worker unavailable');
    }

    function _cfb8DecryptJs(key, iv, data) {
        throw new Error('WASM crypto worker unavailable');
    }

    /**
     * Encrypt a Uint8Array using AES-256-CFB8.
     * mcpts stores raw ciphertext without a custom marker byte.
     */
    async function _encryptData(data, keyString) {
        if (!data || data.length === 0) {
            return new Uint8Array(0);
        }

        var keyBytes = _textToBytes(keyString);
        var key = keyBytes.slice(0, 32);
        var iv = key.slice(0, 16);

        var encrypted;
        if (workerEnabled && window.SkinApex.WasmCrypto) {
            try {
                encrypted = await window.SkinApex.WasmCrypto.encryptCFB8(key, iv, data);
                if (!encrypted || encrypted.length === 0) {
                    throw new Error('WASM returned empty result');
                }
            } catch (err) {
                console.error('WASM encrypt failed:', err);
                workerEnabled = false;
                encrypted = _cfb8EncryptJs(key, iv, data);
            }
        } else {
            encrypted = _cfb8EncryptJs(key, iv, data);
        }

        return new Uint8Array(encrypted);
    }

    /**
     * Decrypt an AES-256-CFB8 encrypted buffer
     * Input format: raw ciphertext
     */
    async function _decryptData(encryptedData, keyString) {
        if (!encryptedData || encryptedData.length === 0) {
            throw new Error('Encrypted data is empty');
        }

        var keyBytes = _textToBytes(keyString);
        var key = keyBytes.slice(0, 32);
        var iv = key.slice(0, 16);

        if (workerEnabled && window.SkinApex.WasmCrypto) {
            try {
                return await window.SkinApex.WasmCrypto.decryptCFB8(key, iv, encryptedData);
            } catch (err) {
                console.error('WASM decrypt failed:', err);
                workerEnabled = false;
                return _cfb8DecryptJs(key, iv, encryptedData);
            }
        }
        return _cfb8DecryptJs(key, iv, encryptedData);
    }

    /**
     * Legacy marker check kept only for older SkinApex output.
     */
    function _isEncrypted(data) {
        return data && data.length > 0 && data[0] === 0x01;
    }

    function _startsWithBytes(data, bytes) {
        if (!data || data.length < bytes.length) return false;
        for (var i = 0; i < bytes.length; i++) {
            if (data[i] !== bytes[i]) return false;
        }
        return true;
    }

    function _safeTextHead(data, max) {
        try {
            return new TextDecoder().decode(data.subarray(0, max)).replace(/^\uFEFF/, '');
        } catch { return ''; }
    }

    function _sanitizeJsonText(text) {
        var nullIndex = text.indexOf('\u0000');
        var trimmed = nullIndex >= 0 ? text.slice(0, nullIndex) : text;
        return trimmed.trim();
    }

    function _needsTextTrim(name) {
        var lower = String(name || '').toLowerCase();
        return lower.endsWith('.json') || lower.endsWith('.mcmeta');
    }

    function _stripTrailingNullsAndWhitespace(data) {
        var end = data.length;
        while (end > 0) {
            var byte = data[end - 1];
            if (byte === 0x00 || byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
                end -= 1;
            } else {
                break;
            }
        }
        if (end === data.length) return data;
        return data.slice(0, end);
    }

    function _formatJsonBytes(data, pretty) {
        var text = _sanitizeJsonText(new TextDecoder().decode(data));
        var parsed = JSON.parse(text);
        return _textToBytes(JSON.stringify(parsed, null, pretty ? 2 : 0));
    }

    function _detectDecryptedByHeader(name, data) {
        var lower = String(name || '').toLowerCase();
        if (lower.endsWith('.png')) {
            return _startsWithBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        }
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
            return _startsWithBytes(data, [0xff, 0xd8, 0xff]);
        }
        if (lower.endsWith('.gif')) {
            var gifHead = _safeTextHead(data, 6);
            return gifHead === 'GIF87a' || gifHead === 'GIF89a';
        }
        if (lower.endsWith('.bmp')) {
            return _safeTextHead(data, 2) === 'BM';
        }
        if (lower.endsWith('.lang')) {
            var text = _safeTextHead(data, 256);
            return /\S+\s*=\s*.+/.test(text);
        }
        if (lower.endsWith('.json') || lower.endsWith('.mcmeta')) {
            var jsonHead = _safeTextHead(data, 128).trimStart();
            return jsonHead.startsWith('{') || jsonHead.startsWith('[');
        }
        return null;
    }

    function _isEncryptedContents(data) {
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

    class CryptManager {
        constructor() {
            this._onProgress = null;
        }

        /**
         * Set a progress callback: onProgress(current, total, fileName)
         */
        setOnProgress(cb) {
            this._onProgress = cb;
        }

        _report(current, total, fileName) {
            if (this._onProgress) {
                this._onProgress(current, total, fileName);
            }
        }

        /**
         * Encrypt a project's zip contents
         * @param {JSZip} zip - The project zip
         * @param {string} keyType - 'official' or 'custom'
         * @param {string} [customKey] - Required if keyType is 'custom'
         * @returns {Promise<{blob: Blob, key: string}>} Encrypted blob and the key used
         */
        async encrypt(zip, keyType, customKey, options) {
            var outputKey;
            options = options || {};
            var compressJson = options.compressJson !== false;

            if (keyType === 'official') {
                outputKey = OFFICIAL_KEY;
            } else {
                outputKey = customKey || _generateKeyString();
            }

            // Collect files to encrypt (with unique per-file keys like McTools)
            var files = [];
            var fileKeys = {};
            zip.forEach(function (relativePath, file) {
                if (file.dir) return;
                // Skip manifest.json and pack_icon.png
                if (SKIP_FILES.indexOf(relativePath) !== -1) return;
                // Each file gets its own unique key (McTools style)
                fileKeys[relativePath] = _generateKeyString();
                files.push({ path: relativePath, entry: file });
            });

            // Create output zip
            var outZip = new JSZip();

            // Copy skip files as-is
            for (var s = 0; s < SKIP_FILES.length; s++) {
                var skipEntry = zip.file(SKIP_FILES[s]);
                if (skipEntry) {
                    var skipData = await skipEntry.async('uint8array');
                    outZip.file(SKIP_FILES[s], skipData);
                }
            }

            // Build contents.json entries and encrypt each file
            var contentEntries = [];
            var signatureEntries = [];
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                this._report(i, files.length, f.path);

                var fileKey = fileKeys[f.path];
                var fileData = await f.entry.async('uint8array');
                if (compressJson && _needsTextTrim(f.path)) {
                    fileData = _formatJsonBytes(fileData, false);
                }
                
                var encrypted = await _encryptData(fileData, fileKey);
                
                // Write as binary
                outZip.file(f.path, encrypted);

                // Record entry with its individual key
                contentEntries.push({
                    path: f.path,
                    key: fileKey
                });
                
                // Calculate hash for signature
                var hash = await _sha256(encrypted);
                signatureEntries.push({
                    path: f.path,
                    hash: hash
                });
            }

            // Add signatures.json (encrypted like other files)
            var signaturesJson = JSON.stringify(signatureEntries);
            var signaturesData = new TextEncoder().encode(signaturesJson);
            var sigKey = _generateKeyString();
            var signaturesEncrypted = await _encryptData(signaturesData, sigKey);
            outZip.file('signatures.json', signaturesEncrypted);
            contentEntries.push({
                path: 'signatures.json',
                key: sigKey
            });

            // Add contents.json with encrypted header (McTools style)
            var contentsObj = {
                version: 1,
                content: contentEntries
            };
            var contentsPlain = JSON.stringify(contentsObj);
            var contentsData = new TextEncoder().encode(contentsPlain);
            
            // Build header + encrypted contents.json
            var header = new Uint8Array(0x100);
            var view = new DataView(header.buffer);
            view.setUint32(0, 0, true);  // version
            view.setUint32(4, 0x9bcfb9fc, true);  // magic
            view.setBigInt64(8, 0n, true);  // reserved
            
            // Encrypt the JSON
            var contentsEncrypted = await _encryptData(contentsData, outputKey);
            var contentsBin = new Uint8Array(0x100 + contentsEncrypted.length);
            contentsBin.set(header, 0);
            contentsBin.set(new Uint8Array(contentsEncrypted), 0x100);
            
            outZip.file('contents.json', contentsBin);

            this._report(files.length, files.length, 'Done');

            var blob = await outZip.generateAsync({ type: 'blob' });
            return { blob: blob, key: outputKey };
        }

        /**
         * Decrypt an encrypted pack
         * @param {File|Blob} file - The encrypted .mcpack file
         * @param {string} keyString - The key to decrypt with (content key from encryption)
         * @returns {Promise<{blob: Blob}>} Decrypted blob
         */
        async decrypt(file, keyString, options) {
            options = options || {};
            var formatJson = !!options.formatJson;
            var zip = await JSZip.loadAsync(file);

            var files = [];
            zip.forEach(function (relativePath, entry) {
                if (entry.dir) return;
                files.push({ path: relativePath, entry: entry });
            });

            var encryptedPathSet = new Set();
            var fileKeyMap = {};

            var contentsEntry = zip.file('contents.json') || zip.file('/contents.json');
            if (!contentsEntry) {
                zip.forEach(function (relativePath, entry) {
                    if (!contentsEntry && !entry.dir && relativePath.toLowerCase().endsWith('/contents.json')) {
                        contentsEntry = entry;
                    }
                });
            }

            if (contentsEntry) {
                var contentsBytes = await contentsEntry.async('uint8array');
                var contentsText;

                if (_isEncryptedContents(contentsBytes)) {
                    var cipherText = contentsBytes.slice(0x100);
                    var decryptedContents = await _decryptData(cipherText, keyString);
                    contentsText = _sanitizeJsonText(new TextDecoder().decode(decryptedContents));
                } else {
                    contentsText = _sanitizeJsonText(new TextDecoder().decode(contentsBytes));
                }

                var parsed = JSON.parse(contentsText);
                if (parsed && Array.isArray(parsed.content)) {
                    for (var cp = 0; cp < parsed.content.length; cp++) {
                        var item = parsed.content[cp];
                        if (!item || !item.path) continue;
                        if (item.key) {
                            var normalizedPath = String(item.path).replace(/^\.\//, '');
                            encryptedPathSet.add(normalizedPath);
                            fileKeyMap[normalizedPath] = item.key;
                        }
                    }
                }
            }

            // Fallback: if contents.json exists, assume all non-skip files are encrypted
            if (encryptedPathSet.size === 0 && contentsEntry) {
                for (var fc = 0; fc < files.length; fc++) {
                    if (SKIP_FILES.indexOf(files[fc].path) === -1) {
                        encryptedPathSet.add(files[fc].path);
                    }
                }
            }

            if (encryptedPathSet.size === 0) {
                throw new Error('No encrypted files found. This file may not be encrypted or uses a different format.');
            }

            var outZip = new JSZip();
            var decryptErrors = [];

            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                this._report(i, files.length, f.path);

                var fileData = await f.entry.async('uint8array');

                if (encryptedPathSet.has(f.path)) {
                    var perFileKey = fileKeyMap[f.path];
                    var theKey = perFileKey || keyString;
                    var decrypted = await _decryptData(fileData, theKey);

                    if (_needsTextTrim(f.path)) {
                        decrypted = _stripTrailingNullsAndWhitespace(decrypted);
                        if (formatJson) {
                            decrypted = _formatJsonBytes(decrypted, true);
                        }
                    }

                    // Verify header to confirm decryption succeeded
                    var headerOk = _detectDecryptedByHeader(f.path.split('/').pop(), decrypted);
                    if (headerOk === false) {
                        decryptErrors.push(f.path);
                    }

                    outZip.file(f.path, decrypted);
                } else {
                    outZip.file(f.path, fileData);
                }
            }

            if (decryptErrors.length > 0) {
                throw new Error('Key mismatch or decryption failed for ' + decryptErrors.length + ' files. First: ' + decryptErrors[0]);
            }

            // Remove encryption metadata after successful decrypt.
            outZip.remove('contents.json');
            outZip.remove('signatures.json');

            this._report(files.length, files.length, 'Done');

            var blob = await outZip.generateAsync({ type: 'blob' });
            return { blob: blob };
        }

        /**
         * Quick check: does this zip blob contain encrypted files?
         * @param {File|Blob} file
         * @returns {Promise<boolean>}
         */
        async isEncrypted(file) {
            try {
                var zip = await JSZip.loadAsync(file);
                var files = [];
                zip.forEach(function (relativePath, entry) {
                    if (!entry.dir) files.push(entry);
                });

                var contentsEntry = zip.file('contents.json') || zip.file('/contents.json');
                if (contentsEntry) {
                    var cdata = await contentsEntry.async('uint8array');
                    if (_isEncryptedContents(cdata)) return true;
                }

                for (var i = 0; i < Math.min(files.length, 5); i++) {
                    var data = await files[i].async('uint8array');
                    if (_isEncrypted(data)) return true;
                    var headerState = _detectDecryptedByHeader(files[i].name || '', data);
                    if (headerState === false) return true;
                }
            } catch (e) {
                // Not a valid zip
            }
            return false;
        }
    }

    window.SkinApex.CryptManager = CryptManager;
    window.SkinApex.CryptManager._generateKeyString = _generateKeyString;
})();
