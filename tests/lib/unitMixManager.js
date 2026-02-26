const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');

class UnitMixManager {
    constructor() {
        this.requiredFields = ['type', 'target_area', 'tolerance', 'priority'];
    }

    /**
     * Parses a unit mix file (CSV or Excel) and returns a normalized array of unit mix objects.
     * @param {Buffer} buffer - The file buffer.
     * @param {string} mimeType - The MIME type of the file.
     * @returns {Array} - Array of normalized unit mix objects.
     * @throws {Error} - If parsing fails or validation errors occur.
     */
    parseMix(buffer, mimeType) {
        let records = [];

        if (mimeType.includes('csv') || mimeType.includes('text/csv')) {
            records = this._parseCSV(buffer);
        } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
            records = this._parseExcel(buffer);
        } else {
            throw new Error('Unsupported file format. Please upload a CSV or Excel file.');
        }

        return this._validateAndNormalize(records);
    }

    _parseCSV(buffer) {
        try {
            return parse(buffer, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            });
        } catch (error) {
            throw new Error(`Failed to parse CSV: ${error.message}`);
        }
    }

    _parseExcel(buffer) {
        try {
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            return xlsx.utils.sheet_to_json(sheet);
        } catch (error) {
            throw new Error(`Failed to parse Excel file: ${error.message}`);
        }
    }

    _validateAndNormalize(records) {
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error('The unit mix file is empty.');
        }

        const normalizedMix = [];
        const errors = [];

        records.forEach((record, index) => {
            const normalizedRecord = {};
            const recordErrors = [];

            // Normalize keys to lower case
            const normalizedKeys = Object.keys(record).reduce((acc, key) => {
                acc[key.toLowerCase().trim()] = record[key];
                return acc;
            }, {});

            // Validate Type
            if (normalizedKeys.type) {
                normalizedRecord.type = String(normalizedKeys.type).trim();
            } else {
                recordErrors.push('Missing "type"');
            }

            // Validate Target Area or Count (at least one is required)
            // If target_area is present, use it. If count is present, use it.
            // But we need to standardize. Let's look for 'target area' or 'area' or 'min area'

            // Allow various column names for flexibility
            const area = normalizedKeys.target_area || normalizedKeys.area || normalizedKeys['target area'];
            const count = normalizedKeys.target_count || normalizedKeys.count || normalizedKeys['target count'];

            if (area) {
                const val = parseFloat(area);
                if (!isNaN(val) && val > 0) {
                    normalizedRecord.targetArea = val;
                } else {
                    recordErrors.push('Invalid "target_area"');
                }
            }

            if (count) {
                const val = parseInt(count, 10);
                if (!isNaN(val) && val >= 0) {
                    normalizedRecord.targetCount = val;
                } else {
                    recordErrors.push('Invalid "target_count"');
                }
            }

            if (!normalizedRecord.targetArea && !normalizedRecord.targetCount) {
                recordErrors.push('Must specify either "target_area" or "target_count"');
            }

            // Validate Tolerance
            // Can be percentage (e.g., "5%") or absolute value (e.g., "1")
            const tolerance = normalizedKeys.tolerance;
            if (tolerance !== undefined) {
                if (typeof tolerance === 'string' && tolerance.includes('%')) {
                    const val = parseFloat(tolerance.replace('%', ''));
                     if (!isNaN(val) && val >= 0) {
                        normalizedRecord.tolerance = { type: 'percentage', value: val };
                    } else {
                        recordErrors.push('Invalid "tolerance" percentage');
                    }
                } else {
                    const val = parseFloat(tolerance);
                    if (!isNaN(val) && val >= 0) {
                        normalizedRecord.tolerance = { type: 'absolute', value: val };
                    } else {
                         // Default tolerance if invalid/missing? Or strict error?
                         // Let's assume 0 if missing/invalid but maybe warn
                         // For now, treat as optional, default to 0
                    }
                }
            }
             if (!normalizedRecord.tolerance) {
                 normalizedRecord.tolerance = { type: 'percentage', value: 0 }; // Default
             }

            // Validate Priority
            const priority = normalizedKeys.priority;
            if (priority !== undefined) {
                 const val = parseInt(priority, 10);
                 if (!isNaN(val)) {
                     normalizedRecord.priority = val;
                 } else {
                      normalizedRecord.priority = 1; // Default
                 }
            } else {
                normalizedRecord.priority = 1; // Default
            }


            if (recordErrors.length > 0) {
                errors.push(`Row ${index + 1}: ${recordErrors.join(', ')}`);
            } else {
                normalizedMix.push(normalizedRecord);
            }
        });

        if (errors.length > 0) {
            throw new Error(`Unit mix validation failed:\n${errors.join('\n')}`);
        }

        return normalizedMix;
    }
}

module.exports = new UnitMixManager();
