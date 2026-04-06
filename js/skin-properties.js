/* ============================================================
   SkinApex - SkinPropertiesPanel
   Edit current skin metadata/properties.
   ============================================================ */

(function () {
    'use strict';

    const Utils = SkinApex.Utils;
    const I18n = SkinApex.I18n;

    class SkinPropertiesPanel {
        constructor() {
            this.el = document.getElementById('skin-properties-panel');
            this._onChange = null;
            this._project = null;
            this._skin = null;
            this._animationOptions = [];
            this._animationIndex = {};
            this._animationLoadError = '';
            this._slotSuggestions = ['move.arms', 'move.legs', 'idle', 'attack.positions', 'cape'];
        }

        setOnChange(fn) {
            this._onChange = fn;
        }

        setProject(project) {
            this._project = project || null;
        }

        setAnimationOptions(options) {
            this._animationOptions = Array.isArray(options) ? options.slice() : [];
            if (this._skin && this.el.style.display !== 'none') {
                this.show(this._skin);
            }
        }

        setSlotSuggestions(options) {
            this._slotSuggestions = Array.isArray(options) && options.length
                ? options.slice()
                : ['move.arms', 'move.legs', 'idle', 'attack.positions', 'cape'];
            if (this._skin && this.el.style.display !== 'none') {
                this.show(this._skin);
            }
        }

        setAnimationIndex(index) {
            this._animationIndex = index && typeof index === 'object' ? index : {};
            this._animationLoadError = '';
            this.setAnimationOptions(Object.keys(this._animationIndex));
        }

        setAnimationLoadError(message) {
            this._animationLoadError = message ? String(message) : '';
            this._animationIndex = {};
            this.setAnimationOptions([]);
        }

        show(skin) {
            this._closePicker();
            this._skin = skin || null;
            if (!skin) {
                this.hide();
                return;
            }

            const hideFramework = !!(skin.data && (skin.data.hide_framework || skin.data.hideFramework || skin.data.hide_bones));
            const skinType = (skin.data && (skin.data.skin_type || skin.data.class || skin.data.type)) || '';
            const animations = skin.animations || skin.data.animations || {};
            const animationLoadNotice = this._animationLoadError
                ? '<div class="sp-warning" role="alert">' + Utils.escapeHtml(this._animationLoadError) + '</div>'
                : '';
            const animationRows = Object.keys(animations).map((key) => {
                return '<div class="sp-anim-row" data-anim-key="' + Utils.escapeHtml(key) + '">' +
                    '<button type="button" class="sp-anim-picker sp-anim-key" data-picker="slot">' + Utils.escapeHtml(key) + '</button>' +
                    '<button type="button" class="sp-anim-picker sp-anim-value" data-picker="animation">' + Utils.escapeHtml(String(animations[key] || '')) + '</button>' +
                    '<button type="button" class="sp-anim-info" title="' + Utils.escapeHtml(I18n.t('skinProps.animationsViewBones', 'View affected bones')) + '">?</button>' +
                    '<button type="button" class="sp-anim-delete">×</button>' +
                '</div>';
            }).join('');

            this.el.innerHTML =
                '<div class="sp-row">' +
                    '<label>' + Utils.escapeHtml(I18n.t('skinProps.name', 'Skin Name')) + '</label>' +
                    '<input type="text" data-prop="name" value="' + Utils.escapeHtml(skin.name || '') + '">' +
                '</div>' +
                '<div class="sp-row">' +
                    '<label>' + Utils.escapeHtml(I18n.t('skinProps.type', 'Skin Class / Type')) + '</label>' +
                    '<input type="text" data-prop="skin_type" value="' + Utils.escapeHtml(skinType) + '">' +
                '</div>' +
                '<label class="sp-check">' +
                    '<input type="checkbox" data-prop="hide_framework"' + (hideFramework ? ' checked' : '') + '>' +
                    '<span>' + Utils.escapeHtml(I18n.t('skinProps.hideFramework', 'Hide framework / bones')) + '</span>' +
                '</label>' +
                '<div class="sp-section">' +
                    '<div class="sp-section-title">' + Utils.escapeHtml(I18n.t('skinProps.animations', 'Animations')) + '</div>' +
                    animationLoadNotice +
                    '<div class="sp-anim-list">' + animationRows + '</div>' +
                    '<button type="button" class="sp-anim-add">' + Utils.escapeHtml(I18n.t('skinProps.addAnimation', 'Add Animation')) + '</button>' +
                '</div>';

            this.el.style.display = 'flex';
            this._wireEvents();
        }

        hide() {
            this._closePicker();
            this._closeAnimationInfo();
            this.el.style.display = 'none';
            // Do NOT clear innerHTML — preserve state so switching tabs back works
        }

        _wireEvents() {
            const nameInput = this.el.querySelector('input[data-prop="name"]');
            const typeInput = this.el.querySelector('input[data-prop="skin_type"]');
            const hideInput = this.el.querySelector('input[data-prop="hide_framework"]');
            const animList = this.el.querySelector('.sp-anim-list');
            const animAdd = this.el.querySelector('.sp-anim-add');

            if (nameInput) {
                nameInput.addEventListener('input', () => this._emit('name', nameInput.value));
            }
            if (typeInput) {
                typeInput.addEventListener('input', () => this._emit('skin_type', typeInput.value));
            }
            if (hideInput) {
                hideInput.addEventListener('change', () => this._emit('hide_framework', !!hideInput.checked));
            }
            if (animAdd && animList) {
                animAdd.addEventListener('click', () => {
                    var baseKey = 'move.custom';
                    var key = baseKey;
                    var suffix = 1;
                    while ((this._skin.animations && this._skin.animations[key]) || (this._skin.data.animations && this._skin.data.animations[key])) {
                        key = baseKey + '.' + suffix;
                        suffix += 1;
                    }
                    var defaultAnim = this._animationOptions[0] || 'animation.player.cape';
                    this._emit('animation-add', { key: key, value: defaultAnim });
                });
            }
            if (animList) {
                animList.addEventListener('click', (e) => {
                    const btn = e.target.closest('.sp-anim-delete');
                    if (btn) {
                        const row = btn.closest('.sp-anim-row');
                        const key = row ? row.getAttribute('data-anim-key') : '';
                        this._emit('animation-delete', key);
                        return;
                    }
                    const infoBtn = e.target.closest('.sp-anim-info');
                    if (infoBtn) {
                        const row = infoBtn.closest('.sp-anim-row');
                        const key = row ? row.getAttribute('data-anim-key') : '';
                        const animationId = (this._skin.animations && this._skin.animations[key]) || (this._skin.data.animations && this._skin.data.animations[key]) || '';
                        this._openAnimationInfo(animationId);
                        return;
                    }
                    const picker = e.target.closest('.sp-anim-picker');
                    if (!picker) return;
                    const row = picker.closest('.sp-anim-row');
                    if (!row) return;
                    const currentKey = row.getAttribute('data-anim-key') || '';
                    const currentValue = (this._skin.animations && this._skin.animations[currentKey]) || (this._skin.data.animations && this._skin.data.animations[currentKey]) || '';
                    if (picker.dataset.picker === 'slot') {
                        this._openPicker(picker, this._buildSlotSuggestions(currentKey), currentKey, (nextKey) => {
                            if (!nextKey || nextKey === currentKey) return;
                            this._emit('animation-rename-key', { from: currentKey, to: nextKey });
                        });
                    } else {
                        this._openPicker(picker, this._buildAnimationSuggestions(), currentValue, (nextValue) => {
                            this._emit('animation-set-value', { key: currentKey, value: nextValue });
                        });
                    }
                });
            }
        }

        _buildSlotSuggestions(currentKey) {
            const existing = Object.keys(this._skin.animations || this._skin.data.animations || {});
            const merged = Array.from(new Set(existing.concat(this._slotSuggestions).concat(currentKey ? [currentKey] : [])));
            return merged;
        }

        _buildAnimationSuggestions() {
            return this._animationOptions.slice();
        }

        _openPicker(anchorEl, options, currentValue, onSelect) {
            this._closePicker();
            const panel = document.createElement('div');
            panel.className = 'sp-picker';
            panel.innerHTML = '<input type="text" class="sp-picker-search" value="' + Utils.escapeHtml(currentValue || '') + '">' +
                '<div class="sp-picker-list"></div>';
            document.body.appendChild(panel);

            const rect = anchorEl.getBoundingClientRect();
            panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 320)) + 'px';
            panel.style.top = Math.min(rect.bottom + 4, window.innerHeight - 260) + 'px';
            panel.style.width = Math.max(220, rect.width) + 'px';

            const search = panel.querySelector('.sp-picker-search');
            const list = panel.querySelector('.sp-picker-list');

            const scoreOption = (query, value) => {
                const q = String(query || '').toLowerCase();
                const v = String(value || '').toLowerCase();
                if (!q) return 1;
                if (v === q) return 100;
                if (v.startsWith(q)) return 80;
                if (v.includes(q)) return 50;
                let score = 0;
                let qi = 0;
                for (let i = 0; i < v.length && qi < q.length; i++) {
                    if (v[i] === q[qi]) {
                        score += 2;
                        qi += 1;
                    }
                }
                return qi === q.length ? score : -1;
            };

            const renderList = () => {
                const query = search.value.trim();
                const ranked = options.map((opt) => ({ value: opt, score: scoreOption(query, opt) }))
                    .filter((item) => item.score >= 0)
                    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
                    .slice(0, 10);
                list.innerHTML = ranked.map((item) => '<button type="button" class="sp-picker-item" data-value="' + Utils.escapeHtml(item.value) + '">' + Utils.escapeHtml(item.value) + '</button>').join('');
            };

            search.addEventListener('input', renderList);
            list.addEventListener('click', (e) => {
                const btn = e.target.closest('.sp-picker-item');
                if (!btn) return;
                const value = btn.getAttribute('data-value') || '';
                if (onSelect) onSelect(value);
                this._closePicker();
            });

            const onDocDown = (e) => {
                if (panel.contains(e.target) || anchorEl.contains(e.target)) return;
                this._closePicker();
            };
            panel._cleanup = () => document.removeEventListener('pointerdown', onDocDown);
            document.addEventListener('pointerdown', onDocDown);
            this._pickerEl = panel;
            renderList();
            search.focus();
            search.select();
        }

        _closePicker() {
            if (!this._pickerEl) return;
            if (this._pickerEl._cleanup) this._pickerEl._cleanup();
            if (this._pickerEl.parentNode) this._pickerEl.parentNode.removeChild(this._pickerEl);
            this._pickerEl = null;
        }

        async _openAnimationInfo(animationId) {
            this._closeAnimationInfo();
            const overlay = document.createElement('div');
            overlay.className = 'sp-anim-info-overlay';
            overlay.innerHTML = '<div class="sp-anim-info-dialog">' +
                '<div class="sp-anim-info-header">' +
                    '<div class="sp-anim-info-title-wrap">' +
                        '<div class="sp-anim-info-label">' + Utils.escapeHtml(I18n.t('skinProps.animationsAffectedBones', 'Affected Bones')) + '</div>' +
                        '<div class="sp-anim-info-title">' + Utils.escapeHtml(animationId || I18n.t('skinProps.animationsUnknown', 'Unknown animation')) + '</div>' +
                    '</div>' +
                    '<button type="button" class="sp-anim-info-close">×</button>' +
                '</div>' +
                '<div class="sp-anim-info-body">Loading...</div>' +
            '</div>';
            document.body.appendChild(overlay);
            const close = () => this._closeAnimationInfo();
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay || e.target.closest('.sp-anim-info-close')) close();
            });
            const onKeyDown = (e) => {
                if (e.key === 'Escape') close();
            };
            document.addEventListener('keydown', onKeyDown);
            overlay._cleanup = () => document.removeEventListener('keydown', onKeyDown);
            this._animInfoEl = overlay;

            const body = overlay.querySelector('.sp-anim-info-body');
            let bones = [];
            try {
                const animation = animationId && this._project ? await this._project.getOfficialAnimation(animationId) : null;
                bones = animation && animation.bones ? Object.keys(animation.bones) : [];
            } catch (err) {
                bones = [];
            }

            if (this._animInfoEl !== overlay || !body) return;
            body.innerHTML = bones.length
                ? '<div class="sp-anim-bone-list">' + bones.map(function (boneName) {
                    return '<span class="sp-anim-bone-chip">' + Utils.escapeHtml(boneName) + '</span>';
                }).join('') + '</div>'
                : '<div class="sp-anim-info-empty">' + Utils.escapeHtml(I18n.t('skinProps.animationsNoBones', 'No affected bones were found for this animation.')) + '</div>';
        }

        _closeAnimationInfo() {
            if (!this._animInfoEl) return;
            if (this._animInfoEl._cleanup) this._animInfoEl._cleanup();
            if (this._animInfoEl.parentNode) this._animInfoEl.parentNode.removeChild(this._animInfoEl);
            this._animInfoEl = null;
        }

        _emit(prop, value) {
            if (!this._skin) return;
            if (this._onChange) {
                this._onChange(this._skin, prop, value);
            }
        }
    }

    window.SkinApex.SkinPropertiesPanel = SkinPropertiesPanel;
})();
