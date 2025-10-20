const { profileMultiFloor } = require('../../../lib/multiFloorProfiler');

const sampleFloors = [
  {
    id: 'floor_0',
    level: 0,
    floorPlan: {
      bounds: { minX: 0, minY: 0, width: 20, height: 30 },
      walls: [],
      forbiddenZones: [],
      entrances: []
    }
  },
  {
    id: 'floor_1',
    level: 1,
    floorPlan: {
      bounds: { minX: 0, minY: 0, width: 20, height: 30 },
      walls: [],
      forbiddenZones: [],
      entrances: []
    }
  }
];

describe('MultiFloorProfiler', () => {
  it('profiles stack and routing across multiple iterations', () => {
    const result = profileMultiFloor(sampleFloors, { iterations: 2, targetFloorCount: 6 });
    expect(result.parameters.iterations).toBe(2);
    expect(result.parameters.floorCount).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(result.stack.samples)).toBe(true);
    expect(result.stack.samples.length).toBe(2);
    expect(Array.isArray(result.routing.samples)).toBe(true);
  });

  it('throws when no floors provided', () => {
    expect(() => profileMultiFloor([], {})).toThrow();
  });
});
