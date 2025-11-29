/**
 * AutoCAD Standards Configuration
 * Defines the professional standards for CAD entities, including layer names,
 * colors, and line types. This configuration is used by the ML-powered
 * validation system to ensure compliance with architectural best practices.
 */

const standards = {
    walls: {
        layer: /^(A-WALL|WALLS|MUR)$/i,
        color: [0, 0, 0], // Black
        lineType: /^(Continuous|SOLID)$/i,
    },
    entrances: {
        layer: /^(A-DOOR|ENTRANCES|ENTREE__SORTIE)$/i,
        color: [255, 0, 0], // Red
        lineType: /^(Hidden|DASHED)$/i,
    },
    forbiddenZones: {
        layer: /^(A-FLOR-FBDN|FORBIDDEN|NO_ENTREE)$/i,
        color: [0, 0, 255], // Blue
        lineType: /^(Phantom|DOTTED)$/i,
    },
    windows: {
        layer: /^(A-GLAZ|WINDOWS|FENETRE)$/i,
        color: [0, 255, 255], // Cyan
        lineType: /^(Continuous|SOLID)$/i,
    },
    columns: {
        layer: /^(A-COLS|COLUMNS|POTEAU)$/i,
        color: [255, 255, 0], // Yellow
        lineType: /^(Continuous|SOLID)$/i,
    },
};

module.exports = standards;
