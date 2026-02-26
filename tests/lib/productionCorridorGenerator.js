/**
 * ProductionCorridorGenerator
 * Creates pink corridor network BETWEEN ilot groups
 * Traces paths along the gaps between workstation zones
 */
class ProductionCorridorGenerator {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots || [];
        this.margin = typeof options.margin === 'number' ? options.margin : 0.2;
        this.corridorWidth = typeof options.corridorWidth === 'number' ? options.corridorWidth : 1.2;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    }

    generateCorridors() {
        if (!this.ilots || this.ilots.length < 2) {
            return [];
        }

        const corridors = [];

        const columns = this.groupIlotsByColumns();

        columns.forEach((column, columnIndex) => {
            if (column.length < 2) {
                return;
            }

            const sorted = [...column].sort((a, b) => a.y - b.y);
            const minX = Math.min(...sorted.map(ilot => ilot.x));
            const maxX = Math.max(...sorted.map(ilot => ilot.x + ilot.width));
            const corridorWidth = this.corridorWidth;
            const corridorSpan = maxX - minX;

            for (let i = 0; i < sorted.length - 1; i++) {
                const current = sorted[i];
                const next = sorted[i + 1];
                const currentBottom = current.y + current.height;
                const gap = next.y - currentBottom;

                if (gap < (this.margin + corridorWidth)) {
                    continue;
                }

                const corridorY = currentBottom + this.margin;
                const corridor = {
                    id: `v_corridor_${columnIndex}_${i}`,
                    x: minX,
                    y: corridorY,
                    width: corridorSpan,
                    height: corridorWidth,
                    length: corridorSpan,
                    area: corridorSpan * corridorWidth,
                    type: 'vertical',
                    polygon: [
                        [minX, corridorY],
                        [maxX, corridorY],
                        [maxX, corridorY + corridorWidth],
                        [minX, corridorY + corridorWidth]
                    ]
                };

                corridors.push(corridor);
            }
        });

        console.log(`[Corridor Gen] Created ${corridors.length} corridor segments`);
        return corridors;
    }

    groupIlotsByColumns() {
        if (!this.ilots || this.ilots.length === 0) {
            return [];
        }

        const columns = {};
        const tolerance = 0.5;

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

        return Object.keys(columns)
            .map(Number)
            .sort((a, b) => a - b)
            .map(key => columns[key]);
    }
}

module.exports = ProductionCorridorGenerator;
