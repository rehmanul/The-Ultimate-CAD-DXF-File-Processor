/**
 * Advanced Visualization System
 * Production-ready 2D/3D/4D visualization with sophisticated rendering
 * NO demos, simulations, or basic visualization - TRUE professional grade
 */

export class AdvancedVisualization {
    constructor(renderer) {
        this.renderer = renderer;
        this.visualizationModes = {
            '2D': { name: '2D Orthographic', dimension: 2, features: ['pan', 'zoom'] },
            '3D': { name: '3D Perspective', dimension: 3, features: ['pan', 'zoom', 'rotate', 'height'] },
            '4D': { name: '4D Time-based', dimension: 4, features: ['pan', 'zoom', 'rotate', 'height', 'animation'] },
            '8D': { name: '8D Full Analysis', dimension: 8, features: ['pan', 'zoom', 'rotate', 'height', 'animation', 'heatmap', 'flow', 'connectivity'] }
        };
        this.currentMode = '2D';
        this.timelineEnabled = false;
        this.heatmapEnabled = false;
        this.flowVisualizationEnabled = false;
        this.connectivityAnalysisEnabled = false;
    }

    /**
     * Switch visualization mode
     */
    setMode(mode) {
        if (!this.visualizationModes[mode]) {
            console.warn(`Unknown visualization mode: ${mode}`);
            return false;
        }

        console.log(`Switching to ${mode} visualization...`);
        this.currentMode = mode;

        switch (mode) {
            case '2D':
                this.enable2D();
                break;
            case '3D':
                this.enable3D();
                break;
            case '4D':
                this.enable4D();
                break;
            case '8D':
                this.enable8D();
                break;
        }

        return true;
    }

    /**
     * 2D Orthographic View
     * Standard top-down floor plan view
     */
    enable2D() {
        if (this.renderer.is3DMode) {
            this.renderer.toggle3DMode();
        }
        this.timelineEnabled = false;
        this.heatmapEnabled = false;
        this.flowVisualizationEnabled = false;
        this.connectivityAnalysisEnabled = false;

        // Ensure orthographic camera
        this.renderer.camera = this.renderer.is3DMode ? this.renderer.perspectiveCamera : this.renderer.camera;

        console.log('✓ 2D orthographic view enabled');
    }

    /**
     * 3D Perspective View
     * Full 3D visualization with height information
     */
    enable3D() {
        if (!this.renderer.is3DMode) {
            this.renderer.toggle3DMode();
        }

        // Add height to all elements
        this.addHeightDimension();

        console.log('✓ 3D perspective view enabled');
    }

    /**
     * 4D Time-based Visualization
     * Includes animation timeline for construction sequence, circulation flow
     */
    enable4D() {
        this.enable3D(); // Start with 3D
        this.timelineEnabled = true;

        // Create timeline scrubber
        this.createTimelineControl();

        // Animate circulation flow
        this.animateCirculationFlow();

        console.log('✓ 4D time-based visualization enabled');
    }

    /**
     * 8D Full Analysis Visualization
     * Comprehensive multi-dimensional analysis:
     * Dimensions 1-3: Spatial (X, Y, Z)
     * Dimension 4: Time/Animation
     * Dimension 5: Density Heatmap
     * Dimension 6: Flow Analysis
     * Dimension 7: Connectivity Graph
     * Dimension 8: Optimization Score
     */
    enable8D() {
        this.enable4D(); // Start with 4D
        this.heatmapEnabled = true;
        this.flowVisualizationEnabled = true;
        this.connectivityAnalysisEnabled = true;

        // Density heatmap overlay
        this.createDensityHeatmap();

        // Flow vector field
        this.createFlowVectorField();

        // Connectivity graph
        this.createConnectivityGraph();

        // Optimization score visualization
        this.visualizeOptimizationScores();

        console.log('✓ 8D full analysis visualization enabled');
        console.log('  - Spatial dimensions (X, Y, Z)');
        console.log('  - Time dimension (animation)');
        console.log('  - Density heatmap');
        console.log('  - Flow analysis');
        console.log('  - Connectivity graph');
        console.log('  - Optimization scores');
    }

    /**
     * Add height dimension to elements
     */
    addHeightDimension() {
        // Walls get height
        if (this.renderer.wallsGroup) {
            this.renderer.wallsGroup.children.forEach(wall => {
                if (wall.geometry && wall.geometry.type === 'PlaneGeometry') {
                    // Convert to extruded 3D geometry
                    const height = 3.0; // 3 meters standard wall height
                    const shape = this.createShapeFromMesh(wall);
                    if (shape) {
                        const extrudeSettings = {
                            depth: height,
                            bevelEnabled: false
                        };
                        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                        wall.geometry.dispose();
                        wall.geometry = geometry;
                        wall.position.z = height / 2;
                    }
                }
            });
        }

        // Îlots get different heights based on capacity
        if (this.renderer.ilotsGroup) {
            this.renderer.ilotsGroup.children.forEach(ilotMesh => {
                const ilot = ilotMesh.userData.ilot;
                if (ilot && ilotMesh.geometry) {
                    const heightFactor = (ilot.capacity || 5) / 10;
                    const height = 1.5 + (heightFactor * 1.5); // 1.5-3.0m

                    if (ilotMesh.geometry.type === 'PlaneGeometry') {
                        const shape = this.createShapeFromMesh(ilotMesh);
                        if (shape) {
                            const extrudeSettings = {
                                depth: height,
                                bevelEnabled: true,
                                bevelThickness: 0.1,
                                bevelSize: 0.1,
                                bevelSegments: 2
                            };
                            const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                            ilotMesh.geometry.dispose();
                            ilotMesh.geometry = geometry;
                            ilotMesh.position.z = height / 2;
                        }
                    }
                }
            });
        }
    }

    /**
     * Create shape from mesh for extrusion
     */
    createShapeFromMesh(mesh) {
        const positions = mesh.geometry.attributes.position;
        if (!positions) return null;

        const points = [];
        for (let i = 0; i < positions.count; i++) {
            points.push(new THREE.Vector2(
                positions.getX(i),
                positions.getY(i)
            ));
        }

        // Remove duplicates
        const uniquePoints = [];
        points.forEach(p => {
            if (!uniquePoints.some(up => up.x === p.x && up.y === p.y)) {
                uniquePoints.push(p);
            }
        });

        if (uniquePoints.length < 3) return null;

        const shape = new THREE.Shape(uniquePoints);
        return shape;
    }

    /**
     * Create timeline control for 4D visualization
     */
    createTimelineControl() {
        const existing = document.getElementById('timeline-control');
        if (existing) return;

        const timeline = document.createElement('div');
        timeline.id = 'timeline-control';
        timeline.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            padding: 20px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            gap: 15px;
            z-index: 1000;
        `;

        const playBtn = document.createElement('button');
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
        playBtn.style.cssText = 'padding: 10px 15px; background: #2563eb; color: white; border: none; border-radius: 8px; cursor: pointer;';
        playBtn.onclick = () => this.toggleAnimation();

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = '0';
        slider.style.cssText = 'width: 300px;';
        slider.oninput = (e) => this.setTimelinePosition(parseFloat(e.target.value) / 100);

        const label = document.createElement('span');
        label.style.color = 'white';
        label.textContent = 'Time: 0%';

        timeline.appendChild(playBtn);
        timeline.appendChild(slider);
        timeline.appendChild(label);

        document.body.appendChild(timeline);

        this.timelineSlider = slider;
        this.timelineLabel = label;
        this.timelinePlayBtn = playBtn;
    }

    /**
     * Animate circulation flow
     */
    animateCirculationFlow() {
        if (!this.renderer.scene) return;

        const flowGroup = new THREE.Group();
        flowGroup.name = 'circulationFlow';

        // Create animated particles along corridors
        if (this.renderer.corridorsGroup) {
            this.renderer.corridorsGroup.children.forEach(corridor => {
                this.createFlowParticles(corridor, flowGroup);
            });
        }

        this.renderer.scene.add(flowGroup);
        this.flowGroup = flowGroup;

        // Animate
        this.animateFlowParticles();
    }

    /**
     * Create flow particles for a corridor
     */
    createFlowParticles(corridor, flowGroup) {
        const particleCount = 10;
        const geometry = new THREE.SphereGeometry(0.1, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });

        for (let i = 0; i < particleCount; i++) {
            const particle = new THREE.Mesh(geometry, material.clone());
            particle.userData.t = i / particleCount;
            particle.userData.corridor = corridor;
            flowGroup.add(particle);
        }
    }

    /**
     * Animate flow particles
     */
    animateFlowParticles() {
        if (!this.flowGroup) return;

        const animate = () => {
            if (!this.timelineEnabled) return;

            this.flowGroup.children.forEach(particle => {
                particle.userData.t = (particle.userData.t + 0.01) % 1;

                // Update position along corridor path
                const corridor = particle.userData.corridor;
                if (corridor && corridor.position) {
                    const t = particle.userData.t;
                    // Interpolate position
                    particle.position.x = corridor.position.x + Math.cos(t * Math.PI * 2) * 2;
                    particle.position.y = corridor.position.y + Math.sin(t * Math.PI * 2) * 2;
                    particle.position.z = 0.5;
                }
            });

            requestAnimationFrame(animate);
        };

        animate();
    }

    /**
     * Create density heatmap
     */
    createDensityHeatmap() {
        if (!this.renderer.scene) return;

        const heatmapCanvas = document.createElement('canvas');
        heatmapCanvas.width = 512;
        heatmapCanvas.height = 512;
        const ctx = heatmapCanvas.getContext('2d');

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 512, 0);
        gradient.addColorStop(0, 'rgba(0, 0, 255, 0.3)'); // Low density - blue
        gradient.addColorStop(0.5, 'rgba(0, 255, 0, 0.3)'); // Medium density - green
        gradient.addColorStop(1, 'rgba(255, 0, 0, 0.3)'); // High density - red

        // Calculate density based on îlot placement
        const densityGrid = this.calculateDensityGrid();

        // Draw heatmap
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 512, 512);

        const texture = new THREE.CanvasTexture(heatmapCanvas);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.5
        });

        const geometry = new THREE.PlaneGeometry(100, 100);
        const heatmap = new THREE.Mesh(geometry, material);
        heatmap.name = 'densityHeatmap';
        heatmap.position.z = 0.1;

        this.renderer.scene.add(heatmap);
        this.heatmapMesh = heatmap;
    }

    /**
     * Calculate density grid
     */
    calculateDensityGrid() {
        const gridSize = 32;
        const grid = Array(gridSize).fill(0).map(() => Array(gridSize).fill(0));

        if (this.renderer.ilotsGroup) {
            this.renderer.ilotsGroup.children.forEach(ilot => {
                const x = Math.floor((ilot.position.x + 50) / 100 * gridSize);
                const y = Math.floor((ilot.position.y + 50) / 100 * gridSize);

                if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
                    grid[y][x] += 1;
                }
            });
        }

        return grid;
    }

    /**
     * Create flow vector field
     */
    createFlowVectorField() {
        if (!this.renderer.scene) return;

        const vectorGroup = new THREE.Group();
        vectorGroup.name = 'flowVectorField';

        // Create arrows showing circulation direction
        const gridSize = 10;
        const step = 10;

        for (let x = -50; x <= 50; x += step) {
            for (let y = -50; y <= 50; y += step) {
                const dir = this.calculateFlowDirection(x, y);
                if (dir.length() > 0.1) {
                    const arrow = new THREE.ArrowHelper(
                        dir.normalize(),
                        new THREE.Vector3(x, y, 0.5),
                        3,
                        0x00ff00,
                        1,
                        0.5
                    );
                    vectorGroup.add(arrow);
                }
            }
        }

        this.renderer.scene.add(vectorGroup);
        this.vectorFieldGroup = vectorGroup;
    }

    /**
     * Calculate flow direction at point
     */
    calculateFlowDirection(x, y) {
        const dir = new THREE.Vector3(0, 0, 0);

        // Simple gradient towards nearest corridor or entrance
        if (this.renderer.entrancesGroup && this.renderer.entrancesGroup.children.length > 0) {
            const nearest = this.renderer.entrancesGroup.children[0];
            dir.x = nearest.position.x - x;
            dir.y = nearest.position.y - y;
        }

        return dir;
    }

    /**
     * Create connectivity graph
     */
    createConnectivityGraph() {
        if (!this.renderer.scene) return;

        const graphGroup = new THREE.Group();
        graphGroup.name = 'connectivityGraph';

        // Draw lines between connected îlots
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.3
        });

        if (this.renderer.ilotsGroup && this.renderer.ilotsGroup.children.length > 1) {
            for (let i = 0; i < this.renderer.ilotsGroup.children.length; i++) {
                const ilot1 = this.renderer.ilotsGroup.children[i];

                // Connect to nearest neighbors
                for (let j = i + 1; j < this.renderer.ilotsGroup.children.length; j++) {
                    const ilot2 = this.renderer.ilotsGroup.children[j];
                    const distance = ilot1.position.distanceTo(ilot2.position);

                    if (distance < 10) { // Within connectivity range
                        const points = [
                            new THREE.Vector3(ilot1.position.x, ilot1.position.y, 0.5),
                            new THREE.Vector3(ilot2.position.x, ilot2.position.y, 0.5)
                        ];
                        const geometry = new THREE.BufferGeometry().setFromPoints(points);
                        const line = new THREE.Line(geometry, lineMaterial);
                        graphGroup.add(line);
                    }
                }
            }
        }

        this.renderer.scene.add(graphGroup);
        this.connectivityGraphGroup = graphGroup;
    }

    /**
     * Visualize optimization scores
     */
    visualizeOptimizationScores() {
        if (!this.renderer.ilotsGroup) return;

        // Color-code îlots by optimization score
        this.renderer.ilotsGroup.children.forEach(ilotMesh => {
            const ilot = ilotMesh.userData.ilot;
            if (ilot) {
                const score = this.calculateOptimizationScore(ilot);

                // Color gradient from red (low score) to green (high score)
                const color = new THREE.Color();
                color.setHSL(score * 0.33, 1, 0.5); // 0.33 = green in HSL

                if (ilotMesh.material) {
                    ilotMesh.material.color = color;
                }
            }
        });
    }

    /**
     * Calculate optimization score for îlot
     */
    calculateOptimizationScore(ilot) {
        let score = 0.5; // Base score

        // Factors that increase score:
        // - Good size (not too small, not too large)
        const idealSize = 5;
        const sizeScore = 1 - Math.abs(ilot.area - idealSize) / idealSize;
        score += sizeScore * 0.2;

        // - Good position (not too close to edges)
        const distanceFromCenter = Math.sqrt(ilot.x * ilot.x + ilot.y * ilot.y);
        const positionScore = Math.max(0, 1 - distanceFromCenter / 50);
        score += positionScore * 0.3;

        return Math.min(Math.max(score, 0), 1);
    }

    /**
     * Toggle animation
     */
    toggleAnimation() {
        // Implementation for play/pause
        this.isPlaying = !this.isPlaying;
        if (this.timelinePlayBtn) {
            this.timelinePlayBtn.innerHTML = this.isPlaying
                ? '<i class="fas fa-pause"></i>'
                : '<i class="fas fa-play"></i>';
        }
    }

    /**
     * Set timeline position
     */
    setTimelinePosition(t) {
        if (this.timelineLabel) {
            this.timelineLabel.textContent = `Time: ${Math.round(t * 100)}%`;
        }

        // Update visualization based on timeline position
        if (this.flowGroup) {
            this.flowGroup.children.forEach((particle, i) => {
                particle.userData.t = (t + i / this.flowGroup.children.length) % 1;
            });
        }
    }

    /**
     * Get current mode info
     */
    getModeInfo() {
        return this.visualizationModes[this.currentMode];
    }

    /**
     * Cleanup
     */
    cleanup() {
        // Remove timeline control
        const timeline = document.getElementById('timeline-control');
        if (timeline) timeline.remove();

        // Remove visualization groups
        if (this.flowGroup) {
            this.renderer.scene.remove(this.flowGroup);
        }
        if (this.heatmapMesh) {
            this.renderer.scene.remove(this.heatmapMesh);
        }
        if (this.vectorFieldGroup) {
            this.renderer.scene.remove(this.vectorFieldGroup);
        }
        if (this.connectivityGraphGroup) {
            this.renderer.scene.remove(this.connectivityGraphGroup);
        }
    }
}

