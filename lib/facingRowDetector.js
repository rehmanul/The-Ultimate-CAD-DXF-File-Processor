/**
 * Facing Row Detector
 * Identifies rows of îlots that face each other for corridor generation
 */

class FacingRowDetector {
    constructor(ilots, options = {}) {
        this.ilots = ilots;
        this.rowTolerance = options.rowTolerance || 3.0; // Y-axis tolerance for row grouping
        this.minRowDistance = options.minRowDistance || 1.5; // Min distance between facing rows
        this.maxRowDistance = options.maxRowDistance || 8.0; // Max distance for facing rows
        this.minOverlap = options.minOverlap || 0.5; // Min overlap ratio (0-1) for facing rows
    }

    /**
     * Detect all facing row pairs in the floor plan
     */
    detectFacingRows() {
        // Step 1: Group îlots into horizontal rows
        const rows = this.groupIntoRows();
        
        // Step 2: Find pairs of rows that face each other
        const facingPairs = this.findFacingPairs(rows);
        
        console.log(`[Facing Row Detector] Found ${rows.length} rows, ${facingPairs.length} facing pairs`);
        
        return {
            rows,
            facingPairs,
            statistics: this.calculateStatistics(rows, facingPairs)
        };
    }

    /**
     * Group îlots into horizontal rows based on Y-coordinate
     */
    groupIntoRows() {
        if (this.ilots.length === 0) return [];
        
        // Sort by Y position
        const sorted = [...this.ilots].sort((a, b) => a.y - b.y);
        
        const rows = [];
        let currentRow = {
            ilots: [sorted[0]],
            minY: sorted[0].y,
            maxY: sorted[0].y + sorted[0].height,
            avgY: sorted[0].y + sorted[0].height / 2
        };
        
        for (let i = 1; i < sorted.length; i++) {
            const ilot = sorted[i];
            const ilotCenterY = ilot.y + ilot.height / 2;
            
            // Check if this îlot belongs to current row
            if (Math.abs(ilotCenterY - currentRow.avgY) < this.rowTolerance) {
                currentRow.ilots.push(ilot);
                currentRow.minY = Math.min(currentRow.minY, ilot.y);
                currentRow.maxY = Math.max(currentRow.maxY, ilot.y + ilot.height);
                currentRow.avgY = (currentRow.minY + currentRow.maxY) / 2;
            } else {
                // Start new row
                if (currentRow.ilots.length > 0) {
                    this.calculateRowBounds(currentRow);
                    rows.push(currentRow);
                }
                currentRow = {
                    ilots: [ilot],
                    minY: ilot.y,
                    maxY: ilot.y + ilot.height,
                    avgY: ilot.y + ilot.height / 2
                };
            }
        }
        
        // Add last row
        if (currentRow.ilots.length > 0) {
            this.calculateRowBounds(currentRow);
            rows.push(currentRow);
        }
        
        return rows;
    }

    /**
     * Calculate complete bounds for a row
     */
    calculateRowBounds(row) {
        row.minX = Math.min(...row.ilots.map(i => i.x));
        row.maxX = Math.max(...row.ilots.map(i => i.x + i.width));
        row.centerX = (row.minX + row.maxX) / 2;
        row.width = Math.max(row.maxX - row.minX, Number.EPSILON);
        row.height = row.maxY - row.minY;
        
        // Calculate density (ilots per meter)
        row.density = row.ilots.length / row.width;
        
        // Calculate alignment score (how well aligned are the îlots)
        const yPositions = row.ilots.map(i => i.y);
        const avgY = yPositions.reduce((a, b) => a + b, 0) / yPositions.length;
        const variance = yPositions.reduce((sum, y) => sum + Math.pow(y - avgY, 2), 0) / yPositions.length;
        row.alignment = 1 / (1 + variance); // Higher = better alignment
        
        return row;
    }

    /**
     * Find pairs of rows that face each other
     */
    findFacingPairs(rows) {
        const pairs = [];
        
        for (let i = 0; i < rows.length - 1; i++) {
            for (let j = i + 1; j < rows.length; j++) {
                const row1 = rows[i];
                const row2 = rows[j];
                
                // Check if rows face each other
                const relationship = this.analyzeRowRelationship(row1, row2);
                
                if (relationship.isFacing) {
                    pairs.push({
                        row1Index: i,
                        row2Index: j,
                        row1,
                        row2,
                        ...relationship
                    });
                }
            }
        }
        
        // Sort by quality score (best pairs first)
        pairs.sort((a, b) => b.qualityScore - a.qualityScore);
        
        return pairs;
    }

    /**
     * Analyze relationship between two rows
     */
    analyzeRowRelationship(row1, row2) {
        // Calculate perpendicular distance between rows
        const centerDistance = Math.abs(row2.avgY - row1.avgY);
        let separation = 0;
        if (row2.minY >= row1.maxY) {
            separation = row2.minY - row1.maxY;
        } else if (row1.minY >= row2.maxY) {
            separation = row1.minY - row2.maxY;
        }
        const distance = (centerDistance + separation) / 2;
        
        // Calculate horizontal overlap
        const overlapStart = Math.max(row1.minX, row2.minX);
        const overlapEnd = Math.min(row1.maxX, row2.maxX);
        const overlapWidth = Math.max(0, overlapEnd - overlapStart);
        const maxWidth = Math.max(row1.width, row2.width);
        const overlapRatio = overlapWidth / maxWidth;
        
        // Check if rows are parallel (both horizontal)
        const isParallel = true; // We group by Y, so rows are already parallel
        
        // Check distance constraint
        const isWithinDistance = distance >= this.minRowDistance && distance <= this.maxRowDistance;
        
        // Check overlap constraint
        const hasOverlap = overlapRatio >= this.minOverlap;
        
        // Determine if rows face each other
        const isFacing = isParallel && isWithinDistance && hasOverlap;
        
        // Calculate quality score (0-1)
        let qualityScore = 0;
        if (isFacing) {
            // Distance score (prefer medium distances)
            const idealDistance = (this.minRowDistance + this.maxRowDistance) / 2;
            const distanceScore = 1 - Math.abs(distance - idealDistance) / idealDistance;
            
            // Overlap score
            const overlapScore = overlapRatio;
            
            // Alignment score (average of both rows)
            const alignmentScore = (row1.alignment + row2.alignment) / 2;
            
            // Density balance (prefer similar densities)
            const densityRatio = Math.min(row1.density, row2.density) / Math.max(row1.density, row2.density);
            
            // Weighted average
            qualityScore = (
                distanceScore * 0.35 +
                overlapScore * 0.35 +
                alignmentScore * 0.2 +
                densityRatio * 0.1
            );
        }
        
        return {
            isFacing,
            distance,
            overlapRatio,
            overlapStart,
            overlapEnd,
            overlapWidth,
            qualityScore,
            corridorPosition: {
                x: overlapStart,
                y: (row1.maxY + row2.minY) / 2,
                width: overlapWidth,
                minY: row1.maxY,
                maxY: row2.minY
            }
        };
    }

    /**
     * Calculate statistics about row detection
     */
    calculateStatistics(rows, facingPairs) {
        const totalIlots = this.ilots.length;
        const ilotsInRows = rows.reduce((sum, row) => sum + row.ilots.length, 0);
        const ilotsInFacingRows = facingPairs.reduce((sum, pair) => 
            sum + pair.row1.ilots.length + pair.row2.ilots.length, 0);
        
        return {
            totalIlots,
            totalRows: rows.length,
            totalFacingPairs: facingPairs.length,
            ilotsInRows,
            ilotsInFacingRows,
            rowCoverage: ilotsInRows / totalIlots,
            facingCoverage: ilotsInFacingRows / totalIlots,
            avgRowSize: ilotsInRows / rows.length,
            avgQualityScore: facingPairs.reduce((sum, p) => sum + p.qualityScore, 0) / facingPairs.length || 0
        };
    }

    /**
     * Generate corridor recommendations for facing pairs
     */
    generateCorridorRecommendations(corridorWidth = 1.5) {
        const result = this.detectFacingRows();
        const recommendations = [];
        
        for (const pair of result.facingPairs) {
            const { row1, row2, corridorPosition, distance, qualityScore } = pair;
            
            // Calculate available space for corridor
            const availableHeight = corridorPosition.maxY - corridorPosition.minY;
            const actualCorridorWidth = Math.min(corridorWidth, availableHeight * 0.8);
            
            // Center corridor in available space
            const corridorY = corridorPosition.y - actualCorridorWidth / 2;
            
            recommendations.push({
                type: 'horizontal',
                orientation: 'horizontal',
                priority: Math.min(1, Math.max(qualityScore, 0)),
                x: corridorPosition.x,
                y: corridorY,
                width: corridorPosition.width,
                height: actualCorridorWidth,
                area: corridorPosition.width * actualCorridorWidth,
                connectsRows: [pair.row1Index, pair.row2Index],
                row1IlotCount: row1.ilots.length,
                row2IlotCount: row2.ilots.length,
                distance,
                qualityScore,
                polygon: [
                    [corridorPosition.x, corridorY],
                    [corridorPosition.x + corridorPosition.width, corridorY],
                    [corridorPosition.x + corridorPosition.width, corridorY + actualCorridorWidth],
                    [corridorPosition.x, corridorY + actualCorridorWidth]
                ]
            });
        }
        
        return {
            recommendations,
            statistics: result.statistics,
            rows: result.rows
        };
    }

    /**
     * Visualize rows for debugging (returns ASCII art)
     */
    visualizeRows() {
        const rows = this.groupIntoRows();
        let output = `\n=== ROW VISUALIZATION ===\n`;
        output += `Total rows: ${rows.length}\n\n`;
        
        rows.forEach((row, index) => {
            output += `Row ${index + 1}: ${row.ilots.length} îlots, Y: ${row.avgY.toFixed(2)}, X: ${row.minX.toFixed(2)}-${row.maxX.toFixed(2)}\n`;
            output += `  Alignment: ${(row.alignment * 100).toFixed(1)}%, Density: ${row.density.toFixed(2)} îlots/m\n`;
        });
        
        const facingPairs = this.findFacingPairs(rows);
        output += `\n=== FACING PAIRS ===\n`;
        output += `Total pairs: ${facingPairs.length}\n\n`;
        
        facingPairs.forEach((pair, index) => {
            output += `Pair ${index + 1}: Rows ${pair.row1Index + 1} ↔ ${pair.row2Index + 1}\n`;
            output += `  Distance: ${pair.distance.toFixed(2)}m, Overlap: ${(pair.overlapRatio * 100).toFixed(1)}%\n`;
            output += `  Quality: ${(pair.qualityScore * 100).toFixed(1)}%\n`;
        });
        
        return output;
    }
}

module.exports = FacingRowDetector;
