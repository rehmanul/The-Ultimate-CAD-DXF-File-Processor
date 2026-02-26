// Production-Grade Three.js Floor Plan Renderer with Full Feature Set
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

export class FloorPlanRenderer {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);
        this.is3DMode = false;
        this.selectedIlots = [];
        this.ilotMeshes = [];
        this.measurementMode = false;
        this.measurementPoints = [];
        this.measurementType = 'distance'; // 'distance', 'area', 'angle'
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        const aspect = container.clientWidth / container.clientHeight;
        const frustumSize = 100;
        this.camera = new THREE.OrthographicCamera(
            frustumSize * aspect / -2, frustumSize * aspect / 2,
            frustumSize / 2, frustumSize / -2, 0.1, 1000
        );
        this.camera.position.set(0, 0, 100);
        this.camera.lookAt(0, 0, 0);

        this.perspectiveCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
        this.perspectiveCamera.position.set(0, 0, 200); // Top-down view
        this.perspectiveCamera.lookAt(0, 0, 0);

        this.rendererType = 'webgl';
        this.webglAvailable = true;

        // Check WebGL support first
        const canvas = document.createElement('canvas');
        let gl = null;
        try {
            gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        } catch (e) {
            console.warn('WebGL context check failed:', e);
        }

        if (!gl) {
            this.webglAvailable = false;
        }

        if (this.webglAvailable) {
            // Create WebGL renderer with error handling
            try {
                this.renderer = new THREE.WebGLRenderer({
                    antialias: true,
                    preserveDrawingBuffer: true,
                    alpha: false,
                    powerPreference: 'high-performance',
                    failIfMajorPerformanceCaveat: false // Allow software rendering if needed
                });

                // Check if renderer actually has a valid context
                if (!this.renderer.getContext()) {
                    throw new Error('WebGL context creation failed');
                }

                this.rendererType = 'webgl';

                // Listen for context loss events
                this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
                    console.warn('WebGL context lost');
                    event.preventDefault();
                });

                this.renderer.domElement.addEventListener('webglcontextrestored', () => {
                    console.log('WebGL context restored');
                    this.render();
                });
            } catch (webglError) {
                console.error('WebGL renderer creation failed:', webglError);
                this.webglAvailable = false;
            }
        }

        if (!this.webglAvailable) {
            console.warn('WebGL unavailable. Falling back to SVG renderer (2D only).');
            this.renderer = new SVGRenderer();
            this.rendererType = 'svg';
        }

        this.renderer.setSize(container.clientWidth, container.clientHeight);
        if (this.renderer.setPixelRatio) {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit for performance
        }
        if (this.renderer.shadowMap) {
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }
        if (this.renderer.toneMapping !== undefined) {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.2;
        }
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableRotate = false;
        this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        this.controls.addEventListener('change', () => this.render());

        this.perspectiveControls = new OrbitControls(this.perspectiveCamera, this.renderer.domElement);
        this.perspectiveControls.enableDamping = false;
        this.perspectiveControls.addEventListener('change', () => this.render());

        if (this.rendererType === 'webgl') {
            this.composer = new EffectComposer(this.renderer);
            this.renderPass = new RenderPass(this.scene, this.camera);
            this.composer.addPass(this.renderPass);

            this.outlinePass = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), this.scene, this.camera);
            this.outlinePass.edgeStrength = 3;
            this.outlinePass.edgeGlow = 0.5;
            this.outlinePass.edgeThickness = 2;
            this.outlinePass.visibleEdgeColor.set('#00ff00');
            this.composer.addPass(this.outlinePass);

            // Bloom pass for glow effects (disabled by default)
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(container.clientWidth, container.clientHeight),
                0.5,  // strength
                0.4,  // radius
                0.85  // threshold
            );
            this.bloomPass.enabled = false;
            this.composer.addPass(this.bloomPass);
        } else {
            this.renderPass = { camera: this.camera };
            this.outlinePass = {
                selectedObjects: [],
                renderCamera: this.camera,
                visibleEdgeColor: { set: () => { } }
            };
            this.bloomPass = null;
            this.composer = {
                render: () => this.renderer.render(this.scene, this.camera),
                setSize: () => { }
            };
        }

        // Shadow settings
        this.shadowsEnabled = true;

        this.wallsGroup = new THREE.Group();
        this.entrancesGroup = new THREE.Group();
        this.forbiddenGroup = new THREE.Group();
        this.ilotsGroup = new THREE.Group();
        this.corridorsGroup = new THREE.Group();
        this.perimeterGroup = new THREE.Group(); // COSTO perimeter circulation
        this.corridorArrowsGroup = new THREE.Group();
        this.measurementsGroup = new THREE.Group();
        this.labelsGroup = new THREE.Group();
        this.connectorsGroup = new THREE.Group();
        this.connectorHighlights = new THREE.Group();
        this.stackGroup = new THREE.Group();
        this.crossFloorPathsGroup = new THREE.Group();
        this.doorsGroup = new THREE.Group();
        this.stackGroup.visible = false;
        this.currentConnectors = [];
        this.currentConnectorOptions = {};
        this.currentStackFloors = null;
        this.currentStackOptions = {};
        this.currentCrossFloorRoutes = [];
        this.crossFloorOptions = {};
        this.corridorArrowsGroup.visible = true;
        this.corridorArrowsVisible = true;
        this.arrowMeshes = [];
        this.arrowMaterials = {
            green: new THREE.MeshBasicMaterial({ color: 0x2e7d32 }),
            bright_green: new THREE.MeshBasicMaterial({ color: 0x22c55e }),
            blue: new THREE.MeshBasicMaterial({ color: 0x2e7d32 }),
            teal: new THREE.MeshBasicMaterial({ color: 0x2e7d32 })
        };
        this.arrowClock = new THREE.Clock(false);
        this.arrowAnimationActive = false;
        this.arrowAnimationFrame = null;
        this.arrowPulseTime = 0;
        this.currentFloorPlan = null;
        this.currentCostoLayout = null;
        this.currentCirculationPaths = [];

        this.scene.add(
            this.wallsGroup,
            this.entrancesGroup,
            this.forbiddenGroup,
            this.ilotsGroup,
            this.corridorsGroup,
            this.perimeterGroup, // COSTO perimeter circulation
            this.corridorArrowsGroup,
            this.measurementsGroup,
            this.labelsGroup,
            this.connectorsGroup,
            this.connectorHighlights,
            this.stackGroup,
            this.crossFloorPathsGroup,
            this.doorsGroup
        );

        // Advanced lighting setup
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 0.5);
        hemiLight.position.set(0, 0, 50);

        // Key light (main directional)
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
        keyLight.position.set(50, -50, 100);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 500;
        keyLight.shadow.camera.left = -100;
        keyLight.shadow.camera.right = 100;
        keyLight.shadow.camera.top = 100;
        keyLight.shadow.camera.bottom = -100;
        keyLight.shadow.bias = -0.0001;

        // Fill light (softer, from opposite side)
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
        fillLight.position.set(-30, 30, 80);

        // Rim light (for depth)
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
        rimLight.position.set(0, 100, -50);

        // Fog for depth perception in 3D
        this.scene.fog = new THREE.Fog(0xffffff, 50, 300);

        this.scene.add(ambientLight, hemiLight, keyLight, fillLight, rimLight);

        // Add ground plane with grid
        this.createGroundPlane();

        this.renderer.domElement.addEventListener('click', (e) => this.onMouseClick(e));
        this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('resize', () => this.onResize());

        // Ensure initial render
        this.render();

        // Also render after a short delay to ensure everything is set up
        setTimeout(() => {
            this.render();
        }, 100);

        // COSTO rendering materials (shared across draw calls)
        this._costoMats = {
            partitionBlue: new THREE.LineBasicMaterial({ color: 0x0066ff }),
            outlineDark: new THREE.LineBasicMaterial({ color: 0x111827 }),
            doorRed: new THREE.LineBasicMaterial({ color: 0xff0000 }),
            doorBlue: new THREE.LineBasicMaterial({ color: 0x3b82f6 }),
            arrowGreen: new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide })
        };
    }

    createGroundPlane() {
        // Infinite grid helper for architectural feel
        const gridHelper = new THREE.GridHelper(200, 40, 0xcccccc, 0xeeeeee);
        gridHelper.position.z = -0.1; // Slightly below floor
        gridHelper.visible = false; // Only show in 3D mode
        this.gridHelper = gridHelper;
        this.scene.add(gridHelper);

        // Ground plane to receive shadows
        const groundGeo = new THREE.PlaneGeometry(300, 300);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.15 });
        this.groundPlane = new THREE.Mesh(groundGeo, groundMat);
        this.groundPlane.receiveShadow = true;
        this.groundPlane.position.z = -0.2;
        this.groundPlane.visible = false; // Only show in 3D mode
        this.scene.add(this.groundPlane);

        // Add a default visible grid/background for 2D mode - but hide it initially
        // It will be shown only when there's content or user explicitly enables grid
        const defaultGrid = new THREE.GridHelper(100, 20, 0xe0e0e0, 0xf0f0f0);
        defaultGrid.position.z = -0.05;
        defaultGrid.visible = false; // Hidden by default - only show when needed
        this.defaultGrid = defaultGrid;
        this.scene.add(defaultGrid);
    }

    /**
     * Create a text sprite for labels using canvas rendering (HiDPI)
     */
    createTextSprite(text, options = {}) {
        const fontSize = options.fontSize || options.fontsize || 12;
        const fontColor = options.fontColor || options.fillStyle || '#000000';
        const backgroundColor = options.backgroundColor ?? 'rgba(255,255,255,0.8)';
        const padding = options.padding || 4;
        const fontWeight = options.fontWeight || 'bold';
        const fontStyle = options.fontStyle || 'normal';
        const fontFamily = options.fontFamily || 'Arial';
        const scale = 4; // HiDPI resolution multiplier for crisp text

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const font = `${fontStyle} ${fontWeight} ${fontSize * scale}px ${fontFamily}`;
        context.font = font;

        const textWidth = context.measureText(text).width;
        canvas.width = Math.ceil(textWidth + padding * 2 * scale);
        canvas.height = Math.ceil((fontSize + padding * 2) * scale);

        // Background
        if (backgroundColor !== 'transparent' && backgroundColor !== 'none') {
            context.fillStyle = backgroundColor;
            context.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Text (re-set font after canvas resize)
        context.font = font;
        context.fillStyle = fontColor;
        context.textBaseline = 'top';
        context.textAlign = 'left';
        context.fillText(text, padding * scale, padding * scale);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });

        const sprite = new THREE.Sprite(material);
        // Scale sprite to world units (divide by scale to negate HiDPI upscaling)
        sprite.scale.set(canvas.width / (20 * scale), canvas.height / (20 * scale), 1);

        return sprite;
    }

    _isSharedMaterial(material) {
        if (!material) return false;
        const costoShared = Object.values(this._costoMats || {});
        if (costoShared.includes(material)) return true;
        const arrowShared = Object.values(this.arrowMaterials || {});
        return arrowShared.includes(material);
    }

    _disposeMaterial(material) {
        if (!material) return;
        if (Array.isArray(material)) {
            material.forEach((m) => this._disposeMaterial(m));
            return;
        }
        if (this._isSharedMaterial(material)) return;
        if (typeof material.dispose === 'function') {
            material.dispose();
        }
    }

    // â”€â”€ COSTO CAD-style helpers (drop-in from spec) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    _getDoorColorForUnit(unit) {
        const row = (unit.row || '').toLowerCase();
        return (row === 'left') ? 'red' : 'blue';
    }

    _getDoorLabelForUnit(unit) {
        const w = Number(unit.doorWidth ?? 0.8);
        return (w >= 0.90) ? '100x205' : '75x205';
    }

    _getDoorEdge(unit) {
        const x = unit.x, y = unit.y, w = unit.width, h = unit.height;
        const side = (unit.doorSide || 'bottom').toLowerCase();
        switch (side) {
            case 'top': return { ax: x, ay: y + h, bx: x + w, by: y + h };
            case 'bottom': return { ax: x, ay: y, bx: x + w, by: y };
            case 'left': return { ax: x, ay: y, bx: x, by: y + h };
            case 'right': return { ax: x + w, ay: y, bx: x + w, by: y + h };
            default: return { ax: x, ay: y, bx: x + w, by: y };
        }
    }

    _drawDoorBlocksForUnit(unit, z = 0.14) {
        if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y) ||
            !Number.isFinite(unit.width) || !Number.isFinite(unit.height)) return;

        const edge = this._getDoorEdge(unit);
        const dx = edge.bx - edge.ax;
        const dy = edge.by - edge.ay;
        const len = Math.hypot(dx, dy);
        if (len < 0.4) return;

        const ux = dx / len, uy = dy / len;
        let nx = -uy, ny = ux;

        // Ensure door opens OUTWARD (from box center toward corridor)
        const bcx = unit.x + unit.width / 2, bcy = unit.y + unit.height / 2;
        const emx = (edge.ax + edge.bx) / 2, emy = (edge.ay + edge.by) / 2;
        if (nx * (emx - bcx) + ny * (emy - bcy) < 0) { nx = -nx; ny = -ny; }

        const colorKey = this._getDoorColorForUnit(unit);
        const mat = (colorKey === 'red') ? this._costoMats.doorRed : this._costoMats.doorBlue;
        const label = this._getDoorLabelForUnit(unit);

        const spacing = 3.0;
        const leafLen = 1.1;
        const offset = 0.10;
        const angle = Math.PI / 6;

        const count = Math.max(1, Math.floor(len / spacing));
        for (let i = 0; i < count; i++) {
            const t = (i + 0.5) / count;
            const hx = edge.ax + dx * t;
            const hy = edge.ay + dy * t;

            const px = hx + nx * offset;
            const py = hy + ny * offset;

            const sign = 1;
            const lx = (ux * Math.cos(angle) - uy * Math.sin(angle)) * sign;
            const ly = (ux * Math.sin(angle) + uy * Math.cos(angle)) * sign;

            const tipX = px + lx * leafLen;
            const tipY = py + ly * leafLen;

            // Leaf line
            this.radiatorsGroup.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(px, py, z),
                    new THREE.Vector3(tipX, tipY, z)
                ]),
                mat
            ));

            // Hinge cap (small L)
            const cap = 0.18;
            this.radiatorsGroup.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(px - ux * cap, py - uy * cap, z),
                    new THREE.Vector3(px + ux * cap, py + uy * cap, z)
                ]),
                mat
            ));

            // Text label near the leaf
            const txt = this.createTextSprite(label, {
                fontsize: 14,
                fillStyle: (colorKey === 'red') ? '#ff0000' : '#3b82f6',
                backgroundColor: 'transparent',
                fontWeight: 'bold'
            });
            txt.position.set(px + nx * 0.55, py + ny * 0.55, z + 0.02);
            txt.scale.set(0.6, 0.3, 1);
            this.radiatorsGroup.add(txt);
        }
    }

    _drawUnitPartitions(unit, z = 0.06) {
        const x = unit.x, y = unit.y, w = unit.width, h = unit.height;
        const blue = this._costoMats.partitionBlue;
        const dark = this._costoMats.outlineDark;

        const doorSide = (unit.doorSide || 'bottom').toLowerCase();
        const edgeMat = (side) => (side === doorSide ? blue : dark);

        const edges = [
            { side: 'bottom', a: [x, y], b: [x + w, y] },
            { side: 'right', a: [x + w, y], b: [x + w, y + h] },
            { side: 'top', a: [x + w, y + h], b: [x, y + h] },
            { side: 'left', a: [x, y + h], b: [x, y] }
        ];

        for (const e of edges) {
            const mat = edgeMat(e.side);
            this.ilotsGroup.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(e.a[0], e.a[1], z),
                    new THREE.Vector3(e.b[0], e.b[1], z)
                ]),
                mat
            ));
        }
    }

    _drawCadArrowHead(group, tip, toward, z, size = 0.08) {
        if (!group || !tip || !toward) return;
        const dx = toward.x - tip.x;
        const dy = toward.y - tip.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.0001) return;

        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;
        const wing = size * 0.55;

        const baseX = tip.x + ux * size;
        const baseY = tip.y + uy * size;
        const left = new THREE.Vector3(baseX + px * wing, baseY + py * wing, z);
        const right = new THREE.Vector3(baseX - px * wing, baseY - py * wing, z);
        const tipV = new THREE.Vector3(tip.x, tip.y, z);

        const geom = new THREE.BufferGeometry().setFromPoints([tipV, left, tipV, right]);
        group.add(new THREE.LineSegments(geom, this._costoMats.outlineDark));
    }

    _drawCadDimensionLine(group, start, end, label, options = {}) {
        if (!group || !start || !end) return;
        const z = Number.isFinite(options.z) ? options.z : 0.10;
        const textOffset = Number.isFinite(options.textOffset) ? options.textOffset : 0.06;
        const textSize = Number.isFinite(options.textSize) ? options.textSize : 7;
        const arrowSize = Number.isFinite(options.arrowSize) ? options.arrowSize : 0.08;
        const dimMat = options.material || this._costoMats.outlineDark;

        const sx = Number(start.x);
        const sy = Number(start.y);
        const ex = Number(end.x);
        const ey = Number(end.y);
        if (![sx, sy, ex, ey].every(Number.isFinite)) return;

        const lineGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(sx, sy, z),
            new THREE.Vector3(ex, ey, z)
        ]);
        group.add(new THREE.Line(lineGeom, dimMat));

        this._drawCadArrowHead(group, { x: sx, y: sy }, { x: ex, y: ey }, z, arrowSize);
        this._drawCadArrowHead(group, { x: ex, y: ey }, { x: sx, y: sy }, z, arrowSize);

        if (!label) return;

        const mx = (sx + ex) * 0.5;
        const my = (sy + ey) * 0.5;
        const dx = ex - sx;
        const dy = ey - sy;
        const len = Math.hypot(dx, dy);
        if (len < 0.0001) return;

        const nx = -dy / len;
        const ny = dx / len;

        const sprite = this.createTextSprite(String(label), {
            fontSize: textSize,
            fontColor: '#111827',
            fontWeight: 'bold',
            backgroundColor: 'transparent',
            padding: 1
        });
        sprite.position.set(mx + nx * textOffset, my + ny * textOffset, z + 0.01);
        sprite.material.rotation = Math.atan2(dy, dx);
        sprite.scale.multiplyScalar(0.70);
        group.add(sprite);
    }

    _drawProfessionalUnitAnnotations(unit, z = 0.10) {
        if (!unit || ![unit.x, unit.y, unit.width, unit.height].every(Number.isFinite)) return;

        const x = unit.x;
        const y = unit.y;
        const w = Math.max(0.05, unit.width);
        const h = Math.max(0.05, unit.height);
        const shortSide = Math.min(w, h);
        const longSide = Math.max(w, h);

        // Keep all boxes annotated while clamping for tiny units.
        const inset = Math.min(Math.max(0.035, shortSide * 0.09), Math.max(0.035, shortSide * 0.18));
        const arrowSize = Math.min(Math.max(0.022, shortSide * 0.045), 0.060);
        const textOffset = Math.min(Math.max(0.014, shortSide * 0.028), 0.050);
        const dimTextSize = shortSide < 1.2 ? 4 : 5;
        const areaTextSize = shortSide < 1.2 ? 4 : 5;

        const primaryIsVertical = h >= w;

        let p1, p2, s1, s2;
        if (primaryIsVertical) {
            p1 = { x: x + w * 0.50, y: y + inset };
            p2 = { x: x + w * 0.50, y: y + h - inset };
            s1 = { x: x + inset, y: y + h * 0.18 };
            s2 = { x: x + w - inset, y: y + h * 0.18 };
        } else {
            p1 = { x: x + inset, y: y + h * 0.50 };
            p2 = { x: x + w - inset, y: y + h * 0.50 };
            s1 = { x: x + w * 0.18, y: y + inset };
            s2 = { x: x + w * 0.18, y: y + h - inset };
        }

        this._drawCadDimensionLine(
            this.ilotsGroup,
            p1,
            p2,
            shortSide.toFixed(2),
            { z, textOffset, textSize: dimTextSize, arrowSize }
        );
        if (shortSide >= 0.95) {
            this._drawCadDimensionLine(
                this.ilotsGroup,
                s1,
                s2,
                longSide.toFixed(2),
                { z, textOffset: textOffset * 0.95, textSize: dimTextSize, arrowSize: arrowSize * 0.9 }
            );
        }

        const area = Number.isFinite(unit.area) ? unit.area : (w * h);
        const areaSprite = this.createTextSprite(`${area.toFixed(2)}m²`, {
            fontSize: areaTextSize,
            fontColor: '#6b7280',
            fontWeight: 'normal',
            fontStyle: 'italic',
            backgroundColor: 'transparent',
            padding: 1
        });
        areaSprite.position.set(x + w * 0.58, y + h * 0.48, z + 0.01);
        areaSprite.material.rotation = primaryIsVertical ? Math.PI / 2 : 0;
        areaSprite.scale.multiplyScalar(0.66);
        this.ilotsGroup.add(areaSprite);
    }

    _renderGreenTrianglesFromPaths(circulationPaths, z = 0.20) {
        if (!Array.isArray(circulationPaths) || circulationPaths.length === 0) return;

        const mat = this._costoMats.arrowGreen;
        const spacing = 6.0;
        const size = 0.9;

        const makeTri = (x, y, angle) => {
            const geom = new THREE.BufferGeometry();
            const verts = new Float32Array([
                -size * 0.6, -size * 0.35, 0,
                -size * 0.6, size * 0.35, 0,
                size * 0.6, 0, 0
            ]);
            geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(x, y, z);
            mesh.rotation.z = angle;
            return mesh;
        };

        const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

        for (const cp of circulationPaths) {
            const path = cp.path;
            if (!Array.isArray(path) || path.length < 2) continue;

            let carry = 0;
            for (let i = 0; i < path.length - 1; i++) {
                const a = path[i], b = path[i + 1];
                if (!a || !b) continue;
                const segLen = dist(a, b);
                if (segLen < 0.01) continue;

                const ang = Math.atan2(b.y - a.y, b.x - a.x);

                let t = (spacing - carry) / segLen;
                while (t <= 1.0) {
                    const x = a.x + (b.x - a.x) * t;
                    const y = a.y + (b.y - a.y) * t;
                    this.corridorsGroup.add(makeTri(x, y, ang));
                    t += spacing / segLen;
                }

                carry = (segLen - ((spacing - carry) % segLen)) % spacing;
            }
        }
    }

    // â”€â”€ Global flow (Entry â†’ Visit all â†’ Exit) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    _getEntrancePoints(floorPlan) {
        const bounds = floorPlan?.bounds;
        const ents = Array.isArray(floorPlan?.entrances) ? floorPlan.entrances : [];
        const pts = [];

        for (const e of ents) {
            if (e?.start && e?.end) {
                pts.push({ x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 });
            } else if (Number.isFinite(e?.x) && Number.isFinite(e?.y)) {
                pts.push({ x: e.x, y: e.y });
            } else if (Array.isArray(e?.polygon) && e.polygon.length) {
                const cx = e.polygon.reduce((s, p) => s + (p.x ?? p[0] ?? 0), 0) / e.polygon.length;
                const cy = e.polygon.reduce((s, p) => s + (p.y ?? p[1] ?? 0), 0) / e.polygon.length;
                pts.push({ x: cx, y: cy });
            }
        }

        if (pts.length === 0 && bounds) {
            pts.push({ x: bounds.minX + (bounds.maxX - bounds.minX) * 0.1, y: bounds.minY });
            pts.push({ x: bounds.maxX - (bounds.maxX - bounds.minX) * 0.1, y: bounds.maxY });
        }

        let entry = pts[0];
        for (const p of pts) if (p.y < entry.y) entry = p;

        let exit = pts[0];
        let best = -1;
        for (const p of pts) {
            const d = Math.hypot(p.x - entry.x, p.y - entry.y);
            if (d > best) { best = d; exit = p; }
        }

        return { entry, exit };
    }

    _corridorCenterlineEndpoints(c) {
        if (![c?.x, c?.y, c?.width, c?.height].every(Number.isFinite)) return null;
        const cx = c.x + c.width / 2;
        const cy = c.y + c.height / 2;
        const isH = c.direction === 'horizontal' || c.width > c.height;
        if (isH) {
            return { a: { x: c.x, y: cy }, b: { x: c.x + c.width, y: cy }, len: c.width };
        }
        return { a: { x: cx, y: c.y }, b: { x: cx, y: c.y + c.height }, len: c.height };
    }

    _buildCorridorGraph(corridors, snap = 0.6, preferAccess = true) {
        const eps = 1e-6;
        const key = (p) => `${Math.round(p.x / snap)}|${Math.round(p.y / snap)}`;
        const nodes = new Map();
        const adj = new Map();
        const edges = [];
        const edgeByKey = new Map();

        const getNodeId = (p) => {
            const k = key(p);
            let n = nodes.get(k);
            if (!n) {
                n = { id: nodes.size, x: p.x, y: p.y };
                nodes.set(k, n);
            }
            return n.id;
        };

        const addAdj = (u, v, w, edgeId) => {
            if (!adj.has(u)) adj.set(u, []);
            adj.get(u).push({ to: v, w, edgeId });
        };

        const axisOf = (a, b) => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'H' : 'V');
        const between = (v, a, b, tol = eps) => v >= Math.min(a, b) - tol && v <= Math.max(a, b) + tol;
        const clamp01 = (t) => Math.max(0, Math.min(1, t));
        const lerpPoint = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

        const paramOnSeg = (a, b, p) => {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            if (Math.abs(dx) >= Math.abs(dy)) {
                if (Math.abs(dx) <= eps) return 0;
                return (p.x - a.x) / dx;
            }
            if (Math.abs(dy) <= eps) return 0;
            return (p.y - a.y) / dy;
        };

        const rawCorridors = Array.isArray(corridors) ? corridors : [];
        const preferred = preferAccess
            ? rawCorridors.filter((c) => String(c?.type || '').toUpperCase() === 'ACCESS')
            : rawCorridors;
        const candidateCorridors = preferred.length > 0 ? preferred : rawCorridors;

        const segments = [];
        for (const c of candidateCorridors) {
            const seg = this._corridorCenterlineEndpoints(c);
            if (!seg || seg.len < 0.4) continue;
            segments.push({
                a: { x: seg.a.x, y: seg.a.y },
                b: { x: seg.b.x, y: seg.b.y },
                len: seg.len,
                axis: axisOf(seg.a, seg.b),
                corridorType: String(c?.type || '').toUpperCase()
            });
        }

        if (!segments.length) {
            return { nodeList: [], adj, edges };
        }

        const splitTs = segments.map(() => [0, 1]);
        const addSplit = (idx, t) => {
            if (!Number.isFinite(t)) return;
            const tt = clamp01(t);
            splitTs[idx].push(tt);
        };

        // Split centerlines at every valid intersection so graph connectivity matches walkable network.
        for (let i = 0; i < segments.length; i++) {
            const si = segments[i];
            for (let j = i + 1; j < segments.length; j++) {
                const sj = segments[j];

                // Orthogonal crossing
                if (si.axis !== sj.axis) {
                    const h = si.axis === 'H' ? si : sj;
                    const v = si.axis === 'V' ? si : sj;
                    const hi = si.axis === 'H' ? i : j;
                    const vi = si.axis === 'V' ? i : j;
                    const x = v.a.x;
                    const y = h.a.y;
                    if (between(x, h.a.x, h.b.x) && between(y, v.a.y, v.b.y)) {
                        addSplit(hi, paramOnSeg(h.a, h.b, { x, y }));
                        addSplit(vi, paramOnSeg(v.a, v.b, { x, y }));
                    }
                    continue;
                }

                // Colinear overlap/touch to avoid disconnected same-line segments
                if (si.axis === 'H') {
                    if (Math.abs(si.a.y - sj.a.y) > snap * 0.5) continue;
                    const s = Math.max(Math.min(si.a.x, si.b.x), Math.min(sj.a.x, sj.b.x));
                    const e = Math.min(Math.max(si.a.x, si.b.x), Math.max(sj.a.x, sj.b.x));
                    if (e + eps < s) continue;
                    addSplit(i, paramOnSeg(si.a, si.b, { x: s, y: si.a.y }));
                    addSplit(i, paramOnSeg(si.a, si.b, { x: e, y: si.a.y }));
                    addSplit(j, paramOnSeg(sj.a, sj.b, { x: s, y: sj.a.y }));
                    addSplit(j, paramOnSeg(sj.a, sj.b, { x: e, y: sj.a.y }));
                } else {
                    if (Math.abs(si.a.x - sj.a.x) > snap * 0.5) continue;
                    const s = Math.max(Math.min(si.a.y, si.b.y), Math.min(sj.a.y, sj.b.y));
                    const e = Math.min(Math.max(si.a.y, si.b.y), Math.max(sj.a.y, sj.b.y));
                    if (e + eps < s) continue;
                    addSplit(i, paramOnSeg(si.a, si.b, { x: si.a.x, y: s }));
                    addSplit(i, paramOnSeg(si.a, si.b, { x: si.a.x, y: e }));
                    addSplit(j, paramOnSeg(sj.a, sj.b, { x: sj.a.x, y: s }));
                    addSplit(j, paramOnSeg(sj.a, sj.b, { x: sj.a.x, y: e }));
                }
            }
        }

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const ts = splitTs[i]
                .map((t) => clamp01(t))
                .sort((a, b) => a - b)
                .filter((t, idx, arr) => idx === 0 || Math.abs(t - arr[idx - 1]) > 1e-4);

            for (let k = 0; k < ts.length - 1; k++) {
                const t0 = ts[k];
                const t1 = ts[k + 1];
                if (t1 - t0 <= 1e-4) continue;
                const p0 = lerpPoint(seg.a, seg.b, t0);
                const p1 = lerpPoint(seg.a, seg.b, t1);
                const w = Math.hypot(p1.x - p0.x, p1.y - p0.y);
                if (!Number.isFinite(w) || w < 0.2) continue;

                const u = getNodeId(p0);
                const v = getNodeId(p1);
                if (u === v) continue;

                const kEdge = u < v ? `${u}|${v}` : `${v}|${u}`;
                let edgeId = edgeByKey.get(kEdge);
                if (edgeId === undefined) {
                    edgeId = edges.length;
                    edges.push({
                        id: edgeId,
                        u,
                        v,
                        a: p0,
                        b: p1,
                        w,
                        used: false,
                        corridorType: seg.corridorType
                    });
                    edgeByKey.set(kEdge, edgeId);
                }

                addAdj(u, v, w, edgeId);
                addAdj(v, u, w, edgeId);
            }
        }

        const nodeList = Array.from(nodes.values());
        return { nodeList, adj, edges };
    }

    _nearestNodeId(nodeList, p) {
        let bestId = 0;
        let best = Infinity;
        for (const n of nodeList) {
            const d = Math.hypot(n.x - p.x, n.y - p.y);
            if (d < best) { best = d; bestId = n.id; }
        }
        return bestId;
    }

    _shortestPathNodes(adj, start, goal) {
        const dist = new Map();
        const prev = new Map();
        const pq = [{ id: start, d: 0 }];
        dist.set(start, 0);

        while (pq.length) {
            pq.sort((a, b) => a.d - b.d);
            const cur = pq.shift();
            if (cur.id === goal) break;

            const neigh = adj.get(cur.id) || [];
            for (const e of neigh) {
                const nd = cur.d + e.w;
                if (!dist.has(e.to) || nd < dist.get(e.to)) {
                    dist.set(e.to, nd);
                    prev.set(e.to, cur.id);
                    pq.push({ id: e.to, d: nd });
                }
            }
        }

        if (!dist.has(goal)) return null;

        const path = [];
        let x = goal;
        while (x !== undefined) {
            path.push(x);
            if (x === start) break;
            x = prev.get(x);
        }
        path.reverse();
        return path;
    }

    _buildDirectedNetworkFromCorridors(corridors, floorPlan) {
        const list = Array.isArray(corridors) ? corridors : [];
        if (!list.length) return [];

        const { nodeList, adj, edges } = this._buildCorridorGraph(list, 0.45, false);
        if (!nodeList.length || !edges.length) return [];

        const { entry } = this._getEntrancePoints(floorPlan || {});
        const hasEntry = entry && Number.isFinite(entry.x) && Number.isFinite(entry.y);
        const source = hasEntry ? this._nearestNodeId(nodeList, entry) : nodeList[0].id;

        // Dijkstra from entry to orient each corridor edge away from entry.
        const dist = new Map();
        nodeList.forEach((n) => dist.set(n.id, Infinity));
        dist.set(source, 0);

        const pq = [{ id: source, d: 0 }];
        while (pq.length) {
            pq.sort((a, b) => a.d - b.d);
            const cur = pq.shift();
            if (!cur) break;
            if (cur.d > (dist.get(cur.id) || Infinity)) continue;
            const neigh = adj.get(cur.id) || [];
            for (const e of neigh) {
                const nd = cur.d + e.w;
                if (nd + 1e-9 < (dist.get(e.to) || Infinity)) {
                    dist.set(e.to, nd);
                    pq.push({ id: e.to, d: nd });
                }
            }
        }

        const flows = [];
        for (const e of edges) {
            const du = dist.get(e.u);
            const dv = dist.get(e.v);
            if (!Number.isFinite(du) && !Number.isFinite(dv)) continue;

            let from = e.a;
            let to = e.b;

            if (Number.isFinite(du) && Number.isFinite(dv)) {
                if (dv + 1e-6 < du) {
                    from = e.b;
                    to = e.a;
                } else if (Math.abs(du - dv) <= 1e-6) {
                    // Deterministic tiebreaker to avoid random flips.
                    if (e.b.x < e.a.x || (Math.abs(e.b.x - e.a.x) < 1e-6 && e.b.y < e.a.y)) {
                        from = e.b;
                        to = e.a;
                    }
                }
            } else if (!Number.isFinite(du) && Number.isFinite(dv)) {
                from = e.b;
                to = e.a;
            }

            const t = String(e.corridorType || '').toUpperCase();
            const onMain = t.includes('MAIN') || t.includes('SPINE') || t.includes('VERTICAL');

            flows.push({
                type: t || 'ACCESS',
                onMainRoute: onMain,
                flowValid: true,
                path: [{ x: from.x, y: from.y }, { x: to.x, y: to.y }],
                arrows: []
            });
        }

        return flows;
    }

    _buildVisitRoutePolyline(floorPlan, corridors) {
        const { entry, exit } = this._getEntrancePoints(floorPlan);
        const { nodeList, adj, edges } = this._buildCorridorGraph(corridors, 0.6);
        if (!nodeList.length || !edges.length) return { path: [], entry, exit };

        const entryNode = this._nearestNodeId(nodeList, entry);
        const exitNode = this._nearestNodeId(nodeList, exit);

        // Edge-cover walk (DFS, revisits allowed)
        const stack = [entryNode];
        const routeNodes = [entryNode];

        const getUnusedEdgeFrom = (u) => {
            const list = adj.get(u) || [];
            for (const e of list) {
                if (!edges[e.edgeId].used) return e;
            }
            return null;
        };

        while (true) {
            const u = stack[stack.length - 1];
            const next = getUnusedEdgeFrom(u);
            if (next) {
                edges[next.edgeId].used = true;
                stack.push(next.to);
                routeNodes.push(next.to);
            } else {
                stack.pop();
                if (!stack.length) break;
                routeNodes.push(stack[stack.length - 1]);
            }
        }

        // Connect end to exit via shortest path
        const last = routeNodes[routeNodes.length - 1];
        if (last !== exitNode) {
            const tail = this._shortestPathNodes(adj, last, exitNode);
            if (tail && tail.length > 1) {
                for (let i = 1; i < tail.length; i++) routeNodes.push(tail[i]);
            }
        }

        // Convert nodes â†’ polyline
        const idToNode = new Map(nodeList.map(n => [n.id, n]));
        const poly = routeNodes.map(id => {
            const n = idToNode.get(id);
            return { x: n.x, y: n.y };
        });

        // Remove immediate duplicates
        const cleaned = [];
        for (const p of poly) {
            const lastP = cleaned[cleaned.length - 1];
            if (!lastP || Math.hypot(p.x - lastP.x, p.y - lastP.y) > 0.05) cleaned.push(p);
        }

        return { path: cleaned, entry, exit };
    }

    _drawGreenSpine(path, z = 0.21) {
        if (!Array.isArray(path) || path.length < 2) return;
        const mat = new THREE.LineBasicMaterial({ color: 0x22c55e });
        const pts = path.map(p => new THREE.Vector3(p.x, p.y, z));
        this.corridorsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }

    // â”€â”€ Wave (scallop) point generator â€” sine-based curve along an edge â”€â”€
    _makeWavePoints(x1, y1, x2, y2, {
        offset = 0.10,
        amp = 0.08,
        wl = 0.55,
        z = 0.16,
        phase = 0
    } = {}) {
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < 0.2) return [];

        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux; // perpendicular

        const steps = Math.max(8, Math.floor(len / (wl / 2)));
        const pts = [];

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = x1 + dx * t;
            const py = y1 + dy * t;

            // scallop wave (sine)
            const s = Math.sin((t * len / wl) * Math.PI * 2 + phase);
            const ox = px + nx * offset + nx * (amp * s);
            const oy = py + ny * offset + ny * (amp * s);

            pts.push(new THREE.Vector3(ox, oy, z));
        }
        return pts;
    }

    // â”€â”€ Blue/cyan wave perimeters on every unit's door edge â”€â”€
    // Normal always points OUTWARD from the box center
    _renderUnitDoorWaves(units) {
        return; // DISABLED: no blue waves

        if (!this._waveGroupBlue) {
            this._waveGroupBlue = new THREE.Group();
            this._waveGroupBlue.name = 'unitDoorWaves';
            this.scene.add(this._waveGroupBlue);
        }
        this._waveGroupBlue.clear();

        const mat = new THREE.LineBasicMaterial({ color: 0x56a9ff });

        const edge = (u) => {
            const x = u.x, y = u.y, w = u.width, h = u.height;
            const s = (u.doorSide || 'bottom').toLowerCase();
            if (s === 'top') return { x1: x, y1: y + h, x2: x + w, y2: y + h };
            if (s === 'bottom') return { x1: x, y1: y, x2: x + w, y2: y };
            if (s === 'left') return { x1: x, y1: y, x2: x, y2: y + h };
            if (s === 'right') return { x1: x + w, y1: y, x2: x + w, y2: y + h };
            return { x1: x, y1: y, x2: x + w, y2: y };
        };

        for (const u of units) {
            if (![u?.x, u?.y, u?.width, u?.height].every(Number.isFinite)) continue;

            const e = edge(u);
            const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
            const len = Math.hypot(dx, dy);
            if (len < 0.5) continue;

            const ux = dx / len, uy = dy / len;
            let nx = -uy, ny = ux;

            // choose normal that points OUT of the unit (from unit center â†’ edge mid)
            const cx = u.x + u.width / 2, cy = u.y + u.height / 2;
            const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2;
            const vx = mx - cx, vy = my - cy;
            if (nx * vx + ny * vy < 0) { nx = -nx; ny = -ny; }

            // build wave explicitly with chosen normal direction
            const wl = 0.42, amp = 0.055, offset = 0.06;
            const steps = Math.max(8, Math.floor(len / (wl / 2)));
            const fixedPts = [];
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const px = e.x1 + dx * t, py = e.y1 + dy * t;
                const s = Math.sin((t * len / wl) * Math.PI * 2);
                fixedPts.push(new THREE.Vector3(
                    px + nx * offset + nx * (amp * s),
                    py + ny * offset + ny * (amp * s),
                    0.14
                ));
            }

            if (fixedPts.length >= 2) {
                this._waveGroupBlue.add(new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints(fixedPts), mat
                ));
            }
        }
    }

    // â”€â”€ Red radiator waves on envelope/perimeter (NOT corridors) â”€â”€
    _renderRadiatorWavesFromEnvelope(floorPlan) {
        return; // DISABLED: no red radiator waves
    }

    // â”€â”€ Corridor â†’ centerline segments â”€â”€
    _buildSegmentsFromCorridors(corridors) {
        const segs = [];
        for (const c of corridors) {
            if (![c?.x, c?.y, c?.width, c?.height].every(Number.isFinite)) continue;
            const isH = c.direction === 'horizontal' || c.width > c.height;
            const cx = c.x + c.width / 2;
            const cy = c.y + c.height / 2;
            if (isH) segs.push({ x1: c.x, y1: cy, x2: c.x + c.width, y2: cy });
            else segs.push({ x1: cx, y1: c.y, x2: cx, y2: c.y + c.height });
        }
        return segs;
    }

    // â”€â”€ Split segments at HÃ—V intersections â”€â”€
    _splitAtIntersections(segs, eps = 1e-6) {
        const horiz = [], vert = [];
        for (const s of segs) {
            if (Math.abs(s.y1 - s.y2) < eps) horiz.push(s);
            else vert.push(s);
        }

        const splits = new Map();
        const add = (s, p) => {
            if (!splits.has(s)) splits.set(s, []);
            splits.get(s).push(p);
        };

        for (const h of horiz) {
            const hx1 = Math.min(h.x1, h.x2), hx2 = Math.max(h.x1, h.x2), hy = h.y1;
            for (const v of vert) {
                const vy1 = Math.min(v.y1, v.y2), vy2 = Math.max(v.y1, v.y2), vx = v.x1;
                if (vx >= hx1 - eps && vx <= hx2 + eps && hy >= vy1 - eps && hy <= vy2 + eps) {
                    add(h, { x: vx, y: hy });
                    add(v, { x: vx, y: hy });
                }
            }
        }

        const out = [];
        const pushPieces = (s) => {
            const pts = [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
            (splits.get(s) || []).forEach(p => pts.push(p));

            if (Math.abs(s.y1 - s.y2) < eps) pts.sort((a, b) => a.x - b.x);
            else pts.sort((a, b) => a.y - b.y);

            const uniq = [];
            for (const p of pts) {
                const last = uniq[uniq.length - 1];
                if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.05) uniq.push(p);
            }

            for (let i = 0; i < uniq.length - 1; i++) {
                const a = uniq[i], b = uniq[i + 1];
                if (Math.hypot(a.x - b.x, a.y - b.y) > 0.2) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
            }
        };

        segs.forEach(pushPieces);
        return out;
    }

    /**
     * Professional flow arrows: derived from UNIT positions.
     * Finds real aisles (gaps between adjacent unit columns).
     * Arrows only appear where storage units define walkable aisles.
     */
    _renderGlobalFlowFromSegments(floorPlan, splitSegs, units, corridors) {
        if (!this._flowGroup) {
            this._flowGroup = new THREE.Group();
            this._flowGroup.name = 'globalFlow';
            this.scene.add(this._flowGroup);
        }
        this._flowGroup.clear();

        const allUnits = (units || []).filter(u =>
            Number.isFinite(u.x) && Number.isFinite(u.y) &&
            Number.isFinite(u.width) && Number.isFinite(u.height)
        );
        if (allUnits.length < 2) return;

        // ── 1. Group units into vertical columns by X center ──
        const SNAP = 0.8; // group units within 0.8m of same X
        const unitCols = [];

        // Sort units by X center
        const sorted = [...allUnits].sort((a, b) =>
            (a.x + a.width / 2) - (b.x + b.width / 2)
        );

        for (const u of sorted) {
            const ucx = u.x + u.width / 2;
            let found = unitCols.find(col => Math.abs(col.cx - ucx) < SNAP);
            if (found) {
                found.units.push(u);
                // Recalculate average X
                found.cx = found.units.reduce((s, uu) => s + uu.x + uu.width / 2, 0) / found.units.length;
                found.rightEdge = Math.max(found.rightEdge, u.x + u.width);
                found.leftEdge = Math.min(found.leftEdge, u.x);
            } else {
                unitCols.push({
                    cx: ucx,
                    leftEdge: u.x,
                    rightEdge: u.x + u.width,
                    units: [u]
                });
            }
        }
        unitCols.sort((a, b) => a.cx - b.cx);

        if (unitCols.length < 2) return;

        // ── 2. Find aisles: gaps between adjacent unit columns ──
        const aisles = [];
        for (let i = 0; i < unitCols.length - 1; i++) {
            const left = unitCols[i];
            const right = unitCols[i + 1];
            const gap = right.leftEdge - left.rightEdge;

            // Only real aisles: gap must be between 0.5m and 5m
            if (gap < 0.5 || gap > 5.0) continue;

            const aisleCx = (left.rightEdge + right.leftEdge) / 2;

            // Find Y range covered by units on BOTH sides
            const leftYs = left.units.map(u => ({ y1: u.y, y2: u.y + u.height }));
            const rightYs = right.units.map(u => ({ y1: u.y, y2: u.y + u.height }));

            const overallY1 = Math.max(
                Math.min(...leftYs.map(s => s.y1)),
                Math.min(...rightYs.map(s => s.y1))
            );
            const overallY2 = Math.min(
                Math.max(...leftYs.map(s => s.y2)),
                Math.max(...rightYs.map(s => s.y2))
            );

            if (overallY2 - overallY1 < 1.0) continue;

            aisles.push({
                cx: aisleCx,
                y1: overallY1,
                y2: overallY2,
                width: gap
            });
        }

        if (aisles.length === 0) return;

        // ── 3. Merge aisles at same X into columns ──
        const COL_SNAP = 1.5;
        const aisleCols = [];
        for (const a of aisles) {
            let found = aisleCols.find(col => Math.abs(col.cx - a.cx) < COL_SNAP);
            if (found) {
                found.segs.push({ y1: a.y1, y2: a.y2 });
                found.cx = (found.cx + a.cx) / 2;
            } else {
                aisleCols.push({ cx: a.cx, segs: [{ y1: a.y1, y2: a.y2 }] });
            }
        }
        aisleCols.sort((a, b) => a.cx - b.cx);

        // Merge overlapping segments per column
        for (const col of aisleCols) {
            col.segs.sort((a, b) => a.y1 - b.y1);
            const merged = [{ ...col.segs[0] }];
            for (let i = 1; i < col.segs.length; i++) {
                const prev = merged[merged.length - 1];
                if (col.segs[i].y1 <= prev.y2 + 1.0) {
                    prev.y2 = Math.max(prev.y2, col.segs[i].y2);
                } else {
                    merged.push({ ...col.segs[i] });
                }
            }
            col.segs = merged;
        }

        // ── 4. Arrow rendering ──
        const BLUE = 0x1565C0;
        const arrowMat = new THREE.MeshBasicMaterial({
            color: BLUE, side: THREE.DoubleSide,
            transparent: true, opacity: 0.85
        });
        const Z = 0.25;

        // Tiny arrows
        const AW = 0.35;  // arrow width
        const AH = 0.28;  // arrow height
        const SPACING = 1.5; // distance between arrows

        const drawArrow = (x, y, angle) => {
            const shape = new THREE.Shape();
            shape.moveTo(-AH / 2, -AW / 2);
            shape.lineTo(AH / 2, 0);
            shape.lineTo(-AH / 2, AW / 2);
            shape.closePath();
            const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), arrowMat);
            mesh.position.set(x, y, Z);
            mesh.rotation.z = angle;
            this._flowGroup.add(mesh);
        };

        let totalArrows = 0;

        // Draw arrows on each aisle column, alternating direction
        for (let ci = 0; ci < aisleCols.length; ci++) {
            const col = aisleCols[ci];
            const goUp = (ci % 2 === 0);
            const angle = goUp ? Math.PI / 2 : -Math.PI / 2;

            for (const seg of col.segs) {
                const segLen = seg.y2 - seg.y1;
                if (segLen < AH * 2) continue;

                const n = Math.max(1, Math.floor(segLen / SPACING));
                for (let a = 0; a < n; a++) {
                    const t = (a + 0.5) / n;
                    drawArrow(col.cx, seg.y1 + segLen * t, angle);
                    totalArrows++;
                }
            }
        }

        // ── 5. Horizontal connecting arrows at top/bottom ──
        for (let ci = 0; ci < aisleCols.length - 1; ci++) {
            const col = aisleCols[ci];
            const next = aisleCols[ci + 1];
            const goUp = (ci % 2 === 0);

            // Link at top (if going up) or bottom (if going down)
            let linkY;
            if (goUp) {
                linkY = Math.min(
                    Math.max(...col.segs.map(s => s.y2)),
                    Math.max(...next.segs.map(s => s.y2))
                );
            } else {
                linkY = Math.max(
                    Math.min(...col.segs.map(s => s.y1)),
                    Math.min(...next.segs.map(s => s.y1))
                );
            }

            const x1 = col.cx, x2 = next.cx;
            const hLen = x2 - x1;
            if (hLen < 0.5) continue;

            const hAngle = 0; // pointing right
            const n = Math.max(1, Math.floor(hLen / SPACING));
            for (let a = 0; a < n; a++) {
                const t = (a + 0.5) / n;
                drawArrow(x1 + hLen * t, linkY, hAngle);
                totalArrows++;
            }
        }

        console.log('[Flow] Aisle arrows: ' + aisleCols.length + ' aisles, ' + totalArrows + ' arrows');
    }
    onResize() {
        const aspect = this.container.clientWidth / this.container.clientHeight;
        const frustumSize = 100;
        this.camera.left = frustumSize * aspect / -2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = frustumSize / -2;
        this.camera.updateProjectionMatrix();

        this.perspectiveCamera.aspect = aspect;
        this.perspectiveCamera.updateProjectionMatrix();

        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.composer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.render();
    }

    onMouseClick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const camera = this.is3DMode ? this.perspectiveCamera : this.camera;
        this.raycaster.setFromCamera(this.mouse, camera);

        if (this.measurementMode) {
            this.addMeasurementPoint(this.mouse, camera);
            return;
        }

        const intersects = this.raycaster.intersectObjects(this.ilotMeshes, false);
        if (intersects.length > 0) {
            const selected = intersects[0].object;
            this.selectIlotMesh(selected);
        } else {
            this.clearSelection();
        }
    }

    onMouseMove(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const camera = this.is3DMode ? this.perspectiveCamera : this.camera;
        this.raycaster.setFromCamera(this.mouse, camera);

        const intersects = this.raycaster.intersectObjects(this.ilotMeshes, false);
        this.renderer.domElement.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
    }

    clear() {
        const oldNav = this.scene.getObjectByName('navOverlay');
        if (oldNav) {
            oldNav.traverse((c) => {
                if (c.geometry) c.geometry.dispose();
                this._disposeMaterial(c.material);
            });
            this.scene.remove(oldNav);
        }

        // Clear all groups with proper memory management
        [
            this.wallsGroup,
            this.entrancesGroup,
            this.forbiddenGroup,
            this.ilotsGroup,
            this.corridorsGroup,
            this.perimeterGroup,
            this.corridorArrowsGroup,
            this.connectorsGroup,
            this.connectorHighlights,
            this.stackGroup,
            this.crossFloorPathsGroup,
            this.doorsGroup
        ].forEach(g => {
            if (g) {
                while (g.children.length > 0) {
                    const child = g.children[0];
                    g.remove(child);
                    // Dispose geometry and materials to prevent memory leaks
                    if (child.geometry) child.geometry.dispose();
                    this._disposeMaterial(child.material);
                }
            }
        });
        if (this._flowGroup) {
            while (this._flowGroup.children.length > 0) {
                const child = this._flowGroup.children[0];
                this._flowGroup.remove(child);
                if (child.geometry) child.geometry.dispose();
                this._disposeMaterial(child.material);
            }
        }

        this.ilotMeshes = [];
        this.selectedIlots = [];
        this.stackGroup.visible = false;
        this.currentConnectors = [];
        this.currentConnectorOptions = {};
        this.currentStackFloors = null;
        this.currentStackOptions = {};
        this.currentCrossFloorRoutes = [];
        this.crossFloorOptions = {};
        this.currentFloorPlan = null;
        this.currentCostoLayout = null;
        this.currentCirculationPaths = [];
        this.clearCorridorArrows();
        this.stopArrowAnimation();

        // Hide default grid when clearing
        if (this.defaultGrid) {
            this.defaultGrid.visible = false;
        }

        this.render();
    }

    loadFloorPlan(floorPlan) {
        this.clear();
        this.currentFloorPlan = floorPlan || null;

        console.log('Loading floor plan:', {
            walls: floorPlan.walls?.length || 0,
            entrances: floorPlan.entrances?.length || 0,
            forbiddenZones: floorPlan.forbiddenZones?.length || 0,
            envelope: floorPlan.envelope?.length || 0
        });

        // Hide default grid when floor plan is loaded (we have actual content)
        if (this.defaultGrid) {
            this.defaultGrid.visible = false;
        }

        // Draw external envelope FIRST in bright green (matching reference - thick line)
        if (floorPlan.envelope && Array.isArray(floorPlan.envelope)) {
            floorPlan.envelope.forEach(line => {
                if (line.start && line.end) {
                    const geometry = new THREE.BufferGeometry().setFromPoints([
                        new THREE.Vector3(line.start.x, line.start.y, 0),
                        new THREE.Vector3(line.end.x, line.end.y, 0)
                    ]);
                    const material = new THREE.LineBasicMaterial({
                        color: 0x6B7280, // Thin gray - matching reference "TÃ´le Blanche"
                        linewidth: 2
                    });
                    this.wallsGroup.add(new THREE.Line(geometry, material));
                }
            });
        } else if (false && floorPlan.bounds) {
            // Generate envelope from bounds if not provided
            const { minX, minY, maxX, maxY } = floorPlan.bounds;
            if ([minX, minY, maxX, maxY].every(v => typeof v === 'number') &&
                maxX > minX && maxY > minY) {
                const envelopeLines = [
                    { start: { x: minX, y: minY }, end: { x: maxX, y: minY } },
                    { start: { x: maxX, y: minY }, end: { x: maxX, y: maxY } },
                    { start: { x: maxX, y: maxY }, end: { x: minX, y: maxY } },
                    { start: { x: minX, y: maxY }, end: { x: minX, y: minY } }
                ];
                const envelopeMaterial = new THREE.LineBasicMaterial({
                    color: 0x6B7280, // Thin gray - matching reference "TÃ´le Blanche"
                    linewidth: 2
                });
                envelopeLines.forEach(line => {
                    const geometry = new THREE.BufferGeometry().setFromPoints([
                        new THREE.Vector3(line.start.x, line.start.y, 0),
                        new THREE.Vector3(line.end.x, line.end.y, 0)
                    ]);
                    this.wallsGroup.add(new THREE.Line(geometry, envelopeMaterial));
                });
            }
        }

        // Draw all entities with proper colors matching reference
        // forceColor = true to override DXF entity colors and match legend
        const drawEntity = (entity, group, defaultColor, forceColor = false) => {
            const color = forceColor ? defaultColor : (entity.color || defaultColor || 0x000000);
            if (entity.polygon) {
                this.drawPolygon(entity.polygon, color, group, false);
                // COSTO CLEAN: No dimension labels - reference style is minimal
            } else if (entity.start && entity.end) {
                this.drawLine(entity.start, entity.end, color, group);
                // COSTO CLEAN: No dimension labels - reference style is minimal
            }
        };

        // Walls: BLACK for visibility - ignore DXF embedded colors
        if (floorPlan.walls) {
            floorPlan.walls.forEach(entity => {
                // Draw walls in BLACK (highly visible on white background)
                drawEntity(entity, this.wallsGroup, 0x000000, true); // Black
            });
            console.log(`[Renderer] Drew ${floorPlan.walls.length} walls in black`);
        } else {
            console.warn('[Renderer] No walls to draw!');
        }

        // Entrances: red
        if (floorPlan.entrances) {
            floorPlan.entrances.forEach(entity => {
                drawEntity(entity, this.entrancesGroup, 0xff0000);
            });
        }

        // Forbidden zones: DARK YELLOW with visible fill
        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(entity => {
                // Draw filled forbidden zone in dark yellow/orange
                if (entity.polygon) {
                    const points = entity.polygon.map(pt =>
                        new THREE.Vector2(Array.isArray(pt) ? pt[0] : pt.x, Array.isArray(pt) ? pt[1] : pt.y)
                    );
                    const shape = new THREE.Shape(points);
                    const fillMesh = new THREE.Mesh(
                        new THREE.ShapeGeometry(shape),
                        new THREE.MeshBasicMaterial({
                            color: 0xffcc00, // Dark yellow/gold
                            transparent: true,
                            opacity: 0.5, // Semi-transparent fill
                            side: THREE.DoubleSide
                        })
                    );
                    fillMesh.position.z = 0.05; // Above floor but below ilots
                    this.forbiddenGroup.add(fillMesh);

                    // Also draw outline
                    const linePoints = points.map(p => new THREE.Vector3(p.x, p.y, 0.06));
                    linePoints.push(linePoints[0]); // Close the shape
                    const outline = new THREE.Line(
                        new THREE.BufferGeometry().setFromPoints(linePoints),
                        new THREE.LineBasicMaterial({ color: 0xcc9900, linewidth: 2 }) // Darker yellow outline
                    );
                    this.forbiddenGroup.add(outline);
                } else {
                    drawEntity(entity, this.forbiddenGroup, 0xffcc00, true);
                }
            });
        }

        // COSTO CLEAN: Room numbers disabled - reference shows clean drawing without labels
        // Room numbers are shown in the LEGENDE table on the side panel instead
        // if (floorPlan.rooms && Array.isArray(floorPlan.rooms)) { ... }

        // Draw RM-xxx special rooms with red filled areas
        if (floorPlan.specialRooms && Array.isArray(floorPlan.specialRooms)) {
            floorPlan.specialRooms.forEach(room => {
                if (room.label && room.label.match(/^RM-\d+$/) && room.polygon) {
                    const shape = new THREE.Shape();
                    room.polygon.forEach((pt, idx) => {
                        const x = Array.isArray(pt) ? pt[0] : pt.x;
                        const y = Array.isArray(pt) ? pt[1] : pt.y;
                        if (idx === 0) {
                            shape.moveTo(x, y);
                        } else {
                            shape.lineTo(x, y);
                        }
                    });
                    shape.lineTo(room.polygon[0][0] || room.polygon[0].x, room.polygon[0][1] || room.polygon[0].y);

                    const geometry = new THREE.ShapeGeometry(shape);
                    const material = new THREE.MeshBasicMaterial({
                        color: 0xff6666, // Light red/pink fill
                        transparent: true,
                        opacity: 0.4
                    });
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.z = 0.01;
                    this.wallsGroup.add(mesh);

                    // Draw label
                    if (room.position) {
                        const labelSprite = this.createTextSprite(room.label, {
                            fontsize: 20,
                            fillStyle: '#ff0000',
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            fontWeight: 'bold'
                        });
                        labelSprite.position.set(room.position.x, room.position.y, 0.1);
                        labelSprite.scale.set(1.5, 1.5, 1);
                        this.wallsGroup.add(labelSprite);
                    }
                }
            });
        }

        // Draw green filled zones (Ex50, etc.)
        if (floorPlan.greenZones && Array.isArray(floorPlan.greenZones)) {
            floorPlan.greenZones.forEach(zone => {
                if (zone.polygon) {
                    const shape = new THREE.Shape();
                    zone.polygon.forEach((pt, idx) => {
                        const x = Array.isArray(pt) ? pt[0] : pt.x;
                        const y = Array.isArray(pt) ? pt[1] : pt.y;
                        if (idx === 0) {
                            shape.moveTo(x, y);
                        } else {
                            shape.lineTo(x, y);
                        }
                    });
                    shape.lineTo(zone.polygon[0][0] || zone.polygon[0].x, zone.polygon[0][1] || zone.polygon[0].y);

                    const geometry = new THREE.ShapeGeometry(shape);
                    const material = new THREE.MeshBasicMaterial({
                        color: 0x00ff00, // Bright green fill
                        transparent: true,
                        opacity: 0.3
                    });
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.z = 0.01;
                    this.wallsGroup.add(mesh);

                    // Draw label if available
                    if (zone.label && zone.position) {
                        const labelSprite = this.createTextSprite(zone.label, {
                            fontsize: 20,
                            fillStyle: '#000000',
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            fontWeight: 'bold'
                        });
                        labelSprite.position.set(zone.position.x, zone.position.y, 0.1);
                        labelSprite.scale.set(1.5, 1.5, 1);
                        this.wallsGroup.add(labelSprite);
                    }
                }
            });
        }

        // Draw yellow annotation boxes
        if (floorPlan.annotations && Array.isArray(floorPlan.annotations)) {
            floorPlan.annotations.forEach(annotation => {
                if (annotation.type === 'yellow-box' && annotation.text && annotation.position) {
                    const labelSprite = this.createTextSprite(annotation.text, {
                        fontsize: 18,
                        fillStyle: '#000000',
                        backgroundColor: 'rgba(255, 255, 0, 0.8)', // Yellow background
                        fontWeight: 'bold',
                        padding: 5
                    });
                    labelSprite.position.set(annotation.position.x, annotation.position.y, 0.1);
                    labelSprite.scale.set(1.2, 1.2, 1);
                    this.wallsGroup.add(labelSprite);
                }
            });
        }

        if (floorPlan.bounds) this.fitToBounds(floorPlan.bounds);
        this.render();
    }

    /**
     * Render green arrows at entrance locations pointing toward floor interior.
     * Reference style: green triangle arrows at entrances/exits.
     * @param {Array} entrances - Array of entrance entities with start/end or polygon
     * @param {Object} bounds - Floor plan bounds {minX, minY, maxX, maxY}
     */
    renderEntranceArrows(entrances, bounds) {
        if (!Array.isArray(entrances) || entrances.length === 0) return;
        if (!bounds) return;

        // Create or find entrance arrows group
        if (!this.entranceArrowsGroup) {
            this.entranceArrowsGroup = new THREE.Group();
            this.entranceArrowsGroup.name = 'entranceArrows';
            this.scene.add(this.entranceArrowsGroup);
        }
        // Clear existing
        while (this.entranceArrowsGroup.children.length > 0) {
            const child = this.entranceArrowsGroup.children[0];
            this.entranceArrowsGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        const arrowMaterial = new THREE.MeshBasicMaterial({
            color: 0x00aa00, // Green arrows for entrances
            side: THREE.DoubleSide
        });

        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        entrances.forEach(entrance => {
            let x, y, angle;

            // Get entrance position
            if (entrance.start && entrance.end) {
                x = (entrance.start.x + entrance.end.x) / 2;
                y = (entrance.start.y + entrance.end.y) / 2;
                // Calculate direction pointing toward floor center
                const dx = centerX - x;
                const dy = centerY - y;
                angle = Math.atan2(dy, dx);
            } else if (entrance.x !== undefined && entrance.y !== undefined) {
                x = entrance.x;
                y = entrance.y;
                const dx = centerX - x;
                const dy = centerY - y;
                angle = Math.atan2(dy, dx);
            } else if (entrance.polygon) {
                // Get centroid of polygon
                const pts = entrance.polygon;
                x = pts.reduce((sum, p) => sum + (p.x || p[0] || 0), 0) / pts.length;
                y = pts.reduce((sum, p) => sum + (p.y || p[1] || 0), 0) / pts.length;
                const dx = centerX - x;
                const dy = centerY - y;
                angle = Math.atan2(dy, dx);
            } else {
                return;
            }

            // Create arrow triangle pointing inward
            const arrowSize = 0.8;
            const arrowGeom = new THREE.BufferGeometry();
            const vertices = new Float32Array([
                -arrowSize * 0.6, -arrowSize * 0.4, 0.2,
                -arrowSize * 0.6, arrowSize * 0.4, 0.2,
                arrowSize * 0.6, 0, 0.2
            ]);
            arrowGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

            const arrow = new THREE.Mesh(arrowGeom, arrowMaterial.clone());
            arrow.position.set(x, y, 0.2);
            arrow.rotation.z = angle;
            this.entranceArrowsGroup.add(arrow);
        });

        console.log(`Rendered ${entrances.length} entrance arrows (green)`);
        this.render();
    }


    drawLine(start, end, color, group) {
        if (!start || !end) return;
        const sx = Number(start.x);
        const sy = Number(start.y);
        const ex = Number(end.x);
        const ey = Number(end.y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
            return;
        }

        // Use TubeGeometry for thick visible lines instead of thin Line
        const path = new THREE.LineCurve3(
            new THREE.Vector3(sx, sy, 0),
            new THREE.Vector3(ex, ey, 0)
        );
        const geometry = new THREE.TubeGeometry(path, 1, 0.03, 4, false); // 3cm thick tubes
        const material = new THREE.MeshBasicMaterial({ color });
        group.add(new THREE.Mesh(geometry, material));
    }

    drawPolygon(polygon, color, group, filled = false) {
        if (!Array.isArray(polygon) || polygon.length === 0) return;
        const points = polygon.map((pt) => {
            if (!pt) return null;
            const x = Number(Array.isArray(pt) ? pt[0] : pt.x);
            const y = Number(Array.isArray(pt) ? pt[1] : pt.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return new THREE.Vector2(x, y);
        }).filter(Boolean);
        if (points.length < 2) return;

        if (filled) {
            if (points.length < 3) return;
            const shape = new THREE.Shape(points);
            const mesh = new THREE.Mesh(
                new THREE.ShapeGeometry(shape),
                new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
            );
            group.add(mesh);
        }

        const linePoints = points.map(p => new THREE.Vector3(p.x, p.y, 0));
        linePoints.push(linePoints[0]);

        if (this.is3DMode) {
            if (points.length < 3) return;
            // Extrude walls in 3D
            const shape = new THREE.Shape(points);
            const extrudeSettings = { depth: 3.0, bevelEnabled: false }; // 3m wall height
            const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            const material = new THREE.MeshStandardMaterial({
                color: 0xeeeeee, // White walls
                roughness: 0.9,
                metalness: 0.0,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
        } else {
            // 2D Line
            group.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(linePoints),
                new THREE.LineBasicMaterial({ color, linewidth: 2 })
            ));
        }
    }

    renderIlots(ilots) {
        // Remember which ilot was selected (by index)
        const selectedIndex = this.selectedIlots.length > 0 ? this.selectedIlots[0].userData.index : -1;

        // Clear existing meshes
        this.ilotsGroup.clear();
        this.ilotMeshes = [];
        this.selectedIlots = [];

        // Render storage units: blue outlines only, NO white fill (per user: remove white layer)
        const outlineColor = 0x0000ff; // Blue outlines like reference "TÃ´le Grise"
        const showLabels = ilots.length <= 900; // Keep full CAD annotation visible on dense plans

        if (!ilots || ilots.length === 0) {
            this.render();
            return;
        }

        // Rebuild all meshes from ilot data (source of truth)
        ilots.forEach((ilot, index) => {
            if (!ilot || typeof ilot.x !== 'number' || typeof ilot.y !== 'number' ||
                typeof ilot.width !== 'number' || typeof ilot.height !== 'number') {
                console.warn('Invalid ilot data:', ilot);
                return;
            }

            // Create shape with relative coordinates (0,0 origin)
            const shape = new THREE.Shape([
                new THREE.Vector2(0, 0),
                new THREE.Vector2(ilot.width, 0),
                new THREE.Vector2(ilot.width, ilot.height),
                new THREE.Vector2(0, ilot.height)
            ]);

            let geometry, material;
            // NO white fill - only blue outlines visible (user: remove white layer on boxes)
            const fillColor = 0xffffff;

            if (this.is3DMode) {
                const area = ilot.area || (ilot.width * ilot.height);
                const baseHeight = 1.5;
                const heightScale = 0.3;
                const maxHeight = 5.0;
                const variableDepth = Math.min(baseHeight + area * heightScale, maxHeight);
                const extrudeSettings = { depth: variableDepth, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2 };
                geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                material = new THREE.MeshStandardMaterial({
                    color: fillColor,
                    metalness: 0.1,
                    roughness: 0.6,
                    transparent: true,
                    opacity: 0  // No fill - transparent (outlines only)
                });
            } else {
                geometry = new THREE.ShapeGeometry(shape);
                material = new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    transparent: true,
                    opacity: 0,  // No white layer - transparent
                    side: THREE.DoubleSide
                });
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.userData = { ilot, index, type: 'ilot' };

            // Enable shadow casting for 3D mode
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Position mesh from ilot data (source of truth)
            mesh.position.set(ilot.x, ilot.y, 0);

            this.ilotsGroup.add(mesh);
            this.ilotMeshes.push(mesh);

            const linePoints = [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(ilot.width, 0, 0),
                new THREE.Vector3(ilot.width, ilot.height, 0),
                new THREE.Vector3(0, ilot.height, 0),
                new THREE.Vector3(0, 0, 0)
            ];
            // Draw blue outline (thicker like reference "TÃ´le Grise")
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(linePoints),
                new THREE.LineBasicMaterial({
                    color: outlineColor, // Blue
                    linewidth: 2, // Thicker lines
                    transparent: false
                })
            );
            line.position.set(ilot.x, ilot.y, 0);
            this.ilotsGroup.add(line);

            // Add additional outline for thickness effect (like reference)
            const outlineLine = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(linePoints),
                new THREE.LineBasicMaterial({
                    color: outlineColor,
                    linewidth: 1.5,
                    transparent: true,
                    opacity: 0.8
                })
            );
            outlineLine.position.set(ilot.x, ilot.y, 0.01);
            this.ilotsGroup.add(outlineLine);

            // Add unit size label and surface area in center of ilot (matching reference style)
            if (showLabels) {
                const area = ilot.area || (ilot.width * ilot.height);

                // Calculate unit size label (consistent with backend calculation)
                const standardSizes = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25];
                let closest = standardSizes[0];
                let minDiff = Math.abs(area - closest);
                for (const size of standardSizes) {
                    const diff = Math.abs(area - size);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closest = size;
                    }
                }
                if (area > 25) {
                    closest = Math.round(area * 2) / 2; // Round to nearest 0.5
                }

                // Store calculated unit size for export consistency
                ilot.unitSize = closest;

                // Professional CAD dimensions + area on every box
                this._drawProfessionalUnitAnnotations(ilot, 0.10);
            }
        });

        // Restore selection if there was one (visual only, no event dispatch)
        if (selectedIndex >= 0 && selectedIndex < this.ilotMeshes.length) {
            const mesh = this.ilotMeshes[selectedIndex];
            this.selectedIlots = [mesh];
            this.outlinePass.selectedObjects = this.selectedIlots;

            // Restore visual state â€” highlight selected, keep others at original
            this.ilotMeshes.forEach(m => {
                if (m === mesh) {
                    m.material.color.set(0xd0e8ff);
                    m.material.opacity = 0.6;
                }
            });
        }

        console.log(`Rendered ${ilots.length} ilots in Three.js`);

        // Perimeter circulation is handled by renderCorridors - disabled here
        // this.renderPerimeterCirculation(ilots, null);

        this.render();
    }
    _normalizePathPoints(rawPoints) {
        if (!Array.isArray(rawPoints)) return null;
        const points = rawPoints.map((pt) => {
            if (!pt) return null;
            const x = Number(pt.x !== undefined ? pt.x : pt[0]);
            const y = Number(pt.y !== undefined ? pt.y : pt[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x, y };
        }).filter(Boolean);
        if (points.length < 2) return null;

        const deduped = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const prev = deduped[deduped.length - 1];
            if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) > 0.05) {
                deduped.push(points[i]);
            }
        }
        return deduped.length >= 2 ? deduped : null;
    }

    _extractUnitRects(units = null) {
        if (Array.isArray(units) && units.length > 0) {
            return units
                .filter((u) => [u?.x, u?.y, u?.width, u?.height].every(Number.isFinite))
                .map((u) => ({ x: u.x, y: u.y, width: u.width, height: u.height }));
        }
        if (this.currentCostoLayout && Array.isArray(this.currentCostoLayout.units)) {
            return this.currentCostoLayout.units
                .filter((u) => [u?.x, u?.y, u?.width, u?.height].every(Number.isFinite))
                .map((u) => ({ x: u.x, y: u.y, width: u.width, height: u.height }));
        }
        return this.ilotMeshes
            .map((mesh) => mesh?.userData?.ilot)
            .filter((u) => [u?.x, u?.y, u?.width, u?.height].every(Number.isFinite))
            .map((u) => ({ x: u.x, y: u.y, width: u.width, height: u.height }));
    }

    _distToSegment(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 0.0001) return Math.hypot(px - ax, py - ay);
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    _pointInsideRect(px, py, rect, pad = 0.0) {
        return (
            px >= rect.x + pad &&
            px <= rect.x + rect.width - pad &&
            py >= rect.y + pad &&
            py <= rect.y + rect.height - pad
        );
    }

    _isFlowPointBlocked(px, py, floorPlan, unitRects = []) {
        const fp = floorPlan || {};
        const tolerance = 0.085;
        const walls = fp.walls || [];
        const envelope = fp.envelope || [];
        const forbidden = fp.forbiddenZones || [];

        for (const r of unitRects) {
            if (this._pointInsideRect(px, py, r, 0.04)) return true;
        }

        for (const zone of forbidden) {
            if (Array.isArray(zone?.polygon) && zone.polygon.length >= 3) {
                const xs = zone.polygon.map((p) => Number(Array.isArray(p) ? p[0] : p?.x)).filter(Number.isFinite);
                const ys = zone.polygon.map((p) => Number(Array.isArray(p) ? p[1] : p?.y)).filter(Number.isFinite);
                if (xs.length && ys.length) {
                    const minX = Math.min(...xs), maxX = Math.max(...xs);
                    const minY = Math.min(...ys), maxY = Math.max(...ys);
                    if (px >= minX && px <= maxX && py >= minY && py <= maxY) return true;
                }
            } else if ([zone?.x, zone?.y, zone?.width, zone?.height].every(Number.isFinite)) {
                if (px >= zone.x && px <= zone.x + zone.width && py >= zone.y && py <= zone.y + zone.height) {
                    return true;
                }
            }
        }

        const testSeg = (a, b) => this._distToSegment(px, py, a.x, a.y, b.x, b.y) < tolerance;

        const testEntity = (entity) => {
            if (entity?.start && entity?.end) {
                return testSeg(entity.start, entity.end);
            }
            if (Array.isArray(entity?.polygon) && entity.polygon.length > 1) {
                for (let i = 0; i < entity.polygon.length - 1; i++) {
                    const a = entity.polygon[i];
                    const b = entity.polygon[i + 1];
                    const p1 = { x: Number(Array.isArray(a) ? a[0] : a?.x), y: Number(Array.isArray(a) ? a[1] : a?.y) };
                    const p2 = { x: Number(Array.isArray(b) ? b[0] : b?.x), y: Number(Array.isArray(b) ? b[1] : b?.y) };
                    if ([p1.x, p1.y, p2.x, p2.y].every(Number.isFinite) && testSeg(p1, p2)) {
                        return true;
                    }
                }
            }
            return false;
        };

        for (const w of walls) {
            if (testEntity(w)) return true;
        }
        for (const e of envelope) {
            if (testEntity(e)) return true;
        }
        return false;
    }

    _isPointInsideCorridor(px, py, corridor, margin = 0.02) {
        if ([corridor?.x, corridor?.y, corridor?.width, corridor?.height].every(Number.isFinite)) {
            return (
                px >= corridor.x - margin &&
                px <= corridor.x + corridor.width + margin &&
                py >= corridor.y - margin &&
                py <= corridor.y + corridor.height + margin
            );
        }
        const path = this._normalizePathPoints(corridor?.path || corridor?.corners || corridor?.polygon);
        if (!path) return false;
        const widthHint = Number(corridor?.corridorWidth || corridor?.width || corridor?.height || 1.2);
        const tolerance = Math.max(0.2, widthHint * 0.55);
        for (let i = 0; i < path.length - 1; i++) {
            const a = path[i];
            const b = path[i + 1];
            if (this._distToSegment(px, py, a.x, a.y, b.x, b.y) <= tolerance) return true;
        }
        return false;
    }

    _fallbackDirectedPathFromCorridors(corridors, floorPlan) {
        const fallback = [];
        const visit = this._buildVisitRoutePolyline(floorPlan || {}, corridors || []);
        if (Array.isArray(visit?.path) && visit.path.length >= 2) {
            fallback.push({ type: 'SPINE', onMainRoute: true, flowValid: true, path: visit.path, arrows: [] });
            return fallback;
        }

        const entry = this._getEntrancePoints(floorPlan || {}).entry || null;

        for (const c of (corridors || [])) {
            if (![c?.x, c?.y, c?.width, c?.height].every(Number.isFinite)) continue;
            const cx = c.x + c.width / 2;
            const cy = c.y + c.height / 2;
            const isH = c.direction === 'horizontal' || c.width >= c.height;
            const seg = isH
                ? [{ x: c.x, y: cy }, { x: c.x + c.width, y: cy }]
                : [{ x: cx, y: c.y }, { x: cx, y: c.y + c.height }];
            if (entry) {
                const d0 = Math.hypot(seg[0].x - entry.x, seg[0].y - entry.y);
                const d1 = Math.hypot(seg[1].x - entry.x, seg[1].y - entry.y);
                if (d1 < d0) seg.reverse();
            }
            fallback.push({
                type: 'BRANCH',
                onMainRoute: false,
                flowValid: true,
                path: seg,
                arrows: []
            });
        }
        return fallback;
    }

    _prepareDirectedCirculationPaths(circulationPaths, corridors, floorPlan) {
        // Prefer backend-routed circulation (entry/exit validated + connector paths).
        // The corridor-only graph is a fallback if backend paths are unavailable.
        const output = [];
        const entry = this._getEntrancePoints(floorPlan || {}).entry || null;
        for (const cp of (Array.isArray(circulationPaths) ? circulationPaths : [])) {
            if (cp?.flowValid === false) continue;
            const path = this._normalizePathPoints(cp?.path);
            if (!path) continue;

            const oriented = [...path];
            if (cp?.flowEntry) {
                const ex = Number(cp.flowEntry.x);
                const ey = Number(cp.flowEntry.y);
                if (Number.isFinite(ex) && Number.isFinite(ey)) {
                    const start = oriented[0];
                    const end = oriented[oriented.length - 1];
                    const dStart = Math.hypot(start.x - ex, start.y - ey);
                    const dEnd = Math.hypot(end.x - ex, end.y - ey);
                    if (dEnd + 1e-6 < dStart) oriented.reverse();
                }
            } else if (entry) {
                const start = oriented[0];
                const end = oriented[oriented.length - 1];
                const dStart = Math.hypot(start.x - entry.x, start.y - entry.y);
                const dEnd = Math.hypot(end.x - entry.x, end.y - entry.y);
                if (dEnd + 1e-6 < dStart) oriented.reverse();
            }

            const arrows = Array.isArray(cp?.arrows)
                ? cp.arrows
                    .map((a) => ({ x: Number(a?.x), y: Number(a?.y), angle: Number(a?.angle) }))
                    .filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.angle))
                : [];

            output.push({
                type: cp?.type || 'FLOW',
                onMainRoute: !!cp?.onMainRoute,
                flowValid: cp?.flowValid !== false,
                path: oriented,
                arrows,
                allowOffCorridor: true
            });
        }

        if (output.length > 0) {
            return output;
        }

        const networkPaths = this._buildDirectedNetworkFromCorridors(corridors, floorPlan);
        if (networkPaths.length > 0) {
            return networkPaths.map((p) => ({ ...p, allowOffCorridor: false }));
        }

        return this._fallbackDirectedPathFromCorridors(corridors, floorPlan);
    }

    _renderDirectedCirculation(flowPaths, floorPlan, unitRects = [], corridors = []) {
        if (!this._flowGroup) {
            this._flowGroup = new THREE.Group();
            this._flowGroup.name = 'directedFlow';
            this.scene.add(this._flowGroup);
        }
        while (this._flowGroup.children.length > 0) {
            const child = this._flowGroup.children[0];
            this._flowGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            this._disposeMaterial(child.material);
        }

        if (!Array.isArray(flowPaths) || flowPaths.length === 0) return;

        const flowLineMaterial = new THREE.LineDashedMaterial({
            color: 0x65b87b,
            dashSize: 0.85,
            gapSize: 0.8,
            transparent: true,
            opacity: 0.86
        });
        const arrowGeometry = new THREE.BufferGeometry();
        const arrowSize = 0.1;
        arrowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            -arrowSize * 0.70, -arrowSize * 0.42, 0,
            -arrowSize * 0.70, arrowSize * 0.42, 0,
            arrowSize * 0.78, 0, 0
        ]), 3));

        const onAnyCorridor = (x, y, margin) => (
            Array.isArray(corridors) &&
            corridors.length > 0 &&
            corridors.some((c) => this._isPointInsideCorridor(x, y, c, margin))
        );

        const addArrow = (x, y, angle, allowOffCorridor = false) => {
            if (this._isFlowPointBlocked(x, y, floorPlan, unitRects)) return;
            if (!allowOffCorridor && Array.isArray(corridors) && corridors.length > 0) {
                if (!onAnyCorridor(x, y, 0.12)) return;
            }
            const mesh = new THREE.Mesh(arrowGeometry, this._costoMats.arrowGreen);
            mesh.position.set(x, y, 0.21);
            mesh.rotation.z = angle;
            this._flowGroup.add(mesh);
        };

        const segmentPasses = (a, b, allowOffCorridor = false) => {
            const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
            if (!allowOffCorridor && Array.isArray(corridors) && corridors.length > 0) {
                const onCorridor = (
                    onAnyCorridor(a.x, a.y, 0.12) &&
                    onAnyCorridor(mid.x, mid.y, 0.12) &&
                    onAnyCorridor(b.x, b.y, 0.12)
                );
                if (!onCorridor) return false;
            }
            if (this._isFlowPointBlocked(mid.x, mid.y, floorPlan, unitRects)) return false;
            return true;
        };

        for (const flow of flowPaths) {
            const path = this._normalizePathPoints(flow.path);
            if (!path) continue;
            const allowOffCorridor = !!flow?.allowOffCorridor;

            const validSegments = [];
            for (let i = 0; i < path.length - 1; i++) {
                const a = path[i];
                const b = path[i + 1];
                const dx = b.x - a.x;
                const dy = b.y - a.y;

                // Snap accidental diagonal strokes to orthogonal elbows to keep traffic lines architecturally clean.
                if (Math.abs(dx) > 0.08 && Math.abs(dy) > 0.08) {
                    const kneeA = { x: b.x, y: a.y };
                    const kneeB = { x: a.x, y: b.y };
                    const candAOk = segmentPasses(a, kneeA, allowOffCorridor) && segmentPasses(kneeA, b, allowOffCorridor);
                    const candBOk = segmentPasses(a, kneeB, allowOffCorridor) && segmentPasses(kneeB, b, allowOffCorridor);
                    if (candAOk) {
                        validSegments.push([a, kneeA], [kneeA, b]);
                        continue;
                    }
                    if (candBOk) {
                        validSegments.push([a, kneeB], [kneeB, b]);
                        continue;
                    }
                }
                if (!segmentPasses(a, b, allowOffCorridor)) continue;
                validSegments.push([a, b]);
            }

            for (const [a, b] of validSegments) {
                const line = new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints([
                        new THREE.Vector3(a.x, a.y, 0.17),
                        new THREE.Vector3(b.x, b.y, 0.17)
                    ]),
                    flowLineMaterial
                );
                line.computeLineDistances();
                this._flowGroup.add(line);
            }

            if (Array.isArray(flow.arrows) && flow.arrows.length > 0) {
                flow.arrows.forEach((a) => addArrow(a.x, a.y, a.angle, allowOffCorridor));
                continue;
            }

            const spacing = flow.onMainRoute ? 1.55 : 2.05;
            let carry = 0;
            for (const [a, b] of validSegments) {
                const segLen = Math.hypot(b.x - a.x, b.y - a.y);
                if (segLen < 0.2) continue;
                const angle = Math.atan2(b.y - a.y, b.x - a.x);

                // Short split-segments still need a visible direction marker.
                if (segLen <= spacing * 1.05) {
                    addArrow((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, angle, allowOffCorridor);
                    carry = 0;
                    continue;
                }

                let t = (spacing - carry) / segLen;
                while (t <= 1.0) {
                    const x = a.x + (b.x - a.x) * t;
                    const y = a.y + (b.y - a.y) * t;
                    addArrow(x, y, angle, allowOffCorridor);
                    t += spacing / segLen;
                }
                carry = (segLen - ((spacing - carry) % segLen)) % spacing;
            }
        }
    }

    renderCorridors(corridors, floorPlan) {
        const corridorList = Array.isArray(corridors) ? corridors : [];
        const activePlan = floorPlan || this.currentFloorPlan || {};
        const flowPaths = this._prepareDirectedCirculationPaths(
            this.currentCirculationPaths,
            corridorList,
            activePlan
        );

        while (this.corridorsGroup.children.length > 0) {
            const child = this.corridorsGroup.children[0];
            this.corridorsGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            this._disposeMaterial(child.material);
        }

        const centerlineMaterial = new THREE.LineDashedMaterial({
            color: 0x8fb5ee,
            dashSize: 0.55,
            gapSize: 0.42,
            transparent: true,
            opacity: 0.75
        });

        const sourcePaths = corridorList;

        for (const corridor of sourcePaths) {
            const pathPoints = this._normalizePathPoints(corridor?.path || corridor?.corners || corridor?.polygon);
            if (pathPoints) {
                const poly = new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints(pathPoints.map((p) => new THREE.Vector3(p.x, p.y, 0.12))),
                    centerlineMaterial
                );
                poly.computeLineDistances();
                this.corridorsGroup.add(poly);
                continue;
            }

            if (![corridor?.x, corridor?.y, corridor?.width, corridor?.height].every(Number.isFinite)) {
                continue;
            }

            const cx = corridor.x + corridor.width / 2;
            const cy = corridor.y + corridor.height / 2;
            const isHorizontal = corridor.direction === 'horizontal' || corridor.width >= corridor.height;
            const seg = isHorizontal
                ? [new THREE.Vector3(corridor.x, cy, 0.12), new THREE.Vector3(corridor.x + corridor.width, cy, 0.12)]
                : [new THREE.Vector3(cx, corridor.y, 0.12), new THREE.Vector3(cx, corridor.y + corridor.height, 0.12)];

            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(seg), centerlineMaterial);
            line.computeLineDistances();
            this.corridorsGroup.add(line);
        }

        const unitRects = this._extractUnitRects();
        this._renderDirectedCirculation(flowPaths, activePlan, unitRects, corridorList);

        console.log(`[Corridors] Rendered ${this.corridorsGroup.children.length} corridor centerlines with directed traffic flow`);
        this.render();
    }

    /**
     * Render radiators as continuous red zigzag polylines along walls.
     * Matches COSTO reference: red zigzag lines along perimeter + corridor edges.
     * @param {Array} radiators - Array of radiator objects with path data
     */
    renderRadiators(radiators) {
        return; // DISABLED: no radiator zigzags
    }

    _drawRadiatorSymbol(cx, cy, angle, material) {
        return; // DISABLED: no radiator symbols
    }

    renderCirculationPaths(circulationPaths) {
        return; // DISABLED: no old circulation dashes
    }

    /**
     * renderCostoLayout - Draw the COMPLETE COSTO professional plan in one shot.
     * Clears all existing geometry and redraws everything from computed data.
     * 
     * @param {Object} floorPlan - Original floor plan (bounds, walls, entrances, forbiddenZones, envelope)
     * @param {Object} layoutData - Computed layout: {units, corridors, radiators, circulationPaths}
     */
    renderCostoLayout(floorPlan, layoutData) {
        console.log('[COSTO Layout] Drawing complete professional plan');
        this.clear();

        if (this.defaultGrid) this.defaultGrid.visible = false;

        const bounds = floorPlan?.bounds || null;
        const units = layoutData.units || [];
        const corridors = layoutData.corridors || [];
        const radiators = layoutData.radiators || [];
        const circulationPaths = layoutData.circulationPaths || [];

        this.currentFloorPlan = floorPlan || null;
        this.currentCostoLayout = { units, corridors, radiators, circulationPaths };
        this.currentCirculationPaths = Array.isArray(circulationPaths) ? circulationPaths : [];
        this.bounds = bounds;

        // â”€â”€ 1. FLOOR BACKGROUND â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Light gray floor fill
        if (bounds) {
            const floorShape = new THREE.Shape([
                new THREE.Vector2(bounds.minX, bounds.minY),
                new THREE.Vector2(bounds.maxX, bounds.minY),
                new THREE.Vector2(bounds.maxX, bounds.maxY),
                new THREE.Vector2(bounds.minX, bounds.maxY)
            ]);
            const floorMesh = new THREE.Mesh(
                new THREE.ShapeGeometry(floorShape),
                new THREE.MeshBasicMaterial({ color: 0xf8f8f8, side: THREE.DoubleSide })
            );
            floorMesh.position.z = -0.02;
            this.wallsGroup.add(floorMesh);
        }

        // Coverage boundary: explicit outer square from plan bounds.
        while (this.perimeterGroup.children.length > 0) {
            const child = this.perimeterGroup.children[0];
            this.perimeterGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            this._disposeMaterial(child.material);
        }
        // Do not draw synthetic coverage square from bounds.
        // Only real envelope/wall geometry should define the outer boundary.
        // â”€â”€ Wall/obstacle collision helper for arrows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const walls = floorPlan.walls || [];
        const forbiddenZones = floorPlan.forbiddenZones || [];
        const arrowWallTolerance = 0.4; // min distance from wall center to allow arrow

        // Point-to-segment distance
        const distToSegment = (px, py, ax, ay, bx, by) => {
            const dx = bx - ax, dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            if (lenSq < 0.0001) return Math.hypot(px - ax, py - ay);
            let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        };

        const pointBlockedByWall = (px, py) => {
            // Check forbidden zones (stairs, elevators, etc.)
            for (const fz of forbiddenZones) {
                if (px >= fz.x && px <= fz.x + (fz.width || 0) &&
                    py >= fz.y && py <= fz.y + (fz.height || 0)) {
                    return true;
                }
            }
            // Check wall segments
            for (const w of walls) {
                if (!w.start || !w.end) continue;
                const d = distToSegment(px, py, w.start.x, w.start.y, w.end.x, w.end.y);
                if (d < arrowWallTolerance) return true;
            }
            return false;
        };

        // (Dashed corridor centerlines removed â€” Final.pdf uses wave perimeters instead)


        // â”€â”€ 8. RADIATOR GROUP (init for door blocks) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (!this.radiatorsGroup) {
            this.radiatorsGroup = new THREE.Group();
            this.radiatorsGroup.name = 'radiators';
            this.scene.add(this.radiatorsGroup);
        }
        while (this.radiatorsGroup.children.length > 0) {
            const child = this.radiatorsGroup.children[0];
            this.radiatorsGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            this._disposeMaterial(child.material);
        }

        // â”€â”€ 4. BOXES (white fills + partitions + door blocks) â”€â”€
        const showLabels = units.length <= 900;

        units.forEach((ilot, index) => {
            if (![ilot.x, ilot.y, ilot.width, ilot.height].every(n => Number.isFinite(n))) return;

            // Clean white fill
            const shape = new THREE.Shape([
                new THREE.Vector2(0, 0),
                new THREE.Vector2(ilot.width, 0),
                new THREE.Vector2(ilot.width, ilot.height),
                new THREE.Vector2(0, ilot.height)
            ]);
            const fillMesh = new THREE.Mesh(
                new THREE.ShapeGeometry(shape),
                new THREE.MeshBasicMaterial({
                    color: 0xffffff, transparent: true, opacity: 0.85,
                    side: THREE.DoubleSide, depthWrite: false
                })
            );
            fillMesh.position.set(ilot.x, ilot.y, 0.02);
            fillMesh.userData = { ilot, index, type: 'ilot', _origColor: 0xffffff, _origOpacity: 0.85 };
            this.ilotsGroup.add(fillMesh);
            this.ilotMeshes.push(fillMesh);

            // Per-edge partition outlines (blue door-side, dark other sides)
            this._drawUnitPartitions(ilot, 0.07);

            // Door blocks disabled — visual clutter at scale
            // this._drawDoorBlocksForUnit(ilot, 0.14);

            // Professional CAD dimensions + area on every box
            if (showLabels) {
                this._drawProfessionalUnitAnnotations(ilot, 0.10);
            }
        });

        // â”€â”€ 5. WALLS (thick filled rectangles, professional CAD style) â”€â”€â”€â”€
        const wallFillColor = 0x4b5563;
        const wallThickness = 0.055;
        const envelopeThickness = 0.075;

        const drawThickWall = (start, end, thickness) => {
            const dx = end.x - start.x, dy = end.y - start.y;
            const len = Math.hypot(dx, dy);
            if (len < 0.1) return;
            // Normal perpendicular to wall direction
            const nx = -dy / len * (thickness / 2);
            const ny = dx / len * (thickness / 2);
            const wallShape = new THREE.Shape([
                new THREE.Vector2(start.x + nx, start.y + ny),
                new THREE.Vector2(end.x + nx, end.y + ny),
                new THREE.Vector2(end.x - nx, end.y - ny),
                new THREE.Vector2(start.x - nx, start.y - ny)
            ]);
            const wallMesh = new THREE.Mesh(
                new THREE.ShapeGeometry(wallShape),
                new THREE.MeshBasicMaterial({ color: wallFillColor, side: THREE.DoubleSide })
            );
            wallMesh.position.z = 0.03;
            this.wallsGroup.add(wallMesh);
        };

        // Draw envelope (exterior perimeter) with thicker fills
        if (floorPlan.envelope && Array.isArray(floorPlan.envelope)) {
            floorPlan.envelope.forEach(line => {
                if (line.start && line.end) {
                    drawThickWall(line.start, line.end, envelopeThickness);
                }
            });
        }

        // Draw internal walls as thick filled rectangles
        if (floorPlan.walls && Array.isArray(floorPlan.walls)) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    drawThickWall(wall.start, wall.end, wallThickness);
                } else if (wall.polygon && Array.isArray(wall.polygon)) {
                    // Polyline walls: draw each segment thick
                    const pts = wall.polygon.map(pt => ({
                        x: Array.isArray(pt) ? pt[0] : pt.x,
                        y: Array.isArray(pt) ? pt[1] : pt.y
                    }));
                    for (let i = 0; i < pts.length - 1; i++) {
                        drawThickWall(pts[i], pts[i + 1], wallThickness);
                    }
                }
            });
        }

        // â”€â”€ 6. FORBIDDEN ZONES (yellow fill) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (floorPlan.forbiddenZones && Array.isArray(floorPlan.forbiddenZones)) {
            floorPlan.forbiddenZones.forEach(fz => {
                if (fz.polygon) {
                    const pts2d = fz.polygon.map(pt =>
                        new THREE.Vector2(Array.isArray(pt) ? pt[0] : pt.x, Array.isArray(pt) ? pt[1] : pt.y)
                    );
                    const fzShape = new THREE.Shape(pts2d);
                    const fzMesh = new THREE.Mesh(
                        new THREE.ShapeGeometry(fzShape),
                        new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
                    );
                    fzMesh.position.z = 0.02;
                    this.forbiddenGroup.add(fzMesh);
                }
            });
        }

        // â”€â”€ 7. ENTRANCES (red lines) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (floorPlan.entrances && Array.isArray(floorPlan.entrances)) {
            const entranceMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
            floorPlan.entrances.forEach(ent => {
                if (ent.start && ent.end) {
                    const geom = new THREE.BufferGeometry().setFromPoints([
                        new THREE.Vector3(ent.start.x, ent.start.y, 0.04),
                        new THREE.Vector3(ent.end.x, ent.end.y, 0.04)
                    ]);
                    this.entrancesGroup.add(new THREE.Line(geom, entranceMat));
                }
            });
        }

        // (removed: blue waves not needed)
        // this._renderUnitDoorWaves(units);

        // â”€â”€ 8c. RED WAVE PERIMETERS on envelope/perimeter â”€â”€â”€â”€â”€â”€
        // this._renderRadiatorWavesFromEnvelope(floorPlan); // disabled: visual clutter

        // â”€â”€ 9. DIRECTED FLOW (entry -> exit) from routed circulation graph â”€â”€
        this.renderCorridors(corridors, floorPlan);

        // â”€â”€ FIT & RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (bounds) this.fitToBounds(bounds);

        console.log(`[COSTO Layout] Complete: ${units.length} boxes, ${corridors.length} corridors, ${radiators.length} radiators, ${circulationPaths.length} circulation`);
        this.render();
    }

    /**
     * _drawNavigationOverlay â€” fire-map style global navigation overlay.
     * Draws: ENTREE/SORTIE badges at doors, thick orange spine from entryâ†’exit,
     * large orange chevron arrows along the spine.
     */
    _drawNavigationOverlay(floorPlan, layoutData) {
        const old = this.scene.getObjectByName('navOverlay');
        if (old) {
            old.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
            this.scene.remove(old);
        }
        const grp = new THREE.Group();
        grp.name = 'navOverlay';
        this.scene.add(grp);

        const rawEntrances = (floorPlan && floorPlan.entrances) || [];
        const bounds = floorPlan && floorPlan.bounds;
        let circulationPaths = (layoutData && layoutData.circulationPaths) || [];
        if (!bounds) return;

        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        const getEntrancePos = (ent) => {
            if (ent.start && ent.end) return { x: (ent.start.x + ent.end.x) / 2, y: (ent.start.y + ent.end.y) / 2 };
            if (ent.x !== undefined) return { x: ent.x, y: ent.y };
            if (ent.polygon && ent.polygon.length) {
                const pts = ent.polygon;
                return {
                    x: pts.reduce((s, p) => s + (p.x || p[0] || 0), 0) / pts.length,
                    y: pts.reduce((s, p) => s + (p.y || p[1] || 0), 0) / pts.length
                };
            }
            return null;
        };

        // If no entrances were tagged in the DXF, synthesize default entry/exit points
        let entrances = [];
        if (rawEntrances.length === 0) {
            entrances = [
                { x: bounds.minX + (bounds.maxX - bounds.minX) * 0.1, y: bounds.minY, type: 'ENTRANCE' },
                { x: bounds.maxX - (bounds.maxX - bounds.minX) * 0.1, y: bounds.maxY, type: 'EXIT' }
            ];
        } else {
            entrances = rawEntrances;
        }

        // If no circulation paths were returned by router, fall back to drawing spine on all corridors
        if (circulationPaths.length === 0 && layoutData && layoutData.corridors) {
            circulationPaths = layoutData.corridors.filter(c => c.width > 0 && c.height > 0).map(c => {
                const isH = c.direction === 'horizontal' || c.width > c.height;
                const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
                return {
                    type: 'SPINE',
                    path: isH
                        ? [{ x: c.x, y: cy }, { x: c.x + c.width, y: cy }]
                        : [{ x: cx, y: c.y }, { x: cx, y: c.y + c.height }]
                };
            });
        }

        // Badge sprite creator
        const makeBadge = (text, bgColor, txtColor) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const fontSize = 28;
            ctx.font = `bold ${fontSize}px Arial`;
            const tw = ctx.measureText(text).width;
            const pad = 14;
            canvas.width = tw + pad * 2;
            canvas.height = fontSize + pad * 2;
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = txtColor;
            ctx.lineWidth = 3;
            ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.fillStyle = txtColor;
            ctx.textBaseline = 'top';
            ctx.fillText(text, pad, pad);
            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
            const sprite = new THREE.Sprite(mat);
            // Scale badge relative to plan span so it's visible but not overwhelming
            const planW = (bounds.maxX - bounds.minX) || 50;
            const planH = (bounds.maxY - bounds.minY) || 50;
            const planSpan = Math.max(planW, planH, 10);
            const badgeScale = Math.max(0.6, Math.min(2.5, planSpan * 0.02));
            sprite.scale.set(canvas.width / 10 * badgeScale * 0.3, canvas.height / 10 * badgeScale * 0.3, 1);
            return sprite;
        };

        // Pick exactly ONE entry and ONE exit (the two furthest-apart entrances)
        const entrancePositions = entrances.map(e => getEntrancePos(e)).filter(Boolean);
        let entryPos = null, exitPos = null;
        if (entrancePositions.length >= 2) {
            let bestDist = -1;
            for (let i = 0; i < entrancePositions.length; i++) {
                for (let j = i + 1; j < entrancePositions.length; j++) {
                    const d = Math.hypot(entrancePositions[i].x - entrancePositions[j].x, entrancePositions[i].y - entrancePositions[j].y);
                    if (d > bestDist) { bestDist = d; entryPos = entrancePositions[i]; exitPos = entrancePositions[j]; }
                }
            }
        } else if (entrancePositions.length === 1) {
            entryPos = entrancePositions[0];
            exitPos = { x: 2 * centerX - entryPos.x, y: 2 * centerY - entryPos.y };
        } else {
            entryPos = { x: bounds.minX, y: bounds.minY };
            exitPos = { x: bounds.maxX, y: bounds.maxY };
        }

        // No ENTREE/SORTIE badges â€” not needed on canvas view
        const planSpanNav = Math.max((bounds.maxX - bounds.minX), (bounds.maxY - bounds.minY), 10);

        // Green spine path + small green chevron arrows along circulation routes
        if (circulationPaths.length === 0) return;
        const spineMat = new THREE.LineBasicMaterial({ color: 0x2e7d32, linewidth: 2 });
        const spineArrowMat = new THREE.LineBasicMaterial({ color: 0x2e7d32, linewidth: 1.5 });
        const spineArrowSpacing = 4.0;
        const spineArrowSize = 0.4;

        circulationPaths.forEach(cp => {
            if (!Array.isArray(cp.path) || cp.path.length < 2) return;
            const pts = cp.path.map(pt => {
                const x = Number(pt.x), y = Number(pt.y);
                return (Number.isFinite(x) && Number.isFinite(y)) ? new THREE.Vector3(x, y, 0.25) : null;
            }).filter(Boolean);
            if (pts.length < 2) return;

            grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), spineMat));

            let accum = 0;
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i], b = pts[i + 1];
                const segLen = a.distanceTo(b);
                if (segLen < 0.01) continue;
                let t = (spineArrowSpacing - accum) / segLen;
                while (t <= 1.0) {
                    const ix = a.x + (b.x - a.x) * t;
                    const iy = a.y + (b.y - a.y) * t;
                    const angle = Math.atan2(b.y - a.y, b.x - a.x);
                    const rv = spineArrowSize;
                    const cosA = Math.cos(angle), sinA = Math.sin(angle);
                    const tip = new THREE.Vector3(ix + cosA * rv, iy + sinA * rv, 0.28);
                    const left = new THREE.Vector3(ix + cosA * (-rv * 0.4) - sinA * rv * 0.7,
                        iy + sinA * (-rv * 0.4) + cosA * rv * 0.7, 0.28);
                    const right = new THREE.Vector3(ix + cosA * (-rv * 0.4) + sinA * rv * 0.7,
                        iy + sinA * (-rv * 0.4) - cosA * rv * 0.7, 0.28);
                    grp.add(new THREE.Line(
                        new THREE.BufferGeometry().setFromPoints([left, tip, right]),
                        spineArrowMat
                    ));
                    t += spineArrowSpacing / segLen;
                }
                accum = (segLen - ((spineArrowSpacing - accum) % segLen)) % spineArrowSpacing;
            }
        });

        this.render();
    }

    /**
     * _drawCostoSheetOverlay - Draw the full-sheet professional overlay:
     * green double border, compass rose + legend, title block at bottom.
     * Matches "Expected output MUST.jpg" exactly.
     */
    _drawCostoSheetOverlay(bounds, units) {
        // Remove old overlay group if exists
        const old = this.scene.getObjectByName('sheetOverlay');
        if (old) { this.scene.remove(old); }
        const overlay = new THREE.Group();
        overlay.name = 'sheetOverlay';
        this.scene.add(overlay);

        const margin = 6.0;
        const minX = bounds.minX - margin;
        const maxX = bounds.maxX + margin + 14; // extra right space for floor 2 stub
        const minY = bounds.minY - margin - 7;  // extra bottom for title block
        const maxY = bounds.maxY + margin;
        const W = maxX - minX;

        // â”€â”€ Green double border â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const greenMat = new THREE.LineBasicMaterial({ color: 0x2e7d32 });
        const drawRect = (x1, y1, x2, y2, mat, grp) => {
            const pts = [
                new THREE.Vector3(x1, y1, 0.2), new THREE.Vector3(x2, y1, 0.2),
                new THREE.Vector3(x2, y2, 0.2), new THREE.Vector3(x1, y2, 0.2),
                new THREE.Vector3(x1, y1, 0.2)
            ];
            grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
        };
        drawRect(minX, minY, maxX, maxY, greenMat, overlay);
        drawRect(minX + 0.3, minY + 0.3, maxX - 0.3, maxY - 0.3, greenMat, overlay);

        // â”€â”€ Horizontal title bar separator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const barH = 5.0;
        const barTopY = minY + barH;
        overlay.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(minX, barTopY, 0.2),
                new THREE.Vector3(maxX, barTopY, 0.2)
            ]), greenMat
        ));

        // â”€â”€ Page number box (bottom-left) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const pageBoxW = 5;
        overlay.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(minX + pageBoxW, minY, 0.2),
                new THREE.Vector3(minX + pageBoxW, barTopY, 0.2)
            ]), greenMat
        ));
        const pageNum = this.createTextSprite('3', { fontSize: 32, fontColor: '#000000', backgroundColor: 'transparent' });
        pageNum.position.set(minX + pageBoxW / 2, minY + barH / 2, 0.25);
        pageNum.scale.set(1.5, 1.5, 1);
        overlay.add(pageNum);

        // â”€â”€ PLAN ETAGE 01 label (bottom bar, left) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const pe1 = this.createTextSprite('PLAN ETAGE 01  1-200', { fontSize: 22, fontColor: '#000000', backgroundColor: 'transparent' });
        pe1.position.set(minX + pageBoxW + 14, minY + barH / 2, 0.25);
        pe1.scale.set(2.2, 1.2, 1);
        overlay.add(pe1);

        // â”€â”€ "SURFACES DES BOX" center label â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const total_area = units.reduce((s, u) => s + (u.area || u.width * u.height || 0), 0);
        const surfLabel = this.createTextSprite('SURFACES DES BOX', { fontSize: 26, fontColor: '#000000', backgroundColor: 'transparent' });
        surfLabel.position.set((minX + maxX) / 2, minY + barH / 2, 0.25);
        surfLabel.scale.set(2.5, 1.4, 1);
        overlay.add(surfLabel);

        // â”€â”€ PLAN ETAGE 02 label (right-center of bar) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const rightSepX = maxX - 22;
        overlay.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(rightSepX, minY, 0.2),
                new THREE.Vector3(rightSepX, barTopY, 0.2)
            ]), greenMat
        ));
        const pe2 = this.createTextSprite('PLAN ETAGE 02  1-200', { fontSize: 20, fontColor: '#000000', backgroundColor: 'transparent' });
        pe2.position.set(rightSepX - 14, minY + barH / 2, 0.25);
        pe2.scale.set(2.0, 1.1, 1);
        overlay.add(pe2);

        // â”€â”€ Company info (bottom-right) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const coSepX = maxX - 18;
        overlay.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(coSepX, minY, 0.2),
                new THREE.Vector3(coSepX, barTopY, 0.2)
            ]), greenMat
        ));
        ['-COSTO-', '5 chemin de la dime 95700', 'Roissy FRANCE'].forEach((line, i) => {
            const lbl = this.createTextSprite(line, { fontSize: 13, fontColor: '#000000', backgroundColor: 'transparent' });
            lbl.position.set(coSepX + (maxX - coSepX) / 2, barTopY - 1.2 - i * 1.4, 0.25);
            lbl.scale.set(1.2, 0.8, 1);
            overlay.add(lbl);
        });

        // â”€â”€ PLAN ETAGE 02 title at top-right â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const pe2Top = this.createTextSprite('PLAN ETAGE 02  1-200', { fontSize: 22, fontColor: '#000000', backgroundColor: 'transparent' });
        pe2Top.position.set(bounds.maxX + 8, maxY - 2.5, 0.25);
        pe2Top.scale.set(2.2, 1.2, 1);
        overlay.add(pe2Top);

        // â”€â”€ SP Area label â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const spLabel = this.createTextSprite(`SP : ${total_area.toFixed(2)}mÂ²`, { fontSize: 18, fontColor: '#1565c0', backgroundColor: 'transparent' });
        spLabel.position.set(bounds.maxX + 8, maxY - 20, 0.25);
        spLabel.scale.set(1.8, 1.0, 1);
        overlay.add(spLabel);

        // â”€â”€ Legend (top-left of plan) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const legX = bounds.minX + 2, legY = maxY - 3;
        // Compass rose (simplified N arrow)
        const compMat = new THREE.LineBasicMaterial({ color: 0x000000 });
        const compR = 1.5;
        // N arrow
        overlay.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(legX, legY - compR * 2, 0.2), new THREE.Vector3(legX, legY, 0.2)]),
            compMat
        ));
        const northLabel = this.createTextSprite('N', { fontSize: 16, fontColor: '#000000', backgroundColor: 'transparent' });
        northLabel.position.set(legX, legY + 0.5, 0.25);
        northLabel.scale.set(0.9, 0.9, 1);
        overlay.add(northLabel);

        const entryLegY = legY - compR * 2 - 1.5;
        // Tole Blanche
        const tbMat = new THREE.LineBasicMaterial({ color: 0x4b5563 });
        overlay.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(legX, entryLegY, 0.2), new THREE.Vector3(legX + 3, entryLegY, 0.2)]),
            tbMat
        ));
        const tb = this.createTextSprite('Tole Blanche', { fontSize: 13, fontColor: '#374151', backgroundColor: 'transparent' });
        tb.position.set(legX + 5, entryLegY, 0.25); tb.scale.set(1.1, 0.7, 1); overlay.add(tb);

        // Tole Grise / ligne circulation
        const tgMat = new THREE.LineBasicMaterial({ color: 0x2563eb });
        overlay.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(legX, entryLegY - 1.4, 0.2), new THREE.Vector3(legX + 3, entryLegY - 1.4, 0.2)]),
            tgMat
        ));
        const tg = this.createTextSprite('Tole Grise / ligne circulation', { fontSize: 13, fontColor: '#374151', backgroundColor: 'transparent' });
        tg.position.set(legX + 7, entryLegY - 1.4, 0.25); tg.scale.set(1.8, 0.7, 1); overlay.add(tg);

        // Radiateur (red scallop sample)
        const radMat = new THREE.LineBasicMaterial({ color: 0xd90014 });
        const scallPts = [];
        for (let i = 0; i <= 12; i++) {
            const t = (i / 12) * Math.PI;
            scallPts.push(new THREE.Vector3(legX + i * 0.25, entryLegY - 2.8 + Math.sin(t) * 0.25, 0.2));
        }
        overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(scallPts), radMat));
        const radLbl = this.createTextSprite('Radiateur', { fontSize: 13, fontColor: '#374151', backgroundColor: 'transparent' });
        radLbl.position.set(legX + 5, entryLegY - 2.8, 0.25); radLbl.scale.set(1.0, 0.7, 1); overlay.add(radLbl);
    }

    /**
     * @deprecated renderCorridors() now draws light-blue dashed circulation + arrows
     */
    renderCirculationLines(corridors) {
        return; // DISABLED: no circulation line clutter
        this.renderCorridors(corridors);
    }

    /**
     * COSTO-style perimeter circulation: clean dashed outlines around row clusters
     * NO ZIGZAG â€” matches reference style with clean lines
     */
    renderPerimeterCirculation(ilots, bounds) {
        if (!ilots || ilots.length === 0) return;

        // Clear existing
        while (this.perimeterGroup.children.length > 0) {
            const child = this.perimeterGroup.children[0];
            this.perimeterGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        // Blue dashed line material (NO zigzag)
        const corridorMaterial = new THREE.LineDashedMaterial({
            color: 0x4488cc,
            linewidth: 1,
            dashSize: 0.3,
            gapSize: 0.15
        });

        // Cyan arrow material
        const arrowMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ccff,
            side: THREE.DoubleSide
        });

        // Group ilots by Y position
        const rowTolerance = 0.5;
        const rows = [];

        ilots.forEach(ilot => {
            const centerY = ilot.y + (ilot.height || 1) / 2;
            let foundRow = rows.find(r => Math.abs(r.centerY - centerY) < rowTolerance);
            if (foundRow) {
                foundRow.ilots.push(ilot);
                foundRow.minX = Math.min(foundRow.minX, ilot.x);
                foundRow.maxX = Math.max(foundRow.maxX, ilot.x + (ilot.width || 1));
                foundRow.minY = Math.min(foundRow.minY, ilot.y);
                foundRow.maxY = Math.max(foundRow.maxY, ilot.y + (ilot.height || 1));
            } else {
                rows.push({
                    centerY,
                    ilots: [ilot],
                    minX: ilot.x,
                    maxX: ilot.x + (ilot.width || 1),
                    minY: ilot.y,
                    maxY: ilot.y + (ilot.height || 1)
                });
            }
        });

        rows.sort((a, b) => a.minY - b.minY);

        // Draw clean dashed outlines (NO zigzag)
        const margin = 0.3;
        rows.forEach((row, idx) => {
            const x1 = row.minX - margin;
            const x2 = row.maxX + margin;
            const y1 = row.minY - margin;
            const y2 = row.maxY + margin;

            // Clean dashed rectangle outline
            const outlinePoints = [
                new THREE.Vector3(x1, y1, 0.15),
                new THREE.Vector3(x2, y1, 0.15),
                new THREE.Vector3(x2, y2, 0.15),
                new THREE.Vector3(x1, y2, 0.15),
                new THREE.Vector3(x1, y1, 0.15)
            ];
            const outlineGeom = new THREE.BufferGeometry().setFromPoints(outlinePoints);
            const outlineLine = new THREE.Line(outlineGeom, corridorMaterial);
            outlineLine.computeLineDistances();
            this.perimeterGroup.add(outlineLine);

            // Add flow arrow in middle of row
            if (row.ilots.length > 2) {
                const arrowSize = 0.4;
                const arrowShape = new THREE.Shape();
                arrowShape.moveTo(-arrowSize / 2, -arrowSize / 3);
                arrowShape.lineTo(arrowSize / 2, 0);
                arrowShape.lineTo(-arrowSize / 2, arrowSize / 3);
                arrowShape.closePath();

                const arrowMesh = new THREE.Mesh(
                    new THREE.ShapeGeometry(arrowShape),
                    arrowMaterial
                );
                arrowMesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0.2);
                this.perimeterGroup.add(arrowMesh);
            }
        });

        console.log(`[COSTO] Rendered perimeter for ${rows.length} row clusters (${ilots.length} ilots)`);
        this.render();
    }

    /**
     * Render exclusion (gray) zones around obstacles
     * These are buffer areas where ilots cannot be placed
     */
    renderExclusionZones(exclusionZones) {
        // Create a group for exclusion zones if not exists
        if (!this.exclusionZonesGroup) {
            this.exclusionZonesGroup = new THREE.Group();
            this.exclusionZonesGroup.name = 'exclusionZones';
            this.scene.add(this.exclusionZonesGroup);
        }

        // Clear existing exclusion zones
        while (this.exclusionZonesGroup.children.length > 0) {
            const child = this.exclusionZonesGroup.children[0];
            this.exclusionZonesGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        if (!exclusionZones || exclusionZones.length === 0) {
            console.log('[Renderer] No exclusion zones to render');
            return;
        }

        // Gray semi-transparent material for exclusion zones
        const exclusionMaterial = new THREE.MeshBasicMaterial({
            color: 0x9CA3AF, // Gray-400
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });

        // Gray outline material
        const outlineMaterial = new THREE.LineBasicMaterial({
            color: 0x6B7280, // Gray-500
            linewidth: 2
        });

        exclusionZones.forEach(zone => {
            // Create rectangle shape
            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.lineTo(zone.width, 0);
            shape.lineTo(zone.width, zone.height);
            shape.lineTo(0, zone.height);
            shape.lineTo(0, 0);

            const geometry = new THREE.ShapeGeometry(shape);
            const mesh = new THREE.Mesh(geometry, exclusionMaterial.clone());
            mesh.position.set(zone.x, zone.y, 0.02); // Slightly above ground
            mesh.userData = { zone, type: 'exclusionZone' };
            this.exclusionZonesGroup.add(mesh);

            // Add outline
            const outlinePoints = [
                new THREE.Vector3(zone.x, zone.y, 0.03),
                new THREE.Vector3(zone.x + zone.width, zone.y, 0.03),
                new THREE.Vector3(zone.x + zone.width, zone.y + zone.height, 0.03),
                new THREE.Vector3(zone.x, zone.y + zone.height, 0.03),
                new THREE.Vector3(zone.x, zone.y, 0.03)
            ];
            const outlineGeom = new THREE.BufferGeometry().setFromPoints(outlinePoints);
            const outline = new THREE.Line(outlineGeom, outlineMaterial);
            this.exclusionZonesGroup.add(outline);

            // Add zone type label
            if (zone.zoneType && this.createTextSprite) {
                const labelText = zone.zoneType.charAt(0).toUpperCase() + zone.zoneType.slice(1);
                const label = this.createTextSprite(labelText, {
                    fontsize: 12,
                    fillStyle: '#374151', // Gray-700
                    backgroundColor: 'rgba(243, 244, 246, 0.9)'
                });
                label.position.set(zone.x + zone.width / 2, zone.y + zone.height / 2, 0.05);
                label.scale.set(0.3, 0.15, 1);
                this.exclusionZonesGroup.add(label);
            }
        });

        console.log(`[Renderer] Rendered ${exclusionZones.length} exclusion zones`);
        this.render();
    }

    clearCorridorArrows() {
        this.arrowMeshes.forEach(mesh => {
            this.corridorArrowsGroup.remove(mesh);
            if (mesh.geometry) {
                mesh.geometry.dispose();
            }
        });
        this.arrowMeshes = [];
    }

    renderCorridorArrows(arrows = []) {
        this.clearCorridorArrows();

        if (!Array.isArray(arrows) || arrows.length === 0) {
            this.stopArrowAnimation();
            this.render();
            return;
        }

        arrows.forEach(arrow => {
            const mesh = this._createCorridorArrowMesh(arrow);
            if (mesh) {
                this.corridorArrowsGroup.add(mesh);
                this.arrowMeshes.push(mesh);
            }
        });

        this.corridorArrowsGroup.visible = this.corridorArrowsVisible;

        if (this.arrowMeshes.length > 0) {
            this.startArrowAnimation();
        } else {
            this.stopArrowAnimation();
            this.render();
        }
    }

    _createCorridorArrowMesh(arrow) {
        try {
            const sizeKey = typeof arrow.size === 'string' ? arrow.size.toLowerCase() : 'medium';
            const sizeConfig = {
                small: { radius: 0.12, height: 0.5 },
                medium: { radius: 0.18, height: 0.75 },
                large: { radius: 0.28, height: 1.1 }
            }[sizeKey] || { radius: 0.18, height: 0.75 };

            const geometry = new THREE.ConeGeometry(sizeConfig.radius, sizeConfig.height, 16);
            const material = this.arrowMaterials[arrow.color] || this.arrowMaterials.green;
            const mesh = new THREE.Mesh(geometry, material);

            const posX = Number.isFinite(arrow.x) ? Number(arrow.x) : 0;
            const posY = Number.isFinite(arrow.y) ? Number(arrow.y) : 0;
            const posZ = Number.isFinite(arrow.z) ? Number(arrow.z) : 0.6;

            mesh.position.set(posX, posY, posZ);

            const direction = typeof arrow.direction === 'string' ? arrow.direction.toLowerCase() : 'right';
            if (typeof arrow.angle === 'number' && Number.isFinite(arrow.angle)) {
                mesh.rotation.z = arrow.angle;
            } else {
                switch (direction) {
                    case 'left':
                        mesh.rotation.z = Math.PI / 2;
                        break;
                    case 'right':
                        mesh.rotation.z = -Math.PI / 2;
                        break;
                    case 'down':
                        mesh.rotation.z = Math.PI;
                        break;
                    default:
                        mesh.rotation.z = 0;
                        break;
                }
            }

            mesh.userData = {
                arrow,
                baseHeight: mesh.position.z
            };

            return mesh;
        } catch (error) {
            console.error('Failed to create corridor arrow mesh:', error);
            return null;
        }
    }

    animateCorridorArrows(deltaTime) {
        if (!this.arrowMeshes.length) return;

        this.arrowPulseTime += deltaTime;

        this.arrowMeshes.forEach((mesh, index) => {
            const phase = this.arrowPulseTime * 2 + index * 0.35;
            const scale = 0.9 + 0.15 * Math.sin(phase);
            mesh.scale.set(scale, scale, scale);

            const arrowData = mesh.userData?.arrow;
            if (arrowData && arrowData.type === 'entrance_flow') {
                const base = mesh.userData.baseHeight || mesh.position.z;
                mesh.position.z = base + 0.1 * Math.sin(this.arrowPulseTime * 3 + index * 0.4);
            }
        });
    }

    startArrowAnimation() {
        if (this.arrowAnimationActive) return;
        this.arrowAnimationActive = true;
        this.arrowClock.start();

        const tick = () => {
            if (!this.arrowAnimationActive) return;
            const delta = this.arrowClock.getDelta();
            this.animateCorridorArrows(delta);
            this.render();
            this.arrowAnimationFrame = window.requestAnimationFrame(tick);
        };

        this.arrowAnimationFrame = window.requestAnimationFrame(tick);
    }

    stopArrowAnimation() {
        if (!this.arrowAnimationActive) return;
        this.arrowAnimationActive = false;
        if (this.arrowAnimationFrame !== null) {
            window.cancelAnimationFrame(this.arrowAnimationFrame);
            this.arrowAnimationFrame = null;
        }
        this.arrowClock.stop();
    }

    setCorridorArrowsVisible(visible) {
        this.corridorArrowsVisible = Boolean(visible);
        this.corridorArrowsGroup.visible = this.corridorArrowsVisible;
        if (this.corridorArrowsVisible && this.arrowMeshes.length) {
            this.startArrowAnimation();
        } else {
            this.stopArrowAnimation();
        }
        this.render();
    }

    fitToBounds(bounds) {
        if (!bounds || typeof bounds.minX !== 'number') {
            console.warn('Invalid bounds:', bounds);
            return;
        }

        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;

        if (width <= 0 || height <= 0) {
            console.warn('Invalid bounds dimensions:', { width, height });
            return;
        }

        const aspect = this.container.clientWidth / this.container.clientHeight;
        // Tight fit with small padding for proper alignment on load
        const frustumSize = Math.max(width / aspect, height) * 1.12;

        this.camera.left = frustumSize * aspect / -2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = frustumSize / -2;
        this.camera.updateProjectionMatrix();

        this.controls.target.set(centerX, centerY, 0);
        this.camera.position.set(centerX, centerY, 100);
        this.controls.update();

        console.log('Fitted to bounds:', { centerX, centerY, width, height, frustumSize });
        this.render();
    }

    resetView() {
        this.controls.reset();
        this.render();
    }

    render() {
        if (!this.renderer) {
            console.warn('Renderer not initialized, cannot render');
            return;
        }

        if (!this.container || this.container.clientWidth === 0 || this.container.clientHeight === 0) {
            // Don't warn on every render - only log once
            if (!this._sizeWarningLogged) {
                console.warn('Container has zero size, skipping render', {
                    width: this.container?.clientWidth,
                    height: this.container?.clientHeight
                });
                this._sizeWarningLogged = true;
            }
            return;
        }

        this._sizeWarningLogged = false; // Reset warning flag when size is valid

        try {
            if (this.rendererType !== 'webgl') {
                this.renderer.render(this.scene, this.camera);
                return;
            }
            if (this.is3DMode) {
                this.renderer.render(this.scene, this.perspectiveCamera);
            } else {
                if (this.composer) {
                    this.composer.render();
                } else {
                    this.renderer.render(this.scene, this.camera);
                }
            }
        } catch (error) {
            console.error('Render error:', error);
            // Don't spam errors - log once per error type
            if (!this._lastRenderError || this._lastRenderError !== error.message) {
                this._lastRenderError = error.message;
            }
        }
    }

    toggleLayer(layerName, visible) {
        const groups = { walls: this.wallsGroup, entrances: this.entrancesGroup, forbidden: this.forbiddenGroup, ilots: this.ilotsGroup, corridors: this.corridorsGroup, arrows: this.corridorArrowsGroup };
        if (groups[layerName]) {
            groups[layerName].visible = visible;
            if (layerName === 'arrows') {
                this.corridorArrowsVisible = Boolean(visible);
            }
            this.render();
        }
    }

    selectIlot(ilotId) {
        const mesh = this.ilotMeshes[ilotId];
        if (mesh) this.selectIlotMesh(mesh);
    }

    selectIlotMesh(mesh) {
        this.selectedIlots = [mesh];
        this.outlinePass.selectedObjects = this.selectedIlots;

        this.ilotMeshes.forEach(m => {
            if (m === mesh) {
                // Highlight selected box with light blue fill
                m.material.color.set(0xd0e8ff);
                m.material.opacity = 0.6;
            } else {
                // Restore original fill
                const origColor = m.userData._origColor;
                const origOpacity = m.userData._origOpacity;
                if (origColor !== undefined) {
                    m.material.color.set(origColor);
                    m.material.opacity = origOpacity;
                } else {
                    m.material.color.set(0xffffff);
                    m.material.opacity = 0;
                }
            }
        });

        if (mesh.userData.ilot) {
            console.log('Selected ilot:', mesh.userData.ilot);
            this.dispatchEvent({ type: 'ilotSelected', ilot: mesh.userData.ilot, index: mesh.userData.index });
        }

        this.render();
    }

    clearSelection() {
        this.selectedIlots = [];
        this.outlinePass.selectedObjects = [];
        this.ilotMeshes.forEach(m => {
            // Restore original fill color and opacity from userData
            const origColor = m.userData._origColor;
            const origOpacity = m.userData._origOpacity;
            if (origColor !== undefined) {
                m.material.color.set(origColor);
                m.material.opacity = origOpacity;
            } else {
                // Legacy fallback: transparent raycasting mesh
                m.material.color.set(0xffffff);
                m.material.opacity = 0;
            }
        });
        this.render();
    }

    toggle3DMode() {
        if (this.rendererType !== 'webgl') {
            this.is3DMode = false;
            return false;
        }

        // Toggle grid visibility based on mode
        if (this.defaultGrid) {
            this.defaultGrid.visible = !this.is3DMode;
        }
        if (this.gridHelper) {
            this.gridHelper.visible = this.is3DMode;
        }
        if (this.groundPlane) {
            this.groundPlane.visible = this.is3DMode;
        }
        this.is3DMode = !this.is3DMode;

        if (this.is3DMode) {
            this.renderPass.camera = this.perspectiveCamera;
            this.outlinePass.renderCamera = this.perspectiveCamera;
            this.controls.enabled = false;
            this.perspectiveControls.enabled = true;

            // Show ground grid and shadow plane in 3D
            if (this.gridHelper) this.gridHelper.visible = true;
            if (this.groundPlane) this.groundPlane.visible = true;

            // Reduce fog visibility in 3D
            if (this.scene.fog) this.scene.fog.far = 300;
        } else {
            this.renderPass.camera = this.camera;
            this.outlinePass.renderCamera = this.camera;
            this.controls.enabled = true;
            this.perspectiveControls.enabled = false;

            // Hide ground elements in 2D
            if (this.gridHelper) this.gridHelper.visible = false;
            if (this.groundPlane) this.groundPlane.visible = false;

            // Disable fog in 2D
            if (this.scene.fog) this.scene.fog.far = 1000;
        }

        const currentIlots = this.ilotMeshes.map(m => m.userData.ilot).filter(Boolean);
        if (currentIlots.length > 0) {
            this.renderIlots(currentIlots);
        }
        if (this.currentConnectors && this.currentConnectors.length > 0) {
            this.renderConnectors(this.currentConnectors, this.currentConnectorOptions || {});
        }
        if (this.stackGroup.visible && this.currentStackFloors) {
            this.renderStackedFloors(this.currentStackFloors, this.currentStackOptions || {});
        }
        if (this.currentCrossFloorRoutes && this.currentCrossFloorRoutes.length > 0) {
            this.renderCrossFloorRoutes(this.currentCrossFloorRoutes, this.crossFloorOptions || {});
        }

        this.render();
        return this.is3DMode;
    }

    enableMeasurementMode(enabled, type = 'distance') {
        this.measurementMode = enabled;
        this.measurementType = type;
        if (!enabled) {
            this.measurementPoints = [];
        }
        this.renderer.domElement.style.cursor = enabled ? 'crosshair' : 'default';
    }

    setMeasurementType(type) {
        this.measurementType = type;
        this.measurementPoints = []; // Reset points when changing type
    }

    addMeasurementPoint(mousePos, camera) {
        this.raycaster.setFromCamera(mousePos, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const intersection = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(plane, intersection);

        this.measurementPoints.push(intersection.clone());

        if (this.measurementType === 'distance' && this.measurementPoints.length === 2) {
            const distance = this.measurementPoints[0].distanceTo(this.measurementPoints[1]);
            this.drawDistanceMeasurement(this.measurementPoints[0], this.measurementPoints[1], distance);
            this.measurementPoints = [];
        } else if (this.measurementType === 'area' && this.measurementPoints.length >= 3) {
            // Check if clicked near first point to close polygon
            if (this.measurementPoints.length > 3 && intersection.distanceTo(this.measurementPoints[0]) < 1) {
                const area = this.calculatePolygonArea(this.measurementPoints.slice(0, -1));
                this.drawAreaMeasurement(this.measurementPoints.slice(0, -1), area);
                this.measurementPoints = [];
            }
        } else if (this.measurementType === 'angle' && this.measurementPoints.length === 3) {
            const angle = this.calculateAngle(this.measurementPoints[0], this.measurementPoints[1], this.measurementPoints[2]);
            this.drawAngleMeasurement(this.measurementPoints[0], this.measurementPoints[1], this.measurementPoints[2], angle);
            this.measurementPoints = [];
        }
    }

    drawDistanceMeasurement(start, end, distance) {
        // Draw line
        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 }));
        this.measurementsGroup.add(line);

        // Draw dimension arrows
        this.drawDimensionArrows(start, end);

        // Draw label
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = 'black';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${distance.toFixed(2)}m`, 128, 40);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.copy(midpoint);
        sprite.scale.set(10, 2.5, 1);
        this.measurementsGroup.add(sprite);

        this.render();
    }

    drawAreaMeasurement(points, area) {
        // Draw polygon outline
        const linePoints = [...points, points[0]];
        const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 }));
        this.measurementsGroup.add(line);

        // Fill polygon
        const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, p.y)));
        const fillGeometry = new THREE.ShapeGeometry(shape);
        const fillMesh = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.2 }));
        this.measurementsGroup.add(fillMesh);

        // Draw label at centroid
        const centroid = this.calculateCentroid(points);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = 'black';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${area.toFixed(2)}mÂ²`, 128, 40);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(centroid.x, centroid.y, 0);
        sprite.scale.set(10, 2.5, 1);
        this.measurementsGroup.add(sprite);

        this.render();
    }

    drawAngleMeasurement(p1, vertex, p2, angle) {
        // Draw lines from vertex to points
        const line1Geometry = new THREE.BufferGeometry().setFromPoints([vertex, p1]);
        const line2Geometry = new THREE.BufferGeometry().setFromPoints([vertex, p2]);
        const line1 = new THREE.Line(line1Geometry, new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 2 }));
        const line2 = new THREE.Line(line2Geometry, new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 2 }));
        this.measurementsGroup.add(line1);
        this.measurementsGroup.add(line2);

        // Draw arc
        const arcPoints = this.generateArcPoints(vertex, p1, p2, angle);
        const arcGeometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
        const arc = new THREE.Line(arcGeometry, new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 2 }));
        this.measurementsGroup.add(arc);

        // Draw label
        const labelPos = this.calculateArcMidpoint(vertex, p1, p2);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = 'black';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${angle.toFixed(1)}Â°`, 128, 40);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.copy(labelPos);
        sprite.scale.set(8, 2, 1);
        this.measurementsGroup.add(sprite);

        this.render();
    }

    drawDimensionArrows(start, end) {
        const direction = new THREE.Vector3().subVectors(end, start).normalize();
        const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0).multiplyScalar(0.5);

        // Arrow at start
        const arrowStart1 = new THREE.Vector3().addVectors(start, perpendicular);
        const arrowStart2 = new THREE.Vector3().subVectors(start, perpendicular);
        const arrowStartGeometry = new THREE.BufferGeometry().setFromPoints([start, arrowStart1, arrowStart2, start]);
        const arrowStart = new THREE.Line(arrowStartGeometry, new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 }));
        this.measurementsGroup.add(arrowStart);

        // Arrow at end
        const arrowEnd1 = new THREE.Vector3().addVectors(end, perpendicular);
        const arrowEnd2 = new THREE.Vector3().subVectors(end, perpendicular);
        const arrowEndGeometry = new THREE.BufferGeometry().setFromPoints([end, arrowEnd1, arrowEnd2, end]);
        const arrowEnd = new THREE.Line(arrowEndGeometry, new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 }));
        this.measurementsGroup.add(arrowEnd);
    }

    calculatePolygonArea(points) {
        if (points.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return Math.abs(area / 2);
    }

    calculateCentroid(points) {
        let sumX = 0, sumY = 0;
        points.forEach(p => {
            sumX += p.x;
            sumY += p.y;
        });
        return { x: sumX / points.length, y: sumY / points.length };
    }

    calculateAngle(p1, vertex, p2) {
        const v1 = new THREE.Vector3().subVectors(p1, vertex);
        const v2 = new THREE.Vector3().subVectors(p2, vertex);
        const dot = v1.dot(v2);
        const mag1 = v1.length();
        const mag2 = v2.length();
        const cosAngle = dot / (mag1 * mag2);
        return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
    }

    generateArcPoints(vertex, p1, p2, angle) {
        const points = [];
        const radius = Math.min(vertex.distanceTo(p1), vertex.distanceTo(p2)) * 0.3;
        const startAngle = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
        const endAngle = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);
        const arcAngle = endAngle - startAngle;
        const numPoints = Math.max(10, Math.floor(Math.abs(arcAngle) / (Math.PI / 18))); // 10Â° segments

        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            const currentAngle = startAngle + arcAngle * t;
            points.push(new THREE.Vector3(
                vertex.x + radius * Math.cos(currentAngle),
                vertex.y + radius * Math.sin(currentAngle),
                0
            ));
        }
        return points;
    }

    calculateArcMidpoint(vertex, p1, p2) {
        const radius = Math.min(vertex.distanceTo(p1), vertex.distanceTo(p2)) * 0.3;
        const startAngle = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
        const endAngle = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);
        const midAngle = (startAngle + endAngle) / 2;
        return new THREE.Vector3(
            vertex.x + radius * Math.cos(midAngle),
            vertex.y + radius * Math.sin(midAngle),
            0
        );
    }

    clearMeasurements() {
        this.measurementsGroup.clear();
        this.render();
    }

    dispatchEvent(event) {
        if (this.eventListeners && this.eventListeners[event.type]) {
            this.eventListeners[event.type].forEach(callback => callback(event));
        }
    }

    addEventListener(type, callback) {
        if (!this.eventListeners) this.eventListeners = {};
        if (!this.eventListeners[type]) this.eventListeners[type] = [];
        this.eventListeners[type].push(callback);
    }

    exportImage(width = 2048, height = 2048) {
        const originalSize = { w: this.renderer.domElement.width, h: this.renderer.domElement.height };
        this.renderer.setSize(width, height);
        this.composer.setSize(width, height);
        this.render();
        const dataURL = this.renderer.domElement.toDataURL('image/png');
        this.renderer.setSize(originalSize.w, originalSize.h);
        this.composer.setSize(originalSize.w, originalSize.h);
        this.render();
        return dataURL;
    }

    async exportGLTF() {
        return new Promise((resolve, reject) => {
            const exporter = new GLTFExporter();
            const options = {
                binary: false,
                embedImages: true,
                truncateDrawRange: false
            };

            exporter.parse(
                this.scene,
                (result) => {
                    const output = JSON.stringify(result, null, 2);
                    resolve(output);
                },
                (error) => reject(error),
                options
            );
        });
    }

    downloadGLTF(filename = 'floorplan.gltf') {
        this.exportGLTF().then(gltf => {
            const blob = new Blob([gltf], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
        }).catch(err => console.error('GLTF export failed:', err));
    }

    renderConnectors(connectors = [], options = {}) {
        this.connectorsGroup.clear();
        this.connectorHighlights.clear();
        this.currentConnectors = Array.isArray(connectors) ? connectors.slice() : [];
        this.currentConnectorOptions = Object.assign({}, options);

        if (!Array.isArray(connectors) || connectors.length === 0) {
            this.render();
            return;
        }

        const colorMap = {
            stair: 0xf97316,
            escalator: 0xfacc15,
            elevator: 0x0ea5e9,
            shaft: 0xa855f7,
            default: 0x22c55e
        };

        const baseElevation = this.is3DMode ? (options.levelElevation || 0) : 0.05;
        const thickness = this.is3DMode ? (options.thickness || 2.5) : 0.01;

        connectors.forEach((connector) => {
            const color = colorMap[connector.type] || colorMap.default;
            const mesh = this._createConnectorMesh(connector, color, thickness);
            if (!mesh) return;

            const zOffset = this.is3DMode
                ? baseElevation + (connector.floorLevel || 0) * thickness
                : baseElevation;

            mesh.position.z = zOffset;
            mesh.userData.connector = connector;
            mesh.renderOrder = 15;
            this.connectorsGroup.add(mesh);
        });

        this.render();
    }

    _createConnectorMesh(connector, color, thickness) {
        const geometry = this._createConnectorGeometry(connector, thickness);
        if (!geometry) return null;

        const material = this.is3DMode
            ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.82 })
            : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, depthWrite: false });

        return new THREE.Mesh(geometry, material);
    }

    _createConnectorGeometry(connector, thickness) {
        const polygon = this._connectorPolygon(connector);
        if (polygon && polygon.length >= 3) {
            const shape = new THREE.Shape(polygon.map(pt => new THREE.Vector2(pt.x, pt.y)));
            if (this.is3DMode) {
                return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
            }
            return new THREE.ShapeGeometry(shape);
        }

        const bbox = connector.boundingBox;
        if (bbox && typeof bbox.minX === 'number' && typeof bbox.minY === 'number' &&
            typeof bbox.maxX === 'number' && typeof bbox.maxY === 'number') {
            const shape = new THREE.Shape([
                new THREE.Vector2(bbox.minX, bbox.minY),
                new THREE.Vector2(bbox.maxX, bbox.minY),
                new THREE.Vector2(bbox.maxX, bbox.maxY),
                new THREE.Vector2(bbox.minX, bbox.maxY)
            ]);
            if (this.is3DMode) {
                return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
            }
            return new THREE.ShapeGeometry(shape);
        }

        const radius = connector.metadata?.radius || connector.metadata?.approxRadius || 1;
        if (this.is3DMode) {
            const cylinder = new THREE.CylinderGeometry(radius, radius, thickness, 24, 1, true);
            cylinder.rotateX(Math.PI / 2);
            return cylinder;
        }
        return new THREE.CircleGeometry(radius, 24);
    }

    _connectorPolygon(connector) {
        if (!connector) return null;
        const polygon = connector.polygon || connector.points;
        if (!Array.isArray(polygon) || polygon.length === 0) return null;
        return polygon.map(pt => {
            const x = typeof pt.x === 'number' ? pt.x : pt[0];
            const y = typeof pt.y === 'number' ? pt.y : pt[1];
            return { x, y };
        });
    }

    renderStackedFloors(floors = [], options = {}) {
        this.stackGroup.clear();

        if (!Array.isArray(floors) || floors.length === 0) {
            this.stackGroup.visible = false;
            this.currentStackFloors = null;
            this.currentStackOptions = {};
            this.render();
            return;
        }

        this.stackGroup.visible = true;
        const activeFloorId = options.activeFloorId;
        const levelHeight = typeof options.levelHeight === 'number'
            ? options.levelHeight
            : (typeof options.floorHeight === 'number' ? options.floorHeight : 3.2);
        const spacing2D = typeof options.spacing2D === 'number' ? options.spacing2D : 0.05;
        const passiveColor = options.passiveColor || 0x9ca3af;
        const activeColor = options.activeColor || 0x2563eb;

        const sortedFloors = floors.slice().sort((a, b) => {
            const levelA = a.level ?? 0;
            const levelB = b.level ?? 0;
            return levelA - levelB;
        });

        sortedFloors.forEach((floor, index) => {
            const highlight = activeFloorId ? floor.id === activeFloorId : index === sortedFloors.length - 1;
            const color = highlight ? activeColor : passiveColor;
            const floorGroup = new THREE.Group();

            if (this.is3DMode) {
                const zBase = typeof floor.translation?.z === 'number'
                    ? floor.translation.z
                    : (typeof floor.z === 'number' ? floor.z : (floor.level ?? index) * levelHeight);
                floorGroup.position.z = zBase;
            } else {
                floorGroup.position.z = (floor.level ?? index) * spacing2D;
            }

            if (typeof floor.translation?.x === 'number') floorGroup.position.x = floor.translation.x;
            if (typeof floor.translation?.y === 'number') floorGroup.position.y = floor.translation.y;

            this._drawStackFloor(floorGroup, floor.floorPlan, {
                color,
                highlight,
                entranceColor: options.entranceColor,
                forbiddenColor: options.forbiddenColor
            });

            this.stackGroup.add(floorGroup);
        });

        this.currentStackFloors = floors;
        this.currentStackOptions = Object.assign({}, options, {
            levelHeight,
            spacing2D
        });

        this.render();
    }

    clearStackedFloors() {
        this.stackGroup.clear();
        this.stackGroup.visible = false;
        this.currentStackFloors = null;
        this.currentStackOptions = {};
        this.render();
    }

    renderCrossFloorRoutes(routes = [], options = {}) {
        this.crossFloorPathsGroup.clear();
        this.currentCrossFloorRoutes = Array.isArray(routes) ? routes.slice() : [];
        this.crossFloorOptions = Object.assign({}, options);

        if (!Array.isArray(routes) || routes.length === 0) {
            this.render();
            return;
        }

        const horizontalColor = options.horizontalColor || 0xfacc15;
        const verticalColor = options.verticalColor || 0x22d3ee;

        routes.forEach((segment) => {
            if (!segment || !segment.start || !segment.end) return;

            const startPoint = new THREE.Vector3(
                Number(segment.start.x) || 0,
                Number(segment.start.y) || 0,
                Number(segment.start.z) || 0
            );
            const endPoint = new THREE.Vector3(
                Number(segment.end.x) || 0,
                Number(segment.end.y) || 0,
                Number(segment.end.z) || 0
            );

            if (!this.is3DMode) {
                const baseZ = segment.type === 'vertical' ? 0.9 : 0.7;
                startPoint.z = baseZ;
                endPoint.z = baseZ;
            }

            const geometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]);
            const color = segment.type === 'vertical' ? verticalColor : horizontalColor;
            const material = new THREE.LineBasicMaterial({
                color,
                linewidth: segment.type === 'vertical' ? 3 : 2,
                transparent: true,
                opacity: segment.type === 'vertical' ? 0.95 : 0.75,
                depthTest: false
            });

            const line = new THREE.Line(geometry, material);
            line.renderOrder = 7;
            this.crossFloorPathsGroup.add(line);
        });

        this.render();
    }

    clearCrossFloorRoutes() {
        this.crossFloorPathsGroup.clear();
        this.currentCrossFloorRoutes = [];
        this.crossFloorOptions = {};
        this.render();
    }

    _drawStackFloor(group, floorPlan, options = {}) {
        if (!group || !floorPlan) return;

        // Match reference style: black walls, red entrances, blue forbidden zones
        const wallColor = options.color || 0x000000; // Black walls like reference "TÃ´le Blanche"
        const highlight = !!options.highlight;
        const entranceColor = options.entranceColor || 0xff0000; // Red entrances
        const forbiddenColor = options.forbiddenColor || 0x0000ff; // Blue forbidden zones

        // Draw external envelope in bright green (matching reference)
        if (floorPlan.envelope && Array.isArray(floorPlan.envelope)) {
            floorPlan.envelope.forEach(line => {
                if (line.start && line.end) {
                    this.drawLine(line.start, line.end, 0x00ff00, group); // Bright green
                }
            });
        }

        const drawEntities = (entities, color, fill = false) => {
            if (!Array.isArray(entities)) return;
            entities.forEach(entity => {
                if (!entity) return;
                if (entity.polygon && entity.polygon.length) {
                    this.drawPolygon(entity.polygon, color, group, fill);
                } else if (entity.points && entity.points.length) {
                    this.drawPolygon(entity.points, color, group, fill);
                } else if (entity.start && entity.end) {
                    this.drawLine(entity.start, entity.end, color, group);
                } else if (entity.center && typeof entity.radius === 'number') {
                    const segments = 24;
                    const pts = [];
                    for (let i = 0; i <= segments; i++) {
                        const angle = (i / segments) * Math.PI * 2;
                        pts.push({
                            x: entity.center.x + Math.cos(angle) * entity.radius,
                            y: entity.center.y + Math.sin(angle) * entity.radius
                        });
                    }
                    this.drawPolygon(pts, color, group, fill);
                }
            });
        };

        drawEntities(floorPlan.walls, wallColor, highlight);
        drawEntities(floorPlan.forbiddenZones, forbiddenColor, highlight);
        drawEntities(floorPlan.entrances, entranceColor, false);

    }

    measureDistance(point1, point2) {
        const dx = point2.x - point1.x;
        const dy = point2.y - point1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    showGrid(cellSize = 10) {
        // Show the default grid if no floor plan bounds
        if (this.defaultGrid && !this.bounds) {
            this.defaultGrid.visible = true;
            this.render();
            return;
        }

        if (this.gridHelper) this.scene.remove(this.gridHelper);
        const size = Math.max(this.bounds?.maxX || 100, this.bounds?.maxY || 100);
        const divisions = Math.floor(size / cellSize);
        this.gridHelper = new THREE.GridHelper(size, divisions, 0xcccccc, 0xeeeeee);
        this.gridHelper.rotation.x = Math.PI / 2;
        this.scene.add(this.gridHelper);

        // Hide default grid when custom grid is shown
        if (this.defaultGrid) {
            this.defaultGrid.visible = false;
        }

        this.render();
    }

    hideGrid() {
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            this.gridHelper = null;
        }

        // Also hide default grid
        if (this.defaultGrid) {
            this.defaultGrid.visible = false;
        }

        this.render();
    }

    addDoor(door) {

        // Create door as a rectangle with arc (swing)
        const doorWidth = door.width || 0.9;
        const doorHeight = 0.1; // Visual thickness
        const doorGeometry = new THREE.PlaneGeometry(doorWidth, doorHeight);
        const doorMaterial = new THREE.MeshBasicMaterial({
            color: 0xffaa00, // Orange/yellow for doors
            transparent: true,
            opacity: 0.8
        });
        const doorMesh = new THREE.Mesh(doorGeometry, doorMaterial);
        doorMesh.position.set(door.position.x, door.position.y, 0.05);
        doorMesh.rotation.z = door.rotation || 0;
        doorMesh.userData.door = door;
        this.doorsGroup.add(doorMesh);

        // Add door label
        const labelText = `${doorWidth}m`;
        const labelSprite = this.createTextSprite(labelText, {
            fontsize: 16,
            fillStyle: '#000000',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            fontWeight: 'bold'
        });
        labelSprite.position.set(door.position.x, door.position.y, 0.1);
        labelSprite.scale.set(0.5, 0.25, 1);
        this.doorsGroup.add(labelSprite);

        this.render();
    }

    createDoorTextSpriteLegacy(text, options = {}) {
        const fontsize = options.fontsize || 24;
        const fillStyle = options.fillStyle || '#1f2937';
        const backgroundColor = options.backgroundColor || 'rgba(255, 255, 255, 0.85)';

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Set font and measure text (handle fontWeight option)
        const fontWeight = options.fontWeight || 'bold';
        context.font = `${fontWeight} ${fontsize}px Arial`;
        const metrics = context.measureText(text);
        const textWidth = metrics.width;

        // Set canvas size with padding
        const padding = 8;
        canvas.width = textWidth + padding * 2;
        canvas.height = fontsize + padding * 2;

        // Re-set font after canvas resize
        context.font = `${fontWeight} ${fontsize}px Arial`;

        // Background - SKIP if transparent
        if (backgroundColor !== 'transparent' && backgroundColor !== 'none') {
            context.fillStyle = backgroundColor;
            context.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Text
        context.fillStyle = fillStyle;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        // Create sprite
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true
        });
        const sprite = new THREE.Sprite(spriteMaterial);

        return sprite;
    }

    // Toggle bloom effect
    toggleBloom(enabled) {
        if (this.bloomPass) {
            this.bloomPass.enabled = enabled;
            if (enabled) {
                this.bloomPass.strength = 0.6;
                this.bloomPass.radius = 0.5;
                this.bloomPass.threshold = 0.7;
            }
            this.render();
        }
        return this.bloomPass?.enabled || false;
    }

    // Toggle shadows
    toggleShadows(enabled) {
        this.shadowsEnabled = enabled;
        this.renderer.shadowMap.enabled = enabled;

        // Update all ilot meshes
        this.ilotMeshes.forEach(mesh => {
            mesh.castShadow = enabled;
            mesh.receiveShadow = enabled;
        });

        // Update the ground plane shadow receiving
        if (this.groundPlane) {
            this.groundPlane.receiveShadow = enabled;
        }

        this.renderer.shadowMap.needsUpdate = true;
        this.render();
        return enabled;
    }

    // Set bloom intensity
    setBloomIntensity(strength = 0.5, radius = 0.4, threshold = 0.85) {
        if (this.bloomPass) {
            this.bloomPass.strength = strength;
            this.bloomPass.radius = radius;
            this.bloomPass.threshold = threshold;
            this.render();
        }
    }
}
