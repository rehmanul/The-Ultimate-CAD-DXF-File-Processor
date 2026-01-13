/**
 * ProductionCorridorGenerator
 * Creates pink corridor network BETWEEN ilot groups
 * Traces paths along the gaps between workstation zones
 */
class ProductionCorridorGenerator {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots || [];
        this.corridorWidth = options.corridorWidth || 1.0;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    }

    generateCorridors() {
        if (!this.ilots || this.ilots.length < 2) {
            return [];
        }

        const corridors = [];

        // Find gaps between ilot rows (horizontal corridors)
        const horizontalCorridors = this._findHorizontalCorridors();
        corridors.push(...horizontalCorridors);

        // Find gaps between ilot columns (vertical corridors)
        const verticalCorridors = this._findVerticalCorridors();
        corridors.push(...verticalCorridors);

        console.log(`[Corridor Gen] Created ${corridors.length} corridor segments`);
        return corridors;
    }

    _findHorizontalCorridors() {
        const corridors = [];

        // Group ilots by their Y position (rows)
        const tolerance = 0.5;
        const rows = this._groupByPosition(this.ilots, 'y', tolerance);

        // Sort rows by Y position
        const sortedRowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);

        // Find gaps between consecutive rows
        for (let i = 0; i < sortedRowKeys.length - 1; i++) {
            const currentRowY = sortedRowKeys[i];
            const nextRowY = sortedRowKeys[i + 1];

            const currentRowIlots = rows[currentRowY];
            const nextRowIlots = rows[nextRowY];

            // Find the bottom of current row and top of next row
            const currentBottom = Math.max(...currentRowIlots.map(il => il.y + il.height));
            const nextTop = Math.min(...nextRowIlots.map(il => il.y));

            const gap = nextTop - currentBottom;

            if (gap >= 0.5) {
                // Find horizontal extent
                const allIlots = [...currentRowIlots, ...nextRowIlots];
                const minX = Math.min(...allIlots.map(il => il.x));
                const maxX = Math.max(...allIlots.map(il => il.x + il.width));

                const corridorY = currentBottom + (gap - this.corridorWidth) / 2;

                corridors.push({
                    id: `h_corridor_${corridors.length}`,
                    x: minX,
                    y: corridorY,
                    width: maxX - minX,
                    height: this.corridorWidth,
                    length: maxX - minX,
                    area: (maxX - minX) * this.corridorWidth,
                    type: 'horizontal'
                });
            }
        }

        return corridors;
    }

    _findVerticalCorridors() {
        const corridors = [];

        // Group ilots by their X position (columns)
        const tolerance = 0.5;
        const cols = this._groupByPosition(this.ilots, 'x', tolerance);

        // Sort columns by X position
        const sortedColKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);

        // Find gaps between consecutive columns
        for (let i = 0; i < sortedColKeys.length - 1; i++) {
            const currentColX = sortedColKeys[i];
            const nextColX = sortedColKeys[i + 1];

            const currentColIlots = cols[currentColX];
            const nextColIlots = cols[nextColX];

            // Find the right of current col and left of next col
            const currentRight = Math.max(...currentColIlots.map(il => il.x + il.width));
            const nextLeft = Math.min(...nextColIlots.map(il => il.x));

            const gap = nextLeft - currentRight;

            if (gap >= 0.5) {
                // Find vertical extent
                const allIlots = [...currentColIlots, ...nextColIlots];
                const minY = Math.min(...allIlots.map(il => il.y));
                const maxY = Math.max(...allIlots.map(il => il.y + il.height));

                const corridorX = currentRight + (gap - this.corridorWidth) / 2;

                corridors.push({
                    id: `v_corridor_${corridors.length}`,
                    x: corridorX,
                    y: minY,
                    width: this.corridorWidth,
                    height: maxY - minY,
                    length: maxY - minY,
                    area: (maxY - minY) * this.corridorWidth,
                    type: 'vertical'
                });
            }
        }

        return corridors;
    }

    _groupByPosition(ilots, axis, tolerance) {
        const groups = {};

        ilots.forEach(ilot => {
            const pos = ilot[axis];
            // Find existing group or create new one
            let foundKey = null;
            for (const key of Object.keys(groups)) {
                if (Math.abs(Number(key) - pos) < tolerance) {
                    foundKey = key;
                    break;
                }
            }

            if (foundKey !== null) {
                groups[foundKey].push(ilot);
            } else {
                groups[pos] = [ilot];
            }
        });

        return groups;
    }
}

module.exports = ProductionCorridorGenerator;
