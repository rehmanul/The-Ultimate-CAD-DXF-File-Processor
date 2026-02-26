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
    const finalGenerated = path.join(ROOT, 'Samples', 'Final_Output', 'Final_generated.pdf');
    const finalReference = path.join(ROOT, 'Samples', 'Ref. Output Samples', 'Final.pdf');
    const reportPath = path.join(ROOT, 'exports', 'quality_report_final.json');

    runStep('Generate Test2 Production Output', 'node', [path.join('scripts', 'processTest2Dwg.js')]);
    runStep('Generate Final Production Output', 'node', [path.join('scripts', 'processFinalDxf.js')]);
    runStep('Validate Final Reference Quality', 'python', [
        path.join('scripts', 'validateReferenceQuality.py'),
        '--generated', finalGenerated,
        '--reference', finalReference,
        '--output', reportPath
    ]);

    console.log('\n=== QUALITY GATE PASSED ===');
    console.log(`Report: ${reportPath}`);
}

try {
    main();
} catch (error) {
    console.error('\n=== QUALITY GATE FAILED ===');
    console.error(error && error.message ? error.message : error);
    process.exit(1);
}
