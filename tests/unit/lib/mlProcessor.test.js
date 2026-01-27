const MLProcessor = require('../../../lib/mlProcessor');

describe('MLProcessor', () => {
  let mlProcessor;

  beforeEach(() => {
    // Create a fresh instance for each test
    mlProcessor = new MLProcessor.constructor();
  });

  afterEach(async () => {
    // Clean up TensorFlow.js resources
    if (mlProcessor.models.roomClassifier) {
      mlProcessor.models.roomClassifier.dispose();
    }
    if (mlProcessor.models.furniturePlacer) {
      mlProcessor.models.furniturePlacer.dispose();
    }
    if (mlProcessor.models.layoutOptimizer) {
      mlProcessor.models.layoutOptimizer.dispose();
    }
    if (mlProcessor.models.cadEntityClassifier) {
      mlProcessor.models.cadEntityClassifier.dispose();
    }
  });

  describe('constructor', () => {
    test('should initialize with empty models and not initialized', () => {
      expect(mlProcessor.models.roomClassifier).toBeNull();
      expect(mlProcessor.models.furniturePlacer).toBeNull();
      expect(mlProcessor.models.layoutOptimizer).toBeNull();
      expect(mlProcessor.models.cadEntityClassifier).toBeNull();
      expect(mlProcessor.isInitialized).toBe(false);
      expect(mlProcessor.trainingData).toEqual({
        rooms: [],
        furniture: [],
        layouts: [],
        cadEntities: []
      });
    });
  });

  describe('initialize', () => {
    test('should initialize models when called', async () => {
      await mlProcessor.initialize();

      expect(mlProcessor.isInitialized).toBe(true);
      expect(mlProcessor.models.roomClassifier).not.toBeNull();
      expect(mlProcessor.models.furniturePlacer).not.toBeNull();
      expect(mlProcessor.models.layoutOptimizer).not.toBeNull();
      expect(mlProcessor.models.cadEntityClassifier).not.toBeNull();
    });

    test('should not reinitialize if already initialized', async () => {
      await mlProcessor.initialize();
      const firstRoomClassifier = mlProcessor.models.roomClassifier;

      await mlProcessor.initialize();

      expect(mlProcessor.models.roomClassifier).toBe(firstRoomClassifier);
    });
  });

  describe('classifyRoom', () => {
    beforeEach(async () => {
      await mlProcessor.initialize();
    });

    test('should classify room using ML when initialized', async () => {
      const roomData = {
        area: 25,
        bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
        adjacency: { room1: true, room2: true },
        center: { x: 2.5, y: 2.5 }
      };

      const result = await mlProcessor.classifyRoom(roomData);

      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('features');
      expect(result.features).toHaveLength(5);
      expect(['office', 'meeting', 'utility', 'hall', 'entry', 'circulation', 'storage', 'other']).toContain(result.type);
    });

    test('should throw when not initialized', async () => {
      const uninitializedProcessor = new MLProcessor.constructor();
      const roomData = { area: 25 };

      await expect(uninitializedProcessor.classifyRoom(roomData))
        .rejects
        .toThrow('Room classifier model is not initialized');
    });
  });

  describe('classifyCADEntity', () => {
    beforeEach(async () => {
      await mlProcessor.initialize();
    });

    test('should classify CAD entity using ML when initialized', () => {
      const entityData = {
        color: 0xFF0000, // Red
        layer: 'ENTRANCE',
        area: 10,
        perimeter: 12,
        aspectRatio: 1.2,
        center: { x: 5, y: 5 }
      };

      const result = mlProcessor.classifyCADEntity(entityData);

      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('features');
      expect(result.features).toHaveLength(9);
      expect(['wall', 'forbidden', 'entrance']).toContain(result.type);
    });

    test('should throw when not initialized', () => {
      const uninitializedProcessor = new MLProcessor.constructor();
      const entityData = { color: 0xFF0000, layer: 'ENTRANCE' };

      expect(() => uninitializedProcessor.classifyCADEntity(entityData))
        .toThrow('CAD entity classifier model is not initialized');
    });
  });

  describe('extractRoomFeatures', () => {
    test('should extract correct features from room data', () => {
      const room = {
        area: 20,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 5 },
        adjacency: { room1: true, room2: true, room3: true },
        center: { x: 2, y: 2.5 }
      };

      const features = mlProcessor.extractRoomFeatures(room);

      expect(features).toHaveLength(5);
      expect(features[0]).toBe(20); // area
      expect(features[1]).toBe(4/5); // aspect ratio (width/height)
      expect(features[2]).toBe(3); // adjacency count
      expect(features[3]).toBe(10); // distance to entrance (default when no entrances provided)
      expect(features[4]).toBe(18); // perimeter (2*(width+height))
    });

    test('should handle missing room data gracefully', () => {
      const room = {};

      const features = mlProcessor.extractRoomFeatures(room);

      expect(features).toHaveLength(5);
      expect(features[0]).toBe(0); // default area
      expect(features[1]).toBe(1); // default aspect ratio
      expect(features[2]).toBe(0); // no adjacency
      expect(features[3]).toBe(10); // default distance
      expect(features[4]).toBe(20); // default perimeter
    });

    test('should calculate distance to entrance if entrances provided', () => {
      const room = {
        area: 20,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 5 },
        center: { x: 5, y: 5 },
        entrances: [{ center: { x: 5, y: 10 } }]
      };

      const features = mlProcessor.extractRoomFeatures(room);
      expect(features[3]).toBe(5); // Distance from (5,5) to (5,10)
    });
  });

  describe('calculateDistanceToEntrance', () => {
    test('should calculate correct distance to nearest entrance', () => {
      const center = { x: 5, y: 5 };
      const entrances = [
        { center: { x: 5, y: 10 } }, // distance 5
        { center: { x: 0, y: 5 } }   // distance 5
      ];

      const distance = mlProcessor.calculateDistanceToEntrance(center, entrances);
      expect(distance).toBe(5);
    });

    test('should handle entrance with start/end coordinates', () => {
      const center = { x: 5, y: 5 };
      const entrances = [
        { start: { x: 0, y: 0 }, end: { x: 0, y: 10 } } // center at 0,5
      ];

      const distance = mlProcessor.calculateDistanceToEntrance(center, entrances);
      // Distance from (5,5) to (0,5) is 5
      expect(distance).toBe(5);
    });

    test('should return default distance if no entrances', () => {
      const center = { x: 5, y: 5 };
      const distance = mlProcessor.calculateDistanceToEntrance(center, []);
      expect(distance).toBe(10);
    });

    test('should return default distance if center missing', () => {
      const distance = mlProcessor.calculateDistanceToEntrance(null, []);
      expect(distance).toBe(10);
    });
  });

  describe('extractCADEntityFeatures', () => {
    test('should extract correct features from CAD entity data', () => {
      const entity = {
        color: 0xFF0000, // Red = 16711680
        layer: 'WALL_LAYER',
        area: 15,
        perimeter: 16,
        aspectRatio: 1.5,
        center: { x: 10, y: 20 }
      };

      const features = mlProcessor.extractCADEntityFeatures(entity);

      expect(features).toHaveLength(9);
      expect(features[0]).toBe(1); // r (255/255)
      expect(features[1]).toBe(0); // g (0/255)
      expect(features[2]).toBe(0); // b (0/255)
      expect(features[3]).toBeGreaterThan(0); // layer hash
      expect(features[4]).toBe(15); // area
      expect(features[5]).toBe(16); // perimeter
      expect(features[6]).toBe(1.5); // aspect ratio
      expect(features[7]).toBe(1); // position x (10/10)
      expect(features[8]).toBe(2); // position y (20/10)
    });

    test('should handle missing entity data gracefully', () => {
      const entity = {};

      const features = mlProcessor.extractCADEntityFeatures(entity);

      expect(features).toHaveLength(9);
      expect(features[0]).toBe(0); // default color components
      expect(features[1]).toBe(0);
      expect(features[2]).toBe(0);
      expect(features[3]).toBeGreaterThan(0); // layer hash for undefined
      expect(features[4]).toBe(0); // default area
      expect(features[5]).toBe(0); // default perimeter
      expect(features[6]).toBe(1); // default aspect ratio
      expect(features[7]).toBe(0); // default position x
      expect(features[8]).toBe(0); // default position y
    });
  });

  describe('disabled methods', () => {
    describe('disabledRoomClassification', () => {
      test('should throw when called', () => {
        expect(() => mlProcessor.disabledRoomClassification({ area: 3 }))
          .toThrow('Room classification requires initialized models');
      });
    });

    describe('disabledCADEntityClassification', () => {
      test('should throw when called', () => {
        expect(() => mlProcessor.disabledCADEntityClassification({ color: 0xFF0000 }))
          .toThrow('CAD entity classification requires initialized models');
      });
    });
  });

  describe('suggestFurniturePlacement', () => {
    beforeEach(async () => {
      await mlProcessor.initialize();
    });

    test('should suggest furniture placement using ML when initialized', async () => {
      const room = { area: 20, bounds: { minX: 0, minY: 0, maxX: 4, maxY: 5 }, type: 'office' };
      const furnitureType = 'desk';

      const result = await mlProcessor.suggestFurniturePlacement(room, furnitureType);

      expect(result).toHaveProperty('x');
      expect(result).toHaveProperty('y');
      expect(result).toHaveProperty('rotation');
      expect(result).toHaveProperty('confidence');
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(0);
    });

    test('should throw when not initialized', async () => {
      const uninitializedProcessor = new MLProcessor.constructor();
      const room = { bounds: { minX: 0, minY: 0, maxX: 5, maxY: 4 } };

      await expect(uninitializedProcessor.suggestFurniturePlacement(room, 'desk'))
        .rejects
        .toThrow('Furniture placement model is not initialized');
    });
  });

  describe('scoreLayout', () => {
    beforeEach(async () => {
      await mlProcessor.initialize();
    });

    test('should score layout using ML when initialized', async () => {
      const layout = { ilots: testUtils.createMockIlots(3) };
      const floorPlan = testUtils.createMockFloorPlan();

      const score = await mlProcessor.scoreLayout(layout, floorPlan);

      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    test('should throw when not initialized', async () => {
      const uninitializedProcessor = new MLProcessor.constructor();
      const layout = { ilots: testUtils.createMockIlots(3) };
      const floorPlan = testUtils.createMockFloorPlan();

      await expect(uninitializedProcessor.scoreLayout(layout, floorPlan))
        .rejects
        .toThrow('Layout optimizer model is not initialized');
    });
  });
});
