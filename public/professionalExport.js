// Professional Export - DXF, PDF with vectors, High-res images
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';
import { InteractiveSVGExporter } from './svgExporter.js';

export class ProfessionalExport {
    constructor(renderer) {
        this.renderer = renderer;
        this.interactiveSVGExporter = new InteractiveSVGExporter(renderer);
    }

    async exportSVG() {
        const svgRenderer = new SVGRenderer();
        svgRenderer.setSize(this.renderer.container.clientWidth, this.renderer.container.clientHeight);

        const camera = this.renderer.is3DMode ? this.renderer.perspectiveCamera : this.renderer.camera;
        svgRenderer.render(this.renderer.scene, camera);

        const svgElement = svgRenderer.domElement;
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svgElement);

        return svgString;
    }

    downloadSVG(filename = 'floorplan.svg') {
        this.exportSVG().then(svg => {
            const blob = new Blob([svg], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
        });
    }

    downloadInteractiveSVG(filename = 'floorplan-interactive.svg') {
        this.interactiveSVGExporter.downloadSVG(filename);
    }

    async exportDXF(floorPlan, ilots, corridors) {
        let dxf = '0\nSECTION\n2\nENTITIES\n';

        // Export walls
        if (floorPlan.walls) {
            floorPlan.walls.forEach(wall => {
                if (wall.start && wall.end) {
                    dxf += `0\nLINE\n8\nWALLS\n10\n${wall.start.x}\n20\n${wall.start.y}\n11\n${wall.end.x}\n21\n${wall.end.y}\n`;
                }
            });
        }

        // Export ilots as rectangles
        ilots.forEach((ilot, i) => {
            const points = [
                [ilot.x, ilot.y],
                [ilot.x + ilot.width, ilot.y],
                [ilot.x + ilot.width, ilot.y + ilot.height],
                [ilot.x, ilot.y + ilot.height],
                [ilot.x, ilot.y]
            ];

            dxf += `0\nPOLYLINE\n8\nILOTS\n66\n1\n70\n1\n`;
            points.forEach(pt => {
                dxf += `0\nVERTEX\n8\nILOTS\n10\n${pt[0]}\n20\n${pt[1]}\n`;
            });
            dxf += `0\nSEQEND\n`;

            // Add text label
            dxf += `0\nTEXT\n8\nLABELS\n10\n${ilot.x + ilot.width / 2}\n20\n${ilot.y + ilot.height / 2}\n40\n0.5\n1\nIlot ${i + 1}\n`;
        });

        // Export corridors
        corridors.forEach(corridor => {
            if (corridor.polygon) {
                dxf += `0\nPOLYLINE\n8\nCORRIDORS\n66\n1\n70\n1\n`;
                corridor.polygon.forEach(pt => {
                    const x = Array.isArray(pt) ? pt[0] : pt.x;
                    const y = Array.isArray(pt) ? pt[1] : pt.y;
                    dxf += `0\nVERTEX\n8\nCORRIDORS\n10\n${x}\n20\n${y}\n`;
                });
                dxf += `0\nSEQEND\n`;
            }
        });

        dxf += '0\nENDSEC\n0\nEOF\n';
        return dxf;
    }

    downloadDXF(floorPlan, ilots, corridors, filename = 'floorplan.dxf') {
        this.exportDXF(floorPlan, ilots, corridors).then(dxf => {
            const blob = new Blob([dxf], { type: 'application/dxf' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
        });
    }

    exportHighResPNG(width = 4096, height = 4096) {
        return this.renderer.exportImage(width, height);
    }

    downloadHighResPNG(width = 4096, height = 4096, filename = 'floorplan_4k.png') {
        const dataURL = this.exportHighResPNG(width, height);
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = filename;
        link.click();
    }

    async exportPrintablePDF(floorPlan, ilots, corridors) {
        // Generate SVG first for vector quality
        const svg = await this.exportSVG();

        // Send to backend for PDF generation with proper scaling
        const API = window.__API_BASE__ || 'http://localhost:3001';
        const response = await fetch(`${API}/api/export/pdf-vector`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                svg,
                floorPlan,
                ilots,
                corridors,
                metadata: {
                    title: 'Floor Plan Layout',
                    date: new Date().toISOString(),
                    ilotCount: ilots.length,
                    totalArea: floorPlan.totalArea
                }
            })
        });

        return response;
    }
}
