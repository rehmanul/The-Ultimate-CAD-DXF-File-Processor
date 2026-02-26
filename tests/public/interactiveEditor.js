// Interactive Ilot Editor - Drag, Resize (Babylon.js version)
// Uses pointer events for direct mesh manipulation instead of Three.js TransformControls

export class InteractiveEditor {
    constructor(renderer, collisionDetector = null) {
        this.renderer = renderer;
        this.selectedMesh = null;
        this.editMode = 'translate';
        this.onIlotModified = null;
        this.enableSnapping = false;
        this.gridSize = 0.5;
        this.collisionDetector = collisionDetector;
        this.isDragging = false;
        this.dragStartPosition = null;
        this.dragStartSize = null;
        this._dragStartPointer = null;
        this._editEnabled = false;
        this.transformControl = { detach() { }, attach() { }, setMode() { }, setSpace() { }, dispose() { } };
        this.setupDragHandlers();
    }

    setupDragHandlers() {
        const canvas = this.renderer._canvas;
        if (!canvas) return;

        canvas.addEventListener('pointerdown', (e) => {
            if (!this._editEnabled || !this.selectedMesh) return;
            const pick = this.renderer.scene.pick(e.offsetX, e.offsetY, m => m === this.selectedMesh);
            if (!pick.hit) return;
            this.isDragging = true;
            this._dragStartPointer = { x: e.clientX, y: e.clientY };
            this.onDragStart();
            e.preventDefault();
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!this.isDragging || !this.selectedMesh) return;
            const cam = this.renderer.camera;
            const vw = cam.orthoRight - cam.orthoLeft;
            const scaleX = vw / canvas.clientWidth;
            const dx = (e.clientX - this._dragStartPointer.x) * scaleX;
            const dy = -(e.clientY - this._dragStartPointer.y) * scaleX;
            if (this.editMode === 'translate') {
                const ilot = this.selectedMesh.userData.ilot;
                this.selectedMesh.position.x = this.dragStartPosition.x + ilot.width / 2 + dx;
                this.selectedMesh.position.y = this.dragStartPosition.y + ilot.height / 2 + dy;
            }
            this.renderer.render();
        });

        canvas.addEventListener('pointerup', () => {
            if (this.isDragging) this.onDragEnd();
        });
    }

    enableEditMode(enabled) {
        this._editEnabled = enabled;
        if (enabled && this.renderer.selectedIlots.length > 0) {
            this.selectedMesh = this.renderer.selectedIlots[0];
            const ilot = this.selectedMesh?.userData?.ilot;
            if (ilot?.locked) { this.selectedMesh = null; return; }
        } else {
            this.selectedMesh = null;
            this.dragStartPosition = null;
            this.dragStartSize = null;
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
    }

    setMode(mode) { this.editMode = mode; }

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
        this.selectedMesh = null;
        this.renderer.render();
        return index;
    }

    duplicateSelected() {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return null;
        const ilot = { ...this.selectedMesh.userData.ilot };
        ilot.x += 2; ilot.y += 2;
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
}
