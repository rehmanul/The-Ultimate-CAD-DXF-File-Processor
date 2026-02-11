/**
 * Renderer Manager - Handles transitions between Autodesk Viewer and Three.js
 * Workflow: Upload → Autodesk Viewer (default) → Generate Ilots/Corridors → Three.js Renderer
 */

export class RendererManager {
    constructor(container) {
        this.container = container;
        this.currentRenderer = null;
        this.rendererType = 'viewer'; // Start with viewer as default
        this.viewerHandle = null;
        this.threeRenderer = null;
        this.floorPlan = null;
        this.ilots = [];
        this.corridors = [];
    }

    /**
     * Initialize the default renderer (Autodesk Viewer)
     */
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

    /**
     * Switch to Three.js renderer (used for ilot/corridor visualization)
     */
    async switchToThreeJS() {
        try {
            // Clean up Autodesk Viewer
            if (this.viewerHandle && this.viewerHandle.viewer) {
                try {
                    this.viewerHandle.viewer.finish();
                } catch (e) {
                    console.warn('Viewer cleanup error:', e);
                }
                this.viewerHandle = null;
            }

            // Clear container
            while (this.container.firstChild) {
                this.container.removeChild(this.container.firstChild);
            }

            // Initialize Three.js renderer
            const { ThreeRenderer } = await import('./threeRenderer.js');
            this.threeRenderer = new ThreeRenderer(this.container);
            this.rendererType = 'three';
            this.currentRenderer = this.threeRenderer;

            // Render current state
            if (this.floorPlan) {
                this.threeRenderer.renderFloorPlan(this.floorPlan, this.ilots, this.corridors);
                // Render green arrows at entrances
                if (this.floorPlan.entrances && this.floorPlan.bounds) {
                    this.threeRenderer.renderEntranceArrows(this.floorPlan.entrances, this.floorPlan.bounds);
                }
            }

            return this.threeRenderer;
        } catch (error) {
            console.error('Failed to switch to Three.js:', error);
            throw error;
        }
    }

    /**
     * Switch to Autodesk Viewer
     */
    async switchToViewer(urn) {
        if (!urn) {
            throw new Error('URN required for Autodesk Viewer');
        }

        try {
            // Clean up Three.js renderer
            if (this.threeRenderer && this.threeRenderer.renderer) {
                this.threeRenderer.renderer.dispose();
                this.threeRenderer = null;
            }

            // Clear container
            while (this.container.firstChild) {
                this.container.removeChild(this.container.firstChild);
            }

            // Initialize Autodesk Viewer
            const { loadViewer, overlayShapes } = await import('./autodeskViewer.js');
            this.viewerHandle = await loadViewer(this.container, urn, { autoApplyTransform: true });
            this.rendererType = 'viewer';
            this.currentRenderer = this.viewerHandle;

            // Overlay ilots and corridors if available
            if (this.ilots.length > 0 || this.corridors.length > 0) {
                overlayShapes(this.container, this.ilots, this.corridors, this.viewerHandle);
            }

            return this.viewerHandle;
        } catch (error) {
            console.error('Failed to switch to Autodesk Viewer:', error);
            throw error;
        }
    }

    /**
     * Update the current state (floor plan, ilots, corridors)
     */
    updateState(floorPlan, ilots = [], corridors = []) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;
        this.corridors = corridors;
        this.render();
    }

    /**
     * Render current state based on active renderer
     */
    render() {
        if (this.rendererType === 'three' && this.threeRenderer) {
            this.threeRenderer.renderFloorPlan(this.floorPlan, this.ilots, this.corridors);
            // Render green arrows at entrances
            if (this.floorPlan && this.floorPlan.entrances && this.floorPlan.bounds) {
                this.threeRenderer.renderEntranceArrows(this.floorPlan.entrances, this.floorPlan.bounds);
            }
        } else if (this.rendererType === 'viewer' && this.viewerHandle) {
            // Import overlayShapes dynamically
            import('./autodeskViewer.js').then(({ overlayShapes }) => {
                overlayShapes(this.container, this.ilots, this.corridors, this.viewerHandle);
            }).catch(err => console.error('Failed to overlay shapes:', err));
        }
    }

    /**
     * Auto-switch renderer based on workflow stage
     * - After upload: Use Autodesk Viewer
     * - After ilot/corridor generation: Switch to Three.js
     */
    autoSwitchRenderer(stage) {
        if (stage === 'upload' && this.rendererType !== 'viewer') {
            const urn = this.floorPlan?.urn;
            if (urn) {
                return this.switchToViewer(urn);
            }
        } else if ((stage === 'ilots' || stage === 'corridors') && this.rendererType !== 'three') {
            return this.switchToThreeJS();
        }
        return Promise.resolve();
    }

    /**
     * Get current renderer type
     */
    getRendererType() {
        return this.rendererType;
    }

    /**
     * Check if renderer is ready
     */
    isReady() {
        return this.currentRenderer !== null;
    }

    /**
     * Dispose all resources
     */
    dispose() {
        if (this.viewerHandle && this.viewerHandle.viewer) {
            try {
                this.viewerHandle.viewer.finish();
            } catch (e) {
                console.warn('Viewer disposal error:', e);
            }
        }

        if (this.threeRenderer && this.threeRenderer.renderer) {
            this.threeRenderer.renderer.dispose();
        }

        this.viewerHandle = null;
        this.threeRenderer = null;
        this.currentRenderer = null;
    }
}
