const CrossFloorRouter = require('../../../lib/crossFloorRouter');

describe('CrossFloorRouter', () => {
    const connectors = [
        { id: 'c0', floorLevel: 0, centroid: { x: 0, y: 0 }, type: 'stair' },
        { id: 'c1', floorLevel: 1, centroid: { x: 1, y: 0 }, type: 'stair' },
        { id: 'c2', floorLevel: 2, centroid: { x: 2, y: 0 }, type: 'stair' },
        { id: 'c3', floorLevel: 2, centroid: { x: 5, y: 5 }, type: 'elevator' }
    ];

    const edges = [
        { from: 'c0', to: 'c1' },
        { from: 'c1', to: 'c2' }
    ];

    it('computes multi-floor routes with segments', () => {
        const result = CrossFloorRouter.computeRoutes([], connectors, edges, { floorHeight: 3 });
        expect(result).toBeTruthy();
        expect(Array.isArray(result.routes)).toBe(true);
        expect(Array.isArray(result.segments)).toBe(true);
        expect(result.routes.length).toBeGreaterThan(0);
        expect(result.segments.length).toBeGreaterThan(0);
    });

    it('gracefully handles missing connectors', () => {
        const emptyResult = CrossFloorRouter.computeRoutes([], [], [], {});
        expect(emptyResult.summary.routeCount).toBe(0);
        expect(emptyResult.summary.segmentCount).toBe(0);
    });
});
