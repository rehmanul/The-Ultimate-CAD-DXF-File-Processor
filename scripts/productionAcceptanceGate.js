'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function runStep(label, command, args, options = {}) {
    console.log(`\n=== ${label} ===`);
    console.log(`> ${command} ${args.join(' ')}`);

    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: false,
        ...options
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${label} failed with exit code ${result.status}`);
    }
}

function main() {
    runStep('Production Quality Gate', 'node', [path.join('scripts', 'productionQualityGate.js')]);
    runStep('Test2 Browser Smoke', 'node', [path.join('scripts', 'playwrightTest2Smoke.js')]);
    console.log('\n=== ACCEPTANCE GATE PASSED ===');
}

try {
    main();
} catch (error) {
    console.error('\n=== ACCEPTANCE GATE FAILED ===');
    console.error(error && error.message ? error.message : error);
    process.exit(1);
}

