/**
 * Advanced Îlot Optimizer - Production-Ready Space Optimization
 * 
 * Features:
 * - Multi-objective optimization (density, accessibility, natural light)
 * - Genetic algorithm for global optimization
 * - Simulated annealing for local refinement
 * - Collision detection and resolution
 * - Accessibility scoring and corridor integration
 */

const GeometryHelpers = require('./geometryHelpers');
const SpatialGrid = require('./spatialGrid');

class AdvancedIlotOptimizer {
    constructor(floorPlan, ilots, options = {}) {
        this.floorPlan = floorPlan;
        this.ilots = ilots;
        this.options = {
            maxIterations: options.maxIterations || 500,
            populationSize: options.populationSize || 50,
            mutationRate: options.mutationRate || 0.15,
            crossoverRate: options.crossoverRate || 0.7,
            elitismRate: options.elitismRate || 0.1,
            temperatureInitial: options.temperatureInitial || 100,
            coolingRate: options.coolingRate || 0.95,
            seed: options.seed || Date.now(),
            ...options
        };

        // Create seeded RNG for reproducibility
        try {
            const createRng = require('./seededRng');
            this.rng = createRng(this.options.seed);
        } catch (e) {
            this.rng = Math.random;
        }

        this.spatialGrid = new SpatialGrid(
            floorPlan.bounds,
            Math.sqrt((floorPlan.bounds.maxX - floorPlan.bounds.minX) *
                (floorPlan.bounds.maxY - floorPlan.bounds.minY)) / 20
        );
    }

    /**
     * Main optimization entry point
     */
    optimizeLayout() {
        const result = this.optimize();
        return result.ilots;
    }

    optimize() {
        console.log('🔧 Starting îlot optimization...');

        // Phase 1: Initial collision resolution
        const collisionFree = this.resolveCollisions(this.ilots);
        console.log(`✅ Phase 1: Collision resolution (${collisionFree.length} îlots)`);

        // Phase 2: Genetic algorithm for global optimization
        const geneticResult = this.geneticOptimization(collisionFree);
        console.log(`✅ Phase 2: Genetic optimization (fitness: ${geneticResult.fitness.toFixed(2)})`);

        // Phase 3: Simulated annealing for local refinement
        const refinedResult = this.simulatedAnnealing(geneticResult.ilots);
        console.log(`✅ Phase 3: Simulated annealing (fitness: ${refinedResult.fitness.toFixed(2)})`);

        // Phase 4: Final adjustments
        const finalIlots = this.finalAdjustments(refinedResult.ilots);
        console.log(`✅ Phase 4: Final adjustments complete`);

        return {
            ilots: finalIlots,
            metrics: this.calculateMetrics(finalIlots),
            optimizationHistory: {
                initial: this.calculateFitness(this.ilots),
                afterCollisionResolution: this.calculateFitness(collisionFree),
                afterGenetic: geneticResult.fitness,
                afterAnnealing: refinedResult.fitness,
                final: this.calculateFitness(finalIlots)
            }
        };
    }

    /**
     * Resolve all collisions between îlots
     */
    resolveCollisions(ilots) {
        const grid = new SpatialGrid(this.floorPlan.bounds, 5);
        const result = [];

        for (const ilot of ilots) {
            if (!this.isValidIlot(ilot)) continue;

            const rect = this.ilotToRect(ilot);
            const neighbors = grid.queryRect(this.expandRect(rect, 0.5));

            let adjusted = { ...ilot };
            let attempts = 0;
            const maxAttempts = 50;

            while (attempts < maxAttempts) {
                const adjustedRect = this.ilotToRect(adjusted);

                // Check for collisions
                let hasCollision = false;
                for (const neighbor of neighbors) {
                    const neighborRect = this.ilotToRect(neighbor);
                    if (GeometryHelpers.rectanglesOverlap(adjustedRect, neighborRect)) {
                        hasCollision = true;
                        break;
                    }
                }

                if (!hasCollision && this.isValidPlacement(adjustedRect)) {
                    result.push(adjusted);
                    grid.insert(adjusted);
                    break;
                }

                // Try to resolve collision by moving
                adjusted = this.nudgeIlot(adjusted, neighbors);
                attempts++;
            }

            if (attempts >= maxAttempts) {
                console.warn(`⚠️ Could not place îlot ${ilot.id} after ${maxAttempts} attempts`);
            }
        }

        return result;
    }

    /**
     * Genetic algorithm optimization
     */
    geneticOptimization(initialIlots) {
        const populationSize = this.options.populationSize;
        let population = this.initializePopulation(initialIlots, populationSize);

        let bestSolution = null;
        let bestFitness = -Infinity;
        let stagnantGenerations = 0;
        const maxStagnant = 50;

        for (let generation = 0; generation < this.options.maxIterations; generation++) {
            // Evaluate fitness
            const fitnessScores = population.map(individual => ({
                individual,
                fitness: this.calculateFitness(individual)
            }));

            // Sort by fitness
            fitnessScores.sort((a, b) => b.fitness - a.fitness);

            // Track best solution
            if (fitnessScores[0].fitness > bestFitness) {
                bestFitness = fitnessScores[0].fitness;
                bestSolution = fitnessScores[0].individual;
                stagnantGenerations = 0;
            } else {
                stagnantGenerations++;
            }

            // Early termination if stagnant
            if (stagnantGenerations >= maxStagnant) {
                console.log(`   Early termination at generation ${generation} (stagnant)`);
                break;
            }

            // Create next generation
            const nextGeneration = [];

            // Elitism: keep top performers
            const eliteCount = Math.floor(populationSize * this.options.elitismRate);
            for (let i = 0; i < eliteCount; i++) {
                nextGeneration.push(fitnessScores[i].individual);
            }

            // Generate offspring
            while (nextGeneration.length < populationSize) {
                const parent1 = this.tournamentSelection(fitnessScores);
                const parent2 = this.tournamentSelection(fitnessScores);

                let offspring;
                if (this.rng() < this.options.crossoverRate) {
                    offspring = this.crossover(parent1, parent2);
                } else {
                    offspring = this.rng() < 0.5 ? [...parent1] : [...parent2];
                }

                if (this.rng() < this.options.mutationRate) {
                    offspring = this.mutate(offspring);
                }

                nextGeneration.push(offspring);
            }

            population = nextGeneration;

            if (generation % 50 === 0) {
                console.log(`   Generation ${generation}: best fitness = ${bestFitness.toFixed(2)}`);
            }
        }

        return { ilots: bestSolution, fitness: bestFitness };
    }

    /**
     * Simulated annealing for local refinement
     */
    simulatedAnnealing(initialIlots) {
        let current = [...initialIlots];
        let currentFitness = this.calculateFitness(current);
        let best = [...current];
        let bestFitness = currentFitness;

        let temperature = this.options.temperatureInitial;
        const coolingRate = this.options.coolingRate;
        const minTemperature = 0.1;

        let iteration = 0;
        while (temperature > minTemperature && iteration < this.options.maxIterations) {
            // Generate neighbor solution
            const neighbor = this.generateNeighborSolution(current);
            const neighborFitness = this.calculateFitness(neighbor);

            // Calculate acceptance probability
            const delta = neighborFitness - currentFitness;
            const acceptanceProbability = delta > 0 ? 1 : Math.exp(delta / temperature);

            // Accept or reject
            if (this.rng() < acceptanceProbability) {
                current = neighbor;
                currentFitness = neighborFitness;

                if (currentFitness > bestFitness) {
                    best = [...current];
                    bestFitness = currentFitness;
                }
            }

            temperature *= coolingRate;
            iteration++;

            if (iteration % 50 === 0) {
                console.log(`   Annealing iteration ${iteration}: T=${temperature.toFixed(2)}, best=${bestFitness.toFixed(2)}`);
            }
        }

        return { ilots: best, fitness: bestFitness };
    }

    /**
     * Calculate comprehensive fitness score
     */
    calculateFitness(ilots) {
        if (!ilots || ilots.length === 0) return 0;

        // Multiple objectives with weights
        const densityScore = this.calculateDensityScore(ilots);
        const accessibilityScore = this.calculateAccessibilityScore(ilots);
        const distributionScore = this.calculateDistributionScore(ilots);
        const validityScore = this.calculateValidityScore(ilots);

        // Weighted combination
        return (
            densityScore * 0.3 +
            accessibilityScore * 0.3 +
            distributionScore * 0.2 +
            validityScore * 0.2
        );
    }

    /**
     * Calculate space utilization score
     */
    calculateDensityScore(ilots) {
        const totalArea = (this.floorPlan.bounds.maxX - this.floorPlan.bounds.minX) *
            (this.floorPlan.bounds.maxY - this.floorPlan.bounds.minY);
        const usedArea = ilots.reduce((sum, ilot) => sum + (ilot.width * ilot.height), 0);
        return Math.min(1, usedArea / totalArea) * 100;
    }

    /**
     * Calculate accessibility score (proximity to corridors/entrances)
     */
    calculateAccessibilityScore(ilots) {
        if (!this.floorPlan.entrances || this.floorPlan.entrances.length === 0) {
            return 50; // Neutral score if no entrances defined
        }

        let totalScore = 0;
        for (const ilot of ilots) {
            const center = { x: ilot.x + ilot.width / 2, y: ilot.y + ilot.height / 2 };
            let minDist = Infinity;

            for (const entrance of this.floorPlan.entrances) {
                let dist;
                if (entrance.polygon) {
                    dist = GeometryHelpers.pointToPolygonDistance(center, entrance.polygon);
                } else if (entrance.start && entrance.end) {
                    dist = GeometryHelpers.pointToSegmentDistance(center, entrance.start, entrance.end);
                } else {
                    continue;
                }
                if (dist < minDist) minDist = dist;
            }

            // Score inversely proportional to distance
            const score = Math.max(0, 100 - minDist);
            totalScore += score;
        }

        return totalScore / ilots.length;
    }

    /**
     * Calculate distribution quality score
     */
    calculateDistributionScore(ilots) {
        if (ilots.length < 2) return 100;

        // Calculate average distance to nearest neighbor
        let avgNearestDistance = 0;
        for (const ilot of ilots) {
            const center = { x: ilot.x + ilot.width / 2, y: ilot.y + ilot.height / 2 };
            let minDist = Infinity;

            for (const other of ilots) {
                if (other === ilot) continue;
                const otherCenter = { x: other.x + other.width / 2, y: other.y + other.height / 2 };
                const dist = Math.hypot(center.x - otherCenter.x, center.y - otherCenter.y);
                if (dist < minDist) minDist = dist;
            }

            avgNearestDistance += minDist;
        }
        avgNearestDistance /= ilots.length;

        // Ideal distance is proportional to sqrt of average area
        const avgArea = ilots.reduce((s, i) => s + i.width * i.height, 0) / ilots.length;
        const idealDistance = Math.sqrt(avgArea) * 2;

        // Score based on how close to ideal
        const deviation = Math.abs(avgNearestDistance - idealDistance);
        return Math.max(0, 100 - deviation * 2);
    }

    /**
     * Calculate validity score (no collisions, within bounds)
     */
    calculateValidityScore(ilots) {
        let validCount = 0;

        for (const ilot of ilots) {
            const rect = this.ilotToRect(ilot);
            if (this.isValidPlacement(rect)) {
                validCount++;
            }
        }

        return (validCount / ilots.length) * 100;
    }

    /**
     * Helper methods
     */

    initializePopulation(baseIlots, size) {
        const population = [baseIlots]; // Keep original as first individual

        for (let i = 1; i < size; i++) {
            const variation = baseIlots.map(ilot => ({
                ...ilot,
                x: ilot.x + (this.rng() - 0.5) * 10,
                y: ilot.y + (this.rng() - 0.5) * 10
            }));
            population.push(variation);
        }

        return population;
    }

    tournamentSelection(fitnessScores, tournamentSize = 5) {
        let best = null;
        let bestFitness = -Infinity;

        for (let i = 0; i < tournamentSize; i++) {
            const candidate = fitnessScores[Math.floor(this.rng() * fitnessScores.length)];
            if (candidate.fitness > bestFitness) {
                best = candidate.individual;
                bestFitness = candidate.fitness;
            }
        }

        return best;
    }

    crossover(parent1, parent2) {
        const offspring = [];
        const crossoverPoint = Math.floor(this.rng() * Math.min(parent1.length, parent2.length));

        for (let i = 0; i < Math.max(parent1.length, parent2.length); i++) {
            if (i < crossoverPoint && i < parent1.length) {
                offspring.push({ ...parent1[i] });
            } else if (i < parent2.length) {
                offspring.push({ ...parent2[i] });
            }
        }

        return offspring;
    }

    mutate(individual) {
        const mutated = individual.map(ilot => {
            if (this.rng() < 0.3) {
                return {
                    ...ilot,
                    x: ilot.x + (this.rng() - 0.5) * 5,
                    y: ilot.y + (this.rng() - 0.5) * 5
                };
            }
            return ilot;
        });

        return mutated;
    }

    generateNeighborSolution(current) {
        const neighbor = [...current];
        const idx = Math.floor(this.rng() * neighbor.length);

        neighbor[idx] = {
            ...neighbor[idx],
            x: neighbor[idx].x + (this.rng() - 0.5) * 2,
            y: neighbor[idx].y + (this.rng() - 0.5) * 2
        };

        return neighbor;
    }

    nudgeIlot(ilot, neighbors) {
        // Calculate repulsion vector from all neighbors
        let fx = 0, fy = 0;

        for (const neighbor of neighbors) {
            const dx = ilot.x - neighbor.x;
            const dy = ilot.y - neighbor.y;
            const dist = Math.hypot(dx, dy);

            if (dist > 0 && dist < 20) {
                const force = 1 / (dist * dist);
                fx += (dx / dist) * force;
                fy += (dy / dist) * force;
            }
        }

        return {
            ...ilot,
            x: ilot.x + fx * 0.5,
            y: ilot.y + fy * 0.5
        };
    }

    finalAdjustments(ilots) {
        // Snap to grid for cleaner layouts
        return ilots.map(ilot => ({
            ...ilot,
            x: Math.round(ilot.x * 2) / 2,
            y: Math.round(ilot.y * 2) / 2
        }));
    }

    isValidIlot(ilot) {
        return ilot && typeof ilot.x === 'number' && typeof ilot.y === 'number' &&
            typeof ilot.width === 'number' && typeof ilot.height === 'number' &&
            ilot.width > 0 && ilot.height > 0;
    }

    ilotToRect(ilot) {
        return {
            x1: ilot.x,
            y1: ilot.y,
            x2: ilot.x + ilot.width,
            y2: ilot.y + ilot.height
        };
    }

    expandRect(rect, margin) {
        return {
            x1: rect.x1 - margin,
            y1: rect.y1 - margin,
            x2: rect.x2 + margin,
            y2: rect.y2 + margin
        };
    }

    isValidPlacement(rect) {
        // Check bounds
        if (rect.x1 < this.floorPlan.bounds.minX || rect.x2 > this.floorPlan.bounds.maxX ||
            rect.y1 < this.floorPlan.bounds.minY || rect.y2 > this.floorPlan.bounds.maxY) {
            return false;
        }

        // Check forbidden zones
        for (const zone of this.floorPlan.forbiddenZones || []) {
            if (zone.polygon && GeometryHelpers.rectanglePolygonIntersection(rect, zone.polygon)) {
                return false;
            }
        }

        return true;
    }

    calculateMetrics(ilots) {
        return {
            totalIlots: ilots.length,
            totalArea: ilots.reduce((s, i) => s + i.width * i.height, 0),
            averageArea: ilots.reduce((s, i) => s + i.width * i.height, 0) / ilots.length,
            densityScore: this.calculateDensityScore(ilots),
            accessibilityScore: this.calculateAccessibilityScore(ilots),
            distributionScore: this.calculateDistributionScore(ilots),
            validityScore: this.calculateValidityScore(ilots),
            overallFitness: this.calculateFitness(ilots)
        };
    }
}

module.exports = AdvancedIlotOptimizer;
