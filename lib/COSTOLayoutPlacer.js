/**
 * COSTOLayoutPlacer - SIMPLIFIED COSTO-style grid layout
 * 
 * Simple approach that WORKS:
 * 1. Create horizontal strips across the entire floor
 * 2. Each strip = 2 rows of boxes (back-to-back)
 * 3. Fill each row with boxes wall-to-wall
 * 4. Corridors between strips only
 */
class COSTOLayoutPlacer {
    constructor(floorPlan, options = {}) {
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };

        // Simple parameters
        this.boxDepth = options.boxDepth || 3.0;           // Height of each box row
        this.corridorWidth = options.corridorWidth || 1.5;  // Corridor between strip pairs
        this.margin = options.margin || 0.5;               // Small margin from edges
        this.minBoxWidth = 1.5;
        this.maxBoxWidth = 4.0;

        this.corridors = [];
    }

    generateIlots(distribution, targetCount = 50, unitMix = []) {
        console.log('[COSTOLayoutPlacer] Generating simple grid layout');

        const ilots = [];
        const { minX, minY, maxX, maxY } = this.bounds;

        // Calculate usable area
        const startX = minX + this.margin;
        const endX = maxX - this.margin;
        const startY = minY + this.margin;
        const endY = maxY - this.margin;
        const usableWidth = endX - startX;
        const usableHeight = endY - startY;

        // Calculate strips: each strip = 2 box rows + corridor
        const stripHeight = (2 * this.boxDepth) + this.corridorWidth;
        const numStrips = Math.floor(usableHeight / stripHeight);

        if (numStrips < 1) {
            console.warn('[COSTOLayoutPlacer] Space too small for strips');
            return [];
        }

        // Build size list from distribution
        const sizes = this._buildSizes(distribution, targetCount);
        let sizeIdx = 0;

        // Generate strips
        let currentY = startY;

        for (let stripIdx = 0; stripIdx < numStrips; stripIdx++) {
            // Row 1 (bottom of strip pair)
            let x = startX;
            while (x < endX - this.minBoxWidth) {
                const width = this._getWidth(sizes, sizeIdx++, endX - x);
                if (width < this.minBoxWidth) break;

                ilots.push(this._createIlot(x, currentY, width, this.boxDepth, stripIdx, 0, ilots.length));
                x += width + 0.05; // tiny gap
            }

            // Row 2 (top of strip pair, back-to-back)
            const row2Y = currentY + this.boxDepth;
            x = startX;
            while (x < endX - this.minBoxWidth) {
                const width = this._getWidth(sizes, sizeIdx++, endX - x);
                if (width < this.minBoxWidth) break;

                ilots.push(this._createIlot(x, row2Y, width, this.boxDepth, stripIdx, 1, ilots.length));
                x += width + 0.05;
            }

            // Move to next strip position
            currentY += (2 * this.boxDepth);

            // Add corridor between this strip and next
            if (stripIdx < numStrips - 1) {
                this.corridors.push({
                    x: startX,
                    y: currentY,
                    width: usableWidth,
                    height: this.corridorWidth,
                    type: 'horizontal'
                });
            }

            currentY += this.corridorWidth;
        }

        // Add perimeter corridors
        this._addPerimeterCorridors(minX, minY, maxX, maxY);

        console.log(`[COSTOLayoutPlacer] Generated ${ilots.length} ilots, ${this.corridors.length} corridors`);
        return ilots;
    }

    _createIlot(x, y, width, height, strip, row, index) {
        const area = width * height;
        return {
            x, y, width, height, area,
            strip, row,
            id: `ilot_${index + 1}`,
            index,
            type: area <= 6 ? 'S' : area <= 12 ? 'M' : 'L',
            sizeCategory: `${Math.floor(area)}-${Math.ceil(area)}`,
            label: `${width.toFixed(1)}m`,
            capacity: Math.max(1, Math.floor(area / 5))
        };
    }

    _addPerimeterCorridors(minX, minY, maxX, maxY) {
        const w = maxX - minX;
        const h = maxY - minY;
        const m = this.margin;

        // Outer perimeter
        this.corridors.push({ x: minX, y: minY, width: w, height: m, type: 'perimeter' });
        this.corridors.push({ x: minX, y: maxY - m, width: w, height: m, type: 'perimeter' });
        this.corridors.push({ x: minX, y: minY, width: m, height: h, type: 'perimeter' });
        this.corridors.push({ x: maxX - m, y: minY, width: m, height: h, type: 'perimeter' });
    }

    _getWidth(sizes, idx, maxWidth) {
        if (sizes.length > 0) {
            const targetArea = sizes[idx % sizes.length];
            const width = Math.min(this.maxBoxWidth, Math.max(this.minBoxWidth, targetArea / this.boxDepth));
            return Math.min(maxWidth - 0.05, width);
        }
        return Math.min(maxWidth - 0.05, this.minBoxWidth + Math.random() * (this.maxBoxWidth - this.minBoxWidth));
    }

    _buildSizes(distribution, count) {
        const sizes = [];
        if (!distribution) return sizes;

        Object.entries(distribution).forEach(([key, weight]) => {
            const match = key.match(/(\d+)-(\d+)/);
            if (match) {
                const min = parseFloat(match[1]);
                const max = parseFloat(match[2]);
                const num = Math.ceil((typeof weight === 'number' ? weight : 1) * count / 100);
                for (let i = 0; i < num; i++) {
                    sizes.push(min + Math.random() * (max - min));
                }
            }
        });

        // Shuffle
        for (let i = sizes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
        }

        return sizes;
    }

    getCorridors() {
        return this.corridors;
    }
}

module.exports = COSTOLayoutPlacer;
