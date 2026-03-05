'use strict';

/**
 * Building-code-style presets for corridor width, egress limit, and accessibility.
 * Use to align with common regulations (IBC, Eurocode-style). Not legally certified.
 */
const PRESETS = {
    none: {
        id: 'none',
        name: 'None (custom)',
        corridorWidth: null,
        egressDistanceLimit: null,
        requireElevators: null,
        minimumAccessibleEntrances: null,
        note: 'Use current UI values.'
    },
    ibc_common: {
        id: 'ibc_common',
        name: 'IBC-style (common path)',
        corridorWidth: 1.2,
        egressDistanceLimit: 45,
        requireElevators: true,
        minimumAccessibleEntrances: 1,
        note: 'Typical US commercial egress; 1.2 m corridor, 45 m max egress.'
    },
    eurocode_style: {
        id: 'eurocode_style',
        name: 'Eurocode-style',
        corridorWidth: 1.2,
        egressDistanceLimit: 40,
        requireElevators: true,
        minimumAccessibleEntrances: 1,
        note: 'Common European references; varies by country.'
    },
    storage_warehouse: {
        id: 'storage_warehouse',
        name: 'Storage / warehouse',
        corridorWidth: 1.5,
        egressDistanceLimit: 60,
        requireElevators: false,
        minimumAccessibleEntrances: 0,
        note: 'Wider corridors; higher egress limit.'
    }
};

function getAll() {
    return Object.values(PRESETS);
}

function getById(id) {
    return PRESETS[id] || null;
}

function applyPreset(id, currentValues = {}) {
    const p = getById(id);
    if (!p || id === 'none') return { ...currentValues };
    return {
        corridorWidth: p.corridorWidth != null ? p.corridorWidth : currentValues.corridorWidth,
        egressDistanceLimit: p.egressDistanceLimit != null ? p.egressDistanceLimit : currentValues.egressDistanceLimit,
        requireElevators: p.requireElevators != null ? p.requireElevators : currentValues.requireElevators,
        minimumAccessibleEntrances: p.minimumAccessibleEntrances != null ? p.minimumAccessibleEntrances : currentValues.minimumAccessibleEntrances
    };
}

module.exports = {
    PRESETS,
    getAll,
    getById,
    applyPreset
};
