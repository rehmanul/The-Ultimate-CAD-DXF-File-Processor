/**
 * Architectural Standards Configuration
 * Defines the minimum requirements for architectural elements, such as room sizes
 * and corridor widths. This configuration is used by the ArchitecturalValidator
 * to ensure compliance with building codes and best practices.
 * 
 * COSTO V1: Added corridor dead-end and travel distance limits
 */

const standards = {
    roomMinimums: {
        office: {
            area: 70, // square feet
            minWidth: 7, // feet
        },
        meeting: {
            area: 120, // square feet
            minWidth: 10, // feet
        },
        restroom: {
            area: 30, // square feet
            minWidth: 5, // feet
        },
        utility: {
            area: 20, // square feet
            minWidth: 4, // feet
        },
    },
    corridorMinimums: {
        width: 36, // inches (0.914 meters)
        widthMeters: 1.2, // meters - COSTO standard
    },
    egressMinimums: {
        doorWidth: 32, // inches (0.813 meters)
        doorWidthMeters: 0.9, // meters
    },
    // COSTO V1: Corridor and travel distance requirements
    corridorRules: {
        maxDeadEndLength: 6.0, // meters - max dead-end corridor length
        maxTravelDistance: 30.0, // meters - max distance to nearest exit
        maxDistanceBetweenExits: 45.0, // meters - max distance between two exits
        minCorridorWidth: 1.2, // meters
        warningTravelDistance: 25.0, // meters - warning threshold
    },
    // COSTO V1: Ilot placement requirements
    ilotRules: {
        minDistanceFromWall: 0.3, // meters
        minDistanceFromExit: 1.0, // meters - keep exits clear
        minSpacingBetweenIlots: 0.5, // meters
        maxIlotArea: 50.0, // square meters
        minIlotArea: 2.0, // square meters
    }
};

module.exports = standards;
