/**
 * COSTO Professional Output – Wall Dimension Annotator
 * =====================================================
 * Utility that computes and renders wall dimension annotations
 * exactly matching the reference architectural drawing.
 *
 * Features:
 *   - Extracts wall segment lengths from floor plan data
 *   - Groups collinear segments and renders dimension chains
 *   - Renders exterior dimensions (outside the building envelope)
 *   - Renders interior box dimensions (W×H inside each box)
 *   - Renders SP: area total annotations in each zone
 *
 * Usage (in costoExports.js drawEnhancedFloorPlanToPDF):
 *   const annotator = new WallDimensionAnnotator(page, font, scale, offsetX, offsetY);
 *   await annotator.annotate(floorPlan, solution, options);
 */
'use strict';

const { rgb, degrees, StandardFonts } = require('pdf-lib');

class WallDimensionAnnotator {
    constructor(page, font, boldFont, scale, offsetX, offsetY, bounds) {
        this.page     = page;
        this.font     = font;
        this.boldFont = boldFont;
        this.scale    = scale;
        this.offsetX  = offsetX;
        this.offsetY  = offsetY;
        this.bounds   = bounds;

        // Colors matching reference
        this.DIM_COLOR     = rgb(0.30, 0.30, 0.35);
        this.RED_COLOR     = rgb(0.85, 0.08, 0.08);
        this.BLUE_COLOR    = rgb(0.00, 0.00, 0.80);
        this.AREA_COLOR    = rgb(0.00, 0.00, 0.00);
        this.TICK_H        = 3;   // pt — tick mark height at dimension ends
        this.DIM_FONT_SIZE = 5;   // pt
        this.BOX_FONT_SIZE = 4.5; // pt (inside box)
        this.AREA_FONT_SIZE= 7.5; // pt
        this.DIM_OFFSET    = 8;   // pt — offset from geometry
    }

    // ── PDF coordinate transform ─────────────────────────────────────────────
    tx(x) { return this.offsetX + (x - this.bounds.minX) * this.scale; }
    ty(y) { return this.offsetY + (y - this.bounds.minY) * this.scale; }

    // ── Draw a single dimension tick mark ────────────────────────────────────
    _drawTick(x, y, horizontal) {
        if (horizontal) {
            this.page.drawLine({ start: {x, y: y - this.TICK_H/2}, end: {x, y: y + this.TICK_H/2}, thickness: 0.5, color: this.DIM_COLOR });
        } else {
            this.page.drawLine({ start: {x: x - this.TICK_H/2, y}, end: {x: x + this.TICK_H/2, y}, thickness: 0.5, color: this.DIM_COLOR });
        }
    }

    // ── Draw a horizontal dimension line with text ────────────────────────────
    _drawHDim(x1, x2, y, label) {
        if (Math.abs(x2 - x1) < 3) return; // Too small to draw
        const mid = (x1 + x2) / 2;
        this.page.drawLine({ start: {x: x1, y}, end: {x: x2, y}, thickness: 0.4, color: this.DIM_COLOR });
        this._drawTick(x1, y, true);
        this._drawTick(x2, y, true);
        const tw = label.length * this.DIM_FONT_SIZE * 0.55;
        this.page.drawText(label, {
            x: mid - tw / 2, y: y + 1.5,
            size: this.DIM_FONT_SIZE, font: this.font, color: this.DIM_COLOR
        });
    }

    // ── Draw a vertical dimension line with text ──────────────────────────────
    _drawVDim(y1, y2, x, label) {
        if (Math.abs(y2 - y1) < 3) return;
        const mid = (y1 + y2) / 2;
        this.page.drawLine({ start: {x, y: y1}, end: {x, y: y2}, thickness: 0.4, color: this.DIM_COLOR });
        this._drawTick(x, y1, false);
        this._drawTick(x, y2, false);
        this.page.drawText(label, {
            x: x + 2, y: mid - this.DIM_FONT_SIZE / 2,
            size: this.DIM_FONT_SIZE, font: this.font, color: this.DIM_COLOR
        });
    }

    // ── Annotate wall segment lengths along all four edges ────────────────────
    annotateWallDimensions(walls) {
        if (!walls || !walls.length) return;
        const B = this.bounds;
        const edgeTol = 1.5; // m — how close to the bounding edge

        // Partition walls by which edge they run along
        const topWalls    = [], bottomWalls = [], leftWalls = [], rightWalls = [];
        for (const w of walls) {
            if (!w.start || !w.end) continue;
            const sx = w.start.x, sy = w.start.y, ex = w.end.x, ey = w.end.y;
            const isH = Math.abs(ey - sy) < edgeTol && Math.abs(ex - sx) > 0.2;
            const isV = Math.abs(ex - sx) < edgeTol && Math.abs(ey - sy) > 0.2;
            if (isH) {
                if (Math.abs(sy - B.minY) < edgeTol && Math.abs(ey - B.minY) < edgeTol) bottomWalls.push(w);
                if (Math.abs(sy - B.maxY) < edgeTol && Math.abs(ey - B.maxY) < edgeTol) topWalls.push(w);
            }
            if (isV) {
                if (Math.abs(sx - B.minX) < edgeTol && Math.abs(ex - B.minX) < edgeTol) leftWalls.push(w);
                if (Math.abs(sx - B.maxX) < edgeTol && Math.abs(ex - B.maxX) < edgeTol) rightWalls.push(w);
            }
        }

        const dimY_bottom = this.ty(B.minY) - this.DIM_OFFSET * 2;
        const dimY_top    = this.ty(B.maxY) + this.DIM_OFFSET * 2;
        const dimX_left   = this.tx(B.minX) - this.DIM_OFFSET * 2;
        const dimX_right  = this.tx(B.maxX) + this.DIM_OFFSET * 2;

        const renderHDimChain = (wallList, dimY) => {
            const segs = wallList.map(w => [
                Math.min(w.start.x, w.end.x),
                Math.max(w.start.x, w.end.x)
            ]).sort((a, b) => a[0] - b[0]);
            for (const [x1, x2] of segs) {
                const len = x2 - x1;
                if (len < 0.1) continue;
                this._drawHDim(this.tx(x1), this.tx(x2), dimY, `${len.toFixed(2)}`);
            }
        };

        const renderVDimChain = (wallList, dimX) => {
            const segs = wallList.map(w => [
                Math.min(w.start.y, w.end.y),
                Math.max(w.start.y, w.end.y)
            ]).sort((a, b) => a[0] - b[0]);
            for (const [y1, y2] of segs) {
                const len = y2 - y1;
                if (len < 0.1) continue;
                this._drawVDim(this.ty(y1), this.ty(y2), dimX, `${len.toFixed(2)}`);
            }
        };

        renderHDimChain(bottomWalls, dimY_bottom);
        renderHDimChain(topWalls,    dimY_top);
        renderVDimChain(leftWalls,   dimX_left);
        renderVDimChain(rightWalls,  dimX_right);
    }

    // ── Annotate box interior dimensions (W×H label) ──────────────────────────
    annotateBoxDimensions(boxes, showNumbering = true) {
        for (const box of boxes) {
            const x  = this.tx(box.x);
            const y  = this.ty(box.y + box.height);   // PDF Y is flipped
            const w  = box.width  * this.scale;
            const h  = box.height * this.scale;
            if (w < 8 || h < 8) continue; // Too small

            // Width dimension at bottom of box
            const wLabel = `${(box.width).toFixed(2)}`;
            const wTW    = wLabel.length * this.BOX_FONT_SIZE * 0.55;
            this.page.drawText(wLabel, {
                x: x + w / 2 - wTW / 2,
                y: y - this.BOX_FONT_SIZE - 1,
                size: this.BOX_FONT_SIZE, font: this.font, color: this.DIM_COLOR
            });

            // Height dimension on left side of box (rotated)
            const hLabel = `${(box.height).toFixed(2)}`;
            this.page.drawText(hLabel, {
                x: x + 1.5,
                y: y + h / 2 - this.BOX_FONT_SIZE / 2,
                size: this.BOX_FONT_SIZE, font: this.font, color: this.DIM_COLOR,
                rotate: degrees(90)
            });

            // Area label in red (matching reference exactly)
            if (box.area || (box.width * box.height)) {
                const area     = box.area || (box.width * box.height);
                const aLabel   = `${area.toFixed(2)}m²`;
                const aTW      = aLabel.length * this.BOX_FONT_SIZE * 0.55;
                this.page.drawText(aLabel, {
                    x: x + w / 2 - aTW / 2,
                    y: y + h + 1,
                    size: this.BOX_FONT_SIZE, font: this.font, color: this.RED_COLOR
                });
            }
        }
    }

    // ── Annotate zone totals (SP: XXX.XXm²) ──────────────────────────────────
    annotateZoneAreas(boxes, zoneLabel = null) {
        // Group boxes by zone
        const zones = new Map();
        for (const box of boxes) {
            const zone = box.zone || 'default';
            if (!zones.has(zone)) zones.set(zone, []);
            zones.get(zone).push(box);
        }

        for (const [zone, zoneBoxes] of zones) {
            const totalArea = zoneBoxes.reduce((s, b) => s + (b.area || b.width * b.height), 0);
            const cx = zoneBoxes.reduce((s, b) => s + b.x + b.width / 2, 0) / zoneBoxes.length;
            const cy = zoneBoxes.reduce((s, b) => s + b.y + b.height / 2, 0) / zoneBoxes.length;
            const px = this.tx(cx);
            const py = this.ty(cy);
            const label = `SP : ${totalArea.toFixed(2)}m²`;
            const lw = label.length * this.AREA_FONT_SIZE * 0.58;
            const lh = this.AREA_FONT_SIZE + 4;

            // White background box
            this.page.drawRectangle({
                x: px - lw / 2 - 4, y: py - lh / 2 - 2,
                width: lw + 8, height: lh + 2,
                color: rgb(1, 1, 1)
            });
            this.page.drawText(label, {
                x: px - lw / 2, y: py - this.AREA_FONT_SIZE / 2,
                size: this.AREA_FONT_SIZE, font: this.boldFont, color: this.BLUE_COLOR
            });
        }
    }
}

module.exports = WallDimensionAnnotator;
