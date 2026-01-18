const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * COSTO Unit Mix Parser
 * Parses Excel/CSV files with unit mix specifications
 * 
 * Expected format:
 * typologie,surface_cible,tolerance,priorite
 * S (<2m²),50,5,obligatoire
 * M (2-3m²),30,10,souhaitable
 */

class UnitMixParser {
    /**
     * Parse unit mix from file
     * @param {string} filePath - Path to Excel or CSV file
     * @returns {Object} Parsed and validated unit mix
     */
    static parseFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.csv') {
            return this.parseCSV(filePath);
        } else if (ext === '.xlsx' || ext === '.xls') {
            return this.parseExcel(filePath);
        } else {
            throw new Error(`Unsupported file format: ${ext}. Use .csv, .xlsx, or .xls`);
        }
    }

    /**
     * Parse CSV file
     */
    static parseCSV(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split(/\r?\n/);

        if (lines.length < 2) {
            throw new Error('CSV file must contain header and at least one data row');
        }

        const header = lines[0].split(',').map(h => h.trim().toLowerCase());
        const rows = lines.slice(1).map(line => {
            const values = line.split(',').map(v => v.trim());
            const row = {};
            header.forEach((col, i) => {
                row[col] = values[i] || '';
            });
            return row;
        });

        return this.validateAndNormalize(rows);
    }

    /**
     * Parse Excel file
     */
    static parseExcel(filePath) {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to JSON with header row
        const data = XLSX.utils.sheet_to_json(sheet, {
            raw: false,
            defval: ''
        });

        if (!data || data.length === 0) {
            throw new Error('Excel file contains no data');
        }

        // Normalize keys to lowercase
        const normalized = data.map(row => {
            const newRow = {};
            Object.keys(row).forEach(key => {
                newRow[key.trim().toLowerCase()] = row[key];
            });
            return newRow;
        });

        return this.validateAndNormalize(normalized);
    }

    /**
     * Validate and normalize unit mix data
     */
    static validateAndNormalize(rows) {
        const typologies = [];
        let totalSurface = 0;
        let totalTolerance = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const lineNum = i + 2; // Account for header

            // Check required fields
            if (!row.typologie) {
                throw new Error(`Line ${lineNum}: Missing typologie (column A)`);
            }

            // Parse surface (target area in m²)
            const surfaceStr = String(row.surface_cible || row.surface || '').replace(',', '.');
            const surface = parseFloat(surfaceStr);
            if (isNaN(surface) || surface <= 0) {
                throw new Error(`Line ${lineNum}: Invalid surface_cible "${surfaceStr}". Must be > 0`);
            }

            // Parse tolerance (± m² or %)
            let tolerance = 0;
            const toleranceStr = String(row.tolerance || '0').replace(',', '.');
            if (toleranceStr.includes('%')) {
                // Percentage tolerance
                const pct = parseFloat(toleranceStr.replace('%', ''));
                if (!isNaN(pct)) {
                    tolerance = (surface * pct) / 100;
                }
            } else {
                // Absolute tolerance in m²
                tolerance = parseFloat(toleranceStr);
            }

            if (isNaN(tolerance) || tolerance < 0) {
                tolerance = surface * 0.1; // Default 10% tolerance
            }

            // Parse priority
            const priorite = String(row.priorite || row.priority || 'souhaitable').toLowerCase();
            const isRequired = priorite.includes('oblig') || priorite.includes('required') || priorite.includes('mandatory');

            totalSurface += surface;
            totalTolerance += tolerance;

            typologies.push({
                name: row.typologie.trim(),
                targetArea: surface,
                tolerance: tolerance,
                minArea: Math.max(0, surface - tolerance),
                maxArea: surface + tolerance,
                priority: isRequired ? 'obligatoire' : 'souhaitable',
                count: 0 // Will be filled during generation
            });
        }

        // Validation summary
        if (typologies.length === 0) {
            throw new Error('No valid typologies found in file');
        }

        return {
            typologies,
            totals: {
                targetArea: totalSurface,
                totalTolerance: totalTolerance,
                minArea: totalSurface - totalTolerance,
                maxArea: totalSurface + totalTolerance,
                typeCount: typologies.length
            },
            metadata: {
                parsedAt: new Date().toISOString(),
                format: 'COSTO V1',
                valid: true
            }
        };
    }

    /**
     * Generate variance report comparing target vs actual
     */
    static calculateVariance(unitMix, generatedIlots) {
        const report = {
            conformity: 0,
            gaps: [],
            extras: [],
            details: []
        };

        // Group ilots by type
        const ilotsByType = {};
        generatedIlots.forEach(ilot => {
            const type = ilot.type || 'unknown';
            if (!ilotsByType[type]) {
                ilotsByType[type] = [];
            }
            ilotsByType[type].push(ilot);
        });

        let totalConformity = 0;

        unitMix.typologies.forEach(typo => {
            const actual = ilotsByType[typo.name] || [];
            const actualArea = actual.reduce((sum, ilot) => sum + (ilot.area || ilot.width * ilot.height), 0);
            const actualCount = actual.length;

            const deviation = actualArea - typo.targetArea;
            const isWithinTolerance = Math.abs(deviation) <= typo.tolerance;
            const conformityPct = isWithinTolerance ? 100 : Math.max(0, 100 - (Math.abs(deviation) / typo.targetArea) * 100);

            totalConformity += conformityPct;

            const detail = {
                typologie: typo.name,
                target: typo.targetArea,
                actual: actualArea,
                deviation: deviation,
                deviationPct: (deviation / typo.targetArea) * 100,
                tolerance: typo.tolerance,
                conformity: conformityPct,
                withinTolerance: isWithinTolerance,
                count: actualCount,
                priority: typo.priority
            };

            report.details.push(detail);

            if (deviation < -typo.tolerance) {
                report.gaps.push({
                    typologie: typo.name,
                    missing: Math.abs(deviation + typo.tolerance),
                    priority: typo.priority
                });
            } else if (deviation > typo.tolerance) {
                report.extras.push({
                    typologie: typo.name,
                    excess: deviation - typo.tolerance
                });
            }
        });

        report.conformity = totalConformity / unitMix.typologies.length;

        return report;
    }
}

module.exports = UnitMixParser;

// CLI usage
if (require.main === module) {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node unitMixParser.js <path-to-file.csv|.xlsx>');
        process.exit(1);
    }

    try {
        const result = UnitMixParser.parseFile(filePath);
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}
