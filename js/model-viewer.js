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
                selected: '__all__',
                molang: null,
                startedAt: 0,
                animatedBones: {}
            };
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
            return JSON.parse(JSON.stringify(this._animationState.animatedBones || {}));
        }

        getAvailableAnimations() {
            return (this._animationState.activeEntries || []).map(function (entry) {
                return { slot: entry.slot, id: entry.id };
            });
        }

        setSelectedAnimation(selection) {
            if (selection === '__none__') {
                this._animationState.selected = '__none__';
                return;
            }
            this._animationState.selected = selection || '__all__';
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
            this.renderer.setSize(w, h);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

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
            this.renderer.setSize(w, h);
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
            this._applyAnimationFrame();
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
            this._animationState.animatedBones = {};
            this._animationState.startedAt = performance.now();
            this._animationState.selected = '__all__';
            this._animationState.molang = window.Molang && window.Molang.Molang
                ? new window.Molang.Molang({}, { useCache: false, convertUndefined: true, useRadians: false, assumeFlatEnvironment: true })
                : null;

            var mappings = skin && skin.animations ? skin.animations : (skin && skin.data ? skin.data.animations : null);
            if (!mappings || !Object.keys(mappings).length || !this._currentGeoData || !this._currentGeoData.bones) {
                this._animationState.officialAnimations = {};
                return;
            }

            // Ensure the index is loaded, then batch-fetch only the animations this skin uses
            await project.getOfficialAnimationIndex();
            var neededIds = Object.values(mappings).filter(function (id) { return !!id; });
            var loadedAnimations = await project.getOfficialAnimations(neededIds);
            this._animationState.officialAnimations = loadedAnimations;

            var animated = {};
            Object.keys(mappings).forEach((slot) => {
                var animationId = mappings[slot];
                var animation = loadedAnimations[animationId];
                if (!animation || !animation.bones) return;
                this._animationState.activeEntries.push({ slot: slot, id: animationId, data: animation });
                Object.keys(animation.bones).forEach((boneName) => {
                    if (this._boneGroups[boneName] || this._findBone(boneName, this._currentGeoData)) {
                        if (!animated[boneName]) animated[boneName] = [];
                        animated[boneName].push({ slot: slot, id: animationId });
                    }
                });
            });
            this._animationState.animatedBones = animated;
        }

        _applyAnimationFrame() {
            if (!this._currentGeoData || !this._currentGeoData.bones || !this._rootGroup) return;
            if (this._transformControls && this._transformControls.dragging) return;
            var entries = this._animationState.activeEntries || [];
            var selection = this._animationState.selected || '__all__';
            if (selection === '__none__') selection = '__none__';
            var time = (performance.now() - (this._animationState.startedAt || performance.now())) / 1000;

            for (var i = 0; i < this._currentGeoData.bones.length; i++) {
                var bone = this._currentGeoData.bones[i];
                var boneName = bone.name || ('bone_' + i);
                var group = this._boneGroups[boneName];
                if (!group) continue;

                var baseRot = bone.rotation || [0, 0, 0];
                var basePivot = bone.pivot || [0, 0, 0];
                var rot = [baseRot[0], baseRot[1], baseRot[2]];
                var pos = [basePivot[0], basePivot[1], basePivot[2]];

                for (var e = 0; e < entries.length; e++) {
                    var entry = entries[e];
                    if (selection === '__none__') continue;
                    if (selection !== '__all__' && selection !== entry.slot && selection !== entry.id) continue;
                    var boneAnim = entry.data && entry.data.bones ? entry.data.bones[boneName] : null;
                    if (!boneAnim) continue;

                    if (boneAnim.rotation) {
                        var nextRot = this._evalAnimVec3(boneAnim.rotation, time);
                        if (nextRot) rot = nextRot;
                    }
                    if (boneAnim.position) {
                        var nextPos = this._evalAnimVec3(boneAnim.position, time);
                        if (nextPos) pos = [basePivot[0] + nextPos[0], basePivot[1] + nextPos[1], basePivot[2] + nextPos[2]];
                    }
                }

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

        _evalAnimVec3(value, time) {
            if (!Array.isArray(value)) return null;
            var out = [0, 0, 0];
            for (var i = 0; i < 3; i++) {
                out[i] = this._evalAnimScalar(value[i], time);
            }
            return out;
        }

        _evalAnimScalar(value, time) {
            if (typeof value === 'number') return value;
            if (typeof value !== 'string') return 0;
            var molang = this._animationState.molang;
            if (!molang) return 0;
            var expression = String(value).replace(/\bMath\./g, 'math.');
            molang.updateExecutionEnv({
                'query.anim_time': time,
                'query.life_time': time,
                'query.modified_move_speed': 1,
                'query.target_x_rotation': 0,
                'query.target_y_rotation': 0,
                'query.head_y_rotation': function () { return 0; },
                'query.time_stamp': time,
                'variable.tcos0': Math.cos(time * 6) * 30
            }, true);
            try {
                return Number(molang.execute(expression)) || 0;
            } catch (e) {
                return 0;
            }
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
            var norms = polyMesh.normals || [];
            var uvData = polyMesh.uvs || [];
            var polys = polyMesh.polys || [];
            var normalized = polyMesh.normalized_uvs !== false;

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
                        var nIdx = corner[1] !== undefined ? corner[1] : 0;
                        var uvIdx = corner[2] !== undefined ? corner[2] : 0;
                        var v = verts[vIdx] || [0, 0, 0];
                        // Offset by pivot
                        positions.push(-(v[0] - pivot[0]), v[1] - pivot[1], v[2] - pivot[2]);
                        var nrm = norms[nIdx] || [0, 1, 0];
                        normals.push(-nrm[0], nrm[1], nrm[2]);
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
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geometry.setIndex(indices);
            return geometry;
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
                    var norms = pm.normals || [];
                    var uvData = pm.uvs || [];
                    var polys = pm.polys || [];
                    var normalized = pm.normalized_uvs !== false;

                    if (verts.length > 0 && polys.length > 0) {
                        for (var pi = 0; pi < polys.length; pi++) {
                            var poly = polys[pi];
                            if (!Array.isArray(poly) || poly.length < 3) continue;
                            for (var ti = 1; ti < poly.length - 1; ti++) {
                                var tri = [poly[0], poly[ti], poly[ti + 1]];
                                for (var ci = 0; ci < tri.length; ci++) {
                                    var corner = tri[ci];
                                    var vIdx = corner[0] || 0;
                                    var nIdx = corner[1] !== undefined ? corner[1] : 0;
                                    var uvIdx = corner[2] !== undefined ? corner[2] : 0;
                                    var v = verts[vIdx] || [0, 0, 0];
                                    allPositions.push(v[0], v[1], -v[2]);
                                    var nrm = norms[nIdx] || [0, 1, 0];
                                    allNormals.push(nrm[0], nrm[1], -nrm[2]);
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
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(allUVs, 2));
            geometry.setIndex(allIndices);

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

    window.SkinApex.ModelViewer = ModelViewer;
})();
