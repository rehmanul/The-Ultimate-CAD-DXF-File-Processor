/**
 * Annotation and Correction System
 * Analyzes validation issues and generates suggestions for corrections. This
 * module uses a combination of rule-based logic and ML models to propose
 * intelligent fixes for design flaws, such as resizing rooms, adjusting
 * corridor widths, and re-coloring entities to meet standards.
 */

class AnnotationAndCorrection {
    constructor(floorPlan, issues) {
        this.floorPlan = floorPlan;
        this.issues = issues;
    }

    /**
     * Generate a list of suggestions for correcting the identified issues.
     */
    generateSuggestions() {
        const suggestions = [];
        for (const issue of this.issues) {
            const suggestion = this.generateSuggestion(issue);
            if (suggestion) {
                suggestions.push(suggestion);
            }
        }
        return suggestions;
    }

    /**
     * Generate a single suggestion for a given issue.
     */
    generateSuggestion(issue) {
        // Robust handling for issue types (string vs object)
        const issueText = (typeof issue === 'string')
            ? issue
            : (issue.message || (typeof issue === 'object' ? JSON.stringify(issue) : String(issue)));

        if (!issueText) return null;

        if (issueText.includes('area')) {
            return this.suggestRoomResize(issueText);
        }
        if (issueText.includes('dimension')) {
            return this.suggestRoomResize(issueText);
        }
        if (issueText.includes('width')) {
            return this.suggestWidthAdjustment(issueText);
        }
        if (issueText.includes('color')) {
            return this.suggestRecolor(issueText);
        }
        if (issueText.includes('layer')) {
            return this.suggestRelayer(issueText);
        }
        return null;
    }

    suggestRoomResize(issue) {
        const roomIdMatch = issue.match(/Room '([^']+)'/);
        const areaMatch = issue.match(/area of ([\d.]+) sq ft, which is less than the minimum of ([\d.]+) sq ft/);
        const dimMatch = issue.match(/minimum dimension of ([\d.]+) ft, which is less than the minimum of ([\d.]+) ft/);

        if (!roomIdMatch) {
            return {
                type: 'resize',
                message: `Consider resizing the room to meet the minimum area and dimension requirements.`,
                details: issue,
            };
        }

        const roomId = roomIdMatch[1];
        const room = this.floorPlan.rooms.find(r => r.id === roomId);
        if (!room) return null;

        let suggestion = `For room '${roomId}', consider resizing to meet standards.`;
        const actions = [];

        if (areaMatch) {
            const currentArea = parseFloat(areaMatch[1]);
            const requiredArea = parseFloat(areaMatch[2]);
            const scaleFactor = Math.sqrt(requiredArea / currentArea);
            suggestion += ` Current area is ${currentArea.toFixed(2)} sq ft, requires ${requiredArea} sq ft.`;
            actions.push({
                action: 'scale',
                factor: scaleFactor,
                description: `Scale room by a factor of ${scaleFactor.toFixed(2)} to meet area requirement.`
            });
        }

        if (dimMatch) {
            const currentDim = parseFloat(dimMatch[1]);
            const requiredDim = parseFloat(dimMatch[2]);
            suggestion += ` Minimum dimension is ${currentDim.toFixed(2)} ft, requires ${requiredDim} ft.`;
            actions.push({
                action: 'adjust-dimension',
                requiredDimension: requiredDim,
                description: `Ensure the shorter side of the room is at least ${requiredDim} ft.`
            });
        }

        return {
            type: 'resize-room',
            message: suggestion,
            details: issue,
            roomId: roomId,
            suggestedActions: actions,
        };
    }

    suggestWidthAdjustment(issue) {
        const idMatch = issue.match(/'([^']+)'/);
        const widthMatch = issue.match(/width of ([\d.]+) ft, which is less than the minimum of ([\d.]+) ft/);

        if (!idMatch || !widthMatch) {
            return {
                type: 'adjust-width',
                message: `Consider adjusting the width to meet the minimum requirement.`,
                details: issue,
            };
        }

        const entityId = idMatch[1];
        const currentWidth = parseFloat(widthMatch[1]);
        const requiredWidth = parseFloat(widthMatch[2]);

        return {
            type: 'adjust-width',
            message: `For entity '${entityId}', increase width from ${currentWidth.toFixed(2)} ft to at least ${requiredWidth} ft.`,
            details: issue,
            entityId: entityId,
            suggestedActions: [{
                action: 'set-width',
                newWidth: requiredWidth,
                description: `Set width to ${requiredWidth} ft.`
            }],
        };
    }

    suggestRecolor(issue) {
        const colorMatch = issue.match(/Color \[([\d,]+)\] does not match standard: \[([\d,]+)\]/);
        if (!colorMatch) {
            return {
                type: 'recolor',
                message: `Consider changing the color to match the standard.`,
                details: issue,
            };
        }

        const currentColor = colorMatch[1].split(',').map(Number);
        const requiredColor = colorMatch[2].split(',').map(Number);

        return {
            type: 'recolor',
            message: `Incorrect color used. Suggest changing from [${currentColor.join(',')}] to [${requiredColor.join(',')}].`,
            details: issue,
            suggestedActions: [{
                action: 'set-color',
                newColor: requiredColor,
                description: `Set color to [${requiredColor.join(',')}].`
            }],
        };
    }

    suggestRelayer(issue) {
        const layerMatch = issue.match(/Layer name '([^']+)' does not match standard: (.+)/);
        if (!layerMatch) {
            return {
                type: 'relayer',
                message: `Consider moving the entity to the correct layer.`,
                details: issue,
            };
        }

        const currentLayer = layerMatch[1];
        const requiredLayer = layerMatch[2];

        return {
            type: 'relayer',
            message: `Incorrect layer used. Suggest moving from layer '${currentLayer}' to a layer matching ${requiredLayer}.`,
            details: issue,
            suggestedActions: [{
                action: 'set-layer',
                newLayer: requiredLayer,
                description: `Move entity to a layer that matches the standard, e.g., ${requiredLayer}.`
            }],
        };
    }
}

module.exports = AnnotationAndCorrection;
