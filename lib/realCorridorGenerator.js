class RealCorridorGenerator {
    constructor(floorPlan, ilots) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;
        this.corridors = [];
    }

    generateCorridors(corridorWidth = 1.2) {
        this.corridors = [];
        
        if (!this.ilots || this.ilots.length < 2) {
            return this.corridors;
        }

        // Connect each ilot to its nearest neighbors
        for (let i = 0; i < this.ilots.length; i++) {
            const ilot = this.ilots[i];
            const nearestIlots = this.findNearestIlots(ilot, 3);
            
            nearestIlots.forEach(targetIlot => {
                const corridor = this.createCorridor(ilot, targetIlot, corridorWidth);
                if (corridor) {
                    this.corridors.push(corridor);
                }
            });
        }

        return this.corridors;
    }

    findNearestIlots(sourceIlot, maxCount) {
        const distances = this.ilots
            .filter(ilot => ilot.id !== sourceIlot.id)
            .map(ilot => ({
                ilot: ilot,
                distance: this.calculateDistance(sourceIlot, ilot)
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, maxCount);

        return distances.map(d => d.ilot);
    }

    calculateDistance(ilot1, ilot2) {
        const centerX1 = ilot1.x + (ilot1.width || 0) / 2;
        const centerY1 = ilot1.y + (ilot1.height || 0) / 2;
        const centerX2 = ilot2.x + (ilot2.width || 0) / 2;
        const centerY2 = ilot2.y + (ilot2.height || 0) / 2;
        
        return Math.sqrt(Math.pow(centerX2 - centerX1, 2) + Math.pow(centerY2 - centerY1, 2));
    }

    createCorridor(ilot1, ilot2, width) {
        const center1 = {
            x: ilot1.x + (ilot1.width || 0) / 2,
            y: ilot1.y + (ilot1.height || 0) / 2
        };
        const center2 = {
            x: ilot2.x + (ilot2.width || 0) / 2,
            y: ilot2.y + (ilot2.height || 0) / 2
        };

        // Create rectangular corridor between centers
        const length = this.calculateDistance(ilot1, ilot2);
        const angle = Math.atan2(center2.y - center1.y, center2.x - center1.x);
        
        const halfWidth = width / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        // Calculate corridor polygon
        const polygon = [
            [center1.x - halfWidth * sin, center1.y + halfWidth * cos],
            [center1.x + halfWidth * sin, center1.y - halfWidth * cos],
            [center2.x + halfWidth * sin, center2.y - halfWidth * cos],
            [center2.x - halfWidth * sin, center2.y + halfWidth * cos]
        ];

        return {
            id: `corridor_${ilot1.id}_${ilot2.id}`,
            type: 'secondary',
            width: width,
            polygon: polygon,
            totalLength: length,
            area: length * width,
            start: center1,
            end: center2,
            connections: [ilot1.id, ilot2.id]
        };
    }

    optimizeCorridorNetwork() {
        // Remove duplicate corridors (same connection in reverse)
        const uniqueCorridors = [];
        const connections = new Set();

        for (const corridor of this.corridors) {
            const conn1 = `${corridor.connections[0]}_${corridor.connections[1]}`;
            const conn2 = `${corridor.connections[1]}_${corridor.connections[0]}`;
            
            if (!connections.has(conn1) && !connections.has(conn2)) {
                connections.add(conn1);
                uniqueCorridors.push(corridor);
            }
        }

        return uniqueCorridors;
    }
}

module.exports = RealCorridorGenerator;