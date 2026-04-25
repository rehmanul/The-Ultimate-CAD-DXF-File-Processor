// Path/Corridor Interactive Editor — Select, Drag, Resize, Delete, Add, Flip
// Mirrors InteractiveEditor for boxes but targets corridor meshes
import * as THREE from 'three';

export class PathEditor {
    constructor(renderer) {
        this.renderer = renderer;
        this.selectedMesh = null;
        this._selectedMeshes = [];
        this._highlightColor = 0x00E5FF; // cyan for selected corridors
        this._editEnabled = false;
        this.isDragging = false;
        this._isResizing = false;
        this._resizeHandle = null;
        this._resizeHandleMeshes = [];
        this._drawMode = false; // for "Add Corridor" click-drag
        this._drawStart = null;
        this._drawPreviewMesh = null;
        this.onCorridorModified = null;
        this.onCorridorDeleted = null;
        this.onCorridorAdded = null;

        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();
        this._plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this._dragStartWorld = new THREE.Vector3();
        this._dragStartPos = null;
        this._dragStartSize = null;
        this.arrowKeyStep = 0.1;

        // Defer event attachment until canvas is ready
        setTimeout(() => this._attachEvents(), 500);
        this._setupKeyboard();
    }

    _getCanvas() {
        return this.renderer?.renderer?.domElement || this.renderer?._canvas || null;
    }

    _screenToWorld(cx, cy) {
        const canvas = this._getCanvas();
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        this._mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
        const cam = this.renderer.camera;
        if (!cam) return null;
        this._raycaster.setFromCamera(this._mouse, cam);
        const pt = new THREE.Vector3();
        this._raycaster.ray.intersectPlane(this._plane, pt);
        return pt;
    }

    _pickCorridorMesh(cx, cy) {
        const canvas = this._getCanvas();
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        this._mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
        const cam = this.renderer.camera;
        if (!cam) return null;
        this._raycaster.setFromCamera(this._mouse, cam);
        // Check resize handles first
        if (this._resizeHandleMeshes.length > 0) {
            const hh = this._raycaster.intersectObjects(this._resizeHandleMeshes, false);
            if (hh.length > 0) return hh[0].object;
        }
        const meshes = this.renderer.corridorMeshes || [];
        const hits = this._raycaster.intersectObjects(meshes, false);
        return hits.length > 0 ? hits[0].object : null;
    }

    // ── Events ──
    _attachEvents() {
        const canvas = this._getCanvas();
        if (!canvas || this._attached) {
            if (!canvas) setTimeout(() => this._attachEvents(), 1000);
            return;
        }
        this._attached = true;

        canvas.addEventListener('pointerdown', (e) => {
            if (!this._editEnabled || e.button !== 0) return;

            // Draw mode — click-drag to create new corridor
            if (this._drawMode) {
                const wp = this._screenToWorld(e.clientX, e.clientY);
                if (!wp) return;
                this._drawStart = { x: wp.x, y: wp.y };
                // Disable orbit controls so drag works
                if (this.renderer.controls) this.renderer.controls.enabled = false;
                e.preventDefault(); e.stopPropagation();
                return;
            }

            const hit = this._pickCorridorMesh(e.clientX, e.clientY);

            // Resize handle
            if (hit && hit.userData?.isResizeHandle) {
                this._isResizing = true;
                this._resizeHandle = hit.userData.handleType;
                const c = this.selectedMesh?.userData?.corridor;
                if (c) {
                    this._dragStartPos = { x: c.x, y: c.y };
                    this._dragStartSize = { width: c.width, height: c.height };
                }
                const wp = this._screenToWorld(e.clientX, e.clientY);
                if (wp) this._dragStartWorld.copy(wp);
                if (this.renderer.controls) this.renderer.controls.enabled = false;
                e.preventDefault(); e.stopPropagation();
                return;
            }

            // Click empty — deselect
            if (!hit || !hit.userData?.corridor) {
                if (!e.ctrlKey && !e.metaKey) this.clearSelection();
                return;
            }

            // Multi-select with Ctrl
            if (e.ctrlKey || e.metaKey) {
                const idx = this._selectedMeshes.indexOf(hit);
                if (idx >= 0) {
                    this._selectedMeshes.splice(idx, 1);
                    if (hit.material?._origColor !== undefined) hit.material.color.setHex(hit.material._origColor);
                } else {
                    this._selectedMeshes.push(hit);
                    if (hit.material) {
                        if (hit.material._origColor === undefined) hit.material._origColor = hit.material.color.getHex();
                        hit.material.color.setHex(this._highlightColor);
                    }
                }
                this.selectedMesh = this._selectedMeshes[this._selectedMeshes.length - 1] || null;
                this._updateResizeHandlesForSelection();
                this.renderer.render();
                e.preventDefault();
                return;
            }

            this.clearSelection();
            this._selectMesh(hit);
            this.isDragging = true;
            const wp = this._screenToWorld(e.clientX, e.clientY);
            if (wp) this._dragStartWorld.copy(wp);
            const c = hit.userData.corridor;
            this._dragStartPos = { x: c.x, y: c.y };
            this._dragStartSize = { width: c.width, height: c.height };
            for (const m of this._selectedMeshes) {
                const cc = m.userData?.corridor;
                if (cc) m._dragGroupStart = { x: cc.x, y: cc.y };
            }
            if (this.renderer.controls) this.renderer.controls.enabled = false;
            e.preventDefault(); e.stopPropagation();
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!this._editEnabled) return;

            // Draw mode preview
            if (this._drawMode && this._drawStart) {
                const wp = this._screenToWorld(e.clientX, e.clientY);
                if (wp) this._updateDrawPreview(this._drawStart, { x: wp.x, y: wp.y });
                e.preventDefault();
                return;
            }

            // Resize
            if (this._isResizing && this.selectedMesh?.userData?.corridor) {
                const wp = this._screenToWorld(e.clientX, e.clientY);
                if (!wp) return;
                const dx = wp.x - this._dragStartWorld.x;
                const dy = wp.y - this._dragStartWorld.y;
                const c = this.selectedMesh.userData.corridor;
                const minS = 0.3;
                let nx = this._dragStartPos.x, ny = this._dragStartPos.y;
                let nw = this._dragStartSize.width, nh = this._dragStartSize.height;
                const h = this._resizeHandle;
                if (h.includes('e')) nw = Math.max(minS, this._dragStartSize.width + dx);
                if (h.includes('w')) { nx = this._dragStartPos.x + dx; nw = Math.max(minS, this._dragStartSize.width - dx); }
                if (h === 'n' || h === 'ne' || h === 'nw') nh = Math.max(minS, this._dragStartSize.height + dy);
                if (h === 's' || h === 'se' || h === 'sw') { ny = this._dragStartPos.y + dy; nh = Math.max(minS, this._dragStartSize.height - dy); }
                c.x = nx; c.y = ny; c.width = nw; c.height = nh;
                this.selectedMesh.geometry.dispose();
                this.selectedMesh.geometry = new THREE.PlaneGeometry(nw, nh);
                this.selectedMesh.position.set(nx + nw / 2, ny + nh / 2, this.selectedMesh.position.z);
                this._updateResizeHandles();
                this.renderer.render();
                return;
            }

            // Drag
            if (!this.isDragging || !this.selectedMesh) return;
            const wp = this._screenToWorld(e.clientX, e.clientY);
            if (!wp) return;
            const dx = wp.x - this._dragStartWorld.x;
            const dy = wp.y - this._dragStartWorld.y;
            const targets = this._selectedMeshes.length > 1 ? this._selectedMeshes : [this.selectedMesh];
            for (const m of targets) {
                const c = m.userData?.corridor;
                if (!c) continue;
                const st = m._dragGroupStart || this._dragStartPos;
                m.position.x = st.x + c.width / 2 + dx;
                m.position.y = st.y + c.height / 2 + dy;
            }
            this.renderer.render();
        });

        canvas.addEventListener('pointerup', (e) => {
            // Draw mode — complete the draw
            if (this._drawMode && this._drawStart) {
                const wp = this._screenToWorld(e.clientX, e.clientY);
                if (wp) {
                    const dx = Math.abs(wp.x - this._drawStart.x);
                    const dy = Math.abs(wp.y - this._drawStart.y);
                    if (dx > 0.3 || dy > 0.3) {
                        this._finalizeDraw(this._drawStart, { x: wp.x, y: wp.y });
                    } else {
                        // Too small — cancel
                        console.log('[PathEditor] Draw cancelled — too small');
                    }
                }
                this._drawStart = null;
                this._removeDrawPreview();
                if (this.renderer.controls) this.renderer.controls.enabled = true;
                return;
            }

            if (this._isResizing) {
                this._isResizing = false;
                this._resizeHandle = null;
                const c = this.selectedMesh?.userData?.corridor;
                if (c && this.onCorridorModified) {
                    this.onCorridorModified(c, this.selectedMesh.userData.index);
                }
                if (this.renderer.controls) this.renderer.controls.enabled = true;
                return;
            }

            if (this.isDragging) {
                this.isDragging = false;
                const targets = this._selectedMeshes.length > 1 ? this._selectedMeshes : (this.selectedMesh ? [this.selectedMesh] : []);
                for (const m of targets) {
                    const c = m.userData?.corridor;
                    if (!c) continue;
                    c.x = m.position.x - c.width / 2;
                    c.y = m.position.y - c.height / 2;
                    delete m._dragGroupStart;
                    if (this.onCorridorModified) this.onCorridorModified(c, m.userData.index);
                }
                this._updateResizeHandles();
                if (this.renderer.controls) this.renderer.controls.enabled = true;
            }
        });
    }

    // ── Keyboard ──
    _setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (!this._editEnabled) return;
            // Don't steal keys from input fields
            if (e.target.matches('input, textarea, select')) return;

            const targets = this._selectedMeshes.length > 0 ? this._selectedMeshes : (this.selectedMesh ? [this.selectedMesh] : []);
            if (targets.length === 0) return;

            if (e.key === 'Delete') {
                this.deleteSelected();
                e.preventDefault();
                return;
            }

            // Arrow keys move selected paths
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;

            let dx = 0, dy = 0;
            const step = e.shiftKey ? this.arrowKeyStep * 5 : this.arrowKeyStep;
            if (e.key === 'ArrowLeft') dx = -step;
            if (e.key === 'ArrowRight') dx = step;
            if (e.key === 'ArrowUp') dy = step;
            if (e.key === 'ArrowDown') dy = -step;

            e.preventDefault(); e.stopPropagation();
            for (const m of targets) {
                const c = m.userData?.corridor;
                if (!c) continue;
                c.x += dx; c.y += dy;
                m.position.x = c.x + c.width / 2;
                m.position.y = c.y + c.height / 2;
                if (this.onCorridorModified) this.onCorridorModified(c, m.userData.index);
            }
            this._updateResizeHandles();
            this.renderer.render();
        });
    }

    // ── Selection ──
    _selectMesh(mesh) {
        if (this.selectedMesh && this.selectedMesh !== mesh && this.selectedMesh.material?._origColor !== undefined) {
            this.selectedMesh.material.color.setHex(this.selectedMesh.material._origColor);
        }
        this.selectedMesh = mesh;
        if (mesh && !this._selectedMeshes.includes(mesh)) this._selectedMeshes = [mesh];
        if (mesh?.material) {
            if (mesh.material._origColor === undefined) mesh.material._origColor = mesh.material.color.getHex();
            mesh.material.color.setHex(this._highlightColor);
        }
        this._createResizeHandles();
        this.renderer.render();
    }

    clearSelection() {
        for (const m of this._selectedMeshes) {
            if (m.material?._origColor !== undefined) m.material.color.setHex(m.material._origColor);
        }
        this._selectedMeshes = [];
        this.selectedMesh = null;
        this._removeResizeHandles();
        if (this.renderer) this.renderer.render();
    }

    enableEditMode(enabled) {
        this._editEnabled = enabled;
        if (!enabled) {
            this.clearSelection();
            this.exitDrawMode();
        }
        if (enabled && !this._attached) this._attachEvents();
    }

    getSelectedCorridors() {
        return this._selectedMeshes.map(m => m.userData?.corridor).filter(Boolean);
    }

    selectAll() {
        this.clearSelection();
        const meshes = this.renderer.corridorMeshes || [];
        for (const m of meshes) {
            if (m.userData?.corridor) {
                this._selectedMeshes.push(m);
                if (m.material) {
                    if (m.material._origColor === undefined) m.material._origColor = m.material.color.getHex();
                    m.material.color.setHex(this._highlightColor);
                }
            }
        }
        this.selectedMesh = this._selectedMeshes[0] || null;
        if (this.selectedMesh) this._createResizeHandles();
        this.renderer.render();
        return this._selectedMeshes.length;
    }

    // ── Delete ──
    deleteSelected() {
        const targets = this._selectedMeshes.length > 0 ? [...this._selectedMeshes] : (this.selectedMesh ? [this.selectedMesh] : []);
        if (targets.length === 0) return [];
        this._removeResizeHandles();
        const deletedIndices = [];
        for (const m of targets) {
            const idx = m.userData?.index;
            if (idx !== undefined) deletedIndices.push(idx);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
            if (m.parent) m.parent.remove(m);
            const arr = this.renderer.corridorMeshes;
            if (arr) {
                const i = arr.indexOf(m);
                if (i >= 0) arr.splice(i, 1);
            }
        }
        this._selectedMeshes = [];
        this.selectedMesh = null;
        this.renderer.render();
        if (this.onCorridorDeleted) this.onCorridorDeleted(deletedIndices);
        return deletedIndices;
    }

    // ── Flip Direction ──
    // Only flips the flow direction of the arrows, NOT the corridor geometry direction
    flipDirection() {
        const targets = this._selectedMeshes.length > 0 ? this._selectedMeshes : (this.selectedMesh ? [this.selectedMesh] : []);
        for (const m of targets) {
            const c = m.userData?.corridor;
            if (!c) continue;
            // Swap start/end of path (reverses arrow direction) but keep geometry direction
            if (Array.isArray(c.path) && c.path.length >= 2) {
                c.path.reverse();
            }
            // Toggle flow direction indicator
            if (c.flowDirection === 'positive') c.flowDirection = 'negative';
            else c.flowDirection = 'positive';
            if (this.onCorridorModified) this.onCorridorModified(c, m.userData.index);
        }
    }

    // ── Width Adjust ──
    adjustWidth(delta) {
        const targets = this._selectedMeshes.length > 0 ? this._selectedMeshes : (this.selectedMesh ? [this.selectedMesh] : []);
        for (const m of targets) {
            const c = m.userData?.corridor;
            if (!c) continue;
            const isH = (c.direction === 'horizontal') || (c.width > c.height);
            if (isH) {
                c.height = Math.max(0.3, c.height + delta);
            } else {
                c.width = Math.max(0.3, c.width + delta);
            }
            m.geometry.dispose();
            m.geometry = new THREE.PlaneGeometry(c.width, c.height);
            m.position.set(c.x + c.width / 2, c.y + c.height / 2, m.position.z);
            if (this.onCorridorModified) this.onCorridorModified(c, m.userData.index);
        }
        this._updateResizeHandles();
        this.renderer.render();
    }

    // ── Draw Mode ──
    enterDrawMode() {
        this._drawMode = true;
        this._drawStart = null;
        this.clearSelection();
        console.log('[PathEditor] Draw mode ENTERED — click & drag on canvas to draw corridor');
    }

    exitDrawMode() {
        this._drawMode = false;
        this._drawStart = null;
        this._removeDrawPreview();
        if (this.renderer.controls) this.renderer.controls.enabled = true;
    }

    _updateDrawPreview(start, end) {
        this._removeDrawPreview();
        const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
        if (w < 0.1 && h < 0.1) return;
        const geo = new THREE.PlaneGeometry(w, h);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00E5FF, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
        this._drawPreviewMesh = new THREE.Mesh(geo, mat);
        this._drawPreviewMesh.position.set(x + w / 2, y + h / 2, 0.3);
        this.renderer.scene.add(this._drawPreviewMesh);
        this.renderer.render();
    }

    _removeDrawPreview() {
        if (this._drawPreviewMesh) {
            if (this._drawPreviewMesh.geometry) this._drawPreviewMesh.geometry.dispose();
            if (this._drawPreviewMesh.material) this._drawPreviewMesh.material.dispose();
            if (this._drawPreviewMesh.parent) this._drawPreviewMesh.parent.remove(this._drawPreviewMesh);
            this._drawPreviewMesh = null;
        }
    }

    _finalizeDraw(start, end) {
        const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x) || 0.8;
        const h = Math.abs(end.y - start.y) || 0.8;
        const isHorizontal = w > h;
        const corridor = {
            id: `corridor_user_${Date.now()}`,
            x, y, width: w, height: h,
            direction: isHorizontal ? 'horizontal' : 'vertical',
            type: 'user_drawn',
            flowDirection: 'positive'
        };
        console.log('[PathEditor] Draw finalized:', corridor);
        if (this.onCorridorAdded) this.onCorridorAdded(corridor);
        this._drawMode = false; // exit draw mode after placing
    }

    // ── Resize Handles — only shown when a single corridor is selected ──
    _createResizeHandles() {
        this._removeResizeHandles();
        if (!this.selectedMesh?.userData?.corridor) return;
        const c = this.selectedMesh.userData.corridor;
        const z = 0.5;
        const sz = 0.18;
        const geo = new THREE.PlaneGeometry(sz, sz);
        const mat = new THREE.MeshBasicMaterial({ color: 0xFF5722, side: THREE.DoubleSide });
        const positions = {
            'n':  { x: c.x + c.width / 2, y: c.y + c.height },
            'e':  { x: c.x + c.width,      y: c.y + c.height / 2 },
            's':  { x: c.x + c.width / 2, y: c.y },
            'w':  { x: c.x,                y: c.y + c.height / 2 }
        };
        for (const [handle, pos] of Object.entries(positions)) {
            const mesh = new THREE.Mesh(geo.clone(), mat.clone());
            mesh.position.set(pos.x, pos.y, z);
            mesh.userData = { isResizeHandle: true, handleType: handle };
            this.renderer.scene.add(mesh);
            this._resizeHandleMeshes.push(mesh);
        }
    }

    _updateResizeHandlesForSelection() {
        this._removeResizeHandles();
        if (this._selectedMeshes.length === 1) {
            this.selectedMesh = this._selectedMeshes[0];
            this._createResizeHandles();
        }
    }

    _updateResizeHandles() {
        if (this._resizeHandleMeshes.length === 0 || !this.selectedMesh?.userData?.corridor) return;
        const c = this.selectedMesh.userData.corridor;
        const positions = {
            'n': { x: c.x + c.width / 2, y: c.y + c.height },
            'e': { x: c.x + c.width,      y: c.y + c.height / 2 },
            's': { x: c.x + c.width / 2, y: c.y },
            'w': { x: c.x,                y: c.y + c.height / 2 }
        };
        for (const m of this._resizeHandleMeshes) {
            const h = m.userData.handleType;
            if (positions[h]) m.position.set(positions[h].x, positions[h].y, m.position.z);
        }
    }

    _removeResizeHandles() {
        for (const m of this._resizeHandleMeshes) {
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
            if (m.parent) m.parent.remove(m);
        }
        this._resizeHandleMeshes = [];
    }
}
