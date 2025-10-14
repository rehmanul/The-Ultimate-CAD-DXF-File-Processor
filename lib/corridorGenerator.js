class CorridorGenerator {
    constructor(floorPlan, ilots) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;
        this.corridors = [];
        this.corridorWidth = 1.2; // meters
    }

    generateCorridors(width = 1.2) {
        this.corridorWidth = width;
        this.corridors = [];

        // Find îlot clusters and rows
        const clusters = this.findIlotClusters();
        const rows = this.identifyIlotRows(clusters);

        // Generate corridors between rows
        this.generateRowCorridors(rows);

        // Generate connecting corridors
        this.generateConnectingCorridors();

        // Generate access corridors to entrances
        this.generateAccessCorridors();

        return this.corridors;
    }

    findIlotClusters() {
        const clusters = [];
        const visited = new Set();

        this.ilots.forEach((ilot, index) => {
            if (visited.has(index)) return;

            const cluster = [];
            this.exploreCluster(index, cluster, visited);

            if (cluster.length > 0) {
                clusters.push(cluster);
            }
        });

        return clusters;
    }

    exploreCluster(ilotIndex, cluster, visited) {
        if (visited.has(ilotIndex)) return;

        visited.add(ilotIndex);
        cluster.push(this.ilots[ilotIndex]);

        // Find nearby îlots
        const currentIlot = this.ilots[ilotIndex];
        this.ilots.forEach((otherIlot, otherIndex) => {
            if (visited.has(otherIndex)) return;

            const distance = this.calculateDistance(
                { x: currentIlot.x + currentIlot.width / 2, y: currentIlot.y + currentIlot.height / 2 },
                { x: otherIlot.x + otherIlot.width / 2, y: otherIlot.y + otherIlot.height / 2 }
            );

            if (distance < 10) { // 10m clustering threshold
                this.exploreCluster(otherIndex, cluster, visited);
            }
        });
    }

    identifyIlotRows(clusters) {
        const rows = [];

        clusters.forEach(cluster => {
            // Sort îlots by Y coordinate to identify horizontal rows
            const sortedByY = [...cluster].sort((a, b) => a.y - b.y);

            let currentRow = [];
            let lastY = -Infinity;

            sortedByY.forEach(ilot => {
                if (Math.abs(ilot.y - lastY) > 5) { // 5m row separation threshold
                    if (currentRow.length > 1) {
                        rows.push(currentRow);
                    }
                    currentRow = [ilot];
                    lastY = ilot.y;
                } else {
                    currentRow.push(ilot);
                }
            });

            if (currentRow.length > 1) {
                rows.push(currentRow);
            }
        });

        return rows;
    }

    generateRowCorridors(rows) {
        for (let i = 0; i < rows.length - 1; i++) {
            const row1 = rows[i];
            const row2 = rows[i + 1];

            if (this.rowsFaceEachOther(row1, row2)) {
                const corridor = this.createCorridorBetweenRows(row1, row2);
                if (corridor) {
                    this.corridors.push(corridor);
                }
            }
        }
    }

    rowsFaceEachOther(row1, row2) {
        const row1AvgY = row1.reduce((sum, ilot) => sum + ilot.y, 0) / row1.length;
        const row2AvgY = row2.reduce((sum, ilot) => sum + ilot.y, 0) / row2.length;

        return Math.abs(row1AvgY - row2AvgY) < 20; // 20m maximum separation
    }

    createCorridorBetweenRows(row1, row2) {
        // Calculate corridor bounds
        const row1Bounds = this.calculateRowBounds(row1);
        const row2Bounds = this.calculateRowBounds(row2);
        // Compute X overlap; corridor should span the overlapping X range of both rows
        const minX = Math.max(row1Bounds.minX, row2Bounds.minX);
        const maxX = Math.min(row1Bounds.maxX, row2Bounds.maxX);

        if (minX >= maxX) return null; // No horizontal overlap

        // Determine vertical gap between rows (closest edges)
        const gap = row2Bounds.minY - row1Bounds.maxY;
        if (gap <= 0) return null; // overlapping rows, no corridor

        // If gap smaller than corridor width, we must expand corridor area to accommodate
        if (gap < this.corridorWidth) {
            // center between rows but set height to corridorWidth
            const corridorY = (row1Bounds.maxY + row2Bounds.minY) / 2 - this.corridorWidth / 2;
            return {
                id: this.corridors.length + 1,
                type: 'main',
                x: minX,
                y: corridorY,
                width: maxX - minX,
                height: this.corridorWidth,
                area: (maxX - minX) * this.corridorWidth,
                connects: [row1, row2]
            };
        }

        // Normal corridor
        const corridorY = row1Bounds.maxY;
        return {
            id: this.corridors.length + 1,
            type: 'main',
            x: minX,
            y: corridorY,
            width: maxX - minX,
            height: gap,
            area: (maxX - minX) * gap,
            connects: [row1, row2]
        };
    }

    calculateRowBounds(row) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        row.forEach(ilot => {
            minX = Math.min(minX, ilot.x);
            maxX = Math.max(maxX, ilot.x + ilot.width);
            minY = Math.min(minY, ilot.y);
            maxY = Math.max(maxY, ilot.y + ilot.height);
        });

        return { minX, maxX, minY, maxY };
    }

    generateConnectingCorridors() {
        const mainCorridors = this.corridors.filter(c => c.type === 'main');

        // Create perpendicular connecting corridors
        for (let i = 0; i < mainCorridors.length - 1; i++) {
            const corridor1 = mainCorridors[i];
            const corridor2 = mainCorridors[i + 1];

            const connector = this.createConnectingCorridor(corridor1, corridor2);
            if (connector) {
                this.corridors.push(connector);
            }
        }
    }

    createConnectingCorridor(corridor1, corridor2) {
        // Find best connection points
        const connection1 = this.findConnectionPoint(corridor1);
        const connection2 = this.findConnectionPoint(corridor2);

        if (!connection1 || !connection2) return null;

        // Create L-shaped or straight connector
        if (Math.abs(connection1.x - connection2.x) < this.corridorWidth) {
            // Vertical connector
            return {
                id: this.corridors.length + 1,
                type: 'connecting',
                x: connection1.x - this.corridorWidth / 2,
                y: Math.min(connection1.y, connection2.y),
                width: this.corridorWidth,
                height: Math.abs(connection1.y - connection2.y),
                area: this.corridorWidth * Math.abs(connection1.y - connection2.y)
            };
        } else {
            // L-shaped connector (simplified to horizontal for demo)
            return {
                id: this.corridors.length + 1,
                type: 'connecting',
                x: Math.min(connection1.x, connection2.x),
                y: connection1.y - this.corridorWidth / 2,
                width: Math.abs(connection1.x - connection2.x),
                height: this.corridorWidth,
                area: Math.abs(connection1.x - connection2.x) * this.corridorWidth
            };
        }
    }

    findConnectionPoint(corridor) {
        // Find optimal connection point on corridor
        return {
            x: corridor.x + corridor.width / 2,
            y: corridor.y + corridor.height / 2
        };
    }

    generateAccessCorridors() {
        this.floorPlan.entrances.forEach((entrance, index) => {
            const accessCorridor = this.createAccessCorridor(entrance, index);
            if (accessCorridor) {
                this.corridors.push(accessCorridor);
            }
        });
    }

    createAccessCorridor(entrance, index) {
        // Find nearest main corridor
        const nearestCorridor = this.findNearestCorridor(entrance);
        if (!nearestCorridor) return null;

        const entranceCenter = {
            x: (entrance.start.x + entrance.end.x) / 2,
            y: (entrance.start.y + entrance.end.y) / 2
        };

        const corridorCenter = {
            x: nearestCorridor.x + nearestCorridor.width / 2,
            y: nearestCorridor.y + nearestCorridor.height / 2
        };

        // Create straight access corridor
        const distance = this.calculateDistance(entranceCenter, corridorCenter);
        const angle = Math.atan2(corridorCenter.y - entranceCenter.y, corridorCenter.x - entranceCenter.x);

        return {
            id: this.corridors.length + 1,
            type: 'access',
            x: entranceCenter.x,
            y: entranceCenter.y - this.corridorWidth / 2,
            width: distance,
            height: this.corridorWidth,
            area: distance * this.corridorWidth,
            angle: angle,
            connects: ['entrance', nearestCorridor.id]
        };
    }

    findNearestCorridor(entrance) {
        const entranceCenter = {
            x: (entrance.start.x + entrance.end.x) / 2,
            y: (entrance.start.y + entrance.end.y) / 2
        };

        let nearestCorridor = null;
        let minDistance = Infinity;

        this.corridors.forEach(corridor => {
            if (corridor.type === 'main') {
                const corridorCenter = {
                    x: corridor.x + corridor.width / 2,
                    y: corridor.y + corridor.height / 2
                };

                const distance = this.calculateDistance(entranceCenter, corridorCenter);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestCorridor = corridor;
                }
            }
        });

        return nearestCorridor;
    }

    calculateDistance(point1, point2) {
        const dx = point1.x - point2.x;
        const dy = point1.y - point2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    optimizeCorridorNetwork() {
        // Remove redundant corridors
        this.removeRedundantCorridors();

        // Merge adjacent corridors
        this.mergeAdjacentCorridors();

        // Ensure minimum width requirements
        this.enforceMinimumWidths();

        return this.corridors;
    }

    removeRedundantCorridors() {
        const toRemove = [];

        for (let i = 0; i < this.corridors.length; i++) {
            for (let j = i + 1; j < this.corridors.length; j++) {
                if (this.corridorsOverlap(this.corridors[i], this.corridors[j])) {
                    // Keep the larger corridor
                    if (this.corridors[i].area < this.corridors[j].area) {
                        toRemove.push(i);
                    } else {
                        toRemove.push(j);
                    }
                }
            }
        }

        // Remove duplicates and sort in descending order
        const uniqueIndices = [...new Set(toRemove)].sort((a, b) => b - a);
        uniqueIndices.forEach(index => {
            this.corridors.splice(index, 1);
        });
    }

    corridorsOverlap(corridor1, corridor2) {
        return !(corridor1.x + corridor1.width <= corridor2.x ||
            corridor2.x + corridor2.width <= corridor1.x ||
            corridor1.y + corridor1.height <= corridor2.y ||
            corridor2.y + corridor2.height <= corridor1.y);
    }

    mergeAdjacentCorridors() {
        let merged = true;

        while (merged) {
            merged = false;

            for (let i = 0; i < this.corridors.length - 1; i++) {
                for (let j = i + 1; j < this.corridors.length; j++) {
                    if (this.canMergeCorridors(this.corridors[i], this.corridors[j])) {
                        this.corridors[i] = this.mergeCorridors(this.corridors[i], this.corridors[j]);
                        this.corridors.splice(j, 1);
                        merged = true;
                        break;
                    }
                }
                if (merged) break;
            }
        }
    }

    canMergeCorridors(corridor1, corridor2) {
        // Check if corridors are adjacent and aligned
        const tolerance = 0.1;

        // Horizontal alignment
        if (Math.abs(corridor1.y - corridor2.y) < tolerance &&
            Math.abs(corridor1.height - corridor2.height) < tolerance) {
            return Math.abs(corridor1.x + corridor1.width - corridor2.x) < tolerance ||
                Math.abs(corridor2.x + corridor2.width - corridor1.x) < tolerance;
        }

        // Vertical alignment
        if (Math.abs(corridor1.x - corridor2.x) < tolerance &&
            Math.abs(corridor1.width - corridor2.width) < tolerance) {
            return Math.abs(corridor1.y + corridor1.height - corridor2.y) < tolerance ||
                Math.abs(corridor2.y + corridor2.height - corridor1.y) < tolerance;
        }

        return false;
    }

    mergeCorridors(corridor1, corridor2) {
        const minX = Math.min(corridor1.x, corridor2.x);
        const minY = Math.min(corridor1.y, corridor2.y);
        const maxX = Math.max(corridor1.x + corridor1.width, corridor2.x + corridor2.width);
        const maxY = Math.max(corridor1.y + corridor1.height, corridor2.y + corridor2.height);

        return {
            id: corridor1.id,
            type: corridor1.type,
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            area: (maxX - minX) * (maxY - minY)
        };
    }

    enforceMinimumWidths() {
        this.corridors.forEach(corridor => {
            if (corridor.width < this.corridorWidth && corridor.height >= corridor.width) {
                // Vertical corridor - adjust width
                corridor.x -= (this.corridorWidth - corridor.width) / 2;
                corridor.width = this.corridorWidth;
            } else if (corridor.height < this.corridorWidth && corridor.width >= corridor.height) {
                // Horizontal corridor - adjust height
                corridor.y -= (this.corridorWidth - corridor.height) / 2;
                corridor.height = this.corridorWidth;
            }

            corridor.area = corridor.width * corridor.height;
        });
    }
}

module.exports = CorridorGenerator;