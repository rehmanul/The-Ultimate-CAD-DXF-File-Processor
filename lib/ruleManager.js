class RuleManager {
    constructor(config = {}) {
        this.config = Object.assign({
            minCorridorWidth: 1.0,
            maxExitDistance: 50.0,
            roundingPrecision: 0.1,
            unitRounding: 0.05,
            fireSafetyClearance: 1.5
        }, config);
    }

    validateLayout(layout) {
        const issues = [];
        const { corridors, boxes, exits } = layout;

        // Check corridor widths
        if (corridors) {
            corridors.forEach(corridor => {
                if (corridor.width < this.config.minCorridorWidth) {
                    issues.push({
                        type: 'violation',
                        rule: 'minCorridorWidth',
                        elementId: corridor.id,
                        message: `Corridor width ${corridor.width} is less than minimum ${this.config.minCorridorWidth}`
                    });
                }
            });
        }

        // Additional checks can be added here
        // e.g., max distance to exit for each box

        return issues;
    }

    setConfig(newConfig) {
        this.config = Object.assign(this.config, newConfig);
    }

    getConfig() {
        return { ...this.config };
    }
}

module.exports = RuleManager;
