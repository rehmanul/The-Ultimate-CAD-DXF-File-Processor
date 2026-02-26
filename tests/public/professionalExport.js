// Professional Export (Babylon.js)
// Provides production SVG, DXF, and high-res PNG export.

import { InteractiveSVGExporter } from './svgExporter.js';

export class ProfessionalExport {
    constructor(renderer) {
        this.renderer = renderer;
        this.interactiveSVGExporter = new InteractiveSVGExporter(renderer);
    }

    async exportSVG(options = {}) {
        if (this.interactiveSVGExporter && typeof this.interactiveSVGExporter.exportInteractiveSVG === 'function') {
            return await this.interactiveSVGExporter.exportInteractiveSVG(options);
        }
        if (this.interactiveSVGExporter && typeof this.interactiveSVGExporter.export === 'function') {
            return this.interactiveSVGExporter.export(options);
        }
        throw new Error('SVG exporter is not available.');
    }

    async downloadSVG(filename = 'floorplan.svg', options = {}) {
        try {
            const svgData = await this.exportSVG(options);
            if (svgData) {
                const blob = new Blob([svgData], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; a.click();
                URL.revokeObjectURL(url);
            }
        } catch (e) {
            console.error('SVG export failed:', e);
        }
    }

    downloadDXF(floorPlan, ilots, corridors, filename = 'floorplan.dxf') {
        try {
            let dxf = '0\nSECTION\n2\nENTITIES\n';
            if (floorPlan.walls) {
                floorPlan.walls.forEach(w => {
                    if (w.start && w.end) {
                        dxf += `0\nLINE\n8\nWALLS\n10\n${w.start.x}\n20\n${w.start.y}\n30\n0\n11\n${w.end.x}\n21\n${w.end.y}\n31\n0\n`;
                    }
                });
            }
            if (ilots) {
                ilots.forEach(il => {
                    const x2 = il.x + il.width, y2 = il.y + il.height;
                    dxf += `0\nLWPOLYLINE\n8\nILOTS\n70\n1\n90\n4\n10\n${il.x}\n20\n${il.y}\n10\n${x2}\n20\n${il.y}\n10\n${x2}\n20\n${y2}\n10\n${il.x}\n20\n${y2}\n`;
                });
            }
            dxf += '0\nENDSEC\n0\nEOF\n';
            const blob = new Blob([dxf], { type: 'application/dxf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename; a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('DXF export failed:', e);
        }
    }

    async downloadHighResPNG(width = 4096, height = 4096, filename = 'floorplan_4k.png') {
        try {
            const dataUrl = await this.renderer.exportImage(width, height, {
                download: false,
                useActiveCamera: true
            });
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = filename;
            a.click();
        } catch (e) {
            console.error('High-res PNG export failed:', e);
        }
    }
}
