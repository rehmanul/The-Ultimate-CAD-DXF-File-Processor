// Helper functions used by client overlay drawing
function safeNum(v, fallback = 0) {
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

module.exports = { safeNum, safePoint };
