const normalizeLayerName = (layerName) => {
    if (!layerName) return '';

    let normalized = layerName.toString();
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    normalized = normalized.trim().toUpperCase();
    normalized = normalized.replace(/\s+/g, '_');
    normalized = normalized.replace(/[^A-Z0-9_]/g, '_');
    normalized = normalized.replace(/_+/g, '_');
    normalized = normalized.replace(/^_+|_+$/g, '');

    return normalized;
};

module.exports = {
    normalizeLayerName
};
