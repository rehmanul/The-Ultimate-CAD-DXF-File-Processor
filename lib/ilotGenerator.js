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
        this.ilots = [];
        const totalArea = this.calculateAvailableArea();

        // Calculate îlot counts based on distribution
        const ilotCounts = this.calculateIlotCounts(distribution, totalArea);

        // Generate îlots for each size category
        Object.entries(ilotCounts).forEach(([sizeRange, count]) => {
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
                }
            }
        });

        return this.ilots;
    }

    calculateAvailableArea() {
        let totalArea = 0;

        this.floorPlan.rooms.forEach(room => {
            if (!this.isRoomForbidden(room)) {
                totalArea += room.area * 0.7; // 70% usable area
            }
        });

        return totalArea;
    }

    calculateIlotCounts(distribution, totalArea) {
        const counts = {};
        const totalIlots = Math.floor(totalArea / 8); // Average 8m² per îlot

        Object.entries(distribution).forEach(([sizeRange, percentage]) => {
            counts[sizeRange] = Math.floor(totalIlots * percentage / 100);
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
            if (this.rectangleIntersectsLine(rect, zone)) {
                return false;
            }
        }

        return true;
    }

    rectanglesOverlap(rect1, rect2) {
        return !(rect1.maxX <= rect2.minX || rect2.maxX <= rect1.minX ||
            rect1.maxY <= rect2.minY || rect2.maxY <= rect1.minY);
    }

    distanceToLine(rect, line) {
        const centerX = (rect.minX + rect.maxX) / 2;
        const centerY = (rect.minY + rect.maxY) / 2;

        const A = line.end.y - line.start.y;
        const B = line.start.x - line.end.x;
        const C = line.end.x * line.start.y - line.start.x * line.end.y;

        return Math.abs(A * centerX + B * centerY + C) / Math.sqrt(A * A + B * B);
    }

    rectangleIntersectsLine(rect, line) {
        // Check if line intersects any edge of rectangle
        const edges = [
            { start: { x: rect.minX, y: rect.minY }, end: { x: rect.maxX, y: rect.minY } },
            { start: { x: rect.maxX, y: rect.minY }, end: { x: rect.maxX, y: rect.maxY } },
            { start: { x: rect.maxX, y: rect.maxY }, end: { x: rect.minX, y: rect.maxY } },
            { start: { x: rect.minX, y: rect.maxY }, end: { x: rect.minX, y: rect.minY } }
        ];

        return edges.some(edge => this.linesIntersect(line, edge));
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
        return room.type === 'Stairs' || room.type === 'Elevator' || room.area < 5;
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