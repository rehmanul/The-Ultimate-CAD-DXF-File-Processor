# Complete Frontend Integration for 3-Stage Floor Plan Processing
# Three.js renderer with stage-by-stage visualization

"""
// Frontend Integration - Three.js Renderer for 3-Stage Processing
// Add this to your main JavaScript file

class ThreeStageRenderer {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        
        // Stage visualization layers
        this.layers = {
            stage1: { rooms: [], walls: [], entrances: [], measurements: [] },
            stage2: { ilots: [], ilotsLabels: [] },
            stage3: { corridors: [], flowIndicators: [], arrows: [] }
        };
        
        // Materials for different elements
        this.materials = {
            room_outline: new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }),
            wall: new THREE.MeshBasicMaterial({ color: 0x404040 }),
            entrance: new THREE.MeshBasicMaterial({ color: 0xff0000 }),
            ilot: new THREE.MeshBasicMaterial({ color: 0xff6666, transparent: true, opacity: 0.7 }),
            corridor: new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 }),
            flow_line: new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 3 }),
            arrow: new THREE.MeshBasicMaterial({ color: 0xff0000 })
        };
        
        this.currentStage = 0;
    }
    
    // Stage 1: Render Empty Floor Plan
    renderStage1EmptyPlan(stage1Result) {
        console.log('🏗️ Rendering Stage 1: Empty Floor Plan');
        
        this.clearStage(1);
        
        const rooms = stage1Result.rooms || [];
        const walls = stage1Result.walls || [];
        const entrances = stage1Result.entrances || [];
        
        // Render room outlines
        rooms.forEach(room => {
            this.renderRoomOutline(room);
            this.renderRoomMeasurement(room);
        });
        
        // Render walls
        walls.forEach(wall => {
            this.renderWall(wall);
        });
        
        // Render entrances
        entrances.forEach(entrance => {
            this.renderEntrance(entrance);
        });
        
        this.currentStage = 1;
        console.log(`✅ Stage 1 Rendered: ${rooms.length} rooms, ${walls.length} walls, ${entrances.length} entrances`);
    }
    
    // Stage 2: Add Ilots to Existing Layout
    renderStage2IlotPlacement(stage2Result) {
        console.log('🏢 Rendering Stage 2: Ilot Placement');
        
        // Keep Stage 1 elements, add Stage 2
        this.clearStage(2);
        
        const ilots = stage2Result.ilots || [];
        
        // Render each ilot as red rectangle
        ilots.forEach(ilot => {
            this.renderIlot(ilot);
            this.renderIlotLabel(ilot);
        });
        
        this.currentStage = 2;
        console.log(`✅ Stage 2 Rendered: ${ilots.length} ilots placed`);
    }
    
    // Stage 3: Add Corridors and Flow Indicators  
    renderStage3CompleteLayout(stage3Result) {
        console.log('🛤️ Rendering Stage 3: Complete Layout with Corridors');
        
        // Keep Stage 1 & 2 elements, add Stage 3
        this.clearStage(3);
        
        const corridors = stage3Result.corridors || [];
        const flowIndicators = stage3Result.flow_indicators || [];
        
        // Render corridors as red outlined rectangles
        corridors.forEach(corridor => {
            this.renderCorridor(corridor);
        });
        
        // Render circulation flow indicators
        flowIndicators.forEach(indicator => {
            this.renderFlowIndicator(indicator);
        });
        
        this.currentStage = 3;
        console.log(`✅ Stage 3 Rendered: ${corridors.length} corridors, ${flowIndicators.length} flow indicators`);
    }
    
    // Individual element renderers
    renderRoomOutline(room) {
        const bounds = room.bounds;
        if (!bounds) return;
        
        // Create room outline geometry
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
            bounds.minX, 0, bounds.minY,
            bounds.maxX, 0, bounds.minY,
            bounds.maxX, 0, bounds.maxY,
            bounds.minX, 0, bounds.maxY,
            bounds.minX, 0, bounds.minY  // Close the loop
        ]);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        
        const line = new THREE.Line(geometry, this.materials.room_outline);
        line.userData = { type: 'room_outline', roomId: room.id, stage: 1 };
        
        this.scene.add(line);
        this.layers.stage1.rooms.push(line);
    }
    
    renderRoomMeasurement(room) {
        if (!room.measurements || !room.measurements.show_dimensions) return;
        
        // Create text sprite for room area measurement
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 32;
        
        context.fillStyle = 'rgba(255, 255, 255, 0.8)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ff0000';
        context.font = '16px Arial';
        context.textAlign = 'center';
        context.fillText(room.measurements.area_text, canvas.width/2, canvas.height/2 + 6);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        
        sprite.position.set(room.centroid.x, 0.1, room.centroid.y);
        sprite.scale.set(3, 0.75, 1);
        sprite.userData = { type: 'measurement', roomId: room.id, stage: 1 };
        
        this.scene.add(sprite);
        this.layers.stage1.measurements.push(sprite);
    }
    
    renderWall(wall) {
        if (!wall.start || !wall.end) return;
        
        // Create wall as thick line
        const geometry = new THREE.CylinderGeometry(0.1, 0.1, 
            Math.sqrt((wall.end.x - wall.start.x)**2 + (wall.end.y - wall.start.y)**2), 8);
        
        const wallMesh = new THREE.Mesh(geometry, this.materials.wall);
        
        // Position and rotate wall
        const centerX = (wall.start.x + wall.end.x) / 2;
        const centerZ = (wall.start.y + wall.end.y) / 2;
        const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
        
        wallMesh.position.set(centerX, 0.5, centerZ);
        wallMesh.rotation.z = angle;
        wallMesh.rotation.x = Math.PI / 2;
        wallMesh.userData = { type: 'wall', stage: 1 };
        
        this.scene.add(wallMesh);
        this.layers.stage1.walls.push(wallMesh);
    }
    
    renderEntrance(entrance) {
        const center = this.getEntranceCenter(entrance);
        if (!center) return;
        
        // Create entrance marker (red rectangle)
        const geometry = new THREE.PlaneGeometry(2, 0.5);
        const entranceMesh = new THREE.Mesh(geometry, this.materials.entrance);
        
        entranceMesh.position.set(center.x, 0.05, center.y);
        entranceMesh.rotation.x = -Math.PI / 2;
        entranceMesh.userData = { type: 'entrance', entranceId: entrance.id, stage: 1 };
        
        this.scene.add(entranceMesh);
        this.layers.stage1.entrances.push(entranceMesh);
    }
    
    renderIlot(ilot) {
        if (!('x' in ilot) || !('y' in ilot)) return;
        
        // Create ilot as red rectangle (outlined, not filled)
        const geometry = new THREE.PlaneGeometry(ilot.width, ilot.height);
        const edges = new THREE.EdgesGeometry(geometry);
        const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ 
            color: 0xff0000, 
            linewidth: 3 
        }));
        
        outline.position.set(ilot.x + ilot.width/2, 0.02, ilot.y + ilot.height/2);
        outline.rotation.x = -Math.PI / 2;
        outline.userData = { type: 'ilot', ilotId: ilot.id, stage: 2 };
        
        this.scene.add(outline);
        this.layers.stage2.ilots.push(outline);
    }
    
    renderIlotLabel(ilot) {
        if (!('x' in ilot) || !ilot.capacity) return;
        
        // Create capacity label
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 64;
        canvas.height = 24;
        
        context.fillStyle = 'rgba(255, 255, 255, 0.9)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#000000';
        context.font = '12px Arial';
        context.textAlign = 'center';
        context.fillText(`${ilot.capacity}p`, canvas.width/2, canvas.height/2 + 4);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        
        sprite.position.set(ilot.x + ilot.width/2, 0.15, ilot.y + ilot.height/2);
        sprite.scale.set(2, 0.6, 1);
        sprite.userData = { type: 'ilot_label', ilotId: ilot.id, stage: 2 };
        
        this.scene.add(sprite);
        this.layers.stage2.ilotsLabels.push(sprite);
    }
    
    renderCorridor(corridor) {
        // Create corridor as red outlined rectangle (like your reference image)
        const geometry = new THREE.PlaneGeometry(corridor.width, corridor.height);
        const edges = new THREE.EdgesGeometry(geometry);
        const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ 
            color: 0xff0000, 
            linewidth: 2 
        }));
        
        outline.position.set(corridor.x + corridor.width/2, 0.01, corridor.y + corridor.height/2);
        outline.rotation.x = -Math.PI / 2;
        outline.userData = { type: 'corridor', corridorId: corridor.id, stage: 3 };
        
        this.scene.add(outline);
        this.layers.stage3.corridors.push(outline);
    }
    
    renderFlowIndicator(indicator) {
        switch (indicator.type) {
            case 'flow_line':
                this.renderFlowLine(indicator);
                break;
            case 'arrow':
                this.renderDirectionalArrow(indicator);
                break;
            case 'entrance_flow':
                this.renderEntranceFlow(indicator);
                break;
        }
    }
    
    renderFlowLine(flowLine) {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
            flowLine.x1, 0.03, flowLine.y1,
            flowLine.x2, 0.03, flowLine.y2
        ]);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        
        const line = new THREE.Line(geometry, this.materials.flow_line);
        line.userData = { type: 'flow_line', stage: 3 };
        
        this.scene.add(line);
        this.layers.stage3.flowIndicators.push(line);
    }
    
    renderDirectionalArrow(arrow) {
        const geometry = new THREE.ConeGeometry(0.2, 0.6, 6);
        const arrowMesh = new THREE.Mesh(geometry, this.materials.arrow);
        
        arrowMesh.position.set(arrow.x, 0.1, arrow.y);
        
        // Rotate based on direction
        switch (arrow.direction) {
            case 'right':
                arrowMesh.rotation.z = -Math.PI / 2;
                break;
            case 'left':
                arrowMesh.rotation.z = Math.PI / 2;
                break;
            case 'up':
                arrowMesh.rotation.x = Math.PI / 2;
                arrowMesh.rotation.z = Math.PI;
                break;
            case 'down':
                arrowMesh.rotation.x = -Math.PI / 2;
                break;
        }
        
        arrowMesh.userData = { type: 'arrow', direction: arrow.direction, stage: 3 };
        
        this.scene.add(arrowMesh);
        this.layers.stage3.arrows.push(arrowMesh);
    }
    
    renderEntranceFlow(flow) {
        // Create flow line with arrow head
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
            flow.x1, 0.03, flow.y1,
            flow.x2, 0.03, flow.y2
        ]);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ 
            color: 0xff0000, 
            linewidth: 4 
        }));
        line.userData = { type: 'entrance_flow', stage: 3 };
        
        this.scene.add(line);
        this.layers.stage3.flowIndicators.push(line);
        
        // Add arrow head at destination
        if (flow.arrow_head) {
            const arrowGeometry = new THREE.ConeGeometry(0.3, 0.8, 6);
            const arrowMesh = new THREE.Mesh(arrowGeometry, this.materials.arrow);
            
            const angle = Math.atan2(flow.y2 - flow.y1, flow.x2 - flow.x1);
            arrowMesh.position.set(flow.x2, 0.1, flow.y2);
            arrowMesh.rotation.z = angle - Math.PI / 2;
            arrowMesh.userData = { type: 'entrance_arrow', stage: 3 };
            
            this.scene.add(arrowMesh);
            this.layers.stage3.arrows.push(arrowMesh);
        }
    }
    
    // Stage control methods
    showStage(stageNumber) {
        // Hide all stages first
        this.hideAllStages();
        
        // Show requested stages progressively
        for (let i = 1; i <= stageNumber; i++) {
            this.showStageLayer(i);
        }
        
        this.currentStage = stageNumber;
        console.log(`Showing stages 1-${stageNumber}`);
    }
    
    showStageLayer(stageNumber) {
        const layer = this.layers[`stage${stageNumber}`];
        if (!layer) return;
        
        Object.values(layer).forEach(meshArray => {
            meshArray.forEach(mesh => {
                mesh.visible = true;
            });
        });
    }
    
    hideAllStages() {
        Object.values(this.layers).forEach(layer => {
            Object.values(layer).forEach(meshArray => {
                meshArray.forEach(mesh => {
                    mesh.visible = false;
                });
            });
        });
    }
    
    clearStage(stageNumber) {
        const layer = this.layers[`stage${stageNumber}`];
        if (!layer) return;
        
        Object.values(layer).forEach(meshArray => {
            meshArray.forEach(mesh => {
                this.scene.remove(mesh);
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) mesh.material.dispose();
            });
            meshArray.length = 0;
        });
    }
    
    clearAllStages() {
        for (let i = 1; i <= 3; i++) {
            this.clearStage(i);
        }
        this.currentStage = 0;
    }
    
    // Utility methods
    getEntranceCenter(entrance) {
        if (entrance.center) return entrance.center;
        
        if (entrance.start && entrance.end) {
            return {
                x: (entrance.start.x + entrance.end.x) / 2,
                y: (entrance.start.y + entrance.end.y) / 2
            };
        }
        
        return null;
    }
    
    // Animation method for dynamic elements
    animate(deltaTime) {
        const time = Date.now() * 0.001;
        
        // Animate arrows with pulsing effect
        this.layers.stage3.arrows.forEach((arrow, index) => {
            const pulse = 0.8 + 0.2 * Math.sin(time * 2 + index * 0.1);
            arrow.scale.setScalar(pulse);
        });
        
        // Animate entrance flow indicators
        this.layers.stage3.flowIndicators.forEach((indicator, index) => {
            if (indicator.userData.type === 'entrance_flow') {
                const bob = 0.03 + 0.01 * Math.sin(time * 3 + index * 0.2);
                indicator.position.y = bob;
            }
        });
    }
}

// UI Controls for 3-Stage Processing
class StageControls {
    constructor(renderer) {
        this.renderer = renderer;
        this.currentStage = 0;
        this.setupUI();
    }
    
    setupUI() {
        // Create UI panel
        const panel = document.createElement('div');
        panel.id = 'stage-controls';
        panel.innerHTML = `
            <div class="stage-control-panel">
                <h3>3-Stage Floor Plan Processing</h3>
                
                <div class="stage-buttons">
                    <button id="process-stage1" class="stage-btn">
                        Stage 1: Empty Plan
                    </button>
                    <button id="process-stage2" class="stage-btn" disabled>
                        Stage 2: Place Ilots
                    </button>
                    <button id="process-stage3" class="stage-btn" disabled>
                        Stage 3: Generate Corridors
                    </button>
                </div>
                
                <div class="stage-display">
                    <button id="show-stage1" class="display-btn">Show Stage 1</button>
                    <button id="show-stage2" class="display-btn">Show Stage 2</button>
                    <button id="show-stage3" class="display-btn">Show Stage 3</button>
                    <button id="show-all" class="display-btn">Show All</button>
                </div>
                
                <div class="stage-info">
                    <div id="stage-status">Ready to process</div>
                    <div id="stage-stats"></div>
                </div>
                
                <div class="stage-options">
                    <label>
                        Corridor Width: 
                        <input type="range" id="corridor-width" min="1.0" max="3.0" step="0.1" value="1.5">
                        <span id="width-value">1.5m</span>
                    </label>
                    
                    <label>
                        Ilot Coverage: 
                        <input type="range" id="ilot-coverage" min="0.1" max="0.5" step="0.05" value="0.25">
                        <span id="coverage-value">25%</span>
                    </label>
                </div>
            </div>
        `;
        
        document.body.appendChild(panel);
        this.bindEvents();
    }
    
    bindEvents() {
        // Stage processing buttons
        document.getElementById('process-stage1').addEventListener('click', () => {
            this.processStage1();
        });
        
        document.getElementById('process-stage2').addEventListener('click', () => {
            this.processStage2();
        });
        
        document.getElementById('process-stage3').addEventListener('click', () => {
            this.processStage3();
        });
        
        // Stage display buttons
        document.getElementById('show-stage1').addEventListener('click', () => {
            this.renderer.showStage(1);
        });
        
        document.getElementById('show-stage2').addEventListener('click', () => {
            this.renderer.showStage(2);
        });
        
        document.getElementById('show-stage3').addEventListener('click', () => {
            this.renderer.showStage(3);
        });
        
        document.getElementById('show-all').addEventListener('click', () => {
            this.renderer.showStage(3);
        });
        
        // Option controls
        document.getElementById('corridor-width').addEventListener('input', (e) => {
            document.getElementById('width-value').textContent = e.target.value + 'm';
        });
        
        document.getElementById('ilot-coverage').addEventListener('input', (e) => {
            document.getElementById('coverage-value').textContent = (e.target.value * 100) + '%';
        });
    }
    
    async processStage1() {
        if (!window.currentCADData) {
            alert('Please upload a floor plan first');
            return;
        }
        
        this.updateStatus('Processing Stage 1: Empty Plan Analysis...');
        
        try {
            const response = await fetch('/api/stages/stage1-empty-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    floorPlan: window.currentCADData
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.renderer.renderStage1EmptyPlan(result.result);
                this.updateStatus(`Stage 1 Complete: ${result.message}`);
                this.enableStageButton(2);
                this.updateStats(1, result.result.metrics);
            } else {
                this.updateStatus('Stage 1 Failed: ' + result.error);
            }
        } catch (error) {
            console.error('Stage 1 processing error:', error);
            this.updateStatus('Stage 1 Error: ' + error.message);
        }
    }
    
    async processStage2() {
        this.updateStatus('Processing Stage 2: Placing Ilots...');
        
        const options = {
            coverage_ratio: parseFloat(document.getElementById('ilot-coverage').value)
        };
        
        try {
            const response = await fetch('/api/stages/stage2-place-ilots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stage1Result: null, // Will use global.stage1Result
                    options: options
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.renderer.renderStage2IlotPlacement(result.result);
                this.updateStatus(`Stage 2 Complete: ${result.message}`);
                this.enableStageButton(3);
                this.updateStats(2, result.statistics);
            } else {
                this.updateStatus('Stage 2 Failed: ' + result.error);
            }
        } catch (error) {
            console.error('Stage 2 processing error:', error);
            this.updateStatus('Stage 2 Error: ' + error.message);
        }
    }
    
    async processStage3() {
        this.updateStatus('Processing Stage 3: Generating Corridors...');
        
        const options = {
            corridor_width: parseFloat(document.getElementById('corridor-width').value),
            generate_flow_indicators: true
        };
        
        try {
            const response = await fetch('/api/stages/stage3-generate-corridors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stage2Result: null, // Will use global.stage2Result
                    options: options
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.renderer.renderStage3CompleteLayout(result.result);
                this.updateStatus(`Stage 3 Complete: ${result.message}`);
                this.updateStats(3, result.statistics);
            } else {
                this.updateStatus('Stage 3 Failed: ' + result.error);
            }
        } catch (error) {
            console.error('Stage 3 processing error:', error);
            this.updateStatus('Stage 3 Error: ' + error.message);
        }
    }
    
    updateStatus(message) {
        const statusElement = document.getElementById('stage-status');
        if (statusElement) {
            statusElement.textContent = message;
            console.log('Stage Status:', message);
        }
    }
    
    updateStats(stage, stats) {
        const statsElement = document.getElementById('stage-stats');
        if (!statsElement) return;
        
        let statsHTML = '';
        
        switch (stage) {
            case 1:
                statsHTML = `
                    <div class="stage-stats">
                        <h4>Stage 1 Statistics</h4>
                        <p>Total Area: ${stats.total_floor_area.toFixed(1)} m²</p>
                        <p>Room Area: ${stats.room_area.toFixed(1)} m²</p>
                        <p>Available Space: ${stats.available_space.toFixed(1)} m²</p>
                        <p>Room Count: ${stats.room_count}</p>
                    </div>
                `;
                break;
            case 2:
                statsHTML = `
                    <div class="stage-stats">
                        <h4>Stage 2 Statistics</h4>
                        <p>Ilots Placed: ${stats.total_ilots}</p>
                        <p>Workspace Area: ${stats.placed_area.toFixed(1)} m²</p>
                        <p>Coverage: ${(stats.coverage_achieved * 100).toFixed(1)}%</p>
                        <p>Success Rate: ${(stats.placement_success_rate * 100).toFixed(1)}%</p>
                    </div>
                `;
                break;
            case 3:
                statsHTML = `
                    <div class="stage-stats">
                        <h4>Stage 3 Statistics</h4>
                        <p>Total Corridors: ${stats.total_corridors}</p>
                        <p>Main Spines: ${stats.main_spines}</p>
                        <p>Corridor Area: ${stats.total_area.toFixed(1)} m²</p>
                        <p>Flow Indicators: ${stats.flow_indicators}</p>
                    </div>
                `;
                break;
        }
        
        statsElement.innerHTML = statsHTML;
    }
    
    enableStageButton(stageNumber) {
        const button = document.getElementById(`process-stage${stageNumber}`);
        if (button) {
            button.disabled = false;
        }
    }
}

// CSS Styles for Stage Controls
const stageStyles = `
<style>
#stage-controls {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 320px;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    z-index: 1000;
    font-family: Arial, sans-serif;
}

.stage-control-panel h3 {
    margin: 0 0 15px 0;
    color: #333;
    font-size: 16px;
}

.stage-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 15px;
}

.stage-btn {
    padding: 10px 15px;
    border: 2px solid #007bff;
    background: white;
    color: #007bff;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.3s;
}

.stage-btn:hover:not(:disabled) {
    background: #007bff;
    color: white;
}

.stage-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.stage-display {
    display: flex;
    gap: 5px;
    margin-bottom: 15px;
}

.display-btn {
    padding: 6px 10px;
    border: 1px solid #6c757d;
    background: white;
    color: #6c757d;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    flex: 1;
}

.display-btn:hover {
    background: #6c757d;
    color: white;
}

.stage-info {
    background: #f8f9fa;
    padding: 10px;
    border-radius: 4px;
    margin-bottom: 15px;
}

#stage-status {
    font-weight: 500;
    color: #333;
    margin-bottom: 5px;
}

.stage-stats h4 {
    margin: 0 0 8px 0;
    color: #007bff;
    font-size: 14px;
}

.stage-stats p {
    margin: 3px 0;
    font-size: 12px;
    color: #666;
}

.stage-options label {
    display: block;
    margin: 8px 0;
    font-size: 12px;
    color: #666;
}

.stage-options input[type="range"] {
    width: 100%;
    margin: 0 5px;
}

.stage-options span {
    font-weight: 500;
    color: #333;
}
</style>
`;

// Initialize the 3-stage system
document.head.insertAdjacentHTML('beforeend', stageStyles);

// Global initialization
let threeStageRenderer = null;
let stageControls = null;

// Initialize after Three.js scene is ready
function initializeThreeStageSystem(scene, camera, renderer) {
    threeStageRenderer = new ThreeStageRenderer(scene, camera, renderer);
    stageControls = new StageControls(threeStageRenderer);
    
    // Add to animation loop
    const originalAnimate = window.animate;
    window.animate = function() {
        if (originalAnimate) originalAnimate();
        if (threeStageRenderer) {
            threeStageRenderer.animate(clock.getDelta());
        }
    };
    
    console.log('✅ 3-Stage Floor Plan System Initialized');
}

// Export for use in main application
window.initializeThreeStageSystem = initializeThreeStageSystem;
window.ThreeStageRenderer = ThreeStageRenderer;
window.StageControls = StageControls;
"""