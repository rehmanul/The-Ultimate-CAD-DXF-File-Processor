// Text Labels and Annotations (Babylon.js version)
// NOTE: This module is currently disabled (textLabels = null) in COSTO mode.
// Provided for API compatibility only.

export class TextLabels {
    constructor(renderer) {
        this.renderer = renderer;
        this.font = null;
        this.labels = [];
    }

    loadFont() { /* no-op — canvas text used instead */ }

    addIlotLabel(ilot, index) {
        const label = this.renderer.createTextSprite(`Ilot ${index + 1}`, {
            fontSize: 24, fontColor: '#000000', backgroundColor: 'rgba(255,255,255,0.9)', padding: 4
        });
        label.position = new BABYLON.Vector3(ilot.x + ilot.width / 2, ilot.y + ilot.height / 2, 0.15);
        label.scaling = new BABYLON.Vector3(3, 1.5, 1);
        label.parent = this.renderer.labelsGroup;
        this.labels.push(label);
    }

    addDimensionLine(start, end, label) {
        this.renderer._createLineMesh([
            { x: start.x, y: start.y, z: 0 },
            { x: end.x, y: end.y, z: 0 }
        ], 0x000000, this.renderer.labelsGroup);
        const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        const sprite = this.renderer.createTextSprite(label, {
            fontSize: 24, fontColor: '#000000', backgroundColor: 'rgba(255,255,255,1)', padding: 4
        });
        sprite.position = new BABYLON.Vector3(mid.x, mid.y, 0.1);
        sprite.scaling = new BABYLON.Vector3(5, 1.25, 1);
        sprite.parent = this.renderer.labelsGroup;
        this.labels.push(sprite);
    }

    addRoomLabel(room, index) {
        if (!room.polygon || room.polygon.length === 0) return;
        let cx, cy;
        if (room.bounds) { cx = (room.bounds.minX + room.bounds.maxX) / 2; cy = (room.bounds.minY + room.bounds.maxY) / 2; }
        else {
            let sx = 0, sy = 0;
            room.polygon.forEach(pt => { sx += Array.isArray(pt) ? pt[0] : pt.x; sy += Array.isArray(pt) ? pt[1] : pt.y; });
            cx = sx / room.polygon.length; cy = sy / room.polygon.length;
        }
        const label = this.renderer.createTextSprite(`Room ${index + 1} — ${room.area?.toFixed(1) || 'N/A'} m²`, {
            fontSize: 32, fontColor: '#000000', backgroundColor: 'rgba(255,255,255,0.9)', padding: 4
        });
        label.position = new BABYLON.Vector3(cx, cy, 0.2);
        label.scaling = new BABYLON.Vector3(10, 2.5, 1);
        label.parent = this.renderer.labelsGroup;
        this.labels.push(label);
    }

    clear() {
        this.labels.forEach(l => { if (l.dispose) l.dispose(); });
        this.labels = [];
    }

    setVisible(visible) {
        this.renderer.labelsGroup.setEnabled(visible);
        this.renderer.render();
    }
}
