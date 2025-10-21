/**
 * Advanced Corridor Generator
 * Generates both horizontal (facing rows) and vertical (column gaps) corridors
 * Production-ready with full architectural accuracy
 */

const FacingRowDetector = require('./facingRowDetector');

class AdvancedCorridorGenerator {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;

        const defaultOptions = {
            corridorWidth: 1.5,
            margin: 0.5,
            generateVertical: true,
            generateHorizontal: true,
            minCorridorLength: 1.0,
            rowTolerance: 3.0,
            minRowDistance: 2.0,
            maxRowDistance: 8.0,
            minOverlap: 0.6,
            horizontalPriority: 1.5,
            verticalPriority: 1.0,
            adjacencyTolerance: 0.15,
            overlapTolerance: 0.2
        };

        this.options = Object.assign({}, defaultOptions, options);

        this.corridorWidth = this.options.corridorWidth;
        this.margin = this.options.margin;
        this.minCorridorLength = this.options.minCorridorLength;
        this.generateVertical = this.options.generateVertical;
        this.generateHorizontal = this.options.generateHorizontal;
        
        // Facing row detection options
        this.rowTolerance = this.options.rowTolerance;
        this.minRowDistance = this.options.minRowDistance;
        this.maxRowDistance = this.options.maxRowDistance;
        this.minOverlap = this.options.minOverlap;
        
        // Priority weights
        this.horizontalPriority = this.options.horizontalPriority;
        this.verticalPriority = this.options.verticalPriority;
        this.adjacencyTolerance = this.options.adjacencyTolerance;
        this.overlapTolerance = this.options.overlapTolerance;
    }

    /**
     * Generate complete corridor network
     * Returns horizontal + vertical corridors with conflict resolution
     */
    generate() {
        console.log('[Advanced Corridor] Starting generation...');
        console.log(`[Advanced Corridor] Input: ${this.ilots.length} îlots`);
        
        const result = this.generateAllCorridors();
        return {
            corridors: result.corridors,
            totalArea: result.metadata.totalArea,
            statistics: {
                horizontal: result.metadata.horizontal.count,
                vertical: result.metadata.vertical.count,
                final: result.corridors.length,
                removedDueToConflicts: result.metadata.removedDueToConflicts
            },
            invalid: result.invalid,
            metadata: result.metadata
        };
    }

    /**
     * Generate corridors with metadata and validation details.
     */
    generateAllCorridors() {
        const horizontalCorridors = this.generateHorizontal ? this.generateHorizontalCorridors() : [];
        const verticalCorridors = this.generateVertical ? this.generateVerticalCorridors() : [];

        console.log(`[Advanced Corridor] Generated ${horizontalCorridors.length} horizontal corridors`);
        console.log(`[Advanced Corridor] Generated ${verticalCorridors.length} vertical corridors`);

        const optimizedHorizontal = this.optimizeCorridors(horizontalCorridors);
        const optimizedVertical = this.optimizeCorridors(verticalCorridors);

        const resolved = this.resolveConflicts(optimizedHorizontal, optimizedVertical);
        const validation = this.validateCorridors(resolved);

        const verticalArea = optimizedVertical.reduce((sum, c) => sum + (c.area || 0), 0);
        const horizontalArea = optimizedHorizontal.reduce((sum, c) => sum + (c.area || 0), 0);
        const totalArea = validation.valid.reduce((sum, c) => sum + (c.area || 0), 0);

        const metadata = {
            horizontal: {
                count: optimizedHorizontal.length,
                totalArea: horizontalArea
            },
            vertical: {
                count: optimizedVertical.length,
                totalArea: verticalArea
            },
            removedDueToConflicts: optimizedHorizontal.length + optimizedVertical.length - resolved.length,
            totalArea,
            validCount: validation.valid.length,
            invalidCount: validation.invalid.length
        };

        return {
            corridors: validation.valid,
            invalid: validation.invalid,
            metadata
        };
    }

    /**
     * Generate horizontal corridors between facing rows of îlots
     */
    generateHorizontalCorridors() {
        const detector = new FacingRowDetector(this.ilots, {
            rowTolerance: this.rowTolerance,
            minRowDistance: this.minRowDistance,
            maxRowDistance: this.maxRowDistance,
            minOverlap: this.minOverlap
        });
        
        const result = detector.generateCorridorRecommendations(this.corridorWidth);
        
        return result.recommendations.map((rec, index) => ({
            id: `horizontal_${index + 1}`,
            type: 'horizontal',
            orientation: 'horizontal',
            polygon: rec.polygon,
            x: rec.x,
            y: rec.y,
            width: rec.width,
            height: rec.height,
            length: rec.width,
            area: rec.area,
            qualityScore: rec.qualityScore,
            priority: rec.qualityScore * this.horizontalPriority,
            connects: `rows_${rec.connectsRows[0]}_${rec.connectsRows[1]}`,
            connectsRows: rec.connectsRows,
            metadata: {
                row1Count: rec.row1IlotCount,
                row2Count: rec.row2IlotCount,
                distance: rec.distance,
                quality: rec.qualityScore
            }
        }));
    }

    /**
     * Generate vertical corridors in gaps between îlots in same column
     */
    generateVerticalCorridors() {
        const columns = this.groupIlotsByColumns();
        const corridors = [];
        let corridorIndex = 0;
        
        for (const column of columns) {
            // Sort by Y position
            column.sort((a, b) => a.y - b.y);
            
            for (let i = 0; i < column.length - 1; i++) {
                const ilot1 = column[i];
                const ilot2 = column[i + 1];
                
                const ilot1Bottom = ilot1.y + ilot1.height;
                const ilot2Top = ilot2.y;
                const gap = ilot2Top - ilot1Bottom;
                
                // Only create corridor if gap is large enough
                if (gap <= this.margin) continue;
                
                const availableGap = gap - this.margin;
                if (availableGap < this.minCorridorLength) continue;
                
                const corridorHeight = Math.min(this.corridorWidth, availableGap);
                
                // Calculate X extent
                const leftMost = Math.min(ilot1.x, ilot2.x);
                const rightMost = Math.max(ilot1.x + ilot1.width, ilot2.x + ilot2.width);
                
                // Center corridor in gap
                const corridorY = ilot1Bottom + (gap - corridorHeight) / 2;
                
                const polygon = [
                    [leftMost, corridorY],
                    [rightMost, corridorY],
                    [rightMost, corridorY + corridorHeight],
                    [leftMost, corridorY + corridorHeight]
                ];
                
                corridors.push({
                    id: `vertical_${++corridorIndex}`,
                    type: 'vertical',
                    orientation: 'vertical',
                    polygon,
                    x: leftMost,
                    y: corridorY,
                    width: rightMost - leftMost,
                    height: corridorHeight,
                    length: corridorHeight,
                    area: (rightMost - leftMost) * corridorHeight,
                    priority: this.verticalPriority,
                    connects: `ilots_${ilot1.id || i}_${ilot2.id || (i + 1)}`,
                    metadata: {
                        gap,
                        availableGap,
                        ilot1Bottom,
                        ilot2Top
                    }
                });
            }
        }
        
        return corridors;
    }

    /**
     * Group îlots by column (X-coordinate)
     */
    groupIlotsByColumns() {
        const columns = {};
        
        for (const ilot of this.ilots) {
            const colKey = Math.round(ilot.x * 10) / 10; // Round to 1 decimal
            if (!columns[colKey]) {
                columns[colKey] = [];
            }
            columns[colKey].push(ilot);
        }
        
        return Object.values(columns).filter(col => col.length > 1); // Only columns with multiple îlots
    }

    /**
     * Resolve conflicts between corridors
     * Priority: horizontal > vertical (configurable)
     */
    resolveConflicts(horizontal, vertical) {
        // Sort all corridors by priority (highest first)
        const allCorridors = [...horizontal, ...vertical].sort((a, b) => b.priority - a.priority);
        
        const kept = [];
        
        for (const corridor of allCorridors) {
            // Check if this corridor conflicts with any already kept
            const hasConflict = kept.some(existing => this.corridorsOverlap(corridor, existing));
            
            if (!hasConflict) {
                kept.push(corridor);
            }
        }
        
        return kept;
    }

    optimizeCorridors(corridors = []) {
        if (!Array.isArray(corridors) || corridors.length === 0) return [];

        const dedup = new Map();
        corridors.forEach(corridor => {
            const key = this._corridorKey(corridor);
            const existing = dedup.get(key);
            if (!existing || (existing.priority || 0) < (corridor.priority || 0)) {
                dedup.set(key, Object.assign({}, corridor));
            }
        });

        const ordered = Array.from(dedup.values()).sort((a, b) => (b.priority || 0) - (a.priority || 0));

        const merged = [];
        while (ordered.length > 0) {
            let current = ordered.shift();
            let mergedSomething = false;

            for (let i = 0; i < ordered.length; i++) {
                const candidate = ordered[i];
                if (current.orientation !== candidate.orientation) continue;
                if (!this._areAdjacentOrOverlapping(current, candidate)) continue;

                const mergedCorridor = this.mergeCorridors(current, candidate);
                if (mergedCorridor) {
                    current = mergedCorridor;
                    ordered.splice(i, 1);
                    i--;
                    mergedSomething = true;
                }
            }

            merged.push(current);
            if (!mergedSomething && this.options.limitOptimized) break;
        }

        return merged;
    }

    mergeCorridors(c1, c2) {
        if (!c1 || !c2) return null;
        if (c1.orientation !== c2.orientation) return null;
        if (!this._areAdjacentOrOverlapping(c1, c2)) return null;

        const bounds1 = this.getCorridorBounds(c1);
        const bounds2 = this.getCorridorBounds(c2);

        const mergedBounds = {
            minX: Math.min(bounds1.minX, bounds2.minX),
            maxX: Math.max(bounds1.maxX, bounds2.maxX),
            minY: Math.min(bounds1.minY, bounds2.minY),
            maxY: Math.max(bounds1.maxY, bounds2.maxY)
        };

        const merged = Object.assign({}, c1, {
            id: `merged_${(c1.id || 'c1')}_${(c2.id || 'c2')}`,
            x: mergedBounds.minX,
            y: mergedBounds.minY,
            width: mergedBounds.maxX - mergedBounds.minX,
            height: mergedBounds.maxY - mergedBounds.minY,
            area: (mergedBounds.maxX - mergedBounds.minX) * (mergedBounds.maxY - mergedBounds.minY),
            priority: Math.max(c1.priority || 0, c2.priority || 0),
            merged: true,
            mergedFrom: [
                ...(c1.mergedFrom || [c1.id || 'unknown']),
                ...(c2.mergedFrom || [c2.id || 'unknown'])
            ]
        });

        return merged;
    }

    /**
     * Check if two corridors overlap
     */
    corridorsOverlap(corridor1, corridor2) {
        const c1 = this.getCorridorBounds(corridor1);
        const c2 = this.getCorridorBounds(corridor2);
        
        // Check AABB intersection
        const xOverlap = c1.minX < c2.maxX && c1.maxX > c2.minX;
        const yOverlap = c1.minY < c2.maxY && c1.maxY > c2.minY;
        
        return xOverlap && yOverlap;
    }

    /**
     * Get axis-aligned bounding box for corridor
     */
    getCorridorBounds(corridor) {
        if (corridor.polygon && corridor.polygon.length > 0) {
            const xs = corridor.polygon.map(p => p[0]);
            const ys = corridor.polygon.map(p => p[1]);
            return {
                minX: Math.min(...xs),
                maxX: Math.max(...xs),
                minY: Math.min(...ys),
                maxY: Math.max(...ys)
            };
        }
        
        // Fallback to x, y, width, height
        return {
            minX: corridor.x,
            maxX: corridor.x + corridor.width,
            minY: corridor.y,
            maxY: corridor.y + corridor.height
        };
    }

    /**
     * Validate corridor doesn't intersect with forbidden zones or walls
     */
    validateCorridor(corridor) {
        if (!this.floorPlan) return true;
        
        const bounds = this.getCorridorBounds(corridor);
        
        // Check against forbidden zones
        if (this.floorPlan.forbiddenZones) {
            for (const zone of this.floorPlan.forbiddenZones) {
                if (this.intersectsZone(bounds, zone)) {
                    return false;
                }
            }
        }
        
        // Check against entrances (corridors shouldn't block entrances)
        if (this.floorPlan.entrances) {
            for (const entrance of this.floorPlan.entrances) {
                if (this.intersectsZone(bounds, entrance)) {
                    return false;
                }
            }
        }
        
        return true;
    }

    validateCorridors(corridors = []) {
        if (!Array.isArray(corridors)) return { valid: [], invalid: [] };

        const valid = [];
        const invalid = [];

        for (const corridor of corridors) {
            let isValid = this.validateCorridor(corridor);

            if (isValid && this.ilots) {
                for (const ilot of this.ilots) {
                    if (this.corridorCutsThroughIlot(corridor, ilot)) {
                        isValid = false;
                        break;
                    }
                }
            }

            if (isValid) {
                valid.push(corridor);
            } else {
                invalid.push(corridor);
            }
        }

        return { valid, invalid };
    }

    corridorCutsThroughIlot(corridor, ilot) {
        if (!corridor || !ilot) return false;
        const corridorBounds = this.getCorridorBounds(corridor);
        const ilotBounds = {
            minX: ilot.x,
            maxX: ilot.x + ilot.width,
            minY: ilot.y,
            maxY: ilot.y + ilot.height
        };

        const overlapMinX = Math.max(corridorBounds.minX, ilotBounds.minX);
        const overlapMaxX = Math.min(corridorBounds.maxX, ilotBounds.maxX);
        const overlapMinY = Math.max(corridorBounds.minY, ilotBounds.minY);
        const overlapMaxY = Math.min(corridorBounds.maxY, ilotBounds.maxY);

        if (overlapMinX >= overlapMaxX || overlapMinY >= overlapMaxY) return false;

        const overlapArea = (overlapMaxX - overlapMinX) * (overlapMaxY - overlapMinY);
        const corridorArea = corridor.area || ((corridorBounds.maxX - corridorBounds.minX) * (corridorBounds.maxY - corridorBounds.minY));

        // Consider it cutting through if more than tolerance of corridor area overlaps
        const overlapRatio = overlapArea / (corridorArea || 1);
        return overlapRatio > (1 - this.overlapTolerance);
    }

    /**
     * Check if corridor bounds intersect with a zone
     */
    intersectsZone(bounds, zone) {
        if (!zone.polygon || zone.polygon.length === 0) return false;
        
        const xs = zone.polygon.map(p => p[0]);
        const ys = zone.polygon.map(p => p[1]);
        const zoneMinX = Math.min(...xs);
        const zoneMaxX = Math.max(...xs);
        const zoneMinY = Math.min(...ys);
        const zoneMaxY = Math.max(...ys);
        
        const xOverlap = bounds.minX < zoneMaxX && bounds.maxX > zoneMinX;
        const yOverlap = bounds.minY < zoneMaxY && bounds.maxY > zoneMinY;
        
        return xOverlap && yOverlap;
    }

    /**
     * Generate visualization data for debugging
     */
    getVisualizationData() {
        const horizontal = this.generateHorizontalCorridors();
        const vertical = this.generateVerticalCorridors();
        
        return {
            horizontal: {
                count: horizontal.length,
                corridors: horizontal.map(c => ({
                    id: c.id,
                    bounds: this.getCorridorBounds(c),
                    area: c.area,
                    priority: c.priority
                }))
            },
            vertical: {
                count: vertical.length,
                corridors: vertical.map(c => ({
                    id: c.id,
                    bounds: this.getCorridorBounds(c),
                    area: c.area,
                    priority: c.priority
                }))
            }
        };
    }

    _corridorKey(corridor) {
        return [
            corridor.orientation || 'any',
            corridor.type || 'generic',
            (corridor.x || 0).toFixed(3),
            (corridor.y || 0).toFixed(3),
            (corridor.width || 0).toFixed(3),
            (corridor.height || 0).toFixed(3)
        ].join(':');
    }

    _areAdjacentOrOverlapping(a, b) {
        if (!a || !b) return false;
        if (this.corridorsOverlap(a, b)) return true;

        const boundsA = this.getCorridorBounds(a);
        const boundsB = this.getCorridorBounds(b);
        const tolerance = this.adjacencyTolerance;

        if (a.orientation === 'vertical') {
            const xOverlap = boundsA.minX < boundsB.maxX && boundsA.maxX > boundsB.minX;
            const yAdjacent = Math.abs(boundsA.maxY - boundsB.minY) <= tolerance || Math.abs(boundsB.maxY - boundsA.minY) <= tolerance;
            return xOverlap && yAdjacent;
        }

        if (a.orientation === 'horizontal') {
            const yOverlap = boundsA.minY < boundsB.maxY && boundsA.maxY > boundsB.minY;
            const xAdjacent = Math.abs(boundsA.maxX - boundsB.minX) <= tolerance || Math.abs(boundsB.maxX - boundsA.minX) <= tolerance;
            return yOverlap && xAdjacent;
        }

        return false;
    }
}

module.exports = AdvancedCorridorGenerator;
