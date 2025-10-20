/**
 * Phase 2: Preset Management API Routes
 * Server-side endpoints for managing distribution presets
 */

const express = require('express');
const router = express.Router();
const distributionPresets = require('../lib/distributionPresets');

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
        const { preset, floorPlanId } = req.body;

        if (!preset || !floorPlanId) {
            return res.status(400).json({
                success: false,
                error: 'Missing preset or floorPlanId'
            });
        }

        // Load floor plan processor
        const FloorPlanProcessor = require('../lib/floorPlanProcessor');
        const processor = new FloorPlanProcessor();

        // Get floor plan data from database or cache
        // This is a placeholder - implement your actual data retrieval
        const floorPlanData = await getFloorPlanData(floorPlanId);
        
        if (!floorPlanData) {
            return res.status(404).json({
                success: false,
                error: 'Floor plan not found'
            });
        }

        // Apply preset configuration
        const result = await processor.generateLayoutWithPreset(floorPlanData, preset);

        res.json({
            success: true,
            layout: result,
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

/**
 * Helper function to get floor plan data
 * Replace with your actual implementation
 */
async function getFloorPlanData(floorPlanId) {
    // TODO: Implement actual database lookup
    // For now, return null
    return null;
}

module.exports = router;
