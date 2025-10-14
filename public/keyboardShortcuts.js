// Keyboard Shortcuts Handler
export class KeyboardShortcuts {
    constructor(renderer, editor, effects, undoManager = null) {
        this.renderer = renderer;
        this.editor = editor;
        this.effects = effects;
        this.undoManager = undoManager;
        this.enabled = true;
        this.setupListeners();
    }
    
    setupListeners() {
        document.addEventListener('keydown', (e) => {
            if (!this.enabled) return;
            
            switch(e.key.toLowerCase()) {
                case 'delete':
                case 'backspace':
                    if (this.editor && this.editor.selectedMesh) {
                        e.preventDefault();
                        this.dispatchEvent('deleteIlot', { mesh: this.editor.selectedMesh });
                    }
                    break;
                    
                case 'escape':
                    this.renderer.clearSelection();
                    if (this.editor) {
                        this.editor.enableEditMode(false);
                        this.editor.transformControl.detach();
                    }
                    break;
                    
                case 'd':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        if (this.editor && this.editor.selectedMesh) {
                            const newIlot = this.editor.duplicateSelected();
                            if (newIlot) this.dispatchEvent('ilotDuplicated', { ilot: newIlot });
                        }
                    }
                    break;
                    
                case 'g':
                    if (this.editor) {
                        this.editor.setMode('translate');
                        this.editor.enableEditMode(true);
                    }
                    break;
                    
                case 's':
                    if (!e.ctrlKey && !e.metaKey) {
                        if (this.editor) {
                            this.editor.setMode('scale');
                            this.editor.enableEditMode(true);
                        }
                    }
                    break;
                    
                case 'r':
                    if (this.editor) {
                        this.editor.setMode('rotate');
                        this.editor.enableEditMode(true);
                    }
                    break;
                    
                case '3':
                    this.renderer.toggle3DMode();
                    break;
                    
                case 'm':
                    const measuring = !this.renderer.measurementMode;
                    this.renderer.enableMeasurementMode(measuring);
                    break;
                    
                case 'h':
                    this.renderer.resetView();
                    break;
                    
                case 'b':
                    if (this.effects) {
                        const enabled = !this.effects.effectsEnabled.bloom;
                        this.effects.enableBloom(enabled);
                    }
                    break;
                    
                case 'z':
                    if ((e.ctrlKey || e.metaKey) && this.undoManager) {
                        e.preventDefault();
                        if (this.undoManager.undo()) {
                            this.dispatchEvent('undoExecuted', {});
                            this.dispatchEvent('statsUpdate', {});
                        }
                    }
                    break;
                    
                case 'y':
                    if ((e.ctrlKey || e.metaKey) && this.undoManager) {
                        e.preventDefault();
                        if (this.undoManager.redo()) {
                            this.dispatchEvent('redoExecuted', {});
                            this.dispatchEvent('statsUpdate', {});
                        }
                    }
                    break;
            }
        });
    }
    
    enable() {
        this.enabled = true;
    }
    
    disable() {
        this.enabled = false;
    }
    
    dispatchEvent(type, data) {
        const event = new CustomEvent(type, { detail: data });
        document.dispatchEvent(event);
    }
}
