'use strict';

const { extractSegments, extractRect } = require('./geometry');

/**
 * RoomDetector - Finds rooms in a floor plan using occupancy grid + flood fill
 * 
 * Strategy:
 * - Build a bitmap where walls are burned with THIN buffer (1 cell)
 * - Flood-fill connected free regions = rooms
 * - Return bounding boxes of rooms large enough for box placement
 */
class RoomDetector {
    constructor(floorPlan, options) {
        this.bounds = floorPlan.bounds;
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.entities = floorPlan.entities || [];
        this.gs = options.gridSize || 0.20;
        this.minRoomArea = options.minRoomArea || 8;
    }

    detect() {
        const b = this.bounds;
        const gs = this.gs;

        this.originX = b.minX;
        this.originY = b.minY;
        this.cols = Math.ceil((b.maxX - b.minX) / gs);
        this.rows = Math.ceil((b.maxY - b.minY) / gs);

        // Pre-extract all wall segments (handles polylines too)
        this.wallSegments = [];
        let polylineWalls = 0;
        for (const wall of this.walls) {
            const segs = extractSegments(wall);
            for (const seg of segs) {
                const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                if (len < 0.1) continue;
                this.wallSegments.push(seg);
            }
            if (segs.length > 1) polylineWalls++;
        }
        console.log(`[RoomDetector] Extracted ${this.wallSegments.length} segments from ${this.walls.length} walls (${polylineWalls} polylines)`);

        const grid = this._buildBitmap();
        const rooms = this._floodFill(grid);

        console.log(`[RoomDetector] Grid ${this.cols}x${this.rows}, found ${rooms.length} rooms`);
        return rooms;
    }

    _buildBitmap() {
        const gs = this.gs;
        const grid = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));

        // Burn perimeter (1 cell border)
        for (let r = 0; r < this.rows; r++) {
            grid[r][0] = 1;
            grid[r][this.cols - 1] = 1;
        }
        for (let c = 0; c < this.cols; c++) {
            grid[0][c] = 1;
            grid[this.rows - 1][c] = 1;
        }

        // Burn all wall segments with thin buffer (1 cell)
        const wallBuf = 1;
        for (const seg of this.wallSegments) {
            this._burnLine(grid, seg.x1, seg.y1, seg.x2, seg.y2, wallBuf);
        }

        // Burn forbidden zones
        for (const fz of this.forbiddenZones) {
            const r = extractRect(fz);
            if (r) this._burnRect(grid, r.x, r.y, r.w, r.h, 2);
        }

        // Burn entrances with clearance
        for (const ent of this.entrances) {
            const segs = extractSegments(ent);
            if (segs.length > 0) {
                for (const seg of segs) {
                    this._burnLine(grid, seg.x1, seg.y1, seg.x2, seg.y2, 3);
                }
            } else {
                const ex = ent.x ?? 0, ey = ent.y ?? 0;
                const ew = ent.width || 1.5, eh = ent.height || 1.5;
                this._burnRect(grid, ex, ey, ew, eh, 3);
            }
        }

        // Count free cells
        let free = 0;
        for (let r = 0; r < this.rows; r++)
            for (let c = 0; c < this.cols; c++)
                if (!grid[r][c]) free++;
        const total = this.rows * this.cols;
        console.log(`[RoomDetector] Bitmap: ${free}/${total} free (${(free/total*100).toFixed(1)}%)`);

        return grid;
    }

    _burnLine(grid, x1, y1, x2, y2, buffer) {
        const gs = this.gs;
        const len = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.max(2, Math.ceil(len / (gs * 0.4)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = x1 + (x2 - x1) * t;
            const py = y1 + (y2 - y1) * t;
            const gc = Math.floor((px - this.originX) / gs);
            const gr = Math.floor((py - this.originY) / gs);
            for (let dr = -buffer; dr <= buffer; dr++) {
                for (let dc = -buffer; dc <= buffer; dc++) {
                    const nr = gr + dr, nc = gc + dc;
                    if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
                        grid[nr][nc] = 1;
                    }
                }
            }
        }
    }

    _burnRect(grid, x, y, w, h, buffer) {
        const gs = this.gs;
        const c1 = Math.floor((x - this.originX) / gs) - buffer;
        const c2 = Math.ceil((x + w - this.originX) / gs) + buffer;
        const r1 = Math.floor((y - this.originY) / gs) - buffer;
        const r2 = Math.ceil((y + h - this.originY) / gs) + buffer;
        for (let r = Math.max(0, r1); r < Math.min(this.rows, r2); r++) {
            for (let c = Math.max(0, c1); c < Math.min(this.cols, c2); c++) {
                grid[r][c] = 1;
            }
        }
    }

    _floodFill(grid) {
        const gs = this.gs;
        const visited = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
        const rooms = [];

        // Minimum dimension in cells for a room to be useful
        const minDimCells = Math.ceil(3.0 / gs); // 3m minimum

        for (let startR = 0; startR < this.rows; startR++) {
            for (let startC = 0; startC < this.cols; startC++) {
                if (grid[startR][startC] || visited[startR][startC]) continue;

                // BFS flood fill
                const queue = [startR * this.cols + startC];
                visited[startR][startC] = 1;
                let minR = startR, maxR = startR, minC = startC, maxC = startC;
                let count = 0;

                while (queue.length > 0) {
                    const idx = queue.shift();
                    const cr = Math.floor(idx / this.cols);
                    const cc = idx % this.cols;
                    count++;

                    if (cr < minR) minR = cr;
                    if (cr > maxR) maxR = cr;
                    if (cc < minC) minC = cc;
                    if (cc > maxC) maxC = cc;

                    // 4-connected neighbors
                    const neighbors = [
                        cr > 0 ? (cr - 1) * this.cols + cc : -1,
                        cr < this.rows - 1 ? (cr + 1) * this.cols + cc : -1,
                        cc > 0 ? cr * this.cols + (cc - 1) : -1,
                        cc < this.cols - 1 ? cr * this.cols + (cc + 1) : -1
                    ];

                    for (const ni of neighbors) {
                        if (ni < 0) continue;
                        const nr = Math.floor(ni / this.cols);
                        const nc = ni % this.cols;
                        if (!grid[nr][nc] && !visited[nr][nc]) {
                            visited[nr][nc] = 1;
                            queue.push(ni);
                        }
                    }
                }

                const widthCells = maxC - minC + 1;
                const heightCells = maxR - minR + 1;
                const areaCells = count;
                const areaM2 = areaCells * gs * gs;

                // Filter: room must be large enough and have reasonable dimensions
                if (widthCells >= minDimCells && heightCells >= minDimCells && areaM2 >= this.minRoomArea) {
                    rooms.push({
                        minX: this.originX + minC * gs,
                        minY: this.originY + minR * gs,
                        maxX: this.originX + (maxC + 1) * gs,
                        maxY: this.originY + (maxR + 1) * gs,
                        width: (maxC - minC + 1) * gs,
                        height: (maxR - minR + 1) * gs,
                        area: areaM2,
                        cells: count
                    });
                }
            }
        }

        // Sort by area descending
        rooms.sort((a, b) => b.area - a.area);
        return rooms;
    }
}

module.exports = RoomDetector;
