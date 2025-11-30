class ProductionCorridorGenerator {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;
        this.margin = options.margin || 0.5;
        this.corridorWidth = options.corridorWidth || 1.2;
    }

    groupIlotsByColumns() {
        const columns = {};
        for (const ilot of this.ilots) {
            const colKey = Math.round(ilot.x * 100) / 100; // Round to 2 decimal places
            if (!columns[colKey]) {
                columns[colKey] = [];
            }
            columns[colKey].push(ilot);
        }
        return Object.values(columns);
    }

    generateCorridors() {
        const corridors = [];
        // Group ilots by columns
        const columnGroups = this.groupIlotsByColumns();
        for (const column of columnGroups) {
            // Sort ilots in column by y position
            column.sort((a, b) => a.y - b.y);
            for (let i = 0; i < column.length - 1; i++) {
                const ilot1 = column[i];
                const ilot2 = column[i + 1];
                // Calculate gap between ilots in the same column
                const ilot1Bottom = ilot1.y + ilot1.height;
                const ilot2Top = ilot2.y;
                const gap = ilot2Top - ilot1Bottom;
                if (gap > this.margin) { // Only create corridor if gap is larger than margin
                    // Find left and right extents
                    const leftMost = Math.min(ilot1.x, ilot2.x);
                    const rightMost = Math.max(ilot1.x + ilot1.width, ilot2.x + ilot2.width);
                    const availableGap = gap - this.margin;
                    if (availableGap <= 0) {
                        continue;
                    }
                    // Clamp corridor height so it never exceeds the available clearance
                    const corridorHeight = Math.min(this.corridorWidth, availableGap);
                    // Offset corridor so it respects margin from the lower ilot while staying within the gap
                    const desiredOffset = Math.max(this.margin, (gap - corridorHeight) / 2);
                    const maxOffset = Math.max(0, ilot2Top - ilot1Bottom - corridorHeight);
                    const corridorY = ilot1Bottom + Math.min(desiredOffset, maxOffset);
                    const polygon = [
                        [leftMost, corridorY],
                        [rightMost, corridorY],
                        [rightMost, corridorY + corridorHeight],
                        [leftMost, corridorY + corridorHeight]
                    ];
                    corridors.push({
                        id: `corridor_${corridors.length + 1}`,
                        polygon: polygon,
                        area: (rightMost - leftMost) * corridorHeight,
                        width: rightMost - leftMost,
                        length: rightMost - leftMost,
                        height: corridorHeight,
                        x: leftMost,
                        y: corridorY
                    });
                }
            }
        }
        // Merge adjacent aligned corridors
        return this._mergeCorridors(corridors);
    }

    _mergeCorridors(corridors) {
        if (corridors.length < 2) return corridors;

        // Sort by Y (primary) and X (secondary)
        corridors.sort((a, b) => {
            if (Math.abs(a.y - b.y) > 0.01) return a.y - b.y;
            return a.x - b.x;
        });

        const merged = [];
        let current = corridors[0];

        for (let i = 1; i < corridors.length; i++) {
            const next = corridors[i];

            // Check if aligned and close enough to merge
            // Allow bridging gaps up to 2.0 meters or 4x margin to create continuous corridors
            const maxGap = Math.max(2.0, this.margin * 4);
            const isAligned = Math.abs(current.y - next.y) < 0.01 && Math.abs(current.height - next.height) < 0.01;
            const isAdjacent = next.x <= current.x + current.width + maxGap;

            if (isAligned && isAdjacent) {
                // Merge
                const newWidth = (next.x + next.width) - current.x;
                current.width = newWidth;
                current.length = newWidth; // Update length
                current.area = current.width * current.height;

                // Update polygon
                current.polygon = [
                    [current.x, current.y],
                    [current.x + current.width, current.y],
                    [current.x + current.width, current.y + current.height],
                    [current.x, current.y + current.height]
                ];
            } else {
                merged.push(current);
                current = next;
            }
        }
        merged.push(current);
        return merged;
    }
}

module.exports = ProductionCorridorGenerator;
