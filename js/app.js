/* ============================================================
   SkinApex - App (Main Controller)
   Orchestrates all modules: tabs, panels, drag-drop, shortcuts,
   and skeleton editing (outline + bone editor + model viewer).
   ============================================================ */

(function () {
    'use strict';

    // References to modules (loaded before this file)
    const Logger = SkinApex.Logger;
    const Project = SkinApex.Project;
    const TabManager = SkinApex.TabManager;
    const Explorer = SkinApex.Explorer;
    const SkinList = SkinApex.SkinList;
    const OutlinePanel = SkinApex.OutlinePanel;
    const BoneEditor = SkinApex.BoneEditor;
    const ModalManager = SkinApex.ModalManager;
    const SkinPropertiesPanel = SkinApex.SkinPropertiesPanel;
    const PreviewPanel = SkinApex.PreviewPanel;
    const StatusBar = SkinApex.StatusBar;
    const HistoryManager = SkinApex.HistoryManager;
    const Utils = SkinApex.Utils;
    const CryptManager = SkinApex.CryptManager;
    const I18n = SkinApex.I18n;

    class App {
        constructor() {
            // Initialize sub-modules
            this.logger = new Logger(document.getElementById('log-output'));
            this.tabManager = new TabManager();
            this.explorer = new Explorer();
            this.skinList = new SkinList();
            this.outlinePanel = new OutlinePanel();
            this.boneEditor = new BoneEditor();
            this.modal = new ModalManager();
            this.skinProperties = new SkinPropertiesPanel();
            this.previewPanel = new PreviewPanel();
            this.statusBar = new StatusBar();
            this._selectedSkinIndex = -1;
            this._currentSkin = null;
            this._historyByTabId = new Map();
            
            // Initialize WASM crypto worker
            this._initCrypto();

            // DOM references
            this.welcomeEl = document.getElementById('welcome');
            this.workspaceEl = document.getElementById('workspace');
            this.tabbarEl = document.getElementById('tabbar');
            this.dropOverlay = document.getElementById('drop-overlay');
            this.fileInput = document.getElementById('file-input');
            this.folderInput = document.getElementById('folder-input');
            this.mobileNavEl = document.getElementById('mobile-nav');
            this.sidebarResizerEl = document.getElementById('sidebar-resizer');
            this.rightResizerEl = document.getElementById('right-resizer');
            this.rightBodyEl = document.getElementById('right-body');
            this.rightBodySplitterEl = document.getElementById('right-body-splitter');
            this.detailSplitterEl = document.getElementById('detail-splitter');
            this.detailTabsEl = document.getElementById('detail-tabs');
            this.boneEditorHeaderHandleEl = null;

            // Panel visibility state
            this._showSidebar = true;
            this._showRight = true;
            this._mobilePanel = 'preview';
            this._layoutStorageKey = 'skinapex-layout-v1';
        }

        /**
         * Initialize the application: wire up all events
         */
        init() {
            this._wireTabManager();
            this._wireSkinList();
            this._wireExplorer();
            this._wireOutline();
            this._wireBoneEditor();
            this._wireSkinProperties();
            this._setupDragDrop();
            this._setupFileInput();
            this._setupFolderInput();
            this._setupShortcuts();
            this._setupActivityButtons();
            this._setupWelcome();
            this._setupToolbarActions();
            this._setupDetailTabs();
            this._setupMobileNav();
            this._restoreDesktopLayoutState();
            this._setupDesktopResizers();
            this._setupMobilePanelDragHandles();
            this.previewPanel.setOnAnimationStateChanged((state) => {
                this.outlinePanel.setAnimatedBones(state && state.animatedBones ? state.animatedBones : {});
            });
            document.addEventListener('skinapex:locale-changed', () => this._handleLocaleChanged());

            this._showWelcome();
        }

        _handleLocaleChanged() {
            var active = this.tabManager.getActive();
            if (!active || !active.project) {
                this.statusBar.set(I18n.t('status.ready'));
                return;
            }
            this._onTabChanged(active.id, active.project);
        }

        // ---- Event Wiring ----

        _wireTabManager() {
            this.tabManager.setOnChange((tabId, project) => {
                this._onTabChanged(tabId, project);
            });
        }

        _getHistoryForTab(tabId) {
            if (!tabId) return null;
            var history = this._historyByTabId.get(tabId);
            if (history) return history;
            history = new HistoryManager(100);
            history.setOnChange(() => this._updateHistoryUi());
            this._historyByTabId.set(tabId, history);
            return history;
        }

        _getActiveHistory() {
            var tab = this.tabManager.getActive();
            return tab ? this._getHistoryForTab(tab.id) : null;
        }

        _pushHistoryAction(action) {
            var history = this._getActiveHistory();
            if (!history || history.isApplying) return;
            history.push(action);
        }

        _updateHistoryUi() {
            var history = this._getActiveHistory();
            var canUndo = !!(history && history.canUndo());
            var canRedo = !!(history && history.canRedo());
            var undoBtn = document.querySelector('.menu-action[data-action="undo"]');
            var redoBtn = document.querySelector('.menu-action[data-action="redo"]');
            if (undoBtn) undoBtn.disabled = !canUndo;
            if (redoBtn) redoBtn.disabled = !canRedo;
            this._refreshHistorySubmenus();
        }

        _closeTab(tabId) {
            if (tabId) this._historyByTabId.delete(tabId);
            this.tabManager.close(tabId);
            this._updateHistoryUi();
        }

        _resetTabHistory(tabId) {
            if (!tabId) return;
            this._historyByTabId.delete(tabId);
            this._getHistoryForTab(tabId);
            this._updateHistoryUi();
        }

        async _undo() {
            var history = this._getActiveHistory();
            if (!history || !history.canUndo()) return;
            var action = await history.undo();
            if (action && action.label) {
                this.statusBar.setMessage(I18n.format('status.undo', { action: action.label }));
            }
        }

        async _redo() {
            var history = this._getActiveHistory();
            if (!history || !history.canRedo()) return;
            var action = await history.redo();
            if (action && action.label) {
                this.statusBar.setMessage(I18n.format('status.redo', { action: action.label }));
            }
        }

        async _undoToAction(action) {
            var history = this._getActiveHistory();
            if (!history || !action) return;
            var actions = await history.undoTo(action);
            var last = actions.length ? actions[actions.length - 1] : null;
            if (last && last.label) {
                this.statusBar.setMessage(I18n.format('status.undo', { action: last.label }));
            }
        }

        async _redoToAction(action) {
            var history = this._getActiveHistory();
            if (!history || !action) return;
            var actions = await history.redoTo(action);
            var last = actions.length ? actions[actions.length - 1] : null;
            if (last && last.label) {
                this.statusBar.setMessage(I18n.format('status.redo', { action: last.label }));
            }
        }

        _isEditingTextInput(target) {
            if (!target) return false;
            var tag = target.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.closest('[contenteditable="true"]');
        }

        _cloneValue(value) {
            if (Array.isArray(value) || (value && typeof value === 'object')) {
                return JSON.parse(JSON.stringify(value));
            }
            return value;
        }

        async _refreshCurrentSkinPanels() {
            var active = this.tabManager.getActive();
            if (!active || !active.project || !this._currentSkin) return;
            await this.previewPanel.showSkin(this._currentSkin, active.project);
            if (this._currentSkin.geometry && active.project.geometries && active.project.geometries[this._currentSkin.geometry]) {
                this.outlinePanel.render(this._currentSkin.geometry, active.project.geometries[this._currentSkin.geometry]);
                this.outlinePanel.setAnimatedBones(this.previewPanel.getAnimatedBones());
            }
            this.skinProperties.show(this._currentSkin);
            this._switchDetailTab('skin');
        }

        async _applySkinMutation(skin, mutation, options) {
            options = options || {};
            if (!skin || !skin.data || !mutation) return;

            if (mutation.type === 'name') {
                skin.name = mutation.value;
                if (skin.data.localization_name !== undefined) skin.data.localization_name = mutation.value;
                else skin.data.name = mutation.value;
            } else if (mutation.type === 'skin_type') {
                skin.type = mutation.value || 'skin';
                if (skin.data.skin_type !== undefined) skin.data.skin_type = mutation.value;
                else if (skin.data.class !== undefined) skin.data.class = mutation.value;
                else skin.data.type = mutation.value;
            } else if (mutation.type === 'hide_framework') {
                skin.data.hide_framework = !!mutation.value;
            } else if (mutation.type === 'animations') {
                var nextAnimations = Object.assign({}, mutation.value || {});
                skin.animations = nextAnimations;
                skin.data.animations = Object.assign({}, nextAnimations);
            }

            this._refreshSkinListSelection();
            if (this._currentSkin === skin) {
                await this._refreshCurrentSkinPanels();
            }

            if (options.recordHistory !== false) {
                this._pushHistoryAction({
                    label: mutation.label,
                    mergeKey: mutation.mergeKey,
                    undo: async () => {
                        await this._applySkinMutation(skin, {
                            type: mutation.type,
                            value: this._cloneValue(mutation.before)
                        }, { recordHistory: false });
                    },
                    redo: async () => {
                        await this._applySkinMutation(skin, {
                            type: mutation.type,
                            value: this._cloneValue(mutation.after)
                        }, { recordHistory: false });
                    }
                });
            }
        }

        _getBoneHistoryLabel(property, boneName) {
            if (property === 'pivot') return I18n.format('history.bonePivot', { name: boneName });
            if (property === 'translation') return I18n.format('history.boneTranslation', { name: boneName });
            if (property === 'offset') return I18n.format('history.boneOffset', { name: boneName });
            if (property === 'parent') return I18n.format('history.boneParent', { name: boneName });
            return I18n.format('history.boneRotation', { name: boneName });
        }

        _getBoneSnapshot(geoData) {
            return this._cloneValue(geoData && geoData.bones ? geoData.bones : []);
        }

        _getBoneMutationBeforeValue(bone, property) {
            if (!bone) return null;
            if (property === 'translation') {
                return bone.pivot && bone.pivot.slice ? bone.pivot.slice() : [0, 0, 0];
            }
            if (property === 'offset') {
                return [0, 0, 0];
            }
            if (property === 'parent') {
                return bone.parent || '';
            }
            return bone[property] && bone[property].slice ? bone[property].slice() : null;
        }

        _applyBoneSnapshot(geoId, geoData, bonesSnapshot, state) {
            var viewer = this.previewPanel.getModelViewer();
            if (!viewer || !geoId || !geoData) return;

            state = state || {};
            geoData.bones = this._cloneValue(bonesSnapshot || []);
            viewer.refreshGeometry();
            this._refreshOutline();
            this._refreshSkinListSelection();

            var selectedBone = state.selectedBone || '';
            var showBoneEditor = !!state.showBoneEditor;
            var hasSelectedBone = selectedBone && !!this._findBoneData(selectedBone, geoData);

            if (hasSelectedBone) {
                this.outlinePanel.selectBone(selectedBone, geoId);
                if (viewer.highlightBone) viewer.highlightBone(selectedBone);
                if (showBoneEditor) {
                    this._showBoneEditorForSelection(selectedBone, geoId, geoData);
                } else {
                    this.boneEditor.hide();
                }
            } else {
                this.outlinePanel.clearSelection();
                if (viewer.highlightBone) viewer.highlightBone(null);
                this.boneEditor.hide();
            }

            this._restoreRightPanelAfterBoneMutation({
                showOutline: true,
                showBoneEditor: hasSelectedBone && showBoneEditor,
                boneName: hasSelectedBone ? selectedBone : '',
                geoId: geoId,
                geoData: geoData,
                hideBoneEditor: !hasSelectedBone || !showBoneEditor
            });
        }

        _pushBoneSnapshotHistory(label, geoId, geoData, beforeBones, afterBones, undoState, redoState) {
            this._pushHistoryAction({
                label: label,
                undo: async () => {
                    this._applyBoneSnapshot(geoId, geoData, beforeBones, undoState);
                },
                redo: async () => {
                    this._applyBoneSnapshot(geoId, geoData, afterBones, redoState);
                }
            });
        }

        _renderHistorySubmenu(direction) {
            var container = document.querySelector('.menu-submenu[data-history-menu="' + direction + '"]');
            if (!container) return;
            var content = container.querySelector('.menu-submenu-content') || container;

            var history = this._getActiveHistory();
            var items = history
                ? (direction === 'undo' ? history.getUndoItems(15) : history.getRedoItems(15))
                : [];

            content.innerHTML = '';
            container.classList.remove('has-scroll-top', 'has-scroll-bottom');
            if (!items.length) {
                var empty = document.createElement('div');
                empty.className = 'menu-history-empty';
                empty.textContent = I18n.t(direction === 'undo' ? 'menu.history.emptyUndo' : 'menu.history.emptyRedo');
                content.appendChild(empty);
                return;
            }

            for (var i = 0; i < items.length; i++) {
                var action = items[i];
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'menu-history-item';
                btn.textContent = action.label || (direction === 'undo' ? I18n.t('menu.undo') : I18n.t('menu.redo'));
                btn.dataset.historyDirection = direction;
                btn.dataset.historyIndex = String(i);
                content.appendChild(btn);
            }

            this._updateHistorySubmenuScrollState(container);
        }

        _refreshHistorySubmenus() {
            this._renderHistorySubmenu('undo');
            this._renderHistorySubmenu('redo');
        }

        _updateHistorySubmenuScrollState(container) {
            if (!container) return;
            var content = container.querySelector('.menu-submenu-content');
            if (!content) return;

            var maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
            container.classList.toggle('has-scroll-top', content.scrollTop > 0);
            container.classList.toggle('has-scroll-bottom', maxScroll > 0 && content.scrollTop < maxScroll - 1);
        }

        _positionHistorySubmenu(actionEl) {
            if (!actionEl) return;
            var submenu = actionEl.querySelector('.menu-submenu');
            if (!submenu) return;

            submenu.style.left = '100%';
            submenu.style.right = 'auto';
            submenu.style.top = '-4px';
            submenu.style.bottom = 'auto';

            var margin = 8;
            var rect = submenu.getBoundingClientRect();
            if (rect.right > window.innerWidth - margin) {
                submenu.style.left = 'auto';
                submenu.style.right = '100%';
                rect = submenu.getBoundingClientRect();
            }
            if (rect.left < margin) {
                submenu.style.left = Math.max(margin - actionEl.getBoundingClientRect().left, 0) + 'px';
                submenu.style.right = 'auto';
                rect = submenu.getBoundingClientRect();
            }
            if (rect.bottom > window.innerHeight - margin) {
                submenu.style.top = 'auto';
                submenu.style.bottom = '-4px';
                rect = submenu.getBoundingClientRect();
            }
            if (rect.top < margin) {
                submenu.style.top = Math.max(margin - rect.top - 4, -4) + 'px';
                submenu.style.bottom = 'auto';
            }
        }

        _applyBoneMutation(boneName, property, value, geoId, geoData, options) {
            options = options || {};
            var viewer = this.previewPanel.getModelViewer();
            if (!viewer || !boneName || !geoId || !geoData) return;

            var beforeBones = property === 'parent' ? this._getBoneSnapshot(geoData) : null;

            if (property === 'pivot') {
                viewer.updateBonePivot(boneName, value, geoId, geoData);
                this.statusBar.setMessage(I18n.format('status.updatedOrigin', { name: boneName }));
            } else if (property === 'translation') {
                viewer.updateBoneTranslation(boneName, value, geoId, geoData);
                this.statusBar.setMessage(I18n.format('status.updatedPosition', { name: boneName }));
            } else if (property === 'offset') {
                viewer.updateBoneOffset(boneName, value, geoId, geoData);
                this.statusBar.setMessage(I18n.format('status.updatedPosition', { name: boneName }));
            } else if (property === 'rotation') {
                viewer.updateBoneRotation(boneName, value, geoId, geoData);
                this.statusBar.setMessage(I18n.format('status.updatedRotation', { name: boneName }));
            } else if (property === 'parent') {
                viewer.updateBoneParent(boneName, value, geoId, geoData);
                this.statusBar.setMessage(I18n.format('status.updatedParent', { name: boneName }));
            }

            var afterBones = property === 'parent' ? this._getBoneSnapshot(geoData) : null;

            this._refreshOutline();
            if (this.outlinePanel.getSelectedBone() === boneName) {
                this._showBoneEditorForSelection(boneName, geoId, geoData);
            }

            if (options.recordHistory !== false) {
                if (property === 'parent') {
                    this._pushBoneSnapshotHistory(
                        this._getBoneHistoryLabel(property, boneName),
                        geoId,
                        geoData,
                        beforeBones,
                        afterBones,
                        { selectedBone: boneName, showBoneEditor: true },
                        { selectedBone: boneName, showBoneEditor: true }
                    );
                } else {
                    this._pushHistoryAction({
                        label: this._getBoneHistoryLabel(property, boneName),
                        mergeKey: 'bone:' + geoId + ':' + boneName + ':' + property,
                        undo: async () => {
                            this._applyBoneMutation(boneName, property, this._cloneValue(options.before), geoId, geoData, { recordHistory: false });
                        },
                        redo: async () => {
                            this._applyBoneMutation(boneName, property, this._cloneValue(value), geoId, geoData, { recordHistory: false });
                        }
                    });
                }
            }
        }

        _wireSkinList() {
            this.skinList.setOnDecryptRequest(() => {
                this._openDecryptDialog();
            });

            this.skinList.setOnSkinSelect(async (skin, index) => {
                const tab = this.tabManager.getActive();
                if (!tab) return;
                this.skinProperties.setProject(tab.project);

                this._selectedSkinIndex = index;
                this._currentSkin = skin;

                await this.previewPanel.showSkin(skin, tab.project);
                var viewer = this.previewPanel.getModelViewer();
                if (viewer) {
                    viewer.setOnBoneTransform((boneName, property, value, geoId, geoData) => {
                        var bone = this._findBoneData(boneName, geoData);
                        var before = this._getBoneMutationBeforeValue(bone, property);
                        this._applyBoneMutation(boneName, property, value, geoId, geoData, { before: before });
                    });
                }
                var skinAnimations = skin && (skin.animations || (skin.data && skin.data.animations));
                var hasSkinAnimations = !!(skinAnimations && Object.keys(skinAnimations).length);
                if (hasSkinAnimations) {
                    try {
                        await Promise.all([
                            tab.project.getOfficialAnimationIndex(),
                            tab.project.getOfficialAnimationSlots()
                        ]);
                        this.skinProperties.setAnimationOptions(tab.project.getOfficialAnimationIds());
                        this.skinProperties.setSlotSuggestions(tab.project.getLoadedOfficialAnimationSlots());
                    } catch (err) {
                        var animationLoadMessage = I18n.t('skinProps.animationsLoadFailed');
                        this.skinProperties.setAnimationLoadError(animationLoadMessage);
                        this.statusBar.setMessage(animationLoadMessage);
                        this.logger.warn(animationLoadMessage + ' ' + (err && err.message ? err.message : ''));
                    }
                } else {
                    this.skinProperties.setAnimationOptions([]);
                    this.skinProperties.setSlotSuggestions([]);
                }

                // Detect UV type from geometry
                var uvType = this._detectUvType(skin, tab.project);
                this.statusBar.setMessage(skin.name + (uvType ? '  ·  ' + uvType : ''));
                this.skinProperties.show(skin);

                // Show outline for the selected skin's geometry
                this.boneEditor.hide();
                var boneTabBtn = document.querySelector('[data-detail-tab="bone"]');
                if (skin.geometry && tab.project.geometries && tab.project.geometries[skin.geometry]) {
                    this.outlinePanel.render(skin.geometry, tab.project.geometries[skin.geometry]);
                    this.outlinePanel.setAnimatedBones(this.previewPanel.getAnimatedBones());
                    this._setDetailTabsVisible(true);
                    if (boneTabBtn) boneTabBtn.disabled = false;
                    this._switchDetailTab('bone');
                } else {
                    this.outlinePanel.hide();
                    this._setDetailTabsVisible(true);
                    if (boneTabBtn) boneTabBtn.disabled = true;
                    this._switchDetailTab('skin');
                }

                if (window.innerWidth <= 900) {
                    this._setMobilePanel('preview');
                }

                this._syncRightPanelState();
            });
        }

        _detectUvType(skin, project) {
            if (!skin || !skin.geometry || !project || !project.geometries) return '';
            var geo = project.geometries[skin.geometry];
            if (!geo || !geo.bones) return '';
            var hasPolyMesh = false;
            for (var b = 0; b < geo.bones.length; b++) {
                var cubes = geo.bones[b].cubes || [];
                for (var c = 0; c < cubes.length; c++) {
                    var uv = cubes[c].uv;
                    if (uv) {
                        return (typeof uv === 'object' && !Array.isArray(uv)) ? 'Cube Per-Face UV' : 'Box UV';
                    }
                }
                // Check poly_mesh
                if (geo.bones[b].poly_mesh) hasPolyMesh = true;
            }
            if (hasPolyMesh) return 'Poly Mesh UV';
            return '';
        }

        _wireSkinProperties() {
            this.skinProperties.setOnChange(async (skin, prop, value) => {
                if (!skin || !skin.data) return;
                if (prop === 'name') {
                    await this._applySkinMutation(skin, {
                        type: 'name',
                        value: value,
                        before: skin.name,
                        after: value,
                        label: I18n.t('history.skinName'),
                        mergeKey: 'skin:name:' + (skin.texturePath || skin.name || '')
                    });
                } else if (prop === 'skin_type') {
                    await this._applySkinMutation(skin, {
                        type: 'skin_type',
                        value: value,
                        before: skin.type,
                        after: value,
                        label: I18n.t('history.skinType'),
                        mergeKey: 'skin:type:' + (skin.texturePath || skin.name || '')
                    });
                } else if (prop === 'hide_framework') {
                    await this._applySkinMutation(skin, {
                        type: 'hide_framework',
                        value: !!value,
                        before: !!skin.data.hide_framework,
                        after: !!value,
                        label: I18n.t('history.hideFramework')
                    });
                } else if (prop === 'animations' || prop === 'animation-add' || prop === 'animation-rename-key' || prop === 'animation-set-value' || prop === 'animation-delete') {
                    var beforeAnimations = Object.assign({}, skin.animations || skin.data.animations || {});
                    var nextAnimations = Object.assign({}, beforeAnimations);
                    if (prop === 'animations') {
                        nextAnimations = Object.assign({}, value || {});
                    } else if (prop === 'animation-add') {
                        nextAnimations[value.key] = value.value;
                    } else if (prop === 'animation-rename-key') {
                        if (value.from && value.to && value.from !== value.to) {
                            nextAnimations[value.to] = nextAnimations[value.from] || '';
                            delete nextAnimations[value.from];
                        }
                    } else if (prop === 'animation-set-value') {
                        nextAnimations[value.key] = value.value;
                    } else if (prop === 'animation-delete') {
                        delete nextAnimations[value];
                    }
                    await this._applySkinMutation(skin, {
                        type: 'animations',
                        value: nextAnimations,
                        before: beforeAnimations,
                        after: nextAnimations,
                        label: I18n.t('history.animations')
                    });
                }
            });
        }

        _refreshSkinListSelection() {
            this.skinList.refresh().then(() => {
                if (this._selectedSkinIndex >= 0) {
                    var selected = document.querySelector('.skin-item[data-index="' + this._selectedSkinIndex + '"]');
                    if (selected) selected.classList.add('selected');
                }
            });
        }

        _setupDetailTabs() {
            var tabs = document.getElementById('detail-tabs');
            if (!tabs) return;
            tabs.addEventListener('click', (e) => {
                var btn = e.target.closest('[data-detail-tab]');
                if (!btn) return;
                this._switchDetailTab(btn.dataset.detailTab);
            });
        }

        _setDetailTabsVisible(visible) {
            var tabs = document.getElementById('detail-tabs');
            if (!tabs) return;
            tabs.style.display = visible ? 'flex' : 'none';
        }

        _switchDetailTab(tabKey) {
            var tabs = document.getElementById('detail-tabs');
            if (!tabs) return;

            tabs.querySelectorAll('.detail-tab').forEach(function (btn) {
                btn.classList.toggle('active', btn.dataset.detailTab === tabKey);
            });

            if (tabKey === 'bone') {
                this.outlinePanel.el.style.display = 'flex';
                if (this.outlinePanel.getSelectedBone() && this.outlinePanel.getSelectedGeoId()) {
                    var tab = this.tabManager.getActive();
                    var geoId = this.outlinePanel.getSelectedGeoId();
                    var geoData = tab && tab.project && tab.project.geometries ? tab.project.geometries[geoId] : null;
                    if (geoData) this._showBoneEditorForSelection(this.outlinePanel.getSelectedBone(), geoId, geoData);
                    else this.boneEditor.hide();
                } else {
                    this.boneEditor.hide();
                }
                this.skinProperties.hide();
            } else if (tabKey === 'skin') {
                this.outlinePanel.el.style.display = 'none';
                this.boneEditor.hide();
                // Re-populate skin properties if we have a current skin
                if (this._currentSkin) {
                    this.skinProperties.show(this._currentSkin);
                } else {
                    this.skinProperties.hide();
                }
            }

            this._syncRightPanelState();
        }

        _syncRightPanelState() {
            var rightPanel = document.getElementById('right-panel');
            if (!rightPanel) return;
            var boneVisible = !!(this.boneEditor && this.boneEditor._currentBoneName);
            var outlineVisible = !!(this.outlinePanel && this.outlinePanel.el && this.outlinePanel.el.style.display !== 'none');
            var skinPanel = document.getElementById('skin-properties-panel');
            var skinVisible = !!skinPanel && skinPanel.style.display !== 'none';
            var hasDetail = boneVisible || skinVisible || outlineVisible;
            var hasLowerPanel = outlineVisible || boneVisible || skinVisible;
            rightPanel.classList.toggle('has-detail-panel', hasDetail);
            rightPanel.classList.toggle('has-lower-panel', hasLowerPanel);

            var detailTabs = document.getElementById('detail-tabs');
            var rightBodySplitter = document.getElementById('right-body-splitter');
            var detailSplitter = document.getElementById('detail-splitter');
            if (detailTabs) detailTabs.style.display = hasDetail ? '' : 'none';
            if (rightBodySplitter) rightBodySplitter.style.display = hasLowerPanel ? '' : 'none';
            if (detailSplitter) detailSplitter.style.display = hasDetail ? '' : 'none';
        }

        _restoreRightPanelAfterBoneMutation(options) {
            options = options || {};
            if (options.showOutline !== false && this.outlinePanel && this.outlinePanel.el) {
                this.outlinePanel.el.style.display = 'flex';
            }
            if (options.showBoneEditor && options.boneName && options.geoId && options.geoData) {
                this._showBoneEditorForSelection(options.boneName, options.geoId, options.geoData);
                this.outlinePanel.selectBone(options.boneName, options.geoId);
            } else if (options.hideBoneEditor) {
                this.boneEditor.hide();
            }
            this._syncRightPanelState();
        }

        _showBoneEditorForSelection(boneName, geoId, geoData) {
            if (!boneName || !geoId || !geoData || !geoData.bones) return;
            var boneNames = geoData.bones.map((b, i) => b.name || ('bone_' + i));
            this.boneEditor.show(boneName, geoId, geoData, boneNames);
            this._setupMobilePanelDragHandles();
        }

        _wireExplorer() {
            this.explorer.setIsEncryptedChecker((path) => {
                const tab = this.tabManager.getActive();
                if (!tab || !tab.project) return Promise.resolve(false);
                return tab.project.isPathEncrypted(path);
            });

            this.explorer.setOnFileClick((path, name) => {
                const tab = this.tabManager.getActive();
                if (!tab) return;

                tab.project.isPathEncrypted(path).then(async (encrypted) => {
                    if (encrypted) {
                        var goDecrypt = await this.modal.confirm(I18n.t('modal.encrypted.title'), I18n.t('modal.encrypted.body'));
                        if (goDecrypt) this._openDecryptDialog();
                        return;
                    }

                    this.previewPanel.showFile(path, name, tab.project);
                    this.statusBar.setMessage(path);
                    // Hide outline and bone editor when viewing files
                    this.boneEditor.hide();
                    this.outlinePanel.hide();
                    this.skinProperties.hide();
                    this._setDetailTabsVisible(false);
                    this._syncRightPanelState();
                });
            });

            this.explorer.setOnCreateFile(async (folderPath) => {
                const tab = this.tabManager.getActive();
                if (!tab || !tab.project) return;
                var name = await this.modal.prompt(I18n.t('modal.newFile.title'), I18n.t('modal.newFile.body'), 'new_file.txt');
                if (!name) return;
                try {
                    await tab.project.createFile(folderPath || '', name, '');
                    this.explorer.render(tab.project.fileTree);
                    this.logger.log('Created file: ' + (folderPath ? folderPath + '/' : '') + name);
                } catch (err) {
                    this.logger.error('Create file failed: ' + err.message);
                }
            });

            this.explorer.setOnCreateFolder(async (folderPath) => {
                const tab = this.tabManager.getActive();
                if (!tab || !tab.project) return;
                var name = await this.modal.prompt(I18n.t('modal.newFolder.title'), I18n.t('modal.newFolder.body'), 'new_folder');
                if (!name) return;
                try {
                    await tab.project.createFolder(folderPath || '', name);
                    this.explorer.render(tab.project.fileTree);
                    this.logger.log('Created folder: ' + (folderPath ? folderPath + '/' : '') + name);
                } catch (err) {
                    this.logger.error('Create folder failed: ' + err.message);
                }
            });

            this.explorer.setOnContextAction(async (action, path, type) => {
                const tab = this.tabManager.getActive();
                if (!tab || !tab.project || !path) return;
                try {
                    if (action === 'delete') {
                        if (!await this.modal.confirm(I18n.t('modal.delete.title'), I18n.format('modal.delete.body', { path: path }))) return;
                        await tab.project.deletePath(path, type);
                        this.logger.log('Deleted: ' + path);
                    } else if (action === 'rename') {
                        var oldName = path.split('/').pop();
                        var newName = await this.modal.prompt(I18n.t('modal.rename.title'), I18n.t('modal.rename.body'), oldName);
                        if (!newName || newName === oldName) return;
                        await tab.project.renamePath(path, type, newName);
                        this.logger.log('Renamed: ' + path + ' -> ' + newName);
                    } else if (action === 'copy') {
                        var targetParent = await this.modal.prompt(I18n.t('modal.copy.title'), I18n.t('modal.copy.body'), '');
                        if (targetParent === null) return;
                        await tab.project.copyPath(path, type, targetParent || '');
                        this.logger.log('Copied: ' + path);
                    } else if (action === 'move') {
                        var moveTarget = await this.modal.prompt(I18n.t('modal.move.title'), I18n.t('modal.move.body'), '');
                        if (moveTarget === null) return;
                        await tab.project.movePath(path, type, moveTarget || '');
                        this.logger.log('Moved: ' + path);
                    }
                    this.explorer.render(tab.project.fileTree);
                } catch (err) {
                    this.logger.error('Operation failed: ' + err.message);
                }
            });
        }

        /**
         * Wire the outline panel bone selection to bone editor + model viewer
         */
        _wireOutline() {
            var self = this;
            
            this.outlinePanel.setOnBoneSelect((boneName, geoId) => {
                const tab = self.tabManager.getActive();
                if (!tab) return;

                const geoData = tab.project.geometries[geoId];
                if (!geoData) return;

                // Get bone names for parent dropdown
                const boneNames = geoData.bones.map((b, i) => b.name || ('bone_' + i));

                // Show bone editor with this bone's properties
                self._showBoneEditorForSelection(boneName, geoId, geoData);
                self._syncRightPanelState();

                // Highlight bone in 3D model viewer
                const viewer = self.previewPanel.getModelViewer();
                if (viewer) {
                    viewer.highlightBone(boneName);
                }

                self.statusBar.setMessage(boneName + ' (' + geoId + ')');
            });

            this._wireViewerBonePicking();

            // Bone parent change via drag-and-drop
            this.outlinePanel.setOnBoneChangeParent(function (change) {
                var viewer = self.previewPanel.getModelViewer();
                if (!viewer) return;
                var boneEditorWasVisible = self.boneEditor && self.boneEditor.isVisible && self.boneEditor.isVisible();
                var outlineWasVisible = self.outlinePanel && self.outlinePanel.el && self.outlinePanel.el.style.display !== 'none';
                var skinPropsEl = document.getElementById('skin-properties-panel');
                var skinPropsWasVisible = !!skinPropsEl && skinPropsEl.style.display !== 'none';

                var boneName = change.boneName;
                var targetBone = change.targetBone;
                var mode = change.mode;
                var geoId = change.geoId;
                var geoData = change.geoData;
                var beforeBones = self._getBoneSnapshot(geoData);

                var bones = geoData && geoData.bones ? geoData.bones : null;
                if (!bones) return;

                var fromIndex = -1;
                var targetIndex = -1;
                for (var i = 0; i < bones.length; i++) {
                    var name = bones[i].name || ('bone_' + i);
                    if (name === boneName) fromIndex = i;
                    if (name === targetBone) targetIndex = i;
                }
                if (fromIndex === -1 || targetIndex === -1) return;

                var movingBone = bones[fromIndex];
                var findBoneByName = function (name) {
                    for (var bi = 0; bi < bones.length; bi++) {
                        var candidateName = bones[bi].name || ('bone_' + bi);
                        if (candidateName === name) return bones[bi];
                    }
                    return null;
                };
                var isDescendantBone = function (name, ancestorName) {
                    var visited = new Set();
                    var currentName = name;
                    while (currentName) {
                        if (currentName === ancestorName) return true;
                        if (visited.has(currentName)) break;
                        visited.add(currentName);
                        var currentBone = findBoneByName(currentName);
                        currentName = currentBone ? (currentBone.parent || '') : '';
                    }
                    return false;
                };
                var insertAt = function (index) {
                    var currentIndex = bones.indexOf(movingBone);
                    if (currentIndex === -1) return;
                    bones.splice(currentIndex, 1);
                    var boundedIndex = Math.max(0, Math.min(index, bones.length));
                    bones.splice(boundedIndex, 0, movingBone);
                };

                if (mode === 'inside') {
                    viewer.updateBoneParent(boneName, targetBone, geoId, geoData);
                    targetIndex = bones.findIndex(function (b, idx) {
                        return (b.name || ('bone_' + idx)) === targetBone;
                    });
                    insertAt(targetIndex + 1);
                } else {
                    var targetParent = bones[targetIndex].parent || '';
                    if (isDescendantBone(targetBone, boneName)) {
                        return;
                    }
                    if (targetParent === boneName) {
                        return;
                    }

                    var cursorParent = targetParent;
                    while (cursorParent) {
                        if (cursorParent === boneName) {
                            return;
                        }
                        var parentBone = null;
                        for (var p = 0; p < bones.length; p++) {
                            var parentBoneName = bones[p].name || ('bone_' + p);
                            if (parentBoneName === cursorParent) {
                                parentBone = bones[p];
                                break;
                            }
                        }
                        cursorParent = parentBone ? (parentBone.parent || '') : '';
                    }

                    viewer.updateBoneParent(boneName, targetParent, geoId, geoData);

                    targetIndex = bones.findIndex(function (b, idx) {
                        return (b.name || ('bone_' + idx)) === targetBone;
                    });
                    insertAt(mode === 'after' ? targetIndex + 1 : targetIndex);
                }

                // Refresh outline to show updated hierarchy
                self.outlinePanel.render(geoId, geoData);
                self.outlinePanel.el.style.display = outlineWasVisible ? 'flex' : 'none';
                self.outlinePanel.selectBone(boneName, geoId);
                if (boneEditorWasVisible) {
                    var updatedBoneNames = geoData.bones.map(function (b, i) { return b.name || ('bone_' + i); });
                    self._showBoneEditorForSelection(boneName, geoId, geoData);
                } else {
                    self.boneEditor.hide();
                }
                if (skinPropsWasVisible && self._currentSkin) {
                    self.skinProperties.show(self._currentSkin);
                } else {
                    self.skinProperties.hide();
                }
                self._syncRightPanelState();
                self._pushBoneSnapshotHistory(
                    I18n.format('history.boneParent', { name: boneName }),
                    geoId,
                    geoData,
                    beforeBones,
                    self._getBoneSnapshot(geoData),
                    { selectedBone: boneName, showBoneEditor: boneEditorWasVisible },
                    { selectedBone: boneName, showBoneEditor: boneEditorWasVisible }
                );
                
                self.logger.log('Bone ' + boneName + ' moved ' + mode + ' ' + targetBone);
            });

            // Listen for bone-add events from outline panel
            this.outlinePanel.el.addEventListener('bone-add', function (e) {
                var detail = e.detail || {};
                if (detail.action === 'auto-fix-human') {
                    self._autoFixHumanBones(detail.geoId, detail.geoData);
                    return;
                }
                self._handleBoneAddFromOutline(detail.action, detail.parentBone, detail.geoId, detail.geoData);
            });

            // Outline back button → hide outline + bone editor (back to skin list)
            this.outlinePanel.setOnBack(function () {
                self.boneEditor.hide();
                self.outlinePanel.hide();
                var viewer = self.previewPanel.getModelViewer();
                if (viewer) viewer.highlightBone(null);
                self.statusBar.setMessage(I18n.t('status.ready'));
            });
        }

        _wireViewerBonePicking() {
            var self = this;
            var originalShowSkin = this.previewPanel.showSkin.bind(this.previewPanel);
            this.previewPanel.showSkin = async function (skin, project) {
                await originalShowSkin(skin, project);
                var viewer = self.previewPanel.getModelViewer();
                if (!viewer) return;
                viewer.setOnBonePick(function (boneName, geoId, geoData) {
                    if (!boneName || !geoId || !geoData) return;
                    var boneNames = geoData.bones.map(function (b, i) { return b.name || ('bone_' + i); });
                    self.outlinePanel.selectBone(boneName, geoId);
                    self._showBoneEditorForSelection(boneName, geoId, geoData);
                    viewer.highlightBone(boneName);
                    self.statusBar.setMessage(boneName + ' (' + geoId + ')');
                });
                viewer.setOnBoneTransform(function (boneName, property, value, geoId, geoData) {
                    var bone = self._findBoneData(boneName, geoData);
                    var before = self._getBoneMutationBeforeValue(bone, property);
                    self._applyBoneMutation(boneName, property, value, geoId, geoData, { before: before });
                    self.outlinePanel.selectBone(boneName, geoId);
                    self._showBoneEditorForSelection(boneName, geoId, geoData);
                });
            };
        }

        /**
         * Handle bone add from outline panel (Add Group/Add Bone buttons)
         */
        _handleBoneAddFromOutline(action, parentBone, geoId, geoData) {
            if (!geoData) return;
            
            var viewer = this.previewPanel.getModelViewer();
            if (!viewer) return;
            var beforeBones = this._getBoneSnapshot(geoData);

            // Determine bone type and name
            var existingNames = geoData.bones.map(function (b, i) { return b.name || ('bone_' + i); });
            var baseName = (action === 'add-group') ? 'group' : 'bone';
            var newName = baseName + '_' + geoData.bones.length;
            var counter = 1;
            while (existingNames.indexOf(newName) !== -1) {
                newName = baseName + '_' + (geoData.bones.length + counter++);
            }

            var newBone = {
                name: newName,
                pivot: [0, 0, 0],
                rotation: [0, 0, 0],
                parent: parentBone || '',
                cubes: []
            };

            // Add to viewer (which updates geoData)
            viewer.addBone(newBone, geoId, geoData);

            // Refresh outline
            this.outlinePanel.render(geoId, geoData);
            this.outlinePanel.selectBone(newName, geoId);

            // Show bone editor for the new bone
            this._showBoneEditorForSelection(newName, geoId, geoData);
            this._pushBoneSnapshotHistory(
                I18n.format('history.boneAdd', { name: newName }),
                geoId,
                geoData,
                beforeBones,
                this._getBoneSnapshot(geoData),
                { selectedBone: parentBone || '', showBoneEditor: !!parentBone },
                { selectedBone: newName, showBoneEditor: true }
            );

            this.logger.log('Added ' + (action === 'add-group' ? 'group' : 'bone') + ': ' + newName);
        }

        _autoFixHumanBones(geoId, geoData) {
            if (!geoData || !geoData.bones || !geoData.bones.length) return;

            var viewer = this.previewPanel.getModelViewer();
            if (!viewer) return;
            var beforeBones = this._getBoneSnapshot(geoData);
            var selectedBone = this.outlinePanel.getSelectedBone();

            var canonicalRules = {
                root: { label: 'root', acceptedNames: ['root'], parent: '' },
                waist: { label: 'waist', acceptedNames: ['waist'], parent: 'root', optional: true },
                body: { label: 'body', acceptedNames: ['body'], parent: 'waist', fallbackParent: 'root' },
                head: { label: 'head', acceptedNames: ['head'], parent: 'body' },
                leftarm: { label: 'leftArm', acceptedNames: ['leftArm', 'leftarm'], parent: 'body' },
                rightarm: { label: 'rightArm', acceptedNames: ['rightArm', 'rightarm'], parent: 'body' },
                leftleg: { label: 'leftLeg', acceptedNames: ['leftLeg', 'leftleg'], parent: 'root' },
                rightleg: { label: 'rightLeg', acceptedNames: ['rightLeg', 'rightleg'], parent: 'root' }
            };

            var aliases = {
                root: [/^root$/i, /^mainroot$/i, /^base$/i],
                waist: [/^waist$/i, /^hips?$/i, /^pelvis$/i, /^torso_base$/i],
                body: [/^body$/i, /^torso$/i, /^chest$/i, /^spine$/i],
                head: [/^head$/i, /^helmet$/i, /^skull$/i],
                leftarm: [/^left.+arm$/i, /^arm.+left$/i, /^l(?:eft)?[_-]?arm$/i, /^arm[_-]?l(?:eft)?$/i, /^lefthand$/i, /^hand[_-]?left$/i],
                rightarm: [/^right.+arm$/i, /^arm.+right$/i, /^r(?:ight)?[_-]?arm$/i, /^arm[_-]?r(?:ight)?$/i, /^righthand$/i, /^hand[_-]?right$/i],
                leftleg: [/^left.+leg$/i, /^leg.+left$/i, /^l(?:eft)?[_-]?leg$/i, /^leg[_-]?l(?:eft)?$/i],
                rightleg: [/^right.+leg$/i, /^leg.+right$/i, /^r(?:ight)?[_-]?leg$/i, /^leg[_-]?r(?:ight)?$/i]
            };

            var normalize = function (name) {
                return String(name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
            };

            var bones = geoData.bones;
            var byNormalized = {};
            for (var i = 0; i < bones.length; i++) {
                var existingName = bones[i].name || ('bone_' + i);
                byNormalized[normalize(existingName)] = bones[i];
            }

            var matched = {};
            var usedBones = new Set();
            var renameCount = 0;
            var reparentCount = 0;
            var createdCount = 0;

            var tryMatchBone = function (canonicalName) {
                if (byNormalized[canonicalName] && !usedBones.has(byNormalized[canonicalName])) {
                    return byNormalized[canonicalName];
                }
                var patterns = aliases[canonicalName] || [];
                for (var p = 0; p < patterns.length; p++) {
                    for (var b = 0; b < bones.length; b++) {
                        var bone = bones[b];
                        var boneName = bone.name || ('bone_' + b);
                        if (usedBones.has(bone)) continue;
                        if (patterns[p].test(boneName)) {
                            return bone;
                        }
                    }
                }
                return null;
            };

            Object.keys(canonicalRules).forEach(function (canonicalName) {
                var bone = tryMatchBone(canonicalName);
                if (bone) {
                    matched[canonicalName] = bone;
                    usedBones.add(bone);
                }
            });

            Object.keys(canonicalRules).forEach(function (canonicalName) {
                var rule = canonicalRules[canonicalName];
                var bone = matched[canonicalName];
                if (!bone && !rule.optional) {
                    bone = {
                        name: rule.label,
                        pivot: [0, 0, 0],
                        rotation: [0, 0, 0],
                        parent: '',
                        cubes: []
                    };
                    bones.push(bone);
                    matched[canonicalName] = bone;
                    createdCount += 1;
                }
            });

            Object.keys(canonicalRules).forEach(function (canonicalName) {
                var rule = canonicalRules[canonicalName];
                var bone = matched[canonicalName];
                if (!bone) return;

                var targetName = rule.label;
                var acceptedNames = Array.isArray(rule.acceptedNames) ? rule.acceptedNames : [targetName];
                if (acceptedNames.indexOf(bone.name || '') === -1) {
                    var previousName = bone.name || '';
                    if (selectedBone === previousName) {
                        selectedBone = targetName;
                    }
                    bone.name = targetName;
                    renameCount += 1;
                    for (var k = 0; k < bones.length; k++) {
                        if ((bones[k].parent || '') === previousName) {
                            bones[k].parent = targetName;
                        }
                    }
                }
            });

            Object.keys(canonicalRules).forEach(function (canonicalName) {
                var rule = canonicalRules[canonicalName];
                var bone = matched[canonicalName];
                if (!bone) return;

                var desiredParent = rule.parent;
                if (canonicalName === 'body' && !matched.waist) {
                    desiredParent = rule.fallbackParent || desiredParent;
                }
                if ((bone.parent || '') !== desiredParent) {
                    bone.parent = desiredParent;
                    reparentCount += 1;
                }
            });

            viewer.refreshGeometry();
            this._refreshOutline();
            if (selectedBone) {
                this.outlinePanel.selectBone(selectedBone, geoId);
            }

            var summary = [];
            if (renameCount) summary.push(renameCount + ' renamed');
            if (reparentCount) summary.push(reparentCount + ' reparented');
            if (createdCount) summary.push(createdCount + ' created');
            if (!summary.length) summary.push('no changes needed');

            this.logger.log('Auto-fixed human bones: ' + summary.join(', '));
            this.statusBar.setMessage(I18n.format('status.autoFix', { summary: summary.join(', ') }));
            this._pushBoneSnapshotHistory(
                I18n.t('history.autoFixHuman'),
                geoId,
                geoData,
                beforeBones,
                this._getBoneSnapshot(geoData),
                { selectedBone: selectedBone || '', showBoneEditor: !!selectedBone },
                { selectedBone: selectedBone || '', showBoneEditor: !!selectedBone }
            );
        }

        /**
         * Wire bone editor changes to model viewer and outline refresh
         */
        _wireBoneEditor() {
            // Bone property changes (pivot, rotation, parent)
            this.boneEditor.setOnBoneChange((boneName, property, value, geoId, geoData) => {
                var bone = this._findBoneData(boneName, geoData);
                var before = this._getBoneMutationBeforeValue(bone, property);
                this._applyBoneMutation(boneName, property, value, geoId, geoData, { before: before });
            });

            // Add bone
            this.boneEditor.setOnBoneAdd((boneName, geoId, geoData) => {
                const viewer = this.previewPanel.getModelViewer();
                if (!viewer) return;
                var beforeBones = this._getBoneSnapshot(geoData);

                // Generate a unique name for the new bone
                var existingNames = geoData.bones.map((b, i) => b.name || ('bone_' + i));
                var newBoneName = 'new_bone';
                var counter = 1;
                while (existingNames.indexOf(newBoneName) !== -1) {
                    newBoneName = 'new_bone_' + counter++;
                }

                var newBone = {
                    name: newBoneName,
                    pivot: [0, 0, 0],
                    rotation: [0, 0, 0],
                    parent: '',
                    cubes: []
                };

                // If adding as child of selected bone
                if (boneName) {
                    newBone.parent = boneName;
                    var parentBone = this._findBoneData(boneName, geoData);
                    if (parentBone && parentBone.pivot) {
                        newBone.pivot = parentBone.pivot.slice();
                    }
                }

                viewer.addBone(newBone, geoId, geoData);

                // Refresh outline and show the new bone
                this._refreshOutline();

                // Select the new bone after a short delay (to let outline render)
                setTimeout(() => {
                    this._showBoneEditorForSelection(newBoneName, geoId, geoData);
                    this._syncRightPanelState();
                    this.outlinePanel.selectBone(newBoneName, geoId);
                    this._pushBoneSnapshotHistory(
                        I18n.format('history.boneAdd', { name: newBoneName }),
                        geoId,
                        geoData,
                        beforeBones,
                        this._getBoneSnapshot(geoData),
                        { selectedBone: boneName || '', showBoneEditor: !!boneName },
                        { selectedBone: newBoneName, showBoneEditor: true }
                    );
                    this.logger.log('Added bone: ' + newBoneName);
                }, 50);
            });

            this.boneEditor.setOnApplyRotationToCubes((boneName, geoId, geoData) => {
                const viewer = this.previewPanel.getModelViewer();
                if (!viewer) return;
                viewer.applyBoneRotationToCubes(boneName, geoId, geoData);
                this._refreshOutline();
                this._restoreRightPanelAfterBoneMutation({ showBoneEditor: true, boneName: boneName, geoId: geoId, geoData: geoData });
                this.statusBar.setMessage(I18n.format('status.updatedRotation', { name: boneName }));
            });

            this.boneEditor.setOnBoneRename((oldName, newName, geoId, geoData) => {
                if (!oldName || !newName || oldName === newName || !geoData || !geoData.bones) return;
                var existing = geoData.bones.some((b, i) => (b.name || ('bone_' + i)) === newName);
                if (existing) {
                    this.statusBar.setMessage(I18n.t('bone.renameExists'));
                    this.boneEditor.refresh();
                    return;
                }

                var beforeBones = this._getBoneSnapshot(geoData);

                var renamed = false;
                geoData.bones.forEach((bone, i) => {
                    var name = bone.name || ('bone_' + i);
                    if (name === oldName) {
                        bone.name = newName;
                        renamed = true;
                    }
                    if ((bone.parent || '') === oldName) {
                        bone.parent = newName;
                    }
                });
                if (!renamed) return;

                var viewer = this.previewPanel.getModelViewer();
                if (viewer) {
                    viewer.refreshGeometry();
                }
                this._refreshOutline();
                this.outlinePanel.selectBone(newName, geoId);
                this._showBoneEditorForSelection(newName, geoId, geoData);
                this._restoreRightPanelAfterBoneMutation({ showBoneEditor: true, boneName: newName, geoId: geoId, geoData: geoData });
                this._pushBoneSnapshotHistory(
                    I18n.format('history.boneRename', { from: oldName, to: newName }),
                    geoId,
                    geoData,
                    beforeBones,
                    this._getBoneSnapshot(geoData),
                    { selectedBone: oldName, showBoneEditor: true },
                    { selectedBone: newName, showBoneEditor: true }
                );
                this.statusBar.setMessage(I18n.format('status.renamedBone', { name: newName }));
            });

            this.boneEditor.setOnBoneDeleteTree((boneName, geoId, geoData) => {
                const viewer = this.previewPanel.getModelViewer();
                if (!viewer || !geoData || !geoData.bones) return;
                var beforeBones = this._getBoneSnapshot(geoData);

                const toDelete = new Set();
                const collect = (name) => {
                    toDelete.add(name);
                    geoData.bones.forEach((bone, i) => {
                        const childName = bone.name || ('bone_' + i);
                        if ((bone.parent || '') === name && !toDelete.has(childName)) {
                            collect(childName);
                        }
                    });
                };
                collect(boneName);

                geoData.bones = geoData.bones.filter((bone, i) => !toDelete.has(bone.name || ('bone_' + i)));
                viewer.refreshGeometry();
                this.boneEditor.hide();
                this._refreshOutline();
                this._refreshSkinListSelection();
                this._restoreRightPanelAfterBoneMutation({ hideBoneEditor: true });
                this._pushBoneSnapshotHistory(
                    I18n.format('history.boneDeleteTree', { name: boneName }),
                    geoId,
                    geoData,
                    beforeBones,
                    this._getBoneSnapshot(geoData),
                    { selectedBone: boneName, showBoneEditor: true },
                    { selectedBone: '', showBoneEditor: false }
                );
                this.statusBar.setMessage(I18n.format('status.deletedBoneTree', { name: boneName }));
            });

            // Delete bone
            this.boneEditor.setOnBoneDelete((boneName, geoId, geoData) => {
                const viewer = this.previewPanel.getModelViewer();
                if (!viewer) return;
                var beforeBones = this._getBoneSnapshot(geoData);

                viewer.deleteBone(boneName, geoId, geoData);

                // Hide bone editor and refresh outline
                this.boneEditor.hide();
                this._refreshOutline();
                this._refreshSkinListSelection();
                this._restoreRightPanelAfterBoneMutation({ hideBoneEditor: true });
                this._pushBoneSnapshotHistory(
                    I18n.format('history.boneDelete', { name: boneName }),
                    geoId,
                    geoData,
                    beforeBones,
                    this._getBoneSnapshot(geoData),
                    { selectedBone: boneName, showBoneEditor: true },
                    { selectedBone: '', showBoneEditor: false }
                );

                this.logger.log('Deleted bone: ' + boneName);
            });

            // Bone editor back button → hide bone editor (back to outline)
            this.boneEditor.setOnBack(() => {
                this.boneEditor.hide();
                this.outlinePanel.clearSelection();
                const viewer = this.previewPanel.getModelViewer();
                if (viewer) viewer.highlightBone(null);
                this._syncRightPanelState();
                this.statusBar.setMessage(I18n.t('status.outline'));
            });
        }

        // ---- View Switching ----

        _showWelcome() {
            this.welcomeEl.style.display = 'flex';
            this.workspaceEl.style.display = 'none';
            this.tabbarEl.style.display = 'none';
            var appEl = document.getElementById('app');
            if (appEl) appEl.classList.remove('workspace-active', 'mobile-nav-visible');
            this.statusBar.set(I18n.t('status.ready'));
        }

        _showWorkspace() {
            this.welcomeEl.style.display = 'none';
            this.workspaceEl.style.display = '';
            this.tabbarEl.style.display = 'flex';
            var appEl = document.getElementById('app');
            if (appEl) appEl.classList.add('workspace-active');
        }

        _updateWorkspaceLayout() {
            const ws = this.workspaceEl;
            // On mobile (< 900px), sidebar and right panel use show-* classes
            // On desktop, they use hide-* classes
            const isMobile = window.innerWidth <= 900;
            if (isMobile) {
                ws.classList.remove('hide-sidebar', 'hide-right');
                // Mobile uses three high-level views: Explorer, Preview, Sidebar.
                ws.classList.toggle('show-sidebar', this._mobilePanel === 'files');
                ws.classList.toggle('show-right', this._mobilePanel === 'skins');
            } else {
                ws.classList.toggle('hide-sidebar', !this._showSidebar);
                ws.classList.toggle('hide-right', !this._showRight);
                ws.classList.remove('show-sidebar', 'show-right');
            }

            if (this.mobileNavEl) {
                var mobileNavVisible = isMobile && this.workspaceEl.style.display !== 'none';
                this.mobileNavEl.style.display = mobileNavVisible ? 'flex' : 'none';
                var appEl = document.getElementById('app');
                if (appEl) appEl.classList.toggle('mobile-nav-visible', mobileNavVisible);
                var buttons = this.mobileNavEl.querySelectorAll('.mobile-nav-btn');
                buttons.forEach((btn) => {
                    btn.classList.toggle('active', btn.dataset.mobilePanel === this._mobilePanel);
                });
            } else {
                var appElWithoutNav = document.getElementById('app');
                if (appElWithoutNav) appElWithoutNav.classList.remove('mobile-nav-visible');
            }
        }

        _setupMobileNav() {
            if (!this.mobileNavEl) return;
            this.mobileNavEl.addEventListener('click', (e) => {
                var btn = e.target.closest('[data-mobile-panel]');
                if (!btn) return;
                var targetPanel = btn.dataset.mobilePanel || 'preview';
                if (window.innerWidth <= 900 && this._mobilePanel === targetPanel && targetPanel !== 'preview') {
                    this._setMobilePanel('preview');
                    return;
                }
                this._setMobilePanel(targetPanel);
            });

            window.addEventListener('resize', () => {
                if (window.innerWidth > 900) {
                    this._showSidebar = true;
                    this._showRight = true;
                }
                this._updateWorkspaceLayout();
            });
        }

        _setMobilePanel(panel) {
            this._mobilePanel = panel || 'preview';
            this._updateWorkspaceLayout();
        }

        _setupDesktopResizers() {
            var rootStyle = document.documentElement.style;
            var persistLayout = () => this._persistDesktopLayoutState();
            var startResize = (config) => {
                if (!config || !config.handle) return;
                config.handle.addEventListener('pointerdown', (e) => {
                    if (window.innerWidth <= 900 && !config.allowMobile) return;
                    e.preventDefault();
                    var pointerId = e.pointerId;
                    var startX = e.clientX;
                    var startY = e.clientY;
                    document.body.classList.add(config.bodyClass);
                    if (config.handle.setPointerCapture) {
                        config.handle.setPointerCapture(pointerId);
                    }

                    var onMove = (moveEvent) => {
                        if (moveEvent.pointerId !== pointerId) return;
                        config.onMove(moveEvent, {
                            startX: startX,
                            startY: startY,
                            setVar: function (name, value) {
                                rootStyle.setProperty(name, value);
                            }
                        });
                    };

                    var finish = (endEvent) => {
                        if (endEvent.pointerId !== pointerId) return;
                        document.body.classList.remove(config.bodyClass);
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', finish);
                        window.removeEventListener('pointercancel', finish);
                        persistLayout();
                        if (config.handle.releasePointerCapture && config.handle.hasPointerCapture && config.handle.hasPointerCapture(pointerId)) {
                            config.handle.releasePointerCapture(pointerId);
                        }
                    };

                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', finish);
                    window.addEventListener('pointercancel', finish);
                });

                if (config.onReset) {
                    config.handle.addEventListener('dblclick', (e) => {
                        if (window.innerWidth <= 900 && !config.allowMobile) return;
                        e.preventDefault();
                        config.onReset({
                            setVar: function (name, value) {
                                rootStyle.setProperty(name, value);
                            }
                        });
                        persistLayout();
                    });
                }
            };

            startResize({
                handle: this.sidebarResizerEl,
                bodyClass: 'is-resizing-sidebar',
                onMove: (moveEvent, api) => {
                    var width = Math.max(180, Math.min(520, moveEvent.clientX - this.workspaceEl.getBoundingClientRect().left - 48));
                    api.setVar('--sidebar-w', width + 'px');
                },
                onReset: (api) => api.setVar('--sidebar-w', '240px')
            });

            startResize({
                handle: this.rightResizerEl,
                bodyClass: 'is-resizing-right',
                onMove: (moveEvent, api) => {
                    var wsRect = this.workspaceEl.getBoundingClientRect();
                    var width = Math.max(220, Math.min(560, wsRect.right - moveEvent.clientX));
                    api.setVar('--right-w', width + 'px');
                },
                onReset: (api) => api.setVar('--right-w', '260px')
            });

            startResize({
                handle: this.rightBodySplitterEl,
                bodyClass: 'is-resizing-right-sections',
                allowMobile: true,
                onMove: (moveEvent, api) => {
                    var panel = document.getElementById('right-panel');
                    if (!panel) return;
                    var rect = panel.getBoundingClientRect();
                    var offset = moveEvent.clientY - rect.top - 30;
                    var minTop = 120;
                    var maxTop = Math.max(minTop, rect.height - 260);
                    var top = Math.max(minTop, Math.min(maxTop, offset));
                    api.setVar('--right-top-h', top + 'px');
                },
                onReset: (api) => api.setVar('--right-top-h', '42%')
            });

            startResize({
                handle: this.detailSplitterEl,
                bodyClass: 'is-resizing-right-sections',
                allowMobile: true,
                onMove: (moveEvent, api) => {
                    var panel = document.getElementById('right-panel');
                    var detailTabs = document.getElementById('detail-tabs');
                    if (!panel || !detailTabs || detailTabs.style.display === 'none') return;
                    var rect = panel.getBoundingClientRect();
                    var topHeight = this.rightBodyEl ? this.rightBodyEl.getBoundingClientRect().height : 0;
                    var baseTop = rect.top + 30 + topHeight + 4 + detailTabs.getBoundingClientRect().height;
                    var middle = Math.max(100, Math.min(rect.height - topHeight - 180, moveEvent.clientY - baseTop));
                    api.setVar('--right-middle-h', middle + 'px');
                },
                onReset: (api) => api.setVar('--right-middle-h', '34%')
            });
        }

        _setupMobilePanelDragHandles() {
            var boneHeader = document.querySelector('#bone-editor-panel .be-header');
            if (boneHeader) {
                this.boneEditorHeaderHandleEl = boneHeader;
            }

            var relayPointerDrag = (handleEl, targetEl) => {
                if (!handleEl || !targetEl) return;
                handleEl.addEventListener('pointerdown', (e) => {
                    if (window.innerWidth > 900) return;
                    targetEl.dispatchEvent(new PointerEvent('pointerdown', {
                        bubbles: true,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        pointerId: e.pointerId,
                        pointerType: e.pointerType,
                        isPrimary: e.isPrimary,
                        button: e.button,
                        buttons: e.buttons
                    }));
                });
            };

            relayPointerDrag(this.detailTabsEl, this.rightBodySplitterEl);
            relayPointerDrag(this.boneEditorHeaderHandleEl, this.detailSplitterEl);
        }

        _persistDesktopLayoutState() {
            try {
                var computed = getComputedStyle(document.documentElement);
                var payload = {
                    sidebarW: computed.getPropertyValue('--sidebar-w').trim() || '240px',
                    rightW: computed.getPropertyValue('--right-w').trim() || '260px',
                    rightTopH: computed.getPropertyValue('--right-top-h').trim() || '42%',
                    rightMiddleH: computed.getPropertyValue('--right-middle-h').trim() || '34%'
                };
                localStorage.setItem(this._layoutStorageKey, JSON.stringify(payload));
            } catch (err) {
                // Ignore storage failures.
            }
        }

        _restoreDesktopLayoutState() {
            try {
                var raw = localStorage.getItem(this._layoutStorageKey);
                if (!raw) return;
                var parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object') return;
                var rootStyle = document.documentElement.style;
                if (parsed.sidebarW) rootStyle.setProperty('--sidebar-w', parsed.sidebarW);
                if (parsed.rightW) rootStyle.setProperty('--right-w', parsed.rightW);
                if (parsed.rightTopH) rootStyle.setProperty('--right-top-h', parsed.rightTopH);
                if (parsed.rightMiddleH) rootStyle.setProperty('--right-middle-h', parsed.rightMiddleH);
            } catch (err) {
                // Ignore invalid saved layout data.
            }
        }

        // ---- Tab Change Handler ----

        _onTabChanged(tabId, project) {
            if (!project) {
                this.skinProperties.setProject(null);
                this.previewPanel.clear();
                if (SkinApex.ModelViewer && SkinApex.ModelViewer.disposeThumbnailRenderer) {
                    SkinApex.ModelViewer.disposeThumbnailRenderer();
                }
                this.outlinePanel.hide();
                this.boneEditor.hide();
                this.skinProperties.hide();
                this._setDetailTabsVisible(false);
                this._showWelcome();
                this._updateHistoryUi();
                return;
            }

            this._getHistoryForTab(tabId);
            this._updateHistoryUi();

            if (project && project.__helpPage) {
                this.skinProperties.setProject(null);
                this._showWorkspace();
                this._updateWorkspaceLayout();
                this.explorer.render([]);
                this.skinList.render({ skins: [], isEncrypted: false });
                this.previewPanel.showHelpPage(project.__helpPage.title, project.__helpPage.body);
                this.outlinePanel.hide();
                this.boneEditor.hide();
                this.skinProperties.hide();
                this._setDetailTabsVisible(false);
                this._syncRightPanelState();
                this.statusBar.set(project.__helpPage.title, I18n.t('status.help'));
                return;
            }

            this._showWorkspace();
            this._updateWorkspaceLayout();
            this.skinProperties.setProject(project);

            this.explorer.render(project.fileTree);
            this.skinList.render(project);
            this.previewPanel.clear();
            if (window.innerWidth <= 900) {
                this._setMobilePanel('skins');
            }

            // Reset outline and bone editor on tab change
            this.outlinePanel.hide();
            this.boneEditor.hide();
            this.skinProperties.hide();
            this._setDetailTabsVisible(false);
            this._selectedSkinIndex = -1;
            this._currentSkin = null;
            var boneTabBtn = document.querySelector('[data-detail-tab="bone"]');
            if (boneTabBtn) boneTabBtn.disabled = false;

            this.statusBar.set(project.name, project.skins.length + ' skin(s)');
            this.logger.log('Switched to project: ' + project.name);
        }

        // ---- File Opening ----

        async _openFile(file) {
            // Check if file is a zip/mcpack
            if (SkinApex.ACCEPTED_EXTENSIONS.test(file.name.toLowerCase())) {
                return this._openZipFile(file);
            }

            // Non-zip file: wrap it in a new zip and open as a project
            return this._openSingleFile(file);
        }

        async _openZipFile(file) {
            this._showWorkspace();

            this.logger.log('Loading: ' + file.name + ' (' + Utils.formatSize(file.size) + ')');
            this.statusBar.setMessage(I18n.format('status.loading', { name: file.name }));

            try {
                const project = await Project.fromFile(file);
                this.tabManager.create(project.name, project);

                this.logger.success('Loaded: ' + project.name);
                this.logger.log('  Manifest: ' + (project.manifest ? 'found' : 'not found'));
                this.logger.log('  Skins: ' + project.skins.length);
                this.logger.log('  Geometries: ' + project.geometryList.length);
                this.logger.log('  Files: ' + Utils.countFiles(project.fileTree));

                if (project.skins.length === 0) {
                    this.logger.warn('No skins found in skins.json');
                }

                this.statusBar.set(project.name, project.skins.length + ' skin(s)');
                if (window.innerWidth <= 900) {
                    this._setMobilePanel('skins');
                }
            } catch (err) {
                this.logger.error('Failed to load ' + file.name + ': ' + err.message);
                this.statusBar.setMessage(I18n.t('status.failedLoad'));
                console.error(err);
            }
        }

        async _openSingleFile(file) {
            this._showWorkspace();

            this.logger.log('Opening file: ' + file.name + ' (' + Utils.formatSize(file.size) + ')');
            this.statusBar.setMessage(I18n.format('status.loading', { name: file.name }));

            try {
                var zip = new JSZip();
                zip.file(file.name, file);
                var displayName = file.name.replace(/\.[^.]+$/, '');
                var project = await Project.fromZip(zip, displayName);
                this.tabManager.create(project.name, project);

                this.logger.success('Loaded: ' + project.name);
                this.logger.log('  Files: ' + Utils.countFiles(project.fileTree));
                this.statusBar.set(project.name, '1 file');
                if (window.innerWidth <= 900) {
                    this._setMobilePanel('skins');
                }
            } catch (err) {
                this.logger.error('Failed to load ' + file.name + ': ' + err.message);
                this.statusBar.setMessage(I18n.t('status.failedLoad'));
                console.error(err);
            }
        }

        _handleFiles(fileList) {
            for (const file of fileList) {
                this._openFile(file);
            }
        }

        // ---- Crypto Initialization ----

        _initCrypto() {
            // Pre-warm WASM crypto worker
            if (window.SkinApex.WasmCrypto && window.SkinApex.WasmCrypto.prewarm) {
                window.SkinApex.WasmCrypto.prewarm().then(() => {
                    this.logger.log('WASM crypto ready');
                }).catch((err) => {
                    console.error('WASM crypto init failed:', err);
                });
            }
        }

        // ---- Drag & Drop ----

        _setupDragDrop() {
            let dragCounter = 0;

            document.addEventListener('dragenter', (e) => {
                e.preventDefault();
                dragCounter++;
                this.dropOverlay.style.display = 'flex';
            });

            document.addEventListener('dragleave', (e) => {
                e.preventDefault();
                dragCounter--;
                if (dragCounter <= 0) {
                    dragCounter = 0;
                    this.dropOverlay.style.display = 'none';
                }
            });

            document.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            document.addEventListener('drop', (e) => {
                e.preventDefault();
                dragCounter = 0;
                this.dropOverlay.style.display = 'none';

                // Check for folder drops using webkitGetAsEntry
                if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
                    var items = e.dataTransfer.items;
                    for (var i = 0; i < items.length; i++) {
                        var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
                        if (entry && entry.isDirectory) {
                            this._openDirectoryEntry(entry);
                            return;
                        }
                    }
                }

                if (e.dataTransfer.files.length > 0) {
                    this._handleFiles(e.dataTransfer.files);
                }
            });
        }

        // ---- File Input ----

        _setupFileInput() {
            this.fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this._handleFiles(e.target.files);
                    e.target.value = '';
                }
            });
        }

        // ---- Folder Input ----

        _setupFolderInput() {
            this.folderInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this._openFolder(e.target.files);
                    e.target.value = '';
                }
            });
        }

        // ---- Keyboard Shortcuts ----

        _setupShortcuts() {
            document.addEventListener('keydown', (e) => {
                // Don't capture shortcuts when typing in inputs
                var inInput = this._isEditingTextInput(e.target);

                if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
                    e.preventDefault();
                    this.fileInput.click();
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    this._saveActiveProject();
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
                    e.preventDefault();
                    const tab = this.tabManager.getActive();
                    if (tab) this._closeTab(tab.id);
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                    e.preventDefault();
                    this._showSidebar = !this._showSidebar;
                    var sb = document.querySelector('[data-panel="sidebar"]');
                    if (sb) sb.classList.toggle('active', this._showSidebar);
                    this._updateWorkspaceLayout();
                }
                if (!inInput && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) this._redo();
                    else this._undo();
                }
                if (!inInput && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    this._redo();
                }
                // Delete key to remove selected bone
                if (e.key === 'Delete' && this.boneEditor.isVisible()) {
                    var boneName = this.boneEditor.getCurrentBoneName();
                    if (boneName) {
                        var geoId = this.outlinePanel.getSelectedGeoId();
                        var tab = this.tabManager.getActive();
                        if (tab && geoId) {
                            var geoData = tab.project.geometries[geoId];
                            if (geoData) {
                                var beforeBones = this._getBoneSnapshot(geoData);
                                var viewer = this.previewPanel.getModelViewer();
                                if (viewer) viewer.deleteBone(boneName, geoId, geoData);
                                this.boneEditor.hide();
                                this._refreshOutline();
                                this._refreshSkinListSelection();
                                this._pushBoneSnapshotHistory(
                                    I18n.format('history.boneDelete', { name: boneName }),
                                    geoId,
                                    geoData,
                                    beforeBones,
                                    this._getBoneSnapshot(geoData),
                                    { selectedBone: boneName, showBoneEditor: true },
                                    { selectedBone: '', showBoneEditor: false }
                                );
                                this.logger.log('Deleted bone: ' + boneName);
                            }
                        }
                    }
                }
            });
        }

        // ---- Activity Bar ----

        _setupActivityButtons() {
            const sidebarBtn = document.querySelector('[data-panel="sidebar"]');

            if (sidebarBtn) {
                sidebarBtn.addEventListener('click', () => {
                    this._showSidebar = !this._showSidebar;
                    sidebarBtn.classList.toggle('active', this._showSidebar);
                    this._updateWorkspaceLayout();
                });
            }

            // Right panel toggle button
            const rightBtn = document.querySelector('[data-panel="right"]');
            if (rightBtn) {
                rightBtn.addEventListener('click', () => {
                    this._showRight = !this._showRight;
                    rightBtn.classList.toggle('active', this._showRight);
                    this._updateWorkspaceLayout();
                });
            }
        }

        // ---- Welcome Page ----

        _setupWelcome() {
            document.getElementById('btn-open').addEventListener('click', () => {
                this.fileInput.click();
            });

            document.getElementById('btn-open-folder').addEventListener('click', () => {
                this.folderInput.click();
            });

            const welcomeDrop = document.getElementById('welcome-drop');
            welcomeDrop.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.stopPropagation();
                welcomeDrop.classList.add('drag-over');
            });
            welcomeDrop.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                welcomeDrop.classList.add('drag-over');
            });
            welcomeDrop.addEventListener('dragleave', (e) => {
                e.stopPropagation();
                welcomeDrop.classList.remove('drag-over');
            });
            welcomeDrop.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                welcomeDrop.classList.remove('drag-over');

                // Check for folder drops
                if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
                    var items = e.dataTransfer.items;
                    for (var i = 0; i < items.length; i++) {
                        var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
                        if (entry && entry.isDirectory) {
                            this._openDirectoryEntry(entry);
                            return;
                        }
                    }
                }

                this._handleFiles(e.dataTransfer.files);
            });
        }

        _setupToolbarActions() {
            var self = this;
            var openBtn = document.getElementById('btn-toolbar-open');
            if (openBtn) {
                openBtn.addEventListener('click', function () {
                    self.fileInput.click();
                });
            }

            var openFolderBtn = document.getElementById('btn-toolbar-open-folder');
            if (openFolderBtn) {
                openFolderBtn.addEventListener('click', function () {
                    self.folderInput.click();
                });
            }

            var saveBtn = document.getElementById('btn-toolbar-save');
            if (saveBtn) {
                saveBtn.addEventListener('click', function () {
                    self._saveActiveProject();
                });
            }

            // Optional legacy menubar support
            var menubar = document.getElementById('menubar');
            if (!menubar) return;

            // Track open state
            var openMenuItem = null;

            function closeAllMenus() {
                menubar.querySelectorAll('.menu-item.open').forEach(function (el) {
                    el.classList.remove('open');
                });
                menubar.querySelectorAll('.menu-action-history.history-open').forEach(function (el) {
                    el.classList.remove('history-open');
                });
                openMenuItem = null;
            }

            function openMenuDropdown(menuItem) {
                closeAllMenus();
                menuItem.classList.add('open');
                openMenuItem = menuItem;

                var dropdown = menuItem.querySelector('.menu-dropdown');
                if (dropdown) {
                    dropdown.style.left = '0px';
                    dropdown.style.right = 'auto';
                    dropdown.style.top = '100%';
                    var rect = dropdown.getBoundingClientRect();
                    var margin = 8;
                    if (rect.right > window.innerWidth - margin) {
                        var shiftLeft = rect.right - (window.innerWidth - margin);
                        dropdown.style.left = Math.min(0, -shiftLeft) + 'px';
                    }
                    rect = dropdown.getBoundingClientRect();
                    if (rect.bottom > window.innerHeight - margin) {
                        dropdown.style.top = 'auto';
                        dropdown.style.bottom = '100%';
                    }
                }
            }

            // Click on menu trigger to open dropdown
            menubar.addEventListener('click', function (e) {
                var trigger = e.target.closest('.menu-trigger');
                var historyItem = e.target.closest('.menu-history-item');
                var action = e.target.closest('.menu-action');

                if (historyItem) {
                    e.stopPropagation();
                    var direction = historyItem.dataset.historyDirection;
                    var history = self._getActiveHistory();
                    if (!history) return;
                    var items = direction === 'undo' ? history.getUndoItems(15) : history.getRedoItems(15);
                    var target = items[Number(historyItem.dataset.historyIndex)];
                    if (!target) return;
                    if (direction === 'undo') self._undoToAction(target);
                    else self._redoToAction(target);
                    closeAllMenus();
                    return;
                }

                if (action) {
                    if (action.classList.contains('menu-action-history')) {
                        var historyDirection = action.dataset.historyDirection;
                        var hasItems = historyDirection === 'undo'
                            ? !!(self._getActiveHistory() && self._getActiveHistory().canUndo())
                            : !!(self._getActiveHistory() && self._getActiveHistory().canRedo());
                        if (!hasItems) return;
                        action.classList.toggle('history-open');
                        if (action.classList.contains('history-open')) {
                            self._positionHistorySubmenu(action);
                        }
                        e.stopPropagation();
                        return;
                    }
                    // Execute action
                    var act = action.dataset.action;
                    self._executeMenuAction(act);
                    closeAllMenus();
                    return;
                }

                if (trigger) {
                    var item = trigger.closest('.menu-item');
                    if (item.classList.contains('open')) {
                        closeAllMenus();
                    } else {
                        openMenuDropdown(item);
                    }
                    e.stopPropagation();
                }
            });

            // Hover to switch menus when one is already open
            menubar.addEventListener('mouseover', function (e) {
                if (!openMenuItem) return;
                var trigger = e.target.closest('.menu-trigger');
                var historyAction = e.target.closest('.menu-action-history');
                if (trigger) {
                    var item = trigger.closest('.menu-item');
                    if (item !== openMenuItem) {
                        openMenuDropdown(item);
                    }
                }
                if (historyAction) {
                    menubar.querySelectorAll('.menu-action-history.history-open').forEach(function (el) {
                        if (el !== historyAction) el.classList.remove('history-open');
                    });
                    historyAction.classList.add('history-open');
                    self._positionHistorySubmenu(historyAction);
                }
            });

            menubar.addEventListener('scroll', function (e) {
                var content = e.target.closest('.menu-submenu-content');
                if (!content) return;
                self._updateHistorySubmenuScrollState(content.closest('.menu-submenu'));
            }, true);

            // Close on click outside
            document.addEventListener('click', function () {
                closeAllMenus();
            });

            // Close on Escape
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    closeAllMenus();
                }
            });
        }

        _executeMenuAction(action) {
            switch (action) {
                case 'open-file':
                    this.fileInput.click();
                    break;
                case 'open-folder':
                    this.folderInput.click();
                    break;
                case 'save':
                    this._saveActiveProject();
                    break;
                case 'undo':
                    this._undo();
                    break;
                case 'redo':
                    this._redo();
                    break;
                case 'toggle-sidebar':
                    this._showSidebar = !this._showSidebar;
                    var sb = document.querySelector('[data-panel="sidebar"]');
                    if (sb) sb.classList.toggle('active', this._showSidebar);
                    this._updateWorkspaceLayout();
                    break;
                case 'toggle-right':
                    this._showRight = !this._showRight;
                    var rb = document.querySelector('[data-panel="right"]');
                    if (rb) rb.classList.toggle('active', this._showRight);
                    this._updateWorkspaceLayout();
                    break;
                case 'about':
                    this._openHelpTab(I18n.t('help.about.title'), {
                        description: I18n.t('help.about.description'),
                        heroCards: [
                            { title: I18n.t('help.about.hero.1.title'), text: I18n.t('help.about.hero.1.text'), className: 'is-accent' },
                            { title: I18n.t('help.about.hero.2.title'), text: I18n.t('help.about.hero.2.text'), className: 'is-success' },
                            { title: I18n.t('help.about.hero.3.title'), text: I18n.t('help.about.hero.3.text'), className: 'is-warn' }
                        ],
                        groups: [
                            {
                                title: I18n.t('help.group.basics'),
                                sections: [
                                    {
                                        title: I18n.t('help.about.overview'),
                                        items: [
                                            { key: I18n.t('help.about.author'), value: I18n.t('help.about.authorValue') },
                                            { key: I18n.t('help.about.purpose'), value: I18n.t('help.about.purposeValue') },
                                            { key: I18n.t('help.about.focus'), value: I18n.t('help.about.focusValue') }
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.about.forWho'),
                                        items: [
                                            I18n.t('help.about.forWho.1'),
                                            I18n.t('help.about.forWho.2'),
                                            I18n.t('help.about.forWho.3')
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.about.workspace'),
                                        items: [
                                            { type: 'visual', title: I18n.t('help.about.workspace.visualTitle'), description: I18n.t('help.about.workspace.visualDesc'), visual: { type: 'workspace', labels: { explorer: I18n.t('help.visual.explorer'), toolbar: I18n.t('help.visual.toolbar'), preview: I18n.t('help.visual.preview'), sidebar: I18n.t('help.visual.sidebar') } } },
                                            I18n.t('help.about.workspace.1'),
                                            I18n.t('help.about.workspace.2'),
                                            I18n.t('help.about.workspace.3'),
                                            I18n.t('help.about.workspace.4')
                                        ]
                                    }
                                ]
                            },
                            {
                                title: I18n.t('help.group.features'),
                                sections: [
                                    {
                                        title: I18n.t('help.about.core'),
                                        items: [
                                            { type: 'card-grid', cards: [
                                                { title: I18n.t('help.about.core.card1.title'), text: I18n.t('help.about.core.card1.text') },
                                                { title: I18n.t('help.about.core.card2.title'), text: I18n.t('help.about.core.card2.text') },
                                                { title: I18n.t('help.about.core.card3.title'), text: I18n.t('help.about.core.card3.text') },
                                                { title: I18n.t('help.about.core.card4.title'), text: I18n.t('help.about.core.card4.text') }
                                            ] }
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.about.tech'),
                                        items: [
                                            { key: I18n.t('help.about.tech.rendering'), value: I18n.t('help.about.tech.renderingValue') },
                                            { key: I18n.t('help.about.tech.archive'), value: I18n.t('help.about.tech.archiveValue') },
                                            { key: I18n.t('help.about.tech.target'), value: I18n.t('help.about.tech.targetValue') }
                                        ]
                                    }
                                ]
                            },
                            {
                                title: I18n.t('help.group.workflow'),
                                sections: [
                                    {
                                        title: I18n.t('help.about.workflow'),
                                        items: [
                                            { type: 'visual', title: I18n.t('help.about.workflow.visualTitle'), description: I18n.t('help.about.workflow.visualDesc'), visual: { type: 'steps', items: [
                                                { title: I18n.t('help.about.workflow.step1.title'), description: I18n.t('help.about.workflow.step1.desc') },
                                                { title: I18n.t('help.about.workflow.step2.title'), description: I18n.t('help.about.workflow.step2.desc') },
                                                { title: I18n.t('help.about.workflow.step3.title'), description: I18n.t('help.about.workflow.step3.desc') },
                                                { title: I18n.t('help.about.workflow.step4.title'), description: I18n.t('help.about.workflow.step4.desc') },
                                                { title: I18n.t('help.about.workflow.step5.title'), description: I18n.t('help.about.workflow.step5.desc') }
                                            ] } },
                                            { type: 'callout', className: 'is-info', text: I18n.t('help.about.workflow.note') }
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.about.notes'),
                                        items: [
                                            I18n.t('help.about.notes.1'),
                                            I18n.t('help.about.notes.2'),
                                            I18n.t('help.about.notes.3')
                                        ]
                                    }
                                ]
                            }
                        ]
                    });
                    break;
                case 'shortcuts':
                    this._openHelpTab(I18n.t('help.shortcuts.title'), {
                        description: I18n.t('help.shortcuts.description'),
                        heroCards: [
                            { title: I18n.t('help.shortcuts.hero.1.title'), text: I18n.t('help.shortcuts.hero.1.text'), className: 'is-accent' },
                            { title: I18n.t('help.shortcuts.hero.2.title'), text: I18n.t('help.shortcuts.hero.2.text'), className: 'is-success' },
                            { title: I18n.t('help.shortcuts.hero.3.title'), text: I18n.t('help.shortcuts.hero.3.text'), className: 'is-warn' }
                        ],
                        groups: [
                            {
                                title: I18n.t('help.group.project'),
                                sections: [
                                    {
                                        title: I18n.t('help.shortcuts.project'),
                                        items: [
                                            { key: 'Ctrl+O', value: I18n.t('help.shortcuts.project.openFile') },
                                            { key: I18n.t('menu.openFolder'), value: I18n.t('help.shortcuts.project.openFolder') },
                                            { key: 'Ctrl+S', value: I18n.t('help.shortcuts.project.save') },
                                            { key: 'Ctrl+W', value: I18n.t('help.shortcuts.project.close') }
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.shortcuts.panels'),
                                        items: [
                                            { key: 'Ctrl+B', value: I18n.t('help.shortcuts.panels.sidebar') },
                                            { key: I18n.t('menu.view') + ' > ' + I18n.t('menu.togglePanel'), value: I18n.t('help.shortcuts.panels.right') }
                                        ]
                                    }
                                ]
                            },
                            {
                                title: I18n.t('help.group.editing'),
                                sections: [
                                    {
                                        title: I18n.t('help.shortcuts.bones'),
                                        items: [
                                            { key: 'Delete', value: I18n.t('help.shortcuts.bones.delete') },
                                            { key: 'Click Bone', value: I18n.t('help.shortcuts.bones.click') },
                                            { key: 'Drag Bone', value: I18n.t('help.shortcuts.bones.drag') },
                                            { key: 'Auto Fix', value: I18n.t('help.shortcuts.bones.fix') }
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.shortcuts.preview'),
                                        items: [
                                            { key: '3D / UV', value: I18n.t('help.shortcuts.preview.mode') },
                                            { key: 'Move / Rotate / Origin', value: I18n.t('help.shortcuts.preview.gizmo') },
                                            { key: 'Tap or Click Model', value: I18n.t('help.shortcuts.preview.pick') }
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.shortcuts.mouse'),
                                        items: [
                                            { type: 'visual', title: I18n.t('help.shortcuts.mouse.visualTitle'), description: I18n.t('help.shortcuts.mouse.visualDesc'), visual: { type: 'toolbar', items: [
                                                { label: I18n.t('preview.tool.move'), className: 'is-active' },
                                                { label: I18n.t('preview.tool.rotate') },
                                                { label: I18n.t('preview.tool.origin'), className: 'is-warn' }
                                            ] } },
                                            { key: I18n.t('help.shortcuts.mouse.drag'), value: I18n.t('help.shortcuts.mouse.dragValue') },
                                            { key: I18n.t('help.shortcuts.mouse.orbit'), value: I18n.t('help.shortcuts.mouse.orbitValue') },
                                            { key: I18n.t('help.shortcuts.mouse.pick'), value: I18n.t('help.shortcuts.mouse.pickValue') },
                                            { key: I18n.t('help.shortcuts.mouse.tree'), value: I18n.t('help.shortcuts.mouse.treeValue') }
                                        ]
                                    }
                                ]
                            },
                            {
                                title: I18n.t('help.group.mobileAndTips'),
                                sections: [
                                    {
                                        title: I18n.t('help.shortcuts.mobile'),
                                        items: [
                                            { key: 'Bottom Navigation', value: I18n.t('help.shortcuts.mobile.nav') },
                                            { key: 'Select Skin', value: I18n.t('help.shortcuts.mobile.skin') }
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.shortcuts.tips'),
                                        items: [
                                            I18n.t('help.shortcuts.tips.1'),
                                            I18n.t('help.shortcuts.tips.2')
                                        ]
                                    }
                                ]
                            }
                        ]
                    });
                    break;
                case 'rig-rules':
                    this._openHelpTab(I18n.t('help.rig.title'), {
                        description: I18n.t('help.rig.description'),
                        heroCards: [
                            { title: I18n.t('help.rig.hero.1.title'), text: I18n.t('help.rig.hero.1.text'), className: 'is-success' },
                            { title: I18n.t('help.rig.hero.2.title'), text: I18n.t('help.rig.hero.2.text'), className: 'is-warn' },
                            { title: I18n.t('help.rig.hero.3.title'), text: I18n.t('help.rig.hero.3.text'), className: 'is-danger' }
                        ],
                        groups: [
                            {
                                title: I18n.t('help.group.basics'),
                                sections: [
                                    {
                                        title: I18n.t('help.rig.scope'),
                                        items: [
                                            I18n.t('help.rig.scope.1'),
                                            I18n.t('help.rig.scope.2')
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.rig.names'),
                                        items: [
                                            { key: 'root', value: I18n.t('help.rig.names.root') },
                                            { key: 'waist', value: I18n.t('help.rig.names.waist') },
                                            { key: 'body', value: I18n.t('help.rig.names.body') },
                                            { key: 'head', value: I18n.t('help.rig.names.head') },
                                            { key: 'leftArm / rightArm', value: I18n.t('help.rig.names.arms') },
                                            { key: 'leftLeg / rightLeg', value: I18n.t('help.rig.names.legs') }
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.rig.hierarchy'),
                                        items: [
                                            I18n.t('help.rig.hierarchy.1'),
                                            I18n.t('help.rig.hierarchy.2'),
                                            I18n.t('help.rig.hierarchy.3'),
                                            I18n.t('help.rig.hierarchy.4'),
                                            I18n.t('help.rig.hierarchy.5')
                                        ]
                                    }
                                ]
                            },
                            {
                                title: I18n.t('help.group.validation'),
                                sections: [
                                    {
                                        title: I18n.t('help.rig.colors'),
                                        items: [
                                            { type: 'visual', title: I18n.t('help.rig.colors.visualTitle'), description: I18n.t('help.rig.colors.visualDesc'), visual: { type: 'chips', items: [
                                                { label: I18n.t('help.visual.green'), className: 'is-pass' },
                                                { label: I18n.t('help.visual.yellow'), className: 'is-warn' },
                                                { label: I18n.t('help.visual.red'), className: 'is-error' },
                                                { label: I18n.t('help.visual.blue'), className: 'is-info' }
                                            ] } },
                                            { key: 'Green', value: I18n.t('help.rig.colors.green') },
                                            { key: 'Yellow', value: I18n.t('help.rig.colors.yellow') },
                                            { key: 'Red', value: I18n.t('help.rig.colors.red') },
                                            { key: 'Blue', value: I18n.t('help.rig.colors.blue') }
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.rig.examples'),
                                        items: [
                                            { type: 'visual', title: I18n.t('help.rig.examples.visualTitle'), description: I18n.t('help.rig.examples.visualDesc'), visual: { type: 'tree', items: [
                                                { label: 'root', indent: 0, badge: I18n.t('help.visual.green'), badgeClass: 'is-pass' },
                                                { label: 'body', indent: 18, badge: I18n.t('help.visual.green'), badgeClass: 'is-pass' },
                                                { label: 'head', indent: 36, badge: I18n.t('help.visual.blue'), badgeClass: 'is-info' },
                                                { label: 'left_arm', indent: 36, badge: I18n.t('help.visual.yellow'), badgeClass: 'is-warn' },
                                                { label: 'rightLeg', indent: 18, badge: I18n.t('help.visual.red'), badgeClass: 'is-error' }
                                            ] } },
                                            I18n.t('help.rig.examples.1'),
                                            I18n.t('help.rig.examples.2'),
                                            I18n.t('help.rig.examples.3')
                                        ]
                                    }
                                ]
                            },
                            {
                                title: I18n.t('help.group.fixing'),
                                sections: [
                                    {
                                        title: I18n.t('help.rig.naming'),
                                        items: [
                                            I18n.t('help.rig.naming.1'),
                                            I18n.t('help.rig.naming.2'),
                                            I18n.t('help.rig.naming.3')
                                        ]
                                    },
                                    {
                                        title: I18n.t('help.rig.autofix'),
                                        items: [
                                            I18n.t('help.rig.autofix.1'),
                                            I18n.t('help.rig.autofix.2')
                                        ]
                                    }
                                ]
                            }
                        ]
                    });
                    break;
                case 'tutorial':
                    this._openHelpTab(I18n.t('help.tutorial.title'), {
                        description: I18n.t('help.tutorial.description'),
                        heroCards: [
                            { title: I18n.t('help.tutorial.hero.1.title'), text: I18n.t('help.tutorial.hero.1.text'), className: 'is-accent' },
                            { title: I18n.t('help.tutorial.hero.2.title'), text: I18n.t('help.tutorial.hero.2.text'), className: 'is-success' },
                            { title: I18n.t('help.tutorial.hero.3.title'), text: I18n.t('help.tutorial.hero.3.text'), className: 'is-warn' }
                        ],
                        tutorial: {
                            steps: [
                                { title: I18n.t('help.tutorial.step1'), description: I18n.t('help.tutorial.step1.desc') },
                                { title: I18n.t('help.tutorial.step2'), description: I18n.t('help.tutorial.step2.desc') },
                                { title: I18n.t('help.tutorial.step3'), description: I18n.t('help.tutorial.step3.desc') },
                                { title: I18n.t('help.tutorial.step4'), description: I18n.t('help.tutorial.step4.desc') },
                                { title: I18n.t('help.tutorial.step5'), description: I18n.t('help.tutorial.step5.desc') }
                            ],
                            panelsTitle: I18n.t('help.tutorial.layout'),
                            panelsDescription: I18n.t('help.tutorial.layout.desc'),
                            colorsTitle: I18n.t('help.tutorial.colors'),
                            colorsDescription: I18n.t('help.tutorial.colors.desc')
                        },
                        groups: [
                            {
                                title: I18n.t('help.group.startHere'),
                                sections: [
                                    {
                                        title: I18n.t('help.tutorial.readingUi'),
                                        items: [
                                            { type: 'visual', title: I18n.t('help.tutorial.readingUi.visualTitle'), description: I18n.t('help.tutorial.readingUi.visualDesc'), visual: { type: 'workspace', labels: { explorer: I18n.t('help.visual.explorer'), toolbar: I18n.t('help.visual.tabs'), preview: I18n.t('help.visual.preview'), sidebar: I18n.t('help.visual.sidebar') } } },
                                            I18n.t('help.tutorial.readingUi.1'),
                                            I18n.t('help.tutorial.readingUi.2'),
                                            I18n.t('help.tutorial.readingUi.3'),
                                            I18n.t('help.tutorial.readingUi.4')
                                        ]
                                    }
                                ]
                            },
                            {
                                title: I18n.t('help.group.editing'),
                                sections: [
                                    {
                                        title: I18n.t('help.tutorial.editingBones'),
                                        items: [
                                            { type: 'visual', title: I18n.t('help.tutorial.editingBones.visualTitle'), description: I18n.t('help.tutorial.editingBones.visualDesc'), visual: { type: 'toolbar', items: [
                                                { label: I18n.t('preview.tool.move'), className: 'is-active' },
                                                { label: I18n.t('preview.tool.rotate') },
                                                { label: I18n.t('preview.tool.origin'), className: 'is-warn' }
                                            ] } },
                                            I18n.t('help.tutorial.editingBones.1'),
                                            I18n.t('help.tutorial.editingBones.2'),
                                            I18n.t('help.tutorial.editingBones.3'),
                                            I18n.t('help.tutorial.editingBones.4')
                                        ]
                                    }
                                ]
                            },
                            {
                                title: I18n.t('help.group.nextSteps'),
                                sections: [
                                    {
                                        title: I18n.t('help.tutorial.next'),
                                        items: [
                                            I18n.t('help.tutorial.next.1'),
                                            I18n.t('help.tutorial.next.2'),
                                            I18n.t('help.tutorial.next.3')
                                        ]
                                    }
                                ]
                            }
                        ]
                    });
                    break;
                case 'set-lang-en':
                    I18n.setLocale('en');
                    break;
                case 'set-lang-zh':
                    I18n.setLocale('zh-CN');
                    break;
                case 'encrypt':
                    this._openEncryptDialog();
                    break;
                case 'decrypt':
                    this._openDecryptDialog();
                    break;
            }
        }

        _openHelpTab(title, body) {
            var helpProject = {
                __helpPage: {
                    title: title,
                    body: body
                },
                cleanup: function () {}
            };
            this.tabManager.create(title, helpProject);
        }

        async _saveActiveProject() {
            var tab = this.tabManager.getActive();
            if (!tab || !tab.project) {
                this.logger.warn('No active project to save');
                return;
            }

            try {
                this.statusBar.setMessage(I18n.format('status.saving', { name: tab.project.name }));
                var blob = await tab.project.exportBlob();
                var base = tab.project.fileName || tab.project.name || 'skinpack';
                var fileName = base.replace(/\.(mcpack|mcaddon|zip)$/i, '') + '.mcpack';

                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

                this.logger.success('Saved: ' + fileName);
                this.statusBar.setMessage(I18n.format('status.saved', { name: fileName }));
            } catch (err) {
                this.logger.error('Save failed: ' + err.message);
                this.statusBar.setMessage(I18n.t('status.saveFailed'));
                console.error(err);
            }
        }

        // ---- Helpers ----

        /**
         * Refresh the outline panel with current geometry data.
         * Uses the viewer's current geometry if available.
         */
        _refreshOutline() {
            const tab = this.tabManager.getActive();
            if (!tab || !tab.project) return;

            var selectedBone = this.outlinePanel.getSelectedBone();
            var selectedGeoId = this.outlinePanel.getSelectedGeoId();

            // Get the current geometry from the model viewer
            var viewer = this.previewPanel.getModelViewer();
            var geoId = selectedGeoId || (viewer ? viewer.getCurrentGeoId() : null);
            var geoData = geoId ? tab.project.geometries[geoId] : (viewer ? viewer.getCurrentGeoData() : null);

            if (geoId && geoData) {
                this.outlinePanel.render(geoId, geoData);

                // Restore selection after refresh
                if (selectedBone) {
                    this.outlinePanel.selectBone(selectedBone, geoId);
                }
            }
        }

        /**
         * Find bone data by name in geometry data
         */
        _findBoneData(boneName, geoData) {
            if (!geoData || !geoData.bones) return null;
            for (var i = 0; i < geoData.bones.length; i++) {
                if ((geoData.bones[i].name || ('bone_' + i)) === boneName) {
                    return geoData.bones[i];
                }
            }
            return null;
        }

        // ---- Folder Opening ----

        /**
         * Open a folder selected via file input (webkitdirectory)
         */
        async _openFolder(fileList) {
            this._showWorkspace();
            this.logger.log('Loading folder with ' + fileList.length + ' files...');
            this.statusBar.setMessage(I18n.t('status.loadingFolder'));

            try {
                var zip = new JSZip();
                var folderName = fileList[0] ? fileList[0].webkitRelativePath.split('/')[0] : 'SkinPack';

                for (var i = 0; i < fileList.length; i++) {
                    var file = fileList[i];
                    // Skip hidden files (starting with .)
                    var parts = file.webkitRelativePath.split('/');
                    var hasHidden = false;
                    for (var p = 0; p < parts.length; p++) {
                        if (parts[p].startsWith('.')) { hasHidden = true; break; }
                    }
                    if (hasHidden) continue;

                    zip.file(file.webkitRelativePath, file);
                }

                var project = await Project.fromZip(zip, folderName);
                this.tabManager.create(project.name, project);

                this.logger.success('Loaded folder: ' + project.name);
                this.logger.log('  Skins: ' + project.skins.length);
                this.logger.log('  Geometries: ' + project.geometryList.length);

                if (project.skins.length === 0) {
                    this.logger.warn('No skins found in skins.json');
                }

                this.statusBar.set(project.name, project.skins.length + ' skin(s)');
                if (window.innerWidth <= 900) {
                    this._setMobilePanel('skins');
                }
            } catch (err) {
                this.logger.error('Failed to load folder: ' + err.message);
                this.statusBar.setMessage(I18n.t('status.failedLoadFolder'));
                console.error(err);
            }
        }

        /**
         * Open a folder dropped via drag & drop using FileSystemDirectoryEntry
         */
        _openDirectoryEntry(dirEntry) {
            var self = this;
            this._showWorkspace();
            this.logger.log('Reading folder: ' + dirEntry.name + '...');
            this.statusBar.setMessage(I18n.t('status.readingFolder'));

            this._readAllDirectoryEntries(dirEntry).then(function(fileMap) {
                if (Object.keys(fileMap).length === 0) {
                    self.logger.warn('Folder is empty or could not be read');
                    self.statusBar.setMessage(I18n.t('status.emptyFolder'));
                    return;
                }

                var zip = new JSZip();
                for (var path in fileMap) {
                    if (fileMap.hasOwnProperty(path)) {
                        zip.file(path, fileMap[path]);
                    }
                }

                return Project.fromZip(zip, dirEntry.name);
            }).then(function(project) {
                if (!project) return;
                self.tabManager.create(project.name, project);

                self.logger.success('Loaded folder: ' + project.name);
                self.logger.log('  Skins: ' + project.skins.length);
                self.logger.log('  Geometries: ' + project.geometryList.length);

                if (project.skins.length === 0) {
                    self.logger.warn('No skins found in skins.json');
                }

                self.statusBar.set(project.name, project.skins.length + ' skin(s)');
                if (window.innerWidth <= 900) {
                    self._setMobilePanel('skins');
                }
            }).catch(function(err) {
                self.logger.error('Failed to load folder: ' + err.message);
                self.statusBar.setMessage(I18n.t('status.failedLoadFolder'));
                console.error(err);
            });
        }

        /**
         * Recursively read all files from a FileSystemDirectoryEntry
         * Returns a promise resolving to { relativePath: File }
         */
        _readAllDirectoryEntries(dirEntry) {
            var self = this;
            return new Promise(function(resolve, reject) {
                var reader = dirEntry.createReader();
                var fileMap = {};

                function readBatch() {
                    reader.readEntries(function(entries) {
                        if (entries.length === 0) {
                            resolve(fileMap);
                            return;
                        }

                        var promises = [];
                        for (var i = 0; i < entries.length; i++) {
                            var entry = entries[i];
                            // Skip hidden files
                            if (entry.name.startsWith('.')) continue;

                            if (entry.isFile) {
                                promises.push(self._readFileEntry(entry, dirEntry.name, fileMap));
                            } else if (entry.isDirectory) {
                                promises.push(self._readAllDirectoryEntries(entry).then(function(subMap) {
                                    for (var path in subMap) {
                                        if (subMap.hasOwnProperty(path)) {
                                            fileMap[path] = subMap[path];
                                        }
                                    }
                                }));
                            }
                        }

                        Promise.all(promises).then(function() {
                            readBatch(); // readEntries may return in batches
                        });
                    }, reject);
                }

                readBatch();
            });
        }

        /**
         * Read a single FileSystemFileEntry and add it to fileMap
         */
        _readFileEntry(fileEntry, basePath, fileMap) {
            return new Promise(function(resolve, reject) {
                fileEntry.file(function(file) {
                    // Build relative path from the base folder name
                    var relativePath = basePath + '/' + file.name;
                    fileMap[relativePath] = file;
                    resolve();
                }, reject);
            });
        }

        _openEncryptDialog() {
            var tab = this.tabManager.getActive();
            if (!tab || !tab.project) {
                this.logger.warn('No active project to encrypt');
                return;
            }

            var self = this;
            var generatedKey = SkinApex.CryptManager._generateKeyString();

            var bodyHtml =
                '<div class="crypt-field">' +
                    '<label>' + I18n.t('crypt.key') + '</label>' +
                    '<div class="crypt-radio-group">' +
                        '<label class="crypt-radio">' +
                            '<input type="radio" name="crypt-enc-key" value="official" checked>' +
                            '<span>' + I18n.t('crypt.official') + '</span>' +
                        '</label>' +
                        '<label class="crypt-radio">' +
                            '<input type="radio" name="crypt-enc-key" value="custom">' +
                            '<span>' + I18n.t('crypt.customAuto') + '</span>' +
                        '</label>' +
                    '</div>' +
                '</div>' +
                '<div class="crypt-key-display" id="crypt-enc-key-display">' +
                    '<div class="crypt-field">' +
                        '<label>' + I18n.t('crypt.customKey') + '</label>' +
                        '<div class="crypt-input-row">' +
                            '<input type="text" id="crypt-enc-key-value" placeholder="' + Utils.escapeHtml(I18n.t('crypt.enterKeyPlaceholder')) + '" value="' + generatedKey + '">' +
                            '<button class="crypt-btn-small" id="crypt-enc-generate" type="button" title="' + Utils.escapeHtml(I18n.t('crypt.generate')) + '">' + I18n.t('crypt.generate') + '</button>' +
                        '</div>' +
                        '<span class="crypt-key-error" id="crypt-enc-key-error"></span>' +
                    '</div>' +
                '</div>' +
                '<div class="crypt-field">' +
                    '<label class="crypt-radio">' +
                        '<input type="checkbox" id="crypt-enc-compress-json" checked>' +
                        '<span>' + I18n.t('crypt.compressJson') + '</span>' +
                    '</label>' +
                '</div>' +
                '<div class="crypt-field">' +
                    '<label class="crypt-radio">' +
                        '<input type="checkbox" id="crypt-enc-create-copy">' +
                        '<span>' + I18n.t('crypt.createCopy') + '</span>' +
                    '</label>' +
                '</div>' +
                '<div class="crypt-field">' +
                    '<label>' + I18n.t('crypt.progress') + '</label>' +
                    '<div class="crypt-progress-bar"><div class="crypt-progress-fill" id="crypt-enc-progress"></div></div>' +
                    '<div class="crypt-status" id="crypt-enc-status">' + Utils.escapeHtml(I18n.format('crypt.readyEncrypt', { name: tab.project.name })) + '</div>' +
                '</div>';

            var footerHtml =
                '<button class="crypt-btn" id="crypt-enc-cancel" type="button">' + I18n.t('crypt.cancel') + '</button>' +
                '<button class="crypt-btn crypt-btn-primary" id="crypt-enc-go" type="button">' + I18n.t('crypt.encrypt') + '</button>';

            var dlg = this.modal.custom(I18n.t('crypt.encrypt.title'), bodyHtml, footerHtml);

            var radioOfficial = dlg.body.querySelector('input[value="official"]');
            var radioCustom = dlg.body.querySelector('input[value="custom"]');
            var keyDisplay = dlg.body.querySelector('#crypt-enc-key-display');
            var keyValue = dlg.body.querySelector('#crypt-enc-key-value');
            var progressFill = dlg.body.querySelector('#crypt-enc-progress');
            var statusEl = dlg.body.querySelector('#crypt-enc-status');
            var compressJsonInput = dlg.body.querySelector('#crypt-enc-compress-json');
            var createCopyInput = dlg.body.querySelector('#crypt-enc-create-copy');
            var goBtn = dlg.footer.querySelector('#crypt-enc-go');
            var cancelBtn = dlg.footer.querySelector('#crypt-enc-cancel');

            var keyError = dlg.body.querySelector('#crypt-enc-key-error');
            var generateBtn = dlg.body.querySelector('#crypt-enc-generate');
            
            // Validate key function
            function validateKey(key) {
                if (!key || key.length === 0) {
                    return I18n.t('crypt.keyRequired');
                }
                if (!/^[0-9a-zA-Z]{32}$/.test(key)) {
                    return I18n.t('crypt.keyInvalid');
                }
                return null;
            }
            
            // Show/hide error
            function showKeyError(msg) {
                if (msg) {
                    keyValue.style.borderColor = 'var(--error)';
                    keyError.textContent = msg;
                    keyError.style.display = 'block';
                } else {
                    keyValue.style.borderColor = '';
                    keyError.textContent = '';
                    keyError.style.display = 'none';
                }
            }
            
            // Validate on blur
            keyValue.addEventListener('blur', function () {
                showKeyError(validateKey(keyValue.value));
            });
            
            // Generate new key
            generateBtn.addEventListener('click', function () {
                var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
                var buf = new Uint8Array(32);
                (window.crypto || window.globalThis.crypto).getRandomValues(buf);
                var newKey = '';
                for (var i = 0; i < 32; i++) {
                    newKey += chars[buf[i] % chars.length];
                }
                keyValue.value = newKey;
                showKeyError(null);
            });
            
            radioCustom.addEventListener('change', function () {
                keyDisplay.classList.add('visible');
            });
            radioOfficial.addEventListener('change', function () {
                keyDisplay.classList.remove('visible');
            });

            cancelBtn.addEventListener('click', function () { dlg.close(); });

            goBtn.addEventListener('click', async function () {
                var keyType = radioOfficial.checked ? 'official' : 'custom';
                var customKey = keyValue.value.trim();
                
                // Validate custom key
                if (keyType === 'custom') {
                    var validationError = validateKey(customKey);
                    if (validationError) {
                        showKeyError(validationError);
                        return;
                    }
                }

                goBtn.disabled = true;
                statusEl.className = 'crypt-status';
                statusEl.textContent = I18n.t('crypt.encrypting');

                try {
                    // Re-export project first to get latest zip
                    var exportBlob = await tab.project.exportBlob();
                    var zip = await JSZip.loadAsync(exportBlob);

                    var crypt = new CryptManager();
                    crypt.setOnProgress(function (current, total, fileName) {
                        var pct = total > 0 ? Math.round((current / total) * 100) : 0;
                        progressFill.style.width = pct + '%';
                        if (current < total) {
                            statusEl.textContent = I18n.format('crypt.progressFile', { action: I18n.t('crypt.encrypting'), file: fileName, current: current, total: total });
                        }
                    });

                    var result = await crypt.encrypt(zip, keyType, customKey, {
                        compressJson: !!(compressJsonInput && compressJsonInput.checked)
                    });
                    progressFill.style.width = '100%';

                    // Show the content key for both official and custom (needed for decryption)
                    var displayKey = result.key;
                    if (keyType === 'official') {
                        statusEl.className = 'crypt-status crypt-success';
                        statusEl.textContent = I18n.format('crypt.successOfficial', { key: displayKey });
                        self.logger.success('Encrypted. Content Key: ' + displayKey);
                    } else {
                        statusEl.className = 'crypt-status crypt-success';
                        statusEl.textContent = I18n.format('crypt.successCustom', { key: displayKey });
                        self.logger.success('Pack encrypted. Key: ' + displayKey);
                    }

                    // Load encrypted project back to workspace (overwrite or copy based on user choice)
                    var url = URL.createObjectURL(result.blob);
                    var baseName = (tab && tab.project && (tab.project.fileName || tab.project.name)) || 'skinpack';
                    var outName = baseName.replace(/\.(mcpack|mcaddon|zip|encrypted\.mcpack|decrypted\.mcpack)$/i, '') + '.encrypted.mcpack';
                    
                    // Load project - need to convert blob to JSZip first, then parse() will detect encrypted state
                    var zip = await JSZip.loadAsync(result.blob);
                    var project = new Project(outName, zip);
                    await project.parse();
                    
                    // Now replace or copy project
                    var doCopy = createCopyInput && createCopyInput.checked;
                    if (doCopy) {
                        self.tabManager.create(project.name, project);
                        self.logger.log('Created copy project: ' + project.name);
                    } else {
                        tab.project.cleanup();
                        self.tabManager.replaceProject(tab.id, project.name, project);
                        self._resetTabHistory(tab.id);
                        if (self.tabManager.getActive() && self.tabManager.getActive().id === tab.id) {
                            self._onTabChanged(tab.id, project);
                        }
                        self.logger.log('Replaced current project with encrypted: ' + project.name);
                    }
                    
                    // Clean up
                    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

                    // Auto-close after a delay
                    setTimeout(function () { dlg.close(); }, 2000);
                } catch (err) {
                    statusEl.className = 'crypt-status crypt-error';
                    statusEl.textContent = I18n.format('crypt.errorPrefix', { message: err.message });
                    self.logger.error('Encryption failed: ' + err.message);
                    console.error(err);
                    goBtn.disabled = false;
                }
            });
        }

        _openDecryptDialog() {
            var tab = this.tabManager.getActive();
            var self = this;

            var bodyHtml =
                '<div class="crypt-field">' +
                    '<label>' + I18n.t('crypt.key') + '</label>' +
                    '<div class="crypt-radio-group">' +
                        '<label class="crypt-radio">' +
                            '<input type="radio" name="crypt-dec-key" value="official" checked>' +
                            '<span>' + I18n.t('crypt.official') + '</span>' +
                        '</label>' +
                        '<label class="crypt-radio">' +
                            '<input type="radio" name="crypt-dec-key" value="custom">' +
                            '<span>' + I18n.t('crypt.custom') + '</span>' +
                        '</label>' +
                    '</div>' +
                '</div>' +
                '<div class="crypt-key-display" id="crypt-dec-key-input">' +
                    '<div class="crypt-field">' +
                        '<label>' + I18n.t('crypt.enterKey') + '</label>' +
                        '<input type="text" id="crypt-dec-key-value" placeholder="' + Utils.escapeHtml(I18n.t('crypt.enterKeyPlaceholder')) + '">' +
                        '<span class="crypt-hint">' + Utils.escapeHtml(I18n.t('crypt.enterKeyHint')) + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="crypt-field">' +
                    '<label class="crypt-radio">' +
                        '<input type="checkbox" id="crypt-dec-format-json" checked>' +
                        '<span>' + I18n.t('crypt.formatJson') + '</span>' +
                    '</label>' +
                '</div>' +
                '<div class="crypt-field">' +
                    '<label class="crypt-radio">' +
                        '<input type="checkbox" id="crypt-dec-create-copy">' +
                        '<span>' + I18n.t('crypt.createCopy') + '</span>' +
                    '</label>' +
                '</div>' +
                '<div class="crypt-field">' +
                    '<label>' + I18n.t('crypt.progress') + '</label>' +
                    '<div class="crypt-progress-bar"><div class="crypt-progress-fill" id="crypt-dec-progress"></div></div>' +
                    '<div class="crypt-status" id="crypt-dec-status">' +
                        (tab ? I18n.format('crypt.readyDecrypt', { name: tab.project.name }) : I18n.t('crypt.noActiveProject')) +
                    '</div>' +
                '</div>';

            var footerHtml =
                '<button class="crypt-btn" id="crypt-dec-cancel" type="button">' + I18n.t('crypt.cancel') + '</button>' +
                '<button class="crypt-btn crypt-btn-primary" id="crypt-dec-go" type="button">' + I18n.t('crypt.decrypt') + '</button>';

            var dlg = this.modal.custom(I18n.t('crypt.decrypt.title'), bodyHtml, footerHtml);

            var radioOfficial = dlg.body.querySelector('input[value="official"]');
            var radioCustom = dlg.body.querySelector('input[value="custom"]');
            var keyInputWrap = dlg.body.querySelector('#crypt-dec-key-input');
            var keyInput = dlg.body.querySelector('#crypt-dec-key-value');
            var formatJsonInput = dlg.body.querySelector('#crypt-dec-format-json');
            var createCopyInput = dlg.body.querySelector('#crypt-dec-create-copy');
            var progressFill = dlg.body.querySelector('#crypt-dec-progress');
            var statusEl = dlg.body.querySelector('#crypt-dec-status');
            var goBtn = dlg.footer.querySelector('#crypt-dec-go');
            var cancelBtn = dlg.footer.querySelector('#crypt-dec-cancel');

            radioCustom.addEventListener('change', function () {
                keyInputWrap.classList.add('visible');
            });
            radioOfficial.addEventListener('change', function () {
                keyInputWrap.classList.remove('visible');
            });

            cancelBtn.addEventListener('click', function () { dlg.close(); });

            goBtn.addEventListener('click', async function () {
                var keyType = radioOfficial.checked ? 'official' : 'custom';
                var keyString;

                if (keyType === 'official') {
                    keyString = 's5s5ejuDru4uchuF2drUFuthaspAbepE';
                } else {
                    keyString = keyInput.value.trim();
                    if (!keyString) {
                        statusEl.className = 'crypt-status crypt-error';
                        statusEl.textContent = I18n.t('crypt.keyPrompt');
                        return;
                    }
                    if (!/^[0-9a-zA-Z]{32}$/.test(keyString)) {
                        statusEl.className = 'crypt-status crypt-error';
                        statusEl.textContent = I18n.t('crypt.keyInvalid');
                        return;
                    }
                }

                if (!tab || !tab.project) {
                    statusEl.className = 'crypt-status crypt-error';
                    statusEl.textContent = I18n.t('crypt.noActiveProject');
                    return;
                }

                var fileToDecrypt;
                try {
                    fileToDecrypt = await tab.project.exportBlob();
                } catch (e) {
                    statusEl.className = 'crypt-status crypt-error';
                    statusEl.textContent = I18n.t('crypt.readProjectFailed');
                    goBtn.disabled = false;
                    return;
                }

                goBtn.disabled = true;
                statusEl.className = 'crypt-status';
                statusEl.textContent = I18n.t('crypt.decrypting');

                try {
                    var crypt = new CryptManager();
                    crypt.setOnProgress(function (current, total, fileName) {
                        var pct = total > 0 ? Math.round((current / total) * 100) : 0;
                        progressFill.style.width = pct + '%';
                        if (current < total) {
                            statusEl.textContent = I18n.format('crypt.progressFile', { action: I18n.t('crypt.decrypting'), file: fileName, current: current, total: total });
                        }
                    });

                    var result = await crypt.decrypt(fileToDecrypt, keyString, {
                        formatJson: !!(formatJsonInput && formatJsonInput.checked)
                    });
                    progressFill.style.width = '100%';

                    statusEl.className = 'crypt-status crypt-success';
                    statusEl.textContent = I18n.t('crypt.successDecrypt');
                    self.logger.success('Pack decrypted successfully.');

                    // Apply result to workspace (overwrite current tab or create a copy)
                    await self._applyCryptResultToWorkspace(
                        result.blob,
                        'decrypted',
                        !!(createCopyInput && createCopyInput.checked),
                        tab
                    );

                    setTimeout(function () { dlg.close(); }, 2000);
                } catch (err) {
                    statusEl.className = 'crypt-status crypt-error';
                    statusEl.textContent = I18n.format('crypt.errorPrefix', { message: err.message });
                    self.logger.error('Decryption failed: ' + err.message);
                    console.error(err);
                    goBtn.disabled = false;
                }
            });
        }

        async _applyCryptResultToWorkspace(blob, mode, createCopy, sourceTab) {
            var zip = await JSZip.loadAsync(blob);
            var baseName = (sourceTab && sourceTab.project && (sourceTab.project.fileName || sourceTab.project.name)) || 'skinpack';
            var nextName = baseName.replace(/\.(mcpack|mcaddon|zip|encrypted\.mcpack|decrypted\.mcpack)$/i, '') + '.' + mode + '.mcpack';

            var project;
            try {
                project = await Project.fromZip(zip, nextName);
                // Force plain state after successful decrypt and clear any caches
                if (mode === 'decrypted') {
                    project.encryptionState = 'plain';
                    project._hasEncryptedFilesCache = false;
                    project._hasContentsJsonCache = null;
                    project._encryptionCheckCache.clear();
                    this.logger.log('Decrypted project parsed: ' + project.skins.length + ' skins');
                }
            } catch (err) {
                this.logger.warn('Result pack could not be parsed as a normal skin pack. Exporting download instead.');
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = nextName;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
                return;
            }

            if (!sourceTab) {
                this.tabManager.create(project.name, project);
                return;
            }

            if (createCopy) {
                this.tabManager.create(project.name, project);
                this.logger.log('Created copy project: ' + project.name);
            } else {
                sourceTab.project.cleanup();
                this.tabManager.replaceProject(sourceTab.id, project.name, project);
                this._resetTabHistory(sourceTab.id);
                if (this.tabManager.getActive() && this.tabManager.getActive().id === sourceTab.id) {
                    this._onTabChanged(sourceTab.id, project);
                }
                this.logger.log('Replaced current project with ' + mode + ' result: ' + project.name);
            }
        }
    }

    window.SkinApex.App = App;
})();
