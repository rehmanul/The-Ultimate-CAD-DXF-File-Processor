// Lightweight sanitizers for ilots and corridors used by server and client overlay
function safeNum(v, fallback = null) {
    if (typeof v === 'number' && isFinite(v)) return Number(v);
    if (Array.isArray(v) && typeof v[0] === 'number') return Number(v[0]);
    return fallback;
}

function safePoint(p) {
    if (!p) return null;
    if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') return [Number(p[0]), Number(p[1]), Number(p[2] || 0)];
    if (typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number') return [Number(p.x), Number(p.y), Number(p.z || 0)];
    return null;
}

function sanitizeIlot(ilot) {
    if (!ilot || typeof ilot !== 'object') return null;
    let x = typeof ilot.x === 'number' ? ilot.x : null;
    let y = typeof ilot.y === 'number' ? ilot.y : null;
    if ((x === null || y === null) && ilot.center) {
        if (Array.isArray(ilot.center)) {
            x = safeNum(ilot.center[0], null);
            y = safeNum(ilot.center[1], null);
        } else if (typeof ilot.center === 'object') {
            x = safeNum(ilot.center.x, null);
            y = safeNum(ilot.center.y, null);
        }
    }
    if (x === null || y === null) return null;
    return Object.assign({}, ilot, { x: Number(x), y: Number(y) });
}

/**
 * Clip ilot to stay within floor plan boundaries
 * Returns null if ilot is completely outside bounds
 */
function clipIlotToBounds(ilot, bounds) {
    if (!ilot || !bounds) return ilot;

    const { minX, minY, maxX, maxY } = bounds;
    if (typeof minX !== 'number' || typeof minY !== 'number' ||
        typeof maxX !== 'number' || typeof maxY !== 'number') {
        return ilot;
    }

    let x = ilot.x;
    let y = ilot.y;
    let width = ilot.width || 1;
    let height = ilot.height || 1;

    // If ilot is completely outside bounds, return null
    if (x + width < minX || x > maxX || y + height < minY || y > maxY) {
        return null;
    }

    // Clip left edge
    if (x < minX) {
        width -= (minX - x);
        x = minX;
    }

    // Clip right edge
    if (x + width > maxX) {
        width = maxX - x;
    }

    // Clip bottom edge
    if (y < minY) {
        height -= (minY - y);
        y = minY;
    }

    // Clip top edge
    if (y + height > maxY) {
        height = maxY - y;
    }

    // If dimensions became too small, reject
    if (width < 0.5 || height < 0.5) {
        return null;
    }

    return Object.assign({}, ilot, {
        x: Number(x),
        y: Number(y),
        width: Number(width),
        height: Number(height),
        area: Number(width * height),
        clipped: true
    });
}

function sanitizeCorridor(corr) {
    if (!corr || typeof corr !== 'object') return null;

    if (Array.isArray(corr.polygon) && corr.polygon.length >= 3) {
        const polygon = corr.polygon.map(pt => (
            Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number'
        ) ? [Number(pt[0]), Number(pt[1])] : null).filter(Boolean);
        if (!polygon.length) return null;
        return Object.assign({}, corr, {
            polygon,
            x: safeNum(corr.x, 0),
            y: safeNum(corr.y, 0),
            width: safeNum(corr.width, polygon[1] ? Math.abs(polygon[1][0] - polygon[0][0]) : 0),
            height: safeNum(corr.height, polygon[2] ? Math.abs(polygon[2][1] - polygon[1][1]) : 0),
            area: safeNum(corr.area, 0)
        });
    }

    if (Array.isArray(corr.path) && corr.path.length) {
        const path = corr.path.map(p => safePoint(p)).filter(Boolean);
        if (path.length < 2) return null;
        return Object.assign({}, corr, { path });
    }

    if (typeof corr.x === 'number' && typeof corr.y === 'number' && typeof corr.width === 'number' && typeof corr.height === 'number') {
        return {
            x: Number(corr.x),
            y: Number(corr.y),
            width: Number(corr.width),
            height: Number(corr.height),
            area: safeNum(corr.area, Number(corr.width) * Number(corr.height))
        };
    }

    return null;
}

function sanitizeArrow(arrow) {
    if (!arrow || typeof arrow !== 'object') return null;

    const x = safeNum(arrow.x, null);
    const y = safeNum(arrow.y, null);
    if (x === null || y === null) return null;

    const direction = typeof arrow.direction === 'string' ? arrow.direction.toLowerCase() : 'right';
    const type = typeof arrow.type === 'string' ? arrow.type : 'corridor_flow';
    const color = typeof arrow.color === 'string' ? arrow.color : 'green';
    const size = typeof arrow.size === 'string' ? arrow.size : 'medium';
    const length = safeNum(arrow.length, null);
    const angle = safeNum(arrow.angle, null);
    const z = safeNum(arrow.z, 0);

    const sanitized = {
        x,
        y,
        z,
        type,
        direction,
        color,
        size
    };

    if (typeof arrow.id === 'string' && arrow.id.trim().length) {
        sanitized.id = arrow.id.trim();
    }

    if (length !== null) sanitized.length = length;
    if (angle !== null) sanitized.angle = angle;

    if (typeof arrow.category === 'string') sanitized.category = arrow.category;
    if (arrow.metadata && typeof arrow.metadata === 'object') {
        sanitized.metadata = arrow.metadata;
    }

    return sanitized;
}

module.exports = { safeNum, safePoint, sanitizeIlot, clipIlotToBounds, sanitizeCorridor, sanitizeArrow };
