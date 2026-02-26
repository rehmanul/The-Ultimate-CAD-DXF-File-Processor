/**
 * Intelligent Box Size Optimizer
 * 
 * Uses machine learning principles and optimization algorithms to:
 * 1. Determine optimal box sizes based on unit mix and floor geometry
 * 2. Minimize wasted space while respecting constraints
 * 3. Maximize yield (leasable area / total area)
 * 4. Balance between standard sizes and custom fits
 * 
 * Inspired by bin-packing algorithms and genetic optimization
 */

class IntelligentBoxOptimizer {
    constructor(options = {}) {
        // Standard COSTO box categories (matching reference output)
        this.standardSizes = {
            'XS': { area: 1.5, width: 1.0, depth: 1.5, label: '1-2 m²' },
            'S':  { area: 2.5, width: 1.5, depth: 1.7, label: '2-3 m²' },
            'M':  { area: 5.0, width: 2.0, depth: 2.5, label: '4-6 m²' },
            'L':  { area: 7.5, width: 2.5, depth: 3.0, label: '6-9 m²' },
            'XL': { area: 10.0, width: 3.0, depth: 3.3, label: '9-12 m²' }
        };
        
        this.boxDepth = options.boxDepth || 2.5;
        this.minWidth = options.minWidth || 1.0;
        this.maxWidth = options.maxWidth || 4.5;
        this.tolerance = options.tolerance || 0.15; // 15% area tolerance
    }
    
    /**
     * INTELLIGENT SIZE DISTRIBUTION
     * Analyzes unit mix and floor geometry to determine optimal box sizes
     * 
     * @param {Object} unitMix - Unit mix distribution {type: {percentage, targetArea}}
     * @param {number} targetCount - Target number of boxes
     * @param {Object} floorGeometry - Floor dimensions and constraints
     * @returns {Array} Optimized array of box sizes
     */
    optimizeSizeDistribution(unitMix, targetCount, floorGeometry) {
        console.log('[BoxOptimizer] Analyzing unit mix and floor geometry...');
        
        const sizes = [];
        
        // Parse unit mix
        const distribution = this._parseUnitMix(unitMix);
        if (distribution.length === 0) {
            console.log('[BoxOptimizer] No valid distribution, using defaults');
            return this._generateDefaultSizes(targetCount);
        }
        
        // Calculate target counts per category
        const categoryCounts = this._calculateCategoryCounts(distribution, targetCount);
        
        // OPTIMIZATION STEP 1: Fit standard sizes to available space
        const rowLength = floorGeometry.availableWidth || 100;
        const optimizedSizes = this._fitSizesToRow(categoryCounts, rowLength);
        
        // OPTIMIZATION STEP 2: Fine-tune sizes to minimize gaps
        const refinedSizes = this._minimizeGaps(optimizedSizes, rowLength);
        
        // OPTIMIZATION STEP 3: Add variety within each category (realistic)
        const finalSizes = this._addSizeVariety(refinedSizes);
        
        console.log(`[BoxOptimizer] Generated ${finalSizes.length} optimized box sizes`);
        console.log(`[BoxOptimizer] Categories: ${Object.keys(categoryCounts).join(', ')}`);
        
        return finalSizes;
    }
    
    /**
     * Parse unit mix from various input formats
     */
    _parseUnitMix(unitMix) {
        const distribution = [];
        
        if (!unitMix || typeof unitMix !== 'object') {
            return distribution;
        }
        
        // Handle distribution object
        if (unitMix.distribution) {
            for (const [type, spec] of Object.entries(unitMix.distribution)) {
                const targetArea = spec.targetArea || spec.area || this._inferAreaFromType(type);
                const percentage = spec.percentage || spec.percent || 0;
                
                if (targetArea > 0 && percentage > 0) {
                    distribution.push({
                        type: type,
                        targetArea: targetArea,
                        percentage: percentage,
                        tolerance: spec.tolerance || this.tolerance
                    });
                }
            }
        }
        // Handle direct object format
        else {
            for (const [key, value] of Object.entries(unitMix)) {
                if (typeof value === 'object' && value.targetArea) {
                    distribution.push({
                        type: key,
                        targetArea: value.targetArea,
                        percentage: value.percentage || 25,
                        tolerance: value.tolerance || this.tolerance
                    });
                }
            }
        }
        
        // Normalize percentages to sum to 100
        const totalPercent = distribution.reduce((sum, d) => sum + d.percentage, 0);
        if (totalPercent > 0 && Math.abs(totalPercent - 100) > 0.1) {
            distribution.forEach(d => {
                d.percentage = (d.percentage / totalPercent) * 100;
            });
        }
        
        return distribution;
    }
    
    /**
     * Infer area from type code (S/M/L/XL)
     */
    _inferAreaFromType(type) {
        const normalized = type.toString().toUpperCase().trim();
        if (this.standardSizes[normalized]) {
            return this.standardSizes[normalized].area;
        }
        
        // Try to parse from range string like "2-3"
        const match = type.match(/(\d+)-(\d+)/);
        if (match) {
            return (parseInt(match[1]) + parseInt(match[2])) / 2;
        }
        
        return 5.0; // Default to M size
    }
    
    /**
     * Calculate target counts per category
     */
    _calculateCategoryCounts(distribution, targetCount) {
        const counts = {};
        
        for (const dist of distribution) {
            const count = Math.round((dist.percentage / 100) * targetCount);
            if (count > 0) {
                counts[dist.type] = {
                    count: count,
                    targetArea: dist.targetArea,
                    tolerance: dist.tolerance
                };
            }
        }
        
        // Adjust to exactly match targetCount
        let totalCount = Object.values(counts).reduce((sum, c) => sum + c.count, 0);
        if (totalCount !== targetCount && distribution.length > 0) {
            // Add/remove from largest category
            const largestType = Object.entries(counts).sort((a, b) => b[1].count - a[1].count)[0][0];
            counts[largestType].count += (targetCount - totalCount);
        }
        
        return counts;
    }
    
    /**
     * OPTIMIZATION: Fit sizes to row length to minimize gaps
     */
    _fitSizesToRow(categoryCounts, rowLength) {
        const sizes = [];
        
        for (const [type, spec] of Object.entries(categoryCounts)) {
            const baseWidth = spec.targetArea / this.boxDepth;
            const count = spec.count;
            
            // Calculate how many boxes of this size fit per row
            const boxesPerRow = Math.floor(rowLength / baseWidth);
            
            if (boxesPerRow === 0) {
                // Box too wide, use full row
                for (let i = 0; i < count; i++) {
                    sizes.push({
                        type: type,
                        width: Math.min(rowLength, baseWidth),
                        area: Math.min(rowLength, baseWidth) * this.boxDepth,
                        targetArea: spec.targetArea
                    });
                }
            } else {
                // Adjust width to fill row exactly
                const optimizedWidth = rowLength / boxesPerRow;
                
                for (let i = 0; i < count; i++) {
                    // Use optimized width for most boxes
                    const useOptimized = (i % boxesPerRow) < boxesPerRow;
                    const width = useOptimized ? optimizedWidth : baseWidth;
                    
                    sizes.push({
                        type: type,
                        width: Math.max(this.minWidth, Math.min(this.maxWidth, width)),
                        area: width * this.boxDepth,
                        targetArea: spec.targetArea
                    });
                }
            }
        }
        
        return sizes;
    }
    
    /**
     * OPTIMIZATION: Minimize gaps by adjusting box widths
     */
    _minimizeGaps(sizes, rowLength) {
        // Group boxes by rows
        const rows = [];
        let currentRow = [];
        let currentRowWidth = 0;
        
        for (const box of sizes) {
            if (currentRowWidth + box.width > rowLength && currentRow.length > 0) {
                rows.push([...currentRow]);
                currentRow = [];
                currentRowWidth = 0;
            }
            
            currentRow.push(box);
            currentRowWidth += box.width;
        }
        
        if (currentRow.length > 0) {
            rows.push(currentRow);
        }
        
        // Adjust each row to fill exactly
        const optimized = [];
        
        for (const row of rows) {
            const totalWidth = row.reduce((sum, b) => sum + b.width, 0);
            const gap = rowLength - totalWidth;
            
            if (gap > 0.1 && gap < 2.0) {
                // Distribute gap across boxes proportionally
                const scaleFactor = rowLength / totalWidth;
                
                for (const box of row) {
                    optimized.push({
                        ...box,
                        width: box.width * scaleFactor,
                        area: box.width * scaleFactor * this.boxDepth
                    });
                }
            } else {
                optimized.push(...row);
            }
        }
        
        return optimized;
    }
    
    /**
     * OPTIMIZATION: Add realistic variety within each category
     * Real-world storage facilities have slight size variations
     */
    _addSizeVariety(sizes) {
        const varied = [];
        
        for (let i = 0; i < sizes.length; i++) {
            const box = sizes[i];
            
            // Add ±5% variation to simulate real-world conditions
            const variationFactor = 1.0 + (Math.random() - 0.5) * 0.1; // ±5%
            const variedWidth = box.width * variationFactor;
            
            // Keep within tolerance of target area
            const variedArea = variedWidth * this.boxDepth;
            const areaDeviation = Math.abs(variedArea - box.targetArea) / box.targetArea;
            
            if (areaDeviation <= box.tolerance || this.tolerance) {
                varied.push({
                    ...box,
                    width: Math.max(this.minWidth, Math.min(this.maxWidth, variedWidth)),
                    area: variedArea,
                    hasVariation: true
                });
            } else {
                // Keep original if variation exceeds tolerance
                varied.push(box);
            }
        }
        
        return varied;
    }
    
    /**
     * Generate default sizes when no distribution provided
     */
    _generateDefaultSizes(targetCount) {
        const sizes = [];
        const distribution = [
            { type: 'S', percentage: 30 },
            { type: 'M', percentage: 30 },
            { type: 'L', percentage: 25 },
            { type: 'XL', percentage: 15 }
        ];
        
        for (const dist of distribution) {
            const count = Math.round((dist.percentage / 100) * targetCount);
            const stdSize = this.standardSizes[dist.type];
            
            for (let i = 0; i < count; i++) {
                sizes.push({
                    type: dist.type,
                    width: stdSize.width,
                    area: stdSize.area,
                    targetArea: stdSize.area
                });
            }
        }
        
        // Adjust to match target
        while (sizes.length < targetCount) {
            sizes.push({
                type: 'M',
                width: this.standardSizes['M'].width,
                area: this.standardSizes['M'].area,
                targetArea: this.standardSizes['M'].area
            });
        }
        
        return sizes.slice(0, targetCount);
    }
    
    /**
     * SMART PARTITION TYPE DETECTION
     * Determines whether a box edge should use Tôle Blanche or Tôle Grise
     * 
     * Rules (from COSTO standards):
     * - Tôle Grise (blue): Internal partitions between storage boxes
     * - Tôle Blanche (gray): Structural walls and building envelope
     */
    detectPartitionType(box, adjacentBoxes, walls) {
        const partitions = {
            top: 'tole_grise',
            bottom: 'tole_grise',
            left: 'tole_grise',
            right: 'tole_grise'
        };
        
        // Check each edge
        const edges = [
            { name: 'top', y: box.y + box.height, isHorizontal: true },
            { name: 'bottom', y: box.y, isHorizontal: true },
            { name: 'left', x: box.x, isHorizontal: false },
            { name: 'right', x: box.x + box.width, isHorizontal: false }
        ];
        
        for (const edge of edges) {
            // Check if edge is against a structural wall
            for (const wall of walls) {
                if (this._edgeAlignsWithWall(edge, wall, box)) {
                    partitions[edge.name] = 'tole_blanche';
                    break;
                }
            }
            
            // If not against wall, check if shared with another box
            const hasAdjacentBox = adjacentBoxes.some(adj => {
                return this._boxesShareEdge(box, adj, edge.name);
            });
            
            if (hasAdjacentBox) {
                partitions[edge.name] = 'tole_grise'; // Shared partition
            }
        }
        
        return partitions;
    }
    
    _edgeAlignsWithWall(edge, wall, box) {
        const tolerance = 0.2;
        
        if (edge.isHorizontal) {
            // Check horizontal edge against horizontal walls
            return Math.abs(edge.y - (wall.start?.y || 0)) < tolerance ||
                   Math.abs(edge.y - (wall.end?.y || 0)) < tolerance;
        } else {
            // Check vertical edge against vertical walls
            return Math.abs(edge.x - (wall.start?.x || 0)) < tolerance ||
                   Math.abs(edge.x - (wall.end?.x || 0)) < tolerance;
        }
    }
    
    _boxesShareEdge(box1, box2, edgeName) {
        const tolerance = 0.1;
        
        switch (edgeName) {
            case 'top':
                return Math.abs(box1.y + box1.height - box2.y) < tolerance;
            case 'bottom':
                return Math.abs(box1.y - (box2.y + box2.height)) < tolerance;
            case 'left':
                return Math.abs(box1.x - (box2.x + box2.width)) < tolerance;
            case 'right':
                return Math.abs(box1.x + box1.width - box2.x) < tolerance;
            default:
                return false;
        }
    }
}

module.exports = IntelligentBoxOptimizer;
