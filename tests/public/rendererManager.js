/**
 * Renderer Manager - Handles transitions between Autodesk Viewer and Three.js
 * Workflow: Upload -> Autodesk Viewer (default) -> Generate Ilots/Corridors -> Three.js renderer
 */

export class RendererManager {
    constructor(container) {
        this.container = container;
        this.currentRenderer = null;
        this.rendererType = 'viewer';
        this.viewerHandle = null;
        this.threeRenderer = null;
        this.floorPlan = null;
        this.ilots = [];
        this.corridors = [];
    }

    async initializeDefaultRenderer(urn) {
        if (!urn) {
            console.warn('No URN provided for default renderer initialization');
            return null;
        }

        try {
            const { loadViewer } = await import('./autodeskViewer.js');
            this.viewerHandle = await loadViewer(this.container, urn, { autoApplyTransform: true });
            this.rendererType = 'viewer';
            this.currentRenderer = this.viewerHandle;
            return this.viewerHandle;
        } catch (error) {
            console.error('Failed to initialize Autodesk Viewer:', error);
            throw error;
        }
    }

    async switchToThreeJS() {
        return this.switchToBabylon();
    }

    async switchToBabylon() {
        try {
            if (this.viewerHandle && this.viewerHandle.viewer) {
                try { this.viewerHandle.viewer.finish(); } catch (e) { console.warn('Viewer cleanup error:', e); }
                this.viewerHandle = null;
            }
            while (this.container.firstChild) { this.container.removeChild(this.container.firstChild); }

            // ✅ Use Three.js renderer (production quality)
            const { FloorPlanRenderer } = await import('./threeRenderer.js');
            this.threeRenderer = new FloorPlanRenderer(this.container);
            this.rendererType = 'threejs';
            this.currentRenderer = this.threeRenderer;

            if (this.floorPlan) {
                this.threeRenderer.renderFloorPlan(this.floorPlan, this.ilots, this.corridors);
                if (this.floorPlan.entrances && this.floorPlan.bounds) {
                    this.threeRenderer.renderEntranceArrows(this.floorPlan.entrances, this.floorPlan.bounds);
                }
            }
            return this.threeRenderer;
        } catch (error) {
            console.error('Failed to switch to Three.js renderer:', error);
            throw error;
        }
    }

    async switchToViewer(urn) {
        if (!urn) {
            throw new Error('URN required for Autodesk Viewer');
        }

        try {
            if (this.babylonRenderer && typeof this.babylonRenderer.dispose === 'function') {
                this.babylonRenderer.dispose();
                this.babylonRenderer = null;
            }

            while (this.container.firstChild) {
                this.container.removeChild(this.container.firstChild);
            }

            const { loadViewer, overlayShapes } = await import('./autodeskViewer.js');
            this.viewerHandle = await loadViewer(this.container, urn, { autoApplyTransform: true });
            this.rendererType = 'viewer';
            this.currentRenderer = this.viewerHandle;

            if (this.ilots.length > 0 || this.corridors.length > 0) {
                overlayShapes(this.container, this.ilots, this.corridors, this.viewerHandle);
            }

            return this.viewerHandle;
        } catch (error) {
            console.error('Failed to switch to Autodesk Viewer:', error);
            throw error;
        }
    }

    updateState(floorPlan, ilots = [], corridors = []) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;
        this.corridors = corridors;
        this.render();
    }

    render() {
        if (this.rendererType === 'threejs' && this.threeRenderer) {
            this.threeRenderer.renderFloorPlan(this.floorPlan, this.ilots, this.corridors);
            if (this.floorPlan && this.floorPlan.entrances && this.floorPlan.bounds) {
                this.threeRenderer.renderEntranceArrows(this.floorPlan.entrances, this.floorPlan.bounds);
            }
        } else if (this.rendererType === 'viewer' && this.viewerHandle) {
            import('./autodeskViewer.js').then(({ overlayShapes }) => {
                overlayShapes(this.container, this.ilots, this.corridors, this.viewerHandle);
            }).catch((err) => console.error('Failed to overlay shapes:', err));
        }
    }

    autoSwitchRenderer(stage) {
        if (stage === 'upload' && this.rendererType !== 'viewer') {
            const urn = this.floorPlan?.urn;
            if (urn) return this.switchToViewer(urn);
        } else if ((stage === 'ilots' || stage === 'corridors') && this.rendererType !== 'threejs') {
            return this.switchToBabylon(); // keeps the same entry point name for compatibility
        }
        return Promise.resolve();
    }

    getRendererType() {
        return this.rendererType;
    }

    isReady() {
        return this.currentRenderer !== null;
    }

    dispose() {
        if (this.viewerHandle && this.viewerHandle.viewer) {
            try { this.viewerHandle.viewer.finish(); } catch (e) { }
        }
        if (this.threeRenderer && typeof this.threeRenderer.dispose === 'function') {
            this.threeRenderer.dispose();
        }
        this.viewerHandle = null;
        this.threeRenderer = null;
        this.currentRenderer = null;
    }
}
