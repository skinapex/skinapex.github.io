/* ============================================================
   SkinApex - PreviewPanel
   Main editor area: shows 3D skin preview, textures, file contents.
   ============================================================ */

(function () {
    'use strict';

    const Utils = SkinApex.Utils;
    const I18n = SkinApex.I18n;
    const Icons = SkinApex.Icons;

    class PreviewPanel {
        constructor() {
            this.el = document.getElementById('editor-content');
            this._currentProject = null;
            this._selectedSkin = null;
            this._modelViewer = null;
            this._viewerContainer = null;
            this._uvContainer = null;
            this._modeButtons = null;
            this._toolButtons = null;
            this._animBar = null;
            this._animBarToggle = null;
            this._animBarContent = null;
            this._animBarCollapsed = false;
            this._transformHint = null;
            this._mode = '3d';
            this._uvToolMode = 'edit';
            this._uvZoomLevels = [0.25, 0.5, 1, 2, 4, 8, 12, 16];
            this._uvZoomIndex = 2;
            this._uvPan = { x: 0, y: 0 };
            this._uvRenderToken = 0;
            this._selectedUvRect = null;
            this._onAnimationStateChanged = null;
            this._polyMeshNormalMode = 'auto';
            this._selectedAction = '__none__';
            this._lookAtPointerEnabled = false;
        }

        setOnAnimationStateChanged(fn) {
            this._onAnimationStateChanged = fn;
        }

        /**
         * Show empty state (no skin/file selected)
         */
        clear() {
            this._stopViewer();
            this.el.className = '';
            this.el.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;flex-direction:column;';
            this.el.innerHTML =
                '<div class="empty-state">' +
                Icons.cube +
                '<p>Select a skin to preview</p>' +
                '</div>';
            this._selectedSkin = null;
            this._mode = '3d';
        }

        /**
         * Show a skin's 3D preview in the main area
         */
        async showSkin(skin, project) {
            this._currentProject = project;
            this._selectedSkin = skin;

            // Stop any existing viewer FIRST (before creating new container)
            this._stopViewer();
            const token = ++this._uvRenderToken;

            // Set up the preview shell with 3D and UV modes
            this.el.innerHTML = '';
            this.el.className = 'preview-3d-wrap';

            // Info bar at top
            const infoBar = document.createElement('div');
            infoBar.className = 'preview-info-bar';
            infoBar.innerHTML =
                '<span class="preview-info-name">' + Utils.escapeHtml(skin.name) + '</span>' +
                (skin.geometry ? '<span class="preview-info-geo">' + Utils.escapeHtml(skin.geometry) + '</span>' : '') +
                (skin.texturePath ? '<span class="preview-info-tex">' + Utils.escapeHtml(skin.texturePath) + '</span>' : '');
            this.el.appendChild(infoBar);

            const modeTabs = document.createElement('div');
            modeTabs.className = 'preview-mode-tabs';
            const viewTabs = document.createElement('div');
            viewTabs.className = 'preview-tab-group';
            const btn3d = document.createElement('button');
            btn3d.className = 'preview-mode-btn active';
            btn3d.type = 'button';
            btn3d.textContent = I18n.t('preview.mode.3d');
            const btnUv = document.createElement('button');
            btnUv.className = 'preview-mode-btn';
            btnUv.type = 'button';
            btnUv.textContent = I18n.t('preview.mode.uv');
            const btnOptions = document.createElement('button');
            btnOptions.className = 'preview-options-btn';
            btnOptions.type = 'button';
            btnOptions.textContent = I18n.t('preview.options3d');
            viewTabs.appendChild(btn3d);
            viewTabs.appendChild(btnUv);

            const tools = document.createElement('div');
            tools.className = 'preview-tab-group preview-tool-group';
            const btnMove = document.createElement('button');
            btnMove.className = 'preview-mode-btn active';
            btnMove.type = 'button';
            btnMove.textContent = I18n.t('preview.tool.move');
            const btnRotate = document.createElement('button');
            btnRotate.className = 'preview-mode-btn';
            btnRotate.type = 'button';
            btnRotate.textContent = I18n.t('preview.tool.rotate');
            const btnOrigin = document.createElement('button');
            btnOrigin.className = 'preview-mode-btn';
            btnOrigin.type = 'button';
            btnOrigin.textContent = I18n.t('preview.tool.origin');
            const btnZoomIn = document.createElement('button');
            btnZoomIn.className = 'preview-mode-btn';
            btnZoomIn.type = 'button';
            btnZoomIn.textContent = I18n.t('preview.tool.zoomIn');
            btnZoomIn.classList.add('preview-mode-btn-compact');
            const btnZoomOut = document.createElement('button');
            btnZoomOut.className = 'preview-mode-btn';
            btnZoomOut.type = 'button';
            btnZoomOut.textContent = I18n.t('preview.tool.zoomOut');
            btnZoomOut.classList.add('preview-mode-btn-compact');
            const btnEdit = document.createElement('button');
            btnEdit.className = 'preview-mode-btn active';
            btnEdit.type = 'button';
            btnEdit.textContent = I18n.t('preview.tool.edit');
            const btnPan = document.createElement('button');
            btnPan.className = 'preview-mode-btn';
            btnPan.type = 'button';
            btnPan.textContent = I18n.t('preview.tool.pan');
            modeTabs.appendChild(viewTabs);
            tools.appendChild(btnMove);
            tools.appendChild(btnRotate);
            tools.appendChild(btnOrigin);
            tools.appendChild(btnZoomIn);
            tools.appendChild(btnZoomOut);
            tools.appendChild(btnEdit);
            tools.appendChild(btnPan);
            modeTabs.appendChild(tools);
            this.el.appendChild(modeTabs);
            this._modeButtons = { btn3d: btn3d, btnUv: btnUv, btnOptions: btnOptions };
            this._toolButtons = {
                btnMove: btnMove,
                btnRotate: btnRotate,
                btnOrigin: btnOrigin,
                btnZoomIn: btnZoomIn,
                btnZoomOut: btnZoomOut,
                btnEdit: btnEdit,
                btnPan: btnPan
            };

            const viewsWrap = document.createElement('div');
            viewsWrap.className = 'preview-views-wrap';
            this.el.appendChild(viewsWrap);

            // 3D viewport container and overlay controls
            this._viewerContainer = document.createElement('div');
            this._viewerContainer.className = 'preview-3d-container';
            this._viewerContainer.style.cssText = 'flex:1;position:relative;overflow:hidden;';
            viewsWrap.appendChild(this._viewerContainer);
            this._viewerContainer.appendChild(btnOptions);

            const animBar = document.createElement('div');
            animBar.className = 'preview-anim-bar';
            animBar.innerHTML =
                '<div class="preview-anim-content">' +
                    '<div class="preview-anim-field">' +
                        '<label class="preview-anim-label">' + Utils.escapeHtml(I18n.t('preview.animation')) + '</label>' +
                        '<select class="preview-anim-select preview-animation-select"></select>' +
                    '</div>' +
                    '<div class="preview-anim-field">' +
                        '<label class="preview-anim-label">' + Utils.escapeHtml(I18n.t('preview.action')) + '</label>' +
                        '<select class="preview-anim-select preview-action-select"></select>' +
                    '</div>' +
                    '<div class="preview-anim-field preview-anim-field-compact">' +
                        '<label class="preview-anim-label">' + Utils.escapeHtml(I18n.t('preview.meshNormals')) + '</label>' +
                        '<select class="preview-anim-select preview-mesh-normal-select">' +
                            '<option value="auto">' + Utils.escapeHtml(I18n.t('preview.meshNormals.auto')) + '</option>' +
                            '<option value="source">' + Utils.escapeHtml(I18n.t('preview.meshNormals.source')) + '</option>' +
                            '<option value="recalculate">' + Utils.escapeHtml(I18n.t('preview.meshNormals.recalculate')) + '</option>' +
                        '</select>' +
                    '</div>' +
                    '<label class="preview-anim-toggle">' +
                        '<input type="checkbox" class="preview-look-pointer-toggle">' +
                        '<span>' + Utils.escapeHtml(I18n.t('preview.lookAtPointer')) + '</span>' +
                    '</label>' +
                '</div>';
            this._viewerContainer.appendChild(animBar);
            this._animBar = animBar;
            this._animBarContent = animBar.querySelector('.preview-anim-content');
            this._animBarToggle = btnOptions;
            this._animationSelect = animBar.querySelector('.preview-animation-select');
            this._actionSelect = animBar.querySelector('.preview-action-select');
            this._meshNormalSelect = animBar.querySelector('.preview-mesh-normal-select');
            this._lookAtPointerToggle = animBar.querySelector('.preview-look-pointer-toggle');
            this._animBarCollapsed = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
            this._syncAnimBarCollapsed();
            if (this._meshNormalSelect) this._meshNormalSelect.value = this._polyMeshNormalMode;
            if (this._lookAtPointerToggle) this._lookAtPointerToggle.checked = this._lookAtPointerEnabled;

            this._toolBadge = document.createElement('div');
            this._toolBadge.className = 'preview-tool-badge';
            this._toolBadge.textContent = I18n.t('preview.tool.uvEditBadge');
            this._viewerContainer.appendChild(this._toolBadge);

            this._uvContainer = document.createElement('div');
            this._uvContainer.className = 'preview-uv-container';
            this._uvContainer.style.display = 'none';
            viewsWrap.appendChild(this._uvContainer);

            btn3d.addEventListener('click', () => this._switchMode('3d'));
            btnUv.addEventListener('click', async () => {
                this._switchMode('uv');
                await this._renderUvPreview(skin, project, token);
            });
            btnMove.addEventListener('click', () => this._setGizmoMode('translate'));
            btnRotate.addEventListener('click', () => this._setGizmoMode('rotate'));
            btnOrigin.addEventListener('click', () => this._setGizmoMode('offset'));
            btnZoomIn.addEventListener('click', () => this._adjustUvZoom(1));
            btnZoomOut.addEventListener('click', () => this._adjustUvZoom(-1));
            btnEdit.addEventListener('click', () => this._setUvToolMode('edit'));
            btnPan.addEventListener('click', () => this._setUvToolMode('pan'));
            if (this._meshNormalSelect) {
                this._meshNormalSelect.addEventListener('change', async () => {
                    var nextMode = this._meshNormalSelect.value || 'auto';
                    if (nextMode === this._polyMeshNormalMode) return;
                    this._polyMeshNormalMode = nextMode;
                    if (this._selectedSkin && this._currentProject) {
                        await this.showSkin(this._selectedSkin, this._currentProject);
                    }
                });
            }
            if (this._lookAtPointerToggle) {
                this._lookAtPointerToggle.addEventListener('change', () => {
                    this._lookAtPointerEnabled = !!this._lookAtPointerToggle.checked;
                    if (this._modelViewer) {
                        this._modelViewer.setLookAtPointerEnabled(this._lookAtPointerEnabled);
                    }
                });
            }
            if (this._animBarToggle) {
                this._animBarToggle.addEventListener('click', () => {
                    this._animBarCollapsed = !this._animBarCollapsed;
                    this._syncAnimBarCollapsed();
                });
            }
            // If no geometry is available, fall back to a texture-only preview
            if (!skin.geometry || !project.geometries || !project.geometries[skin.geometry]) {
                await this._showTextureFallback(skin, project);
                return;
            }

            // Create model viewer with the new container
            this._modelViewer = new SkinApex.ModelViewer(this._viewerContainer);
            this._modelViewer.setPolyMeshNormalMode(this._polyMeshNormalMode);
            this._modelViewer.setLookAtPointerEnabled(this._lookAtPointerEnabled);
            await this._modelViewer.showSkin(skin, project);
            this._populateAnimationSelect(skin);
            this._populateActionSelect();
            if (this._onAnimationStateChanged) {
                this._onAnimationStateChanged({
                    animatedBones: this.getAnimatedBones(),
                    animations: this.getAvailableAnimations()
                });
            }
            this._setGizmoMode('translate');
            this._syncToolUi();

        }

        /**
         * Show a file preview (image, JSON, or text)
         */
        async showFile(path, name, project) {
            this._stopViewer();
            this.el.innerHTML = '';
            this.el.className = '';
            this.el.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;';
            this._currentProject = project;

            const lower = name.toLowerCase();

            if (SkinApex.IMAGE_EXTENSIONS.test(lower)) {
                await this._showImage(path, name, project);
            } else if (lower.endsWith('.json')) {
                await this._showJson(path, project);
            } else {
                await this._showText(path, name, project);
            }
        }

        showHelpPage(title, body) {
            this._stopViewer();
            this._currentProject = null;
            this._selectedSkin = null;
            this.el.innerHTML = '';
            this.el.className = '';
            this.el.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;overflow:auto;';
            var content = '';
            if (body && typeof body === 'object' && (Array.isArray(body.sections) || Array.isArray(body.groups))) {
                var renderVisual = function (visual) {
                    if (!visual || typeof visual !== 'object') return '';
                    if (visual.type === 'chips') {
                        return '<div class="help-chip-row">' +
                            (visual.items || []).map(function (item) {
                                return '<span class="help-demo-chip ' + Utils.escapeHtml(item.className || '') + '">' + Utils.escapeHtml(item.label || '') + '</span>';
                            }).join('') +
                        '</div>';
                    }
                    if (visual.type === 'workspace') {
                        return '<div class="help-workspace-demo">' +
                            '<div class="help-workspace-col is-explorer">' + Utils.escapeHtml((visual.labels && visual.labels.explorer) || 'Explorer') + '</div>' +
                            '<div class="help-workspace-main">' +
                                '<div class="help-workspace-toolbar">' + Utils.escapeHtml((visual.labels && visual.labels.toolbar) || 'Toolbar') + '</div>' +
                                '<div class="help-workspace-preview">' + Utils.escapeHtml((visual.labels && visual.labels.preview) || 'Preview') + '</div>' +
                            '</div>' +
                            '<div class="help-workspace-col is-sidebar">' + Utils.escapeHtml((visual.labels && visual.labels.sidebar) || 'Sidebar') + '</div>' +
                        '</div>';
                    }
                    if (visual.type === 'tree') {
                        return '<div class="help-tree-demo">' +
                            (visual.items || []).map(function (item) {
                                return '<div class="help-tree-row ' + Utils.escapeHtml(item.className || '') + '" style="padding-left:' + String(item.indent || 0) + 'px">' +
                                    '<span class="help-tree-dot"></span>' +
                                    '<span class="help-tree-label">' + Utils.escapeHtml(item.label || '') + '</span>' +
                                    (item.badge ? '<span class="help-tree-badge ' + Utils.escapeHtml(item.badgeClass || '') + '">' + Utils.escapeHtml(item.badge) + '</span>' : '') +
                                '</div>';
                            }).join('') +
                        '</div>';
                    }
                    if (visual.type === 'toolbar') {
                        return '<div class="help-toolbar-demo">' +
                            (visual.items || []).map(function (item) {
                                return '<span class="help-toolbar-btn ' + Utils.escapeHtml(item.className || '') + '">' + Utils.escapeHtml(item.label || '') + '</span>';
                            }).join('') +
                        '</div>';
                    }
                    if (visual.type === 'steps') {
                        return '<div class="help-mini-steps">' +
                            (visual.items || []).map(function (item, index) {
                                return '<div class="help-mini-step">' +
                                    '<span class="help-mini-step-no">' + String(index + 1) + '</span>' +
                                    '<div class="help-mini-step-body">' +
                                        '<div class="help-mini-step-title">' + Utils.escapeHtml(item.title || '') + '</div>' +
                                        '<div class="help-mini-step-desc">' + Utils.escapeHtml(item.description || '') + '</div>' +
                                    '</div>' +
                                '</div>';
                            }).join('') +
                        '</div>';
                    }
                    return '';
                };
                var renderHeroCards = function (cards) {
                    if (!Array.isArray(cards) || !cards.length) return '';
                    return '<section class="help-hero-grid">' + cards.map(function (card) {
                        return '<article class="help-hero-card ' + Utils.escapeHtml(card.className || '') + '">' +
                            '<div class="help-hero-title">' + Utils.escapeHtml(card.title || '') + '</div>' +
                            '<div class="help-hero-text">' + Utils.escapeHtml(card.text || '') + '</div>' +
                        '</article>';
                    }).join('') + '</section>';
                };
                var renderItems = function (items) {
                    return items.map(function (item) {
                        if (typeof item === 'string') {
                            return '<div class="help-line">' + Utils.escapeHtml(item) + '</div>';
                        }
                        if (item && item.type === 'callout') {
                            return '<div class="help-callout ' + Utils.escapeHtml(item.className || '') + '">' + Utils.escapeHtml(item.text || '') + '</div>';
                        }
                        if (item && item.type === 'card-grid') {
                            return '<div class="help-card-grid">' + (item.cards || []).map(function (card) {
                                return '<article class="help-card">' +
                                    '<div class="help-card-title">' + Utils.escapeHtml(card.title || '') + '</div>' +
                                    '<div class="help-card-text">' + Utils.escapeHtml(card.text || '') + '</div>' +
                                '</article>';
                            }).join('') + '</div>';
                        }
                        if (item && item.type === 'visual') {
                            return '<div class="help-visual-card">' +
                                (item.title ? '<div class="help-visual-title">' + Utils.escapeHtml(item.title) + '</div>' : '') +
                                renderVisual(item.visual) +
                                (item.description ? '<div class="help-visual-desc">' + Utils.escapeHtml(item.description) + '</div>' : '') +
                            '</div>';
                        }
                        return '<div class="help-kv">' +
                            '<span class="help-kv-key">' + Utils.escapeHtml(item.key || '') + '</span>' +
                            '<span class="help-kv-value">' + Utils.escapeHtml(item.value || '') + '</span>' +
                        '</div>';
                    }).join('');
                };
                var slugify = function (text, prefix) {
                    var base = String(text || prefix || 'section').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
                    return (prefix || 'help') + '-' + (base || 'section');
                };
                var groups = Array.isArray(body.groups) ? body.groups : [{ title: '', sections: body.sections || [] }];
                var navHtml = '<nav class="help-nav">' + groups.map(function (group, groupIndex) {
                    var sections = Array.isArray(group.sections) ? group.sections : [];
                    var groupId = slugify(group.title || ('group-' + groupIndex), 'group');
                    return '<div class="help-nav-group">' +
                        (group.title ? '<a class="help-nav-group-title" href="#' + Utils.escapeHtml(groupId) + '">' + Utils.escapeHtml(group.title) + '</a>' : '') +
                        '<div class="help-nav-links">' + sections.map(function (section, sectionIndex) {
                            var sectionId = slugify(section.title || ('section-' + sectionIndex), 'section');
                            return '<a class="help-nav-link" href="#' + Utils.escapeHtml(sectionId) + '">' + Utils.escapeHtml(section.title || '') + '</a>';
                        }).join('') + '</div>' +
                    '</div>';
                }).join('') + '</nav>';
                var tutorial = '';
                if (body.tutorial && Array.isArray(body.tutorial.steps)) {
                    tutorial = '<section class="help-section help-tutorial">' +
                        '<div class="help-tutorial-grid">' +
                            body.tutorial.steps.map(function (step, index) {
                                return '<article class="tutorial-step-card">' +
                                    '<div class="tutorial-step-no">' + String(index + 1) + '</div>' +
                                    '<div class="tutorial-step-title">' + Utils.escapeHtml(step.title || '') + '</div>' +
                                    '<div class="tutorial-step-desc">' + Utils.escapeHtml(step.description || '') + '</div>' +
                                '</article>';
                            }).join('') +
                        '</div>' +
                        '<div class="tutorial-visuals">' +
                            '<div class="tutorial-visual-card">' +
                                '<div class="tutorial-visual-title">' + Utils.escapeHtml(body.tutorial.panelsTitle || '') + '</div>' +
                                '<div class="tutorial-workspace-demo">' +
                                    '<div class="tutorial-demo-explorer">Explorer</div>' +
                                    '<div class="tutorial-demo-preview">Preview</div>' +
                                    '<div class="tutorial-demo-sidebar">Sidebar</div>' +
                                '</div>' +
                                '<div class="tutorial-visual-desc">' + Utils.escapeHtml(body.tutorial.panelsDescription || '') + '</div>' +
                            '</div>' +
                            '<div class="tutorial-visual-card">' +
                                '<div class="tutorial-visual-title">' + Utils.escapeHtml(body.tutorial.colorsTitle || '') + '</div>' +
                                '<div class="tutorial-status-demo">' +
                                    '<span class="tutorial-status-chip is-pass">Green</span>' +
                                    '<span class="tutorial-status-chip is-warn">Yellow</span>' +
                                    '<span class="tutorial-status-chip is-error">Red</span>' +
                                '</div>' +
                                '<div class="tutorial-visual-desc">' + Utils.escapeHtml(body.tutorial.colorsDescription || '') + '</div>' +
                            '</div>' +
                        '</div>' +
                    '</section>';
                }
                content = '<div class="help-page help-page-doc">' +
                    navHtml +
                    '<div class="help-doc-content">' +
                        '<div class="help-page-header">' +
                            '<h1 class="help-page-title">' + Utils.escapeHtml(title) + '</h1>' +
                            (body.description ? '<p class="help-page-description">' + Utils.escapeHtml(body.description) + '</p>' : '') +
                        '</div>' +
                        renderHeroCards(body.heroCards) +
                        tutorial +
                        groups.map(function (group, groupIndex) {
                            var sections = Array.isArray(group.sections) ? group.sections : [];
                            var groupId = slugify(group.title || ('group-' + groupIndex), 'group');
                            return '<section class="help-doc-group">' +
                                (group.title ? '<div class="help-doc-group-title" id="' + Utils.escapeHtml(groupId) + '">' + Utils.escapeHtml(group.title) + '</div>' : '') +
                                sections.map(function (section, sectionIndex) {
                                    var items = Array.isArray(section.items) ? section.items : [];
                                    var sectionId = slugify(section.title || ('section-' + sectionIndex), 'section');
                                    return '<section class="help-section" id="' + Utils.escapeHtml(sectionId) + '">' +
                                        '<h2 class="help-section-title">' + Utils.escapeHtml(section.title || '') + '</h2>' +
                                        renderItems(items) +
                                    '</section>';
                                }).join('') +
                            '</section>';
                        }).join('') +
                    '</div>' +
                '</div>';
            } else {
                content = '<pre class="json-viewer">' + Utils.escapeHtml(String(body || '')) + '</pre>';
            }
            this.el.innerHTML =
                '<div class="preview-info-bar"><span class="preview-info-name">' + Utils.escapeHtml(title) + '</span></div>' +
                content;
        }

        /**
         * Stop the 3D viewer
         */
        _stopViewer() {
            this._uvRenderToken++;
            if (this._modelViewer) {
                this._modelViewer.destroy();
                this._modelViewer = null;
            }
            this._viewerContainer = null;
            this._uvContainer = null;
            this._modeButtons = null;
            this._toolButtons = null;
            this._selectedUvRect = null;
        }

        _switchMode(mode) {
            this._mode = mode;
            if (this._viewerContainer) {
                this._viewerContainer.style.display = mode === '3d' ? 'block' : 'none';
            }
            if (this._uvContainer) {
                this._uvContainer.style.display = mode === 'uv' ? 'flex' : 'none';
            }
            if (this._modeButtons) {
                this._modeButtons.btn3d.classList.toggle('active', mode === '3d');
                this._modeButtons.btnUv.classList.toggle('active', mode === 'uv');
            }
            if (this._animBar) {
                this._animBar.style.display = mode === '3d' ? '' : 'none';
            }
            if (mode === '3d' && this._modelViewer) {
                this._modelViewer.setGizmoMode('translate');
            }
            this._syncToolUi();
        }

        _syncAnimBarCollapsed() {
            if (!this._animBar || !this._animBarToggle || !this._animBarContent) return;
            this._animBar.classList.toggle('is-collapsed', !!this._animBarCollapsed);
            this._animBarToggle.setAttribute('aria-expanded', this._animBarCollapsed ? 'false' : 'true');
            this._animBar.style.display = this._animBarCollapsed ? 'none' : '';
        }

        _setGizmoMode(mode) {
            if (this._modelViewer) {
                this._modelViewer.setGizmoMode(mode);
            }
            if (this._toolButtons) {
                this._toolButtons.btnMove.classList.toggle('active', mode === 'translate');
                this._toolButtons.btnRotate.classList.toggle('active', mode === 'rotate');
                this._toolButtons.btnOrigin.classList.toggle('active', mode === 'offset');
            }
            if (this._toolBadge) {
                this._toolBadge.textContent = mode === 'rotate'
                    ? I18n.t('preview.tool.rotateBadge')
                    : (mode === 'offset' ? I18n.t('preview.tool.originBadge') : I18n.t('preview.tool.moveBadge'));
                this._toolBadge.classList.toggle('is-origin', mode === 'offset');
            }
        }

        _setUvToolMode(mode) {
            this._uvToolMode = mode === 'pan' ? 'pan' : 'edit';
            this._syncToolUi();
        }

        _adjustUvZoom(step) {
            var nextIndex = this._uvZoomIndex + step;
            if (nextIndex < 0) nextIndex = 0;
            if (nextIndex >= this._uvZoomLevels.length) nextIndex = this._uvZoomLevels.length - 1;
            if (nextIndex === this._uvZoomIndex) return;
            this._uvZoomIndex = nextIndex;
            if (this._selectedSkin && this._currentProject && this._mode === 'uv') {
                this._renderUvPreview(this._selectedSkin, this._currentProject, this._uvRenderToken);
            }
        }

        _zoomUvAt(step, anchorScreen, canvas, baseScale) {
            var currentZoom = this._uvZoomLevels[this._uvZoomIndex] || 1;
            var nextIndex = this._uvZoomIndex + step;
            if (nextIndex < 0) nextIndex = 0;
            if (nextIndex >= this._uvZoomLevels.length) nextIndex = this._uvZoomLevels.length - 1;
            if (nextIndex === this._uvZoomIndex) return;

            var nextZoom = this._uvZoomLevels[nextIndex] || currentZoom;
            var currentPixelsPerUnit = baseScale * currentZoom;
            var nextPixelsPerUnit = baseScale * nextZoom;
            var anchorUvX = this._uvPan.x + (anchorScreen.x / currentPixelsPerUnit);
            var anchorUvY = this._uvPan.y + (anchorScreen.y / currentPixelsPerUnit);

            this._uvZoomIndex = nextIndex;
            this._uvPan.x = anchorUvX - (anchorScreen.x / nextPixelsPerUnit);
            this._uvPan.y = anchorUvY - (anchorScreen.y / nextPixelsPerUnit);

            if (this._selectedSkin && this._currentProject && this._mode === 'uv') {
                this._renderUvPreview(this._selectedSkin, this._currentProject, this._uvRenderToken);
            }
        }

        _syncToolUi() {
            if (!this._toolButtons) return;
            var isUv = this._mode === 'uv';
            this._toolButtons.btnMove.style.display = isUv ? 'none' : '';
            this._toolButtons.btnRotate.style.display = isUv ? 'none' : '';
            this._toolButtons.btnOrigin.style.display = isUv ? 'none' : '';
            this._toolButtons.btnZoomIn.style.display = isUv ? '' : 'none';
            this._toolButtons.btnZoomOut.style.display = isUv ? '' : 'none';
            this._toolButtons.btnEdit.style.display = isUv ? '' : 'none';
            this._toolButtons.btnPan.style.display = isUv ? '' : 'none';
            this._toolButtons.btnMove.disabled = isUv;
            this._toolButtons.btnRotate.disabled = isUv;
            this._toolButtons.btnOrigin.disabled = isUv;
            this._toolButtons.btnZoomIn.classList.toggle('active', false);
            this._toolButtons.btnZoomOut.classList.toggle('active', false);
            this._toolButtons.btnEdit.classList.toggle('active', isUv && this._uvToolMode === 'edit');
            this._toolButtons.btnPan.classList.toggle('active', isUv && this._uvToolMode === 'pan');
            this._toolButtons.btnZoomIn.disabled = !isUv;
            this._toolButtons.btnZoomOut.disabled = !isUv;
            this._toolButtons.btnEdit.disabled = !isUv;
            this._toolButtons.btnPan.disabled = !isUv;
            if (isUv) {
                this._toolButtons.btnZoomOut.disabled = this._uvZoomIndex <= 0;
                this._toolButtons.btnZoomIn.disabled = this._uvZoomIndex >= this._uvZoomLevels.length - 1;
            }
            if (this._toolBadge) {
                if (isUv) {
                    this._toolBadge.textContent = this._uvToolMode === 'pan' ? I18n.t('preview.tool.uvPanBadge') : I18n.t('preview.tool.uvEditBadge');
                    this._toolBadge.classList.remove('is-origin');
                }
            }
        }

        _populateAnimationSelect(skin) {
            if (!this._animationSelect || !this._modelViewer) return;
            var animations = skin && skin.animations ? skin.animations : (skin && skin.data ? skin.data.animations : null);
            var options = ['<option value="__all__">' + Utils.escapeHtml(I18n.t('preview.animationAll')) + '</option>'];
            options.push('<option value="__none__">' + Utils.escapeHtml(I18n.t('preview.animationNone')) + '</option>');
            Object.keys(animations || {}).forEach(function (slot) {
                options.push('<option value="' + Utils.escapeHtml(slot) + '">' + Utils.escapeHtml(slot + ' -> ' + animations[slot]) + '</option>');
            });
            this._animationSelect.innerHTML = options.join('');
            this._animationSelect.value = '__all__';
            this._animationSelect.onchange = () => {
                var value = this._animationSelect.value;
                this._modelViewer.setSelectedAnimation(value);
                if (this._onAnimationStateChanged) {
                    this._onAnimationStateChanged({
                        animatedBones: this.getAnimatedBones(),
                        animations: this.getAvailableAnimations()
                    });
                }
            };
        }

        _populateActionSelect() {
            if (!this._actionSelect || !this._modelViewer) return;
            var presets = this._modelViewer.getPreviewAnimationPresets ? this._modelViewer.getPreviewAnimationPresets() : [];
            var options = ['<option value="__none__">' + Utils.escapeHtml(I18n.t('preview.actionNone')) + '</option>'];
            presets.forEach(function (preset) {
                options.push('<option value="__action__:' + Utils.escapeHtml(preset.key) + '">' + Utils.escapeHtml(I18n.t(preset.labelKey)) + '</option>');
            });
            this._actionSelect.innerHTML = options.join('');
            this._actionSelect.value = this._selectedAction || '__none__';
            this._actionSelect.onchange = () => {
                this._selectedAction = this._actionSelect.value || '__none__';
                this._modelViewer.setSelectedAction(this._selectedAction);
                if (this._onAnimationStateChanged) {
                    this._onAnimationStateChanged({
                        animatedBones: this.getAnimatedBones(),
                        animations: this.getAvailableAnimations()
                    });
                }
            };
            this._modelViewer.setSelectedAction(this._selectedAction);
        }

        getAnimatedBones() {
            return this._modelViewer ? this._modelViewer.getAnimatedBones() : {};
        }

        getAvailableAnimations() {
            return this._modelViewer ? this._modelViewer.getAvailableAnimations() : [];
        }

        async _renderUvPreview(skin, project, token) {
            if (!this._uvContainer) return;
            try {
                const geoData = skin && skin.geometry && project && project.geometries
                    ? project.geometries[skin.geometry]
                    : null;
                if (!geoData) {
                    this._uvContainer.innerHTML = '<div class="panel-empty">' + Utils.escapeHtml(I18n.t('preview.empty.noGeoUv')) + '</div>';
                    this._uvContainer.dataset.loaded = '1';
                    return;
                }

                this._uvContainer.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

                let img = this._getViewerTextureImage();
                if (!img && skin.texturePath) {
                    const blobUrl = await this._withTimeout(project.getTextureBlobUrl(skin.texturePath), 6000);
                    if (!blobUrl) {
                        this._uvContainer.innerHTML = '<div class="panel-empty">' + Utils.escapeHtml(I18n.t('preview.empty.textureMissing')) + '</div>';
                        this._uvContainer.dataset.loaded = '1';
                        return;
                    }
                    img = await this._withTimeout(this._loadImage(blobUrl), 6000);
                }

                if (token !== this._uvRenderToken || !this._uvContainer) return;
                if (!img) {
                    this._uvContainer.innerHTML = '<div class="panel-empty">' + Utils.escapeHtml(I18n.t('preview.empty.textureFailed')) + '</div>';
                    this._uvContainer.dataset.loaded = '1';
                    return;
                }

                const texW = img.width;
                const texH = img.height;
                const maxSide = Math.max(texW, texH);
                const baseScale = Math.max(2, Math.floor(700 / maxSide));
                const requestedZoom = this._uvZoomLevels[this._uvZoomIndex] || 1;
                const effectiveZoom = requestedZoom;

                const triangles = this._collectUvTriangles(geoData, texW, texH);
                const rects = this._collectEditableUvRects(geoData);
                const drawCount = Math.min(triangles.length, 12000);

                this._uvContainer.innerHTML = '';
                const meta = document.createElement('div');
                meta.className = 'preview-uv-meta';
                meta.textContent = 'Texture ' + texW + 'x' + texH + ' | Zoom ' + effectiveZoom.toFixed(2) + 'x | Triangles ' + triangles.length + (drawCount < triangles.length ? ' (showing ' + drawCount + ')' : '') + ' | UV Rects ' + rects.length;
                const viewport = document.createElement('div');
                viewport.className = 'preview-uv-viewport';
                const canvas = document.createElement('canvas');
                canvas.className = 'preview-uv-canvas';
                viewport.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
                viewport.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
                this._uvContainer.appendChild(meta);
                viewport.appendChild(canvas);
                this._uvContainer.appendChild(viewport);
                var viewportWidth = Math.max(320, viewport.clientWidth || 320);
                var viewportHeight = Math.max(240, viewport.clientHeight || 240);
                canvas.width = viewportWidth;
                canvas.height = viewportHeight;
                this._wireUvEditor(canvas, img, baseScale, effectiveZoom, rects, triangles, texW, texH);
            } catch (err) {
                if (!this._uvContainer) return;
                this._uvContainer.innerHTML = '<div class="panel-empty">' + Utils.escapeHtml(I18n.t('preview.empty.uvFailed')) + '</div>';
                console.error('UV preview failed:', err);
            }
        }

        _collectUvTriangles(geoData, texW, texH) {
            const triangles = [];
            const bones = (geoData && geoData.bones) ? geoData.bones : [];

            for (let b = 0; b < bones.length; b++) {
                const bone = bones[b];

                if (bone.cubes) {
                    for (let c = 0; c < bone.cubes.length; c++) {
                        const cubeObj = bone.cubes[c];
                        const isPerFace = cubeObj.uv && typeof cubeObj.uv === 'object' && !Array.isArray(cubeObj.uv);

                        const cubeData = SkinApex.ModelViewer._generateCubeGeometry(
                            cubeObj, texW, texH, bone.mirror === true
                        );
                        if (!cubeData || !cubeData.uvs) continue;
                        for (let i = 0; i < cubeData.uvs.length; i += 6) {
                            triangles.push([
                                [cubeData.uvs[i] * texW, (1 - cubeData.uvs[i + 1]) * texH],
                                [cubeData.uvs[i + 2] * texW, (1 - cubeData.uvs[i + 3]) * texH],
                                [cubeData.uvs[i + 4] * texW, (1 - cubeData.uvs[i + 5]) * texH]
                            ]);
                        }
                    }
                }

                const pm = bone.poly_mesh;
                if (pm && pm.positions && pm.uvs && pm.polys) {
                    const normalized = pm.normalized_uvs !== false;
                    for (let pi = 0; pi < pm.polys.length; pi++) {
                        const poly = pm.polys[pi];
                        if (!Array.isArray(poly) || poly.length < 3) continue;
                        for (let ti = 1; ti < poly.length - 1; ti++) {
                            const tri = [poly[0], poly[ti], poly[ti + 1]];
                            const points = [];
                            for (let ci = 0; ci < 3; ci++) {
                                const corner = tri[ci];
                                const uvIndex = (corner[2] !== undefined) ? corner[2] : 0;
                                const uv = pm.uvs[uvIndex] || [0, 0];
                                let u = uv[0];
                                let v = uv[1];
                                if (normalized) {
                                    u *= texW;
                                    v *= texH;
                                }
                                points.push([u, texH - v]);
                            }
                            triangles.push(points);
                        }
                    }
                }
            }

            return triangles;
        }

        _collectEditableUvRects(geoData) {
            const rects = [];
            const viewer = this._modelViewer;
            const selectedBone = viewer ? viewer.getHighlightedBone() : null;
            const bones = (geoData && geoData.bones) ? geoData.bones : [];

            for (let b = 0; b < bones.length; b++) {
                const bone = bones[b];
                const boneName = bone.name || ('bone_' + b);
                if (selectedBone && boneName !== selectedBone) continue;
                const cubes = bone.cubes || [];
                for (let c = 0; c < cubes.length; c++) {
                    const cube = cubes[c];
                    if (cube.uv && typeof cube.uv === 'object' && !Array.isArray(cube.uv)) {
                        ['north', 'east', 'south', 'west', 'up', 'down'].forEach((face) => {
                            const faceUv = cube.uv[face];
                            if (!faceUv || !Array.isArray(faceUv.uv)) return;
                            const size = Array.isArray(faceUv.uv_size) ? faceUv.uv_size : [0, 0];
                            rects.push({
                                type: 'per-face',
                                bone,
                                cube,
                                face,
                                x: faceUv.uv[0],
                                y: faceUv.uv[1],
                                w: size[0],
                                h: size[1]
                            });
                        });
                    } else if (Array.isArray(cube.uv)) {
                        const layout = this._getBoxUvRectLayout(cube, bone);
                        rects.push({
                            type: 'box',
                            part: 'west',
                            bone,
                            cube,
                            x: layout.west.x,
                            y: layout.west.y,
                            w: layout.west.w,
                            h: layout.west.h
                        });
                        rects.push({
                            type: 'box',
                            part: 'north',
                            bone,
                            cube,
                            x: layout.north.x,
                            y: layout.north.y,
                            w: layout.north.w,
                            h: layout.north.h
                        });
                        rects.push({
                            type: 'box',
                            part: 'east',
                            bone,
                            cube,
                            x: layout.east.x,
                            y: layout.east.y,
                            w: layout.east.w,
                            h: layout.east.h
                        });
                        rects.push({
                            type: 'box',
                            part: 'south',
                            bone,
                            cube,
                            x: layout.south.x,
                            y: layout.south.y,
                            w: layout.south.w,
                            h: layout.south.h
                        });
                        rects.push({
                            type: 'box',
                            part: 'up',
                            bone,
                            cube,
                            x: layout.up.x,
                            y: layout.up.y,
                            w: layout.up.w,
                            h: layout.up.h
                        });
                        rects.push({
                            type: 'box',
                            part: 'down',
                            bone,
                            cube,
                            x: layout.down.x,
                            y: layout.down.y,
                            w: layout.down.w,
                            h: layout.down.h
                        });
                    }
                }
            }

            return rects;
        }

        _isBoxUvMirrored(cube, bone) {
            return cube && cube.mirror !== undefined ? cube.mirror === true : !!(bone && bone.mirror === true);
        }

        _getBoxUvSize(cube) {
            const size = cube.size || [0, 0, 0];
            return {
                sx: Math.max(0, Math.floor((Number(size[0]) || 0) + 0.0000001)),
                sy: Math.max(0, Math.floor((Number(size[1]) || 0) + 0.0000001)),
                sz: Math.max(0, Math.floor((Number(size[2]) || 0) + 0.0000001))
            };
        }

        _getBoxUvRectLayout(cube, bone) {
            const { sx, sy, sz } = this._getBoxUvSize(cube);
            const baseX = Number(cube.uv && cube.uv[0]) || 0;
            const baseY = Number(cube.uv && cube.uv[1]) || 0;
            const layout = {
                east: { x: baseX, y: baseY + sz, w: sz, h: sy },
                west: { x: baseX + sz + sx, y: baseY + sz, w: sz, h: sy },
                north: { x: baseX + sz, y: baseY + sz, w: sx, h: sy },
                south: { x: baseX + (2 * sz) + sx, y: baseY + sz, w: sx, h: sy },
                up: { x: baseX + sz, y: baseY, w: sx, h: sz },
                down: { x: baseX + sz + sx, y: baseY, w: sx, h: sz }
            };
            if (this._isBoxUvMirrored(cube, bone)) {
                const east = layout.east;
                layout.east = layout.west;
                layout.west = east;
            }
            return layout;
        }

        _getBoxUvPreviewRectLayout(cube, bone) {
            const layout = this._getBoxUvRectLayout(cube, bone);
            const preview = {};
            const bleedMargin = 1 / 64;
            Object.keys(layout).forEach((key) => {
                const rect = layout[key];
                preview[key] = {
                    x: rect.x + bleedMargin,
                    y: rect.y + bleedMargin,
                    w: Math.max(0, rect.w - (bleedMargin * 2)),
                    h: Math.max(0, rect.h - (bleedMargin * 2))
                };
            });
            return preview;
        }

        _getDisplayedUvRect(rect) {
            if (!rect || rect.type !== 'box') return rect;
            const preview = this._getBoxUvPreviewRectLayout(rect.cube, rect.bone);
            const next = preview[rect.part];
            return next ? {
                x: next.x,
                y: next.y,
                w: next.w,
                h: next.h
            } : rect;
        }

        _setBoxUvFromDraggedRect(rect, nextX, nextY) {
            const cube = rect.cube;
            const bone = rect.bone;
            const { sx, sz } = this._getBoxUvSize(cube);
            const mirrored = this._isBoxUvMirrored(cube, bone);
            let baseX = Number(cube.uv && cube.uv[0]) || 0;
            let baseY = Number(cube.uv && cube.uv[1]) || 0;

            switch (rect.part) {
                case 'west':
                    baseX = mirrored ? nextX : (nextX - sz - sx);
                    baseY = nextY - sz;
                    break;
                case 'north':
                    baseX = nextX - sz;
                    baseY = nextY - sz;
                    break;
                case 'east':
                    baseX = mirrored ? (nextX - sz - sx) : nextX;
                    baseY = nextY - sz;
                    break;
                case 'south':
                    baseX = nextX - (2 * sz) - sx;
                    baseY = nextY - sz;
                    break;
                case 'up':
                    baseX = nextX - sz;
                    baseY = nextY;
                    break;
                case 'down':
                    baseX = nextX - sz - sx;
                    baseY = nextY;
                    break;
            }

            cube.uv = [baseX, baseY];
            return this._getBoxUvRectLayout(cube, bone);
        }

        _syncBoxUvRects(rects, targetRect) {
            const layout = this._getBoxUvRectLayout(targetRect.cube, targetRect.bone);
            rects.forEach((rect) => {
                if (rect.type !== 'box' || rect.cube !== targetRect.cube) return;
                const next = layout[rect.part];
                if (!next) return;
                rect.x = next.x;
                rect.y = next.y;
                rect.w = next.w;
                rect.h = next.h;
            });
        }

        _wireUvEditor(canvas, img, baseScale, zoom, rects, triangles, texW, texH) {
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            const pixelsPerUnit = baseScale * zoom;
            const visibleWidth = canvas.width / pixelsPerUnit;
            const visibleHeight = canvas.height / pixelsPerUnit;
            const clampPan = () => {
                const maxX = Math.max(0, texW - visibleWidth);
                const maxY = Math.max(0, texH - visibleHeight);
                this._uvPan.x = Math.max(0, Math.min(maxX, this._uvPan.x));
                this._uvPan.y = Math.max(0, Math.min(maxY, this._uvPan.y));
            };
            const worldToScreen = (u, v) => ({
                x: (u - this._uvPan.x) * pixelsPerUnit,
                y: (v - this._uvPan.y) * pixelsPerUnit
            });
            const screenToWorld = (x, y) => ({
                x: this._uvPan.x + (x / pixelsPerUnit),
                y: this._uvPan.y + (y / pixelsPerUnit)
            });
            const getLiveTriangles = () => {
                const geo = this._currentProject && this._selectedSkin && this._currentProject.geometries
                    ? this._currentProject.geometries[this._selectedSkin.geometry]
                    : null;
                return geo ? this._collectUvTriangles(geo, texW, texH) : triangles;
            };
            const redraw = () => {
                clampPan();
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(
                    img,
                    this._uvPan.x,
                    this._uvPan.y,
                    visibleWidth,
                    visibleHeight,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );
                const liveTriangles = getLiveTriangles();
                const drawCount = Math.min(liveTriangles.length, 12000);
                for (let i = 0; i < drawCount; i++) {
                    const tri = liveTriangles[i];
                    const hue = Math.round((i * 360) / Math.max(1, drawCount));
                    const p0 = worldToScreen(tri[0][0], tri[0][1]);
                    const p1 = worldToScreen(tri[1][0], tri[1][1]);
                    const p2 = worldToScreen(tri[2][0], tri[2][1]);
                    ctx.beginPath();
                    ctx.moveTo(p0.x, p0.y);
                    ctx.lineTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.closePath();
                    ctx.fillStyle = 'hsla(' + hue + ', 85%, 52%, 0.08)';
                    ctx.strokeStyle = 'hsla(' + hue + ', 95%, 65%, 0.7)';
                    ctx.lineWidth = 1;
                    ctx.fill();
                    ctx.stroke();
                }
                rects.forEach((rect) => {
                    const displayRect = this._getDisplayedUvRect(rect);
                    const p = worldToScreen(displayRect.x, displayRect.y);
                    ctx.strokeStyle = rect === this._selectedUvRect ? '#75beff' : '#007acc';
                    ctx.lineWidth = rect === this._selectedUvRect ? 2 : 1;
                    ctx.strokeRect(p.x, p.y, displayRect.w * pixelsPerUnit, displayRect.h * pixelsPerUnit);
                });
            };

            let drag = null;
            let pinch = null;
            const pickRect = (x, y) => {
                const world = screenToWorld(x, y);
                return rects.slice().reverse().find((rect) => world.x >= rect.x && world.x <= (rect.x + rect.w) && world.y >= rect.y && world.y <= (rect.y + rect.h)) || null;
            };
            const getCanvasPoint = (e) => {
                const rect = canvas.getBoundingClientRect();
                const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
                const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
                return {
                    x: (e.clientX - rect.left) * scaleX,
                    y: (e.clientY - rect.top) * scaleY
                };
            };
            const getPinchDistance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
            const activePointers = new Map();

            canvas.addEventListener('pointerdown', (e) => {
                activePointers.set(e.pointerId, getCanvasPoint(e));
                if (activePointers.size === 2) {
                    const points = Array.from(activePointers.values());
                    pinch = {
                        distance: getPinchDistance(points[0], points[1]),
                        center: {
                            x: (points[0].x + points[1].x) / 2,
                            y: (points[0].y + points[1].y) / 2
                        }
                    };
                    drag = null;
                    return;
                }
                const point = getCanvasPoint(e);
                const x = point.x;
                const y = point.y;
                const hit = pickRect(x, y);
                this._selectedUvRect = hit;
                if (this._uvToolMode === 'pan') {
                    drag = {
                        type: 'pan',
                        startX: x,
                        startY: y,
                        origPanX: this._uvPan.x,
                        origPanY: this._uvPan.y
                    };
                    canvas.setPointerCapture(e.pointerId);
                } else if (hit) {
                    drag = { rect: hit, startX: x, startY: y, origX: hit.x, origY: hit.y };
                    canvas.setPointerCapture(e.pointerId);
                }
                redraw();
            });

            canvas.addEventListener('pointermove', (e) => {
                if (activePointers.has(e.pointerId)) {
                    activePointers.set(e.pointerId, getCanvasPoint(e));
                }
                if (activePointers.size === 2) {
                    const points = Array.from(activePointers.values());
                    const distance = getPinchDistance(points[0], points[1]);
                    const center = {
                        x: (points[0].x + points[1].x) / 2,
                        y: (points[0].y + points[1].y) / 2
                    };
                    if (pinch) {
                        if (distance > pinch.distance * 1.08) {
                            this._zoomUvAt(1, center, canvas, baseScale);
                            pinch = { distance: distance, center: center };
                        } else if (distance < pinch.distance / 1.08) {
                            this._zoomUvAt(-1, center, canvas, baseScale);
                            pinch = { distance: distance, center: center };
                        }
                    }
                    return;
                }
                if (!drag) return;
                if (drag.type === 'pan') {
                    const point = getCanvasPoint(e);
                    this._uvPan.x = drag.origPanX - ((point.x - drag.startX) / pixelsPerUnit);
                    this._uvPan.y = drag.origPanY - ((point.y - drag.startY) / pixelsPerUnit);
                    redraw();
                    return;
                }
                const point = getCanvasPoint(e);
                const x = point.x;
                const y = point.y;
                const dx = Math.round((x - drag.startX) / pixelsPerUnit);
                const dy = Math.round((y - drag.startY) / pixelsPerUnit);
                const nextX = drag.origX + dx;
                const nextY = drag.origY + dy;
                if (drag.rect.type === 'per-face') {
                    drag.rect.x = nextX;
                    drag.rect.y = nextY;
                    drag.rect.cube.uv[drag.rect.face].uv = [drag.rect.x, drag.rect.y];
                } else {
                    this._setBoxUvFromDraggedRect(drag.rect, nextX, nextY);
                    this._syncBoxUvRects(rects, drag.rect);
                }
                redraw();
            });

            const commit = () => {
                if (!drag) return;
                if (drag.type === 'pan') {
                    drag = null;
                    redraw();
                    return;
                }
                if (drag.rect.type === 'per-face') {
                    drag.rect.cube.uv[drag.rect.face].uv = [drag.rect.x, drag.rect.y];
                } else {
                    this._setBoxUvFromDraggedRect(drag.rect, drag.rect.x, drag.rect.y);
                    this._syncBoxUvRects(rects, drag.rect);
                }
                const viewer = this._modelViewer;
                if (viewer) viewer.refreshGeometry();
                drag = null;
                redraw();
            };

            canvas.addEventListener('pointerup', commit);
            canvas.addEventListener('pointercancel', commit);
            canvas.addEventListener('pointerup', (e) => {
                activePointers.delete(e.pointerId);
                if (activePointers.size < 2) pinch = null;
            });
            canvas.addEventListener('pointercancel', (e) => {
                activePointers.delete(e.pointerId);
                if (activePointers.size < 2) pinch = null;
            });
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const point = getCanvasPoint(e);
                this._zoomUvAt(e.deltaY < 0 ? 1 : -1, point, canvas, baseScale);
            }, { passive: false });
            redraw();
        }

        _getViewerTextureImage() {
            const viewer = this._modelViewer;
            if (!viewer || !viewer.currentTexture || !viewer.currentTexture.image) return null;
            const image = viewer.currentTexture.image;
            if (!image.width || !image.height) return null;
            return image;
        }

        _flipUvRectY(y, h) {
            return -(Number(y) || 0) - (Number(h) || 0);
        }

        _loadImage(src) {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = src;
            });
        }

        _withTimeout(promise, timeoutMs) {
            return new Promise((resolve, reject) => {
                let done = false;
                const timer = setTimeout(function () {
                    if (done) return;
                    done = true;
                    reject(new Error('timeout'));
                }, timeoutMs);

                promise.then(function (value) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve(value);
                }).catch(function (err) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    reject(err);
                });
            });
        }

        /**
         * Fallback to 2D texture when no 3D geometry is available
         */
        async _showTextureFallback(skin, project) {
            if (!skin.texturePath) {
                this.el.innerHTML =
                    '<div class="skin-detail">' +
                    '<div class="skin-detail-info">' +
                    '<h3>' + Utils.escapeHtml(skin.name) + '</h3>' +
                    '<p>' + Utils.escapeHtml(I18n.t('preview.empty.noGeoTex')) + '</p>' +
                    '</div>' +
                    '</div>';
                return;
            }

            const blobUrl = await project.getTextureBlobUrl(skin.texturePath);
            if (!blobUrl) {
                this.el.innerHTML =
                    '<div class="skin-detail">' +
                    '<div class="skin-detail-info">' +
                    '<h3>' + Utils.escapeHtml(skin.name) + '</h3>' +
                    '<p>' + Utils.escapeHtml(I18n.t('preview.empty.textureMissing')) + ': ' + Utils.escapeHtml(skin.texturePath) + '</p>' +
                    '</div>' +
                    '</div>';
                return;
            }

            const img = new Image();
            img.onload = () => {
                const maxDim = Math.min(256, Math.max(img.width, img.height));
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.className = 'skin-detail-canvas';
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                this.el.innerHTML =
                    '<div class="skin-detail">' +
                    '<div class="skin-detail-canvas-wrap"></div>' +
                    '<div class="skin-detail-info">' +
                    '<h3>' + Utils.escapeHtml(skin.name) + '</h3>' +
                    '<p>' + Utils.escapeHtml(skin.geometry || I18n.t('preview.empty.noGeometry')) +
                    ' &middot; ' + img.width + 'x' + img.height + ' &middot; ' +
                    Utils.escapeHtml(skin.texturePath) + '</p>' +
                    '</div>' +
                    '</div>';
                this.el.querySelector('.skin-detail-canvas-wrap').appendChild(canvas);
            };
            img.src = blobUrl;
        }

        // ---- Private renderers ----

        async _showImage(path, name, project) {
            const url = await project.getFileBlobUrl(path);
            if (url) {
                this.el.innerHTML =
                    '<div class="image-preview">' +
                    '<img src="' + url + '" alt="' + Utils.escapeHtml(name) + '">' +
                    '</div>';
            } else {
                this.el.innerHTML = '<div class="empty-state"><p>Failed to load image</p></div>';
            }
        }

        async _showJson(path, project) {
            const text = await project.getFileText(path);
            if (text !== null) {
                try {
                    const formatted = JSON.stringify(JSON.parse(text), null, 2);
                    this.el.innerHTML = '<pre class="json-viewer">' + Utils.escapeHtml(formatted) + '</pre>';
                } catch (e) {
                    this.el.innerHTML = '<pre class="json-viewer">' + Utils.escapeHtml(text) + '</pre>';
                }
            } else {
                this.el.innerHTML = '<div class="empty-state"><p>Failed to read file</p></div>';
            }
        }

        async _showText(path, name, project) {
            const text = await project.getFileText(path);
            if (text !== null) {
                this.el.innerHTML = '<pre class="json-viewer">' + Utils.escapeHtml(text) + '</pre>';
            } else {
                this.el.innerHTML =
                    '<div class="empty-state">' +
                    '<p>' + Utils.escapeHtml(name) + '</p>' +
                    '<p>Binary file - cannot preview</p>' +
                    '</div>';
            }
        }

        /**
         * Get the current ModelViewer instance (for bone editing)
         */
        getModelViewer() {
            return this._modelViewer;
        }

        /**
         * Destroy and clean up
         */
        destroy() {
            this._stopViewer();
        }
    }

    window.SkinApex.PreviewPanel = PreviewPanel;
})();
