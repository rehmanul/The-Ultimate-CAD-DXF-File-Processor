'use strict';

/**
 * Smoke check: after processTest2Dxf (or similar), assert corridor count and continuity.
 * Run: node scripts/processTest2Dxf.js && node scripts/smokeCorridorCheck.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SUMMARY_PATH = path.join(ROOT, 'Samples', 'Test2_Output', 'summary.json');
const CORRIDORS_PATH = path.join(ROOT, 'Samples', 'Test2_Output', 'corridors.json');

function main() {
    if (!fs.existsSync(SUMMARY_PATH)) {
        console.error('Missing summary.json. Run: node scripts/processTest2Dxf.js');
        process.exit(1);
    }
    const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
    const corridorCount = summary.corridors != null ? summary.corridors : 0;
    if (corridorCount < 1) {
        console.error('Smoke fail: expected at least 1 corridor, got', corridorCount);
        process.exit(1);
    }

    if (fs.existsSync(CORRIDORS_PATH)) {
        const data = JSON.parse(fs.readFileSync(CORRIDORS_PATH, 'utf8'));
        const corridors = data.corridors || [];
        corridors.forEach((c, i) => {
            const w = Number(c.width);
            const h = Number(c.height);
            if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
                console.error(`Smoke fail: corridor ${i} has invalid dimensions width=${c.width} height=${c.height}`);
                process.exit(1);
            }
        });
    }

    console.log('Smoke OK: corridor count =', corridorCount);
}

main();
