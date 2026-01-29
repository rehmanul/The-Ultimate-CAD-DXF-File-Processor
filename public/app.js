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
let corridorArrows = [];
let corridorArrowsVisible = true;
let corridorStatistics = null;
let corridorFilters = { showMain: true, showAccess: true };
let renderer = null;
let editor = null;
let effects = null;
let shortcuts = null;
let textLabels = null;
let collisionDetector = null;
let undoManager = null;
let professionalExport = null;
let presetSelector = null;  // Phase 2: Preset selector instance
let multiFloorStack = [];
let multiFloorResult = null;
let activeStackFloorId = null;
let stackVisualizationEnabled = false;
let activePresetConfig = null;

const deepClone = (data) => {
    if (data === null || data === undefined) return data;
    if (typeof structuredClone === 'function') {
        return structuredClone(data);
    }
    if (typeof window !== 'undefined' && typeof window.structuredClone === 'function') {
        return window.structuredClone(data);
    }
    try {
        return JSON.parse(JSON.stringify(data));
    } catch (err) {
        throw new Error(`Deep clone failed: ${err.message}`);
    }
};

document.addEventListener('DOMContentLoaded', function () {
    console.log('✨ FloorPlan Pro - Production System Initialized');
    if (typeof showNotification === 'function') {
        showNotification('FloorPlan Pro loading...', 'info', { duration: 2000 });
    }

    const container = document.getElementById('threeContainer');
    
    // Initialize upload and file input immediately (before renderer) so upload works even if init is delayed
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    if (uploadBtn && fileInput) {
        uploadBtn.type = 'button';
        const triggerUpload = (event) => {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const input = document.getElementById('fileInput');
            if (!input) return;
            try {
                input.value = '';
                input.click();
            } catch (err) {
                console.error('Upload trigger failed:', err);
                if (typeof showNotification === 'function') showNotification('Could not open file dialog: ' + (err.message || 'unknown error'), 'error');
            }
        };
        uploadBtn._triggerUpload = triggerUpload;
        uploadBtn.addEventListener('click', triggerUpload);
        // Attach file input change listener early so file selection works even before renderer init
        fileInput.removeEventListener('change', handleFileUpload);
        fileInput.addEventListener('change', handleFileUpload);
        // Fallback: delegated click on nav-actions so upload works even if button listeners are overwritten
        const navActions = document.querySelector('.nav-actions');
        if (navActions && !navActions._uploadDelegated) {
            navActions._uploadDelegated = true;
            navActions.addEventListener('click', function (e) {
                const btn = e.target && (e.target.id === 'uploadBtn' || e.target.closest('#uploadBtn'));
                if (!btn) return;
                const inp = document.getElementById('fileInput');
                if (inp) {
                    e.preventDefault();
                    e.stopPropagation();
                    inp.value = '';
                    inp.click();
                }
            }, true);
        }
        console.log('Upload button and file input initialized early');
    } else {
        console.warn('Upload button or file input not found during DOMContentLoaded');
    }

    // Initialize UI enhancements
    initializeAutoHide();
    initializeCollapsible();

    // Initialize renderer
    const initRenderer = () => {
        if (!container) {
            console.error('Container element not found');
            showNotification('Canvas container not found. Please refresh the page.', 'error');
            return;
        }

        // Wait for container to have size (with timeout so app always finishes init)
        const initStartedAt = Date.now();
        const INIT_SIZE_WAIT_MS = 5000;
        const checkSize = () => {
            const hasSize = container.clientWidth > 0 && container.clientHeight > 0;
            const waitedLongEnough = (Date.now() - initStartedAt) >= INIT_SIZE_WAIT_MS;
            if (!hasSize && !waitedLongEnough) {
                console.warn('Container has zero size, waiting...', {
                    width: container.clientWidth,
                    height: container.clientHeight
                });
                setTimeout(checkSize, 100);
                return;
            }
            if (!hasSize) {
                console.warn('Container still zero size after ' + INIT_SIZE_WAIT_MS + 'ms; initializing anyway.');
            }

            try {
                if (hasSize) {
                    console.log('Initializing renderer with container size:', {
                        width: container.clientWidth,
                        height: container.clientHeight
                    });
                    renderer = new FloorPlanRenderer(container);
                    if (renderer) {
                        renderer.render();
                        console.log('Renderer initialized and rendered');
                    }
                } else {
                    renderer = null;
                }
            } catch (error) {
                console.error('Failed to initialize renderer:', error);
                renderer = null;
                showNotification('Failed to initialize graphics renderer: ' + error.message, 'error');
            }

            initializeModules();

            if (renderer && renderer.rendererType === 'svg') {
                showNotification('WebGL disabled. Running in 2D fallback mode.', 'warning');
            }

            if (!renderer) {
                showNotification('Graphics disabled (WebGL unavailable). Upload and processing still work, but 3D view is off.', 'warning');
            }
        };

        // Start checking after a short delay to ensure DOM is ready
        setTimeout(checkSize, 50);
    };

    // Wait for DOM to be fully ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initRenderer);
    } else {
        initRenderer();
    }
});

function initializeModules() {
    // Initialize all production modules
    const hasRenderer = !!renderer;
    undoManager = new UndoRedoManager();
    if (hasRenderer) {
        textLabels = new TextLabels(renderer);
        professionalExport = new ProfessionalExport(renderer);
        editor = new InteractiveEditor(renderer, null);
        effects = new AdvancedEffects(renderer);
        shortcuts = new KeyboardShortcuts(renderer, editor, effects, undoManager);
    } else {
        textLabels = null;
        professionalExport = null;
        editor = null;
        effects = null;
        shortcuts = null;
    }

    // Phase 2: Initialize preset selector
    if (window.PresetSelector) {
        const presetContainer = document.getElementById('presetSelectorContainer');
        if (presetContainer) {
            presetSelector = new window.PresetSelector(presetContainer);
            presetSelector.onPresetSelected = (preset) => {
                console.log('Preset selected:', preset);
                applyPresetDistribution(preset);
            };
        }
    }

    // Initialize Edit Tools (requires renderer)
    if (hasRenderer) {
        initializeEditTools();
    }

    // Initialize Unit Mix Import
    initializeUnitMixImport();

    // Initialize Excel Export Buttons
    initializeExportButtons();

    // Phase 2: Distribution input event listeners
    document.querySelectorAll('.distribution-input').forEach(input => {
        input.addEventListener('input', () => {
            updateDistributionTotal();
        });
    });

    initializeMultiFloorControls();


    // Setup editor callbacks with collision detection and undo/redo
    if (editor) {
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
        updateLegendTable(); // Update legend when ilots are rendered
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
        updateLegendTable(); // Update legend when ilots are rendered
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
        updateLegendTable(); // Update legend when ilots are rendered
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
        updateLegendTable(); // Update legend when ilots are rendered
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
        updateLegendTable(); // Update legend when ilots are rendered
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
        updateLegendTable(); // Update legend when ilots are rendered
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
        updateLegendTable(); // Update legend when ilots are rendered
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
    }

    // Top buttons already hidden in HTML

    initializeLayoutChrome();
    initializeHeaderActions();

    // Attach event listeners to UI elements
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        // Remove any existing listeners to prevent duplicates
        fileInput.onchange = null;
        fileInput.removeEventListener('change', handleFileUpload);
        // Add fresh event listener
        fileInput.addEventListener('change', handleFileUpload);
        console.log('File input event listener attached');
    } else {
        console.warn('File input element not found');
    }

    const generateIlotsBtn = document.getElementById('generateIlotsBtn');
    if (generateIlotsBtn) generateIlotsBtn.onclick = generateIlots;

    const generateCorridorsBtn = document.getElementById('generateCorridorsBtn');
    if (generateCorridorsBtn) generateCorridorsBtn.onclick = generateCorridors;

    setupCorridorWidthSlider();

    // Enhancement: Connect 3D toggle to editor
    if (renderer) {
        // Find existing toggle button if any, or just rely on global function
        const originalToggle = renderer.toggle3DMode;
        renderer.toggle3DMode = function () {
            const is3D = originalToggle.call(this);
            if (editor) {
                editor.updateCamera(this.is3DMode ? this.perspectiveCamera : this.camera);
            }
            return is3D;
        };
    }

    const toggleArrowsBtn = document.getElementById('toggleArrowsBtn');
    if (toggleArrowsBtn) {
        toggleArrowsBtn.setAttribute('aria-pressed', corridorArrowsVisible ? 'true' : 'false');
        toggleArrowsBtn.addEventListener('click', () => {
            corridorArrowsVisible = !corridorArrowsVisible;
            if (renderer && renderer.setCorridorArrowsVisible) {
                renderer.setCorridorArrowsVisible(corridorArrowsVisible);
            }
            toggleArrowsBtn.setAttribute('aria-pressed', corridorArrowsVisible ? 'true' : 'false');
            renderCurrentState();
        });
    }

    const showMainCheckbox = document.getElementById('show-main-corridors');
    if (showMainCheckbox) {
        corridorFilters.showMain = showMainCheckbox.checked;
        showMainCheckbox.addEventListener('change', () => {
            corridorFilters.showMain = showMainCheckbox.checked;
            renderCurrentState();
            updateStats();
        });
    }

    const showAccessCheckbox = document.getElementById('show-access-corridors');
    if (showAccessCheckbox) {
        corridorFilters.showAccess = showAccessCheckbox.checked;
        showAccessCheckbox.addEventListener('change', () => {
            corridorFilters.showAccess = showAccessCheckbox.checked;
            renderCurrentState();
            updateStats();
        });
    }

    // Distribution inputs handling
    const distributionInputs = document.querySelectorAll('.distribution-input');
    const applyDistributionBtn = document.getElementById('applyDistributionBtn');

    distributionInputs.forEach(input => {
        input.addEventListener('input', () => updateDistributionTotal());
    });

    if (applyDistributionBtn) {
        applyDistributionBtn.addEventListener('click', () => {
            if (!currentFloorPlan) {
                showNotification('Please upload a floor plan first.', 'warning');
                return;
            }

            const distribution = {};
            const ranges = ['0-1', '1-3', '3-5', '5-10'];
            distributionInputs.forEach(input => {
                const index = Number(input.dataset.index);
                const percentage = parseFloat(input.value) || 0;
                distribution[ranges[index]] = percentage;
            });

            let normalized;
            try {
                normalized = normalizePresetDistribution(distribution);
            } catch (error) {
                showNotification(error.message || 'Invalid distribution', 'error');
                return;
            }
            const normalizedPercentages = {};
            Object.entries(normalized).forEach(([range, weight]) => {
                normalizedPercentages[range] = +(weight * 100).toFixed(2);
            });
            activePresetConfig = {
                id: 'custom-manual',
                name: 'Manual mix',
                rawDistribution: { ...normalizedPercentages },
                normalizedDistribution: normalized,
                corridorWidth: getActiveCorridorWidth(),
                options: {},
                metadata: { custom: true }
            };

            const distributionEditor = document.getElementById('distributionEditor');
            if (distributionEditor) {
                distributionEditor.value = JSON.stringify(normalized, null, 2);
            }

            updateActivePresetSummary(activePresetConfig);
            showNotification('Distribution updated.', 'info', {
                description: 'Regenerate îlots to apply the custom mix.',
                action: currentFloorPlan ? {
                    label: 'Regenerate now',
                    callback: () => generateIlots()
                } : null
            });
        });
    }

    // Apply distribution button was handled above. Now initialize totals.
    updateDistributionTotal();

    // Distribution editor (hidden, used internally)
    const distributionEditor = document.createElement('textarea');
    distributionEditor.id = 'distributionEditor';
    distributionEditor.style.display = 'none';
    distributionEditor.value = JSON.stringify({}, null, 2);
    document.body.appendChild(distributionEditor);

    // Initialize total display
    updateDistributionTotal();

    const exportPdfBtn = document.getElementById('exportPdfBtn');
    if (exportPdfBtn) exportPdfBtn.onclick = exportToPDF;

    const exportImageBtn = document.getElementById('exportImageBtn');
    if (exportImageBtn) exportImageBtn.onclick = exportToImage;

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

    // Door placement functionality
    let doorPlacementMode = null; // '0.75' or '1.0' or null
    let doorPlacementStart = null;

    const door075Btn = document.getElementById('door075Btn');
    const door1mBtn = document.getElementById('door1mBtn');
    const cancelDoorBtn = document.getElementById('cancelDoorBtn');

    function activateDoorMode(width) {
        doorPlacementMode = width;
        doorPlacementStart = null;
        if (door075Btn) door075Btn.classList.toggle('active', width === '0.75');
        if (door1mBtn) door1mBtn.classList.toggle('active', width === '1.0');
        showNotification(`Door placement mode: ${width}m - Click on a wall to place door`, 'info');
    }

    function cancelDoorMode() {
        doorPlacementMode = null;
        doorPlacementStart = null;
        if (door075Btn) door075Btn.classList.remove('active');
        if (door1mBtn) door1mBtn.classList.remove('active');
        showNotification('Door placement cancelled', 'info');
    }

    if (door075Btn) {
        door075Btn.addEventListener('click', () => {
            if (doorPlacementMode === '0.75') {
                cancelDoorMode();
            } else {
                activateDoorMode('0.75');
            }
        });
    }

    if (door1mBtn) {
        door1mBtn.addEventListener('click', () => {
            if (doorPlacementMode === '1.0') {
                cancelDoorMode();
            } else {
                activateDoorMode('1.0');
            }
        });
    }

    if (cancelDoorBtn) {
        cancelDoorBtn.addEventListener('click', cancelDoorMode);
    }

    // Handle door placement on canvas click
    if (renderer && container) {
        container.addEventListener('click', (e) => {
            if (!doorPlacementMode || !currentFloorPlan) return;

            // Get mouse position in world coordinates
            const rect = container.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, renderer.camera);

            // Find nearest wall
            const walls = currentFloorPlan.walls || [];
            let nearestWall = null;
            let nearestDistance = Infinity;
            let nearestPoint = null;

            walls.forEach(wall => {
                if (wall.start && wall.end) {
                    const wallStart = new THREE.Vector3(wall.start.x, wall.start.y, 0);
                    const wallEnd = new THREE.Vector3(wall.end.x, wall.end.y, 0);
                    const wallDir = new THREE.Vector3().subVectors(wallEnd, wallStart);
                    const wallLength = wallDir.length();
                    wallDir.normalize();

                    // Project mouse point onto wall line
                    const mousePoint = raycaster.ray.origin;
                    const toMouse = new THREE.Vector3().subVectors(mousePoint, wallStart);
                    const projection = toMouse.dot(wallDir);
                    const clampedProjection = Math.max(0, Math.min(projection, wallLength));
                    const closestPoint = new THREE.Vector3().addVectors(wallStart, wallDir.multiplyScalar(clampedProjection));

                    const distance = mousePoint.distanceTo(closestPoint);
                    if (distance < nearestDistance && distance < 2.0) { // Within 2m of wall
                        nearestDistance = distance;
                        nearestWall = wall;
                        nearestPoint = { x: closestPoint.x, y: closestPoint.y };
                    }
                }
            });

            if (nearestWall && nearestPoint) {
                const doorWidth = parseFloat(doorPlacementMode);
                const door = {
                    id: `door_${Date.now()}`,
                    position: nearestPoint,
                    width: doorWidth,
                    wall: nearestWall,
                    type: 'door'
                };

                // Add door to floor plan
                if (!currentFloorPlan.doors) currentFloorPlan.doors = [];
                currentFloorPlan.doors.push(door);

                // Render door
                if (renderer.addDoor) {
                    renderer.addDoor(door);
                }

                showNotification(`Door (${doorWidth}m) placed successfully`, 'success');
                cancelDoorMode();
            } else {
                showNotification('Click near a wall to place door', 'warning');
            }
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

    const exportReferencePdfBtn = document.getElementById('exportReferencePdfBtn');
    if (exportReferencePdfBtn) {
        exportReferencePdfBtn.addEventListener('click', async () => {
            if (!currentFloorPlan) {
                showNotification('No floor plan loaded', 'warning');
                return;
            }
            if (!generatedIlots || generatedIlots.length === 0) {
                showNotification('Generate ilots first', 'warning');
                return;
            }
            
            try {
                showNotification('Exporting reference-style PDF...', 'info');
                const API = window.__API_BASE__ || window.location.origin;
                
                // Convert ilots to boxes format - ensure all data is included
                const boxes = generatedIlots.map(ilot => {
                    const area = ilot.area || (ilot.width * ilot.height) || 0;
                    // Use pre-calculated unitSize from renderer if available
                    const unitSize = ilot.unitSize || (() => {
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
                            closest = Math.round(area * 2) / 2;
                        }
                        return closest;
                    })();
                    
                    return {
                        id: ilot.id || `BOX_${generatedIlots.indexOf(ilot) + 1}`,
                        x: ilot.x || 0,
                        y: ilot.y || 0,
                        width: ilot.width || 0,
                        height: ilot.height || 0,
                        area: area,
                        unitSize: unitSize, // Pre-calculated unit size for export consistency
                        type: ilot.type || ilot.sizeCategory || 'M',
                        zone: ilot.zone || '',
                        row: ilot.row || 0
                    };
                });
                
                // Convert corridors
                const corridors = corridorNetwork.map(corridor => ({
                    corners: corridor.polygon || (corridor.corners || []),
                    width: corridor.width || 1.2
                }));
                
                const solution = {
                    boxes: boxes,
                    corridors: corridors
                };
                
                // Ensure floorPlan includes all necessary data
                const exportFloorPlan = {
                    ...currentFloorPlan,
                    doors: currentFloorPlan.doors || [], // Include doors
                    dimensions: currentFloorPlan.dimensions || [], // Include dimensions
                    rooms: currentFloorPlan.rooms || [], // Include rooms with numbers
                    envelope: currentFloorPlan.envelope || [], // Include envelope
                    annotations: currentFloorPlan.annotations || [], // Include annotations
                    functionalAreas: currentFloorPlan.functionalAreas || [], // Include functional areas
                    specialRooms: currentFloorPlan.specialRooms || [], // Include RM-xxx rooms
                    greenZones: currentFloorPlan.greenZones || [] // Include green zones
                };
                
                const response = await fetch(`${API}/api/costo/export/reference-pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        solution: solution,
                        floorPlan: exportFloorPlan,
                        metrics: {
                            totalArea: currentFloorPlan.totalArea || 0,
                            yieldRatio: 0.85,
                            unitMixCompliance: 0.95,
                            totalBoxes: boxes.length
                        },
                        options: {
                            pageSize: 'A1',
                            title: 'COSTO V1 - Storage Layout',
                            showLegend: true,
                            showTitleBlock: true,
                            scale: '1:100',
                            drawingNumber: '[01]',
                            showDimensions: true,
                            showUnitLabels: true,
                            showAreas: true, // Ensure areas are shown
                            showDoors: true // Ensure doors are shown
                        }
                    })
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Export failed');
                }
                
                const result = await response.json();
                
                // Download the file
                const downloadResponse = await fetch(`${API}/exports/${result.filename}`);
                const blob = await downloadResponse.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                showNotification('Reference PDF exported successfully!', 'success');
            } catch (error) {
                console.error('Reference PDF export error:', error);
                showNotification('Export failed: ' + error.message, 'error');
            }
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
                const API = window.__API_BASE__ || window.location.origin;
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
                const API = window.__API_BASE__ || window.location.origin;
                const resp = await fetch(`${API}/api/optimize/paths`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ floorPlan: currentFloorPlan, ilots: generatedIlots }) });
                const j = await resp.json();
                if (j && Array.isArray(j.corridors)) {
                    corridorNetwork = j.corridors;
                    corridorArrows = Array.isArray(j.arrows) ? j.arrows : [];
                    corridorStatistics = null;
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
    console.log('handleFileUpload called', e);
    
    // Handle both direct file input events and programmatic calls
    const target = e?.target || e?.currentTarget || document.getElementById('fileInput');
    if (!target) {
        console.error('No file input target found');
        showNotification('File input not found. Please refresh the page.', 'error');
        return;
    }
    
    if (!target.files || !target.files[0]) {
        console.warn('No file selected');
        return;
    }

    const file = target.files[0];
    console.log('Processing file:', file.name, file.type, file.size);
    try {
        showLoader('Uploading file...');
        const formData = new FormData();
        formData.append('file', file);

        // Use current origin for API (works in production)
        const API = window.__API_BASE__ || window.location.origin;
        console.log('Uploading to:', `${API}/api/jobs`);
        
        const response = await fetch(`${API}/api/jobs`, {
            method: 'POST',
            body: formData,
            // Don't set Content-Type - let browser set it with boundary for multipart/form-data
        });

        const result = await response.json();

        if (result.success === false) {
            throw new Error(result.error || 'Server processing failed');
        }

        // Handle different response structures
        let analysisData;
        if (result.cadData) {
            analysisData = result.cadData;
        } else if (result.walls || result.bounds) {
            // Response is the data itself
            analysisData = result;
        } else if (result.data && result.data.cadData) {
            // Nested data structure
            analysisData = result.data.cadData;
        } else {
            console.error('Unexpected response structure:', result);
            throw new Error('Invalid server response format');
        }

        currentFloorPlan = {
            urn: result.urn || result.id || `local_${Date.now()}`,
            walls: analysisData.walls || [],
            forbiddenZones: analysisData.forbiddenZones || [],
            entrances: analysisData.entrances || [],
            bounds: analysisData.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
            totalArea: analysisData.totalArea || 0,
            rooms: analysisData.rooms || [],
            placementTransform: analysisData.placementTransform || null,
            sourceFile: file.name,
            name: file.name ? file.name.replace(/\.[^.]+$/, '') : (result.urn || 'Untitled'),
            uploadedAt: new Date().toISOString()
        };

        generatedIlots = [];
        corridorNetwork = [];
        corridorArrows = [];
        corridorStatistics = null;
        corridorArrowsVisible = true;
        const showMainCorridorsCheckbox = document.getElementById('show-main-corridors');
        if (showMainCorridorsCheckbox) {
            showMainCorridorsCheckbox.checked = true;
            corridorFilters.showMain = true;
        }
        const showAccessCorridorsCheckbox = document.getElementById('show-access-corridors');
        if (showAccessCorridorsCheckbox) {
            showAccessCorridorsCheckbox.checked = true;
            corridorFilters.showAccess = true;
        }
        const toggleArrowsBtn = document.getElementById('toggleArrowsBtn');
        if (toggleArrowsBtn) {
            toggleArrowsBtn.setAttribute('aria-pressed', 'true');
        }
        console.log('currentFloorPlan created:', currentFloorPlan);

        updateActivePlanSummary(currentFloorPlan);
        updateStats();
        refreshRoomList();

        // Initialize collision detection
        collisionDetector = new CollisionDetection(currentFloorPlan);
        editor.collisionDetector = collisionDetector;

        // Load floor plan into Three.js renderer with color coding
        if (renderer) {
            try {
                renderer.loadFloorPlan(currentFloorPlan);
                // Force render immediately
                renderer.render();
                // Fit to bounds and center - wait for render to complete
                setTimeout(() => {
                    try {
                        if (currentFloorPlan.bounds) {
                            renderer.fitToBounds(currentFloorPlan.bounds);
                        }
                        // Render again after fitting
                        renderer.render();
                    } catch (error) {
                        console.error('Error fitting to bounds:', error);
                    }
                }, 100);
                if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
                    window.requestAnimationFrame(() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    });
                }
            } catch (error) {
                console.error('Error loading floor plan into renderer:', error);
                showNotification('Error rendering floor plan: ' + error.message, 'error');
            }
        } else {
            console.warn('Renderer not available when trying to load floor plan');
            showNotification('Renderer not initialized. Please refresh the page.', 'warning');
        }

        // Room labels are off by default for clean plan output
        const showRoomLabels = false;
        if (showRoomLabels && textLabels && currentFloorPlan.rooms) {
            currentFloorPlan.rooms.forEach((room, i) => textLabels.addRoomLabel(room, i));
        }

        // Show legend
        showLegend();

        hideLoader();
        showNotification(`File processed successfully! ${currentFloorPlan.rooms.length} rooms detected.`, 'success');

        activeStackFloorId = null;
        multiFloorResult = null;
        if (renderer) renderer.renderConnectors([]);
        refreshMultiFloorUI();

    } catch (error) {
        hideLoader();
        showNotification('Upload failed: ' + error.message, 'error');
    }
}

function updateStats() {
    if (currentFloorPlan) {
        document.getElementById('roomCount').textContent = currentFloorPlan.rooms?.length || 0;
        document.getElementById('totalArea').textContent = `${currentFloorPlan.totalArea ? currentFloorPlan.totalArea.toFixed(2) : 0} m²`;
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
    if (corridorList) {
        corridorList.innerHTML = '';
        const corridorsToDisplay = getFilteredCorridors();
        if (corridorNetwork.length === 0) {
            corridorList.innerHTML = '<div class="list-item">No corridors generated yet</div>';
        } else if (corridorsToDisplay.length === 0) {
            corridorList.innerHTML = '<div class="list-item">All corridor types hidden</div>';
        } else {
            corridorsToDisplay.forEach((corridor, index) => {
                const item = document.createElement('div');
                item.className = 'list-item';
                const label = corridor.type ? corridor.type.replace(/_/g, ' ') : 'Standard';
                item.textContent = `Corridor ${index + 1} - Type: ${label}`;
                corridorList.appendChild(item);
            });
        }
    }

    updateCorridorStatsPanel();
}

function renderCurrentState() {
    if (!renderer) {
        console.warn('Renderer not available for renderCurrentState');
        return;
    }
    
    try {
        console.log('renderCurrentState called:', generatedIlots.length, 'ilots,', corridorNetwork.length, 'corridors');
        
        // Ensure floor plan is loaded
        if (currentFloorPlan) {
            renderer.loadFloorPlan(currentFloorPlan);
        }
        
        // Render ilots
        if (generatedIlots.length > 0) {
            renderer.renderIlots(generatedIlots);
            updateLegendTable(); // Update legend when ilots are rendered
        }

        // Only render arrows (circulation indicators), not solid corridor rectangles
        if (renderer.renderCorridorArrows && corridorArrows.length > 0) {
            renderer.renderCorridorArrows(corridorArrows);
            renderer.setCorridorArrowsVisible(corridorArrowsVisible);
            // Hide solid corridors when arrows are available
            renderer.renderCorridors([]);
        } else {
            // Render solid corridors when arrows are unavailable
            renderer.renderCorridors(getFilteredCorridors());
        }

        if (!stackVisualizationEnabled && renderer.clearCrossFloorRoutes) {
            renderer.clearCrossFloorRoutes();
        }
        
        // Ensure final render
        renderer.render();
    } catch (e) {
        console.error('renderCurrentState error:', e);
    }
    updateConnectorVisualization();

    // Update variance display after rendering ilots
    if (generatedIlots.length > 0) {
        updateVarianceDisplay();
    }
}

function getFilteredCorridors() {
    if (!Array.isArray(corridorNetwork)) return [];
    return corridorNetwork.filter((corridor) => {
        const type = (corridor?.type || '').toLowerCase();
        if (!corridorFilters.showMain && (type === 'main' || type === 'vertical' || type === 'vertical_spine')) {
            return false;
        }
        if (!corridorFilters.showAccess && (type === 'access' || type === 'entrance')) {
            return false;
        }
        return true;
    });
}

function computeCorridorCounts(sourceCorridors) {
    const counts = {
        main: 0,
        vertical: 0,
        connecting: 0,
        access: 0
    };

    if (!Array.isArray(sourceCorridors) || sourceCorridors.length === 0) {
        return counts;
    }

    sourceCorridors.forEach((c) => {
        const type = (c?.type || '').toLowerCase();
        if (type.includes('main') || type.includes('vertical') || type.includes('spine')) {
            counts.main++;
        } else if (type.includes('connecting')) {
            counts.connecting++;
        } else if (type.includes('access') || type.includes('entrance')) {
            counts.access++;
        } else {
            // Default unclassified corridors to access
            counts.access++;
        }
    });

    return counts;
}

function updateCorridorStatsPanel() {
    const mainEl = document.getElementById('statsMainCorridors');
    const connectingEl = document.getElementById('statsConnectingCorridors');
    const accessEl = document.getElementById('statsAccessCorridors');
    const arrowEl = document.getElementById('statsArrowCount');

    if (!mainEl || !connectingEl || !accessEl || !arrowEl) return;

    // Use corridorArrows to classify when corridorNetwork is empty
    const sourceData = corridorNetwork.length > 0 ? corridorNetwork : corridorArrows;

    if (corridorStatistics && corridorNetwork.length > 0) {
        mainEl.textContent = String((corridorStatistics.main_corridors ?? 0) + (corridorStatistics.vertical_corridors ?? 0));
        connectingEl.textContent = String(corridorStatistics.connecting_corridors ?? 0);
        accessEl.textContent = String(corridorStatistics.access_corridors ?? 0);
    } else {
        const counts = computeCorridorCounts(sourceData);
        mainEl.textContent = String(counts.main + counts.vertical);
        connectingEl.textContent = String(counts.connecting);
        accessEl.textContent = String(counts.access);
    }

    arrowEl.textContent = String(corridorArrows.length || 0);

    // Update the main statistics card "Corridors" count
    const totalCorridorCount = document.getElementById('corridorCount');
    if (totalCorridorCount) {
        const count = corridorNetwork.length > 0 ? corridorNetwork.length : (corridorArrows.length > 0 ? corridorArrows.length : 0);
        totalCorridorCount.textContent = String(count);
    }
}

function initializeMultiFloorControls() {
    const addBtn = document.getElementById('addFloorToStackBtn');
    if (addBtn) addBtn.addEventListener('click', addCurrentFloorToStack);

    const computeBtn = document.getElementById('computeMultiFloorBtn');
    if (computeBtn) computeBtn.addEventListener('click', computeMultiFloorStack);

    const clearBtn = document.getElementById('clearMultiFloorBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearMultiFloorStack);

    const profileBtn = document.getElementById('profileStackBtn');
    if (profileBtn) profileBtn.addEventListener('click', profileMultiFloorStack);

    const previewBtn = document.getElementById('previewStackBtn');
    if (previewBtn) previewBtn.addEventListener('click', toggleStackVisualization);

    const reportBtn = document.getElementById('reportStackBtn');
    if (reportBtn) reportBtn.addEventListener('click', generateMultiFloorReport);

    const floorList = document.getElementById('multiFloorList');
    if (floorList) {
        floorList.addEventListener('click', (event) => {
            const target = event.target.closest('[data-floor-id]');
            if (!target) return;
            selectStackFloor(target.getAttribute('data-floor-id'));
        });
    }

    const floorHeightInput = document.getElementById('floorHeightInput');
    if (floorHeightInput && !floorHeightInput.value) floorHeightInput.value = '3.2';
    if (floorHeightInput) {
        floorHeightInput.addEventListener('change', () => {
            if (stackVisualizationEnabled) {
                updateStackVisualization();
            } else {
                updateConnectorVisualization();
            }
        });
    }

    const toleranceInput = document.getElementById('connectorToleranceInput');
    if (toleranceInput && !toleranceInput.value) toleranceInput.value = '1.25';

    const egressInput = document.getElementById('egressLimitInput');
    if (egressInput && !egressInput.value) egressInput.value = '45';

    const accessibleInput = document.getElementById('accessibleEntrancesInput');
    if (accessibleInput && !accessibleInput.value) accessibleInput.value = '1';

    if (typeof document !== 'undefined') {
        const requireElevator = document.getElementById('requireElevatorToggle');
        if (requireElevator && requireElevator.checked === undefined) requireElevator.checked = true;
    }

    refreshMultiFloorUI();
    updateStackPreviewButton();
}

function addCurrentFloorToStack() {
    if (!currentFloorPlan) {
        showNotification('Upload and process a floor plan before adding to the stack.', 'warning');
        return;
    }

    const levelInput = document.getElementById('floorLevelInput');
    const nameInput = document.getElementById('floorNameInput');

    let level = levelInput ? parseInt(levelInput.value, 10) : multiFloorStack.length;
    if (Number.isNaN(level)) level = multiFloorStack.length;

    const floorName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : (currentFloorPlan.name || `Floor ${level}`);

    const existing = multiFloorStack.find(entry => entry.level === level);
    const floorId = existing ? existing.id : `stack_${Date.now()}`;

    const entry = {
        id: floorId,
        name: floorName,
        level,
        floorPlan: deepClone(currentFloorPlan),
        ilots: deepClone(generatedIlots),
        corridors: deepClone(corridorNetwork),
        arrows: deepClone(corridorArrows),
        corridor_statistics: corridorStatistics ? deepClone(corridorStatistics) : null,
        presetConfig: activePresetConfig ? deepClone(activePresetConfig) : null,
        metadata: {
            source: currentFloorPlan.sourceFile || currentFloorPlan.urn || floorName,
            rooms: currentFloorPlan.rooms?.length || 0,
            totalArea: currentFloorPlan.totalArea || 0
        }
    };

    if (existing) {
        const index = multiFloorStack.findIndex(item => item.id === existing.id);
        multiFloorStack.splice(index, 1, entry);
    } else {
        multiFloorStack.push(entry);
    }

    activeStackFloorId = entry.id;
    multiFloorResult = null;
    stackVisualizationEnabled = false;
    if (renderer) {
        renderer.renderConnectors([]);
        renderer.clearStackedFloors && renderer.clearStackedFloors();
    }

    refreshMultiFloorUI();
    updateStackPreviewButton();
    updateConnectorVisualization();
    showNotification(`Floor "${floorName}" saved to stack (level ${level}).`, 'success');
}

async function computeMultiFloorStack() {
    if (multiFloorStack.length === 0) {
        showNotification('Add one or more floors to the stack first.', 'warning');
        return;
    }

    try {
        showLoader('Aligning stacked floors...', 25);
        const API = window.__API_BASE__ || window.location.origin;

        const payload = {
            floors: multiFloorStack.map(entry => ({
                id: entry.id,
                name: entry.name,
                level: entry.level,
                floorPlan: entry.floorPlan,
                ilots: entry.ilots,
                corridors: entry.corridors
            })),
            options: getMultiFloorOptions()
        };

        const response = await fetch(`${API}/api/multi-floor/stack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Multi-floor stack failed');
        }

        multiFloorResult = data.result;
        if (multiFloorResult && data.metrics) {
            multiFloorResult.metrics = data.metrics;
        }

        try {
            await fetchCrossFloorCorridors();
        } catch (error) {
            console.error('Cross-floor corridor computation failed:', error);
            if (multiFloorResult) multiFloorResult.crossFloorCorridors = null;
        }

        if (multiFloorResult?.floors?.length) {
            const floorIds = multiFloorResult.floors.map(f => f.id);
            if (!activeStackFloorId || !floorIds.includes(activeStackFloorId)) {
                activeStackFloorId = floorIds[0];
            }
        }

        refreshMultiFloorUI();
        updateStackPreviewButton();
        if (stackVisualizationEnabled) {
            updateStackVisualization(true);
        } else {
            updateConnectorVisualization();
        }

        const connectorCount = multiFloorResult.connectors?.length || 0;
        showNotification(`Multi-floor stack computed: ${multiFloorStack.length} floors, ${connectorCount} connectors.`, 'success');
    } catch (error) {
        console.error('Multi-floor stack error', error);
        showNotification('Multi-floor stack failed: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

function clearMultiFloorStack() {
    multiFloorStack = [];
    multiFloorResult = null;
    activeStackFloorId = null;
    stackVisualizationEnabled = false;
    if (renderer) {
        renderer.renderConnectors([]);
        renderer.clearStackedFloors && renderer.clearStackedFloors();
        renderer.clearCrossFloorRoutes && renderer.clearCrossFloorRoutes();
    }
    refreshMultiFloorUI();
    updateStackPreviewButton();
    updateConnectorVisualization();
    renderCurrentState();
    showNotification('Multi-floor stack cleared.', 'info');
}

function selectStackFloor(floorId) {
    const entry = multiFloorStack.find(item => item.id === floorId);
    if (!entry) return;

    activeStackFloorId = entry.id;
    currentFloorPlan = deepClone(entry.floorPlan);
    generatedIlots = deepClone(entry.ilots || []);
    corridorNetwork = deepClone(entry.corridors || []);
    corridorArrows = deepClone(entry.arrows || []);
    corridorStatistics = entry.corridor_statistics ? deepClone(entry.corridor_statistics) : null;
    activePresetConfig = entry.presetConfig ? deepClone(entry.presetConfig) : activePresetConfig;
    if (entry.presetConfig) {
        syncPresetUIFromConfig(activePresetConfig);
    } else {
        updateActivePresetSummary(activePresetConfig);
    }

    collisionDetector = new CollisionDetection(currentFloorPlan);
    if (editor) editor.collisionDetector = collisionDetector;

    if (renderer) {
        try {
            renderer.loadFloorPlan(currentFloorPlan);
            renderer.renderIlots(generatedIlots);
            updateLegendTable(); // Update legend when ilots are rendered
            renderer.renderCorridors(getFilteredCorridors());
            if (renderer.renderCorridorArrows) {
                renderer.renderCorridorArrows(corridorArrows);
                renderer.setCorridorArrowsVisible(corridorArrowsVisible);
            }
            renderer.render(); // Ensure final render
        } catch (error) {
            console.error('Error rendering stack floor:', error);
            showNotification('Error rendering floor: ' + error.message, 'error');
        }
    }

    if (textLabels) {
        const showRoomLabels = false;
        textLabels.clear();
        if (showRoomLabels) {
            (currentFloorPlan.rooms || []).forEach((room, index) => textLabels.addRoomLabel(room, index));
        }
    }

    const levelInput = document.getElementById('floorLevelInput');
    if (levelInput) levelInput.value = entry.level;
    const nameInput = document.getElementById('floorNameInput');
    if (nameInput) nameInput.value = entry.name || '';

    updateActivePlanSummary(entry.name || currentFloorPlan);
    refreshRoomList();
    updateStats();
    updateConnectorVisualization();
    refreshMultiFloorUI();
    updateStackPreviewButton();
    updateStackVisualization();
}

function refreshMultiFloorUI() {
    const statusEl = document.getElementById('multiFloorStatus');
    if (statusEl) {
        if (!multiFloorStack.length) {
            statusEl.textContent = 'No floors added to stack yet.';
        } else {
            const metrics = multiFloorResult?.metrics;
            let summary = `${multiFloorStack.length} floor(s) staged for stacking`;
            if (metrics) {
                const duration = typeof metrics.durationMs === 'number' ? metrics.durationMs.toFixed(1) : metrics.durationMs;
                summary += `<span class="stack-metric">Stack time: ${duration} ms • Connectors: ${metrics.connectorCount || 0} • Warnings: ${metrics.warningCount || 0}</span>`;
            }
            statusEl.innerHTML = summary;
        }
    }

    const listEl = document.getElementById('multiFloorList');
    if (listEl) {
        listEl.innerHTML = '';
        if (!multiFloorStack.length) {
            listEl.innerHTML = '<div class="list-item muted">Add processed floors to build a stacked model.</div>';
        } else {
            multiFloorStack
                .slice()
                .sort((a, b) => a.level - b.level)
                .forEach(entry => {
                    const item = document.createElement('div');
                    item.className = 'multi-floor-item' + (entry.id === activeStackFloorId ? ' active' : '');
                    item.setAttribute('data-floor-id', entry.id);

                    const connectorSummary = multiFloorResult
                        ? (multiFloorResult.connectors || []).filter(conn => conn.floorId === entry.id)
                        : [];

                    item.innerHTML = `
                        <div class="multi-floor-title">${entry.name || `Floor ${entry.level}`}</div>
                        <div class="multi-floor-meta">
                            Level ${entry.level} • Rooms: ${entry.metadata?.rooms ?? entry.floorPlan.rooms?.length ?? 0}
                            ${connectorSummary.length ? ` • Connectors: ${connectorSummary.length}` : ''}
                        </div>
                    `;
                    listEl.appendChild(item);
                });
        }
    }

    const warningEl = document.getElementById('multiFloorWarnings');
    if (warningEl) {
        warningEl.innerHTML = '';
        const warnings = multiFloorResult?.warnings || [];
        if (!warnings.length) {
            warningEl.innerHTML = '<div class="list-item success">All floors aligned within tolerance.</div>';
        } else {
            warnings.forEach((warning) => {
                const item = document.createElement('div');
                item.className = 'list-item warning';
                item.textContent = warning;
                warningEl.appendChild(item);
            });
        }
    }

    const connectorListEl = document.getElementById('multiFloorConnectorList');
    if (connectorListEl) {
        connectorListEl.innerHTML = '';
        if (!multiFloorResult?.connectors?.length) {
            connectorListEl.innerHTML = '<div class="list-item muted">Stack to see vertical circulation summaries.</div>';
        } else {
            multiFloorStack
                .slice()
                .sort((a, b) => a.level - b.level)
                .forEach(entry => {
                    const connectors = (multiFloorResult.connectors || []).filter(conn => conn.floorId === entry.id);
                    if (!connectors.length) return;
                    const container = document.createElement('div');
                    container.className = 'list-item';
                    const stairCount = connectors.filter(c => c.type === 'stair' || c.type === 'escalator').length;
                    const elevatorCount = connectors.filter(c => c.type === 'elevator').length;
                    container.innerHTML = `
                        <div class="connector-floor-label">${entry.name || `Floor ${entry.level}`}</div>
                        <div class="connector-floor-stats">
                            <span>Stairs: ${stairCount}</span>
                            <span>Elevators: ${elevatorCount}</span>
                            <span>Total connectors: ${connectors.length}</span>
                        </div>
                    `;
                    connectorListEl.appendChild(container);
                });
        }
    }

    const routesEl = document.getElementById('multiFloorRoutes');
    if (routesEl) {
        routesEl.innerHTML = '';
        const cross = multiFloorResult?.crossFloorCorridors;
        if (!cross || !cross.routes || cross.routes.length === 0) {
            routesEl.innerHTML = '<div class="list-item muted">Compute stack to generate cross-floor routes.</div>';
        } else {
            const unreachable = cross.summary?.unreachable?.length || 0;
            const metrics = multiFloorResult?.crossFloorCorridorMetrics;
            const item = document.createElement('div');
            item.className = 'connector-floor-stats';
            item.innerHTML = `
                <span>Routes: ${cross.routes.length}</span>
                <span>Segments: ${cross.segments?.length || 0}</span>
                <span>Unreachable connectors: ${unreachable}</span>
                ${metrics ? `<span>Duration: ${metrics.durationMs?.toFixed?.(1) || metrics.durationMs} ms</span>` : ''}
            `;
            routesEl.appendChild(item);
        }
    }

    const profileEl = document.getElementById('multiFloorProfile');
    if (profileEl) {
        profileEl.innerHTML = '';
        const profile = multiFloorResult?.profile;
        if (!profile) {
            profileEl.innerHTML = '<div class="list-item muted">Profile the stack to gather timing metrics.</div>';
        } else {
            const item = document.createElement('div');
            item.className = 'connector-floor-stats';
            const stackAvg = profile.stack?.averageMs;
            const routeAvg = profile.routing?.averageMs;
            item.innerHTML = `
                <span>Iterations: ${profile.parameters?.iterations || 0}</span>
                <span>Floors tested: ${profile.parameters?.floorCount || 0}</span>
                <span>Avg stack: ${stackAvg !== undefined ? stackAvg.toFixed(1) : '0'} ms</span>
                <span>Avg routing: ${routeAvg !== undefined ? routeAvg.toFixed(1) : '0'} ms</span>
            `;
            profileEl.appendChild(item);
            if (profile.parameters?.autoExpanded) {
                const note = document.createElement('div');
                note.className = 'list-item muted';
                note.textContent = 'Floor set auto-expanded to meet profiling target.';
                profileEl.appendChild(note);
            }
        }
    }

    const reportEl = document.getElementById('multiFloorReport');
    if (reportEl) {
        reportEl.innerHTML = '';
        const report = multiFloorResult?.report;
        if (!report) {
            reportEl.innerHTML = '<div class="list-item muted">Generate a report to capture current metrics.</div>';
        } else {
            const item = document.createElement('div');
            item.className = 'connector-floor-stats';
            item.innerHTML = `
                <span>Generated: ${new Date(report.generatedAt).toLocaleString()}</span>
                <span>Floors: ${report.summary?.floorCount || 0}</span>
                <span>Connectors: ${report.summary?.connectors?.total || 0}</span>
                <span>Routes: ${report.summary?.routes?.total || 0}</span>
            `;
            reportEl.appendChild(item);
        }
    }

    const complianceEl = document.getElementById('multiFloorCompliance');
    if (complianceEl) {
        complianceEl.innerHTML = '';
        if (!multiFloorResult?.compliance) {
            complianceEl.innerHTML = '<div class="list-item muted">Run stacking to evaluate cross-floor compliance.</div>';
        } else {
            const { egress, accessibility } = multiFloorResult.compliance;
            const summary = document.createElement('div');
            summary.className = 'compliance-summary';
            summary.innerHTML = `
                <div>Egress: ${multiFloorResult.stats?.complianceSummary?.egress?.passCount || 0} pass / ${multiFloorResult.stats?.complianceSummary?.egress?.failCount || 0} fail</div>
                <div>Accessibility: ${multiFloorResult.stats?.complianceSummary?.accessibility?.passCount || 0} pass / ${multiFloorResult.stats?.complianceSummary?.accessibility?.failCount || 0} fail</div>
            `;
            complianceEl.appendChild(summary);

            const details = document.createElement('div');
            details.className = 'compliance-details';

            (egress?.floors || []).forEach(report => {
                const item = document.createElement('div');
                item.className = 'compliance-item ' + (report.pass ? 'pass' : 'fail');
                item.innerHTML = `
                    <div class="compliance-title">Floor ${report.floorLevel}</div>
                    <div class="compliance-metrics">
                        <span>Rooms evaluated: ${report.evaluatedRooms}</span>
                        <span>Max egress: ${report.maxDistance ? report.maxDistance.toFixed(1) : 'N/A'} m</span>
                        <span>Status: ${report.pass ? 'PASS' : 'FAIL'}</span>
                    </div>
                    ${report.violations && report.violations.length
                        ? `<div class="compliance-notes">${report.violations.join('<br>')}</div>` : ''}
                `;
                details.appendChild(item);
            });

            (accessibility?.floors || []).forEach(report => {
                const item = document.createElement('div');
                item.className = 'compliance-item ' + (report.pass ? 'pass' : 'fail');
                item.innerHTML = `
                    <div class="compliance-title">Floor ${report.floorLevel}</div>
                    <div class="compliance-metrics">
                        <span>Elevator: ${report.hasElevator ? 'Yes' : 'No'}</span>
                        <span>Stairs: ${report.stairCount}</span>
                        <span>Accessible entrances: ${report.accessibleEntrances}</span>
                        <span>Status: ${report.pass ? 'PASS' : 'FAIL'}</span>
                    </div>
                    ${report.notes && report.notes.length ? `<div class="compliance-notes">${report.notes.join('<br>')}</div>` : ''}
                `;
                details.appendChild(item);
            });

            complianceEl.appendChild(details);
        }
    }

    updateStackPreviewButton();
}

function getMultiFloorOptions() {
    const floorHeightInput = document.getElementById('floorHeightInput');
    const toleranceInput = document.getElementById('connectorToleranceInput');
    const egressInput = document.getElementById('egressLimitInput');
    const elevatorToggle = document.getElementById('requireElevatorToggle');
    const accessibleInput = document.getElementById('accessibleEntrancesInput');

    return {
        floorHeight: floorHeightInput ? parseFloat(floorHeightInput.value) || undefined : undefined,
        connectorMatchTolerance: toleranceInput ? parseFloat(toleranceInput.value) || undefined : undefined,
        egressDistanceLimit: egressInput ? parseFloat(egressInput.value) || undefined : undefined,
        requireElevators: elevatorToggle ? elevatorToggle.checked : true,
        minimumAccessibleEntrances: accessibleInput ? parseInt(accessibleInput.value, 10) || undefined : undefined
    };
}

function updateConnectorVisualization() {
    if (!renderer) return;

    if (stackVisualizationEnabled && multiFloorResult) {
        const options = getMultiFloorOptions();
        const levelHeight = options.floorHeight || options.levelHeight || 3.2;
        renderer.renderConnectors(multiFloorResult.connectors || [], {
            levelElevation: levelHeight,
            multiFloor: true
        });
        return;
    }

    if (!multiFloorResult || !activeStackFloorId) {
        renderer.renderConnectors([]);
        return;
    }

    const options = getMultiFloorOptions();
    const levelHeight = options.floorHeight || options.levelHeight || 3.2;
    const connectors = (multiFloorResult.connectors || []).filter(conn => conn.floorId === activeStackFloorId);
    renderer.renderConnectors(connectors, { levelElevation: levelHeight });
}

function toggleStackVisualization() {
    if (!multiFloorResult || !multiFloorResult.floors || multiFloorResult.floors.length === 0) {
        showNotification('Compute the multi-floor stack first.', 'warning');
        return;
    }
    stackVisualizationEnabled = !stackVisualizationEnabled;
    updateStackVisualization(true);
}

function updateStackVisualization(force = false) {
    updateStackPreviewButton();
    if (!renderer) return;

    if (!stackVisualizationEnabled || !multiFloorResult) {
        if (renderer.clearStackedFloors) renderer.clearStackedFloors();
        if (renderer.clearCrossFloorRoutes) renderer.clearCrossFloorRoutes();
        if (force) {
            renderCurrentState();
        } else {
            updateConnectorVisualization();
        }
        return;
    }

    const options = getMultiFloorOptions();
    const levelHeight = options.floorHeight || options.levelHeight || 3.2;

    if (force) {
        renderCurrentState();
    }

    if (renderer.renderStackedFloors) {
        renderer.renderStackedFloors(multiFloorResult.floors, {
            activeFloorId: activeStackFloorId,
            levelHeight
        });
    }

    if (renderer.renderCrossFloorRoutes) {
        const segments = multiFloorResult.crossFloorCorridors?.segments || [];
        if (segments.length) {
            renderer.renderCrossFloorRoutes(segments, { levelHeight });
        } else if (renderer.clearCrossFloorRoutes) {
            renderer.clearCrossFloorRoutes();
        }
    }

    renderer.renderConnectors(multiFloorResult.connectors || [], {
        levelElevation: levelHeight,
        multiFloor: true
    });
}

function updateStackPreviewButton() {
    const btn = document.getElementById('previewStackBtn');
    if (!btn) return;

    const hasResult = !!(multiFloorResult && multiFloorResult.floors && multiFloorResult.floors.length);
    btn.disabled = !hasResult;
    btn.classList.toggle('stack-active', stackVisualizationEnabled && hasResult);

    const profileBtn = document.getElementById('profileStackBtn');
    if (profileBtn) {
        profileBtn.disabled = !hasResult;
        profileBtn.classList.toggle('stack-active', !!(multiFloorResult?.profile));
    }

    const reportBtn = document.getElementById('reportStackBtn');
    if (reportBtn) {
        reportBtn.disabled = !hasResult;
        reportBtn.classList.toggle('stack-active', !!(multiFloorResult?.report));
    }

    if (!hasResult) {
        btn.innerHTML = '<i class="fas fa-vr-cardboard"></i> Preview Stack';
        return;
    }

    if (stackVisualizationEnabled) {
        btn.innerHTML = '<i class="fas fa-eye-slash"></i> Exit Stack Preview';
    } else {
        btn.innerHTML = '<i class="fas fa-vr-cardboard"></i> Preview Stack';
    }
}

async function fetchCrossFloorCorridors() {
    if (!multiFloorResult || !multiFloorResult.floors || !multiFloorResult.connectors) {
        return;
    }

    try {
        const API = window.__API_BASE__ || window.location.origin;
        const payload = {
            floors: multiFloorResult.floors,
            connectors: multiFloorResult.connectors,
            edges: multiFloorResult.edges || [],
            options: getMultiFloorOptions()
        };

        const response = await fetch(`${API}/api/multi-floor/corridors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => null);
        if (response.ok && data && data.success) {
            if (multiFloorResult) {
                multiFloorResult.crossFloorCorridors = data.routes || null;
                multiFloorResult.crossFloorCorridorMetrics = data.metrics || null;
            }
        } else {
            console.warn('Cross-floor corridors unavailable', data?.error);
            if (multiFloorResult) {
                multiFloorResult.crossFloorCorridors = null;
                multiFloorResult.crossFloorCorridorMetrics = null;
            }
        }
    } catch (error) {
        console.error('Error in fetchCrossFloorCorridors:', error);
        showNotification('Error fetching cross-floor corridors: ' + error.message, 'error');
    }
}

async function profileMultiFloorStack() {
    if (!multiFloorResult || !multiFloorResult.floors) {
        showNotification('Compute the multi-floor stack first.', 'warning');
        return;
    }

    try {
        showLoader('Profiling multi-floor stack...', 35);
        const API = window.__API_BASE__ || window.location.origin;
        const payload = {
            floors: multiFloorResult.floors,
            options: {
                iterations: 5,
                targetFloorCount: 6,
                autoExpand: true,
                stackOptions: getMultiFloorOptions()
            }
        };

        const response = await fetch(`${API}/api/multi-floor/profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Profiling failed');
        }

        if (multiFloorResult) {
            multiFloorResult.profile = data.profile;
            multiFloorResult.profileMetrics = data.metrics || null;
        }

        refreshMultiFloorUI();
        updateStackPreviewButton();
        showNotification('Profiling complete.', 'success');
    } catch (error) {
        console.error('Profiling error', error);
        showNotification('Profiling failed: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

async function generateMultiFloorReport() {
    if (!multiFloorResult || !multiFloorResult.floors) {
        showNotification('Compute the multi-floor stack first.', 'warning');
        return;
    }

    try {
        showLoader('Generating multi-floor report...', 40);
        const API = window.__API_BASE__ || window.location.origin;
        const payload = {
            floors: multiFloorResult.floors,
            options: {
                stackOptions: getMultiFloorOptions(),
                routeOptions: getMultiFloorOptions(),
                profile: multiFloorResult.profile || null
            }
        };

        const response = await fetch(`${API}/api/multi-floor/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Report generation failed');
        }

        if (multiFloorResult) {
            multiFloorResult.report = data.report;
        }

        refreshMultiFloorUI();
        updateStackPreviewButton();

        const jsonBlob = new Blob([JSON.stringify(data.report, null, 2)], { type: 'application/json' });
        triggerDownload(jsonBlob, `multi-floor-report-${Date.now()}.json`);
        if (data.report?.markdown) {
            const mdBlob = new Blob([data.report.markdown], { type: 'text/markdown' });
            triggerDownload(mdBlob, `multi-floor-report-${Date.now()}.md`);
        }

        showNotification('Report generated and downloaded.', 'success');
    } catch (error) {
        console.error('Report generation error', error);
        showNotification('Report generation failed: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function refreshRoomList() {
    const roomList = document.getElementById('roomList');
    if (!roomList) return;

    roomList.innerHTML = '';
    const rooms = currentFloorPlan?.rooms || [];
    if (!rooms.length) {
        roomList.innerHTML = '<div class="list-item">No rooms detected yet</div>';
        return;
    }

    rooms.forEach((room, index) => {
        const item = document.createElement('div');
        item.className = 'list-item';
        const area = room.area ? room.area.toFixed(2) : 'N/A';
        item.textContent = `Room ${index + 1} - Area: ${area} m²`;
        roomList.appendChild(item);
    });
}

function syncActiveStackFloor() {
    if (!activeStackFloorId) return;
    const index = multiFloorStack.findIndex(entry => entry.id === activeStackFloorId);
    if (index === -1) return;

    multiFloorStack[index] = {
        ...multiFloorStack[index],
        floorPlan: deepClone(currentFloorPlan),
        ilots: deepClone(generatedIlots),
        corridors: deepClone(corridorNetwork),
        arrows: deepClone(corridorArrows),
        corridor_statistics: corridorStatistics ? deepClone(corridorStatistics) : null,
        metadata: {
            ...(multiFloorStack[index].metadata || {}),
            rooms: currentFloorPlan?.rooms?.length || 0,
            totalArea: currentFloorPlan?.totalArea || 0
        }
    };
    refreshMultiFloorUI();
    if (stackVisualizationEnabled) {
        updateStackVisualization();
    } else {
        updateStackPreviewButton();
    }
}


async function generateIlots() {
    if (!currentFloorPlan) {
        showNotification('Please upload a CAD file first', 'warning');
        return;
    }

    try {
        showLoader('Generating îlots...', 10);

        const bounds = currentFloorPlan.bounds;
        if (!bounds) {
            hideLoader();
            showNotification('Floor plan bounds missing.', 'error');
            return;
        }
        const minX = Number(bounds.minX);
        const minY = Number(bounds.minY);
        const maxX = Number(bounds.maxX);
        const maxY = Number(bounds.maxY);
        if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
            hideLoader();
            showNotification('Floor plan bounds are invalid.', 'error');
            return;
        }

        console.log('Using DXF bounds:', bounds);

        // Ensure floorPlan has required arrays (even if empty)
        const floorPlan = {
            ...currentFloorPlan,
            walls: currentFloorPlan.walls || [],
            forbiddenZones: currentFloorPlan.forbiddenZones || [],
            entrances: currentFloorPlan.entrances || [],
            bounds: bounds
        };

        // Calculate target ilots based on actual usable area
        let floorArea = Number(floorPlan.totalArea) || 0;
        if (floorArea === 0 && floorPlan.rooms && floorPlan.rooms.length > 0) {
            floorArea = floorPlan.rooms.reduce((sum, r) => sum + (Number(r.area) || 0), 0);
        }
        if (floorArea === 0 && floorPlan.bounds) {
            const width = Number(floorPlan.bounds.maxX) - Number(floorPlan.bounds.minX);
            const height = Number(floorPlan.bounds.maxY) - Number(floorPlan.bounds.minY);
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                floorArea = width * height;
            }
        }
        if (!Number.isFinite(floorArea) || floorArea <= 0) {
            showNotification('Unable to compute usable area. Check room detection and bounds.', 'error');
            return;
        }
        const targetIlots = Math.max(1, Math.floor(floorArea / 10));

        const distribution = parseDistribution();
        console.log('Using distribution configuration:', distribution);

        console.log(`Generating ${targetIlots} ilots for ${floorArea.toFixed(2)} m² floor area`);

        const API = window.__API_BASE__ || window.location.origin;
        const unitMixPayload = activeUnitMix && Array.isArray(activeUnitMix.typologies)
            ? activeUnitMix.typologies.map(typo => ({
                type: typo.name,
                targetArea: typo.targetArea,
                tolerance: typo.tolerance,
                priority: typo.priority
            }))
            : null;

        const response = await fetch(`${API}/api/ilots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                floorPlan: floorPlan,
                distribution: distribution,
                unitMix: unitMixPayload,
                options: buildIlotOptions(targetIlots)
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
        syncActiveStackFloor();
        refreshMultiFloorUI();

        // Wait for viewer to be ready before rendering
        setTimeout(() => {
            renderCurrentState();
            updateLegendTable(); // Update legend with unit statistics
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
    // First check active preset
    if (activePresetConfig?.normalizedDistribution) {
        return activePresetConfig.normalizedDistribution;
    }
    
    // Check distribution editor
    const txt = document.getElementById('distributionEditor')?.value;
    if (txt && txt.trim() !== '') {
        try {
            const obj = JSON.parse(txt);
            return normalizePresetDistribution(obj);
        } catch (e) {
            console.warn('Distribution JSON is invalid, using default:', e);
        }
    }
    
    // Check distribution inputs in UI
    const distributionInputs = document.querySelectorAll('.distribution-input');
    if (distributionInputs.length > 0) {
        const distribution = {};
        const ranges = ['0-1', '1-3', '3-5', '5-10'];
        let hasValues = false;
        
        distributionInputs.forEach((input, index) => {
            const value = parseFloat(input.value) || 0;
            if (value > 0) hasValues = true;
            distribution[ranges[index]] = value;
        });
        
        if (hasValues) {
            try {
                return normalizePresetDistribution(distribution);
            } catch (e) {
                console.warn('Distribution inputs invalid, using default:', e);
            }
        }
    }
    
    // Use default distribution if nothing is configured
    const defaultDistribution = {
        '0-2': 25,
        '2-5': 35,
        '5-10': 30,
        '10-20': 10
    };
    
    console.log('Using default distribution:', defaultDistribution);
    return normalizePresetDistribution(defaultDistribution);
}

async function generateCorridors() {
    if (!generatedIlots.length) {
        showNotification('Please generate îlots first', 'warning');
        return;
    }
    if (!currentFloorPlan || !currentFloorPlan.bounds) {
        showNotification('Floor plan bounds missing.', 'error');
        return;
    }

    try {
        showLoader('Generating corridors...', 20);

        const API = window.__API_BASE__ || window.location.origin;
        const corridorWidth = getActiveCorridorWidth();
        const generateArrows = document.getElementById('generate-arrows') ? document.getElementById('generate-arrows').checked : true;

        const response = await fetch(`${API}/api/corridors/advanced`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                floorPlan: currentFloorPlan,
                options: {
                    corridor_width: corridorWidth,
                    generate_arrows: generateArrows
                }
            })
        });

        if (!response.ok) {
            throw new Error('Corridor generation failed');
        }

        const result = await response.json();
        if (result.error) {
            throw new Error(result.error);
        }
        corridorNetwork = Array.isArray(result.corridors) ? result.corridors : [];
        corridorArrows = Array.isArray(result.arrows) ? result.arrows : [];
        corridorStatistics = result.statistics || null;
        console.log(`Generated ${corridorNetwork.length} corridors`);
        console.log('First corridor:', corridorNetwork[0]);

        updateStats();
        syncActiveStackFloor();
        refreshMultiFloorUI();

        setTimeout(() => {
            renderCurrentState();
        }, 500);

        if (renderer && renderer.renderCorridorArrows) {
            renderer.renderCorridorArrows(corridorArrows);
            renderer.setCorridorArrowsVisible(corridorArrowsVisible);
        }

        const arrowMessage = corridorArrows.length ? `${corridorArrows.length} circulation arrows` : `${corridorNetwork.length} corridors`;
        showNotification(`Generated ${arrowMessage}`, 'success');
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
        const API = window.__API_BASE__ || window.location.origin;
        const response = await fetch(`${API}/api/export/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ floorPlan: currentFloorPlan, ilots: generatedIlots, corridors: corridorNetwork, arrows: corridorArrows })
        });

        const result = await response.json();
        if (result && result.filepath) {
            showNotification('PDF exported: ' + result.filename, 'success');
            // Trigger download
            const API = window.__API_BASE__ || window.location.origin;
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
        const API = window.__API_BASE__ || window.location.origin;
        const response = await fetch(`${API}/api/export/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ floorPlan: currentFloorPlan, ilots: generatedIlots, corridors: corridorNetwork, arrows: corridorArrows })
        });

        const result = await response.json();
        if (result && result.filepath) {
            showNotification('Image exported: ' + result.filename, 'success');
            const API = window.__API_BASE__ || window.location.origin;
            window.open(`${API}/exports/${result.filename}`, '_blank');
        } else {
            showNotification('Image export failed', 'error');
        }
    } catch (e) {
        showNotification('Image export failed: ' + e.message, 'error');
    }
}

// Phase 2: Apply preset distribution
function applyPresetDistribution(preset) {
    if (!preset || !preset.distribution) {
        showNotification('Invalid preset', 'error');
        return;
    }

    // Update distribution inputs
    const distributionInputs = document.querySelectorAll('.distribution-input');
    const ranges = Object.keys(preset.distribution).sort((a, b) => {
        const aMin = parseFloat(a.split('-')[0]);
        const bMin = parseFloat(b.split('-')[0]);
        return aMin - bMin;
    });

    ranges.forEach((range, index) => {
        if (distributionInputs[index]) {
            distributionInputs[index].value = preset.distribution[range];
        }
    });

    // Update corridor width
    setupCorridorWidthSlider(preset.corridorWidth);

    let normalized;
    try {
        normalized = normalizePresetDistribution(preset.distribution);
    } catch (error) {
        showNotification(error.message || 'Invalid preset distribution', 'error');
        return;
    }
    if (document.getElementById('distributionEditor')) {
        document.getElementById('distributionEditor').value = JSON.stringify(normalized, null, 2);
    }

    activePresetConfig = {
        id: preset.id,
        name: preset.name,
        rawDistribution: { ...preset.distribution },
        normalizedDistribution: normalized,
        corridorWidth: typeof preset.corridorWidth === 'number' ? preset.corridorWidth : parseFloat(document.getElementById('corridorWidthSlider')?.value || '1.2'),
        options: preset.options || {}
    };

    // Update distribution total display
    updateDistributionTotal();

    // Store preset ID for regeneration
    window.currentPresetId = preset.id;

    updateActivePresetSummary(activePresetConfig);

    showNotification(`Preset "${preset.name}" ready`, 'success', {
        description: 'Regenerate îlots to apply the updated distribution.',
        action: currentFloorPlan ? {
            label: 'Regenerate now',
            callback: () => generateIlots()
        } : null
    });
}

function setupCorridorWidthSlider(initialWidth) {
    const slider = document.getElementById('corridorWidthSlider');
    const valueEl = document.getElementById('corridorWidthValue');
    if (!slider || !valueEl) return;

    if (typeof initialWidth === 'number' && !Number.isNaN(initialWidth)) {
        slider.value = initialWidth;
    } else {
        // Set default to 1.2m
        slider.value = 1.2;
    }

    valueEl.textContent = `${slider.value}m`;

    if (!slider.dataset.bound) {
        slider.addEventListener('input', () => {
            valueEl.textContent = `${slider.value}m`;
            if (activePresetConfig) {
                activePresetConfig.corridorWidth = parseFloat(slider.value) || activePresetConfig.corridorWidth;
            }
        });
        slider.dataset.bound = '1';
    }
}

function normalizePresetDistribution(distribution) {
    if (!distribution || typeof distribution !== 'object') {
        throw new Error('Distribution must be an object with numeric weights');
    }

    const ordered = Object.entries(distribution).map(([range, value]) => {
        let weight = Number(value);
        if (Number.isNaN(weight) || weight < 0) {
            throw new Error(`Invalid distribution weight for ${range}`);
        }
        if (weight > 1.01) weight = weight / 100;
        return [range, weight];
    }).sort((a, b) => {
        const aMin = parseFloat(a[0].split('-')[0]);
        const bMin = parseFloat(b[0].split('-')[0]);
        return aMin - bMin;
    });

    if (!ordered.length) {
        throw new Error('Distribution must include at least one size range');
    }

    const total = ordered.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) {
        throw new Error('Distribution weights must sum to a positive value');
    }

    const normalized = {};
    ordered.forEach(([range, weight]) => {
        normalized[range] = weight / total;
    });

    return normalized;
}

function buildIlotOptions(targetIlots) {
    const corridorWidth = getActiveCorridorWidth();
    const presetOptions = activePresetConfig?.options || {};
    return {
        totalIlots: targetIlots,
        seed: computeDeterministicSeed(currentFloorPlan, activePresetConfig),
        minEntranceDistance: 1.0,
        minIlotDistance: 0.5,
        maxAttemptsPerIlot: 800,
        margin: typeof presetOptions.margin === 'number' ? presetOptions.margin : (presetOptions.minRowDistance || 1.0),
        spacing: typeof presetOptions.spacing === 'number' ? presetOptions.spacing : 0.3,
        corridorWidth
    };
}

function computeDeterministicSeed(floorPlan, presetConfig) {
    const bounds = floorPlan?.bounds || {};
    const source = [
        presetConfig?.id || 'default',
        bounds.minX ?? 0,
        bounds.minY ?? 0,
        bounds.maxX ?? 0,
        bounds.maxY ?? 0,
        floorPlan?.urn || ''
    ].join('|');

    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }
    return hash;
}

function getActiveCorridorWidth() {
    if (typeof activePresetConfig?.corridorWidth === 'number') {
        return activePresetConfig.corridorWidth;
    }
    const slider = document.getElementById('corridorWidthSlider');
    return slider ? parseFloat(slider.value || '1.2') : 1.2;
}

// Update distribution total display
function updateDistributionTotal() {
    const inputs = document.querySelectorAll('.distribution-input');
    let total = 0;
    inputs.forEach(input => {
        total += parseFloat(input.value) || 0;
    });

    const totalDisplay = document.getElementById('distributionTotal');
    const errorDisplay = document.getElementById('distributionError');
    const applyBtn = document.getElementById('applyDistributionBtn');

    if (totalDisplay) {
        totalDisplay.textContent = total.toFixed(1) + '%';
        totalDisplay.style.color = Math.abs(total - 100) < 0.1 ? '#4CAF50' : '#f44336';
    }

    if (errorDisplay) {
        if (Math.abs(total - 100) < 0.1) {
            errorDisplay.classList.add('hidden');
        } else {
            errorDisplay.classList.remove('hidden');
        }
    }

    if (applyBtn) {
        applyBtn.disabled = Math.abs(total - 100) > 0.1;
    }
}

const LAYOUT_STATE_STORAGE_KEY = 'fp-layout-state-v2';
const NOTIFICATION_ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
};

function initializeLayoutChrome() {
    const layoutRoot = document.querySelector('.app-layout');
    if (!layoutRoot) return;

    const toggleButtons = Array.from(document.querySelectorAll('[data-toggle-panel]'));
    const state = loadLayoutState();
    applyLayoutState(layoutRoot, state);
    syncToggleButtons(toggleButtons, state);

    toggleButtons.forEach((button) => {
        button.addEventListener('click', (event) => {
            event?.preventDefault();
            const panel = button.dataset.togglePanel;
            if (!panel) return;
            state[panel] = !state[panel];
            applyLayoutState(layoutRoot, state);
            syncToggleButtons(toggleButtons, state);
            persistLayoutState(state);
        });
    });
}

function initializeHeaderActions() {
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    
    if (!uploadBtn) {
        console.warn('Upload button not found');
        return;
    }
    
    if (!fileInput) {
        console.warn('File input not found');
        return;
    }
    
    // Ensure button type is set correctly
    uploadBtn.type = 'button';
    
    // Remove any existing listeners to prevent duplicates
    const oldTrigger = uploadBtn._triggerUpload;
    if (oldTrigger) {
        uploadBtn.removeEventListener('click', oldTrigger);
        uploadBtn.removeEventListener('pointerdown', oldTrigger);
        uploadBtn.removeEventListener('touchstart', oldTrigger);
    }
    
    // Create new trigger function
    const triggerUpload = (event) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        console.log('Upload button clicked, triggering file input');
        
        // Ensure file input is accessible
        if (!fileInput) {
            console.error('File input not available');
            showNotification('File input not available. Please refresh the page.', 'error');
            return;
        }
        
        // Reset and trigger file input
        try {
            fileInput.value = '';
            fileInput.click();
            console.log('File input click triggered');
        } catch (error) {
            console.error('Error triggering file input:', error);
            showNotification('Error opening file dialog: ' + error.message, 'error');
        }
    };
    
    // Store reference for cleanup
    uploadBtn._triggerUpload = triggerUpload;
    
    // Add event listeners
    uploadBtn.addEventListener('click', triggerUpload, { passive: false });
    uploadBtn.addEventListener('pointerdown', triggerUpload, { passive: false });
    uploadBtn.addEventListener('touchstart', triggerUpload, { passive: false });
    uploadBtn.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            triggerUpload(event);
        }
    });
    
    console.log('Upload button initialized successfully');
    
    // Also handle data-trigger="upload" elements
    const uploadTriggers = document.querySelectorAll('[data-trigger="upload"]');
    uploadTriggers.forEach(trigger => {
        trigger.addEventListener('click', (event) => {
            event?.preventDefault();
            if (fileInput) {
                fileInput.value = '';
                fileInput.click();
            }
        });
    });

    updateActivePlanSummary(currentFloorPlan);
    updateActivePresetSummary(activePresetConfig);
}

function loadLayoutState() {
    try {
        const stored = localStorage.getItem(LAYOUT_STATE_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                left: !!parsed.left,
                right: !!parsed.right
            };
        }
    } catch (error) {
        console.warn('Failed to load layout state', error);
    }
    return { left: false, right: false };
}

function persistLayoutState(state) {
    try {
        localStorage.setItem(LAYOUT_STATE_STORAGE_KEY, JSON.stringify({
            left: !!state.left,
            right: !!state.right
        }));
    } catch (error) {
        console.warn('Failed to persist layout state', error);
    }
}

function applyLayoutState(root, state) {
    if (!root) return;
    const normalized = {
        left: !!state.left,
        right: !!state.right
    };
    root.classList.toggle('left-collapsed', normalized.left);
    root.classList.toggle('right-collapsed', normalized.right);
    root.dataset.leftCollapsed = normalized.left ? 'true' : 'false';
    root.dataset.rightCollapsed = normalized.right ? 'true' : 'false';
}

function syncToggleButtons(buttons, state) {
    const friendlyNames = {
        left: 'configuration panel',
        right: 'insights panel'
    };

    buttons.forEach((button) => {
        const panel = button.dataset.togglePanel;
        if (!panel) return;
        const collapsed = !!state[panel];
        button.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
        button.classList.toggle('is-active', collapsed);
        button.dataset.state = collapsed ? 'collapsed' : 'expanded';
        const label = button.querySelector('span');
        if (label && button.classList.contains('header-btn')) {
            if (!label.dataset.baseLabel) {
                label.dataset.baseLabel = label.textContent;
            }
            label.textContent = collapsed ? `Show ${label.dataset.baseLabel}` : label.dataset.baseLabel;
        }
        const targetLabel = friendlyNames[panel] || `${panel} panel`;
        button.setAttribute('aria-label', collapsed ? `Expand ${targetLabel}` : `Collapse ${targetLabel}`);
    });
}

function updateActivePlanSummary(plan) {
    const nameTarget = document.getElementById('activePlanName');
    const pill = document.getElementById('activePlanPill');
    const planName = typeof plan === 'string'
        ? plan
        : (plan && plan.name) || null;
    if (nameTarget) {
        nameTarget.textContent = planName || 'No file';
        nameTarget.title = planName || 'No plan loaded';
    }
    if (pill) {
        pill.classList.toggle('is-active', !!planName);
    }
}

function updateActivePresetSummary(preset) {
    const nameTarget = document.getElementById('activePresetName');
    const pill = document.getElementById('activePresetPill');
    const presetName = preset && preset.name ? preset.name : null;
    if (nameTarget) {
        nameTarget.textContent = presetName || 'Not selected';
        nameTarget.title = presetName || 'No preset selected';
    }
    if (pill) {
        pill.classList.toggle('is-active', !!presetName);
        pill.dataset.custom = preset?.metadata?.custom ? 'true' : 'false';
    }
}

function syncPresetUIFromConfig(config) {
    if (!config) {
        updateActivePresetSummary(null);
        return;
    }
    const distributionInputs = document.querySelectorAll('.distribution-input');
    const ranges = ['0-1', '1-3', '3-5', '5-10'];
    const source = config.rawDistribution || {};
    ranges.forEach((range, index) => {
        const input = distributionInputs[index];
        if (!input) return;
        let value = source[range];
        if (typeof value === 'number' && value <= 1.05) {
            value = Math.round(value * 100);
        }
        if (typeof value === 'number' && !Number.isNaN(value)) {
            input.value = value;
        }
    });
    updateDistributionTotal();
    setupCorridorWidthSlider(config.corridorWidth);
    updateActivePresetSummary(config);
    if (presetSelector && typeof presetSelector.hydrateSelection === 'function' && config.id) {
        presetSelector.hydrateSelection(config.id);
    }
}

function showNotification(message, type = 'info', options = {}) {
    if (typeof type === 'object' && type !== null) {
        options = type;
        type = options.type || 'info';
    }
    
    // Handle duration parameter (can be passed as third arg or in options)
    if (typeof options === 'number') {
        options = { duration: options };
    } else if (typeof options === 'string') {
        // Legacy: third param was type, options was fourth
        options = {};
    }

    // Remove duplicate notifications with same message
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(n => {
        const content = n.querySelector('.notification-content')?.textContent || '';
        if (content.includes(message.substring(0, 30))) { // Match first 30 chars
            n.remove();
        }
    });

    const host = document.getElementById('notifications') || document.body;
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.setAttribute('role', 'alert');
    notification.dataset.type = type;
    if (options.sticky) notification.classList.add('notification-sticky');
    if (options.compact) notification.classList.add('notification-compact');

    const iconWrapper = document.createElement('span');
    iconWrapper.className = 'notification-icon';
    iconWrapper.innerHTML = `<i class="fas ${options.icon || NOTIFICATION_ICONS[type] || NOTIFICATION_ICONS.info}"></i>`;
    notification.appendChild(iconWrapper);

    const content = document.createElement('div');
    content.className = 'notification-content';

    const titleEl = document.createElement('div');
    titleEl.className = 'notification-title';
    titleEl.textContent = options.title || message;
    content.appendChild(titleEl);

    if (options.description) {
        const descriptionEl = document.createElement('div');
        descriptionEl.className = 'notification-description';
        descriptionEl.textContent = options.description;
        content.appendChild(descriptionEl);
    } else if (options.title) {
        const descriptionEl = document.createElement('div');
        descriptionEl.className = 'notification-description';
        descriptionEl.textContent = message;
        content.appendChild(descriptionEl);
    }

    notification.appendChild(content);

    if (options.action && typeof options.action.callback === 'function') {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'notification-action';
        actionBtn.textContent = options.action.label || 'View';
        actionBtn.addEventListener('click', () => {
            try {
                options.action.callback();
            } finally {
                dismiss();
            }
        });
        notification.appendChild(actionBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'notification-close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.addEventListener('click', dismiss);
    notification.appendChild(closeBtn);

    host.appendChild(notification);

    const duration = typeof options.duration === 'number' ? options.duration : 5000;
    let timer = null;
    if (duration > 0 && !options.sticky) {
        timer = setTimeout(dismiss, duration);
    }

    function dismiss() {
        if (timer) clearTimeout(timer);
        notification.classList.add('notification-dismiss');
        setTimeout(() => notification.remove(), 220);
    }

    return dismiss;
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

// Auto-hide functionality for navigation and sidebars
function initializeAutoHide() {
    const nav = document.querySelector('.top-nav');
    const leftSidebar = document.querySelector('.sidebar-left');
    const rightSidebar = document.querySelector('.sidebar-right');
    const mainContent = document.querySelector('.main-content');

    // Pin states
    let navPinned = false;
    let leftPinned = false;
    let rightPinned = false;

    let hideTimer = null;

    // Start with navigation hidden
    if (nav && !navPinned) {
        nav.classList.add('auto-hidden');
    }

    // Navigation pin button
    const navPinBtn = document.getElementById('navPinBtn');
    if (navPinBtn) {
        navPinBtn.addEventListener('click', () => {
            navPinned = !navPinned;
            navPinBtn.classList.toggle('pinned', navPinned);
            if (navPinned) {
                nav.classList.add('pinned');
                nav.classList.remove('auto-hidden');
            } else {
                nav.classList.remove('pinned');
            }
        });
    }

    // Left sidebar toggle
    const leftToggle = document.getElementById('leftSidebarToggle');
    if (leftToggle) {
        leftToggle.addEventListener('click', () => {
            leftPinned = !leftPinned;
            leftToggle.classList.toggle('pinned', leftPinned);
            if (leftPinned) {
                leftSidebar.classList.add('pinned');
                leftSidebar.classList.remove('auto-hidden');
            } else {
                leftSidebar.classList.remove('pinned');
            }
            resizeCanvas(); // Resize canvas when toggling sidebar
        });
    }

    // Right sidebar toggle
    const rightToggle = document.getElementById('rightSidebarToggle');
    if (rightToggle) {
        rightToggle.addEventListener('click', () => {
            rightPinned = !rightPinned;
            rightToggle.classList.toggle('pinned', rightPinned);
            if (rightPinned) {
                rightSidebar.classList.add('pinned');
                rightSidebar.classList.remove('auto-hidden');
            } else {
                rightSidebar.classList.remove('pinned');
            }
            resizeCanvas(); // Resize canvas when toggling sidebar
        });
    }

    // Helper function to resize canvas when sidebars toggle
    function resizeCanvas() {
        if (renderer && renderer.onResize) {
            setTimeout(() => {
                renderer.onResize();
            }, 350); // Wait for CSS transition to complete
        }
    }

    // Mouse movement tracking for auto-hide
    document.addEventListener('mousemove', (e) => {
        const { clientX, clientY } = e;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // Show/hide navigation based on mouse position
        if (!navPinned) {
            if (clientY < 60) {
                nav.classList.remove('auto-hidden');
            } else {
                clearTimeout(hideTimer);
                hideTimer = setTimeout(() => {
                    if (!navPinned) nav.classList.add('auto-hidden');
                }, 1000);
            }
        }

        // Show/hide left sidebar
        if (!leftPinned) {
            if (clientX < 30) {
                const wasHidden = leftSidebar.classList.contains('auto-hidden');
                leftSidebar.classList.remove('auto-hidden');
                if (wasHidden) resizeCanvas();
            } else if (clientX > 300) {
                clearTimeout(hideTimer);
                hideTimer = setTimeout(() => {
                    if (!leftPinned) {
                        const wasVisible = !leftSidebar.classList.contains('auto-hidden');
                        leftSidebar.classList.add('auto-hidden');
                        if (wasVisible) resizeCanvas();
                    }
                }, 1000);
            }
        }

        // Show/hide right sidebar
        if (!rightPinned) {
            if (clientX > windowWidth - 30) {
                const wasHidden = rightSidebar.classList.contains('auto-hidden');
                rightSidebar.classList.remove('auto-hidden');
                if (wasHidden) resizeCanvas();
            } else if (clientX < windowWidth - 300) {
                clearTimeout(hideTimer);
                hideTimer = setTimeout(() => {
                    if (!rightPinned) {
                        const wasVisible = !rightSidebar.classList.contains('auto-hidden');
                        rightSidebar.classList.add('auto-hidden');
                        if (wasVisible) resizeCanvas();
                    }
                }, 1000);
            }
        }
    });

    // Keep elements visible when hovering over them
    [nav, leftSidebar, rightSidebar].forEach(el => {
        if (!el) return;
        el.addEventListener('mouseenter', () => {
            clearTimeout(hideTimer);
        });
    });
}

// Collapsible sections functionality
function initializeCollapsible() {
    const sections = document.querySelectorAll('.sidebar-section');

    sections.forEach(section => {
        const header = section.querySelector('h3');
        if (!header) return;

        header.addEventListener('click', () => {
            section.classList.toggle('collapsed');
        });
    });
}

// Show legend when floor plan is loaded
function showLegend() {
    const legend = document.getElementById('floorLegend');
    if (legend) {
        legend.style.display = 'block';
        updateLegendTable();
    }
}

// Update legend table with unit size statistics (matching reference format)
function updateLegendTable() {
    const tableBody = document.getElementById('legendTableBody');
    const unitTable = document.getElementById('legendUnitTable');
    
    if (!tableBody || !unitTable || !generatedIlots || generatedIlots.length === 0) {
        if (unitTable) unitTable.style.display = 'none';
        return;
    }
    
    // Calculate unit size statistics (using consistent calculation)
    const unitSizeMap = {};
    generatedIlots.forEach(ilot => {
        const area = ilot.area || (ilot.width * ilot.height);
        // Calculate unit size label (consistent with backend)
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
            closest = Math.round(area * 2) / 2;
        }
        
        // Get group (consistent with backend)
        const size = closest;
        let group = 'A';
        if (size <= 1) group = 'A';
        else if (size <= 2) group = 'B';
        else if (size <= 5) group = 'C';
        else if (size <= 10) group = 'D';
        else if (size <= 15) group = 'E';
        else group = 'F';
        
        if (!unitSizeMap[closest]) {
            unitSizeMap[closest] = {
                size: closest,
                group: group,
                count: 0,
                totalArea: 0
            };
        }
        unitSizeMap[closest].count++;
        unitSizeMap[closest].totalArea += area;
    });
    
    // Sort by size
    const unitSizes = Object.values(unitSizeMap).sort((a, b) => a.size - b.size);
    
    // Clear and populate table - Match reference: RM No., DESCRIPTION, AREA (SQ.FT.)
    tableBody.innerHTML = '';
    
    // Use actual rooms if available, otherwise use unit sizes
    const rooms = currentFloorPlan?.rooms || [];
    const roomRows = rooms.length > 0 ? rooms.slice(0, 26).map((room, idx) => ({
        rmNo: String(room.number || (idx + 1)).padStart(2, '0'),
        description: room.type || room.description || 'Office',
        area: ((room.area || 0) * 10.764).toFixed(1) // Convert m² to sq.ft.
    })) : unitSizes.slice(0, 26).map(unit => ({
        rmNo: String(Math.floor(unit.size)).padStart(2, '0'),
        description: 'Unit',
        area: ((unit.size * unit.count) * 10.764).toFixed(1)
    }));
    
    roomRows.slice(0, 26).forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'legend-table-row';
        rowEl.innerHTML = `
            <div class="legend-table-cell">${row.rmNo}</div>
            <div class="legend-table-cell">${row.description}</div>
            <div class="legend-table-cell">${row.area}</div>
        `;
        tableBody.appendChild(rowEl);
    });
    
    unitTable.style.display = 'block';
}

// Hide legend
function hideLegend() {
    const legend = document.getElementById('floorLegend');
    if (legend) {
        legend.style.display = 'none';
    }
}

function initializeEditTools() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const editBtn = document.getElementById('editModeBtn');
    const snapBtn = document.getElementById('snapGridBtn');

    if (undoBtn) {
        undoBtn.addEventListener('click', () => {
            if (undoManager && undoManager.canUndo()) {
                undoManager.undo();
                showNotification('Undo successful', 'info');
            } else {
                showNotification('Nothing to undo', 'warning');
            }
        });
    }

    if (redoBtn) {
        redoBtn.addEventListener('click', () => {
            if (undoManager && undoManager.canRedo()) {
                undoManager.redo();
                showNotification('Redo successful', 'info');
            } else {
                showNotification('Nothing to redo', 'warning');
            }
        });
    }

    if (editBtn) {
        let editModeActive = false;
        editBtn.addEventListener('click', () => {
            if (editor) {
                editModeActive = !editModeActive;
                editor.enableEditMode(editModeActive);
                editBtn.classList.toggle('active', editModeActive);
                showNotification(editModeActive ? 'Edit mode enabled' : 'Edit mode disabled', 'info');
            }
        });
    }

    if (snapBtn) {
        snapBtn.addEventListener('click', () => {
            if (editor) {
                editor.enableSnapping = !editor.enableSnapping;
                snapBtn.classList.toggle('active', editor.enableSnapping);
                showNotification(editor.enableSnapping ? 'Snap to grid enabled' : 'Snap to grid disabled', 'info');
            }
        });
    }

    // Delete key listener
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.matches('input, textarea')) {
            if (renderer && renderer.selectedIlots && renderer.selectedIlots.length > 0) {
                const selectedMesh = renderer.selectedIlots[0];
                const selectedIlot = selectedMesh.userData.ilot;
                const index = selectedMesh.userData.index;

                if (selectedIlot && typeof index === 'number' && index >= 0 && index < generatedIlots.length) {
                    // Remove from array
                    generatedIlots.splice(index, 1);

                    // Re-render
                    renderer.renderIlots(generatedIlots);
        updateLegendTable(); // Update legend when ilots are rendered
                    updateStats();

                    showNotification('Ilot deleted', 'success');
                    e.preventDefault();
                }
            }
        }
    });
}

// ===== UNIT MIX IMPORT SYSTEM =====
let activeUnitMix = null;

function initializeUnitMixImport() {
    const importBtn = document.getElementById('importUnitMixBtn');
    const fileInput = document.getElementById('unitMixFileInput');
    const preview = document.getElementById('unitMixPreview');
    const summary = document.getElementById('unitMixSummary');

    if (!importBtn || !fileInput) return;

    importBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) {
            fileInput.value = ''; // Reset input
            return;
        }

        // Validate file extension
        const fileName = (file.name || '').toLowerCase();
        const validExtensions = ['.csv', '.xlsx', '.xls'];
        const extIndex = fileName.lastIndexOf('.');
        const fileExtension = extIndex >= 0 ? fileName.substring(extIndex) : '';
        const validMimeTypes = [
            'text/csv',
            'application/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];
        const hasValidMime = validMimeTypes.includes((file.type || '').toLowerCase());

        if (!validExtensions.includes(fileExtension) && !hasValidMime) {
            showNotification(`Unsupported file format: ${fileExtension || '(no extension)'}. Use .csv, .xlsx, or .xls`, 'error');
            fileInput.value = ''; // Reset input
            return;
        }

        try {
            showLoader('Importing unit mix...', 5);
            const unitMix = await parseUnitMixFile(file);
            activeUnitMix = unitMix;

            // Display preview
            const totalArea = unitMix.totals.targetArea.toFixed(1);
            const typeCount = unitMix.typologies.length;
            const typesList = unitMix.typologies.map(t => t.name).join(', ');

            summary.innerHTML = `
                <div style="margin-bottom: 5px;"><strong>${typeCount} typologies</strong>: ${typesList}</div>
                <div>Total target: <strong>${totalArea} m²</strong></div>
                <div style="margin-top: 5px; padding: 5px; background: rgba(16, 185, 129, 0.1); border-radius: 4px;">
                    ✓ Unit mix loaded successfully
                </div>
            `;
            preview.style.display = 'block';

            showNotification(`Unit mix loaded: ${typeCount} typologies, ${totalArea} m² target`, 'success');

            // Update distribution inputs to match unit mix
            updateDistributionFromUnitMix(unitMix);
            hideLoader();

        } catch (error) {
            console.error('Unit mix import error:', error);
            const errorMsg = error.message || 'Unit mix import failed';
            showNotification(`Import failed: ${errorMsg}`, 'error');
            preview.style.display = 'none';
            hideLoader();
        }

        fileInput.value = ''; // Reset input
    });
}

async function parseUnitMixFile(file) {
    const API = window.__API_BASE__ || window.location.origin;
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API}/api/import/mix`, {
        method: 'POST',
        body: formData
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Unit mix import failed');
    }

    if (!payload.mix || !payload.mix.typologies) {
        throw new Error('Invalid unit mix response');
    }

    return payload.mix;
}

function updateDistributionFromUnitMix(unitMix) {
    // Convert unit mix to distribution percentages
    const total = unitMix.totals.targetArea;

    const inputs = Array.from(document.querySelectorAll('.distribution-input'));
    const ranges = inputs.map(input => input.dataset.range).filter(Boolean);

    if (!Number.isFinite(total) || total <= 0 || ranges.length === 0) {
        showNotification('Unit mix loaded, but distribution ranges could not be updated.', 'warning');
        return;
    }

    const parsedRanges = ranges.map(range => {
        const parts = range.split('-').map(Number);
        return {
            range,
            min: Number.isFinite(parts[0]) ? parts[0] : 0,
            max: Number.isFinite(parts[1]) ? parts[1] : parts[0],
            center: (Number.isFinite(parts[0]) && Number.isFinite(parts[1]))
                ? (parts[0] + parts[1]) / 2
                : parts[0] || 0
        };
    });

    const distribution = {};
    parsedRanges.forEach(item => {
        distribution[item.range] = 0;
    });

    unitMix.typologies.forEach(typo => {
        const area = Number(typo.targetArea);
        if (!Number.isFinite(area) || area <= 0) return;

        let match = parsedRanges.find(item => area >= item.min && area <= item.max);
        if (!match) {
            match = parsedRanges.reduce((best, item) => {
                const delta = Math.abs(area - item.center);
                if (!best || delta < best.delta) {
                    return { range: item.range, delta };
                }
                return best;
            }, null);
            match = match ? parsedRanges.find(item => item.range === match.range) : null;
        }

        if (match) {
            distribution[match.range] += (area / total) * 100;
        }
    });

    inputs.forEach(input => {
        const range = input.dataset.range;
        const value = distribution[range] || 0;
        input.value = value.toFixed(1);
    });

    let normalized;
    try {
        normalized = normalizePresetDistribution(distribution);
    } catch (error) {
        showNotification(error.message || 'Unit mix distribution invalid', 'error');
        return;
    }
    const distributionEditor = document.getElementById('distributionEditor');
    if (distributionEditor) {
        distributionEditor.value = JSON.stringify(normalized, null, 2);
    }

    updateDistributionTotal();
    showNotification('Unit mix loaded and distribution updated.', 'success');
}

function calculateUnitMixVariance() {
    if (!activeUnitMix || !generatedIlots.length) {
        return null;
    }

    const report = {
        conformity: 0,
        gaps: [],
        extras: [],
        details: []
    };

    // Group ilots by type - normalize type names for matching
    const normalizeTypeName = (name) => {
        if (!name) return 'unknown';
        const str = String(name).trim();
        // Extract base type (e.g., "S (<2m²)" -> "S")
        const match = str.match(/^([A-Za-z0-9]+)/);
        return match ? match[1] : str;
    };

    const ilotsByType = {};
    generatedIlots.forEach(ilot => {
        const type = normalizeTypeName(ilot.type || 'unknown');
        if (!ilotsByType[type]) ilotsByType[type] = [];
        ilotsByType[type].push(ilot);
    });

    let totalConformity = 0;

    activeUnitMix.typologies.forEach(typo => {
        // Normalize typology name for matching
        const typoBaseName = normalizeTypeName(typo.name);
        
        // Try exact match first, then normalized match
        let actual = ilotsByType[typo.name] || ilotsByType[typoBaseName] || [];
        
        // If still no match, try case-insensitive match
        if (actual.length === 0) {
            for (const [type, ilots] of Object.entries(ilotsByType)) {
                if (type.toLowerCase() === typoBaseName.toLowerCase()) {
                    actual = ilots;
                    break;
                }
            }
        }
        
        const actualArea = actual.reduce((sum, ilot) => sum + (ilot.area || ilot.width * ilot.height), 0);
        const deviation = actualArea - typo.targetArea;
        const isWithinTolerance = Math.abs(deviation) <= typo.tolerance;
        const conformityPct = isWithinTolerance ? 100 : Math.max(0, 100 - (Math.abs(deviation) / typo.targetArea) * 100);

        totalConformity += conformityPct;

        report.details.push({
            typologie: typo.name,
            target: typo.targetArea,
            actual: actualArea,
            deviation,
            conformity: conformityPct,
            withinTolerance: isWithinTolerance,
            count: actual.length
        });

        if (deviation < -typo.tolerance) {
            report.gaps.push({
                typologie: typo.name,
                missing: Math.abs(deviation + typo.tolerance)
            });
        } else if (deviation > typo.tolerance) {
            report.extras.push({
                typologie: typo.name,
                excess: deviation - typo.tolerance
            });
        }
    });

    report.conformity = totalConformity / activeUnitMix.typologies.length;
    return report;
}

// ===== EXCEL EXPORT AND VARIANCE REPORTING =====
import { ExcelExporter } from './excelExporter.js';

function initializeExportButtons() {
    const exportBoxListBtn = document.getElementById('exportBoxListBtn');
    const exportTypologyBtn = document.getElementById('exportTypologyBtn');
    const exportVarianceBtn = document.getElementById('exportVarianceBtn');
    const exportAllBtn = document.getElementById('exportAllReportsBtn');
    const refreshVarianceBtn = document.getElementById('refreshVarianceBtn');

    if (exportBoxListBtn) {
        exportBoxListBtn.addEventListener('click', () => {
            if (!generatedIlots.length) {
                showNotification('No ilots to export', 'warning');
                return;
            }
            ExcelExporter.downloadCSV(
                ExcelExporter.exportBoxList(generatedIlots, activeUnitMix),
                'box-list.csv'
            );
            showNotification('Box list exported', 'success');
        });
    }

    if (exportTypologyBtn) {
        exportTypologyBtn.addEventListener('click', () => {
            if (!generatedIlots.length) {
                showNotification('No ilots to export', 'warning');
                return;
            }
            ExcelExporter.downloadCSV(
                ExcelExporter.exportTypologySummary(generatedIlots, activeUnitMix),
                'typologie-summary.csv'
            );
            showNotification('Typologie summary exported', 'success');
        });
    }

    if (exportVarianceBtn) {
        exportVarianceBtn.addEventListener('click', () => {
            if (!activeUnitMix) {
                showNotification('Import unit mix first', 'warning');
                return;
            }
            if (!generatedIlots.length) {
                showNotification('Generate ilots first', 'warning');
                return;
            }
            ExcelExporter.downloadCSV(
                ExcelExporter.exportVarianceReport(generatedIlots, activeUnitMix),
                'variance-report.csv'
            );
            showNotification('Variance report exported', 'success');
        });
    }

    if (exportAllBtn) {
        exportAllBtn.addEventListener('click', () => {
            if (!generatedIlots.length) {
                showNotification('Generate ilots first', 'warning');
                return;
            }
            ExcelExporter.downloadAllReports(generatedIlots, activeUnitMix);
            showNotification('All reports exported!', 'success');
        });
    }

    if (refreshVarianceBtn) {
        refreshVarianceBtn.addEventListener('click', () => {
            updateVarianceDisplay();
        });
    }
}

function updateVarianceDisplay() {
    const varianceReport = document.getElementById('varianceReport');
    const refreshBtn = document.getElementById('refreshVarianceBtn');

    if (!activeUnitMix || !generatedIlots.length) {
        varianceReport.innerHTML = `
            <div style="text-align: center; color: #9ca3af; padding: 20px;">
                Import unit mix + generate ilots to see variance
            </div>
        `;
        refreshBtn.style.display = 'none';
        return;
    }

    const variance = calculateUnitMixVariance();

    let html = `
        <div style="background: ${variance.conformity >= 80 ? '#d1fae5' : '#fee2e2'}; padding: 10px; border-radius: 6px; margin-bottom: 10px;">
            <div style="font-size: 12px; font-weight: 700; color: ${variance.conformity >= 80 ? '#065f46' : '#991b1b'};">
                Overall Conformity
            </div>
            <div style="font-size: 20px; font-weight: 800; color: ${variance.conformity >= 80 ? '#065f46' : '#991b1b'};">
                ${variance.conformity.toFixed(1)}%
            </div>
        </div>
        <div style="max-height: 300px; overflow-y: auto;">
    `;

    variance.details.forEach(detail => {
        const statusColor = detail.withinTolerance ? '#10b981' : '#ef4444';
        const statusIcon = detail.withinTolerance ? '✓' : '⚠';

        html += `
            <div style="padding: 8px; margin-bottom: 6px; background: #f9fafb; border-left: 3px solid ${statusColor}; border-radius: 4px;">
                <div style="font-weight: 600; margin-bottom: 3px;">${statusIcon} ${detail.typologie}</div>
                <div style="color: #6b7280; font-size: 9px;">
                    Target: ${detail.target.toFixed(1)} m² | Actual: ${detail.actual.toFixed(1)} m²
                </div>
                <div style="color: ${detail.deviation >= 0 ? '#ef4444' : '#3b82f6'}; font-size: 9px; font-weight: 600;">
                    ${detail.deviation >= 0 ? '+' : ''}${detail.deviation.toFixed(1)} m² (${detail.conformity.toFixed(0)}%)
                </div>
            </div>
        `;
    });

    html += '</div>';
    varianceReport.innerHTML = html;
    refreshBtn.style.display = 'block';
}

// Hook up top bar Generate buttons to trigger sidebar button clicks
const topGenerateIlotsBtn = document.getElementById('topGenerateIlotsBtn');
const topGenerateCorridorsBtn = document.getElementById('topGenerateCorridorsBtn');

if (topGenerateIlotsBtn) {
    topGenerateIlotsBtn.addEventListener('click', () => {
        const sidebarBtn = document.querySelector('#generateIlotsBtn, button[onclick*="generateIlots"]');
        if (sidebarBtn) {
            sidebarBtn.click();
        } else {
            // Trigger generation directly if available
            if (typeof window.generateIlots === 'function') {
                window.generateIlots();
            }
        }
    });
}

if (topGenerateCorridorsBtn) {
    topGenerateCorridorsBtn.addEventListener('click', () => {
        const sidebarBtn = document.querySelector('#generateCorridorsBtn, button[onclick*="generateCorridors"]');
        if (sidebarBtn) {
            sidebarBtn.click();
        } else {
            // Trigger generation directly if available
            if (typeof window.generateCorridors === 'function') {
                window.generateCorridors();
            }
        }
    });
}

// ============ ADVANCED FEATURES ============

// Heat Map Visualization Toggle
let heatMapEnabled = false;
const heatMapBtn = document.getElementById('heatMapBtn');
if (heatMapBtn) {
    heatMapBtn.addEventListener('click', () => {
        heatMapEnabled = !heatMapEnabled;
        heatMapBtn.classList.toggle('active', heatMapEnabled);

        if (renderer && renderer.ilotMeshes) {
            renderer.ilotMeshes.forEach(mesh => {
                if (heatMapEnabled) {
                    // Color by density (size-based heat map)
                    const ilot = mesh.userData.ilot;
                    const area = ilot.area || (ilot.width * ilot.height);
                    const maxArea = 25; // Max expected area
                    const ratio = Math.min(area / maxArea, 1);

                    // Gradient from green (small) to yellow to red (large)
                    const r = ratio < 0.5 ? ratio * 2 : 1;
                    const g = ratio < 0.5 ? 1 : 1 - (ratio - 0.5) * 2;
                    const b = 0.2;

                    // Apply heat map color to fill (keep blue outline)
                    mesh.material.color.setRGB(r, g, b);
                    mesh.material.opacity = 0.6; // More visible heat map
                } else {
                    // Reset to transparent white fill (blue outline remains)
                    mesh.material.color.setHex(0xffffff);
                    mesh.material.opacity = 0.1; // Very transparent - outline is main feature
                }
            });
            renderer.render();
        }

        // Show single notification (duplicate removal handled in showNotification)
        showNotification(heatMapEnabled ? 'Heat Map: Showing density by size' : 'Heat Map disabled', 'info', { duration: 3000 });
    });
}

// Keyboard Shortcuts Modal
const keyboardShortcutsBtn = document.getElementById('keyboardShortcutsBtn');
if (keyboardShortcutsBtn) {
    keyboardShortcutsBtn.addEventListener('click', () => {
        // Create modal if doesn't exist
        let modal = document.getElementById('shortcutsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'shortcutsModal';
            modal.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: white; padding: 30px; border-radius: 12px; z-index: 10000;
                box-shadow: 0 25px 50px rgba(0,0,0,0.25); max-width: 500px; width: 90%;
            `;
            modal.innerHTML = `
                <h2 style="margin: 0 0 20px; color: #1e293b; display: flex; justify-content: space-between; align-items: center;">
                    <span><i class="fas fa-keyboard"></i> Keyboard Shortcuts</span>
                    <button id="closeShortcutsModal" style="background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
                </h2>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #6366f1;">
                        <strong style="color: #6366f1;">G</strong> - Move mode
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #6366f1;">
                        <strong style="color: #6366f1;">S</strong> - Scale mode
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #6366f1;">
                        <strong style="color: #6366f1;">R</strong> - Rotate mode
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #6366f1;">
                        <strong style="color: #6366f1;">3</strong> - Toggle 3D view
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #10b981;">
                        <strong style="color: #10b981;">M</strong> - Measure distance
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #10b981;">
                        <strong style="color: #10b981;">A</strong> - Measure area
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #10b981;">
                        <strong style="color: #10b981;">N</strong> - Measure angle
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #10b981;">
                        <strong style="color: #10b981;">H</strong> - Reset view
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #ef4444;">
                        <strong style="color: #ef4444;">DEL</strong> - Delete selected
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #ef4444;">
                        <strong style="color: #ef4444;">ESC</strong> - Deselect
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #f59e0b;">
                        <strong style="color: #f59e0b;">Ctrl+Z</strong> - Undo
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #f59e0b;">
                        <strong style="color: #f59e0b;">Ctrl+Y</strong> - Redo
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #3b82f6;">
                        <strong style="color: #3b82f6;">Ctrl+D</strong> - Duplicate
                    </div>
                    <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #3b82f6;">
                        <strong style="color: #3b82f6;">B</strong> - Toggle bloom
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Backdrop
            const backdrop = document.createElement('div');
            backdrop.id = 'shortcutsBackdrop';
            backdrop.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9999;';
            document.body.appendChild(backdrop);

            // Close handlers
            document.getElementById('closeShortcutsModal').addEventListener('click', closeModal);
            backdrop.addEventListener('click', closeModal);
        } else {
            modal.style.display = 'block';
            document.getElementById('shortcutsBackdrop').style.display = 'block';
        }

        function closeModal() {
            document.getElementById('shortcutsModal').style.display = 'none';
            document.getElementById('shortcutsBackdrop').style.display = 'none';
        }
    });
}

// Fit View Button
const fitViewBtn = document.getElementById('fitViewBtn');
if (fitViewBtn && renderer) {
    fitViewBtn.addEventListener('click', () => {
        if (renderer.fitToBounds) {
            renderer.fitToBounds();
            showNotification('View fitted to content', 'info');
        }
    });
}

// Reset Camera Button
const resetCameraBtn = document.getElementById('resetCameraBtn');
if (resetCameraBtn && renderer) {
    resetCameraBtn.addEventListener('click', () => {
        if (renderer.controls) {
            renderer.controls.reset();
            showNotification('Camera reset to default', 'info');
        }
    });
}

// Make top nav pinned by default
document.addEventListener('DOMContentLoaded', () => {
    const topNav = document.querySelector('.top-nav');
    if (topNav) {
        topNav.classList.add('pinned');
    }
});

// ============ SHADOW & BLOOM CONTROLS ============
let shadowsEnabled = true;
let bloomEnabled = false;

const toggleShadowsBtn = document.getElementById('toggleShadowsBtn');
if (toggleShadowsBtn) {
    toggleShadowsBtn.addEventListener('click', () => {
        shadowsEnabled = !shadowsEnabled;
        toggleShadowsBtn.classList.toggle('active', shadowsEnabled);
        if (renderer && renderer.toggleShadows) {
            renderer.toggleShadows(shadowsEnabled);
            showNotification(shadowsEnabled ? 'Shadows enabled' : 'Shadows disabled', 'info');
        }
    });
}

const bloomBtnEl = document.getElementById('bloomBtn');
if (bloomBtnEl) {
    bloomBtnEl.addEventListener('click', () => {
        bloomEnabled = !bloomEnabled;
        bloomBtnEl.classList.toggle('active', bloomEnabled);
        if (renderer && renderer.toggleBloom) {
            renderer.toggleBloom(bloomEnabled);
            showNotification(bloomEnabled ? 'Bloom effect enabled' : 'Bloom effect disabled', 'info');
        }
    });
}

// Grid Toggle
let gridVisible = true;
const gridToggleBtnEl = document.getElementById('gridToggleBtn');
if (gridToggleBtnEl) {
    gridToggleBtnEl.addEventListener('click', () => {
        gridVisible = !gridVisible;
        gridToggleBtnEl.classList.toggle('active', gridVisible);
        if (renderer && renderer.gridHelper) {
            renderer.gridHelper.visible = gridVisible;
            renderer.render();
        }
        showNotification(gridVisible ? 'Grid visible' : 'Grid hidden', 'info');
    });
}

// ============ ADVANCED KEYBOARD SHORTCUTS FOR CAD-STYLE EDITING ============
document.addEventListener('keydown', (e) => {
    if (!editor || !editor.transformControl) return;
    
    switch(e.key.toLowerCase()) {
        case 'g':
            editor.transformControl.setMode('translate');
            showNotification('Move mode (G)', 'info');
            break;
        case 'r':
            editor.transformControl.setMode('rotate');
            showNotification('Rotate mode (R)', 'info');
            break;
        case 's':
            if (!e.ctrlKey) {
                editor.transformControl.setMode('scale');
                showNotification('Scale mode (S)', 'info');
            }
            break;
        case 'b':
            bloomEnabled = !bloomEnabled;
            if (bloomBtnEl) bloomBtnEl.classList.toggle('active', bloomEnabled);
            if (renderer && renderer.toggleBloom) renderer.toggleBloom(bloomEnabled);
            break;
        case '3':
            if (renderer && renderer.toggle3DMode) renderer.toggle3DMode();
            break;
        case 'h':
            if (renderer && renderer.fitToBounds) renderer.fitToBounds();
            break;
    }
});
