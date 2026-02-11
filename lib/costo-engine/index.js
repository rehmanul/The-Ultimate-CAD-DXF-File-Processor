'use strict';

/**
 * COSTO Layout Engine v2 - Clean constraint-aware layout system
 * 
 * Pipeline:
 * 1. Parse floor plan geometry (walls, pillars, stairs, exits, obstacles)
 * 2. Build occupancy bitmap at fine resolution
 * 3. Flood-fill to discover rooms (connected free regions)
 * 4. For each room: place back-to-back box row strips
 * 5. Generate 1.2m access corridors between row pairs (wall-free)
 * 6. Generate circulation paths through corridors
 * 
 * Input:  floorPlan {bounds, walls, forbiddenZones, entrances, entities}
 * Output: {units, corridors, radiators, circulationPaths}
 */

const RoomDetector = require('./roomDetector');
const BoxPlacer = require('./boxPlacer');
const CorridorBuilder = require('./corridorBuilder');
const CirculationRouter = require('./circulationRouter');
const RadiatorGenerator = require('./radiatorGenerator');

class CostoLayoutEngineV2 {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = floorPlan.bounds;
        this.options = {
            gridSize: 0.20,              // 20cm grid resolution
            corridorWidth: options.corridorWidth || 1.2,
            boxDepth: options.boxDepth || 2.5,
            boxSpacing: options.boxSpacing || 0.05,
            wallClearance: options.wallClearance || 0.15,
            perimeterMargin: options.perimeterMargin || 0.3,
            minRoomArea: options.minRoomArea || 8,  // m² minimum to place boxes
            ...options
        };
    }

    generate(config = {}) {
        const distribution = config.distribution || { S: 25, M: 35, L: 25, XL: 15 };
        const t0 = Date.now();

        console.log('[CostoV2] ═══════════════════════════════════════');
        console.log('[CostoV2] Starting layout generation');
        console.log(`[CostoV2] Bounds: ${(this.bounds.maxX - this.bounds.minX).toFixed(1)} x ${(this.bounds.maxY - this.bounds.minY).toFixed(1)} m`);

        // Step 1: Detect rooms
        const detector = new RoomDetector(this.floorPlan, this.options);
        const rooms = detector.detect();
        console.log(`[CostoV2] Detected ${rooms.length} rooms`);

        // Step 2: Place boxes in each room (gap-based, respects all walls/obstacles)
        const placer = new BoxPlacer(this.floorPlan, this.options);
        const { units, corridors } = placer.placeInRooms(rooms, distribution);
        console.log(`[CostoV2] Placed ${units.length} units, ${corridors.length} corridors`);

        // Step 3: Build corridor metadata
        const corridorBuilder = new CorridorBuilder(this.options);
        const enrichedCorridors = corridorBuilder.enrich(corridors);

        // Step 4: Main circulation route (connected blue path like reference)
        const router = new CirculationRouter(this.floorPlan, this.options);
        const mainRoute = router.generateRoute(enrichedCorridors, units);

        // Also keep individual corridor centerlines as secondary circulation
        // BUT only if they don't cross any walls
        const corridorCenterlines = enrichedCorridors
            .filter(c => c.type === 'ACCESS')
            .map(c => {
                const isH = c.direction === 'horizontal';
                const cx = c.x + c.width / 2;
                const cy = c.y + c.height / 2;
                const path = isH
                    ? [{ x: c.x, y: cy }, { x: c.x + c.width, y: cy }]
                    : [{ x: cx, y: c.y }, { x: cx, y: c.y + c.height }];
                return { type: 'CORRIDOR_CENTER', style: 'dashed_lightblue', path };
            })
            .filter(cl => !router._segmentCrossesWall(cl.path[0], cl.path[1]));

        const circulationPaths = [...mainRoute, ...corridorCenterlines];

        const elapsed = Date.now() - t0;
        console.log(`[CostoV2] Complete in ${elapsed}ms`);
        console.log('[CostoV2] ═══════════════════════════════════════');

        // Step 5: Generate red zigzag radiators along box rows
        const radGen = new RadiatorGenerator(this.floorPlan, this.options);
        const radiators = radGen.generateFromLayout(units, enrichedCorridors);
        console.log(`[CostoV2] Generated ${radiators.length} radiators`);

        return { units, corridors: enrichedCorridors, radiators, circulationPaths };
    }
}

module.exports = CostoLayoutEngineV2;
