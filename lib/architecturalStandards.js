/**
 * Architectural Standards Configuration
 * Defines the minimum requirements for architectural elements, such as room sizes
 * and corridor widths. This configuration is used by the ArchitecturalValidator
 * to ensure compliance with building codes and best practices.
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
        width: 36, // inches
    },
    egressMinimums: {
        doorWidth: 32, // inches
    },
};

module.exports = standards;
