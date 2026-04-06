/* ============================================================
   SkinApex - Explorer (File Tree)
   Renders file tree, supports create operations and context menu.
   ============================================================ */

(function () {
    'use strict';

    const Utils = SkinApex.Utils;
    const Icons = SkinApex.Icons;
    const I18n = SkinApex.I18n;

    class Explorer {
        constructor() {
            this.el = document.getElementById('file-tree');
            this._onFileClick = null;
            this._onCreateFile = null;
            this._onCreateFolder = null;
            this._onContextAction = null;
            this._isEncryptedChecker = null;
            this._selectedPath = '';
            this._selectedType = 'folder';
            this._longPressTimer = null;

            this._menuEl = document.createElement('div');
            this._menuEl.className = 'explorer-context-menu';
            this._menuEl.style.display = 'none';
            this._menuEl.innerHTML =
                '<button type="button" data-action="move">' + I18n.t('explorer.context.move') + '</button>' +
                '<button type="button" data-action="rename">' + I18n.t('explorer.context.rename') + '</button>' +
                '<button type="button" data-action="copy">' + I18n.t('explorer.context.copy') + '</button>' +
                '<button type="button" data-action="delete">' + I18n.t('explorer.context.delete') + '</button>';
            document.body.appendChild(this._menuEl);

            this._menuEl.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-action]');
                if (!btn) return;
                const action = btn.dataset.action;
                const path = this._menuEl.dataset.path || '';
                const type = this._menuEl.dataset.type || 'file';
                this._hideContextMenu();
                if (this._onContextAction) this._onContextAction(action, path, type);
            });

            document.addEventListener('click', () => this._hideContextMenu());

            const newFileBtn = document.getElementById('btn-explorer-new-file');
            if (newFileBtn) {
                newFileBtn.addEventListener('click', () => {
                    if (this._onCreateFile) this._onCreateFile(this.getSelectedFolderPath());
                });
            }

            const newFolderBtn = document.getElementById('btn-explorer-new-folder');
            if (newFolderBtn) {
                newFolderBtn.addEventListener('click', () => {
                    if (this._onCreateFolder) this._onCreateFolder(this.getSelectedFolderPath());
                });
            }
        }

        setOnFileClick(fn) {
            this._onFileClick = fn;
        }

        setOnCreateFile(fn) {
            this._onCreateFile = fn;
        }

        setOnCreateFolder(fn) {
            this._onCreateFolder = fn;
        }

        setOnContextAction(fn) {
            this._onContextAction = fn;
        }

        setIsEncryptedChecker(fn) {
            this._isEncryptedChecker = fn;
        }

        getSelectedFolderPath() {
            if (this._selectedType === 'folder') return this._selectedPath || '';
            if (!this._selectedPath) return '';
            var idx = this._selectedPath.lastIndexOf('/');
            return idx >= 0 ? this._selectedPath.slice(0, idx) : '';
        }

        render(tree) {
            this.el.innerHTML = '';
            if (!tree || !tree.children || Object.keys(tree.children).length === 0) {
                this.el.innerHTML = '<div class="panel-empty">' + Utils.escapeHtml(I18n.t('explorer.empty')) + '</div>';
                return;
            }
            this._renderNode(tree, 0, this.el);
        }

        _renderNode(node, depth, parentEl) {
            const entries = Object.values(node.children).sort((a, b) => {
                if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

            for (const entry of entries) {
                if (entry.type === 'folder') {
                    this._renderFolder(entry, depth, parentEl);
                } else {
                    this._renderFile(entry, depth, parentEl);
                }
            }
        }

        _renderFolder(entry, depth, parentEl) {
            const wrapper = document.createElement('div');

            const folderEl = document.createElement('div');
            folderEl.className = 'tree-folder' + (entry.path === this._selectedPath && this._selectedType === 'folder' ? ' selected' : '');
            folderEl.style.paddingLeft = (depth * 16 + 8) + 'px';
            folderEl.innerHTML =
                '<span class="tree-arrow">' + Icons.chevron + '</span>' +
                '<span class="tree-icon">' + Icons.folder + '</span>' +
                '<span class="tree-label">' + Utils.escapeHtml(entry.name) + '</span>';

            const childrenEl = document.createElement('div');
            childrenEl.className = 'tree-children';

            folderEl.addEventListener('click', () => {
                this._selectPath(entry.path, 'folder');
                const arrow = folderEl.querySelector('.tree-arrow');
                const icon = folderEl.querySelector('.tree-icon');
                const isExpanded = childrenEl.classList.contains('expanded');
                if (isExpanded) {
                    childrenEl.classList.remove('expanded');
                    arrow.classList.remove('expanded');
                    icon.innerHTML = Icons.folder;
                } else {
                    childrenEl.classList.add('expanded');
                    arrow.classList.add('expanded');
                    icon.innerHTML = Icons.folderOpen;
                    if (childrenEl.children.length === 0) {
                        this._renderNode(entry, depth + 1, childrenEl);
                    }
                }
            });

            this._bindContextMenu(folderEl, entry.path, 'folder');

            wrapper.appendChild(folderEl);
            wrapper.appendChild(childrenEl);
            parentEl.appendChild(wrapper);
        }

        _renderFile(entry, depth, parentEl) {
            const fileEl = document.createElement('div');
            fileEl.className = 'tree-file' + (entry.path === this._selectedPath && this._selectedType === 'file' ? ' selected' : '');
            fileEl.style.paddingLeft = (depth * 16 + 28) + 'px';
            fileEl.dataset.path = entry.path;
            fileEl.innerHTML =
                '<span class="tree-icon">' + Utils.getFileIcon(entry.name) + '</span>' +
                '<span class="tree-lock" style="display:none"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>' +
                '<span class="tree-label">' + Utils.escapeHtml(entry.name) + '</span>';

            fileEl.addEventListener('click', () => {
                this._selectPath(entry.path, 'file');
                if (this._onFileClick) this._onFileClick(entry.path, entry.name);
            });

            this._bindContextMenu(fileEl, entry.path, 'file');
            parentEl.appendChild(fileEl);

            if (this._isEncryptedChecker) {
                this._isEncryptedChecker(entry.path).then((encrypted) => {
                    if (!encrypted) return;
                    var lock = fileEl.querySelector('.tree-lock');
                    if (lock) lock.style.display = 'inline-flex';
                }).catch(() => {});
            }
        }

        _selectPath(path, type) {
            this._selectedPath = path || '';
            this._selectedType = type || 'file';
            this.el.querySelectorAll('.tree-folder.selected, .tree-file.selected').forEach(el => {
                el.classList.remove('selected');
            });
            var selector = (type === 'folder' ? '.tree-folder' : '.tree-file') + '[data-path="' + (path || '').replace(/"/g, '\\"') + '"]';
            var target = this.el.querySelector(selector);
            if (target) target.classList.add('selected');
        }

        _bindContextMenu(el, path, type) {
            el.dataset.path = path || '';
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this._selectPath(path, type);
                this._showContextMenu(e.clientX, e.clientY, path, type);
            });

            el.addEventListener('touchstart', (e) => {
                clearTimeout(this._longPressTimer);
                this._longPressTimer = setTimeout(() => {
                    this._selectPath(path, type);
                    var t = e.touches && e.touches[0];
                    var x = t ? t.clientX : 20;
                    var y = t ? t.clientY : 20;
                    this._showContextMenu(x, y, path, type);
                }, 520);
            }, { passive: true });

            el.addEventListener('touchend', () => {
                clearTimeout(this._longPressTimer);
            }, { passive: true });
            el.addEventListener('touchcancel', () => {
                clearTimeout(this._longPressTimer);
            }, { passive: true });
        }

        _showContextMenu(x, y, path, type) {
            this._menuEl.dataset.path = path || '';
            this._menuEl.dataset.type = type || 'file';
            this._menuEl.style.display = 'block';
            var margin = 8;
            var rect = this._menuEl.getBoundingClientRect();
            var maxX = window.innerWidth - rect.width - margin;
            var maxY = window.innerHeight - rect.height - margin;
            var clampedX = Math.max(margin, Math.min(x, maxX));
            var clampedY = Math.max(margin, Math.min(y, maxY));
            this._menuEl.style.left = clampedX + 'px';
            this._menuEl.style.top = clampedY + 'px';
        }

        _hideContextMenu() {
            this._menuEl.style.display = 'none';
        }
    }

    window.SkinApex.Explorer = Explorer;
})();
