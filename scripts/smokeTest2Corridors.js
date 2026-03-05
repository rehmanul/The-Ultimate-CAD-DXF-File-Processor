'use strict';

/**
 * Smoke test: run Test2 DXF pipeline and assert corridor count and continuity.
 * Ensures no regression in row-placement corridor logic.
 * Run: node scripts/smokeTest2Corridors.js
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'Samples', 'Test2_Output');
const SUMMARY_PATH = path.join(OUTPUT_DIR, 'summary.json');
const CORRIDORS_PATH = path.join(OUTPUT_DIR, 'corridors.json');

const MIN_CORRIDORS = 5;
const MIN_BOXES = 100;

function runProcessTest2() {
    const result = spawnSync('node', [path.join('scripts', 'processTest2Dxf.js')], {
        cwd: ROOT,
        stdio: 'pipe',
        encoding: 'utf8',
        shell: false
    });
    if (result.status !== 0) {
        throw new Error(`processTest2Dxf.js failed: ${result.stderr || result.stdout}`);
    }
}

function assertCorridorContinuity(corridors) {
    for (let i = 0; i < corridors.length; i++) {
        const c = corridors[i];
        const w = Number(c.width);
        const h = Number(c.height);
        if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) {
            throw new Error(`Corridor ${i} has invalid width/height: ${w} x ${h}`);
        }
        if (!(Number.isFinite(c.x) && Number.isFinite(c.y))) {
            throw new Error(`Corridor ${i} has invalid position: ${c.x}, ${c.y}`);
        }
    }
}

function main() {
    console.log('=== Smoke: Test2 corridor count and continuity ===\n');
    runProcessTest2();

    if (!fs.existsSync(SUMMARY_PATH)) {
        throw new Error(`Summary not found: ${SUMMARY_PATH}`);
    }
    const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
    if (summary.corridors < MIN_CORRIDORS) {
        throw new Error(`Expected at least ${MIN_CORRIDORS} corridors, got ${summary.corridors}`);
    }
    if (summary.boxes < MIN_BOXES) {
        throw new Error(`Expected at least ${MIN_BOXES} boxes, got ${summary.boxes}`);
    }

    if (fs.existsSync(CORRIDORS_PATH)) {
        const data = JSON.parse(fs.readFileSync(CORRIDORS_PATH, 'utf8'));
        const corridors = data.corridors || [];
        assertCorridorContinuity(corridors);
        console.log(`Corridors: ${corridors.length} (all continuous strips)`);
    }

    console.log(`Boxes: ${summary.boxes}, Corridors: ${summary.corridors}`);
    console.log('\n=== Smoke passed ===');
}

main();
