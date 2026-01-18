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
    exportInteractiveSVG(options = {}) {
        const {
            includeWalls = true,
            includeIlots = true,
            includeCorridors = true,
            includeLabels = true,
            bounds = null,
            title = 'Floor Plan Export',
            showTooltips = true
        } = options;

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

        floorPlan.wallsGroup.children.forEach(child => {
            if (child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
                const positions = child.geometry.attributes.position.array;
                if (positions.length >= 4) {
                    const points = [];
                    for (let i = 0; i < positions.length; i += 3) {
                        points.push(`${positions[i].toFixed(2)},${positions[i + 1].toFixed(2)}`);
                    }
                    svg += `            <polyline class="wall" points="${points.join(' ')}"/>\n`;
                }
            }
        });

        svg += '        </g>\n';
        return svg;
    }

    renderCorridorsToSVG(floorPlan) {
        let svg = '        <g id="corridors" class="corridors-layer">\n';

        floorPlan.corridorsGroup.children.forEach(child => {
            if (child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
                const positions = child.geometry.attributes.position.array;
                if (positions.length >= 6) {
                    svg += `            <line class="corridor" x1="${positions[0].toFixed(2)}" y1="${positions[1].toFixed(2)}" x2="${positions[3].toFixed(2)}" y2="${positions[4].toFixed(2)}"/>\n`;
                }
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
            if (!group) return;
            group.children.forEach(child => {
                if (child.geometry) {
                    child.geometry.computeBoundingBox();
                    const box = child.geometry.boundingBox;
                    if (box) {
                        minX = Math.min(minX, child.position.x + box.min.x);
                        minY = Math.min(minY, child.position.y + box.min.y);
                        maxX = Math.max(maxX, child.position.x + box.max.x);
                        maxY = Math.max(maxY, child.position.y + box.max.y);
                    }
                }
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
    downloadSVG(filename = 'floorplan.svg', options = {}) {
        const svgContent = this.exportInteractiveSVG(options);
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }
}
