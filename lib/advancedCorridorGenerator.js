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
        this.corridorWidth = options.corridorWidth || 1.5;
        this.margin = options.margin || 0.5;
        
        // Facing row detection options
        this.rowTolerance = options.rowTolerance || 3.0;
        this.minRowDistance = options.minRowDistance || 2.0;
        this.maxRowDistance = options.maxRowDistance || 8.0;
        this.minOverlap = options.minOverlap || 0.6;
        
        // Priority weights
        this.horizontalPriority = options.horizontalPriority !== undefined ? options.horizontalPriority : 1.5;
        this.verticalPriority = options.verticalPriority !== undefined ? options.verticalPriority : 1.0;
    }

    /**
     * Generate complete corridor network
     * Returns horizontal + vertical corridors with conflict resolution
     */
    generate() {
        console.log('[Advanced Corridor] Starting generation...');
        console.log(`[Advanced Corridor] Input: ${this.ilots.length} îlots`);
        
        // Step 1: Generate horizontal corridors between facing rows
        const horizontalCorridors = this.generateHorizontalCorridors();
        console.log(`[Advanced Corridor] Generated ${horizontalCorridors.length} horizontal corridors`);
        
        // Step 2: Generate vertical corridors in column gaps
        const verticalCorridors = this.generateVerticalCorridors();
        console.log(`[Advanced Corridor] Generated ${verticalCorridors.length} vertical corridors`);
        
        // Step 3: Resolve conflicts (remove overlapping corridors)
        const resolved = this.resolveConflicts(horizontalCorridors, verticalCorridors);
        console.log(`[Advanced Corridor] Final: ${resolved.length} corridors after conflict resolution`);
        
        // Step 4: Calculate total area
        const totalArea = resolved.reduce((sum, c) => sum + c.area, 0);
        
        return {
            corridors: resolved,
            totalArea,
            statistics: {
                horizontal: horizontalCorridors.length,
                vertical: verticalCorridors.length,
                final: resolved.length,
                removedDueToConflicts: (horizontalCorridors.length + verticalCorridors.length) - resolved.length
            }
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
            polygon: rec.polygon,
            x: rec.x,
            y: rec.y,
            width: rec.width,
            height: rec.height,
            length: rec.width,
            area: rec.area,
            priority: rec.qualityScore * this.horizontalPriority,
            connects: `rows_${rec.connectsRows[0]}_${rec.connectsRows[1]}`,
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
                    polygon,
                    x: leftMost,
                    y: corridorY,
                    width: rightMost - leftMost,
                    height: corridorHeight,
                    length: corridorHeight,
                    area: (rightMost - leftMost) * corridorHeight,
                    priority: this.verticalPriority,
                    connects: `ilots_${ilot1.id || i}_${ilot2.id || (i+1)}`,
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
}

module.exports = AdvancedCorridorGenerator;
