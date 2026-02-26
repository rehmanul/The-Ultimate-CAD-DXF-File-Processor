/**
 * Production Genetic Algorithm Optimizer for FloorPlan Pro
 * Multi-objective optimization for ilot placement and layout quality
 */

const { Worker } = require('worker_threads');
const path = require('path');

class GeneticOptimizer {
    constructor(options = {}) {
        this.config = {
            populationSize: options.populationSize || 100,
            generations: options.generations || 50,
            elitismRate: options.elitismRate || 0.1,
            mutationRate: options.mutationRate || 0.15,
            crossoverRate: options.crossoverRate || 0.7,
            tournamentSize: options.tournamentSize || 5,
            adaptiveMutation: options.adaptiveMutation !== false,
            parallelEvaluation: options.parallelEvaluation !== false,
            objectives: options.objectives || ['utilization', 'circulation', 'accessibility', 'aesthetics']
        };

        this.population = [];
        this.generation = 0;
        this.bestIndividual = null;
        this.convergenceHistory = [];
        this.workers = [];
    }

    /**
     * Initialize optimization
     */
    async initialize(floorPlan, distributionConfig) {
        this.floorPlan = floorPlan;
        this.distributionConfig = distributionConfig;
        this.bounds = this.calculateBounds(floorPlan);
        
        // Initialize worker pool for parallel evaluation
        if (this.config.parallelEvaluation) {
            await this.initializeWorkerPool();
        }

        console.log('Genetic optimizer initialized');
        console.log(`Population: ${this.config.populationSize}, Generations: ${this.config.generations}`);
    }

    /**
     * Initialize worker pool
     */
    async initializeWorkerPool() {
        const numWorkers = require('os').cpus().length;
        for (let i = 0; i < numWorkers; i++) {
            // Workers would be created here for parallel processing
            // For now, we'll use sequential processing
        }
    }

    /**
     * Calculate floor plan bounds
     */
    calculateBounds(floorPlan) {
        if (floorPlan.bounds) {
            return floorPlan.bounds;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        // Calculate from walls
        if (floorPlan.walls) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    minX = Math.min(minX, wall.start.x, wall.end.x);
                    minY = Math.min(minY, wall.start.y, wall.end.y);
                    maxX = Math.max(maxX, wall.start.x, wall.end.x);
                    maxY = Math.max(maxY, wall.start.y, wall.end.y);
                }
            });
        }

        return { minX, minY, maxX, maxY };
    }

    /**
     * Run genetic algorithm optimization
     */
    async optimize(progressCallback) {
        console.log('Starting genetic optimization...');

        // Generate initial population
        this.population = this.generateInitialPopulation();
        
        // Evaluate initial population
        await this.evaluatePopulation(this.population);
        this.updateBestIndividual();

        // Evolution loop
        for (this.generation = 0; this.generation < this.config.generations; this.generation++) {
            // Selection
            const parents = this.selection();

            // Crossover
            const offspring = this.crossover(parents);

            // Mutation
            this.mutate(offspring);

            // Evaluate offspring
            await this.evaluatePopulation(offspring);

            // Replacement (elitism + offspring)
            this.population = this.replacement(this.population, offspring);

            // Update best
            this.updateBestIndividual();

            // Track convergence
            this.trackConvergence();

            // Progress callback
            if (progressCallback) {
                progressCallback({
                    generation: this.generation,
                    totalGenerations: this.config.generations,
                    bestFitness: this.bestIndividual.fitness,
                    averageFitness: this.getAverageFitness(),
                    diversity: this.calculateDiversity()
                });
            }

            // Log progress
            if ((this.generation + 1) % 10 === 0) {
                console.log(`Generation ${this.generation + 1}: Best fitness = ${this.bestIndividual.fitness.total.toFixed(4)}`);
            }

            // Early stopping if converged
            if (this.hasConverged()) {
                console.log(`Converged at generation ${this.generation + 1}`);
                break;
            }
        }

        console.log('Genetic optimization completed');
        console.log(`Final best fitness: ${this.bestIndividual.fitness.total.toFixed(4)}`);

        return this.bestIndividual;
    }

    /**
     * Generate initial population
     */
    generateInitialPopulation() {
        const population = [];

        for (let i = 0; i < this.config.populationSize; i++) {
            const individual = this.createRandomIndividual();
            population.push(individual);
        }

        return population;
    }

    /**
     * Create random individual (layout solution)
     */
    createRandomIndividual() {
        const ilots = [];
        const targetIlots = this.distributionConfig.targetCount || 50;

        // Generate ilots based on distribution
        const distribution = this.distributionConfig.distribution || {};
        
        for (const [rangeKey, percentage] of Object.entries(distribution)) {
            if (percentage === 0) continue;

            const [minArea, maxArea] = rangeKey.split('-').map(Number);
            const count = Math.floor(targetIlots * (percentage / 100));

            for (let i = 0; i < count; i++) {
                const area = minArea + Math.random() * (maxArea - minArea);
                const aspectRatio = 0.5 + Math.random() * 1.5; // 0.5 to 2.0
                
                const height = Math.sqrt(area / aspectRatio);
                const width = area / height;

                // Random position within bounds
                const x = this.bounds.minX + Math.random() * (this.bounds.maxX - this.bounds.minX - width);
                const y = this.bounds.minY + Math.random() * (this.bounds.maxY - this.bounds.minY - height);

                ilots.push({
                    x, y, width, height, area,
                    id: `ilot_${ilots.length}`
                });
            }
        }

        return {
            ilots: ilots,
            fitness: null,
            generation: this.generation
        };
    }

    /**
     * Evaluate population fitness
     */
    async evaluatePopulation(population) {
        for (const individual of population) {
            if (!individual.fitness) {
                individual.fitness = this.evaluateFitness(individual);
            }
        }
    }

    /**
     * Evaluate individual fitness (multi-objective)
     */
    evaluateFitness(individual) {
        const objectives = {};

        // Space utilization
        objectives.utilization = this.evaluateUtilization(individual);

        // Circulation efficiency
        objectives.circulation = this.evaluateCirculation(individual);

        // Accessibility
        objectives.accessibility = this.evaluateAccessibility(individual);

        // Aesthetics (regularity, alignment)
        objectives.aesthetics = this.evaluateAesthetics(individual);

        // Constraint violations
        objectives.constraints = this.evaluateConstraints(individual);

        // Weighted sum (can be replaced with Pareto ranking)
        const weights = {
            utilization: 0.30,
            circulation: 0.25,
            accessibility: 0.20,
            aesthetics: 0.15,
            constraints: 0.10
        };

        const total = Object.entries(objectives).reduce((sum, [key, value]) => {
            return sum + value * (weights[key] || 0);
        }, 0);

        return {
            total: total,
            ...objectives
        };
    }

    /**
     * Evaluate space utilization
     */
    evaluateUtilization(individual) {
        const totalIlotArea = individual.ilots.reduce((sum, ilot) => sum + ilot.area, 0);
        const floorArea = (this.bounds.maxX - this.bounds.minX) * (this.bounds.maxY - this.bounds.minY);
        
        const utilizationRatio = totalIlotArea / floorArea;

        // Optimal utilization: 60-75%
        if (utilizationRatio >= 0.6 && utilizationRatio <= 0.75) {
            return 1.0;
        } else if (utilizationRatio < 0.6) {
            return utilizationRatio / 0.6;
        } else {
            return Math.max(0, 1 - (utilizationRatio - 0.75) / 0.25);
        }
    }

    /**
     * Evaluate circulation efficiency
     */
    evaluateCirculation(individual) {
        // Check for adequate spacing between ilots
        let totalGaps = 0;
        let gapCount = 0;

        for (let i = 0; i < individual.ilots.length; i++) {
            for (let j = i + 1; j < individual.ilots.length; j++) {
                const gap = this.calculateGap(individual.ilots[i], individual.ilots[j]);
                if (gap > 0 && gap < 10) { // Only count relevant gaps
                    totalGaps += gap;
                    gapCount++;
                }
            }
        }

        const avgGap = gapCount > 0 ? totalGaps / gapCount : 0;

        // Optimal corridor width: 1.5-2.5m
        if (avgGap >= 1.5 && avgGap <= 2.5) {
            return 1.0;
        } else if (avgGap < 1.5) {
            return Math.max(0, avgGap / 1.5);
        } else {
            return Math.max(0, 1 - (avgGap - 2.5) / 5);
        }
    }

    /**
     * Calculate gap between two ilots
     */
    calculateGap(ilot1, ilot2) {
        const horizontalGap = Math.max(0, 
            Math.min(ilot1.x + ilot1.width, ilot2.x + ilot2.width) - 
            Math.max(ilot1.x, ilot2.x)
        );

        const verticalGap = Math.max(0,
            Math.min(ilot1.y + ilot1.height, ilot2.y + ilot2.height) - 
            Math.max(ilot1.y, ilot2.y)
        );

        if (horizontalGap > 0 && verticalGap > 0) {
            return 0; // Overlapping
        }

        // Calculate minimum distance
        const dx = Math.max(0, Math.max(ilot1.x, ilot2.x) - Math.min(ilot1.x + ilot1.width, ilot2.x + ilot2.width));
        const dy = Math.max(0, Math.max(ilot1.y, ilot2.y) - Math.min(ilot1.y + ilot1.height, ilot2.y + ilot2.height));

        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Evaluate accessibility to entrances
     */
    evaluateAccessibility(individual) {
        if (!this.floorPlan.entrances || this.floorPlan.entrances.length === 0) {
            return 1.0; // No entrances to check
        }

        let totalDistance = 0;

        individual.ilots.forEach(ilot => {
            const ilotCenter = {
                x: ilot.x + ilot.width / 2,
                y: ilot.y + ilot.height / 2
            };

            // Find nearest entrance
            let minDistance = Infinity;
            this.floorPlan.entrances.forEach(entrance => {
                const entrancePos = entrance.center || entrance;
                const distance = Math.sqrt(
                    Math.pow(ilotCenter.x - entrancePos.x, 2) +
                    Math.pow(ilotCenter.y - entrancePos.y, 2)
                );
                minDistance = Math.min(minDistance, distance);
            });

            totalDistance += minDistance;
        });

        const avgDistance = totalDistance / individual.ilots.length;

        // Optimal average distance: 5-15m
        if (avgDistance >= 5 && avgDistance <= 15) {
            return 1.0;
        } else if (avgDistance < 5) {
            return avgDistance / 5;
        } else {
            return Math.max(0, 1 - (avgDistance - 15) / 30);
        }
    }

    /**
     * Evaluate aesthetics (alignment, regularity)
     */
    evaluateAesthetics(individual) {
        let score = 0;

        // Grid alignment score
        const gridScore = this.evaluateGridAlignment(individual.ilots);
        score += gridScore * 0.5;

        // Size regularity score
        const regularityScore = this.evaluateSizeRegularity(individual.ilots);
        score += regularityScore * 0.5;

        return score;
    }

    /**
     * Evaluate grid alignment
     */
    evaluateGridAlignment(ilots) {
        if (ilots.length === 0) return 0;

        // Check alignment on grid (0.5m precision)
        const gridSize = 0.5;
        let alignedCount = 0;

        ilots.forEach(ilot => {
            const xAligned = Math.abs(ilot.x % gridSize) < 0.1 || Math.abs(ilot.x % gridSize - gridSize) < 0.1;
            const yAligned = Math.abs(ilot.y % gridSize) < 0.1 || Math.abs(ilot.y % gridSize - gridSize) < 0.1;
            
            if (xAligned && yAligned) {
                alignedCount++;
            }
        });

        return alignedCount / ilots.length;
    }

    /**
     * Evaluate size regularity
     */
    evaluateSizeRegularity(ilots) {
        if (ilots.length === 0) return 0;

        const areas = ilots.map(i => i.area);
        const mean = areas.reduce((sum, a) => sum + a, 0) / areas.length;
        const variance = areas.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / areas.length;
        const stdDev = Math.sqrt(variance);

        // Lower variance = better regularity
        const coefficientOfVariation = stdDev / mean;

        return Math.max(0, 1 - coefficientOfVariation);
    }

    /**
     * Evaluate constraints (collisions, forbidden zones)
     */
    evaluateConstraints(individual) {
        let violations = 0;

        // Check ilot-ilot collisions
        for (let i = 0; i < individual.ilots.length; i++) {
            for (let j = i + 1; j < individual.ilots.length; j++) {
                if (this.checkCollision(individual.ilots[i], individual.ilots[j])) {
                    violations++;
                }
            }
        }

        // Check forbidden zone violations
        if (this.floorPlan.forbiddenZones) {
            individual.ilots.forEach(ilot => {
                this.floorPlan.forbiddenZones.forEach(zone => {
                    if (this.checkCollision(ilot, zone)) {
                        violations++;
                    }
                });
            });
        }

        // Check entrance violations
        if (this.floorPlan.entrances) {
            individual.ilots.forEach(ilot => {
                this.floorPlan.entrances.forEach(entrance => {
                    if (this.checkCollision(ilot, entrance)) {
                        violations++;
                    }
                });
            });
        }

        // Check bounds violations
        individual.ilots.forEach(ilot => {
            if (ilot.x < this.bounds.minX || ilot.x + ilot.width > this.bounds.maxX ||
                ilot.y < this.bounds.minY || ilot.y + ilot.height > this.bounds.maxY) {
                violations++;
            }
        });

        // Penalty function
        return Math.max(0, 1 - violations / 10);
    }

    /**
     * Check collision between two rectangles
     */
    checkCollision(rect1, rect2) {
        const r1 = {
            x: rect1.x,
            y: rect1.y,
            width: rect1.width || 1,
            height: rect1.height || 1
        };

        const r2 = {
            x: rect2.x || rect2.start?.x || 0,
            y: rect2.y || rect2.start?.y || 0,
            width: rect2.width || (rect2.end ? Math.abs(rect2.end.x - rect2.start.x) : 1),
            height: rect2.height || (rect2.end ? Math.abs(rect2.end.y - rect2.start.y) : 1)
        };

        return !(r1.x + r1.width < r2.x ||
                 r2.x + r2.width < r1.x ||
                 r1.y + r1.height < r2.y ||
                 r2.y + r2.height < r1.y);
    }

    /**
     * Selection (tournament selection)
     */
    selection() {
        const parents = [];
        const parentCount = Math.floor(this.config.populationSize * this.config.crossoverRate);

        for (let i = 0; i < parentCount; i++) {
            const tournament = [];
            
            // Select random individuals for tournament
            for (let j = 0; j < this.config.tournamentSize; j++) {
                const randomIndex = Math.floor(Math.random() * this.population.length);
                tournament.push(this.population[randomIndex]);
            }

            // Select best from tournament
            tournament.sort((a, b) => b.fitness.total - a.fitness.total);
            parents.push(tournament[0]);
        }

        return parents;
    }

    /**
     * Crossover (uniform crossover for ilot layouts)
     */
    crossover(parents) {
        const offspring = [];

        for (let i = 0; i < parents.length; i += 2) {
            if (i + 1 < parents.length) {
                const parent1 = parents[i];
                const parent2 = parents[i + 1];

                const [child1, child2] = this.uniformCrossover(parent1, parent2);
                offspring.push(child1, child2);
            } else {
                offspring.push({ ...parents[i], ilots: [...parents[i].ilots] });
            }
        }

        return offspring;
    }

    /**
     * Uniform crossover
     */
    uniformCrossover(parent1, parent2) {
        const child1Ilots = [];
        const child2Ilots = [];

        const maxLength = Math.max(parent1.ilots.length, parent2.ilots.length);

        for (let i = 0; i < maxLength; i++) {
            if (Math.random() < 0.5) {
                if (i < parent1.ilots.length) child1Ilots.push({ ...parent1.ilots[i] });
                if (i < parent2.ilots.length) child2Ilots.push({ ...parent2.ilots[i] });
            } else {
                if (i < parent2.ilots.length) child1Ilots.push({ ...parent2.ilots[i] });
                if (i < parent1.ilots.length) child2Ilots.push({ ...parent1.ilots[i] });
            }
        }

        return [
            { ilots: child1Ilots, fitness: null, generation: this.generation },
            { ilots: child2Ilots, fitness: null, generation: this.generation }
        ];
    }

    /**
     * Mutation
     */
    mutate(offspring) {
        const mutationRate = this.config.adaptiveMutation ? 
            this.getAdaptiveMutationRate() : 
            this.config.mutationRate;

        offspring.forEach(individual => {
            if (Math.random() < mutationRate) {
                const mutationType = Math.random();

                if (mutationType < 0.4) {
                    // Position mutation
                    this.mutatePosition(individual);
                } else if (mutationType < 0.7) {
                    // Size mutation
                    this.mutateSize(individual);
                } else if (mutationType < 0.9) {
                    // Swap mutation
                    this.mutateSwap(individual);
                } else {
                    // Add/remove mutation
                    this.mutateAddRemove(individual);
                }
            }
        });
    }

    /**
     * Position mutation
     */
    mutatePosition(individual) {
        if (individual.ilots.length === 0) return;

        const ilot = individual.ilots[Math.floor(Math.random() * individual.ilots.length)];
        const maxShift = 2.0; // 2m maximum shift

        ilot.x += (Math.random() - 0.5) * maxShift;
        ilot.y += (Math.random() - 0.5) * maxShift;

        // Clamp to bounds
        ilot.x = Math.max(this.bounds.minX, Math.min(ilot.x, this.bounds.maxX - ilot.width));
        ilot.y = Math.max(this.bounds.minY, Math.min(ilot.y, this.bounds.maxY - ilot.height));
    }

    /**
     * Size mutation
     */
    mutateSize(individual) {
        if (individual.ilots.length === 0) return;

        const ilot = individual.ilots[Math.floor(Math.random() * individual.ilots.length)];
        const scaleFactor = 0.9 + Math.random() * 0.2; // 0.9 to 1.1

        ilot.width *= scaleFactor;
        ilot.height *= scaleFactor;
        ilot.area = ilot.width * ilot.height;
    }

    /**
     * Swap mutation
     */
    mutateSwap(individual) {
        if (individual.ilots.length < 2) return;

        const idx1 = Math.floor(Math.random() * individual.ilots.length);
        const idx2 = Math.floor(Math.random() * individual.ilots.length);

        const temp = { x: individual.ilots[idx1].x, y: individual.ilots[idx1].y };
        individual.ilots[idx1].x = individual.ilots[idx2].x;
        individual.ilots[idx1].y = individual.ilots[idx2].y;
        individual.ilots[idx2].x = temp.x;
        individual.ilots[idx2].y = temp.y;
    }

    /**
     * Add/remove mutation
     */
    mutateAddRemove(individual) {
        if (Math.random() < 0.5 && individual.ilots.length > 5) {
            // Remove random ilot
            const idx = Math.floor(Math.random() * individual.ilots.length);
            individual.ilots.splice(idx, 1);
        } else {
            // Add random ilot
            const area = 2 + Math.random() * 8; // 2-10 m²
            const aspectRatio = 0.5 + Math.random() * 1.5;
            const height = Math.sqrt(area / aspectRatio);
            const width = area / height;

            individual.ilots.push({
                x: this.bounds.minX + Math.random() * (this.bounds.maxX - this.bounds.minX - width),
                y: this.bounds.minY + Math.random() * (this.bounds.maxY - this.bounds.minY - height),
                width, height, area,
                id: `ilot_${individual.ilots.length}`
            });
        }
    }

    /**
     * Adaptive mutation rate
     */
    getAdaptiveMutationRate() {
        const diversity = this.calculateDiversity();
        
        // Increase mutation when diversity is low
        if (diversity < 0.1) {
            return this.config.mutationRate * 2;
        } else if (diversity > 0.5) {
            return this.config.mutationRate * 0.5;
        }
        
        return this.config.mutationRate;
    }

    /**
     * Calculate population diversity
     */
    calculateDiversity() {
        if (this.population.length < 2) return 1;

        let totalDistance = 0;
        let comparisons = 0;

        for (let i = 0; i < this.population.length; i++) {
            for (let j = i + 1; j < this.population.length; j++) {
                totalDistance += this.calculateIndividualDistance(this.population[i], this.population[j]);
                comparisons++;
            }
        }

        return totalDistance / comparisons;
    }

    /**
     * Calculate distance between two individuals
     */
    calculateIndividualDistance(ind1, ind2) {
        const lengthDiff = Math.abs(ind1.ilots.length - ind2.ilots.length);
        return lengthDiff / Math.max(ind1.ilots.length, ind2.ilots.length);
    }

    /**
     * Replacement (elitism + offspring)
     */
    replacement(population, offspring) {
        // Sort population by fitness
        population.sort((a, b) => b.fitness.total - a.fitness.total);

        // Keep elite individuals
        const eliteCount = Math.floor(this.config.populationSize * this.config.elitismRate);
        const elite = population.slice(0, eliteCount);

        // Combine elite and offspring
        const combined = [...elite, ...offspring];

        // Sort and select best
        combined.sort((a, b) => b.fitness.total - a.fitness.total);

        return combined.slice(0, this.config.populationSize);
    }

    /**
     * Update best individual
     */
    updateBestIndividual() {
        const best = this.population.reduce((best, ind) => {
            return ind.fitness.total > best.fitness.total ? ind : best;
        }, this.population[0]);

        if (!this.bestIndividual || best.fitness.total > this.bestIndividual.fitness.total) {
            this.bestIndividual = { ...best, ilots: best.ilots.map(i => ({ ...i })) };
        }
    }

    /**
     * Track convergence
     */
    trackConvergence() {
        const avgFitness = this.getAverageFitness();
        const bestFitness = this.bestIndividual.fitness.total;

        this.convergenceHistory.push({
            generation: this.generation,
            avgFitness: avgFitness,
            bestFitness: bestFitness,
            diversity: this.calculateDiversity()
        });
    }

    /**
     * Get average fitness
     */
    getAverageFitness() {
        const sum = this.population.reduce((sum, ind) => sum + ind.fitness.total, 0);
        return sum / this.population.length;
    }

    /**
     * Check convergence
     */
    hasConverged() {
        if (this.convergenceHistory.length < 10) return false;

        // Check if best fitness hasn't improved in last 10 generations
        const recent = this.convergenceHistory.slice(-10);
        const fitnessRange = Math.max(...recent.map(h => h.bestFitness)) - 
                            Math.min(...recent.map(h => h.bestFitness));

        return fitnessRange < 0.001; // Convergence threshold
    }

    /**
     * Get optimization statistics
     */
    getStatistics() {
        return {
            generation: this.generation,
            bestFitness: this.bestIndividual?.fitness,
            averageFitness: this.getAverageFitness(),
            diversity: this.calculateDiversity(),
            convergenceHistory: this.convergenceHistory
        };
    }

    /**
     * Cleanup
     */
    async cleanup() {
        // Terminate workers if any
        for (const worker of this.workers) {
            await worker.terminate();
        }
        this.workers = [];
    }
}

module.exports = GeneticOptimizer;
