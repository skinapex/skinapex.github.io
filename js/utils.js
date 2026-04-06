/* ============================================================
   SkinApex - Utility Functions
   ============================================================ */

(function () {
    'use strict';

    const Utils = {};

    /**
     * Escape HTML special characters to prevent XSS
     */
    Utils.escapeHtml = function (str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    /**
     * Format bytes into human-readable size string
     */
    Utils.formatSize = function (bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    };

    /**
     * Get current time as HH:MM:SS string
     */
    Utils.timeStr = function () {
        const d = new Date();
        return [d.getHours(), d.getMinutes(), d.getSeconds()]
            .map(n => String(n).padStart(2, '0')).join(':');
    };

    /**
     * Debounce a function call
     */
    Utils.debounce = function (fn, ms) {
        let t;
        return function () {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, arguments), ms);
        };
    };

    /**
     * Get appropriate SVG icon for a file based on extension
     */
    Utils.getFileIcon = function (name) {
        const Icons = SkinApex.Icons;
        const lower = name.toLowerCase();
        if (lower.endsWith('.json')) return Icons.fileJson;
        if (lower.endsWith('.lang')) return Icons.fileJson;
        if (SkinApex.IMAGE_EXTENSIONS.test(lower)) return Icons.fileImage;
        if (lower.match(/\.(zip|mcpack|mcaddon)$/)) return Icons.fileZip;
        return Icons.file;
    };

    /**
     * Count all file nodes in a tree recursively
     */
    Utils.countFiles = function (node) {
        let count = 0;
        if (!node || !node.children) return 0;
        for (const child of Object.values(node.children)) {
            if (child.type === 'file') count++;
            else count += Utils.countFiles(child);
        }
        return count;
    };

    window.SkinApex.Utils = Utils;
})();
