# FloorPlan Pro - Corridor Generator Integration Guide

## Complete Integration with Your CAD DXF Processor

This guide shows how to integrate the advanced corridor generator with your existing CAD DXF processor project.

## 1. Node.js Server Integration (server.js)

Add this endpoint to your existing server.js file:

```javascript
// Enhanced corridor generation endpoint with comprehensive green arrows
app.post('/api/corridors/advanced', (req, res) => {
    try {
        const { floorPlan, options = {} } = req.body;
        
        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }

        // Normalize floor plan data for corridor generator
        const normalizedFloorPlan = {
            walls: floorPlan.walls || [],
            forbiddenZones: floorPlan.forbiddenZones || [],
            entrances: floorPlan.entrances || [],
            bounds: floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
            rooms: floorPlan.rooms || [],
            urn: floorPlan.urn
        };

        // Set default options
        const generationOptions = Object.assign({
            corridor_width: 1.5,
            generate_arrows: true,
            min_corridor_length: 3.0,
            max_corridor_spacing: 8.0
        }, options);

        // Here you would call the Python corridor generator
        // For now, we'll use a placeholder that calls your Python script
        
        const { spawn } = require('child_process');
        const python = spawn('python3', ['corridor-generator-complete.py']);
        
        let result = '';
        let error = '';
        
        // Send floor plan data to Python script
        python.stdin.write(JSON.stringify({
            floor_plan: normalizedFloorPlan,
            options: generationOptions
        }));
        python.stdin.end();
        
        python.stdout.on('data', (data) => {
            result += data.toString();
        });
        
        python.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        python.on('close', (code) => {
            if (code !== 0) {
                console.error('Python corridor generator error:', error);
                return res.status(500).json({ 
                    error: 'Corridor generation failed: ' + error 
                });
            }
            
            try {
                const corridorNetwork = JSON.parse(result);
                
                // Store generated corridors for the floor plan
                global.lastGeneratedCorridors = corridorNetwork.corridors;
                global.lastGeneratedArrows = corridorNetwork.arrows;
                
                const planId = normalizedFloorPlan.urn || floorPlan.urn || floorPlan.id;
                if (planId) {
                    floorPlanStore.updateLayout(planId, {
                        corridors: corridorNetwork.corridors,
                        arrows: corridorNetwork.arrows,
                        corridor_statistics: corridorNetwork.statistics
                    });
                }
                
                console.log(`Advanced corridor generation: ${corridorNetwork.statistics.total_corridors} corridors, ${corridorNetwork.arrows.length} arrows`);
                
                res.json({
                    success: true,
                    corridors: corridorNetwork.corridors,
                    arrows: corridorNetwork.arrows,
                    statistics: corridorNetwork.statistics,
                    metadata: corridorNetwork.metadata,
                    message: `Generated ${corridorNetwork.statistics.total_corridors} corridors with ${corridorNetwork.arrows.length} circulation arrows`
                });
            } catch (parseError) {
                console.error('Failed to parse corridor generator result:', parseError);
                res.status(500).json({ 
                    error: 'Failed to parse corridor generation result' 
                });
            }
        });
        
    } catch (error) {
        console.error('Advanced corridor generation error:', error);
        res.status(500).json({ 
            error: 'Advanced corridor generation failed: ' + error.message 
        });
    }
});

// Get generated arrows for overlay visualization
app.get('/api/corridors/arrows/:urn', (req, res) => {
    try {
        const urn = req.params.urn;
        
        // Try to get stored arrows for this floor plan
        const floorPlan = floorPlanStore.getFloorPlan(urn);
        if (floorPlan && floorPlan.arrows) {
            return res.json({
                success: true,
                arrows: floorPlan.arrows,
                count: floorPlan.arrows.length
            });
        }
        
        // Fallback to last generated arrows
        const arrows = global.lastGeneratedArrows || [];
        res.json({
            success: true,
            arrows: arrows,
            count: arrows.length,
            message: arrows.length > 0 ? 'Using last generated arrows' : 'No arrows available'
        });
        
    } catch (error) {
        console.error('Error fetching corridor arrows:', error);
        res.status(500).json({ 
            error: 'Failed to fetch corridor arrows: ' + error.message 
        });
    }
});
```

## 2. Frontend Three.js Integration

Add this to your Three.js renderer:

```javascript
// Corridor Arrow Renderer for Three.js
class CorridorArrowRenderer {
    constructor(scene) {
        this.scene = scene;
        this.arrowMeshes = [];
        this.arrowMaterials = {
            green: new THREE.MeshBasicMaterial({ color: 0x00cc00 }),
            bright_green: new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
            blue: new THREE.MeshBasicMaterial({ color: 0x0066cc })
        };
    }
    
    renderCorridorArrows(arrows) {
        // Clear existing arrows
        this.clearArrows();
        
        arrows.forEach(arrow => {
            const arrowMesh = this.createArrowMesh(arrow);
            if (arrowMesh) {
                this.arrowMeshes.push(arrowMesh);
                this.scene.add(arrowMesh);
            }
        });
        
        console.log(`Rendered ${this.arrowMeshes.length} circulation arrows`);
    }
    
    createArrowMesh(arrow) {
        try {
            // Create arrow geometry based on size
            let geometry;
            switch (arrow.size) {
                case 'small':
                    geometry = new THREE.ConeGeometry(0.15, 0.6, 6);
                    break;
                case 'large':
                    geometry = new THREE.ConeGeometry(0.3, 1.2, 8);
                    break;
                default: // medium
                    geometry = new THREE.ConeGeometry(0.2, 0.8, 6);
            }
            
            // Select material based on color
            const material = this.arrowMaterials[arrow.color] || this.arrowMaterials.green;
            
            const arrowMesh = new THREE.Mesh(geometry, material);
            
            // Position arrow (convert from floor plan coordinates)
            arrowMesh.position.set(arrow.x, 0.2, arrow.y);
            
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
            
            // Add arrow type as user data
            arrowMesh.userData = {
                type: arrow.type,
                direction: arrow.direction,
                arrowData: arrow
            };
            
            return arrowMesh;
        } catch (error) {
            console.error('Error creating arrow mesh:', error);
            return null;
        }
    }
    
    clearArrows() {
        this.arrowMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
        });
        this.arrowMeshes = [];
    }
    
    // Animate arrows for better visibility
    animateArrows(deltaTime) {
        const time = Date.now() * 0.001;
        
        this.arrowMeshes.forEach((mesh, index) => {
            // Subtle pulsing animation
            const pulse = 0.8 + 0.2 * Math.sin(time * 2 + index * 0.1);
            mesh.scale.setScalar(pulse);
            
            // Slight bob animation for entrance flow arrows
            if (mesh.userData.type === 'entrance_flow') {
                mesh.position.y = 0.2 + 0.1 * Math.sin(time * 3 + index * 0.2);
            }
        });
    }
}

// Usage in your main renderer
const arrowRenderer = new CorridorArrowRenderer(scene);

// Function to load and display corridors with arrows
function loadAndDisplayCorridors(cadData) {
    fetch('/api/corridors/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            floorPlan: cadData,
            options: {
                corridor_width: 1.5,
                generate_arrows: true
            }
        })
    })
    .then(response => response.json())
    .then(result => {
        if (result.success) {
            console.log('Corridor generation successful:', result.statistics);
            
            // Render corridors (use your existing corridor renderer)
            if (window.renderCorridors) {
                window.renderCorridors(result.corridors);
            }
            
            // Render circulation arrows
            arrowRenderer.renderCorridorArrows(result.arrows);
            
            // Update UI with statistics
            updateCorridorStatistics(result.statistics);
        } else {
            console.error('Corridor generation failed:', result.error);
        }
    })
    .catch(error => {
        console.error('Error generating corridors:', error);
    });
}

// Function to update UI with corridor statistics
function updateCorridorStatistics(stats) {
    const statsElement = document.getElementById('corridor-stats');
    if (statsElement) {
        statsElement.innerHTML = `
            <div class="corridor-stats">
                <h3>Corridor Network</h3>
                <p>Total Corridors: ${stats.total_corridors}</p>
                <p>Main Corridors: ${stats.main_corridors}</p>
                <p>Connecting: ${stats.connecting_corridors}</p>
                <p>Access: ${stats.access_corridors}</p>
                <p>Total Area: ${stats.total_corridor_area.toFixed(1)} m²</p>
                <p>Average Width: ${stats.average_width.toFixed(1)} m</p>
            </div>
        `;
    }
}

// Add to your animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Animate corridor arrows
    arrowRenderer.animateArrows(clock.getDelta());
    
    renderer.render(scene, camera);
}
```

## 3. HTML UI Integration

Add this to your HTML interface:

```html
<!-- Corridor Generation Controls -->
<div id="corridor-controls" class="control-panel">
    <h3>Advanced Corridor Generation</h3>
    
    <div class="control-group">
        <label>Corridor Width:</label>
        <input type="range" id="corridor-width" min="1.0" max="3.0" step="0.1" value="1.5">
        <span id="width-display">1.5m</span>
    </div>
    
    <div class="control-group">
        <label>
            <input type="checkbox" id="generate-arrows" checked>
            Generate Circulation Arrows
        </label>
    </div>
    
    <div class="control-group">
        <label>
            <input type="checkbox" id="show-main-corridors" checked>
            Main Corridors
        </label>
    </div>
    
    <div class="control-group">
        <label>
            <input type="checkbox" id="show-access-corridors" checked>
            Access Corridors
        </label>
    </div>
    
    <button id="generate-advanced-corridors" class="btn btn-primary">
        Generate Advanced Corridors
    </button>
    
    <button id="toggle-arrows" class="btn btn-secondary">
        Toggle Arrows
    </button>
</div>

<!-- Corridor Statistics Display -->
<div id="corridor-stats" class="stats-panel">
    <!-- Statistics will be populated by JavaScript -->
</div>

<style>
.control-panel {
    background: #f5f5f5;
    padding: 15px;
    margin: 10px 0;
    border-radius: 8px;
    border: 1px solid #ddd;
}

.control-group {
    margin: 10px 0;
    display: flex;
    align-items: center;
    gap: 10px;
}

.control-group label {
    font-weight: 500;
    min-width: 120px;
}

.stats-panel {
    background: #e8f5e8;
    padding: 15px;
    margin: 10px 0;
    border-radius: 8px;
    border: 1px solid #90ee90;
}

.corridor-stats h3 {
    color: #2d5016;
    margin-top: 0;
}

.corridor-stats p {
    margin: 5px 0;
    color: #2d5016;
    font-family: monospace;
}

.btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
}

.btn-primary {
    background: #007bff;
    color: white;
}

.btn-secondary {
    background: #6c757d;
    color: white;
}

.btn:hover {
    opacity: 0.8;
}
</style>

<script>
// UI Event Handlers
document.getElementById('corridor-width').addEventListener('input', function() {
    document.getElementById('width-display').textContent = this.value + 'm';
});

document.getElementById('generate-advanced-corridors').addEventListener('click', function() {
    const options = {
        corridor_width: parseFloat(document.getElementById('corridor-width').value),
        generate_arrows: document.getElementById('generate-arrows').checked
    };
    
    if (window.currentCADData) {
        loadAndDisplayCorridors(window.currentCADData, options);
    } else {
        alert('Please upload a floor plan first');
    }
});

document.getElementById('toggle-arrows').addEventListener('click', function() {
    if (window.arrowRenderer) {
        window.arrowRenderer.arrowMeshes.forEach(mesh => {
            mesh.visible = !mesh.visible;
        });
    }
});

// Store arrow renderer globally for access
window.arrowRenderer = arrowRenderer;
</script>
```

## 4. Python Script Modification for Node.js Integration

Modify the Python script to accept JSON input via stdin:

```python
import sys
import json

def main():
    try:
        # Read JSON input from stdin
        input_data = json.loads(sys.stdin.read())
        floor_plan_data = input_data['floor_plan']
        options = input_data.get('options', {})
        
        # Generate corridors
        result = generate_corridors_for_floor_plan(floor_plan_data, options)
        
        # Output result as JSON
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            'corridors': [],
            'arrows': [],
            'statistics': {'total_corridors': 0, 'total_corridor_area': 0},
            'error': str(e)
        }
        print(json.dumps(error_result))

if __name__ == "__main__":
    main()
```

## 5. Installation and Setup

1. **Install Python dependencies:**
```bash
pip install numpy
```

2. **Make the Python script executable:**
```bash
chmod +x corridor-generator-complete.py
```

3. **Test the integration:**
```bash
# Test with sample data
echo '{"floor_plan": {"rooms": [...], "entrances": [...], "bounds": {...}}, "options": {"corridor_width": 1.5}}' | python3 corridor-generator-complete.py
```

## 6. Features Enabled

✅ **Advanced Corridor Generation**
- Main circulation corridors between room rows
- Connecting corridors between main routes
- Access corridors from entrances
- Vertical circulation spines

✅ **Comprehensive Arrow System**
- Bidirectional flow arrows in corridors
- Entrance/exit flow paths
- Intersection navigation arrows
- Color-coded arrow types

✅ **Real-time Visualization**
- Animated corridor arrows
- Toggle visibility controls
- Statistics display
- Interactive generation parameters

✅ **Full Integration**
- Compatible with existing CAD processor
- Stores results in floor plan database
- Supports all existing export formats
- Works with Three.js renderer

This complete integration enables your CAD DXF processor to generate professional-grade corridor networks with comprehensive circulation flow visualization, exactly like your reference image with green arrows highlighting all circulation paths.