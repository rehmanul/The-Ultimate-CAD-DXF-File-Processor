// Advanced Visual Effects - Bloom, SSAO, Shadows
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as THREE from 'three';

export class AdvancedEffects {
    constructor(renderer) {
        this.renderer = renderer;
        this.bloomPass = null;
        this.ssaoPass = null;
        this.outputPass = null;
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
        const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isLowEnd = /Intel|AMD/i.test(renderer) && !/Radeon|GeForce/i.test(renderer);
        const pixelRatio = window.devicePixelRatio || 1;
        const memory = navigator.deviceMemory || 4; // Default to 4GB

        if (isMobile || pixelRatio > 2 || memory < 4) {
            return 'low';
        } else if (isLowEnd || pixelRatio > 1.5) {
            return 'medium';
        } else {
            return 'high';
        }
    }

    applyAutoQuality() {
        const profiles = {
            low: { bloomStrength: 0.3, ssaoSamples: 8, shadowMapSize: 512 },
            medium: { bloomStrength: 0.5, ssaoSamples: 16, shadowMapSize: 1024 },
            high: { bloomStrength: 0.7, ssaoSamples: 32, shadowMapSize: 2048 }
        };

        const profile = profiles[this.deviceProfile];
        this.defaultBloomStrength = profile.bloomStrength;
        this.defaultSSAOSamples = profile.ssaoSamples;
        this.defaultShadowMapSize = profile.shadowMapSize;

        console.log(`Auto-detected device profile: ${this.deviceProfile}`);

        // Mobile optimizations
        if (this.deviceProfile === 'low' || this.deviceProfile === 'medium') {
            this.renderer.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        }

        // Touch controls for mobile
        this.setupMobileControls();
    }

    setupMobileControls() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
            // Reduce controls sensitivity for touch
            this.renderer.controls.touches = {
                ONE: THREE.TOUCH.PAN,
                TWO: THREE.TOUCH.DOLLY_PAN
            };
            this.renderer.perspectiveControls.touches = {
                ONE: THREE.TOUCH.ROTATE,
                TWO: THREE.TOUCH.DOLLY_PAN
            };
        }
    }

    enableBloom(enabled, strength = null) {
        if (enabled && !this.bloomPass) {
            const bloomStrength = strength !== null ? strength : this.defaultBloomStrength;
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(this.renderer.container.clientWidth, this.renderer.container.clientHeight),
                bloomStrength, 0.4, 0.85
            );
            this.renderer.composer.addPass(this.bloomPass);
        } else if (!enabled && this.bloomPass) {
            this.renderer.composer.removePass(this.bloomPass);
            this.bloomPass = null;
        }
        this.effectsEnabled.bloom = enabled;
        this.renderer.render();
    }

    enableSSAO(enabled) {
        if (enabled && !this.ssaoPass && this.renderer.is3DMode) {
            this.ssaoPass = new SSAOPass(
                this.renderer.scene,
                this.renderer.perspectiveCamera,
                this.renderer.container.clientWidth,
                this.renderer.container.clientHeight
            );
            this.ssaoPass.kernelRadius = this.deviceProfile === 'low' ? 4 : 8;
            this.ssaoPass.minDistance = 0.005;
            this.ssaoPass.maxDistance = 0.1;
            this.ssaoPass.kernelSize = this.defaultSSAOSamples;
            this.renderer.composer.addPass(this.ssaoPass);

            if (!this.outputPass) {
                this.outputPass = new OutputPass();
                this.renderer.composer.addPass(this.outputPass);
            }
        } else if (!enabled && this.ssaoPass) {
            this.renderer.composer.removePass(this.ssaoPass);
            this.ssaoPass = null;
        }
        this.effectsEnabled.ssao = enabled;
        this.renderer.render();
    }

    enableShadows(enabled) {
        this.renderer.renderer.shadowMap.enabled = enabled;
        this.renderer.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        const shadowSize = this.defaultShadowMapSize;
        this.renderer.scene.traverse((obj) => {
            if (obj.isMesh) {
                obj.castShadow = enabled;
                obj.receiveShadow = enabled;
            }
            if (obj.isLight && obj.isDirectionalLight) {
                obj.castShadow = enabled;
                obj.shadow.mapSize.width = shadowSize;
                obj.shadow.mapSize.height = shadowSize;
                obj.shadow.camera.near = 0.1;
                obj.shadow.camera.far = 1000;
                obj.shadow.camera.left = -50;
                obj.shadow.camera.right = 50;
                obj.shadow.camera.top = 50;
                obj.shadow.camera.bottom = -50;
            }
        });

        this.effectsEnabled.shadows = enabled;
        this.renderer.render();
    }

    setBloomStrength(strength) {
        if (this.bloomPass) {
            this.bloomPass.strength = strength;
            this.renderer.render();
        }
    }

    setSSAOIntensity(intensity) {
        if (this.ssaoPass) {
            this.ssaoPass.output = intensity;
            this.renderer.render();
        }
    }
}
