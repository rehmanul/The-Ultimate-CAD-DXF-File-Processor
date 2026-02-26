// Interactive SVG Exporter for COSTO
// Generates SVG with embedded tooltips and click interactions

export class InteractiveSVGExporter {
    constructor(renderer) {
        this.renderer = renderer;
    }

    /**
     * Export floor plan as interactive SVG
     * @param {Object} options - Export options
     * @returns {string} SVG content
     */
    async exportInteractiveSVG(options = {}) {
        const {
            includeWalls = true,
            includeIlots = true,
            includeCorridors = true,
            includeLabels = true,
            bounds = null,
            title = 'Floor Plan Export',
            showTooltips = true,
            fidelity = 'render',
            width: captureWidth = null,
            height: captureHeight = null
        } = options;

        // High-fidelity mode: use the exact rendered canvas as SVG image payload.
        if (fidelity === 'render') {
            const capture = await this._captureRendererPng(captureWidth, captureHeight);
            const dataUrl = capture && typeof capture === 'object' ? capture.dataUrl : capture;
            if (!dataUrl) {
                throw new Error('Renderer capture failed for SVG export.');
            }
            const width = capture && typeof capture === 'object' ? capture.width : null;
            const height = capture && typeof capture === 'object' ? capture.height : null;
            return this._buildImageWrappedSvg(dataUrl, title, width, height);
        }

        const floorPlan = this.renderer;
        const actualBounds = bounds || this.calculateBounds();

        // Calculate dimensions
        const width = actualBounds.maxX - actualBounds.minX;
        const height = actualBounds.maxY - actualBounds.minY;
        const padding = Math.max(width, height) * 0.1;

        const svgWidth = width + (padding * 2);
        const svgHeight = height + (padding * 2);

        // Start SVG
        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}" height="${svgHeight}" 
     viewBox="${actualBounds.minX - padding} ${actualBounds.minY - padding} ${svgWidth} ${svgHeight}"
     xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink">
    
    <title>${this.escapeXML(title)}</title>
    
    <defs>
        <!-- Styles -->
        <style type="text/css"><![CDATA[
            .wall { fill: none; stroke: #000000; stroke-width: 0.15; }
            .entrance { fill: none; stroke: #ff6b6b; stroke-width: 0.1; }
            .ilot { fill: #10b981; fill-opacity: 0.7; stroke: #000000; stroke-width: 0.05; cursor: pointer; transition: all 0.2s; }
            .ilot:hover { fill: #059669; fill-opacity: 0.9; stroke-width: 0.1; }
            .ilot.selected { fill: #3b82f6; fill-opacity: 0.9; stroke: #1e40af; stroke-width: 0.15; }
            .corridor { fill: none; stroke: #ec4899; stroke-width: 0.1; stroke-dasharray: 0.3,0.2; }
            .label { fill: #1f2937; font-family: Arial, sans-serif; font-size: 0.4px; text-anchor: middle; pointer-events: none; }
            .tooltip { fill: white; stroke: #d1d5db; stroke-width: 0.02; filter: drop-shadow(0 0.1px 0.2px rgba(0,0,0,0.3)); }
            .tooltip-text { fill: #1f2937; font-family: Arial, sans-serif; font-size: 0.3px; }
            .hidden { display: none; }
        ]]></style>
        
        <!-- Box Shadow Filter -->
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.1"/>
            <feOffset dx="0" dy="0.05" result="offsetblur"/>
            <feComponentTransfer>
                <feFuncA type="linear" slope="0.3"/>
            </feComponentTransfer>
            <feMerge>
                <feMergeNode/>
                <feMergeNode in="SourceGraphic"/>
            </feMerge>
        </filter>
    </defs>
    
    <!-- Background -->
    <rect x="${actualBounds.minX - padding}" y="${actualBounds.minY - padding}" 
          width="${svgWidth}" height="${svgHeight}" fill="#fafafa"/>
    
    <g id="floorplan">
`;

        // Add walls
        if (includeWalls && floorPlan.wallsGroup) {
            svg += this.renderWallsToSVG(floorPlan);
        }

        // Add corridors
        if (includeCorridors && floorPlan.corridorsGroup) {
            svg += this.renderCorridorsToSVG(floorPlan);
        }

        // Add ilots with interactivity
        if (includeIlots && floorPlan.ilotMeshes) {
            svg += this.renderIlotsToSVG(floorPlan.ilotMeshes, showTooltips);
        }

        // Close SVG
        svg += `    </g>
    
    <!-- Interactive tooltip (hidden by default) -->
    <g id="tooltip" class="hidden">
        <rect class="tooltip" x="0" y="0" width="4" height="2" rx="0.1"/>
        <text class="tooltip-text" x="0.2" y="0.6"></text>
    </g>
    
    <script type="text/javascript"><![CDATA[
        // Interactive behavior
        (function() {
            var tooltip = document.getElementById('tooltip');
            var tooltipRect = tooltip.querySelector('rect');
            var tooltipText = tooltip.querySelector('text');
            var selectedIlot = null;
            
            // Ilot click handler
            document.querySelectorAll('.ilot').forEach(function(ilot) {
                ilot.addEventListener('click', function() {
                    if (selectedIlot) {
                        selectedIlot.classList.remove('selected');
                    }
                    selectedIlot = ilot;
                    ilot.classList.add('selected');
                    
                    // Show info panel (could be customized)
                    var info = ilot.getAttribute('data-info');
                    console.log('Selected:', info);
                });
                
                ilot.addEventListener('mouseenter', function(e) {
                    var info = ilot.getAttribute('data-info');
                    tooltipText.textContent = info;
                    
                    var bbox = ilot.getBBox();
                    tooltipRect.setAttribute('x', bbox.x + bbox.width / 2 - 2);
                    tooltipRect.setAttribute('y', bbox.y - 0.5);
                    tooltipText.setAttribute('x', bbox.x + bbox.width / 2 - 2 + 0.2);
                    tooltipText.setAttribute('y', bbox.y - 0.5 + 0.6);
                    
                    tooltip.classList.remove('hidden');
                });
                
                ilot.addEventListener('mouseleave', function() {
                    tooltip.classList.add('hidden');
                });
            });
        })();
    ]]></script>
</svg>`;

        return svg;
    }

    renderWallsToSVG(floorPlan) {
        let svg = '        <g id="walls" class="walls-layer">\n';

        this._getGroupMeshes(floorPlan.wallsGroup).forEach(child => {
            const points = this._extractPoints(child);
            if (points.length >= 2) {
                const polyline = points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
                svg += `            <polyline class="wall" points="${polyline}"/>\n`;
            }
        });

        svg += '        </g>\n';
        return svg;
    }

    renderCorridorsToSVG(floorPlan) {
        let svg = '        <g id="corridors" class="corridors-layer">\n';

        this._getGroupMeshes(floorPlan.corridorsGroup).forEach(child => {
            const points = this._extractPoints(child);
            if (points.length >= 2) {
                const first = points[0];
                const last = points[points.length - 1];
                svg += `            <line class="corridor" x1="${first.x.toFixed(2)}" y1="${first.y.toFixed(2)}" x2="${last.x.toFixed(2)}" y2="${last.y.toFixed(2)}"/>\n`;
            }
        });

        svg += '        </g>\n';
        return svg;
    }

    renderIlotsToSVG(ilotMeshes, showTooltips) {
        let svg = '        <g id="ilots" class="ilots-layer">\n';

        ilotMeshes.forEach((mesh, index) => {
            const ilot = mesh.userData.ilot;
            if (!ilot) return;

            const x = ilot.x.toFixed(2);
            const y = ilot.y.toFixed(2);
            const w = ilot.width.toFixed(2);
            const h = ilot.height.toFixed(2);
            const area = (ilot.area || ilot.width * ilot.height).toFixed(2);
            const type = ilot.type || 'unknown';

            const info = `Box ${index + 1}: ${area}m² (${w}×${h}) - ${type}`;

            svg += `            <rect class="ilot" 
                   x="${x}" y="${y}" width="${w}" height="${h}" 
                   data-id="${index}" 
                   data-area="${area}" 
                   data-type="${type}"
                   data-info="${this.escapeXML(info)}"
                   filter="url(#shadow)"/>\n`;

            // Add label
            const labelX = (parseFloat(x) + parseFloat(w) / 2).toFixed(2);
            const labelY = (parseFloat(y) + parseFloat(h) / 2).toFixed(2);
            svg += `            <text class="label" x="${labelX}" y="${labelY}">${area}m²</text>\n`;
        });

        svg += '        </g>\n';
        return svg;
    }

    calculateBounds() {
        const floorPlan = this.renderer;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        // Check all mesh groups
        [floorPlan.wallsGroup, floorPlan.ilotsGroup, floorPlan.corridorsGroup].forEach(group => {
            this._getGroupMeshes(group).forEach(child => {
                const bounds = this._extractBounds(child);
                if (!bounds) return;
                minX = Math.min(minX, bounds.minX);
                minY = Math.min(minY, bounds.minY);
                maxX = Math.max(maxX, bounds.maxX);
                maxY = Math.max(maxY, bounds.maxY);
            });
        });

        if (!isFinite(minX)) {
            return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }

        return { minX, minY, maxX, maxY };
    }

    escapeXML(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Download SVG as file
     */
    async downloadSVG(filename = 'floorplan.svg', options = {}) {
        const svgContent = await this.exportInteractiveSVG(options);
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    async _captureRendererPng(width = null, height = null) {
        try {
            if (!this.renderer) return null;
            const targetWidth = Number.isFinite(width) ? width : Math.max(2048, Math.round((this.renderer.container?.clientWidth || 800) * 2));
            const targetHeight = Number.isFinite(height) ? height : Math.max(1536, Math.round((this.renderer.container?.clientHeight || 600) * 2));

            if (typeof this.renderer.captureImageData === 'function') {
                const dataUrl = await this.renderer.captureImageData(targetWidth, targetHeight, true);
                return { dataUrl, width: targetWidth, height: targetHeight };
            }
            if (typeof this.renderer.exportImage === 'function') {
                const dataUrl = await this.renderer.exportImage(targetWidth, targetHeight, { download: false, useActiveCamera: true });
                return { dataUrl, width: targetWidth, height: targetHeight };
            }
            if (this.renderer._canvas && typeof this.renderer._canvas.toDataURL === 'function') {
                return {
                    dataUrl: this.renderer._canvas.toDataURL('image/png'),
                    width: this.renderer._canvas.width || targetWidth,
                    height: this.renderer._canvas.height || targetHeight
                };
            }
        } catch (error) {
            console.error('SVG fidelity capture failed:', error);
        }
        return null;
    }

    _buildImageWrappedSvg(dataUrl, title = 'Floor Plan Export', width = null, height = null) {
        const safeWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : 4096;
        const safeHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : 4096;
        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">
  <title>${this.escapeXML(title)}</title>
  <rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" fill="#ffffff"/>
  <image href="${dataUrl}" xlink:href="${dataUrl}" x="0" y="0" width="${safeWidth}" height="${safeHeight}" preserveAspectRatio="none"/>
</svg>`;
    }

    _getGroupMeshes(group) {
        if (!group) return [];
        if (Array.isArray(group.children)) return group.children;
        if (typeof group.getChildMeshes === 'function') return group.getChildMeshes(false);
        return [];
    }

    _extractPoints(mesh) {
        // Three.js path
        if (mesh?.geometry?.attributes?.position?.array) {
            const positions = mesh.geometry.attributes.position.array;
            const points = [];
            for (let i = 0; i < positions.length; i += 3) {
                points.push({ x: Number(positions[i]) || 0, y: Number(positions[i + 1]) || 0 });
            }
            return points;
        }

        // Babylon.js path
        if (mesh && typeof mesh.getVerticesData === 'function' && typeof BABYLON !== 'undefined') {
            const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            if (positions && positions.length >= 6) {
                const points = [];
                for (let i = 0; i < positions.length; i += 3) {
                    points.push({ x: Number(positions[i]) || 0, y: Number(positions[i + 1]) || 0 });
                }
                return points;
            }
        }

        return [];
    }

    _extractBounds(mesh) {
        // Babylon.js bounds
        if (mesh && typeof mesh.getBoundingInfo === 'function') {
            const info = mesh.getBoundingInfo();
            const box = info?.boundingBox;
            const min = box?.minimumWorld;
            const max = box?.maximumWorld;
            if (min && max) {
                return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
            }
        }

        // Three.js bounds
        if (mesh?.geometry) {
            mesh.geometry.computeBoundingBox?.();
            const box = mesh.geometry.boundingBox;
            if (box) {
                const px = mesh?.position?.x || 0;
                const py = mesh?.position?.y || 0;
                return {
                    minX: px + box.min.x,
                    minY: py + box.min.y,
                    maxX: px + box.max.x,
                    maxY: py + box.max.y
                };
            }
        }
        return null;
    }
}
