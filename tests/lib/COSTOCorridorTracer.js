/**
 * COSTOCorridorTracer - Traces circulation corridors along room boundaries
 * 
 * Creates zigzag circulation lines that follow the architectural structure
 * rather than arbitrary placement.
 */
class COSTOCorridorTracer {
    constructor(options = {}) {
        this.zigzagAmplitude = options.zigzagAmplitude || 0.3;
        this.zigzagFrequency = options.zigzagFrequency || 0.5;
        this.arrowSpacing = options.arrowSpacing || 3.0;
        this.arrowSize = options.arrowSize || 0.4;
    }

    /**
     * Trace corridors based on room boundaries and generated ilots
     * @param {Array} rooms - Detected rooms
     * @param {Array} ilots - Generated storage units
     * @param {Array} corridors - Corridor definitions from subdivision
     * @returns {Array} Enhanced corridor data with zigzag points
     */
    traceCorridors(rooms, ilots, corridors) {
        console.log(`[COSTOCorridorTracer] Tracing ${corridors.length} corridors`);

        const enhancedCorridors = corridors.map(corridor => {
            const zigzagPoints = this._generateZigzag(corridor);
            const arrows = this._generateArrows(corridor);

            return {
                ...corridor,
                zigzagPoints,
                arrows
            };
        });

        // Add perimeter circulation connecting all rooms
        const perimeterPath = this._tracePerimeter(rooms, ilots);
        if (perimeterPath) {
            enhancedCorridors.push(perimeterPath);
        }

        return enhancedCorridors;
    }

    /**
     * Generate zigzag points for a corridor
     */
    _generateZigzag(corridor) {
        const points = [];
        const isHorizontal = corridor.type === 'horizontal' || corridor.width > corridor.height;

        const centerX = corridor.x + corridor.width / 2;
        const centerY = corridor.y + corridor.height / 2;

        if (isHorizontal) {
            let peak = true;
            for (let x = corridor.x; x <= corridor.x + corridor.width; x += this.zigzagFrequency) {
                const offsetY = peak ? this.zigzagAmplitude : -this.zigzagAmplitude;
                points.push({ x: x, y: centerY + offsetY, z: 0.1 });
                peak = !peak;
            }
        } else {
            let peak = true;
            for (let y = corridor.y; y <= corridor.y + corridor.height; y += this.zigzagFrequency) {
                const offsetX = peak ? this.zigzagAmplitude : -this.zigzagAmplitude;
                points.push({ x: centerX + offsetX, y: y, z: 0.1 });
                peak = !peak;
            }
        }

        return points;
    }

    /**
     * Generate direction arrows for a corridor
     */
    _generateArrows(corridor) {
        const arrows = [];
        const isHorizontal = corridor.type === 'horizontal' || corridor.width > corridor.height;

        const centerX = corridor.x + corridor.width / 2;
        const centerY = corridor.y + corridor.height / 2;

        if (isHorizontal) {
            const startX = corridor.x + this.arrowSpacing / 2;
            const endX = corridor.x + corridor.width - this.arrowSpacing / 2;
            for (let x = startX; x < endX; x += this.arrowSpacing) {
                arrows.push({
                    x: x,
                    y: centerY,
                    direction: 'right',
                    size: this.arrowSize
                });
            }
        } else {
            const startY = corridor.y + this.arrowSpacing / 2;
            const endY = corridor.y + corridor.height - this.arrowSpacing / 2;
            for (let y = startY; y < endY; y += this.arrowSpacing) {
                arrows.push({
                    x: centerX,
                    y: y,
                    direction: 'up',
                    size: this.arrowSize
                });
            }
        }

        return arrows;
    }

    /**
     * Trace perimeter circulation path around all rooms
     */
    _tracePerimeter(rooms, ilots) {
        if (!ilots || ilots.length === 0) return null;

        // Find overall bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const ilot of ilots) {
            minX = Math.min(minX, ilot.x);
            minY = Math.min(minY, ilot.y);
            maxX = Math.max(maxX, ilot.x + ilot.width);
            maxY = Math.max(maxY, ilot.y + ilot.height);
        }

        // Create perimeter path
        const margin = 0.3;
        const perimeterPoints = [
            { x: minX - margin, y: minY - margin },
            { x: maxX + margin, y: minY - margin },
            { x: maxX + margin, y: maxY + margin },
            { x: minX - margin, y: maxY + margin },
            { x: minX - margin, y: minY - margin }
        ];

        // Generate zigzag along perimeter
        const zigzagPoints = [];
        for (let i = 0; i < perimeterPoints.length - 1; i++) {
            const start = perimeterPoints[i];
            const end = perimeterPoints[i + 1];
            const isHorizontal = Math.abs(end.y - start.y) < Math.abs(end.x - start.x);

            if (isHorizontal) {
                const direction = end.x > start.x ? 1 : -1;
                let peak = true;
                for (let x = start.x; direction > 0 ? x <= end.x : x >= end.x; x += direction * this.zigzagFrequency) {
                    const offsetY = peak ? this.zigzagAmplitude : -this.zigzagAmplitude;
                    zigzagPoints.push({ x: x, y: start.y + offsetY, z: 0.1 });
                    peak = !peak;
                }
            } else {
                const direction = end.y > start.y ? 1 : -1;
                let peak = true;
                for (let y = start.y; direction > 0 ? y <= end.y : y >= end.y; y += direction * this.zigzagFrequency) {
                    const offsetX = peak ? this.zigzagAmplitude : -this.zigzagAmplitude;
                    zigzagPoints.push({ x: start.x + offsetX, y: y, z: 0.1 });
                    peak = !peak;
                }
            }
        }

        return {
            type: 'perimeter',
            x: minX - margin,
            y: minY - margin,
            width: (maxX - minX) + 2 * margin,
            height: (maxY - minY) + 2 * margin,
            zigzagPoints,
            arrows: []
        };
    }
}

module.exports = COSTOCorridorTracer;
