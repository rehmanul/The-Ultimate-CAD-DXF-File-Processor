'use strict';

/**
 * RadiatorGenerator - Red zigzag partition indicators along box rows.
 * 
 * In the COSTO reference, the red zigzag lines run along the OUTER edge
 * of each box row — they indicate the partition type (Tôle Blanche/Grise)
 * between the boxes and the building perimeter or adjacent corridors.
 * 
 * Strategy: Group units by their primary-axis position (row band) and side,
 * then draw zigzag along the outer edge of each group.
 */
class RadiatorGenerator {
    constructor(floorPlan, options = {}) {
        this.bounds = floorPlan.bounds;
        this.amplitude = 0.12;
        this.wavelength = 0.35;
    }

    /**
     * Generate zigzag lines from placed units and corridors.
     * Groups units by row position and side, draws zigzag on outer edges.
     */
    generateFromLayout(units, corridors) {
        if (!units || units.length === 0) return [];

        // Determine orientation from corridors
        const isVertical = corridors.length > 0
            ? corridors[0].direction === 'vertical'
            : false;

        // Group units by their primary-axis position (rounded to 0.5m bands)
        // and by their row side (left/right)
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

            // Split into contiguous runs (break if gap > 1m between units)
            const runs = this._splitIntoRuns(groupUnits, isVertical);

            for (const run of runs) {
                const path = this._rowOuterZigzag(run, side, isVertical);
                if (path.length >= 2) {
                    radiators.push({
                        type: 'radiator', path, color: 'red',
                        style: 'zigzag', row: side
                    });
                }
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
            const prevEnd = isVertical
                ? prev.y + prev.height
                : prev.x + prev.width;
            const currStart = isVertical ? curr.y : curr.x;
            if (currStart - prevEnd > 1.0) {
                runs.push([curr]); // new run
            } else {
                runs[runs.length - 1].push(curr);
            }
        }
        return runs;
    }

    /** Generate zigzag along the outer edge of a contiguous row of units */
    _rowOuterZigzag(units, side, isVertical) {
        if (units.length === 0) return [];

        let edgeFixed, edgeStart, edgeEnd;
        let nx, ny;

        if (isVertical) {
            edgeStart = units[0].y;
            edgeEnd = units[units.length - 1].y + units[units.length - 1].height;

            if (side === 'left') {
                edgeFixed = Math.min(...units.map(u => u.x));
                nx = -1; ny = 0;
            } else {
                edgeFixed = Math.max(...units.map(u => u.x + u.width));
                nx = 1; ny = 0;
            }
            return this._zigzagLine(edgeFixed, edgeStart, edgeFixed, edgeEnd, nx, ny);
        } else {
            edgeStart = units[0].x;
            edgeEnd = units[units.length - 1].x + units[units.length - 1].width;

            if (side === 'left') {
                edgeFixed = Math.min(...units.map(u => u.y));
                nx = 0; ny = -1;
            } else {
                edgeFixed = Math.max(...units.map(u => u.y + u.height));
                nx = 0; ny = 1;
            }
            return this._zigzagLine(edgeStart, edgeFixed, edgeEnd, edgeFixed, nx, ny);
        }
    }

    /** Generate zigzag points along a line with given normal */
    _zigzagLine(x1, y1, x2, y2, nx, ny) {
        const pts = [];
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) return pts;

        const half = this.wavelength / 2;
        const n = Math.max(4, Math.floor(len / half) + 1);

        for (let i = 0; i <= n; i++) {
            const t = Math.min(i * half / len, 1.0);
            const bx = x1 + dx * t;
            const by = y1 + dy * t;
            const sign = (i % 2 === 0) ? 1 : -1;
            pts.push({
                x: bx + nx * sign * this.amplitude,
                y: by + ny * sign * this.amplitude
            });
        }
        return pts;
    }

    /** Legacy generate() for backward compat */
    generate() {
        return [];
    }
}

module.exports = RadiatorGenerator;
