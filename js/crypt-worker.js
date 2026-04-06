import init, { cfb8_encrypt, cfb8_decrypt } from './vendor/mctools-crypto/mctools_crypto.js';

let ready = null;

function ensureReady() {
    if (!ready) {
        ready = init();
    }
    return ready;
}

self.addEventListener('message', async function (event) {
    var req = event.data || {};
    var id = req.id;

    try {
        await ensureReady();

        if (req.op === 'init') {
            self.postMessage({ id: id, ok: true, data: new ArrayBuffer(0) });
            return;
        }

        if (!req.key || !req.iv || !req.data) {
            throw new Error('Invalid crypto worker payload');
        }

        var key = new Uint8Array(req.key);
        var iv = new Uint8Array(req.iv);
        var data = new Uint8Array(req.data);
        var out = req.op === 'encrypt'
            ? cfb8_encrypt(key, iv, data)
            : cfb8_decrypt(key, iv, data);

        self.postMessage({ id: id, ok: true, data: out.buffer }, [out.buffer]);
    } catch (err) {
        self.postMessage({ id: id, ok: false, error: String(err && err.message ? err.message : err) });
    }
});
