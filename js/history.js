/* ============================================================
   SkinApex - HistoryManager
   Lightweight undo/redo stack with optional merge support.
   ============================================================ */

(function () {
    'use strict';

    class HistoryManager {
        constructor(limit) {
            this.limit = Math.max(1, limit || 100);
            this.undoStack = [];
            this.redoStack = [];
            this.isApplying = false;
            this._onChange = null;
        }

        setOnChange(fn) {
            this._onChange = fn;
        }

        canUndo() {
            return this.undoStack.length > 0;
        }

        canRedo() {
            return this.redoStack.length > 0;
        }

        peekUndo() {
            return this.canUndo() ? this.undoStack[this.undoStack.length - 1] : null;
        }

        peekRedo() {
            return this.canRedo() ? this.redoStack[this.redoStack.length - 1] : null;
        }

        getUndoItems(limit) {
            var start = Math.max(0, this.undoStack.length - (limit || this.limit));
            return this.undoStack.slice(start).reverse();
        }

        getRedoItems(limit) {
            var start = Math.max(0, this.redoStack.length - (limit || this.limit));
            return this.redoStack.slice(start).reverse();
        }

        push(action) {
            if (!action || typeof action.undo !== 'function' || typeof action.redo !== 'function') return;
            action.timestamp = Date.now();

            var last = this.peekUndo();
            if (last && this._canMerge(last, action)) {
                last.redo = action.redo;
                last.label = action.label || last.label;
                last.timestamp = action.timestamp;
            } else {
                this.undoStack.push(action);
                if (this.undoStack.length > this.limit) {
                    this.undoStack.shift();
                }
            }

            this.redoStack = [];
            this._emitChange();
        }

        async undo() {
            var action = this.undoStack.pop();
            if (!action) return null;
            this.isApplying = true;
            try {
                await action.undo();
                this.redoStack.push(action);
                return action;
            } finally {
                this.isApplying = false;
                this._emitChange();
            }
        }

        async redo() {
            var action = this.redoStack.pop();
            if (!action) return null;
            this.isApplying = true;
            try {
                await action.redo();
                this.undoStack.push(action);
                return action;
            } finally {
                this.isApplying = false;
                this._emitChange();
            }
        }

        async undoTo(action) {
            if (!action) return [];
            var applied = [];
            while (this.peekUndo()) {
                var current = await this.undo();
                if (!current) break;
                applied.push(current);
                if (current === action) break;
            }
            return applied;
        }

        async redoTo(action) {
            if (!action) return [];
            var applied = [];
            while (this.peekRedo()) {
                var current = await this.redo();
                if (!current) break;
                applied.push(current);
                if (current === action) break;
            }
            return applied;
        }

        clear() {
            this.undoStack = [];
            this.redoStack = [];
            this._emitChange();
        }

        _canMerge(prev, next) {
            if (!prev || !next || !prev.mergeKey || !next.mergeKey) return false;
            if (prev.mergeKey !== next.mergeKey) return false;
            return (next.timestamp - (prev.timestamp || 0)) <= 1500;
        }

        _emitChange() {
            if (this._onChange) this._onChange(this);
        }
    }

    window.SkinApex = window.SkinApex || {};
    window.SkinApex.HistoryManager = HistoryManager;
})();
