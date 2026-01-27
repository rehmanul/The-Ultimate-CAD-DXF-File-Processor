/**
 * COSTO Box Catalog - V1
 * Configurable box catalog system for storage unit templates
 * Based on COSTO V1 specifications
 */

class CostoBoxCatalog {
    constructor() {
        this.templates = new Map();
        this.defaultTemplates = this._createDefaultTemplates();
        this._initializeDefaults();
    }

    _createDefaultTemplates() {
        return {
            'S': {
                name: 'S',
                description: 'Small storage unit',
                minArea: 0.5,
                maxArea: 2.0,
                widthRange: { min: 0.8, max: 1.5 },
                depthRange: { min: 0.8, max: 2.0 },
                doorWidth: 0.9,
                partitionType: 'standard',
                partitionThickness: 0.1,
                module: 0.1, // 0.1m grid alignment
                aspectRatio: { min: 0.6, max: 1.4 },
                accessible: false,
                premium: false
            },
            'M': {
                name: 'M',
                description: 'Medium storage unit',
                minArea: 2.0,
                maxArea: 5.0,
                widthRange: { min: 1.2, max: 2.5 },
                depthRange: { min: 1.0, max: 3.0 },
                doorWidth: 1.0,
                partitionType: 'standard',
                partitionThickness: 0.1,
                module: 0.1,
                aspectRatio: { min: 0.6, max: 1.4 },
                accessible: false,
                premium: false
            },
            'L': {
                name: 'L',
                description: 'Large storage unit',
                minArea: 5.0,
                maxArea: 10.0,
                widthRange: { min: 1.5, max: 3.5 },
                depthRange: { min: 1.5, max: 4.0 },
                doorWidth: 1.2,
                partitionType: 'standard',
                partitionThickness: 0.1,
                module: 0.1,
                aspectRatio: { min: 0.6, max: 1.4 },
                accessible: false,
                premium: false
            },
            'XL': {
                name: 'XL',
                description: 'Extra large storage unit',
                minArea: 10.0,
                maxArea: 20.0,
                widthRange: { min: 2.0, max: 5.0 },
                depthRange: { min: 2.0, max: 5.0 },
                doorWidth: 1.5,
                partitionType: 'standard',
                partitionThickness: 0.1,
                module: 0.1,
                aspectRatio: { min: 0.6, max: 1.4 },
                accessible: false,
                premium: false
            }
        };
    }

    _initializeDefaults() {
        for (const [name, template] of Object.entries(this.defaultTemplates)) {
            this.templates.set(name, { ...template });
        }
    }

    /**
     * Define or update a box template
     * @param {string} name - Template name (e.g., 'S', 'M', 'L', 'XL')
     * @param {Object} config - Template configuration
     */
    defineTemplate(name, config) {
        if (!name || typeof name !== 'string') {
            throw new Error('Template name must be a non-empty string');
        }

        const template = {
            name: name.toUpperCase(),
            description: config.description || `${name} storage unit`,
            minArea: Number(config.minArea) || 0.5,
            maxArea: Number(config.maxArea) || 20.0,
            widthRange: config.widthRange || { min: 0.8, max: 5.0 },
            depthRange: config.depthRange || { min: 0.8, max: 5.0 },
            doorWidth: Number(config.doorWidth) || 0.9,
            partitionType: config.partitionType || 'standard',
            partitionThickness: Number(config.partitionThickness) || 0.1,
            module: Number(config.module) || 0.1,
            aspectRatio: config.aspectRatio || { min: 0.6, max: 1.4 },
            accessible: Boolean(config.accessible),
            premium: Boolean(config.premium)
        };

        // Validate template
        this._validateTemplate(template);
        
        this.templates.set(template.name, template);
        return template;
    }

    _validateTemplate(template) {
        if (template.minArea >= template.maxArea) {
            throw new Error(`Template ${template.name}: minArea must be less than maxArea`);
        }
        if (template.widthRange.min >= template.widthRange.max) {
            throw new Error(`Template ${template.name}: widthRange min must be less than max`);
        }
        if (template.depthRange.min >= template.depthRange.max) {
            throw new Error(`Template ${template.name}: depthRange min must be less than max`);
        }
        if (template.aspectRatio.min >= template.aspectRatio.max) {
            throw new Error(`Template ${template.name}: aspectRatio min must be less than max`);
        }
    }

    /**
     * Get box dimensions for a target area
     * @param {string} type - Box type (e.g., 'S', 'M', 'L', 'XL')
     * @param {number} targetArea - Target area in m²
     * @param {Object} constraints - Additional constraints (maxWidth, maxDepth, etc.)
     * @param {Object} rules - Rounding rules (e.g., { area: 0.5, dimension: 0.1 })
     * @returns {Object|null} - { width, depth, area, type } or null if impossible
     */
    getBoxDimensions(type, targetArea, constraints = {}, rules = {}) {
        const template = this.templates.get(type.toUpperCase());
        if (!template) {
            console.warn(`[BoxCatalog] Template '${type}' not found, using defaults`);
            // Return default dimensions
            return {
                width: 2.0,
                depth: 1.5,
                area: 3.0,
                type: type.toUpperCase(),
                doorWidth: 0.9,
                partitionThickness: 0.1,
                accessible: false,
                premium: false
            };
        }

        const maxWidth = constraints.maxWidth || template.widthRange.max;
        const maxDepth = constraints.maxDepth || template.depthRange.max;
        const minWidth = Math.max(template.widthRange.min, constraints.minWidth || 0);
        const minDepth = Math.max(template.depthRange.min, constraints.minDepth || 0);

        // Clamp target area to template range
        const clampedArea = Math.max(template.minArea, Math.min(template.maxArea, targetArea));

        // Try different aspect ratios
        const aspectRatios = [1.2, 1.5, 1.8, 2.0, 0.8, 0.6, 1.0];
        
        for (const aspect of aspectRatios) {
            // Calculate dimensions from area and aspect ratio
            let width = Math.sqrt(clampedArea * aspect);
            let depth = clampedArea / width;

            // Apply rounding rules
            if (rules.dimension) {
                width = Math.round(width / rules.dimension) * rules.dimension;
                depth = Math.round(depth / rules.dimension) * rules.dimension;
            }

            // Validate constraints
            if (width < minWidth || width > maxWidth) continue;
            if (depth < minDepth || depth > maxDepth) continue;

            const actualArea = width * depth;
            const actualAspect = width / depth;

            // Check aspect ratio (relaxed check)
            if (actualAspect < template.aspectRatio.min * 0.8 || actualAspect > template.aspectRatio.max * 1.2) {
                continue;
            }

            // Apply area rounding if specified
            let finalArea = actualArea;
            if (rules.area) {
                finalArea = Math.round(actualArea / rules.area) * rules.area;
                // Adjust dimensions to match rounded area
                const scale = Math.sqrt(finalArea / actualArea);
                width *= scale;
                depth *= scale;
                
                if (rules.dimension) {
                    width = Math.round(width / rules.dimension) * rules.dimension;
                    depth = Math.round(depth / rules.dimension) * rules.dimension;
                }
                finalArea = width * depth;
            }

            // Final validation (relaxed)
            if (finalArea < template.minArea * 0.8 || finalArea > template.maxArea * 1.2) continue;
            if (width < minWidth * 0.8 || width > maxWidth * 1.1) continue;
            if (depth < minDepth * 0.8 || depth > maxDepth * 1.1) continue;

            return {
                width: Math.max(0.5, width),
                depth: Math.max(0.5, depth),
                area: finalArea,
                type: template.name,
                doorWidth: template.doorWidth,
                partitionThickness: template.partitionThickness,
                accessible: template.accessible,
                premium: template.premium
            };
        }

        // Fallback: Use maximum dimensions that fit
        const maxPossibleArea = maxWidth * maxDepth;
        const useArea = Math.min(clampedArea, maxPossibleArea * 0.9);
        
        // Try simple square-ish box
        let finalWidth = Math.sqrt(useArea * 1.2);
        let finalDepth = useArea / finalWidth;
        
        // Clamp to constraints
        finalWidth = Math.max(minWidth, Math.min(maxWidth, finalWidth));
        finalDepth = Math.max(minDepth, Math.min(maxDepth, finalDepth));
        
        // Adjust to fit
        if (finalWidth * finalDepth < useArea * 0.5) {
            finalWidth = Math.min(maxWidth, finalWidth * 1.2);
            finalDepth = Math.min(maxDepth, finalDepth * 1.2);
        }

        return {
            width: Math.max(0.5, finalWidth),
            depth: Math.max(0.5, finalDepth),
            area: finalWidth * finalDepth,
            type: template.name,
            doorWidth: template.doorWidth,
            partitionThickness: template.partitionThickness,
            accessible: template.accessible,
            premium: template.premium
        };
    }

    /**
     * Get template by name
     * @param {string} name - Template name
     * @returns {Object|null} - Template configuration
     */
    getTemplate(name) {
        return this.templates.get(name.toUpperCase()) || null;
    }

    /**
     * Get all templates
     * @returns {Array<Object>} - Array of template configurations
     */
    getAllTemplates() {
        return Array.from(this.templates.values());
    }

    /**
     * Find template for a given area
     * @param {number} area - Area in m²
     * @returns {Object|null} - Matching template
     */
    findTemplateForArea(area) {
        for (const template of this.templates.values()) {
            if (area >= template.minArea && area <= template.maxArea) {
                return template;
            }
        }
        return null;
    }

    /**
     * Export catalog configuration
     * @returns {Object} - Serializable catalog
     */
    exportCatalog() {
        return {
            templates: Array.from(this.templates.entries()).map(([name, template]) => ({
                name: template.name,
                ...template
            })),
            version: '1.0'
        };
    }

    /**
     * Import catalog configuration
     * @param {Object} catalog - Catalog configuration
     */
    importCatalog(catalog) {
        if (!catalog || !catalog.templates) return;
        
        this.templates.clear();
        for (const template of catalog.templates) {
            this.defineTemplate(template.name, template);
        }
    }
}

module.exports = new CostoBoxCatalog();
