const ProductionCorridorGenerator = require('../../../lib/productionCorridorGenerator');

describe('ProductionCorridorGenerator', () => {
  let generator;
  let mockFloorPlan;
  let mockIlots;

  beforeEach(() => {
    mockFloorPlan = testUtils.createMockFloorPlan();
    mockIlots = testUtils.createMockIlots(4);
    generator = new ProductionCorridorGenerator(mockFloorPlan, mockIlots);
  });

  describe('constructor', () => {
    test('should initialize with default options', () => {
      const gen = new ProductionCorridorGenerator(mockFloorPlan, mockIlots);
      expect(gen.margin).toBe(0.5);
      expect(gen.corridorWidth).toBe(1.2);
    });

    test('should initialize with custom options', () => {
      const options = { margin: 1.0, corridorWidth: 2.0 };
      const gen = new ProductionCorridorGenerator(mockFloorPlan, mockIlots, options);
      expect(gen.margin).toBe(1.0);
      expect(gen.corridorWidth).toBe(2.0);
    });
  });

  describe('groupIlotsByColumns', () => {
    test('should group ilots by x-coordinate (column)', () => {
      // Create ilots in different columns
      const columnIlots = [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 0, y: 3, width: 1, height: 1 },
        { x: 5, y: 0, width: 1, height: 1 },
        { x: 5, y: 3, width: 1, height: 1 }
      ];
      const gen = new ProductionCorridorGenerator(mockFloorPlan, columnIlots);

      const columns = gen.groupIlotsByColumns();

      expect(columns).toHaveLength(2);
      expect(columns[0]).toHaveLength(2); // Column x=0
      expect(columns[1]).toHaveLength(2); // Column x=5
    });

    test('should handle empty ilots array', () => {
      const gen = new ProductionCorridorGenerator(mockFloorPlan, []);
      const columns = gen.groupIlotsByColumns();
      expect(columns).toHaveLength(0);
    });
  });

  describe('generateCorridors', () => {
    test('should generate vertical corridors between ilots in same column', () => {
      // Create ilots in same column with gap
      const columnIlots = [
        { x: 0, y: 0, width: 2, height: 1 },
        { x: 0, y: 3, width: 2, height: 1 } // Gap of 2 between bottom of first and top of second
      ];
      const gen = new ProductionCorridorGenerator(mockFloorPlan, columnIlots, { margin: 0.5 });

      const corridors = gen.generateCorridors();

      expect(corridors).toHaveLength(1);
      const corridor = corridors[0];
      expect(corridor.x).toBe(0); // Left edge of column
      expect(corridor.y).toBe(1.5); // Centered in gap (1 + (2-1.2)/2)
      expect(corridor.width).toBe(2); // Full width of column
      expect(corridor.height).toBe(1.2); // Corridor width
    });

    test('should not generate corridors when gap is less than margin', () => {
      // Create ilots with small gap
      const closeIlots = [
        { x: 0, y: 0, width: 2, height: 1 },
        { x: 0, y: 1.3, width: 2, height: 1 } // Gap of 0.3, less than margin 0.5
      ];
      const gen = new ProductionCorridorGenerator(mockFloorPlan, closeIlots, { margin: 0.5 });

      const corridors = gen.generateCorridors();

      expect(corridors).toHaveLength(0);
    });

    test('should generate multiple corridors in same column', () => {
      // Create three ilots in same column
      const multipleIlots = [
        { x: 0, y: 0, width: 2, height: 1 },
        { x: 0, y: 3, width: 2, height: 1 },
        { x: 0, y: 6, width: 2, height: 1 }
      ];
      const gen = new ProductionCorridorGenerator(mockFloorPlan, multipleIlots, { margin: 0.5 });

      const corridors = gen.generateCorridors();

      expect(corridors).toHaveLength(2); // Two gaps between three ilots
    });

    test('should handle ilots with different widths in same column', () => {
      // Create ilots with different widths
      const variedIlots = [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 0, y: 3, width: 3, height: 1 } // Wider than first
      ];
      const gen = new ProductionCorridorGenerator(mockFloorPlan, variedIlots, { margin: 0.5 });

      const corridors = gen.generateCorridors();

      expect(corridors).toHaveLength(1);
      const corridor = corridors[0];
      expect(corridor.x).toBe(0); // Left edge of leftmost ilot
      expect(corridor.width).toBe(3); // Width spans from leftmost to rightmost
    });

    test('should generate corridors for multiple columns', () => {
      // Create ilots in two columns
      const multiColumnIlots = [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 0, y: 3, width: 1, height: 1 },
        { x: 5, y: 0, width: 1, height: 1 },
        { x: 5, y: 3, width: 1, height: 1 }
      ];
      const gen = new ProductionCorridorGenerator(mockFloorPlan, multiColumnIlots, { margin: 0.5 });

      const corridors = gen.generateCorridors();

      expect(corridors).toHaveLength(2); // One corridor per column
    });

    test('should create proper polygon coordinates', () => {
      const columnIlots = [
        { x: 2, y: 0, width: 2, height: 1 },
        { x: 2, y: 3, width: 2, height: 1 }
      ];
      const gen = new ProductionCorridorGenerator(mockFloorPlan, columnIlots, { margin: 0.5 });

      const corridors = gen.generateCorridors();

      expect(corridors).toHaveLength(1);
      const corridor = corridors[0];
      expect(corridor.polygon).toEqual([
        [2, 1.5], // Left-top
        [4, 1.5], // Right-top
        [4, 2.7], // Right-bottom
        [2, 2.7]  // Left-bottom
      ]);
    });

    test('should calculate correct area', () => {
      const columnIlots = [
        { x: 0, y: 0, width: 3, height: 1 },
        { x: 0, y: 4, width: 3, height: 1 }
      ];
      const gen = new ProductionCorridorGenerator(mockFloorPlan, columnIlots, { margin: 0.5, corridorWidth: 2 });

      const corridors = gen.generateCorridors();

      expect(corridors).toHaveLength(1);
      const corridor = corridors[0];
      expect(corridor.area).toBe(6); // width (3) * height (2)
    });
  });
});
