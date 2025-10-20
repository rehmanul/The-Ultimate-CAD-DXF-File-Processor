/**
 * Unit Tests for DXF Color Table
 */

const dxfColorTable = require('../../../lib/dxfColorTable');

describe('DXF Color Table', () => {
    describe('getRGB', () => {
        test('should return correct RGB for standard colors', () => {
            const red = dxfColorTable.getRGB(1);
            expect(red.r).toBe(255);
            expect(red.g).toBe(0);
            expect(red.b).toBe(0);
            expect(red.name).toBe('Red');

            const blue = dxfColorTable.getRGB(5);
            expect(blue.r).toBe(0);
            expect(blue.g).toBe(0);
            expect(blue.b).toBe(255);
            expect(blue.name).toBe('Blue');

            const black = dxfColorTable.getRGB(0);
            expect(black.r).toBe(0);
            expect(black.g).toBe(0);
            expect(black.b).toBe(0);
        });

        test('should handle out of range indices', () => {
            const result = dxfColorTable.getRGB(-1);
            expect(result).toBeDefined();
            expect(result.r).toBeDefined();

            const result2 = dxfColorTable.getRGB(300);
            expect(result2).toBeDefined();
        });

        test('should have all 256 colors defined', () => {
            for (let i = 0; i <= 255; i++) {
                const color = dxfColorTable.getRGB(i);
                expect(color).toBeDefined();
                expect(color.r).toBeGreaterThanOrEqual(0);
                expect(color.r).toBeLessThanOrEqual(255);
                expect(color.g).toBeGreaterThanOrEqual(0);
                expect(color.g).toBeLessThanOrEqual(255);
                expect(color.b).toBeGreaterThanOrEqual(0);
                expect(color.b).toBeLessThanOrEqual(255);
            }
        });
    });

    describe('getIndexFromRGB', () => {
        test('should find exact color matches', () => {
            const redIndex = dxfColorTable.getIndexFromRGB(255, 0, 0);
            expect(redIndex).toBe(1);

            const blueIndex = dxfColorTable.getIndexFromRGB(0, 0, 255);
            expect([5, 170]).toContain(blueIndex); // Could be 5 or 170 (both pure blue)
        });

        test('should find closest match for approximate colors', () => {
            const almostRed = dxfColorTable.getIndexFromRGB(250, 10, 10);
            const redIndex = dxfColorTable.getIndexFromRGB(255, 0, 0);
            expect(Math.abs(almostRed - redIndex)).toBeLessThan(20);
        });

        test('should handle grayscale colors', () => {
            const gray = dxfColorTable.getIndexFromRGB(128, 128, 128);
            expect(gray).toBeDefined();
            expect(gray).toBeGreaterThanOrEqual(0);
            expect(gray).toBeLessThanOrEqual(255);
        });
    });

    describe('classifyByColor', () => {
        test('should classify red colors as entrance', () => {
            const result = dxfColorTable.classifyByColor(1);
            expect(result.type).toBe('entrance');
            expect(result.confidence).toBeGreaterThanOrEqual(0.7);

            const result2 = dxfColorTable.classifyByColor(10);
            expect(result2.type).toBe('entrance');
        });

        test('should classify blue colors as forbidden', () => {
            const result = dxfColorTable.classifyByColor(5);
            expect(result.type).toBe('forbidden');
            expect(result.confidence).toBeGreaterThanOrEqual(0.7);

            const result2 = dxfColorTable.classifyByColor(140);
            expect(result2.type).toBe('forbidden');
        });

        test('should classify black/gray colors as wall', () => {
            const result = dxfColorTable.classifyByColor(0);
            expect(result.type).toBe('wall');

            const result2 = dxfColorTable.classifyByColor(8);
            expect(result2.type).toBe('wall');

            const result3 = dxfColorTable.classifyByColor(250);
            expect(result3.type).toBe('wall');
        });

        test('should return confidence scores', () => {
            const result = dxfColorTable.classifyByColor(1);
            expect(result.confidence).toBeGreaterThan(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
        });
    });

    describe('normalizeDXFColor', () => {
        test('should handle color indices directly', () => {
            expect(dxfColorTable.normalizeDXFColor(1)).toBe(1);
            expect(dxfColorTable.normalizeDXFColor(5)).toBe(5);
            expect(dxfColorTable.normalizeDXFColor(255)).toBe(255);
        });

        test('should convert RGB integer to index', () => {
            const redRGB = 0xFF0000; // 16711680
            const index = dxfColorTable.normalizeDXFColor(redRGB);
            expect(index).toBe(1); // Should map to red

            const blueRGB = 0x0000FF; // 255
            const blueIndex = dxfColorTable.normalizeDXFColor(blueRGB);
            expect([5, 170]).toContain(blueIndex);
        });

        test('should handle invalid values', () => {
            const result = dxfColorTable.normalizeDXFColor(-1);
            expect(result).toBe(0);

            const result2 = dxfColorTable.normalizeDXFColor(null);
            expect(result2).toBe(0);
        });
    });

    describe('getHexColor', () => {
        test('should return hex color strings', () => {
            const red = dxfColorTable.getHexColor(1);
            expect(red).toBe('#ff0000');

            const blue = dxfColorTable.getHexColor(5);
            expect(blue).toBe('#0000ff');

            const white = dxfColorTable.getHexColor(7);
            expect(white).toBe('#ffffff');
        });

        test('should handle all color indices', () => {
            for (let i = 0; i <= 255; i++) {
                const hex = dxfColorTable.getHexColor(i);
                expect(hex).toMatch(/^#[0-9a-f]{6}$/);
            }
        });
    });

    describe('semantic mappings', () => {
        test('should have entrance colors mapped', () => {
            const entranceColors = dxfColorTable.semanticMappings.entrance;
            expect(entranceColors).toContain(1); // Red
            expect(entranceColors.length).toBeGreaterThan(0);
        });

        test('should have forbidden colors mapped', () => {
            const forbiddenColors = dxfColorTable.semanticMappings.forbidden;
            expect(forbiddenColors).toContain(5); // Blue
            expect(forbiddenColors.length).toBeGreaterThan(0);
        });

        test('should have wall colors mapped', () => {
            const wallColors = dxfColorTable.semanticMappings.wall;
            expect(wallColors).toContain(0); // Black
            expect(wallColors.length).toBeGreaterThan(0);
        });
    });
});
