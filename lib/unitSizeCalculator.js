/**
 * Shared Unit Size Calculator
 * Ensures consistent unit size label calculation across frontend and backend
 */

class UnitSizeCalculator {
    // Standard sizes matching reference: 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25
    static STANDARD_SIZES = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25];

    /**
     * Calculate unit size label from area
     * @param {number} area - Area in m²
     * @returns {number} - Unit size label
     */
    static calculateUnitSizeLabel(area) {
        if (!Number.isFinite(area) || area <= 0) {
            return 0.5; // Default to smallest size
        }

        // Find closest standard size
        let closest = this.STANDARD_SIZES[0];
        let minDiff = Math.abs(area - closest);

        for (const size of this.STANDARD_SIZES) {
            const diff = Math.abs(area - size);
            if (diff < minDiff) {
                minDiff = diff;
                closest = size;
            }
        }

        // If area is significantly larger, use the actual value rounded
        if (area > 25) {
            return Math.round(area * 2) / 2; // Round to nearest 0.5
        }

        return closest;
    }

    /**
     * Get unit group from size label
     * @param {number|string} sizeLabel - Unit size label
     * @returns {string} - Group identifier (A, B, C, D, E, F)
     */
    static getUnitGroup(sizeLabel) {
        const size = typeof sizeLabel === 'string' ? parseFloat(sizeLabel) : sizeLabel;
        if (size <= 1) return 'A';
        if (size <= 2) return 'B';
        if (size <= 5) return 'C';
        if (size <= 10) return 'D';
        if (size <= 15) return 'E';
        return 'F';
    }
}

module.exports = UnitSizeCalculator;
