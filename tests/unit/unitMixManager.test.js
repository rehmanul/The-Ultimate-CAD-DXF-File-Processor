const unitMixManager = require('../../lib/unitMixManager');
const assert = require('assert');

// Simple CSV Parser test since we don't have proper mock setup in this environment easily
// We will test if parseMix calls the internal parsers correctly and validates output.

describe('UnitMixManager', () => {

    it('should parse a valid CSV buffer', () => {
        const csvContent = 'type,target_area,tolerance,priority\nBox1,5,5%,1\nBox2,10,10%,2';
        const buffer = Buffer.from(csvContent);

        const result = unitMixManager.parseMix(buffer, 'text/csv');

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].type, 'Box1');
        assert.strictEqual(result[0].targetArea, 5);
        assert.strictEqual(result[0].tolerance.type, 'percentage');
        assert.strictEqual(result[0].tolerance.value, 5);
        assert.strictEqual(result[0].priority, 1);

        assert.strictEqual(result[1].type, 'Box2');
        assert.strictEqual(result[1].targetArea, 10);
        assert.strictEqual(result[1].priority, 2);
    });

    it('should handle different column casing', () => {
        const csvContent = 'Type,Target Area,Tolerance,Priority\nBox1,5,5%,1';
        const buffer = Buffer.from(csvContent);

        const result = unitMixManager.parseMix(buffer, 'text/csv');

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].type, 'Box1');
        assert.strictEqual(result[0].targetArea, 5);
    });

    it('should validate missing required fields', () => {
        const csvContent = 'type,tolerance\nBox1,5%'; // Missing target_area/count
        const buffer = Buffer.from(csvContent);

        try {
            unitMixManager.parseMix(buffer, 'text/csv');
            assert.fail('Should have thrown error');
        } catch (e) {
            assert.ok(e.message.toLowerCase().includes('validation failed'), 'Error message should indicate validation failure: ' + e.message);
            assert.ok(e.message.includes('Must specify either "target_area" or "target_count"'), 'Error should mention missing area/count');
        }
    });

    it('should handle invalid number format', () => {
         const csvContent = 'type,target_area,tolerance\nBox1,abc,5%';
         const buffer = Buffer.from(csvContent);

         try {
            unitMixManager.parseMix(buffer, 'text/csv');
            assert.fail('Should have thrown error');
        } catch (e) {
            assert.ok(e.message.toLowerCase().includes('validation failed'), 'Error message should indicate validation failure: ' + e.message);
            assert.ok(e.message.includes('Invalid "target_area"'), 'Error should mention invalid area');
        }
    });

    it('should handle percentage tolerance correctly', () => {
        const csvContent = 'type,target_area,tolerance\nBox1,10,5%';
        const buffer = Buffer.from(csvContent);
        const result = unitMixManager.parseMix(buffer, 'text/csv');
        assert.strictEqual(result[0].tolerance.type, 'percentage');
        assert.strictEqual(result[0].tolerance.value, 5);
    });

    it('should handle absolute tolerance correctly', () => {
        const csvContent = 'type,target_area,tolerance\nBox1,10,0.5';
        const buffer = Buffer.from(csvContent);
        const result = unitMixManager.parseMix(buffer, 'text/csv');
        assert.strictEqual(result[0].tolerance.type, 'absolute');
        assert.strictEqual(result[0].tolerance.value, 0.5);
    });
});
