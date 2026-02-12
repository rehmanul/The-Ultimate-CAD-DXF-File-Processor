'use strict';

/**
 * RadiatorGenerator - Discrete radiator symbols along box rows.
 * 
 * In the COSTO reference, radiators are small angled red rectangle symbols
 * with dimension labels (e.g., "100×300") placed at regular intervals.
 * NO ZIGZAG PATHS — only position + angle + label data.
 */
class RadiatorGenerator {
    constructor(floorPlan, options = {}) {
        this.bounds = floorPlan.bounds;
        this.symbolSpacing = 3.0;  // 3m between symbols
        this.label = '100×300';
    }

    /**
     * Generate radiator position data from placed units and corridors.
     * Returns position+angle data for discrete symbol rendering, NOT zigzag paths.
     */
    generateFromLayout(units, corridors) {
        if (!units || units.length === 0) return [];

        // Determine orientation from corridors
        const isVertical = corridors.length > 0
            ? corridors[0].direction === 'vertical'
            : false;

        // Group units by their primary-axis position
        const groups = new Map();
        for (const u of units) {
            const priPos = isVertical ? u.x : u.y;
            const key = `${Math.round(priPos * 2) / 2}_${u.row || 'left'}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(u);
        }

        const radiators = [];

        for (const [key, groupUnits] of groups) {
            const side = key.endsWith('_right') ? 'right' : 'left';

            // Sort along secondary axis
            groupUnits.sort((a, b) => isVertical ? (a.y - b.y) : (a.x - b.x));

            // Get contiguous runs
            const runs = this._splitIntoRuns(groupUnits, isVertical);

            for (const run of runs) {
                const { start, end, angle } = this._getRowEdge(run, side, isVertical);
                const wallLen = Math.hypot(end.x - start.x, end.y - start.y);
                if (wallLen < 1) continue;

                // Generate position data (NOT zigzag path)
                const n = Math.max(1, Math.floor(wallLen / this.symbolSpacing));
                const positions = [];
                for (let i = 0; i < n; i++) {
                    const t = (i + 0.5) / n;
                    positions.push({
                        x: start.x + (end.x - start.x) * t,
                        y: start.y + (end.y - start.y) * t
                    });
                }

                radiators.push({
                    type: 'radiator',
                    label: this.label,
                    wallAngle: angle,
                    positions: positions,
                    // Backwards-compatible path: just 2 points (start, end)
                    path: [start, end],
                    row: side
                });
            }
        }

        return radiators;
    }

    /** Split units into contiguous runs (break at gaps > 1m) */
    _splitIntoRuns(sortedUnits, isVertical) {
        if (sortedUnits.length === 0) return [];
        const runs = [[sortedUnits[0]]];
        for (let i = 1; i < sortedUnits.length; i++) {
            const prev = sortedUnits[i - 1];
            const curr = sortedUnits[i];
            const prevEnd = isVertical ? prev.y + prev.height : prev.x + prev.width;
            const currStart = isVertical ? curr.y : curr.x;
            if (currStart - prevEnd > 1.0) {
                runs.push([curr]);
            } else {
                runs[runs.length - 1].push(curr);
            }
        }
        return runs;
    }

    /** Get the edge line (start, end, angle) for a row of units */
    _getRowEdge(units, side, isVertical) {
        if (isVertical) {
            const edgeStart = units[0].y;
            const edgeEnd = units[units.length - 1].y + units[units.length - 1].height;
            const edgeFixed = side === 'left'
                ? Math.min(...units.map(u => u.x))
                : Math.max(...units.map(u => u.x + u.width));
            return {
                start: { x: edgeFixed, y: edgeStart },
                end: { x: edgeFixed, y: edgeEnd },
                angle: Math.PI / 2
            };
        } else {
            const edgeStart = units[0].x;
            const edgeEnd = units[units.length - 1].x + units[units.length - 1].width;
            const edgeFixed = side === 'left'
                ? Math.min(...units.map(u => u.y))
                : Math.max(...units.map(u => u.y + u.height));
            return {
                start: { x: edgeStart, y: edgeFixed },
                end: { x: edgeEnd, y: edgeFixed },
                angle: 0
            };
        }
    }

    /** Legacy generate() for backward compat */
    generate() {
        return [];
    }
}

module.exports = RadiatorGenerator;
