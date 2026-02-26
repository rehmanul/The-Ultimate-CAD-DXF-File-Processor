class SpatialGrid {
    constructor(bounds, cellSize = 5) {
        this.bounds = bounds;
        this.cellSize = cellSize;
        this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
        this.rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cellSize));
        this.cells = new Map(); // key: `${col}_${row}` -> array of items
    }

    _keyForXY(x, y) {
        const col = Math.floor((x - this.bounds.minX) / this.cellSize);
        const row = Math.floor((y - this.bounds.minY) / this.cellSize);
        return `${col}_${row}`;
    }

    _cellsForRect(rect) {
        const col1 = Math.floor((rect.x1 - this.bounds.minX) / this.cellSize);
        const col2 = Math.floor((rect.x2 - this.bounds.minX) / this.cellSize);
        const row1 = Math.floor((rect.y1 - this.bounds.minY) / this.cellSize);
        const row2 = Math.floor((rect.y2 - this.bounds.minY) / this.cellSize);
        const keys = [];
        for (let c = col1; c <= col2; c++) {
            for (let r = row1; r <= row2; r++) {
                keys.push(`${c}_${r}`);
            }
        }
        return keys;
    }

    insert(item) {
        // item must have x, y, width, height
        const rect = { x1: item.x, y1: item.y, x2: item.x + item.width, y2: item.y + item.height };
        const keys = this._cellsForRect(rect);
        for (const k of keys) {
            if (!this.cells.has(k)) this.cells.set(k, []);
            this.cells.get(k).push(item);
        }
    }

    queryRect(rect) {
        const keys = this._cellsForRect(rect);
        const results = new Set();
        for (const k of keys) {
            const arr = this.cells.get(k);
            if (!arr) continue;
            for (const it of arr) results.add(it);
        }
        return Array.from(results);
    }

    clear() {
        this.cells.clear();
    }
}

module.exports = SpatialGrid;
