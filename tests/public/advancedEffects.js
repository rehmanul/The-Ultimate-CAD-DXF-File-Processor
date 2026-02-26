// Advanced Visual Effects (Babylon.js version)
// Bloom, shadows, and quality management — using BABYLON.DefaultRenderingPipeline

export class AdvancedEffects {
    constructor(renderer) {
        this.renderer = renderer;
        this.effectsEnabled = {
            bloom: false,
            ssao: false,
            shadows: false
        };
        this.deviceProfile = this.detectDeviceProfile();
        this.applyAutoQuality();
    }

    detectDeviceProfile() {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        const debugInfo = gl ? gl.getExtension('WEBGL_debug_renderer_info') : null;
        const gpuRenderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isLowEnd = /Intel|AMD/i.test(gpuRenderer) && !/Radeon|GeForce/i.test(gpuRenderer);
        const pixelRatio = window.devicePixelRatio || 1;
        const memory = navigator.deviceMemory || 4;

        if (isMobile || pixelRatio > 2 || memory < 4) return 'low';
        if (isLowEnd || pixelRatio > 1.5) return 'medium';
        return 'high';
    }

    applyAutoQuality() {
        const profiles = {
            low: { bloomWeight: 0.3 },
            medium: { bloomWeight: 0.5 },
            high: { bloomWeight: 0.7 }
        };
        const profile = profiles[this.deviceProfile];
        this.defaultBloomWeight = profile.bloomWeight;
        console.log(`Auto-detected device profile: ${this.deviceProfile}`);
        this.setupMobileControls();
    }

    setupMobileControls() {
        // Touch handling is managed by Babylon.js pointer events — no additional setup needed
    }

    enableBloom(enabled, weight = null) {
        if (!this.renderer._pipeline) return;
        const w = weight !== null ? weight : this.defaultBloomWeight;
        this.renderer._pipeline.bloomEnabled = enabled;
        if (enabled) this.renderer._pipeline.bloomWeight = w;
        this.effectsEnabled.bloom = enabled;
        this.renderer.render();
    }

    enableSSAO(enabled) {
        // SSAO requires Babylon.js SSAO2 pipeline — stubbed for now
        this.effectsEnabled.ssao = enabled;
        console.log(`SSAO ${enabled ? 'enabled' : 'disabled'} (Babylon.js SSAO2 pipeline not loaded)`);
        this.renderer.render();
    }

    enableShadows(enabled) {
        this.renderer.shadowsEnabled = enabled;
        this.effectsEnabled.shadows = enabled;
        this.renderer.render();
    }

    setBloomStrength(strength) {
        if (this.renderer._pipeline) {
            this.renderer._pipeline.bloomWeight = strength;
            this.renderer.render();
        }
    }

    setSSAOIntensity(intensity) {
        console.log('SSAO intensity set to:', intensity, '(not implemented in Babylon.js core)');
    }
}
