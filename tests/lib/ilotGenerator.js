class IlotGenerator {
    constructor(floorPlan) {
        this.floorPlan = floorPlan;
        this.ilots = [];
        this.corridorWidth = 1.2; // meters
        try {
            const createRng = require('./seededRng');
            this.rng = (floorPlan && floorPlan.seed != null) ? createRng(Number(floorPlan.seed)) : Math.random;
        } catch (e) {
            this.rng = Math.random;
        }
    }

    generateIlots(distribution) {
        console.log('[IlotGenerator] Starting generation...');
        this.ilots = [];
        const totalArea = this.calculateAvailableArea();
        console.log(`[IlotGenerator] Total available area: ${totalArea.toFixed(2)} m²`);

        // Calculate îlot counts based on distribution
        const ilotCounts = this.calculateIlotCounts(distribution, totalArea);
        console.log('[IlotGenerator] Target counts:', JSON.stringify(ilotCounts));

        // Generate îlots for each size category
        Object.entries(ilotCounts).forEach(([sizeRange, count]) => {
            console.log(`[IlotGenerator] Generating ${count} ilots for range ${sizeRange}`);
            const [minSize, maxSize] = this.parseSizeRange(sizeRange);

            for (let i = 0; i < count; i++) {
                const area = minSize + this.rng() * (maxSize - minSize);
                const dimensions = this.calculateDimensions(area);
                const position = this.findValidPosition(dimensions);

                if (position) {
                    this.ilots.push({
                        id: this.ilots.length + 1,
                        area: area,
                        width: dimensions.width,
                        height: dimensions.height,
                        x: position.x,
                        y: position.y,
                        type: this.classifyIlotType(area),
                        capacity: Math.ceil(area / 6) // 6m² per person
                    });
                } else {
                    // console.log(`[IlotGenerator] Failed to place ilot of size ${area.toFixed(2)}`);
                }
            }
        });

        console.log(`[IlotGenerator] Successfully placed ${this.ilots.length} ilots`);
        return this.ilots;
    }

    calculateAvailableArea() {
        const fs = require('fs');
        const path = require('path');
        const log = (msg) => fs.appendFileSync('ilot_debug.log', msg + '\n');

        log(`[CalculateAvailableArea] Checking ${this.floorPlan.rooms.length} rooms`);
        let totalArea = 0;

        this.floorPlan.rooms.forEach((room, idx) => {
            const forbidden = this.isRoomForbidden(room);
            const usable = room.area * 0.7;
            log(`[Room ${idx}] Area: ${room.area}, Forbidden: ${forbidden}, Usable: ${usable}`);
            if (!forbidden) {
                totalArea += usable;
            }
        });

        log(`[CalculateAvailableArea] Total: ${totalArea}`);
        return totalArea;
    }

    calculateIlotCounts(distribution, totalArea) {
        const counts = {};
        const totalIlots = Math.max(0, Math.floor(totalArea / 8)); // Average 8m^2 per ilot
        const entries = Object.entries(distribution || {});

        if (totalIlots === 0 || entries.length === 0) {
            entries.forEach(([sizeRange]) => {
                counts[sizeRange] = 0;
            });
            return counts;
        }

        const allocations = entries.map(([sizeRange, percentage]) => {
            const pct = Number(percentage) || 0;
            const raw = (totalIlots * pct) / 100;
            const count = Math.floor(raw);
            return {
                sizeRange,
                percentage: pct,
                count,
                remainder: raw - count
            };
        });

        let allocated = allocations.reduce((sum, item) => sum + item.count, 0);
        const remainderOrder = allocations
            .slice()
            .sort((a, b) => (b.remainder - a.remainder) || (b.percentage - a.percentage));

        let idx = 0;
        while (allocated < totalIlots) {
            remainderOrder[idx % remainderOrder.length].count += 1;
            allocated += 1;
            idx += 1;
        }

        allocations.forEach((item) => {
            counts[item.sizeRange] = item.count;
        });

        return counts;
    }

    parseSizeRange(sizeRange) {
        const match = sizeRange.match(/(\d+)-(\d+)/);
        if (match) {
            return [parseInt(match[1]), parseInt(match[2])];
        }
        return [1, 10]; // Default range
    }

    calculateDimensions(area) {
        // Optimize for rectangular shapes with good proportions
        const aspectRatio = 1.2 + this.rng() * 0.8; // 1.2 to 2.0
        const width = Math.sqrt(area * aspectRatio);
        const height = area / width;

        return { width, height };
    }

    findValidPosition(dimensions) {
        const maxAttempts = 100;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const room = this.selectRandomRoom();
            if (!room) continue;

            const x = room.bounds.minX + this.rng() * (room.bounds.maxX - room.bounds.minX - dimensions.width);
            const y = room.bounds.minY + this.rng() * (room.bounds.maxY - room.bounds.minY - dimensions.height);

            if (this.isPositionValid(x, y, dimensions)) {
                return { x, y };
            }
        }

        return null;
    }

    selectRandomRoom() {
        const availableRooms = this.floorPlan.rooms.filter(room => !this.isRoomForbidden(room));
        if (availableRooms.length === 0) return null;

        return availableRooms[Math.floor(this.rng() * availableRooms.length)];
    }

    isPositionValid(x, y, dimensions) {
        const rect = {
            minX: x,
            minY: y,
            maxX: x + dimensions.width,
            maxY: y + dimensions.height
        };

        // Check collision with existing îlots
        for (const ilot of this.ilots) {
            if (this.rectanglesOverlap(rect, {
                minX: ilot.x,
                minY: ilot.y,
                maxX: ilot.x + ilot.width,
                maxY: ilot.y + ilot.height
            })) {
                return false;
            }
        }

        // Check distance from entrances
        for (const entrance of this.floorPlan.entrances) {
            if (this.distanceToLine(rect, entrance) < 2.0) { // 2m minimum distance
                return false;
            }
        }

        // Check forbidden zones
        for (const zone of this.floorPlan.forbiddenZones) {
            if (!zone) continue;
            if (Array.isArray(zone.polygon)) {
                if (this.rectangleIntersectsPolygon(rect, zone.polygon)) {
                    return false;
                }
            } else if (zone.start && zone.end) {
                if (this.rectangleIntersectsLine(rect, zone)) {
                    return false;
                }
            }
        }

        return true;
    }

    rectanglesOverlap(rect1, rect2) {
        return !(rect1.maxX <= rect2.minX || rect2.maxX <= rect1.minX ||
            rect1.maxY <= rect2.minY || rect2.maxY <= rect1.minY);
    }

    distanceToLine(rect, line) {
        if (!line || !line.start || !line.end) {
            throw new Error('Invalid line geometry for distance check.');
        }
        const centerX = (rect.minX + rect.maxX) / 2;
        const centerY = (rect.minY + rect.maxY) / 2;

        const A = line.end.y - line.start.y;
        const B = line.start.x - line.end.x;
        const C = line.end.x * line.start.y - line.start.x * line.end.y;

        return Math.abs(A * centerX + B * centerY + C) / Math.sqrt(A * A + B * B);
    }

    rectangleIntersectsLine(rect, line) {
        if (!line || !line.start || !line.end) {
            throw new Error('Invalid line geometry for collision check.');
        }
        // Check if line intersects any edge of rectangle
        const edges = [
            { start: { x: rect.minX, y: rect.minY }, end: { x: rect.maxX, y: rect.minY } },
            { start: { x: rect.maxX, y: rect.minY }, end: { x: rect.maxX, y: rect.maxY } },
            { start: { x: rect.maxX, y: rect.maxY }, end: { x: rect.minX, y: rect.maxY } },
            { start: { x: rect.minX, y: rect.maxY }, end: { x: rect.minX, y: rect.minY } }
        ];

        return edges.some(edge => this.linesIntersect(line, edge));
    }

    rectangleIntersectsPolygon(rect, polygon) {
        const points = (polygon || []).map((pt) => {
            if (Array.isArray(pt)) {
                return { x: Number(pt[0]), y: Number(pt[1]) };
            }
            if (pt && typeof pt === 'object') {
                return { x: Number(pt.x), y: Number(pt.y) };
            }
            return null;
        }).filter(pt => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y));

        if (points.length < 2) return false;

        const rectCorners = [
            { x: rect.minX, y: rect.minY },
            { x: rect.maxX, y: rect.minY },
            { x: rect.maxX, y: rect.maxY },
            { x: rect.minX, y: rect.maxY }
        ];

        if (rectCorners.some(corner => this.pointInPolygon(corner, points))) {
            return true;
        }

        if (points.some(pt => pt.x >= rect.minX && pt.x <= rect.maxX && pt.y >= rect.minY && pt.y <= rect.maxY)) {
            return true;
        }

        for (let i = 0; i < points.length; i++) {
            const start = points[i];
            const end = points[(i + 1) % points.length];
            if (this.rectangleIntersectsLine(rect, { start, end })) {
                return true;
            }
        }

        return false;
    }

    pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;

            const intersect = ((yi > point.y) !== (yj > point.y)) &&
                (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    linesIntersect(line1, line2) {
        const det = (line1.end.x - line1.start.x) * (line2.end.y - line2.start.y) -
            (line2.end.x - line2.start.x) * (line1.end.y - line1.start.y);

        if (det === 0) return false;

        const lambda = ((line2.end.y - line2.start.y) * (line2.end.x - line1.start.x) +
            (line2.start.x - line2.end.x) * (line2.end.y - line1.start.y)) / det;
        const gamma = ((line1.start.y - line1.end.y) * (line2.end.x - line1.start.x) +
            (line1.end.x - line1.start.x) * (line2.end.y - line1.start.y)) / det;

        return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
    }

    isRoomForbidden(room) {
        const type = (room && room.type ? String(room.type).toLowerCase() : '');
        if (type === 'stairs' || type === 'elevator' || type === 'circulation' || type === 'entry') {
            return true;
        }
        if (room && room.adjacency && Array.isArray(room.adjacency.forbidden) && room.adjacency.forbidden.length > 0) {
            return true;
        }
        return false;
    }

    classifyIlotType(area) {
        if (area <= 1) return 'Individual';
        if (area <= 3) return 'Small Team';
        if (area <= 5) return 'Team';
        return 'Large Team';
    }

    optimizeLayout() {
        // Genetic algorithm for layout optimization
        const generations = 50;
        const populationSize = 20;

        let population = this.generateInitialPopulation(populationSize);

        for (let gen = 0; gen < generations; gen++) {
            population = this.evolvePopulation(population);
        }

        this.ilots = population[0].ilots;
        return this.ilots;
    }

    generateInitialPopulation(size) {
        const population = [];

        for (let i = 0; i < size; i++) {
            const individual = {
                ilots: [...this.ilots],
                fitness: this.calculateFitness(this.ilots)
            };
            population.push(individual);
        }

        return population.sort((a, b) => b.fitness - a.fitness);
    }

    evolvePopulation(population) {
        const newPopulation = [];

        // Keep best individuals
        newPopulation.push(...population.slice(0, 5));

        // Generate offspring
        while (newPopulation.length < population.length) {
            const parent1 = this.selectParent(population);
            const parent2 = this.selectParent(population);
            const offspring = this.crossover(parent1, parent2);
            this.mutate(offspring);
            offspring.fitness = this.calculateFitness(offspring.ilots);
            newPopulation.push(offspring);
        }

        return newPopulation.sort((a, b) => b.fitness - a.fitness);
    }

    calculateFitness(ilots) {
        let fitness = 0;

        // Reward space utilization
        const totalArea = ilots.reduce((sum, ilot) => sum + ilot.area, 0);
        fitness += totalArea * 10;

        // Penalize overlaps
        for (let i = 0; i < ilots.length; i++) {
            for (let j = i + 1; j < ilots.length; j++) {
                if (this.rectanglesOverlap(
                    { minX: ilots[i].x, minY: ilots[i].y, maxX: ilots[i].x + ilots[i].width, maxY: ilots[i].y + ilots[i].height },
                    { minX: ilots[j].x, minY: ilots[j].y, maxX: ilots[j].x + ilots[j].width, maxY: ilots[j].y + ilots[j].height }
                )) {
                    fitness -= 1000;
                }
            }
        }

        return fitness;
    }

    selectParent(population) {
        const tournamentSize = 3;
        const tournament = [];

        for (let i = 0; i < tournamentSize; i++) {
            tournament.push(population[Math.floor(this.rng() * population.length)]);
        }

        return tournament.sort((a, b) => b.fitness - a.fitness)[0];
    }

    crossover(parent1, parent2) {
        const offspring = { ilots: [] };
        const crossoverPoint = Math.floor(parent1.ilots.length / 2);

        offspring.ilots = [
            ...parent1.ilots.slice(0, crossoverPoint),
            ...parent2.ilots.slice(crossoverPoint)
        ];

        return offspring;
    }

    mutate(individual) {
        const mutationRate = 0.1;

        individual.ilots.forEach(ilot => {
            if (this.rng() < mutationRate) {
                const newPosition = this.findValidPosition({ width: ilot.width, height: ilot.height });
                if (newPosition) {
                    ilot.x = newPosition.x;
                    ilot.y = newPosition.y;
                }
            }
        });
    }
}

module.exports = IlotGenerator;


