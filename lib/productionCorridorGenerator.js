class ProductionCorridorGenerator {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;
        this.margin = options.margin || 0.5;
        this.corridorWidth = options.corridorWidth || 1.2;
    }

    groupIlotsByRows() {
        const rows = {};
        for (const ilot of this.ilots) {
            const rowKey = Math.round(ilot.y * 100) / 100; // Round to 2 decimal places
            if (!rows[rowKey]) {
                rows[rowKey] = [];
            }
            rows[rowKey].push(ilot);
        }
        return Object.values(rows);
    }

    generateCorridors() {
        const corridors = [];
        // Group ilots by rows
        const rowGroups = this.groupIlotsByRows();
        for (const row of rowGroups) {
            // Sort ilots in row by x position
            row.sort((a, b) => a.x - b.x);
            for (let i = 0; i < row.length - 1; i++) {
                const col1 = row[i];
                const col2 = row[i + 1];
                // Calculate gap between columns
                const col1Right = col1.x + col1.width;
                const col2Left = col2.x;
                const gap = col2Left - col1Right;
                if (gap > 0) {
                    // Find top and bottom extents
                    const topMost = Math.min(col1.y, col2.y);
                    const bottomMost = Math.max(col1.y + col1.height, col2.y + col2.height);
                    // Center the corridor in the gap to prevent overlap
                    const corridorX = col1Right + (gap - this.corridorWidth) / 2;
                    const corridorWidth = this.corridorWidth;
                    const polygon = [
                        [corridorX, topMost],
                        [corridorX + corridorWidth, topMost],
                        [corridorX + corridorWidth, bottomMost],
                        [corridorX, bottomMost]
                    ];
                    corridors.push({
                        id: `corridor_${corridors.length + 1}`,
                        polygon: polygon,
                        area: corridorWidth * (bottomMost - topMost),
                        width: corridorWidth,
                        height: bottomMost - topMost,
                        x: corridorX,
                        y: topMost
                    });
                }
            }
        }
        return corridors;
    }
}

module.exports = ProductionCorridorGenerator;
