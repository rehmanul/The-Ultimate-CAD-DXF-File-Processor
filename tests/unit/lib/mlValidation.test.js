const ArchitecturalValidator = require('../../../lib/architecturalValidator');
const AnnotationAndCorrection = require('../../../lib/annotationAndCorrection');

describe('ML Validation Systems', () => {
    const mockFloorPlan = {
        rooms: [
            { id: 'room1', type: 'office', area: 60, bounds: { minX: 0, minY: 0, maxX: 6, maxY: 10 } },
            { id: 'room2', type: 'meeting', area: 150, bounds: { minX: 10, minY: 0, maxX: 20, maxY: 15 } }
        ],
        corridors: [
            { id: 'corridor1', width: 2.5 }
        ],
        entrances: [
            { id: 'entrance1', width: 2 }
        ],
    };

    it('ArchitecturalValidator should identify issues', () => {
        const validator = new ArchitecturalValidator(mockFloorPlan);
        const report = validator.validate();
        expect(report.isValid).toBe(false);
        expect(report.issues.length).toBe(4);
    });

    it('AnnotationAndCorrection should generate suggestions', () => {
        const validator = new ArchitecturalValidator(mockFloorPlan);
        const report = validator.validate();
        const corrector = new AnnotationAndCorrection(mockFloorPlan, report.issues);
        const suggestions = corrector.generateSuggestions();
        expect(suggestions.length).toBe(4);
    });
});
