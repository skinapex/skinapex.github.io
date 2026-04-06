/* ============================================================
   SkinApex - SkinList
   Renders the skin list panel with 3D preview thumbnails.
   ============================================================ */

(function () {
    'use strict';

    const Utils = SkinApex.Utils;
    const Icons = SkinApex.Icons;
    const I18n = SkinApex.I18n;

    class SkinList {
        constructor() {
            this.el = document.getElementById('skin-list-panel');
            this._onSkinSelect = null;
            this._onDecryptRequest = null;
            this._currentProject = null;
            this._renderingThumbs = false;
        }

        /**
         * Set callback for skin selection: fn(skinData, index)
         */
        setOnSkinSelect(fn) {
            this._onSkinSelect = fn;
        }

        setOnDecryptRequest(fn) {
            this._onDecryptRequest = fn;
        }

        /**
         * Get the currently bound project
         */
        getProject() {
            return this._currentProject;
        }

        /**
         * Render the skin list for a project
         */
        async render(project) {
            this._currentProject = project;
            this.el.innerHTML = '';

            if (!project) {
                this.el.innerHTML = '<div class="panel-empty">' + Utils.escapeHtml(I18n.t('skins.empty')) + '</div>';
                return;
            }

            if (project.encryptionState === 'encrypted') {
                this.el.innerHTML =
                    '<div class="skin-encrypted-empty">' +
                        '<div class="skin-encrypted-icon">' +
                            '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
                        '</div>' +
                        '<div class="skin-encrypted-msg">' + Utils.escapeHtml(I18n.t('skins.encrypted')) + '</div>' +
                        '<div class="skin-encrypted-hint">' + Utils.escapeHtml(I18n.t('skins.encryptedHint')) + '</div>' +
                        '<button class="btn-primary skin-decrypt-btn" id="skin-list-decrypt-btn" type="button">' + Utils.escapeHtml(I18n.t('skins.decrypt')) + '</button>' +
                    '</div>';
                var decryptBtn = this.el.querySelector('#skin-list-decrypt-btn');
                if (decryptBtn && this._onDecryptRequest) {
                    decryptBtn.addEventListener('click', () => this._onDecryptRequest());
                }
                return;
            }

            if (project.skins.length === 0) {
                this.el.innerHTML = '<div class="panel-empty">' + Utils.escapeHtml(I18n.t('skins.empty')) + '</div>';
                return;
            }

            for (let i = 0; i < project.skins.length; i++) {
                const skin = project.skins[i];
                const item = this._createSkinItem(skin, i);
                this.el.appendChild(item);
            }

            // Render 3D thumbnails in background
            this._render3DThumbnails(project);
        }

        /**
         * Re-render the list (e.g. after deletion)
         */
        async refresh() {
            if (this._currentProject) {
                await this.render(this._currentProject);
            }
        }

        /**
         * Create a skin list item DOM element
         */
        _createSkinItem(skin, index) {
            const item = document.createElement('div');
            item.className = 'skin-item';
            item.dataset.index = index;

            // Thumbnail container
            const thumb = document.createElement('div');
            thumb.className = 'skin-thumb-3d';

            // Placeholder while 3D thumbnail loads
            const placeholder = document.createElement('div');
            placeholder.className = 'skin-thumb-placeholder';
            placeholder.innerHTML = Icons.skin;
            thumb.appendChild(placeholder);

            // Info
            const info = document.createElement('div');
            info.className = 'skin-info';
            info.innerHTML =
                '<div class="skin-name">' + Utils.escapeHtml(skin.name) + '</div>' +
                '<div class="skin-type">' + Utils.escapeHtml(skin.type || 'skin') + '</div>';

            item.appendChild(thumb);
            item.appendChild(info);

            item.addEventListener('click', () => {
                this.el.querySelectorAll('.skin-item.selected').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                if (this._onSkinSelect) this._onSkinSelect(skin, index);
            });

            return item;
        }

        /**
         * Render 3D thumbnails for all skins asynchronously
         */
        async _render3DThumbnails(project) {
            if (!project || !project.skins || project.skins.length === 0) return;
            if (typeof THREE === 'undefined') return;
            if (!SkinApex.ModelViewer) return;

            const items = this.el.querySelectorAll('.skin-item');
            if (items.length === 0) return;

            // Render one at a time to avoid GPU overload
            for (let i = 0; i < project.skins.length; i++) {
                const skin = project.skins[i];
                const thumbEl = items[i] ? items[i].querySelector('.skin-thumb-3d') : null;
                if (!thumbEl) continue;

                try {
                    // Check if the skin has geometry data
                    if (skin.geometry && project.geometries && project.geometries[skin.geometry]) {
                        const dataUrl = await SkinApex.ModelViewer.renderThumbnail(skin, project, 96);
                        if (dataUrl) {
                            const img = document.createElement('img');
                            img.className = 'skin-thumb-3d-img';
                            img.src = dataUrl;
                            img.onload = () => {
                                thumbEl.innerHTML = '';
                                thumbEl.appendChild(img);
                            };
                        } else {
                            this._fallback2DThumb(skin, project, thumbEl);
                        }
                    } else {
                        this._fallback2DThumb(skin, project, thumbEl);
                    }
                } catch (err) {
                    // Fallback to 2D on any error
                    this._fallback2DThumb(skin, project, thumbEl);
                }
            }
        }

        /**
         * Fallback to 2D texture thumbnail
         */
        _fallback2DThumb(skin, project, thumbEl) {
            if (skin.texturePath) {
                project.getTextureBlobUrl(skin.texturePath).then(url => {
                    if (url && thumbEl) {
                        const img = document.createElement('img');
                        img.className = 'skin-thumb-3d-img';
                        img.src = url;
                        img.onload = () => {
                            thumbEl.innerHTML = '';
                            thumbEl.appendChild(img);
                        };
                    }
                });
            }
        }
    }

    window.SkinApex.SkinList = SkinList;
})();
