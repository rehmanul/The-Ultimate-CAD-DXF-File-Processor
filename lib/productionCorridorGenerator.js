/**
 * Production-Grade Corridor Generator
 * Creates corridors between facing rows of ilots
 * Ensures corridors touch both rows and never cut through ilots
 */
class ProductionCorridorGenerator {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;
        this.corridorWidth = options.corridorWidth || 1.2;
    }

    /**
     * Generate corridors between rows of ilots
     * @returns {Array} Corridor polygons with metadata
     */
    generateCorridors() {
        console.log(`[Production Corridor] Generating corridors for ${this.ilots.length} ilots`);

        if (this.ilots.length === 0) {
            console.warn('[Production Corridor] No ilots to connect');
            return [];
        }

        // Group ilots by row
        const rows = this._groupIlotsIntoRows();
        console.log(`[Production Corridor] Found ${rows.length} rows`);

        if (rows.length < 2) {
            console.warn('[Production Corridor] Need at least 2 rows for corridors');
            return [];
        }

        // Generate corridors between adjacent rows
        const corridors = [];
        for (let i = 0; i < rows.length - 1; i++) {
            const row1 = rows[i];
            const row2 = rows[i + 1];

            const corridor = this._createCorridorBetweenRows(row1, row2);
            if (corridor) {
                corridors.push(corridor);
            }
        }

        console.log(`[Production Corridor] Generated ${corridors.length} corridors`);
        return corridors;
    }

    /**
     * Group ilots into horizontal rows based on Y position
     */
    _groupIlotsIntoRows() {
        if (this.ilots.length === 0) return [];

        // Sort by Y position
        const sorted = [...this.ilots].sort((a, b) => a.y - b.y);
        console.log(`[Corridor Debug] Sorted ilots Y range: ${sorted[0].y.toFixed(2)} to ${sorted[sorted.length - 1].y.toFixed(2)}`);

        const rows = [];
        let currentRow = [sorted[0]];
        let currentY = sorted[0].y;
        const tolerance = 3.0; // 3m tolerance for same row (increased from 1m)

        for (let i = 1; i < sorted.length; i++) {
            const ilot = sorted[i];

            if (Math.abs(ilot.y - currentY) <= tolerance) {
                // Same row
                currentRow.push(ilot);
            } else {
                // New row
                rows.push({
                    ilots: currentRow.sort((a, b) => a.x - b.x),
                    y: currentY,
                    avgY: currentRow.reduce((sum, i) => sum + i.y, 0) / currentRow.length
                });
                currentRow = [ilot];
                currentY = ilot.y;
            }
        }

        // Add last row
        if (currentRow.length > 0) {
            rows.push({
                ilots: currentRow.sort((a, b) => a.x - b.x),
                y: currentY,
                avgY: currentRow.reduce((sum, i) => sum + i.y, 0) / currentRow.length
            });
        }

        console.log(`[Corridor Debug] Grouped into ${rows.length} rows:`, rows.map(r => `Row@Y=${r.avgY.toFixed(2)} (${r.ilots.length} ilots)`).join(', '));
        return rows;
    }

    /**
     * Create corridor between two facing rows
     */
    _createCorridorBetweenRows(row1, row2) {
        // Calculate row boundaries
        const row1Bottom = Math.max(...row1.ilots.map(i => i.y + i.height));
        const row2Top = Math.min(...row2.ilots.map(i => i.y));

        const gap = row2Top - row1Bottom;
        console.log(`[Corridor Debug] Row gap: ${gap.toFixed(2)}m (row1Bottom=${row1Bottom.toFixed(2)}, row2Top=${row2Top.toFixed(2)})`);

        if (gap < 0.5) {
            console.warn('[Production Corridor] Insufficient gap between rows:', gap);
            return null;
        }

        // Calculate corridor horizontal extent
        const leftMost = Math.min(
            ...row1.ilots.map(i => i.x),
            ...row2.ilots.map(i => i.x)
        );
        const rightMost = Math.max(
            ...row1.ilots.map(i => i.x + i.width),
            ...row2.ilots.map(i => i.x + i.width)
        );

        // Create corridor polygon that touches both rows
        const polygon = [
            [leftMost, row1Bottom],
            [rightMost, row1Bottom],
            [rightMost, row2Top],
            [leftMost, row2Top]
        ];

        const area = (rightMost - leftMost) * gap;

        return {
            type: 'horizontal',
            polygon: polygon,
            area: area,
            width: gap,
            length: rightMost - leftMost,
            row1: row1.ilots.map(i => i.id),
            row2: row2.ilots.map(i => i.id),
            touches: {
                row1Bottom: row1Bottom,
                row2Top: row2Top
            }
        };
    }
}

module.exports = ProductionCorridorGenerator;
