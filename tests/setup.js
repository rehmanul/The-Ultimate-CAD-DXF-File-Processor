// Test setup file
const tf = require('@tensorflow/tfjs');

// Configure TensorFlow.js for testing
tf.setBackend('cpu');

// Mock console methods to reduce noise during tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeAll(() => {
  // Silence console output during tests unless explicitly needed
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

// Global test utilities
global.testUtils = {
  // Create mock floor plan data
  createMockFloorPlan: (overrides = {}) => ({
    walls: [
      { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
    ],
    forbiddenZones: [],
    entrances: [{ start: { x: 5, y: 0 }, end: { x: 5, y: 1 } }],
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    rooms: [],
    ...overrides
  }),

  // Create mock ilot data
  createMockIlots: (count = 3, overrides = {}) => {
    const ilots = [];
    for (let i = 0; i < count; i++) {
      ilots.push({
        id: `ilot_${i}`,
        x: i * 3,
        y: i * 2,
        width: 2,
        height: 1.5,
        area: 3,
        ...overrides
      });
    }
    return ilots;
  },

  // Clean up any created files/directories
  cleanupTestFiles: async (paths) => {
    const fs = require('fs').promises;
    const path = require('path');

    for (const filePath of paths) {
      try {
        const fullPath = path.resolve(filePath);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          await fs.unlink(fullPath);
        }
      } catch (error) {
        // Ignore errors if file doesn't exist
      }
    }
  }
};
