/**
 * Architectural Validator - COSTO V1
 * Enforces architectural rules and best practices on a floor plan. This module
 * combines rule-based logic to validate room sizes, corridor widths,
 * egress paths, dead-ends, and travel distances.
 */
const architecturalStandards = require('./architecturalStandards');

class ArchitecturalValidator {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.options = options;
        this.ilots = floorPlan.ilots || [];
        this.corridors = floorPlan.corridors || [];
        this.entrances = floorPlan.entrances || [];
    }

    /**
     * Run all validation checks and return a comprehensive report.
     */
    validate() {
        const roomIssues = this.validateRooms();
        const corridorIssues = this.validateCorridors();
        const egressIssues = this.validateEgressPaths();
        const deadEndIssues = this.validateDeadEnds();
        const travelDistanceIssues = this.validateTravelDistances();
        const ilotPlacementIssues = this.validateIlotPlacement();

        const allIssues = [
            ...roomIssues,
            ...corridorIssues,
            ...egressIssues,
            ...deadEndIssues,
            ...travelDistanceIssues,
            ...ilotPlacementIssues
        ];

        // Categorize issues
        const errors = allIssues.filter(i => i.severity === 'error');
        const warnings = allIssues.filter(i => i.severity === 'warning');

        return {
            isValid: errors.length === 0,
            issues: allIssues,
            summary: {
                totalIssues: allIssues.length,
                errors: errors.length,
                warnings: warnings.length,
                categories: {
                    rooms: roomIssues.length,
                    corridors: corridorIssues.length,
                    egress: egressIssues.length,
                    deadEnds: deadEndIssues.length,
                    travelDistance: travelDistanceIssues.length,
                    ilotPlacement: ilotPlacementIssues.length
                }
            }
        };
    }

    /**
     * Validate room sizes and dimensions based on their type.
     */
    validateRooms() {
        const issues = [];
        const rooms = this.floorPlan.rooms || [];
        const standards = architecturalStandards.roomMinimums;

        for (const room of rooms) {
            const roomType = room.type || 'office';
            const standard = standards[roomType];

            if (standard) {
                const roomArea = room.area || 0;
                const roomWidth = room.bounds ? (room.bounds.maxX - room.bounds.minX) : 0;
                const roomHeight = room.bounds ? (room.bounds.maxY - room.bounds.minY) : 0;

                if (roomArea < standard.area) {
                    issues.push({
                        type: 'room-area',
                        severity: 'error',
                        message: `Room '${room.id}' (${roomType}) has area ${roomArea.toFixed(2)} sq ft, minimum is ${standard.area} sq ft.`,
                        element: room.id,
                        actual: roomArea,
                        required: standard.area
                    });
                }

                if (Math.min(roomWidth, roomHeight) < standard.minWidth) {
                    issues.push({
                        type: 'room-dimension',
                        severity: 'warning',
                        message: `Room '${room.id}' (${roomType}) has min dimension ${Math.min(roomWidth, roomHeight).toFixed(2)} ft, minimum is ${standard.minWidth} ft.`,
                        element: room.id,
                        actual: Math.min(roomWidth, roomHeight),
                        required: standard.minWidth
                    });
                }
            }
        }

        return issues;
    }

    /**
     * Validate corridor widths and accessibility.
     */
    validateCorridors() {
        const issues = [];
        const corridors = this.corridors;
        const minWidth = architecturalStandards.corridorRules?.minCorridorWidth || 1.2;

        for (let i = 0; i < corridors.length; i++) {
            const corridor = corridors[i];
            const corridorWidth = Math.min(corridor.width || 0, corridor.height || 0);

            if (corridorWidth < minWidth) {
                issues.push({
                    type: 'corridor-width',
                    severity: 'error',
                    message: `Corridor ${i + 1} has width ${corridorWidth.toFixed(2)}m, minimum is ${minWidth}m.`,
                    element: `corridor-${i}`,
                    actual: corridorWidth,
                    required: minWidth
                });
            }
        }

        return issues;
    }

    /**
     * Validate egress paths for safety and compliance.
     */
    validateEgressPaths() {
        const issues = [];
        const entrances = this.entrances;
        const minWidth = architecturalStandards.egressMinimums?.doorWidthMeters || 0.9;

        if (entrances.length === 0) {
            issues.push({
                type: 'egress-missing',
                severity: 'error',
                message: 'No exits/entrances detected. At least one exit is required.',
                element: 'floor-plan',
                actual: 0,
                required: 1
            });
        } else if (entrances.length === 1) {
            issues.push({
                type: 'egress-single',
                severity: 'warning',
                message: 'Only one exit detected. Consider adding a second exit for safety.',
                element: 'floor-plan',
                actual: 1,
                required: 2
            });
        }

        for (let i = 0; i < entrances.length; i++) {
            const entrance = entrances[i];
            let entranceWidth = entrance.width;

            // Calculate width from start/end if not provided
            if (!entranceWidth && entrance.start && entrance.end) {
                const dx = (entrance.end.x || 0) - (entrance.start.x || 0);
                const dy = (entrance.end.y || 0) - (entrance.start.y || 0);
                entranceWidth = Math.sqrt(dx * dx + dy * dy);
            }

            if (entranceWidth && entranceWidth < minWidth) {
                issues.push({
                    type: 'egress-width',
                    severity: 'error',
                    message: `Exit ${i + 1} has width ${entranceWidth.toFixed(2)}m, minimum is ${minWidth}m.`,
                    element: `entrance-${i}`,
                    actual: entranceWidth,
                    required: minWidth
                });
            }
        }

        return issues;
    }

    /**
     * COSTO V1: Validate corridor dead-ends
     * Dead-end corridors should not exceed max length
     */
    validateDeadEnds() {
        const issues = [];
        const corridors = this.corridors;
        const maxDeadEndLength = architecturalStandards.corridorRules?.maxDeadEndLength || 6.0;

        if (corridors.length === 0) return issues;

        // Build adjacency to detect dead-ends
        for (let i = 0; i < corridors.length; i++) {
            const corridor = corridors[i];
            const length = Math.max(corridor.width || 0, corridor.height || 0);

            // Check if this corridor connects to exits
            const connectsToExit = this._corridorConnectsToExit(corridor);
            const connectsToOtherCorridors = this._countCorridorConnections(corridor, corridors) > 1;

            // A dead-end is a corridor that doesn't connect to exits directly 
            // and only connects to one other corridor
            if (!connectsToExit && !connectsToOtherCorridors && length > maxDeadEndLength) {
                issues.push({
                    type: 'dead-end',
                    severity: 'error',
                    message: `Dead-end corridor ${i + 1} is ${length.toFixed(2)}m long, max is ${maxDeadEndLength}m.`,
                    element: `corridor-${i}`,
                    actual: length,
                    required: maxDeadEndLength
                });
            }
        }

        return issues;
    }

    /**
     * COSTO V1: Validate max travel distance to nearest exit
     */
    validateTravelDistances() {
        const issues = [];
        const ilots = this.ilots;
        const entrances = this.entrances;
        const maxDistance = architecturalStandards.corridorRules?.maxTravelDistance || 30.0;
        const warningDistance = architecturalStandards.corridorRules?.warningTravelDistance || 25.0;

        if (entrances.length === 0) return issues;

        for (let i = 0; i < ilots.length; i++) {
            const ilot = ilots[i];
            const ilotCenter = {
                x: (ilot.x || 0) + (ilot.width || 0) / 2,
                y: (ilot.y || 0) + (ilot.height || 0) / 2
            };

            // Find distance to nearest exit
            let minDistanceToExit = Infinity;
            for (const entrance of entrances) {
                const exitCenter = this._getEntranceCenter(entrance);
                const distance = this._distance(ilotCenter, exitCenter);
                minDistanceToExit = Math.min(minDistanceToExit, distance);
            }

            if (minDistanceToExit > maxDistance) {
                issues.push({
                    type: 'travel-distance',
                    severity: 'error',
                    message: `Ilot ${ilot.id || i + 1} is ${minDistanceToExit.toFixed(2)}m from nearest exit, max is ${maxDistance}m.`,
                    element: ilot.id || `ilot-${i}`,
                    actual: minDistanceToExit,
                    required: maxDistance
                });
            } else if (minDistanceToExit > warningDistance) {
                issues.push({
                    type: 'travel-distance',
                    severity: 'warning',
                    message: `Ilot ${ilot.id || i + 1} is ${minDistanceToExit.toFixed(2)}m from nearest exit (warning threshold: ${warningDistance}m).`,
                    element: ilot.id || `ilot-${i}`,
                    actual: minDistanceToExit,
                    required: warningDistance
                });
            }
        }

        return issues;
    }

    /**
     * COSTO V1: Validate ilot placement rules
     */
    validateIlotPlacement() {
        const issues = [];
        const ilots = this.ilots;
        const entrances = this.entrances;
        const rules = architecturalStandards.ilotRules || {};
        const minDistanceFromExit = rules.minDistanceFromExit || 1.0;
        const minSpacing = rules.minSpacingBetweenIlots || 0.5;
        const maxArea = rules.maxIlotArea || 50.0;
        const minArea = rules.minIlotArea || 2.0;

        for (let i = 0; i < ilots.length; i++) {
            const ilot = ilots[i];
            const area = ilot.area || (ilot.width * ilot.height) || 0;

            // Check area bounds
            if (area > maxArea) {
                issues.push({
                    type: 'ilot-area',
                    severity: 'warning',
                    message: `Ilot ${ilot.id || i + 1} has area ${area.toFixed(2)}m², max is ${maxArea}m².`,
                    element: ilot.id || `ilot-${i}`,
                    actual: area,
                    required: maxArea
                });
            }
            if (area < minArea && area > 0) {
                issues.push({
                    type: 'ilot-area',
                    severity: 'warning',
                    message: `Ilot ${ilot.id || i + 1} has area ${area.toFixed(2)}m², min is ${minArea}m².`,
                    element: ilot.id || `ilot-${i}`,
                    actual: area,
                    required: minArea
                });
            }

            // Check distance from exits
            for (let j = 0; j < entrances.length; j++) {
                const entrance = entrances[j];
                const exitCenter = this._getEntranceCenter(entrance);
                const ilotBox = this._getIlotBox(ilot);
                const distanceToExit = this._distanceBoxToPoint(ilotBox, exitCenter);

                if (distanceToExit < minDistanceFromExit) {
                    issues.push({
                        type: 'ilot-exit-clearance',
                        severity: 'error',
                        message: `Ilot ${ilot.id || i + 1} is ${distanceToExit.toFixed(2)}m from exit ${j + 1}, min clearance is ${minDistanceFromExit}m.`,
                        element: ilot.id || `ilot-${i}`,
                        actual: distanceToExit,
                        required: minDistanceFromExit
                    });
                }
            }

            // Check spacing between ilots
            for (let j = i + 1; j < ilots.length; j++) {
                const other = ilots[j];
                const distance = this._distanceBoxToBox(this._getIlotBox(ilot), this._getIlotBox(other));

                if (distance < minSpacing && distance >= 0) {
                    issues.push({
                        type: 'ilot-spacing',
                        severity: 'warning',
                        message: `Ilots ${ilot.id || i + 1} and ${other.id || j + 1} are ${distance.toFixed(2)}m apart, min spacing is ${minSpacing}m.`,
                        element: `${ilot.id || `ilot-${i}`},${other.id || `ilot-${j}`}`,
                        actual: distance,
                        required: minSpacing
                    });
                }
            }
        }

        return issues;
    }

    // Helper methods
    _getEntranceCenter(entrance) {
        if (entrance.x !== undefined && entrance.y !== undefined) {
            return { x: entrance.x, y: entrance.y };
        }
        if (entrance.start && entrance.end) {
            return {
                x: ((entrance.start.x || 0) + (entrance.end.x || 0)) / 2,
                y: ((entrance.start.y || 0) + (entrance.end.y || 0)) / 2
            };
        }
        return { x: 0, y: 0 };
    }

    _getIlotBox(ilot) {
        return {
            minX: ilot.x || 0,
            minY: ilot.y || 0,
            maxX: (ilot.x || 0) + (ilot.width || 0),
            maxY: (ilot.y || 0) + (ilot.height || 0)
        };
    }

    _distance(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }

    _distanceBoxToPoint(box, point) {
        const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX);
        const dy = Math.max(box.minY - point.y, 0, point.y - box.maxY);
        return Math.sqrt(dx * dx + dy * dy);
    }

    _distanceBoxToBox(box1, box2) {
        const dx = Math.max(box1.minX - box2.maxX, box2.minX - box1.maxX, 0);
        const dy = Math.max(box1.minY - box2.maxY, box2.minY - box1.maxY, 0);
        return Math.sqrt(dx * dx + dy * dy);
    }

    _corridorConnectsToExit(corridor) {
        const cBox = {
            minX: corridor.x || 0,
            minY: corridor.y || 0,
            maxX: (corridor.x || 0) + (corridor.width || 0),
            maxY: (corridor.y || 0) + (corridor.height || 0)
        };

        for (const entrance of this.entrances) {
            const exitCenter = this._getEntranceCenter(entrance);
            if (this._distanceBoxToPoint(cBox, exitCenter) < 2.0) {
                return true;
            }
        }
        return false;
    }

    _countCorridorConnections(corridor, allCorridors) {
        const cBox = {
            minX: corridor.x || 0,
            minY: corridor.y || 0,
            maxX: (corridor.x || 0) + (corridor.width || 0),
            maxY: (corridor.y || 0) + (corridor.height || 0)
        };

        let connections = 0;
        for (const other of allCorridors) {
            if (other === corridor) continue;
            const oBox = {
                minX: other.x || 0,
                minY: other.y || 0,
                maxX: (other.x || 0) + (other.width || 0),
                maxY: (other.y || 0) + (other.height || 0)
            };

            // Check if corridors touch or overlap
            const distance = this._distanceBoxToBox(cBox, oBox);
            if (distance < 0.5) {
                connections++;
            }
        }
        return connections;
    }
}

module.exports = ArchitecturalValidator;
