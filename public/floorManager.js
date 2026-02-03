/**
 * PHASE 5: FloorManager - Multi-Floor Support
 * Manages multiple floors for professional building plans
 */

export class FloorManager {
    constructor() {
        this.floors = [];
        this.activeFloorIndex = 0;
        this.totalBuildingArea = 0;
    }

    /**
     * Add a new floor to the building
     * @param {Object} floorData - Floor data { name, floorPlan, ilots, corridors, exclusionZones }
     * @returns {number} Index of added floor
     */
    addFloor(floorData) {
        const floor = {
            id: `FLOOR_${this.floors.length}`,
            name: floorData.name || `ETAGE ${String(this.floors.length).padStart(2, '0')}`,
            floorPlan: floorData.floorPlan,
            ilots: floorData.ilots || [],
            corridors: floorData.corridors || [],
            exclusionZones: floorData.exclusionZones || [],
            radiators: floorData.radiators || [],
            bounds: floorData.bounds || floorData.floorPlan?.bounds,
            area: 0,
            usableArea: 0,
            createdAt: new Date().toISOString()
        };

        // Calculate floor areas
        if (floor.bounds) {
            const { minX, maxX, minY, maxY } = floor.bounds;
            floor.area = (maxX - minX) * (maxY - minY);
        }

        floor.usableArea = floor.ilots.reduce((sum, ilot) => sum + (ilot.area || 0), 0);

        this.floors.push(floor);
        this.updateTotalArea();

        console.log(`[FloorManager] Added floor "${floor.name}" with ${floor.ilots.length} ilots, ${floor.area.toFixed(1)}m²`);
        return this.floors.length - 1;
    }

    /**
     * Update floor data
     */
    updateFloor(index, updates) {
        if (index >= 0 && index < this.floors.length) {
            Object.assign(this.floors[index], updates);

            // Recalculate usable area
            if (updates.ilots) {
                this.floors[index].usableArea = updates.ilots.reduce((sum, ilot) => sum + (ilot.area || 0), 0);
            }

            this.updateTotalArea();
        }
    }

    /**
     * Switch active floor
     */
    switchFloor(index) {
        if (index >= 0 && index < this.floors.length) {
            this.activeFloorIndex = index;
            console.log(`[FloorManager] Switched to floor "${this.floors[index].name}"`);
            return this.floors[index];
        }
        return null;
    }

    /**
     * Get active floor data
     */
    getActiveFloor() {
        return this.floors[this.activeFloorIndex] || null;
    }

    /**
     * Remove floor by index
     */
    removeFloor(index) {
        if (index >= 0 && index < this.floors.length) {
            const removed = this.floors.splice(index, 1)[0];
            if (this.activeFloorIndex >= this.floors.length) {
                this.activeFloorIndex = Math.max(0, this.floors.length - 1);
            }
            this.updateTotalArea();
            console.log(`[FloorManager] Removed floor "${removed.name}"`);
            return removed;
        }
        return null;
    }

    /**
     * Calculate total building area across all floors
     */
    updateTotalArea() {
        this.totalBuildingArea = this.floors.reduce((sum, floor) => sum + (floor.area || 0), 0);
    }

    /**
     * Get building summary statistics
     */
    getSummary() {
        const totalIlots = this.floors.reduce((sum, floor) => sum + floor.ilots.length, 0);
        const totalUsableArea = this.floors.reduce((sum, floor) => sum + (floor.usableArea || 0), 0);

        return {
            floorCount: this.floors.length,
            totalBuildingArea: this.totalBuildingArea,
            totalUsableArea,
            totalIlots,
            utilization: this.totalBuildingArea > 0
                ? (totalUsableArea / this.totalBuildingArea * 100).toFixed(1) + '%'
                : '0%',
            floors: this.floors.map((f, i) => ({
                index: i,
                name: f.name,
                area: f.area,
                usableArea: f.usableArea,
                ilotCount: f.ilots.length,
                isActive: i === this.activeFloorIndex
            }))
        };
    }

    /**
     * Export all floors data for PDF/Excel
     */
    exportAllFloors() {
        return {
            buildingSummary: this.getSummary(),
            floors: this.floors.map(floor => ({
                name: floor.name,
                id: floor.id,
                bounds: floor.bounds,
                area: floor.area,
                usableArea: floor.usableArea,
                ilots: floor.ilots,
                corridors: floor.corridors,
                exclusionZones: floor.exclusionZones,
                radiators: floor.radiators
            })),
            exportedAt: new Date().toISOString()
        };
    }

    /**
     * Clear all floors
     */
    clear() {
        this.floors = [];
        this.activeFloorIndex = 0;
        this.totalBuildingArea = 0;
        console.log('[FloorManager] Cleared all floors');
    }
}

// Export singleton instance
export const floorManager = new FloorManager();
