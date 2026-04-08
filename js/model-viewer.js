/* ============================================================
   SkinApex - ModelViewer
   Three.js-based 3D skin preview with orbit controls.
   Supports main preview, offscreen thumbnail rendering, and
   bone hierarchy for skeleton editing.
   Cube geometry based on Bedrock entity model format.
   ============================================================ */

(function () {
    'use strict';

    class ModelViewer {
        constructor(container) {
            this.container = container;
            this.scene = null;
            this.camera = null;
            this.renderer = null;
            this.currentMesh = null;
            this.currentTexture = null;
            this.isOpen = false;
            this.animFrameId = null;
            this.canvasEl = null;

            // Orbit controls state
            this.isRotating = false;
            this.isPanning = false;
            this.lastMouse = { x: 0, y: 0 };
            this.rotation = {
                x: ModelViewer.DEFAULT_VIEW_ROTATION.x,
                y: ModelViewer.DEFAULT_VIEW_ROTATION.y
            };
            this.panOffset = { x: 0, y: 0 };
            this.zoom = 1;
            this.targetZoom = 1;
            this.autoRotate = false;
            this._boneGroups = {};      // boneName -> THREE.Group
            this._boneMaterials = {};   // boneName -> THREE.MeshStandardMaterial
            this._rootGroup = null;     // THREE.Group root of bone hierarchy
            this._currentGeoData = null;
            this._currentGeoId = null;
            this._highlightedBone = null;
            this._modelCenter = null;
            this._modelSize = null;
            this._isDestroyed = false;
            this._showSkinToken = 0;
            this._raycaster = new THREE.Raycaster();
            this._pointer = new THREE.Vector2();
            this._onBonePick = null;
            this._clickCandidate = null;
            this._transformControls = null;
            this._gizmoMode = 'translate';
            this._onBoneTransform = null;
            this._transformDragState = null;
            this._originHelper = null;
            this._animationState = {
                officialAnimations: {},
                activeEntries: [],
                actionEntries: {},
                selectedAnimation: '__all__',
                selectedAction: '__none__',
                molang: null,
                startedAt: 0,
                animatedBones: {}
            };
            this._polyMeshNormalMode = 'auto';
            this._lookAtPointerEnabled = false;
            this._pointerLookTarget = { yaw: 0, pitch: 0 };
            this._pointerLookCurrent = { yaw: 0, pitch: 0 };
            this._pointerLookClient = null;
        }

        setPolyMeshNormalMode(mode) {
            this._polyMeshNormalMode = mode === 'source' || mode === 'recalculate' ? mode : 'auto';
        }

        setLookAtPointerEnabled(enabled) {
            this._lookAtPointerEnabled = !!enabled;
            if (!this._lookAtPointerEnabled) {
                this._pointerLookTarget = { yaw: 0, pitch: 0 };
                this._pointerLookClient = null;
            }
        }

        setOnBonePick(fn) {
            this._onBonePick = fn;
        }

        setOnBoneTransform(fn) {
            this._onBoneTransform = fn;
        }

        setGizmoMode(mode) {
            this._gizmoMode = mode === 'rotate' ? 'rotate' : (mode === 'offset' ? 'offset' : 'translate');
            if (this._transformControls) {
                this._transformControls.setMode(this._gizmoMode === 'rotate' ? 'rotate' : 'translate');
                this._transformControls.setSpace('local');
                this._syncTransformControls();
            }
        }

        getHighlightedBone() {
            return this._highlightedBone;
        }

        getAnimatedBones() {
            var selectionAnimation = this._animationState.selectedAnimation || '__all__';
            var selectionAction = this._animationState.selectedAction || '__none__';
            var filtered = {};
            var animatedBones = this._animationState.animatedBones || {};
            Object.keys(animatedBones).forEach(function (boneName) {
                var entries = animatedBones[boneName] || [];
                var visible = entries.filter(function (entry) {
                    var slot = entry.slot || '';
                    if (slot.indexOf('__action__:') === 0) {
                        return selectionAction !== '__none__' && slot === selectionAction;
                    }
                    if (selectionAnimation === '__none__') return false;
                    return selectionAnimation === '__all__' || selectionAnimation === entry.slot || selectionAnimation === entry.id;
                });
                if (visible.length) {
                    filtered[boneName] = visible;
                }
            });
            return JSON.parse(JSON.stringify(filtered));
        }

        getAvailableAnimations() {
            return (this._animationState.activeEntries || []).map(function (entry) {
                return { slot: entry.slot, id: entry.id };
            });
        }

        getPreviewAnimationPresets() {
            return ModelViewer.PREVIEW_ANIMATION_PRESETS.map(function (preset) {
                return { key: preset.key, labelKey: preset.labelKey };
            });
        }

        _normalizeHumanBoneName(name) {
            var raw = String(name || '');
            var normalized = raw.replace(/[^a-z0-9]/gi, '').toLowerCase();
            if (!normalized) return '';
            if (ModelViewer.HUMAN_BONE_ALIASES[normalized]) return normalized;
            var aliasKeys = Object.keys(ModelViewer.HUMAN_BONE_ALIASES);
            for (var i = 0; i < aliasKeys.length; i++) {
                var canonical = aliasKeys[i];
                var patterns = ModelViewer.HUMAN_BONE_ALIASES[canonical] || [];
                for (var p = 0; p < patterns.length; p++) {
                    if (patterns[p].test(raw)) return canonical;
                }
            }
            return normalized;
        }

        _findAnimatedBoneEntry(bonesMap, boneName) {
            if (!bonesMap) return null;
            if (bonesMap[boneName]) return bonesMap[boneName];
            var canonical = this._normalizeHumanBoneName(boneName);
            if (canonical && bonesMap[canonical]) return bonesMap[canonical];
            var keys = Object.keys(bonesMap);
            for (var i = 0; i < keys.length; i++) {
                if (this._normalizeHumanBoneName(keys[i]) === canonical) {
                    return bonesMap[keys[i]];
                }
            }
            return null;
        }

        setSelectedAnimation(selection) {
            if (selection === '__none__') {
                this._animationState.selectedAnimation = '__none__';
                return;
            }
            this._animationState.selectedAnimation = selection || '__all__';
        }

        setSelectedAction(selection) {
            this._animationState.selectedAction = selection || '__none__';
        }

        /**
         * Initialize the Three.js scene, camera, renderer, lights
         */
        init() {
            if (this._isDestroyed) return;
            if (this.scene) return;

            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x1e1e1e);

            this.canvasEl = document.createElement('canvas');
            this.container.appendChild(this.canvasEl);

            const w = this.container.clientWidth || 600;
            const h = this.container.clientHeight || 400;
            const aspect = w / h;
            const frustumSize = this._getFrustumSize();
            this.camera = new THREE.OrthographicCamera(
                frustumSize * aspect / -2, frustumSize * aspect / 2,
                frustumSize / 2, frustumSize / -2, 0.01, 1000
            );
            this.camera.position.set(0, 20, 50);
            this.camera.lookAt(0, 0, 0);

            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvasEl,
                antialias: false,
                alpha: true
            });
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this._syncRendererSize(w, h);

            // Lights
            this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
            const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
            dirLight.position.set(10, 40, 30);
            this.scene.add(dirLight);
            const backLight = new THREE.DirectionalLight(0xffffff, 0.2);
            backLight.position.set(-10, 20, -20);
            this.scene.add(backLight);

            // Grid
            const grid = new THREE.GridHelper(80, 16, 0x3a3a3a, 0x2a2a2a);
            grid.position.y = -0.01;
            this.scene.add(grid);

            this._originHelper = new THREE.Object3D();
            this._originHelper.visible = false;
            this.scene.add(this._originHelper);

            this._initControls();
            this._initTransformControls();

            this._resizeObserver = new ResizeObserver(() => this._onResize());
            this._resizeObserver.observe(this.container);
        }

        _initTransformControls() {
            if (!window.THREE || !THREE.TransformControls || !this.camera || !this.canvasEl || !this.scene) return;
            this._transformControls = new THREE.TransformControls(this.camera, this.canvasEl);
            this._transformControls.setMode(this._gizmoMode === 'rotate' ? 'rotate' : 'translate');
            this._transformControls.setSpace('local');
            this._transformControls.size = 0.8;
            this._transformControls.visible = false;

            this._transformControls.addEventListener('dragging-changed', (e) => {
                var dragging = !!(e && e.value);
                if (dragging) {
                    this.isRotating = false;
                    this.isPanning = false;
                    this._clickCandidate = null;
                    if (this._rootGroup) {
                        this._rootGroup.updateMatrixWorld(true);
                    }
                    var boneName = this._highlightedBone;
                    var bone = boneName && this._currentGeoData ? this._findBone(boneName, this._currentGeoData) : null;
                    var group = boneName ? this._boneGroups[boneName] : null;
                    var target = this._getTransformTarget();
                    var startWorldPos = new THREE.Vector3();
                    var startLocalPos = new THREE.Vector3();
                    var activeAxis = this._transformControls ? (this._transformControls.axis || '') : '';
                    if (target) target.getWorldPosition(startWorldPos);
                    if (target) startLocalPos.copy(target.position);
                    this._transformDragState = bone ? {
                        boneName: boneName,
                        pivot: (bone.pivot || [0, 0, 0]).slice(),
                        rotation: (bone.rotation || [0, 0, 0]).slice(),
                        worldPos: [startWorldPos.x, startWorldPos.y, startWorldPos.z],
                        localPos: [startLocalPos.x, startLocalPos.y, startLocalPos.z],
                        delta: [0, 0, 0],
                        value: this._gizmoMode === 'offset'
                            ? (bone.pivot || [0, 0, 0]).slice()
                            : this._getAbsolutePivotFromTransformTarget(target),
                        axis: activeAxis
                    } : null;
                } else if (this._transformDragState && this._onBoneTransform && this._currentGeoData) {
                    var state = this._transformDragState;
                    var group = this._boneGroups[state.boneName];
                    if (group) {
                        if (this._gizmoMode === 'rotate') {
                            var rotation = [
                                -THREE.MathUtils.radToDeg(group.rotation.x),
                                -THREE.MathUtils.radToDeg(group.rotation.y),
                                THREE.MathUtils.radToDeg(group.rotation.z)
                            ];
                            this._onBoneTransform(state.boneName, 'rotation', rotation, this._currentGeoId, this._currentGeoData);
                        } else {
                            if (state.value) {
                                this._onBoneTransform(
                                    state.boneName,
                                    this._gizmoMode === 'offset' ? 'pivot' : 'translation',
                                    state.value,
                                    this._currentGeoId,
                                    this._currentGeoData
                                );
                            }
                        }
                    }
                    this._transformDragState = null;
                }
            });

            this._transformControls.addEventListener('objectChange', () => {
                if (!this._transformDragState || !this._currentGeoData) return;
                var state = this._transformDragState;
                var target = this._getTransformTarget();
                if (!target) return;

                if (this._gizmoMode === 'rotate') {
                    return;
                }

                state.value = this._getAbsolutePivotFromTransformTarget(target);
            });

            this.scene.add(this._transformControls);
        }

        refreshGeometry() {
            if (!this._currentGeoData) return;
            var highlighted = this._highlightedBone;
            this._rebuildFullHierarchy(this._currentGeoData);
            if (highlighted) {
                this.highlightBone(highlighted);
            }
        }

        _getFrustumSize() {
            if (this._modelSize && this._modelSize[1] > 0) {
                return Math.max(50, this._modelSize[1] * 1.8);
            }
            return 50;
        }

        _onResize() {
            if (this._isDestroyed) return;
            if (!this.container || !this.renderer || !this.camera) return;
            const w = this.container.clientWidth;
            const h = this.container.clientHeight;
            if (w === 0 || h === 0) return;
            const aspect = w / h;
            const frustumSize = this._getFrustumSize();
            this.camera.left = frustumSize * aspect / -2;
            this.camera.right = frustumSize * aspect / 2;
            this.camera.top = frustumSize / 2;
            this.camera.bottom = frustumSize / -2;
            this.camera.updateProjectionMatrix();
            this._syncRendererSize(w, h);
        }

        _syncRendererSize(w, h) {
            if (!this.renderer || !this.canvasEl) return;
            var width = Math.max(1, Math.round(Number(w) || 0));
            var height = Math.max(1, Math.round(Number(h) || 0));
            this.renderer.setSize(width, height, false);
            this.canvasEl.style.width = '100%';
            this.canvasEl.style.height = '100%';
        }

        /**
         * Update camera frustum to match the loaded model size.
         * Called after model load to resync the camera with actual model dimensions.
         */
        _updateFrustum() {
            if (!this.camera || !this.container) return;
            var w = this.container.clientWidth;
            var h = this.container.clientHeight;
            if (w === 0 || h === 0) { w = 600; h = 400; }
            var aspect = w / h;
            var frustumSize = this._getFrustumSize();
            this.camera.left = frustumSize * aspect / -2;
            this.camera.right = frustumSize * aspect / 2;
            this.camera.top = frustumSize / 2;
            this.camera.bottom = frustumSize / -2;
            this.camera.updateProjectionMatrix();
        }

        _initControls() {
            var canvas = this.canvasEl;

            canvas.addEventListener('mousedown', (e) => {
                if (this._transformControls && (this._transformControls.dragging || this._transformControls.axis)) {
                    this.lastMouse = { x: e.clientX, y: e.clientY };
                    return;
                }
                this._clickCandidate = { x: e.clientX, y: e.clientY, button: e.button };
                if (e.button === 0) {
                    this.isRotating = true;
                    this.autoRotate = false;
                } else if (e.button === 2 || e.button === 1) {
                    this.isPanning = true;
                }
                this.lastMouse = { x: e.clientX, y: e.clientY };
                canvas.style.cursor = 'grabbing';
            });

            canvas.addEventListener('mousemove', (e) => {
                this._setPointerLookClientPosition(e.clientX, e.clientY);
                const dx = e.clientX - this.lastMouse.x;
                const dy = e.clientY - this.lastMouse.y;
                this.lastMouse = { x: e.clientX, y: e.clientY };
                if (this.isRotating) {
                    this.rotation.y += dx * 0.008;
                    this.rotation.x += dy * 0.008;
                    this.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotation.x));
                }
                if (this.isPanning) {
                    this.panOffset.x -= dx * 0.04;
                    this.panOffset.y += dy * 0.04;
                }
            });

            canvas.addEventListener('mouseup', (e) => {
                this._handleClickPick(e);
                this.isRotating = false;
                this.isPanning = false;
                canvas.style.cursor = 'grab';
            });

            canvas.addEventListener('mouseleave', () => {
                this._clickCandidate = null;
                this.isRotating = false;
                this.isPanning = false;
                this._pointerLookTarget = { yaw: 0, pitch: 0 };
                this._pointerLookClient = null;
                canvas.style.cursor = 'grab';
            });

            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                // Scroll up (negative deltaY) = zoom in, scroll down = zoom out
                const speed = 1 - e.deltaY * 0.001;
                this.targetZoom = Math.max(0.3, Math.min(5, this.targetZoom * speed));
            }, { passive: false });

            canvas.addEventListener('contextmenu', (e) => e.preventDefault());
            canvas.style.cursor = 'grab';

            // --- Touch controls (mobile) ---
            this._touchState = { touches: [], lastPinchDist: 0, isPinching: false, isTouchRotate: false, isTouchPan: false, tapCandidate: null };

            canvas.addEventListener('touchstart', (e) => {
                e.preventDefault();
                var ts = this._touchState;
                if (this._transformControls && (this._transformControls.dragging || this._transformControls.axis)) {
                    ts.isTouchRotate = false;
                    ts.isTouchPan = false;
                    ts.tapCandidate = null;
                    return;
                }
                ts.touches = Array.from(e.touches);
                ts.lastPinchDist = 0;
                ts.isPinching = false;
                ts.isTouchRotate = false;
                ts.isTouchPan = false;
                ts.tapCandidate = null;

                if (e.touches.length === 1) {
                    this._setPointerLookClientPosition(e.touches[0].clientX, e.touches[0].clientY);
                    ts.isTouchRotate = true;
                    this.autoRotate = false;
                    ts.tapCandidate = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
                    ts.touches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
                } else if (e.touches.length === 2) {
                    ts.isTouchPan = true;
                    var dx = e.touches[0].clientX - e.touches[1].clientX;
                    var dy = e.touches[0].clientY - e.touches[1].clientY;
                    ts.lastPinchDist = Math.sqrt(dx * dx + dy * dy);
                    ts.touches = [
                        { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 }
                    ];
                }
            }, { passive: false });

            canvas.addEventListener('touchmove', (e) => {
                e.preventDefault();
                var ts = this._touchState;
                if (e.touches.length === 1) {
                    this._setPointerLookClientPosition(e.touches[0].clientX, e.touches[0].clientY);
                }

                if (e.touches.length === 1 && ts.isTouchRotate) {
                    var dx = e.touches[0].clientX - ts.touches[0].x;
                    var dy = e.touches[0].clientY - ts.touches[0].y;
                    if (Math.abs(dx) + Math.abs(dy) > 6 && ts.tapCandidate) {
                        ts.tapCandidate.moved = true;
                    }
                    this.rotation.y += dx * 0.008;
                    this.rotation.x += dy * 0.008;
                    this.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotation.x));
                    ts.touches[0] = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                } else if (e.touches.length === 2) {
                    var dx2 = e.touches[0].clientX - e.touches[1].clientX;
                    var dy2 = e.touches[0].clientY - e.touches[1].clientY;
                    var dist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                    var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

                    if (ts.lastPinchDist > 0) {
                        var scale = dist / ts.lastPinchDist;
                        this.targetZoom = Math.max(0.3, Math.min(5, this.targetZoom * scale));
                    }
                    ts.lastPinchDist = dist;

                    if (ts.touches.length > 0) {
                        var pdx = midX - ts.touches[0].x;
                        var pdy = midY - ts.touches[0].y;
                        this.panOffset.x -= pdx * 0.04;
                        this.panOffset.y += pdy * 0.04;
                    }
                    ts.touches = [{ x: midX, y: midY }];
                }
            }, { passive: false });

            canvas.addEventListener('touchend', (e) => {
                var ts = this._touchState;
                if (e.touches.length === 0 && ts.tapCandidate && !ts.tapCandidate.moved) {
                    this._handlePointPick(ts.tapCandidate.x, ts.tapCandidate.y);
                }
                if (e.touches.length === 0) {
                    this._pointerLookTarget = { yaw: 0, pitch: 0 };
                    ts.isTouchRotate = false;
                    ts.isTouchPan = false;
                    ts.lastPinchDist = 0;
                    ts.tapCandidate = null;
                } else if (e.touches.length === 1) {
                    ts.isTouchRotate = true;
                    ts.isTouchPan = false;
                    ts.lastPinchDist = 0;
                    ts.tapCandidate = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
                    ts.touches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
                }
            }, { passive: false });
        }

        _handleClickPick(e) {
            if (!e || !this._clickCandidate || this._clickCandidate.button !== 0) {
                this._clickCandidate = null;
                return;
            }

            var dx = Math.abs(e.clientX - this._clickCandidate.x);
            var dy = Math.abs(e.clientY - this._clickCandidate.y);
            this._clickCandidate = null;
            if (dx > 4 || dy > 4) return;
            this._handlePointPick(e.clientX, e.clientY);
        }

        _handlePointPick(clientX, clientY) {
            if (!this.canvasEl || !this.camera || !this.scene) return;

            var rect = this.canvasEl.getBoundingClientRect();
            this._pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
            this._pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
            this._raycaster.setFromCamera(this._pointer, this.camera);

            var meshes = [];
            Object.keys(this._boneGroups).forEach((boneName) => {
                var group = this._boneGroups[boneName];
                if (!group) return;
                group.traverse(function (obj) {
                    if (obj.isMesh) {
                        obj.userData.boneName = boneName;
                        meshes.push(obj);
                    }
                });
            });

            var hits = this._raycaster.intersectObjects(meshes, false);
            if (!hits || hits.length === 0) return;
            var pickedBone = hits[0].object && hits[0].object.userData ? hits[0].object.userData.boneName : null;
            if (!pickedBone) return;

            this.highlightBone(pickedBone);
            if (this._onBonePick) {
                this._onBonePick(pickedBone, this._currentGeoId, this._currentGeoData);
            }
        }

        startLoop() {
            if (this.isOpen) return;
            this.isOpen = true;
            this._animate();
        }

        stopLoop() {
            this.isOpen = false;
            if (this.animFrameId) {
                cancelAnimationFrame(this.animFrameId);
                this.animFrameId = null;
            }
        }

        _animate() {
            if (!this.isOpen || this._isDestroyed) return;
            if (!this.renderer || !this.camera || !this.scene) {
                this.stopLoop();
                return;
            }
            this.animFrameId = requestAnimationFrame(() => this._animate());

            var target = this.currentMesh || this._rootGroup;
            if (this.autoRotate && target) {
                this.rotation.y += 0.004;
            }
            this.zoom += (this.targetZoom - this.zoom) * 0.1;
            if (target) {
                target.rotation.x = this.rotation.x;
                target.rotation.y = this.rotation.y;
            }
            this.camera.zoom = this.zoom;
            this.camera.updateProjectionMatrix();
            var halfH = ((this._modelSize && this._modelSize[1]) || 32) / 2;
            this.camera.position.x = this.panOffset.x;
            this.camera.position.y = halfH + this.panOffset.y;
            this.camera.position.z = 50;  // Ensure camera Z is always set
            this.camera.lookAt(this.panOffset.x, halfH, 0);
            if (target) {
                target.updateMatrixWorld(true);
            }
            this.camera.updateMatrixWorld(true);
            this._updatePointerLookFromClientPosition();
            this._updatePointerLookState();
            this._applyAnimationFrame();
            this.renderer.render(this.scene, this.camera);
        }

        /**
         * Load and display a 3D model for a skin.
         * Uses bone hierarchy for skeleton editing support.
         */
        async showSkin(skin, project) {
            if (this._isDestroyed) return;
            var token = ++this._showSkinToken;
            this.init();
            if (this._isDestroyed || token !== this._showSkinToken) return;
            this._clearMesh();
            this._clearBoneHierarchy();
            this.rotation = {
                x: ModelViewer.DEFAULT_VIEW_ROTATION.x,
                y: ModelViewer.DEFAULT_VIEW_ROTATION.y
            };
            this.panOffset = { x: 0, y: 0 };
            this.zoom = 1;
            this.targetZoom = 1;
            this.autoRotate = false;
            this._animationState.activeEntries = [];
            this._animationState.actionEntries = {};
            this._animationState.animatedBones = {};
            this._animationState.startedAt = performance.now();

            if (!skin || !skin.geometry) {
                this.startLoop();
                return;
            }

            try {
                var geoData = project.geometries[skin.geometry];
                if (!geoData) {
                    console.warn('ModelViewer: geometry not found:', skin.geometry);
                    this.startLoop();
                    return;
                }

                console.log('[UV] showSkin:', skin.name, '| geo:', skin.geometry, '| texPath:', skin.texturePath);
                console.log('[UV] texDim:', this._getTextureDimensions(geoData, null));
                console.log('[UV] bones:', geoData.bones.length);
                var _fb = geoData.bones[0];
                if (_fb) {
                    console.log('[UV] first bone:', _fb.name, '| cubes:', (_fb.cubes || []).length, '| poly_mesh:', !!_fb.poly_mesh);
                    if (_fb.cubes && _fb.cubes[0]) {
                        var sampleCube = _fb.cubes[0];
                        console.log('[UV] sample cube UV type:', Array.isArray(sampleCube.uv) ? 'box UV array' : (sampleCube.uv && typeof sampleCube.uv === 'object' ? 'per-face object' : 'none/other'));
                        console.log('[UV] sample cube UV:', JSON.stringify(sampleCube.uv));
                        console.log('[UV] sample cube origin:', JSON.stringify(sampleCube.origin), 'size:', JSON.stringify(sampleCube.size));
                        console.log('[UV] sample cube mirror:', sampleCube.mirror);
                    }
                }

                this.currentTexture = await this._loadTexture(skin.texturePath, project);
                console.log('[UV] texture loaded:', this.currentTexture ? (this.currentTexture.image ? this.currentTexture.image.width + 'x' + this.currentTexture.image.height : 'no image') : 'null');
                if (this._isDestroyed || token !== this._showSkinToken || !this.scene) {
                    this._disposeCurrentTexture();
                    return;
                }
                this._currentGeoData = geoData;
                this._currentGeoId = skin.geometry;

                // Build bone hierarchy (supports editing)
                var result = this._buildBoneHierarchy(geoData, this.currentTexture);
                if (!result) {
                    console.warn('ModelViewer: failed to build bone hierarchy for', skin.geometry);
                    this.startLoop();
                    return;
                }

                this._rootGroup = result.root;
                this._boneGroups = result.boneGroups;
                this._boneMaterials = result.materials;
                if (this._isDestroyed || token !== this._showSkinToken || !this.scene) {
                    this._clearBoneHierarchy();
                    return;
                }
                this.scene.add(this._rootGroup);
                await this._prepareAnimations(skin, project);

                // Update camera frustum to match the loaded model
                this._updateFrustum();

                // Ensure canvas is properly sized after DOM reflow
                requestAnimationFrame(() => {
                    if (this.isOpen) this._onResize();
                });
            } catch (err) {
                console.error('ModelViewer: showSkin error:', err);
            }

            this.startLoop();
        }

        _clearMesh() {
            if (this.currentMesh) {
                this.scene.remove(this.currentMesh);
                if (this.currentMesh.geometry) this.currentMesh.geometry.dispose();
                if (this.currentMesh.material) {
                    // Detach texture before disposing material
                    this.currentMesh.material.map = null;
                    this.currentMesh.material.dispose();
                }
                this.currentMesh = null;
            }
            this._disposeCurrentTexture();
        }

        _disposeCurrentTexture() {
            if (this.currentTexture) {
                this.currentTexture.dispose();
                this.currentTexture = null;
            }
        }

        /**
         * Clean up bone hierarchy and all associated resources
         */
        _clearBoneHierarchy() {
            if (this._transformControls) {
                this._transformControls.detach();
                this._transformControls.visible = false;
            }
            if (this._rootGroup) {
                this.scene.remove(this._rootGroup);
                // Dispose all child geometries and materials
                this._rootGroup.traverse((obj) => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        // Detach shared texture reference before disposing material
                        // (material.dispose() does NOT dispose textures in Three.js)
                        obj.material.map = null;
                        obj.material.dispose();
                    }
                });
                this._rootGroup = null;
            }
            this._boneGroups = {};
            this._boneMaterials = {};
            this._highlightedBone = null;
            this._currentGeoData = null;
            this._currentGeoId = null;
            this._modelCenter = null;
            this._modelSize = null;
            this._animationState.activeEntries = [];
            this._animationState.animatedBones = {};
            if (this._originHelper) {
                this._originHelper.visible = false;
                this._originHelper.position.set(0, 0, 0);
            }
            this._disposeCurrentTexture();
        }

        async _prepareAnimations(skin, project) {
            this._animationState.activeEntries = [];
            this._animationState.actionEntries = {};
            this._animationState.animatedBones = {};
            this._animationState.startedAt = performance.now();
            this._animationState.selectedAnimation = '__all__';
            this._animationState.selectedAction = '__none__';
            this._animationState.molang = window.Molang && window.Molang.Molang
                ? new window.Molang.Molang({}, { useCache: false, convertUndefined: true, useRadians: false, assumeFlatEnvironment: true })
                : null;

            var mappings = skin && skin.animations ? skin.animations : (skin && skin.data ? skin.data.animations : null);
            if (!this._currentGeoData || !this._currentGeoData.bones) {
                this._animationState.officialAnimations = {};
                return;
            }

            // Ensure the index is loaded, then batch-fetch only the animations this skin uses
            try {
                await project.getOfficialAnimationIndex();
            } catch (err) {
                this._animationState.officialAnimations = {};
                return;
            }
            var neededIds = [];
            if (mappings && Object.keys(mappings).length) {
                neededIds = neededIds.concat(Object.values(mappings).filter(function (id) { return !!id; }));
            }
            ModelViewer.PREVIEW_ANIMATION_PRESETS.forEach(function (preset) {
                var definition = ModelViewer.PREVIEW_ACTION_DEFINITIONS[preset.key];
                if (definition && Array.isArray(definition.animationIds)) {
                    neededIds = neededIds.concat(definition.animationIds);
                }
            });
            neededIds = Array.from(new Set(neededIds));
            var loadedAnimations = await project.getOfficialAnimations(neededIds);
            this._animationState.officialAnimations = loadedAnimations;

            var animated = {};
            var addAnimatedBones = (slot, animationId, animation) => {
                if (!animation || !animation.bones) return;
                Object.keys(animation.bones).forEach((boneName) => {
                    var targetBone = this._findBone(boneName, this._currentGeoData) || this._findBoneByCanonicalName(boneName, this._currentGeoData);
                    if (!targetBone) return;
                    var targetBoneName = targetBone.name || boneName;
                    if (!animated[targetBoneName]) animated[targetBoneName] = [];
                    animated[targetBoneName].push({ slot: slot, id: animationId });
                });
            };

            Object.keys(mappings || {}).forEach((slot) => {
                var animationId = mappings[slot];
                var animation = loadedAnimations[animationId];
                if (!animation || !animation.bones) return;
                this._animationState.activeEntries.push({
                    slot: slot,
                    id: animationId,
                    data: animation,
                    meta: {
                        overridePreviousAnimation: !!animation.override_previous_animation,
                        blendWeight: animation.blend_weight,
                        animTimeUpdate: animation.anim_time_update,
                        animationLength: Number(animation.animation_length) || 0,
                        loop: !!animation.loop
                    }
                });
                addAnimatedBones(slot, animationId, animation);
            });

            var actionEntries = {};
            ModelViewer.PREVIEW_ANIMATION_PRESETS.forEach((preset) => {
                var definition = ModelViewer.PREVIEW_ACTION_DEFINITIONS[preset.key];
                if (!definition || !Array.isArray(definition.animationIds)) return;
                var selectionKey = '__action__:' + preset.key;
                var entries = [];
                definition.animationIds.forEach((animationId) => {
                    var animation = loadedAnimations[animationId];
                    if (!animation || !animation.bones) return;
                    entries.push({
                        slot: selectionKey,
                        id: animationId,
                        data: animation,
                        meta: {
                            overridePreviousAnimation: !!animation.override_previous_animation,
                            blendWeight: animation.blend_weight,
                            animTimeUpdate: animation.anim_time_update,
                            animationLength: Number(animation.animation_length) || 0,
                            loop: !!animation.loop
                        }
                    });
                    addAnimatedBones(selectionKey, animationId, animation);
                });
                actionEntries[selectionKey] = entries;
            });

            this._animationState.actionEntries = actionEntries;
            this._animationState.animatedBones = animated;
        }

        _applyAnimationFrame() {
            if (!this._currentGeoData || !this._currentGeoData.bones || !this._rootGroup) return;
            if (this._transformControls && this._transformControls.dragging) return;
            var animationEntries = this._animationState.activeEntries || [];
            var animationSelection = this._animationState.selectedAnimation || '__all__';
            var actionSelection = this._animationState.selectedAction || '__none__';
            var time = (performance.now() - (this._animationState.startedAt || performance.now())) / 1000;
            var previewPreset = this._getPreviewPresetState(actionSelection, time);
            var neutralPreset = ModelViewer._buildPreviewPresetState(null, time);
            var entries = [];
            if (animationSelection !== '__none__') {
                entries = entries.concat(animationEntries.filter(function (entry) {
                    return animationSelection === '__all__' || animationSelection === entry.slot || animationSelection === entry.id;
                }));
            }
            if (actionSelection !== '__none__') {
                entries = entries.concat((this._animationState.actionEntries && this._animationState.actionEntries[actionSelection]) || []);
            }

            for (var i = 0; i < this._currentGeoData.bones.length; i++) {
                var bone = this._currentGeoData.bones[i];
                var boneName = bone.name || ('bone_' + i);
                var group = this._boneGroups[boneName];
                if (!group) continue;

                var baseRot = bone.rotation || [0, 0, 0];
                var basePivot = bone.pivot || [0, 0, 0];
                var rotAccum = [0, 0, 0];
                var posAccum = [0, 0, 0];

                for (var e = 0; e < entries.length; e++) {
                    var entry = entries[e];
                    var boneAnim = this._findAnimatedBoneEntry(entry.data && entry.data.bones ? entry.data.bones : null, boneName);
                    if (!boneAnim) continue;

                    var entryPreviewPreset = entry.slot && entry.slot.indexOf('__action__:') === 0
                        ? previewPreset
                        : neutralPreset;

                    var entryContext = this._buildAnimationExecutionContext(entry, time, entryPreviewPreset);
                    var blendWeight = this._resolveAnimationBlendWeight(entry, entryContext, entryPreviewPreset);

                    if (entry.meta && entry.meta.overridePreviousAnimation) {
                        if (boneAnim.rotation) rotAccum = [0, 0, 0];
                        if (boneAnim.position) posAccum = [0, 0, 0];
                    }

                    if (boneAnim.rotation) {
                        var nextRot = this._evalAnimVec3(boneAnim.rotation, entryContext, rotAccum, entryPreviewPreset);
                        if (nextRot) {
                            rotAccum[0] += nextRot[0] * blendWeight;
                            rotAccum[1] += nextRot[1] * blendWeight;
                            rotAccum[2] += nextRot[2] * blendWeight;
                        }
                    }
                    if (boneAnim.position) {
                        var nextPos = this._evalAnimVec3(boneAnim.position, entryContext, posAccum, entryPreviewPreset);
                        if (nextPos) {
                            posAccum[0] += nextPos[0] * blendWeight;
                            posAccum[1] += nextPos[1] * blendWeight;
                            posAccum[2] += nextPos[2] * blendWeight;
                        }
                    }
                }

                var rot = [baseRot[0] + rotAccum[0], baseRot[1] + rotAccum[1], baseRot[2] + rotAccum[2]];
                var pos = [basePivot[0] + posAccum[0], basePivot[1] + posAccum[1], basePivot[2] + posAccum[2]];

                this._applyPointerLookOverride(boneName, bone, group, rot);

                group.rotation.set(-rot[0] * Math.PI / 180, -rot[1] * Math.PI / 180, rot[2] * Math.PI / 180);
                var localPos = this._getBoneLocalPosition(bone, pos, this._currentGeoData);
                group.position.set(localPos[0], localPos[1], localPos[2]);
                group.updateMatrix();
            }

            if (this._rootGroup) {
                this._rootGroup.updateMatrixWorld(true);
            }
        }

        _getBoneLocalPosition(bone, absolutePivot, geoData) {
            var pivot = absolutePivot || bone.pivot || [0, 0, 0];
            if (!bone || !bone.parent) {
                return [-pivot[0], pivot[1], pivot[2]];
            }
            var parentBone = this._findBone(bone.parent, geoData);
            if (!parentBone) {
                return [-pivot[0], pivot[1], pivot[2]];
            }
            var parentPivot = parentBone.pivot || [0, 0, 0];
            return [
                -(pivot[0] - parentPivot[0]),
                pivot[1] - parentPivot[1],
                pivot[2] - parentPivot[2]
            ];
        }

        _getAbsolutePivotFromGroupPosition(boneName, group, geoData) {
            if (!group || !this._rootGroup) return null;
            var world = new THREE.Vector3();
            group.getWorldPosition(world);
            var local = this._rootGroup.worldToLocal(world.clone());
            return [-local.x, local.y, local.z];
        }

        _getAbsolutePivotFromTransformTarget(target) {
            if (!target || !this._rootGroup) return null;
            var world = new THREE.Vector3();
            target.getWorldPosition(world);
            var local = this._rootGroup.worldToLocal(world.clone());
            return [-local.x, local.y, local.z];
        }

        _getTransformTarget() {
            if (!this._highlightedBone) return null;
            return this._gizmoMode === 'offset'
                ? this._originHelper
                : this._boneGroups[this._highlightedBone];
        }

        _syncOriginHelperParent() {
            if (!this._originHelper || !this.scene) return;
            var parent = this._rootGroup || this.scene;
            if (this._originHelper.parent === parent) return;
            parent.attach(this._originHelper);
        }

        _syncOriginHelper() {
            if (!this._originHelper || !this._highlightedBone) return;
            this._syncOriginHelperParent();
            var bone = this._findBone(this._highlightedBone, this._currentGeoData);
            if (!bone || !bone.pivot) {
                this._originHelper.visible = false;
                return;
            }
            this._originHelper.position.set(-bone.pivot[0], bone.pivot[1], bone.pivot[2]);
            this._originHelper.visible = this._gizmoMode === 'offset';
            this._originHelper.updateMatrixWorld(true);
        }

        _syncTransformControls() {
            if (!this._transformControls) return;
            if (this._rootGroup) {
                this._rootGroup.updateMatrixWorld(true);
            }
            this._syncOriginHelper();
            var target = this._getTransformTarget();
            if (!target) {
                this._transformControls.detach();
                this._transformControls.visible = false;
                if (this._originHelper) this._originHelper.visible = false;
                return;
            }
            this._transformControls.attach(target);
            this._transformControls.visible = true;
            this._transformControls.setMode(this._gizmoMode === 'rotate' ? 'rotate' : 'translate');
            this._transformControls.setSpace('local');
        }

        _buildAnimationExecutionContext(entry, time, previewPreset) {
            var context = {
                animTime: time,
                lifeTime: time,
                timeStamp: time,
                animationLength: entry && entry.meta ? Number(entry.meta.animationLength) || 0 : 0,
                loop: !!(entry && entry.meta && entry.meta.loop)
            };
            if (!entry || !entry.meta || !entry.meta.animTimeUpdate) {
                return context;
            }
            var animTime = this._evalAnimScalar(entry.meta.animTimeUpdate, context, 0, previewPreset);
            context.animTime = Number(animTime) || 0;
            return context;
        }

        _resolveAnimationBlendWeight(entry, context, previewPreset) {
            if (!entry || !entry.meta || entry.meta.blendWeight === undefined || entry.meta.blendWeight === null || entry.meta.blendWeight === '') {
                return 1;
            }
            if (typeof entry.meta.blendWeight === 'number') {
                return entry.meta.blendWeight;
            }
            var value = this._evalAnimScalar(entry.meta.blendWeight, context || { animTime: 0, lifeTime: 0, timeStamp: 0 }, 0, previewPreset || null);
            return Number.isFinite(value) ? value : 1;
        }

        _evalAnimVec3(value, context, currentValue, previewPreset) {
            if (Array.isArray(value)) {
                var out = [0, 0, 0];
                for (var i = 0; i < 3; i++) {
                    out[i] = this._evalAnimScalar(value[i], context, currentValue ? currentValue[i] : 0, previewPreset);
                }
                return out;
            }
            if (value && typeof value === 'object') {
                return this._evalAnimKeyframes(value, context, currentValue, previewPreset, 3);
            }
            return null;
        }

        _evalAnimScalar(value, context, currentValue, previewPreset) {
            if (typeof value === 'number') return value;
            if (value && typeof value === 'object') {
                var keyframed = this._evalAnimKeyframes(value, context, currentValue, previewPreset, 1);
                return Number(keyframed) || 0;
            }
            if (typeof value !== 'string') return 0;
            var molang = this._animationState.molang;
            if (!molang) return 0;
            var expression = String(value).replace(/\bMath\./g, 'math.');
            var envContext = context || { animTime: 0, lifeTime: 0, timeStamp: 0 };
            var preset = previewPreset || ModelViewer._buildPreviewPresetState(null, envContext.animTime || 0);
            var pointerLook = this._pointerLookCurrent || { yaw: 0, pitch: 0 };
            molang.updateExecutionEnv({
                'query.anim_time': envContext.animTime || 0,
                'query.life_time': envContext.lifeTime || 0,
                'query.modified_move_speed': preset.moveSpeed,
                'query.modified_distance_moved': preset.distanceMoved,
                'query.cape_flap_amount': preset.capeFlapAmount,
                'query.is_sneaking': preset.isSneaking ? 1 : 0,
                'query.is_swimming': 0,
                'query.target_x_rotation': pointerLook.pitch,
                'query.target_y_rotation': pointerLook.yaw,
                'query.head_y_rotation': function () { return pointerLook.yaw; },
                'query.get_root_locator_offset': function () { return 0; },
                'query.time_stamp': envContext.timeStamp || 0,
                'variable.tcos0': preset.tcos0,
                'variable.swim_amount': 0,
                'this': Number(currentValue) || 0
            }, true);
            try {
                return Number(molang.execute(expression)) || 0;
            } catch (e) {
                return 0;
            }
        }

        _evalAnimKeyframes(timeline, context, currentValue, previewPreset, componentCount) {
            var keyframes = this._parseAnimKeyframes(timeline);
            if (!keyframes.length) {
                return componentCount === 1 ? 0 : null;
            }
            var sampleTime = this._normalizeAnimSampleTime(context ? context.animTime : 0, context);
            var first = keyframes[0];
            if (sampleTime <= first.time) {
                return this._resolveAnimKeyframeValue(first.value, 'pre', context, currentValue, previewPreset, componentCount);
            }

            for (var i = 0; i < keyframes.length; i++) {
                var frame = keyframes[i];
                if (sampleTime === frame.time) {
                    return this._resolveAnimKeyframeValue(frame.value, 'post', context, currentValue, previewPreset, componentCount);
                }
                var next = keyframes[i + 1];
                if (!next) continue;
                if (sampleTime < next.time) {
                    var startValue = this._resolveAnimKeyframeValue(frame.value, 'post', context, currentValue, previewPreset, componentCount);
                    var endValue = this._resolveAnimKeyframeValue(next.value, 'pre', context, currentValue, previewPreset, componentCount);
                    var span = next.time - frame.time;
                    var alpha = span > 0 ? (sampleTime - frame.time) / span : 0;
                    return this._interpolateAnimValue(startValue, endValue, alpha, componentCount);
                }
            }

            return this._resolveAnimKeyframeValue(keyframes[keyframes.length - 1].value, 'post', context, currentValue, previewPreset, componentCount);
        }

        _parseAnimKeyframes(timeline) {
            if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)) return [];
            return Object.keys(timeline)
                .map(function (key) {
                    return { rawKey: key, time: Number(key), value: timeline[key] };
                })
                .filter(function (entry) {
                    return Number.isFinite(entry.time);
                })
                .sort(function (a, b) {
                    return a.time - b.time;
                });
        }

        _normalizeAnimSampleTime(time, context) {
            var sampleTime = Number(time);
            if (!Number.isFinite(sampleTime)) sampleTime = 0;
            var animationLength = context ? Number(context.animationLength) || 0 : 0;
            if (animationLength <= 0) return sampleTime;
            if (context && context.loop) {
                sampleTime = sampleTime % animationLength;
                if (sampleTime < 0) sampleTime += animationLength;
                return sampleTime;
            }
            if (sampleTime < 0) return 0;
            if (sampleTime > animationLength) return animationLength;
            return sampleTime;
        }

        _resolveAnimKeyframeValue(keyframeValue, edge, context, currentValue, previewPreset, componentCount) {
            var resolved = keyframeValue;
            if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
                if (edge === 'pre' && resolved.pre !== undefined) {
                    resolved = resolved.pre;
                } else if (edge === 'post' && resolved.post !== undefined) {
                    resolved = resolved.post;
                } else if (resolved.post !== undefined) {
                    resolved = resolved.post;
                } else if (resolved.pre !== undefined) {
                    resolved = resolved.pre;
                }
            }
            return this._evalAnimValueComponents(resolved, context, currentValue, previewPreset, componentCount);
        }

        _evalAnimValueComponents(value, context, currentValue, previewPreset, componentCount) {
            if (componentCount === 1) {
                return this._evalAnimScalarComponent(value, context, currentValue, previewPreset);
            }
            if (!Array.isArray(value)) return null;
            var out = new Array(componentCount);
            for (var i = 0; i < componentCount; i++) {
                out[i] = this._evalAnimScalarComponent(value[i], context, currentValue ? currentValue[i] : 0, previewPreset);
            }
            return out;
        }

        _evalAnimScalarComponent(value, context, currentValue, previewPreset) {
            if (typeof value === 'number') return value;
            if (typeof value === 'string') return this._evalAnimScalar(value, context, currentValue, previewPreset);
            return Number(value) || 0;
        }

        _interpolateAnimValue(startValue, endValue, alpha, componentCount) {
            var t = Math.max(0, Math.min(1, Number(alpha) || 0));
            if (componentCount === 1) {
                var startScalar = Number(startValue) || 0;
                var endScalar = Number(endValue) || 0;
                return startScalar + ((endScalar - startScalar) * t);
            }
            if (!Array.isArray(startValue) || !Array.isArray(endValue)) {
                return Array.isArray(startValue) ? startValue : endValue;
            }
            var out = new Array(componentCount);
            for (var i = 0; i < componentCount; i++) {
                var startComponent = Number(startValue[i]) || 0;
                var endComponent = Number(endValue[i]) || 0;
                out[i] = startComponent + ((endComponent - startComponent) * t);
            }
            return out;
        }

        _setPointerLookClientPosition(clientX, clientY) {
            if (!this._lookAtPointerEnabled) return;
            this._pointerLookClient = {
                x: Number(clientX) || 0,
                y: Number(clientY) || 0
            };
        }

        _updatePointerLookFromClientPosition() {
            if (!this._lookAtPointerEnabled || !this.canvasEl || !this.camera) return;
            if (!this._pointerLookClient) return;
            var rect = this.canvasEl.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            var headPose = this._getPointerLookHeadPose();
            if (!headPose) return;

            this.camera.updateMatrixWorld(true);
            if (this._rootGroup) {
                this._rootGroup.updateMatrixWorld(true);
            }

            var ndc = new THREE.Vector2(
                ((this._pointerLookClient.x - rect.left) / rect.width) * 2 - 1,
                -(((this._pointerLookClient.y - rect.top) / rect.height) * 2 - 1)
            );
            this._raycaster.setFromCamera(ndc, this.camera);

            var headWorld = headPose.worldPosition;
            var ray = this._raycaster.ray;
            var planeNormal = new THREE.Vector3();
            this.camera.getWorldDirection(planeNormal);
            var cameraWorld = new THREE.Vector3();
            this.camera.getWorldPosition(cameraWorld);
            var cameraToHead = headWorld.clone().sub(cameraWorld);
            var headDepth = Math.max(1, planeNormal.dot(cameraToHead));
            var depthBias = Math.max(4, ((this._modelSize && Math.max(this._modelSize[0] || 0, this._modelSize[1] || 0, this._modelSize[2] || 0)) || 16) * 0.35);
            var planeDepth = Math.max(2, headDepth - depthBias);
            var planePoint = cameraWorld.clone().add(planeNormal.clone().multiplyScalar(planeDepth));
            var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);
            var targetWorld = new THREE.Vector3();
            if (!ray.intersectPlane(plane, targetWorld)) {
                var fallbackDistance = Math.max(8, planeDepth);
                targetWorld.copy(ray.origin).add(ray.direction.clone().multiplyScalar(fallbackDistance));
            }

            var parent = headPose.parent;
            var headLocal = parent.worldToLocal(headWorld.clone());
            var targetLocal = parent.worldToLocal(targetWorld.clone());
            var localVector = targetLocal.sub(headLocal);
            var horizontal = Math.sqrt((localVector.x * localVector.x) + (localVector.z * localVector.z));
            if (horizontal < 0.0001 && Math.abs(localVector.y) < 0.0001) return;

            var yaw = THREE.MathUtils.radToDeg(Math.atan2(localVector.x, -localVector.z));
            var pitch = THREE.MathUtils.radToDeg(Math.atan2(localVector.y, Math.max(horizontal, 0.0001)));

            this._pointerLookTarget = {
                yaw: Math.max(-110, Math.min(110, yaw)),
                pitch: Math.max(-50, Math.min(50, pitch))
            };
        }

        _updatePointerLookState() {
            var target = this._lookAtPointerEnabled ? this._pointerLookTarget : { yaw: 0, pitch: 0 };
            this._pointerLookCurrent.yaw += (target.yaw - this._pointerLookCurrent.yaw) * 0.45;
            this._pointerLookCurrent.pitch += (target.pitch - this._pointerLookCurrent.pitch) * 0.45;
        }

        _applyPointerLookOverride(boneName, bone, group, rotation) {
            if (!this._lookAtPointerEnabled || !Array.isArray(rotation)) return;
            if (this._normalizeHumanBoneName(boneName) !== 'head') return;
            var pointerLook = this._pointerLookCurrent || { yaw: 0, pitch: 0 };
            var baseRotation = bone && Array.isArray(bone.rotation) ? bone.rotation : [0, 0, 0];
            rotation[0] = (Number(baseRotation[0]) || 0) - pointerLook.pitch;
            rotation[1] = (Number(baseRotation[1]) || 0) + pointerLook.yaw;
        }

        _getPointerLookHeadPose() {
            if (!this._lookAtPointerEnabled || !this.camera) return null;
            var headGroup = this._findPointerLookHeadGroup();
            if (!headGroup) return null;
            var worldPosition = new THREE.Vector3();
            headGroup.getWorldPosition(worldPosition);
            return {
                group: headGroup,
                parent: headGroup.parent || this._rootGroup || this.scene,
                worldPosition: worldPosition
            };
        }

        _findPointerLookHeadGroup() {
            if (!this._boneGroups) return null;
            if (this._boneGroups.head) return this._boneGroups.head;
            var keys = Object.keys(this._boneGroups);
            for (var i = 0; i < keys.length; i++) {
                if (this._normalizeHumanBoneName(keys[i]) === 'head') {
                    return this._boneGroups[keys[i]];
                }
            }
            return null;
        }

        _getPreviewPresetState(selection, time) {
            if (!selection || selection.indexOf('__action__:') !== 0) {
                return ModelViewer._buildPreviewPresetState(null, time);
            }
            return ModelViewer._buildPreviewPresetState(selection.slice(11), time);
        }

        async _loadTexture(texturePath, project) {
            if (!texturePath) { console.log('[UV] _loadTexture: no texturePath'); return null; }
            console.log('[UV] _loadTexture: loading', texturePath);
            var blobUrl = await project.getTextureBlobUrl(texturePath);
            console.log('[UV] _loadTexture: blobUrl =', blobUrl ? blobUrl.substring(0, 80) + '...' : 'null');
            if (!blobUrl) return null;
            return new Promise((resolve) => {
                new THREE.TextureLoader().load(blobUrl, (tex) => {
                    tex.magFilter = THREE.NearestFilter;
                    tex.minFilter = THREE.NearestFilter;
                    tex.flipY = true;
                    tex.generateMipmaps = false;
                    tex.wrapS = THREE.ClampToEdgeWrapping;
                    tex.wrapT = THREE.ClampToEdgeWrapping;
                    tex.needsUpdate = true;
                    console.log('[UV] _loadTexture: loaded', tex.image ? tex.image.width + 'x' + tex.image.height : 'no image');
                    resolve(tex);
                }, undefined, (err) => { console.error('[UV] _loadTexture: FAILED', err); resolve(null); });
            });
        }

        // ================================================================
        //  Bone Hierarchy — for skeleton editing
        // ================================================================

        /**
         * Get texture dimensions from geometry data and loaded texture
         */
        _getTextureDimensions(geoData, texture) {
            if (texture && texture.image) {
                return { w: texture.image.width, h: texture.image.height };
            }
            if (geoData.texturewidth !== undefined) {
                return { w: geoData.texturewidth, h: geoData.textureheight };
            }
            if (geoData.texture_width !== undefined) {
                return { w: geoData.texture_width, h: geoData.texture_height };
            }
            if (geoData.description) {
                return {
                    w: geoData.description.texture_width || 64,
                    h: geoData.description.texture_height || 64
                };
            }
            return { w: 64, h: 64 };
        }

        /**
         * Compute bounding box of all cube corners across all bones.
         * Used for centering the model.
         */
        _computeGeoBounds(geoData) {
            var minX = Infinity, minY = Infinity, minZ = Infinity;
            var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

            var bones = geoData.bones || [];
            for (var b = 0; b < bones.length; b++) {
                var bone = bones[b];
                var cubes = bone.cubes || [];
                for (var c = 0; c < cubes.length; c++) {
                    var cube = cubes[c];
                    var o = cube.origin || [0, 0, 0];
                    var s = cube.size || [1, 1, 1];
                    var inf = cube.inflate || 0;
                    if (o[0] - inf < minX) minX = o[0] - inf;
                    if (o[1] - inf < minY) minY = o[1] - inf;
                    if (o[2] - inf < minZ) minZ = o[2] - inf;
                    if (o[0] + s[0] + inf > maxX) maxX = o[0] + s[0] + inf;
                    if (o[1] + s[1] + inf > maxY) maxY = o[1] + s[1] + inf;
                    if (o[2] + s[2] + inf > maxZ) maxZ = o[2] + s[2] + inf;
                }
                // Also handle poly_mesh
                if (bone.poly_mesh && bone.poly_mesh.positions) {
                    var verts = bone.poly_mesh.positions;
                    for (var vi = 0; vi < verts.length; vi++) {
                        var v = verts[vi];
                        if (v[0] < minX) minX = v[0];
                        if (v[1] < minY) minY = v[1];
                        if (v[2] < minZ) minZ = v[2];
                        if (v[0] > maxX) maxX = v[0];
                        if (v[1] > maxY) maxY = v[1];
                        if (v[2] > maxZ) maxZ = v[2];
                    }
                }
            }

            if (!isFinite(minX)) return null;
            return {
                min: [minX, minY, minZ],
                max: [maxX, maxY, maxZ],
                center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
                size: [maxX - minX, maxY - minY, maxZ - minZ]
            };
        }

        /**
         * Build a hierarchical THREE.Group structure from Bedrock geometry.
         * Each bone becomes a THREE.Group positioned at its pivot.
         * Cubes are offset relative to the bone's pivot.
         *
         * @returns {{ root: THREE.Group, boneGroups: Object, materials: Object }} or null
         */
        _buildBoneHierarchy(geoData, texture, skipCentering) {
            if (!geoData || !geoData.bones || geoData.bones.length === 0) return null;

            var texDim = this._getTextureDimensions(geoData, texture);
            var texW = texDim.w, texH = texDim.h;

            var root = new THREE.Group();
            var boneGroups = {};
            var boneMaterials = {};

            // Base material shared options
            var baseMatOptions = {
                transparent: true,
                alphaTest: 0.1,
                side: THREE.DoubleSide,
                roughness: 0.9,
                metalness: 0.0
            };

            // --- Pass 1: Create bone groups ---
            var bones = geoData.bones;
            for (var b = 0; b < bones.length; b++) {
                var bone = bones[b];
                var group = new THREE.Group();
                group.name = bone.name || ('bone_' + b);
                group.rotation.order = 'ZYX';

                // Pivot position in Three.js space (X negated)
                var pivot = bone.pivot || [0, 0, 0];
                group.position.set(-pivot[0], pivot[1], pivot[2]);

                // Rotation in degrees → radians, Z negated
                var rot = bone.rotation || [0, 0, 0];
                group.rotation.set(
                    -rot[0] * Math.PI / 180,
                    -rot[1] * Math.PI / 180,
                    rot[2] * Math.PI / 180
                );

                // Create per-bone material for independent highlighting
                var mat = new THREE.MeshStandardMaterial(
                    Object.assign({}, baseMatOptions, {
                        color: 0xffffff,
                        map: texture
                    })
                );
                boneMaterials[bone.name || ('bone_' + b)] = mat;

                boneGroups[bone.name || ('bone_' + b)] = group;
                root.add(group);
            }

            // --- Pass 2: Set parent relationships ---
            // Store absolute pivot positions before reparenting
            // (When a bone becomes a child, its position must be relative to parent's pivot)
            var absolutePositions = {};
            for (var bp = 0; bp < bones.length; bp++) {
                var bpName = bones[bp].name || ('bone_' + bp);
                absolutePositions[bpName] = boneGroups[bpName].position.clone();
            }
            for (var b2 = 0; b2 < bones.length; b2++) {
                var bone2 = bones[b2];
                var bName = bone2.name || ('bone_' + b2);
                if (bone2.parent && boneGroups[bone2.parent]) {
                    var parentAbsPos = absolutePositions[bone2.parent];
                    root.remove(boneGroups[bName]);
                    // Convert child position from absolute to relative-to-parent
                    boneGroups[bName].position.x -= parentAbsPos.x;
                    boneGroups[bName].position.y -= parentAbsPos.y;
                    boneGroups[bName].position.z -= parentAbsPos.z;
                    boneGroups[bone2.parent].add(boneGroups[bName]);
                }
            }

            // --- Pass 3: Build cube meshes for each bone ---
            for (var b3 = 0; b3 < bones.length; b3++) {
                var bone3 = bones[b3];
                var bName3 = bone3.name || ('bone_' + b3);
                var group3 = boneGroups[bName3];
                var mat3 = boneMaterials[bName3];
                var pivot3 = bone3.pivot || [0, 0, 0];

                // Cubes
                if (bone3.cubes) {
                    for (var c = 0; c < bone3.cubes.length; c++) {
                        var cube = bone3.cubes[c];
                        var cubeData = ModelViewer._generateCubeGeometry(
                            cube,
                            texW,
                            texH,
                            bone3.mirror === true
                        );
                        if (!cubeData || cubeData.positions.length === 0) continue;

                        var geometry = new THREE.BufferGeometry();
                        geometry.setAttribute('position', new THREE.Float32BufferAttribute(cubeData.positions, 3));
                        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(cubeData.normals, 3));
                        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(cubeData.uvs, 2));
                        geometry.setIndex(cubeData.indices);

                        // Offset positions relative to bone pivot
                        var posAttr = geometry.attributes.position;
                        for (var i = 0; i < posAttr.count; i++) {
                            posAttr.setX(i, posAttr.getX(i) + pivot3[0]);
                            posAttr.setY(i, posAttr.getY(i) - pivot3[1]);
                            posAttr.setZ(i, posAttr.getZ(i) - pivot3[2]);
                        }
                        posAttr.needsUpdate = true;

                        var mesh = new THREE.Mesh(geometry, mat3);
                        mesh.userData.boneName = bName3;
                        group3.add(mesh);
                    }
                }

                // Poly Mesh
                if (bone3.poly_mesh) {
                    var pmData = this._buildPolyMeshGeometry(bone3.poly_mesh, texW, texH, pivot3);
                    if (pmData) {
                        var mesh2 = new THREE.Mesh(pmData, mat3);
                        mesh2.userData.boneName = bName3;
                        group3.add(mesh2);
                    }
                }
            }

            // --- Center the model ---
            if (!skipCentering) {
                var bounds = this._computeGeoBounds(geoData);
                if (bounds) {
                    // Position root group so model is centered horizontally, feet at y=0
                    root.position.set(-bounds.center[0], -bounds.min[1], bounds.center[2]);
                    // Store model center and size for camera tracking
                    this._modelCenter = [0, bounds.size[1] / 2, 0];
                    this._modelSize = bounds.size;
                }
            }

            return { root: root, boneGroups: boneGroups, materials: boneMaterials };
        }

        /**
         * Build BufferGeometry for a bone's poly_mesh data, offset by pivot
         */
        _buildPolyMeshGeometry(polyMesh, texW, texH, pivot) {
            var verts = polyMesh.positions || [];
            var uvData = polyMesh.uvs || [];
            var polys = polyMesh.polys || [];
            var normalized = polyMesh.normalized_uvs !== false;
            var normalPlan = this._resolvePolyMeshNormals(polyMesh, polys);

            if (verts.length === 0 || polys.length === 0) return null;

            var positions = [];
            var normals = [];
            var uvs = [];
            var indices = [];
            var idx = 0;

            for (var pi = 0; pi < polys.length; pi++) {
                var poly = polys[pi];
                if (!Array.isArray(poly) || poly.length < 3) continue;
                for (var ti = 1; ti < poly.length - 1; ti++) {
                    var tri = [poly[0], poly[ti], poly[ti + 1]];
                    for (var ci = 0; ci < tri.length; ci++) {
                        var corner = tri[ci];
                        var vIdx = corner[0] || 0;
                        var uvIdx = corner[2] !== undefined ? corner[2] : 0;
                        var v = verts[vIdx] || [0, 0, 0];
                        // Offset by pivot
                        positions.push(-(v[0] - pivot[0]), v[1] - pivot[1], v[2] - pivot[2]);
                        if (normalPlan.useSourceNormals) {
                            var nIdx = corner[1] !== undefined ? corner[1] : 0;
                            var nrm = normalPlan.normals[nIdx] || [0, 1, 0];
                            normals.push(-nrm[0], nrm[1], nrm[2]);
                        }
                        var uv = uvData[uvIdx] || [0, 0];
                        var uu = uv[0], vv = uv[1];
                        if (normalized) { uu *= texW; vv *= texH; }
                        uvs.push(uu / texW, vv / texH);
                        indices.push(idx++);
                    }
                }
            }

            if (positions.length === 0) return null;

            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geometry.setIndex(indices);
            if (normalPlan.useSourceNormals) {
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            } else {
                geometry.computeVertexNormals();
            }
            return geometry;
        }

        _resolvePolyMeshNormals(polyMesh, polys) {
            var mode = this._polyMeshNormalMode;
            if (mode === 'recalculate') {
                return { useSourceNormals: false, normals: [] };
            }

            var sourceNormals = Array.isArray(polyMesh && polyMesh.normals) ? polyMesh.normals : [];
            if (!sourceNormals.length) {
                return { useSourceNormals: false, normals: [] };
            }

            var normalizedNormals = new Array(sourceNormals.length);
            for (var i = 0; i < sourceNormals.length; i++) {
                var normal = sourceNormals[i];
                if (!Array.isArray(normal) || normal.length < 3) {
                    return { useSourceNormals: false, normals: [] };
                }
                var nx = Number(normal[0]);
                var ny = Number(normal[1]);
                var nz = Number(normal[2]);
                if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
                    return { useSourceNormals: false, normals: [] };
                }
                var length = Math.sqrt((nx * nx) + (ny * ny) + (nz * nz));
                if (length < 1e-5) {
                    return { useSourceNormals: false, normals: [] };
                }
                normalizedNormals[i] = [nx / length, ny / length, nz / length];
            }

            var cornersChecked = 0;
            for (var pi = 0; pi < polys.length; pi++) {
                var poly = polys[pi];
                if (!Array.isArray(poly) || poly.length < 3) continue;
                for (var ci = 0; ci < poly.length; ci++) {
                    var corner = poly[ci];
                    if (!Array.isArray(corner)) {
                        return { useSourceNormals: false, normals: [] };
                    }
                    var nIdx = corner[1] !== undefined ? corner[1] : 0;
                    if (!Number.isInteger(nIdx) || nIdx < 0 || nIdx >= normalizedNormals.length) {
                        return { useSourceNormals: false, normals: [] };
                    }
                    cornersChecked += 1;
                }
            }

            if (mode === 'source') {
                return { useSourceNormals: true, normals: normalizedNormals };
            }

            return cornersChecked > 0
                ? { useSourceNormals: true, normals: normalizedNormals }
                : { useSourceNormals: false, normals: [] };
        }

        // ================================================================
        //  Bone Editing API
        // ================================================================

        /**
         * Highlight a bone in the 3D view (emissive glow)
         */
        highlightBone(boneName) {
            this._unhighlightAll();
            this._highlightedBone = boneName;
            if (boneName && this._boneMaterials[boneName]) {
                this._boneMaterials[boneName].emissive.set(0x1a5276);
                this._boneMaterials[boneName].emissiveIntensity = 0.4;
            }
            if (this._transformControls) {
                this._syncTransformControls();
            }
        }

        /**
         * Remove all bone highlighting
         */
        _unhighlightAll() {
            this._highlightedBone = null;
            for (var name in this._boneMaterials) {
                this._boneMaterials[name].emissive.set(0x000000);
                this._boneMaterials[name].emissiveIntensity = 0;
            }
            if (this._transformControls) {
                this._transformControls.detach();
                this._transformControls.visible = false;
            }
        }

        /**
         * Update a bone's pivot/origin while keeping the visible model position stable.
         * @param {string} boneName - Bone name
         * @param {number[]} pivot - New pivot [x, y, z]
         * @param {string} geoId - Geometry identifier
         * @param {Object} geoData - The full geometry data object
         */
        updateBonePivot(boneName, pivot, geoId, geoData) {
            if (!this._boneGroups[boneName]) return;

            var bone = this._findBone(boneName, geoData);
            if (!bone) return;

            // Calculate delta
            var oldPivot = bone.pivot || [0, 0, 0];
            var dx = pivot[0] - oldPivot[0];
            var dy = pivot[1] - oldPivot[1];
            var dz = pivot[2] - oldPivot[2];

            // Update the pivot itself.
            bone.pivot = pivot.slice();

            // Keep descendants visually in place by moving their pivots with the parent,
            // but do not move geometry data.
            this._shiftDescendantPivotsOnly(boneName, dx, dy, dz, geoData);

            // Rebuild entire hierarchy
            this._rebuildFullHierarchy(geoData);
            this._syncTransformControls();
        }

        /**
         * Move a bone and its subtree together in model space.
         */
        updateBoneTranslation(boneName, pivot, geoId, geoData) {
            if (!this._boneGroups[boneName]) return;

            var bone = this._findBone(boneName, geoData);
            if (!bone) return;

            var oldPivot = bone.pivot || [0, 0, 0];
            var dx = pivot[0] - oldPivot[0];
            var dy = pivot[1] - oldPivot[1];
            var dz = pivot[2] - oldPivot[2];

            bone.pivot = pivot.slice();

            if (bone.cubes) {
                for (var c = 0; c < bone.cubes.length; c++) {
                    var cube = bone.cubes[c];
                    var o = cube.origin || [0, 0, 0];
                    cube.origin = [o[0] + dx, o[1] + dy, o[2] + dz];
                    if (cube.pivot) {
                        cube.pivot = [cube.pivot[0] + dx, cube.pivot[1] + dy, cube.pivot[2] + dz];
                    }
                }
            }

            if (bone.poly_mesh && bone.poly_mesh.positions) {
                for (var p = 0; p < bone.poly_mesh.positions.length; p++) {
                    var pos = bone.poly_mesh.positions[p];
                    bone.poly_mesh.positions[p] = [pos[0] + dx, pos[1] + dy, pos[2] + dz];
                }
            }

            this._shiftDescendants(boneName, dx, dy, dz, geoData);
            this._rebuildFullHierarchy(geoData);
            this._syncTransformControls();
        }

        updateBoneOffset(boneName, delta, geoId, geoData) {
            if (!this._boneGroups[boneName]) return;

            var bone = this._findBone(boneName, geoData);
            if (!bone) return;

            var dx = delta[0] || 0;
            var dy = delta[1] || 0;
            var dz = -(delta[2] || 0);

            if (bone.cubes) {
                for (var c = 0; c < bone.cubes.length; c++) {
                    var cube = bone.cubes[c];
                    var o = cube.origin || [0, 0, 0];
                    cube.origin = [o[0] + dx, o[1] + dy, o[2] + dz];
                    if (cube.pivot) {
                        cube.pivot = [cube.pivot[0] + dx, cube.pivot[1] + dy, cube.pivot[2] + dz];
                    }
                }
            }

            if (bone.poly_mesh && bone.poly_mesh.positions) {
                for (var p = 0; p < bone.poly_mesh.positions.length; p++) {
                    var pos = bone.poly_mesh.positions[p];
                    bone.poly_mesh.positions[p] = [pos[0] + dx, pos[1] + dy, pos[2] + dz];
                }
            }

            this._rebuildBoneCubes(boneName, geoData);
        }

        applyBoneRotationToCubes(boneName, geoId, geoData) {
            var bone = this._findBone(boneName, geoData);
            if (!bone) return;

            var rotation = bone.rotation || [0, 0, 0];
            if (!rotation[0] && !rotation[1] && !rotation[2]) return;

            var pivot = bone.pivot || [0, 0, 0];
            var euler = new THREE.Euler(
                -rotation[0] * Math.PI / 180,
                -rotation[1] * Math.PI / 180,
                rotation[2] * Math.PI / 180,
                'ZYX'
            );

            var rotatePoint = function (point) {
                var vec = new THREE.Vector3(-(point[0] - pivot[0]), point[1] - pivot[1], point[2] - pivot[2]);
                vec.applyEuler(euler);
                return [-(vec.x - pivot[0]), vec.y + pivot[1], vec.z + pivot[2]];
            };

            if (bone.cubes) {
                for (var c = 0; c < bone.cubes.length; c++) {
                    var cube = bone.cubes[c];
                    cube.rotation = cube.rotation || [0, 0, 0];
                    cube.rotation = [
                        (cube.rotation[0] || 0) + rotation[0],
                        (cube.rotation[1] || 0) + rotation[1],
                        (cube.rotation[2] || 0) + rotation[2]
                    ];
                    if (cube.origin) {
                        cube.origin = rotatePoint(cube.origin);
                    }
                    if (cube.pivot) {
                        cube.pivot = rotatePoint(cube.pivot);
                    }
                }
            }

            if (bone.poly_mesh && bone.poly_mesh.positions) {
                for (var p = 0; p < bone.poly_mesh.positions.length; p++) {
                    bone.poly_mesh.positions[p] = rotatePoint(bone.poly_mesh.positions[p]);
                }
            }

            bone.rotation = [0, 0, 0];
            this._rebuildBoneCubes(boneName, geoData);
            if (this._boneGroups[boneName]) {
                this._boneGroups[boneName].rotation.set(0, 0, 0);
            }
        }

        rebuildSingleBoneGeometry(boneName, geoData) {
            this._rebuildBoneCubes(boneName, geoData);
        }

        /**
         * Recursively shift a bone's descendants' pivots, cube origins, and poly_mesh
         * positions so they move together with their ancestor's pivot change.
         */
        _shiftDescendants(parentName, dx, dy, dz, geoData) {
            if (!geoData || !geoData.bones) return;
            for (var i = 0; i < geoData.bones.length; i++) {
                var child = geoData.bones[i];
                if (child.parent === parentName) {
                    var childName = child.name || ('bone_' + i);
                    // Shift pivot
                    var cp = child.pivot || [0, 0, 0];
                    child.pivot = [cp[0] + dx, cp[1] + dy, cp[2] + dz];
                    // Shift cube origins
                    if (child.cubes) {
                        for (var c = 0; c < child.cubes.length; c++) {
                            var cube = child.cubes[c];
                            var o = cube.origin || [0, 0, 0];
                            cube.origin = [o[0] + dx, o[1] + dy, o[2] + dz];
                            if (cube.pivot) {
                                cube.pivot = [cube.pivot[0] + dx, cube.pivot[1] + dy, cube.pivot[2] + dz];
                            }
                        }
                    }
                    // Shift poly_mesh positions
                    if (child.poly_mesh && child.poly_mesh.positions) {
                        for (var p = 0; p < child.poly_mesh.positions.length; p++) {
                            var pos = child.poly_mesh.positions[p];
                            child.poly_mesh.positions[p] = [pos[0] + dx, pos[1] + dy, pos[2] + dz];
                        }
                    }
                    // Recurse
                    this._shiftDescendants(childName, dx, dy, dz, geoData);
                }
            }
        }

        _shiftDescendantPivotsOnly(parentName, dx, dy, dz, geoData) {
            if (!geoData || !geoData.bones) return;
            for (var i = 0; i < geoData.bones.length; i++) {
                var child = geoData.bones[i];
                if (child.parent === parentName) {
                    var childName = child.name || ('bone_' + i);
                    var cp = child.pivot || [0, 0, 0];
                    child.pivot = [cp[0] + dx, cp[1] + dy, cp[2] + dz];
                    this._shiftDescendantPivotsOnly(childName, dx, dy, dz, geoData);
                }
            }
        }

        _updateDescendantGroupPositions(parentName, dx, dy, dz, geoData) {
            if (!geoData || !geoData.bones) return;
            for (var i = 0; i < geoData.bones.length; i++) {
                var child = geoData.bones[i];
                if (child.parent === parentName) {
                    var childName = child.name || ('bone_' + i);
                    var group = this._boneGroups[childName];
                    if (group) {
                        group.position.set(group.position.x - dx, group.position.y + dy, group.position.z + dz);
                    }
                    this._updateDescendantGroupPositions(childName, dx, dy, dz, geoData);
                }
            }
        }

        /**
         * Update a bone's rotation in real-time.
         * @param {string} boneName - Bone name
         * @param {number[]} rotation - New rotation [x, y, z] in degrees
         * @param {string} geoId - Geometry identifier
         * @param {Object} geoData - The full geometry data object
         */
        updateBoneRotation(boneName, rotation, geoId, geoData) {
            if (!this._boneGroups[boneName]) return;

            // Update data model
            var bone = this._findBone(boneName, geoData);
            if (bone) {
                bone.rotation = rotation.slice();
            }

            // Update Three.js group rotation
            var group = this._boneGroups[boneName];
            group.rotation.set(
                -rotation[0] * Math.PI / 180,
                rotation[1] * Math.PI / 180,
                rotation[2] * Math.PI / 180
            );
        }

        /**
         * Update a bone's parent (reparent in the hierarchy).
         * @param {string} boneName - Bone name
         * @param {string|null} parentName - New parent name, or null/empty for root
         * @param {string} geoId - Geometry identifier
         * @param {Object} geoData - The full geometry data object
         */
        updateBoneParent(boneName, parentName, geoId, geoData) {
            if (!this._boneGroups[boneName]) return;

            // Update data model
            var bone = this._findBone(boneName, geoData);
            if (bone) {
                bone.parent = parentName || '';
            }

            // Reparent Three.js group
            var group = this._boneGroups[boneName];

            // Get child's current world position before detaching
            var childWorldPos = new THREE.Vector3();
            group.getWorldPosition(childWorldPos);

            if (group.parent) {
                group.parent.remove(group);
            }

            if (parentName && this._boneGroups[parentName]) {
                var newParent = this._boneGroups[parentName];

                // Force world matrix update so getWorldPosition is accurate
                this._rootGroup.updateMatrixWorld(true);

                // Get parent's world position
                var parentWorldPos = new THREE.Vector3();
                newParent.getWorldPosition(parentWorldPos);

                // Set child position relative to new parent
                group.position.copy(childWorldPos).sub(parentWorldPos);

                newParent.add(group);
            } else if (this._rootGroup) {
                // Reparenting to root: position should be absolute relative to root
                // childWorldPos is already in world space; root.position is the centering offset
                group.position.copy(childWorldPos).sub(this._rootGroup.position);
                this._rootGroup.add(group);
            }
        }

        /**
         * Add a new bone to the model.
         * @param {Object} boneData - { name, pivot, rotation, parent, cubes }
         * @param {string} geoId - Geometry identifier
         * @param {Object} geoData - The full geometry data object
         */
        addBone(boneData, geoId, geoData) {
            if (!geoData.bones) geoData.bones = [];
            if (!boneData.name) boneData.name = 'new_bone_' + geoData.bones.length;

            // Add to data model
            geoData.bones.push(boneData);

            // Rebuild entire hierarchy
            this._rebuildFullHierarchy(geoData);
        }

        /**
         * Delete a bone from the model.
         * @param {string} boneName - Bone name to delete
         * @param {string} geoId - Geometry identifier
         * @param {Object} geoData - The full geometry data object
         */
        deleteBone(boneName, geoId, geoData) {
            if (!geoData.bones) return;

            // Remove from data model
            var idx = -1;
            for (var i = 0; i < geoData.bones.length; i++) {
                if ((geoData.bones[i].name || ('bone_' + i)) === boneName) {
                    idx = i;
                    break;
                }
            }
            if (idx === -1) return;

            // Also clear any bones that reference this as parent
            for (var j = 0; j < geoData.bones.length; j++) {
                if (geoData.bones[j].parent === boneName) {
                    geoData.bones[j].parent = '';
                }
            }

            geoData.bones.splice(idx, 1);

            // Rebuild entire hierarchy
            this._unhighlightAll();
            this._rebuildFullHierarchy(geoData);
        }

        /**
         * Get list of bone names in the current geometry
         */
        getBoneNames() {
            if (!this._currentGeoData || !this._currentGeoData.bones) return [];
            return this._currentGeoData.bones.map((b, i) => b.name || ('bone_' + i));
        }

        /**
         * Get the currently loaded geometry data object
         */
        getCurrentGeoData() {
            return this._currentGeoData;
        }

        /**
         * Get the current geometry identifier
         */
        getCurrentGeoId() {
            return this._currentGeoId;
        }

        /**
         * Dump UV rectangles from actual Three.js geometries currently in scene.
         * This reflects what renderer really uses, not source JSON.
         */
        getDebugUvSnapshot(limit) {
            var maxItems = (limit && limit > 0) ? limit : 200;
            var tex = this._getTextureDimensions(this._currentGeoData || {}, this.currentTexture);
            var rows = [];

            if (!this._rootGroup) {
                return { texture: [tex.w, tex.h], rows: rows };
            }

            var meshCounter = 0;
            this._rootGroup.traverse(function (obj) {
                if (!obj || !obj.isMesh || !obj.geometry) return;
                var uvAttr = obj.geometry.getAttribute && obj.geometry.getAttribute('uv');
                if (!uvAttr || !uvAttr.array) return;

                var arr = uvAttr.array;
                var faceCounter = 0;
                for (var i = 0; i + 11 < arr.length; i += 12) {
                    var points = [];
                    var minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
                    for (var j = 0; j < 12; j += 2) {
                        var u = arr[i + j] * tex.w;
                        var v = arr[i + j + 1] * tex.h;
                        points.push([u, v]);
                        if (u < minU) minU = u;
                        if (v < minV) minV = v;
                        if (u > maxU) maxU = u;
                        if (v > maxV) maxV = v;
                    }

                    rows.push({
                        bone: obj.userData && obj.userData.boneName ? obj.userData.boneName : '(unknown)',
                        mesh: meshCounter,
                        face: faceCounter,
                        rect: [minU, minV, maxU - minU, maxV - minV],
                        points: points
                    });

                    faceCounter++;
                    if (rows.length >= maxItems) break;
                }
                meshCounter++;
            });

            return { texture: [tex.w, tex.h], rows: rows };
        }

        /**
         * Find a bone in the geometry data by name
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

        _findBoneByCanonicalName(boneName, geoData) {
            if (!geoData || !geoData.bones) return null;
            var canonical = this._normalizeHumanBoneName(boneName);
            if (!canonical) return null;
            for (var i = 0; i < geoData.bones.length; i++) {
                var currentName = geoData.bones[i].name || ('bone_' + i);
                if (this._normalizeHumanBoneName(currentName) === canonical) {
                    return geoData.bones[i];
                }
            }
            return null;
        }

        /**
         * Rebuild cube meshes for a single bone (after pivot change).
         */
        _rebuildBoneCubes(boneName, geoData) {
            var group = this._boneGroups[boneName];
            var mat = this._boneMaterials[boneName];
            if (!group || !mat || !geoData) return;

            var bone = this._findBone(boneName, geoData);
            if (!bone) return;

            // Remove existing meshes from this group
            while (group.children.length > 0) {
                var child = group.children[0];
                if (child.geometry) child.geometry.dispose();
                group.remove(child);
            }

            var texDim = this._getTextureDimensions(geoData, this.currentTexture);
            var pivot = bone.pivot || [0, 0, 0];

            // Rebuild cubes
            if (bone.cubes) {
                for (var c = 0; c < bone.cubes.length; c++) {
                    var cubeData = ModelViewer._generateCubeGeometry(
                        bone.cubes[c],
                        texDim.w,
                        texDim.h,
                        bone.mirror === true
                    );
                    if (!cubeData || cubeData.positions.length === 0) continue;

                    var geometry = new THREE.BufferGeometry();
                    geometry.setAttribute('position', new THREE.Float32BufferAttribute(cubeData.positions, 3));
                    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(cubeData.normals, 3));
                    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(cubeData.uvs, 2));
                    geometry.setIndex(cubeData.indices);

                    // Offset positions relative to new pivot
                    var posAttr = geometry.attributes.position;
                    for (var i = 0; i < posAttr.count; i++) {
                        posAttr.setX(i, posAttr.getX(i) + pivot[0]);
                        posAttr.setY(i, posAttr.getY(i) - pivot[1]);
                        posAttr.setZ(i, posAttr.getZ(i) - pivot[2]);
                    }
                    posAttr.needsUpdate = true;

                    var mesh = new THREE.Mesh(geometry, mat);
                    mesh.userData.boneName = boneName;
                    group.add(mesh);
                }
            }

            // Rebuild poly mesh
            if (bone.poly_mesh) {
                var pmData = this._buildPolyMeshGeometry(bone.poly_mesh, texDim.w, texDim.h, pivot);
                if (pmData) {
                    var mesh2 = new THREE.Mesh(pmData, mat);
                    mesh2.userData.boneName = boneName;
                    group.add(mesh2);
                }
            }

            // Restore highlight if this bone was highlighted
            if (this._highlightedBone === boneName) {
                mat.emissive.set(0x1a5276);
                mat.emissiveIntensity = 0.4;
            }
        }

        /**
         * Rebuild the entire bone hierarchy (after add/delete).
         */
        _rebuildFullHierarchy(geoData) {
            // Preserve existing root position (centering offset) so bone
            // position edits produce visible movement instead of being
            // negated by automatic re-centering.
            var savedRootPosition = null;
            if (this._rootGroup) {
                savedRootPosition = this._rootGroup.position.clone();
            }

            if (this._rootGroup) {
                this.scene.remove(this._rootGroup);
                this._rootGroup.traverse((obj) => {
                    if (obj.geometry) obj.geometry.dispose();
                });
            }

            // Dispose old bone materials (but not the shared texture)
            for (var name in this._boneMaterials) {
                this._boneMaterials[name].dispose();
            }

            // Rebuild hierarchy WITHOUT re-centering (skipCentering=true)
            var result = this._buildBoneHierarchy(geoData, this.currentTexture, true);
            if (!result) return;

            this._rootGroup = result.root;
            this._boneGroups = result.boneGroups;
            this._boneMaterials = result.materials;
            this._currentGeoData = geoData;

            // Restore the saved centering offset so visual position is preserved
            if (savedRootPosition) {
                this._rootGroup.position.copy(savedRootPosition);
            }

            this.scene.add(this._rootGroup);
            this._syncOriginHelperParent();

            if (this._transformControls) {
                this._syncTransformControls();
            }

            // Update camera frustum after rebuild
            this._updateFrustum();
        }

        // ================================================================
        //  Flat Mesh — for thumbnails (no bone hierarchy, single mesh)
        // ================================================================

        /**
         * Build Three.js BufferGeometry from Bedrock geometry model data.
         * Flat mesh approach — all bones combined into one geometry.
         * Used for offscreen thumbnail rendering.
         */
        _buildMesh(geoData, texture) {
            if (!geoData || !geoData.bones || geoData.bones.length === 0) return null;

            var allPositions = [];
            var allNormals = [];
            var allUVs = [];
            var allIndices = [];
            var globalIndex = 0;

            var texDim = this._getTextureDimensions(geoData, texture);
            var texW = texDim.w, texH = texDim.h;

            var bones = geoData.bones;
            for (var b = 0; b < bones.length; b++) {
                var bone = bones[b];

                if (bone.cubes) {
                    for (var c = 0; c < bone.cubes.length; c++) {
                        var data = ModelViewer._generateCubeGeometry(
                            bone.cubes[c],
                            texW,
                            texH,
                            bone.mirror === true
                        );
                        for (var p = 0; p < data.positions.length; p++) allPositions.push(data.positions[p]);
                        for (var n = 0; n < data.normals.length; n++) allNormals.push(data.normals[n]);
                        for (var u = 0; u < data.uvs.length; u++) allUVs.push(data.uvs[u]);
                        for (var idx = 0; idx < data.indices.length; idx++) {
                            allIndices.push(data.indices[idx] + globalIndex);
                        }
                        globalIndex += (data.positions.length / 3);
                    }
                }

                if (bone.poly_mesh) {
                    var pm = bone.poly_mesh;
                    var verts = pm.positions || [];
                    var uvData = pm.uvs || [];
                    var polys = pm.polys || [];
                    var normalized = pm.normalized_uvs !== false;
                    var normalPlan = this._resolvePolyMeshNormals(pm, polys);

                    if (verts.length > 0 && polys.length > 0) {
                        for (var pi = 0; pi < polys.length; pi++) {
                            var poly = polys[pi];
                            if (!Array.isArray(poly) || poly.length < 3) continue;
                            for (var ti = 1; ti < poly.length - 1; ti++) {
                                var tri = [poly[0], poly[ti], poly[ti + 1]];
                                for (var ci = 0; ci < tri.length; ci++) {
                                    var corner = tri[ci];
                                    var vIdx = corner[0] || 0;
                                    var uvIdx = corner[2] !== undefined ? corner[2] : 0;
                                    var v = verts[vIdx] || [0, 0, 0];
                                    allPositions.push(v[0], v[1], -v[2]);
                                    if (normalPlan.useSourceNormals) {
                                        var nIdx = corner[1] !== undefined ? corner[1] : 0;
                                        var nrm = normalPlan.normals[nIdx] || [0, 1, 0];
                                        allNormals.push(nrm[0], nrm[1], -nrm[2]);
                                    }
                                    var uv = uvData[uvIdx] || [0, 0];
                                    var uu = uv[0], vv = uv[1];
                                    if (normalized) { uu *= texW; vv *= texH; }
                                    allUVs.push(uu / texW, vv / texH);
                                    allIndices.push(globalIndex++);
                                }
                            }
                        }
                    }
                }
            }

            if (allPositions.length === 0) return null;

            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(allUVs, 2));
            geometry.setIndex(allIndices);
            if (allNormals.length === allPositions.length) {
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
            } else {
                geometry.computeVertexNormals();
            }

            // Center the model so feet are at y=0
            geometry.computeBoundingBox();
            var box = geometry.boundingBox;
            var center = box.getCenter(new THREE.Vector3());
            var size = box.getSize(new THREE.Vector3());
            var posAttr = geometry.attributes.position;
            for (var i = 0; i < posAttr.count; i++) {
                posAttr.setXYZ(i,
                    posAttr.getX(i) - center.x,
                    posAttr.getY(i) - center.y + (size.y / 2),
                    posAttr.getZ(i) - center.z
                );
            }
            posAttr.needsUpdate = true;

            return geometry;
        }

        /**
         * Generate cube face geometry — matches Bedrock entity model format.
         * Reference: 4dskinmerge implementation (no pivot transforms).
         */
        static _generateCubeGeometry(cube, texW, texH, boneMirror) {
            var ox = (cube.origin || [0, 0, 0])[0];
            var oy = (cube.origin || [0, 0, 0])[1];
            var oz = (cube.origin || [0, 0, 0])[2];
            var sx = (cube.size || [1, 1, 1])[0];
            var sy = (cube.size || [1, 1, 1])[1];
            var sz = (cube.size || [1, 1, 1])[2];
            var boxUvSx = Math.max(0, Math.floor(sx + 0.0000001));
            var boxUvSy = Math.max(0, Math.floor(sy + 0.0000001));
            var boxUvSz = Math.max(0, Math.floor(sz + 0.0000001));
            var inf = cube.inflate || 0;
            var cubePivot = cube.pivot || null;
            var cubeRotation = cube.rotation || null;

            var verts = [
                [ox - inf, oy - inf, oz + sz + inf],
                [ox + sx + inf, oy - inf, oz + sz + inf],
                [ox + sx + inf, oy + sy + inf, oz + sz + inf],
                [ox - inf, oy + sy + inf, oz + sz + inf],
                [ox - inf, oy - inf, oz - inf],
                [ox + sx + inf, oy - inf, oz - inf],
                [ox + sx + inf, oy + sy + inf, oz - inf],
                [ox - inf, oy + sy + inf, oz - inf]
            ];

            var faceNormals = [
                [0, 0, -1], // North
                [1, 0, 0],  // East
                [0, 0, 1],  // South
                [-1, 0, 0], // West
                [0, 1, 0],  // Up
                [0, -1, 0]  // Down
            ];

            // Bedrock geometry uses an X-flipped coordinate mapping in Blockbench's
            // preview/model space. Apply that once here so cube, bone, and poly_mesh
            // all live in the same internal coordinate system.
            for (var tv = 0; tv < verts.length; tv++) {
                verts[tv] = [-verts[tv][0], verts[tv][1], verts[tv][2]];
            }
            for (var tn = 0; tn < faceNormals.length; tn++) {
                faceNormals[tn] = [-faceNormals[tn][0], faceNormals[tn][1], faceNormals[tn][2]];
            }

            if (cubePivot && cubeRotation && (cubeRotation[0] || cubeRotation[1] || cubeRotation[2])) {
                var pivotX = -(cubePivot[0] || 0);
                var pivotY = cubePivot[1] || 0;
                var pivotZ = cubePivot[2] || 0;
                var euler = new THREE.Euler(
                    -(cubeRotation[0] || 0) * Math.PI / 180,
                    -(cubeRotation[1] || 0) * Math.PI / 180,
                    (cubeRotation[2] || 0) * Math.PI / 180,
                    'ZYX'
                );

                for (var rv = 0; rv < verts.length; rv++) {
                    var vert = verts[rv];
                    var rotated = new THREE.Vector3(
                        vert[0] - pivotX,
                        vert[1] - pivotY,
                        vert[2] - pivotZ
                    );
                    rotated.applyEuler(euler);
                    verts[rv] = [
                        rotated.x + pivotX,
                        rotated.y + pivotY,
                        rotated.z + pivotZ
                    ];
                }

                for (var rn = 0; rn < faceNormals.length; rn++) {
                    var normal = new THREE.Vector3(
                        faceNormals[rn][0],
                        faceNormals[rn][1],
                        faceNormals[rn][2]
                    );
                    normal.applyEuler(euler);
                    faceNormals[rn] = [normal.x, normal.y, normal.z];
                }
            }

            var faceKeys = ['north', 'east', 'south', 'west', 'up', 'down'];
            var faceIndices = [
                [4, 5, 6, 7], // North
                [1, 5, 6, 2], // East
                [1, 0, 3, 2], // South
                [4, 0, 3, 7], // West
                [3, 2, 6, 7], // Up
                [4, 5, 1, 0]  // Down
            ];

            var effectiveMirror = (cube.mirror !== undefined) ? !!cube.mirror : !!boneMirror;

            // Determine UV layout: per-face object or box UV array
            var uvData = cube.uv;
            var usePerFaceUv = (uvData && typeof uvData === 'object' && !Array.isArray(uvData));
            var faces;
            var faceCornerOrders = null;
            var explicitCornerUVs = null;

            if (usePerFaceUv) {
                // Per-face UV: each face specifies its own uv rect
                // Format: { north: { uv: [u,v], uv_size: [w,h] }, ... }
                faces = [];
                faceCornerOrders = [
                    [0, 1, 2, 3],
                    [0, 1, 2, 3],
                    [0, 1, 2, 3],
                    [0, 1, 2, 3],
                    [0, 1, 2, 3],
                    [0, 1, 2, 3]
                ];
                for (var fi = 0; fi < 6; fi++) {
                    var fkey = faceKeys[fi];
                    var defaultW = (fi === 1 || fi === 3) ? sz : sx;
                    var defaultH = (fi === 4 || fi === 5) ? sz : sy;
                    var fuv = uvData[fkey] || {};
                    var uvXY = Array.isArray(fuv.uv) ? fuv.uv : [0, 0];
                    var uvWH = Array.isArray(fuv.uv_size) ? fuv.uv_size : [defaultW, defaultH];
                    if (!fuv || !fuv.uv) {
                        console.warn('[UV] Per-face UV missing for', fkey, 'on cube', JSON.stringify(cube.origin), JSON.stringify(cube.size), '— using defaults');
                    }
                    faces.push({ fi: faceIndices[fi], u: uvXY[0], v: uvXY[1], w: uvWH[0], h: uvWH[1] });
                }
            } else {
                // Box UV: follow Blockbench/Bedrock face layout so the 3D preview,
                // UV overlay, and exported edits all agree on face slots and winding.
                var uvx = (uvData || [0, 0])[0];
                var uvy = (uvData || [0, 0])[1];
                var boxLayout = {
                    east:  { x1: uvx,                                  y1: uvy + boxUvSz, x2: uvx + boxUvSz,                            y2: uvy + boxUvSz + boxUvSy },
                    west:  { x1: uvx + boxUvSz + boxUvSx,              y1: uvy + boxUvSz, x2: uvx + boxUvSz + boxUvSx + boxUvSz,      y2: uvy + boxUvSz + boxUvSy },
                    up:    { x1: uvx + boxUvSz + boxUvSx,              y1: uvy + boxUvSz, x2: uvx + boxUvSz,                            y2: uvy },
                    down:  { x1: uvx + boxUvSz + (2 * boxUvSx),        y1: uvy,           x2: uvx + boxUvSz + boxUvSx,                  y2: uvy + boxUvSz },
                    south: { x1: uvx + (2 * boxUvSz) + boxUvSx,        y1: uvy + boxUvSz, x2: uvx + (2 * boxUvSz) + (2 * boxUvSx),    y2: uvy + boxUvSz + boxUvSy },
                    north: { x1: uvx + boxUvSz,                        y1: uvy + boxUvSz, x2: uvx + boxUvSz + boxUvSx,                  y2: uvy + boxUvSz + boxUvSy }
                };

                if (effectiveMirror) {
                    for (var layoutKey in boxLayout) {
                        if (!Object.prototype.hasOwnProperty.call(boxLayout, layoutKey)) continue;
                        var layout = boxLayout[layoutKey];
                        var mirroredX = layout.x2;
                        layout.x2 = layout.x1;
                        layout.x1 = mirroredX;
                    }
                    var eastLayout = {
                        x1: boxLayout.east.x1,
                        y1: boxLayout.east.y1,
                        x2: boxLayout.east.x2,
                        y2: boxLayout.east.y2
                    };
                    boxLayout.east.x1 = boxLayout.west.x1;
                    boxLayout.east.y1 = boxLayout.west.y1;
                    boxLayout.east.x2 = boxLayout.west.x2;
                    boxLayout.east.y2 = boxLayout.west.y2;
                    boxLayout.west.x1 = eastLayout.x1;
                    boxLayout.west.y1 = eastLayout.y1;
                    boxLayout.west.x2 = eastLayout.x2;
                    boxLayout.west.y2 = eastLayout.y2;
                }

                faces = [
                    { fi: faceIndices[0] },
                    { fi: faceIndices[1] },
                    { fi: faceIndices[2] },
                    { fi: faceIndices[3] },
                    { fi: faceIndices[4] },
                    { fi: faceIndices[5] }
                ];
                explicitCornerUVs = [
                    [ // North
                        [boxLayout.north.x2, boxLayout.north.y2],
                        [boxLayout.north.x1, boxLayout.north.y2],
                        [boxLayout.north.x1, boxLayout.north.y1],
                        [boxLayout.north.x2, boxLayout.north.y1]
                    ],
                    [ // East
                        [boxLayout.east.x1, boxLayout.east.y2],
                        [boxLayout.east.x2, boxLayout.east.y2],
                        [boxLayout.east.x2, boxLayout.east.y1],
                        [boxLayout.east.x1, boxLayout.east.y1]
                    ],
                    [ // South
                        [boxLayout.south.x2, boxLayout.south.y2],
                        [boxLayout.south.x1, boxLayout.south.y2],
                        [boxLayout.south.x1, boxLayout.south.y1],
                        [boxLayout.south.x2, boxLayout.south.y1]
                    ],
                    [ // West
                        [boxLayout.west.x1, boxLayout.west.y2],
                        [boxLayout.west.x2, boxLayout.west.y2],
                        [boxLayout.west.x2, boxLayout.west.y1],
                        [boxLayout.west.x1, boxLayout.west.y1]
                    ],
                    [ // Up
                        [boxLayout.up.x1, boxLayout.up.y2],
                        [boxLayout.up.x2, boxLayout.up.y2],
                        [boxLayout.up.x2, boxLayout.up.y1],
                        [boxLayout.up.x1, boxLayout.up.y1]
                    ],
                    [ // Down
                        [boxLayout.down.x1, boxLayout.down.y2],
                        [boxLayout.down.x2, boxLayout.down.y2],
                        [boxLayout.down.x2, boxLayout.down.y1],
                        [boxLayout.down.x1, boxLayout.down.y1]
                    ]
                ];
            }

            var positions = [];
            var normals = [];
            var uvs = [];
            var indices = [];
            var idx = 0;

            for (var f = 0; f < faces.length; f++) {
                var face = faces[f];
                var triOrder = [0, 1, 2, 0, 2, 3];
                var cornerUVs;
                if (explicitCornerUVs && explicitCornerUVs[f]) {
                    cornerUVs = explicitCornerUVs[f];
                    if (!usePerFaceUv) {
                        var minU = Infinity;
                        var maxU = -Infinity;
                        var minV = Infinity;
                        var maxV = -Infinity;
                        for (var cu = 0; cu < cornerUVs.length; cu++) {
                            minU = Math.min(minU, cornerUVs[cu][0]);
                            maxU = Math.max(maxU, cornerUVs[cu][0]);
                            minV = Math.min(minV, cornerUVs[cu][1]);
                            maxV = Math.max(maxV, cornerUVs[cu][1]);
                        }
                        var bleedMargin = 1 / 64;
                        cornerUVs = cornerUVs.map(function (point) {
                            return [
                                point[0] === minU ? (point[0] + bleedMargin) : (point[0] - bleedMargin),
                                point[1] === minV ? (point[1] + bleedMargin) : (point[1] - bleedMargin)
                            ];
                        });
                    }
                } else {
                    var u1 = face.u, v1 = face.v;
                    var u2 = face.u + face.w, v2 = face.v + face.h;
                    var rectCornerUVs = [
                        [u1, v1],
                        [u2, v1],
                        [u2, v2],
                        [u1, v2]
                    ];
                    var order = faceCornerOrders && faceCornerOrders[f] ? faceCornerOrders[f] : [0, 1, 2, 3];
                    cornerUVs = [
                        rectCornerUVs[order[0]],
                        rectCornerUVs[order[1]],
                        rectCornerUVs[order[2]],
                        rectCornerUVs[order[3]]
                    ];
                }
                var fn = faceNormals[f];

                for (var t = 0; t < triOrder.length; t++) {
                    var vi = triOrder[t];
                    var vert = verts[face.fi[vi]];
                    positions.push(vert[0], vert[1], vert[2]);
                    normals.push(fn[0], fn[1], fn[2]);
                    var uv = cornerUVs[vi];
                    // Box UV needs a V flip for the texture pipeline here.
                    // Per-face UV data already uses top-left atlas coordinates in the editor,
                    // so it must follow the same preview convention instead of being inverted.
                    var finalV = 1 - (uv[1] / texH);
                    uvs.push(uv[0] / texW, finalV);
                    indices.push(idx++);
                }
            }

            return { positions: positions, normals: normals, uvs: uvs, indices: indices };
        }

        // ================================================================
        //  Offscreen Thumbnail Rendering (flat mesh, no bones)
        // ================================================================

        /**
         * Render an offscreen thumbnail for a skin (uses flat mesh)
         */
        static async renderThumbnail(skin, project, size) {
            if (!skin || !project) return null;

            var geoData = project.geometries[skin.geometry];
            if (!geoData) return null;

            var texture = await ModelViewer._loadTextureStatic(skin.texturePath, project);

            // Use bone hierarchy for correct bone positioning (same as main viewer)
            var tempViewer = new ModelViewer(document.createElement('div'));
            var result = tempViewer._buildBoneHierarchy(geoData, texture);
            if (!result) return null;

            // Compute bounding box for camera framing
            var bbox = new THREE.Box3().setFromObject(result.root);
            var thumbSize = new THREE.Vector3();
            bbox.getSize(thumbSize);
            var thumbCenter = new THREE.Vector3();
            bbox.getCenter(thumbCenter);
            var modelH = Math.max(thumbSize.y, 8);

            // Binary search for optimal frustum size
            var minFrustum = modelH * 1.05;
            var maxFrustum = modelH * 6.0;
            var bestFrustum = maxFrustum;
            var thumbRenderer = ModelViewer._getThumbnailRenderer(size);

            for (var iter = 0; iter < 8; iter++) {
                var midFrustum = (minFrustum + maxFrustum) / 2;
                var testDataUrl = ModelViewer._renderThumbAtFrustum(result.root, thumbCenter, midFrustum, size, thumbRenderer);

                var borderStatus = await ModelViewer._analyzeThumbnailBorder(testDataUrl);

                if (borderStatus === 'empty') {
                    maxFrustum = midFrustum;
                } else if (borderStatus === 'full') {
                    minFrustum = midFrustum;
                } else {
                    bestFrustum = midFrustum;
                    break;
                }
                bestFrustum = midFrustum;
            }

            // Final render at best frustum size
            var finalDataUrl = ModelViewer._renderThumbAtFrustum(result.root, thumbCenter, bestFrustum, size, thumbRenderer);

            // Cleanup
            result.root.traverse(function (child) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });

            return finalDataUrl;
        }

        /**
         * Render a thumbnail at a specific frustum size and return dataURL
         */
        static _renderThumbAtFrustum(rootGroup, center, frustumSize, size, renderer) {
            var scene = new THREE.Scene();
            scene.background = new THREE.Color(0x2d2d2d);

            var camera = new THREE.OrthographicCamera(
                frustumSize / -2, frustumSize / 2,
                frustumSize / 2, frustumSize / -2, 0.01, 1000
            );
            camera.position.set(0, center.y, 50);
            camera.lookAt(0, center.y, 0);

            // Apply a slight rotation for a nice 3/4 view
            var wrapper = new THREE.Group();
            wrapper.rotation.x = ModelViewer.DEFAULT_VIEW_ROTATION.x;
            wrapper.rotation.y = ModelViewer.DEFAULT_VIEW_ROTATION.y;
            wrapper.add(rootGroup.clone(true));
            scene.add(wrapper);

            scene.add(new THREE.AmbientLight(0xffffff, 0.7));
            var dlLight = new THREE.DirectionalLight(0xffffff, 0.6);
            dlLight.position.set(10, 40, 30);
            scene.add(dlLight);

            renderer.setSize(size, size, false);
            renderer.setPixelRatio(1);
            renderer.render(scene, camera);

            var dataUrl = renderer.domElement.toDataURL('image/png');

            return dataUrl;
        }

        static _getThumbnailRenderer(size) {
            if (!ModelViewer._thumbnailRenderer) {
                ModelViewer._thumbnailRenderer = new THREE.WebGLRenderer({
                    antialias: false,
                    alpha: false,
                    preserveDrawingBuffer: true
                });
                ModelViewer._thumbnailRenderer.setPixelRatio(1);
            }
            ModelViewer._thumbnailRenderer.setSize(size, size, false);
            return ModelViewer._thumbnailRenderer;
        }

        static disposeThumbnailRenderer() {
            if (ModelViewer._thumbnailRenderer) {
                ModelViewer._thumbnailRenderer.dispose();
                if (ModelViewer._thumbnailRenderer.forceContextLoss) {
                    ModelViewer._thumbnailRenderer.forceContextLoss();
                }
                ModelViewer._thumbnailRenderer = null;
            }
        }

        /**
         * Analyze thumbnail border to determine if model fills the frame.
         * Returns: 'empty' (all border transparent), 'full' (all border has content),
         *          'partial' (mixed - some edges have content)
         *
         * Uses 3 concentric zones (outer 8%, middle 8%, inner 8% of each edge):
         * - If all 3 zones have content → 'full' (too zoomed in, content overflows)
         * - If only outer zone has content → 'partial' (good fit)
         * - If no zones have content → 'empty' (too zoomed out, model is tiny)
         */
        static async _analyzeThumbnailBorder(dataUrl) {
            return new Promise(function (resolve) {
                var canvas = document.createElement('canvas');
                var img = new Image();
                img.onload = function () {
                    canvas.width = img.width;
                    canvas.height = img.height;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    var w = img.width;
                    var h = img.height;
                    var imageData = ctx.getImageData(0, 0, w, h);
                    var pixels = imageData.data;

                    var stripW = Math.max(1, Math.floor(w * 0.06));
                    var innerW = Math.max(1, Math.floor(w * 0.12));

                    var outerHasContent = false;
                    var innerHasContent = false;

                    function isContent(idx) {
                        var r = pixels[idx];
                        var g = pixels[idx + 1];
                        var b = pixels[idx + 2];
                        var a = pixels[idx + 3];
                        if (a < 128) return false;
                        return !(r === 45 && g === 45 && b === 45);
                    }

                    // Sample border pixels
                    for (var y = 0; y < h; y++) {
                        var outerIdx = (y * w) * 4;
                        var innerIdx = (y * w + stripW) * 4;
                        if (!outerHasContent && isContent(outerIdx)) outerHasContent = true;
                        if (!innerHasContent && stripW < innerW && isContent(innerIdx)) innerHasContent = true;

                        var outerR = (y * w + w - 1) * 4;
                        var innerR = (y * w + w - 1 - stripW) * 4;
                        if (!outerHasContent && isContent(outerR)) outerHasContent = true;
                        if (!innerHasContent && stripW < innerW && isContent(innerR)) innerHasContent = true;
                    }
                    for (var x = 0; x < w; x++) {
                        var topIdx = x * 4;
                        if (!outerHasContent && isContent(topIdx)) outerHasContent = true;
                        if (!innerHasContent && stripW < innerW && isContent((stripW * w + x) * 4)) innerHasContent = true;

                        var botIdx = ((h - 1) * w + x) * 4;
                        if (!outerHasContent && isContent(botIdx)) outerHasContent = true;
                        if (!innerHasContent && stripW < innerW && isContent(((h - 1 - stripW) * w + x) * 4)) innerHasContent = true;
                    }

                    if (outerHasContent && innerHasContent) {
                        resolve('full');
                    } else if (outerHasContent) {
                        resolve('partial');
                    } else {
                        resolve('empty');
                    }
                };
                img.onerror = function () { resolve('empty'); };
                img.src = dataUrl;
            });
        }

        static async _loadTextureStatic(texturePath, project) {
            if (!texturePath) return null;
            var blobUrl = await project.getTextureBlobUrl(texturePath);
            if (!blobUrl) return null;
            return new Promise((resolve) => {
                new THREE.TextureLoader().load(blobUrl, (tex) => {
                    tex.magFilter = THREE.NearestFilter;
                    tex.minFilter = THREE.NearestFilter;
                    tex.flipY = true;
                    tex.generateMipmaps = false;
                    tex.wrapS = THREE.ClampToEdgeWrapping;
                    tex.wrapT = THREE.ClampToEdgeWrapping;
                    tex.needsUpdate = true;
                    resolve(tex);
                }, undefined, () => resolve(null));
            });
        }

        static _buildMeshStatic(geoData, texture) {
            var temp = new ModelViewer(document.createElement('div'));
            return temp._buildMesh(geoData, texture);
        }

        // ================================================================
        //  Cleanup
        // ================================================================

        destroy() {
            this._isDestroyed = true;
            this._showSkinToken++;
            this.stopLoop();
            this._clearBoneHierarchy();
            this._clearMesh();
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            }
            if (this.renderer) {
                this.renderer.dispose();
                if (this.renderer.forceContextLoss) {
                    this.renderer.forceContextLoss();
                }
                this.renderer = null;
            }
            if (this._transformControls && this.scene) {
                this.scene.remove(this._transformControls);
            }
            this._transformControls = null;
            if (this.canvasEl && this.canvasEl.parentNode) {
                this.canvasEl.parentNode.removeChild(this.canvasEl);
            }
            this.canvasEl = null;
            this.scene = null;
            this.camera = null;
        }
    }

    ModelViewer.DEFAULT_VIEW_ROTATION = Object.freeze({ x: -0.3, y: Math.PI - 0.6 });
    ModelViewer.HUMAN_BONE_ALIASES = Object.freeze({
        root: [/^root$/i, /^mainroot$/i, /^base$/i],
        waist: [/^waist$/i, /^hips?$/i, /^pelvis$/i, /^torso[_-]?base$/i],
        body: [/^body$/i, /^torso$/i, /^chest$/i, /^spine$/i],
        head: [/^head$/i, /^helmet$/i, /^skull$/i],
        cape: [/^cape$/i, /^cloak$/i],
        leftarm: [/^left.+arm$/i, /^arm.+left$/i, /^l(?:eft)?[_-]?arm$/i, /^arm[_-]?l(?:eft)?$/i, /^lefthand$/i, /^hand[_-]?left$/i],
        rightarm: [/^right.+arm$/i, /^arm.+right$/i, /^r(?:ight)?[_-]?arm$/i, /^arm[_-]?r(?:ight)?$/i, /^righthand$/i, /^hand[_-]?right$/i],
        leftleg: [/^left.+leg$/i, /^leg.+left$/i, /^l(?:eft)?[_-]?leg$/i, /^leg[_-]?l(?:eft)?$/i],
        rightleg: [/^right.+leg$/i, /^leg.+right$/i, /^r(?:ight)?[_-]?leg$/i, /^leg[_-]?r(?:ight)?$/i]
    });
    ModelViewer.PREVIEW_ANIMATION_PRESETS = Object.freeze([
        {
            key: 'walk',
            labelKey: 'preview.action.walk'
        },
        {
            key: 'run',
            labelKey: 'preview.action.run'
        },
        {
            key: 'walkRunTransition',
            labelKey: 'preview.action.walkRunTransition'
        },
        {
            key: 'sneak',
            labelKey: 'preview.action.sneak'
        },
        {
            key: 'sneakMove',
            labelKey: 'preview.action.sneakMove'
        }
    ]);

    ModelViewer.PREVIEW_ACTION_DEFINITIONS = Object.freeze({
        walk: Object.freeze({
            animationIds: Object.freeze([
                'animation.player.cape',
                'animation.player.move.arms',
                'animation.player.move.legs'
            ])
        }),
        run: Object.freeze({
            animationIds: Object.freeze([
                'animation.player.cape',
                'animation.player.move.arms',
                'animation.player.move.legs'
            ])
        }),
        walkRunTransition: Object.freeze({
            animationIds: Object.freeze([
                'animation.player.cape',
                'animation.player.move.arms',
                'animation.player.move.legs'
            ])
        }),
        sneak: Object.freeze({
            animationIds: Object.freeze([
                'animation.player.cape',
                'animation.player.sneaking'
            ])
        }),
        sneakMove: Object.freeze({
            animationIds: Object.freeze([
                'animation.player.cape',
                'animation.player.sneaking',
                'animation.player.move.arms',
                'animation.player.move.legs'
            ])
        })
    });

    ModelViewer._buildPreviewPresetState = function (presetKey, time) {
        var state = {
            actionKey: presetKey || '',
            moveSpeed: 0,
            distanceMoved: 0,
            capeFlapAmount: 0.02,
            isSneaking: false,
            tcos0: 0,
            limbCycleSpeed: 0,
            limbPhase: 0
        };
        var walkCycleSpeed = 4.5;
        var runCycleSpeed = 8.5;
        var walkAmplitude = 12;
        var runAmplitude = 24;
        var distanceScale = 0;
        var walkRunTransitionPhase = (walkCycleSpeed * time) + (((runCycleSpeed - walkCycleSpeed) / 1.45) * (1 - Math.cos(time * 1.45)) * 0.5);

        if (presetKey === 'walk') {
            state.moveSpeed = 0.35;
            distanceScale = 1.1;
            state.capeFlapAmount = 0.16;
            state.tcos0 = Math.cos(time * walkCycleSpeed) * walkAmplitude;
            state.limbCycleSpeed = walkCycleSpeed;
        } else if (presetKey === 'run') {
            state.moveSpeed = 1;
            distanceScale = 2.4;
            state.capeFlapAmount = 0.62;
            state.tcos0 = Math.cos(time * runCycleSpeed) * runAmplitude;
            state.limbCycleSpeed = runCycleSpeed;
        } else if (presetKey === 'walkRunTransition') {
            var blend = (Math.sin(time * 1.45) + 1) / 2;
            var cycleSpeed = walkCycleSpeed + ((runCycleSpeed - walkCycleSpeed) * blend);
            var amplitude = walkAmplitude + ((runAmplitude - walkAmplitude) * blend);
            state.moveSpeed = 0.3 + (0.7 * blend);
            distanceScale = 1 + (1.5 * blend);
            state.capeFlapAmount = 0.12 + (0.58 * blend);
            state.tcos0 = Math.cos(walkRunTransitionPhase) * amplitude;
            state.limbCycleSpeed = 0;
            state.limbPhase = walkRunTransitionPhase;
        } else if (presetKey === 'sneak') {
            state.isSneaking = true;
            state.moveSpeed = 0.08;
            state.capeFlapAmount = 0.08;
            state.tcos0 = 0;
        } else if (presetKey === 'sneakMove') {
            state.isSneaking = true;
            state.moveSpeed = 0.18;
            distanceScale = 0.55;
            state.capeFlapAmount = 0.18;
            state.tcos0 = Math.cos(time * 3.2) * 12;
            state.limbCycleSpeed = 3.2;
        }

        state.distanceMoved = time * distanceScale;
        return state;
    };

    window.SkinApex.ModelViewer = ModelViewer;
})();
