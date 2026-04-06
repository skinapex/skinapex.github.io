/* ============================================================
   SkinApex - StatusBar
   Simple wrapper for status bar text updates
   ============================================================ */

(function () {
    'use strict';

    class StatusBar {
        constructor() {
            this.msgEl = document.getElementById('status-msg');
            this.infoEl = document.getElementById('status-info');
        }

        /**
         * Set left status message
         */
        setMessage(msg) {
            this.msgEl.textContent = msg;
        }

        /**
         * Set right status info
         */
        setInfo(info) {
            this.infoEl.textContent = info;
        }

        /**
         * Set both at once
         */
        set(msg, info) {
            this.msgEl.textContent = msg;
            this.infoEl.textContent = info || '';
        }
    }

    window.SkinApex.StatusBar = StatusBar;
})();
