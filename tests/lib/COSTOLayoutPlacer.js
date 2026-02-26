/**
 * COSTOLayoutPlacer - Production Double-Loaded Corridor Layout Engine
 *
 * Generates storage box layouts matching the COSTO reference architectural pattern:
 *   - Double-loaded row pairs (back-to-back boxes sharing a partition wall)
 *   - Access corridors between row pairs (light-blue dashed circulation lines)
 *   - Main arteries perpendicular to rows at regular intervals
 *   - Perimeter corridors along all exterior walls
 *   - Radiators (red zigzag polylines) along exterior wall segments
 *   - Partition type metadata (Tole Blanche / Tole Grise) per box edge
 *
 * The reference output shows:
 *   - RED zigzag = Radiateurs (perimeter heating along walls)
 *   - LIGHT-BLUE dashed = Ligne circulation (corridor center-lines)
 *   - BLUE solid = Tole Grise (grey sheet-metal box partitions)
 *   - BLACK thin = Tole Blanche (white sheet-metal / structural walls)
 */

const IntelligentBoxOptimizer = require('./intelligentBoxOptimizer');
const IntelligentDetector = require('./intelligentDetector');

class COSTOLayoutPlacer {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.bounds = floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        this.walls = floorPlan.walls || [];
        this.forbiddenZones = floorPlan.forbiddenZones || [];
        this.entrances = floorPlan.entrances || [];
        this.zones = floorPlan.layerZones || [];

        // ── Automatic Stair Detection ────────────────────────────────────
        // Detect stairs from DXF geometry and add as forbidden zones
        this.stairs = [];
        if (floorPlan.entities && floorPlan.entities.length > 0) {
            this.stairs = IntelligentDetector.detectStairs(floorPlan.entities);
            console.log(`[COSTOLayoutPlacer] Detected ${this.stairs.length} stairs`);
        }
        // Also include any explicitly defined stairs
        if (floorPlan.stairs && floorPlan.stairs.length > 0) {
            this.stairs.push(...floorPlan.stairs);
        }

        // Add stairs to forbidden zones with 2m clearance buffer
        const stairClearance = options.stairClearance || 2.0;
        for (const stair of this.stairs) {
            const bufferedStair = this._createBufferedZone(stair, stairClearance);
            this.forbiddenZones.push(bufferedStair);
        }
        console.log(`[COSTOLayoutPlacer] Total forbidden zones: ${this.forbiddenZones.length}`);

        // Initialize intelligent optimizer
        this.boxOptimizer = new IntelligentBoxOptimizer({
            boxDepth: options.boxDepth || 2.5,
            minWidth: options.minBoxWidth || 1.0,
            maxWidth: options.maxBoxWidth || 4.5
        });

        // ── Box geometry ────────────────────────────────────────────────
        this.boxDepth = options.boxDepth || 2.5;   // Depth of one row of boxes (m)
        this.minBoxWidth = Number.isFinite(options.minBoxWidth) ? options.minBoxWidth : 1.0;
        this.maxBoxWidth = Number.isFinite(options.maxBoxWidth) ? options.maxBoxWidth : 4.5;
        this.partitionGap = Number.isFinite(options.partitionGap) ? options.partitionGap : 0.05;
        this.boxSpacing = Number.isFinite(options.spacing) ? options.spacing : 0.02;  // Reduced from 0.05

        // ── Corridor geometry (optimized for higher density) ───────────
        this.accessCorridorWidth = options.accessCorridorWidth || options.corridorWidth || 1.2;
        this.mainArteryWidth = options.mainArteryWidth || 2.5;  // Reduced from 3.5
        this.perimeterCorridorWidth = options.perimeterCorridorWidth || 0.6;  // Reduced from 1.2
        this.mainArteryInterval = options.mainArteryInterval || 4;    // Increased from 3 (fewer arteries)
        this.verticalArterySpacing = options.verticalArterySpacing || 30;   // Increased from 22

        // ── Radiator geometry ───────────────────────────────────────────
        this.radiatorAmplitude = options.radiatorAmplitude || 0.15;
        this.radiatorWavelength = options.radiatorWavelength || 0.4;
        this.radiatorOffset = options.radiatorOffset || 0.25;

        // ── Wall clearance ──────────────────────────────────────────────
        this.wallClearance = Number.isFinite(options.wallClearance) ? options.wallClearance : 0.1;

        // ── Output containers (populated by generateIlots) ──────────────
        this.corridors = [];
        this.radiators = [];
        this.circulationPaths = [];
        this.stats = null;
        this.targetWidth = null;
    }

    /**
     * Create a buffered forbidden zone around an obstacle (stair, elevator, etc.)
     * @param {Object} zone - The zone to buffer (with bounds or polygon)
     * @param {number} clearance - Buffer distance in meters
     * @returns {Object} Buffered zone
     */
    _createBufferedZone(zone, clearance) {
        if (zone.bounds) {
            return {
                type: zone.type || 'stair',
                layer: zone.layer || 'FORBIDDEN',
                bounds: {
                    minX: zone.bounds.minX - clearance,
                    minY: zone.bounds.minY - clearance,
                    maxX: zone.bounds.maxX + clearance,
                    maxY: zone.bounds.maxY + clearance
                },
                original: zone
            };
        } else if (zone.polygon) {
            // For polygon zones, expand the polygon outward
            const center = this._getPolygonCenter(zone.polygon);
            const expandedPolygon = zone.polygon.map(pt => ({
                x: center.x + (pt.x - center.x) * (1 + clearance / 5),
                y: center.y + (pt.y - center.y) * (1 + clearance / 5)
            }));
            return {
                type: zone.type || 'stair',
                layer: zone.layer || 'FORBIDDEN',
                polygon: expandedPolygon,
                original: zone
            };
        }
        return zone;
    }

    /**
     * Get center of a polygon
     */
    _getPolygonCenter(polygon) {
        const sum = polygon.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
        return { x: sum.x / polygon.length, y: sum.y / polygon.length };
    }

    // ════════════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ════════════════════════════════════════════════════════════════════

    /**
     * Generate storage boxes using double-loaded corridor pattern.
     * @param {Object|Array} distribution - Size distribution {rangeStr: count} or array
     * @param {number} targetCount - Target number of boxes
     * @param {Array} unitMix - Optional unit mix array
     * @returns {Array<Object>} Placed box objects
     */
    generateIlots(distribution, targetCount = 50, unitMix = []) {
        console.log('[COSTOLayoutPlacer] Production double-loaded corridor placement');
        console.log(`[COSTOLayoutPlacer] Target: ${targetCount}, Distribution:`, JSON.stringify(distribution));

        this.targetWidth = this._computeTargetWidth(distribution);

        // Auto-calculate target from floor area when targetCount is low
        let actualTarget = targetCount;
        if (targetCount < 10) {
            const boundsWidth = this.bounds.maxX - this.bounds.minX;
            const boundsHeight = this.bounds.maxY - this.bounds.minY;
            const boundsArea = boundsWidth * boundsHeight;
            const avgBoxArea = this.targetWidth * this.boxDepth;
            // ~70% of gross area is usable - aggressive space filling
            actualTarget = Math.floor((boundsArea * 0.70) / avgBoxArea);
            console.log(`[COSTOLayoutPlacer] Auto-calculated target from floor area: ${actualTarget}`);
        }

        // ── UNIT MIX INTEGRATION ────────────────────────────────────────────
        // When unitMix is provided with typologies, generate boxes based on 
        // target areas from unit mix instead of random distribution.
        let sizes;
        if (Array.isArray(unitMix) && unitMix.length > 0 && unitMix[0].targetArea) {
            console.log(`[COSTOLayoutPlacer] Using unit mix for box sizes (${unitMix.length} typologies)`);
            sizes = this._buildSizesFromUnitMix(unitMix, actualTarget);
        } else {
            sizes = this._buildSizes(distribution, actualTarget);
        }

        // Reset outputs
        this.corridors = [];
        this.radiators = [];
        this.circulationPaths = [];

        // ── Place boxes ─────────────────────────────────────────────────
        let ilots;
        const hasUsableZones = this.zones && this.zones.some(z => z.area && z.area > 20);

        // If zones are too sparse, use rooms as alternate zones
        const rooms = this.floorPlan.rooms || [];
        let effectiveZones = this.zones;
        if ((!hasUsableZones || this.zones.length < 5) && rooms.length > 5) {
            console.log(`[COSTOLayoutPlacer] Using ${rooms.length} rooms as zones (layer zones sparse: ${this.zones ? this.zones.length : 0})`);

            // Convert rooms to zones with robust bounds extraction
            effectiveZones = rooms.map((room, idx) => {
                // Try to get bounds directly, or compute from polygon
                let bounds = room.bounds;
                if (!bounds && room.polygon && Array.isArray(room.polygon) && room.polygon.length >= 3) {
                    const xs = room.polygon.map(p => Array.isArray(p) ? p[0] : (p.x || 0));
                    const ys = room.polygon.map(p => Array.isArray(p) ? p[1] : (p.y || 0));
                    bounds = {
                        minX: Math.min(...xs),
                        maxX: Math.max(...xs),
                        minY: Math.min(...ys),
                        maxY: Math.max(...ys)
                    };
                }

                if (!bounds) return null;

                const width = bounds.maxX - bounds.minX;
                const height = bounds.maxY - bounds.minY;
                const area = room.area || (width * height);

                return {
                    id: room.id || `room_${idx}`,
                    bounds: bounds,
                    area: area,
                    type: 'room'
                };
            }).filter(z => z && z.bounds && z.area > 1);  // Reduced from 2 - accept smaller rooms

            console.log(`[COSTOLayoutPlacer] Converted ${effectiveZones.length} rooms to zones`);
            this.zones = effectiveZones;
        }

        if (effectiveZones && effectiveZones.length >= 5) {
            console.log(`[COSTOLayoutPlacer] Zone-based placement (${effectiveZones.length} zones)`);
            ilots = this._placeDoubleLoadedInZones(sizes);
        } else {
            console.log('[COSTOLayoutPlacer] Bounds-based placement');
            ilots = this._placeDoubleLoadedInBounds(sizes, this.bounds, null);
        }

        // ── GAP FILLING PASS ─────────────────────────────────────────────
        // If we placed <50% of target, aggressively fill remaining space
        const initialCount = ilots.length;
        const shortfallRatio = 1 - (initialCount / actualTarget);
        if (shortfallRatio > 0.3 && actualTarget > 20) {
            console.log(`[COSTOLayoutPlacer] Gap-fill pass (${(shortfallRatio * 100).toFixed(0)}% shortfall)`);
            const gapBoxes = this._fillGaps(ilots, sizes.slice(ilots.length), actualTarget - ilots.length);
            ilots.push(...gapBoxes);
            console.log(`[COSTOLayoutPlacer] Gap-fill added ${gapBoxes.length} boxes`);
        }

        // ── EMERGENCY FALLBACK ──────────────────────────────────────────
        // If still no boxes placed, use simple grid placement over entire floor
        if (ilots.length === 0) {
            console.warn('[COSTOLayoutPlacer] Emergency fallback: zone placement failed, using grid');
            const gridBoxes = this._emergencyGridPlacement(sizes, actualTarget);
            ilots.push(...gridBoxes);
            console.log(`[COSTOLayoutPlacer] Emergency grid placed ${gridBoxes.length} boxes`);
        }


        // ── Assign IDs, areas, labels, and intelligent partition types ─
        ilots.forEach((ilot, idx) => {
            ilot.id = ilot.id || `ilot_${idx + 1}`;
            ilot.index = idx;
            ilot.area = ilot.width * ilot.height;
            ilot.label = `${ilot.area.toFixed(1)}m²`;

            // INTELLIGENT PARTITION TYPE DETECTION
            // Determine Tôle Blanche vs Tôle Grise for each edge
            ilot.partitions = this.boxOptimizer.detectPartitionType(ilot, ilots, this.walls);

            // Set door properties for realistic rendering
            ilot.doorSide = ilot.facing || 'front';
            ilot.doorWidth = 0.8; // Standard 80cm door
        });

        // ── Generate perimeter corridors ────────────────────────────────
        const perimeterCorridors = this._generatePerimeterCorridors();
        this.corridors.push(...perimeterCorridors);

        // ── Generate radiators along walls ──────────────────────────────
        this.radiators = this._generateWallRadiators();

        // ── Generate circulation center-line paths ──────────────────────
        this.circulationPaths = this._buildCirculationPaths();

        // ── Statistics ──────────────────────────────────────────────────
        this.stats = {
            targetCount: actualTarget,
            placedCount: ilots.length,
            shortfall: Math.max(0, actualTarget - ilots.length),
            mode: 'double-loaded',
            corridorCount: this.corridors.length,
            radiatorCount: this.radiators.length,
            circulationPathCount: this.circulationPaths.length
        };

        console.log(`[COSTOLayoutPlacer] Placed ${ilots.length}/${actualTarget} boxes | ` +
            `${this.corridors.length} corridors | ${this.radiators.length} radiators | ` +
            `${this.circulationPaths.length} circulation paths`);

        return ilots;
    }

    getCorridors() { return this.corridors; }
    getRadiators() { return this.radiators; }
    getCirculationPaths() { return this.circulationPaths; }
    getStats() {
        return this.stats || {
            targetCount: 0, placedCount: 0, shortfall: 0,
            mode: 'double-loaded', corridorCount: 0,
            radiatorCount: 0, circulationPathCount: 0
        };
    }

    /**
     * Build box sizes from unit mix typologies.
     * Converts typologies like {type: 'S', targetArea: 50} into actual box dimensions.
     * @param {Array} unitMix - Array of {type, targetArea, tolerance, priority}
     * @param {number} targetCount - Total number of boxes to generate
     * @returns {Array} Array of {width, area, type} objects
     */
    _buildSizesFromUnitMix(unitMix, targetCount) {
        const sizes = [];

        // Calculate total target area and distribution percentages
        const totalTargetArea = unitMix.reduce((sum, t) => sum + (t.targetArea || 0), 0);

        if (totalTargetArea === 0) {
            console.log('[COSTOLayoutPlacer] Unit mix has no target areas, falling back to default');
            return IntelligentBoxOptimizer.optimizeDistribution(
                { '0-2': 0.25, '2-5': 0.35, '5-10': 0.30, '10-20': 0.10 },
                targetCount,
                this.bounds,
                this.floorPlan
            );
        }

        // Generate boxes for each typology
        for (const typo of unitMix) {
            const targetArea = typo.targetArea || 10;
            const typeName = typo.type || typo.name || 'M';

            // Estimate average box area for this typology
            let avgBoxArea;
            if (typeName === 'S' || typeName.includes('<2') || typeName.includes('1-2')) {
                avgBoxArea = 1.5;
            } else if (typeName === 'M' || typeName.includes('2-3') || typeName.includes('2-5')) {
                avgBoxArea = 3.5;
            } else if (typeName === 'L' || typeName.includes('5-10')) {
                avgBoxArea = 7;
            } else if (typeName === 'XL' || typeName.includes('10+') || typeName.includes('10-20')) {
                avgBoxArea = 15;
            } else {
                avgBoxArea = 5;
            }

            // Calculate number of boxes for this typology
            const boxCount = Math.max(1, Math.round(targetArea / avgBoxArea));

            // Generate box sizes with some variation
            for (let i = 0; i < boxCount; i++) {
                // Add ±10% variation to box area
                const variation = 0.9 + Math.random() * 0.2;
                const boxArea = avgBoxArea * variation;

                // Calculate width based on area and box depth
                const depth = this.boxDepth || 2.5;
                const width = Math.max(1.0, boxArea / depth);

                sizes.push({
                    width: Math.round(width * 10) / 10,  // Round to 0.1m
                    area: Math.round(boxArea * 10) / 10,
                    type: typeName
                });
            }
        }

        console.log(`[COSTOLayoutPlacer] Built ${sizes.length} box sizes from unit mix`);

        // If we generated fewer than target, pad with medium boxes
        while (sizes.length < targetCount * 0.8) {
            sizes.push({
                width: 1.5,
                area: 3.75,
                type: 'M'
            });
        }

        return sizes;
    }

    /**
     * Emergency grid placement when zone-based placement fails completely.
     * Creates a simple grid of boxes across the floor bounds.
     * @param {Array} sizes - Array of {width, area} objects
     * @param {number} targetCount - Target number of boxes
     * @returns {Array} Placed box objects
     */
    _emergencyGridPlacement(sizes, targetCount) {
        console.log('[COSTOLayoutPlacer] Running emergency grid placement');
        const boxes = [];

        const margin = 1.0; // 1m margin from walls
        const innerMinX = this.bounds.minX + margin;
        const innerMinY = this.bounds.minY + margin;
        const innerMaxX = this.bounds.maxX - margin;
        const innerMaxY = this.bounds.maxY - margin;

        const innerWidth = innerMaxX - innerMinX;
        const innerHeight = innerMaxY - innerMinY;

        if (innerWidth < 2 || innerHeight < 2) {
            console.warn('[COSTOLayoutPlacer] Floor too small for emergency grid');
            return boxes;
        }

        // Use average box dimensions from sizes or defaults
        const avgWidth = sizes.length > 0
            ? sizes.reduce((sum, s) => sum + (s.width || 2), 0) / sizes.length
            : 2.5;
        const boxHeight = this.boxDepth || 2.5;
        const corridorWidth = 1.2;

        // Calculate number of columns and rows
        const colSpacing = avgWidth + 0.1;
        const rowSpacing = boxHeight * 2 + corridorWidth; // Two rows back-to-back + corridor

        const numCols = Math.floor(innerWidth / colSpacing);
        const numRowPairs = Math.floor(innerHeight / rowSpacing);

        if (numCols < 1 || numRowPairs < 1) {
            console.warn('[COSTOLayoutPlacer] Could not fit any boxes in emergency grid');
            return boxes;
        }

        let placed = 0;
        for (let rp = 0; rp < numRowPairs && placed < targetCount; rp++) {
            const baseY = innerMinY + rp * rowSpacing;

            for (let row = 0; row < 2 && placed < targetCount; row++) {
                const y = baseY + row * boxHeight;

                for (let col = 0; col < numCols && placed < targetCount; col++) {
                    const x = innerMinX + col * colSpacing;
                    const width = sizes[placed]?.width || avgWidth;

                    const candidate = {
                        x: x,
                        y: y,
                        width: Math.min(width, avgWidth),
                        height: boxHeight,
                        partitionType: row === 0 ? 'tole_grise' : 'tole_blanche',
                        type: 'storage',
                        method: 'emergency_grid'
                    };
                    // Only place if it doesn't overlap walls/obstacles
                    if (this._isValidPlacement(candidate, null, false)) {
                        boxes.push(candidate);
                        placed++;
                    }
                }
            }

            // Add access corridor between row pairs
            this.corridors.push({
                type: 'access',
                direction: 'horizontal',
                x: innerMinX,
                y: baseY + boxHeight * 2,
                width: innerWidth,
                height: corridorWidth
            });
        }

        console.log(`[COSTOLayoutPlacer] Emergency grid: placed ${boxes.length} boxes in ${numRowPairs} row pairs`);
        return boxes;
    }

    // ════════════════════════════════════════════════════════════════════
    //  ZONE DISTRIBUTION
    // ════════════════════════════════════════════════════════════════════

    _placeDoubleLoadedInZones(sizes) {
        const validZones = this.zones
            .filter(z => z.bounds && z.area && z.area > 0)
            .sort((a, b) => (b.area || 0) - (a.area || 0));

        console.log(`[COSTOLayoutPlacer] _placeDoubleLoadedInZones: ${this.zones.length} zones -> ${validZones.length} valid`);

        if (validZones.length === 0) {
            return this._placeDoubleLoadedInBounds(sizes, this.bounds, null);
        }

        const allBoxes = [];
        let remaining = [...sizes];

        for (const zone of validZones) {
            if (remaining.length === 0) break;
            const zoneArea = zone.area || 0;
            const zw = zone.bounds.maxX - zone.bounds.minX;
            const zh = zone.bounds.maxY - zone.bounds.minY;

            if (zoneArea < 2) {
                console.log(`[COSTOLayoutPlacer] Zone ${zone.id}: skip (area ${zoneArea.toFixed(1)} < 2)`);
                continue;
            }

            const avgBoxArea = this.targetWidth * this.boxDepth;
            // Minimum 1 box per zone to ensure all zones get utilized
            const zoneTarget = Math.max(1, Math.floor((zoneArea * 0.70) / avgBoxArea));
            const zoneSizes = remaining.splice(0, Math.min(zoneTarget, remaining.length));

            console.log(`[COSTOLayoutPlacer] Zone ${zone.id}: ${zw.toFixed(1)}×${zh.toFixed(1)}m, area=${zoneArea.toFixed(1)}m², target=${zoneSizes.length}`);

            if (zoneSizes.length === 0) continue;

            const zoneBoxes = this._placeDoubleLoadedInBounds(zoneSizes, zone.bounds, zone);
            console.log(`[COSTOLayoutPlacer] Zone ${zone.id || '?'}: ${zoneBoxes.length}/${zoneSizes.length} placed`);
            allBoxes.push(...zoneBoxes);
        }

        return allBoxes;
    }

    // ════════════════════════════════════════════════════════════════════
    //  CORE DOUBLE-LOADED PLACEMENT ALGORITHM
    // ════════════════════════════════════════════════════════════════════

    /**
     * Place boxes in double-loaded row pairs within a rectangular region.
     *
     * Layout structure (horizontal rows, vertical stacking):
     *
     *   ┌ Perimeter corridor ────────────────────────────────┐
     *   │  ┌──┬──┬──┬──┬──┬──┐  │vert │  ┌──┬──┬──┬──┬──┐  │
     *   │  │  │  │  │  │  │  │  │artery│  │  │  │  │  │  │  │  Row A
     *   │  ├──┴──┴──┴──┴──┴──┤  │     │  ├──┴──┴──┴──┴──┤  │  Partition (Tole Grise)
     *   │  │  │  │  │  │  │  │  │     │  │  │  │  │  │  │  │  Row B
     *   │  └──┴──┴──┴──┴──┴──┘  │     │  └──┴──┴──┴──┴──┘  │
     *   │  ═══ access corridor ══╪═════╪══════════════════   │  (light-blue dashed)
     *   │  ┌──┬──┬──┬──┬──┬──┐  │     │  ┌──┬──┬──┬──┬──┐  │
     *   │  │  │  │  │  │  │  │  │     │  │  │  │  │  │  │  │  Row C
     *   │  ├──┴──┴──┴──┴──┴──┤  │     │  ├──┴──┴──┴──┴──┤  │  Partition
     *   │  │  │  │  │  │  │  │  │     │  │  │  │  │  │  │  │  Row D
     *   │  └──┴──┴──┴──┴──┴──┘  │     │  └──┴──┴──┴──┴──┘  │
     *   └ Perimeter corridor ────────────────────────────────┘
     *   ╬╬╬╬╬╬╬╬╬╬╬╬ radiators (red zigzag along walls) ╬╬╬╬
     *
     * @param {Array} sizes - Array of {width, area} objects
     * @param {Object} bounds - {minX, minY, maxX, maxY}
     * @param {Object|null} zone - Optional zone with polygon for containment
     * @returns {Array} Placed box objects
     */
    _placeDoubleLoadedInBounds(sizes, bounds, zone) {
        const allBoxes = [];

        // ── 1. Compute usable interior ──────────────────────────────────
        // For zones (rooms), use minimal margin to maximize placement
        // For full bounds, use perimeter corridor
        const boundsWidth = bounds.maxX - bounds.minX;
        const boundsHeight = bounds.maxY - bounds.minY;
        const isSmall = boundsWidth < 10 || boundsHeight < 10;
        const pm = zone ? (isSmall ? 0.1 : 0.3) : this.perimeterCorridorWidth;

        const innerMinX = bounds.minX + pm;
        const innerMinY = bounds.minY + pm;
        const innerMaxX = bounds.maxX - pm;
        const innerMaxY = bounds.maxY - pm;

        const innerWidth = innerMaxX - innerMinX;
        const innerHeight = innerMaxY - innerMinY;

        // Reduced minimum size check for zones
        const minWidth = zone ? 0.8 : this.minBoxWidth;
        const minHeight = zone ? 1.5 : this.boxDepth * 2;

        if (innerWidth < minWidth || innerHeight < minHeight) {
            if (!zone) console.log('[COSTOLayoutPlacer] Area too small for double-loaded placement');
            return allBoxes;
        }

        // ── 2. Determine row orientation ────────────────────────────────
        // Rows run along the LONGER axis; stacking happens along the shorter axis.
        const horizontal = innerWidth >= innerHeight;

        const rowLength = horizontal ? innerWidth : innerHeight;
        const stackLength = horizontal ? innerHeight : innerWidth;

        // ── 3. Compute vertical artery positions (perpendicular to rows) ─
        const verticalArteries = [];
        if (rowLength > this.verticalArterySpacing * 1.5) {
            const numSections = Math.max(2, Math.round(rowLength / this.verticalArterySpacing));
            const sectionWidth = rowLength / numSections;
            for (let i = 1; i < numSections; i++) {
                const pos = (horizontal ? innerMinX : innerMinY) + sectionWidth * i;
                verticalArteries.push(pos);
            }
        }

        // Build section ranges along the row axis
        const rowStart = horizontal ? innerMinX : innerMinY;
        const rowEnd = horizontal ? innerMaxX : innerMaxY;
        const sections = [];
        let secStart = rowStart;
        for (const arteryPos of verticalArteries) {
            const secEnd = arteryPos - this.mainArteryWidth / 2;
            if (secEnd - secStart > this.minBoxWidth * 2) {
                sections.push({ start: secStart, end: secEnd });
            }
            secStart = arteryPos + this.mainArteryWidth / 2;

            // Record artery corridor
            if (horizontal) {
                this.corridors.push({
                    type: 'mainArtery', direction: 'vertical',
                    x: arteryPos - this.mainArteryWidth / 2,
                    y: innerMinY,
                    width: this.mainArteryWidth,
                    height: innerHeight
                });
            } else {
                this.corridors.push({
                    type: 'mainArtery', direction: 'horizontal',
                    x: innerMinX,
                    y: arteryPos - this.mainArteryWidth / 2,
                    width: innerWidth,
                    height: this.mainArteryWidth
                });
            }
        }
        // Last section
        if (rowEnd - secStart > this.minBoxWidth * 2) {
            sections.push({ start: secStart, end: rowEnd });
        }
        // If no arteries at all, the whole row range is one section
        if (sections.length === 0) {
            sections.push({ start: rowStart, end: rowEnd });
        }

        // ── 4. Stack double-loaded row pairs along the perpendicular axis ─
        const pairDepth = this.boxDepth * 2 + this.partitionGap;
        const stripHeight = pairDepth + this.accessCorridorWidth;
        const stackStart = horizontal ? innerMinY : innerMinX;
        const stackEnd = horizontal ? innerMaxY : innerMaxX;

        let cursor = stackStart;
        let pairIndex = 0;
        let sizeIndex = 0;

        while (cursor + pairDepth <= stackEnd && sizeIndex < sizes.length) {
            // Insert horizontal main artery every N pairs
            if (pairIndex > 0 && pairIndex % this.mainArteryInterval === 0) {
                if (cursor + this.mainArteryWidth + pairDepth <= stackEnd) {
                    if (horizontal) {
                        this.corridors.push({
                            type: 'mainArtery', direction: 'horizontal',
                            x: innerMinX, y: cursor,
                            width: innerWidth, height: this.mainArteryWidth
                        });
                    } else {
                        this.corridors.push({
                            type: 'mainArtery', direction: 'vertical',
                            x: cursor, y: innerMinY,
                            width: this.mainArteryWidth, height: innerHeight
                        });
                    }
                    cursor += this.mainArteryWidth;
                }
            }

            // Row A position (top/left row of the pair)
            const rowAPos = cursor;
            // Row B position (bottom/right row, back-to-back with A)
            const rowBPos = cursor + this.boxDepth + this.partitionGap;

            // ── Fill rows across all sections ───────────────────────────
            for (const section of sections) {
                const secMin = section.start;
                const secMax = section.end;

                // Row A: boxes face toward the corridor (below/right)
                const rowABoxes = this._fillRow({
                    rowStart: secMin, rowEnd: secMax,
                    perpPos: rowAPos, depth: this.boxDepth,
                    sizes, sizeIndexRef: { value: sizeIndex },
                    facing: horizontal ? 'south' : 'east',
                    pairId: pairIndex, rowId: pairIndex * 2,
                    horizontal, zone
                });
                sizeIndex = rowABoxes.nextSizeIndex;
                allBoxes.push(...rowABoxes.boxes);

                // Row B: boxes face toward the corridor (above/left)
                const rowBBoxes = this._fillRow({
                    rowStart: secMin, rowEnd: secMax,
                    perpPos: rowBPos, depth: this.boxDepth,
                    sizes, sizeIndexRef: { value: sizeIndex },
                    facing: horizontal ? 'north' : 'west',
                    pairId: pairIndex, rowId: pairIndex * 2 + 1,
                    horizontal, zone
                });
                sizeIndex = rowBBoxes.nextSizeIndex;
                allBoxes.push(...rowBBoxes.boxes);
            }

            // ── Access corridor after this pair ─────────────────────────
            const corridorStart = cursor + pairDepth;
            if (horizontal) {
                this.corridors.push({
                    type: 'access', direction: 'horizontal',
                    x: innerMinX, y: corridorStart,
                    width: innerWidth, height: this.accessCorridorWidth
                });
            } else {
                this.corridors.push({
                    type: 'access', direction: 'vertical',
                    x: corridorStart, y: innerMinY,
                    width: this.accessCorridorWidth, height: innerHeight
                });
            }

            cursor += stripHeight;
            pairIndex++;
        }

        return allBoxes;
    }

    /**
     * Fill one row of boxes along the row axis.
     * @returns {{ boxes: Array, nextSizeIndex: number }}
     */
    _fillRow({ rowStart, rowEnd, perpPos, depth, sizes,
        sizeIndexRef, facing, pairId, rowId, horizontal, zone }) {

        const boxes = [];
        let cursor = rowStart;
        let sizeIdx = sizeIndexRef.value;

        while (cursor < rowEnd - this.minBoxWidth * 0.5 && sizeIdx < sizes.length) {
            const sizeEntry = sizes[sizeIdx];
            let boxWidth = (typeof sizeEntry === 'number') ? sizeEntry
                : (sizeEntry.width || this.targetWidth || this.minBoxWidth);

            // Clamp width to remaining space
            const remaining = rowEnd - cursor;
            if (boxWidth > remaining) {
                if (remaining >= this.minBoxWidth) {
                    boxWidth = remaining;
                } else {
                    break; // Row full
                }
            }

            // Build box geometry (horizontal rows: x along row axis, y perpendicular)
            const box = horizontal
                ? { x: cursor, y: perpPos, width: boxWidth, height: depth }
                : { x: perpPos, y: cursor, width: depth, height: boxWidth };

            // Collision checks
            if (this._isValidPlacement(box, zone)) {
                box.facing = facing;
                box.pairId = pairId;
                box.rowId = rowId;
                box.partitionType = 'toleGrise';
                // Propagate type and area from unit mix if available
                if (sizeEntry && typeof sizeEntry === 'object') {
                    if (sizeEntry.type) box.type = sizeEntry.type;
                    if (sizeEntry.area) box.area = sizeEntry.area;
                }
                boxes.push(box);
            }

            cursor += boxWidth + this.boxSpacing;
            sizeIdx += 1;
        }

        return { boxes, nextSizeIndex: sizeIdx };
    }

    // ════════════════════════════════════════════════════════════════════
    //  GAP FILLING (Aggressive space optimization)
    // ════════════════════════════════════════════════════════════════════

    /**
     * Fill remaining empty spaces with boxes using grid-based scanning.
     * Called when initial placement has significant shortfall.
     * Uses multi-directional scanning to ensure all areas are covered.
     */
    _fillGaps(existingBoxes, remainingSizes, targetCount) {
        const gapBoxes = [];
        const gridSize = 0.3; // Finer 0.3m grid for better coverage

        // Convert existing boxes to occupancy set for fast lookup
        const occupied = new Set();
        const markOccupied = (box) => {
            const x1 = Math.floor(box.x / gridSize);
            const y1 = Math.floor(box.y / gridSize);
            const x2 = Math.ceil((box.x + box.width) / gridSize);
            const y2 = Math.ceil((box.y + box.height) / gridSize);
            for (let gx = x1; gx < x2; gx++) {
                for (let gy = y1; gy < y2; gy++) {
                    occupied.add(`${gx},${gy}`);
                }
            }
        };

        for (const box of existingBoxes) {
            markOccupied(box);
        }

        const margin = 0.3;
        const innerMinX = this.bounds.minX + margin;
        const innerMinY = this.bounds.minY + margin;
        const innerMaxX = this.bounds.maxX - margin;
        const innerMaxY = this.bounds.maxY - margin;

        const gridMinX = Math.floor(innerMinX / gridSize);
        const gridMinY = Math.floor(innerMinY / gridSize);
        const gridMaxX = Math.ceil(innerMaxX / gridSize);
        const gridMaxY = Math.ceil(innerMaxY / gridSize);

        // Box sizes to try (from largest to smallest)
        const boxSizes = [
            { w: this.targetWidth || 2.0, h: this.boxDepth || 3.0 },
            { w: 2.0, h: 2.5 },  // Standard
            { w: 1.5, h: 2.0 },  // Medium
            { w: 1.2, h: 1.5 },  // Small
            { w: 1.0, h: 1.2 },  // Tiny
        ];

        const tryPlaceAt = (gx, gy) => {
            if (occupied.has(`${gx},${gy}`)) return false;

            // Try each box size from largest to smallest
            for (const size of boxSizes) {
                const targetGridW = Math.ceil(size.w / gridSize);
                const targetGridH = Math.ceil(size.h / gridSize);

                // Check bounds
                if (gx + targetGridW > gridMaxX || gy + targetGridH > gridMaxY) continue;

                // Check if we can fit this size starting from (gx, gy)
                let canFit = true;
                for (let dy = 0; dy < targetGridH && canFit; dy++) {
                    for (let dx = 0; dx < targetGridW && canFit; dx++) {
                        if (occupied.has(`${gx + dx},${gy + dy}`)) {
                            canFit = false;
                        }
                    }
                }

                if (!canFit) continue;

                // Create box at this position
                const box = {
                    x: gx * gridSize,
                    y: gy * gridSize,
                    width: targetGridW * gridSize,
                    height: targetGridH * gridSize
                };

                // Validate placement (wall collision check enabled)
                if (!this._isValidPlacement(box, null, false)) continue;

                // Check it doesn't overlap existing gapBoxes
                let overlaps = false;
                for (const gb of gapBoxes) {
                    if (box.x < gb.x + gb.width && box.x + box.width > gb.x &&
                        box.y < gb.y + gb.height && box.y + box.height > gb.y) {
                        overlaps = true;
                        break;
                    }
                }
                if (overlaps) continue;

                // Mark as occupied
                for (let dy = 0; dy < targetGridH; dy++) {
                    for (let dx = 0; dx < targetGridW; dx++) {
                        occupied.add(`${gx + dx},${gy + dy}`);
                    }
                }

                box.partitionType = 'toleGrise';
                box.isGapFill = true;
                gapBoxes.push(box);
                return true;
            }
            return false;
        };

        // PASS 1: Bottom-up scan (left to right, bottom to top)
        for (let gy = gridMinY; gy < gridMaxY && gapBoxes.length < targetCount; gy++) {
            for (let gx = gridMinX; gx < gridMaxX && gapBoxes.length < targetCount; gx++) {
                tryPlaceAt(gx, gy);
            }
        }

        // PASS 2: Top-down scan (left to right, top to bottom) - catches upper sections
        for (let gy = gridMaxY - 1; gy >= gridMinY && gapBoxes.length < targetCount; gy--) {
            for (let gx = gridMinX; gx < gridMaxX && gapBoxes.length < targetCount; gx++) {
                tryPlaceAt(gx, gy);
            }
        }

        // PASS 3: Right-to-left scan (top to bottom)
        for (let gx = gridMaxX - 1; gx >= gridMinX && gapBoxes.length < targetCount; gx--) {
            for (let gy = gridMaxY - 1; gy >= gridMinY && gapBoxes.length < targetCount; gy--) {
                tryPlaceAt(gx, gy);
            }
        }

        // PASS 4: Center-out scan (start from center, spiral outward)
        const centerX = Math.floor((gridMinX + gridMaxX) / 2);
        const centerY = Math.floor((gridMinY + gridMaxY) / 2);
        const maxRadius = Math.max(gridMaxX - gridMinX, gridMaxY - gridMinY);

        for (let r = 0; r <= maxRadius && gapBoxes.length < targetCount; r++) {
            for (let dy = -r; dy <= r && gapBoxes.length < targetCount; dy++) {
                for (let dx = -r; dx <= r && gapBoxes.length < targetCount; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const gx = centerX + dx;
                    const gy = centerY + dy;
                    if (gx < gridMinX || gx >= gridMaxX || gy < gridMinY || gy >= gridMaxY) continue;
                    tryPlaceAt(gx, gy);
                }
            }
        }

        return gapBoxes;
    }


    // ════════════════════════════════════════════════════════════════════
    //  PERIMETER CORRIDORS
    // ════════════════════════════════════════════════════════════════════

    _generatePerimeterCorridors() {
        const corridors = [];
        const b = this.bounds;
        const w = this.perimeterCorridorWidth;

        // Bottom
        corridors.push({
            type: 'perimeter', direction: 'horizontal',
            x: b.minX, y: b.minY,
            width: b.maxX - b.minX, height: w
        });
        // Top
        corridors.push({
            type: 'perimeter', direction: 'horizontal',
            x: b.minX, y: b.maxY - w,
            width: b.maxX - b.minX, height: w
        });
        // Left
        corridors.push({
            type: 'perimeter', direction: 'vertical',
            x: b.minX, y: b.minY,
            width: w, height: b.maxY - b.minY
        });
        // Right
        corridors.push({
            type: 'perimeter', direction: 'vertical',
            x: b.maxX - w, y: b.minY,
            width: w, height: b.maxY - b.minY
        });

        return corridors;
    }

    // ════════════════════════════════════════════════════════════════════
    //  RADIATOR GENERATION
    // ════════════════════════════════════════════════════════════════════

    /**
     * INTELLIGENT RADIATOR GENERATION
     * Generate zigzag radiator polylines along perimeter wall segments.
     * Enhanced with smart wall detection, merging, and realistic placement.
     * Radiators are offset slightly inward from the wall and rendered
     * as red zigzag lines matching the reference output exactly.
     */
    _generateWallRadiators() {
        const radiators = [];
        const b = this.bounds;
        const centerX = (b.minX + b.maxX) / 2;
        const centerY = (b.minY + b.maxY) / 2;

        // STEP 1: Intelligent wall segment detection and merging
        const candidateSegments = this._detectPerimeterWalls();

        // STEP 2: Merge collinear segments for continuous radiators
        const mergedSegments = this._mergeCollinearSegments(candidateSegments);

        console.log(`[Radiator] Detected ${candidateSegments.length} wall segments, merged to ${mergedSegments.length}`);

        // STEP 3: Generate radiators for each merged segment
        for (const seg of mergedSegments) {
            const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
            if (length < 1.0) continue; // Skip very short segments

            // Compute inward normal direction (toward floor center)
            const midX = (seg.x1 + seg.x2) / 2;
            const midY = (seg.y1 + seg.y2) / 2;
            const dx = seg.x2 - seg.x1;
            const dy = seg.y2 - seg.y1;
            const len = Math.hypot(dx, dy);

            // Two possible normals: (-dy, dx) and (dy, -dx)
            const n1x = -dy / len;
            const n1y = dx / len;

            // Pick the one that points toward the floor center
            const dot1 = n1x * (centerX - midX) + n1y * (centerY - midY);
            const nx = dot1 >= 0 ? n1x : -n1x;
            const ny = dot1 >= 0 ? n1y : -n1y;

            // ENHANCED: Create zigzag with adaptive wavelength based on segment length
            const adaptiveWavelength = Math.min(this.radiatorWavelength, length / 5);
            const zigzag = this._createZigzagAlongSegment(
                seg.x1, seg.y1, seg.x2, seg.y2,
                nx, ny,
                this.radiatorOffset,
                this.radiatorAmplitude,
                adaptiveWavelength
            );

            if (zigzag.length >= 2) {
                radiators.push({
                    type: 'radiator',
                    wallSegment: { start: { x: seg.x1, y: seg.y1 }, end: { x: seg.x2, y: seg.y2 } },
                    path: zigzag,
                    amplitude: this.radiatorAmplitude,
                    wavelength: adaptiveWavelength,
                    color: 'red', // Explicit for reference matching
                    style: 'zigzag'
                });
            }
        }

        console.log(`[Radiator] Generated ${radiators.length} radiator polylines`);
        return radiators;
    }

    /**
     * INTELLIGENT PERIMETER WALL DETECTION
     * Detects walls along the building perimeter using multiple strategies:
     * 1. Actual CAD wall entities near bounds
     * 2. Boundary rectangle fallback
     * 3. Smart filtering to avoid interior walls
     */
    _detectPerimeterWalls() {
        const b = this.bounds;
        const candidateSegments = [];
        const threshold = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08; // 8% threshold

        if (this.walls.length > 0) {
            // Strategy 1: Use actual wall entities
            for (const wall of this.walls) {
                const seg = this._extractWallSegment(wall);
                if (!seg) continue;

                const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                if (length < 0.5) continue; // Skip tiny segments

                // Check if wall is near perimeter
                const midX = (seg.x1 + seg.x2) / 2;
                const midY = (seg.y1 + seg.y2) / 2;

                const nearLeft = Math.abs(midX - b.minX) < threshold;
                const nearRight = Math.abs(midX - b.maxX) < threshold;
                const nearBottom = Math.abs(midY - b.minY) < threshold;
                const nearTop = Math.abs(midY - b.maxY) < threshold;

                if (nearLeft || nearRight || nearBottom || nearTop) {
                    candidateSegments.push({
                        x1: seg.x1, y1: seg.y1,
                        x2: seg.x2, y2: seg.y2,
                        source: 'wall_entity',
                        perimeter: nearLeft ? 'left' : nearRight ? 'right' : nearBottom ? 'bottom' : 'top'
                    });
                }
            }
        }

        // Strategy 2: Fallback to boundary rectangle if insufficient walls
        if (candidateSegments.length < 4) {
            console.log('[Radiator] Using boundary rectangle fallback');
            candidateSegments.length = 0; // Clear
            candidateSegments.push(
                { x1: b.minX, y1: b.minY, x2: b.maxX, y2: b.minY, source: 'bounds', perimeter: 'bottom' },  // Bottom
                { x1: b.maxX, y1: b.minY, x2: b.maxX, y2: b.maxY, source: 'bounds', perimeter: 'right' },   // Right
                { x1: b.maxX, y1: b.maxY, x2: b.minX, y2: b.maxY, source: 'bounds', perimeter: 'top' },     // Top
                { x1: b.minX, y1: b.maxY, x2: b.minX, y2: b.minY, source: 'bounds', perimeter: 'left' }     // Left
            );
        }

        return candidateSegments;
    }

    /**
     * MERGE COLLINEAR WALL SEGMENTS
     * Combines adjacent wall segments that are collinear (same line)
     * to create continuous radiator runs matching reference output
     */
    _mergeCollinearSegments(segments) {
        if (segments.length === 0) return [];

        const merged = [];
        const used = new Set();

        for (let i = 0; i < segments.length; i++) {
            if (used.has(i)) continue;

            let current = { ...segments[i] };
            used.add(i);

            // Try to extend this segment by merging with collinear neighbors
            let foundMerge = true;
            while (foundMerge) {
                foundMerge = false;

                for (let j = 0; j < segments.length; j++) {
                    if (used.has(j)) continue;

                    const other = segments[j];

                    // Check if segments are collinear and adjacent
                    if (this._areCollinear(current, other) && this._areAdjacent(current, other)) {
                        // Merge segments
                        current = this._extendSegment(current, other);
                        used.add(j);
                        foundMerge = true;
                    }
                }
            }

            merged.push(current);
        }

        return merged;
    }

    /**
     * Check if two segments are collinear (on same line)
     */
    _areCollinear(seg1, seg2, tolerance = 0.1) {
        // Calculate angles
        const angle1 = Math.atan2(seg1.y2 - seg1.y1, seg1.x2 - seg1.x1);
        const angle2 = Math.atan2(seg2.y2 - seg2.y1, seg2.x2 - seg2.x1);

        const angleDiff = Math.abs(angle1 - angle2);
        const angleMatch = angleDiff < tolerance || Math.abs(angleDiff - Math.PI) < tolerance;

        if (!angleMatch) return false;

        // Check if points are on same line
        const dx = seg1.x2 - seg1.x1;
        const dy = seg1.y2 - seg1.y1;
        const len = Math.hypot(dx, dy);

        if (len === 0) return false;

        // Distance from seg2.x1,y1 to line defined by seg1
        const t = ((seg2.x1 - seg1.x1) * dx + (seg2.y1 - seg1.y1) * dy) / (len * len);
        const projX = seg1.x1 + t * dx;
        const projY = seg1.y1 + t * dy;
        const dist = Math.hypot(seg2.x1 - projX, seg2.y1 - projY);

        return dist < 0.2; // 20cm tolerance for collinearity
    }

    /**
     * Check if two segments are adjacent (share endpoint or are very close)
     */
    _areAdjacent(seg1, seg2, tolerance = 0.3) {
        const d11 = Math.hypot(seg1.x1 - seg2.x1, seg1.y1 - seg2.y1);
        const d12 = Math.hypot(seg1.x1 - seg2.x2, seg1.y1 - seg2.y2);
        const d21 = Math.hypot(seg1.x2 - seg2.x1, seg1.y2 - seg2.y1);
        const d22 = Math.hypot(seg1.x2 - seg2.x2, seg1.y2 - seg2.y2);

        return d11 < tolerance || d12 < tolerance || d21 < tolerance || d22 < tolerance;
    }

    /**
     * Extend segment by merging with another
     */
    _extendSegment(seg1, seg2) {
        // Find the two farthest points among all endpoints
        const points = [
            { x: seg1.x1, y: seg1.y1 },
            { x: seg1.x2, y: seg1.y2 },
            { x: seg2.x1, y: seg2.y1 },
            { x: seg2.x2, y: seg2.y2 }
        ];

        let maxDist = 0;
        let p1 = points[0], p2 = points[1];

        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                const dist = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
                if (dist > maxDist) {
                    maxDist = dist;
                    p1 = points[i];
                    p2 = points[j];
                }
            }
        }

        return {
            x1: p1.x, y1: p1.y,
            x2: p2.x, y2: p2.y,
            source: seg1.source || seg2.source,
            perimeter: seg1.perimeter || seg2.perimeter
        };
    }

    /**
     * Create a zigzag polyline offset from and parallel to a wall segment.
     * @returns {Array<{x:number, y:number}>}
     */
    _createZigzagAlongSegment(x1, y1, x2, y2, nx, ny, offset, amplitude, wavelength) {
        const points = [];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        if (length < 0.5) return points;

        const ux = dx / length; // Unit vector along wall
        const uy = dy / length;

        const halfWave = wavelength / 2;
        const numPoints = Math.max(4, Math.floor(length / halfWave) + 1);

        for (let i = 0; i <= numPoints; i++) {
            const t = Math.min(i * halfWave / length, 1.0);
            // Base position along wall
            const bx = x1 + dx * t;
            const by = y1 + dy * t;
            // Offset from wall (inward)
            const ox = bx + nx * offset;
            const oy = by + ny * offset;
            // Zigzag: alternate + / - amplitude perpendicular to wall
            const zigSign = (i % 2 === 0) ? 1 : -1;
            const px = ox + nx * zigSign * amplitude;
            const py = oy + ny * zigSign * amplitude;
            points.push({ x: px, y: py });
        }

        return points;
    }

    /**
     * Check whether a wall segment lies near the perimeter of the bounds.
     */
    _isPerimeterWall(seg, bounds) {
        const threshold = (Math.max(
            bounds.maxX - bounds.minX,
            bounds.maxY - bounds.minY
        )) * 0.05; // 5% of the larger dimension

        const midX = (seg.x1 + seg.x2) / 2;
        const midY = (seg.y1 + seg.y2) / 2;

        return (
            Math.abs(midX - bounds.minX) < threshold ||
            Math.abs(midX - bounds.maxX) < threshold ||
            Math.abs(midY - bounds.minY) < threshold ||
            Math.abs(midY - bounds.maxY) < threshold
        );
    }

    // ════════════════════════════════════════════════════════════════════
    //  CIRCULATION PATH GENERATION
    // ════════════════════════════════════════════════════════════════════

    /**
     * Build dashed center-line paths for every corridor.
     * These are rendered as light-blue dashed lines ("ligne circulation").
     * Includes traffic direction (entry/exit) based on nearest entrance.
     */
    _buildCirculationPaths() {
        const paths = [];

        // Find center of entrances for direction calculation
        const entranceCenter = this._getEntranceCenter();
        const hasEntrances = entranceCenter !== null;

        for (const corridor of this.corridors) {
            const cx = corridor.x + corridor.width / 2;
            const cy = corridor.y + corridor.height / 2;

            // All access corridors have consistent directional flow pointing TOWARDS entrance
            // This creates a logical circulation pattern
            let trafficDirection = 'access'; // Use 'access' for all - blue arrows
            let startPoint, endPoint;

            if (corridor.direction === 'horizontal') {
                // Determine direction based on entrance position
                if (hasEntrances && entranceCenter.x < cx) {
                    // Entrance is to the left - arrows point left (towards entrance)
                    startPoint = { x: corridor.x + corridor.width, y: cy };
                    endPoint = { x: corridor.x, y: cy };
                } else {
                    // Entrance is to the right - arrows point right (towards entrance)
                    startPoint = { x: corridor.x, y: cy };
                    endPoint = { x: corridor.x + corridor.width, y: cy };
                }

                paths.push({
                    type: corridor.type,
                    style: 'dashed_lightblue',
                    trafficDirection: trafficDirection,
                    path: [startPoint, endPoint]
                });
            } else {
                // Vertical corridor
                if (hasEntrances && entranceCenter.y < cy) {
                    // Entrance is below - arrows point down (towards entrance)
                    startPoint = { x: cx, y: corridor.y + corridor.height };
                    endPoint = { x: cx, y: corridor.y };
                } else {
                    // Entrance is above - arrows point up (towards entrance)
                    startPoint = { x: cx, y: corridor.y };
                    endPoint = { x: cx, y: corridor.y + corridor.height };
                }

                paths.push({
                    type: corridor.type,
                    style: 'dashed_lightblue',
                    trafficDirection: trafficDirection,
                    path: [startPoint, endPoint]
                });
            }
        }

        return paths;
    }

    /**
     * Get the center point of all entrances for traffic direction calculation.
     * @returns {Object|null} Center point {x, y} or null if no entrances
     */
    _getEntranceCenter() {
        if (!this.entrances || this.entrances.length === 0) {
            return null;
        }

        let sumX = 0, sumY = 0, count = 0;

        for (const entrance of this.entrances) {
            if (entrance.position) {
                sumX += entrance.position.x;
                sumY += entrance.position.y;
                count++;
            } else if (entrance.x !== undefined && entrance.y !== undefined) {
                sumX += entrance.x;
                sumY += entrance.y;
                count++;
            } else if (entrance.bounds) {
                sumX += (entrance.bounds.minX + entrance.bounds.maxX) / 2;
                sumY += (entrance.bounds.minY + entrance.bounds.maxY) / 2;
                count++;
            }
        }

        if (count === 0) {
            return null;
        }

        return { x: sumX / count, y: sumY / count };
    }

    /**
     * Check if a corridor rectangle overlaps with any wall.
     * @param {Object} corridor - The corridor object with x, y, width, height
     * @returns {boolean} True if corridor overlaps a wall
     */
    _corridorOverlapsWall(corridor) {
        const buffer = 0.1; // Small buffer for tolerance

        for (const wall of this.walls) {
            const seg = this._extractWallSegment(wall);
            if (!seg) continue;

            // Check if wall segment intersects corridor bounds
            const corridorBounds = {
                minX: corridor.x - buffer,
                minY: corridor.y - buffer,
                maxX: corridor.x + corridor.width + buffer,
                maxY: corridor.y + corridor.height + buffer
            };

            // Line-rectangle intersection check
            if (this._lineIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, corridorBounds)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if a line segment intersects a rectangle.
     */
    _lineIntersectsRect(x1, y1, x2, y2, rect) {
        // Check if either endpoint is inside the rectangle
        if ((x1 >= rect.minX && x1 <= rect.maxX && y1 >= rect.minY && y1 <= rect.maxY) ||
            (x2 >= rect.minX && x2 <= rect.maxX && y2 >= rect.minY && y2 <= rect.maxY)) {
            return true;
        }

        // Check line intersection with all 4 edges
        const edges = [
            { x1: rect.minX, y1: rect.minY, x2: rect.maxX, y2: rect.minY }, // bottom
            { x1: rect.maxX, y1: rect.minY, x2: rect.maxX, y2: rect.maxY }, // right
            { x1: rect.minX, y1: rect.maxY, x2: rect.maxX, y2: rect.maxY }, // top
            { x1: rect.minX, y1: rect.minY, x2: rect.minX, y2: rect.maxY }  // left
        ];

        for (const edge of edges) {
            if (this._segmentsIntersect(x1, y1, x2, y2, edge.x1, edge.y1, edge.x2, edge.y2)) {
                return true;
            }
        }

        return false;
    }

    // ════════════════════════════════════════════════════════════════════
    //  SIZE COMPUTATION
    // ════════════════════════════════════════════════════════════════════

    _computeTargetWidth(distribution) {
        let distArray = [];
        if (!distribution) return this.minBoxWidth;

        if (Array.isArray(distribution)) {
            distArray = distribution;
        } else if (typeof distribution === 'object') {
            for (const [range, count] of Object.entries(distribution)) {
                const parts = range.split('-').map(Number);
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    distArray.push({ area: (parts[0] + parts[1]) / 2, count: Number(count) || 0 });
                }
            }
        }
        if (distArray.length === 0) return this.minBoxWidth;

        let totalArea = 0, totalCount = 0;
        for (const item of distArray) {
            const area = Number(item.area) || 0;
            const count = Number(item.count) || 0;
            totalArea += area * count;
            totalCount += count;
        }
        if (totalCount === 0 || totalArea === 0) return this.minBoxWidth;

        const avgArea = totalArea / totalCount;
        const targetWidth = avgArea / this.boxDepth;
        return Math.max(this.minBoxWidth, Math.min(this.maxBoxWidth, targetWidth));
    }

    /**
     * INTELLIGENT SIZE BUILDING
     * Uses the IntelligentBoxOptimizer to generate optimal box sizes
     * based on unit mix, floor geometry, and COSTO best practices
     */
    _buildSizes(distribution, targetCount) {
        // Use intelligent optimizer for better size distribution
        const floorGeometry = {
            availableWidth: this.bounds.maxX - this.bounds.minX,
            availableHeight: this.bounds.maxY - this.bounds.minY,
            wallCount: this.walls.length,
            zoneCount: this.zones.length
        };

        const unitMix = { distribution: distribution };
        const optimizedSizes = this.boxOptimizer.optimizeSizeDistribution(
            unitMix,
            targetCount,
            floorGeometry
        );

        // If optimizer returns valid sizes, use them
        if (optimizedSizes && optimizedSizes.length > 0) {
            console.log(`[COSTOLayoutPlacer] Using ${optimizedSizes.length} intelligently optimized box sizes`);
            return optimizedSizes;
        }

        // Fallback to original algorithm
        console.log('[COSTOLayoutPlacer] Falling back to original size calculation');
        const sizes = [];
        let distArray = [];

        if (!distribution) {
            // no-op
        } else if (Array.isArray(distribution)) {
            distArray = distribution;
        } else if (typeof distribution === 'object') {
            for (const [range, count] of Object.entries(distribution)) {
                const parts = range.split('-').map(Number);
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    distArray.push({ area: (parts[0] + parts[1]) / 2, count: Number(count) || 0 });
                }
            }
        }

        if (distArray.length === 0) {
            for (let i = 0; i < targetCount; i++) {
                sizes.push({ width: this.targetWidth || this.minBoxWidth });
            }
            return sizes;
        }

        const totalDistCount = distArray.reduce((s, it) => s + (Number(it.count) || 0), 0);
        if (totalDistCount === 0) {
            for (let i = 0; i < targetCount; i++) {
                sizes.push({ width: this.targetWidth || this.minBoxWidth });
            }
            return sizes;
        }

        for (const item of distArray) {
            const area = Number(item.area) || 0;
            const count = Number(item.count) || 0;
            if (area <= 0 || count <= 0) continue;

            const proportion = count / totalDistCount;
            const boxCount = Math.round(proportion * targetCount);
            const width = Math.max(this.minBoxWidth, Math.min(this.maxBoxWidth, area / this.boxDepth));

            for (let i = 0; i < boxCount; i++) {
                sizes.push({ width, area });
            }
        }

        // Pad or trim to target
        while (sizes.length < targetCount) {
            sizes.push({ width: this.targetWidth || this.minBoxWidth });
        }
        if (sizes.length > targetCount) sizes.length = targetCount;

        return sizes;
    }

    // ════════════════════════════════════════════════════════════════════
    //  COLLISION / VALIDATION
    // ════════════════════════════════════════════════════════════════════

    _isValidPlacement(box, zone, skipWallCheck = false) {
        const { x, y, width, height } = box;

        // Bounds check
        if (x < this.bounds.minX || y < this.bounds.minY ||
            x + width > this.bounds.maxX || y + height > this.bounds.maxY) {
            return false;
        }

        // Forbidden zones (stairs, elevators, ducts)
        for (const fz of this.forbiddenZones) {
            if (this._boxIntersectsRect(x, y, width, height, fz)) return false;
        }

        // Entrance clearance
        for (const ent of this.entrances) {
            if (this._boxNearEntrance(x, y, width, height, ent)) return false;
        }

        // Wall collision (skip for gap-fill to allow more aggressive placement)
        if (!skipWallCheck) {
            for (const wall of this.walls) {
                if (this._boxIntersectsWall(x, y, width, height, wall)) return false;
            }
        }

        // Zone containment (if zone provided)
        if (zone && zone.bounds) {
            const cx = x + width / 2;
            const cy = y + height / 2;
            if (cx < zone.bounds.minX || cx > zone.bounds.maxX ||
                cy < zone.bounds.minY || cy > zone.bounds.maxY) {
                return false;
            }
        }

        return true;
    }

    _boxNearEntrance(bx, by, bw, bh, entrance) {
        const clearance = 1.5;
        if (entrance.start && entrance.end) {
            const ex = Math.min(entrance.start.x, entrance.end.x) - clearance;
            const ey = Math.min(entrance.start.y, entrance.end.y) - clearance;
            const ew = Math.abs(entrance.end.x - entrance.start.x) + 2 * clearance;
            const eh = Math.abs(entrance.end.y - entrance.start.y) + 2 * clearance;
            return !(bx + bw <= ex || bx >= ex + ew || by + bh <= ey || by >= ey + eh);
        }
        if (entrance.x !== undefined && entrance.y !== undefined) {
            const ex = entrance.x - clearance;
            const ey = entrance.y - clearance;
            return !(bx + bw <= ex || bx >= ex + 2 * clearance ||
                by + bh <= ey || by >= ey + 2 * clearance);
        }
        return false;
    }

    _boxIntersectsRect(x, y, w, h, rect) {
        let rx, ry, rw, rh;
        if (rect.bounds) {
            rx = rect.bounds.minX; ry = rect.bounds.minY;
            rw = rect.bounds.maxX - rect.bounds.minX;
            rh = rect.bounds.maxY - rect.bounds.minY;
        } else if (typeof rect.x === 'number') {
            rx = rect.x; ry = rect.y;
            rw = rect.width; rh = rect.height;
        } else {
            return false;
        }
        return !(x + w <= rx || x >= rx + rw || y + h <= ry || y >= ry + rh);
    }

    _boxIntersectsWall(bx, by, bw, bh, wall) {
        const seg = this._extractWallSegment(wall);
        if (!seg) return false;

        const cl = this.wallClearance;
        // Expanded box with clearance
        const rx = bx - cl;
        const ry = by - cl;
        const rw = bw + cl * 2;
        const rh = bh + cl * 2;

        // Check if either wall endpoint is inside the expanded box
        if (seg.x1 >= rx && seg.x1 <= rx + rw && seg.y1 >= ry && seg.y1 <= ry + rh) return true;
        if (seg.x2 >= rx && seg.x2 <= rx + rw && seg.y2 >= ry && seg.y2 <= ry + rh) return true;

        // Check if wall segment crosses any box edge
        const boxEdges = [
            { x1: rx, y1: ry, x2: rx + rw, y2: ry },
            { x1: rx + rw, y1: ry, x2: rx + rw, y2: ry + rh },
            { x1: rx, y1: ry + rh, x2: rx + rw, y2: ry + rh },
            { x1: rx, y1: ry, x2: rx, y2: ry + rh }
        ];

        for (const edge of boxEdges) {
            if (this._segmentsIntersect(
                seg.x1, seg.y1, seg.x2, seg.y2,
                edge.x1, edge.y1, edge.x2, edge.y2
            )) {
                return true;
            }
        }
        return false;
    }

    /**
     * Calculate polygon center for stair/elevator detection
     */
    _calculatePolygonCenter(polygon) {
        if (!polygon || polygon.length === 0) return { x: 0, y: 0 };

        let sumX = 0, sumY = 0;
        for (const pt of polygon) {
            sumX += Array.isArray(pt) ? pt[0] : pt.x;
            sumY += Array.isArray(pt) ? pt[1] : pt.y;
        }

        return { x: sumX / polygon.length, y: sumY / polygon.length };
    }

    /**
     * Calculate polygon radius (for circular stairs)
     */
    _calculatePolygonRadius(polygon) {
        if (!polygon || polygon.length === 0) return 0;

        const center = this._calculatePolygonCenter(polygon);
        let maxDist = 0;

        for (const pt of polygon) {
            const x = Array.isArray(pt) ? pt[0] : pt.x;
            const y = Array.isArray(pt) ? pt[1] : pt.y;
            const dist = Math.hypot(x - center.x, y - center.y);
            maxDist = Math.max(maxDist, dist);
        }

        return maxDist;
    }

    _extractWallSegment(wall) {
        const x1 = wall.x1 !== undefined ? wall.x1 : (wall.start ? wall.start.x : wall.startX);
        const y1 = wall.y1 !== undefined ? wall.y1 : (wall.start ? wall.start.y : wall.startY);
        const x2 = wall.x2 !== undefined ? wall.x2 : (wall.end ? wall.end.x : wall.endX);
        const y2 = wall.y2 !== undefined ? wall.y2 : (wall.end ? wall.end.y : wall.endY);
        if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
        return { x1, y1, x2, y2 };
    }

    _segmentsIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
        const denom = (ax1 - ax2) * (by1 - by2) - (ay1 - ay2) * (bx1 - bx2);
        if (Math.abs(denom) < 1e-10) return false;
        const t = ((ax1 - bx1) * (by1 - by2) - (ay1 - by1) * (bx1 - bx2)) / denom;
        const u = -((ax1 - ax2) * (ay1 - by1) - (ay1 - ay2) * (ax1 - bx1)) / denom;
        return (t >= 0 && t <= 1 && u >= 0 && u <= 1);
    }

    _pointInPolygon(x, y, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }
}

module.exports = COSTOLayoutPlacer;

