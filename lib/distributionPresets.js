/**
 * Distribution Presets Library
 * Pre-configured distribution profiles for common building types
 */

class DistributionPresets {
    constructor() {
        this.presets = this.loadDefaultPresets();
        this.customPresets = new Map();
    }

    /**
     * Load built-in preset library
     */
    loadDefaultPresets() {
        return {
            'modern-office': {
                id: 'modern-office',
                name: 'Modern Office',
                description: 'Typical office building with mix of private offices and open spaces',
                category: 'Office',
                distribution: {
                    '0-2': 5,    // Small meeting pods
                    '2-4': 15,   // Individual offices
                    '4-8': 45,   // Team workspaces
                    '8-15': 25,  // Large meeting rooms
                    '15-30': 10  // Conference rooms
                },
                corridorWidth: 1.8,
                options: {
                    minRowDistance: 2.0,
                    maxRowDistance: 8.0,
                    minOverlap: 0.6
                },
                metadata: {
                    author: 'FloorPlan Pro',
                    created: '2025-01-24',
                    version: '1.0'
                }
            },
            
            'hotel-standard': {
                id: 'hotel-standard',
                name: 'Hotel Floor',
                description: 'Standard hotel room configuration with varied room sizes',
                category: 'Hospitality',
                distribution: {
                    '15-20': 60,  // Standard rooms
                    '20-30': 25,  // Deluxe rooms
                    '30-50': 10,  // Suites
                    '50-80': 5    // Premium suites
                },
                corridorWidth: 2.0,
                options: {
                    minRowDistance: 2.5,
                    maxRowDistance: 7.0,
                    minOverlap: 0.7
                },
                metadata: {
                    author: 'FloorPlan Pro',
                    created: '2025-01-24',
                    version: '1.0'
                }
            },
            
            'warehouse': {
                id: 'warehouse',
                name: 'Warehouse Storage',
                description: 'Industrial storage with large bay configuration',
                category: 'Industrial',
                distribution: {
                    '10-20': 20,   // Small storage bays
                    '20-40': 40,   // Medium storage bays
                    '40-80': 30,   // Large storage areas
                    '80-150': 10   // Extra large zones
                },
                corridorWidth: 3.0,
                options: {
                    minRowDistance: 3.0,
                    maxRowDistance: 10.0,
                    minOverlap: 0.5
                },
                metadata: {
                    author: 'FloorPlan Pro',
                    created: '2025-01-24',
                    version: '1.0'
                }
            },
            
            'coworking': {
                id: 'coworking',
                name: 'Co-working Space',
                description: 'Flexible workspace with hot desks and private offices',
                category: 'Office',
                distribution: {
                    '1-3': 30,   // Hot desks
                    '3-6': 40,   // Small team pods
                    '6-12': 20,  // Private offices
                    '12-25': 10  // Meeting rooms
                },
                corridorWidth: 1.5,
                options: {
                    minRowDistance: 1.8,
                    maxRowDistance: 6.0,
                    minOverlap: 0.5
                },
                metadata: {
                    author: 'FloorPlan Pro',
                    created: '2025-01-24',
                    version: '1.0'
                }
            },
            
            'retail': {
                id: 'retail',
                name: 'Retail Store',
                description: 'Retail space with varied shop sizes',
                category: 'Retail',
                distribution: {
                    '5-15': 40,   // Small shops/kiosks
                    '15-30': 35,  // Medium retail units
                    '30-60': 20,  // Large stores
                    '60-100': 5   // Anchor stores
                },
                corridorWidth: 2.5,
                options: {
                    minRowDistance: 2.0,
                    maxRowDistance: 12.0,
                    minOverlap: 0.4
                },
                metadata: {
                    author: 'FloorPlan Pro',
                    created: '2025-01-24',
                    version: '1.0'
                }
            },
            
            'residential': {
                id: 'residential',
                name: 'Residential Apartments',
                description: 'Apartment building with studio to 3-bedroom units',
                category: 'Residential',
                distribution: {
                    '25-35': 25,  // Studio apartments
                    '35-50': 35,  // 1-bedroom
                    '50-75': 25,  // 2-bedroom
                    '75-120': 15  // 3-bedroom
                },
                corridorWidth: 1.6,
                options: {
                    minRowDistance: 2.0,
                    maxRowDistance: 8.0,
                    minOverlap: 0.6
                },
                metadata: {
                    author: 'FloorPlan Pro',
                    created: '2025-01-24',
                    version: '1.0'
                }
            }
        };
    }

    /**
     * Get all available presets
     */
    getAllPresets() {
        const all = { ...this.presets };
        
        // Add custom presets
        this.customPresets.forEach((preset, id) => {
            all[id] = preset;
        });
        
        return all;
    }

    /**
     * Get preset by ID
     */
    getPreset(id) {
        return this.presets[id] || this.customPresets.get(id) || null;
    }

    /**
     * Get presets by category
     */
    getPresetsByCategory(category) {
        const all = this.getAllPresets();
        return Object.values(all).filter(preset => preset.category === category);
    }

    /**
     * Get all categories
     */
    getCategories() {
        const all = this.getAllPresets();
        const categories = new Set();
        Object.values(all).forEach(preset => categories.add(preset.category));
        return Array.from(categories).sort();
    }

    /**
     * Add custom preset
     */
    addCustomPreset(preset) {
        // Validate preset structure
        if (!this.validatePreset(preset)) {
            throw new Error('Invalid preset structure');
        }

        // Generate ID if not provided
        if (!preset.id) {
            preset.id = `custom-${Date.now()}`;
        }

        // Add metadata
        preset.metadata = {
            ...preset.metadata,
            custom: true,
            created: preset.metadata?.created || new Date().toISOString()
        };

        this.customPresets.set(preset.id, preset);
        return preset.id;
    }

    /**
     * Delete custom preset
     */
    deleteCustomPreset(id) {
        // Can't delete built-in presets
        if (this.presets[id]) {
            return false;
        }
        
        return this.customPresets.delete(id);
    }

    /**
     * Validate preset structure
     */
    validatePreset(preset) {
        if (!preset.name || !preset.distribution) {
            return false;
        }

        // Validate distribution totals 100%
        const total = Object.values(preset.distribution).reduce((sum, val) => sum + val, 0);
        if (Math.abs(total - 100) > 0.01) {
            return false;
        }

        // Validate distribution ranges
        for (const [range, percentage] of Object.entries(preset.distribution)) {
            if (!range.match(/^\d+-\d+$/)) {
                return false;
            }
            if (percentage < 0 || percentage > 100) {
                return false;
            }
        }

        return true;
    }

    /**
     * Export preset to JSON
     */
    exportPreset(id) {
        const preset = this.getPreset(id);
        if (!preset) {
            throw new Error(`Preset not found: ${id}`);
        }
        return JSON.stringify(preset, null, 2);
    }

    /**
     * Import preset from JSON
     */
    importPreset(json) {
        try {
            const preset = JSON.parse(json);
            if (!this.validatePreset(preset)) {
                throw new Error('Invalid preset format');
            }
            return this.addCustomPreset(preset);
        } catch (error) {
            throw new Error(`Import failed: ${error.message}`);
        }
    }

    /**
     * Clone preset (for customization)
     */
    clonePreset(id, newName) {
        const original = this.getPreset(id);
        if (!original) {
            throw new Error(`Preset not found: ${id}`);
        }

        const cloned = {
            ...JSON.parse(JSON.stringify(original)),
            id: `custom-${Date.now()}`,
            name: newName || `${original.name} (Copy)`,
            metadata: {
                ...original.metadata,
                clonedFrom: id,
                custom: true,
                created: new Date().toISOString()
            }
        };

        this.customPresets.set(cloned.id, cloned);
        return cloned.id;
    }

    /**
     * Get preset recommendations based on floor plan characteristics
     */
    recommendPresets(floorPlan) {
        const recommendations = [];
        const totalArea = floorPlan.totalArea || 0;
        const roomCount = floorPlan.rooms?.length || 0;

        // Office recommendation
        if (totalArea > 500 && totalArea < 5000) {
            recommendations.push({
                id: 'modern-office',
                score: 0.9,
                reason: 'Floor area suitable for office layout'
            });
        }

        // Hotel recommendation
        if (totalArea > 1000 && roomCount > 10) {
            recommendations.push({
                id: 'hotel-standard',
                score: 0.85,
                reason: 'Multiple rooms suggest hospitality use'
            });
        }

        // Warehouse recommendation
        if (totalArea > 2000 && roomCount < 5) {
            recommendations.push({
                id: 'warehouse',
                score: 0.8,
                reason: 'Large open spaces suggest industrial use'
            });
        }

        return recommendations.sort((a, b) => b.score - a.score);
    }

    /**
     * Save custom presets to local storage (browser) or file (Node.js)
     */
    saveCustomPresets() {
        const presets = Array.from(this.customPresets.values());
        
        // Browser environment
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('floorplan-custom-presets', JSON.stringify(presets));
        }
        
        return presets;
    }

    /**
     * Load custom presets from storage
     */
    loadCustomPresets() {
        // Browser environment
        if (typeof localStorage !== 'undefined') {
            try {
                const stored = localStorage.getItem('floorplan-custom-presets');
                if (stored) {
                    const presets = JSON.parse(stored);
                    presets.forEach(preset => {
                        this.customPresets.set(preset.id, preset);
                    });
                }
            } catch (error) {
                console.error('Failed to load custom presets:', error);
            }
        }
    }
}

module.exports = new DistributionPresets();
