// Excel Exporter for COSTO - Detailed box lists and summaries
export class ExcelExporter {
    /**
     * Generate Excel-compatible CSV with box details
     */
    static exportBoxList(ilots, unitMix = null) {
        const rows = [];

        // Header
        rows.push([
            'Box ID',
            'Position X (m)',
            'Position Y (m)',
            'Width (m)',
            'Height (m)',
            'Area (m²)',
            'Typologie',
            'Zone',
            'Notes'
        ]);

        // Box data
        ilots.forEach((ilot, index) => {
            rows.push([
                `B${String(index + 1).padStart(3, '0')}`,
                ilot.x.toFixed(2),
                ilot.y.toFixed(2),
                ilot.width.toFixed(2),
                ilot.height.toFixed(2),
                (ilot.area || ilot.width * ilot.height).toFixed(2),
                ilot.type || 'Standard',
                ilot.zone || 'Zone-1',
                ilot.notes || ''
            ]);
        });

        return this.arrayToCSV(rows);
    }

    /**
     * Generate summary by typologie
     */
    static exportTypologySummary(ilots, unitMix = null) {
        const rows = [];

        // Header
        rows.push(['Typologie', 'Count', 'Total Area (m²)', 'Avg Area (m²)', 'Target (m²)', 'Deviation (m²)', 'Conformity (%)']);

        // Group by type
        const byType = {};
        ilots.forEach(ilot => {
            const type = ilot.type || 'Standard';
            if (!byType[type]) {
                byType[type] = [];
            }
            byType[type].push(ilot);
        });

        // Calculate stats
        Object.keys(byType).forEach(type => {
            const boxes = byType[type];
            const count = boxes.length;
            const totalArea = boxes.reduce((sum, b) => sum + (b.area || b.width * b.height), 0);
            const avgArea = totalArea / count;

            // Find target from unit mix
            let target = '-';
            let deviation = '-';
            let conformity = '-';

            if (unitMix) {
                const typo = unitMix.typologies.find(t => t.name === type);
                if (typo) {
                    target = typo.targetArea.toFixed(2);
                    deviation = (totalArea - typo.targetArea).toFixed(2);
                    const deviationPct = Math.abs((totalArea - typo.targetArea) / typo.targetArea * 100);
                    conformity = (100 - deviationPct).toFixed(1);
                }
            }

            rows.push([
                type,
                count,
                totalArea.toFixed(2),
                avgArea.toFixed(2),
                target,
                deviation,
                conformity
            ]);
        });

        // Totals row
        const totalCount = ilots.length;
        const totalArea = ilots.reduce((sum, b) => sum + (b.area || b.width * b.height), 0);
        rows.push(['TOTAL', totalCount, totalArea.toFixed(2), '-', '-', '-', '-']);

        return this.arrayToCSV(rows);
    }

    /**
     * Generate variance report
     */
    static exportVarianceReport(ilots, unitMix) {
        if (!unitMix) {
            throw new Error('Unit mix required for variance report');
        }

        const rows = [];

        // Header
        rows.push(['Variance Report - Unit Mix Conformity']);
        rows.push([]);
        rows.push(['Generated:', new Date().toISOString()]);
        rows.push(['Total Boxes:', ilots.length]);
        rows.push(['Total Area:', ilots.reduce((sum, b) => sum + (b.area || b.width * b.height), 0).toFixed(2) + ' m²']);
        rows.push([]);

        // Details header
        rows.push([
            'Typologie',
            'Target Area (m²)',
            'Actual Area (m²)',
            'Count',
            'Deviation (m²)',
            'Deviation (%)',
            'Tolerance (m²)',
            'Status',
            'Conformity (%)'
        ]);

        // Group ilots by type
        const byType = {};
        ilots.forEach(ilot => {
            const type = ilot.type || 'unknown';
            if (!byType[type]) byType[type] = [];
            byType[type].push(ilot);
        });

        let totalConformity = 0;

        unitMix.typologies.forEach(typo => {
            const actual = byType[typo.name] || [];
            const actualArea = actual.reduce((sum, ilot) => sum + (ilot.area || ilot.width * ilot.height), 0);
            const count = actual.length;
            const deviation = actualArea - typo.targetArea;
            const deviationPct = (deviation / typo.targetArea * 100);
            const isWithinTolerance = Math.abs(deviation) <= typo.tolerance;
            const conformity = isWithinTolerance ? 100 : Math.max(0, 100 - Math.abs(deviationPct));

            totalConformity += conformity;

            const status = isWithinTolerance ? '✓ OK' : (deviation < 0 ? '⚠ Missing' : '⚠ Excess');

            rows.push([
                typo.name,
                typo.targetArea.toFixed(2),
                actualArea.toFixed(2),
                count,
                deviation.toFixed(2),
                deviationPct.toFixed(1) + '%',
                typo.tolerance.toFixed(2),
                status,
                conformity.toFixed(1) + '%'
            ]);
        });

        rows.push([]);
        rows.push(['Overall Conformity:', (totalConformity / unitMix.typologies.length).toFixed(1) + '%']);

        return this.arrayToCSV(rows);
    }

    /**
     * Convert 2D array to CSV string
     */
    static arrayToCSV(data) {
        return data.map(row =>
            row.map(cell => {
                const cellStr = String(cell);
                // Escape quotes and wrap in quotes if contains comma/quote/newline
                if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                    return '"' + cellStr.replace(/"/g, '""') + '"';
                }
                return cellStr;
            }).join(',')
        ).join('\n');
    }

    /**
     * Download CSV file
     */
    static downloadCSV(csvContent, filename = 'export.csv') {
        const BOM = '\uFEFF'; // UTF-8 BOM for Excel compatibility
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Generate complete export package (multiple CSV files in zip would require library)
     */
    static downloadAllReports(ilots, unitMix) {
        // For now, download separately. In production, would use JSZip
        this.downloadCSV(this.exportBoxList(ilots, unitMix), 'box-list.csv');
        setTimeout(() => {
            this.downloadCSV(this.exportTypologySummary(ilots, unitMix), 'typologie-summary.csv');
        }, 100);
        if (unitMix) {
            setTimeout(() => {
                this.downloadCSV(this.exportVarianceReport(ilots, unitMix), 'variance-report.csv');
            }, 200);
        }
    }
}
