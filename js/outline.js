/* ============================================================
   SkinApex - OutlinePanel
   Hierarchical bone tree with internal drag reparenting.
   Uses pointer events instead of native HTML drag/drop so it
   won't conflict with the workspace file-drop handler.
   ============================================================ */

(function () {
    'use strict';

    const Utils = SkinApex.Utils;
    const Icons = SkinApex.Icons;
    const I18n = SkinApex.I18n;
    const HUMAN_BONE_RULES = {
        root: { label: 'Root', canonicalName: 'root', expectedParent: null, required: true },
        waist: { label: 'Waist', canonicalName: 'waist', expectedParent: 'root', required: false },
        body: { label: 'Body', canonicalName: 'body', expectedParent: 'waist', fallbackParents: ['root'], required: true },
        head: { label: 'Head', canonicalName: 'head', expectedParent: 'body', required: true },
        cape: { label: 'Cape', canonicalName: 'cape', expectedParent: 'body', fallbackParents: ['head'], required: false },
        rightarm: { label: 'Right Arm', canonicalName: 'rightArm', expectedParent: 'body', required: true },
        leftarm: { label: 'Left Arm', canonicalName: 'leftArm', expectedParent: 'body', required: true },
        rightleg: { label: 'Right Leg', canonicalName: 'rightLeg', expectedParent: 'root', required: true },
        leftleg: { label: 'Left Leg', canonicalName: 'leftLeg', expectedParent: 'root', required: true }
    };
    const HUMAN_BONE_ALIASES = {
        root: [/^root$/i, /^mainroot$/i, /^base$/i],
        waist: [/^waist$/i, /^hips?$/i, /^pelvis$/i, /^torso[_-]?base$/i],
        body: [/^body$/i, /^torso$/i, /^chest$/i, /^spine$/i],
        head: [/^head$/i, /^helmet$/i, /^skull$/i],
        cape: [/^cape$/i, /^cloak$/i],
        leftarm: [/^left.+arm$/i, /^arm.+left$/i, /^l(?:eft)?[_-]?arm$/i, /^arm[_-]?l(?:eft)?$/i, /^lefthand$/i, /^hand[_-]?left$/i],
        rightarm: [/^right.+arm$/i, /^arm.+right$/i, /^r(?:ight)?[_-]?arm$/i, /^arm[_-]?r(?:ight)?$/i, /^righthand$/i, /^hand[_-]?right$/i],
        leftleg: [/^left.+leg$/i, /^leg.+left$/i, /^l(?:eft)?[_-]?leg$/i, /^leg[_-]?l(?:eft)?$/i],
        rightleg: [/^right.+leg$/i, /^leg.+right$/i, /^r(?:ight)?[_-]?leg$/i, /^leg[_-]?r(?:ight)?$/i]
    };

    class OutlinePanel {
        constructor() {
            this.el = document.getElementById('outline-panel');
            this.bodyEl = document.getElementById('outline-body');
            this.geoNameEl = document.getElementById('outline-geo-name');

            this._onBoneSelect = null;
            this._onBack = null;
            this._onBoneChangeParent = null;

            this._selectedBone = null;
            this._currentGeoId = null;
            this._currentGeoData = null;
            this._validation = null;
            this._actionsEl = null;
            this._animatedBones = {};
            this._autoScroll = { active: false, speed: 0, pointerY: 0, frame: 0 };
            this._lockedScrollTop = 0;
            this._touchScrollBlocker = null;

            this._dragState = null;

            this._injectBackBtn();
            this._bindPointerDrag();
            this._bindScrollShadow();
            window.addEventListener('resize', () => this._updateBackButtonVisibility());
        }

        setOnBack(fn) {
            this._onBack = fn;
        }

        setOnBoneSelect(fn) {
            this._onBoneSelect = fn;
        }

        setOnBoneChangeParent(fn) {
            this._onBoneChangeParent = fn;
        }

        getSelectedBone() {
            return this._selectedBone;
        }

        getSelectedGeoId() {
            return this._currentGeoId;
        }

        _injectBackBtn() {
            var header = this.el.querySelector('.outline-section-header');
            if (!header) return;
            var btn = document.createElement('button');
            btn.className = 'outline-back-btn';
            btn.title = I18n.t('outline.back');
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._onBack) this._onBack();
            });
            header.insertBefore(btn, header.firstChild);

            this._backBtnEl = btn;
            this._updateBackButtonVisibility();
        }

        _updateBackButtonVisibility() {
            if (!this._backBtnEl) return;
            this._backBtnEl.style.display = window.innerWidth <= 900 ? 'none' : 'inline-flex';
        }

        _bindPointerDrag() {
            this.bodyEl.addEventListener('pointerdown', (e) => {
                var row = e.target.closest('.outline-bone-row');
                if (!row || e.button !== 0) return;

                this._dragState = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    startScrollTop: this.bodyEl.scrollTop,
                    boneName: row.dataset.bone,
                    sourceRow: row,
                    dragging: false,
                    armed: window.innerWidth > 900,
                    holdTimer: null,
                    dropTarget: null,
                    dropMode: null
                };

                if (window.innerWidth <= 900) {
                    this._dragState.holdTimer = setTimeout(() => {
                        if (this._dragState && this._dragState.pointerId === e.pointerId) {
                            this._dragState.armed = true;
                            this.bodyEl.classList.add('outline-drag-armed');
                            document.body.classList.add('outline-global-dragging');
                            this._dragState.sourceRow.classList.add('drag-armed');
                            this.bodyEl.scrollTop = this._dragState.startScrollTop || 0;
                            this._lockScrollDuringDrag();
                            if (this._dragState.sourceRow.setPointerCapture) {
                                this._dragState.sourceRow.setPointerCapture(e.pointerId);
                            }
                        }
                    }, 280);
                }
            });

            this.bodyEl.addEventListener('pointermove', (e) => {
                if (!this._dragState || this._dragState.pointerId !== e.pointerId) return;

                var dx = Math.abs(e.clientX - this._dragState.startX);
                var dy = Math.abs(e.clientY - this._dragState.startY);
                if (!this._dragState.armed) {
                    if (dx + dy > 8 && this._dragState.holdTimer) {
                        clearTimeout(this._dragState.holdTimer);
                        this._dragState.holdTimer = null;
                    }
                    return;
                }
                if (!this._dragState.dragging && dx + dy < 6) return;

                if (!this._dragState.dragging) {
                    this._dragState.dragging = true;
                    this.bodyEl.classList.add('outline-dragging');
                    this._dragState.sourceRow.classList.add('dragging');
                    if (this._dragState.sourceRow.setPointerCapture) {
                        this._dragState.sourceRow.setPointerCapture(e.pointerId);
                    }
                }

                e.preventDefault();
                if (window.innerWidth <= 900) {
                    this._lockedScrollTop = this.bodyEl.scrollTop;
                }

                this._updateAutoScroll(e.clientY);

                var el = document.elementFromPoint(e.clientX, e.clientY);
                var row = el ? el.closest('.outline-bone-row') : null;
                var targetInfo = this._getDropInfo(row, e.clientY);
                this._setDropTarget(targetInfo ? targetInfo.row : null, targetInfo ? targetInfo.mode : null);
            });

            var finishDrag = (e) => {
                if (!this._dragState || this._dragState.pointerId !== e.pointerId) return;

                var state = this._dragState;
                var dropTarget = state.dropTarget;
                var dropMode = state.dropMode;
                var sourceRow = state.sourceRow;
                this._stopAutoScroll();
                this._clearDragState();

                if (sourceRow && sourceRow.releasePointerCapture && sourceRow.hasPointerCapture && sourceRow.hasPointerCapture(e.pointerId)) {
                    sourceRow.releasePointerCapture(e.pointerId);
                }

                if (!state.dragging || !dropTarget || !dropMode) return;

                var boneName = state.boneName;
                var targetBone = dropTarget.dataset.bone;
                if (!boneName || !targetBone || boneName === targetBone) return;
                if (dropMode === 'inside' && this._isDescendant(targetBone, boneName)) return;

                if (this._onBoneChangeParent) {
                    this._onBoneChangeParent({
                        boneName: boneName,
                        targetBone: targetBone,
                        mode: dropMode,
                        geoId: this._currentGeoId,
                        geoData: this._currentGeoData
                    });
                }
            };

            this.bodyEl.addEventListener('pointerup', finishDrag);
            this.bodyEl.addEventListener('pointercancel', finishDrag);
            this.bodyEl.addEventListener('lostpointercapture', finishDrag);
        }

        _clearDragState() {
            if (this._dragState && this._dragState.sourceRow) {
                this._dragState.sourceRow.classList.remove('dragging');
                this._dragState.sourceRow.classList.remove('drag-armed');
            }
            if (this._dragState && this._dragState.holdTimer) {
                clearTimeout(this._dragState.holdTimer);
            }
            this.bodyEl.classList.remove('outline-dragging');
            this.bodyEl.classList.remove('outline-drag-armed');
            document.body.classList.remove('outline-global-dragging');
            this._stopAutoScroll();
            this._unlockScrollDuringDrag();
            this.bodyEl.querySelectorAll('.outline-bone-row.drop-target, .outline-bone-row.drop-before, .outline-bone-row.drop-after').forEach(function (el) {
                el.classList.remove('drop-target', 'drop-before', 'drop-after');
            });
            this._dragState = null;
        }

        _lockScrollDuringDrag() {
            if (window.innerWidth > 900) return;
            this._lockedScrollTop = this.bodyEl.scrollTop;
            this.bodyEl.style.overflowY = 'hidden';
            this.bodyEl.style.touchAction = 'none';
            if (!this._touchScrollBlocker) {
                this._touchScrollBlocker = (e) => {
                    if (!this._dragState || (!this._dragState.armed && !this._dragState.dragging)) return;
                    e.preventDefault();
                    this.bodyEl.scrollTop = this._lockedScrollTop;
                };
                this.bodyEl.addEventListener('touchmove', this._touchScrollBlocker, { passive: false });
            }
        }

        _unlockScrollDuringDrag() {
            this.bodyEl.style.overflowY = '';
            this.bodyEl.style.touchAction = '';
            if (this._touchScrollBlocker) {
                this.bodyEl.removeEventListener('touchmove', this._touchScrollBlocker);
                this._touchScrollBlocker = null;
            }
        }

        _updateAutoScroll(clientY) {
            if (!this._dragState || !this._dragState.dragging) {
                this._stopAutoScroll();
                return;
            }

            var rect = this.bodyEl.getBoundingClientRect();
            var threshold = 36;
            var stickyInsetBottom = 0;
            if (this._actionsEl) {
                var actionsRect = this._actionsEl.getBoundingClientRect();
                if (actionsRect.height > 0) {
                    stickyInsetBottom = actionsRect.height;
                }
            }
            var effectiveBottom = rect.bottom - stickyInsetBottom;
            var speed = 0;
            if (clientY < rect.top + threshold) {
                speed = -Math.ceil(((rect.top + threshold) - clientY) / 6);
            } else if (clientY > effectiveBottom - threshold) {
                speed = Math.ceil((clientY - (effectiveBottom - threshold)) / 6);
            }

            if (!speed) {
                this._stopAutoScroll();
                return;
            }

            this._autoScroll.active = true;
            this._autoScroll.speed = speed;
            this._autoScroll.pointerY = clientY;
            if (!this._autoScroll.frame) {
                this._runAutoScroll();
            }
        }

        _runAutoScroll() {
            if (!this._autoScroll.active) {
                this._autoScroll.frame = 0;
                return;
            }

            var maxScroll = this.bodyEl.scrollHeight - this.bodyEl.clientHeight;
            var next = Math.max(0, Math.min(maxScroll, this.bodyEl.scrollTop + this._autoScroll.speed));
            this.bodyEl.scrollTop = next;
            this._lockedScrollTop = next;

            var el = document.elementFromPoint(this.bodyEl.getBoundingClientRect().left + 24, this._autoScroll.pointerY);
            var row = el ? el.closest('.outline-bone-row') : null;
            var targetInfo = this._getDropInfo(row, this._autoScroll.pointerY);
            this._setDropTarget(targetInfo ? targetInfo.row : null, targetInfo ? targetInfo.mode : null);

            this._autoScroll.frame = requestAnimationFrame(() => this._runAutoScroll());
        }

        _stopAutoScroll() {
            this._autoScroll.active = false;
            this._autoScroll.speed = 0;
            if (this._autoScroll.frame) {
                cancelAnimationFrame(this._autoScroll.frame);
                this._autoScroll.frame = 0;
            }
        }

        _setDropTarget(row, mode) {
            if (this._dragState && this._dragState.dropTarget === row && this._dragState.dropMode === mode) return;

            this.bodyEl.querySelectorAll('.outline-bone-row.drop-target, .outline-bone-row.drop-before, .outline-bone-row.drop-after').forEach(function (el) {
                el.classList.remove('drop-target', 'drop-before', 'drop-after');
            });

            if (this._dragState) {
                this._dragState.dropTarget = row;
                this._dragState.dropMode = mode;
            }

            if (!row || !mode) return;
            if (mode === 'inside') row.classList.add('drop-target');
            if (mode === 'before') row.classList.add('drop-before');
            if (mode === 'after') row.classList.add('drop-after');
        }

        _getDropInfo(row, clientY) {
            if (!row || !this._dragState) return null;
            var targetBone = row.dataset.bone;
            if (!targetBone || targetBone === this._dragState.boneName) return null;

            var target = this._findBone(targetBone, this._currentGeoData);
            if (!target) return null;

            var rect = row.getBoundingClientRect();
            var ratio = (clientY - rect.top) / Math.max(rect.height, 1);
            var mode = null;
            if (ratio >= 0.33 && ratio <= 0.66) {
                if (this._isDescendant(targetBone, this._dragState.boneName)) return null;
                mode = 'inside';
            } else if (ratio < 0.33) {
                if (target.parent === this._dragState.boneName) return null;
                mode = 'before';
            } else {
                if (target.parent === this._dragState.boneName) return null;
                mode = 'after';
            }

            return { row: row, mode: mode };
        }

        _findBone(boneName, geoData) {
            if (!geoData || !geoData.bones) return null;
            for (var i = 0; i < geoData.bones.length; i++) {
                if ((geoData.bones[i].name || ('bone_' + i)) === boneName) {
                    return geoData.bones[i];
                }
            }
            return null;
        }

        _isDescendant(targetBone, ancestorBone) {
            if (!this._currentGeoData || !this._currentGeoData.bones) return false;
            var visited = new Set();
            var current = targetBone;
            while (current) {
                if (current === ancestorBone) return true;
                if (visited.has(current)) break;
                visited.add(current);
                var bone = this._findBone(current, this._currentGeoData);
                current = bone ? bone.parent : null;
            }
            return false;
        }

        render(geoId, geoData) {
            var previousSelection = this._selectedBone;
            this._currentGeoId = geoId;
            this._currentGeoData = geoData;
            this._validation = this._analyzeBoneHierarchy(geoData);
            this._updateBackButtonVisibility();
            this._clearDragState();
            this.bodyEl.innerHTML = '';

            if (!geoId || !geoData) {
                this.el.style.display = 'none';
                return;
            }

            this.el.style.display = 'flex';

            var shortName = geoId;
            if (shortName.indexOf('geometry.') === 0) {
                shortName = shortName.substring('geometry.'.length);
            }
            this.geoNameEl.textContent = shortName;

            if (!geoData.bones || geoData.bones.length === 0) {
                this.bodyEl.innerHTML = '<div class="panel-empty">' + Utils.escapeHtml(I18n.t('outline.empty')) + '</div>';
                this._addActionButtons();
                this._updateActionShadow();
                return;
            }

            this._appendValidationSummary();

            var childrenMap = {};
            var roots = [];

            for (var i = 0; i < geoData.bones.length; i++) {
                var bone = geoData.bones[i];
                var boneName = bone.name || ('bone_' + i);
                if (bone.parent) {
                    if (!childrenMap[bone.parent]) childrenMap[bone.parent] = [];
                    childrenMap[bone.parent].push({ bone: bone, name: boneName });
                } else {
                    roots.push({ bone: bone, name: boneName });
                }
            }

            for (var r = 0; r < roots.length; r++) {
                this._appendBoneNode(roots[r], 0, childrenMap, geoId);
            }

            this._addActionButtons();
            this._updateActionShadow();

            if (previousSelection) {
                this.selectBone(previousSelection, geoId);
            }
        }

        setAnimatedBones(animatedBones) {
            this._animatedBones = animatedBones || {};
            if (this._currentGeoId && this._currentGeoData) {
                this.render(this._currentGeoId, this._currentGeoData);
            }
        }

        _appendBoneNode(boneEntry, depth, childrenMap, geoId) {
            var boneName = boneEntry.name;
            var normalizedName = this._normalizeBoneName(boneName);
            var matchedRuleName = this._matchHumanBoneRuleName(boneName);
            var rule = matchedRuleName ? HUMAN_BONE_RULES[matchedRuleName] : null;
            var isSpecialBone = !!rule;
            var issue = this._validation && this._validation.issuesByBone ? this._validation.issuesByBone[boneName] : null;
            var warning = this._validation && this._validation.warningsByBone ? this._validation.warningsByBone[boneName] : null;
            var annotation = this._validation && this._validation.annotationsByBone ? this._validation.annotationsByBone[boneName] : '';
            var animationEntries = this._animatedBones[boneName] || null;
            var hasAnimation = !!(animationEntries && animationEntries.length);
            var animationLabel = hasAnimation
                ? animationEntries.map(function (entry) {
                    var shortId = String(entry.id || '').replace(/^animation\./, '');
                    return (entry.slot || shortId) + (shortId ? ' > ' + shortId : '');
                }).join(', ')
                : '';
            var row = document.createElement('div');
            row.className = 'outline-bone-row' +
                (boneName === this._selectedBone && geoId === this._currentGeoId ? ' selected' : '') +
                (isSpecialBone ? ' is-special-bone' : '') +
                (hasAnimation ? ' has-animation' : '') +
                (warning ? ' has-warning' : '') +
                (issue ? ' has-issue' : '');
            row.dataset.bone = boneName;
            row.style.setProperty('--outline-depth', String(depth));
            row.innerHTML =
                '<span class="outline-tree-indent"></span>' +
                '<span class="outline-icon">' + Icons.bone + '</span>' +
                '<span class="outline-bone-name">' + Utils.escapeHtml(boneName) + '</span>' +
                (hasAnimation ? '<span class="outline-bone-animation" title="' + Utils.escapeHtml(animationLabel) + '">' + Utils.escapeHtml(animationLabel) + '</span>' : '') +
                (isSpecialBone ? '<span class="outline-bone-badge" title="' + Utils.escapeHtml(I18n.t('outline.badge.special')) + '">' + Utils.escapeHtml(rule.label) + '</span>' : '') +
                (annotation ? '<span class="outline-bone-note" title="' + Utils.escapeHtml(annotation) + '">' + Utils.escapeHtml(annotation) + '</span>' : '') +
                (warning ? '<span class="outline-bone-warning" title="' + Utils.escapeHtml(warning) + '">' + Utils.escapeHtml(I18n.t('outline.badge.warning')) + '</span>' : '') +
                (issue ? '<span class="outline-bone-issue" title="' + Utils.escapeHtml(issue) + '">' + Utils.escapeHtml(I18n.t('outline.badge.issue')) + '</span>' : '');

            row.addEventListener('click', (e) => {
                if (this._dragState && this._dragState.dragging) return;
                e.stopPropagation();
                this.selectBone(boneName, geoId);
                if (this._onBoneSelect) {
                    this._onBoneSelect(boneName, geoId);
                }
            });

            this.bodyEl.appendChild(row);

            var children = childrenMap[boneName] || [];
            for (var i = 0; i < children.length; i++) {
                this._appendBoneNode(children[i], depth + 1, childrenMap, geoId);
            }
        }

        _analyzeBoneHierarchy(geoData) {
            var result = {
                issuesByBone: {},
                warningsByBone: {},
                annotationsByBone: {},
                missingBones: [],
                issueMessages: [],
                warningMessages: []
            };
            if (!geoData || !geoData.bones || !geoData.bones.length) return result;

            var boneMap = {};
            for (var i = 0; i < geoData.bones.length; i++) {
                var bone = geoData.bones[i];
                var boneName = bone.name || ('bone_' + i);
                var matchedRuleName = this._matchHumanBoneRuleName(boneName);
                if (!matchedRuleName) continue;
                boneMap[matchedRuleName] = {
                    actualName: boneName,
                    parent: bone.parent || ''
                };
            }

            var ruleNames = Object.keys(HUMAN_BONE_RULES);
            for (var j = 0; j < ruleNames.length; j++) {
                var normalizedName = ruleNames[j];
                var rule = HUMAN_BONE_RULES[normalizedName];
                var existing = boneMap[normalizedName];
                if (!existing) {
                    if (rule.required) {
                        result.missingBones.push(rule.label);
                        result.issueMessages.push(I18n.format('outline.error.missingBone', { name: rule.label }));
                    }
                    continue;
                }

                var canonicalName = rule.canonicalName || existing.actualName;
                if (existing.actualName !== canonicalName) {
                    var canonicalPresent = boneMap[this._normalizeBoneName(canonicalName)] && boneMap[this._normalizeBoneName(canonicalName)].actualName === canonicalName;
                    if (canonicalPresent) {
                        result.warningsByBone[existing.actualName] = I18n.format('outline.error.namingDuplicate', { actual: existing.actualName, expected: canonicalName });
                        result.warningMessages.push(result.warningsByBone[existing.actualName]);
                    } else {
                        result.issuesByBone[existing.actualName] = I18n.format('outline.error.renameCamel', { actual: existing.actualName, expected: canonicalName });
                        result.issueMessages.push(result.issuesByBone[existing.actualName]);
                    }
                }

                var actualParent = this._normalizeBoneName(existing.parent);
                var expectedParent = rule.expectedParent;
                if (normalizedName === 'cape') {
                    if (actualParent === 'head') {
                        result.annotationsByBone[existing.actualName] = 'Hair';
                    } else if (actualParent === 'body') {
                        result.annotationsByBone[existing.actualName] = 'Cape';
                    }
                }
                if (expectedParent === null) {
                    if (actualParent) {
                        result.issuesByBone[existing.actualName] = I18n.format('outline.error.topLevel', { name: existing.actualName, parent: existing.parent });
                        result.issueMessages.push(result.issuesByBone[existing.actualName]);
                    }
                    continue;
                }

                var allowedParents = [expectedParent].concat(rule.fallbackParents || []);
                if (allowedParents.indexOf(actualParent) !== -1) {
                    continue;
                }

                if (!boneMap[expectedParent]) {
                    result.issuesByBone[existing.actualName] = I18n.format('outline.error.expectedUnderMissing', { name: existing.actualName, expected: expectedParent });
                    result.issueMessages.push(result.issuesByBone[existing.actualName]);
                    continue;
                }

                result.issuesByBone[existing.actualName] = I18n.format('outline.error.expectedUnderParent', { name: existing.actualName, expected: boneMap[expectedParent].actualName, parent: (existing.parent || I18n.t('bone.parentNone')) });
                result.issueMessages.push(result.issuesByBone[existing.actualName]);
            }

            return result;
        }

        _appendValidationSummary() {
            if (!this._validation) return;

            var issueCount = this._validation.issueMessages ? this._validation.issueMessages.length : 0;
            var warningCount = this._validation.warningMessages ? this._validation.warningMessages.length : 0;
            var summary = document.createElement('div');
            summary.className = 'outline-validation-summary' + (issueCount ? ' has-issues' : (warningCount ? ' has-warnings' : ' is-valid'));

            var details = '';
            if (issueCount) {
                details = this._validation.issueMessages.map(function (message) {
                    return '<div class="outline-validation-line">' + Utils.escapeHtml(message) + '</div>';
                }).join('');
            } else if (warningCount) {
                details = this._validation.warningMessages.map(function (message) {
                    return '<div class="outline-validation-line">' + Utils.escapeHtml(message) + '</div>';
                }).join('');
            } else {
                details = '<div class="outline-validation-line">' + Utils.escapeHtml(I18n.t('outline.validation.pass')) + '</div>';
            }

            summary.innerHTML =
                '<div class="outline-validation-title">' + Utils.escapeHtml(issueCount ? I18n.format('outline.validation.issues', { count: issueCount }) : (warningCount ? I18n.format('outline.validation.warnings', { count: warningCount }) : I18n.t('outline.validation.ok'))) + '</div>' +
                details;

            this.bodyEl.appendChild(summary);
        }

        _bindScrollShadow() {
            this.bodyEl.addEventListener('scroll', () => {
                this._updateActionShadow();
            });
        }

        _updateActionShadow() {
            if (!this._actionsEl) return;
            var maxScroll = this.bodyEl.scrollHeight - this.bodyEl.clientHeight;
            var atBottom = maxScroll <= 1 || this.bodyEl.scrollTop >= maxScroll - 1;
            this._actionsEl.classList.toggle('has-shadow', !atBottom);
        }

        _normalizeBoneName(name) {
            return String(name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        }

        _matchHumanBoneRuleName(name) {
            var normalized = this._normalizeBoneName(name);
            if (HUMAN_BONE_RULES[normalized]) return normalized;

            var ruleNames = Object.keys(HUMAN_BONE_ALIASES);
            for (var i = 0; i < ruleNames.length; i++) {
                var ruleName = ruleNames[i];
                var patterns = HUMAN_BONE_ALIASES[ruleName] || [];
                for (var p = 0; p < patterns.length; p++) {
                    if (patterns[p].test(String(name || ''))) {
                        return ruleName;
                    }
                }
            }

            return '';
        }

        _addActionButtons() {
            var container = document.createElement('div');
            container.className = 'outline-actions';
            container.innerHTML =
                '<button class="outline-action-btn" data-action="auto-fix-human" title="' + Utils.escapeHtml(I18n.t('outline.badge.fix')) + '">' +
                '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4v4H9"/><path d="M3 12V8h4"/><path d="M4.2 6.2A4.5 4.5 0 0 1 12 4"/><path d="M11.8 9.8A4.5 4.5 0 0 1 4 12"/></svg>' +
                '<span>' + Utils.escapeHtml(I18n.t('outline.badge.fix')) + '</span></button>' +
                '<button class="outline-action-btn" data-action="add-group" title="' + Utils.escapeHtml(I18n.t('outline.badge.addGroup')) + '">' +
                '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v10M3 8h10"/></svg>' +
                '<span>' + Utils.escapeHtml(I18n.t('outline.badge.addGroup')) + '</span></button>' +
                '<button class="outline-action-btn" data-action="add-bone" title="' + Utils.escapeHtml(I18n.t('outline.badge.addBone')) + '">' +
                '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="5" cy="3" r="2"/><circle cx="11" cy="13" r="2"/><path d="M5 5v4l2 1v3l2 2"/></svg>' +
                '<span>' + Utils.escapeHtml(I18n.t('outline.badge.addBone')) + '</span></button>';

            container.addEventListener('click', (e) => {
                var btn = e.target.closest('[data-action]');
                if (!btn) return;
                var event = new CustomEvent('bone-add', {
                    detail: {
                        action: btn.dataset.action,
                        parentBone: this._selectedBone || '',
                        geoId: this._currentGeoId,
                        geoData: this._currentGeoData
                    }
                });
                this.el.dispatchEvent(event);
            });

            this.bodyEl.appendChild(container);
            this._actionsEl = container;
        }

        hide() {
            this._clearDragState();
            this.el.style.display = 'none';
            this._selectedBone = null;
            this._currentGeoId = null;
            this._currentGeoData = null;
            this._actionsEl = null;
            this.bodyEl.innerHTML = '';
        }

        selectBone(boneName, geoId) {
            this._selectedBone = boneName;
            this._currentGeoId = geoId;

            this.bodyEl.querySelectorAll('.outline-bone-row.selected').forEach(function (el) {
                el.classList.remove('selected');
            });
            var rows = this.bodyEl.querySelectorAll('.outline-bone-row');
            var item = null;
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].dataset.bone === boneName) {
                    item = rows[i];
                    break;
                }
            }
            if (item) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            }
        }

        clearSelection() {
            this._selectedBone = null;
            this._currentGeoId = null;
            this.bodyEl.querySelectorAll('.outline-bone-row.selected').forEach(function (el) {
                el.classList.remove('selected');
            });
        }
    }

    window.SkinApex.OutlinePanel = OutlinePanel;
})();
