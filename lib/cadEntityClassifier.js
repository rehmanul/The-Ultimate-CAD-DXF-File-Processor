/**
 * CAD Entity Classifier
 * Integrates ML-based classification into CAD processing pipeline
 */

const mlProcessor = require('./mlProcessor');

class CADEntityClassifier {
    constructor() {
        this.mlProcessor = mlProcessor;
    }

    /**
     * Classify a CAD entity using ML processor
     */
    classifyEntity(entity) {
        const layer = (entity.layer || '').toUpperCase();
        const color = entity.color || 0;

        // Prioritize layer-based classification first
        if (layer.includes('ENTRANCE') || layer.includes('EXIT') || layer.includes('DOOR') ||
            layer.includes('OPENING') || layer.includes('RED') || layer === 'ENTREE__SORTIE' ||
            layer === 'DOORS') {
            return { type: 'entrance', confidence: 0.9 };
        } else if (layer.includes('FORBIDDEN') || layer.includes('STAIR') || layer.includes('ELEVATOR') ||
            layer.includes('LIFT') || layer.includes('BLUE') || layer.includes('RESTRICT') ||
            layer === 'NO_ENTREE' || layer === 'STAIRS' || layer === 'CABINETRY' ||
            layer === 'LIGHTING' || layer === 'POWER' || layer === 'APPLIANCES') {
            return { type: 'forbidden', confidence: 0.9 };
        } else if (layer === 'WALLS' || layer === 'MUR' || layer.includes('WALL') || layer === '0') {
            return { type: 'wall', confidence: 0.9 };
        }

        // Then prioritize color-based classification
        if (color === 0xFF0000 || color === 1 || color === 16711680) { // Red
            return { type: 'entrance', confidence: 0.8 };
        } else if (color === 0x0000FF || color === 5 || color === 255) { // Blue
            return { type: 'forbidden', confidence: 0.8 };
        }

        // Extract features from entity
        const features = this.extractEntityFeatures(entity);

        // Use ML processor for classification only as last resort
        try {
            if (this.mlProcessor.isInitialized) {
                return this.mlProcessor.classifyCADEntity(features);
            }
        } catch (error) {
            console.warn('ML classification failed, using fallback:', error.message);
        }

        // Fallback to rule-based classification
        return this.fallbackClassification(entity);
    }

    /**
     * Extract features from CAD entity for ML classification
     */
    extractEntityFeatures(entity) {
        const layer = (entity.layer || '').toLowerCase();
        const color = entity.color || 0;

        // Calculate geometric properties
        let area = 0;
        let perimeter = 0;
        let aspectRatio = 1;
        let center = { x: 0, y: 0 };

        if (entity.polygon) {
            // Polygon entity
            const vertices = entity.polygon;
            const bounds = this.getPolygonBounds(vertices);
            area = this.calculatePolygonArea(vertices);
            perimeter = this.calculatePolygonPerimeter(vertices);
            aspectRatio = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);
            center = {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2
            };
        } else if (entity.start && entity.end) {
            // Line entity
            const length = Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y);
            perimeter = length;
            aspectRatio = 1;
            center = {
                x: (entity.start.x + entity.end.x) / 2,
                y: (entity.start.y + entity.end.y) / 2
            };
        }

        return {
            layer: layer,
            color: color,
            center: center,
            area: area,
            perimeter: perimeter,
            aspectRatio: aspectRatio
        };
    }

    /**
     * Fallback rule-based classification
     */
    fallbackClassification(entity) {
        const layer = (entity.layer || '').toUpperCase();
        const color = entity.color || 0;

        // Layer-based classification first (higher priority)
        if (layer.includes('ENTRANCE') || layer.includes('EXIT') || layer.includes('DOOR') ||
            layer.includes('OPENING') || layer.includes('RED') || layer === 'ENTREE__SORTIE' ||
            layer === 'DOORS') {
            return { type: 'entrance', confidence: 0.9 };
        } else if (layer.includes('FORBIDDEN') || layer.includes('STAIR') || layer.includes('ELEVATOR') ||
            layer.includes('LIFT') || layer.includes('BLUE') || layer.includes('RESTRICT') ||
            layer === 'NO_ENTREE' || layer === 'STAIRS' || layer === 'CABINETRY' ||
            layer === 'LIGHTING' || layer === 'POWER' || layer === 'APPLIANCES') {
            return { type: 'forbidden', confidence: 0.9 };
        } else if (layer === 'WALLS' || layer === 'MUR' || layer.includes('WALL')) {
            return { type: 'wall', confidence: 0.9 };
        }

        // Color-based classification as fallback
        if (color === 0xFF0000 || color === 1 || color === 16711680) { // Red
            return { type: 'entrance', confidence: 0.8 };
        } else if (color === 0x0000FF || color === 5 || color === 255) { // Blue
            return { type: 'forbidden', confidence: 0.8 };
        }

        // Default to wall
        return { type: 'wall', confidence: 0.7 };
    }

    /**
     * Helper methods for polygon calculations
     */
    getPolygonBounds(vertices) {
        if (!vertices || vertices.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        vertices.forEach(v => {
            minX = Math.min(minX, v[0]);
            minY = Math.min(minY, v[1]);
            maxX = Math.max(maxX, v[0]);
            maxY = Math.max(maxY, v[1]);
        });

        return { minX, minY, maxX, maxY };
    }

    calculatePolygonArea(vertices) {
        if (!vertices || vertices.length < 3) return 0;

        let area = 0;
        for (let i = 0; i < vertices.length; i++) {
            const j = (i + 1) % vertices.length;
            area += vertices[i][0] * vertices[j][1];
            area -= vertices[j][0] * vertices[i][1];
        }

        return Math.abs(area / 2);
    }

    calculatePolygonPerimeter(vertices) {
        if (!vertices || vertices.length < 2) return 0;

        let perimeter = 0;
        for (let i = 0; i < vertices.length; i++) {
            const j = (i + 1) % vertices.length;
            perimeter += Math.hypot(vertices[j][0] - vertices[i][0], vertices[j][1] - vertices[i][1]);
        }

        return perimeter;
    }
}

module.exports = new CADEntityClassifier();
