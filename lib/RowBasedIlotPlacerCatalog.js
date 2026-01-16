/*
 * RowBasedIlotPlacerCatalog
 *
 * This class is a variant of RowBasedIlotPlacer that uses a configurable
 * catalog of unit definitions instead of arbitrary area ranges. It supports
 * selecting unit types based on a requested distribution and ensures that
 * the generated îlots conform to the catalog’s dimensions and door widths.
 */

const defaultCatalog = require('./unitCatalog');

class RowBasedIlotPlacerCatalog {
  /**
   * Create a new ilot placer.
   * @param {Object} floorPlan The normalized floor plan (walls, forbidden zones, bounds, rooms).
   * @param {Object} options Options controlling generation.
   * @param {Object} [options.catalog] Custom unit catalog. If omitted, the default catalog is used.
   * @param {Object} [options.distribution] A mapping of unit type keys to weights (e.g., {S: 0.3, M: 0.4, L: 0.3}).
   * @param {number} [options.corridorWidth] Corridor width in meters.
   * @param {number} [options.wallMargin] Margin from walls in meters.
   */
  constructor(floorPlan, options = {}) {
    this.floorPlan = floorPlan || {};
    this.catalog = options.catalog || defaultCatalog;
    this.distribution = options.distribution || { S: 0.3, M: 0.4, L: 0.3 };
    this.corridorWidth = typeof options.corridorWidth === 'number' ? options.corridorWidth : 1.5;
    this.wallMargin = typeof options.wallMargin === 'number' ? options.wallMargin : 0.5;
    this.rooms = floorPlan.rooms || [];
    this.walls = floorPlan.walls || [];
    this.forbiddenZones = floorPlan.forbiddenZones || [];
    this.entrances = floorPlan.entrances || [];
  }

  /**
   * Generate ilots using the catalog and distribution.
   * @param {number} [targetCount] Desired number of units.
   * @returns {Array} Array of ilot objects with x, y, width, height, area, type and catalog properties.
   */
  generateIlots(targetCount = 50) {
    const ilots = [];
    // Determine how many units of each type should be generated based on distribution
    const typeCounts = {};
    const typeKeys = Object.keys(this.distribution);
    let totalWeight = 0;
    typeKeys.forEach((type) => { totalWeight += this.distribution[type]; });
    typeKeys.forEach((type) => {
      typeCounts[type] = Math.round((this.distribution[type] / totalWeight) * targetCount);
    });
    // For each room, place units
    if (this.rooms.length > 0) {
      this.rooms.forEach((room) => {
        const bounds = room.bounds || this._polygonToBounds(room.polygon);
        if (!bounds) return;
        // Fill the room with units based on remaining counts
        this._fillRoomWithCatalog(room, bounds, typeCounts, ilots);
      });
    }
    // If we have not reached targetCount, place remaining in bounds
    const totalPlaced = ilots.length;
    if (totalPlaced < targetCount) {
      const remaining = targetCount - totalPlaced;
      const bounds = this.floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      this._fillBoundsWithCatalog(bounds, typeCounts, remaining, ilots);
    }
    return ilots;
  }

  /**
   * Place units inside a room respecting wall margins.
   * @private
   */
  _fillRoomWithCatalog(room, bounds, typeCounts, ilots) {
    const minX = bounds.minX + this.wallMargin;
    const maxX = bounds.maxX - this.wallMargin;
    const minY = bounds.minY + this.wallMargin;
    const maxY = bounds.maxY - this.wallMargin;
    let x = minX;
    let y = minY;
    let rowMaxHeight = 0;
    // Keep placing until no more space
    while (y < maxY) {
      // Choose next type based on remaining counts
      const type = this._selectType(typeCounts);
      if (!type) break;
      const unitDef = this.catalog[type];
      // Choose dimension template randomly
      const template = unitDef.dimensions[Math.floor(Math.random() * unitDef.dimensions.length)];
      const width = template.width;
      const height = template.depth;
      // Move to next row if insufficient horizontal space
      if (x + width > maxX) {
        x = minX;
        y += rowMaxHeight + this.corridorWidth;
        rowMaxHeight = 0;
        continue;
      }
      // Break if vertical space exhausted
      if (y + height > maxY) break;
      // Check for collisions with walls/forbidden zones/entrances
      if (this._collidesWithForbidden(x, y, width, height) || this._collidesWithEntrance(x, y, width, height)) {
        x += width + this.corridorWidth;
        continue;
      }
      // Place the unit
      ilots.push({
        type,
        x,
        y,
        width,
        height,
        area: width * height,
        catalog: unitDef
      });
      // Update counts and positions
      typeCounts[type] = Math.max(0, typeCounts[type] - 1);
      rowMaxHeight = Math.max(rowMaxHeight, height);
      x += width + this.corridorWidth;
    }
  }

  /**
   * Place remaining units in the overall floor bounds.
   * @private
   */
  _fillBoundsWithCatalog(bounds, typeCounts, remaining, ilots) {
    const minX = bounds.minX + this.wallMargin;
    const maxX = bounds.maxX - this.wallMargin;
    const minY = bounds.minY + this.wallMargin;
    const maxY = bounds.maxY - this.wallMargin;
    let x = minX;
    let y = minY;
    let rowMaxHeight = 0;
    let placed = 0;
    while (placed < remaining && y < maxY) {
      const type = this._selectType(typeCounts);
      if (!type) break;
      const unitDef = this.catalog[type];
      const template = unitDef.dimensions[Math.floor(Math.random() * unitDef.dimensions.length)];
      const width = template.width;
      const height = template.depth;
      if (x + width > maxX) {
        x = minX;
        y += rowMaxHeight + this.corridorWidth;
        rowMaxHeight = 0;
        continue;
      }
      if (y + height > maxY) break;
      if (this._collidesWithForbidden(x, y, width, height) || this._collidesWithEntrance(x, y, width, height)) {
        x += width + this.corridorWidth;
        continue;
      }
      ilots.push({
        type,
        x,
        y,
        width,
        height,
        area: width * height,
        catalog: unitDef
      });
      typeCounts[type] = Math.max(0, typeCounts[type] - 1);
      rowMaxHeight = Math.max(rowMaxHeight, height);
      x += width + this.corridorWidth;
      placed++;
    }
  }

  /**
   * Select a unit type with remaining count based on distribution.
   * @private
   */
  _selectType(typeCounts) {
    const types = Object.keys(typeCounts).filter((t) => typeCounts[t] > 0);
    if (types.length === 0) return null;
    const total = types.reduce((sum, t) => sum + typeCounts[t], 0);
    let r = Math.random() * total;
    for (const type of types) {
      r -= typeCounts[type];
      if (r < 0) return type;
    }
    return types[0];
  }

  /**
   * Determine if a proposed box collides with a forbidden zone.
   * @private
   */
  _collidesWithForbidden(x, y, w, h) {
    // Simple axis-aligned bounding box collision
    return (this.forbiddenZones || []).some((z) => {
      return x < z.end.x && x + w > z.start.x && y < z.end.y && y + h > z.start.y;
    });
  }

  /**
   * Determine if a proposed box collides with an entrance.
   * @private
   */
  _collidesWithEntrance(x, y, w, h) {
    return (this.entrances || []).some((e) => {
      return x < e.end.x && x + w > e.start.x && y < e.end.y && y + h > e.start.y;
    });
  }

  /**
   * Compute bounding box from polygon if provided.
   * @private
   */
  _polygonToBounds(polygon) {
    if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polygon.forEach((pt) => {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    });
    return { minX, minY, maxX, maxY };
  }
}

module.exports = RowBasedIlotPlacerCatalog;
