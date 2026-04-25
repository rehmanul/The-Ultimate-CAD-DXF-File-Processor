'use strict';

const { generateV11FromWalls } = require('../_generate_pdf');

function num(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function rectCenterline(rect) {
    const x = num(rect && rect.x, NaN);
    const y = num(rect && rect.y, NaN);
    const width = num(rect && rect.width, NaN);
    const height = num(rect && rect.height, NaN);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return null;
    }

    if (width >= height) {
        const cy = y + height / 2;
        return {
            direction: 'horizontal',
            points: [
                { x, y: cy },
                { x: x + width, y: cy }
            ]
        };
    }

    const cx = x + width / 2;
    return {
        direction: 'vertical',
        points: [
            { x: cx, y },
            { x: cx, y: y + height }
        ]
    };
}

function normalizeUnit(box, index) {
    const width = +num(box && box.width).toFixed(3);
    const height = +num(box && box.height).toFixed(3);
    const area = +(num(box && box.area, width * height)).toFixed(2);
    const face = box && (box.corridorFace || box.doorSide || box.facing) || null;

    return {
        id: String(box && box.id ? box.id : `unit_${index + 1}`),
        displayNumber: index + 1,
        x: +num(box && box.x).toFixed(3),
        y: +num(box && box.y).toFixed(3),
        width,
        height,
        area,
        label: `${area.toFixed(2)}m²`,
        type: box && box.type ? box.type : (area >= 4.6 ? 'L' : area >= 3.2 ? 'M' : 'S'),
        zone: box && box.zone ? box.zone : 'main',
        partitionType: box && box.partitionType ? box.partitionType : 'toleGrise',
        partitions: {
            top: 'tole_grise',
            bottom: 'tole_grise',
            left: 'tole_grise',
            right: 'tole_grise'
        },
        corridorFace: face,
        doorSide: box && box.doorSide ? box.doorSide : face,
        facing: box && box.facing ? box.facing : face,
        layoutMode: 'referenceDenseV11',
        number: index + 1,
        floor: 1
    };
}

function normalizeCorridor(corridor, index) {
    const x = +num(corridor && corridor.x).toFixed(3);
    const y = +num(corridor && corridor.y).toFixed(3);
    const width = +num(corridor && corridor.width).toFixed(3);
    const height = +num(corridor && corridor.height).toFixed(3);
    const polygon = Array.isArray(corridor && corridor.polygon)
        ? corridor.polygon.map((pt) => ({
            x: +num(pt && pt.x).toFixed(3),
            y: +num(pt && pt.y).toFixed(3)
        }))
        : [
            { x, y },
            { x: +(x + width).toFixed(3), y },
            { x: +(x + width).toFixed(3), y: +(y + height).toFixed(3) },
            { x, y: +(y + height).toFixed(3) }
        ];

    return {
        id: corridor && corridor.id ? corridor.id : `corridor_${index}`,
        x,
        y,
        width,
        height,
        direction: corridor && corridor.direction ? corridor.direction : (width >= height ? 'horizontal' : 'vertical'),
        type: corridor && corridor.type ? corridor.type : 'main_artery',
        polygon,
        corners: polygon
    };
}

async function generateReferenceLayout(floorPlan) {
    const walls = Array.isArray(floorPlan && floorPlan.walls) ? floorPlan.walls : [];
    const bounds = floorPlan && floorPlan.bounds;
    if (!bounds) {
        throw new Error('Reference dense layout requires floorPlan.bounds');
    }

    const result = await generateV11FromWalls(walls, bounds);
    const corridors = Array.isArray(result && result.corridors)
        ? result.corridors.map(normalizeCorridor)
        : [];
    const units = Array.isArray(result && result.boxes)
        ? result.boxes.map(normalizeUnit)
        : [];
    const circulationPaths = corridors
        .map((corridor) => {
            const centerline = rectCenterline(corridor);
            if (!centerline) return null;
            return {
                id: `path_${corridor.id}`,
                type: corridor.type || 'main_artery',
                direction: centerline.direction,
                points: centerline.points
            };
        })
        .filter(Boolean);

    return {
        units,
        corridors,
        radiators: [],
        circulationPaths,
        junctions: [],
        metrics: result && result.metrics ? result.metrics : {
            totalBoxes: units.length,
            corridorCount: corridors.length
        },
        layoutMode: 'referenceDenseV11'
    };
}

module.exports = {
    generateReferenceLayout
};
