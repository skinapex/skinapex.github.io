/* ============================================================
   SkinApex - BoneEditor
   Bone property editor panel for skeleton editing.
   Displays and edits bone pivot, rotation, parent, and supports
   add/delete operations. Changes update the 3D model in real-time.
   ============================================================ */

(function () {
    'use strict';

    const Utils = SkinApex.Utils;
    const I18n = SkinApex.I18n;

    class BoneEditor {
        constructor() {
            this.el = document.getElementById('bone-editor-panel');
            this._onBoneChange = null;
            this._onBoneAdd = null;
            this._onBoneDelete = null;
            this._onBoneDeleteTree = null;
            this._onApplyRotationToCubes = null;
            this._onBoneRename = null;
            this._onBack = null;
            this._currentBoneName = null;
            this._currentGeoId = null;
            this._geoData = null;
            this._allBoneNames = [];
            this._inputElements = {};
        }

        /**
         * Set callback for bone property changes: fn(boneName, property, value, geoId, geoData)
         */
        setOnBoneChange(fn) {
            this._onBoneChange = fn;
        }

        /**
         * Set callback for bone add: fn(boneName, geoId, geoData)
         */
        setOnBoneAdd(fn) {
            this._onBoneAdd = fn;
        }

        /**
         * Set callback for bone delete: fn(boneName, geoId, geoData)
         */
        setOnBoneDelete(fn) {
            this._onBoneDelete = fn;
        }

        setOnBoneDeleteTree(fn) {
            this._onBoneDeleteTree = fn;
        }

        setOnApplyRotationToCubes(fn) {
            this._onApplyRotationToCubes = fn;
        }

        setOnBoneRename(fn) {
            this._onBoneRename = fn;
        }

        /**
         * Set callback for back button: fn()
         */
        setOnBack(fn) {
            this._onBack = fn;
        }

        /**
         * Show the bone editor for a specific bone
         * @param {string} boneName - Selected bone name
         * @param {string} geoId - Geometry identifier
         * @param {Object} geoData - Full geometry data
         * @param {string[]} allBoneNames - List of all bone names (for parent dropdown)
         */
        show(boneName, geoId, geoData, allBoneNames) {
            this._currentBoneName = boneName;
            this._currentGeoId = geoId;
            this._geoData = geoData;
            this._allBoneNames = allBoneNames || [];

            if (!geoData || !boneName) {
                this.hide();
                return;
            }

            // Find the bone data
            var bone = this._findBone(boneName, geoData);
            if (!bone) {
                this.hide();
                return;
            }

            this.el.style.display = 'flex';
            this._render(bone);
        }

        /**
         * Hide the bone editor
         */
        hide() {
            this.el.style.display = 'none';
            this._currentBoneName = null;
            this._currentGeoId = null;
            this._geoData = null;
            this._inputElements = {};
        }

        /**
         * Check if the editor is currently visible
         */
        isVisible() {
            return this.el.style.display !== 'none';
        }

        /**
         * Refresh the editor (e.g., after external bone changes)
         */
        refresh() {
            if (!this._currentBoneName || !this._geoData) return;
            var bone = this._findBone(this._currentBoneName, this._geoData);
            if (bone) {
                this._render(bone);
            }
        }

        /**
         * Get the currently selected bone name
         */
        getCurrentBoneName() {
            return this._currentBoneName;
        }

        // ---- Private Methods ----

        /**
         * Find a bone in geometry data by name
         */
        _findBone(boneName, geoData) {
            if (!geoData || !geoData.bones) return null;
            for (var i = 0; i < geoData.bones.length; i++) {
                if ((geoData.bones[i].name || ('bone_' + i)) === boneName) {
                    return geoData.bones[i];
                }
            }
            return null;
        }

        /**
         * Render the bone editor UI
         */
        _render(bone) {
            var boneName = bone.name || this._currentBoneName;
            var pivot = bone.pivot || [0, 0, 0];
            var rotation = bone.rotation || [0, 0, 0];
            var parent = bone.parent || '';
            var cubeCount = (bone.cubes || []).length;
            var hasPolyMesh = !!(bone.poly_mesh);

            this._inputElements = {};

            this.el.innerHTML =
                '<div class="be-header">' +
                    '<button class="be-back-btn" title="' + Utils.escapeHtml(I18n.t('outline.back')) + '"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>' +
                    '<span class="be-title">' + Utils.escapeHtml(I18n.t('bone.title')) + '</span>' +
                '</div>' +
                '<div class="be-body">' +
                    // Name
                    '<div class="be-section">' +
                        '<div class="be-label">' + Utils.escapeHtml(I18n.t('bone.name')) + '</div>' +
                        '<input type="text" class="be-name-input" value="' + Utils.escapeHtml(boneName) + '">' +
                    '</div>' +
                    // Info
                    '<div class="be-section be-info-row">' +
                        '<span class="be-info-item">' + cubeCount + ' cube' + (cubeCount !== 1 ? 's' : '') + '</span>' +
                        (hasPolyMesh ? '<span class="be-info-item">' + Utils.escapeHtml(I18n.t('bone.polyMesh')) + '</span>' : '') +
                    '</div>' +
                    // Origin / Pivot
                    '<div class="be-section">' +
                        '<div class="be-label">' + Utils.escapeHtml(I18n.t('bone.origin')) + '</div>' +
                        '<div class="be-help-text">' + Utils.escapeHtml(I18n.t('bone.originHelp')) + '</div>' +
                        '<div class="be-vec3">' +
                            '<div class="be-field"><label>X</label><input type="number" step="0.1" data-prop="pivot.0" value="' + pivot[0] + '"></div>' +
                            '<div class="be-field"><label>Y</label><input type="number" step="0.1" data-prop="pivot.1" value="' + pivot[1] + '"></div>' +
                            '<div class="be-field"><label>Z</label><input type="number" step="0.1" data-prop="pivot.2" value="' + pivot[2] + '"></div>' +
                        '</div>' +
                    '</div>' +
                    // Rotation
                    '<div class="be-section">' +
                        '<div class="be-label">' + Utils.escapeHtml(I18n.t('bone.rotation')) + '</div>' +
                        '<div class="be-vec3">' +
                            '<div class="be-field"><label>X</label><input type="number" step="0.5" data-prop="rotation.0" value="' + rotation[0] + '"></div>' +
                            '<div class="be-field"><label>Y</label><input type="number" step="0.5" data-prop="rotation.1" value="' + rotation[1] + '"></div>' +
                            '<div class="be-field"><label>Z</label><input type="number" step="0.5" data-prop="rotation.2" value="' + rotation[2] + '"></div>' +
                        '</div>' +
                    '</div>' +
                    // Parent
                    '<div class="be-section">' +
                        '<div class="be-label">' + Utils.escapeHtml(I18n.t('bone.parent')) + '</div>' +
                        '<select class="be-parent-select" data-prop="parent">' +
                            '<option value="">' + Utils.escapeHtml(I18n.t('bone.parentNone')) + '</option>' +
                            this._buildParentOptions(boneName) +
                        '</select>' +
                    '</div>' +
                    // Actions
                    '<div class="be-actions">' +
                        '<div class="be-actions-row">' +
                            '<button class="be-btn be-btn-secondary be-btn-apply-rotation" title="' + Utils.escapeHtml(I18n.t('bone.applyRotationToCubes')) + '">' + Utils.escapeHtml(I18n.t('bone.applyRotationToCubes')) + '</button>' +
                            '<button class="be-btn be-btn-add" title="' + Utils.escapeHtml(I18n.t('bone.add')) + '">' + Utils.escapeHtml(I18n.t('bone.add')) + '</button>' +
                        '</div>' +
                        '<div class="be-actions-row be-actions-row-danger">' +
                            '<button class="be-btn be-btn-delete" title="' + Utils.escapeHtml(I18n.t('bone.delete')) + '">' + Utils.escapeHtml(I18n.t('bone.delete')) + '</button>' +
                            '<button class="be-btn be-btn-delete-tree" title="' + Utils.escapeHtml(I18n.t('bone.deleteWithChildren')) + '">' + Utils.escapeHtml(I18n.t('bone.deleteWithChildren')) + '</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            // Wire up input events
            this._wireInputs();
        }

        /**
         * Build <option> elements for parent dropdown (exclude self)
         */
        _buildParentOptions(currentBoneName) {
            var html = '';
            var currentParent = '';
            if (this._geoData) {
                var bone = this._findBone(currentBoneName, this._geoData);
                if (bone) currentParent = bone.parent || '';
            }

            for (var i = 0; i < this._allBoneNames.length; i++) {
                var name = this._allBoneNames[i];
                if (name === currentBoneName) continue; // Don't allow self-parenting
                var selected = (name === currentParent) ? ' selected' : '';
                html += '<option value="' + Utils.escapeHtml(name) + '"' + selected + '>' + Utils.escapeHtml(name) + '</option>';
            }
            return html;
        }

        /**
         * Wire up all input change events
         */
        _wireInputs() {
            var self = this;

            // Back button
            var backBtn = this.el.querySelector('.be-back-btn');
            if (backBtn) {
                backBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (self._onBack) self._onBack();
                });
            }

            // Number inputs (pivot and rotation)
            var inputs = this.el.querySelectorAll('input[type="number"]');
            inputs.forEach(function (input) {
                input.addEventListener('change', function () {
                    var prop = this.dataset.prop;
                    if (!prop) return;
                    var val = parseFloat(this.value) || 0;
                    self._handleVec3Change(prop, val);
                });

                input.addEventListener('input', function () {
                    var prop = this.dataset.prop;
                    if (!prop) return;
                    var val = parseFloat(this.value) || 0;
                    self._handleVec3Change(prop, val);
                });
            });

            // Parent select
            var parentSelect = this.el.querySelector('.be-parent-select');
            if (parentSelect) {
                parentSelect.addEventListener('change', function () {
                    var val = this.value;
                    if (self._onBoneChange && self._currentBoneName) {
                        self._onBoneChange(
                            self._currentBoneName,
                            'parent',
                            val,
                            self._currentGeoId,
                            self._geoData
                        );
                    }
                });
            }

            var nameInput = this.el.querySelector('.be-name-input');
            if (nameInput) {
                nameInput.addEventListener('change', function () {
                    var nextName = (this.value || '').trim();
                    if (!nextName || nextName === self._currentBoneName) {
                        this.value = self._currentBoneName || '';
                        return;
                    }
                    if (self._onBoneRename) {
                        self._onBoneRename(self._currentBoneName, nextName, self._currentGeoId, self._geoData);
                    }
                });
            }

            // Add button
            var addBtn = this.el.querySelector('.be-btn-add');
            if (addBtn) {
                addBtn.addEventListener('click', function () {
                    if (self._onBoneAdd) {
                        self._onBoneAdd(self._currentBoneName, self._currentGeoId, self._geoData);
                    }
                });
            }

            var applyRotationBtn = this.el.querySelector('.be-btn-apply-rotation');
            if (applyRotationBtn) {
                applyRotationBtn.addEventListener('click', function () {
                    if (self._onApplyRotationToCubes && self._currentBoneName) {
                        self._onApplyRotationToCubes(self._currentBoneName, self._currentGeoId, self._geoData);
                    }
                });
            }

            // Delete button
            var deleteBtn = this.el.querySelector('.be-btn-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', function () {
                    if (self._onBoneDelete && self._currentBoneName) {
                        self._onBoneDelete(
                            self._currentBoneName,
                            self._currentGeoId,
                            self._geoData
                        );
                    }
                });
            }

            var deleteTreeBtn = this.el.querySelector('.be-btn-delete-tree');
            if (deleteTreeBtn) {
                deleteTreeBtn.addEventListener('click', function () {
                    if (self._onBoneDeleteTree && self._currentBoneName) {
                        self._onBoneDeleteTree(
                            self._currentBoneName,
                            self._currentGeoId,
                            self._geoData
                        );
                    }
                });
            }

        }

        /**
         * Handle a change to a vector3 property (pivot or rotation)
         * prop format: "pivot.0", "rotation.1", etc.
         */
        _handleVec3Change(prop, value) {
            if (!this._currentBoneName || !this._geoData) return;

            var parts = prop.split('.');
            var property = parts[0]; // "pivot" or "rotation"
            var index = parseInt(parts[1], 10); // 0, 1, or 2

            if (isNaN(index) || index < 0 || index > 2) return;

            var bone = this._findBone(this._currentBoneName, this._geoData);
            if (!bone) return;

            // Prepare next value but DO NOT mutate geoData here.
            // The viewer callbacks (updateBonePivot/updateBoneRotation)
            // need the old value still present in geoData to compute deltas.
            var next = (bone[property] && bone[property].slice)
                ? bone[property].slice()
                : [0, 0, 0];
            next[index] = value;

            // Notify callback with the full array
            if (this._onBoneChange) {
                this._onBoneChange(
                    this._currentBoneName,
                    property,
                    next,
                    this._currentGeoId,
                    this._geoData
                );
            }
        }
    }

    window.SkinApex.BoneEditor = BoneEditor;
})();
