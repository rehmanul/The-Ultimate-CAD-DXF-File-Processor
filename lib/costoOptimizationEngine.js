/**
 * COSTO Optimization Engine - V1
 * Multi-criteria optimization for storage unit layout
 * Based on COSTO V1 specifications
 * 
 * Optimization Objectives (Priority order):
 * 1. Unit mix compliance (weighted deviation)
 * 2. Maximize leasable m² / usable m² (yield)
 * 3. Minimize partition linear meters (cost)
 * 4. Plan readability (axes, repeatability, standardization)
 */

const RowBasedIlotPlacer = require('./RowBasedIlotPlacer');
const CostoBoxCatalog = require('./costoBoxCatalog');

class CostoOptimizationEngine {
    constructor(floorPlan, unitMix, rules = {}) {
        this.floorPlan = floorPlan;
        this.unitMix = unitMix;
        this.rules = {
            mainCorridorWidth: rules.mainCorridorWidth || 1.5,
            secondaryCorridorWidth: rules.secondaryCorridorWidth || 1.2,
            minClearance: rules.minClearance || 0.3,
            roundingArea: rules.roundingArea || 0.5, // Round to nearest 0.5 m²
            roundingDimension: rules.roundingDimension || 0.1, // 0.1m grid
            ...rules
        };
        
        this.catalog = CostoBoxCatalog;
        this.bestSolution = null;
        this.optimizationHistory = [];
    }

    /**
     * Main optimization entry point
     * @param {Object} options - Optimization options
     * @returns {Object} - Optimized solution with metrics
     */
    optimize(options = {}) {
        const {
            maxIterations = 100,
            populationSize = 50,
            convergenceThreshold = 0.001,
            method = 'hybrid' // 'hybrid', 'genetic', 'simulated_annealing'
        } = options;

        console.log('[COSTO Optimizer] Starting optimization...');
        console.log(`[COSTO Optimizer] Method: ${method}, Max iterations: ${maxIterations}`);

        // Phase 1: Generate initial candidate solutions
        const candidates = this.generateCandidates(populationSize);
        console.log(`[COSTO Optimizer] Generated ${candidates.length} candidate solutions`);

        // Phase 2: Optimize using selected method
        let solution;
        if (method === 'genetic') {
            solution = this.geneticOptimization(candidates, maxIterations);
        } else if (method === 'simulated_annealing') {
            solution = this.simulatedAnnealing(candidates[0], maxIterations);
        } else {
            // Hybrid: genetic + simulated annealing
            solution = this.hybridOptimization(candidates, maxIterations);
        }

        // Phase 3: Post-processing (geometric cleaning, alignment, collision detection)
        solution = this.postProcess(solution);

        // Phase 4: Calculate final metrics
        const metrics = this.calculateMetrics(solution);
        solution.metrics = metrics;

        this.bestSolution = solution;
        console.log(`[COSTO Optimizer] Optimization complete. Score: ${metrics.totalScore.toFixed(3)}`);

        return solution;
    }

    /**
     * Generate candidate solutions (strips + cutting)
     * @param {number} count - Number of candidates to generate
     * @returns {Array<Object>} - Array of candidate solutions
     */
    generateCandidates(count) {
        const candidates = [];
        
        // Generate strips along main axes
        const strips = this.generateStrips();
        
        for (let i = 0; i < count; i++) {
            const solution = this.placeBoxesInStrips(strips, i);
            if (solution && solution.boxes.length > 0) {
                candidates.push(solution);
            }
        }

        return candidates;
    }

    /**
     * Generate strips (rows) along main axes
     * @returns {Array<Object>} - Array of strip definitions
     */
    generateStrips() {
        const strips = [];
        const bounds = this.floorPlan.bounds;
        const envelope = this.floorPlan.envelope || this.floorPlan.rooms?.[0]?.polygon;
        
        if (!bounds || !Number.isFinite(bounds.minX)) {
            console.warn('[COSTO Optimizer] Invalid bounds, using default');
            return strips;
        }

        // Determine main axis (horizontal or vertical)
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const isHorizontal = width >= height;

        // Generate strips
        const stripSpacing = this.rules.secondaryCorridorWidth + 2.5; // Average box depth + corridor
        const startPos = isHorizontal ? bounds.minY : bounds.minX;
        const endPos = isHorizontal ? bounds.maxY : bounds.maxX;
        const crossPos = isHorizontal ? bounds.minX : bounds.minY;
        const crossEnd = isHorizontal ? bounds.maxX : bounds.maxY;

        let currentPos = startPos + this.rules.minClearance;
        let stripId = 1;
        const maxStrips = 100; // Safety limit
        let stripCount = 0;

        while (currentPos < endPos - this.rules.minClearance && stripCount < maxStrips) {
            const strip = {
                id: `STRIP_${stripId++}`,
                orientation: isHorizontal ? 'horizontal' : 'vertical',
                position: currentPos,
                start: crossPos + this.rules.minClearance,
                end: crossEnd - this.rules.minClearance,
                boxes: []
            };

            strips.push(strip);
            currentPos += stripSpacing;
            stripCount++;
        }

        console.log(`[COSTO Optimizer] Generated ${strips.length} strips`);
        return strips;
    }

    /**
     * Place boxes in strips
     * @param {Array<Object>} strips - Strip definitions
     * @param {number} seed - Random seed for variation
     * @returns {Object} - Solution with boxes
     */
    placeBoxesInStrips(strips, seed = 0) {
        const boxes = [];
        const rng = this.createSeededRNG(seed);

        // Distribute unit mix across strips
        const unitMixDistribution = this.distributeUnitMix(strips.length, rng);

        strips.forEach((strip, stripIndex) => {
            const typologies = (unitMixDistribution && unitMixDistribution[stripIndex]) ? unitMixDistribution[stripIndex] : [];
            let currentPos = strip.start;
            const maxPos = strip.end;
            let placedInStrip = 0;
            const maxBoxesPerStrip = 50; // Safety limit

            for (const typo of typologies) {
                if (placedInStrip >= maxBoxesPerStrip) break;
                
                const template = this.catalog.getTemplate(typo.name);
                if (!template) {
                    // Use default if template not found
                    const defaultArea = typo.boxArea || typo.targetArea || 5;
                    const defaultWidth = Math.min(2.5, maxPos - currentPos - this.rules.minClearance);
                    const defaultDepth = defaultArea / defaultWidth;
                    
                    if (defaultWidth < 0.5 || defaultDepth < 0.5) continue;
                    
                    const x = strip.orientation === 'horizontal' ? currentPos : strip.position;
                    const y = strip.orientation === 'horizontal' ? strip.position : currentPos;
                    const width = strip.orientation === 'horizontal' ? defaultWidth : defaultDepth;
                    const height = strip.orientation === 'horizontal' ? defaultDepth : defaultWidth;
                    
                    boxes.push({
                        id: `BOX_${boxes.length + 1}`,
                        type: typo.name || 'M',
                        x,
                        y,
                        width,
                        height,
                        area: defaultArea,
                        zone: `ZONE_${Math.floor(stripIndex / 5) + 1}`,
                        row: stripIndex + 1,
                        stripId: strip.id
                    });
                    
                    currentPos += (strip.orientation === 'horizontal' ? width : height) + this.rules.minClearance;
                    placedInStrip++;
                    continue;
                }

                // Get box dimensions - use boxArea if available, otherwise targetArea
                const targetArea = typo.boxArea || typo.targetArea || template.minArea || 5;
                const availableWidth = maxPos - currentPos - this.rules.minClearance;
                
                if (availableWidth < 0.5) {
                    break; // No more space in this strip
                }
                
                const constraints = {
                    maxWidth: Math.max(0.5, availableWidth),
                    maxDepth: strip.orientation === 'horizontal' 
                        ? Math.max(1, (strips[stripIndex + 1]?.position || this.floorPlan.bounds.maxY) - strip.position - this.rules.minClearance)
                        : Math.max(1, (strips[stripIndex + 1]?.position || this.floorPlan.bounds.maxX) - strip.position - this.rules.minClearance)
                };

                // Ensure constraints are valid
                if (constraints.maxWidth < 0.5 || constraints.maxDepth < 0.5) {
                    break; // Strip is too narrow
                }

                const boxDims = this.catalog.getBoxDimensions(
                    typo.name,
                    targetArea,
                    constraints,
                    {
                        area: this.rules.roundingArea,
                        dimension: this.rules.roundingDimension
                    }
                );

                if (!boxDims || boxDims.width < 0.5 || boxDims.depth < 0.5) {
                    // Try with smaller area
                    const smallerArea = targetArea * 0.8;
                    const fallbackDims = this.catalog.getBoxDimensions(
                        typo.name,
                        smallerArea,
                        constraints,
                        {
                            area: this.rules.roundingArea,
                            dimension: this.rules.roundingDimension
                        }
                    );
                    if (!fallbackDims) continue;
                    
                    // Use fallback
                    const x = strip.orientation === 'horizontal' ? currentPos : strip.position;
                    const y = strip.orientation === 'horizontal' ? strip.position : currentPos;
                    const width = strip.orientation === 'horizontal' ? fallbackDims.width : fallbackDims.depth;
                    const height = strip.orientation === 'horizontal' ? fallbackDims.depth : fallbackDims.width;
                    
                    boxes.push({
                        id: `BOX_${boxes.length + 1}`,
                        type: fallbackDims.type,
                        x,
                        y,
                        width,
                        height,
                        area: fallbackDims.area,
                        zone: `ZONE_${Math.floor(stripIndex / 5) + 1}`,
                        row: stripIndex + 1,
                        stripId: strip.id
                    });
                    
                    currentPos += (strip.orientation === 'horizontal' ? width : height) + this.rules.minClearance;
                    placedInStrip++;
                    continue;
                }

                // Place box
                const x = strip.orientation === 'horizontal' ? currentPos : strip.position;
                const y = strip.orientation === 'horizontal' ? strip.position : currentPos;
                const width = strip.orientation === 'horizontal' ? boxDims.width : boxDims.depth;
                const height = strip.orientation === 'horizontal' ? boxDims.depth : boxDims.width;

                // Check if box fits
                if (currentPos + (strip.orientation === 'horizontal' ? width : height) > maxPos) {
                    break; // No more space
                }

                boxes.push({
                    id: `BOX_${boxes.length + 1}`,
                    type: boxDims.type,
                    x,
                    y,
                    width,
                    height,
                    area: boxDims.area,
                    zone: `ZONE_${Math.floor(stripIndex / 5) + 1}`,
                    row: stripIndex + 1,
                    stripId: strip.id,
                    doorWidth: boxDims.doorWidth
                });

                currentPos += (strip.orientation === 'horizontal' ? width : height) + this.rules.minClearance;
                placedInStrip++;
            }
        });

        return {
            boxes,
            strips,
            score: this.scoreSolution({ boxes })
        };
    }

    /**
     * Distribute unit mix across strips
     * @param {number} stripCount - Number of strips
     * @param {Function} rng - Random number generator
     * @returns {Array<Array>} - Typologies per strip
     */
    distributeUnitMix(stripCount, rng) {
        const distribution = [];
        for (let i = 0; i < stripCount; i++) {
            distribution.push([]);
        }
        
        if (!this.unitMix || !this.unitMix.typologies || stripCount === 0) {
            return distribution;
        }

        // Enhanced distribution: ensure each typology gets distributed
        this.unitMix.typologies.forEach(typo => {
            const priority = typo.priority === 'obligatoire' ? 3 : 1;
            // Estimate boxes needed based on target area
            const avgArea = (typo.minArea + typo.maxArea) / 2 || typo.targetArea || 5;
            const boxesNeeded = Math.max(1, Math.ceil(typo.targetArea / avgArea) * priority);
            
            // Distribute boxes across strips
            for (let i = 0; i < boxesNeeded; i++) {
                const stripIndex = Math.floor(rng() * stripCount);
                if (stripIndex >= 0 && stripIndex < distribution.length) {
                    // Create a copy of typo for this box
                    distribution[stripIndex].push({
                        ...typo,
                        boxArea: avgArea + (rng() - 0.5) * (typo.maxArea - typo.minArea) * 0.2 // Slight variation
                    });
                }
            }
        });

        // Ensure at least some boxes in each strip
        distribution.forEach((strip, idx) => {
            if (strip.length === 0 && this.unitMix.typologies.length > 0) {
                // Add at least one box from first typology
                const firstTypo = this.unitMix.typologies[0];
                strip.push({
                    ...firstTypo,
                    boxArea: (firstTypo.minArea + firstTypo.maxArea) / 2 || firstTypo.targetArea
                });
            }
        });

        return distribution;
    }

    /**
     * Score a solution (multi-criteria)
     * @param {Object} solution - Solution to score
     * @returns {Object} - Score breakdown
     */
    scoreSolution(solution) {
        const boxes = solution.boxes || [];
        
        // Objective 1: Unit mix compliance (weight: 0.4)
        const complianceScore = this.scoreUnitMixCompliance(boxes);
        
        // Objective 2: Yield - leasable m² / usable m² (weight: 0.3)
        const yieldScore = this.scoreYield(boxes);
        
        // Objective 3: Minimize partition cost (weight: 0.2)
        const partitionScore = this.scorePartitionCost(boxes);
        
        // Objective 4: Plan readability (weight: 0.1)
        const readabilityScore = this.scoreReadability(boxes);

        const totalScore = 
            complianceScore * 0.4 +
            yieldScore * 0.3 +
            partitionScore * 0.2 +
            readabilityScore * 0.1;

        return {
            totalScore,
            complianceScore,
            yieldScore,
            partitionScore,
            readabilityScore,
            breakdown: {
                unitMixCompliance: complianceScore,
                yield: yieldScore,
                partitionCost: partitionScore,
                readability: readabilityScore
            }
        };
    }

    /**
     * Score unit mix compliance
     * @param {Array<Object>} boxes - Generated boxes
     * @returns {number} - Score 0-1
     */
    scoreUnitMixCompliance(boxes) {
        if (!this.unitMix || !this.unitMix.typologies) return 0;

        let totalDeviation = 0;
        let totalWeight = 0;

        this.unitMix.typologies.forEach(typo => {
            const actualBoxes = boxes.filter(b => b.type === typo.name);
            const actualArea = actualBoxes.reduce((sum, b) => sum + (b.area || b.width * b.height), 0);
            const deviation = Math.abs(actualArea - typo.targetArea);
            const tolerance = typo.tolerance || typo.targetArea * 0.1;
            
            const normalizedDeviation = Math.min(1, deviation / (typo.targetArea + tolerance));
            const weight = typo.priority === 'obligatoire' ? 2 : 1;
            
            totalDeviation += normalizedDeviation * weight;
            totalWeight += weight;
        });

        return totalWeight > 0 ? Math.max(0, 1 - (totalDeviation / totalWeight)) : 0;
    }

    /**
     * Score yield (leasable m² / usable m²)
     * @param {Array<Object>} boxes - Generated boxes
     * @returns {number} - Score 0-1
     */
    scoreYield(boxes) {
        if (!boxes || boxes.length === 0) return 0;
        
        const totalBoxArea = boxes.reduce((sum, b) => {
            const area = b.area || (b.width && b.height ? b.width * b.height : 0);
            return sum + (isFinite(area) ? area : 0);
        }, 0);
        
        const usableArea = this.calculateUsableArea();
        
        if (!isFinite(usableArea) || usableArea <= 0) return 0;
        
        const yieldRatio = totalBoxArea / usableArea;
        // Target yield: 0.7-0.8 is excellent, normalize to 0-1
        return Math.min(1, Math.max(0, yieldRatio / 0.8));
    }

    /**
     * Score partition cost (minimize linear meters)
     * @param {Array<Object>} boxes - Generated boxes
     * @returns {number} - Score 0-1 (higher = less partitions = better)
     */
    scorePartitionCost(boxes) {
        // Estimate partition length (simplified)
        const estimatedPartitionLength = boxes.length * 2.5; // Average perimeter per box
        const maxExpectedPartitions = boxes.length * 4; // Worst case
        
        return Math.max(0, 1 - (estimatedPartitionLength / maxExpectedPartitions));
    }

    /**
     * Score readability (alignment, standardization)
     * @param {Array<Object>} boxes - Generated boxes
     * @returns {number} - Score 0-1
     */
    scoreReadability(boxes) {
        if (boxes.length === 0) return 0;

        // Check alignment
        const xPositions = boxes.map(b => b.x);
        const yPositions = boxes.map(b => b.y);
        
        const xAlignment = this.calculateAlignment(xPositions);
        const yAlignment = this.calculateAlignment(yPositions);
        
        return (xAlignment + yAlignment) / 2;
    }

    calculateAlignment(positions) {
        if (positions.length < 2) return 1;
        
        const sorted = [...positions].sort((a, b) => a - b);
        const gridSize = this.rules.roundingDimension;
        let alignedCount = 0;
        
        sorted.forEach(pos => {
            const rounded = Math.round(pos / gridSize) * gridSize;
            if (Math.abs(pos - rounded) < gridSize * 0.1) {
                alignedCount++;
            }
        });
        
        return alignedCount / positions.length;
    }

    /**
     * Hybrid optimization (genetic + simulated annealing)
     */
    hybridOptimization(candidates, maxIterations) {
        // Phase 1: Genetic algorithm for global search
        let population = candidates.slice(0, 50);
        const generations = Math.floor(maxIterations * 0.7);

        for (let gen = 0; gen < generations; gen++) {
            // Evaluate
            population.forEach(sol => {
                sol.score = this.scoreSolution(sol);
            });
            
            // Sort by score
            population.sort((a, b) => (b.score?.totalScore || 0) - (a.score?.totalScore || 0));
            
            // Keep elite
            const eliteSize = Math.floor(population.length * 0.2);
            const elite = population.slice(0, eliteSize);
            
            // Generate new population
            const newPopulation = [...elite];
            while (newPopulation.length < population.length) {
                const parent1 = this.tournamentSelection(population);
                const parent2 = this.tournamentSelection(population);
                const offspring = this.crossover(parent1, parent2);
                this.mutate(offspring);
                newPopulation.push(offspring);
            }
            
            population = newPopulation;
        }

        // Phase 2: Simulated annealing for local refinement
        let best = population[0];
        return this.simulatedAnnealing(best, Math.floor(maxIterations * 0.3));
    }

    tournamentSelection(population, tournamentSize = 3) {
        const tournament = [];
        for (let i = 0; i < tournamentSize; i++) {
            tournament.push(population[Math.floor(Math.random() * population.length)]);
        }
        tournament.sort((a, b) => (b.score?.totalScore || 0) - (a.score?.totalScore || 0));
        return tournament[0];
    }

    crossover(parent1, parent2) {
        // Simple crossover: take boxes from both parents
        const boxes = [
            ...parent1.boxes.slice(0, Math.floor(parent1.boxes.length / 2)),
            ...parent2.boxes.slice(Math.floor(parent2.boxes.length / 2))
        ];
        return { boxes, score: null };
    }

    mutate(solution) {
        // Random mutation: slightly adjust box positions
        solution.boxes.forEach(box => {
            if (Math.random() < 0.1) {
                box.x += (Math.random() - 0.5) * 0.2;
                box.y += (Math.random() - 0.5) * 0.2;
            }
        });
    }

    simulatedAnnealing(initialSolution, maxIterations) {
        let current = initialSolution;
        let best = { ...current, score: this.scoreSolution(current) };
        let temperature = 1000;
        const coolingRate = 0.95;

        for (let i = 0; i < maxIterations; i++) {
            const neighbor = this.generateNeighbor(current);
            neighbor.score = this.scoreSolution(neighbor);
            
            const delta = neighbor.score.totalScore - (current.score?.totalScore || 0);
            
            if (delta > 0 || Math.random() < Math.exp(delta / temperature)) {
                current = neighbor;
                if (neighbor.score.totalScore > (best.score?.totalScore || 0)) {
                    best = neighbor;
                }
            }
            
            temperature *= coolingRate;
        }

        return best;
    }

    generateNeighbor(solution) {
        // Generate neighbor by small adjustments
        const neighbor = {
            boxes: solution.boxes.map(b => ({ ...b }))
        };
        
        // Randomly adjust a few boxes
        const adjustCount = Math.max(1, Math.floor(neighbor.boxes.length * 0.1));
        for (let i = 0; i < adjustCount; i++) {
            const idx = Math.floor(Math.random() * neighbor.boxes.length);
            neighbor.boxes[idx].x += (Math.random() - 0.5) * 0.5;
            neighbor.boxes[idx].y += (Math.random() - 0.5) * 0.5;
        }
        
        return neighbor;
    }

    /**
     * Post-process solution (geometric cleaning, alignment, collision detection)
     */
    postProcess(solution) {
        // Remove collisions
        solution.boxes = this.removeCollisions(solution.boxes);
        
        // Align to grid
        solution.boxes = this.alignToGrid(solution.boxes);
        
        // Remove boxes outside envelope
        solution.boxes = this.filterToEnvelope(solution.boxes);
        
        return solution;
    }

    removeCollisions(boxes) {
        const valid = [];
        for (const box of boxes) {
            let hasCollision = false;
            for (const other of valid) {
                if (this.boxesOverlap(box, other)) {
                    hasCollision = true;
                    break;
                }
            }
            if (!hasCollision) {
                valid.push(box);
            }
        }
        return valid;
    }

    boxesOverlap(box1, box2) {
        return !(
            box1.x + box1.width <= box2.x ||
            box2.x + box2.width <= box1.x ||
            box1.y + box1.height <= box2.y ||
            box2.y + box2.height <= box1.y
        );
    }

    alignToGrid(boxes) {
        const gridSize = this.rules.roundingDimension;
        return boxes.map(box => ({
            ...box,
            x: Math.round(box.x / gridSize) * gridSize,
            y: Math.round(box.y / gridSize) * gridSize
        }));
    }

    filterToEnvelope(boxes) {
        const envelope = this.floorPlan.envelope || this.floorPlan.rooms?.[0]?.polygon;
        if (!envelope) return boxes;
        
        return boxes.filter(box => {
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            return this.pointInPolygon([centerX, centerY], envelope);
        });
    }

    pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i][0] || polygon[i].x;
            const yi = polygon[i][1] || polygon[i].y;
            const xj = polygon[j][0] || polygon[j].x;
            const yj = polygon[j][1] || polygon[j].y;
            
            const intersect = ((yi > point[1]) !== (yj > point[1])) &&
                (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    /**
     * Calculate metrics for solution
     */
    calculateMetrics(solution) {
        const boxes = solution.boxes || [];
        const score = this.scoreSolution(solution);
        
        const totalArea = boxes.reduce((sum, b) => {
            const area = b.area || (b.width && b.height ? b.width * b.height : 0);
            return sum + (isFinite(area) ? area : 0);
        }, 0);
        
        const usableArea = this.calculateUsableArea();
        const yieldRatio = usableArea > 0 ? totalArea / usableArea : 0;
        
        return {
            totalScore: isFinite(score.totalScore) ? score.totalScore : 0,
            unitMixCompliance: isFinite(score.complianceScore) ? score.complianceScore : 0,
            yield: isFinite(score.yieldScore) ? score.yieldScore : 0,
            partitionCost: isFinite(score.partitionScore) ? score.partitionScore : 0,
            readability: isFinite(score.readabilityScore) ? score.readabilityScore : 0,
            totalBoxes: boxes.length,
            totalArea: totalArea,
            usableArea: usableArea,
            yieldRatio: isFinite(yieldRatio) ? yieldRatio : 0
        };
    }

    calculateUsableArea() {
        const envelope = this.floorPlan.envelope || this.floorPlan.rooms?.[0]?.polygon;
        if (!envelope) {
            const bounds = this.floorPlan.bounds;
            if (bounds && isFinite(bounds.maxX)) {
                return (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
            }
            return 1000; // Default fallback
        }
        
        // Calculate polygon area
        let area = 0;
        for (let i = 0; i < envelope.length; i++) {
            const j = (i + 1) % envelope.length;
            const xi = Array.isArray(envelope[i]) ? envelope[i][0] : envelope[i].x;
            const yi = Array.isArray(envelope[i]) ? envelope[i][1] : envelope[i].y;
            const xj = Array.isArray(envelope[j]) ? envelope[j][0] : envelope[j].x;
            const yj = Array.isArray(envelope[j]) ? envelope[j][1] : envelope[j].y;
            if (isFinite(xi) && isFinite(yi) && isFinite(xj) && isFinite(yj)) {
                area += xi * yj - xj * yi;
            }
        }
        const calculatedArea = Math.abs(area / 2);
        return calculatedArea > 0 ? calculatedArea : 1000; // Fallback
    }

    createSeededRNG(seed) {
        let state = seed;
        return () => {
            state = (state * 9301 + 49297) % 233280;
            return state / 233280;
        };
    }

    geneticOptimization(candidates, maxIterations) {
        // Simplified genetic algorithm
        return this.hybridOptimization(candidates, maxIterations);
    }
}

module.exports = CostoOptimizationEngine;
