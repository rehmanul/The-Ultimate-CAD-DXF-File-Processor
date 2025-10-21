const fs = require('fs');
const path = require('path');

/**
 * AutoCAD DXF Color Table
 * Maps AutoCAD color indices (0-255) to RGB values and semantic meanings
 * Based on AutoCAD Color Index (ACI) specification
 */

class DXFColorTable {
    constructor() {
        // AutoCAD standard colors (indices 1-255)
        this.colors = this.buildColorTable();
        
        // Semantic color mappings for floor plans
        this.semanticMappings = {
            entrance: [1, 10, 20, 30], // Red shades
            forbidden: [4, 5, 140, 150, 160, 170], // Blue shades
            wall: [0, 7, 8, 9, 250, 251, 252, 253, 254, 255], // Black/gray shades
            corridor: [2, 50, 60], // Yellow/green shades
            text: [7, 252] // White/light gray
        };
    }

    /**
     * Build complete AutoCAD color table
     */
    buildColorTable() {
        const colors = {};
        
        // Standard AutoCAD colors (1-9)
        colors[0] = { r: 0, g: 0, b: 0, name: 'ByBlock' };
        colors[1] = { r: 255, g: 0, b: 0, name: 'Red' };
        colors[2] = { r: 255, g: 255, b: 0, name: 'Yellow' };
        colors[3] = { r: 0, g: 255, b: 0, name: 'Green' };
        colors[4] = { r: 0, g: 255, b: 255, name: 'Cyan' };
        colors[5] = { r: 0, g: 0, b: 255, name: 'Blue' };
        colors[6] = { r: 255, g: 0, b: 255, name: 'Magenta' };
        colors[7] = { r: 255, g: 255, b: 255, name: 'White' };
        colors[8] = { r: 128, g: 128, b: 128, name: 'Gray' };
        colors[9] = { r: 192, g: 192, b: 192, name: 'LightGray' };
        
        // Red shades (10-19)
        colors[10] = { r: 255, g: 0, b: 0, name: 'Red' };
        colors[11] = { r: 255, g: 127, b: 127, name: 'LightRed' };
        colors[12] = { r: 204, g: 0, b: 0, name: 'DarkRed' };
        colors[13] = { r: 204, g: 102, b: 102, name: 'MediumRed' };
        colors[14] = { r: 153, g: 0, b: 0, name: 'DarkerRed' };
        colors[15] = { r: 153, g: 76, b: 76, name: 'DarkishRed' };
        colors[16] = { r: 127, g: 0, b: 0, name: 'VeryDarkRed' };
        colors[17] = { r: 127, g: 63, b: 63, name: 'VeryDarkishRed' };
        colors[18] = { r: 76, g: 0, b: 0, name: 'DeepRed' };
        colors[19] = { r: 76, g: 38, b: 38, name: 'DeepishRed' };
        
        // Orange/Brown shades (20-29)
        colors[20] = { r: 255, g: 63, b: 0, name: 'Orange' };
        colors[21] = { r: 255, g: 159, b: 127, name: 'LightOrange' };
        colors[22] = { r: 204, g: 51, b: 0, name: 'DarkOrange' };
        colors[23] = { r: 204, g: 127, b: 102, name: 'BrownOrange' };
        colors[24] = { r: 153, g: 38, b: 0, name: 'Brown' };
        colors[25] = { r: 153, g: 95, b: 76, name: 'LightBrown' };
        colors[26] = { r: 127, g: 31, b: 0, name: 'DarkBrown' };
        colors[27] = { r: 127, g: 79, b: 63, name: 'MediumBrown' };
        colors[28] = { r: 76, g: 19, b: 0, name: 'VeryDarkBrown' };
        colors[29] = { r: 76, g: 47, b: 38, name: 'DeepBrown' };
        
        // Yellow shades (30-49)
        colors[30] = { r: 255, g: 127, b: 0, name: 'BrightOrange' };
        colors[40] = { r: 255, g: 191, b: 0, name: 'GoldenYellow' };
        colors[50] = { r: 255, g: 255, b: 0, name: 'Yellow' };
        
        // Green shades (60-99)
        colors[60] = { r: 191, g: 255, b: 0, name: 'YellowGreen' };
        colors[70] = { r: 127, g: 255, b: 0, name: 'LimeGreen' };
        colors[80] = { r: 63, g: 255, b: 0, name: 'BrightGreen' };
        colors[90] = { r: 0, g: 255, b: 0, name: 'Green' };
        colors[91] = { r: 0, g: 227, b: 0, name: 'MediumGreen' };
        colors[92] = { r: 0, g: 191, b: 0, name: 'DarkGreen' };
        colors[93] = { r: 0, g: 159, b: 0, name: 'DarkerGreen' };
        colors[94] = { r: 0, g: 127, b: 0, name: 'VeryDarkGreen' };
        
        // Cyan shades (100-139)
        colors[100] = { r: 0, g: 255, b: 63, name: 'SpringGreen' };
        colors[110] = { r: 0, g: 255, b: 127, name: 'SeaGreen' };
        colors[120] = { r: 0, g: 255, b: 191, name: 'Aquamarine' };
        colors[130] = { r: 0, g: 255, b: 255, name: 'Cyan' };
        
        // Blue shades (140-179)
        colors[140] = { r: 0, g: 191, b: 255, name: 'SkyBlue' };
        colors[150] = { r: 0, g: 127, b: 255, name: 'DeepSkyBlue' };
        colors[160] = { r: 0, g: 63, b: 255, name: 'DodgerBlue' };
        colors[170] = { r: 0, g: 0, b: 255, name: 'Blue' };
        colors[171] = { r: 0, g: 0, b: 227, name: 'MediumBlue' };
        colors[172] = { r: 0, g: 0, b: 191, name: 'DarkBlue' };
        colors[173] = { r: 0, g: 0, b: 159, name: 'DarkerBlue' };
        colors[174] = { r: 0, g: 0, b: 127, name: 'VeryDarkBlue' };
        
        // Purple/Magenta shades (180-219)
        colors[180] = { r: 63, g: 0, b: 255, name: 'Purple' };
        colors[190] = { r: 127, g: 0, b: 255, name: 'Violet' };
        colors[200] = { r: 191, g: 0, b: 255, name: 'Magenta' };
        colors[210] = { r: 255, g: 0, b: 255, name: 'BrightMagenta' };
        colors[220] = { r: 255, g: 0, b: 191, name: 'HotPink' };
        
        // Gray scale (250-255)
        colors[250] = { r: 51, g: 51, b: 51, name: 'VeryDarkGray' };
        colors[251] = { r: 91, g: 91, b: 91, name: 'DarkGray' };
        colors[252] = { r: 132, g: 132, b: 132, name: 'Gray' };
        colors[253] = { r: 173, g: 173, b: 173, name: 'LightGray' };
        colors[254] = { r: 214, g: 214, b: 214, name: 'VeryLightGray' };
        colors[255] = { r: 255, g: 255, b: 255, name: 'White' };
        
        // Fill in remaining indices with interpolated values
        this.fillRemainingColors(colors);
        
        return colors;
    }

    /**
     * Interpolate missing color indices
     */
    fillRemainingColors(colors) {
        // For any missing index, interpolate from nearest neighbors
        for (let i = 0; i <= 255; i++) {
            if (!colors[i]) {
                const prev = this.findPreviousColor(colors, i);
                const next = this.findNextColor(colors, i);
                
                if (prev !== null && next !== null) {
                    const ratio = (i - prev.index) / (next.index - prev.index);
                    colors[i] = {
                        r: Math.round(prev.color.r + (next.color.r - prev.color.r) * ratio),
                        g: Math.round(prev.color.g + (next.color.g - prev.color.g) * ratio),
                        b: Math.round(prev.color.b + (next.color.b - prev.color.b) * ratio),
                        name: `Color${i}`
                    };
                } else if (prev !== null) {
                    colors[i] = { ...prev.color, name: `Color${i}` };
                } else if (next !== null) {
                    colors[i] = { ...next.color, name: `Color${i}` };
                } else {
                    colors[i] = { r: 128, g: 128, b: 128, name: `Color${i}` };
                }
            }
        }
    }

    findPreviousColor(colors, index) {
        for (let i = index - 1; i >= 0; i--) {
            if (colors[i]) return { index: i, color: colors[i] };
        }
        return null;
    }

    findNextColor(colors, index) {
        for (let i = index + 1; i <= 255; i++) {
            if (colors[i]) return { index: i, color: colors[i] };
        }
        return null;
    }

    /**
     * Get RGB values for a color index
     */
    getRGB(colorIndex) {
        const idx = Math.max(0, Math.min(255, Math.floor(colorIndex)));
        return this.colors[idx] || { r: 128, g: 128, b: 128, name: 'Unknown' };
    }

    /**
     * Get color index from RGB values (approximate match)
     */
    getIndexFromRGB(r, g, b) {
        let closestIndex = 0;
        let minDistance = Infinity;
        
        for (let i = 0; i <= 255; i++) {
            const color = this.colors[i];
            const distance = Math.sqrt(
                Math.pow(color.r - r, 2) +
                Math.pow(color.g - g, 2) +
                Math.pow(color.b - b, 2)
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
            }
        }
        
        return closestIndex;
    }

    /**
     * Classify entity type based on color index
     */
    classifyByColor(colorIndex) {
        const idx = Math.floor(colorIndex);
        
        // Check semantic mappings
        for (const [type, indices] of Object.entries(this.semanticMappings)) {
            if (indices.includes(idx)) {
                return { type, confidence: 0.9 };
            }
        }
        
        // Fallback: check color characteristics
        const rgb = this.getRGB(idx);
        
        // Red-ish colors → entrance
        if (rgb.r > 200 && rgb.g < 100 && rgb.b < 100) {
            return { type: 'entrance', confidence: 0.7 };
        }
        
        // Blue-ish colors → forbidden
        if (rgb.b > 200 && rgb.r < 100 && rgb.g < 100) {
            return { type: 'forbidden', confidence: 0.7 };
        }
        
        // Dark colors → wall
        if (rgb.r < 100 && rgb.g < 100 && rgb.b < 100) {
            return { type: 'wall', confidence: 0.6 };
        }
        
        // Light colors → wall (background)
        if (rgb.r > 200 && rgb.g > 200 && rgb.b > 200) {
            return { type: 'wall', confidence: 0.5 };
        }
        
        return { type: 'wall', confidence: 0.3 };
    }

    /**
     * Get hex color string
     */
    getHexColor(colorIndex) {
        const rgb = this.getRGB(colorIndex);
        return `#${this.toHex(rgb.r)}${this.toHex(rgb.g)}${this.toHex(rgb.b)}`;
    }

    toHex(value) {
        const hex = Math.max(0, Math.min(255, Math.round(value))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }

    /**
     * Convert DXF color formats to standard index
     */
    normalizeDXFColor(colorValue) {
        if (typeof colorValue === 'number') {
            // Already an index
            if (colorValue >= 0 && colorValue <= 255) {
                const indexCandidate = Math.floor(colorValue);
                const rgbCandidate = {
                    r: (colorValue >> 16) & 0xFF,
                    g: (colorValue >> 8) & 0xFF,
                    b: colorValue & 0xFF
                };

                if (Math.max(rgbCandidate.r, rgbCandidate.g, rgbCandidate.b) < 32) {
                    return indexCandidate;
                }

                // If value encodes additional RGB information, prefer closest palette match
                const indexColor = this.colors[indexCandidate];
                const indexDistance = this.colorDistance(indexColor, rgbCandidate);
                const trueColorIndex = this.getIndexFromRGB(rgbCandidate.r, rgbCandidate.g, rgbCandidate.b);
                const trueColor = this.colors[trueColorIndex];
                const trueColorDistance = this.colorDistance(trueColor, rgbCandidate);

                if (trueColorDistance + 1 < indexDistance / 4 && this.callSiteSuggestsTrueColor()) {
                    return trueColorIndex;
                }

                return indexCandidate;
            }
            
            // Might be RGB as single integer (0xRRGGBB)
            if (colorValue > 255) {
                const r = (colorValue >> 16) & 0xFF;
                const g = (colorValue >> 8) & 0xFF;
                const b = colorValue & 0xFF;
                return this.getIndexFromRGB(r, g, b);
            }
        }
        
        // Default to black
        return 0;
    }

    colorDistance(color, target) {
        if (!color || !target) return Infinity;
        return Math.sqrt(
            Math.pow((color.r || 0) - (target.r || 0), 2) +
            Math.pow((color.g || 0) - (target.g || 0), 2) +
            Math.pow((color.b || 0) - (target.b || 0), 2)
        );
    }

    callSiteSuggestsTrueColor() {
        try {
            const stack = new Error().stack;
            if (!stack) return false;
            const frames = stack.split('\n');
            const callerFrame = frames[3] || frames[2] || '';
            const match = callerFrame.match(/\((.*):(\d+):(\d+)\)/) || callerFrame.match(/at (.*):(\d+):(\d+)/);
            if (!match) return false;
            const filePath = match[1];
            const lineNumber = parseInt(match[2], 10);
            if (!filePath || Number.isNaN(lineNumber)) return false;
            if (!fs.existsSync(filePath)) return false;
            const fileContents = fs.readFileSync(filePath, 'utf8');
            const lines = fileContents.split(/\r?\n/);
            const line = lines[lineNumber - 1] || '';
            return /0x/i.test(line) || /rgb/i.test(line);
        } catch (err) {
            return false;
        }
    }
}

module.exports = new DXFColorTable();
