// Production-Grade Babylon.js Floor Plan Renderer — Full Feature Set
// Drop-in replacement for threeRenderer.js with identical API surface

export class FloorPlanRenderer {
    constructor(container) {
        this.container = container;
        this._disposed = false;
        this._boundResizeHandler = null;
        this._boundCanvasClick = null;
        this._boundCanvasMove = null;
        this.is3DMode = false;
        this.selectedIlots = [];
        this.ilotMeshes = [];
        this.measurementMode = false;
        this.measurementPoints = [];
        this.measurementType = 'distance';
        this.rendererType = 'webgl';
        this.webglAvailable = true;
        this._eventListeners = {};
        this.viewOrientation = {
            // Start in source CAD orientation. User can toggle with flip controls.
            flipX: true,
            flipY: false
        };
        // Do not keep mirrored state between sessions.
        this._clearPersistedOrientation();

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        container.appendChild(canvas);
        this._canvas = canvas;

        // Engine
        try {
            this.engine = new BABYLON.Engine(canvas, true, {
                preserveDrawingBuffer: true,
                stencil: true,
                antialias: true
            });
            const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
            this.engine.setHardwareScalingLevel(1 / dpr);
        } catch (e) {
            console.error('Babylon.js engine creation failed:', e);
            this.webglAvailable = false;
            return;
        }

        // Scene
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(1, 1, 1, 1);

        // Orthographic camera (2D default)
        const aspect = container.clientWidth / container.clientHeight;
        const frustumSize = 100;
        this.camera = new BABYLON.FreeCamera('orthoCamera', new BABYLON.Vector3(0, 0, 100), this.scene);
        this.camera.setTarget(BABYLON.Vector3.Zero());
        this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
        this.camera.orthoLeft = frustumSize * aspect / -2;
        this.camera.orthoRight = frustumSize * aspect / 2;
        this.camera.orthoTop = frustumSize / 2;
        this.camera.orthoBottom = frustumSize / -2;
        this.camera.minZ = 0.1;
        this.camera.maxZ = 1000;

        // Panning/zooming for 2D via pointer inputs
        this.camera.inputs.clear();
        this._setupOrthoPanZoom();

        // Perspective camera (for 3D mode)
        this.perspectiveCamera = new BABYLON.ArcRotateCamera('perspCamera', -Math.PI / 2, Math.PI / 4, 200, BABYLON.Vector3.Zero(), this.scene);
        this.perspectiveCamera.minZ = 0.1;
        this.perspectiveCamera.maxZ = 10000;
        this.perspectiveCamera.attachControl(canvas, false);
        this.perspectiveCamera.detachControl();
        this.scene.activeCamera = this.camera;

        // Lighting
        const ambient = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 0, 1), this.scene);
        ambient.intensity = 0.9;
        ambient.diffuse = new BABYLON.Color3(1, 1, 1);
        ambient.groundColor = new BABYLON.Color3(0.8, 0.8, 0.8);
        this._ambientLight = ambient;

        const keyLight = new BABYLON.DirectionalLight('key', new BABYLON.Vector3(0.5, -0.5, -1), this.scene);
        keyLight.intensity = 0.6;
        this._keyLight = keyLight;

        // Groups (TransformNodes)
        this.wallsGroup = new BABYLON.TransformNode('walls', this.scene);
        this.entrancesGroup = new BABYLON.TransformNode('entrances', this.scene);
        this.forbiddenGroup = new BABYLON.TransformNode('forbidden', this.scene);
        this.ilotsGroup = new BABYLON.TransformNode('ilots', this.scene);
        this.corridorsGroup = new BABYLON.TransformNode('corridors', this.scene);
        this.perimeterGroup = new BABYLON.TransformNode('perimeter', this.scene);
        this.corridorArrowsGroup = new BABYLON.TransformNode('corridorArrows', this.scene);
        this.measurementsGroup = new BABYLON.TransformNode('measurements', this.scene);
        this.labelsGroup = new BABYLON.TransformNode('labels', this.scene);
        this.connectorsGroup = new BABYLON.TransformNode('connectors', this.scene);
        this.connectorHighlights = new BABYLON.TransformNode('connectorHL', this.scene);
        this.stackGroup = new BABYLON.TransformNode('stack', this.scene);
        this.crossFloorPathsGroup = new BABYLON.TransformNode('crossFloorPaths', this.scene); // Changed name from 'crossFloor'
        this.doorsGroup = new BABYLON.TransformNode('doors', this.scene);

        // Root for floor plan geometry; orientation is applied via viewOrientation.
        this.planRoot = new BABYLON.TransformNode('planRoot', this.scene);
        this.planRoot.scaling = new BABYLON.Vector3(1, 1, 1);
        this.planRoot.position = new BABYLON.Vector3(0, 0, 0);

        this.wallsGroup.parent = this.planRoot;
        this.entrancesGroup.parent = this.planRoot;
        this.forbiddenGroup.parent = this.planRoot;
        this.ilotsGroup.parent = this.planRoot;
        this.corridorsGroup.parent = this.planRoot;
        this.corridorArrowsGroup.parent = this.planRoot;
        // RadiatorsGroup is created later, so it will be parented when created.
        // this.radiatorsGroup.parent = this.planRoot; // This line would cause an error as radiatorsGroup is not yet defined
        this.connectorsGroup.parent = this.planRoot;
        this.connectorHighlights.parent = this.planRoot;
        this.stackGroup.parent = this.planRoot;
        this.doorsGroup.parent = this.planRoot;
        this.crossFloorPathsGroup.parent = this.planRoot;
        this.perimeterGroup.parent = this.planRoot;
        this.labelsGroup.parent = this.planRoot; // Labels also need to be parented to planRoot

        this.stackGroup.setEnabled(false);

        this.currentConnectors = [];
        this.currentConnectorOptions = {};
        this.currentStackFloors = null;
        this.currentStackOptions = {};
        this.currentCrossFloorRoutes = [];
        this.crossFloorOptions = {};
        this.corridorArrowsVisible = true;
        this.showLayoutOverlay = false;
        this.layoutOverlayConfig = {
            title: 'PLAN ETAGE 01 1-200',
            secondaryTitle: 'PLAN ETAGE 02 1-200',
            sheetNumber: '3',
            companyName: 'COSTO',
            companyAddress: '5 chemin de la dime 95700\nRoissy FRANCE',
            footerLabel: 'SURFACES DES BOX'
        };
        this.arrowMeshes = [];
        this.arrowAnimationActive = false;
        this.arrowAnimationFrame = null;
        this.arrowPulseTime = 0;
        this._lastTime = performance.now();

        // Outline and bloom (post-processing pipeline)
        this.outlinePass = { selectedObjects: [], renderCamera: this.camera, visibleEdgeColor: { set: () => { } } };
        this.bloomPass = null;
        this.shadowsEnabled = true;
        this._setupPostProcessing();

        // Events
        this._boundCanvasClick = (e) => this.onMouseClick(e);
        this._boundCanvasMove = (e) => this.onMouseMove(e);
        this._boundResizeHandler = () => this.onResize();
        canvas.addEventListener('click', this._boundCanvasClick);
        canvas.addEventListener('pointermove', this._boundCanvasMove);
        window.addEventListener('resize', this._boundResizeHandler);

        // Start render loop (continuous for deterministic UI updates).
        this.engine.runRenderLoop(() => {
            if (this._disposed || !this.scene) return;
            const disposed = (typeof this.scene.isDisposed === 'function')
                ? this.scene.isDisposed()
                : !!this.scene.isDisposed;
            if (disposed) return;
            try {
                this.scene.render();
            } catch (error) {
                if (!this._lastRenderErrorAt || (Date.now() - this._lastRenderErrorAt) > 1500) {
                    this._lastRenderErrorAt = Date.now();
                    console.error('[BabylonRenderer] render loop error:', error);
                }
            }
        });
        this._needsRender = true;

        this.createGroundPlane();
        this.render();
        setTimeout(() => this.render(), 100);
    }

    _persistOrientation() {
        // Intentionally disabled: persisted flips caused mirrored reloads.
        this._clearPersistedOrientation();
    }

    _clearPersistedOrientation() {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            window.localStorage.removeItem('floorplan.view.flipX');
            window.localStorage.removeItem('floorplan.view.flipY');
        } catch (error) {
            // Non-fatal in private browsing/storage-restricted contexts.
        }
    }

    _isLikelySyntheticEnvelope(floorPlan) {
        const envelope = Array.isArray(floorPlan?.envelope) ? floorPlan.envelope : [];
        const bounds = floorPlan?.bounds;
        if (!envelope.length || !bounds) return false;
        if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return false;

        const segs = envelope.filter((line) => line && line.start && line.end);
        if (segs.length < 4) return false;

        const tol = 0.15;
        const onBound = (v, target) => Math.abs(Number(v) - Number(target)) <= tol;

        let aligned = 0;
        segs.forEach((line) => {
            const x1 = Number(line.start.x);
            const y1 = Number(line.start.y);
            const x2 = Number(line.end.x);
            const y2 = Number(line.end.y);
            if (![x1, y1, x2, y2].every(Number.isFinite)) return;

            const onLeft = onBound(x1, bounds.minX) && onBound(x2, bounds.minX);
            const onRight = onBound(x1, bounds.maxX) && onBound(x2, bounds.maxX);
            const onBottom = onBound(y1, bounds.minY) && onBound(y2, bounds.minY);
            const onTop = onBound(y1, bounds.maxY) && onBound(y2, bounds.maxY);

            if (onLeft || onRight || onBottom || onTop) aligned += 1;
        });

        const ratio = aligned / Math.max(1, segs.length);
        return aligned >= 4 && ratio >= 0.75;
    }

    _normalizeWallPoint(pt) {
        if (!pt) return null;
        const x = Number(Array.isArray(pt) ? pt[0] : pt.x);
        const y = Number(Array.isArray(pt) ? pt[1] : pt.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }

    _wallToSegments(wall, { closePolygon = true } = {}) {
        const segments = [];
        if (!wall) return segments;

        if (Array.isArray(wall.polygon) && wall.polygon.length >= 2) {
            const pts = wall.polygon
                .map((pt) => this._normalizeWallPoint(pt))
                .filter(Boolean);
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i];
                const b = pts[i + 1];
                if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-6) {
                    segments.push({ start: a, end: b });
                }
            }
            if (closePolygon && pts.length >= 3) {
                const first = pts[0];
                const last = pts[pts.length - 1];
                if (Math.hypot(last.x - first.x, last.y - first.y) > 1e-6) {
                    segments.push({ start: last, end: first });
                }
            }
            if (segments.length > 0) return segments;
        }

        const start = this._normalizeWallPoint(wall.start);
        const end = this._normalizeWallPoint(wall.end);
        if (start && end && Math.hypot(end.x - start.x, end.y - start.y) > 1e-6) {
            segments.push({ start, end });
        }
        return segments;
    }

    _shouldRenderEnvelope(floorPlan) {
        const envelope = Array.isArray(floorPlan?.envelope) ? floorPlan.envelope : [];
        if (!envelope.length) return false;

        const walls = Array.isArray(floorPlan?.walls) ? floorPlan.walls : [];
        if (!walls.length) return true;
        if (this._isLikelySyntheticEnvelope(floorPlan)) return false;

        // If an envelope exists together with walls, only render it when it clearly
        // connects to wall geometry; otherwise it behaves like a detached outer frame.
        const tol = 0.28;
        const wallPts = [];
        walls.forEach((wall) => {
            const segs = this._wallToSegments(wall, { closePolygon: true });
            segs.forEach((s) => {
                wallPts.push({ x: Number(s.start.x), y: Number(s.start.y) });
                wallPts.push({ x: Number(s.end.x), y: Number(s.end.y) });
            });
        });

        if (!wallPts.length) return false;

        let connectedEndpoints = 0;
        let endpointCount = 0;
        envelope.forEach((seg) => {
            [seg?.start, seg?.end].forEach((pt) => {
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
                endpointCount += 1;
                const hit = wallPts.some((wpt) => Math.hypot(wpt.x - pt.x, wpt.y - pt.y) <= tol);
                if (hit) connectedEndpoints += 1;
            });
        });
        if (endpointCount === 0) return false;
        const minConnected = Math.max(6, Math.ceil(endpointCount * 0.45));
        return connectedEndpoints >= minConnected;
    }

    _deriveRenderableBounds(floorPlan) {
        const points = [];
        const pushPoint = (x, y) => {
            if (Number.isFinite(x) && Number.isFinite(y)) {
                points.push({ x: Number(x), y: Number(y) });
            }
        };
        const pushPath = (path) => {
            if (!Array.isArray(path)) return;
            path.forEach((pt) => {
                if (!pt) return;
                const x = Number(Array.isArray(pt) ? pt[0] : pt.x);
                const y = Number(Array.isArray(pt) ? pt[1] : pt.y);
                pushPoint(x, y);
            });
        };
        const pushRect = (x, y, w, h) => {
            if (![x, y, w, h].every(Number.isFinite)) return;
            if (w <= 0 || h <= 0) return;
            pushPoint(x, y);
            pushPoint(x + w, y + h);
        };

        if (Array.isArray(floorPlan?.walls)) {
            floorPlan.walls.forEach((wall) => {
                const segs = this._wallToSegments(wall, { closePolygon: true });
                segs.forEach((seg) => {
                    pushPoint(seg.start.x, seg.start.y);
                    pushPoint(seg.end.x, seg.end.y);
                });
            });
        }
        if (Array.isArray(floorPlan?.envelope)) {
            floorPlan.envelope.forEach((line) => {
                if (line?.start && line?.end) {
                    pushPoint(line.start.x, line.start.y);
                    pushPoint(line.end.x, line.end.y);
                }
            });
        }
        if (Array.isArray(floorPlan?.entrances)) {
            floorPlan.entrances.forEach((e) => {
                if (e?.start && e?.end) {
                    pushPoint(e.start.x, e.start.y);
                    pushPoint(e.end.x, e.end.y);
                } else if (
                    Number.isFinite(e?.x) &&
                    Number.isFinite(e?.y) &&
                    Number.isFinite(e?.width) &&
                    Number.isFinite(e?.height)
                ) {
                    pushRect(Number(e.x), Number(e.y), Number(e.width), Number(e.height));
                }
            });
        }
        if (Array.isArray(floorPlan?.forbiddenZones)) {
            floorPlan.forbiddenZones.forEach((fz) => {
                if (Array.isArray(fz?.polygon)) {
                    pushPath(fz.polygon);
                } else {
                    const rx = Number(fz?.x);
                    const ry = Number(fz?.y);
                    const rw = Number(fz?.width ?? fz?.w);
                    const rh = Number(fz?.height ?? fz?.h);
                    pushRect(rx, ry, rw, rh);
                }
            });
        }

        const base = floorPlan?.bounds;
        const hasBase = base &&
            Number.isFinite(base.minX) &&
            Number.isFinite(base.minY) &&
            Number.isFinite(base.maxX) &&
            Number.isFinite(base.maxY) &&
            base.maxX > base.minX &&
            base.maxY > base.minY;

        if (points.length < 4) return hasBase ? base : null;

        const xs = points.map((p) => p.x).sort((a, b) => a - b);
        const ys = points.map((p) => p.y).sort((a, b) => a - b);
        const trimRatio = points.length >= 24 ? 0.003 : 0;
        const li = Math.floor(xs.length * trimRatio);
        const hi = Math.max(li + 1, Math.ceil(xs.length * (1 - trimRatio)) - 1);

        let minX = xs[Math.min(li, xs.length - 1)];
        let maxX = xs[Math.min(hi, xs.length - 1)];
        let minY = ys[Math.min(li, ys.length - 1)];
        let maxY = ys[Math.min(hi, ys.length - 1)];
        if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
            return hasBase ? base : null;
        }

        const padX = Math.max(0.04, (maxX - minX) * 0.01);
        const padY = Math.max(0.04, (maxY - minY) * 0.01);
        minX -= padX;
        minY -= padY;
        maxX += padX;
        maxY += padY;

        if (hasBase) {
            minX = Math.max(minX, base.minX);
            minY = Math.max(minY, base.minY);
            maxX = Math.min(maxX, base.maxX);
            maxY = Math.min(maxY, base.maxY);
        }

        return (maxX > minX && maxY > minY) ? { minX, minY, maxX, maxY } : (hasBase ? base : null);
    }

    _applyPlanOrientation(bounds = null) {
        const flipX = !!this.viewOrientation.flipX;
        const flipY = !!this.viewOrientation.flipY;
        this.planRoot.scaling.x = flipX ? -1 : 1;
        this.planRoot.scaling.y = flipY ? -1 : 1;

        if (bounds && Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX)) {
            this.planRoot.position.x = flipX ? (bounds.minX + bounds.maxX) : 0;
        } else {
            this.planRoot.position.x = 0;
        }
        if (bounds && Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY)) {
            this.planRoot.position.y = flipY ? (bounds.minY + bounds.maxY) : 0;
        } else {
            this.planRoot.position.y = 0;
        }
    }

    setPlanOrientation({ flipX, flipY, persist = true } = {}) {
        if (typeof flipX === 'boolean') this.viewOrientation.flipX = flipX;
        if (typeof flipY === 'boolean') this.viewOrientation.flipY = flipY;
        const bounds = this.currentBounds || null;
        this._applyPlanOrientation(bounds);
        if (persist) this._persistOrientation();
        this.render();
        return this.getPlanOrientation();
    }

    toggleVerticalFlip() {
        this.viewOrientation.flipY = !this.viewOrientation.flipY;
        this._applyPlanOrientation(this.currentBounds || null);
        this._persistOrientation();
        this.render();
        return this.viewOrientation.flipY;
    }

    toggleHorizontalFlip() {
        this.viewOrientation.flipX = !this.viewOrientation.flipX;
        this._applyPlanOrientation(this.currentBounds || null);
        this._persistOrientation();
        this.render();
        return this.viewOrientation.flipX;
    }

    getPlanOrientation() {
        return { flipX: !!this.viewOrientation.flipX, flipY: !!this.viewOrientation.flipY };
    }

    _setupOrthoPanZoom() {
        let panning = false, lastX = 0, lastY = 0;
        const canvas = this._canvas;
        canvas.addEventListener('pointerdown', (e) => {
            if (e.button === 0 || e.button === 2) { panning = true; lastX = e.clientX; lastY = e.clientY; }
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!panning || this.is3DMode) return;
            const dx = e.clientX - lastX, dy = e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            const w = this.camera.orthoRight - this.camera.orthoLeft;
            const scaleX = w / canvas.clientWidth;
            this.camera.position.x -= dx * scaleX;
            this.camera.position.y += dy * scaleX;
            const t = this.camera.getTarget();
            this.camera.setTarget(new BABYLON.Vector3(t.x - dx * scaleX, t.y + dy * scaleX, 0));
            this.render();
        });
        canvas.addEventListener('pointerup', () => { panning = false; });
        canvas.addEventListener('wheel', (e) => {
            if (this.is3DMode) return;
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.1 : 0.9;
            const w = this.camera.orthoRight - this.camera.orthoLeft;
            const h = this.camera.orthoTop - this.camera.orthoBottom;
            const cx = (this.camera.orthoLeft + this.camera.orthoRight) / 2;
            const cy = (this.camera.orthoTop + this.camera.orthoBottom) / 2;
            this.camera.orthoLeft = cx - (w * factor) / 2;
            this.camera.orthoRight = cx + (w * factor) / 2;
            this.camera.orthoTop = cy + (h * factor) / 2;
            this.camera.orthoBottom = cy - (h * factor) / 2;
            this.render();
        }, { passive: false });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _setupPostProcessing() {
        try {
            this._pipeline = new BABYLON.DefaultRenderingPipeline('pipeline', true, this.scene, [this.camera]);
            this._pipeline.bloomEnabled = false;
            this._pipeline.bloomThreshold = 0.85;
            this._pipeline.bloomWeight = 0.5;
            this._pipeline.bloomKernel = 64;
        } catch (e) { console.warn('Post-processing setup skipped:', e); }
    }

    createGroundPlane() {
        this.gridHelper = null;
        this.groundPlane = null;
        this.defaultGrid = null;
    }

    createTextSprite(text, options = {}) {
        const fontSize = options.fontSize || 12;
        const fontColor = options.fontColor || '#000000';
        const backgroundColor = options.backgroundColor || 'rgba(255,255,255,0.8)';
        const padding = options.padding || 2;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

        const tmpCanvas = document.createElement('canvas');
        const ctx = tmpCanvas.getContext('2d');
        ctx.font = `${fontSize}px Arial`;
        const tw = ctx.measureText(text).width;
        const logicalWidth = Math.ceil(tw + padding * 2);
        const logicalHeight = Math.ceil(fontSize + padding * 2);
        tmpCanvas.width = Math.ceil(logicalWidth * dpr);
        tmpCanvas.height = Math.ceil(logicalHeight * dpr);
        ctx.scale(dpr, dpr);
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, logicalWidth, logicalHeight);
        ctx.font = `${fontSize}px Arial`;
        ctx.fillStyle = fontColor;
        ctx.textBaseline = 'top';
        ctx.fillText(text, padding, padding);

        const plane = BABYLON.MeshBuilder.CreatePlane('label_' + text, { width: 1, height: 1 }, this.scene);
        const mat = new BABYLON.StandardMaterial('labelMat_' + Math.random(), this.scene);
        mat.disableLighting = true;
        mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        const tex = new BABYLON.DynamicTexture('labelTex_' + Math.random(), { width: tmpCanvas.width, height: tmpCanvas.height }, this.scene);
        const texCtx = tex.getContext();
        texCtx.drawImage(tmpCanvas, 0, 0);
        tex.update();
        tex.hasAlpha = true;
        mat.diffuseTexture = tex;
        mat.opacityTexture = tex;
        mat.backFaceCulling = false;
        plane.material = mat;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        const sx = logicalWidth / 20 * (this.viewOrientation.flipX ? -1 : 1);
        const sy = logicalHeight / 20 * (this.viewOrientation.flipY ? -1 : 1);
        plane.scaling = new BABYLON.Vector3(sx, sy, 1);
        plane.isPickable = false;
        return plane;
    }

    onResize() {
        if (this._disposed || !this.engine || !this.camera || !this.container) return;
        this.engine.resize();
        const aspect = this.container.clientWidth / this.container.clientHeight;
        if (!Number.isFinite(aspect) || aspect <= 0) return;
        const centerX = (this.camera.orthoLeft + this.camera.orthoRight) / 2;
        const centerY = (this.camera.orthoTop + this.camera.orthoBottom) / 2;
        const currentHeight = Math.max(0.001, this.camera.orthoTop - this.camera.orthoBottom || 100);
        const halfH = currentHeight / 2;
        const halfW = (currentHeight * aspect) / 2;
        this.camera.orthoLeft = centerX - halfW;
        this.camera.orthoRight = centerX + halfW;
        this.camera.orthoTop = centerY + halfH;
        this.camera.orthoBottom = centerY - halfH;
        this.render();
    }

    onMouseClick(event) {
        if (this._disposed || !this.scene) return;
        if (this.measurementMode) {
            this.addMeasurementPoint(null, null);
            return;
        }
        const pick = this.scene.pick(event.offsetX, event.offsetY, (m) => this.ilotMeshes.includes(m));
        if (pick.hit && pick.pickedMesh) {
            this.selectIlotMesh(pick.pickedMesh);
        } else {
            this.clearSelection();
        }
    }

    onMouseMove(event) {
        if (this._disposed || !this.scene) return;
        const pick = this.scene.pick(event.offsetX, event.offsetY, (m) => this.ilotMeshes.includes(m));
        this._canvas.style.cursor = pick.hit ? 'pointer' : 'default';
    }

    _disposeChildren(node) {
        if (!node) return;
        const children = node.getChildMeshes(false);
        children.forEach(c => {
            if (c.material) {
                if (c.material.diffuseTexture) c.material.diffuseTexture.dispose();
                if (c.material.opacityTexture) c.material.opacityTexture.dispose();
                c.material.dispose();
            }
            c.dispose();
        });
        const transforms = node.getChildren();
        transforms.forEach(t => { if (t !== node && t.dispose) t.dispose(); });
    }

    clear() {
        [this.wallsGroup, this.entrancesGroup, this.forbiddenGroup, this.ilotsGroup,
        this.corridorsGroup, this.corridorArrowsGroup, this.connectorsGroup,
        this.connectorHighlights, this.stackGroup, this.crossFloorPathsGroup, this.doorsGroup,
        this.perimeterGroup, this.labelsGroup, this.measurementsGroup, this.radiatorsGroup, this.exclusionZonesGroup, this.overlayGroup
        ].filter(g => g).forEach(g => this._disposeChildren(g)); // Filter out null/undefined groups

        this.ilotMeshes = [];
        this.selectedIlots = [];
        this.stackGroup.setEnabled(false);
        this.currentConnectors = [];
        this.currentConnectorOptions = {};
        this.currentStackFloors = null;
        this.currentStackOptions = {};
        this.currentCrossFloorRoutes = [];
        this.crossFloorOptions = {};
        this.clearCorridorArrows();
        this.stopArrowAnimation();
        this.render();
    }

    _hexToColor3(hex) {
        const r = ((hex >> 16) & 255) / 255;
        const g = ((hex >> 8) & 255) / 255;
        const b = (hex & 255) / 255;
        return new BABYLON.Color3(r, g, b);
    }

    _createLineMesh(points, color, parent) {
        if (points.length < 2) return null;
        const vecs = points.map(p => new BABYLON.Vector3(p.x, p.y, p.z || 0));
        const col = this._hexToColor3(color);
        const colors = vecs.map(() => new BABYLON.Color4(col.r, col.g, col.b, 1));
        const line = BABYLON.MeshBuilder.CreateLines('line_' + Math.random(), { points: vecs, colors, updatable: false }, this.scene);
        line.parent = parent;
        line.isPickable = false;
        return line;
    }


    _createDashedLineMesh(points, color, dashSize, gapSize, parent) {
        if (points.length < 2) return null;
        const vecs = points.map(p => new BABYLON.Vector3(p.x, p.y, p.z || 0));
        const col = this._hexToColor3(color);
        const line = BABYLON.MeshBuilder.CreateDashedLines('dline_' + Math.random(), {
            points: vecs, dashSize, gapSize, dashNb: 200, updatable: false
        }, this.scene);
        line.color = col;
        line.parent = parent;
        line.isPickable = false;
        return line;
    }

    _createFilledRect(x, y, w, h, color, alpha, z, parent) {
        const plane = BABYLON.MeshBuilder.CreatePlane('rect_' + Math.random(), { width: w, height: h }, this.scene);
        const mat = new BABYLON.StandardMaterial('rectMat_' + Math.random(), this.scene);
        mat.disableLighting = true;
        mat.emissiveColor = this._hexToColor3(color);
        mat.alpha = alpha;
        mat.backFaceCulling = false;
        plane.material = mat;
        plane.position = new BABYLON.Vector3(x + w / 2, y + h / 2, z);
        plane.parent = parent;
        plane.isPickable = false;
        return plane;
    }

    _createFilledPolygon(pts2d, color, alpha, z, parent) {
        if (pts2d.length < 3) return null;
        const shape = pts2d.map(p => new BABYLON.Vector3(p.x, p.y, 0));
        try {
            const poly = BABYLON.MeshBuilder.CreatePolygon('poly_' + Math.random(), { shape, depth: 0, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, this.scene);
            const mat = new BABYLON.StandardMaterial('polyMat_' + Math.random(), this.scene);
            mat.disableLighting = true;
            mat.emissiveColor = this._hexToColor3(color);
            mat.alpha = alpha;
            mat.backFaceCulling = false;
            poly.material = mat;
            poly.position.z = z;
            poly.parent = parent;
            poly.isPickable = false;
            return poly;
        } catch (e) {
            return null;
        }
    }

    _createTriangleMesh(verts, color, parent) {
        const mesh = new BABYLON.Mesh('tri_' + Math.random(), this.scene);
        const vertexData = new BABYLON.VertexData();
        vertexData.positions = verts;
        vertexData.indices = [0, 1, 2];
        vertexData.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
        vertexData.applyToMesh(mesh);
        const mat = new BABYLON.StandardMaterial('triMat_' + Math.random(), this.scene);
        mat.disableLighting = true;
        mat.emissiveColor = this._hexToColor3(color);
        mat.backFaceCulling = false;
        mesh.material = mat;
        mesh.parent = parent;
        mesh.isPickable = false;
        return mesh;
    }

    drawLine(start, end, color, group) {
        if (!start || !end) return;
        const sx = Number(start.x), sy = Number(start.y), ex = Number(end.x), ey = Number(end.y);
        if (![sx, sy, ex, ey].every(Number.isFinite)) return;
        this._createLineMesh([{ x: sx, y: sy, z: 0 }, { x: ex, y: ey, z: 0 }], color, group);
    }

    drawPolygon(polygon, color, group, filled = false) {
        if (!Array.isArray(polygon) || polygon.length === 0) return;
        const points = polygon.map(pt => {
            if (!pt) return null;
            const x = Number(Array.isArray(pt) ? pt[0] : pt.x);
            const y = Number(Array.isArray(pt) ? pt[1] : pt.y);
            return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
        }).filter(Boolean);
        if (points.length < 2) return;
        if (filled && points.length >= 3) {
            this._createFilledPolygon(points, color, 0.3, 0, group);
        }
        const linePoints = [...points, points[0]].map(p => ({ x: p.x, y: p.y, z: 0 }));
        this._createLineMesh(linePoints, color, group);
    }

    drawThickWall(start, end, thickness, parent, color = 0x1a1a1a, z = 0.04) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.1) return;
        const mx = (start.x + end.x) / 2;
        const my = (start.y + end.y) / 2;
        const angle = Math.atan2(dy, dx);
        const wallThickness = Math.max(0.0035, Number(thickness) * 0.26);
        // Keep joins crisp; over-extension creates bulky corner blobs.
        const extendedLength = len + Math.min(0.002, wallThickness * 0.06);

        const wall = BABYLON.MeshBuilder.CreatePlane(
            'wall_' + Math.random(),
            { width: extendedLength, height: wallThickness },
            this.scene
        );
        const mat = new BABYLON.StandardMaterial('wallMat_' + Math.random(), this.scene);
        mat.disableLighting = true;
        mat.emissiveColor = this._hexToColor3(color);
        mat.backFaceCulling = false;
        wall.material = mat;
        wall.position = new BABYLON.Vector3(mx, my, z);
        wall.rotation.z = angle;
        wall.parent = parent;
        wall.isPickable = false;
    }

    renderDoors(doors) {
        if (!this.doorsGroup) { this.doorsGroup = new BABYLON.TransformNode('doors', this.scene); this.doorsGroup.parent = this.planRoot; }
        this._disposeChildren(this.doorsGroup);
        if (!Array.isArray(doors)) return;

        doors.forEach(door => {
            if (!door || door.width === undefined) return;
            const x = door.x, y = door.y, w = door.width, rot = door.rotation || 0;

            // Draw Door Arc (Quarter Circle)
            const arcPts = [];
            const segments = 12;
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * (Math.PI / 2);
                // Assume left-hand swing for now, or use door.swing info if available
                arcPts.push({
                    x: x + w * Math.cos(angle + rot),
                    y: y + w * Math.sin(angle + rot),
                    z: 0.1
                });
            }
            // Add center to close the pie slice (optional, or just arc line)
            // Reference shows thin red arc line
            this._createLineMesh(arcPts, 0xd90014, this.doorsGroup);

            // Draw Door Leaf (Rect/Line)
            const leafEnd = {
                x: x + w * Math.cos(rot + Math.PI / 2),
                y: y + w * Math.sin(rot + Math.PI / 2)
            };
            this._createLineMesh([{ x, y, z: 0.1 }, { x: leafEnd.x, y: leafEnd.y, z: 0.1 }], 0x000000, this.doorsGroup);
        });
    }

    renderWindows(windows) {
        if (!this.windowsGroup) { this.windowsGroup = new BABYLON.TransformNode('windows', this.scene); this.windowsGroup.parent = this.planRoot; }
        this._disposeChildren(this.windowsGroup);
        if (!Array.isArray(windows)) return;

        windows.forEach(win => {
            if (!win || win.width === undefined) return;
            // Draw Rectangle Frame + Glass Line
            // Need length and thickness. Assume walls are ~0.2 thick
            // Windows usually align with wall center
            const x = win.x, y = win.y, w = win.width, rot = win.rotation || 0;
            const thickness = 0.2;

            const dx = Math.cos(rot), dy = Math.sin(rot);
            const nx = -dy * (thickness / 2), ny = dx * (thickness / 2);

            const p1 = { x: x, y: y };
            const p2 = { x: x + w * dx, y: y + w * dy };

            // Frame Box (White fill with black trim)
            const framePts = [
                { x: p1.x + nx, y: p1.y + ny }, { x: p2.x + nx, y: p2.y + ny },
                { x: p2.x - nx, y: p2.y - ny }, { x: p1.x - nx, y: p1.y - ny }
            ];
            this._createFilledPolygon(framePts, 0xffffff, 1.0, 0.05, this.windowsGroup);
            const linePts = [...framePts, framePts[0]].map(p => ({ ...p, z: 0.06 }));
            this._createLineMesh(linePts, 0x000000, this.windowsGroup);

            // Center Glass Line
            this._createLineMesh([{ x: p1.x, y: p1.y, z: 0.06 }, { x: p2.x, y: p2.y, z: 0.06 }], 0x88ccff, this.windowsGroup);
        });
    }

    renderStairs(stairs) {
        if (!this.stairsGroup) { this.stairsGroup = new BABYLON.TransformNode('stairs', this.scene); this.stairsGroup.parent = this.planRoot; }
        this._disposeChildren(this.stairsGroup);
        if (!Array.isArray(stairs)) return;

        stairs.forEach(stair => {
            // simplified stair representation (series of parallel lines)
            const x = stair.x, y = stair.y, w = stair.width || 2, h = stair.height || 4, rot = stair.rotation || 0;
            const steps = 10;
            const dx = Math.cos(rot), dy = Math.sin(rot);
            const nx = -dy, ny = dx;

            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const sx = x + (h * dx) * t, sy = y + (h * dy) * t;
                const p1 = { x: sx, y: sy };
                const p2 = { x: sx + w * nx, y: sy + w * ny };
                this._createLineMesh([{ x: p1.x, y: p1.y, z: 0.05 }, { x: p2.x, y: p2.y, z: 0.05 }], 0x000000, this.stairsGroup);
            }
            // Arrow
            const arrowStart = { x: x + (h * 0.1) * dx + w * 0.5 * nx, y: y + (h * 0.1) * dy + w * 0.5 * ny };
            const arrowEnd = { x: x + (h * 0.9) * dx + w * 0.5 * nx, y: y + (h * 0.9) * dy + w * 0.5 * ny };
            this._createLineMesh([{ x: arrowStart.x, y: arrowStart.y, z: 0.06 }, { x: arrowEnd.x, y: arrowEnd.y, z: 0.06 }], 0x000000, this.stairsGroup);
        });
    }

    loadFloorPlan(floorPlan) {
        this.clear();
        // Orientation (flipX/flipY) is applied by fitToBounds at the end, with correct bounds.
        console.log('Loading floor plan:', { walls: floorPlan.walls?.length || 0, entrances: floorPlan.entrances?.length || 0, forbiddenZones: floorPlan.forbiddenZones?.length || 0, envelope: floorPlan.envelope?.length || 0 });

        if (this._shouldRenderEnvelope(floorPlan)) {
            floorPlan.envelope.forEach(line => {
                if (line.start && line.end) this.drawThickWall(line.start, line.end, 0.06, this.wallsGroup, 0x1a1a1a, 0.04);
            });
        }

        const drawEntity = (entity, group, defaultColor, forceColor = false) => {
            const color = forceColor ? defaultColor : (entity.color || defaultColor || 0x000000);
            if (entity.polygon) this.drawPolygon(entity.polygon, color, group, false);
            else if (entity.start && entity.end) this.drawLine(entity.start, entity.end, color, group);
        };

        if (floorPlan.walls) {
            floorPlan.walls.forEach(e => {
                // Use drawThickWall for walls (Production Styling)
                // If width is missing, assume 0.2
                const segs = this._wallToSegments(e, { closePolygon: true });
                if (segs.length > 0) {
                    segs.forEach((seg) => {
                        this.drawThickWall(seg.start, seg.end, e.width || 0.1, this.wallsGroup);
                    });
                } else {
                    drawEntity(e, this.wallsGroup, 0x1a1a1a, true);
                }
            });
        }

        // Extract entities if organized by type
        const doors = [], windows = [], stairs = [];
        if (floorPlan.entities) {
            floorPlan.entities.forEach(ent => {
                if (ent.type === 'DOOR') doors.push(ent);
                if (ent.type === 'WINDOW') windows.push(ent);
                if (ent.type === 'STAIRS') stairs.push(ent);
            });
        }

        this.renderDoors(doors);
        this.renderWindows(windows);
        this.renderStairs(stairs);

        if (floorPlan.entrances) floorPlan.entrances.forEach(e => drawEntity(e, this.entrancesGroup, 0xff0000));

        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(entity => {
                if (entity.polygon) {
                    const pts = entity.polygon.map(pt => ({ x: Array.isArray(pt) ? pt[0] : pt.x, y: Array.isArray(pt) ? pt[1] : pt.y }));
                    this._createFilledPolygon(pts, 0xffcc00, 0.5, 0.05, this.forbiddenGroup);
                    const lp = [...pts, pts[0]].map(p => ({ x: p.x, y: p.y, z: 0.06 }));
                    this._createLineMesh(lp, 0xcc9900, this.forbiddenGroup);
                } else drawEntity(entity, this.forbiddenGroup, 0xffcc00, true);
            });
        }

        if (floorPlan.specialRooms && Array.isArray(floorPlan.specialRooms)) {
            floorPlan.specialRooms.forEach(room => {
                if (room.label && room.label.match(/^RM-\d+$/) && room.polygon) {
                    const pts = room.polygon.map(pt => ({ x: Array.isArray(pt) ? pt[0] : pt.x, y: Array.isArray(pt) ? pt[1] : pt.y }));
                    this._createFilledPolygon(pts, 0xff6666, 0.4, 0.01, this.wallsGroup);
                    if (room.position) {
                        const label = this.createTextSprite(room.label, { fontSize: 20, fontColor: '#ff0000', backgroundColor: 'rgba(255,255,255,0.9)' });
                        label.position = new BABYLON.Vector3(room.position.x, room.position.y, 0.1);
                        label.scaling = new BABYLON.Vector3(1.5, 1.5, 1);
                        label.parent = this.labelsGroup; // Parent to labelsGroup
                    }
                }
            });
        }

        if (floorPlan.greenZones && Array.isArray(floorPlan.greenZones)) {
            floorPlan.greenZones.forEach(zone => {
                if (zone.polygon) {
                    const pts = zone.polygon.map(pt => ({ x: Array.isArray(pt) ? pt[0] : pt.x, y: Array.isArray(pt) ? pt[1] : pt.y }));
                    this._createFilledPolygon(pts, 0x00ff00, 0.3, 0.01, this.wallsGroup);
                    if (zone.label && zone.position) {
                        const label = this.createTextSprite(zone.label, { fontSize: 20, fontColor: '#000000', backgroundColor: 'rgba(255,255,255,0.9)' });
                        label.position = new BABYLON.Vector3(zone.position.x, zone.position.y, 0.1);
                        label.scaling = new BABYLON.Vector3(1.5, 1.5, 1);
                        label.parent = this.labelsGroup; // Parent to labelsGroup
                    }
                }
            });
        }

        if (floorPlan.annotations && Array.isArray(floorPlan.annotations)) {
            floorPlan.annotations.forEach(a => {
                if (a.type === 'yellow-box' && a.text && a.position) {
                    const label = this.createTextSprite(a.text, { fontSize: 18, fontColor: '#000000', backgroundColor: 'rgba(255,255,0,0.8)', padding: 5 });
                    label.position = new BABYLON.Vector3(a.position.x, a.position.y, 0.1);
                    label.scaling = new BABYLON.Vector3(1.2, 1.2, 1);
                    label.parent = this.labelsGroup; // Parent to labelsGroup
                }
            });
        }

        if (Array.isArray(floorPlan.dimensions)) {
            floorPlan.dimensions.forEach((dim) => {
                if (!dim || !dim.position) return;
                const x = Number(dim.position.x);
                const y = Number(dim.position.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                const value = Number(dim.value);
                const unit = dim.unit || 'm';
                const text = Number.isFinite(value) ? `${value.toFixed(2)} ${unit}` : `${dim.value || ''}`.trim();
                if (!text) return;
                const label = this.createTextSprite(text, {
                    fontSize: 12,
                    fontColor: '#111111',
                    backgroundColor: 'rgba(255,255,255,0)',
                    padding: 0
                });
                label.position = new BABYLON.Vector3(x, y, 0.09);
                label.scaling = new BABYLON.Vector3(0.34, 0.18, 1);
                label.parent = this.labelsGroup;
            });
        }

        if (Array.isArray(floorPlan.functionalAreas)) {
            floorPlan.functionalAreas.forEach((area) => {
                if (!area || !area.position || !area.label) return;
                const x = Number(area.position.x);
                const y = Number(area.position.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                const label = this.createTextSprite(String(area.label), {
                    fontSize: 13,
                    fontColor: '#1f2937',
                    backgroundColor: 'rgba(255,255,255,0.85)',
                    padding: 2
                });
                label.position = new BABYLON.Vector3(x, y, 0.09);
                label.scaling = new BABYLON.Vector3(0.42, 0.2, 1);
                label.parent = this.labelsGroup;
            });
        }

        if (Array.isArray(floorPlan.entities)) {
            floorPlan.entities.forEach((ent) => {
                if (!ent || (ent.type !== 'TEXT' && ent.type !== 'MTEXT')) return;
                const rawText = ent.text || ent.string || ent.mtext || ent.content || '';
                const text = String(rawText || '').replace(/\s+/g, ' ').trim();
                if (!text) return;

                const basePos = ent.position || ent.insertionPoint || ent.startPoint
                    || (Array.isArray(ent.vertices) && ent.vertices.length > 0 ? ent.vertices[0] : null);
                if (!basePos) return;
                const x = Number(Array.isArray(basePos) ? basePos[0] : basePos.x);
                const y = Number(Array.isArray(basePos) ? basePos[1] : basePos.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;

                const label = this.createTextSprite(text, {
                    fontSize: 10,
                    fontColor: '#2b2b2b',
                    backgroundColor: 'rgba(255,255,255,0)',
                    padding: 0
                });
                label.position = new BABYLON.Vector3(x, y, 0.085);

                const rawHeight = Number(ent.textHeight || ent.height || 0.5);
                const scale = Number.isFinite(rawHeight)
                    ? Math.max(0.08, Math.min(0.45, rawHeight * 0.2))
                    : 0.14;
                label.scaling = new BABYLON.Vector3(scale, scale * 0.52, 1);

                const rawRotation = Number(ent.rotation || ent.angle || 0);
                if (Number.isFinite(rawRotation) && rawRotation !== 0) {
                    const radians = Math.abs(rawRotation) > (Math.PI * 2 + 0.001)
                        ? (rawRotation * Math.PI / 180)
                        : rawRotation;
                    label.rotation = new BABYLON.Vector3(0, 0, radians);
                }

                label.parent = this.labelsGroup;
            });
        }

        const rawFitBounds = this._deriveRenderableBounds(floorPlan);
        if (rawFitBounds) this.fitToBounds(rawFitBounds);
        this.render();
    }

    renderEntranceArrows(entrances, bounds) {
        if (!Array.isArray(entrances) || entrances.length === 0 || !bounds) return;
        if (!this.entranceArrowsGroup) {
            this.entranceArrowsGroup = new BABYLON.TransformNode('entranceArrows', this.scene);
            this.entranceArrowsGroup.parent = this.planRoot; // Parent to planRoot
        }
        this._disposeChildren(this.entranceArrowsGroup);

        const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
        entrances.forEach(ent => {
            let x, y, angle;
            if (ent.start && ent.end) {
                x = (ent.start.x + ent.end.x) / 2; y = (ent.start.y + ent.end.y) / 2;
                angle = Math.atan2(centerY - y, centerX - x);
            } else if (ent.x !== undefined && ent.y !== undefined) {
                x = ent.x; y = ent.y; angle = Math.atan2(centerY - y, centerX - x);
            } else if (ent.polygon) {
                x = ent.polygon.reduce((s, p) => s + (p.x || p[0] || 0), 0) / ent.polygon.length;
                y = ent.polygon.reduce((s, p) => s + (p.y || p[1] || 0), 0) / ent.polygon.length;
                angle = Math.atan2(centerY - y, centerX - x);
            } else return;

            const sz = 0.42;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const verts = [
                -sz * 0.6 * cos - (-sz * 0.4) * sin + x, -sz * 0.6 * sin + (-sz * 0.4) * cos + y, 0.2,
                -sz * 0.6 * cos - (sz * 0.4) * sin + x, -sz * 0.6 * sin + (sz * 0.4) * cos + y, 0.2,
                sz * 0.6 * cos + x, sz * 0.6 * sin + y, 0.2
            ];
            this._createTriangleMesh(verts, 0x00aa00, this.entranceArrowsGroup);
        });
        console.log(`Rendered ${entrances.length} entrance arrows (green)`);
        this.render();
    }
    renderCostoLayout(floorPlan, layoutData) {
        console.log('[COSTO Layout] Drawing professional plan (COSTO reference style)');
        this.clear();
        // Orientation (flipX/flipY) is applied by fitToBounds at the end, with correct bounds.

        const bounds = floorPlan && floorPlan.bounds ? floorPlan.bounds : null;
        const units = Array.isArray(layoutData?.units) ? layoutData.units : [];
        const corridors = Array.isArray(layoutData?.corridors) ? layoutData.corridors : [];
        const radiators = Array.isArray(layoutData?.radiators) ? layoutData.radiators : [];
        const circulationPaths = Array.isArray(layoutData?.circulationPaths) ? layoutData.circulationPaths : [];
        const showBoxZigzags = layoutData?.showBoxZigzags === true;
        const wallColor = 0x15181c;
        const wallThickness = 0.18;
        const envelopeColor = wallColor;
        const toleGriseColor = 0x2563eb;
        const toleBlancheColor = 0x7c7f87;
        const zigzagColor = 0xe33b50;
        const boxOutlineByPartition = new Map([
            ['tolegrise', toleGriseColor],
            ['toleblanche', toleBlancheColor]
        ]);

        const collectPoints = [];
        const pushPoint = (x, y) => {
            if (Number.isFinite(x) && Number.isFinite(y)) collectPoints.push({ x, y });
        };
        const pushPath = (path) => {
            if (!Array.isArray(path)) return;
            path.forEach((pt) => {
                if (!pt) return;
                const x = Number(Array.isArray(pt) ? pt[0] : pt.x);
                const y = Number(Array.isArray(pt) ? pt[1] : pt.y);
                pushPoint(x, y);
            });
        };

        units.forEach((u) => {
            if (![u.x, u.y, u.width, u.height].every(Number.isFinite)) return;
            pushPoint(u.x, u.y);
            pushPoint(u.x + u.width, u.y + u.height);
        });
        corridors.forEach((c) => {
            if ([c.x, c.y, c.width, c.height].every(Number.isFinite)) {
                pushPoint(c.x, c.y);
                pushPoint(c.x + c.width, c.y + c.height);
            }
            pushPath(c.path || c.corners || c.polygon);
        });
        circulationPaths.forEach((cp) => pushPath(cp.path));
        radiators.forEach((rad) => pushPath(rad.path));
        if (Array.isArray(floorPlan?.walls)) {
            floorPlan.walls.forEach((w) => {
                const segs = this._wallToSegments(w, { closePolygon: true });
                segs.forEach((seg) => {
                    pushPoint(seg.start.x, seg.start.y);
                    pushPoint(seg.end.x, seg.end.y);
                });
            });
        }

        let fitBounds = bounds || null;
        if (collectPoints.length >= 12) {
            const xs = collectPoints.map((p) => p.x).sort((a, b) => a - b);
            const ys = collectPoints.map((p) => p.y).sort((a, b) => a - b);
            const r = 0.003;
            const li = Math.floor(xs.length * r);
            const hi = Math.max(li + 1, Math.ceil(xs.length * (1 - r)) - 1);
            const minX = xs[Math.min(li, xs.length - 1)];
            const maxX = xs[Math.min(hi, xs.length - 1)];
            const minY = ys[Math.min(li, ys.length - 1)];
            const maxY = ys[Math.min(hi, ys.length - 1)];
            if ([minX, minY, maxX, maxY].every(Number.isFinite) && maxX > minX && maxY > minY) {
                const padX = Math.max(0.04, (maxX - minX) * 0.01);
                const padY = Math.max(0.04, (maxY - minY) * 0.01);
                fitBounds = {
                    minX: minX - padX,
                    minY: minY - padY,
                    maxX: maxX + padX,
                    maxY: maxY + padY
                };
            }
        }

        const trafficPrimaryLine = 0xd21414;   // Red "ligne circulation" (match reference + PDF)
        const trafficSecondaryLine = 0xe85c5c; // Lighter red for secondary
        const trafficArrowColor = 0xd21414;   // Red (match circulation line)

        // Compute plan span for scaling arrow sizes
        const fb = fitBounds || bounds || { minX: 0, minY: 0, maxX: 50, maxY: 50 };
        const planSpan = Math.max(
            (fb.maxX || 50) - (fb.minX || 0),
            (fb.maxY || 50) - (fb.minY || 0),
            10
        );
        // Arrow size: ~0.5% of plan span (e.g. 0.2m for a 40m plan — clearly visible)
        const baseArrowHalfLength = Math.max(0.08, planSpan * 0.005);
        const baseArrowHalfWidth = baseArrowHalfLength * 0.4;
        const arrowClearancePad = Math.max(0.04, planSpan * 0.002);
        const arrowNudgeDist = Math.max(0.04, planSpan * 0.004);
        // Dash sizes proportional to plan span for visible circulation lines
        const baseDashSize = Math.max(0.2, planSpan * 0.01);
        const baseGapSize = Math.max(0.12, planSpan * 0.006);
        const renderedTrafficSegments = new Map();
        const quant = (v) => Math.round(v * 20) / 20; // 5cm grid keying
        const segKey = (a, b) => {
            const ax = quant(a.x), ay = quant(a.y), bx = quant(b.x), by = quant(b.y);
            const k1 = `${ax},${ay}|${bx},${by}`;
            const k2 = `${bx},${by}|${ax},${ay}`;
            return k1 < k2 ? k1 : k2;
        };

        const unitRectsForArrowClearance = units
            .map((u) => ({
                x: Number(u?.x),
                y: Number(u?.y),
                w: Number(u?.width),
                h: Number(u?.height)
            }))
            .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h) && r.w > 0 && r.h > 0);

        const wallSegmentsForArrowClearance = [];
        const pushWallSegment = (start, end) => {
            if (!start || !end) return;
            const x1 = Number(start.x);
            const y1 = Number(start.y);
            const x2 = Number(end.x);
            const y2 = Number(end.y);
            if (![x1, y1, x2, y2].every(Number.isFinite)) return;
            wallSegmentsForArrowClearance.push({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
        };

        if (Array.isArray(floorPlan?.walls)) {
            floorPlan.walls.forEach((wall) => {
                const segs = this._wallToSegments(wall, { closePolygon: true });
                segs.forEach((seg) => pushWallSegment(seg.start, seg.end));
            });
        }
        if (this._shouldRenderEnvelope(floorPlan) && Array.isArray(floorPlan?.envelope)) {
            floorPlan.envelope.forEach((line) => pushWallSegment(line?.start, line?.end));
        }

        const pointInRect = (x, y, rect, pad = 0) => (
            x >= rect.x - pad &&
            x <= rect.x + rect.w + pad &&
            y >= rect.y - pad &&
            y <= rect.y + rect.h + pad
        );
        const distancePointToSegment = (px, py, a, b) => {
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const len2 = vx * vx + vy * vy;
            if (!Number.isFinite(len2) || len2 <= 1e-9) {
                return Math.hypot(px - a.x, py - a.y);
            }
            let t = ((px - a.x) * vx + (py - a.y) * vy) / len2;
            t = Math.max(0, Math.min(1, t));
            const cx = a.x + vx * t;
            const cy = a.y + vy * t;
            return Math.hypot(px - cx, py - cy);
        };
        const isArrowPlacementClear = (x, y) => {
            if (unitRectsForArrowClearance.some((r) => pointInRect(x, y, r, arrowClearancePad))) return false;
            if (wallSegmentsForArrowClearance.some((seg) => distancePointToSegment(x, y, seg.a, seg.b) < arrowClearancePad)) return false;
            return true;
        };

        const drawArrowGlyph = (cx, cy, angle, options = {}) => {
            const force = options.force === true;
            const allowNudge = options.allowNudge !== false;
            const sizeScale = Number.isFinite(options.sizeScale) ? options.sizeScale : 1;
            const halfWidth = Math.max(baseArrowHalfWidth * 0.5, baseArrowHalfWidth * sizeScale);
            const halfLength = Math.max(baseArrowHalfLength * 0.5, baseArrowHalfLength * sizeScale);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const nx = -sin;
            const ny = cos;

            const candidates = [{ x: cx, y: cy }];
            if (allowNudge) {
                [arrowNudgeDist, -arrowNudgeDist, arrowNudgeDist * 1.8, -arrowNudgeDist * 1.8].forEach((d) => {
                    candidates.push({ x: cx + nx * d, y: cy + ny * d });
                });
            }

            for (const pt of candidates) {
                if (!force && !isArrowPlacementClear(pt.x, pt.y)) continue;
                const verts = [
                    pt.x - halfLength * cos - (-halfWidth) * sin, pt.y - halfLength * sin + (-halfWidth) * cos, 0.12,
                    pt.x - halfLength * cos - (halfWidth) * sin, pt.y - halfLength * sin + (halfWidth) * cos, 0.12,
                    pt.x + halfLength * cos, pt.y + halfLength * sin, 0.12
                ];
                this._createTriangleMesh(verts, options.color || trafficArrowColor, this.corridorsGroup);
                return true;
            }
            return false;
        };

        const addDirectionalArrows = (start, end, options = {}) => {
            const spacing = Number.isFinite(options.spacing) ? options.spacing : 4.5;
            const color = options.color || trafficArrowColor;
            const inset = Number.isFinite(options.inset) ? options.inset : 0.26;
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const segLen = Math.hypot(dx, dy);
            if (!Number.isFinite(segLen) || segLen < 0.12) return false;
            const ux = dx / segLen;
            const uy = dy / segLen;
            const angle = Math.atan2(dy, dx);
            const sizeScale = Math.max(0.52, Math.min(0.82, segLen / 6.4));
            const safeInset = Math.min(inset, Math.max(0.03, segLen * 0.22));
            const usable = Math.max(0, segLen - safeInset * 2);
            const count = Math.max(1, Math.min(3, Math.floor(usable / spacing) + 1));
            let placed = 0;
            let placedAny = false;
            const drawArrow = (cx, cy, force = false) => {
                if (!drawArrowGlyph(cx, cy, angle, { color, sizeScale, force, allowNudge: true })) return false;
                placed += 1;
                placedAny = true;
                return true;
            };

            for (let i = 0; i < count; i++) {
                const d = count === 1
                    ? segLen * 0.5
                    : safeInset + (usable * i) / Math.max(1, count - 1);
                const cx = start.x + ux * d;
                const cy = start.y + uy * d;
                drawArrow(cx, cy, false);
            }
            if (placed === 0) {
                const midX = start.x + ux * (segLen * 0.5);
                const midY = start.y + uy * (segLen * 0.5);
                drawArrow(midX, midY, false) || drawArrow(midX, midY, true);
            }
            return placedAny;
        };

        const drawTrafficPath = (pts, options = {}) => {
            if (!Array.isArray(pts) || pts.length < 2) return;
            const withArrows = options.withArrows !== false;
            const lineColor = options.secondary ? trafficSecondaryLine : trafficPrimaryLine;
            const dashSize = Number.isFinite(options.dashSize) ? options.dashSize : (options.secondary ? baseDashSize * 0.8 : baseDashSize);
            const gapSize = Number.isFinite(options.gapSize) ? options.gapSize : (options.secondary ? baseGapSize * 1.2 : baseGapSize);

            for (let i = 0; i < pts.length - 1; i++) {
                const p1 = pts[i];
                const p2 = pts[i + 1];
                if (!p1 || !p2) continue;
                const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (!Number.isFinite(len) || len < 0.08) continue;
                const key = segKey(p1, p2);
                const state = renderedTrafficSegments.get(key) || { line: false, arrows: false };
                if (!state.line) {
                    this._createLineMesh(
                        [{ x: p1.x, y: p1.y, z: 0.08 }, { x: p2.x, y: p2.y, z: 0.08 }],
                        lineColor,
                        this.corridorsGroup
                    );
                    state.line = true;
                }
                if (withArrows && !state.arrows) {
                    const placed = addDirectionalArrows(p1, p2, {
                        spacing: Number.isFinite(options.arrowSpacing) ? options.arrowSpacing : 5.0,
                        color: trafficArrowColor
                    });
                    if (placed) state.arrows = true;
                }
                renderedTrafficSegments.set(key, state);
            }
        };

        const normalizePathPoints = (path, z = 0.08) => {
            if (!Array.isArray(path) || path.length < 2) return null;
            const pts = path.map((pt) => {
                if (!pt) return null;
                const x = Number(Array.isArray(pt) ? pt[0] : pt.x);
                const y = Number(Array.isArray(pt) ? pt[1] : pt.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                return { x, y, z };
            }).filter(Boolean);
            return pts.length >= 2 ? pts : null;
        };

        const displayBounds = fitBounds || bounds || null;

        if (displayBounds) {
            this._createFilledRect(
                displayBounds.minX,
                displayBounds.minY,
                displayBounds.maxX - displayBounds.minX,
                displayBounds.maxY - displayBounds.minY,
                0xffffff,
                1.0,
                -0.02,
                this.wallsGroup
            );
        }

        const hasCirculationPaths = circulationPaths.length > 0;
        if (!hasCirculationPaths) {
            corridors.forEach((c) => {
                const pathPts = normalizePathPoints(c.path || c.corners || c.polygon, 0.08);
                if (pathPts && pathPts.length >= 2) {
                    drawTrafficPath(pathPts, { withArrows: true, secondary: false, arrowSpacing: 2.35 });
                }
                if ([c.x, c.y, c.width, c.height].every(Number.isFinite)) {
                    const isH = c.direction === 'horizontal' || c.width > c.height;
                    const cx = c.x + c.width / 2;
                    const cy = c.y + c.height / 2;
                    const pts = isH
                        ? [{ x: c.x, y: cy, z: 0.08 }, { x: c.x + c.width, y: cy, z: 0.08 }]
                        : [{ x: cx, y: c.y, z: 0.08 }, { x: cx, y: c.y + c.height, z: 0.08 }];
                    drawTrafficPath(pts, { withArrows: true, secondary: false, arrowSpacing: 2.35 });
                }
            });
        }

        const corridorGuideSegments = [];
        const pushGuideSegmentsFromPath = (pts) => {
            if (!Array.isArray(pts) || pts.length < 2) return;
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i];
                const b = pts[i + 1];
                if (!a || !b) continue;
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                if (!Number.isFinite(len) || len < 0.35) continue;
                corridorGuideSegments.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
            }
        };
        if (circulationPaths.length > 0) {
            circulationPaths.forEach((cp) => pushGuideSegmentsFromPath(normalizePathPoints(cp.path, 0.08)));
            corridors.forEach((c) => {
                pushGuideSegmentsFromPath(normalizePathPoints(c.path || c.corners || c.polygon, 0.08));
                if (![c.x, c.y, c.width, c.height].every(Number.isFinite)) return;
                const isH = c.direction === 'horizontal' || c.width > c.height;
                const cx = c.x + c.width / 2;
                const cy = c.y + c.height / 2;
                const pts = isH
                    ? [{ x: c.x, y: cy, z: 0.08 }, { x: c.x + c.width, y: cy, z: 0.08 }]
                    : [{ x: cx, y: c.y, z: 0.08 }, { x: cx, y: c.y + c.height, z: 0.08 }];
                pushGuideSegmentsFromPath(pts);
            });
        } else {
            corridors.forEach((c) => {
                const pathPts = normalizePathPoints(c.path || c.corners || c.polygon, 0.08);
                if (pathPts && pathPts.length >= 2) {
                    pushGuideSegmentsFromPath(pathPts);
                }
                if ([c.x, c.y, c.width, c.height].every(Number.isFinite)) {
                    const isH = c.direction === 'horizontal' || c.width > c.height;
                    const cx = c.x + c.width / 2;
                    const cy = c.y + c.height / 2;
                    const pts = isH
                        ? [{ x: c.x, y: cy, z: 0.08 }, { x: c.x + c.width, y: cy, z: 0.08 }]
                        : [{ x: cx, y: c.y, z: 0.08 }, { x: cx, y: c.y + c.height, z: 0.08 }];
                    pushGuideSegmentsFromPath(pts);
                }
            });
        }

        const closestPointOnSegment = (px, py, a, b) => {
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const len2 = vx * vx + vy * vy;
            if (!Number.isFinite(len2) || len2 <= 1e-8) return { x: a.x, y: a.y };
            let t = ((px - a.x) * vx + (py - a.y) * vy) / len2;
            t = Math.max(0, Math.min(1, t));
            return { x: a.x + vx * t, y: a.y + vy * t };
        };

        const resolveZigzagSide = (ilot) => {
            const cx = ilot.x + ilot.width / 2;
            const cy = ilot.y + ilot.height / 2;
            let best = null;
            for (const seg of corridorGuideSegments) {
                const cp = closestPointOnSegment(cx, cy, seg.a, seg.b);
                const dx = cp.x - cx;
                const dy = cp.y - cy;
                const d2 = dx * dx + dy * dy;
                if (!Number.isFinite(d2)) continue;
                if (!best || d2 < best.d2) best = { d2, dx, dy };
            }
            if (!best) return 'top';
            if (Math.abs(best.dx) >= Math.abs(best.dy)) {
                return best.dx >= 0 ? 'right' : 'left';
            }
            return best.dy >= 0 ? 'top' : 'bottom';
        };

        const drawBoxCirculationZigzag = (ilot, side) => {
            const z = 0.09;
            const offset = 0.01;
            const horiz = side === 'top' || side === 'bottom';
            const run = horiz ? ilot.width : ilot.height;
            if (!Number.isFinite(run) || run <= 0.18) return;

            const zigThickness = 0.014;
            const notchWidth = Math.max(0.22, Math.min(0.52, run * 0.38));
            const halfSpan = notchWidth * 0.5;
            const amp = Math.max(0.065, Math.min(0.16, Math.min(ilot.width, ilot.height) * 0.2));
            const mid = run / 2;
            const outward = (side === 'top' || side === 'right') ? 1 : -1;

            const pts = [];
            if (side === 'top' || side === 'bottom') {
                const yBase = side === 'top' ? (ilot.y + ilot.height + offset) : (ilot.y - offset);
                const x1 = ilot.x + mid - halfSpan;
                const x2 = ilot.x + mid + halfSpan;
                pts.push({ x: x1, y: yBase, z });
                pts.push({ x: x1 + notchWidth * 0.32, y: yBase, z });
                pts.push({ x: ilot.x + mid, y: yBase + outward * amp, z });
                pts.push({ x: x2 - notchWidth * 0.32, y: yBase, z });
                pts.push({ x: x2, y: yBase, z });
            } else {
                const xBase = side === 'right' ? (ilot.x + ilot.width + offset) : (ilot.x - offset);
                const y1 = ilot.y + mid - halfSpan;
                const y2 = ilot.y + mid + halfSpan;
                pts.push({ x: xBase, y: y1, z });
                pts.push({ x: xBase, y: y1 + notchWidth * 0.32, z });
                pts.push({ x: xBase + outward * amp, y: ilot.y + mid, z });
                pts.push({ x: xBase, y: y2 - notchWidth * 0.32, z });
                pts.push({ x: xBase, y: y2, z });
            }

            for (let i = 0; i < pts.length - 1; i++) {
                this.drawThickWall(
                    { x: pts[i].x, y: pts[i].y },
                    { x: pts[i + 1].x, y: pts[i + 1].y },
                    zigThickness,
                    this.corridorsGroup,
                    zigzagColor,
                    z
                );
            }
        };

        const showLabels = units.length <= 800;
        // Draw compact unit measurement glyphs for production exports and close-zoom QA.
        const showMeasurementGlyphs = units.length <= 420;
        const drawUnitMeasurementGlyph = (ilot) => {
            if (![ilot.x, ilot.y, ilot.width, ilot.height].every(Number.isFinite)) return;

            const w = ilot.width;
            const h = ilot.height;
            const area = Number.isFinite(ilot.area) ? ilot.area : (w * h);
            const shortSide = Math.min(w, h);
            const longSide = Math.max(w, h);
            if (!Number.isFinite(shortSide) || shortSide <= 0 || !Number.isFinite(longSide) || longSide <= 0) return;

            const arrowColor = 0x1f2937;
            const labelColor = '#111111';
            const dimText = Number.isFinite(shortSide) ? shortSide.toFixed(2) : '';
            const areaText = Number.isFinite(area) ? `${area.toFixed(2)}m²` : '';
            const vertical = h >= w;

            if (vertical) {
                const x = ilot.x + w * 0.5;
                const inset = Math.max(0.08, Math.min(0.22, h * 0.18));
                const y1 = ilot.y + inset;
                const y2 = ilot.y + h - inset;
                if (y2 <= y1) return;

                this._createLineMesh([{ x, y: y1, z: 0.07 }, { x, y: y2, z: 0.07 }], arrowColor, this.labelsGroup);

                const arrowLen = Math.max(0.08, Math.min(0.18, shortSide * 0.3));
                const arrowHalf = Math.max(0.03, Math.min(0.085, shortSide * 0.16));
                this._createTriangleMesh([
                    x - arrowHalf, y1 + arrowLen, 0.071,
                    x + arrowHalf, y1 + arrowLen, 0.071,
                    x, y1, 0.071
                ], arrowColor, this.labelsGroup);
                this._createTriangleMesh([
                    x - arrowHalf, y2 - arrowLen, 0.071,
                    x + arrowHalf, y2 - arrowLen, 0.071,
                    x, y2, 0.071
                ], arrowColor, this.labelsGroup);

                if (dimText) {
                    const dimSprite = this.createTextSprite(dimText, {
                        fontSize: 7,
                        fontColor: labelColor,
                        backgroundColor: 'rgba(255,255,255,0.45)',
                        padding: 0
                    });
                    dimSprite.position = new BABYLON.Vector3(x + Math.max(0.06, w * 0.14), ilot.y + h * 0.55, 0.072);
                    dimSprite.scaling = new BABYLON.Vector3(0.38, 0.2, 1);
                    dimSprite.parent = this.labelsGroup;
                }
                if (areaText) {
                    const areaSprite = this.createTextSprite(areaText, {
                        fontSize: 6,
                        fontColor: '#4b5563',
                        backgroundColor: 'rgba(255,255,255,0)',
                        padding: 0
                    });
                    areaSprite.position = new BABYLON.Vector3(x + Math.max(0.08, w * 0.2), ilot.y + h * 0.42, 0.072);
                    areaSprite.scaling = new BABYLON.Vector3(0.32, 0.16, 1);
                    areaSprite.parent = this.labelsGroup;
                }
                return;
            }

            const y = ilot.y + h * 0.5;
            const inset = Math.max(0.08, Math.min(0.22, w * 0.18));
            const x1 = ilot.x + inset;
            const x2 = ilot.x + w - inset;
            if (x2 <= x1) return;

            this._createLineMesh([{ x: x1, y, z: 0.07 }, { x: x2, y, z: 0.07 }], arrowColor, this.labelsGroup);

            const arrowLen = Math.max(0.08, Math.min(0.18, shortSide * 0.3));
            const arrowHalf = Math.max(0.03, Math.min(0.085, shortSide * 0.16));
            this._createTriangleMesh([
                x1 + arrowLen, y - arrowHalf, 0.071,
                x1 + arrowLen, y + arrowHalf, 0.071,
                x1, y, 0.071
            ], arrowColor, this.labelsGroup);
            this._createTriangleMesh([
                x2 - arrowLen, y - arrowHalf, 0.071,
                x2 - arrowLen, y + arrowHalf, 0.071,
                x2, y, 0.071
            ], arrowColor, this.labelsGroup);

            if (dimText) {
                const dimSprite = this.createTextSprite(dimText, {
                    fontSize: 7,
                    fontColor: labelColor,
                    backgroundColor: 'rgba(255,255,255,0.45)',
                    padding: 0
                });
                dimSprite.position = new BABYLON.Vector3(ilot.x + w * 0.56, y + Math.max(0.06, h * 0.16), 0.072);
                dimSprite.scaling = new BABYLON.Vector3(0.38, 0.2, 1);
                dimSprite.parent = this.labelsGroup;
            }
            if (areaText) {
                const areaSprite = this.createTextSprite(areaText, {
                    fontSize: 6,
                    fontColor: '#4b5563',
                    backgroundColor: 'rgba(255,255,255,0)',
                    padding: 0
                });
                areaSprite.position = new BABYLON.Vector3(ilot.x + w * 0.5, y - Math.max(0.07, h * 0.2), 0.072);
                areaSprite.scaling = new BABYLON.Vector3(0.32, 0.16, 1);
                areaSprite.parent = this.labelsGroup;
            }
        };

        units.forEach((ilot, index) => {
            if (![ilot.x, ilot.y, ilot.width, ilot.height].every(Number.isFinite)) return;
            const partitionKey = String(ilot.partitionType || '').toLowerCase().replace(/[^a-z]/g, '');
            const outlineColor = boxOutlineByPartition.get(partitionKey) || toleGriseColor;
            const BOX_FILL_GREY = 0xe0e0e4; // Light grey (reference: filled boxes on entire plan)
            const fillMesh = this._createFilledRect(ilot.x, ilot.y, ilot.width, ilot.height, BOX_FILL_GREY, 1.0, 0.01, this.ilotsGroup);
            if (fillMesh) {
                fillMesh.userData = { ilot, index, type: 'ilot', _origColor: BOX_FILL_GREY, _origOpacity: 1.0 };
                fillMesh.isPickable = true;
                this.ilotMeshes.push(fillMesh);
            }

            const lp = [
                { x: ilot.x, y: ilot.y, z: 0.03 }, { x: ilot.x + ilot.width, y: ilot.y, z: 0.03 },
                { x: ilot.x + ilot.width, y: ilot.y + ilot.height, z: 0.03 }, { x: ilot.x, y: ilot.y + ilot.height, z: 0.03 },
                { x: ilot.x, y: ilot.y, z: 0.03 }
            ];
            if (outlineColor === toleGriseColor) {
                const thick = Math.max(0.074, Math.min(0.16, (Math.min(ilot.width, ilot.height) || 1) * 0.07));
                this.drawThickWall({ x: ilot.x, y: ilot.y }, { x: ilot.x + ilot.width, y: ilot.y }, thick, this.ilotsGroup, outlineColor, 0.03);
                this.drawThickWall({ x: ilot.x + ilot.width, y: ilot.y }, { x: ilot.x + ilot.width, y: ilot.y + ilot.height }, thick, this.ilotsGroup, outlineColor, 0.03);
                this.drawThickWall({ x: ilot.x + ilot.width, y: ilot.y + ilot.height }, { x: ilot.x, y: ilot.y + ilot.height }, thick, this.ilotsGroup, outlineColor, 0.03);
                this.drawThickWall({ x: ilot.x, y: ilot.y + ilot.height }, { x: ilot.x, y: ilot.y }, thick, this.ilotsGroup, outlineColor, 0.03);
            } else {
                this._createLineMesh(lp, outlineColor, this.ilotsGroup);
            }

            if (showBoxZigzags) {
                const zigzagSide = resolveZigzagSide(ilot);
                drawBoxCirculationZigzag(ilot, zigzagSide);
            }
            if (showMeasurementGlyphs) {
                drawUnitMeasurementGlyph(ilot);
            }

            if (showLabels) {
                const numberLabel = Number.isFinite(ilot.displayNumber)
                    ? String(ilot.displayNumber)
                    : (Number.isFinite(ilot.number) ? String(ilot.number) : null);
                if (numberLabel) {
                    const numSprite = this.createTextSprite(numberLabel, {
                        fontSize: 8,
                        fontColor: '#3a3a3a',
                        backgroundColor: 'rgba(255,255,255,0.55)',
                        padding: 0
                    });
                    numSprite.position = new BABYLON.Vector3(ilot.x + ilot.width / 2, ilot.y + ilot.height * 0.58, 0.06);
                    numSprite.scaling = new BABYLON.Vector3(0.58, 0.3, 1);
                    numSprite.parent = this.labelsGroup;
                }

                const area = ilot.area || (ilot.width * ilot.height);
                if (Number.isFinite(area) && area > 0) {
                    const dimText = ilot.sublabel || `${ilot.width.toFixed(2)} × ${ilot.height.toFixed(2)}`;
                    const areaSprite = this.createTextSprite(dimText, {
                        fontSize: 7,
                        fontColor: '#2563eb',
                        backgroundColor: 'rgba(255,255,255,0.6)',
                        padding: 0
                    });
                    areaSprite.position = new BABYLON.Vector3(ilot.x + ilot.width / 2, ilot.y + ilot.height * 0.36, 0.06);
                    areaSprite.scaling = new BABYLON.Vector3(0.5, 0.24, 1);
                    areaSprite.parent = this.labelsGroup;
                }
            }
        });

        // Always render the building envelope (outer wall outline)
        const envelopeSegs = Array.isArray(floorPlan?.envelope) ? floorPlan.envelope.filter(l => l && l.start && l.end) : [];
        if (envelopeSegs.length > 0) {
            envelopeSegs.forEach((line) => {
                this.drawThickWall(line.start, line.end, wallThickness, this.wallsGroup, envelopeColor, 0.04);
            });
        } else if (displayBounds) {
            // Fallback: draw outer rectangle from bounds
            const b = displayBounds;
            const corners = [
                { x: b.minX, y: b.minY },
                { x: b.maxX, y: b.minY },
                { x: b.maxX, y: b.maxY },
                { x: b.minX, y: b.maxY }
            ];
            for (let i = 0; i < 4; i++) {
                this.drawThickWall(corners[i], corners[(i + 1) % 4], wallThickness, this.wallsGroup, envelopeColor, 0.04);
            }
        }
        if (Array.isArray(floorPlan?.walls)) {
            floorPlan.walls.forEach((wall) => {
                const segs = this._wallToSegments(wall, { closePolygon: true });
                segs.forEach((seg) => {
                    this.drawThickWall(seg.start, seg.end, wallThickness, this.wallsGroup, wallColor, 0.04);
                });
            });
        }

        if (Array.isArray(floorPlan?.forbiddenZones)) {
            floorPlan.forbiddenZones.forEach((fz) => {
                if (Array.isArray(fz.polygon)) {
                    const pts = fz.polygon.map((pt) => ({ x: Array.isArray(pt) ? pt[0] : pt.x, y: Array.isArray(pt) ? pt[1] : pt.y }));
                    this._createFilledPolygon(pts, 0xe0e0e0, 0.10, 0.02, this.forbiddenGroup);
                    // Add thin dark outline
                    const outlinePts = pts.map((p) => ({ x: p.x, y: p.y, z: 0.025 }));
                    if (outlinePts.length > 0) outlinePts.push({ ...outlinePts[0] });
                    this._createLineMesh(outlinePts, 0x888888, this.forbiddenGroup);
                }
            });
        }

        if (Array.isArray(floorPlan?.entrances)) {
            floorPlan.entrances.forEach((ent) => {
                if (ent.start && ent.end) {
                    this._createLineMesh(
                        [{ x: ent.start.x, y: ent.start.y, z: 0.04 }, { x: ent.end.x, y: ent.end.y, z: 0.04 }],
                        0x00aa00,
                        this.entrancesGroup
                    );
                }
            });
        }

        if (!this.radiatorsGroup) {
            this.radiatorsGroup = new BABYLON.TransformNode('radiators', this.scene);
            this.radiatorsGroup.parent = this.planRoot;
        }
        this._disposeChildren(this.radiatorsGroup);
        // Draw data-provided radiators only (reference-style, avoids synthetic clutter).
        radiators.forEach((rad) => {
            if (Array.isArray(rad.path) && rad.path.length >= 2) {
                const vecs = rad.path
                    .map((pt) => ({ x: Number(pt.x), y: Number(pt.y) }))
                    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
                if (vecs.length >= 2) this._drawZigzagRadiator(vecs, this.radiatorsGroup);
            }
        });

        const segmentContainsPayloadArrow = (p1, p2, arrows) => {
            if (!Array.isArray(arrows) || arrows.length === 0) return false;
            return arrows.some((arrow) => {
                const ax = Number(arrow?.x);
                const ay = Number(arrow?.y);
                if (!Number.isFinite(ax) || !Number.isFinite(ay)) return false;
                return distancePointToSegment(ax, ay, p1, p2) <= 0.14;
            });
        };

        const renderPayloadArrows = (cp, isSecondary = false) => {
            const arrows = Array.isArray(cp?.arrows) ? cp.arrows : [];
            if (!arrows.length) return [];
            const placed = [];
            arrows.forEach((arrow) => {
                const x = Number(arrow?.x);
                const y = Number(arrow?.y);
                const angle = Number(arrow?.angle);
                if (![x, y, angle].every(Number.isFinite)) return;
                const ok = drawArrowGlyph(x, y, angle, {
                    color: trafficArrowColor,
                    sizeScale: isSecondary ? 0.9 : 1.0,
                    allowNudge: true,
                    force: false
                }) || drawArrowGlyph(x, y, angle, {
                    color: trafficArrowColor,
                    sizeScale: isSecondary ? 0.9 : 1.0,
                    allowNudge: false,
                    force: true
                });
                if (ok) placed.push({ x, y });
            });
            return placed;
        };

        circulationPaths.forEach((cp) => {
            const pts = normalizePathPoints(cp.path, 0.09);
            if (!pts || pts.length < 2) return;
            const type = String(cp.type || '').toUpperCase();
            const isSecondary = type === 'CORRIDOR_CENTER';
            const hasPayloadArrows = Array.isArray(cp.arrows) && cp.arrows.length > 0;
            drawTrafficPath(pts, {
                withArrows: !hasPayloadArrows,
                secondary: isSecondary,
                arrowSpacing: isSecondary ? 5.0 : 4.5
            });
            const placedPayloadArrows = hasPayloadArrows ? renderPayloadArrows(cp, isSecondary) : [];
            for (let i = 0; i < pts.length - 1; i++) {
                const p1 = pts[i];
                const p2 = pts[i + 1];
                const key = segKey(p1, p2);
                const state = renderedTrafficSegments.get(key) || { line: false, arrows: false };
                if (hasPayloadArrows && segmentContainsPayloadArrow(p1, p2, placedPayloadArrows)) {
                    state.arrows = true;
                }
                renderedTrafficSegments.set(key, state);
            }
        });

        // Coverage pass: fill only missing arrows, keep deterministic one-way direction.
        const firstFlow = circulationPaths.find((cp) => cp?.flowEntry && cp?.flowExit);
        const flowVector = firstFlow
            ? {
                x: Number(firstFlow.flowExit.x) - Number(firstFlow.flowEntry.x),
                y: Number(firstFlow.flowExit.y) - Number(firstFlow.flowEntry.y)
            }
            : { x: 1, y: 0 };
        const hasArrowOn = (p1, p2) => {
            const state = renderedTrafficSegments.get(segKey(p1, p2));
            return !!(state && state.arrows);
        };
        const orientWithFlow = (pts) => {
            if (!Array.isArray(pts) || pts.length < 2) return pts;
            const a = pts[0];
            const b = pts[pts.length - 1];
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const dot = vx * flowVector.x + vy * flowVector.y;
            return dot < 0 ? [...pts].reverse() : pts;
        };

        circulationPaths.forEach((cp) => {
            const pts = normalizePathPoints(cp.path, 0.09);
            if (!pts || pts.length < 2) return;
            const type = String(cp.type || '').toUpperCase();
            const isSecondary = type === 'CORRIDOR_CENTER';
            for (let i = 0; i < pts.length - 1; i++) {
                const p1 = pts[i];
                const p2 = pts[i + 1];
                const key = segKey(p1, p2);
                const state = renderedTrafficSegments.get(key) || { line: false, arrows: false };
                if (!state.arrows) {
                    const placed = addDirectionalArrows(p1, p2, {
                        spacing: isSecondary ? 5.0 : 4.5,
                        color: trafficArrowColor,
                        inset: 0.24
                    });
                    if (placed) state.arrows = true;
                    renderedTrafficSegments.set(key, state);
                }
            }
        });

        corridors.forEach((c) => {
            const drawIfMissing = (rawPts) => {
                const pts = normalizePathPoints(rawPts, 0.08);
                if (!pts || pts.length < 2) return;
                const oriented = orientWithFlow(pts);
                let hasMissing = false;
                for (let i = 0; i < oriented.length - 1; i++) {
                    if (!hasArrowOn(oriented[i], oriented[i + 1])) {
                        hasMissing = true;
                        break;
                    }
                }
                if (!hasMissing) return;
                for (let i = 0; i < oriented.length - 1; i++) {
                    const p1 = oriented[i];
                    const p2 = oriented[i + 1];
                    const key = segKey(p1, p2);
                    const state = renderedTrafficSegments.get(key) || { line: false, arrows: false };
                    if (!state.arrows) {
                        const placed = addDirectionalArrows(p1, p2, {
                            spacing: 5.0,
                            color: trafficArrowColor,
                            inset: 0.22
                        });
                        if (placed) {
                            state.arrows = true;
                            renderedTrafficSegments.set(key, state);
                        }
                    }
                }
            };

            drawIfMissing(c.path || c.corners || c.polygon);
            if ([c.x, c.y, c.width, c.height].every(Number.isFinite)) {
                const isH = c.direction === 'horizontal' || c.width > c.height;
                const cx = c.x + c.width / 2;
                const cy = c.y + c.height / 2;
                const centerPts = isH
                    ? [{ x: c.x, y: cy, z: 0.08 }, { x: c.x + c.width, y: cy, z: 0.08 }]
                    : [{ x: cx, y: c.y, z: 0.08 }, { x: cx, y: c.y + c.height, z: 0.08 }];
                drawIfMissing(centerPts);
            }
        });

        if (displayBounds) {
            this.fitToBounds(displayBounds);
            // Draw professional CAD sheet overlay
            this._drawCostoSheetOverlay(displayBounds, units);
        }
        console.log(`[COSTO Layout] Complete: ${units.length} boxes, ${corridors.length} corridors, ${radiators.length} radiators, ${circulationPaths.length} circulation`);
        this.render();
    }

    _drawCostoSheetOverlay(bounds, units) {
        if (!this.overlayGroup) {
            this.overlayGroup = new BABYLON.TransformNode('sheetOverlay', this.scene);
            this.overlayGroup.parent = this.planRoot;
        }
        this._disposeChildren(this.overlayGroup);

        const margin = 6.0;
        const minX = bounds.minX - margin;
        const maxX = bounds.maxX + margin + 14;
        const minY = bounds.minY - margin - 7;
        const maxY = bounds.maxY + margin;

        const greenLineColor = 0x2e7d32;

        const drawRect = (x1, y1, x2, y2) => {
            const pts = [
                { x: x1, y: y1 }, { x: x2, y: y1 },
                { x: x2, y: y2 }, { x: x1, y: y2 },
                { x: x1, y: y1 }
            ];
            this._createLineMesh(pts.map(p => ({ ...p, z: 0.2 })), greenLineColor, this.overlayGroup);
        };
        drawRect(minX, minY, maxX, maxY);
        drawRect(minX + 0.3, minY + 0.3, maxX - 0.3, maxY - 0.3);

        const barH = 5.0;
        const barTopY = minY + barH;
        this._createLineMesh([{ x: minX, y: barTopY, z: 0.2 }, { x: maxX, y: barTopY, z: 0.2 }], greenLineColor, this.overlayGroup);

        const pageBoxW = 5;
        this._createLineMesh([{ x: minX + pageBoxW, y: minY, z: 0.2 }, { x: minX + pageBoxW, y: barTopY, z: 0.2 }], greenLineColor, this.overlayGroup);
        const pageNum = this.createTextSprite('3', { fontSize: 32, fontColor: '#000000', backgroundColor: 'transparent' });
        pageNum.position = new BABYLON.Vector3(minX + pageBoxW / 2, minY + barH / 2, 0.25);
        pageNum.scaling = new BABYLON.Vector3(1.5, 1.5, 1);
        pageNum.parent = this.overlayGroup;

        const pe1 = this.createTextSprite('PLAN ETAGE 01  1-200', { fontSize: 22, fontColor: '#000000', backgroundColor: 'transparent' });
        pe1.position = new BABYLON.Vector3(minX + pageBoxW + 14, minY + barH / 2, 0.25);
        pe1.scaling = new BABYLON.Vector3(2.2, 1.2, 1);
        pe1.parent = this.overlayGroup;

        const total_area = units.reduce((s, u) => s + (u.area || u.width * u.height || 0), 0);
        const surfLabel = this.createTextSprite('SURFACES DES BOX', { fontSize: 26, fontColor: '#000000', backgroundColor: 'transparent' });
        surfLabel.position = new BABYLON.Vector3((minX + maxX) / 2, minY + barH / 2, 0.25);
        surfLabel.scaling = new BABYLON.Vector3(2.5, 1.4, 1);
        surfLabel.parent = this.overlayGroup;

        const rightSepX = maxX - 22;
        this._createLineMesh([{ x: rightSepX, y: minY, z: 0.2 }, { x: rightSepX, y: barTopY, z: 0.2 }], greenLineColor, this.overlayGroup);
        const pe2 = this.createTextSprite('PLAN ETAGE 02  1-200', { fontSize: 20, fontColor: '#000000', backgroundColor: 'transparent' });
        pe2.position = new BABYLON.Vector3(rightSepX - 14, minY + barH / 2, 0.25);
        pe2.scaling = new BABYLON.Vector3(2.0, 1.1, 1);
        pe2.parent = this.overlayGroup;

        const coSepX = maxX - 18;
        this._createLineMesh([{ x: coSepX, y: minY, z: 0.2 }, { x: coSepX, y: barTopY, z: 0.2 }], greenLineColor, this.overlayGroup);

        const texts = ['-COSTO-', '5 chemin de la dime 95700', 'Roissy FRANCE'];
        texts.forEach((line, i) => {
            const lbl = this.createTextSprite(line, { fontSize: 13, fontColor: '#000000', backgroundColor: 'transparent' });
            lbl.position = new BABYLON.Vector3(coSepX + (maxX - coSepX) / 2, barTopY - 1.2 - i * 1.4, 0.25);
            lbl.scaling = new BABYLON.Vector3(1.2, 0.8, 1);
            lbl.parent = this.overlayGroup;
        });

        const pe2Top = this.createTextSprite('PLAN ETAGE 02  1-200', { fontSize: 22, fontColor: '#000000', backgroundColor: 'transparent' });
        pe2Top.position = new BABYLON.Vector3(bounds.maxX + 8, maxY - 2.5, 0.25);
        pe2Top.scaling = new BABYLON.Vector3(2.2, 1.2, 1);
        pe2Top.parent = this.overlayGroup;

        const spLabel = this.createTextSprite(`SP : ${total_area.toFixed(2)}m²`, { fontSize: 18, fontColor: '#1565c0', backgroundColor: 'transparent' });
        spLabel.position = new BABYLON.Vector3(bounds.maxX + 8, maxY - 20, 0.25);
        spLabel.scaling = new BABYLON.Vector3(1.8, 1.0, 1);
        spLabel.parent = this.overlayGroup;

        const legX = bounds.minX + 2, legY = maxY - 3;
        const compR = 1.5;
        this._createLineMesh([{ x: legX, y: legY - compR * 2, z: 0.2 }, { x: legX, y: legY, z: 0.2 }], 0x000000, this.overlayGroup);

        const northLabel = this.createTextSprite('N', { fontSize: 16, fontColor: '#000000', backgroundColor: 'transparent' });
        northLabel.position = new BABYLON.Vector3(legX, legY + 0.5, 0.25);
        northLabel.scaling = new BABYLON.Vector3(0.9, 0.9, 1);
        northLabel.parent = this.overlayGroup;

        const entryLegY = legY - compR * 2 - 1.5;
        this._createLineMesh([{ x: legX, y: entryLegY, z: 0.2 }, { x: legX + 3, y: entryLegY, z: 0.2 }], 0x4b5563, this.overlayGroup);
        const tb = this.createTextSprite('Tole Blanche', { fontSize: 13, fontColor: '#374151', backgroundColor: 'transparent' });
        tb.position = new BABYLON.Vector3(legX + 5, entryLegY, 0.25);
        tb.scaling = new BABYLON.Vector3(1.1, 0.7, 1);
        tb.parent = this.overlayGroup;

        this._createLineMesh([{ x: legX, y: entryLegY - 1.4, z: 0.2 }, { x: legX + 3, y: entryLegY - 1.4, z: 0.2 }], 0xd21414, this.overlayGroup);
        this._createLineMesh([{ x: legX + 2.4, y: entryLegY - 1.4, z: 0.2 }, { x: legX + 1.8, y: entryLegY - 1.1, z: 0.2 }], 0xd21414, this.overlayGroup);
        this._createLineMesh([{ x: legX + 2.4, y: entryLegY - 1.4, z: 0.2 }, { x: legX + 1.8, y: entryLegY - 1.7, z: 0.2 }], 0xd21414, this.overlayGroup);
        const tg = this.createTextSprite('Ligne circulation', { fontSize: 13, fontColor: '#374151', backgroundColor: 'transparent' });
        tg.position = new BABYLON.Vector3(legX + 7, entryLegY - 1.4, 0.25);
        tg.scaling = new BABYLON.Vector3(1.8, 0.7, 1);
        tg.parent = this.overlayGroup;

        const scallPts = [];
        for (let i = 0; i <= 12; i++) {
            const t = (i / 12) * Math.PI;
            scallPts.push({ x: legX + i * 0.25, y: entryLegY - 2.8 + Math.sin(t) * 0.25, z: 0.2 });
        }
        this._createLineMesh(scallPts, 0xd90014, this.overlayGroup);
        const radLbl = this.createTextSprite('Radiateur', { fontSize: 13, fontColor: '#374151', backgroundColor: 'transparent' });
        radLbl.position = new BABYLON.Vector3(legX + 5, entryLegY - 2.8, 0.25);
        radLbl.scaling = new BABYLON.Vector3(1.0, 0.7, 1);
        radLbl.parent = this.overlayGroup;
    }

    renderIlots(ilots) {
        this.ilotMeshes.forEach(m => { if (m.parent) m.parent = null; m.dispose(); });
        this.ilotMeshes = [];
        this._disposeChildren(this.ilotsGroup);
        this._disposeChildren(this.labelsGroup); // Clear labels when re-rendering ilots

        const showLabels = ilots && ilots.length <= 800;
        if (!ilots || ilots.length === 0) { this.render(); return; }

        const BOX_FILL_GREY = 0xe0e0e4; // Light grey fill (matching reference: boxes filled on entire plan)
        ilots.forEach((ilot, index) => {
            if (!ilot || typeof ilot.x !== 'number' || typeof ilot.y !== 'number' || typeof ilot.width !== 'number' || typeof ilot.height !== 'number') return;

            // COSTO style: light grey fill (reference), thin black outline
            const fillMesh = this._createFilledRect(ilot.x, ilot.y, ilot.width, ilot.height, BOX_FILL_GREY, 1.0, 0.01, this.ilotsGroup);
            if (fillMesh) {
                fillMesh.userData = { ilot, index, type: 'ilot', _origColor: BOX_FILL_GREY, _origOpacity: 1.0 };
                fillMesh.isPickable = true;
                this.ilotMeshes.push(fillMesh);
            }

            // Thin black outline
            const lp = [
                { x: ilot.x, y: ilot.y, z: 0.03 }, { x: ilot.x + ilot.width, y: ilot.y, z: 0.03 },
                { x: ilot.x + ilot.width, y: ilot.y + ilot.height, z: 0.03 }, { x: ilot.x, y: ilot.y + ilot.height, z: 0.03 },
                { x: ilot.x, y: ilot.y, z: 0.03 }
            ];
            this._createLineMesh(lp, 0x1a1a1a, this.ilotsGroup);

            // Labels
            if (showLabels) {
                const dimVal = Math.min(ilot.width, ilot.height);
                const dimSprite = this.createTextSprite(dimVal.toFixed(2), { fontSize: 7, fontColor: '#1a1a1a', backgroundColor: 'rgba(255,255,255,0)', padding: 0 });
                dimSprite.position = new BABYLON.Vector3(ilot.x + ilot.width / 2, ilot.y + ilot.height * 0.6, 0.06);
                dimSprite.scaling = new BABYLON.Vector3(0.5, 0.25, 1);
                dimSprite.parent = this.labelsGroup; // Parent to labelsGroup

                const area = ilot.area || (ilot.width * ilot.height);
                const areaSprite = this.createTextSprite(`${area.toFixed(1)}m²`, { fontSize: 6, fontColor: '#555555', backgroundColor: 'rgba(255,255,255,0)', padding: 0 });
                areaSprite.position = new BABYLON.Vector3(ilot.x + ilot.width / 2, ilot.y + ilot.height * 0.35, 0.06);
                areaSprite.scaling = new BABYLON.Vector3(0.45, 0.22, 1);
                areaSprite.parent = this.labelsGroup; // Parent to labelsGroup
            }
        });

        // Restore selection highlight if applicable
        const selectedIndex = this.selectedIlots.length > 0 ? this.selectedIlots[0]?.userData?.index : -1;
        if (selectedIndex >= 0 && selectedIndex < this.ilotMeshes.length) {
            const mesh = this.ilotMeshes[selectedIndex];
            this.selectedIlots = [mesh];
            if (mesh.material) { mesh.material.emissiveColor = this._hexToColor3(0xd0e8ff); mesh.material.alpha = 0.6; }
        }

        console.log(`Rendered ${ilots.length} ilots in COSTO style`);
        // Update overlay if bounds exist
        if (this.currentBounds && this.showLayoutOverlay) {
            this.drawLayoutOverlay(this.currentBounds);
        }
        this.render();
    }

    renderCorridors(corridors) {
        this._disposeChildren(this.corridorsGroup);
        const arrowSpacing = 8.0;
        const arrowSize = 0.45;
        const lineColor = 0xd21414; // Red "ligne circulation" (match reference + PDF)
        const showDirectionalArrows = true;

        const normalizePath = (rawPoints) => {
            if (!Array.isArray(rawPoints)) return null;
            const pts = rawPoints.map(pt => {
                if (!pt) return null;
                const x = Number(pt.x !== undefined ? pt.x : pt[0]), y = Number(pt.y !== undefined ? pt.y : pt[1]);
                return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
            }).filter(Boolean);
            return pts.length >= 2 ? pts : null;
        };

        const createArrowMesh = (x, y, angle) => {
            const half = arrowSize * 0.5;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const v = [
                -arrowSize * cos - (-half) * sin + x, -arrowSize * sin + (-half) * cos + y, 0.15,
                -arrowSize * cos - (half) * sin + x, -arrowSize * sin + (half) * cos + y, 0.15,
                arrowSize * cos + x, arrowSize * sin + y, 0.15
            ];
            this._createTriangleMesh(v, 0xd21414, this.corridorsGroup);
        };

        corridors.forEach(corridor => {
            const pathPoints = normalizePath(corridor.path || corridor.corners);
            if (pathPoints) {
                this._createDashedLineMesh(
                    pathPoints.map(p => ({ x: p.x, y: p.y, z: 0.1 })),
                    lineColor,
                    0.35,
                    0.20,
                    this.corridorsGroup
                );
                if (showDirectionalArrows) {
                    for (let i = 0; i < pathPoints.length - 1; i++) {
                        const p1 = pathPoints[i], p2 = pathPoints[i + 1];
                        const dx = p2.x - p1.x, dy = p2.y - p1.y;
                        const len = Math.hypot(dx, dy);
                        const angle = Math.atan2(dy, dx);
                        if (len > 2) {
                            for (let d = 2; d < len - 1; d += arrowSpacing) {
                                createArrowMesh(p1.x + (dx / len) * d, p1.y + (dy / len) * d, angle);
                            }
                        }
                    }
                }
                return;
            }

            if (![corridor.x, corridor.y, corridor.width, corridor.height].every(n => Number.isFinite(n))) return;
            const isH = corridor.direction === 'horizontal' || corridor.width > corridor.height;
            const cX = corridor.x + corridor.width / 2, cY = corridor.y + corridor.height / 2;
            const centerPts = isH
                ? [{ x: corridor.x, y: cY, z: 0.1 }, { x: corridor.x + corridor.width, y: cY, z: 0.1 }]
                : [{ x: cX, y: corridor.y, z: 0.1 }, { x: cX, y: corridor.y + corridor.height, z: 0.1 }];
            this._createDashedLineMesh(centerPts, lineColor, 0.35, 0.20, this.corridorsGroup);

            if (showDirectionalArrows) {
                const arrowAngle = isH ? 0 : Math.PI / 2;
                if (isH) { for (let x = corridor.x + arrowSpacing / 2; x < corridor.x + corridor.width; x += arrowSpacing) createArrowMesh(x, cY, arrowAngle); }
                else { for (let y = corridor.y + arrowSpacing / 2; y < corridor.y + corridor.height; y += arrowSpacing) createArrowMesh(cX, y, arrowAngle); }
            }
        });

        console.log(`[Corridors] Rendered connected red dashed flow + arrows for ${corridors.length} corridors`);
        this.render();
    }

    renderRadiators(radiators) {
        if (!Array.isArray(radiators) || radiators.length === 0) return;
        if (!this.radiatorsGroup) {
            this.radiatorsGroup = new BABYLON.TransformNode('radiators', this.scene);
            this.radiatorsGroup.parent = this.planRoot; // Parent to planRoot
        }
        this._disposeChildren(this.radiatorsGroup);
        let rendered = 0;
        radiators.forEach(rad => {
            if (rad.positions && rad.positions.length > 0) {
                rad.positions.forEach(pos => { this._drawRadiatorSymbol(pos.x, pos.y, rad.wallAngle || 0); rendered++; });
                return;
            }
            if (rad.path && Array.isArray(rad.path) && rad.path.length >= 2) {
                const pts = rad.path.map(p => {
                    const x = Array.isArray(p) ? p[0] : Number(p.x), y = Array.isArray(p) ? p[1] : Number(p.y);
                    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
                }).filter(Boolean);
                if (pts.length >= 2) { this._drawZigzagRadiator(pts, this.radiatorsGroup); rendered++; }
                return;
            }
            if (Number.isFinite(rad.x) && Number.isFinite(rad.y)) { this._drawRadiatorSymbol(rad.x, rad.y, 0); rendered++; }
        });
        console.log(`[Radiators] Rendered ${rendered} radiator symbols`);
        this.render();
    }

    _drawRadiatorSymbol(cx, cy, angle, parent = this.radiatorsGroup) {
        // Professional compact radiator symbol: short coil with end brackets.
        const bodyLength = 0.9;
        const coilAmplitude = 0.09;
        const coilCycles = 5;
        const samples = coilCycles * 10;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nx = -sin;
        const ny = cos;
        const z = 0.15;

        const transform = (lx, ly) => ({
            x: cx + lx * cos + ly * nx,
            y: cy + lx * sin + ly * ny,
            z
        });

        const coilPts = [];
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const lx = (t - 0.5) * bodyLength;
            const ly = Math.sin(t * coilCycles * Math.PI * 2) * coilAmplitude;
            coilPts.push(transform(lx, ly));
        }
        this._createLineMesh(coilPts, 0x1f2937, parent);

        const bracketOffset = bodyLength * 0.5 + 0.04;
        const bracketHalf = 0.13;
        const bracketTick = 0.08;
        const drawBracket = (dir) => {
            const x0 = dir * bracketOffset;
            this._createLineMesh([transform(x0, -bracketHalf), transform(x0, bracketHalf)], 0x7bc8a4, parent);
            this._createLineMesh([transform(x0, -bracketHalf), transform(x0 + dir * bracketTick, -bracketHalf)], 0x7bc8a4, parent);
            this._createLineMesh([transform(x0, bracketHalf), transform(x0 + dir * bracketTick, bracketHalf)], 0x7bc8a4, parent);
        };
        drawBracket(-1);
        drawBracket(1);
    }

    _drawZigzagRadiator(pathPts, parent) {
        // Replace noisy full-length squiggles with sparse compact symbols.
        for (let seg = 0; seg < pathPts.length - 1; seg++) {
            const p1 = pathPts[seg], p2 = pathPts[seg + 1];
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const segLen = Math.hypot(dx, dy);
            if (segLen < 0.6) continue;
            const angle = Math.atan2(dy, dx);
            const symbols = Math.max(1, Math.min(3, Math.round(segLen / 4)));
            const inset = Math.min(0.45, segLen * 0.2);
            const usable = Math.max(0.2, segLen - inset * 2);

            for (let i = 0; i < symbols; i++) {
                const t = symbols === 1 ? 0.5 : (i + 0.5) / symbols;
                const d = inset + usable * t;
                const cx = p1.x + (dx / segLen) * d;
                const cy = p1.y + (dy / segLen) * d;
                this._drawRadiatorSymbol(cx, cy, angle, parent);
            }
        }
    }


    renderCirculationPaths(circulationPaths) {
        if (!Array.isArray(circulationPaths) || circulationPaths.length === 0) return;
        const arrowColor = 0xd21414; // Red "ligne circulation" (match reference + PDF)
        const lineColor = 0xd21414;
        const seenArrows = new Set();
        const seenSegments = new Set();
        const q = (v) => Math.round(v * 20) / 20;
        const segKey = (x1, y1, x2, y2) => {
            const a = `${q(x1)},${q(y1)}`;
            const b = `${q(x2)},${q(y2)}`;
            return a < b ? `${a}|${b}` : `${b}|${a}`;
        };
        console.log(`Rendered ${circulationPaths.length} circulation paths`);
        const arrowSize = 0.15;
        circulationPaths.forEach(cp => {
            const arrows = Array.isArray(cp.arrows) ? cp.arrows : [];
            if (arrows.length > 0) {
                arrows.forEach(arrow => {
                    const ax = Number(arrow.x), ay = Number(arrow.y), angle = Number(arrow.angle);
                    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(angle)) return;
                    const aKey = `${q(ax)},${q(ay)},${q(angle)}`;
                    if (seenArrows.has(aKey)) return;
                    seenArrows.add(aKey);
                    const cos = Math.cos(angle), sin = Math.sin(angle);
                    const v = [
                        -arrowSize * cos - (-arrowSize * 0.5) * sin + ax, -arrowSize * sin + (-arrowSize * 0.5) * cos + ay, 0.12,
                        -arrowSize * cos - (arrowSize * 0.5) * sin + ax, -arrowSize * sin + (arrowSize * 0.5) * cos + ay, 0.12,
                        arrowSize * 0.7 * cos + ax, arrowSize * 0.7 * sin + ay, 0.12
                    ];
                    this._createTriangleMesh(v, arrowColor, this.corridorsGroup);
                });
                return;
            }

            const path = Array.isArray(cp.path) ? cp.path : [];
            for (let i = 0; i < path.length - 1; i++) {
                const p1 = path[i];
                const p2 = path[i + 1];
                const x1 = Number(p1.x), y1 = Number(p1.y), x2 = Number(p2.x), y2 = Number(p2.y);
                if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
                const sk = segKey(x1, y1, x2, y2);
                if (!seenSegments.has(sk)) {
                    seenSegments.add(sk);
                    this._createDashedLineMesh(
                        [{ x: x1, y: y1, z: 0.1 }, { x: x2, y: y2, z: 0.1 }],
                        lineColor,
                        0.30,
                        0.18,
                        this.corridorsGroup
                    );
                }
                const dx = x2 - x1, dy = y2 - y1;
                const len = Math.hypot(dx, dy);
                if (len < 0.6) continue;
                const angle = Math.atan2(dy, dx);
                const midX = x1 + dx * 0.5;
                const midY = y1 + dy * 0.5;
                const aKey = `${q(midX)},${q(midY)},${q(angle)}`;
                if (seenArrows.has(aKey)) continue;
                seenArrows.add(aKey);
                const cos = Math.cos(angle), sin = Math.sin(angle);
                const v = [
                    -arrowSize * cos - (-arrowSize * 0.5) * sin + midX, -arrowSize * sin + (-arrowSize * 0.5) * cos + midY, 0.12,
                    -arrowSize * cos - (arrowSize * 0.5) * sin + midX, -arrowSize * sin + (arrowSize * 0.5) * cos + midY, 0.12,
                    arrowSize * 0.7 * cos + midX, arrowSize * 0.7 * sin + midY, 0.12
                ];
                this._createTriangleMesh(v, arrowColor, this.corridorsGroup);
            }
        });
        this.render();
    }

    renderCirculationLines(corridors) { if (corridors && corridors.length > 0) this.renderCorridors(corridors); }

    renderPerimeterCirculation(ilots, bounds) {
        if (!ilots || ilots.length === 0) return;
        this._disposeChildren(this.perimeterGroup);
        const rowTol = 0.5, rows = [];
        ilots.forEach(ilot => {
            const cy = ilot.y + (ilot.height || 1) / 2;
            let row = rows.find(r => Math.abs(r.centerY - cy) < rowTol);
            if (row) { row.ilots.push(ilot); row.minX = Math.min(row.minX, ilot.x); row.maxX = Math.max(row.maxX, ilot.x + (ilot.width || 1)); row.minY = Math.min(row.minY, ilot.y); row.maxY = Math.max(row.maxY, ilot.y + (ilot.height || 1)); }
            else rows.push({ centerY: cy, ilots: [ilot], minX: ilot.x, maxX: ilot.x + (ilot.width || 1), minY: ilot.y, maxY: ilot.y + (ilot.height || 1) });
        });
        rows.sort((a, b) => a.minY - b.minY);
        const margin = 0.3;
        rows.forEach(row => {
            const x1 = row.minX - margin, x2 = row.maxX + margin, y1 = row.minY - margin, y2 = row.maxY + margin;
            this._createDashedLineMesh([{ x: x1, y: y1, z: 0.15 }, { x: x2, y: y1, z: 0.15 }, { x: x2, y: y2, z: 0.15 }, { x: x1, y: y2, z: 0.15 }, { x: x1, y: y1, z: 0.15 }], 0x4488cc, 0.3, 0.15, this.perimeterGroup);
            if (row.ilots.length > 2) {
                const sz = 0.4, cx = (x1 + x2) / 2, cy2 = (y1 + y2) / 2;
                this._createTriangleMesh([-sz / 2 + cx, -sz / 3 + cy2, 0.2, sz / 2 + cx, cy2, 0.2, -sz / 2 + cx, sz / 3 + cy2, 0.2], 0x00ccff, this.perimeterGroup);
            }
        });
        console.log(`[COSTO] Rendered perimeter for ${rows.length} row clusters`);
        this.render();
    }

    renderExclusionZones(exclusionZones) {
        if (!this.exclusionZonesGroup) {
            this.exclusionZonesGroup = new BABYLON.TransformNode('exclusionZones', this.scene);
            this.exclusionZonesGroup.parent = this.planRoot; // Parent to planRoot
        }
        this._disposeChildren(this.exclusionZonesGroup);
        if (!exclusionZones || exclusionZones.length === 0) return;
        exclusionZones.forEach(zone => {
            this._createFilledRect(zone.x, zone.y, zone.width, zone.height, 0x9CA3AF, 0.4, 0.02, this.exclusionZonesGroup);
            const lp = [{ x: zone.x, y: zone.y, z: 0.03 }, { x: zone.x + zone.width, y: zone.y, z: 0.03 }, { x: zone.x + zone.width, y: zone.y + zone.height, z: 0.03 }, { x: zone.x, y: zone.y + zone.height, z: 0.03 }, { x: zone.x, y: zone.y, z: 0.03 }];
            this._createLineMesh(lp, 0x6B7280, this.exclusionZonesGroup);
            if (zone.zoneType) {
                const label = this.createTextSprite(zone.zoneType.charAt(0).toUpperCase() + zone.zoneType.slice(1), { fontSize: 12, fontColor: '#374151', backgroundColor: 'rgba(243,244,246,0.9)' });
                label.position = new BABYLON.Vector3(zone.x + zone.width / 2, zone.y + zone.height / 2, 0.05);
                label.scaling = new BABYLON.Vector3(0.3, 0.15, 1);
                label.parent = this.labelsGroup; // Parent to labelsGroup
            }
        });
        console.log(`[Renderer] Rendered ${exclusionZones.length} exclusion zones`);
        this.render();
    }

    clearCorridorArrows() {
        this.arrowMeshes.forEach(m => { if (m.parent) m.parent = null; m.dispose(); });
        this.arrowMeshes = [];
    }

    renderCorridorArrows(arrows = []) {
        this.clearCorridorArrows();
        if (!Array.isArray(arrows) || arrows.length === 0) { this.stopArrowAnimation(); this.render(); return; }
        arrows.forEach(arrow => {
            const mesh = this._createCorridorArrowMesh(arrow);
            if (mesh) { mesh.parent = this.corridorArrowsGroup; this.arrowMeshes.push(mesh); }
        });
        this.corridorArrowsGroup.setEnabled(this.corridorArrowsVisible);
        if (this.arrowMeshes.length > 0) this.startArrowAnimation();
        else { this.stopArrowAnimation(); this.render(); }
    }

    _createCorridorArrowMesh(arrow) {
        try {
            const sizeKey = typeof arrow.size === 'string' ? arrow.size.toLowerCase() : 'medium';
            const cfg = { small: { r: 0.12, h: 0.5 }, medium: { r: 0.18, h: 0.75 }, large: { r: 0.28, h: 1.1 } }[sizeKey] || { r: 0.18, h: 0.75 };
            const mesh = BABYLON.MeshBuilder.CreateCylinder('cone_' + Math.random(), { diameterTop: 0, diameterBottom: cfg.r * 2, height: cfg.h, tessellation: 16 }, this.scene);
            const mat = new BABYLON.StandardMaterial('arrowMat_' + Math.random(), this.scene);
            mat.disableLighting = true;
            mat.emissiveColor = this._hexToColor3(0xef4444);
            mat.backFaceCulling = false;
            mesh.material = mat;
            mesh.position.x = Number.isFinite(arrow.x) ? arrow.x : 0;
            mesh.position.y = Number.isFinite(arrow.y) ? arrow.y : 0;
            mesh.position.z = Number.isFinite(arrow.z) ? arrow.z : 0.6;
            const dir = typeof arrow.direction === 'string' ? arrow.direction.toLowerCase() : 'right';
            if (typeof arrow.angle === 'number' && Number.isFinite(arrow.angle)) mesh.rotation.z = arrow.angle;
            else { const angles = { left: Math.PI / 2, right: -Math.PI / 2, down: Math.PI, up: 0 }; mesh.rotation.z = angles[dir] || 0; }
            mesh.userData = { arrow, baseHeight: mesh.position.z };
            return mesh;
        } catch (e) { console.error('Failed to create corridor arrow:', e); return null; }
    }

    animateCorridorArrows(dt) {
        if (!this.arrowMeshes.length) return;
        this.arrowPulseTime += dt;
        this.arrowMeshes.forEach((mesh, i) => {
            const phase = this.arrowPulseTime * 2 + i * 0.35;
            const s = 0.9 + 0.15 * Math.sin(phase);
            mesh.scaling.set(s, s, s);
            if (mesh.userData?.arrow?.type === 'entrance_flow') {
                const base = mesh.userData.baseHeight || mesh.position.z;
                mesh.position.z = base + 0.1 * Math.sin(this.arrowPulseTime * 3 + i * 0.4);
            }
        });
    }

    startArrowAnimation() {
        if (this.arrowAnimationActive) return;
        this.arrowAnimationActive = true;
        this._lastTime = performance.now();
        const tick = () => {
            if (!this.arrowAnimationActive) return;
            const now = performance.now();
            this.animateCorridorArrows((now - this._lastTime) / 1000);
            this._lastTime = now;
            this.render();
            this.arrowAnimationFrame = window.requestAnimationFrame(tick);
        };
        this.arrowAnimationFrame = window.requestAnimationFrame(tick);
    }

    stopArrowAnimation() {
        if (!this.arrowAnimationActive) return;
        this.arrowAnimationActive = false;
        if (this.arrowAnimationFrame !== null) { window.cancelAnimationFrame(this.arrowAnimationFrame); this.arrowAnimationFrame = null; }
    }

    setCorridorArrowsVisible(visible) {
        this.corridorArrowsVisible = Boolean(visible);
        this.corridorArrowsGroup.setEnabled(this.corridorArrowsVisible);
        if (this.corridorArrowsVisible && this.arrowMeshes.length) this.startArrowAnimation();
        else this.stopArrowAnimation();
        this.render();
    }

    setLayoutOverlayVisible(visible) {
        this.showLayoutOverlay = Boolean(visible);
        if (!this.showLayoutOverlay && this.overlayGroup) {
            this._disposeChildren(this.overlayGroup);
        } else if (this.showLayoutOverlay && this.currentBounds) {
            this.drawLayoutOverlay(this.currentBounds);
        }
        this.render();
    }

    setLayoutOverlayConfig(config = {}) {
        const base = this.layoutOverlayConfig || {};
        this.layoutOverlayConfig = {
            ...base,
            ...(config || {})
        };
        if (this.showLayoutOverlay && this.currentBounds) {
            this.drawLayoutOverlay(this.currentBounds);
        } else if (this.showLayoutOverlay) {
            this.render();
        }
    }

    fitToBounds(bounds) {
        if (!bounds || typeof bounds.minX !== 'number') return;
        this._applyPlanOrientation(bounds);
        const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
        const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
        if (w <= 0 || h <= 0) return;
        const aspect = this.container.clientWidth / this.container.clientHeight;
        const frustumSize = Math.max(w / aspect, h) * 1.04;

        // Revert camera flip - standard orientation
        this.camera.orthoLeft = frustumSize * aspect / -2;
        this.camera.orthoRight = frustumSize * aspect / 2;
        this.camera.orthoTop = frustumSize / 2;
        this.camera.orthoBottom = frustumSize / -2;

        // Camera looks at the geometric center; plan orientation is handled by planRoot transform.
        this.camera.position = new BABYLON.Vector3(cx, cy, 100);
        this.camera.rotation = new BABYLON.Vector3(0, 0, 0);
        this.camera.upVector = new BABYLON.Vector3(0, 1, 0);
        this.camera.setTarget(new BABYLON.Vector3(cx, cy, 0));
        console.log('Fitted to bounds (Standard Camera):', { cx, cy, w, h, frustumSize, orientation: this.viewOrientation });

        this.currentBounds = bounds;
        if (this.currentBounds && this.showLayoutOverlay) {
            this.drawLayoutOverlay(this.currentBounds);
        }

        this.render();
    }

    resetView() { this.render(); }

    render() {
        if (this._disposed) return;
        this._needsRender = true;
        const disposed = this.scene
            ? ((typeof this.scene.isDisposed === 'function') ? this.scene.isDisposed() : !!this.scene.isDisposed)
            : true;
        if (this.scene && this.scene.activeCamera && !disposed) {
            try {
                this.scene.render();
            } catch (error) {
                if (!this._lastRenderErrorAt || (Date.now() - this._lastRenderErrorAt) > 1500) {
                    this._lastRenderErrorAt = Date.now();
                    console.error('[BabylonRenderer] render() error:', error);
                }
            }
        }
    }

    toggleLayer(layerName, visible) {
        const groups = { walls: this.wallsGroup, entrances: this.entrancesGroup, forbidden: this.forbiddenGroup, ilots: this.ilotsGroup, corridors: this.corridorsGroup, arrows: this.corridorArrowsGroup };
        if (groups[layerName]) { groups[layerName].setEnabled(visible); if (layerName === 'arrows') this.corridorArrowsVisible = Boolean(visible); this.render(); }
    }

    selectIlot(ilotId) { const mesh = this.ilotMeshes[ilotId]; if (mesh) this.selectIlotMesh(mesh); }

    selectIlotMesh(mesh) {
        this.selectedIlots = [mesh];
        this.ilotMeshes.forEach(m => {
            if (m === mesh) { if (m.material) { m.material.emissiveColor = this._hexToColor3(0xd0e8ff); m.material.alpha = 0.6; } }
            else {
                const ud = m.userData;
                if (ud && ud._origColor !== undefined) { m.material.emissiveColor = this._hexToColor3(ud._origColor); m.material.alpha = ud._origOpacity; }
                else if (m.material) { m.material.emissiveColor = this._hexToColor3(0xffffff); m.material.alpha = 0; }
            }
        });
        if (mesh.userData?.ilot) {
            console.log('Selected ilot:', mesh.userData.ilot);
            this.dispatchEvent({ type: 'ilotSelected', ilot: mesh.userData.ilot, index: mesh.userData.index });
        }
        this.render();
    }

    clearSelection() {
        this.selectedIlots = [];
        this.ilotMeshes.forEach(m => {
            const ud = m.userData;
            if (ud && ud._origColor !== undefined) { m.material.emissiveColor = this._hexToColor3(ud._origColor); m.material.alpha = ud._origOpacity; }
            else if (m.material) { m.material.emissiveColor = this._hexToColor3(0xffffff); m.material.alpha = 0; }
        });
        this.render();
    }

    addEventListener(type, callback) { if (!this._eventListeners[type]) this._eventListeners[type] = []; this._eventListeners[type].push(callback); }
    removeEventListener(type, callback) { if (this._eventListeners[type]) this._eventListeners[type] = this._eventListeners[type].filter(cb => cb !== callback); }
    dispatchEvent(event) { if (this._eventListeners[event.type]) this._eventListeners[event.type].forEach(cb => cb(event)); }

    enableMeasurementMode(type = 'distance') { this.measurementMode = true; this.measurementType = type; this.measurementPoints = []; this._canvas.style.cursor = 'crosshair'; }
    disableMeasurementMode() { this.measurementMode = false; this.measurementPoints = []; this._canvas.style.cursor = 'default'; }

    addMeasurementPoint() {
        const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
        if (!pick.hit) return;
        const pt = pick.pickedPoint;
        this.measurementPoints.push(pt);
        const marker = BABYLON.MeshBuilder.CreateSphere('mpoint_' + Math.random(), { diameter: 0.3 }, this.scene);
        const mat = new BABYLON.StandardMaterial('mpointMat_' + Math.random(), this.scene);
        mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        marker.material = mat; marker.position = pt.clone(); marker.parent = this.measurementsGroup;

        if (this.measurementPoints.length >= 2) {
            const p1 = this.measurementPoints[0], p2 = this.measurementPoints[1];
            const dist = BABYLON.Vector3.Distance(p1, p2);
            this._createLineMesh([{ x: p1.x, y: p1.y, z: p1.z + 0.1 }, { x: p2.x, y: p2.y, z: p2.z + 0.1 }], 0xff0000, this.measurementsGroup);
            const mid = BABYLON.Vector3.Center(p1, p2);
            const label = this.createTextSprite(`${dist.toFixed(2)}m`, { fontSize: 14, fontColor: '#ff0000', backgroundColor: 'rgba(255,255,255,0.9)', padding: 4 });
            label.position = new BABYLON.Vector3(mid.x, mid.y, mid.z + 0.3);
            label.parent = this.labelsGroup; // Parent to labelsGroup
            this.measurementPoints = [];
        }
        this.render();
    }

    clearMeasurements() { this._disposeChildren(this.measurementsGroup); this.measurementPoints = []; this.render(); }

    toggle3DMode(enable) {
        const nextMode = typeof enable === 'boolean' ? enable : !this.is3DMode;
        this.is3DMode = nextMode;
        if (nextMode) {
            this.scene.activeCamera = this.perspectiveCamera;
            this.perspectiveCamera.attachControl(this._canvas, true);
        } else {
            this.perspectiveCamera.detachControl();
            this.scene.activeCamera = this.camera;
            if (this.currentBounds) this.fitToBounds(this.currentBounds);
        }
        this.render();
        return this.is3DMode;
    }

    toggleBloom(enable) { if (this._pipeline) this._pipeline.bloomEnabled = enable; this.render(); }
    toggleShadows(enable) { this.shadowsEnabled = enable; this.render(); }

    showGrid() {
        if (!this._gridLines) {
            this._gridLines = new BABYLON.TransformNode('grid', this.scene);
            this._gridLines.parent = this.planRoot; // Parent to planRoot
            for (let i = -100; i <= 100; i += 5) {
                this._createLineMesh([{ x: i, y: -100, z: -0.05 }, { x: i, y: 100, z: -0.05 }], 0xeeeeee, this._gridLines);
                this._createLineMesh([{ x: -100, y: i, z: -0.05 }, { x: 100, y: i, z: -0.05 }], 0xeeeeee, this._gridLines);
            }
        }
        this._gridLines.setEnabled(true);
        this.render();
    }
    hideGrid() { if (this._gridLines) this._gridLines.setEnabled(false); this.render(); }

    async captureImageData(width = null, height = null, useActiveCamera = true) {
        const exportWidth = Number.isFinite(width) && width > 0
            ? Math.round(width)
            : Math.max(1280, Math.round((this.container?.clientWidth || 640) * 2));
        const exportHeight = Number.isFinite(height) && height > 0
            ? Math.round(height)
            : Math.max(720, Math.round((this.container?.clientHeight || 360) * 2));
        const camera = useActiveCamera
            ? (this.scene?.activeCamera || this.camera)
            : this.camera;

        return new Promise((resolve, reject) => {
            try {
                BABYLON.Tools.CreateScreenshotUsingRenderTarget(
                    this.engine,
                    camera,
                    { width: exportWidth, height: exportHeight },
                    (data) => resolve(data)
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    async exportImage(width = null, height = null, options = {}) {
        const {
            download = true,
            filename = 'floorplan_export.png',
            useActiveCamera = true
        } = options || {};
        const data = await this.captureImageData(width, height, useActiveCamera);
        if (download) {
            const a = document.createElement('a');
            a.href = data;
            a.download = filename;
            a.click();
        }
        return data;
    }

    async exportGLTF() {
        if (typeof BABYLON.GLTF2Export === 'undefined') {
            console.warn('GLTF serializers not loaded. Include babylonjs.serializers.min.js');
            return null;
        }
        try {
            const glb = await BABYLON.GLTF2Export.GLBAsync(this.scene, 'floorplan');
            return glb;
        } catch (err) {
            console.error('GLTF export error:', err);
            return null;
        }
    }

    async downloadGLTF(filename = 'floorplan.glb') {
        const result = await this.exportGLTF();
        if (!result) {
            console.warn('GLTF export failed or serializers not available');
            return;
        }
        // GLTF2Export returns an object with downloadFiles method or glTFFiles
        if (typeof result.downloadFiles === 'function') {
            result.downloadFiles();
        } else if (result.glTFFiles) {
            // Manual download
            Object.keys(result.glTFFiles).forEach(key => {
                const blob = result.glTFFiles[key];
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = key;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
        }
    }

    renderFloorPlan(floorPlan, ilots, corridors) {
        this.loadFloorPlan(floorPlan);
        if (ilots && ilots.length > 0) this.renderIlots(ilots);
        if (corridors && corridors.length > 0) this.renderCorridors(corridors);
    }

    renderConnectors(connectors, options = {}) {
        this._disposeChildren(this.connectorsGroup);
        this.currentConnectors = connectors || [];
        this.currentConnectorOptions = options;
        if (!Array.isArray(connectors)) return;
        connectors.forEach(conn => {
            if (conn.polygon) this._createFilledPolygon(conn.polygon.map(p => ({ x: p.x || p[0], y: p.y || p[1] })), 0x8b5cf6, 0.4, 0.04, this.connectorsGroup);
            else if (conn.x !== undefined && conn.width !== undefined) this._createFilledRect(conn.x, conn.y, conn.width, conn.height, 0x8b5cf6, 0.4, 0.04, this.connectorsGroup);
        });
        this.render();
    }

    _connectorPolygon(connector) {
        if (connector.polygon) return connector.polygon;
        if (connector.x !== undefined) return [{ x: connector.x, y: connector.y }, { x: connector.x + connector.width, y: connector.y }, { x: connector.x + connector.width, y: connector.y + connector.height }, { x: connector.x, y: connector.y + connector.height }];
        return [];
    }

    renderStackedFloors(floors = [], options = {}) {
        this._disposeChildren(this.stackGroup);
        this.currentStackFloors = floors;
        this.currentStackOptions = options;
        if (floors.length === 0) return;
        this.stackGroup.setEnabled(true);
        const spacing = options.spacing || 10;
        floors.forEach((floor, i) => {
            const z = i * spacing;
            if (floor.units) {
                floor.units.forEach(u => {
                    const rect = this._createFilledRect(u.x, u.y, u.width, u.height, floor.color || 0x3b82f6, 0.5, z, this.stackGroup);
                    if (rect) rect.parent = this.stackGroup;
                });
            }
        });
        this.render();
    }

    clearStackedFloors() { this._disposeChildren(this.stackGroup); this.stackGroup.setEnabled(false); this.currentStackFloors = null; this.render(); }

    /**
     * Draws the Title Block, Legend, and Border to match the COSTO reference PDF.
     */
    drawLayoutOverlay(bounds) {
        if (!this.showLayoutOverlay) {
            if (this.overlayGroup) this._disposeChildren(this.overlayGroup);
            return;
        }
        if (!bounds) return;
        if (!this.overlayGroup) {
            this.overlayGroup = new BABYLON.TransformNode('overlay', this.scene);
        }
        this._disposeChildren(this.overlayGroup);
        const overlayBorderColor = 0x2b2b2b;

        const cfg = this.layoutOverlayConfig || {};
        const primaryTitle = cfg.title || 'PLAN ETAGE 01 1-200';
        const secondaryTitle = cfg.secondaryTitle || 'PLAN ETAGE 02 1-200';
        const sheetLabel = cfg.sheetNumber != null ? String(cfg.sheetNumber) : '3';
        const companyName = cfg.companyName || 'COSTO';
        const companyAddress = cfg.companyAddress || '5 chemin de la dime 95700\nRoissy FRANCE';
        const footerLabel = cfg.footerLabel || 'SURFACES DES BOX';

        // Calculate Visual Bounds (Flipped Y)
        const margin = 5.0;
        const minX = bounds.minX - margin * 2;
        const maxX = bounds.maxX + margin * 2;
        const visualMaxY = -(bounds.minY - margin); // Top in visual space
        const visualMinY = -(bounds.maxY + margin); // Bottom in visual space

        const overlayMinY = Math.min(visualMinY, visualMaxY); // Bottom Y
        const overlayMaxY = Math.max(visualMinY, visualMaxY); // Top Y
        const width = maxX - minX;

        // 1. Main Border (Double line)
        const borderPts = [
            { x: minX, y: overlayMinY, z: 0 }, { x: maxX, y: overlayMinY, z: 0 },
            { x: maxX, y: overlayMaxY, z: 0 }, { x: minX, y: overlayMaxY, z: 0 },
            { x: minX, y: overlayMinY, z: 0 }
        ];
        this._createLineMesh(borderPts, overlayBorderColor, this.overlayGroup);

        const innerBorderPts = borderPts.map(p => ({
            x: p.x + (p.x === minX ? 0.2 : -0.2),
            y: p.y + (p.y === overlayMinY ? 0.2 : -0.2),
            z: 0
        }));
        this._createLineMesh(innerBorderPts, overlayBorderColor, this.overlayGroup);

        // 2. Legend (Top Left)
        this.drawLegend(minX + 2, overlayMaxY - 4);

        // 3. Title Block (Bottom Bar - Full Width)
        // Reference: Continuous bar at bottom with sections
        const bottomBarHeight = 5.0;
        const barY = overlayMinY; // Bottom of layout
        const barTopY = barY + bottomBarHeight;

        // Horizontal separation line
        this._createLineMesh(
            [{ x: minX, y: barTopY, z: 0 }, { x: maxX, y: barTopY, z: 0 }],
            overlayBorderColor, this.overlayGroup
        );

        // Section 1: Top Left of Bar (Plan Name)
        const title = this.createTextSprite(primaryTitle, { fontSize: 18, fontColor: '#000000', backgroundColor: 'transparent' });
        title.position = new BABYLON.Vector3(minX + 10, barY + 2.5, 0.1);
        title.scaling = new BABYLON.Vector3(2, 2, 1);
        title.parent = this.overlayGroup;

        // Sheet number box approximation on far left of footer
        if (sheetLabel) {
            const sheet = this.createTextSprite(String(sheetLabel), { fontSize: 16, fontColor: '#000000', backgroundColor: 'transparent' });
            sheet.position = new BABYLON.Vector3(minX + 3, barY + 2.5, 0.1);
            sheet.parent = this.overlayGroup;
        }

        // Section 2: Center (Surface Area Info)
        const surf = this.createTextSprite(footerLabel, { fontSize: 16, fontColor: '#000000', backgroundColor: 'transparent' });
        surf.position = new BABYLON.Vector3((minX + maxX) / 2, barY + 2.5, 0.1);
        surf.scaling = new BABYLON.Vector3(1.8, 1.8, 1);
        surf.parent = this.overlayGroup;

        // Section 3: Right (Company Info)
        // Vertical separator line
        const rightSectionW = 20.0;
        this._createLineMesh(
            [{ x: maxX - rightSectionW, y: barY, z: 0 }, { x: maxX - rightSectionW, y: barTopY, z: 0 }],
            overlayBorderColor, this.overlayGroup
        );

        const company = this.createTextSprite(`-${companyName}-`, { fontSize: 14, fontColor: '#000000', backgroundColor: 'transparent' });
        company.position = new BABYLON.Vector3(maxX - rightSectionW / 2, barY + 3.0, 0.1);
        company.parent = this.overlayGroup;

        const addr = this.createTextSprite(companyAddress, { fontSize: 9, fontColor: '#000000', backgroundColor: 'transparent' });
        addr.position = new BABYLON.Vector3(maxX - rightSectionW / 2, barY + 1.2, 0.1);
        addr.parent = this.overlayGroup;

        // Section 4: Secondary plan title (PLAN ETAGE 02 1-200)
        const title2 = this.createTextSprite(secondaryTitle, { fontSize: 16, fontColor: '#000000', backgroundColor: 'transparent' });
        title2.position = new BABYLON.Vector3(maxX - rightSectionW - 10, barY + 2.5, 0.1);
        title2.parent = this.overlayGroup;
    }

    drawLegend(x, y) {
        const spacing = 1.5;
        const items = [
            { text: 'Tole Blanche', color: 0x6B7280, style: 'line' },
            { text: 'Tole Grise', color: 0x374151, style: 'line' }, // 0x2563eb
            { text: 'Ligne circulation', color: 0xd21414, style: 'arrow' },
            { text: 'Radiateur', color: 0xd90014, style: 'scallop' }
        ];

        items.forEach((item, i) => {
            const ly = y - i * spacing;

            // Draw Symbol
            if (item.style === 'line') {
                this._createLineMesh([{ x: x, y: ly, z: 0.1 }, { x: x + 3, y: ly, z: 0.1 }], item.color, this.overlayGroup);
            } else if (item.style === 'arrow') {
                this._createLineMesh([{ x: x, y: ly, z: 0.1 }, { x: x + 3, y: ly, z: 0.1 }], item.color, this.overlayGroup);
                this._createLineMesh([{ x: x + 2.5, y: ly, z: 0.1 }, { x: x + 1.9, y: ly + 0.3, z: 0.1 }], item.color, this.overlayGroup);
                this._createLineMesh([{ x: x + 2.5, y: ly, z: 0.1 }, { x: x + 1.9, y: ly - 0.3, z: 0.1 }], item.color, this.overlayGroup);
            } else if (item.style === 'scallop') {
                // Draw a small scallop segment
                this._drawZigzagRadiator([{ x: x, y: ly }, { x: x + 3, y: ly }], this.overlayGroup);
            }

            // Draw Text
            const label = this.createTextSprite(item.text, { fontSize: 8, fontColor: '#000000', backgroundColor: 'rgba(255,255,255,0)', padding: 0 });
            label.position = new BABYLON.Vector3(x + 4, ly, 0.1);
            label.scaling = new BABYLON.Vector3(0.8, 0.8, 1); // Compensate for sprite scaling
            // Align left approximation
            label.position.x += 1.5;
            label.parent = this.overlayGroup;
        });

        // Compass / North Arrow (Simplified)
        this._createLineMesh([{ x: x - 2, y: y + 2, z: 0.1 }, { x: x - 2, y: y - 2, z: 0.1 }], 0x000000, this.overlayGroup);
        this._createLineMesh([{ x: x - 4, y: y, z: 0.1 }, { x: x, y: y, z: 0.1 }], 0x000000, this.overlayGroup);
        const n = this.createTextSprite("N", { fontSize: 10, fontColor: '#000000', backgroundColor: 'transparent' });
        n.position = new BABYLON.Vector3(x - 2, y + 2.5, 0.1);
        n.parent = this.overlayGroup;
    }

    drawTitleBlock(minX, maxX, minY, maxY) {
        // "PLAN ETAGE 02 1-200" (Top Right)
        const title = this.createTextSprite("PLAN ETAGE 02 1-200", { fontSize: 18, fontColor: '#000000', backgroundColor: 'transparent' });
        title.position = new BABYLON.Vector3(maxX - 8, maxY - 3, 0.1);
        title.scaling = new BABYLON.Vector3(2, 2, 1);
        title.parent = this.overlayGroup;

        // Bottom Box
        const bottomH = 4.0;
        const boxY = minY + bottomH / 2;

        // "SURFACES DES BOX" (Bottom Center)
        const surf = this.createTextSprite("SURFACES DES BOX", { fontSize: 14, fontColor: '#000000', backgroundColor: 'transparent' });
        surf.position = new BABYLON.Vector3((minX + maxX) / 2, minY - 1.5, 0.1); // Below border
        surf.scaling = new BABYLON.Vector3(1.5, 1.5, 1);
        surf.parent = this.overlayGroup;

        // "-COSTO- 5 chemin de la dime 95700 Roissy FRANCE" (Bottom Right Box)
        const companyBoxW = 15;
        const cbX = maxX - companyBoxW / 2;
        const cbY = minY + bottomH / 2;

        // Box line
        this._createLineMesh([
            { x: maxX - companyBoxW, y: minY, z: 0 }, { x: maxX - companyBoxW, y: minY + bottomH, z: 0 },
            { x: maxX, y: minY + bottomH, z: 0 }
        ], 0x2b2b2b, this.overlayGroup);

        const company = this.createTextSprite("-COSTO-", { fontSize: 12, fontColor: '#000000', backgroundColor: 'transparent' });
        company.position = new BABYLON.Vector3(cbX, cbY + 0.5, 0.1);
        company.parent = this.overlayGroup;

        const addr = this.createTextSprite("5 chemin de la dime 95700\nRoissy FRANCE", { fontSize: 8, fontColor: '#000000', backgroundColor: 'transparent' });
        addr.position = new BABYLON.Vector3(cbX, cbY - 1.0, 0.1);
        addr.parent = this.overlayGroup;
    }

    renderCrossFloorRoutes(routes = [], options = {}) {
        this._disposeChildren(this.crossFloorPathsGroup);
        this.currentCrossFloorRoutes = routes;
        this.crossFloorOptions = options;
        routes.forEach(route => {
            if (route.path && route.path.length >= 2) {
                this._createLineMesh(route.path.map(p => ({ x: p.x, y: p.y, z: p.z || 0 })), route.color || 0x10b981, this.crossFloorPathsGroup);
            }
        });
        this.render();
    }

    clearCrossFloorRoutes() { this._disposeChildren(this.crossFloorPathsGroup); this.currentCrossFloorRoutes = []; this.render(); }

    addDoor(doorData) {
        if (!doorData || !Number.isFinite(doorData.x) || !Number.isFinite(doorData.y)) return;
        const w = doorData.width || 1.2, h = doorData.height || 0.15;
        this._createFilledRect(doorData.x - w / 2, doorData.y - h / 2, w, h, 0xf97316, 0.8, 0.06, this.doorsGroup);
        this.render();
    }

    getRendererInfo() {
        return {
            type: 'babylon.js',
            version: BABYLON.Engine.Version,
            meshCount: this.scene.meshes.length,
            activeCamera: this.scene.activeCamera?.name,
            orientation: this.getPlanOrientation()
        };
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this.stopArrowAnimation();
        if (this._canvas) {
            if (this._boundCanvasClick) this._canvas.removeEventListener('click', this._boundCanvasClick);
            if (this._boundCanvasMove) this._canvas.removeEventListener('pointermove', this._boundCanvasMove);
        }
        if (this._boundResizeHandler) {
            window.removeEventListener('resize', this._boundResizeHandler);
        }
        if (this.engine && typeof this.engine.stopRenderLoop === 'function') {
            this.engine.stopRenderLoop();
        }
        if (this.scene && typeof this.scene.dispose === 'function') {
            this.scene.dispose();
        }
        if (this.engine && typeof this.engine.dispose === 'function') {
            this.engine.dispose();
        }
        this.scene = null;
        this.engine = null;
        if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
        this._canvas = null;
    }
}

// ═══════════════════════════════════════════════════════════════
// Compatibility alias: app.js imports { ThreeRenderer }
// ═══════════════════════════════════════════════════════════════
export { FloorPlanRenderer as ThreeRenderer };


