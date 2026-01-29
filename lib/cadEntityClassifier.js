/**
 * CAD Entity Classifier
 * Classifies CAD entities using layer and color rules.
 */

const dxfColorTable = require('./dxfColorTable');
const { normalizeLayerName } = require('./layerNormalization');

class CADEntityClassifier {
    constructor() {
    }

    /**
     * Classify a CAD entity using deterministic rules
     */
    classifyEntity(entity) {
        const layer = normalizeLayerName(entity.layer);
        const colorRaw = entity.color || 0;
        const color = dxfColorTable.normalizeDXFColor(colorRaw);

        // Prioritize layer-based classification first
        if (layer.includes('ENVELOPE') || layer.includes('PERIMETER') || layer.includes('BOUNDARY') ||
            layer.includes('EXTERNAL') || layer.includes('OUTLINE')) {
            return { type: 'envelope', confidence: 0.95 };
        } else if (layer.includes('ENTRANCE') || layer.includes('EXIT') || layer.includes('DOOR') ||
            layer.includes('OPENING') || layer.includes('RED') || layer === 'ENTREE_SORTIE' ||
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
        
        // Color-based detection: Green (color 3) = envelope/perimeter
        if (color === 3 || color === 0x00ff00 || color === 0x00FF00) {
            // Check if it's a large closed polygon (likely envelope)
            if (entity.polygon && entity.polygon.length >= 4) {
                return { type: 'envelope', confidence: 0.8 };
            }
        }

        // Then prioritize color-based classification using DXF color table
        const colorClassification = dxfColorTable.classifyByColor(color);
        if (colorClassification.confidence >= 0.7) {
            return colorClassification;
        }

        // Default to wall when classification is ambiguous
        return { type: 'wall', confidence: 0.6 };
    }
}

module.exports = new CADEntityClassifier();
