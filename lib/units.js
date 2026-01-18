/**
 * DXF Unit Normalization Module
 * COSTO V1 Requirement: All geometry must be in METERS
 * 
 * DXF $INSUNITS values:
 *   0 = Unitless
 *   1 = Inches
 *   2 = Feet
 *   3 = Miles
 *   4 = Millimeters
 *   5 = Centimeters
 *   6 = Meters
 *   7 = Kilometers
 *   8 = Microinches
 *   9 = Mils
 *  10 = Yards
 *  11 = Angstroms
 *  12 = Nanometers
 *  13 = Microns
 *  14 = Decimeters
 *  15 = Decameters
 *  16 = Hectometers
 *  17 = Gigameters
 *  18 = Astronomical units
 *  19 = Light years
 *  20 = Parsecs
 */

const UNIT_SCALE_TO_METERS = {
    0: 1,         // Unitless - assume meters (or use heuristics)
    1: 0.0254,    // Inches -> Meters
    2: 0.3048,    // Feet -> Meters
    3: 1609.344,  // Miles -> Meters
    4: 0.001,     // Millimeters -> Meters
    5: 0.01,      // Centimeters -> Meters
    6: 1,         // Meters -> Meters (no conversion)
    7: 1000,      // Kilometers -> Meters
    8: 0.0000000254, // Microinches -> Meters
    9: 0.0000254, // Mils -> Meters
    10: 0.9144,   // Yards -> Meters
    14: 0.1,      // Decimeters -> Meters
    15: 10,       // Decameters -> Meters
    16: 100,      // Hectometers -> Meters
};

/**
 * Parse $INSUNITS from DXF header section
 * @param {string} dxfContent - Raw DXF file content
 * @returns {number} INSUNITS value (0-20), defaults to 0 if not found
 */
function parseInsunits(dxfContent) {
    // Look for $INSUNITS in HEADER section
    // Format is:
    //   9
    //   $INSUNITS
    //   70
    //   <value>
    const insunitsMatch = dxfContent.match(/\$INSUNITS[\s\r\n]+70[\s\r\n]+(\d+)/i);
    if (insunitsMatch) {
        return parseInt(insunitsMatch[1], 10);
    }
    return 0; // Unitless / not specified
}

/**
 * Get the scale factor to convert from DXF units to meters
 * @param {number} insunits - The $INSUNITS value
 * @returns {number} Scale factor (multiply coordinates by this to get meters)
 */
function getScaleToMeters(insunits) {
    return UNIT_SCALE_TO_METERS[insunits] || 1;
}

/**
 * Infer units from geometry heuristics when $INSUNITS is missing or 0
 * Assumptions:
 *   - Typical door width: 0.8-1.2m
 *   - Typical wall thickness: 0.1-0.3m
 *   - Typical room dimension: 3-15m
 * 
 * @param {Object} bounds - { width, height } of the floor plan
 * @param {Array} walls - Array of wall segments
 * @returns {number} Inferred scale factor to meters
 */
function inferScaleFromGeometry(bounds, walls = []) {
    const { width, height } = bounds;

    // If dimensions are reasonable for meters (e.g., 10-500m building), assume 1:1
    if (width >= 5 && width <= 500 && height >= 5 && height <= 500) {
        return 1; // Already in meters
    }

    // If dimensions are in thousands (e.g., 10000-500000), likely mm
    if (width >= 1000 && width <= 1000000) {
        console.log('[Units] Inferred: Millimeters (dimensions in thousands)');
        return 0.001; // mm to m
    }

    // If dimensions are in hundreds (e.g., 100-5000), might be cm
    if (width >= 100 && width <= 50000 && height >= 100) {
        console.log('[Units] Inferred: Centimeters (dimensions in hundreds)');
        return 0.01; // cm to m
    }

    // If dimensions are very small (< 5), might already be in some scaled format
    if (width < 5 && height < 5) {
        // Could be a scaled drawing, assume decameters
        console.log('[Units] Inferred: Decameters (very small dimensions)');
        return 10;
    }

    // Default: assume meters
    console.log('[Units] Inferred: Meters (default assumption)');
    return 1;
}

/**
 * Normalize all coordinates in floor plan data to meters
 * @param {Object} floorPlanData - The extracted CAD data
 * @param {number} scaleFactor - Scale factor to apply
 * @returns {Object} Normalized floor plan data (in meters)
 */
function normalizeToMeters(floorPlanData, scaleFactor) {
    if (scaleFactor === 1) {
        return floorPlanData; // Already in meters
    }

    console.log(`[Units] Normalizing geometry with scale factor: ${scaleFactor}`);

    const scalePoint = (pt) => {
        if (!pt) return pt;
        if (Array.isArray(pt)) {
            return pt.map(v => v * scaleFactor);
        }
        return { x: pt.x * scaleFactor, y: pt.y * scaleFactor };
    };

    const scaleWall = (wall) => {
        if (wall.start && wall.end) {
            return {
                ...wall,
                start: scalePoint(wall.start),
                end: scalePoint(wall.end)
            };
        }
        if (wall.polygon) {
            return {
                ...wall,
                polygon: wall.polygon.map(scalePoint)
            };
        }
        return wall;
    };

    const scaleZone = (zone) => {
        if (zone.polygon) {
            return {
                ...zone,
                polygon: zone.polygon.map(scalePoint),
                bounds: zone.bounds ? scaleBounds(zone.bounds) : undefined
            };
        }
        if (zone.start && zone.end) {
            return {
                ...zone,
                start: scalePoint(zone.start),
                end: scalePoint(zone.end)
            };
        }
        return zone;
    };

    const scaleBounds = (bounds) => ({
        minX: bounds.minX * scaleFactor,
        minY: bounds.minY * scaleFactor,
        maxX: bounds.maxX * scaleFactor,
        maxY: bounds.maxY * scaleFactor,
        width: (bounds.width || bounds.maxX - bounds.minX) * scaleFactor,
        height: (bounds.height || bounds.maxY - bounds.minY) * scaleFactor,
        area: (bounds.area || (bounds.width * bounds.height)) * scaleFactor * scaleFactor
    });

    const scaleRoom = (room) => ({
        ...room,
        polygon: room.polygon ? room.polygon.map(scalePoint) : undefined,
        bounds: room.bounds ? scaleBounds(room.bounds) : undefined,
        area: room.area ? room.area * scaleFactor * scaleFactor : undefined,
        center: room.center ? scalePoint(room.center) : undefined
    });

    return {
        ...floorPlanData,
        walls: (floorPlanData.walls || []).map(scaleWall),
        forbiddenZones: (floorPlanData.forbiddenZones || []).map(scaleZone),
        entrances: (floorPlanData.entrances || []).map(scaleZone),
        rooms: (floorPlanData.rooms || []).map(scaleRoom),
        bounds: floorPlanData.bounds ? scaleBounds(floorPlanData.bounds) : floorPlanData.bounds,
        unitInfo: {
            originalUnit: 'unknown',
            scaleFactor: scaleFactor,
            normalizedTo: 'meters'
        }
    };
}

module.exports = {
    parseInsunits,
    getScaleToMeters,
    inferScaleFromGeometry,
    normalizeToMeters,
    UNIT_SCALE_TO_METERS
};
