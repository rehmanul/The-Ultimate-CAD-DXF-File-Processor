/**
 * Phase 2: Preset Management API Routes
 * Server-side endpoints for managing distribution presets
 */

const express = require('express');
const router = express.Router();
const distributionPresets = require('../lib/distributionPresets');
const floorPlanStore = require('./floorPlanStore');
const RowBasedIlotPlacer = require('./RowBasedIlotPlacer');
const ProductionCorridorGenerator = require('./productionCorridorGenerator');
const { sanitizeIlot, sanitizeCorridor } = require('./sanitizers');

/**
 * GET /api/presets
 * Get all available presets
 */
router.get('/presets', (req, res) => {
    try {
        const presets = distributionPresets.getAllPresets();
        const categories = distributionPresets.getCategories();

        res.json({
            success: true,
            presets,
            categories,
            count: Object.keys(presets).length
        });
    } catch (error) {
        console.error('Error fetching presets:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch presets',
            message: error.message
        });
    }
});

/**
 * GET /api/presets/:id
 * Get specific preset by ID
 */
router.get('/presets/:id', (req, res) => {
    try {
        const preset = distributionPresets.getPreset(req.params.id);
        
        if (!preset) {
            return res.status(404).json({
                success: false,
                error: 'Preset not found'
            });
        }

        res.json({
            success: true,
            preset
        });
    } catch (error) {
        console.error('Error fetching preset:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch preset',
            message: error.message
        });
    }
});

/**
 * GET /api/presets/category/:category
 * Get presets by category
 */
router.get('/presets/category/:category', (req, res) => {
    try {
        const presets = distributionPresets.getPresetsByCategory(req.params.category);

        res.json({
            success: true,
            category: req.params.category,
            presets,
            count: presets.length
        });
    } catch (error) {
        console.error('Error fetching presets by category:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch presets',
            message: error.message
        });
    }
});

/**
 * POST /api/presets
 * Create custom preset
 */
router.post('/presets', (req, res) => {
    try {
        const preset = req.body;
        
        // Validate preset
        if (!distributionPresets.validatePreset(preset)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid preset format'
            });
        }

        const presetId = distributionPresets.addCustomPreset(preset);

        res.json({
            success: true,
            presetId,
            message: 'Custom preset created successfully'
        });
    } catch (error) {
        console.error('Error creating preset:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create preset',
            message: error.message
        });
    }
});

/**
 * DELETE /api/presets/:id
 * Delete custom preset
 */
router.delete('/presets/:id', (req, res) => {
    try {
        const deleted = distributionPresets.deleteCustomPreset(req.params.id);

        if (!deleted) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete built-in preset or preset not found'
            });
        }

        res.json({
            success: true,
            message: 'Preset deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting preset:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete preset',
            message: error.message
        });
    }
});

/**
 * POST /api/presets/:id/clone
 * Clone existing preset
 */
router.post('/presets/:id/clone', (req, res) => {
    try {
        const { newName } = req.body;
        const newPresetId = distributionPresets.clonePreset(req.params.id, newName);

        res.json({
            success: true,
            presetId: newPresetId,
            message: 'Preset cloned successfully'
        });
    } catch (error) {
        console.error('Error cloning preset:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clone preset',
            message: error.message
        });
    }
});

/**
 * GET /api/presets/:id/export
 * Export preset as JSON
 */
router.get('/presets/:id/export', (req, res) => {
    try {
        const json = distributionPresets.exportPreset(req.params.id);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=${req.params.id}.json`);
        res.send(json);
    } catch (error) {
        console.error('Error exporting preset:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export preset',
            message: error.message
        });
    }
});

/**
 * POST /api/presets/import
 * Import preset from JSON
 */
router.post('/presets/import', (req, res) => {
    try {
        const { json } = req.body;
        const presetId = distributionPresets.importPreset(json);

        res.json({
            success: true,
            presetId,
            message: 'Preset imported successfully'
        });
    } catch (error) {
        console.error('Error importing preset:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to import preset',
            message: error.message
        });
    }
});

/**
 * POST /api/apply-preset
 * Apply preset to floor plan
 */
router.post('/api/apply-preset', async (req, res) => {
    try {
        const { presetId, preset: presetPayload, floorPlanId, floorPlan, options = {} } = req.body || {};

        const preset = resolvePreset(presetId, presetPayload);
        if (!preset) {
            return res.status(400).json({
                success: false,
                error: 'Preset not found or invalid'
            });
        }

        let workingPlan = floorPlan ? normalizeFloorPlan(floorPlan) : null;
        const planId = floorPlanId || workingPlan?.urn;

        if (!workingPlan && planId) {
            workingPlan = floorPlanStore.getFloorPlan(planId);
        }

        if (!workingPlan && global.lastProcessedCAD) {
            workingPlan = normalizeFloorPlan(global.lastProcessedCAD);
        }

        if (!workingPlan) {
            return res.status(404).json({
                success: false,
                error: 'Floor plan not available'
            });
        }

        const normalizedDistribution = normalizeDistribution(preset.distribution);
        const generatorOptions = buildGeneratorOptions(workingPlan, preset, options);

        const placer = new RowBasedIlotPlacer(workingPlan, generatorOptions);
        const ilotsRaw = placer.generateIlots(normalizedDistribution, generatorOptions.totalIlots);
        const ilots = Array.isArray(ilotsRaw) ? ilotsRaw.map(sanitizeIlot).filter(Boolean) : [];

        const corridorGenerator = new ProductionCorridorGenerator(workingPlan, ilots, {
            corridorWidth: generatorOptions.corridorWidth,
            margin: generatorOptions.margin || 0.5
        });
        const corridorsRaw = corridorGenerator.generateCorridors ? corridorGenerator.generateCorridors() : [];
        const corridors = Array.isArray(corridorsRaw) ? corridorsRaw.map(sanitizeCorridor).filter(Boolean) : [];

        if (workingPlan.urn) {
            floorPlanStore.saveFloorPlan(workingPlan);
            floorPlanStore.updateLayout(workingPlan.urn, {
                ilots,
                corridors,
                distribution: normalizedDistribution,
                options: generatorOptions
            });
        }

        res.json({
            success: true,
            layout: {
                ilots,
                corridors
            },
            distribution: normalizedDistribution,
            options: generatorOptions,
            message: 'Preset applied successfully'
        });
    } catch (error) {
        console.error('Error applying preset:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to apply preset',
            message: error.message
        });
    }
});

/**
 * POST /api/presets/recommend
 * Get preset recommendations based on floor plan
 */
router.post('/presets/recommend', (req, res) => {
    try {
        const { floorPlan } = req.body;

        if (!floorPlan) {
            return res.status(400).json({
                success: false,
                error: 'Floor plan data required'
            });
        }

        const recommendations = distributionPresets.recommendPresets(floorPlan);

        res.json({
            success: true,
            recommendations
        });
    } catch (error) {
        console.error('Error generating recommendations:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate recommendations',
            message: error.message
        });
    }
});

module.exports = router;

function resolvePreset(presetId, presetPayload) {
    if (presetPayload && presetPayload.distribution) {
        return presetPayload;
    }
    if (!presetId) return null;
    return distributionPresets.getPreset(presetId);
}

function normalizeFloorPlan(plan) {
    if (!plan) return null;
    const copy = JSON.parse(JSON.stringify(plan));
    copy.urn = copy.urn || copy.id || `local_${Date.now()}`;
    if (!copy.totalArea) {
        if (Array.isArray(copy.rooms) && copy.rooms.length) {
            copy.totalArea = copy.rooms.reduce((sum, r) => sum + (Number(r.area) || 0), 0);
        } else if (copy.bounds) {
            const width = (copy.bounds.maxX || 0) - (copy.bounds.minX || 0);
            const height = (copy.bounds.maxY || 0) - (copy.bounds.minY || 0);
            copy.totalArea = width * height;
        }
    }
    return copy;
}

function normalizeDistribution(distribution) {
    const fallback = { '1-3': 0.25, '3-5': 0.35, '5-10': 0.40 };
    if (!distribution || typeof distribution !== 'object') return fallback;
    const ordered = Object.entries(distribution).map(([range, value]) => {
        let weight = Number(value);
        if (Number.isNaN(weight) || weight < 0) weight = 0;
        if (weight > 1.01) weight = weight / 100;
        return [range, weight];
    }).sort((a, b) => {
        const aMin = parseFloat(a[0].split('-')[0]);
        const bMin = parseFloat(b[0].split('-')[0]);
        return aMin - bMin;
    });
    const total = ordered.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) return fallback;
    const normalized = {};
    ordered.forEach(([range, weight]) => {
        normalized[range] = weight / total;
    });
    return normalized;
}

function buildGeneratorOptions(floorPlan, preset, options = {}) {
    const merged = Object.assign({}, options);
    const area = estimateFloorArea(floorPlan);
    if (!merged.totalIlots) {
        merged.totalIlots = Math.max(10, Math.min(100, Math.round(area / 50)));
    }
    merged.corridorWidth = typeof merged.corridorWidth === 'number'
        ? merged.corridorWidth
        : (typeof preset.corridorWidth === 'number' ? preset.corridorWidth : 1.2);
    merged.margin = typeof merged.margin === 'number'
        ? merged.margin
        : (preset.options && typeof preset.options.minRowDistance === 'number'
            ? preset.options.minRowDistance
            : 1.0);
    merged.spacing = typeof merged.spacing === 'number'
        ? merged.spacing
        : (preset.options && typeof preset.options.spacing === 'number'
            ? preset.options.spacing
            : 0.3);
    merged.seed = typeof merged.seed === 'number' ? merged.seed : computeSeed(floorPlan, preset);
    return merged;
}

function computeSeed(floorPlan, preset) {
    const bounds = floorPlan.bounds || {};
    const source = [
        preset?.id || preset?.name || 'preset',
        bounds.minX ?? 0,
        bounds.minY ?? 0,
        bounds.maxX ?? 0,
        bounds.maxY ?? 0,
        floorPlan.urn || ''
    ].join('|');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }
    return hash;
}

function estimateFloorArea(floorPlan) {
    if (!floorPlan) return 0;
    if (typeof floorPlan.totalArea === 'number' && floorPlan.totalArea > 0) return floorPlan.totalArea;
    if (Array.isArray(floorPlan.rooms) && floorPlan.rooms.length) {
        return floorPlan.rooms.reduce((sum, room) => sum + (Number(room.area) || 0), 0);
    }
    if (floorPlan.bounds) {
        const width = (floorPlan.bounds.maxX || 0) - (floorPlan.bounds.minX || 0);
        const height = (floorPlan.bounds.maxY || 0) - (floorPlan.bounds.minY || 0);
        return width * height;
    }
    return 0;
}
