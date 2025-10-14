class IntelligentIlotGenerator {
    constructor(floorPlan) {
        this.floorPlan = floorPlan;
        this.sizeRanges = {
            '0-1': { min: 0.5, max: 1.0 },
            '1-3': { min: 1.0, max: 3.0 },
            '3-5': { min: 3.0, max: 5.0 },
            '5-10': { min: 5.0, max: 10.0 }
        };
        this.minWallDistance = 0.1;
        this.minEntranceDistance = 1.0;
        this.minIlotDistance = 0.5;
        try {
            const createRng = require('./seededRng');
            this.rng = (floorPlan && floorPlan.seed != null) ? createRng(Number(floorPlan.seed)) : Math.random;
        } catch (e) {
            this.rng = Math.random;
        }
    }

    generateIlots(distribution) {
        const coverage = 0.3;
        const minDistance = 0.5;

        const totalArea = this.calculateAvailableArea();
        const targetIlotArea = totalArea * coverage;

        const ilots = this.generateIlotsBySize(distribution, targetIlotArea);
        const placedIlots = this.placeIlots(ilots, minDistance);

        return placedIlots;
    }

    calculateAvailableArea() {
        const bounds = this.floorPlan.bounds;
        let totalArea = Math.abs((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));

        // Convert from CAD units to m² if needed
        if (totalArea > 1000000) {
            totalArea = totalArea / 1000000; // mm² to m²
        } else if (totalArea > 10000) {
            totalArea = totalArea / 10000; // cm² to m²
        }

        return Math.max(totalArea * 0.7, 50);
    }

    generateIlotsBySize(sizeDistribution, targetArea) {
        const ilots = [];

        Object.entries(sizeDistribution).forEach(([sizeRange, percentage]) => {
            const rangeArea = targetArea * percentage;
            const range = this.sizeRanges[sizeRange];

            if (!range || rangeArea <= 0) return;

            const avgSize = (range.min + range.max) / 2;
            const count = Math.floor(rangeArea / avgSize);

            for (let i = 0; i < count; i++) {
                const area = range.min + this.rng() * (range.max - range.min);
                const aspectRatio = 0.6 + this.rng() * 0.8;

                const width = Math.sqrt(area / aspectRatio);
                const height = area / width;

                ilots.push({
                    id: `ilot_${ilots.length + 1}`,
                    width: width,
                    height: height,
                    area: area,
                    capacity: Math.ceil(area * 1.5),
                    type: this.getIlotType(area),
                    placed: false
                });
            }
        });

        return ilots;
    }

    getIlotType(area) {
        if (area < 1) return 'single';
        if (area < 3) return 'double';
        if (area < 5) return 'team';
        return 'meeting';
    }

    placeIlots(ilots, minDistance) {
        const placedIlots = [];
        const bounds = this.floorPlan.bounds;
        const gridSize = 0.2;

        const sortedIlots = [...ilots].sort((a, b) => b.area - a.area);

        for (const ilot of sortedIlots) {
            const position = this.findValidPosition(ilot, placedIlots, gridSize, minDistance);

            if (position) {
                const placedIlot = {
                    ...ilot,
                    x: position.x,
                    y: position.y,
                    placed: true,
                    isValid: true
                };
                placedIlots.push(placedIlot);
            }
        }

        return placedIlots;
    }

    findValidPosition(ilot, placedIlots, gridSize, minDistance) {
        const bounds = this.floorPlan.bounds;
        const maxAttempts = 500;

        // Use appropriate grid size for CAD coordinates
        const cadGridSize = Math.max(gridSize, (bounds.maxX - bounds.minX) / 100);

        // Try systematic placement first
        for (let attempts = 0; attempts < maxAttempts; attempts++) {
            const x = bounds.minX + this.rng() * (bounds.maxX - bounds.minX - ilot.width);
            const y = bounds.minY + this.rng() * (bounds.maxY - bounds.minY - ilot.height);
            const position = { x, y };

            if (this.isValidPosition(ilot, position, placedIlots, minDistance)) {
                return position;
            }
        }

        return null;
    }

    isValidPosition(ilot, position, placedIlots, minDistance) {
        const ilotRect = {
            x1: position.x,
            y1: position.y,
            x2: position.x + ilot.width,
            y2: position.y + ilot.height
        };

        if (ilotRect.x1 < this.floorPlan.bounds.minX || ilotRect.x2 > this.floorPlan.bounds.maxX ||
            ilotRect.y1 < this.floorPlan.bounds.minY || ilotRect.y2 > this.floorPlan.bounds.maxY) {
            return false;
        }

        if (this.floorPlan.forbiddenZones) {
            for (const zone of this.floorPlan.forbiddenZones) {
                if (this.rectangleIntersectsPolygon(ilotRect, zone.polygon)) {
                    return false;
                }
            }
        }

        if (this.floorPlan.entrances) {
            for (const zone of this.floorPlan.entrances) {
                if (this.rectangleNearPolygon(ilotRect, zone.polygon, this.minEntranceDistance)) {
                    return false;
                }
            }
        }

        for (const placedIlot of placedIlots) {
            const otherRect = {
                x1: placedIlot.x,
                y1: placedIlot.y,
                x2: placedIlot.x + placedIlot.width,
                y2: placedIlot.y + placedIlot.height
            };

            if (this.rectanglesOverlapWithDistance(ilotRect, otherRect, minDistance)) {
                return false;
            }
        }

        return true;
    }

    rectangleIntersectsPolygon(rect, polygon) {
        if (!polygon || polygon.length < 3) return false;

        const corners = [
            [rect.x1, rect.y1], [rect.x2, rect.y1],
            [rect.x2, rect.y2], [rect.x1, rect.y2]
        ];

        for (const corner of corners) {
            if (this.pointInPolygon(corner, polygon)) {
                return true;
            }
        }

        for (const vertex of polygon) {
            if (vertex[0] >= rect.x1 && vertex[0] <= rect.x2 &&
                vertex[1] >= rect.y1 && vertex[1] <= rect.y2) {
                return true;
            }
        }

        return false;
    }

    rectangleNearPolygon(rect, polygon, distance) {
        if (!polygon || polygon.length < 3) return false;

        const expandedRect = {
            x1: rect.x1 - distance,
            y1: rect.y1 - distance,
            x2: rect.x2 + distance,
            y2: rect.y2 + distance
        };

        return this.rectangleIntersectsPolygon(expandedRect, polygon);
    }

    rectanglesOverlapWithDistance(rect1, rect2, distance) {
        return !(rect1.x2 + distance <= rect2.x1 ||
            rect2.x2 + distance <= rect1.x1 ||
            rect1.y2 + distance <= rect2.y1 ||
            rect2.y2 + distance <= rect1.y1);
    }

    pointInPolygon(point, polygon) {
        const x = point[0], y = point[1];
        let inside = false;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i][0], yi = polygon[i][1];
            const xj = polygon[j][0], yj = polygon[j][1];

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    }

    optimizeLayout() {
        return this.ilots || [];
    }
}

module.exports = IntelligentIlotGenerator;