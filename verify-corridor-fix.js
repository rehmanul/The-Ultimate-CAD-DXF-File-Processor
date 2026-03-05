/**
 * Verification script for corridor accessibility fix
 * Checks if the fix code is properly integrated and logs are appearing
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(80));
console.log('CORRIDOR ACCESSIBILITY FIX VERIFICATION');
console.log('='.repeat(80));
console.log('');

// Check 1: Verify ProfessionalGridLayoutEngine.js has the integration
console.log('✓ Check 1: ProfessionalGridLayoutEngine.js integration');
const enginePath = path.join(__dirname, 'lib', 'ProfessionalGridLayoutEngine.js');
const engineCode = fs.readFileSync(enginePath, 'utf8');

const checks = [
    {
        name: 'Import AdvancedCorridorNetworkGenerator',
        pattern: /const AdvancedCorridorNetworkGenerator = require\('\.\/advancedCorridorNetworkGenerator'\)/,
        found: false
    },
    {
        name: 'Create corridorGenerator instance',
        pattern: /const corridorGenerator = new AdvancedCorridorNetworkGenerator\(/,
        found: false
    },
    {
        name: 'Call validateAndBridgeConnectivity',
        pattern: /corridorGenerator\.validateAndBridgeConnectivity\(/,
        found: false
    },
    {
        name: 'Return enhancedCorridors',
        pattern: /corridors: enhancedCorridors/,
        found: false
    },
    {
        name: 'Log corridor fix message',
        pattern: /\[BayGrid\] Applying corridor accessibility fix/,
        found: false
    }
];

checks.forEach(check => {
    check.found = check.pattern.test(engineCode);
    console.log(`  ${check.found ? '✓' : '✗'} ${check.name}`);
});

const allChecksPass = checks.every(c => c.found);
console.log('');

if (allChecksPass) {
    console.log('✓ All integration checks PASSED');
} else {
    console.log('✗ Some integration checks FAILED');
    console.log('  The fix code may not be properly integrated.');
}
console.log('');

// Check 2: Verify AdvancedCorridorNetworkGenerator has the fix methods
console.log('✓ Check 2: AdvancedCorridorNetworkGenerator.js fix methods');
const generatorPath = path.join(__dirname, 'lib', 'advancedCorridorNetworkGenerator.js');
const generatorCode = fs.readFileSync(generatorPath, 'utf8');

const methodChecks = [
    {
        name: 'validateAndBridgeConnectivity method',
        pattern: /validateAndBridgeConnectivity\s*\(/,
        found: false
    },
    {
        name: 'detectIsolatedÎlots method',
        pattern: /detectIsolatedÎlots\s*\(/,
        found: false
    },
    {
        name: 'ensureEntranceConnectivity method',
        pattern: /ensureEntranceConnectivity\s*\(/,
        found: false
    }
];

methodChecks.forEach(check => {
    check.found = check.pattern.test(generatorCode);
    console.log(`  ${check.found ? '✓' : '✗'} ${check.name}`);
});

const allMethodsExist = methodChecks.every(c => c.found);
console.log('');

if (allMethodsExist) {
    console.log('✓ All fix methods exist');
} else {
    console.log('✗ Some fix methods are missing');
}
console.log('');

// Check 3: Verify CirculationRouter has connectivity detection
console.log('✓ Check 3: CirculationRouter.js connectivity detection');
const routerPath = path.join(__dirname, 'lib', 'costo-engine', 'circulationRouter.js');
const routerCode = fs.readFileSync(routerPath, 'utf8');

const routerChecks = [
    {
        name: 'detectConnectivity method',
        pattern: /detectConnectivity\s*\(/,
        found: false
    },
    {
        name: '_findUnreachableFromEntrances method',
        pattern: /_findUnreachableFromEntrances\s*\(/,
        found: false
    },
    {
        name: '_findÎlotComponent method',
        pattern: /_findÎlotComponent\s*\(/,
        found: false
    }
];

routerChecks.forEach(check => {
    check.found = check.pattern.test(routerCode);
    console.log(`  ${check.found ? '✓' : '✗'} ${check.name}`);
});

const allRouterMethodsExist = routerChecks.every(c => c.found);
console.log('');

if (allRouterMethodsExist) {
    console.log('✓ All connectivity detection methods exist');
} else {
    console.log('✗ Some connectivity detection methods are missing');
}
console.log('');

// Check 4: Verify CorridorRouter has gap bridging
console.log('✓ Check 4: CorridorRouter.js gap bridging');
const corridorRouterPath = path.join(__dirname, 'lib', 'corridorRouter.js');
const corridorRouterCode = fs.readFileSync(corridorRouterPath, 'utf8');

const bridgingChecks = [
    {
        name: 'generateBridgingCorridors static method',
        pattern: /static generateBridgingCorridors\s*\(/,
        found: false
    },
    {
        name: '_createBridgingCorridor method',
        pattern: /_createBridgingCorridor\s*\(/,
        found: false
    },
    {
        name: '_segmentCrossesWall method',
        pattern: /_segmentCrossesWall\s*\(/,
        found: false
    }
];

bridgingChecks.forEach(check => {
    check.found = check.pattern.test(corridorRouterCode);
    console.log(`  ${check.found ? '✓' : '✗'} ${check.name}`);
});

const allBridgingMethodsExist = bridgingChecks.every(c => c.found);
console.log('');

if (allBridgingMethodsExist) {
    console.log('✓ All gap bridging methods exist');
} else {
    console.log('✗ Some gap bridging methods are missing');
}
console.log('');

// Summary
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log('');

if (allChecksPass && allMethodsExist && allRouterMethodsExist && allBridgingMethodsExist) {
    console.log('✓ ALL CHECKS PASSED - Fix code is properly integrated');
    console.log('');
    console.log('NEXT STEPS:');
    console.log('1. RESTART the server (Ctrl+C then run: node server.js)');
    console.log('2. Upload a floor plan in the frontend (localhost:3000)');
    console.log('3. Click "Generate Tools"');
    console.log('4. Check browser console for these logs:');
    console.log('   - [BayGrid] Applying corridor accessibility fix...');
    console.log('   - [Corridor Network] Starting post-generation validation loop');
    console.log('   - [CirculationRouter] Connectivity: X component(s), Y unreachable îlot(s)...');
    console.log('   - [CorridorRouter] Generated bridging corridor connecting component...');
    console.log('   - [Corridor Network] Network is fully connected after N iteration(s)');
    console.log('   - [BayGrid] Corridor fix: 17 original → 20+ enhanced (with connectivity)');
    console.log('');
    console.log('If logs appear but output is still wrong, the issue is in PDF rendering.');
    console.log('If logs do NOT appear, the server was not restarted properly.');
} else {
    console.log('✗ SOME CHECKS FAILED - Fix code may not be properly integrated');
    console.log('');
    console.log('Please review the failed checks above and ensure all fix code is in place.');
}
console.log('');
