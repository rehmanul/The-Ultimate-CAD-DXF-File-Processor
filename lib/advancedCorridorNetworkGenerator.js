/**
 * AdvancedCorridorNetworkGenerator
 * Creates complete circulation network with horizontal AND vertical corridors
 * Matches COSTO V1 reference output (pink circulation paths)
 */
class AdvancedCorridorNetworkGenerator {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots || [];
        this.corridorWidth = options.corridorWidth || 1.2;
        this.margin = options.margin || 0.2;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        this.minCorridorLength = options.minCorridorLength || 2.0;
    }

    /**
     * Generate complete corridor network
     * @returns {Array} Array of corridor segments with corners for path rendering
     */
    generateNetwork() {
        if (!this.ilots || this.ilots.length === 0) {
            console.warn('[Corridor Network] No îlots provided');
            return [];
        }

        const corridors = [];

        // Step 1: Generate vertical corridors (between rows)
        const verticalCorridors = this.generateVerticalCorridors();
        corridors.push(...verticalCorridors);

        // Step 2: Generate horizontal corridors (between columns)
        const horizontalCorridors = this.generateHorizontalCorridors();
        corridors.push(...horizontalCorridors);

        // Step 3: Generate perimeter corridors (around edges)
        const perimeterCorridors = this.generatePerimeterCorridors();
        corridors.push(...perimeterCorridors);

        // Step 4: Connect corridors into continuous paths
        const connectedPaths = this.connectCorridorPaths(corridors);

        console.log(`[Corridor Network] Generated ${connectedPaths.length} corridor paths`);
        return connectedPaths;
    }

    /**
     * Generate vertical corridors between rows of îlots
     * @returns {Array} Vertical corridor segments
     */
    generateVerticalCorridors() {
        const corridors = [];
        const rows = this.groupIlotsByRows();

        rows.forEach((row, rowIndex) => {
            if (row.length < 2) return;

            const sorted = [...row].sort((a, b) => a.x - b.x);

            for (let i = 0; i < sorted.length - 1; i++) {
                const current = sorted[i];
                const next = sorted[i + 1];
                const currentRight = current.x + current.width;
                const gap = next.x - currentRight;

                if (gap < (this.margin + this.corridorWidth)) continue;

                const corridorX = currentRight + this.margin;
                const minY = Math.min(current.y, next.y);
                const maxY = Math.max(current.y + current.height, next.y + next.height);
                const corridorHeight = maxY - minY;

                if (corridorHeight < this.minCorridorLength) continue;

                corridors.push({
                    id: `v_${rowIndex}_${i}`,
                    type: 'vertical',
                    x: corridorX,
                    y: minY,
                    width: this.corridorWidth,
                    height: corridorHeight,
                    corners: [
                        [corridorX, minY],
                        [corridorX, maxY],
                        [corridorX + this.corridorWidth, maxY],
                        [corridorX + this.corridorWidth, minY]
                    ]
                });
            }
        });

        return corridors;
    }

    /**
     * Generate horizontal corridors between columns of îlots
     * @returns {Array} Horizontal corridor segments
     */
    generateHorizontalCorridors() {
        const corridors = [];
        const columns = this.groupIlotsByColumns();

        columns.forEach((column, colIndex) => {
            if (column.length < 2) return;

            const sorted = [...column].sort((a, b) => a.y - b.y);

            for (let i = 0; i < sorted.length - 1; i++) {
                const current = sorted[i];
                const next = sorted[i + 1];
                const currentBottom = current.y + current.height;
                const gap = next.y - currentBottom;

                if (gap < (this.margin + this.corridorWidth)) continue;

                const corridorY = currentBottom + this.margin;
                const minX = Math.min(current.x, next.x);
                const maxX = Math.max(current.x + current.width, next.x + next.width);
                const corridorWidth = maxX - minX;

                if (corridorWidth < this.minCorridorLength) continue;

                corridors.push({
                    id: `h_${colIndex}_${i}`,
                    type: 'horizontal',
                    x: minX,
                    y: corridorY,
                    width: corridorWidth,
                    height: this.corridorWidth,
                    corners: [
                        [minX, corridorY],
                        [maxX, corridorY],
                        [maxX, corridorY + this.corridorWidth],
                        [minX, corridorY + this.corridorWidth]
                    ]
                });
            }
        });

        return corridors;
    }

    /**
     * Generate perimeter corridors around the edges
     * @returns {Array} Perimeter corridor segments
     */
    generatePerimeterCorridors() {
        const corridors = [];
        const bounds = this.bounds;
        const margin = 1.5; // Distance from wall

        // Check if there's space for perimeter corridors
        const hasTopSpace = this.checkSpaceForPerimeter('top', margin);
        const hasBottomSpace = this.checkSpaceForPerimeter('bottom', margin);
        const hasLeftSpace = this.checkSpaceForPerimeter('left', margin);
        const hasRightSpace = this.checkSpaceForPerimeter('right', margin);

        // Top perimeter
        if (hasTopSpace) {
            const y = bounds.maxY - margin - this.corridorWidth;
            corridors.push({
                id: 'perimeter_top',
                type: 'horizontal',
                x: bounds.minX + margin,
                y: y,
                width: (bounds.maxX - bounds.minX) - 2 * margin,
                height: this.corridorWidth,
                corners: [
                    [bounds.minX + margin, y],
                    [bounds.maxX - margin, y],
                    [bounds.maxX - margin, y + this.corridorWidth],
                    [bounds.minX + margin, y + this.corridorWidth]
                ]
            });
        }

        // Bottom perimeter
        if (hasBottomSpace) {
            const y = bounds.minY + margin;
            corridors.push({
                id: 'perimeter_bottom',
                type: 'horizontal',
                x: bounds.minX + margin,
                y: y,
                width: (bounds.maxX - bounds.minX) - 2 * margin,
                height: this.corridorWidth,
                corners: [
                    [bounds.minX + margin, y],
                    [bounds.maxX - margin, y],
                    [bounds.maxX - margin, y + this.corridorWidth],
                    [bounds.minX + margin, y + this.corridorWidth]
                ]
            });
        }

        // Left perimeter
        if (hasLeftSpace) {
            const x = bounds.minX + margin;
            corridors.push({
                id: 'perimeter_left',
                type: 'vertical',
                x: x,
                y: bounds.minY + margin,
                width: this.corridorWidth,
                height: (bounds.maxY - bounds.minY) - 2 * margin,
                corners: [
                    [x, bounds.minY + margin],
                    [x, bounds.maxY - margin],
                    [x + this.corridorWidth, bounds.maxY - margin],
                    [x + this.corridorWidth, bounds.minY + margin]
                ]
            });
        }

        // Right perimeter
        if (hasRightSpace) {
            const x = bounds.maxX - margin - this.corridorWidth;
            corridors.push({
                id: 'perimeter_right',
                type: 'vertical',
                x: x,
                y: bounds.minY + margin,
                width: this.corridorWidth,
                height: (bounds.maxY - bounds.minY) - 2 * margin,
                corners: [
                    [x, bounds.minY + margin],
                    [x, bounds.maxY - margin],
                    [x + this.corridorWidth, bounds.maxY - margin],
                    [x + this.corridorWidth, bounds.minY + margin]
                ]
            });
        }

        return corridors;
    }

    /**
     * Check if there's space for a perimeter corridor
     * @param {string} side - 'top', 'bottom', 'left', or 'right'
     * @param {number} margin - Margin from edge
     * @returns {boolean} True if space available
     */
    checkSpaceForPerimeter(side, margin) {
        const bounds = this.bounds;
        const threshold = margin + this.corridorWidth + 0.5;

        for (const ilot of this.ilots) {
            switch (side) {
                case 'top':
                    if (ilot.y + ilot.height > bounds.maxY - threshold) return false;
                    break;
                case 'bottom':
                    if (ilot.y < bounds.minY + threshold) return false;
                    break;
                case 'left':
                    if (ilot.x < bounds.minX + threshold) return false;
                    break;
                case 'right':
                    if (ilot.x + ilot.width > bounds.maxX - threshold) return false;
                    break;
            }
        }
        return true;
    }

    /**
     * Connect corridor segments into continuous paths
     * @param {Array} corridors - Array of corridor segments
     * @returns {Array} Connected corridor paths
     */
    connectCorridorPaths(corridors) {
        // For now, return corridors as-is with proper corner structure
        // Future enhancement: merge adjacent corridors into single paths
        return corridors.map(corridor => ({
            ...corridor,
            // Ensure corners are in correct format for rendering
            corners: corridor.corners || this.rectangleToCorners(corridor)
        }));
    }

    /**
     * Convert rectangle corridor to corner points
     * @param {Object} corridor - Corridor with x, y, width, height
     * @returns {Array} Array of corner points
     */
    rectangleToCorners(corridor) {
        return [
            [corridor.x, corridor.y],
            [corridor.x + corridor.width, corridor.y],
            [corridor.x + corridor.width, corridor.y + corridor.height],
            [corridor.x, corridor.y + corridor.height]
        ];
    }

    /**
     * Group îlots by rows (similar Y coordinates)
     * @returns {Array} Array of row groups
     */
    groupIlotsByRows() {
        const rows = {};
        const tolerance = 1.0;

        this.ilots.forEach(ilot => {
            const pos = ilot.y;
            let foundKey = null;

            for (const key of Object.keys(rows)) {
                if (Math.abs(Number(key) - pos) < tolerance) {
                    foundKey = key;
                    break;
                }
            }

            if (foundKey !== null) {
                rows[foundKey].push(ilot);
            } else {
                rows[pos] = [ilot];
            }
        });

        return Object.values(rows);
    }

    /**
     * Group îlots by columns (similar X coordinates)
     * @returns {Array} Array of column groups
     */
    groupIlotsByColumns() {
        const columns = {};
        const tolerance = 1.0;

        this.ilots.forEach(ilot => {
            const pos = ilot.x;
            let foundKey = null;

            for (const key of Object.keys(columns)) {
                if (Math.abs(Number(key) - pos) < tolerance) {
                    foundKey = key;
                    break;
                }
            }

            if (foundKey !== null) {
                columns[foundKey].push(ilot);
            } else {
                columns[pos] = [ilot];
            }
        });

        return Object.values(columns);
    }
}

module.exports = AdvancedCorridorNetworkGenerator;
