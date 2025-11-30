#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('📊 Generating Comprehensive Test Coverage Report\n');

// Generate coverage with multiple reporters
try {
  execSync('npx jest --coverage --coverageReporters=text lcov html json', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' }
  });

  console.log('\n📈 Coverage Summary:');
  console.log('- HTML Report: coverage/lcov-report/index.html');
  console.log('- LCOV Report: coverage/lcov.info');
  console.log('- JSON Report: coverage/coverage-final.json');
  console.log('- Text Summary: Above output');

  // Check coverage thresholds
  const fs = require('fs');
  const coveragePath = 'coverage/coverage-summary.json';

  if (fs.existsSync(coveragePath)) {
    const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    const total = coverage.total;

    console.log('\n🎯 Coverage Thresholds:');
    console.log(`Lines: ${total.lines.pct}% (target: >80%)`);
    console.log(`Functions: ${total.functions.pct}% (target: >80%)`);
    console.log(`Branches: ${total.branches.pct}% (target: >70%)`);
    console.log(`Statements: ${total.statements.pct}% (target: >80%)`);

    // Check if thresholds are met
    const thresholds = {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80
    };

    let allPassed = true;
    Object.keys(thresholds).forEach(metric => {
      if (total[metric].pct < thresholds[metric]) {
        console.log(`❌ ${metric} coverage below threshold`);
        allPassed = false;
      }
    });

    if (allPassed) {
      console.log('\n✅ All coverage thresholds met!');
    } else {
      console.log('\n⚠️  Some coverage thresholds not met. Consider adding more tests.');
      process.exit(1);
    }
  }

} catch (error) {
  console.error('❌ Coverage generation failed');
  process.exit(1);
}
