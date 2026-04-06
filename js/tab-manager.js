/* ============================================================
   SkinApex - TabManager
   Manages project tabs: create, switch, close, render
   ============================================================ */

(function () {
    'use strict';

    const Utils = SkinApex.Utils;

    class TabManager {
        constructor() {
            this.tabs = new Map(); // id -> { id, name, project }
            this.activeTabId = null;
            this._nextId = 1;
            this._container = document.getElementById('tabbar');
            this._onChange = null;
        }

        /**
         * Register callback for tab changes: fn(tabId, project | null)
         */
        setOnChange(fn) {
            this._onChange = fn;
        }

        /**
         * Create a new tab for a project and switch to it
         */
        create(name, project) {
            const id = 'tab_' + this._nextId++;
            this.tabs.set(id, { id, name, project });
            this.switchTo(id);
            return id;
        }

        /**
         * Switch to a tab by id
         */
        switchTo(id) {
            if (!this.tabs.has(id)) return;
            this.activeTabId = id;
            this._render();
            const tab = this.tabs.get(id);
            if (this._onChange) this._onChange(id, tab.project);
        }

        /**
         * Close a tab by id, cleanup project resources
         */
        close(id) {
            const tab = this.tabs.get(id);
            if (!tab) return;
            tab.project.cleanup();
            this.tabs.delete(id);

            if (this.activeTabId === id) {
                const keys = [...this.tabs.keys()];
                this.activeTabId = keys.length > 0 ? keys[keys.length - 1] : null;
            }

            this._render();

            if (this.activeTabId) {
                const t = this.tabs.get(this.activeTabId);
                if (this._onChange) this._onChange(this.activeTabId, t.project);
            } else {
                if (this._onChange) this._onChange(null, null);
            }
        }

        /**
         * Replace project data in an existing tab.
         */
        replaceProject(id, name, project) {
            if (!this.tabs.has(id)) return;
            this.tabs.set(id, { id: id, name: name, project: project });
            this._render();
            if (this.activeTabId === id && this._onChange) {
                this._onChange(id, project);
            }
        }

        /**
         * Get the currently active tab data
         */
        getActive() {
            if (!this.activeTabId) return null;
            return this.tabs.get(this.activeTabId);
        }

        /**
         * Render all tabs into the tabbar DOM
         */
        _render() {
            this._container.innerHTML = '';
            this.tabs.forEach((tab) => {
                const el = document.createElement('div');
                el.className = 'tab-item' + (tab.id === this.activeTabId ? ' active' : '');
                el.innerHTML =
                    '<span class="tab-name">' + Utils.escapeHtml(tab.name) + '</span>' +
                    '<button class="tab-close" title="Close">&times;</button>';

                el.addEventListener('click', (e) => {
                    if (!e.target.classList.contains('tab-close')) {
                        this.switchTo(tab.id);
                    }
                });

                el.querySelector('.tab-close').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.close(tab.id);
                });

                this._container.appendChild(el);
            });

            // Fixed "+" tab at the end — only show when there are open tabs
            if (this.tabs.size > 0) {
                const plusEl = document.createElement('div');
                plusEl.className = 'tab-item tab-plus';
                plusEl.innerHTML = '<span class="tab-name">+</span>';
                plusEl.addEventListener('click', () => {
                    this.activeTabId = null;
                    this._render();
                    if (this._onChange) this._onChange(null, null);
                });
                this._container.appendChild(plusEl);
            }
        }

        /**
         * Switch to the "+" (welcome) tab
         */
        showWelcome() {
            this.activeTabId = null;
            this._render();
        }
    }

    window.SkinApex.TabManager = TabManager;
})();
