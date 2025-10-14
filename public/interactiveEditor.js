// Interactive Ilot Editor - Drag, Resize, Rotate
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class InteractiveEditor {
    constructor(renderer, collisionDetector = null) {
        this.renderer = renderer;
        this.transformControl = null;
        this.selectedMesh = null;
        this.editMode = 'translate';
        this.onIlotModified = null;
        this.enableSnapping = false;
        this.gridSize = 0.5;
        this.collisionDetector = collisionDetector;
        this.setupTransformControls();
    }
    
    setupTransformControls() {
        const camera = this.renderer.is3DMode ? this.renderer.perspectiveCamera : this.renderer.camera;
        
        try {
            this.transformControl = new TransformControls(camera, this.renderer.renderer.domElement);
            this.transformControl.setMode('translate');
            this.transformControl.setSpace('world');
            
            this.isDragging = false;
            this.dragStartPosition = null;
            this.dragStartSize = null;
            
            this.transformControl.addEventListener('dragging-changed', (event) => {
                this.renderer.controls.enabled = !event.value;
                this.renderer.perspectiveControls.enabled = !event.value;
                
                if (event.value) {
                    this.onDragStart();
                } else {
                    this.onDragEnd();
                }
            });
            
            if (this.transformControl instanceof THREE.Object3D) {
                this.renderer.scene.add(this.transformControl);
            }
        } catch (error) {
            console.error('TransformControls setup failed:', error);
        }
    }
    
    enableEditMode(enabled) {
        if (enabled && this.renderer.selectedIlots.length > 0) {
            this.selectedMesh = this.renderer.selectedIlots[0];
            this.transformControl.attach(this.selectedMesh);
        } else {
            this.transformControl.detach();
            this.selectedMesh = null;
            this.dragStartPosition = null;
            this.dragStartSize = null;
        }
        this.renderer.render();
    }
    
    onDragStart() {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return;
        
        const ilot = this.selectedMesh.userData.ilot;
        
        // Capture original position
        this.dragStartPosition = {
            x: ilot.x,
            y: ilot.y
        };
        
        // Capture original size
        this.dragStartSize = {
            width: ilot.width,
            height: ilot.height
        };
        
        this.isDragging = true;
    }
    
    onDragEnd() {
        if (!this.isDragging || !this.selectedMesh || !this.selectedMesh.userData.ilot) return;
        
        this.isDragging = false;
        
        // Update ilot data from mesh transform
        this.finalizeTransform();
    }
    
    setMode(mode) {
        this.editMode = mode;
        this.transformControl.setMode(mode);
        this.renderer.render();
    }
    
    finalizeTransform() {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return;
        
        const ilot = this.selectedMesh.userData.ilot;
        const pos = this.selectedMesh.position;
        const scale = this.selectedMesh.scale;
        
        // Calculate new position from mesh
        let newX = pos.x;
        let newY = pos.y;
        
        // Calculate new size from scale
        let newWidth = this.dragStartSize.width * scale.x;
        let newHeight = this.dragStartSize.height * scale.y;
        
        // Apply snapping if enabled
        if (this.enableSnapping && this.collisionDetector) {
            const tempIlot = { x: newX, y: newY, width: newWidth, height: newHeight };
            const snapped = this.collisionDetector.snapIlotToGrid(tempIlot, this.gridSize);
            newX = snapped.x;
            newY = snapped.y;
            newWidth = snapped.width;
            newHeight = snapped.height;
        }
        
        // Check if anything actually changed
        const positionChanged = (newX !== this.dragStartPosition.x || newY !== this.dragStartPosition.y);
        const sizeChanged = (newWidth !== this.dragStartSize.width || newHeight !== this.dragStartSize.height);
        
        if (!positionChanged && !sizeChanged) {
            // No change, reset mesh transform
            this.selectedMesh.position.set(ilot.x, ilot.y, pos.z);
            this.selectedMesh.scale.set(1, 1, 1);
            return;
        }
        
        // Update ilot data
        ilot.x = newX;
        ilot.y = newY;
        ilot.width = newWidth;
        ilot.height = newHeight;
        
        // Reset mesh transform (ilot data is source of truth)
        this.selectedMesh.position.set(ilot.x, ilot.y, pos.z);
        this.selectedMesh.scale.set(1, 1, 1);
        
        // Notify callback with old and new states
        if (this.onIlotModified) {
            this.onIlotModified(
                ilot,
                this.selectedMesh.userData.index,
                {
                    oldPosition: this.dragStartPosition,
                    newPosition: { x: newX, y: newY },
                    oldSize: this.dragStartSize,
                    newSize: { width: newWidth, height: newHeight },
                    positionChanged,
                    sizeChanged
                }
            );
        }
    }
    
    deleteSelected() {
        if (!this.selectedMesh) return null;
        const index = this.selectedMesh.userData.index;
        this.transformControl.detach();
        this.renderer.ilotsGroup.remove(this.selectedMesh);
        this.renderer.ilotMeshes.splice(index, 1);
        this.selectedMesh = null;
        this.renderer.render();
        return index;
    }
    
    duplicateSelected() {
        if (!this.selectedMesh || !this.selectedMesh.userData.ilot) return null;
        
        const ilot = { ...this.selectedMesh.userData.ilot };
        ilot.x += 2;
        ilot.y += 2;
        return ilot;
    }
}
