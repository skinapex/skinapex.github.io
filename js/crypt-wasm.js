/* ============================================================
   SkinApex - WASM Crypto Client
   Worker-backed CFB8 encryption/decryption adapted from mcpts.
   ============================================================ */

(function () {
    'use strict';

    var worker = null;
    var seq = 0;
    var pending = new Map();

    function _toBuffer(data) {
        if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
            return data.buffer;
        }
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }

    function _getWorker() {
        if (worker) return worker;

        worker = new Worker('js/crypt-worker.js', { type: 'module' });
        worker.onmessage = function (event) {
            var payload = event.data || {};
            var entry = pending.get(payload.id);
            if (!entry) return;
            pending.delete(payload.id);

            if (payload.ok) {
                entry.resolve(new Uint8Array(payload.data));
            } else {
                entry.reject(new Error(payload.error || 'crypto worker error'));
            }
        };

        worker.onerror = function (event) {
            pending.forEach(function (entry) {
                entry.reject(new Error(event.message || 'crypto worker error'));
            });
            pending.clear();
        };

        return worker;
    }

    function _callWorker(op, key, iv, data) {
        return new Promise(function (resolve, reject) {
            var id = ++seq;
            pending.set(id, { resolve: resolve, reject: reject });

            var payload = {
                id: id,
                op: op,
                key: _toBuffer(key),
                iv: _toBuffer(iv),
                data: _toBuffer(data)
            };
            _getWorker().postMessage(payload, [payload.key, payload.iv, payload.data]);
        });
    }

    function prewarm() {
        return new Promise(function (resolve) {
            var id = ++seq;
            pending.set(id, {
                resolve: function () { resolve(); },
                reject: function () { resolve(); }
            });
            _getWorker().postMessage({ id: id, op: 'init' });
        });
    }

    window.SkinApex.WasmCrypto = {
        prewarm: prewarm,
        encryptCFB8: function (key, iv, data) { return _callWorker('encrypt', key, iv, data); },
        decryptCFB8: function (key, iv, data) { return _callWorker('decrypt', key, iv, data); }
    };
})();
