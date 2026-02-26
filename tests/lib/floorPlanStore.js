/**
 * In-memory floor plan store.
 * Keeps track of the latest normalized floor plan data and layouts.
 * Designed for single-instance deployments; extend with persistent backend as needed.
 */

const clone = (value) => {
    if (value === null || value === undefined) return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return value;
    }
};

const store = new Map();

function normalizeId(id) {
    if (!id) return null;
    return String(id);
}

function ensureEntry(id) {
    const key = normalizeId(id);
    if (!key) return null;
    if (!store.has(key)) {
        store.set(key, { floorPlan: null, layout: null, meta: {} });
    }
    return key;
}

function saveFloorPlan(floorPlan, meta = {}) {
    if (!floorPlan) return null;
    const id = normalizeId(floorPlan.urn || floorPlan.id);
    if (!id) return null;
    const key = ensureEntry(id);
    const entry = store.get(key);
    entry.floorPlan = clone(floorPlan);
    entry.meta.floorPlan = Object.assign({}, entry.meta.floorPlan || {}, meta, {
        savedAt: new Date().toISOString()
    });
    store.set(key, entry);
    return clone(entry.floorPlan);
}

function updateLayout(id, layout, meta = {}) {
    const key = ensureEntry(id);
    if (!key) return null;
    const entry = store.get(key);
    entry.layout = clone(layout);
    entry.meta.layout = Object.assign({}, entry.meta.layout || {}, meta, {
        updatedAt: new Date().toISOString()
    });
    store.set(key, entry);
    return {
        floorPlan: clone(entry.floorPlan),
        layout: clone(entry.layout)
    };
}

function getFloorPlan(id) {
    const entry = store.get(normalizeId(id));
    return entry && entry.floorPlan ? clone(entry.floorPlan) : null;
}

function getLayout(id) {
    const entry = store.get(normalizeId(id));
    return entry && entry.layout ? clone(entry.layout) : null;
}

function remove(id) {
    return store.delete(normalizeId(id));
}

function listSummaries() {
    const summaries = [];
    store.forEach((entry, id) => {
        summaries.push({
            id,
            floorPlanUpdated: entry.meta.floorPlan?.savedAt || null,
            layoutUpdated: entry.meta.layout?.updatedAt || null,
            hasLayout: Boolean(entry.layout)
        });
    });
    return summaries;
}

module.exports = {
    saveFloorPlan,
    updateLayout,
    getFloorPlan,
    getLayout,
    remove,
    listSummaries
};
