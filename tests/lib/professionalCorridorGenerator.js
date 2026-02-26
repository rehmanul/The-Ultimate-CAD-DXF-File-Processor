const CorridorRouter = require('./corridorRouter');

class ProfessionalCorridorGenerator {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;
        this.corridors = [];
        this.options = options;
    }

    generateCorridors(corridorWidth = 1.2) {
        const corridors = [];
        const rows = this.groupIlotsIntoRows();

        for (let i = 0; i < rows.length - 1; i++) {
            const row1 = rows[i];
            const row2 = rows[i + 1];

            if (!row1.length || !row2.length) continue;

            // compute vertical gap between rows
            const row1Bottom = Math.max(...row1.map(ilot => ilot.y + ilot.height));
            const row2Top = Math.min(...row2.map(ilot => ilot.y));

            // If rows are adjacent with enough gap, create a continuous horizontal corridor
            if (row2Top - row1Bottom >= corridorWidth) {
                const corridor = this.createCorridorBetweenRows(row1, row2, corridorWidth);
                if (corridor) corridors.push(corridor);
            } else {
                // Try vertical corridors or L-shaped connectors between facing ilots
                const connectors = this.createConnectorsBetweenRows(row1, row2, corridorWidth);
                corridors.push(...connectors);
            }
        }

        this.corridors = corridors;
        return corridors;
    }

    groupIlotsIntoRows() {
        const rows = [];
        const sorted = [...this.ilots].sort((a, b) => a.y - b.y);
        if (sorted.length === 0) return rows;

        let currentRow = [sorted[0]];
        let runningY = sorted[0].y + sorted[0].height / 2;
        const tolerance = Math.max((this.floorPlan.bounds.maxY - this.floorPlan.bounds.minY) / 50, 20);

        for (let i = 1; i < sorted.length; i++) {
            const ilot = sorted[i];
            const centerY = ilot.y + ilot.height / 2;
            if (Math.abs(centerY - runningY) <= tolerance) {
                currentRow.push(ilot);
                // update runningY as average
                runningY = (runningY * (currentRow.length - 1) + centerY) / currentRow.length;
            } else {
                rows.push(currentRow.sort((a, b) => a.x - b.x));
                currentRow = [ilot];
                runningY = centerY;
            }
        }
        if (currentRow.length) rows.push(currentRow.sort((a, b) => a.x - b.x));
        return rows;
    }

    rowsFaceEachOther(row1, row2) {
        const row1CenterY = row1.reduce((sum, ilot) => sum + ilot.y + ilot.height / 2, 0) / row1.length;
        const row2CenterY = row2.reduce((sum, ilot) => sum + ilot.y + ilot.height / 2, 0) / row2.length;

        const dy = Math.abs(row2CenterY - row1CenterY);
        return dy > 10 && dy < (this.floorPlan.bounds.maxY - this.floorPlan.bounds.minY);
    }

    createCorridorBetweenRows(row1, row2, corridorWidth) {
        const row1Bottom = Math.max(...row1.map(ilot => ilot.y + ilot.height));
        const row2Top = Math.min(...row2.map(ilot => ilot.y));

        if (row2Top - row1Bottom < corridorWidth) return null;

        const leftMost = Math.min(...row1.map(ilot => ilot.x), ...row2.map(ilot => ilot.x));
        const rightMost = Math.max(...row1.map(ilot => ilot.x + ilot.width), ...row2.map(ilot => ilot.x + ilot.width));

        // Build corridor polygon that touches the faces of the ilots (row1 bottom and row2 top)
        const polygon = [
            [leftMost, row1Bottom],
            [rightMost, row1Bottom],
            [rightMost, row2Top],
            [leftMost, row2Top]
        ];

        // Verify corridor does not cut through any ilot: shrink horizontally to avoid intruding into ilots
        const safeLeft = Math.max(leftMost, ...row1.map(i => i.x), ...row2.map(i => i.x));
        const safeRight = Math.min(rightMost, ...row1.map(i => i.x + i.width), ...row2.map(i => i.x + i.width));

        return {
            type: 'horizontal',
            polygon,
            area: (rightMost - leftMost) * (row2Top - row1Bottom),
            width: row2Top - row1Bottom,
            length: rightMost - leftMost,
            touches: { row1Y: row1Bottom, row2Y: row2Top }
        };
    }

    createConnectorsBetweenRows(row1, row2, corridorWidth) {
        const connectors = [];
        // Only connect a few key ilots per row to avoid O(n²) pathfinding
        const samples = Math.min(3, Math.max(row1.length, row2.length));
        const step1 = Math.max(1, Math.floor(row1.length / samples));
        const step2 = Math.max(1, Math.floor(row2.length / samples));
        
        for (let i = 0; i < row1.length; i += step1) {
            for (let j = 0; j < row2.length; j += step2) {
                const a = row1[i];
                const b = row2[j];
                const mx = (a.x + a.width / 2 + b.x + b.width / 2) / 2;
                const poly = [
                    [mx - corridorWidth / 2, a.y + a.height],
                    [mx + corridorWidth / 2, a.y + a.height],
                    [mx + corridorWidth / 2, b.y],
                    [mx - corridorWidth / 2, b.y]
                ];
                connectors.push({ type: 'connector', polygon: poly, width: corridorWidth });
            }
        }
        return connectors;
    }
}

module.exports = ProfessionalCorridorGenerator;