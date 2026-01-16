/**
 * Cluster Placer - Production Grade
 * Places ilots in realistic clusters (teams) rather than simple rows.
 * Handles rotation, collision detection, and room alignment.
 */
class ClusterPlacer {
    constructor(floorPlan, options = {}) {
        this.bounds = floorPlan.bounds;
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];

        this.margin = options.margin || 1.0;
        this.spacing = options.spacing || 0.5; // Spacing between clusters
        this.internalSpacing = options.internalSpacing || 0.1; // Spacing within a cluster

        // Spatial grid for collision detection (simple bucket implementation)
        this.gridSize = 2.0; // 2m buckets
        this.grid = new Map();
    }

    /**
     * Generate clusters for a specific room/space
     */
    placeClusters(space, configs) {
        const clusters = [];
        const bounds = space.bounds;

        // Determine primary orientation of the space (horizontal or vertical)
        const isVertical = (bounds.maxY - bounds.minY) > (bounds.maxX - bounds.minX);
        const primaryRotation = isVertical ? 90 : 0;

        // Try to place clusters
        for (const config of configs) {
            let placedCount = 0;
            let attempts = 0;
            const maxAttempts = 500;

            while (placedCount < config.count && attempts < maxAttempts) {
                attempts++;

                // 1. Pick a random point within bounds (respecting margins)
                const x = bounds.minX + this.margin + Math.random() * (bounds.maxX - bounds.minX - 2 * this.margin);
                const y = bounds.minY + this.margin + Math.random() * (bounds.maxY - bounds.minY - 2 * this.margin);

                // 2. Determine rotation (align with walls usually)
                // 80% chance to align with room, 20% chance to rotate 90 deg
                const rotation = Math.random() > 0.2 ? primaryRotation : (primaryRotation + 90) % 180;

                // 3. Create cluster candidate
                const cluster = this._createCluster(x, y, config.type, rotation);

                // 4. Validate position
                if (this._isValidPosition(cluster, space)) {
                    clusters.push(cluster);
                    this._addToGrid(cluster);
                    placedCount++;
                }
            }
        }

        // Flatten clusters into individual ilots
        return clusters.flatMap(c => c.ilots);
    }

    _createCluster(x, y, type, rotation) {
        const ilots = [];
        let width, height, rows, cols;

        // Define cluster configurations
        switch (type) {
            case 'team_4': // 2x2 block
                width = 1.6; height = 0.8; // Standard desk size
                rows = 2; cols = 2;
                break;
            case 'team_6': // 3x2 block
                width = 1.6; height = 0.8;
                rows = 2; cols = 3;
                break;
            case 'meeting_small': // Single large table
                width = 2.4; height = 1.2;
                rows = 1; cols = 1;
                break;
            default: // Single desk
                width = 1.6; height = 0.8;
                rows = 1; cols = 1;
        }

        // Calculate total cluster dimensions
        const totalW = cols * width + (cols - 1) * this.internalSpacing;
        const totalH = rows * height + (rows - 1) * this.internalSpacing;

        // Center point adjustment (x,y is center of cluster)
        const startX = x - totalW / 2;
        const startY = y - totalH / 2;

        // Generate individual ilots
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // Local position
                let lx = startX + c * (width + this.internalSpacing);
                let ly = startY + r * (height + this.internalSpacing);

                // Apply rotation around center (x,y) if needed
                if (rotation === 90) {
                    const dx = lx - x;
                    const dy = ly - y;
                    lx = x - dy;
                    ly = y + dx;
                    // Swap dimensions for rotated items
                    ilots.push({
                        x: lx, y: ly,
                        width: height, height: width,
                        rotation: 90,
                        type: type.includes('meeting') ? 'meeting' : 'team'
                    });
                } else {
                    ilots.push({
                        x: lx, y: ly,
                        width: width, height: height,
                        rotation: 0,
                        type: type.includes('meeting') ? 'meeting' : 'team'
                    });
                }
            }
        }

        return {
            x, y, width: totalW, height: totalH, rotation,
            ilots,
            bounds: { // Approximate bounding box for the whole cluster
                minX: x - (rotation === 90 ? totalH : totalW) / 2,
                maxX: x + (rotation === 90 ? totalH : totalW) / 2,
                minY: y - (rotation === 90 ? totalW : totalH) / 2,
                maxY: y + (rotation === 90 ? totalW : totalH) / 2
            }
        };
    }

    _isValidPosition(cluster, space) {
        const b = cluster.bounds;

        // 1. Check room bounds
        if (b.minX < space.bounds.minX || b.maxX > space.bounds.maxX ||
            b.minY < space.bounds.minY || b.maxY > space.bounds.maxY) {
            return false;
        }

        // 2. Check polygon containment (if room is not a rectangle)
        if (space.polygon) {
            // Check all 4 corners of the cluster
            const corners = [
                [b.minX, b.minY], [b.maxX, b.minY],
                [b.maxX, b.maxY], [b.minX, b.maxY]
            ];
            for (const p of corners) {
                if (!this._pointInPolygon(p, space.polygon)) return false;
            }
        }

        // 3. Check forbidden zones
        for (const zone of this.forbiddenZones) {
            if (this._boxIntersectsPolygon(b, zone.polygon)) return false;
        }

        // 4. Check entrances (with extra clearance)
        for (const ent of this.entrances) {
            if (this._boxIntersectsPolygon(b, ent.polygon, 1.5)) return false; // 1.5m clearance
        }

        // 5. Check walls
        // Simple bounding box check first
        for (const wall of this.walls) {
            // Skip walls that define the room boundary itself if we are inside (already checked by polygon)
            // But for safety, check intersection. 
            // Ideally we use a spatial index for walls too, but linear scan for single room is fast enough.
            if (this._lineIntersectsBox(wall.start, wall.end, b)) return false;
        }

        // 6. Check overlap with existing clusters (using grid)
        if (this._checkGridCollision(b)) return false;

        return true;
    }

    _addToGrid(cluster) {
        const b = cluster.bounds;
        const startX = Math.floor(b.minX / this.gridSize);
        const endX = Math.floor(b.maxX / this.gridSize);
        const startY = Math.floor(b.minY / this.gridSize);
        const endY = Math.floor(b.maxY / this.gridSize);

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const key = `${x},${y}`;
                if (!this.grid.has(key)) this.grid.set(key, []);
                this.grid.get(key).push(cluster);
            }
        }
    }

    _checkGridCollision(b) {
        const expanded = {
            minX: b.minX - this.spacing,
            maxX: b.maxX + this.spacing,
            minY: b.minY - this.spacing,
            maxY: b.maxY + this.spacing
        };
        const startX = Math.floor(b.minX / this.gridSize);
        const endX = Math.floor(b.maxX / this.gridSize);
        const startY = Math.floor(b.minY / this.gridSize);
        const endY = Math.floor(b.maxY / this.gridSize);

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const key = `${x},${y}`;
                const cell = this.grid.get(key);
                if (cell) {
                    for (const other of cell) {
                        const otherExpanded = {
                            minX: other.bounds.minX - this.spacing,
                            maxX: other.bounds.maxX + this.spacing,
                            minY: other.bounds.minY - this.spacing,
                            maxY: other.bounds.maxY + this.spacing
                        };
                        if (this._boxesOverlap(expanded, otherExpanded)) return true;
                    }
                }
            }
        }
        return false;
    }

    _boxesOverlap(a, b) {
        return (a.minX < b.maxX && a.maxX > b.minX &&
            a.minY < b.maxY && a.maxY > b.minY);
    }

    _pointInPolygon(point, polygon) {
        const x = point[0], y = point[1];
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i][0], yi = polygon[i][1];
            const xj = polygon[j][0], yj = polygon[j][1];
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    _boxIntersectsPolygon(box, polygon, padding = 0) {
        // Expand box by padding
        const b = {
            minX: box.minX - padding, maxX: box.maxX + padding,
            minY: box.minY - padding, maxY: box.maxY + padding
        };

        // 1. Check if any polygon point is inside box
        for (const p of polygon) {
            if (p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY) return true;
        }

        // 2. Check if box corners are inside polygon
        // (Critical for cases where box is fully inside the polygon)
        const boxCorners = [
            [b.minX, b.minY], [b.maxX, b.minY],
            [b.maxX, b.maxY], [b.minX, b.maxY]
        ];
        for (const c of boxCorners) {
            if (this._pointInPolygon(c, polygon)) return true;
        }

        // 3. Check edge intersections
        const boxLines = [
            [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }],
            [{ x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }],
            [{ x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }],
            [{ x: b.minX, y: b.maxY }, { x: b.minX, y: b.minY }]
        ];

        for (let i = 0; i < polygon.length; i++) {
            const p1 = { x: polygon[i][0], y: polygon[i][1] };
            const p2 = { x: polygon[(i + 1) % polygon.length][0], y: polygon[(i + 1) % polygon.length][1] };

            for (const bl of boxLines) {
                if (this._segmentsIntersect(p1, p2, bl[0], bl[1])) return true;
            }
        }

        return false;
    }

    _lineIntersectsBox(p1, p2, box) {
        // Liang-Barsky algorithm or simple segment intersection with box edges
        const boxLines = [
            [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }],
            [{ x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }],
            [{ x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }],
            [{ x: box.minX, y: box.maxY }, { x: box.minX, y: box.minY }]
        ];

        // Check if line is fully inside (unlikely for walls)
        if (p1.x >= box.minX && p1.x <= box.maxX && p1.y >= box.minY && p1.y <= box.maxY) return true;

        for (const bl of boxLines) {
            if (this._segmentsIntersect(p1, p2, bl[0], bl[1])) return true;
        }
        return false;
    }

    _segmentsIntersect(a, b, c, d) {
        const det = (b.x - a.x) * (d.y - c.y) - (d.x - c.x) * (b.y - a.y);
        if (det === 0) return false;
        const lambda = ((d.y - c.y) * (d.x - a.x) + (c.x - d.x) * (d.y - a.y)) / det;
        const gamma = ((a.y - b.y) * (d.x - a.x) + (b.x - a.x) * (d.y - a.y)) / det;
        return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
    }
}

module.exports = ClusterPlacer;
