/**
 * Unit Catalog System
 * Defines standard unit types, dimensions, and constraints for the self-storage facility.
 */

class UnitCatalog {
    constructor() {
        this.templates = [
            {
                id: 'S',
                name: 'Small',
                description: 'Small storage unit (0-2 m²)',
                minArea: 0,
                maxArea: 2,
                dimensions: [
                    { width: 1.0, depth: 1.0 },
                    { width: 1.0, depth: 1.5 },
                    { width: 1.5, depth: 1.0 }
                ],
                doorWidth: 0.8,
                partitionThickness: 0.05,
                color: '#4CAF50'
            },
            {
                id: 'M',
                name: 'Medium',
                description: 'Medium storage unit (2-5 m²)',
                minArea: 2,
                maxArea: 5,
                dimensions: [
                    { width: 1.5, depth: 2.0 },
                    { width: 2.0, depth: 2.0 },
                    { width: 2.0, depth: 2.5 }
                ],
                doorWidth: 0.9,
                partitionThickness: 0.05,
                color: '#2196F3'
            },
            {
                id: 'L',
                name: 'Large',
                description: 'Large storage unit (5-10 m²)',
                minArea: 5,
                maxArea: 10,
                dimensions: [
                    { width: 2.5, depth: 3.0 },
                    { width: 3.0, depth: 3.0 },
                    { width: 3.0, depth: 3.3 } // ~10m2
                ],
                doorWidth: 1.0,
                partitionThickness: 0.05,
                color: '#FF9800'
            },
            {
                id: 'XL',
                name: 'Extra Large',
                description: 'Extra Large storage unit (10+ m²)',
                minArea: 10,
                maxArea: 20,
                dimensions: [
                    { width: 3.0, depth: 4.0 },
                    { width: 4.0, depth: 4.0 },
                    { width: 4.0, depth: 5.0 }
                ],
                doorWidth: 1.2,
                partitionThickness: 0.05,
                color: '#9C27B0'
            }
        ];
    }

    getTemplateById(id) {
        return this.templates.find(t => t.id === id);
    }

    getTemplates() {
        return this.templates;
    }

    /**
     * Find best matching template for a requested area
     * @param {number} targetArea 
     */
    findBestTemplateForArea(targetArea) {
        // Find templates that include this area in their range
        const candidates = this.templates.filter(t => targetArea >= t.minArea && targetArea <= t.maxArea);

        if (candidates.length === 0) {
            // Fallback: find closest
            return this.templates.sort((a, b) => {
                const distA = Math.min(Math.abs(targetArea - a.minArea), Math.abs(targetArea - a.maxArea));
                const distB = Math.min(Math.abs(targetArea - b.minArea), Math.abs(targetArea - b.maxArea));
                return distA - distB;
            })[0];
        }
        return candidates[0];
    }

    /**
     * Get validated dimensions for a specific template
     * @param {string} templateId 
     * @param {number} preferredWidth Optional preferred width
     */
    getDimensionsForTemplate(templateId, preferredWidth = null) {
        const template = this.getTemplateById(templateId);
        if (!template) return null;

        if (preferredWidth) {
            const exact = template.dimensions.find(d => Math.abs(d.width - preferredWidth) < 0.1);
            if (exact) return exact;
        }

        // Return random available dimension for now, or first
        return template.dimensions[0];
    }
}

module.exports = new UnitCatalog();
