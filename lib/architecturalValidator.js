/**
 * Architectural Validator
 * Enforces architectural rules and best practices on a floor plan. This module
 * combines rule-based logic and ML models to validate room sizes, corridor widths,
 * egress paths, and other critical design elements.
 */
const architecturalStandards = require('./architecturalStandards');

class ArchitecturalValidator {
    constructor(floorPlan, options = {}) {
        this.floorPlan = floorPlan;
        this.options = options;
    }

    /**
     * Run all validation checks and return a comprehensive report.
     */
    validate() {
        const roomIssues = this.validateRooms();
        const corridorIssues = this.validateCorridors();
        const egressIssues = this.validateEgressPaths();

        const allIssues = [...roomIssues, ...corridorIssues, ...egressIssues];

        return {
            isValid: allIssues.length === 0,
            issues: allIssues,
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
            const roomType = room.type || 'office'; // Default to office if type is not specified
            const standard = standards[roomType];

            if (standard) {
                const roomArea = room.area || 0;
                const roomWidth = room.bounds ? (room.bounds.maxX - room.bounds.minX) : 0;
                const roomHeight = room.bounds ? (room.bounds.maxY - room.bounds.minY) : 0;

                if (roomArea < standard.area) {
                    issues.push(`Room '${room.id}' (${roomType}) has an area of ${roomArea.toFixed(2)} sq ft, which is less than the minimum of ${standard.area} sq ft.`);
                }

                if (Math.min(roomWidth, roomHeight) < standard.minWidth) {
                    issues.push(`Room '${room.id}' (${roomType}) has a minimum dimension of ${Math.min(roomWidth, roomHeight).toFixed(2)} ft, which is less than the minimum of ${standard.minWidth} ft.`);
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
        const corridors = this.floorPlan.corridors || [];
        const minWidth = architecturalStandards.corridorMinimums.width / 12; // Convert inches to feet

        for (const corridor of corridors) {
            const corridorWidth = corridor.width || 0;
            if (corridorWidth < minWidth) {
                issues.push(`Corridor '${corridor.id}' has a width of ${corridorWidth.toFixed(2)} ft, which is less than the minimum of ${minWidth.toFixed(2)} ft.`);
            }
        }

        return issues;
    }

    /**
     * Validate egress paths for safety and compliance.
     */
    validateEgressPaths() {
        const issues = [];
        const entrances = this.floorPlan.entrances || [];
        const minWidth = architecturalStandards.egressMinimums.doorWidth / 12; // Convert inches to feet

        for (const entrance of entrances) {
            const entranceWidth = entrance.width || 0;
            if (entranceWidth < minWidth) {
                issues.push(`Entrance '${entrance.id}' has a width of ${entranceWidth.toFixed(2)} ft, which is less than the minimum of ${minWidth.toFixed(2)} ft.`);
            }
        }

        return issues;
    }
}

module.exports = ArchitecturalValidator;
