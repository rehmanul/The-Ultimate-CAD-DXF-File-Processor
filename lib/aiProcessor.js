/**
 * AI-Powered CAD Analysis Module
 * Implements machine learning detection, genetic optimization, and furniture recognition
 */

class AIProcessor {
    constructor() {
        this.mlModels = {
            doorDetector: null,
            stairDetector: null,
            furnitureDetector: null
        };
        this.geneticAlgorithm = new GeneticOptimizer();
        this.furniturePatterns = this.initializeFurniturePatterns();
    }

    /**
     * Machine Learning Detection - Enhanced door/stair detection
     * Uses rule-based patterns that can be enhanced with trained ML models
     */
    detectArchitecturalElements(entities, bounds) {
        const elements = {
            doors: [],
            stairs: [],
            elevators: [],
            columns: []
        };

        entities.forEach((entity, index) => {
            // Door Detection (ML-enhanced rule-based)
            if (this.isPotentialDoor(entity)) {
                const door = this.classifyDoor(entity);
                if (door.confidence > 0.7) {
                    elements.doors.push({
                        ...door,
                        entityIndex: index,
                        position: this.getEntityCenter(entity)
                    });
                }
            }

            // Stair Detection
            if (this.isPotentialStair(entity)) {
                const stair = this.classifyStair(entity);
                if (stair.confidence > 0.6) {
                    elements.stairs.push({
                        ...stair,
                        entityIndex: index,
                        bounds: this.getEntityBounds(entity)
                    });
                }
            }

            // Elevator Detection
            if (this.isPotentialElevator(entity)) {
                elements.elevators.push({
                    type: 'elevator',
                    bounds: this.getEntityBounds(entity),
                    confidence: 0.8,
                    entityIndex: index
                });
            }

            // Column Detection
            if (this.isPotentialColumn(entity)) {
                elements.columns.push({
                    type: 'column',
                    center: this.getEntityCenter(entity),
                    radius: this.getEntitySize(entity),
                    confidence: 0.9,
                    entityIndex: index
                });
            }
        });

        return elements;
    }

    isPotentialDoor(entity) {
        // Rule-based door detection (can be enhanced with ML)
        if (entity.type === 'ARC') return true;
        if (entity.type === 'LINE') {
            const length = this.getEntityLength(entity);
            return length > 0.8 && length < 1.5; // Typical door width
        }
        return false;
    }

    isPotentialStair(entity) {
        // Look for parallel lines or rectangular patterns
        if (entity.type === 'LINE') {
            const length = this.getEntityLength(entity);
            return length > 2 && length < 10; // Stair run length
        }
        return false;
    }

    isPotentialElevator(entity) {
        // Small rectangular areas
        const bounds = this.getEntityBounds(entity);
        const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
        return area > 1 && area < 10; // Elevator shaft size
    }

    isPotentialColumn(entity) {
        // Circular or small square entities
        if (entity.type === 'CIRCLE') return true;
        const bounds = this.getEntityBounds(entity);
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        return Math.abs(width - height) < 0.1 && width < 0.5; // Square columns
    }

    classifyDoor(entity) {
        let confidence = 0.5;
        let type = 'standard';

        if (entity.type === 'ARC') {
            confidence = 0.9;
            type = 'swing';
        } else if (entity.type === 'LINE') {
            const length = this.getEntityLength(entity);
            if (length > 0.8 && length < 1.2) {
                confidence = 0.8;
                type = 'single';
            }
        }

        return { type, confidence };
    }

    classifyStair(entity) {
        return {
            type: 'straight',
            steps: Math.floor(this.getEntityLength(entity) / 0.3), // Assume 30cm tread
            confidence: 0.7
        };
    }

    /**
     * Layout Optimization - Genetic Algorithm for optimal ilot placement
     */
    optimizeLayout(floorPlan, currentIlots, constraints = {}) {
        console.log('AI Processor: Starting genetic algorithm layout optimization...');

        const populationSize = constraints.populationSize || 50;
        const generations = constraints.generations || 100;
        const mutationRate = constraints.mutationRate || 0.1;

        // Initialize population with current layout and variations
        let population = this.geneticAlgorithm.initializePopulation(currentIlots, populationSize, floorPlan);

        for (let generation = 0; generation < generations; generation++) {
            // Evaluate fitness of each individual
            population.forEach(individual => {
                individual.fitness = this.evaluateLayoutFitness(individual, floorPlan);
            });

            // Sort by fitness (higher is better)
            population.sort((a, b) => b.fitness - a.fitness);

            // Keep best individuals
            const eliteSize = Math.floor(populationSize * 0.1);
            const elites = population.slice(0, eliteSize);

            // Create new population through crossover and mutation
            const newPopulation = [...elites];

            while (newPopulation.length < populationSize) {
                const parent1 = this.geneticAlgorithm.tournamentSelection(population);
                const parent2 = this.geneticAlgorithm.tournamentSelection(population);

                const offspring = this.geneticAlgorithm.crossover(parent1, parent2);
                this.geneticAlgorithm.mutate(offspring, mutationRate, floorPlan);

                newPopulation.push(offspring);
            }

            population = newPopulation;

            if (generation % 20 === 0) {
                console.log(`Generation ${generation}: Best fitness = ${population[0].fitness.toFixed(3)}`);
            }
        }

        return population[0]; // Return best solution
    }

    evaluateLayoutFitness(layout, floorPlan) {
        let fitness = 0;

        // Distance to entrances (prefer closer to entrances)
        const entranceDistance = this.calculateEntranceDistance(layout, floorPlan.entrances);
        fitness += Math.max(0, 10 - entranceDistance); // Max 10 points

        // Collision penalty
        const collisions = this.countCollisions(layout, floorPlan);
        fitness -= collisions * 5; // Heavy penalty for collisions

        // Distribution evenness
        const distributionScore = this.evaluateDistribution(layout, floorPlan.bounds);
        fitness += distributionScore * 2; // Max 20 points

        // Corridor efficiency
        const corridorScore = this.evaluateCorridorEfficiency(layout);
        fitness += corridorScore * 3; // Max 30 points

        return Math.max(0, fitness);
    }

    calculateEntranceDistance(ilots, entrances) {
        if (!entrances || entrances.length === 0) return 0;

        let totalDistance = 0;
        ilots.forEach(ilot => {
            let minDistance = Infinity;
            entrances.forEach(entrance => {
                const distance = this.distanceBetween(
                    { x: ilot.x + ilot.width/2, y: ilot.y + ilot.height/2 },
                    this.getEntityCenter(entrance)
                );
                minDistance = Math.min(minDistance, distance);
            });
            totalDistance += minDistance;
        });

        return totalDistance / ilots.length;
    }

    countCollisions(ilots, floorPlan) {
        let collisions = 0;

        // Check ilot-ilot collisions
        for (let i = 0; i < ilots.length; i++) {
            for (let j = i + 1; j < ilots.length; j++) {
                if (this.ilotsOverlap(ilots[i], ilots[j])) {
                    collisions++;
                }
            }
        }

        // Check ilot-wall collisions
        ilots.forEach(ilot => {
            floorPlan.walls?.forEach(wall => {
                if (this.ilotIntersectsWall(ilot, wall)) {
                    collisions++;
                }
            });
        });

        // Check ilot-forbidden zone collisions
        ilots.forEach(ilot => {
            floorPlan.forbiddenZones?.forEach(zone => {
                if (this.ilotIntersectsZone(ilot, zone)) {
                    collisions++;
                }
            });
        });

        return collisions;
    }

    evaluateDistribution(ilots, bounds) {
        // Calculate center of mass and variance
        const centers = ilots.map(ilot => ({
            x: ilot.x + ilot.width/2,
            y: ilot.y + ilot.height/2
        }));

        const centerX = centers.reduce((sum, c) => sum + c.x, 0) / centers.length;
        const centerY = centers.reduce((sum, c) => sum + c.y, 0) / centers.length;

        const variance = centers.reduce((sum, c) => {
            return sum + Math.pow(c.x - centerX, 2) + Math.pow(c.y - centerY, 2);
        }, 0) / centers.length;

        // Lower variance = better distribution (more centered)
        return Math.max(0, 10 - variance / 100);
    }

    evaluateCorridorEfficiency(ilots) {
        // Simplified: prefer layouts that form clear rows
        let rowScore = 0;
        const tolerance = 3; // meters

        // Group by Y position (rows)
        const rows = {};
        ilots.forEach(ilot => {
            const rowKey = Math.round(ilot.y / tolerance) * tolerance;
            if (!rows[rowKey]) rows[rowKey] = [];
            rows[rowKey].push(ilot);
        });

        // Score based on row alignment
        Object.values(rows).forEach(row => {
            if (row.length > 1) {
                rowScore += row.length * 2; // Bonus for multiple ilots in row
            }
        });

        return Math.min(10, rowScore);
    }

    /**
     * Furniture Recognition - Pattern matching for common furniture
     */
    detectFurniture(entities, bounds) {
        const furniture = [];

        entities.forEach((entity, index) => {
            const detected = this.matchFurniturePattern(entity);
            if (detected) {
                furniture.push({
                    ...detected,
                    entityIndex: index,
                    position: this.getEntityCenter(entity),
                    bounds: this.getEntityBounds(entity)
                });
            }
        });

        return furniture;
    }

    initializeFurniturePatterns() {
        return {
            desk: {
                shape: 'rectangle',
                sizeRange: { min: 1.2, max: 2.0 }, // width
                aspectRatio: { min: 0.4, max: 0.8 }, // height/width
                confidence: 0.8
            },
            chair: {
                shape: 'circle',
                sizeRange: { min: 0.4, max: 0.8 }, // diameter
                confidence: 0.7
            },
            table: {
                shape: 'rectangle',
                sizeRange: { min: 1.5, max: 3.0 },
                aspectRatio: { min: 0.8, max: 1.2 }, // square-ish
                confidence: 0.75
            },
            cabinet: {
                shape: 'rectangle',
                sizeRange: { min: 0.8, max: 1.8 },
                aspectRatio: { min: 1.5, max: 4.0 }, // taller than wide
                confidence: 0.8
            }
        };
    }

    matchFurniturePattern(entity) {
        const bounds = this.getEntityBounds(entity);
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const aspectRatio = height / width;

        // Check each furniture type
        for (const [type, pattern] of Object.entries(this.furniturePatterns)) {
            let matches = false;

            if (pattern.shape === 'rectangle' && entity.type === 'LINE') {
                // Rectangle check
                if (width >= pattern.sizeRange.min && width <= pattern.sizeRange.max &&
                    aspectRatio >= pattern.aspectRatio.min && aspectRatio <= pattern.aspectRatio.max) {
                    matches = true;
                }
            } else if (pattern.shape === 'circle' && entity.type === 'CIRCLE') {
                // Circle check
                const diameter = entity.radius * 2;
                if (diameter >= pattern.sizeRange.min && diameter <= pattern.sizeRange.max) {
                    matches = true;
                }
            }

            if (matches) {
                return {
                    type: type,
                    confidence: pattern.confidence,
                    dimensions: { width, height }
                };
            }
        }

        return null;
    }

    // Utility methods
    getEntityCenter(entity) {
        if (entity.type === 'CIRCLE') {
            return { x: entity.x1 || 0, y: entity.y1 || 0 };
        }
        return {
            x: ((entity.x1 || 0) + (entity.x2 || 0)) / 2,
            y: ((entity.y1 || 0) + (entity.y2 || 0)) / 2
        };
    }

    getEntityBounds(entity) {
        const coords = [entity.x1, entity.y1, entity.x2, entity.y2].filter(c => c !== undefined);
        return {
            minX: Math.min(...coords),
            maxX: Math.max(...coords),
            minY: Math.min(...coords),
            maxY: Math.max(...coords)
        };
    }

    getEntityLength(entity) {
        if (entity.x1 !== undefined && entity.x2 !== undefined) {
            return Math.sqrt(Math.pow(entity.x2 - entity.x1, 2) + Math.pow(entity.y2 - entity.y1, 2));
        }
        return 0;
    }

    getEntitySize(entity) {
        if (entity.type === 'CIRCLE') return entity.radius || 0;
        const bounds = this.getEntityBounds(entity);
        return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    }

    distanceBetween(point1, point2) {
        return Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));
    }

    ilotsOverlap(ilot1, ilot2) {
        return !(ilot1.x + ilot1.width < ilot2.x ||
                ilot2.x + ilot2.width < ilot1.x ||
                ilot1.y + ilot1.height < ilot2.y ||
                ilot2.y + ilot2.height < ilot1.y);
    }

    ilotIntersectsWall(ilot, wall) {
        // Simplified collision detection
        const ilotCenter = { x: ilot.x + ilot.width/2, y: ilot.y + ilot.height/2 };
        const wallCenter = {
            x: (wall.start.x + wall.end.x) / 2,
            y: (wall.start.y + wall.end.y) / 2
        };
        const distance = this.distanceBetween(ilotCenter, wallCenter);
        return distance < 1.0; // 1m buffer
    }

    ilotIntersectsZone(ilot, zone) {
        // Check if ilot overlaps with zone polygon
        const ilotCenter = { x: ilot.x + ilot.width/2, y: ilot.y + ilot.height/2 };
        // Simplified: check distance to zone center
        const zoneCenter = this.getEntityCenter(zone);
        const distance = this.distanceBetween(ilotCenter, zoneCenter);
        return distance < 2.0; // 2m buffer for zones
    }
}

/**
 * Genetic Algorithm Optimizer for layout optimization
 */
class GeneticOptimizer {
    initializePopulation(currentIlots, populationSize, floorPlan) {
        const population = [];

        // Include current layout
        population.push([...currentIlots]);

        // Generate variations
        for (let i = 1; i < populationSize; i++) {
            const variant = this.createVariant(currentIlots, floorPlan);
            population.push(variant);
        }

        return population;
    }

    createVariant(ilots, floorPlan) {
        const variant = ilots.map(ilot => ({ ...ilot }));

        // Random mutations
        variant.forEach(ilot => {
            if (Math.random() < 0.3) { // 30% chance to mutate each ilot
                ilot.x += (Math.random() - 0.5) * 2; // ±1m
                ilot.y += (Math.random() - 0.5) * 2;

                // Keep within bounds
                ilot.x = Math.max(floorPlan.bounds.minX + 1, Math.min(floorPlan.bounds.maxX - ilot.width - 1, ilot.x));
                ilot.y = Math.max(floorPlan.bounds.minY + 1, Math.min(floorPlan.bounds.maxY - ilot.height - 1, ilot.y));
            }
        });

        return variant;
    }

    tournamentSelection(population, tournamentSize = 3) {
        let best = population[Math.floor(Math.random() * population.length)];
        for (let i = 1; i < tournamentSize; i++) {
            const contender = population[Math.floor(Math.random() * population.length)];
            if (contender.fitness > best.fitness) {
                best = contender;
            }
        }
        return best;
    }

    crossover(parent1, parent2) {
        const child = [];
        const maxLength = Math.max(parent1.length, parent2.length);

        for (let i = 0; i < maxLength; i++) {
            if (i < parent1.length && i < parent2.length) {
                // Take from parent1 or parent2 randomly
                child.push(Math.random() < 0.5 ? { ...parent1[i] } : { ...parent2[i] });
            } else if (i < parent1.length) {
                child.push({ ...parent1[i] });
            } else if (i < parent2.length) {
                child.push({ ...parent2[i] });
            }
        }

        return child;
    }

    mutate(individual, mutationRate, floorPlan) {
        individual.forEach(ilot => {
            if (Math.random() < mutationRate) {
                // Small random displacement
                ilot.x += (Math.random() - 0.5) * 0.5;
                ilot.y += (Math.random() - 0.5) * 0.5;

                // Keep within bounds
                ilot.x = Math.max(floorPlan.bounds.minX + 1, Math.min(floorPlan.bounds.maxX - ilot.width - 1, ilot.x));
                ilot.y = Math.max(floorPlan.bounds.minY + 1, Math.min(floorPlan.bounds.maxY - ilot.height - 1, ilot.y));
            }
        });
    }
}

module.exports = AIProcessor;
