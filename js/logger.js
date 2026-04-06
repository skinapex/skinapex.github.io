/* ============================================================
   SkinApex - Logger
   Output panel logging with timestamps and severity levels
   ============================================================ */

(function () {
    'use strict';

    const Utils = SkinApex.Utils;

    class Logger {
        constructor(el) {
            this.el = el;
        }

        _append(level, msg) {
            var line = '[' + Utils.timeStr() + '] ' + msg;
            if (level === 'error') console.error(line);
            else if (level === 'warn') console.warn(line);
            else if (level === 'success') console.info(line);
            else console.log(line);

            if (!this.el) return;
            const entry = document.createElement('div');
            entry.className = 'log-entry ' + level;
            entry.innerHTML =
                '<span class="log-time">[' + Utils.timeStr() + ']</span>' +
                '<span class="log-msg">' + Utils.escapeHtml(msg) + '</span>';
            this.el.appendChild(entry);
            this.el.scrollTop = this.el.scrollHeight;
        }

        log(msg) { this._append('info', msg); }
        warn(msg) { this._append('warn', msg); }
        error(msg) { this._append('error', msg); }
        success(msg) { this._append('success', msg); }

        clear() {
            if (!this.el) return;
            this.el.innerHTML = '';
        }
    }

    window.SkinApex.Logger = Logger;
})();
