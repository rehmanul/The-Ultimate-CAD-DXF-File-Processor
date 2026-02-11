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
            green: new THREE.MeshBasicMaterial({ color: 0xef4444 }), // Red arrows like reference plans
            bright_green: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
            blue: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
            teal: new THREE.MeshBasicMaterial({ color: 0xef4444 })
        };
        this.arrowClock = new THREE.Clock(false);
        this.arrowAnimationActive = false;
        this.arrowAnimationFrame = null;
        this.arrowPulseTime = 0;

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
     * Create a text sprite for labels using canvas rendering
     */
    createTextSprite(text, options = {}) {
        const fontSize = options.fontSize || 12;
        const fontColor = options.fontColor || '#000000';
        const backgroundColor = options.backgroundColor || 'rgba(255,255,255,0.8)';
        const padding = options.padding || 2;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = `${fontSize}px Arial`;

        const textWidth = context.measureText(text).width;
        canvas.width = textWidth + padding * 2;
        canvas.height = fontSize + padding * 2;

        // Background
        context.fillStyle = backgroundColor;
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Text
        context.font = `${fontSize}px Arial`;
        context.fillStyle = fontColor;
        context.textBaseline = 'top';
        context.fillText(text, padding, padding);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(canvas.width / 20, canvas.height / 20, 1);

        return sprite;
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
        // Clear all groups with proper memory management
        [
            this.wallsGroup,
            this.entrancesGroup,
            this.forbiddenGroup,
            this.ilotsGroup,
            this.corridorsGroup,
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
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                }
            }
        });

        this.ilotMeshes = [];
        this.selectedIlots = [];
        this.stackGroup.visible = false;
        this.currentConnectors = [];
        this.currentConnectorOptions = {};
        this.currentStackFloors = null;
        this.currentStackOptions = {};
        this.currentCrossFloorRoutes = [];
        this.crossFloorOptions = {};
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
                        color: 0x6B7280, // Thin gray - matching reference "Tôle Blanche"
                        linewidth: 2
                    });
                    this.wallsGroup.add(new THREE.Line(geometry, material));
                }
            });
        } else if (floorPlan.bounds) {
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
                    color: 0x6B7280, // Thin gray - matching reference "Tôle Blanche"
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

        // Walls: FORCE thin gray (Tôle Blanche) - ignore DXF embedded colors
        if (floorPlan.walls) {
            floorPlan.walls.forEach(entity => {
                drawEntity(entity, this.wallsGroup, 0x6B7280, true); // Thin gray
            });
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
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(sx, sy, 0),
            new THREE.Vector3(ex, ey, 0)
        ]);
        group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: 2 })));
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
        const outlineColor = 0x0000ff; // Blue outlines like reference "Tôle Grise"
        const showLabels = ilots.length <= 500; // Show labels for more ilots

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
            // Draw blue outline (thicker like reference "Tôle Grise")
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

                // COSTO: Add width + area label (matching reference: "1.42 10m²")
                const labelText = ilot.label || `${ilot.width.toFixed(2)} ${area.toFixed(0)}m²`;
                const labelSprite = this.createTextSprite(labelText, {
                    fontSize: 10,
                    fontColor: '#000000',
                    backgroundColor: 'rgba(255,255,255,0.8)',
                    padding: 2
                });
                labelSprite.position.set(
                    ilot.x + ilot.width / 2,
                    ilot.y + ilot.height / 2,  // Center of box
                    0.1
                );
                labelSprite.scale.set(1.0, 0.5, 1);
                this.ilotsGroup.add(labelSprite);
            }
        });

        // Restore selection if there was one (visual only, no event dispatch)
        if (selectedIndex >= 0 && selectedIndex < this.ilotMeshes.length) {
            const mesh = this.ilotMeshes[selectedIndex];
            this.selectedIlots = [mesh];
            this.outlinePass.selectedObjects = this.selectedIlots;

            // Restore visual state — highlight selected, keep others at original
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

    renderCorridors(corridors) {
        // Clear existing corridors with proper memory management
        while (this.corridorsGroup.children.length > 0) {
            const child = this.corridorsGroup.children[0];
            this.corridorsGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        }

        // Pink fill ONLY for narrow access corridors between box rows
        const accessFillMaterial = new THREE.MeshBasicMaterial({
            color: 0xf0a0b8,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        // COSTO: Pink dashed circulation centerlines (matching reference "ligne circulation")
        const circulationMaterial = new THREE.LineDashedMaterial({
            color: 0xe06090,
            dashSize: 0.4,
            gapSize: 0.3
        });

        // Main corridor outline (no fill, just border)
        const mainCorridorLineMaterial = new THREE.LineDashedMaterial({
            color: 0xd05080,
            dashSize: 0.6,
            gapSize: 0.3
        });

        // Arrow materials
        const arrowMaterial = new THREE.MeshBasicMaterial({
            color: 0xd05080,
            side: THREE.DoubleSide
        });

        const arrowSpacing = 4.0;
        const arrowSize = 0.35;

        const normalizePath = (rawPoints) => {
            if (!Array.isArray(rawPoints)) return null;
            const points = rawPoints.map((pt) => {
                if (!pt) return null;
                const x = Number(pt.x !== undefined ? pt.x : pt[0]);
                const y = Number(pt.y !== undefined ? pt.y : pt[1]);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                return { x, y };
            }).filter(Boolean);
            return points.length >= 2 ? points : null;
        };

        const createArrowMesh = (x, y, angle, material = arrowMaterial) => {
            const arrowGeom = new THREE.BufferGeometry();
            const half = arrowSize * 0.5;
            const vertices = new Float32Array([
                -arrowSize, -half, 0.15,
                -arrowSize, half, 0.15,
                arrowSize, 0, 0.15
            ]);
            arrowGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            const arrow = new THREE.Mesh(arrowGeom, material);
            arrow.position.set(x, y, 0.15);
            arrow.rotation.z = angle;
            return arrow;
        };

        const drawPath = (points) => {
            const vectors = points.map(pt => new THREE.Vector3(pt.x, pt.y, 0.1));
            const geom = new THREE.BufferGeometry().setFromPoints(vectors);
            const line = new THREE.Line(geom, circulationMaterial);
            line.computeLineDistances();
            this.corridorsGroup.add(line);
        };

        corridors.forEach(corridor => {
            // Path-based corridors
            const pathPoints = normalizePath(corridor.path || corridor.corners);
            if (pathPoints) {
                drawPath(pathPoints);
                return;
            }

            // Rectangle-based corridors (from COSTOLayoutEngine)
            if (![corridor.x, corridor.y, corridor.width, corridor.height].every(n => Number.isFinite(n))) {
                return;
            }

            const corridorType = (corridor.type || '').toUpperCase();
            const isHorizontal = corridor.direction === 'horizontal' || corridor.width > corridor.height;
            const centerX = corridor.x + corridor.width / 2;
            const centerY = corridor.y + corridor.height / 2;
            const startX = corridor.x;
            const endX = corridor.x + corridor.width;
            const startY = corridor.y;
            const endY = corridor.y + corridor.height;

            const isAccess = corridorType === 'ACCESS' || corridorType === 'ENTRANCE';

            // Only draw pink fill on ACCESS corridors (narrow ones between box rows)
            if (isAccess) {
                const rectShape = new THREE.Shape();
                rectShape.moveTo(startX, startY);
                rectShape.lineTo(endX, startY);
                rectShape.lineTo(endX, endY);
                rectShape.lineTo(startX, endY);
                rectShape.closePath();
                const rectGeom = new THREE.ShapeGeometry(rectShape);
                const rectMesh = new THREE.Mesh(rectGeom, accessFillMaterial);
                rectMesh.position.z = 0.02;
                this.corridorsGroup.add(rectMesh);
            }

            // Draw dashed centerline for all corridors
            const lineMat = isAccess ? circulationMaterial : mainCorridorLineMaterial;
            const centerPoints = isHorizontal
                ? [new THREE.Vector3(startX, centerY, 0.1), new THREE.Vector3(endX, centerY, 0.1)]
                : [new THREE.Vector3(centerX, startY, 0.1), new THREE.Vector3(centerX, endY, 0.1)];

            const lineGeom = new THREE.BufferGeometry().setFromPoints(centerPoints);
            const line = new THREE.Line(lineGeom, lineMat);
            line.computeLineDistances();
            this.corridorsGroup.add(line);

            // Add arrows only on ACCESS corridors
            if (isAccess) {
                const arrowAngle = isHorizontal ? 0 : Math.PI / 2;
                if (isHorizontal) {
                    for (let x = startX + arrowSpacing / 2; x < endX; x += arrowSpacing) {
                        this.corridorsGroup.add(createArrowMesh(x, centerY, arrowAngle, arrowMaterial));
                    }
                } else {
                    for (let y = startY + arrowSpacing / 2; y < endY; y += arrowSpacing) {
                        this.corridorsGroup.add(createArrowMesh(centerX, y, arrowAngle, arrowMaterial));
                    }
                }
            }
        });

        console.log(`[Corridors] Rendered ${corridors.length} corridors (pink fill + dashed centerlines)`);
        this.render();
    }

    /**
     * Render radiators as RED ZIGZAG polylines along perimeter walls.
     * Handles both path-based (from COSTOLayoutEngine) and rect-based formats.
     * @param {Array} radiators - Array of radiator objects
     */
    renderRadiators(radiators) {
        if (!Array.isArray(radiators) || radiators.length === 0) {
            console.log('[Radiators] No radiators to render');
            return;
        }

        // Create or find a group for radiators
        if (!this.radiatorsGroup) {
            this.radiatorsGroup = new THREE.Group();
            this.radiatorsGroup.name = 'radiators';
            this.scene.add(this.radiatorsGroup);
        }
        // Clear existing
        while (this.radiatorsGroup.children.length > 0) {
            const child = this.radiatorsGroup.children[0];
            this.radiatorsGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        const radiatorLineMaterial = new THREE.LineBasicMaterial({
            color: 0xd90014, // Red matching reference
            linewidth: 2
        });

        let rendered = 0;
        radiators.forEach((radiator, index) => {
            // Path-based radiators (zigzag from COSTOLayoutEngine)
            if (radiator.path && Array.isArray(radiator.path) && radiator.path.length >= 2) {
                const vectors = radiator.path.map(pt => {
                    const x = Array.isArray(pt) ? pt[0] : Number(pt.x);
                    const y = Array.isArray(pt) ? pt[1] : Number(pt.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                    return new THREE.Vector3(x, y, 0.15);
                }).filter(Boolean);

                if (vectors.length >= 2) {
                    const geom = new THREE.BufferGeometry().setFromPoints(vectors);
                    const line = new THREE.Line(geom, radiatorLineMaterial);
                    line.userData = { type: 'radiator', id: radiator.id || `rad_${index}` };
                    this.radiatorsGroup.add(line);
                    rendered++;
                }
                return;
            }

            // Rectangle-based radiators (x, y, width, depth)
            if (Number.isFinite(radiator.x) && Number.isFinite(radiator.y)) {
                const w = radiator.width || 0.6;
                const d = radiator.depth || 0.1;
                const shape = new THREE.Shape();
                if (radiator.horizontal !== false) {
                    shape.moveTo(-w / 2, 0);
                    shape.lineTo(w / 2, 0);
                    shape.lineTo(w / 2, d);
                    shape.lineTo(-w / 2, d);
                } else {
                    shape.moveTo(0, -w / 2);
                    shape.lineTo(d, -w / 2);
                    shape.lineTo(d, w / 2);
                    shape.lineTo(0, w / 2);
                }
                shape.closePath();
                const geometry = new THREE.ShapeGeometry(shape);
                const mat = new THREE.MeshBasicMaterial({ color: 0xd90014, side: THREE.DoubleSide });
                const mesh = new THREE.Mesh(geometry, mat);
                mesh.position.set(radiator.x, radiator.y, 0.15);
                this.radiatorsGroup.add(mesh);
                rendered++;
            }
        });

        console.log(`[Radiators] Rendered ${rendered}/${radiators.length} radiator elements (red zigzag)`);
        this.render();
    }

    /**
     * Render circulation center-line paths as light-blue dashed lines.
     * Reference style: "ligne circulation" dashed lines through corridors.
     * @param {Array} circulationPaths - Array of {path: [{x,y},...], type, style}
     */
    renderCirculationPaths(circulationPaths) {
        if (!Array.isArray(circulationPaths) || circulationPaths.length === 0) return;

        const material = new THREE.LineDashedMaterial({
            color: 0x66b3f2, // Light blue
            linewidth: 2,
            dashSize: 0.3,
            gapSize: 0.2
        });

        circulationPaths.forEach(cp => {
            const path = cp.path;
            if (!Array.isArray(path) || path.length < 2) return;
            const vectors = path
                .map(pt => {
                    const x = Number(pt.x), y = Number(pt.y);
                    return Number.isFinite(x) && Number.isFinite(y)
                        ? new THREE.Vector3(x, y, 0.08)
                        : null;
                })
                .filter(Boolean);
            if (vectors.length < 2) return;
            const geom = new THREE.BufferGeometry().setFromPoints(vectors);
            const line = new THREE.Line(geom, material);
            line.computeLineDistances(); // Required for dashed material
            this.corridorsGroup.add(line);
        });

        console.log(`Rendered ${circulationPaths.length} circulation paths (light-blue dashed)`);
        this.render();
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

        const bounds = floorPlan.bounds;
        const units = layoutData.units || [];
        const corridors = layoutData.corridors || [];
        const radiators = layoutData.radiators || [];
        const circulationPaths = layoutData.circulationPaths || [];

        // ── 1. FLOOR BACKGROUND ──────────────────────────────────────
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

        // ── 2. CORRIDORS (CAD style: invisible fill, no border) ────────
        // Corridors are not filled in professional COSTO plans
        // Their presence is indicated only by centerlines + arrows

        // ── 3. CORRIDOR DASHED CENTERLINES + GREEN ARROWS ────────────
        const corridorLineMat = new THREE.LineDashedMaterial({
            color: 0x2563eb, dashSize: 0.3, gapSize: 0.2
        });
        const greenArrowMat = new THREE.MeshBasicMaterial({ color: 0x4caf50, side: THREE.DoubleSide });

        corridors.forEach(c => {
            if (![c.x, c.y, c.width, c.height].every(n => Number.isFinite(n))) return;
            const isH = c.direction === 'horizontal' || c.width > c.height;
            const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
            const pts = isH
                ? [new THREE.Vector3(c.x, cy, 0.08), new THREE.Vector3(c.x + c.width, cy, 0.08)]
                : [new THREE.Vector3(cx, c.y, 0.08), new THREE.Vector3(cx, c.y + c.height, 0.08)];
            const lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
            const line = new THREE.Line(lineGeom, corridorLineMat);
            line.computeLineDistances();
            this.corridorsGroup.add(line);

            // Small green directional arrows (COSTO reference style)
            const arrowAngle = isH ? 0 : Math.PI / 2;
            const arrowSize = 0.18;
            const arrowSpacing = 3.0;
            const makeGreenArrow = (ax, ay) => {
                const verts = new Float32Array([
                    -arrowSize, -arrowSize * 0.5, 0.12,
                    -arrowSize, arrowSize * 0.5, 0.12,
                    arrowSize * 0.7, 0, 0.12
                ]);
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
                const m = new THREE.Mesh(g, greenArrowMat);
                m.position.set(ax, ay, 0);
                m.rotation.z = arrowAngle;
                return m;
            };
            if (isH) {
                for (let x = c.x + arrowSpacing / 2; x < c.x + c.width; x += arrowSpacing)
                    this.corridorsGroup.add(makeGreenArrow(x, cy));
            } else {
                for (let y = c.y + arrowSpacing / 2; y < c.y + c.height; y += arrowSpacing)
                    this.corridorsGroup.add(makeGreenArrow(cx, y));
            }
        });

        // ── 4. BOXES (CAD style: white fills, thin gray outlines, width dimensions) ──
        const boxOutlineMat = new THREE.LineBasicMaterial({ color: 0x374151 });
        const showLabels = units.length <= 600;

        units.forEach((ilot, index) => {
            if (![ilot.x, ilot.y, ilot.width, ilot.height].every(n => Number.isFinite(n))) return;

            // Clean white fill (professional CAD style)
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

            // Thin dark gray outline (uniform for all box types)
            const linePoints = [
                new THREE.Vector3(0, 0, 0.05),
                new THREE.Vector3(ilot.width, 0, 0.05),
                new THREE.Vector3(ilot.width, ilot.height, 0.05),
                new THREE.Vector3(0, ilot.height, 0.05),
                new THREE.Vector3(0, 0, 0.05)
            ];
            const outline = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(linePoints), boxOutlineMat
            );
            outline.position.set(ilot.x, ilot.y, 0);
            this.ilotsGroup.add(outline);

            // Width dimension label (COSTO reference shows width in meters, e.g. "2.15")
            if (showLabels) {
                // Determine the "width" dimension (the shorter side facing the corridor)
                const isH = ilot.width < ilot.height;
                const dimValue = isH ? ilot.width : ilot.height;
                const labelText = dimValue.toFixed(2);
                const sprite = this.createTextSprite(labelText, {
                    fontSize: 8, fontColor: '#1f2937',
                    backgroundColor: 'rgba(255,255,255,0)', padding: 1
                });
                sprite.position.set(ilot.x + ilot.width / 2, ilot.y + ilot.height / 2, 0.1);
                sprite.scale.set(0.8, 0.4, 1);
                this.ilotsGroup.add(sprite);

                // Area label (smaller, below dimension)
                const area = ilot.area || (ilot.width * ilot.height);
                const areaText = `${area.toFixed(1)}m²`;
                const areaSprite = this.createTextSprite(areaText, {
                    fontSize: 7, fontColor: '#6b7280',
                    backgroundColor: 'rgba(255,255,255,0)', padding: 1
                });
                areaSprite.position.set(ilot.x + ilot.width / 2, ilot.y + ilot.height * 0.3, 0.1);
                areaSprite.scale.set(0.7, 0.35, 1);
                this.ilotsGroup.add(areaSprite);
            }
        });

        // ── 5. WALLS (thick filled rectangles, professional CAD style) ────
        const wallFillColor = 0x4b5563;
        const wallThickness = 0.15; // 15cm wall thickness
        const envelopeThickness = 0.20; // 20cm for outer walls

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

        // ── 5b. FLOOR BOUNDARY (thick filled perimeter rectangle) ────
        if (bounds) {
            const bt = envelopeThickness;
            const corners = [
                { start: { x: bounds.minX, y: bounds.minY }, end: { x: bounds.maxX, y: bounds.minY } },
                { start: { x: bounds.maxX, y: bounds.minY }, end: { x: bounds.maxX, y: bounds.maxY } },
                { start: { x: bounds.maxX, y: bounds.maxY }, end: { x: bounds.minX, y: bounds.maxY } },
                { start: { x: bounds.minX, y: bounds.maxY }, end: { x: bounds.minX, y: bounds.minY } }
            ];
            corners.forEach(c => drawThickWall(c.start, c.end, bt));
        }

        // ── 6. FORBIDDEN ZONES (yellow fill) ────────────────────────
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

        // ── 7. ENTRANCES (red lines) ────────────────────────────────
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

        // ── 8. RADIATORS (red zigzag on perimeter) ──────────────────
        if (!this.radiatorsGroup) {
            this.radiatorsGroup = new THREE.Group();
            this.radiatorsGroup.name = 'radiators';
            this.scene.add(this.radiatorsGroup);
        }
        while (this.radiatorsGroup.children.length > 0) {
            const child = this.radiatorsGroup.children[0];
            this.radiatorsGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
        const radMat = new THREE.LineBasicMaterial({ color: 0xd90014, linewidth: 2 });
        radiators.forEach((rad, i) => {
            if (rad.path && Array.isArray(rad.path) && rad.path.length >= 2) {
                const vecs = rad.path.map(pt => {
                    const x = Number(pt.x), y = Number(pt.y);
                    return Number.isFinite(x) && Number.isFinite(y) ? new THREE.Vector3(x, y, 0.15) : null;
                }).filter(Boolean);
                if (vecs.length >= 2) {
                    const geom = new THREE.BufferGeometry().setFromPoints(vecs);
                    this.radiatorsGroup.add(new THREE.Line(geom, radMat));
                }
            }
        });

        // ── 9. CIRCULATION PATHS (thin blue dashed + green arrows, CAD style) ──
        const routeDashedMat = new THREE.LineDashedMaterial({
            color: 0x2563eb, dashSize: 0.4, gapSize: 0.25
        });
        const routeArrowMat = new THREE.MeshBasicMaterial({ color: 0x4caf50, side: THREE.DoubleSide });

        // Helper: build small green directional arrows along a path
        const buildRouteArrows = (points, zPos) => {
            const arrowSize = 0.18;
            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i], p2 = points[i + 1];
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const segLen = Math.hypot(dx, dy);
                if (segLen < 2.0) continue;
                const angle = Math.atan2(dy, dx);
                const step = 3.0;
                for (let d = step; d < segLen - 0.5; d += step) {
                    const ax = p1.x + (dx / segLen) * d;
                    const ay = p1.y + (dy / segLen) * d;
                    const verts = new Float32Array([
                        -arrowSize, -arrowSize * 0.5, 0,
                        -arrowSize, arrowSize * 0.5, 0,
                        arrowSize * 0.7, 0, 0
                    ]);
                    const g = new THREE.BufferGeometry();
                    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
                    const m = new THREE.Mesh(g, routeArrowMat);
                    m.position.set(ax, ay, zPos + 0.02);
                    m.rotation.z = angle;
                    this.corridorsGroup.add(m);
                }
            }
        };

        circulationPaths.forEach(cp => {
            if (!Array.isArray(cp.path) || cp.path.length < 2) return;
            const pts = cp.path.map(pt => {
                const x = Number(pt.x), y = Number(pt.y);
                return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
            }).filter(Boolean);
            if (pts.length < 2) return;

            // All route types: thin blue dashed lines (professional CAD style)
            const vecs = pts.map(p => new THREE.Vector3(p.x, p.y, 0.08));
            const geom = new THREE.BufferGeometry().setFromPoints(vecs);
            const line = new THREE.Line(geom, routeDashedMat);
            line.computeLineDistances();
            this.corridorsGroup.add(line);

            // Green directional arrows on main route segments
            const isMainRoute = cp.type === 'SPINE' || cp.type === 'BRANCH' || cp.type === 'ENTRANCE_CONNECTION';
            if (isMainRoute) {
                buildRouteArrows(pts, 0.08);
            }
        });

        // ── FIT & RENDER ────────────────────────────────────────────
        if (bounds) this.fitToBounds(bounds);

        console.log(`[COSTO Layout] Complete: ${units.length} boxes, ${corridors.length} corridors, ${radiators.length} radiators, ${circulationPaths.length} circulation`);
        this.render();
    }

    /**
     * @deprecated renderCorridors() now draws light-blue dashed circulation + arrows
     */
    renderCirculationLines(corridors) {
        if (corridors && corridors.length > 0) {
            this.renderCorridors(corridors);
        }
    }

    /**
     * COSTO-style perimeter circulation: red zigzag around row clusters
     * Detects horizontal row groups and draws zigzag around each cluster's contour
     */
    renderPerimeterCirculation(ilots, bounds) {
        if (!ilots || ilots.length === 0) return;

        // Clear existing perimeter circulation
        while (this.perimeterGroup.children.length > 0) {
            const child = this.perimeterGroup.children[0];
            this.perimeterGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        // Red zigzag material
        const zigzagMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            linewidth: 2
        });

        // Cyan arrow material for flow direction
        const arrowMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ccff,
            side: THREE.DoubleSide
        });

        // Group ilots by Y position to detect horizontal rows
        const rowTolerance = 0.5; // Y positions within this tolerance are same row
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

        // Sort rows by Y position
        rows.sort((a, b) => a.minY - b.minY);

        // Zigzag helper function
        const amplitude = 0.2;
        const frequency = 0.3;

        const drawZigzag = (startX, startY, endX, endY, isHorizontal) => {
            const points = [];
            let peak = true;

            if (isHorizontal) {
                const dx = endX > startX ? frequency : -frequency;
                for (let x = startX; (endX > startX ? x <= endX : x >= endX); x += dx) {
                    const offsetY = peak ? amplitude : -amplitude;
                    points.push(new THREE.Vector3(x, startY + offsetY, 0.15));
                    peak = !peak;
                }
            } else {
                const dy = endY > startY ? frequency : -frequency;
                for (let y = startY; (endY > startY ? y <= endY : y >= endY); y += dy) {
                    const offsetX = peak ? amplitude : -amplitude;
                    points.push(new THREE.Vector3(startX + offsetX, y, 0.15));
                    peak = !peak;
                }
            }

            if (points.length > 1) {
                const geom = new THREE.BufferGeometry().setFromPoints(points);
                const line = new THREE.Line(geom, zigzagMaterial);
                this.perimeterGroup.add(line);
            }
        };

        // Draw zigzag around each row cluster
        const margin = 0.3;
        rows.forEach((row, idx) => {
            const x1 = row.minX - margin;
            const x2 = row.maxX + margin;
            const y1 = row.minY - margin;
            const y2 = row.maxY + margin;

            // Draw zigzag on all 4 sides of this row
            drawZigzag(x1, y1, x2, y1, true);  // Bottom
            drawZigzag(x2, y1, x2, y2, false); // Right
            drawZigzag(x2, y2, x1, y2, true);  // Top
            drawZigzag(x1, y2, x1, y1, false); // Left

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
        ctx.fillText(`${area.toFixed(2)}m²`, 128, 40);

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
        ctx.fillText(`${angle.toFixed(1)}°`, 128, 40);

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
        const numPoints = Math.max(10, Math.floor(Math.abs(arcAngle) / (Math.PI / 18))); // 10° segments

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
        const wallColor = options.color || 0x000000; // Black walls like reference "Tôle Blanche"
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
        } else if (floorPlan.bounds) {
            // Generate envelope from bounds if not provided
            const { minX, minY, maxX, maxY } = floorPlan.bounds;
            if ([minX, minY, maxX, maxY].every(v => typeof v === 'number')) {
                const envelopeLines = [
                    { start: { x: minX, y: minY }, end: { x: maxX, y: minY } },
                    { start: { x: maxX, y: minY }, end: { x: maxX, y: maxY } },
                    { start: { x: maxX, y: maxY }, end: { x: minX, y: maxY } },
                    { start: { x: minX, y: maxY }, end: { x: minX, y: minY } }
                ];
                envelopeLines.forEach(line => {
                    this.drawLine(line.start, line.end, 0x00ff00, group); // Bright green
                });
            }
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

        if (floorPlan.bounds) {
            const { minX, minY, maxX, maxY } = floorPlan.bounds;
            if ([minX, minY, maxX, maxY].every(v => typeof v === 'number')) {
                const rect = [
                    { x: minX, y: minY },
                    { x: maxX, y: minY },
                    { x: maxX, y: maxY },
                    { x: minX, y: maxY }
                ];
                this.drawPolygon(rect, wallColor, group, false);
            }
        }
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

    createTextSprite(text, options = {}) {
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
