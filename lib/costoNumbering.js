/**
 * COSTO Automatic Numbering System - V1
 * Implements zone + row + number scheme for box numbering
 * Based on COSTO V1 specifications
 */

class CostoNumbering {
    constructor() {
        this.numberingSchemes = {
            default: {
                zonePrefix: 'Z',
                rowPrefix: 'R',
                separator: '-',
                padding: { zone: 2, row: 2, number: 3 }
            },
            compact: {
                zonePrefix: '',
                rowPrefix: '',
                separator: '',
                padding: { zone: 1, row: 1, number: 2 }
            },
            verbose: {
                zonePrefix: 'ZONE',
                rowPrefix: 'ROW',
                separator: '-',
                padding: { zone: 2, row: 2, number: 4 }
            }
        };
    }

    /**
     * Apply automatic numbering to boxes
     * @param {Array<Object>} boxes - Boxes to number
     * @param {Object} options - Numbering options
     * @returns {Array<Object>} - Boxes with assigned IDs
     */
    applyNumbering(boxes, options = {}) {
        const {
            scheme = 'default',
            startZone = 1,
            startRow = 1,
            startNumber = 1
        } = options;

        const numberingScheme = this.numberingSchemes[scheme] || this.numberingSchemes.default;

        // Group boxes by zone and row
        const grouped = this.groupBoxesByZoneAndRow(boxes);

        let currentNumber = startNumber;
        const numberedBoxes = [];

        // Sort zones
        const sortedZones = Object.keys(grouped).sort((a, b) => {
            const zoneA = parseInt(a.replace(/\D/g, '')) || 0;
            const zoneB = parseInt(b.replace(/\D/g, '')) || 0;
            return zoneA - zoneB;
        });

        sortedZones.forEach((zoneKey, zoneIndex) => {
            const zoneNumber = startZone + zoneIndex;
            const zoneBoxes = grouped[zoneKey];

            // Sort by row
            const sortedRows = Object.keys(zoneBoxes).sort((a, b) => {
                const rowA = parseInt(a.replace(/\D/g, '')) || 0;
                const rowB = parseInt(b.replace(/\D/g, '')) || 0;
                return rowA - rowB;
            });

            sortedRows.forEach((rowKey, rowIndex) => {
                const rowNumber = startRow + rowIndex;
                const rowBoxes = zoneBoxes[rowKey];

                // Sort boxes within row (by X coordinate, then Y)
                rowBoxes.sort((a, b) => {
                    if (Math.abs(a.x - b.x) > 0.1) return a.x - b.x;
                    return a.y - b.y;
                });

                rowBoxes.forEach((box, boxIndex) => {
                    const boxNumber = startNumber + currentNumber - 1;
                    box.id = this.generateID(
                        zoneNumber,
                        rowNumber,
                        boxNumber,
                        numberingScheme
                    );
                    box.zone = this.formatZone(zoneNumber, numberingScheme);
                    box.row = rowNumber;
                    box.number = boxNumber;
                    numberedBoxes.push(box);
                    currentNumber++;
                });
            });
        });

        return numberedBoxes;
    }

    /**
     * Group boxes by zone and row
     */
    groupBoxesByZoneAndRow(boxes) {
        const grouped = {};

        boxes.forEach(box => {
            const zone = box.zone || 'ZONE_1';
            const row = box.row || box.stripId || 1;

            if (!grouped[zone]) {
                grouped[zone] = {};
            }
            if (!grouped[zone][row]) {
                grouped[zone][row] = [];
            }

            grouped[zone][row].push(box);
        });

        return grouped;
    }

    /**
     * Generate box ID according to scheme
     */
    generateID(zoneNumber, rowNumber, boxNumber, scheme) {
        const zoneStr = this.padNumber(zoneNumber, scheme.padding.zone);
        const rowStr = this.padNumber(rowNumber, scheme.padding.row);
        const numStr = this.padNumber(boxNumber, scheme.padding.number);

        const parts = [];
        if (scheme.zonePrefix) parts.push(scheme.zonePrefix + zoneStr);
        if (scheme.rowPrefix) parts.push(scheme.rowPrefix + rowStr);
        parts.push(numStr);

        return parts.join(scheme.separator);
    }

    /**
     * Format zone identifier
     */
    formatZone(zoneNumber, scheme) {
        const zoneStr = this.padNumber(zoneNumber, scheme.padding.zone);
        return scheme.zonePrefix ? scheme.zonePrefix + zoneStr : zoneStr;
    }

    /**
     * Pad number with zeros
     */
    padNumber(num, width) {
        const str = num.toString();
        return str.length >= width ? str : '0'.repeat(width - str.length) + str;
    }

    /**
     * Parse box ID to extract components
     */
    parseID(boxID, scheme = 'default') {
        const numberingScheme = this.numberingSchemes[scheme] || this.numberingSchemes.default;
        const regex = new RegExp(
            `${numberingScheme.zonePrefix}(\\d+)${numberingScheme.separator}${numberingScheme.rowPrefix}(\\d+)${numberingScheme.separator}(\\d+)`
        );
        const match = boxID.match(regex);
        
        if (match) {
            return {
                zone: parseInt(match[1]),
                row: parseInt(match[2]),
                number: parseInt(match[3])
            };
        }
        return null;
    }

    /**
     * Get numbering statistics
     */
    getStatistics(boxes) {
        const zones = new Set();
        const rows = new Set();
        let totalBoxes = 0;

        boxes.forEach(box => {
            if (box.zone) zones.add(box.zone);
            if (box.row) rows.add(box.row);
            totalBoxes++;
        });

        return {
            totalBoxes,
            zoneCount: zones.size,
            rowCount: rows.size,
            zones: Array.from(zones).sort(),
            rows: Array.from(rows).sort()
        };
    }
}

module.exports = new CostoNumbering();
