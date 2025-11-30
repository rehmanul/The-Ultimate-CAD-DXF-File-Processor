#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Running FloorPlan Pro Test Suite\n');

// Run unit tests
console.log('📋 Running Unit Tests...');
try {
  execSync('npx jest tests/unit --verbose', { stdio: 'inherit' });
  console.log('✅ Unit tests passed\n');
} catch (error) {
  console.error('❌ Unit tests failed');
  process.exit(1);
}

// Run integration tests
console.log('🔗 Running Integration Tests...');
try {
  execSync('npx jest tests/integration --verbose', { stdio: 'inherit' });
  console.log('✅ Integration tests passed\n');
} catch (error) {
  console.error('❌ Integration tests failed');
  process.exit(1);
}

// Run E2E tests
console.log('🌐 Running End-to-End Tests...');
try {
  execSync('npx jest tests/e2e --verbose', { stdio: 'inherit' });
  console.log('✅ E2E tests passed\n');
} catch (error) {
  console.error('❌ E2E tests failed');
  process.exit(1);
}

// Run coverage report
console.log('📊 Generating Coverage Report...');
try {
  execSync('npx jest --coverage --coverageReporters=text-summary html', { stdio: 'inherit' });
  console.log('✅ Coverage report generated\n');
} catch (error) {
  console.error('❌ Coverage report failed');
  process.exit(1);
}

console.log('🎉 All tests passed! FloorPlan Pro is ready for production.');
