/**
 * Unit Tests for Enhanced ML Training Data Generator
 */

const EnhancedMLTrainingDataGenerator = require('../../../lib/enhancedMLTrainingDataGenerator');

describe('EnhancedMLTrainingDataGenerator', () => {
    describe('generateCompleteTrainingData', () => {
        test('should generate complete training dataset', () => {
            const samples = 100;
            const data = EnhancedMLTrainingDataGenerator.generateCompleteTrainingData(samples);

            expect(data).toHaveProperty('rooms');
            expect(data).toHaveProperty('furniture');
            expect(data).toHaveProperty('layouts');
            expect(data).toHaveProperty('cadEntities');
        });

        test('should generate correct number of samples', () => {
            const samples = 50;
            const data = EnhancedMLTrainingDataGenerator.generateCompleteTrainingData(samples);

            expect(data.rooms.length).toBe(samples);
            expect(data.furniture.length).toBe(samples);
            expect(data.cadEntities.length).toBe(samples);
        });

        test('should generate fewer layout samples', () => {
            const samples = 100;
            const data = EnhancedMLTrainingDataGenerator.generateCompleteTrainingData(samples);

            expect(data.layouts.length).toBe(10); // 10% of samples
        });
    });

    describe('generateRoomClassificationData', () => {
        test('should generate room classification data', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateRoomClassificationData(samples);

            expect(data.length).toBe(samples);
            data.forEach(sample => {
                expect(sample).toHaveProperty('features');
                expect(sample).toHaveProperty('label');
                expect(sample.features.length).toBe(5); // area, aspectRatio, adjacency, distance, perimeter
            });
        });

        test('should generate valid room types', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateRoomClassificationData(samples);

            data.forEach(sample => {
                expect(sample.label).toBeGreaterThanOrEqual(0);
                expect(sample.label).toBeLessThan(8); // 8 room types
            });
        });

        test('should generate realistic area values', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateRoomClassificationData(samples);

            data.forEach(sample => {
                const area = sample.features[0];
                expect(area).toBeGreaterThan(0);
                expect(area).toBeLessThan(300); // Reasonable room size
            });
        });
    });

    describe('generateRoomFeatures', () => {
        test('should generate office features correctly', () => {
            const features = EnhancedMLTrainingDataGenerator.generateRoomFeatures('office');

            const [area, aspectRatio, adjacency, distance, perimeter] = features;
            expect(area).toBeGreaterThanOrEqual(9);
            expect(area).toBeLessThanOrEqual(25);
            expect(aspectRatio).toBeGreaterThanOrEqual(1.2);
            expect(aspectRatio).toBeLessThanOrEqual(2.0);
        });

        test('should generate reception features with near entrance distance', () => {
            const features = EnhancedMLTrainingDataGenerator.generateRoomFeatures('reception');

            const distance = features[3];
            expect(distance).toBeGreaterThanOrEqual(0);
            expect(distance).toBeLessThanOrEqual(5); // Very close to entrance
        });

        test('should generate server room features with far entrance distance', () => {
            const features = EnhancedMLTrainingDataGenerator.generateRoomFeatures('server_room');

            const distance = features[3];
            expect(distance).toBeGreaterThanOrEqual(30); // Far from entrance
        });

        test('should generate restroom features with small area', () => {
            const features = EnhancedMLTrainingDataGenerator.generateRoomFeatures('restroom');

            const area = features[0];
            expect(area).toBeGreaterThanOrEqual(4);
            expect(area).toBeLessThanOrEqual(12);
        });

        test('should generate cafeteria features with large area', () => {
            const features = EnhancedMLTrainingDataGenerator.generateRoomFeatures('cafeteria');

            const area = features[0];
            expect(area).toBeGreaterThanOrEqual(50);
            expect(area).toBeLessThanOrEqual(200);
        });

        test('should calculate perimeter correctly', () => {
            const features = EnhancedMLTrainingDataGenerator.generateRoomFeatures('office');

            const [area, aspectRatio, , , perimeter] = features;
            const expectedPerimeter = 2 * Math.sqrt(area * aspectRatio) + 2 * Math.sqrt(area / aspectRatio);
            expect(Math.abs(perimeter - expectedPerimeter)).toBeLessThan(0.01);
        });
    });

    describe('generateFurniturePlacementData', () => {
        test('should generate furniture placement data', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateFurniturePlacementData(samples);

            expect(data.length).toBe(samples);
            data.forEach(sample => {
                expect(sample).toHaveProperty('features');
                expect(sample).toHaveProperty('label');
                expect(sample.features.length).toBe(5); // roomType, roomArea, width, height, furnitureType
                expect(sample.label.length).toBe(3); // [x, y, rotation]
            });
        });

        test('should generate normalized positions', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateFurniturePlacementData(samples);

            data.forEach(sample => {
                const [x, y, rotation] = sample.label;
                expect(x).toBeGreaterThanOrEqual(0);
                expect(x).toBeLessThanOrEqual(1);
                expect(y).toBeGreaterThanOrEqual(0);
                expect(y).toBeLessThanOrEqual(1);
            });
        });

        test('should generate valid rotation values', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateFurniturePlacementData(samples);

            data.forEach(sample => {
                const rotation = sample.label[2];
                expect(rotation).toBeGreaterThanOrEqual(0);
                expect(rotation).toBeLessThanOrEqual(Math.PI * 2);
            });
        });
    });

    describe('generateFurniturePlacement', () => {
        test('should place desk along walls in office', () => {
            const placement = EnhancedMLTrainingDataGenerator.generateFurniturePlacement('office', 10, 8, 'desk');

            const [x, y] = placement;
            // Should be near left or right wall
            expect(x < 0.3 || x > 0.7).toBe(true);
        });

        test('should place table in center of meeting room', () => {
            const placement = EnhancedMLTrainingDataGenerator.generateFurniturePlacement('meeting_room', 10, 8, 'table');

            const [x, y] = placement;
            // Should be relatively centered
            expect(x).toBeGreaterThan(0.2);
            expect(x).toBeLessThan(0.8);
            expect(y).toBeGreaterThan(0.2);
            expect(y).toBeLessThan(0.8);
        });
    });

    describe('generateLayoutOptimizationData', () => {
        test('should generate layout optimization data', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateLayoutOptimizationData(samples);

            expect(data.length).toBe(samples);
            data.forEach(sample => {
                expect(sample).toHaveProperty('features');
                expect(sample).toHaveProperty('label');
                expect(sample.features.length).toBe(3); // numRooms, totalArea, aspectRatio
            });
        });

        test('should generate quality scores between 0 and 1', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateLayoutOptimizationData(samples);

            data.forEach(sample => {
                expect(sample.label).toBeGreaterThanOrEqual(0);
                expect(sample.label).toBeLessThanOrEqual(1);
            });
        });
    });

    describe('calculateLayoutQuality', () => {
        test('should calculate quality score', () => {
            const score = EnhancedMLTrainingDataGenerator.calculateLayoutQuality(10, 300, 1.2);

            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
        });

        test('should give higher scores for balanced layouts', () => {
            const balanced = EnhancedMLTrainingDataGenerator.calculateLayoutQuality(15, 300, 1.0);
            const unbalanced = EnhancedMLTrainingDataGenerator.calculateLayoutQuality(5, 1000, 0.2);

            expect(balanced).toBeGreaterThan(unbalanced);
        });
    });

    describe('generateCADEntityData', () => {
        test('should generate CAD entity data', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateCADEntityData(samples);

            expect(data.length).toBe(samples);
            data.forEach(sample => {
                expect(sample).toHaveProperty('features');
                expect(sample).toHaveProperty('label');
                expect(sample.label).toBeGreaterThanOrEqual(0);
                expect(sample.label).toBeLessThan(5); // 5 entity types
            });
        });

        test('should generate valid entity features', () => {
            const samples = 10;
            const data = EnhancedMLTrainingDataGenerator.generateCADEntityData(samples);

            data.forEach(sample => {
                const features = sample.features;
                expect(features).toHaveProperty('layer');
                expect(features).toHaveProperty('color');
                expect(features).toHaveProperty('center');
                expect(features).toHaveProperty('area');
                expect(features).toHaveProperty('perimeter');
                expect(features).toHaveProperty('aspectRatio');
            });
        });
    });

    describe('generateEntityFeatures', () => {
        test('should generate wall features correctly', () => {
            const features = EnhancedMLTrainingDataGenerator.generateEntityFeatures('wall');

            expect(['WALLS', '0']).toContain(features.layer);
            expect([0, 7]).toContain(features.color);
            expect(features.aspectRatio).toBeGreaterThanOrEqual(10); // Long and thin
        });

        test('should generate entrance features correctly', () => {
            const features = EnhancedMLTrainingDataGenerator.generateEntityFeatures('entrance');

            expect(['DOOR', 'ENTRANCE']).toContain(features.layer);
            expect(features.color).toBe(1); // Red
        });

        test('should generate forbidden zone features correctly', () => {
            const features = EnhancedMLTrainingDataGenerator.generateEntityFeatures('forbidden');

            expect(['STAIRS', 'ELEVATOR']).toContain(features.layer);
            expect(features.color).toBe(5); // Blue
        });

        test('should generate column features as nearly square', () => {
            const features = EnhancedMLTrainingDataGenerator.generateEntityFeatures('column');

            expect(features.aspectRatio).toBeGreaterThanOrEqual(0.9);
            expect(features.aspectRatio).toBeLessThanOrEqual(1.1);
        });

        test('should generate window features as long and thin', () => {
            const features = EnhancedMLTrainingDataGenerator.generateEntityFeatures('window');

            expect(features.aspectRatio).toBeGreaterThanOrEqual(2);
        });
    });

    describe('data validation', () => {
        test('should generate consistent data across multiple calls', () => {
            const data1 = EnhancedMLTrainingDataGenerator.generateCompleteTrainingData(10);
            const data2 = EnhancedMLTrainingDataGenerator.generateCompleteTrainingData(10);

            expect(data1.rooms.length).toBe(data2.rooms.length);
            expect(data1.furniture.length).toBe(data2.furniture.length);
            expect(data1.cadEntities.length).toBe(data2.cadEntities.length);
        });

        test('should not have null or undefined values', () => {
            const data = EnhancedMLTrainingDataGenerator.generateCompleteTrainingData(10);

            data.rooms.forEach(sample => {
                expect(sample.features.every(f => f !== null && f !== undefined)).toBe(true);
                expect(sample.label).not.toBeNull();
                expect(sample.label).not.toBeUndefined();
            });
        });

        test('should generate realistic numeric values', () => {
            const data = EnhancedMLTrainingDataGenerator.generateCompleteTrainingData(10);

            data.rooms.forEach(sample => {
                sample.features.forEach(feature => {
                    expect(isNaN(feature)).toBe(false);
                    expect(isFinite(feature)).toBe(true);
                });
            });
        });
    });
});
