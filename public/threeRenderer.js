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

        // Try WebGL with error handling
        try {
            this.renderer = new THREE.WebGLRenderer({
                antialias: true,
                preserveDrawingBuffer: true,
                alpha: false,
                powerPreference: 'high-performance'
            });
            this.rendererType = 'webgl';
        } catch (webglError) {
            console.warn('WebGL renderer failed, trying software fallback:', webglError);
            // Try with forceSoftwareRenderer option
            try {
                this.renderer = new THREE.WebGLRenderer({
                    antialias: false,
                    preserveDrawingBuffer: true,
                    alpha: false,
                    powerPreference: 'default',
                    failIfMajorPerformanceCaveat: false
                });
                this.rendererType = 'webgl-software';
                console.log('Using WebGL with software fallback');
            } catch (fallbackError) {
                console.error('WebGL initialization completely failed:', fallbackError);
                throw new Error('WebGL is not available. Please enable hardware acceleration in your browser settings or update your graphics drivers.');
            }
        }
        
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit for performance
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableRotate = false;
        this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        this.controls.addEventListener('change', () => this.render());

        this.perspectiveControls = new OrbitControls(this.perspectiveCamera, this.renderer.domElement);
        this.perspectiveControls.enableDamping = false;
        this.perspectiveControls.addEventListener('change', () => this.render());

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
            green: new THREE.MeshBasicMaterial({ color: 0xec4899 }), // Pink/Magenta to match corridors
            bright_green: new THREE.MeshBasicMaterial({ color: 0xec4899 }), // Pink/Magenta
            blue: new THREE.MeshBasicMaterial({ color: 0xec4899 }),
            teal: new THREE.MeshBasicMaterial({ color: 0xec4899 })
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
            this.crossFloorPathsGroup
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

        this.render();
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
            this.crossFloorPathsGroup
        ].forEach(g => g.clear());
        this.stackGroup.visible = false;
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

    loadFloorPlan(floorPlan) {
        this.clear();

        console.log('Loading floor plan:', {
            walls: floorPlan.walls?.length || 0,
            entrances: floorPlan.entrances?.length || 0,
            forbiddenZones: floorPlan.forbiddenZones?.length || 0
        });

        // Draw all entities with original DXF colors
        const drawEntity = (entity) => {
            const color = entity.color || 0;
            if (entity.polygon) this.drawPolygon(entity.polygon, color, this.wallsGroup, false);
            else if (entity.start && entity.end) this.drawLine(entity.start, entity.end, color, this.wallsGroup);
        };

        if (floorPlan.walls) floorPlan.walls.forEach(drawEntity);
        if (floorPlan.entrances) floorPlan.entrances.forEach(drawEntity);
        if (floorPlan.forbiddenZones) floorPlan.forbiddenZones.forEach(drawEntity);

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

        // All workstations render as green to match legend
        const colorMap = { single: 0x10b981, double: 0x10b981, team: 0x10b981, meeting: 0x10b981 };

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
            if (this.is3DMode) {
                const extrudeSettings = { depth: 2.8, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2 };
                geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                material = new THREE.MeshStandardMaterial({
                    color: colorMap[ilot.type] || 0x10b981,
                    metalness: 0.1,
                    roughness: 0.4,
                    transparent: true,
                    opacity: 0.95
                });
            } else {
                geometry = new THREE.ShapeGeometry(shape);
                material = new THREE.MeshBasicMaterial({
                    color: colorMap[ilot.type] || 0x10b981,
                    transparent: true,
                    opacity: 0.7,
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
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(linePoints),
                new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 })
            );
            line.position.set(ilot.x, ilot.y, 0);
            this.ilotsGroup.add(line);

            // Add area label in center of ilot
            const areaText = ilot.label || `${(ilot.area || ilot.width * ilot.height).toFixed(1)}m²`;
            const labelSprite = this.createTextSprite(areaText, {
                fontsize: 24,
                fillStyle: '#1f2937',
                backgroundColor: 'rgba(255, 255, 255, 0.85)'
            });
            labelSprite.position.set(
                ilot.x + ilot.width / 2,
                ilot.y + ilot.height / 2,
                0.2
            );
            // Scale based on ilot size
            const scale = Math.min(ilot.width, ilot.height) * 0.3;
            labelSprite.scale.set(scale, scale * 0.5, 1);
            this.ilotsGroup.add(labelSprite);
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
        this.corridorsGroup.clear();

        // Pink/Magenta color for corridors (matches professional plans: #ec4899)
        const corridorColor = 0xec4899;
        const lineMaterial = new THREE.LineBasicMaterial({ color: corridorColor, linewidth: 2 });

        corridors.forEach(corridor => {
            // Draw center-line through corridor (walking path style)
            const centerLine = [];

            // Use dashed lines for a "schematic" technical look
            const lineMaterial = new THREE.LineDashedMaterial({
                color: 0xec4899, // Pink/Magenta
                linewidth: 2,
                scale: 1,
                dashSize: 0.5,
                gapSize: 0.25
            });



            if (corridor.type === 'horizontal' || corridor.width > corridor.height) {
                // Horizontal corridor - draw horizontal line through center
                const centerY = corridor.y + (corridor.height || this.corridorWidth || 1) / 2;
                centerLine.push(new THREE.Vector3(corridor.x, centerY, 0.1));
                centerLine.push(new THREE.Vector3(corridor.x + corridor.width, centerY, 0.1));
            } else {
                // Vertical corridor - draw vertical line through center
                const centerX = corridor.x + (corridor.width || this.corridorWidth || 1) / 2;
                centerLine.push(new THREE.Vector3(centerX, corridor.y, 0.1));
                centerLine.push(new THREE.Vector3(centerX, corridor.y + corridor.height, 0.1));
            }

            if (centerLine.length >= 2) {
                const geometry = new THREE.BufferGeometry().setFromPoints(centerLine);
                const line = new THREE.Line(geometry, lineMaterial);
                line.computeLineDistances(); // Essential for dashed lines
                this.corridorsGroup.add(line);

                // Add small nodes at start/end for schematic look
                const nodeGeo = new THREE.CircleGeometry(0.15, 8);
                const nodeMat = new THREE.MeshBasicMaterial({ color: 0xec4899 });

                const startNode = new THREE.Mesh(nodeGeo, nodeMat);
                startNode.position.copy(centerLine[0]);
                this.corridorsGroup.add(startNode);

                const endNode = new THREE.Mesh(nodeGeo, nodeMat);
                endNode.position.copy(centerLine[centerLine.length - 1]);
                this.corridorsGroup.add(endNode);
            }
        });

        console.log(`Rendered ${corridors.length} corridor paths`);
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
        if (this.is3DMode) {
            this.renderer.render(this.scene, this.perspectiveCamera);
        } else {
            this.composer.render();
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

        const wallColor = options.color || 0x9ca3af;
        const highlight = !!options.highlight;
        const entranceColor = options.entranceColor || (highlight ? 0xef4444 : 0xf87171);
        const forbiddenColor = options.forbiddenColor || (highlight ? 0x0ea5e9 : 0x38bdf8);

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
        if (this.gridHelper) this.scene.remove(this.gridHelper);
        const size = Math.max(this.bounds?.maxX || 100, this.bounds?.maxY || 100);
        const divisions = Math.floor(size / cellSize);
        this.gridHelper = new THREE.GridHelper(size, divisions, 0xcccccc, 0xeeeeee);
        this.gridHelper.rotation.x = Math.PI / 2;
        this.scene.add(this.gridHelper);
        this.render();
    }

    hideGrid() {
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            this.gridHelper = null;
            this.render();
        }
    }

    createTextSprite(text, options = {}) {
        const fontsize = options.fontsize || 24;
        const fillStyle = options.fillStyle || '#1f2937';
        const backgroundColor = options.backgroundColor || 'rgba(255, 255, 255, 0.85)';

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Set font and measure text
        context.font = `bold ${fontsize}px Arial`;
        const metrics = context.measureText(text);
        const textWidth = metrics.width;

        // Set canvas size with padding
        const padding = 8;
        canvas.width = textWidth + padding * 2;
        canvas.height = fontsize + padding * 2;

        // Re-set font after canvas resize
        context.font = `bold ${fontsize}px Arial`;

        // Background
        context.fillStyle = backgroundColor;
        context.fillRect(0, 0, canvas.width, canvas.height);

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
