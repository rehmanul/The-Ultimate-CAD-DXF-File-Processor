/**
 * COSTOLayoutEngine - Production Storage Unit Placement
 * 
 * COSTO Standard Row-Based Layout (matching reference architectural output):
 * - Zone-aware placement: walls burned into occupancy grid to detect placeable regions
 * - Back-to-back rows with shared partition (Tole Grise)
 * - Access corridors every 2 rows
 * - Red zigzag radiators along perimeter walls
 * - Blue dashed circulation lines with directional arrows
 * - Per-unit wall collision validation as safety net
 */

const ComplianceSolver = require('./ComplianceSolver');

class COSTOLayoutEngine {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = floorPlan.bounds;
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];

        // COSTO Standard Unit Sizes (width x depth in meters)
        this.unitTypes = [
            { type: 'XS', width: 1.0, height: 1.5, area: 1.5 },
            { type: 'S', width: 1.5, height: 2.0, area: 3.0 },
            { type: 'M', width: 2.0, height: 2.5, area: 5.0 },
            { type: 'L', width: 2.5, height: 3.0, area: 7.5 },
            { type: 'XL', width: 3.0, height: 3.5, area: 10.5 }
        ];

        // Layout parameters - COSTO standard
        this.mainCorridorWidth = options.mainCorridorWidth || 1.5;
        this.accessCorridorWidth = options.accessCorridorWidth || 1.2;
        this.wallClearance = options.wallClearance || 0.3;
        this.unitDepth = options.unitDepth || 2.5;
        this.unitSpacing = options.unitSpacing || 0.05;

        // Radiator geometry
        this.radiatorAmplitude = options.radiatorAmplitude || 0.15;
        this.radiatorWavelength = options.radiatorWavelength || 0.4;
        this.radiatorOffset = options.radiatorOffset || 0.25;

        // Grid resolution for zone detection (meters)
        this.gridSize = options.gridSize || 0.5;

        // State
        this.units = [];
        this.corridors = [];
        this.radiators = [];
        this.circulationPaths = [];
        this.rowClusters = [];
    }

    // ════════════════════════════════════════════════════════════════════
    //  MAIN ENTRY POINT
    // ════════════════════════════════════════════════════════════════════

    generateLayout(config = {}) {
        console.log(`[COSTOLayoutEngine] Starting layout with zone-aware placement`);

        this.units = [];
        this.corridors = [];
        this.radiators = [];
        this.circulationPaths = [];
        this.rowClusters = [];
        this.config = config;

        const targetCount = config.targetCount || 100;

        // Step 1: Detect placeable zones (respects walls, forbidden zones, obstacles)
        const zones = this._detectPlaceableZones();
        console.log(`[COSTOLayoutEngine] Detected ${zones.length} placeable zones`);

        // Step 2: Generate cluster grid within each zone
        for (const zone of zones) {
            const zoneArea = (zone.maxX - zone.minX) * (zone.maxY - zone.minY);
            if (zoneArea < 4.0) continue; // Skip tiny zones
            this._generateDenseClusterGrid(zone);
        }
        console.log(`[COSTOLayoutEngine] Created ${this.rowClusters.length} clusters across ${zones.length} zones`);

        // Step 3: Fill clusters — wall collision filters bad placements
        this._fillRowsWithUnits(targetCount);
        console.log(`[COSTOLayoutEngine] Placed ${this.units.length} units in ${this.rowClusters.length} clusters`);

        // Step 4: Generate corridors
        this._generateCorridors(zones);

        // Step 5: Generate radiators along perimeter walls
        this.radiators = this._generateWallRadiators();

        // Step 6: Generate circulation paths
        this.circulationPaths = this._buildCirculationPaths();

        // Step 7: Compliance validation
        const compliance = new ComplianceSolver().validate({
            boxes: this.units,
            corridors: this.corridors,
            walls: this.walls,
            entrances: this.entrances,
            bounds: this.bounds
        });

        console.log(`[COSTOLayoutEngine] Compliance: ${compliance.score}%`);
        console.log(`[COSTOLayoutEngine] Radiators: ${this.radiators.length}, Circulation paths: ${this.circulationPaths.length}`);

        return {
            units: this.units,
            corridors: this.corridors,
            radiators: this.radiators,
            circulationPaths: this.circulationPaths,
            compliance,
            stats: {
                placedCount: this.units.length,
                targetCount,
                corridorCount: this.corridors.length,
                clusterCount: this.rowClusters.length,
                radiatorCount: this.radiators.length,
                circulationPathCount: this.circulationPaths.length
            }
        };
    }

    /**
     * Generate a dense grid of row clusters across the full floor bounds.
     * Clusters are placed in a regular grid pattern. Individual units within
     * clusters that overlap walls are rejected by _unitOverlapsWalls.
     */
    _generateDenseClusterGrid(fullZone) {
        const rowDepth = this.unitDepth;
        const clusterWidth = rowDepth * 2; // Two rows back-to-back
        const corridorWidth = this.accessCorridorWidth;

        const zoneWidth = fullZone.maxX - fullZone.minX;
        const zoneHeight = fullZone.maxY - fullZone.minY;

        // How many clusters fit horizontally
        const totalClusterWidth = clusterWidth + corridorWidth;
        const availableWidth = zoneWidth - this.mainCorridorWidth;
        const numCols = Math.max(1, Math.floor(availableWidth / totalClusterWidth));

        // How many cluster rows fit vertically (each row = cluster height + cross corridor)
        const clusterRowHeight = 8.0; // ~8m per vertical segment (fits ~4-5 units)
        const crossCorridorHeight = corridorWidth;
        const numRows = Math.max(1, Math.floor(zoneHeight / (clusterRowHeight + crossCorridorHeight)));

        console.log(`[COSTOLayoutEngine] Dense grid: ${numCols} cols × ${numRows} rows = ${numCols * numRows} potential clusters`);

        for (let row = 0; row < numRows; row++) {
            const segStartY = fullZone.minY + row * (clusterRowHeight + crossCorridorHeight) + crossCorridorHeight * 0.5;
            const segEndY = Math.min(segStartY + clusterRowHeight, fullZone.maxY - crossCorridorHeight * 0.5);

            if (segEndY - segStartY < 2.0) continue; // Skip if too thin

            let currentX = fullZone.minX + this.mainCorridorWidth;

            for (let col = 0; col < numCols; col++) {
                const clusterStartX = currentX;
                const clusterEndX = clusterStartX + clusterWidth;

                if (clusterEndX > fullZone.maxX + 0.01) break;

                // Don't check forbidden zones at cluster level — let unit-level wall check handle it
                this.rowClusters.push({
                    id: `cluster_${this.rowClusters.length}`,
                    startX: clusterStartX,
                    endX: clusterEndX,
                    startY: segStartY,
                    endY: segEndY,
                    centerX: (clusterStartX + clusterEndX) / 2,
                    zone: fullZone
                });

                currentX = clusterEndX + corridorWidth;
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════
    //  ZONE DETECTION — Occupancy Grid Approach
    // ════════════════════════════════════════════════════════════════════

    /**
     * Detect placeable zones by burning walls into an occupancy grid,
     * then extracting large wall-free rectangular regions.
     */
    _detectPlaceableZones() {
        const b = this.bounds;
        const gs = this.gridSize;
        const clearance = this.wallClearance;

        const width = b.maxX - b.minX;
        const height = b.maxY - b.minY;
        const cols = Math.ceil(width / gs);
        const rows = Math.ceil(height / gs);

        if (cols <= 0 || rows <= 0) {
            return [{ minX: b.minX + clearance, minY: b.minY + clearance, maxX: b.maxX - clearance, maxY: b.maxY - clearance }];
        }

        // Create occupancy grid (false = free, true = blocked)
        const grid = Array.from({ length: rows }, () => new Array(cols).fill(false));

        // Burn perimeter clearance
        const perimCells = Math.ceil(clearance / gs);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (r < perimCells || r >= rows - perimCells || c < perimCells || c >= cols - perimCells) {
                    grid[r][c] = true;
                }
            }
        }

        // Burn walls into the grid with clearance buffer
        const wallBuffer = Math.max(1, Math.ceil((clearance + 0.1) / gs)); // Extra 10cm buffer
        for (const wall of this.walls) {
            const seg = this._extractWallSegment(wall);
            if (!seg) continue;

            const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
            if (length < 0.3) continue; // Skip tiny segments

            // Check if this is a perimeter wall (we already handled perimeter)
            if (this._isPerimeterWall(seg)) continue;

            // Rasterize wall line into grid cells with buffer
            const steps = Math.max(2, Math.ceil(length / (gs * 0.5)));
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const px = seg.x1 + (seg.x2 - seg.x1) * t;
                const py = seg.y1 + (seg.y2 - seg.y1) * t;
                const gc = Math.floor((px - b.minX) / gs);
                const gr = Math.floor((py - b.minY) / gs);

                // Mark cells in a buffer radius
                for (let dr = -wallBuffer; dr <= wallBuffer; dr++) {
                    for (let dc = -wallBuffer; dc <= wallBuffer; dc++) {
                        const nr = gr + dr;
                        const nc = gc + dc;
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                            grid[nr][nc] = true;
                        }
                    }
                }
            }
        }

        // Burn forbidden zones into grid
        for (const fz of this.forbiddenZones) {
            const fzBounds = this._getZoneBounds(fz);
            if (!fzBounds) continue;

            const fzBuffer = Math.ceil(1.0 / gs); // 1m clearance around forbidden zones
            const c1 = Math.floor((fzBounds.minX - b.minX) / gs) - fzBuffer;
            const c2 = Math.ceil((fzBounds.maxX - b.minX) / gs) + fzBuffer;
            const r1 = Math.floor((fzBounds.minY - b.minY) / gs) - fzBuffer;
            const r2 = Math.ceil((fzBounds.maxY - b.minY) / gs) + fzBuffer;

            for (let r = Math.max(0, r1); r < Math.min(rows, r2); r++) {
                for (let c = Math.max(0, c1); c < Math.min(cols, c2); c++) {
                    grid[r][c] = true;
                }
            }
        }

        // Burn entrances into grid (doors need clearance)
        for (const ent of this.entrances) {
            const ex = ent.x !== undefined ? ent.x : (ent.start ? ent.start.x : 0);
            const ey = ent.y !== undefined ? ent.y : (ent.start ? ent.start.y : 0);
            const ew = ent.width || 2.0;
            const eh = ent.height || 2.0;
            const entBuffer = Math.ceil(1.5 / gs); // 1.5m clearance around entrances

            const c1 = Math.floor((ex - b.minX) / gs) - entBuffer;
            const c2 = Math.ceil((ex + ew - b.minX) / gs) + entBuffer;
            const r1 = Math.floor((ey - b.minY) / gs) - entBuffer;
            const r2 = Math.ceil((ey + eh - b.minY) / gs) + entBuffer;

            for (let r = Math.max(0, r1); r < Math.min(rows, r2); r++) {
                for (let c = Math.max(0, c1); c < Math.min(cols, c2); c++) {
                    grid[r][c] = true;
                }
            }
        }

        // Burn entities/obstacles from floor plan (columns, stairs, elevators, etc.)
        const entities = this.floorPlan.entities || [];
        for (const entity of entities) {
            if (!entity || entity.type === 'wall') continue; // walls already handled
            const ex = entity.x !== undefined ? entity.x : (entity.bounds ? entity.bounds.minX : undefined);
            const ey = entity.y !== undefined ? entity.y : (entity.bounds ? entity.bounds.minY : undefined);
            const ew = entity.width || (entity.bounds ? entity.bounds.maxX - entity.bounds.minX : 0);
            const eh = entity.height || (entity.bounds ? entity.bounds.maxY - entity.bounds.minY : 0);
            if (ex === undefined || ey === undefined || ew <= 0 || eh <= 0) continue;

            const entBuffer = Math.ceil(0.5 / gs); // 0.5m clearance around entities
            const c1 = Math.floor((ex - b.minX) / gs) - entBuffer;
            const c2 = Math.ceil((ex + ew - b.minX) / gs) + entBuffer;
            const r1 = Math.floor((ey - b.minY) / gs) - entBuffer;
            const r2 = Math.ceil((ey + eh - b.minY) / gs) + entBuffer;

            for (let r = Math.max(0, r1); r < Math.min(rows, r2); r++) {
                for (let c = Math.max(0, c1); c < Math.min(cols, c2); c++) {
                    grid[r][c] = true;
                }
            }
        }

        // Extract large rectangular zones using maximal rectangle algorithm
        const zones = this._extractRectangularZones(grid, rows, cols, b, gs);

        // If no zones found, fall back to simple inset bounds
        if (zones.length === 0) {
            console.log('[COSTOLayoutEngine] No zones detected, using inset bounds fallback');
            return [{
                minX: b.minX + clearance,
                minY: b.minY + clearance,
                maxX: b.maxX - clearance,
                maxY: b.maxY - clearance
            }];
        }

        return zones;
    }

    /**
     * Extract large wall-free rectangular regions from the occupancy grid.
     * Uses a greedy algorithm to find the largest free rectangles.
     */
    _extractRectangularZones(grid, rows, cols, bounds, gs) {
        const zones = [];
        const used = Array.from({ length: rows }, () => new Array(cols).fill(false));

        // Minimum zone size: 2m x 2m (lower threshold to capture more usable space)
        const minZoneCells = Math.ceil(2.0 / gs);

        // Greedy: scan for the largest available rectangle, mark it, repeat
        for (let pass = 0; pass < 100; pass++) {
            let bestRect = null;
            let bestArea = 0;

            // Try starting rectangles from each free cell
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (grid[r][c] || used[r][c]) continue;

                    // Expand rightward then downward
                    let maxC = cols;
                    for (let dr = r; dr < rows; dr++) {
                        // Find how far right we can go on this row
                        let rightLimit = maxC;
                        for (let dc = c; dc < maxC; dc++) {
                            if (grid[dr][dc] || used[dr][dc]) {
                                rightLimit = dc;
                                break;
                            }
                        }
                        maxC = rightLimit;
                        if (maxC <= c) break;

                        const rectW = maxC - c;
                        const rectH = dr - r + 1;

                        if (rectW >= minZoneCells && rectH >= minZoneCells) {
                            const area = rectW * rectH;
                            if (area > bestArea) {
                                bestArea = area;
                                bestRect = { r, c, h: rectH, w: rectW };
                            }
                        }
                    }
                }
            }

            if (!bestRect || bestArea < minZoneCells * minZoneCells) break;

            // Mark cells as used
            for (let dr = bestRect.r; dr < bestRect.r + bestRect.h; dr++) {
                for (let dc = bestRect.c; dc < bestRect.c + bestRect.w; dc++) {
                    used[dr][dc] = true;
                }
            }

            // Convert grid coords to world coords
            zones.push({
                minX: bounds.minX + bestRect.c * gs,
                minY: bounds.minY + bestRect.r * gs,
                maxX: bounds.minX + (bestRect.c + bestRect.w) * gs,
                maxY: bounds.minY + (bestRect.r + bestRect.h) * gs
            });
        }

        // Sort zones by area (largest first)
        zones.sort((a, b) => {
            const aArea = (a.maxX - a.minX) * (a.maxY - a.minY);
            const bArea = (b.maxX - b.minX) * (b.maxY - b.minY);
            return bArea - aArea;
        });

        console.log(`[COSTOLayoutEngine] Extracted ${zones.length} rectangular zones`);
        return zones;
    }

    // ════════════════════════════════════════════════════════════════════
    //  ROW CLUSTER GENERATION (per zone)
    // ════════════════════════════════════════════════════════════════════

    /**
     * Generate row clusters within a single zone.
     * Each cluster = 2 back-to-back rows sharing a partition wall.
     */
    _generateRowClustersInZone(zone) {
        const zoneWidth = zone.maxX - zone.minX;
        const zoneHeight = zone.maxY - zone.minY;

        // Skip zones too small for even one cluster
        if (zoneWidth < this.unitDepth * 2 + this.accessCorridorWidth || zoneHeight < 2.0) {
            return;
        }

        const rowDepth = this.unitDepth;
        const clusterWidth = rowDepth * 2; // Two rows back-to-back
        const corridorWidth = this.accessCorridorWidth;

        // Calculate how many clusters fit horizontally in this zone
        const totalClusterWidth = clusterWidth + corridorWidth;
        const availableWidth = zoneWidth - this.mainCorridorWidth;
        const numClusters = Math.max(1, Math.floor(availableWidth / totalClusterWidth));

        let currentX = zone.minX + this.mainCorridorWidth;

        for (let i = 0; i < numClusters; i++) {
            const clusterStartX = currentX;
            const clusterEndX = clusterStartX + clusterWidth;

            // Ensure cluster doesn't exceed zone
            if (clusterEndX > zone.maxX) break;

            // Verify this cluster doesn't overlap forbidden zones
            if (!this._clusterOverlapsForbidden(clusterStartX, clusterEndX, zone.minY, zone.maxY)) {
                this.rowClusters.push({
                    id: `cluster_${this.rowClusters.length}`,
                    startX: clusterStartX,
                    endX: clusterEndX,
                    startY: zone.minY + corridorWidth * 0.5,
                    endY: zone.maxY - corridorWidth * 0.5,
                    centerX: (clusterStartX + clusterEndX) / 2,
                    zone: zone
                });
            }

            currentX = clusterEndX + corridorWidth;
        }
    }

    // ════════════════════════════════════════════════════════════════════
    //  FILL ROWS WITH UNITS
    // ════════════════════════════════════════════════════════════════════

    _fillRowsWithUnits(targetCount) {
        if (this.rowClusters.length === 0) return;

        // Fill ALL clusters to full capacity — don't cap at targetCount.
        // This maximizes area coverage: every cluster fills both rows completely.
        let totalPlaced = 0;

        for (const cluster of this.rowClusters) {
            // Calculate how many units can fit vertically in this cluster
            const clusterHeight = cluster.endY - cluster.startY;
            const avgUnitWidth = 1.5; // average unit front width
            const maxUnitsPerRow = Math.ceil(clusterHeight / (avgUnitWidth + this.unitSpacing));
            const maxUnits = maxUnitsPerRow * 2; // two rows per cluster

            const clusterUnits = this._fillCluster(cluster, maxUnits, totalPlaced);
            this.units.push(...clusterUnits);
            totalPlaced += clusterUnits.length;
        }

        console.log(`[COSTOLayoutEngine] Filled ${this.rowClusters.length} clusters with ${totalPlaced} total units`);
    }

    /**
     * Fill a single cluster with units (2 back-to-back rows).
     * Each unit is checked against walls before placement.
     */
    _fillCluster(cluster, maxUnits, startId) {
        const units = [];
        const unitSizes = this._selectUnitSizes(maxUnits);
        let attempted = 0;
        let rejectedWall = 0;
        let rejectedForbidden = 0;

        let currentY = cluster.startY;

        for (const size of unitSizes) {
            if (units.length >= maxUnits) break;
            if (currentY + size.width > cluster.endY) break;

            // LEFT row unit (facing center)
            const leftUnit = {
                id: `unit_${startId + units.length}`,
                type: size.type,
                x: cluster.startX,
                y: currentY,
                width: this.unitDepth,
                height: size.width,
                area: size.area,
                label: `${size.area}m²`,
                clusterId: cluster.id,
                row: 'left',
                partitionType: 'toleGrise'
            };

            attempted++;
            if (this._unitOverlapsWalls(leftUnit)) {
                rejectedWall++;
            } else if (this._unitOverlapsForbidden(leftUnit)) {
                rejectedForbidden++;
            } else {
                units.push(leftUnit);
            }

            // RIGHT row unit (facing center, mirrored)
            if (units.length < maxUnits) {
                const rightUnit = {
                    id: `unit_${startId + units.length}`,
                    type: size.type,
                    x: cluster.centerX,
                    y: currentY,
                    width: this.unitDepth,
                    height: size.width,
                    area: size.area,
                    label: `${size.area}m²`,
                    clusterId: cluster.id,
                    row: 'right',
                    partitionType: 'toleGrise'
                };

                attempted++;
                if (this._unitOverlapsWalls(rightUnit)) {
                    rejectedWall++;
                } else if (this._unitOverlapsForbidden(rightUnit)) {
                    rejectedForbidden++;
                } else {
                    units.push(rightUnit);
                }
            }

            currentY += size.width + this.unitSpacing;
        }

        if (rejectedWall > 0 || rejectedForbidden > 0) {
            console.log(`[Cluster ${cluster.id}] attempted=${attempted} placed=${units.length} rejectedWall=${rejectedWall} rejectedForbidden=${rejectedForbidden} x=[${cluster.startX.toFixed(1)},${cluster.endX.toFixed(1)}] y=[${cluster.startY.toFixed(1)},${cluster.endY.toFixed(1)}]`);
        }

        return units;
    }

    /**
     * Select a mix of unit sizes based on typical COSTO distribution.
     */
    _selectUnitSizes(count) {
        const sizes = [];
        const distribution = this.config?.distribution || { XS: 10, S: 25, M: 35, L: 20, XL: 10 };

        const total = Object.values(distribution).reduce((s, v) => s + v, 0);

        for (let i = 0; i < count; i++) {
            let rand = Math.random() * total;
            let selectedType = this.unitTypes[2]; // Default M

            for (const ut of this.unitTypes) {
                const weight = distribution[ut.type] || 0;
                rand -= weight;
                if (rand <= 0) {
                    selectedType = ut;
                    break;
                }
            }

            sizes.push({
                type: selectedType.type,
                width: selectedType.width,
                height: selectedType.height,
                area: selectedType.area
            });
        }

        return sizes;
    }

    // ════════════════════════════════════════════════════════════════════
    //  CORRIDOR GENERATION
    // ════════════════════════════════════════════════════════════════════

    _generateCorridors(zones) {
        // Only generate corridors for zones that have clusters with placed units
        const zonesWithUnits = new Set();
        for (const unit of this.units) {
            if (unit.clusterId) {
                const cluster = this.rowClusters.find(c => c.id === unit.clusterId);
                if (cluster && cluster.zone) {
                    zonesWithUnits.add(`${cluster.zone.minX},${cluster.zone.minY}`);
                }
            }
        }

        // Access corridors between clusters that have units
        const clustersByZone = new Map();
        for (const cluster of this.rowClusters) {
            // Only include clusters that have placed units
            const hasUnits = this.units.some(u => u.clusterId === cluster.id);
            if (!hasUnits) continue;

            const zoneKey = `${cluster.zone.minX},${cluster.zone.minY}`;
            if (!clustersByZone.has(zoneKey)) clustersByZone.set(zoneKey, []);
            clustersByZone.get(zoneKey).push(cluster);
        }

        for (const [zoneKey, clusters] of clustersByZone) {
            if (clusters.length < 2) continue; // Need at least 2 clusters for access corridors

            // Sort clusters by X position
            clusters.sort((a, b) => a.startX - b.startX);

            for (let i = 0; i < clusters.length - 1; i++) {
                const current = clusters[i];
                const next = clusters[i + 1];
                const gapWidth = next.startX - current.endX;

                // Only create access corridor if there's a real gap between clusters
                if (gapWidth > 0.5) {
                    this.corridors.push({
                        id: `access_corridor_${this.corridors.length}`,
                        type: 'ACCESS',
                        direction: 'vertical',
                        x: current.endX,
                        y: Math.min(current.startY, next.startY),
                        width: gapWidth,
                        height: Math.max(current.endY, next.endY) - Math.min(current.startY, next.startY)
                    });
                }
            }

            // One horizontal cross-corridor per zone group (between top and bottom of clusters)
            const allMinY = Math.min(...clusters.map(c => c.startY));
            const allMaxY = Math.max(...clusters.map(c => c.endY));
            const allMinX = Math.min(...clusters.map(c => c.startX));
            const allMaxX = Math.max(...clusters.map(c => c.endX));

            // Only add cross corridor if zone is wide enough
            if (allMaxX - allMinX > 5) {
                this.corridors.push({
                    id: `cross_${this.corridors.length}`,
                    type: 'CROSS',
                    direction: 'horizontal',
                    x: allMinX - this.mainCorridorWidth,
                    y: (allMinY + allMaxY) / 2 - this.accessCorridorWidth / 2,
                    width: allMaxX - allMinX + this.mainCorridorWidth,
                    height: this.accessCorridorWidth
                });
            }
        }

        console.log(`[COSTOLayoutEngine] Generated ${this.corridors.length} corridors (from ${clustersByZone.size} active zones)`);
    }

    // ════════════════════════════════════════════════════════════════════
    //  RADIATOR GENERATION (ported from COSTOLayoutPlacer)
    // ════════════════════════════════════════════════════════════════════

    /**
     * Generate zigzag radiator polylines along perimeter wall segments.
     * Red zigzag lines matching the COSTO reference output.
     */
    _generateWallRadiators() {
        const radiators = [];
        const b = this.bounds;
        const centerX = (b.minX + b.maxX) / 2;
        const centerY = (b.minY + b.maxY) / 2;

        // Step 1: Detect perimeter wall segments
        const candidateSegments = this._detectPerimeterWalls();

        // Step 2: Merge collinear segments for continuous radiators
        const mergedSegments = this._mergeCollinearSegments(candidateSegments);

        console.log(`[Radiator] Detected ${candidateSegments.length} wall segments, merged to ${mergedSegments.length}`);

        // Step 3: Generate radiators for each merged segment
        for (const seg of mergedSegments) {
            const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
            if (length < 1.0) continue;

            // Compute inward normal direction (toward floor center)
            const midX = (seg.x1 + seg.x2) / 2;
            const midY = (seg.y1 + seg.y2) / 2;
            const dx = seg.x2 - seg.x1;
            const dy = seg.y2 - seg.y1;
            const len = Math.hypot(dx, dy);

            const n1x = -dy / len;
            const n1y = dx / len;

            const dot1 = n1x * (centerX - midX) + n1y * (centerY - midY);
            const nx = dot1 >= 0 ? n1x : -n1x;
            const ny = dot1 >= 0 ? n1y : -n1y;

            const adaptiveWavelength = Math.min(this.radiatorWavelength, length / 5);
            const zigzag = this._createZigzagAlongSegment(
                seg.x1, seg.y1, seg.x2, seg.y2,
                nx, ny,
                this.radiatorOffset,
                this.radiatorAmplitude,
                adaptiveWavelength
            );

            if (zigzag.length >= 2) {
                radiators.push({
                    type: 'radiator',
                    wallSegment: { start: { x: seg.x1, y: seg.y1 }, end: { x: seg.x2, y: seg.y2 } },
                    path: zigzag,
                    amplitude: this.radiatorAmplitude,
                    wavelength: adaptiveWavelength,
                    color: 'red',
                    style: 'zigzag'
                });
            }
        }

        console.log(`[Radiator] Generated ${radiators.length} radiator polylines`);
        return radiators;
    }

    /**
     * Detect walls along the building perimeter.
     */
    _detectPerimeterWalls() {
        const b = this.bounds;
        const candidateSegments = [];
        const threshold = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08;

        if (this.walls.length > 0) {
            for (const wall of this.walls) {
                const seg = this._extractWallSegment(wall);
                if (!seg) continue;

                const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                if (length < 0.5) continue;

                const midX = (seg.x1 + seg.x2) / 2;
                const midY = (seg.y1 + seg.y2) / 2;

                const nearLeft = Math.abs(midX - b.minX) < threshold;
                const nearRight = Math.abs(midX - b.maxX) < threshold;
                const nearBottom = Math.abs(midY - b.minY) < threshold;
                const nearTop = Math.abs(midY - b.maxY) < threshold;

                if (nearLeft || nearRight || nearBottom || nearTop) {
                    candidateSegments.push({
                        x1: seg.x1, y1: seg.y1,
                        x2: seg.x2, y2: seg.y2,
                        source: 'wall_entity',
                        perimeter: nearLeft ? 'left' : nearRight ? 'right' : nearBottom ? 'bottom' : 'top'
                    });
                }
            }
        }

        // Fallback to boundary rectangle if insufficient walls
        if (candidateSegments.length < 4) {
            console.log('[Radiator] Using boundary rectangle fallback');
            candidateSegments.length = 0;
            candidateSegments.push(
                { x1: b.minX, y1: b.minY, x2: b.maxX, y2: b.minY, source: 'bounds', perimeter: 'bottom' },
                { x1: b.maxX, y1: b.minY, x2: b.maxX, y2: b.maxY, source: 'bounds', perimeter: 'right' },
                { x1: b.maxX, y1: b.maxY, x2: b.minX, y2: b.maxY, source: 'bounds', perimeter: 'top' },
                { x1: b.minX, y1: b.maxY, x2: b.minX, y2: b.minY, source: 'bounds', perimeter: 'left' }
            );
        }

        return candidateSegments;
    }

    /**
     * Merge collinear wall segments for continuous radiator runs.
     */
    _mergeCollinearSegments(segments) {
        if (segments.length === 0) return [];

        const merged = [];
        const used = new Set();

        for (let i = 0; i < segments.length; i++) {
            if (used.has(i)) continue;

            let current = { ...segments[i] };
            used.add(i);

            let foundMerge = true;
            while (foundMerge) {
                foundMerge = false;
                for (let j = 0; j < segments.length; j++) {
                    if (used.has(j)) continue;
                    if (this._areCollinear(current, segments[j]) && this._areAdjacent(current, segments[j])) {
                        current = this._extendSegment(current, segments[j]);
                        used.add(j);
                        foundMerge = true;
                    }
                }
            }
            merged.push(current);
        }

        return merged;
    }

    _areCollinear(seg1, seg2, tolerance = 0.1) {
        const angle1 = Math.atan2(seg1.y2 - seg1.y1, seg1.x2 - seg1.x1);
        const angle2 = Math.atan2(seg2.y2 - seg2.y1, seg2.x2 - seg2.x1);
        const angleDiff = Math.abs(angle1 - angle2);
        if (!(angleDiff < tolerance || Math.abs(angleDiff - Math.PI) < tolerance)) return false;

        const dx = seg1.x2 - seg1.x1;
        const dy = seg1.y2 - seg1.y1;
        const len = Math.hypot(dx, dy);
        if (len === 0) return false;

        const t = ((seg2.x1 - seg1.x1) * dx + (seg2.y1 - seg1.y1) * dy) / (len * len);
        const projX = seg1.x1 + t * dx;
        const projY = seg1.y1 + t * dy;
        return Math.hypot(seg2.x1 - projX, seg2.y1 - projY) < 0.2;
    }

    _areAdjacent(seg1, seg2, tolerance = 0.3) {
        const d11 = Math.hypot(seg1.x1 - seg2.x1, seg1.y1 - seg2.y1);
        const d12 = Math.hypot(seg1.x1 - seg2.x2, seg1.y1 - seg2.y2);
        const d21 = Math.hypot(seg1.x2 - seg2.x1, seg1.y2 - seg2.y1);
        const d22 = Math.hypot(seg1.x2 - seg2.x2, seg1.y2 - seg2.y2);
        return d11 < tolerance || d12 < tolerance || d21 < tolerance || d22 < tolerance;
    }

    _extendSegment(seg1, seg2) {
        const points = [
            { x: seg1.x1, y: seg1.y1 }, { x: seg1.x2, y: seg1.y2 },
            { x: seg2.x1, y: seg2.y1 }, { x: seg2.x2, y: seg2.y2 }
        ];

        let maxDist = 0, p1 = points[0], p2 = points[1];
        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                const dist = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
                if (dist > maxDist) {
                    maxDist = dist;
                    p1 = points[i];
                    p2 = points[j];
                }
            }
        }

        return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, source: seg1.source, perimeter: seg1.perimeter };
    }

    /**
     * Create zigzag polyline offset from a wall segment.
     */
    _createZigzagAlongSegment(x1, y1, x2, y2, nx, ny, offset, amplitude, wavelength) {
        const points = [];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        if (length < 0.5) return points;

        const halfWave = wavelength / 2;
        const numPoints = Math.max(4, Math.floor(length / halfWave) + 1);

        for (let i = 0; i <= numPoints; i++) {
            const t = Math.min(i * halfWave / length, 1.0);
            const bx = x1 + dx * t;
            const by = y1 + dy * t;
            const ox = bx + nx * offset;
            const oy = by + ny * offset;
            const zigSign = (i % 2 === 0) ? 1 : -1;
            points.push({
                x: ox + nx * zigSign * amplitude,
                y: oy + ny * zigSign * amplitude
            });
        }

        return points;
    }

    // ════════════════════════════════════════════════════════════════════
    //  CIRCULATION PATH GENERATION (ported from COSTOLayoutPlacer)
    // ════════════════════════════════════════════════════════════════════

    /**
     * Build dashed center-line circulation paths for corridors.
     * Blue dashed lines with directional arrows matching reference.
     */
    _buildCirculationPaths() {
        const paths = [];
        const entranceCenter = this._getEntranceCenter();
        const hasEntrances = entranceCenter !== null;

        for (const corridor of this.corridors) {
            const cx = corridor.x + corridor.width / 2;
            const cy = corridor.y + corridor.height / 2;
            let startPoint, endPoint;

            if (corridor.direction === 'horizontal') {
                if (hasEntrances && entranceCenter.x < cx) {
                    startPoint = { x: corridor.x + corridor.width, y: cy };
                    endPoint = { x: corridor.x, y: cy };
                } else {
                    startPoint = { x: corridor.x, y: cy };
                    endPoint = { x: corridor.x + corridor.width, y: cy };
                }
            } else {
                if (hasEntrances && entranceCenter.y < cy) {
                    startPoint = { x: cx, y: corridor.y + corridor.height };
                    endPoint = { x: cx, y: corridor.y };
                } else {
                    startPoint = { x: cx, y: corridor.y };
                    endPoint = { x: cx, y: corridor.y + corridor.height };
                }
            }

            paths.push({
                type: corridor.type,
                style: 'dashed_lightblue',
                trafficDirection: 'access',
                path: [startPoint, endPoint]
            });
        }

        return paths;
    }

    _getEntranceCenter() {
        if (!this.entrances || this.entrances.length === 0) return null;

        let sumX = 0, sumY = 0, count = 0;
        for (const entrance of this.entrances) {
            if (entrance.position) {
                sumX += entrance.position.x; sumY += entrance.position.y; count++;
            } else if (entrance.x !== undefined && entrance.y !== undefined) {
                sumX += entrance.x; sumY += entrance.y; count++;
            } else if (entrance.bounds) {
                sumX += (entrance.bounds.minX + entrance.bounds.maxX) / 2;
                sumY += (entrance.bounds.minY + entrance.bounds.maxY) / 2;
                count++;
            }
        }

        return count === 0 ? null : { x: sumX / count, y: sumY / count };
    }

    // ════════════════════════════════════════════════════════════════════
    //  COLLISION DETECTION
    // ════════════════════════════════════════════════════════════════════

    _unitOverlapsWalls(unit) {
        const buffer = this.wallClearance;
        const ux = unit.x - buffer;
        const uy = unit.y - buffer;
        const uw = unit.width + buffer * 2;
        const uh = unit.height + buffer * 2;

        for (const wall of this.walls) {
            const seg = this._extractWallSegment(wall);
            if (!seg) continue;

            if (this._lineIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, ux, uy, uw, uh)) {
                return true;
            }
        }

        // Also check against entities/obstacles
        const entities = this.floorPlan.entities || [];
        for (const entity of entities) {
            if (!entity || entity.type === 'wall') continue;
            const ex = entity.x !== undefined ? entity.x : (entity.bounds ? entity.bounds.minX : undefined);
            const ey = entity.y !== undefined ? entity.y : (entity.bounds ? entity.bounds.minY : undefined);
            const ew = entity.width || (entity.bounds ? entity.bounds.maxX - entity.bounds.minX : 0);
            const eh = entity.height || (entity.bounds ? entity.bounds.maxY - entity.bounds.minY : 0);
            if (ex === undefined || ey === undefined || ew <= 0 || eh <= 0) continue;

            if (this._rectsOverlap(ux, uy, uw, uh, ex, ey, ew, eh)) {
                return true;
            }
        }

        // Check against entrances (need clearance)
        for (const ent of this.entrances) {
            const ex = ent.x !== undefined ? ent.x : 0;
            const ey = ent.y !== undefined ? ent.y : 0;
            const ew = ent.width || 2.0;
            const eh = ent.height || 2.0;
            const entBuffer = 1.0; // 1m clearance around entrances

            if (this._rectsOverlap(ux, uy, uw, uh, ex - entBuffer, ey - entBuffer, ew + entBuffer * 2, eh + entBuffer * 2)) {
                return true;
            }
        }

        return false;
    }

    _unitOverlapsForbidden(unit) {
        for (const fz of this.forbiddenZones) {
            const fzBounds = this._getZoneBounds(fz);
            if (!fzBounds) continue;
            if (this._rectsOverlap(
                unit.x, unit.y, unit.width, unit.height,
                fzBounds.minX, fzBounds.minY,
                fzBounds.maxX - fzBounds.minX,
                fzBounds.maxY - fzBounds.minY
            )) return true;
        }
        return false;
    }

    _clusterOverlapsForbidden(startX, endX, startY, endY) {
        for (const fz of this.forbiddenZones) {
            const fzBounds = this._getZoneBounds(fz);
            if (!fzBounds) continue;
            if (this._rectsOverlap(
                startX, startY, endX - startX, endY - startY,
                fzBounds.minX, fzBounds.minY,
                fzBounds.maxX - fzBounds.minX,
                fzBounds.maxY - fzBounds.minY
            )) return true;
        }
        return false;
    }

    // ════════════════════════════════════════════════════════════════════
    //  GEOMETRY UTILITIES
    // ════════════════════════════════════════════════════════════════════

    _lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
        // Check if either endpoint is inside rectangle
        if ((x1 >= rx && x1 <= rx + rw && y1 >= ry && y1 <= ry + rh) ||
            (x2 >= rx && x2 <= rx + rw && y2 >= ry && y2 <= ry + rh)) {
            return true;
        }

        // Check line intersection with all 4 edges of rect
        const edges = [
            [rx, ry, rx + rw, ry],
            [rx + rw, ry, rx + rw, ry + rh],
            [rx, ry + rh, rx + rw, ry + rh],
            [rx, ry, rx, ry + rh]
        ];

        for (const [ex1, ey1, ex2, ey2] of edges) {
            if (this._linesIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2)) {
                return true;
            }
        }
        return false;
    }

    _linesIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (Math.abs(denom) < 1e-10) return false;

        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

        return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    }

    _rectsOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
        return !(x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1);
    }

    _extractWallSegment(wall) {
        const x1 = wall.x1 !== undefined ? wall.x1 : (wall.start ? wall.start.x : wall.startX);
        const y1 = wall.y1 !== undefined ? wall.y1 : (wall.start ? wall.start.y : wall.startY);
        const x2 = wall.x2 !== undefined ? wall.x2 : (wall.end ? wall.end.x : wall.endX);
        const y2 = wall.y2 !== undefined ? wall.y2 : (wall.end ? wall.end.y : wall.endY);
        if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
        return { x1, y1, x2, y2 };
    }

    /**
     * Check if a wall segment is along the perimeter of the bounds.
     */
    _isPerimeterWall(seg) {
        const b = this.bounds;
        // Use 1.5% threshold (tighter) to avoid misclassifying internal walls near edges
        const threshold = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.015;
        
        // Both endpoints must be near the same edge to be a perimeter wall
        const x1NearLeft = Math.abs(seg.x1 - b.minX) < threshold;
        const x2NearLeft = Math.abs(seg.x2 - b.minX) < threshold;
        const x1NearRight = Math.abs(seg.x1 - b.maxX) < threshold;
        const x2NearRight = Math.abs(seg.x2 - b.maxX) < threshold;
        const y1NearBottom = Math.abs(seg.y1 - b.minY) < threshold;
        const y2NearBottom = Math.abs(seg.y2 - b.minY) < threshold;
        const y1NearTop = Math.abs(seg.y1 - b.maxY) < threshold;
        const y2NearTop = Math.abs(seg.y2 - b.maxY) < threshold;

        // Wall runs along left edge
        if (x1NearLeft && x2NearLeft) return true;
        // Wall runs along right edge
        if (x1NearRight && x2NearRight) return true;
        // Wall runs along bottom edge
        if (y1NearBottom && y2NearBottom) return true;
        // Wall runs along top edge
        if (y1NearTop && y2NearTop) return true;

        return false;
    }

    _getZoneBounds(zone) {
        if (zone.bounds) return zone.bounds;
        if (zone.minX !== undefined) return { minX: zone.minX, minY: zone.minY, maxX: zone.maxX, maxY: zone.maxY };
        if (zone.x !== undefined) return { minX: zone.x, minY: zone.y, maxX: zone.x + zone.width, maxY: zone.y + zone.height };
        if (zone.polygon && zone.polygon.length >= 3) {
            const xs = zone.polygon.map(p => Array.isArray(p) ? p[0] : p.x);
            const ys = zone.polygon.map(p => Array.isArray(p) ? p[1] : p.y);
            return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
        }
        return null;
    }

    // Public accessors
    getUnits() { return this.units; }
    getCorridors() { return this.corridors; }
    getRadiators() { return this.radiators; }
    getCirculationPaths() { return this.circulationPaths; }
}

module.exports = COSTOLayoutEngine;
