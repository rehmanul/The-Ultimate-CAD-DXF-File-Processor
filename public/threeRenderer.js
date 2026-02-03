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
        this.perspectiveCamera.position.set(0, -200, 150);
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
                        color: 0x00ff00, // Bright green
                        linewidth: 3 // Thick line like reference
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
                    color: 0x00ff00, // Bright green
                    linewidth: 3 // Thick line like reference
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
        const drawEntity = (entity, group, defaultColor) => {
            const color = entity.color || defaultColor || 0x000000;
            if (entity.polygon) {
                this.drawPolygon(entity.polygon, color, group, false);
                // Add dimension labels for polygon edges
                if (entity.polygon && entity.polygon.length >= 2) {
                    for (let i = 0; i < entity.polygon.length; i++) {
                        const pt1 = entity.polygon[i];
                        const pt2 = entity.polygon[(i + 1) % entity.polygon.length];
                        const x1 = Array.isArray(pt1) ? pt1[0] : pt1.x;
                        const y1 = Array.isArray(pt1) ? pt1[1] : pt1.y;
                        const x2 = Array.isArray(pt2) ? pt2[0] : pt2.x;
                        const y2 = Array.isArray(pt2) ? pt2[1] : pt2.y;
                        const length = Math.hypot(x2 - x1, y2 - y1);
                        if (length > 0.5) { // Only show dimensions for lines > 0.5m
                            const midX = (x1 + x2) / 2;
                            const midY = (y1 + y2) / 2;
                            const dimText = `${length.toFixed(2)}m`;
                            const dimSprite = this.createTextSprite(dimText, {
                                fontsize: 16,
                                fillStyle: '#ff00ff', // Magenta like reference dimensions
                                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                fontWeight: 'normal'
                            });
                            dimSprite.position.set(midX, midY, 0.15);
                            dimSprite.scale.set(0.8, 0.4, 1);
                            this.wallsGroup.add(dimSprite);
                        }
                    }
                }
            } else if (entity.start && entity.end) {
                this.drawLine(entity.start, entity.end, color, group);
                // Add dimension label for line
                const length = Math.hypot(
                    entity.end.x - entity.start.x,
                    entity.end.y - entity.start.y
                );
                if (length > 0.5) { // Only show dimensions for lines > 0.5m
                    const midX = (entity.start.x + entity.end.x) / 2;
                    const midY = (entity.start.y + entity.end.y) / 2;
                    const dimText = `${length.toFixed(2)}m`;
                    const dimSprite = this.createTextSprite(dimText, {
                        fontsize: 16,
                        fillStyle: '#ff00ff', // Magenta like reference dimensions
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        fontWeight: 'normal'
                    });
                    dimSprite.position.set(midX, midY, 0.15);
                    dimSprite.scale.set(0.8, 0.4, 1);
                    this.wallsGroup.add(dimSprite);
                }
            }
        };

        // Walls: black (Tôle Blanche)
        if (floorPlan.walls) {
            floorPlan.walls.forEach(entity => {
                drawEntity(entity, this.wallsGroup, 0x000000);
            });
        }

        // Entrances: red
        if (floorPlan.entrances) {
            floorPlan.entrances.forEach(entity => {
                drawEntity(entity, this.entrancesGroup, 0xff0000);
            });
        }

        // Forbidden zones: blue
        if (floorPlan.forbiddenZones) {
            floorPlan.forbiddenZones.forEach(entity => {
                drawEntity(entity, this.forbiddenGroup, 0x0000ff);
            });
        }

        // Draw room numbers (use actual extracted numbers from DXF, 1-26 like reference)
        if (floorPlan.rooms && Array.isArray(floorPlan.rooms)) {
            floorPlan.rooms.forEach((room) => {
                // Use extracted room number if available, otherwise use index+1
                const roomNumber = room.number || room.id?.replace('room_', '') ||
                    (floorPlan.rooms.indexOf(room) + 1);

                if (roomNumber <= 26) { // Reference shows up to 26
                    // Use labelPosition if available (from TEXT entity extraction), otherwise center
                    const labelX = room.labelPosition?.x || room.center?.x || room.centroid?.x ||
                        (room.bounds ? (room.bounds.minX + room.bounds.maxX) / 2 : 0);
                    const labelY = room.labelPosition?.y || room.center?.y || room.centroid?.y ||
                        (room.bounds ? (room.bounds.minY + room.bounds.maxY) / 2 : 0);

                    if (labelX && labelY) {
                        const labelSprite = this.createTextSprite(String(roomNumber), {
                            fontsize: 24,
                            fillStyle: '#000000', // Black text like reference
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            fontWeight: 'bold'
                        });
                        labelSprite.position.set(labelX, labelY, 0.1);
                        labelSprite.scale.set(2, 2, 1);
                        this.wallsGroup.add(labelSprite);
                    }
                }
            });
        }

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

    drawLine(start, end, color, group) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(start.x, start.y, 0),
            new THREE.Vector3(end.x, end.y, 0)
        ]);
        group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: 2 })));
    }

    drawPolygon(polygon, color, group, filled = false) {
        const points = polygon.map(pt => new THREE.Vector2(Array.isArray(pt) ? pt[0] : pt.x, Array.isArray(pt) ? pt[1] : pt.y));

        if (filled) {
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

        // Render storage units in architectural reference style (blue outlines, no fill)
        // Match reference: blue thick outlines, unit size labels
        const colorMap = {
            single: 0xffffff,  // White/transparent fill
            double: 0xffffff,
            team: 0xffffff,
            meeting: 0xffffff,
            S: 0xffffff,
            M: 0xffffff,
            L: 0xffffff,
            XL: 0xffffff
        };
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

            // Use ilot.color for size category distinction if available
            const fillColor = ilot.color ? parseInt(ilot.color.replace('#', ''), 16) : (colorMap[ilot.type] || 0xffffff);

            if (this.is3DMode) {
                // Variable height based on ilot area (larger ilots = taller)
                const area = ilot.area || (ilot.width * ilot.height);
                const baseHeight = 1.5; // Minimum height
                const heightScale = 0.3; // How much to scale by area
                const maxHeight = 5.0; // Maximum height cap
                const variableDepth = Math.min(baseHeight + area * heightScale, maxHeight);
                const extrudeSettings = { depth: variableDepth, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2 };
                geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                material = new THREE.MeshStandardMaterial({
                    color: fillColor,
                    metalness: 0.1,
                    roughness: 0.6,
                    transparent: true,
                    opacity: 0.85
                });
            } else {
                geometry = new THREE.ShapeGeometry(shape);
                // Use size category color with slight transparency for visual distinction
                material = new THREE.MeshBasicMaterial({
                    color: fillColor,
                    transparent: true,
                    opacity: ilot.color ? 0.35 : 0.1, // More visible fill when color is set
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

                // Display unit size label (unit number at top)
                const unitSizeText = String(closest);
                const labelSprite = this.createTextSprite(unitSizeText, {
                    fontsize: 24,
                    fillStyle: '#1F2937', // Dark gray text
                    backgroundColor: 'transparent', // NO white background
                    fontWeight: 'bold'
                });
                labelSprite.position.set(
                    ilot.x + ilot.width / 2,
                    ilot.y + ilot.height / 2 + (ilot.height * 0.12),
                    0.2
                );
                const scale = Math.min(ilot.width, ilot.height) * 0.3;
                labelSprite.scale.set(scale, scale * 0.5, 1);
                this.ilotsGroup.add(labelSprite);

                // Display area in m² below unit number (SPEC REQUIREMENT)
                const areaText = `${area.toFixed(2)} m²`;
                const areaSprite = this.createTextSprite(areaText, {
                    fontsize: 16,
                    fillStyle: '#214181', // Dark blue per spec
                    backgroundColor: 'transparent',
                    fontWeight: 'normal'
                });
                areaSprite.position.set(
                    ilot.x + ilot.width / 2,
                    ilot.y + ilot.height / 2 - (ilot.height * 0.12),
                    0.2
                );
                const areaScale = Math.min(ilot.width, ilot.height) * 0.22;
                areaSprite.scale.set(areaScale, areaScale * 0.4, 1);
                this.ilotsGroup.add(areaSprite);
            }
        });

        // Restore selection if there was one (visual only, no event dispatch)
        if (selectedIndex >= 0 && selectedIndex < this.ilotMeshes.length) {
            const mesh = this.ilotMeshes[selectedIndex];
            this.selectedIlots = [mesh];
            this.outlinePass.selectedObjects = this.selectedIlots;

            // Restore visual state
            this.ilotMeshes.forEach(m => {
                if (m === mesh) {
                    m.material.opacity = 1.0;
                    if (m.material.emissive) m.material.emissive.set(0x444444);
                } else {
                    m.material.opacity = 0.7;
                    if (m.material.emissive) m.material.emissive.set(0x000000);
                }
            });
        }

        console.log(`Rendered ${ilots.length} ilots in Three.js`);
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

        // PHASE 2: Gray fill material for Tole Grise (corridors only, subtle)
        const grayFillMaterial = new THREE.MeshBasicMaterial({
            color: 0xE5E7EB, // Lighter gray
            transparent: true,
            opacity: 0.25,   // Much more subtle
            side: THREE.DoubleSide
        });

        // Diagonal line material for hatching
        const hatchMaterial = new THREE.LineBasicMaterial({
            color: 0x6B7280, // Gray-500
            linewidth: 1
        });

        // Blue centerline material
        const blueCenterMaterial = new THREE.LineBasicMaterial({
            color: 0x3B82F6, // Blue-500
            linewidth: 2
        });

        // Red dashed corridors to match reference "Ligne circulation" style
        const corridorColor = 0xff0000; // Red like reference
        const lineMaterial = new THREE.LineDashedMaterial({
            color: corridorColor,
            linewidth: 2,
            dashSize: 0.5,
            gapSize: 0.3,
            scale: 1
        });

        corridors.forEach(corridor => {
            // PHASE 2: Draw gray filled rectangle (Tole Grise base)
            const corridorShape = new THREE.Shape();
            corridorShape.moveTo(0, 0);
            corridorShape.lineTo(corridor.width, 0);
            corridorShape.lineTo(corridor.width, corridor.height);
            corridorShape.lineTo(0, corridor.height);
            corridorShape.closePath();

            const fillGeometry = new THREE.ShapeGeometry(corridorShape);
            const fillMesh = new THREE.Mesh(fillGeometry, grayFillMaterial.clone());
            fillMesh.position.set(corridor.x, corridor.y, 0.01);
            this.corridorsGroup.add(fillMesh);

            // Draw 45° diagonal hatching lines
            const hatchSpacing = 0.3; // 30cm between lines
            const diagLength = Math.sqrt(corridor.width ** 2 + corridor.height ** 2);
            const numLines = Math.ceil(diagLength / hatchSpacing) + 5;

            for (let i = -numLines; i <= numLines; i++) {
                const offset = i * hatchSpacing;

                // Calculate intersection points with corridor rectangle
                // Line equation: y = x + offset (45° angle)
                const points = [];

                // Check intersection with bottom edge (y = 0)
                const xAtBottom = -offset;
                if (xAtBottom >= 0 && xAtBottom <= corridor.width) {
                    points.push(new THREE.Vector3(corridor.x + xAtBottom, corridor.y, 0.02));
                }

                // Check intersection with left edge (x = 0)
                const yAtLeft = offset;
                if (yAtLeft >= 0 && yAtLeft <= corridor.height) {
                    points.push(new THREE.Vector3(corridor.x, corridor.y + yAtLeft, 0.02));
                }

                // Check intersection with top edge (y = height)
                const xAtTop = corridor.height - offset;
                if (xAtTop >= 0 && xAtTop <= corridor.width) {
                    points.push(new THREE.Vector3(corridor.x + xAtTop, corridor.y + corridor.height, 0.02));
                }

                // Check intersection with right edge (x = width)
                const yAtRight = corridor.width + offset;
                if (yAtRight >= 0 && yAtRight <= corridor.height) {
                    points.push(new THREE.Vector3(corridor.x + corridor.width, corridor.y + yAtRight, 0.02));
                }

                if (points.length >= 2) {
                    const hatchGeom = new THREE.BufferGeometry().setFromPoints([points[0], points[1]]);
                    const hatchLine = new THREE.Line(hatchGeom, hatchMaterial);
                    this.corridorsGroup.add(hatchLine);
                }
            }

            // Draw blue center-line through corridor
            const centerLine = [];

            if (corridor.type === 'horizontal' || corridor.width > corridor.height) {
                // Horizontal corridor - draw horizontal line through center
                const centerY = corridor.y + (corridor.height || this.corridorWidth || 1) / 2;
                centerLine.push(new THREE.Vector3(corridor.x, centerY, 0.08));
                centerLine.push(new THREE.Vector3(corridor.x + corridor.width, centerY, 0.08));
            } else {
                // Vertical corridor - draw vertical line through center
                const centerX = corridor.x + (corridor.width || this.corridorWidth || 1) / 2;
                centerLine.push(new THREE.Vector3(centerX, corridor.y, 0.08));
                centerLine.push(new THREE.Vector3(centerX, corridor.y + corridor.height, 0.08));
            }

            // Draw the blue centerline first
            if (centerLine.length >= 2) {
                const blueLineGeom = new THREE.BufferGeometry().setFromPoints(centerLine);
                const blueLine = new THREE.Line(blueLineGeom, blueCenterMaterial);
                this.corridorsGroup.add(blueLine);
            }

            if (centerLine.length >= 2) {
                // Add dimension label for corridor length
                const start = centerLine[0];
                const end = centerLine[centerLine.length - 1];
                const length = Math.hypot(end.x - start.x, end.y - start.y);
                if (length > 0.5) {
                    const midX = (start.x + end.x) / 2;
                    const midY = (start.y + end.y) / 2;
                    const dimText = `${length.toFixed(2)}m`;
                    const dimSprite = this.createTextSprite(dimText, {
                        fontsize: 14,
                        fillStyle: '#ff0000', // Red like corridors
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        fontWeight: 'normal'
                    });
                    dimSprite.position.set(midX, midY, 0.15);
                    dimSprite.scale.set(0.7, 0.35, 1);
                    this.corridorsGroup.add(dimSprite);
                }
            }

            if (centerLine.length >= 2) {
                const geometry = new THREE.BufferGeometry().setFromPoints(centerLine);
                const line = new THREE.Line(geometry, lineMaterial);
                // Compute line distance for dashed material (call on Line, not geometry)
                if (line.computeLineDistances) {
                    line.computeLineDistances();
                }
                this.corridorsGroup.add(line);

                // Add corridor width annotation if available
                if (corridor.width && centerLine.length >= 2) {
                    const midX = (centerLine[0].x + centerLine[1].x) / 2;
                    const midY = (centerLine[0].y + centerLine[1].y) / 2;
                    const widthText = `${Math.round(corridor.width * 1000)}`;
                    const labelSprite = this.createTextSprite(widthText, {
                        fontsize: 16,
                        fillStyle: '#ff0000',
                        backgroundColor: 'rgba(255, 255, 255, 0.9)'
                    });
                    labelSprite.position.set(midX, midY, 0.15);
                    labelSprite.scale.set(0.3, 0.3, 1);
                    this.corridorsGroup.add(labelSprite);
                }
            }
        });

        console.log(`Rendered ${corridors.length} corridor paths`);
        this.render();
    }

    /**
     * Render circulation lines (red zigzag) and direction arrows (green triangles)
     * Call this after renderCorridors for professional appearance
     */
    renderCirculationLines(corridors) {
        // Red zigzag material for "Ligne circulation" style
        const zigzagMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            linewidth: 2
        });

        // Green arrow material for direction indicators
        const arrowMaterial = new THREE.MeshBasicMaterial({
            color: 0x00aa00,
            side: THREE.DoubleSide
        });

        corridors.forEach(corridor => {
            const isHorizontal = corridor.type === 'horizontal' || corridor.width > corridor.height;
            const centerX = corridor.x + corridor.width / 2;
            const centerY = corridor.y + corridor.height / 2;

            // Draw RED ZIGZAG line through center
            const zigzagPoints = [];
            const zigzagAmplitude = 0.25;
            const zigzagFrequency = 0.4;

            if (isHorizontal) {
                const startX = corridor.x;
                const endX = corridor.x + corridor.width;
                let peak = true;
                for (let x = startX; x <= endX; x += zigzagFrequency) {
                    const offsetY = peak ? zigzagAmplitude : -zigzagAmplitude;
                    zigzagPoints.push(new THREE.Vector3(x, centerY + offsetY, 0.1));
                    peak = !peak;
                }
            } else {
                const startY = corridor.y;
                const endY = corridor.y + corridor.height;
                let peak = true;
                for (let y = startY; y <= endY; y += zigzagFrequency) {
                    const offsetX = peak ? zigzagAmplitude : -zigzagAmplitude;
                    zigzagPoints.push(new THREE.Vector3(centerX + offsetX, y, 0.1));
                    peak = !peak;
                }
            }

            if (zigzagPoints.length > 1) {
                const zigzagGeom = new THREE.BufferGeometry().setFromPoints(zigzagPoints);
                const zigzagLine = new THREE.Line(zigzagGeom, zigzagMaterial);
                this.corridorsGroup.add(zigzagLine);
            }

            // Draw GREEN DIRECTION ARROWS
            if (corridor.hasArrows !== false) {
                const arrowSize = 0.35;
                const arrowSpacing = 2.5;

                if (isHorizontal) {
                    for (let x = corridor.x + arrowSpacing; x < corridor.x + corridor.width - arrowSpacing; x += arrowSpacing) {
                        const dir = corridor.direction === 'right-to-left' ? -1 : 1;
                        const arrowShape = new THREE.Shape();
                        arrowShape.moveTo(x - arrowSize * dir, centerY - arrowSize * 0.5);
                        arrowShape.lineTo(x + arrowSize * dir, centerY);
                        arrowShape.lineTo(x - arrowSize * dir, centerY + arrowSize * 0.5);
                        arrowShape.closePath();

                        const arrowGeom = new THREE.ShapeGeometry(arrowShape);
                        const arrow = new THREE.Mesh(arrowGeom, arrowMaterial);
                        arrow.position.z = 0.12;
                        this.corridorsGroup.add(arrow);
                    }
                } else {
                    for (let y = corridor.y + arrowSpacing; y < corridor.y + corridor.height - arrowSpacing; y += arrowSpacing) {
                        const dir = corridor.direction === 'down' ? -1 : 1;
                        const arrowShape = new THREE.Shape();
                        arrowShape.moveTo(centerX - arrowSize * 0.5, y - arrowSize * dir);
                        arrowShape.lineTo(centerX, y + arrowSize * dir);
                        arrowShape.lineTo(centerX + arrowSize * 0.5, y - arrowSize * dir);
                        arrowShape.closePath();

                        const arrowGeom = new THREE.ShapeGeometry(arrowShape);
                        const arrow = new THREE.Mesh(arrowGeom, arrowMaterial);
                        arrow.position.z = 0.12;
                        this.corridorsGroup.add(arrow);
                    }
                }
            }
        });

        console.log(`Added circulation lines and arrows to ${corridors.length} corridors`);
        this.render();
    }

    /**
     * PHASE 4: Render radiators as small black rectangles along walls
     * Either from DXF data or auto-generated at intervals
     */
    renderRadiators(radiators, walls, options = {}) {
        // Create radiators group if not exists
        if (!this.radiatorsGroup) {
            this.radiatorsGroup = new THREE.Group();
            this.radiatorsGroup.name = 'radiators';
            this.scene.add(this.radiatorsGroup);
        }

        // Clear existing radiators
        while (this.radiatorsGroup.children.length > 0) {
            const child = this.radiatorsGroup.children[0];
            this.radiatorsGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        const {
            radiatorWidth = 0.6,    // 60cm width
            radiatorDepth = 0.1,    // 10cm depth
            autoSpacing = 3.0,      // Generate every 3m if no DXF data
            wallOffset = 0.05       // 5cm from wall
        } = options;

        // BROWN material for radiators per COSTO spec (RGB 136 0 21)
        const radiatorMaterial = new THREE.MeshBasicMaterial({
            color: 0x880015, // Dark red/brown per spec
            side: THREE.DoubleSide
        });

        let radiatorsToRender = [];

        // Use provided radiators if available
        if (radiators && radiators.length > 0) {
            radiatorsToRender = radiators;
        } else if (walls && walls.length > 0) {
            // Auto-generate radiators along walls
            console.log('[Radiators] Auto-generating from walls...');

            walls.forEach(wall => {
                const start = wall.start || { x: wall.x1, y: wall.y1 };
                const end = wall.end || { x: wall.x2, y: wall.y2 };

                if (!start || !end) return;

                const wallLength = Math.hypot(end.x - start.x, end.y - start.y);
                if (wallLength < autoSpacing) return; // Wall too short

                const isHorizontal = Math.abs(end.y - start.y) < 0.1;
                const isVertical = Math.abs(end.x - start.x) < 0.1;

                if (!isHorizontal && !isVertical) return; // Only process orthogonal walls

                const numRadiators = Math.floor(wallLength / autoSpacing);
                for (let i = 1; i <= numRadiators; i++) {
                    const t = i / (numRadiators + 1);
                    const x = start.x + (end.x - start.x) * t;
                    const y = start.y + (end.y - start.y) * t;

                    radiatorsToRender.push({
                        x, y,
                        horizontal: isHorizontal,
                        width: radiatorWidth,
                        depth: radiatorDepth
                    });
                }
            });
        }

        // Render each radiator
        radiatorsToRender.forEach(rad => {
            const w = rad.width || radiatorWidth;
            const d = rad.depth || radiatorDepth;

            const shape = new THREE.Shape();
            if (rad.horizontal !== false) {
                // Radiator along horizontal wall
                shape.moveTo(-w / 2, 0);
                shape.lineTo(w / 2, 0);
                shape.lineTo(w / 2, d);
                shape.lineTo(-w / 2, d);
                shape.closePath();
            } else {
                // Radiator along vertical wall
                shape.moveTo(0, -w / 2);
                shape.lineTo(d, -w / 2);
                shape.lineTo(d, w / 2);
                shape.lineTo(0, w / 2);
                shape.closePath();
            }

            const geometry = new THREE.ShapeGeometry(shape);
            const mesh = new THREE.Mesh(geometry, radiatorMaterial.clone());
            mesh.position.set(rad.x, rad.y, 0.03);
            this.radiatorsGroup.add(mesh);
        });

        console.log(`[Radiators] Rendered ${radiatorsToRender.length} radiator symbols`);
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
        // Increase padding factor from 1.2 to 1.6 for a "smaller" view (zoomed out)
        const frustumSize = Math.max(width / aspect, height) * 1.6;

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
                m.material.opacity = 1.0;
                if (m.material.emissive) m.material.emissive.set(0x444444);
            } else {
                m.material.opacity = 0.7;
                if (m.material.emissive) m.material.emissive.set(0x000000);
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
            m.material.opacity = 0.7;
            if (m.material.emissive) m.material.emissive.set(0x000000);
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
