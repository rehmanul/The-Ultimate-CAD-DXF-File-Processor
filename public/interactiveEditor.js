// Interactive Ilot Editor - ADVANCED Edition
// Drag, Resize handles, Multi-select, Alignment, Add box, Wall-snap, Properties panel

export class InteractiveEditor {
    constructor(renderer, collisionDetector = null) {
        this.renderer = renderer;
        this.selectedMesh = null;
        this.selectedMeshes = []; // multi-select
        this.editMode = 'translate'; // translate | resize | add
        this.onIlotModified = null;
        this.onIlotAdded = null;
        this.onIlotDeleted = null;
        this.enableSnapping = false;
        this.wallSnapping = true;
        this.gridSize = 0.5;
        this.collisionDetector = collisionDetector;
        this.isDragging = false;
        this.isResizing = false;
        this.resizeHandle = null; // 'n','s','e','w','ne','nw','se','sw'
        this.dragStartPosition = null;
        this.dragStartSize = null;
        this._dragStartPointer = null;
        this._editEnabled = false;
        this._addMode = false;
        this._clipboard = null;
        this._history = [];
        this._historyIndex = -1;
        this.transformControl = { detach(){}, attach(){}, setMode(){}, setSpace(){}, dispose(){} };
        this.setupDragHandlers();
        this._createPropertiesPanel();
    }

    setupDragHandlers() {
        const canvas = this.renderer._canvas;
        if (!canvas) return;

        canvas.addEventListener('pointerdown', (e) => {
            if (!this._editEnabled) return;

            // Add mode: place new box
            if (this._addMode) {
                this._placeNewBox(e);
                return;
            }

            if (!this.selectedMesh) return;

            // Check resize handles first
            const handle = this._hitResizeHandle(e);
            if (handle) {
                this.isResizing = true;
                this.resizeHandle = handle;
                this._dragStartPointer = { x: e.clientX, y: e.clientY };
                this.onDragStart();
                e.preventDefault();
                return;
            }

            const pick = this.renderer.scene.pick(e.offsetX, e.offsetY, m => m === this.selectedMesh);
            if (!pick.hit) return;
            this.isDragging = true;
            this._dragStartPointer = { x: e.clientX, y: e.clientY };
            this.onDragStart();
            e.preventDefault();
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!this._editEnabled) return;

            // Update cursor for resize handles
            if (!this.isDragging && !this.isResizing && this.selectedMesh) {
                const handle = this._hitResizeHandle(e);
                canvas.style.cursor = handle ? this._getResizeCursor(handle) : (this._addMode ? 'crosshair' : 'default');
            }

            if (!this.isDragging && !this.isResizing) return;
            if (!this.selectedMesh) return;

            const cam = this.renderer.camera;
            const vw = cam.orthoRight - cam.orthoLeft;
            const scaleX = vw / canvas.clientWidth;
            const dx = (e.clientX - this._dragStartPointer.x) * scaleX;
            const dy = -(e.clientY - this._dragStartPointer.y) * scaleX;

            if (this.isResizing) {
                this._applyResize(dx, dy);
            } else if (this.editMode === 'translate') {
                const ilot = this.selectedMesh.userData.ilot;
                let newX = this.dragStartPosition.x + dx;
                let newY = this.dragStartPosition.y + dy;

                // Grid snap
                if (this.enableSnapping) {
                    newX = Math.round(newX / this.gridSize) * this.gridSize;
                    newY = Math.round(newY / this.gridSize) * this.gridSize;
                }

                this.selectedMesh.position.x = newX + ilot.width / 2;
                this.selectedMesh.position.y = newY + ilot.height / 2;
            }
            this.renderer.render();
            this._updatePropertiesPanel();
        });

        canvas.addEventListener('pointerup', () => {
            if (this.isDragging) this.onDragEnd();
            if (this.isResizing) this._endResize();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (!this._editEnabled) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Arrow keys: move selected box(es) (no Shift — Shift is for corridors)
            if (!e.shiftKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
                const meshes = this.selectedMeshes.length > 0 ? this.selectedMeshes :
                               (this.selectedMesh ? [this.selectedMesh] : []);
                if (meshes.length === 0) return;
                e.preventDefault();
                const step = e.ctrlKey ? 0.5 : 0.1;
                const deltas = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
                const [ddx, ddy] = deltas[e.key];
                meshes.forEach(m => {
                    const ilot = m.userData?.ilot;
                    if (!ilot || ilot.locked) return;
                    ilot.x += ddx;
                    ilot.y += ddy;
                    m.position.x = ilot.x + ilot.width / 2;
                    m.position.y = ilot.y + ilot.height / 2;
                });
                this.renderer.render();
                this._updatePropertiesPanel();
                return;
            }

            switch(e.key) {
                case 'Delete':
                case 'Backspace':
                    if (this.selectedMesh) { this.deleteSelected(); e.preventDefault(); }
                    break;
                case 'd':
                    if (e.ctrlKey && this.selectedMesh) { this._duplicateAndPlace(); e.preventDefault(); }
                    break;
                case 'c':
                    if (e.ctrlKey && this.selectedMesh) { this._copyToClipboard(); e.preventDefault(); }
                    break;
                case 'v':
                    if (e.ctrlKey && this._clipboard) { this._pasteFromClipboard(); e.preventDefault(); }
                    break;
                case 'Escape':
                    this._addMode = false;
                    this.selectedMesh = null;
                    this.selectedMeshes = [];
                    this._updatePropertiesPanel();
                    break;
                case 'a':
                    if (!e.ctrlKey) { this._addMode = !this._addMode; }
                    if (e.ctrlKey) {
                        // Select all ilots
                        e.preventDefault();
                        this.selectedMeshes = [...this.renderer.ilotMeshes];
                        if (this.selectedMeshes.length > 0) this.selectedMesh = this.selectedMeshes[0];
                    }
                    break;
            }
        });
    }

    // ── Resize handle hit detection ──
    _hitResizeHandle(e) {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return null;
        const ilot = this.selectedMesh.userData.ilot;
        const canvas = this.renderer._canvas;
        const cam = this.renderer.camera;
        const vw = cam.orthoRight - cam.orthoLeft;
        const vh = cam.orthoTop - cam.orthoBottom;
        const scaleX = canvas.clientWidth / vw;
        const scaleY = canvas.clientHeight / vh;

        const corners = {
            nw: { x: ilot.x, y: ilot.y + ilot.height },
            ne: { x: ilot.x + ilot.width, y: ilot.y + ilot.height },
            sw: { x: ilot.x, y: ilot.y },
            se: { x: ilot.x + ilot.width, y: ilot.y },
            n:  { x: ilot.x + ilot.width/2, y: ilot.y + ilot.height },
            s:  { x: ilot.x + ilot.width/2, y: ilot.y },
            e:  { x: ilot.x + ilot.width, y: ilot.y + ilot.height/2 },
            w:  { x: ilot.x, y: ilot.y + ilot.height/2 }
        };

        const threshold = 8; // pixels
        for (const [name, pt] of Object.entries(corners)) {
            const sx = (pt.x - cam.orthoLeft) * scaleX;
            const sy = canvas.clientHeight - (pt.y - cam.orthoBottom) * scaleY;
            if (Math.abs(e.offsetX - sx) < threshold && Math.abs(e.offsetY - sy) < threshold) {
                return name;
            }
        }
        return null;
    }

    _getResizeCursor(handle) {
        const map = { n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize',
                      ne:'nesw-resize', sw:'nesw-resize', nw:'nwse-resize', se:'nwse-resize' };
        return map[handle] || 'default';
    }

    _applyResize(dx, dy) {
        if (!this.selectedMesh || !this.dragStartPosition || !this.dragStartSize) return;
        const ilot = this.selectedMesh.userData.ilot;
        let x = this.dragStartPosition.x, y = this.dragStartPosition.y;
        let w = this.dragStartSize.width, h = this.dragStartSize.height;
        const h_ = this.resizeHandle;

        if (h_.includes('e')) w += dx;
        if (h_.includes('w')) { x += dx; w -= dx; }
        if (h_.includes('n')) h += dy;
        if (h_.includes('s')) { y += dy; h -= dy; }

        w = Math.max(0.2, w);
        h = Math.max(0.2, h);

        if (this.enableSnapping) {
            x = Math.round(x / this.gridSize) * this.gridSize;
            y = Math.round(y / this.gridSize) * this.gridSize;
            w = Math.round(w / this.gridSize) * this.gridSize;
            h = Math.round(h / this.gridSize) * this.gridSize;
        }

        ilot.x = x; ilot.y = y; ilot.width = w; ilot.height = h;
        ilot.area = w * h;
        this.selectedMesh.position.set(x + w/2, y + h/2, this.selectedMesh.position.z);
        this.selectedMesh.scaling.x = w / this.dragStartSize.width;
        this.selectedMesh.scaling.y = h / this.dragStartSize.height;
    }

    _endResize() {
        this.isResizing = false;
        this.resizeHandle = null;
        if (this.selectedMesh && this.selectedMesh.userData.ilot) {
            const ilot = this.selectedMesh.userData.ilot;
            if (this.onIlotModified) {
                this.onIlotModified(ilot, this.selectedMesh.userData.index, {
                    oldPosition: this.dragStartPosition, newPosition: { x: ilot.x, y: ilot.y },
                    oldSize: this.dragStartSize, newSize: { width: ilot.width, height: ilot.height },
                    positionChanged: true, sizeChanged: true
                });
            }
        }
        this._updatePropertiesPanel();
    }

    // ── Add new box mode ──
    _placeNewBox(e) {
        const canvas = this.renderer._canvas;
        const cam = this.renderer.camera;
        const vw = cam.orthoRight - cam.orthoLeft;
        const vh = cam.orthoTop - cam.orthoBottom;
        const worldX = cam.orthoLeft + (e.offsetX / canvas.clientWidth) * vw;
        const worldY = cam.orthoTop - (e.offsetY / canvas.clientHeight) * vh;

        const newIlot = {
            x: worldX - 1.45, y: worldY - 0.6,
            width: 2.90, height: 1.20,
            area: 2.90 * 1.20,
            id: `manual_${Date.now()}`,
            type: 'S', label: 'NEW',
            doorSide: 'top'
        };

        if (this.enableSnapping) {
            newIlot.x = Math.round(newIlot.x / this.gridSize) * this.gridSize;
            newIlot.y = Math.round(newIlot.y / this.gridSize) * this.gridSize;
        }

        if (this.onIlotAdded) this.onIlotAdded(newIlot);
        this._addMode = false;
    }

    // ── Clipboard ──
    _copyToClipboard() {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return;
        this._clipboard = { ...this.selectedMesh.userData.ilot };
    }

    _pasteFromClipboard() {
        if (!this._clipboard) return;
        const ilot = { ...this._clipboard, x: this._clipboard.x + 1, y: this._clipboard.y + 1,
                       id: `paste_${Date.now()}` };
        if (this.onIlotAdded) this.onIlotAdded(ilot);
    }

    _duplicateAndPlace() {
        const dup = this.duplicateSelected();
        if (dup && this.onIlotAdded) this.onIlotAdded(dup);
    }

    // ── Properties Panel ──
    _createPropertiesPanel() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('ilotPropertiesPanel')) return;

        const panel = document.createElement('div');
        panel.id = 'ilotPropertiesPanel';
        panel.style.cssText = `
            position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
            background: rgba(20,20,30,0.95); color: #e0e0e0; padding: 8px 16px;
            border-radius: 8px; font-size: 11px; font-family: 'Space Grotesk', monospace;
            display: none; z-index: 1000; backdrop-filter: blur(10px);
            border: 1px solid rgba(100,150,255,0.3); box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            gap: 12px; align-items: center;
        `;
        panel.innerHTML = `
            <span style="color:#7aa2f7;font-weight:600">Properties</span>
            <label>X: <input type="number" id="propX" step="0.1" style="width:60px;background:#1a1b26;color:#c0caf5;border:1px solid #3b4261;border-radius:3px;padding:2px 4px;font-size:11px"></label>
            <label>Y: <input type="number" id="propY" step="0.1" style="width:60px;background:#1a1b26;color:#c0caf5;border:1px solid #3b4261;border-radius:3px;padding:2px 4px;font-size:11px"></label>
            <label>W: <input type="number" id="propW" step="0.1" min="0.2" style="width:60px;background:#1a1b26;color:#c0caf5;border:1px solid #3b4261;border-radius:3px;padding:2px 4px;font-size:11px"></label>
            <label>H: <input type="number" id="propH" step="0.1" min="0.2" style="width:60px;background:#1a1b26;color:#c0caf5;border:1px solid #3b4261;border-radius:3px;padding:2px 4px;font-size:11px"></label>
            <span id="propArea" style="color:#9ece6a">0.00 m²</span>
            <button id="propApplyBtn" style="background:#7aa2f7;color:#1a1b26;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:600">Apply</button>
        `;
        document.body.appendChild(panel);

        const applyBtn = document.getElementById('propApplyBtn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => this._applyProperties());
        }
        // Live update area display
        ['propX','propY','propW','propH'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.addEventListener('input', () => {
                const w = parseFloat(document.getElementById('propW').value) || 0;
                const h = parseFloat(document.getElementById('propH').value) || 0;
                const areaEl = document.getElementById('propArea');
                if (areaEl) areaEl.textContent = (w * h).toFixed(2) + ' m²';
            });
        });
    }

    _updatePropertiesPanel() {
        const panel = document.getElementById('ilotPropertiesPanel');
        if (!panel) return;
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) {
            panel.style.display = 'none';
            return;
        }
        const ilot = this.selectedMesh.userData.ilot;
        panel.style.display = 'flex';
        document.getElementById('propX').value = ilot.x.toFixed(2);
        document.getElementById('propY').value = ilot.y.toFixed(2);
        document.getElementById('propW').value = ilot.width.toFixed(2);
        document.getElementById('propH').value = ilot.height.toFixed(2);
        document.getElementById('propArea').textContent = (ilot.width * ilot.height).toFixed(2) + ' m²';
    }

    _applyProperties() {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return;
        const ilot = this.selectedMesh.userData.ilot;
        const oldPos = { x: ilot.x, y: ilot.y };
        const oldSize = { width: ilot.width, height: ilot.height };

        ilot.x = parseFloat(document.getElementById('propX').value) || ilot.x;
        ilot.y = parseFloat(document.getElementById('propY').value) || ilot.y;
        ilot.width = Math.max(0.2, parseFloat(document.getElementById('propW').value) || ilot.width);
        ilot.height = Math.max(0.2, parseFloat(document.getElementById('propH').value) || ilot.height);
        ilot.area = ilot.width * ilot.height;

        this.selectedMesh.position.set(ilot.x + ilot.width/2, ilot.y + ilot.height/2, this.selectedMesh.position.z);

        if (this.onIlotModified) {
            this.onIlotModified(ilot, this.selectedMesh.userData.index, {
                oldPosition: oldPos, newPosition: { x: ilot.x, y: ilot.y },
                oldSize, newSize: { width: ilot.width, height: ilot.height },
                positionChanged: true, sizeChanged: true
            });
        }
        this.renderer.render();
    }

    // ── Alignment tools ──
    alignSelected(direction) {
        const meshes = this.selectedMeshes.length > 0 ? this.selectedMeshes :
                       (this.selectedMesh ? [this.selectedMesh] : []);
        if (meshes.length < 2) return;

        const ilots = meshes.map(m => m.userData.ilot).filter(Boolean);
        let ref;
        switch(direction) {
            case 'left':   ref = Math.min(...ilots.map(i => i.x)); ilots.forEach(i => i.x = ref); break;
            case 'right':  ref = Math.max(...ilots.map(i => i.x + i.width)); ilots.forEach(i => i.x = ref - i.width); break;
            case 'top':    ref = Math.max(...ilots.map(i => i.y + i.height)); ilots.forEach(i => i.y = ref - i.height); break;
            case 'bottom': ref = Math.min(...ilots.map(i => i.y)); ilots.forEach(i => i.y = ref); break;
            case 'center-h': ref = ilots.reduce((s,i) => s + i.x + i.width/2, 0) / ilots.length;
                ilots.forEach(i => i.x = ref - i.width/2); break;
            case 'center-v': ref = ilots.reduce((s,i) => s + i.y + i.height/2, 0) / ilots.length;
                ilots.forEach(i => i.y = ref - i.height/2); break;
        }
        meshes.forEach(m => {
            const i = m.userData.ilot;
            if (i) m.position.set(i.x + i.width/2, i.y + i.height/2, m.position.z);
        });
        this.renderer.render();
    }

    distributeSelected(direction) {
        const meshes = this.selectedMeshes.length > 0 ? this.selectedMeshes :
                       (this.selectedMesh ? [this.selectedMesh] : []);
        if (meshes.length < 3) return;

        const ilots = meshes.map(m => ({ mesh: m, ilot: m.userData.ilot })).filter(o => o.ilot);
        if (direction === 'horizontal') {
            ilots.sort((a,b) => a.ilot.x - b.ilot.x);
            const minX = ilots[0].ilot.x;
            const maxX = ilots[ilots.length-1].ilot.x;
            const step = (maxX - minX) / (ilots.length - 1);
            ilots.forEach((o, i) => { o.ilot.x = minX + step * i; });
        } else {
            ilots.sort((a,b) => a.ilot.y - b.ilot.y);
            const minY = ilots[0].ilot.y;
            const maxY = ilots[ilots.length-1].ilot.y;
            const step = (maxY - minY) / (ilots.length - 1);
            ilots.forEach((o, i) => { o.ilot.y = minY + step * i; });
        }
        ilots.forEach(o => {
            o.mesh.position.set(o.ilot.x + o.ilot.width/2, o.ilot.y + o.ilot.height/2, o.mesh.position.z);
        });
        this.renderer.render();
    }

    // ── Core methods (preserved from original) ──
    enableEditMode(enabled) {
        this._editEnabled = enabled;
        if (enabled && this.renderer.selectedIlots && this.renderer.selectedIlots.length > 0) {
            this.selectedMesh = this.renderer.selectedIlots[0];
            const ilot = this.selectedMesh?.userData?.ilot;
            if (ilot?.locked) { this.selectedMesh = null; return; }
            this._updatePropertiesPanel();
        } else {
            this.selectedMesh = null;
            this.dragStartPosition = null;
            this.dragStartSize = null;
            this._updatePropertiesPanel();
        }
        this.renderer.render();
    }

    onDragStart() {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return;
        const ilot = this.selectedMesh.userData.ilot;
        this.dragStartPosition = { x: ilot.x, y: ilot.y };
        this.dragStartSize = { width: ilot.width, height: ilot.height };
    }

    onDragEnd() {
        if (!this.isDragging || !this.selectedMesh || !this.selectedMesh.userData.ilot) return;
        this.isDragging = false;
        this.finalizeTransform();
        this._updatePropertiesPanel();
    }

    setMode(mode) { this.editMode = mode; }

    setAddMode(enabled) {
        this._addMode = enabled;
        const canvas = this.renderer._canvas;
        if (canvas) canvas.style.cursor = enabled ? 'crosshair' : 'default';
    }

    finalizeTransform() {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return;
        const ilot = this.selectedMesh.userData.ilot;
        const pos = this.selectedMesh.position;
        let newX = pos.x - ilot.width / 2;
        let newY = pos.y - ilot.height / 2;
        let newWidth = this.dragStartSize.width;
        let newHeight = this.dragStartSize.height;

        if (this.enableSnapping && this.collisionDetector) {
            const snapped = this.collisionDetector.snapIlotToGrid({ x: newX, y: newY, width: newWidth, height: newHeight }, this.gridSize);
            newX = snapped.x; newY = snapped.y; newWidth = snapped.width; newHeight = snapped.height;
        }

        const positionChanged = (newX !== this.dragStartPosition.x || newY !== this.dragStartPosition.y);
        const sizeChanged = (newWidth !== this.dragStartSize.width || newHeight !== this.dragStartSize.height);
        if (!positionChanged && !sizeChanged) {
            this.selectedMesh.position.set(ilot.x + ilot.width / 2, ilot.y + ilot.height / 2, pos.z);
            return;
        }

        ilot.x = newX; ilot.y = newY; ilot.width = newWidth; ilot.height = newHeight;
        ilot.area = newWidth * newHeight;
        this.selectedMesh.position.set(ilot.x + ilot.width / 2, ilot.y + ilot.height / 2, pos.z);

        if (this.onIlotModified) {
            this.onIlotModified(ilot, this.selectedMesh.userData.index, {
                oldPosition: this.dragStartPosition, newPosition: { x: newX, y: newY },
                oldSize: this.dragStartSize, newSize: { width: newWidth, height: newHeight },
                positionChanged, sizeChanged
            });
        }
    }

    deleteSelected() {
        if (!this.selectedMesh) return null;
        const index = this.selectedMesh.userData.index;
        this.selectedMesh.dispose();
        this.renderer.ilotMeshes.splice(index, 1);
        const deletedMesh = this.selectedMesh;
        this.selectedMesh = null;
        this._updatePropertiesPanel();
        this.renderer.render();
        if (this.onIlotDeleted) this.onIlotDeleted(index);
        return index;
    }

    duplicateSelected() {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return null;
        const ilot = { ...this.selectedMesh.userData.ilot };
        ilot.x += 2; ilot.y += 2;
        ilot.id = `dup_${Date.now()}`;
        return ilot;
    }

    updateCamera(camera) { /* No-op: Babylon.js handles camera changes automatically */ }

    splitSelected(divisions = 2, direction = 'horizontal') {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return null;
        const ilot = this.selectedMesh.userData.ilot;
        const newIlots = [];
        if (direction === 'horizontal' || direction === 'both') {
            const newWidth = ilot.width / divisions;
            for (let i = 0; i < divisions; i++) {
                newIlots.push({ ...ilot, x: ilot.x + i * newWidth, width: newWidth, area: newWidth * ilot.height, id: `${ilot.id}_H${i}` });
            }
        } else if (direction === 'vertical') {
            const newHeight = ilot.height / divisions;
            for (let i = 0; i < divisions; i++) {
                newIlots.push({ ...ilot, y: ilot.y + i * newHeight, height: newHeight, area: ilot.width * newHeight, id: `${ilot.id}_V${i}` });
            }
        }
        return { originalIndex: this.selectedMesh.userData.index, newIlots };
    }

    canMerge(ilot1, ilot2) {
        const tolerance = 0.01;
        if (Math.abs(ilot1.y - ilot2.y) < tolerance && Math.abs(ilot1.height - ilot2.height) < tolerance) {
            if (Math.abs(ilot1.x + ilot1.width - ilot2.x) < tolerance || Math.abs(ilot2.x + ilot2.width - ilot1.x) < tolerance) return 'horizontal';
        }
        if (Math.abs(ilot1.x - ilot2.x) < tolerance && Math.abs(ilot1.width - ilot2.width) < tolerance) {
            if (Math.abs(ilot1.y + ilot1.height - ilot2.y) < tolerance || Math.abs(ilot2.y + ilot2.height - ilot1.y) < tolerance) return 'vertical';
        }
        return null;
    }

    mergeIlots(ilot1, ilot2) {
        const direction = this.canMerge(ilot1, ilot2);
        if (!direction) return null;
        if (direction === 'horizontal') {
            const minX = Math.min(ilot1.x, ilot2.x), maxX = Math.max(ilot1.x + ilot1.width, ilot2.x + ilot2.width);
            return { ...ilot1, x: minX, width: maxX - minX, area: (maxX - minX) * ilot1.height, id: `${ilot1.id}_MERGED` };
        } else {
            const minY = Math.min(ilot1.y, ilot2.y), maxY = Math.max(ilot1.y + ilot1.height, ilot2.y + ilot2.height);
            return { ...ilot1, y: minY, height: maxY - minY, area: ilot1.width * (maxY - minY), id: `${ilot1.id}_MERGED` };
        }
    }

    // ══════════════════════════════════════════════════════════════
    // ═══ ADVANCED TOOLS ═════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════

    /** Rotate selected box 90° (swap width ↔ height) */
    rotate90() {
        const meshes = this.selectedMeshes.length > 0 ? this.selectedMeshes :
                       (this.selectedMesh ? [this.selectedMesh] : []);
        if (!meshes.length) return 0;
        let count = 0;
        meshes.forEach(m => {
            const ilot = m.userData?.ilot;
            if (!ilot || ilot.locked) return;
            const cx = ilot.x + ilot.width / 2, cy = ilot.y + ilot.height / 2;
            const tmp = ilot.width;
            ilot.width = ilot.height;
            ilot.height = tmp;
            ilot.x = cx - ilot.width / 2;
            ilot.y = cy - ilot.height / 2;
            ilot.area = ilot.width * ilot.height;
            m.position.set(ilot.x + ilot.width / 2, ilot.y + ilot.height / 2, m.position.z);
            count++;
        });
        if (count) this.renderer.render();
        return count;
    }

    /** Mirror selected boxes horizontally around their collective center */
    mirrorHorizontal(allIlots) {
        const meshes = this.selectedMeshes.length > 0 ? this.selectedMeshes :
                       (this.selectedMesh ? [this.selectedMesh] : []);
        if (!meshes.length) return 0;
        const ilots = meshes.map(m => m.userData?.ilot).filter(Boolean);
        if (!ilots.length) return 0;
        const cx = ilots.reduce((s, i) => s + i.x + i.width / 2, 0) / ilots.length;
        ilots.forEach(i => { i.x = 2 * cx - i.x - i.width; });
        meshes.forEach(m => {
            const i = m.userData.ilot;
            if (i) m.position.set(i.x + i.width / 2, i.y + i.height / 2, m.position.z);
        });
        this.renderer.render();
        return ilots.length;
    }

    /** Generate a single row of boxes from startX to endX at given Y */
    generateRow(startX, endX, y, boxW, boxH, gap = 0) {
        const boxes = [];
        let ox = startX;
        while (ox + boxW * 0.3 <= endX) {
            const w = Math.min(boxW, endX - ox);
            if (w >= boxW * 0.3) {
                boxes.push({
                    x: ox, y: y, width: w, height: boxH,
                    area: w * boxH, id: `gen_${Date.now()}_${boxes.length}`,
                    type: 'M', label: `${(w * boxH).toFixed(1)}m²`,
                    partitionType: 'toleGrise', doorSide: 'bottom'
                });
            }
            ox += w + gap;
        }
        return boxes;
    }

    /** Generate a corridor pair: two facing rows + corridor between them */
    generateCorridorPair(startX, endX, startY, boxW, boxH, corrW, gap = 0) {
        const rowA = this.generateRow(startX, endX, startY, boxW, boxH, gap);
        rowA.forEach(b => { b.doorSide = 'top'; });
        const corrY = startY + boxH;
        const corridor = {
            id: `corr_${Date.now()}`, x: startX, y: corrY,
            width: endX - startX, height: corrW,
            direction: 'horizontal', type: 'main',
            corners: [
                { x: startX, y: corrY }, { x: endX, y: corrY },
                { x: endX, y: corrY + corrW }, { x: startX, y: corrY + corrW }
            ]
        };
        const rowBY = corrY + corrW;
        const rowB = this.generateRow(startX, endX, rowBY, boxW, boxH, gap);
        rowB.forEach(b => { b.doorSide = 'bottom'; });
        return { boxes: [...rowA, ...rowB], corridor, pairHeight: boxH + corrW + boxH };
    }

    /** Fill entire building with corridor pairs */
    fillBuilding(bounds, boxW, boxH, corrW, gap = 0, excludeZones = []) {
        if (!bounds) return { boxes: [], corridors: [] };
        const allBoxes = [], allCorridors = [];
        const pairH = boxH + corrW + boxH;
        let cy = bounds.minY;
        while (cy + pairH <= bounds.maxY + 0.01) {
            const pair = this.generateCorridorPair(
                bounds.minX, bounds.maxX, cy, boxW, boxH, corrW, gap
            );
            // Filter out boxes that overlap exclude zones
            const filtered = pair.boxes.filter(b => {
                const bcx = b.x + b.width / 2, bcy = b.y + b.height / 2;
                return !excludeZones.some(z =>
                    bcx > z.x && bcx < z.x + z.w &&
                    bcy > z.y && bcy < z.y + z.h
                );
            });
            allBoxes.push(...filtered);
            allCorridors.push(pair.corridor);
            cy += pairH;
        }
        // Fill remaining space with a single row if enough room
        if (cy + boxH <= bounds.maxY + 0.01) {
            const lastRow = this.generateRow(bounds.minX, bounds.maxX, cy, boxW, boxH, gap);
            const filtered = lastRow.filter(b => {
                const bcx = b.x + b.width / 2, bcy = b.y + b.height / 2;
                return !excludeZones.some(z =>
                    bcx > z.x && bcx < z.x + z.w &&
                    bcy > z.y && bcy < z.y + z.h
                );
            });
            allBoxes.push(...filtered);
        }
        return { boxes: allBoxes, corridors: allCorridors };
    }

    /** Fill gaps between existing boxes in the same row */
    fillGaps(existingIlots, boxW, boxH, bounds) {
        if (!bounds || !existingIlots.length) return [];
        // Group boxes by Y (row tolerance 0.3m)
        const rowTol = 0.3;
        const rows = {};
        existingIlots.forEach(b => {
            const ky = Math.round(b.y / rowTol) * rowTol;
            if (!rows[ky]) rows[ky] = [];
            rows[ky].push(b);
        });
        const newBoxes = [];
        Object.values(rows).forEach(rowBoxes => {
            rowBoxes.sort((a, b) => a.x - b.x);
            const rowY = rowBoxes[0].y;
            const rowH = rowBoxes[0].height;
            // Fill gap before first box
            if (rowBoxes[0].x - bounds.minX > boxW * 0.4) {
                const gap = this.generateRow(bounds.minX, rowBoxes[0].x, rowY, boxW, rowH, 0);
                newBoxes.push(...gap);
            }
            // Fill gaps between boxes
            for (let i = 0; i < rowBoxes.length - 1; i++) {
                const endPrev = rowBoxes[i].x + rowBoxes[i].width;
                const startNext = rowBoxes[i + 1].x;
                if (startNext - endPrev > boxW * 0.4) {
                    const gap = this.generateRow(endPrev, startNext, rowY, boxW, rowH, 0);
                    newBoxes.push(...gap);
                }
            }
            // Fill gap after last box
            const lastEnd = rowBoxes[rowBoxes.length - 1].x + rowBoxes[rowBoxes.length - 1].width;
            if (bounds.maxX - lastEnd > boxW * 0.4) {
                const gap = this.generateRow(lastEnd, bounds.maxX, rowY, boxW, rowH, 0);
                newBoxes.push(...gap);
            }
        });
        return newBoxes;
    }

    /** Select all boxes in the same row as the selected box */
    selectRow(allMeshes, tolerance = 0.3) {
        if (!this.selectedMesh) return [];
        const refY = this.selectedMesh.userData?.ilot?.y;
        if (typeof refY !== 'number') return [];
        this.selectedMeshes = allMeshes.filter(m => {
            const iy = m.userData?.ilot?.y;
            return typeof iy === 'number' && Math.abs(iy - refY) < tolerance;
        });
        if (this.selectedMeshes.length) this.selectedMesh = this.selectedMeshes[0];
        return this.selectedMeshes;
    }

    /** Clear all boxes within a rectangular area */
    clearArea(ilots, x1, y1, x2, y2) {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        const removed = [];
        const kept = [];
        ilots.forEach((b, i) => {
            const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
            if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
                removed.push(i);
            } else {
                kept.push(b);
            }
        });
        return { kept, removedCount: removed.length };
    }

    /** Delete all currently selected boxes */
    deleteMultiple(ilots) {
        const meshes = this.selectedMeshes.length > 0 ? this.selectedMeshes :
                       (this.selectedMesh ? [this.selectedMesh] : []);
        if (!meshes.length) return { remaining: ilots, deletedCount: 0 };
        const indices = new Set(meshes.map(m => m.userData?.index).filter(i => typeof i === 'number'));
        const remaining = ilots.filter((_, i) => !indices.has(i));
        this.selectedMesh = null;
        this.selectedMeshes = [];
        this._updatePropertiesPanel();
        return { remaining, deletedCount: indices.size };
    }

    /** Apply box properties (type, partition, door side) to selected */
    applyBoxProps(ilots, props, scope = 'selected') {
        let targets;
        if (scope === 'all') {
            targets = ilots;
        } else if (scope === 'row' && this.selectedMesh?.userData?.ilot) {
            const refY = this.selectedMesh.userData.ilot.y;
            targets = ilots.filter(i => Math.abs(i.y - refY) < 0.3);
        } else {
            const meshes = this.selectedMeshes.length > 0 ? this.selectedMeshes :
                           (this.selectedMesh ? [this.selectedMesh] : []);
            targets = meshes.map(m => m.userData?.ilot).filter(Boolean);
        }
        let count = 0;
        targets.forEach(i => {
            if (props.type) i.type = props.type;
            if (props.partitionType) i.partitionType = props.partitionType;
            if (props.doorSide) i.doorSide = props.doorSide;
            i.label = `${i.area?.toFixed(1) || '?'}m²`;
            count++;
        });
        return count;
    }

    /** Setup rubber-band rectangle selection */
    setupRubberBand() {
        const canvas = this.renderer._canvas;
        if (!canvas || this._rubberBandSetup) return;
        this._rubberBandSetup = true;
        this._rbActive = false;
        this._rbStart = null;

        // Create visual overlay
        const overlay = document.createElement('div');
        overlay.id = 'rubberBandOverlay';
        overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px dashed #bb9af7;background:rgba(187,154,247,0.1);display:none;z-index:999;';
        document.body.appendChild(overlay);

        canvas.addEventListener('pointerdown', (e) => {
            if (!this._rbMode || !this._editEnabled) return;
            this._rbActive = true;
            this._rbStart = { x: e.clientX, y: e.clientY };
            overlay.style.display = 'block';
            e.preventDefault();
            e.stopPropagation();
        }, true);

        canvas.addEventListener('pointermove', (e) => {
            if (!this._rbActive || !this._rbStart) return;
            const x = Math.min(e.clientX, this._rbStart.x);
            const y = Math.min(e.clientY, this._rbStart.y);
            const w = Math.abs(e.clientX - this._rbStart.x);
            const h = Math.abs(e.clientY - this._rbStart.y);
            overlay.style.left = x + 'px';
            overlay.style.top = y + 'px';
            overlay.style.width = w + 'px';
            overlay.style.height = h + 'px';
        });

        canvas.addEventListener('pointerup', (e) => {
            if (!this._rbActive || !this._rbStart) return;
            this._rbActive = false;
            overlay.style.display = 'none';

            // Convert screen rect to world coords
            const cam = this.renderer.camera;
            const rect = canvas.getBoundingClientRect();
            const vw = cam.orthoRight - cam.orthoLeft;
            const vh = cam.orthoTop - cam.orthoBottom;
            const toWorldX = (sx) => cam.orthoLeft + ((sx - rect.left) / rect.width) * vw;
            const toWorldY = (sy) => cam.orthoTop - ((sy - rect.top) / rect.height) * vh;

            const wx1 = toWorldX(Math.min(this._rbStart.x, e.clientX));
            const wx2 = toWorldX(Math.max(this._rbStart.x, e.clientX));
            const wy1 = toWorldY(Math.max(this._rbStart.y, e.clientY));
            const wy2 = toWorldY(Math.min(this._rbStart.y, e.clientY));

            // Select all meshes whose center falls within the rectangle
            this.selectedMeshes = (this.renderer.ilotMeshes || []).filter(m => {
                const ilot = m.userData?.ilot;
                if (!ilot) return false;
                const cx = ilot.x + ilot.width / 2, cy = ilot.y + ilot.height / 2;
                return cx >= wx1 && cx <= wx2 && cy >= wy1 && cy <= wy2;
            });
            if (this.selectedMeshes.length) {
                this.selectedMesh = this.selectedMeshes[0];
            }
            this._rbStart = null;
        });
    }

    setRubberBandMode(enabled) {
        this._rbMode = enabled;
        this.setupRubberBand();
        const canvas = this.renderer._canvas;
        if (canvas) canvas.style.cursor = enabled ? 'crosshair' : 'default';
    }
}
