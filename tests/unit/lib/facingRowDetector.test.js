/**
 * Unit Tests for Facing Row Detector
 */

const FacingRowDetector = require('../../../lib/facingRowDetector');

describe('FacingRowDetector', () => {
    let mockIlots;

    beforeEach(() => {
        // Create mock îlots in two facing rows
        mockIlots = [
            // Row 1 (top)
            { x: 0, y: 0, width: 2, height: 1 },
            { x: 3, y: 0, width: 2, height: 1 },
            { x: 6, y: 0, width: 2, height: 1 },
            // Row 2 (bottom, facing row 1)
            { x: 0, y: 5, width: 2, height: 1 },
            { x: 3, y: 5, width: 2, height: 1 },
            { x: 6, y: 5, width: 2, height: 1 }
        ];
    });

    describe('constructor', () => {
        test('should initialize with default options', () => {
            const detector = new FacingRowDetector(mockIlots);
            expect(detector.ilots).toBe(mockIlots);
            expect(detector.rowTolerance).toBe(3.0);
            expect(detector.minRowDistance).toBe(1.5);
            expect(detector.maxRowDistance).toBe(8.0);
        });

        test('should accept custom options', () => {
            const options = {
                rowTolerance: 2.0,
                minRowDistance: 2.0,
                maxRowDistance: 10.0,
                minOverlap: 0.7
            };
            const detector = new FacingRowDetector(mockIlots, options);
            expect(detector.rowTolerance).toBe(2.0);
            expect(detector.minRowDistance).toBe(2.0);
            expect(detector.maxRowDistance).toBe(10.0);
            expect(detector.minOverlap).toBe(0.7);
        });
    });

    describe('groupIntoRows', () => {
        test('should group îlots into rows by Y coordinate', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();

            expect(rows.length).toBe(2);
            expect(rows[0].ilots.length).toBe(3);
            expect(rows[1].ilots.length).toBe(3);
        });

        test('should calculate row bounds correctly', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();

            const row1 = rows[0];
            expect(row1.minX).toBe(0);
            expect(row1.maxX).toBe(8); // Last îlot at x=6 with width=2
            expect(row1.width).toBe(8);
        });

        test('should calculate row density', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();

            rows.forEach(row => {
                expect(row.density).toBeGreaterThan(0);
                expect(row.density).toBe(row.ilots.length / row.width);
            });
        });

        test('should calculate alignment score', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();

            rows.forEach(row => {
                expect(row.alignment).toBeGreaterThan(0);
                expect(row.alignment).toBeLessThanOrEqual(1);
            });
        });

        test('should handle single îlot', () => {
            const singleIlot = [{ x: 0, y: 0, width: 2, height: 1 }];
            const detector = new FacingRowDetector(singleIlot);
            const rows = detector.groupIntoRows();

            expect(rows.length).toBe(1);
            expect(rows[0].ilots.length).toBe(1);
        });

        test('should handle empty îlots array', () => {
            const detector = new FacingRowDetector([]);
            const rows = detector.groupIntoRows();

            expect(rows.length).toBe(0);
        });

        test('should separate rows with sufficient Y distance', () => {
            const separatedIlots = [
                { x: 0, y: 0, width: 2, height: 1 },
                { x: 0, y: 10, width: 2, height: 1 } // Far apart
            ];
            const detector = new FacingRowDetector(separatedIlots);
            const rows = detector.groupIntoRows();

            expect(rows.length).toBe(2);
        });
    });

    describe('findFacingPairs', () => {
        test('should find facing row pairs', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();
            const pairs = detector.findFacingPairs(rows);

            expect(pairs.length).toBeGreaterThan(0);
            expect(pairs[0].isFacing).toBe(true);
        });

        test('should calculate distance between rows', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();
            const pairs = detector.findFacingPairs(rows);

            expect(pairs[0].distance).toBeGreaterThan(0);
            expect(pairs[0].distance).toBeCloseTo(4.5, 1); // Roughly 5 - 0.5
        });

        test('should calculate overlap ratio', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();
            const pairs = detector.findFacingPairs(rows);

            expect(pairs[0].overlapRatio).toBeGreaterThan(0);
            expect(pairs[0].overlapRatio).toBeLessThanOrEqual(1);
        });

        test('should calculate quality score', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();
            const pairs = detector.findFacingPairs(rows);

            expect(pairs[0].qualityScore).toBeGreaterThan(0);
            expect(pairs[0].qualityScore).toBeLessThanOrEqual(1);
        });

        test('should sort pairs by quality score', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();
            const pairs = detector.findFacingPairs(rows);

            if (pairs.length > 1) {
                for (let i = 0; i < pairs.length - 1; i++) {
                    expect(pairs[i].qualityScore).toBeGreaterThanOrEqual(pairs[i + 1].qualityScore);
                }
            }
        });

        test('should not find pairs when rows are too far apart', () => {
            const farIlots = [
                { x: 0, y: 0, width: 2, height: 1 },
                { x: 0, y: 20, width: 2, height: 1 } // 20m apart (> maxRowDistance)
            ];
            const detector = new FacingRowDetector(farIlots);
            const rows = detector.groupIntoRows();
            const pairs = detector.findFacingPairs(rows);

            expect(pairs.length).toBe(0);
        });

        test('should not find pairs when rows dont overlap', () => {
            const nonOverlappingIlots = [
                { x: 0, y: 0, width: 2, height: 1 },
                { x: 10, y: 3, width: 2, height: 1 } // No X overlap
            ];
            const detector = new FacingRowDetector(nonOverlappingIlots);
            const rows = detector.groupIntoRows();
            const pairs = detector.findFacingPairs(rows);

            expect(pairs.length).toBe(0);
        });
    });

    describe('analyzeRowRelationship', () => {
        test('should detect facing rows with good overlap', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();
            const relationship = detector.analyzeRowRelationship(rows[0], rows[1]);

            expect(relationship.isFacing).toBe(true);
            expect(relationship.overlapRatio).toBeGreaterThan(0.5);
        });

        test('should provide corridor position', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();
            const relationship = detector.analyzeRowRelationship(rows[0], rows[1]);

            expect(relationship.corridorPosition).toBeDefined();
            expect(relationship.corridorPosition.x).toBeDefined();
            expect(relationship.corridorPosition.y).toBeDefined();
            expect(relationship.corridorPosition.width).toBeDefined();
        });

        test('should calculate corridor position between rows', () => {
            const detector = new FacingRowDetector(mockIlots);
            const rows = detector.groupIntoRows();
            const relationship = detector.analyzeRowRelationship(rows[0], rows[1]);

            const { corridorPosition } = relationship;
            expect(corridorPosition.y).toBeGreaterThan(rows[0].maxY);
            expect(corridorPosition.y).toBeLessThan(rows[1].minY);
        });
    });

    describe('detectFacingRows', () => {
        test('should return complete results', () => {
            const detector = new FacingRowDetector(mockIlots);
            const result = detector.detectFacingRows();

            expect(result.rows).toBeDefined();
            expect(result.facingPairs).toBeDefined();
            expect(result.statistics).toBeDefined();
        });

        test('should calculate statistics', () => {
            const detector = new FacingRowDetector(mockIlots);
            const result = detector.detectFacingRows();

            const stats = result.statistics;
            expect(stats.totalIlots).toBe(mockIlots.length);
            expect(stats.totalRows).toBeGreaterThan(0);
            expect(stats.rowCoverage).toBeGreaterThan(0);
            expect(stats.rowCoverage).toBeLessThanOrEqual(1);
        });
    });

    describe('generateCorridorRecommendations', () => {
        test('should generate corridor recommendations', () => {
            const detector = new FacingRowDetector(mockIlots);
            const result = detector.generateCorridorRecommendations(1.5);

            expect(result.recommendations).toBeDefined();
            expect(result.recommendations.length).toBeGreaterThan(0);
        });

        test('should generate corridors with correct dimensions', () => {
            const corridorWidth = 2.0;
            const detector = new FacingRowDetector(mockIlots);
            const result = detector.generateCorridorRecommendations(corridorWidth);

            result.recommendations.forEach(rec => {
                expect(rec.height).toBeLessThanOrEqual(corridorWidth);
                expect(rec.height).toBeGreaterThan(0);
            });
        });

        test('should generate horizontal corridors', () => {
            const detector = new FacingRowDetector(mockIlots);
            const result = detector.generateCorridorRecommendations(1.5);

            result.recommendations.forEach(rec => {
                expect(rec.type).toBe('horizontal');
                expect(rec.orientation).toBe('horizontal');
            });
        });

        test('should include priority scores', () => {
            const detector = new FacingRowDetector(mockIlots);
            const result = detector.generateCorridorRecommendations(1.5);

            result.recommendations.forEach(rec => {
                expect(rec.priority).toBeDefined();
                expect(rec.priority).toBeGreaterThan(0);
                expect(rec.priority).toBeLessThanOrEqual(1);
            });
        });

        test('should generate valid polygons', () => {
            const detector = new FacingRowDetector(mockIlots);
            const result = detector.generateCorridorRecommendations(1.5);

            result.recommendations.forEach(rec => {
                expect(rec.polygon).toBeDefined();
                expect(rec.polygon.length).toBe(4); // Rectangle
                rec.polygon.forEach(point => {
                    expect(point.length).toBe(2); // [x, y]
                });
            });
        });
    });

    describe('visualizeRows', () => {
        test('should generate ASCII visualization', () => {
            const detector = new FacingRowDetector(mockIlots);
            const visualization = detector.visualizeRows();

            expect(typeof visualization).toBe('string');
            expect(visualization).toContain('ROW VISUALIZATION');
            expect(visualization).toContain('FACING PAIRS');
        });

        test('should include row information', () => {
            const detector = new FacingRowDetector(mockIlots);
            const visualization = detector.visualizeRows();

            expect(visualization).toContain('Total rows:');
            expect(visualization).toContain('îlots');
        });
    });

    describe('edge cases', () => {
        test('should handle single row', () => {
            const singleRow = [
                { x: 0, y: 0, width: 2, height: 1 },
                { x: 3, y: 0, width: 2, height: 1 }
            ];
            const detector = new FacingRowDetector(singleRow);
            const result = detector.detectFacingRows();

            expect(result.rows.length).toBe(1);
            expect(result.facingPairs.length).toBe(0);
        });

        test('should handle three rows with multiple facing pairs', () => {
            const threeRows = [
                { x: 0, y: 0, width: 2, height: 1 },
                { x: 0, y: 3, width: 2, height: 1 },
                { x: 0, y: 6, width: 2, height: 1 }
            ];
            const detector = new FacingRowDetector(threeRows);
            const result = detector.detectFacingRows();

            expect(result.rows.length).toBe(3);
            expect(result.facingPairs.length).toBeGreaterThan(0);
        });

        test('should handle irregular îlot sizes', () => {
            const irregularIlots = [
                { x: 0, y: 0, width: 1, height: 1 },
                { x: 2, y: 0, width: 3, height: 0.5 },
                { x: 6, y: 0, width: 2, height: 1.5 }
            ];
            const detector = new FacingRowDetector(irregularIlots);
            const result = detector.detectFacingRows();

            expect(result.rows.length).toBeGreaterThan(0);
        });
    });
});
