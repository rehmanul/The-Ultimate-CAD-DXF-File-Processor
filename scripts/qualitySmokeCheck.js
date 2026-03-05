'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REFERENCE_DIR = path.join(ROOT, 'Reference Output Examples');
const generated = path.join(ROOT, 'Samples', 'Final_Output', 'Final_generated.pdf');
const reference = path.join(REFERENCE_DIR, 'Final.pdf');
const report = path.join(ROOT, 'exports', 'quality_smoke_report.json');

function assertFileExists(label, targetPath) {
    if (!fs.existsSync(targetPath)) {
        throw new Error(`${label} not found: ${targetPath}`);
    }
}

function run(label, command, args) {
    console.log(`\n=== ${label} ===`);
    console.log(`> ${command} ${args.join(' ')}`);

    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: false
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${label} failed with exit code ${result.status}`);
    }
}

function main() {
    const dryRun = process.argv.includes('--dry-run');
    assertFileExists('Reference Final.pdf', reference);

    if (dryRun) {
        console.log('\n=== QUALITY SMOKE DRY RUN ===');
        console.log(`Reference PDF: ${reference}`);
        console.log(`Generated PDF target: ${generated}`);
        console.log(`Report target: ${report}`);
        return;
    }

    run('Generate Final Smoke Output', 'node', [path.join('scripts', 'processFinalDxf.js')]);
    run('Validate Final Smoke Quality', 'python', [
        path.join('scripts', 'validateReferenceQuality.py'),
        '--generated', generated,
        '--reference', reference,
        '--output', report
    ]);

    console.log('\n=== QUALITY SMOKE PASSED ===');
    console.log(`Report: ${report}`);
}

try {
    main();
} catch (error) {
    console.error('\n=== QUALITY SMOKE FAILED ===');
    console.error(error && error.message ? error.message : error);
    process.exit(1);
}
