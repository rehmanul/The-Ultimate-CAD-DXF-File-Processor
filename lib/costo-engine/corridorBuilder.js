'use strict';

/**
 * CorridorBuilder - Enriches corridor data with IDs and metadata
 */
class CorridorBuilder {
    constructor(options) {
        this.options = options;
    }

    enrich(corridors) {
        return corridors.map((c, i) => ({
            ...c,
            id: c.id || `corridor_${i}`,
            type: c.type || 'ACCESS',
            direction: c.direction || (c.width > c.height ? 'horizontal' : 'vertical')
        }));
    }
}

module.exports = CorridorBuilder;
