'use strict';

/**
 * RadiatorGenerator - Continuous zigzag/wavy radiator paths along box row perimeters.
 *
 * Reference output: red continuous wavy/zigzag polylines running along the outer
 * edge of every box row that faces a perimeter wall. Each radiator segment is a
 * polyline with high-density zigzag points (not discrete symbols).
 *
 * Generated data:
 *   path[]   – polyline points for continuous wavy rendering
 *   positions[] – backwards-compatible discrete symbol positions
 *   wallAngle   – angle of the wall (radians)
 *   label       – dimension label e.g. "100×300"
 */
class RadiatorGenerator {
    constructor(floorPlan, options = {}) {
        this.bounds = floorPlan.bounds;
        this.walls = floorPlan.walls || [];
        // Zigzag parameters (tuned to match reference image)
        this.waveAmplitude = options.waveAmplitude || 0.18;  // 18cm peak-to-peak
        this.waveFrequency = options.waveFrequency || 4.0;   // waves per metre
        this.symbolSpacing = options.symbolSpacing || 2.5;   // metres between discrete symbols
        this.label = options.label || '100×300';
        this.wallOffset = options.wallOffset || 0.08;        // 8cm inward from wall
    }

    /**
     * Generate radiator data from laid-out units and corridors.
     * Returns wavy-path segments along the outer (perimeter-facing) edge of each row.
     */
    generateFromLayout(units, corridors) {
        if (!units || units.length === 0) return [];

        // Determine primary layout orientation from corridors
        const hCount = corridors.filter(c => c.direction === 'horizontal').length;
        const vCount = corridors.filter(c => c.direction === 'vertical').length;
        const isVertical = vCount > hCount;

        // Group units by their primary-axis band (row id or rounded position)
        const groups = new Map();
        for (const u of units) {
            const key = u.row != null
                ? String(u.row)
                : String(Math.round((isVertical ? u.x : u.y) * 4) / 4);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(u);
        }

        const bounds = this.bounds;
        const radiators = [];

        for (const [, groupUnits] of groups) {
            // Sort along secondary axis
            groupUnits.sort((a, b) => isVertical ? (a.y - b.y) : (a.x - b.x));
            const runs = this._splitIntoRuns(groupUnits, isVertical);

            for (const run of runs) {
                // Get the two edges of the row (inner corridor-facing / outer perimeter-facing)
                const edges = this._getRowEdges(run, isVertical);

                for (const edge of edges) {
                    // Only place radiators on the perimeter-facing side (outer edge)
                    const isOuter = this._isPerimeterFacing(edge, bounds, isVertical);
                    if (!isOuter) continue;

                    const wallLen = Math.hypot(
                        edge.end.x - edge.start.x,
                        edge.end.y - edge.start.y
                    );
                    if (wallLen < 1.0) continue;

                    const wavyPath = this._generateZigzagPath(edge.start, edge.end, wallLen, edge.inwardNormal);

                    // Discrete positions (backwards compat)
                    const n = Math.max(1, Math.floor(wallLen / this.symbolSpacing));
                    const positions = [];
                    for (let i = 0; i < n; i++) {
                        const t = (i + 0.5) / n;
                        positions.push({
                            x: edge.start.x + (edge.end.x - edge.start.x) * t,
                            y: edge.start.y + (edge.end.y - edge.start.y) * t
                        });
                    }

                    radiators.push({
                        type: 'radiator',
                        label: this.label,
                        wallAngle: Math.atan2(
                            edge.end.y - edge.start.y,
                            edge.end.x - edge.start.x
                        ),
                        positions,
                        path: wavyPath,
                        length: wallLen
                    });
                }
            }
        }

        // If no perimeter-facing rows found (open plan), fall back to bounds perimeter
        if (radiators.length === 0) {
            return this._generateBoundsPerimeter();
        }

        console.log(`[RadiatorGen] Generated ${radiators.length} radiator runs (wavy paths)`);
        return radiators;
    }

    /**
     * Generate a dense zigzag polyline along a wall segment.
     * @param {{x,y}} start
     * @param {{x,y}} end
     * @param {number} length
     * @param {{x,y}} inwardNormal – unit vector pointing inward (away from wall)
     */
    _generateZigzagPath(start, end, length, inwardNormal) {
        const dx = (end.x - start.x) / length;
        const dy = (end.y - start.y) / length;
        const nx = inwardNormal ? inwardNormal.x : -dy;
        const ny = inwardNormal ? inwardNormal.y : dx;

        const amp = this.waveAmplitude;
        const pointsPerWave = 8;
        const numWaves = Math.max(2, Math.ceil(length * this.waveFrequency));
        const totalPoints = numWaves * 2 + 1; // sharp zigzag

        const path = [];
        for (let i = 0; i <= totalPoints; i++) {
            const t = i / totalPoints;
            const baseX = start.x + dx * length * t;
            const baseY = start.y + dy * length * t;
            // Alternate positive/negative amplitude (sharp zigzag)
            const side = (i % 2 === 0) ? 1 : -1;
            path.push({
                x: baseX + nx * amp * side,
                y: baseY + ny * amp * side
            });
        }
        return path;
    }

    /** Split units into contiguous runs (break at gaps > 0.8m) */
    _splitIntoRuns(sortedUnits, isVertical) {
        if (sortedUnits.length === 0) return [];
        const runs = [[sortedUnits[0]]];
        for (let i = 1; i < sortedUnits.length; i++) {
            const prev = sortedUnits[i - 1];
            const curr = sortedUnits[i];
            const prevEnd = isVertical ? prev.y + prev.height : prev.x + prev.width;
            const currStart = isVertical ? curr.y : curr.x;
            if (currStart - prevEnd > 0.8) runs.push([curr]);
            else runs[runs.length - 1].push(curr);
        }
        return runs;
    }

    /**
     * Get both edges of a run of units (min-edge and max-edge in primary axis).
     * Returns [{start, end, inwardNormal}, ...]
     */
    _getRowEdges(units, isVertical) {
        if (isVertical) {
            const edgeYStart = units[0].y;
            const edgeYEnd = units[units.length - 1].y + units[units.length - 1].height;
            const minX = Math.min(...units.map(u => u.x));
            const maxX = Math.max(...units.map(u => u.x + u.width));
            return [
                {
                    start: { x: minX, y: edgeYStart },
                    end: { x: minX, y: edgeYEnd },
                    inwardNormal: { x: 1, y: 0 }   // pointing right (inward)
                },
                {
                    start: { x: maxX, y: edgeYStart },
                    end: { x: maxX, y: edgeYEnd },
                    inwardNormal: { x: -1, y: 0 }  // pointing left (inward)
                }
            ];
        } else {
            const edgeXStart = units[0].x;
            const edgeXEnd = units[units.length - 1].x + units[units.length - 1].width;
            const minY = Math.min(...units.map(u => u.y));
            const maxY = Math.max(...units.map(u => u.y + u.height));
            return [
                {
                    start: { x: edgeXStart, y: minY },
                    end: { x: edgeXEnd, y: minY },
                    inwardNormal: { x: 0, y: 1 }   // pointing up (inward)
                },
                {
                    start: { x: edgeXStart, y: maxY },
                    end: { x: edgeXEnd, y: maxY },
                    inwardNormal: { x: 0, y: -1 }  // pointing down (inward)
                }
            ];
        }
    }

    /**
     * Determine if an edge is perimeter-facing (close to bounds boundary).
     */
    _isPerimeterFacing(edge, bounds, isVertical) {
        const tol = 2.5; // metres tolerance
        if (isVertical) {
            const edgeX = edge.start.x;
            return (edgeX <= bounds.minX + tol) || (edgeX >= bounds.maxX - tol);
        } else {
            const edgeY = edge.start.y;
            return (edgeY <= bounds.minY + tol) || (edgeY >= bounds.maxY - tol);
        }
    }

    /**
     * Fallback: generate radiator paths along the 4 bounds walls.
     */
    _generateBoundsPerimeter() {
        const b = this.bounds;
        const off = this.wallOffset;
        const edges = [
            { start: { x: b.minX + off, y: b.minY + off }, end: { x: b.maxX - off, y: b.minY + off }, inwardNormal: { x: 0, y: 1 } },
            { start: { x: b.maxX - off, y: b.minY + off }, end: { x: b.maxX - off, y: b.maxY - off }, inwardNormal: { x: -1, y: 0 } },
            { start: { x: b.maxX - off, y: b.maxY - off }, end: { x: b.minX + off, y: b.maxY - off }, inwardNormal: { x: 0, y: -1 } },
            { start: { x: b.minX + off, y: b.maxY - off }, end: { x: b.minX + off, y: b.minY + off }, inwardNormal: { x: 1, y: 0 } }
        ];
        return edges.map((edge, i) => {
            const len = Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y);
            return {
                type: 'radiator',
                label: this.label,
                wallAngle: Math.atan2(edge.end.y - edge.start.y, edge.end.x - edge.start.x),
                positions: [{ x: (edge.start.x + edge.end.x) / 2, y: (edge.start.y + edge.end.y) / 2 }],
                path: this._generateZigzagPath(edge.start, edge.end, len, edge.inwardNormal),
                length: len
            };
        });
    }

    /** Legacy generate() stub for backward compat */
    generate() {
        return [];
    }
}

module.exports = RadiatorGenerator;
