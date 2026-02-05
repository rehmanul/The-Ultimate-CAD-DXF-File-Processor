/**
 * COSTOLayoutPlacer - Professional COSTO-style ilot layout
 * 
 * ROOM-BASED APPROACH:
 * 1. Uses RoomDetector to detect actual rooms from DXF walls
 * 2. Subdivides each room into storage units using COSTORoomSubdivider
 * 3. Traces corridors along room boundaries using COSTOCorridorTracer
 * 
 * This matches the COSTO reference where boxes are fitted INTO
 * the actual architectural structure, not placed arbitrarily.
 */
const COSTORoomSubdivider = require('./COSTORoomSubdivider');
const COSTOCorridorTracer = require('./COSTOCorridorTracer');
const roomDetector = require('./roomDetector'); // Exports an instance, not a class

class COSTOLayoutPlacer {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.rooms = floorPlan.rooms || [];

        // Initialize components - roomDetector is already an instance
        this.roomDetector = roomDetector;
        this.subdivider = new COSTORoomSubdivider({
            boxDepth: options.boxDepth || 2.5,
            corridorWidth: options.corridorWidth || 1.2,
            minBoxWidth: options.minBoxWidth || 1.0,
            maxBoxWidth: options.maxBoxWidth || 4.0,
            perimeterMargin: options.perimeterMargin || 0.3
        });
        this.corridorTracer = new COSTOCorridorTracer({
            zigzagAmplitude: options.zigzagAmplitude || 0.3,
            zigzagFrequency: options.zigzagFrequency || 0.5
        });

        // Store generated corridors
        this.corridors = [];
    }

    /**
     * Generate ilots using room-based subdivision
     */
    generateIlots(distribution, targetCount = 50, unitMix = []) {
        console.log('[COSTOLayoutPlacer] Starting room-based generation');

        // Step 1: Detect rooms from walls (or use pre-detected rooms)
        let rooms = this.rooms;

        if (!rooms || rooms.length === 0) {
            console.log('[COSTOLayoutPlacer] No pre-detected rooms, detecting from walls...');

            if (this.walls && this.walls.length > 0) {
                try {
                    rooms = this.roomDetector.detectRooms(
                        this.walls,
                        this.entrances,
                        this.forbiddenZones,
                        this.bounds,
                        { snapTolerance: 0.1, minRoomArea: 2 }
                    );
                    console.log(`[COSTOLayoutPlacer] Detected ${rooms.length} rooms from walls`);
                } catch (e) {
                    console.error('[COSTOLayoutPlacer] Room detection failed:', e.message);
                    rooms = [];
                }
            }
        }

        // Fallback: If no rooms detected, create a single room from bounds
        if (!rooms || rooms.length === 0) {
            console.log('[COSTOLayoutPlacer] No rooms detected, using bounds as single room');
            rooms = [{
                id: 'room_envelope',
                name: 'Envelope',
                area: (this.bounds.maxX - this.bounds.minX) * (this.bounds.maxY - this.bounds.minY),
                bounds: this.bounds,
                polygon: [
                    { x: this.bounds.minX, y: this.bounds.minY },
                    { x: this.bounds.maxX, y: this.bounds.minY },
                    { x: this.bounds.maxX, y: this.bounds.maxY },
                    { x: this.bounds.minX, y: this.bounds.maxY }
                ]
            }];
        }

        // Step 2: Subdivide rooms into storage units
        console.log(`[COSTOLayoutPlacer] Subdividing ${rooms.length} rooms...`);
        const result = this.subdivider.subdivideRooms(rooms, distribution, unitMix, targetCount);

        // Step 3: Trace corridors
        console.log('[COSTOLayoutPlacer] Tracing corridors...');
        this.corridors = this.corridorTracer.traceCorridors(rooms, result.ilots, result.corridors);

        console.log(`[COSTOLayoutPlacer] Complete: ${result.ilots.length} ilots, ${this.corridors.length} corridors`);

        return result.ilots;
    }

    /**
     * Get the generated corridors for rendering
     */
    getCorridors() {
        return this.corridors;
    }
}

module.exports = COSTOLayoutPlacer;
