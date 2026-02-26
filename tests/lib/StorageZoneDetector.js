/**
 * StorageZoneDetector - Production-grade storage area detection
 * 
 * Identifies usable storage zones within floor plans by:
 * 1. Detecting large open areas bounded by walls
 * 2. Excluding forbidden zones (stairs, lifts, pillars)
 * 3. Respecting entrance clearance zones
 * 4. Using semantic layer information from DXF
 */

const GeometryHelpers = require('./geometryHelpers');

class StorageZoneDetector {
    constructor(options = {}) {
        this.minZoneArea = options.minZoneArea || 20; // Minimum 20m² for storage
        this.wallBuffer = options.wallBuffer || 0.3; // 0.3m clearance from walls
        this.entranceClearance = options.entranceClearance || 3.0; // 3m clear at entrances
        this.stairBuffer = options.stairBuffer || 2.0; // 2m buffer around stairs
        this.pillarBuffer = options.pillarBuffer || 0.5; // 0.5m around pillars
        this.gridResolution = options.gridResolution || 0.5; // 0.5m grid cells
    }

    /**
     * Detect storage zones from floor plan data
     * @param {Object} floorPlan - { walls, bounds, forbiddenZones, entrances }
     * @returns {Array} Array of storage zone polygons
     */
    detectZones(floorPlan) {
        const { walls, bounds, forbiddenZones, entrances } = floorPlan;

        console.log(`[StorageZoneDetector] Analyzing floor plan...`);
        console.log(`[StorageZoneDetector] Bounds: ${bounds.maxX - bounds.minX}m x ${bounds.maxY - bounds.minY}m`);
        console.log(`[StorageZoneDetector] Walls: ${walls?.length || 0}, Forbidden: ${forbiddenZones?.length || 0}`);

        // Build occupancy grid
        const grid = this._buildOccupancyGrid(bounds, walls, forbiddenZones, entrances);

        // Find connected open regions
        const regions = this._findConnectedRegions(grid);

        // Convert regions to polygons
        const zones = this._regionsToZones(regions, grid, bounds);

        console.log(`[StorageZoneDetector] Detected ${zones.length} storage zones`);

        return zones;
    }

    /**
     * Build occupancy grid marking walls, forbidden zones, etc.
     */
    _buildOccupancyGrid(bounds, walls, forbiddenZones, entrances) {
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const cols = Math.ceil(width / this.gridResolution);
        const rows = Math.ceil(height / this.gridResolution);

        // Initialize grid: 0 = open, 1 = wall, 2 = forbidden, 3 = entrance
        const grid = {
            cells: new Uint8Array(cols * rows),
            cols,
            rows,
            resolution: this.gridResolution,
            originX: bounds.minX,
            originY: bounds.minY
        };

        // Mark walls with buffer
        if (walls && walls.length > 0) {
            this._markWallsOnGrid(grid, walls);
        }

        // Mark forbidden zones (stairs, lifts)
        if (forbiddenZones && forbiddenZones.length > 0) {
            this._markForbiddenOnGrid(grid, forbiddenZones);
        }

        // Mark entrance clearance zones
        if (entrances && entrances.length > 0) {
            this._markEntrancesOnGrid(grid, entrances);
        }

        return grid;
    }

    /**
     * Mark walls on grid with buffer zone
     */
    _markWallsOnGrid(grid, walls) {
        const bufferCells = Math.ceil(this.wallBuffer / grid.resolution);

        for (const wall of walls) {
            if (!wall.start || !wall.end) continue;

            // Rasterize wall line to grid
            const cells = this._rasterizeLine(
                wall.start.x, wall.start.y,
                wall.end.x, wall.end.y,
                grid
            );

            // Mark wall cells and buffer
            for (const cell of cells) {
                this._markCellWithBuffer(grid, cell.col, cell.row, 1, bufferCells);
            }
        }
    }

    /**
     * Mark forbidden zones on grid with buffer
     */
    _markForbiddenOnGrid(grid, forbiddenZones) {
        const bufferCells = Math.ceil(this.stairBuffer / grid.resolution);

        for (const zone of forbiddenZones) {
            const bounds = this._getZoneBounds(zone);
            if (!bounds) continue;

            // Mark all cells in zone bounds + buffer
            const minCol = Math.max(0, Math.floor((bounds.minX - grid.originX) / grid.resolution) - bufferCells);
            const maxCol = Math.min(grid.cols - 1, Math.ceil((bounds.maxX - grid.originX) / grid.resolution) + bufferCells);
            const minRow = Math.max(0, Math.floor((bounds.minY - grid.originY) / grid.resolution) - bufferCells);
            const maxRow = Math.min(grid.rows - 1, Math.ceil((bounds.maxY - grid.originY) / grid.resolution) + bufferCells);

            for (let row = minRow; row <= maxRow; row++) {
                for (let col = minCol; col <= maxCol; col++) {
                    const idx = row * grid.cols + col;
                    if (grid.cells[idx] === 0) {
                        grid.cells[idx] = 2; // Forbidden
                    }
                }
            }
        }
    }

    /**
     * Mark entrance clearance zones
     */
    _markEntrancesOnGrid(grid, entrances) {
        const clearanceCells = Math.ceil(this.entranceClearance / grid.resolution);

        for (const entrance of entrances) {
            const bounds = this._getZoneBounds(entrance);
            if (!bounds) continue;

            // Mark entrance area + clearance
            const minCol = Math.max(0, Math.floor((bounds.minX - grid.originX) / grid.resolution) - clearanceCells);
            const maxCol = Math.min(grid.cols - 1, Math.ceil((bounds.maxX - grid.originX) / grid.resolution) + clearanceCells);
            const minRow = Math.max(0, Math.floor((bounds.minY - grid.originY) / grid.resolution) - clearanceCells);
            const maxRow = Math.min(grid.rows - 1, Math.ceil((bounds.maxY - grid.originY) / grid.resolution) + clearanceCells);

            for (let row = minRow; row <= maxRow; row++) {
                for (let col = minCol; col <= maxCol; col++) {
                    const idx = row * grid.cols + col;
                    if (grid.cells[idx] === 0) {
                        grid.cells[idx] = 3; // Entrance clearance
                    }
                }
            }
        }
    }

    /**
     * Find connected open regions using flood fill
     */
    _findConnectedRegions(grid) {
        const visited = new Uint8Array(grid.cols * grid.rows);
        const regions = [];

        for (let row = 0; row < grid.rows; row++) {
            for (let col = 0; col < grid.cols; col++) {
                const idx = row * grid.cols + col;

                // Skip if visited or not open
                if (visited[idx] || grid.cells[idx] !== 0) continue;

                // Flood fill to find connected region
                const region = this._floodFill(grid, visited, col, row);

                // Only keep regions above minimum area
                const area = region.length * grid.resolution * grid.resolution;
                if (area >= this.minZoneArea) {
                    regions.push({
                        cells: region,
                        area: area
                    });
                }
            }
        }

        // Sort by area (largest first)
        regions.sort((a, b) => b.area - a.area);

        return regions;
    }

    /**
     * Flood fill to find connected open cells
     */
    _floodFill(grid, visited, startCol, startRow) {
        const region = [];
        const stack = [{ col: startCol, row: startRow }];

        while (stack.length > 0) {
            const { col, row } = stack.pop();
            const idx = row * grid.cols + col;

            // Skip if out of bounds, visited, or not open
            if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue;
            if (visited[idx] || grid.cells[idx] !== 0) continue;

            // Mark visited and add to region
            visited[idx] = 1;
            region.push({ col, row });

            // Add neighbors (4-connected)
            stack.push({ col: col + 1, row });
            stack.push({ col: col - 1, row });
            stack.push({ col, row: row + 1 });
            stack.push({ col, row: row - 1 });
        }

        return region;
    }

    /**
     * Convert grid regions to zone polygons
     */
    _regionsToZones(regions, grid, bounds) {
        const zones = [];

        for (let i = 0; i < regions.length; i++) {
            const region = regions[i];

            // Get bounding box of region
            let minCol = Infinity, maxCol = -Infinity;
            let minRow = Infinity, maxRow = -Infinity;

            for (const cell of region.cells) {
                minCol = Math.min(minCol, cell.col);
                maxCol = Math.max(maxCol, cell.col);
                minRow = Math.min(minRow, cell.row);
                maxRow = Math.max(maxRow, cell.row);
            }

            // Convert to world coordinates
            const zoneBounds = {
                minX: grid.originX + minCol * grid.resolution,
                maxX: grid.originX + (maxCol + 1) * grid.resolution,
                minY: grid.originY + minRow * grid.resolution,
                maxY: grid.originY + (maxRow + 1) * grid.resolution
            };

            // Create simplified rectangular polygon
            const polygon = [
                [zoneBounds.minX, zoneBounds.minY],
                [zoneBounds.maxX, zoneBounds.minY],
                [zoneBounds.maxX, zoneBounds.maxY],
                [zoneBounds.minX, zoneBounds.maxY]
            ];

            zones.push({
                id: `storage_zone_${i + 1}`,
                type: 'storage',
                polygon: polygon,
                bounds: zoneBounds,
                area: region.area,
                cellCount: region.cells.length,
                cells: region.cells // Keep for detailed placement
            });
        }

        return zones;
    }

    /**
     * Rasterize a line to grid cells using Bresenham's algorithm
     */
    _rasterizeLine(x1, y1, x2, y2, grid) {
        const cells = [];

        // Convert to grid coordinates
        const col1 = Math.floor((x1 - grid.originX) / grid.resolution);
        const row1 = Math.floor((y1 - grid.originY) / grid.resolution);
        const col2 = Math.floor((x2 - grid.originX) / grid.resolution);
        const row2 = Math.floor((y2 - grid.originY) / grid.resolution);

        // Bresenham's line algorithm
        let col = col1, row = row1;
        const dCol = Math.abs(col2 - col1);
        const dRow = Math.abs(row2 - row1);
        const sCol = col1 < col2 ? 1 : -1;
        const sRow = row1 < row2 ? 1 : -1;
        let err = dCol - dRow;

        while (true) {
            if (col >= 0 && col < grid.cols && row >= 0 && row < grid.rows) {
                cells.push({ col, row });
            }

            if (col === col2 && row === row2) break;

            const e2 = 2 * err;
            if (e2 > -dRow) {
                err -= dRow;
                col += sCol;
            }
            if (e2 < dCol) {
                err += dCol;
                row += sRow;
            }
        }

        return cells;
    }

    /**
     * Mark cell and buffer around it
     */
    _markCellWithBuffer(grid, col, row, value, buffer) {
        for (let dr = -buffer; dr <= buffer; dr++) {
            for (let dc = -buffer; dc <= buffer; dc++) {
                const c = col + dc;
                const r = row + dr;

                if (c >= 0 && c < grid.cols && r >= 0 && r < grid.rows) {
                    const idx = r * grid.cols + c;
                    if (grid.cells[idx] === 0) {
                        grid.cells[idx] = value;
                    }
                }
            }
        }
    }

    /**
     * Get bounds from zone (polygon or bounds)
     */
    _getZoneBounds(zone) {
        if (zone.bounds) return zone.bounds;

        if (zone.polygon && zone.polygon.length > 0) {
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;

            for (const pt of zone.polygon) {
                const x = Array.isArray(pt) ? pt[0] : pt.x;
                const y = Array.isArray(pt) ? pt[1] : pt.y;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }

            return { minX, maxX, minY, maxY };
        }

        if (zone.x !== undefined && zone.width !== undefined) {
            return {
                minX: zone.x,
                maxX: zone.x + zone.width,
                minY: zone.y,
                maxY: zone.y + zone.height
            };
        }

        return null;
    }
}

module.exports = StorageZoneDetector;
