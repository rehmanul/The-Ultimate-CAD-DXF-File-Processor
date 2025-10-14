// FloorPlan Pro Clean - Complete Production System
import { FloorPlanRenderer } from './threeRenderer.js';
import { InteractiveEditor } from './interactiveEditor.js';
import { AdvancedEffects } from './advancedEffects.js';
import { KeyboardShortcuts } from './keyboardShortcuts.js';
import { TextLabels } from './textLabels.js';
import { CollisionDetection } from './collisionDetection.js';
import { UndoRedoManager, MoveIlotCommand, DeleteIlotCommand, AddIlotCommand, ResizeIlotCommand, TransformIlotCommand } from './undoRedo.js';
import { ProfessionalExport } from './professionalExport.js';


let currentFloorPlan = null;
let generatedIlots = [];
let corridorNetwork = [];
let renderer = null;
let editor = null;
let effects = null;
let shortcuts = null;
let textLabels = null;
let collisionDetector = null;
let undoManager = null;
let professionalExport = null;


document.addEventListener('DOMContentLoaded', function () {
    console.log('FloorPlan Pro Clean - System Ready');

    // Global defensive error handler to surface injected-script issues (e.g., content.js from extensions)
    window.addEventListener('error', (ev) => {
        try {
            const src = ev.filename || (ev.error && ev.error.fileName) || '';
            if (src && src.toLowerCase().includes('content.js')) {
                console.warn('An injected script (content.js) triggered an error:', ev.message, 'from', src);
                // suppress the error to avoid breaking the app UI; report to console only
                ev.preventDefault && ev.preventDefault();
            }
        } catch (e) { /* ignore errors in handler */ }
    });

    // Initialize content.query immediately to prevent TypeErrors
    (function initializeContentQuery() {
        // Defensive shim: some browser extensions inject a global `content` object that conflicts with our usage.
        // Provide a minimal safe `content.query` stub if an unexpected `content` object exists to avoid runtime TypeErrors.
        if (typeof window.content === 'undefined') {
            // Some extensions inject code expecting a `content` global. Provide a minimal safe object to avoid crashes.
            Object.defineProperty(window, 'content', {
                configurable: true,
                enumerable: false,
                writable: true,
                value: { query: function () { return null; } }
            });
        } else if (typeof window.content.query === 'undefined') {
            // Only add a safe no-op query function if content exists but doesn't expose query.
            Object.defineProperty(window.content, 'query', {
                configurable: true,
                enumerable: false,
                writable: true,
                value: function () { return null; }
            });
        }
    })(); // Execute immediately

    const container = document.getElementById('threeContainer');

    // Wait for container to have size before initializing renderer
    setTimeout(() => {
        if (container.clientWidth === 0 || container.clientHeight === 0) {
            console.warn('Container has zero size, waiting...');
            setTimeout(() => {
                renderer = new FloorPlanRenderer(container);
                initializeModules();
            }, 100);
        } else {
            renderer = new FloorPlanRenderer(container);
            initializeModules();
        }
    }, 0);
});

function initializeModules() {
    // Initialize all production modules
    textLabels = new TextLabels(renderer);
    undoManager = new UndoRedoManager();
    professionalExport = new ProfessionalExport(renderer);
    editor = new InteractiveEditor(renderer, null);
    effects = new AdvancedEffects(renderer);
    shortcuts = new KeyboardShortcuts(renderer, editor, effects, undoManager);



    // Setup editor callbacks with collision detection and undo/redo
    editor.onIlotModified = (ilot, index, changeData) => {
        // Validate new position
        if (collisionDetector) {
            const validation = collisionDetector.isIlotValid(ilot, generatedIlots.filter((_, i) => i !== index));
            if (!validation.valid) {
                showNotification(`Invalid position: ${validation.reason}`, 'warning');
                // Revert to old state
                ilot.x = changeData.oldPosition.x;
                ilot.y = changeData.oldPosition.y;
                ilot.width = changeData.oldSize.width;
                ilot.height = changeData.oldSize.height;
                renderer.renderIlots(generatedIlots);
                if (textLabels) {
                    textLabels.clear();
                    generatedIlots.forEach((il, i) => textLabels.addIlotLabel(il, i));
                }
                return;
            }
        }

        // Create appropriate undo command
        if (changeData.positionChanged && changeData.sizeChanged) {
            // Both changed - use transform command
            const command = new TransformIlotCommand(
                ilot,
                { ...changeData.oldPosition, ...changeData.oldSize },
                { ...changeData.newPosition, ...changeData.newSize },
                () => {
                    renderer.renderIlots(generatedIlots);
                    if (textLabels) {
                        textLabels.clear();
                        generatedIlots.forEach((il, i) => textLabels.addIlotLabel(il, i));
                    }
                }
            );
            undoManager.addToHistory(command);
        } else if (changeData.positionChanged) {
            // Only position changed
            const command = new MoveIlotCommand(
                ilot,
                changeData.oldPosition,
                changeData.newPosition,
                () => {
                    renderer.renderIlots(generatedIlots);
                    if (textLabels) {
                        textLabels.clear();
                        generatedIlots.forEach((il, i) => textLabels.addIlotLabel(il, i));
                    }
                }
            );
            undoManager.addToHistory(command);
        } else if (changeData.sizeChanged) {
            // Only size changed
            const command = new ResizeIlotCommand(
                ilot,
                changeData.oldSize,
                changeData.newSize,
                () => {
                    renderer.renderIlots(generatedIlots);
                    if (textLabels) {
                        textLabels.clear();
                        generatedIlots.forEach((il, i) => textLabels.addIlotLabel(il, i));
                    }
                }
            );
            undoManager.addToHistory(command);
        }

        // Update the ilot in array
        generatedIlots[index] = ilot;

        // Re-render to show changes
        renderer.renderIlots(generatedIlots);
        if (textLabels) {
            textLabels.clear();
            generatedIlots.forEach((il, i) => textLabels.addIlotLabel(il, i));
        }

        // Update editor's mesh reference if it was selected
        if (editor.selectedMesh && editor.selectedMesh.userData.index === index) {
            editor.selectedMesh = renderer.ilotMeshes[index];
            if (editor.transformControl.object) {
                editor.transformControl.detach();
                editor.transformControl.attach(editor.selectedMesh);
            }
        }
    };

    // Listen for keyboard events
    document.addEventListener('deleteIlot', (e) => {
        const mesh = e.detail.mesh;
        if (!mesh || !mesh.userData.ilot) return;

        const index = mesh.userData.index;
        const command = new DeleteIlotCommand(generatedIlots, index, () => {
            renderer.renderIlots(generatedIlots);
            if (textLabels) {
                textLabels.clear();
                generatedIlots.forEach((il, i) => textLabels.addIlotLabel(il, i));
            }
            updateStats();
        });

        undoManager.execute(command);
        editor.transformControl.detach();
        editor.selectedMesh = null;
        renderer.clearSelection();
        showNotification('Ilot deleted (Ctrl+Z to undo)', 'info');
    });

    document.addEventListener('ilotDuplicated', (e) => {
        const newIlot = e.detail.ilot;
        const command = new AddIlotCommand(generatedIlots, newIlot, () => {
            renderer.renderIlots(generatedIlots);
            if (textLabels) {
                textLabels.clear();
                generatedIlots.forEach((il, i) => textLabels.addIlotLabel(il, i));
            }
            updateStats();
        });

        undoManager.execute(command);
        showNotification('Ilot duplicated (Ctrl+Z to undo)', 'success');
    });

    document.addEventListener('statsUpdate', () => {
        updateStats();
    });

    // Top buttons already hidden in HTML

    // Sidebar toggle buttons
    const leftToggleBtn = document.getElementById('leftToggle');
    const rightToggleBtn = document.getElementById('rightToggle');
    const containerDiv = document.querySelector('.container');

    if (leftToggleBtn && containerDiv) {
        leftToggleBtn.addEventListener('click', () => {
            containerDiv.classList.toggle('left-collapsed');
            console.log('Left toggle clicked, classes:', containerDiv.className);
        });
    }

    if (rightToggleBtn && containerDiv) {
        rightToggleBtn.addEventListener('click', () => {
            containerDiv.classList.toggle('right-collapsed');
            console.log('Right toggle clicked, classes:', containerDiv.className);
        });
    }

    // Attach event listeners to UI elements
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.onchange = handleFileUpload;

    const generateIlotsBtn = document.getElementById('generateIlotsBtn');
    if (generateIlotsBtn) generateIlotsBtn.onclick = generateIlots;

    const generateCorridorsBtn = document.getElementById('generateCorridorsBtn');
    if (generateCorridorsBtn) generateCorridorsBtn.onclick = generateCorridors;

    const corridorWidthSlider = document.getElementById('corridorWidthSlider');
    const corridorWidthValue = document.getElementById('corridorWidthValue');
    if (corridorWidthSlider && corridorWidthValue) {
        corridorWidthValue.textContent = corridorWidthSlider.value + 'm';
        corridorWidthSlider.addEventListener('input', () => {
            corridorWidthValue.textContent = corridorWidthSlider.value + 'm';
        });
    }

    // Distribution inputs handling
    const distributionInputs = document.querySelectorAll('.distribution-input');
    const distributionTotal = document.getElementById('distributionTotal');
    const distributionError = document.getElementById('distributionError');
    const applyDistributionBtn = document.getElementById('applyDistributionBtn');

    function updateDistributionTotal() {
        let total = 0;
        distributionInputs.forEach(input => {
            total += parseInt(input.value) || 0;
        });

        if (distributionTotal) {
            distributionTotal.textContent = total + '%';
            if (total === 100) {
                distributionTotal.style.color = '#4caf50';
                if (distributionError) distributionError.classList.add('hidden');
                if (applyDistributionBtn) applyDistributionBtn.disabled = false;
            } else {
                distributionTotal.style.color = '#f44336';
                if (distributionError) distributionError.classList.remove('hidden');
                if (applyDistributionBtn) applyDistributionBtn.disabled = true;
            }
        }
    }

    distributionInputs.forEach(input => {
        input.addEventListener('input', updateDistributionTotal);
    });

    if (applyDistributionBtn) {
        applyDistributionBtn.addEventListener('click', () => {
            const distribution = {};
            distributionInputs.forEach(input => {
                const index = input.dataset.index;
                const value = parseInt(input.value) || 0;
                // Map index to size range
                const ranges = ['0-1', '1-3', '3-5', '5-10'];
                distribution[ranges[index]] = value / 100; // Convert to decimal
            });

            // Update the hidden distribution editor
            const distributionEditor = document.getElementById('distributionEditor');
            if (distributionEditor) {
                distributionEditor.value = JSON.stringify(distribution, null, 2);
            }

            showNotification('Distribution configuration applied', 'success');
        });
    }

    // Distribution editor (hidden, used internally)
    const distributionEditor = document.createElement('textarea');
    distributionEditor.id = 'distributionEditor';
    distributionEditor.style.display = 'none';
    distributionEditor.value = JSON.stringify({ '0-1': 0.10, '1-3': 0.25, '3-5': 0.30, '5-10': 0.35 }, null, 2);
    document.body.appendChild(distributionEditor);

    // Initialize total display
    updateDistributionTotal();

    const exportPdfBtn = document.getElementById('exportPdfBtn');
    if (exportPdfBtn) exportPdfBtn.onclick = exportToPDF;

    const exportImageBtn = document.getElementById('exportImageBtn');
    if (exportImageBtn) exportImageBtn.onclick = exportToImage;

    // Debug button
    window.debugIlots = function () {
        console.log('=== DEBUG INFO ===');
        console.log('Generated ilots:', generatedIlots.slice(0, 3).map(i => ({ x: i.x, y: i.y, width: i.width, height: i.height, capacity: i.capacity })));
        console.log('FloorPlan bounds:', currentFloorPlan?.bounds);
        console.log('Renderer type:', renderer?.constructor?.name, 'Scene children:', renderer?.scene?.children?.length);
    };

    // Enhancement: Export high-res image
    window.exportHighRes = function () {
        if (!renderer) return;
        const dataURL = renderer.exportImage(4096, 4096);
        const link = document.createElement('a');
        link.download = `floorplan_${Date.now()}.png`;
        link.href = dataURL;
        link.click();
        showNotification('High-res image exported', 'success');
    };

    // Enhancement: Layer visibility controls
    window.toggleWalls = () => renderer?.toggleLayer('walls', !renderer.wallsGroup.visible);
    window.toggleEntrances = () => renderer?.toggleLayer('entrances', !renderer.entrancesGroup.visible);
    window.toggleForbidden = () => renderer?.toggleLayer('forbidden', !renderer.forbiddenGroup.visible);
    window.toggleIlots = () => renderer?.toggleLayer('ilots', !renderer.ilotsGroup.visible);
    window.toggleCorridors = () => renderer?.toggleLayer('corridors', !renderer.corridorsGroup.visible);

    // Viewer controls
    const resetCameraBtn = document.getElementById('resetCameraBtn');
    if (resetCameraBtn) {
        resetCameraBtn.addEventListener('click', () => {
            if (renderer) {
                renderer.resetView();
                showNotification('View reset', 'info');
            }
        });
    }

    // Wireframe button removed from HTML

    const gridToggleBtn = document.getElementById('gridToggleBtn');
    if (gridToggleBtn) {
        let gridVisible = false;
        gridToggleBtn.addEventListener('click', () => {
            gridVisible = !gridVisible;
            if (gridVisible) {
                renderer.showGrid(100);
                gridToggleBtn.innerHTML = '<i class="fas fa-border-all"></i> Hide Grid';
            } else {
                renderer.hideGrid();
                gridToggleBtn.innerHTML = '<i class="fas fa-border-all"></i> Show Grid';
            }
        });
    }

    // Wire up 3D toggle button
    const toggle3DBtn = document.getElementById('toggle3DBtn');
    if (toggle3DBtn) {
        toggle3DBtn.addEventListener('click', () => {
            const is3D = renderer.toggle3DMode();
            const camera = is3D ? renderer.perspectiveCamera : renderer.camera;
            editor.transformControl.camera = camera;
            showNotification(is3D ? 'Switched to 3D view' : 'Switched to 2D view', 'info');
        });
    }

    // Wire up measurement tool buttons
    const measureBtn = document.getElementById('measureBtn');
    if (measureBtn) {
        let measuring = false;
        measureBtn.addEventListener('click', () => {
            measuring = !measuring;
            renderer.enableMeasurementMode(measuring, 'distance');
            measureBtn.classList.toggle('active', measuring);
            showNotification(measuring ? 'Distance measurement: Click two points' : 'Measurement mode disabled', 'info');
        });
    }

    const areaMeasureBtn = document.getElementById('areaMeasureBtn');
    if (areaMeasureBtn) {
        let measuring = false;
        areaMeasureBtn.addEventListener('click', () => {
            measuring = !measuring;
            renderer.enableMeasurementMode(measuring, 'area');
            areaMeasureBtn.classList.toggle('active', measuring);
            showNotification(measuring ? 'Area measurement: Click points to form polygon, click near start to close' : 'Measurement mode disabled', 'info');
        });
    }

    const angleMeasureBtn = document.getElementById('angleMeasureBtn');
    if (angleMeasureBtn) {
        let measuring = false;
        angleMeasureBtn.addEventListener('click', () => {
            measuring = !measuring;
            renderer.enableMeasurementMode(measuring, 'angle');
            angleMeasureBtn.classList.toggle('active', measuring);
            showNotification(measuring ? 'Angle measurement: Click vertex, then two points' : 'Measurement mode disabled', 'info');
        });
    }

    // Wire up clear measurements button
    const clearMeasureBtn = document.getElementById('clearMeasureBtn');
    if (clearMeasureBtn) {
        clearMeasureBtn.addEventListener('click', () => {
            renderer.clearMeasurements();
            showNotification('Measurements cleared', 'info');
        });
    }

    // Wire up export buttons
    const exportGltfBtn = document.getElementById('exportGltfBtn');
    if (exportGltfBtn) {
        exportGltfBtn.addEventListener('click', () => {
            showNotification('Exporting 3D model...', 'info');
            renderer.downloadGLTF(`floorplan_${Date.now()}.gltf`);
            setTimeout(() => showNotification('3D model exported', 'success'), 500);
        });
    }

    const exportSvgBtn = document.getElementById('exportSvgBtn');
    if (exportSvgBtn) {
        exportSvgBtn.addEventListener('click', () => {
            showNotification('Exporting SVG...', 'info');
            professionalExport.downloadSVG(`floorplan_${Date.now()}.svg`);
            setTimeout(() => showNotification('SVG exported', 'success'), 500);
        });
    }

    const exportDxfBtn = document.getElementById('exportDxfBtn');
    if (exportDxfBtn) {
        exportDxfBtn.addEventListener('click', () => {
            if (!currentFloorPlan) {
                showNotification('No floor plan loaded', 'warning');
                return;
            }
            showNotification('Exporting DXF...', 'info');
            professionalExport.downloadDXF(currentFloorPlan, generatedIlots, corridorNetwork, `floorplan_${Date.now()}.dxf`);
            setTimeout(() => showNotification('DXF exported', 'success'), 500);
        });
    }

    const export4kBtn = document.getElementById('export4kBtn');
    if (export4kBtn) {
        export4kBtn.addEventListener('click', () => {
            showNotification('Exporting 4K image...', 'info');
            professionalExport.downloadHighResPNG(4096, 4096, `floorplan_4k_${Date.now()}.png`);
            setTimeout(() => showNotification('4K image exported', 'success'), 500);
        });
    }

    // Add undo/redo buttons
    const viewerControls = document.querySelector('.panel h4:nth-of-type(3)');
    if (viewerControls) {
        const undoBtn = document.createElement('button');
        undoBtn.id = 'undoBtn';
        undoBtn.className = 'btn';
        undoBtn.innerHTML = '<i class="fas fa-undo"></i> Undo (Ctrl+Z)';
        undoBtn.addEventListener('click', () => {
            if (undoManager.undo()) {
                updateStats();
                showNotification('Undo successful', 'info');
            } else {
                showNotification('Nothing to undo', 'warning');
            }
        });
        viewerControls.insertAdjacentElement('afterend', undoBtn);

        const redoBtn = document.createElement('button');
        redoBtn.id = 'redoBtn';
        redoBtn.className = 'btn';
        redoBtn.innerHTML = '<i class="fas fa-redo"></i> Redo (Ctrl+Y)';
        redoBtn.addEventListener('click', () => {
            if (undoManager.redo()) {
                updateStats();
                showNotification('Redo successful', 'info');
            } else {
                showNotification('Nothing to redo', 'warning');
            }
        });
        viewerControls.insertAdjacentElement('afterend', redoBtn);
    }

    // Add edit mode buttons
    if (viewerControls) {
        const editModeBtn = document.createElement('button');
        editModeBtn.id = 'editModeBtn';
        editModeBtn.className = 'btn';
        editModeBtn.innerHTML = '<i class="fas fa-edit"></i> Edit Mode (G)';
        let editing = false;
        editModeBtn.addEventListener('click', () => {
            editing = !editing;
            editor.setMode('translate');
            editor.enableEditMode(editing);
            editModeBtn.classList.toggle('active', editing);
            showNotification(editing ? 'Edit mode enabled - Drag to move' : 'Edit mode disabled', 'info');
        });
        viewerControls.insertAdjacentElement('afterend', editModeBtn);

        const snapGridBtn = document.createElement('button');
        snapGridBtn.id = 'snapGridBtn';
        snapGridBtn.className = 'btn';
        snapGridBtn.innerHTML = '<i class="fas fa-magnet"></i> Snap to Grid';
        let snapEnabled = false;
        snapGridBtn.addEventListener('click', () => {
            snapEnabled = !snapEnabled;
            editor.enableSnapping = snapEnabled;
            snapGridBtn.classList.toggle('active', snapEnabled);
            showNotification(snapEnabled ? 'Grid snapping enabled (0.5m)' : 'Grid snapping disabled', 'info');
        });
        viewerControls.insertAdjacentElement('afterend', snapGridBtn);
    }

    // Add visual effects controls
    const effectsSection = document.createElement('h4');
    effectsSection.textContent = 'Visual Effects';
    if (viewerControls) viewerControls.parentElement.insertBefore(effectsSection, viewerControls.nextSibling.nextSibling.nextSibling.nextSibling.nextSibling.nextSibling);

    const bloomBtn = document.createElement('button');
    bloomBtn.id = 'bloomBtn';
    bloomBtn.className = 'btn';
    bloomBtn.innerHTML = '<i class="fas fa-sun"></i> Bloom Effect (B)';
    bloomBtn.addEventListener('click', () => {
        const enabled = !effects.effectsEnabled.bloom;
        effects.enableBloom(enabled, 0.8);
        bloomBtn.classList.toggle('active', enabled);
        showNotification(enabled ? 'Bloom enabled' : 'Bloom disabled', 'info');
    });
    effectsSection.insertAdjacentElement('afterend', bloomBtn);

    const ssaoBtn = document.createElement('button');
    ssaoBtn.id = 'ssaoBtn';
    ssaoBtn.className = 'btn';
    ssaoBtn.innerHTML = '<i class="fas fa-adjust"></i> Ambient Occlusion';
    ssaoBtn.addEventListener('click', () => {
        if (!renderer.is3DMode) {
            showNotification('SSAO only works in 3D mode', 'warning');
            return;
        }
        const enabled = !effects.effectsEnabled.ssao;
        effects.enableSSAO(enabled);
        ssaoBtn.classList.toggle('active', enabled);
        showNotification(enabled ? 'SSAO enabled' : 'SSAO disabled', 'info');
    });
    effectsSection.insertAdjacentElement('afterend', ssaoBtn);

    const shadowsBtn = document.createElement('button');
    shadowsBtn.id = 'shadowsBtn';
    shadowsBtn.className = 'btn';
    shadowsBtn.innerHTML = '<i class="fas fa-moon"></i> Shadows';
    shadowsBtn.addEventListener('click', () => {
        const enabled = !effects.effectsEnabled.shadows;
        effects.enableShadows(enabled);
        shadowsBtn.classList.toggle('active', enabled);
        showNotification(enabled ? 'Shadows enabled' : 'Shadows disabled', 'info');
    });
    effectsSection.insertAdjacentElement('afterend', shadowsBtn);

    // Add keyboard shortcuts help
    const helpBtn = document.createElement('button');
    helpBtn.id = 'helpBtn';
    helpBtn.className = 'btn';
    helpBtn.innerHTML = '<i class="fas fa-keyboard"></i> Keyboard Shortcuts';
    helpBtn.addEventListener('click', () => {
        const shortcuts = `
KEYBOARD SHORTCUTS:

G - Move mode
S - Scale mode
R - Rotate mode
3 - Toggle 3D view
M - Measure distance
A - Measure area
N - Measure angle
H - Reset view
B - Toggle bloom
ESC - Deselect
DEL - Delete selected
Ctrl+D - Duplicate
Ctrl+Z - Undo
Ctrl+Y - Redo

CLICK - Select ilot
DRAG - Move selected ilot
        `;
        alert(shortcuts);
    });
    effectsSection.insertAdjacentElement('afterend', helpBtn);

    // Listen for ilot selection events
    if (renderer) {
        renderer.addEventListener('ilotSelected', (event) => {
            const ilot = event.ilot;
            showNotification(`Selected: Ilot ${event.index + 1} (${ilot.type || 'standard'}, ${ilot.capacity || 'N/A'} capacity)`, 'info');

            // Highlight in list
            const ilotsList = document.getElementById('ilotsList');
            if (ilotsList) {
                const items = ilotsList.querySelectorAll('.list-item');
                items.forEach((item, idx) => {
                    item.style.backgroundColor = idx === event.index ? '#e0f2fe' : '';
                    item.style.fontWeight = idx === event.index ? 'bold' : '';
                });
            }

            // Enable edit mode automatically
            editor.enableEditMode(true);
        });
    }

    // Optimization buttons (may be noop if backend doesn't expose these endpoints)
    const optimizeLayoutBtn = document.getElementById('optimizeLayoutBtn');
    const optimizePathsBtn = document.getElementById('optimizePathsBtn');
    if (optimizeLayoutBtn) {
        optimizeLayoutBtn.addEventListener('click', async () => {
            if (!generatedIlots.length || !currentFloorPlan) { showNotification('Generate îlots first', 'warning'); return; }
            showNotification('Applying layout optimization...', 'info');
            try {
                const API = (window.__API_BASE__) ? window.__API_BASE__ : 'http://localhost:3001';
                const resp = await fetch(`${API}/api/optimize/layout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ floorPlan: currentFloorPlan, ilots: generatedIlots }) });
                const j = await resp.json();
                if (j && Array.isArray(j.ilots)) {
                    generatedIlots = j.ilots;
                    document.getElementById('ilotCount').textContent = generatedIlots.length;
                    renderCurrentState();
                    showNotification('Optimization complete', 'success');
                } else {
                    showNotification('No optimization changes returned', 'warning');
                }
            } catch (e) {
                console.error('Optimization layout failed', e);
                showNotification('Optimization failed', 'error');
            }
        });
    }

    if (optimizePathsBtn) {
        optimizePathsBtn.addEventListener('click', async () => {
            if (!generatedIlots.length || !currentFloorPlan) { showNotification('Generate îlots first', 'warning'); return; }
            showNotification('Optimizing corridors...', 'info');
            try {
                const API = (window.__API_BASE__) ? window.__API_BASE__ : 'http://localhost:3001';
                const resp = await fetch(`${API}/api/optimize/paths`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ floorPlan: currentFloorPlan, ilots: generatedIlots }) });
                const j = await resp.json();
                if (j && Array.isArray(j.corridors)) {
                    corridorNetwork = j.corridors;
                    renderCurrentState();
                    showNotification('Corridor optimization complete', 'success');
                } else {
                    showNotification('No corridor optimization returned', 'warning');
                }
            } catch (e) {
                console.error('Optimization paths failed', e);
                showNotification('Optimization failed', 'error');
            }
        });
    }

    // Autodesk Viewer handles zoom natively

    showNotification('FloorPlan Pro Clean ready for CAD analysis', 'info');
}

async function handleFileUpload(e) {
    if (!e.target.files[0]) return;

    const file = e.target.files[0];
    try {
        showLoader('Uploading file...');
        const formData = new FormData();
        formData.append('file', file);

        const API = (window.__API_BASE__) ? window.__API_BASE__ : 'http://localhost:3001';
        const response = await fetch(`${API}/api/jobs`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        // Use CAD data directly from upload response
        const analysisData = result.cadData;

        currentFloorPlan = {
            urn: result.urn, // Store the URN for Autodesk Viewer
            walls: analysisData.walls || [],
            forbiddenZones: analysisData.forbiddenZones || [],
            entrances: analysisData.entrances || [],
            bounds: analysisData.bounds,
            totalArea: analysisData.totalArea || 0,
            rooms: analysisData.rooms || [],
            placementTransform: analysisData.placementTransform || null
        };

        console.log('currentFloorPlan created:', currentFloorPlan);

        // Update UI statistics
        document.getElementById('roomCount').textContent = currentFloorPlan.rooms.length;
        document.getElementById('totalArea').textContent = `${currentFloorPlan.totalArea} m²`;

        console.log('UI updated - rooms:', currentFloorPlan.rooms.length, 'area:', currentFloorPlan.totalArea);

        // Update room list
        const roomList = document.getElementById('roomList');
        if (roomList) {
            roomList.innerHTML = '';
            if (currentFloorPlan.rooms.length === 0) {
                roomList.innerHTML = '<div class="list-item">No rooms detected yet</div>';
            } else {
                currentFloorPlan.rooms.forEach((room, index) => {
                    const item = document.createElement('div');
                    item.className = 'list-item';
                    item.textContent = `Room ${index + 1} - Area: ${room.area ? room.area.toFixed(2) : 'N/A'} m²`;
                    roomList.appendChild(item);
                });
            }
        }

        // Initialize collision detection
        collisionDetector = new CollisionDetection(currentFloorPlan);
        editor.collisionDetector = collisionDetector;

        // Load floor plan into Three.js renderer with color coding
        if (renderer) {
            renderer.loadFloorPlan(currentFloorPlan);
            // Fit to bounds and center - wait for render to complete
            setTimeout(() => {
                if (currentFloorPlan.bounds) {
                    renderer.fitToBounds(currentFloorPlan.bounds);
                }
            }, 100);
        }

        // Add room labels
        if (textLabels && currentFloorPlan.rooms) {
            currentFloorPlan.rooms.forEach((room, i) => textLabels.addRoomLabel(room, i));
        }

        hideLoader();
        showNotification(`File processed successfully! ${currentFloorPlan.rooms.length} rooms detected.`, 'success');

    } catch (error) {
        hideLoader();
        showNotification('Upload failed: ' + error.message, 'error');
    }
}

function updateStats() {
    if (currentFloorPlan) {
        document.getElementById('roomCount').textContent = currentFloorPlan.rooms?.length || 0;
        document.getElementById('totalArea').textContent = `${currentFloorPlan.totalArea || 0} m²`;
    }
    document.getElementById('ilotCount').textContent = generatedIlots.length;
    const ilotsList = document.getElementById('ilotsList');
    ilotsList.innerHTML = '';
    if (generatedIlots.length === 0) {
        ilotsList.innerHTML = '<div class="list-item">No îlots generated yet</div>';
    } else {
        generatedIlots.forEach((ilot, index) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.textContent = `Îlot ${index + 1} - Capacity: ${ilot.capacity || 'N/A'}`;
            ilotsList.appendChild(item);
        });
    }

    const corridorList = document.getElementById('corridorList');
    corridorList.innerHTML = '';
    if (corridorNetwork.length === 0) {
        corridorList.innerHTML = '<div class="list-item">No corridors generated yet</div>';
    } else {
        corridorNetwork.forEach((corridor, index) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.textContent = `Corridor ${index + 1} - Type: ${corridor.type || 'Standard'}`;
            corridorList.appendChild(item);
        });
    }
}

function renderCurrentState() {
    console.log('renderCurrentState called:', generatedIlots.length, 'ilots,', corridorNetwork.length, 'corridors');
    if (renderer) {
        renderer.renderIlots(generatedIlots);
        renderer.renderCorridors(corridorNetwork);
    }
}


async function generateIlots() {
    if (!currentFloorPlan) {
        showNotification('Please upload a CAD file first', 'warning');
        return;
    }

    try {
        showLoader('Generating îlots...', 10);

        // Use DXF bounds directly
        let bounds = currentFloorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        console.log('Using DXF bounds:', bounds);

        // Ensure floorPlan has required arrays (even if empty)
        const floorPlan = {
            ...currentFloorPlan,
            walls: currentFloorPlan.walls || [],
            forbiddenZones: currentFloorPlan.forbiddenZones || [],
            entrances: currentFloorPlan.entrances || [],
            bounds: bounds
        };

        // Calculate target ilots based on actual room area
        let floorArea = floorPlan.totalArea || 0;
        if (floorArea === 0 && floorPlan.rooms && floorPlan.rooms.length > 0) {
            floorArea = floorPlan.rooms.reduce((sum, r) => sum + (r.area || 0), 0);
        }
        if (floorArea === 0 || floorArea > 100000) {
            // Fallback: use 30% of bounding box area as usable space
            const width = floorPlan.bounds.maxX - floorPlan.bounds.minX;
            const height = floorPlan.bounds.maxY - floorPlan.bounds.minY;
            floorArea = width * height * 0.3;
        }
        const targetIlots = Math.max(10, Math.min(100, Math.floor(floorArea / 50))); // 1 ilot per 50 m², max 100

        const distribution = parseDistribution();
        console.log('Using distribution configuration:', distribution);

        console.log(`Generating ${targetIlots} ilots for ${floorArea.toFixed(2)} m² floor area`);

        const API = (window.__API_BASE__) ? window.__API_BASE__ : 'http://localhost:3001';
        const response = await fetch(`${API}/api/ilots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                floorPlan: floorPlan,
                distribution: distribution,
                options: {
                    totalIlots: targetIlots,
                    seed: Date.now(),
                    minEntranceDistance: 1.0,
                    minIlotDistance: 0.5,
                    maxAttemptsPerIlot: 800
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || 'Failed to generate ilots');
        }

        const data = await response.json();
        generatedIlots = data.ilots || [];

        console.log(`Generated ${generatedIlots.length} ilots with total area: ${data.totalArea?.toFixed(2) || 0} m²`);
        console.log('First 3 ilots:', generatedIlots.slice(0, 3));
        console.log('Floor bounds:', floorPlan.bounds);

        // Add labels to ilots
        if (textLabels) {
            textLabels.clear();
            generatedIlots.forEach((ilot, i) => textLabels.addIlotLabel(ilot, i));
        }

        if (generatedIlots.length > 0) {
            const ilotBounds = {
                minX: Math.min(...generatedIlots.map(i => i.x)),
                maxX: Math.max(...generatedIlots.map(i => i.x + i.width)),
                minY: Math.min(...generatedIlots.map(i => i.y)),
                maxY: Math.max(...generatedIlots.map(i => i.y + i.height))
            };
            console.log('Ilot bounds:', ilotBounds);

            const combinedBounds = {
                minX: Math.min(floorPlan.bounds.minX, ilotBounds.minX),
                maxX: Math.max(floorPlan.bounds.maxX, ilotBounds.maxX),
                minY: Math.min(floorPlan.bounds.minY, ilotBounds.minY),
                maxY: Math.max(floorPlan.bounds.maxY, ilotBounds.maxY)
            };
            renderer.fitToBounds(combinedBounds);
        }

        updateStats();

        // Wait for viewer to be ready before rendering
        setTimeout(() => {
            renderCurrentState();
        }, 500);

        showNotification(`Generated ${generatedIlots.length} îlots (${data.totalArea?.toFixed(2)} m²)`, 'success');
        hideLoader();
    } catch (error) {
        console.error('Îlot generation error:', error);
        showNotification(`Failed to generate îlots: ${error.message}`, 'error');
        hideLoader();
    }
}


function parseDistribution() {
    const txt = document.getElementById('distributionEditor')?.value;
    if (!txt) return { '1-3': 0.25, '3-5': 0.35, '5-10': 0.40 };
    try {
        const obj = JSON.parse(txt);
        if (typeof obj === 'object') return obj;
    } catch (e) {
        console.warn('Invalid distribution JSON, falling back to default');
    }
    return { '1-3': 0.25, '3-5': 0.35, '5-10': 0.40 };
}

async function generateCorridors() {
    if (!generatedIlots.length) {
        showNotification('Please generate îlots first', 'warning');
        return;
    }

    try {
        showLoader('Generating corridors...', 20);

        const API = (window.__API_BASE__) ? window.__API_BASE__ : 'http://localhost:3001';
        const response = await fetch(`${API}/api/corridors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                floorPlan: currentFloorPlan,
                ilots: generatedIlots,
                corridorWidth: parseFloat(document.getElementById('corridorWidthSlider').value || '1.2')
            })
        });

        if (!response.ok) {
            throw new Error('Corridor generation failed');
        }

        const result = await response.json();
        corridorNetwork = result.corridors || [];

        console.log(`Generated ${corridorNetwork.length} corridors`);
        console.log('First corridor:', corridorNetwork[0]);

        updateStats();

        setTimeout(() => {
            renderCurrentState();
        }, 500);

        showNotification(`Generated ${corridorNetwork.length} corridors (${result.totalArea?.toFixed(2)} m²)`, 'success');
        hideLoader();

    } catch (error) {
        console.error('Corridor generation error:', error);
        hideLoader();
        showNotification('Corridor generation failed: ' + error.message, 'error');
    }
}

async function exportToPDF() {
    if (!currentFloorPlan) {
        showNotification('No floor plan to export.', 'warning');
        return;
    }
    showNotification('Generating PDF...', 'info');
    try {
        const API = (window.__API_BASE__) ? window.__API_BASE__ : 'http://localhost:3001';
        const response = await fetch(`${API}/api/export/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ floorPlan: currentFloorPlan, ilots: generatedIlots, corridors: corridorNetwork })
        });

        const result = await response.json();
        if (result && result.filepath) {
            showNotification('PDF exported: ' + result.filename, 'success');
            // Trigger download
            const API = (window.__API_BASE__) ? window.__API_BASE__ : 'http://localhost:3001';
            window.open(`${API}/exports/${result.filename}`, '_blank');
        } else {
            showNotification('PDF export failed', 'error');
        }
    } catch (e) {
        showNotification('PDF export failed: ' + e.message, 'error');
    }
}

async function exportToImage() {
    if (!currentFloorPlan) {
        showNotification('No floor plan to export.', 'warning');
        return;
    }
    showNotification('Generating Image...', 'info');
    try {
        const API = (window.__API_BASE__) ? window.__API_BASE__ : 'http://localhost:3001';
        const response = await fetch(`${API}/api/export/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ floorPlan: currentFloorPlan, ilots: generatedIlots, corridors: corridorNetwork })
        });

        const result = await response.json();
        if (result && result.filepath) {
            showNotification('Image exported: ' + result.filename, 'success');
            const API = (window.__API_BASE__) ? window.__API_BASE__ : 'http://localhost:3001';
            window.open(`${API}/exports/${result.filename}`, '_blank');
        } else {
            showNotification('Image export failed', 'error');
        }
    } catch (e) {
        showNotification('Image export failed: ' + e.message, 'error');
    }
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// No polling needed - local processing is instant

// Loader helpers
function showLoader(message, percentage = 0) {
    try {
        // Update global loader
        const globalLoader = document.getElementById('globalLoader');
        const loaderMsg = document.getElementById('loaderMessage');
        const loaderPct = document.getElementById('loaderPercentage');
        const progressCircle = document.getElementById('progressCircle');

        if (globalLoader) globalLoader.classList.remove('hidden');
        if (loaderMsg && message) loaderMsg.textContent = message;
        if (loaderPct) loaderPct.textContent = Math.round(percentage) + '%';
        if (progressCircle) {
            const circumference = 339.292;
            const offset = circumference - (percentage / 100) * circumference;
            progressCircle.style.strokeDashoffset = offset;
        }

        // Update sidebar progress
        const sidebarStatus = document.getElementById('processingStatus');
        const sidebarMsg = document.getElementById('progressMessageSmall');
        const sidebarPct = document.getElementById('progressPercentSmall');
        const sidebarCircle = document.getElementById('progressCircleSmall');

        if (sidebarStatus) sidebarStatus.classList.remove('hidden');
        if (sidebarMsg && message) sidebarMsg.textContent = message;
        if (sidebarPct) sidebarPct.textContent = Math.round(percentage) + '%';
        if (sidebarCircle) {
            const circumference = 169.646;
            const offset = circumference - (percentage / 100) * circumference;
            sidebarCircle.style.strokeDashoffset = offset;
        }
    } catch (e) { /* ignore */ }
}

function hideLoader() {
    try {
        const globalLoader = document.getElementById('globalLoader');
        if (globalLoader) globalLoader.classList.add('hidden');

        const sidebarStatus = document.getElementById('processingStatus');
        if (sidebarStatus) sidebarStatus.classList.add('hidden');
    } catch (e) { /* ignore */ }
}
