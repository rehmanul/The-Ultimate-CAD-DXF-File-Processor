# Reference Output Implementation Guide

## Overview

This document describes the implementation to match the COSTO V1 reference output (Image 1) with professional CAD formatting, complete corridor networks, and radiator paths.

## What Was Implemented

### 1. Radiator Generator (`lib/radiatorGenerator.js`)
**Purpose:** Generate RED ZIGZAG polylines along perimeter walls

**Features:**
- Identifies perimeter walls automatically
- Generates zigzag paths with configurable amplitude and frequency
- Offsets radiators from walls (default 30cm)
- Outputs path arrays compatible with DXF/PDF export

**Usage:**
```javascript
const RadiatorGenerator = require('./lib/radiatorGenerator');

const generator = new RadiatorGenerator(floorPlan, {
    zigzagAmplitude: 0.15,  // 15cm zigzag amplitude
    zigzagFrequency: 0.5,   // Zigzag every 50cm
    wallOffset: 0.3         // 30cm from wall
});

const radiators = generator.generateRadiators();
```

### 2. Advanced Corridor Network Generator (`lib/advancedCorridorNetworkGenerator.js`)
**Purpose:** Create complete circulation network with horizontal AND vertical corridors

**Features:**
- Generates vertical corridors between rows
- Generates horizontal corridors between columns
- Generates perimeter corridors around edges
- Connects corridors into continuous paths
- Outputs corner-based paths for proper rendering

**Improvements over basic generator:**
- Full network coverage (not just vertical gaps)
- Perimeter circulation paths
- Better connectivity between zones
- Corner-based path representation for dashed line rendering

**Usage:**
```javascript
const AdvancedCorridorNetworkGenerator = require('./lib/advancedCorridorNetworkGenerator');

const generator = new AdvancedCorridorNetworkGenerator(floorPlan, boxes, {
    corridorWidth: 1.2,
    margin: 0.2,
    minCorridorLength: 2.0
});

const corridors = generator.generateNetwork();
```

### 3. Complete Pipeline (`lib/costoCompletePipeline.js`)
**Purpose:** Integrate all components into a single processing pipeline

**Features:**
- Orchestrates corridor generation
- Orchestrates radiator generation
- Calculates comprehensive metrics
- Provides unified export interface
- Configurable options for all components

**Usage:**
```javascript
const CostoCompletePipeline = require('./lib/costoCompletePipeline');

const pipeline = new CostoCompletePipeline({
    corridorWidth: 1.2,
    useAdvancedCorridors: true,
    generateRadiators: true
});

// Process complete solution
const solution = await pipeline.processComplete(floorPlan, boxes, {
    metadata: {
        projectName: 'My Project',
        versionId: 'V1.0'
    }
});

// Export to PDF
const pdfBytes = await pipeline.exportToPDF(solution, floorPlan, {
    title: 'COSTO V1 - Storage Layout',
    scale: '1:200',
    showLegend: true,
    showTitleBlock: true
});
```

### 4. Enhanced PDF Export (Updated `lib/costoExports.js`)
**Existing features confirmed:**
- Professional title block with COSTO branding
- Legend with line samples (Tôle Blanche, Tôle Grise, circulation, radiateur)
- Multi-floor layout support
- Intelligent partition rendering (tole_blanche vs tole_grise)
- Dashed corridor lines (light-blue)
- Red zigzag radiator rendering
- Scale annotations and floor labels

**Key rendering details:**
- Corridors: Light-blue dashed lines (rgb(0.4, 0.7, 0.95))
- Radiators: Red zigzag lines (rgb(0.85, 0, 0.08))
- Tôle Grise: Blue partitions (rgb(0, 0.2, 0.8))
- Tôle Blanche: Gray walls (rgb(0.42, 0.45, 0.5))

## Testing

### Run Test Script
```bash
npm run test-reference
```

This will:
1. Create mock floor plan and boxes
2. Generate corridors using advanced generator
3. Generate radiators along perimeter
4. Export to PDF, DXF, and SVG
5. Save outputs to `exports/` folder

### Expected Output Files
- `test_reference_output.pdf` - Professional PDF matching Image 1
- `test_reference_output.dxf` - DXF with all layers
- `test_reference_output.svg` - Interactive SVG

## Integration with Existing Code

### Server Integration
To use the new pipeline in your server endpoints:

```javascript
const CostoCompletePipeline = require('./lib/costoCompletePipeline');

app.post('/api/costo/process-complete', async (req, res) => {
    try {
        const { floorPlan, boxes, options } = req.body;
        
        const pipeline = new CostoCompletePipeline({
            corridorWidth: options.corridorWidth || 1.2,
            useAdvancedCorridors: true,
            generateRadiators: true
        });
        
        const solution = await pipeline.processComplete(floorPlan, boxes, options);
        
        res.json({
            success: true,
            solution: solution,
            metrics: solution.metrics
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

### Batch Processing Integration
Update existing batch scripts to use the new pipeline:

```javascript
const CostoCompletePipeline = require('./lib/costoCompletePipeline');

// In your batch processing script
const pipeline = new CostoCompletePipeline({
    corridorWidth: 1.2,
    useAdvancedCorridors: true,
    generateRadiators: true
});

const solution = await pipeline.processComplete(floorPlan, boxes);

// Export all formats
const pdfBytes = await pipeline.exportToPDF(solution, floorPlan);
const dxfContent = pipeline.exportToDXF(solution, floorPlan);
const svgContent = pipeline.exportToSVG(solution, floorPlan);
```

## Configuration Options

### Pipeline Options
```javascript
{
    corridorWidth: 1.2,           // Corridor width in meters
    useAdvancedCorridors: true,   // Use advanced network generator
    generateRadiators: true       // Generate radiator paths
}
```

### Corridor Generator Options
```javascript
{
    corridorWidth: 1.2,           // Corridor width
    margin: 0.2,                  // Margin from boxes
    minCorridorLength: 2.0        // Minimum corridor length
}
```

### Radiator Generator Options
```javascript
{
    zigzagAmplitude: 0.15,        // Zigzag amplitude (15cm)
    zigzagFrequency: 0.5,         // Zigzag frequency (50cm)
    wallOffset: 0.3               // Offset from wall (30cm)
}
```

### PDF Export Options
```javascript
{
    pageSize: 'A1',               // 'A1' or 'A3'
    title: 'COSTO V1 - Layout',   // Document title
    showLegend: true,             // Show legend
    showTitleBlock: true,         // Show title block
    includeRadiators: true,       // Include radiators
    includeCorridors: true,       // Include corridors
    showBoxNumbers: false,        // Show box IDs
    showDimensions: false,        // Show dimension lines
    scale: '1:200',               // Drawing scale
    companyName: 'COSTO',         // Company name
    companyAddress: '...',        // Company address
    version: '1.0',               // Version number
    versionId: 'V1.0',            // Version ID
    pageNumber: 3                 // Page number
}
```

## Visual Elements Matching Reference

### ✓ Implemented
- [x] Pink/light-blue dashed circulation corridors
- [x] Red zigzag radiators along perimeter
- [x] Blue storage boxes (Tôle Grise)
- [x] Gray structural walls (Tôle Blanche)
- [x] Professional legend with line samples
- [x] Title block with COSTO branding
- [x] Scale annotations
- [x] Floor labels (PLAN ETAGE 01, 02)
- [x] Multi-floor layout support
- [x] Complete corridor network (horizontal + vertical)

### Rendering Details
1. **Corridors**: Rendered as dashed light-blue lines along corner paths
2. **Radiators**: Rendered as continuous red zigzag polylines
3. **Boxes**: Rendered with intelligent partition types (blue for internal, gray for structural)
4. **Legend**: Shows all line types with samples
5. **Title Block**: Professional CAD format with project info

## Troubleshooting

### Corridors Not Showing
- Verify boxes have proper x, y, width, height properties
- Check corridor width is appropriate for gaps between boxes
- Ensure `useAdvancedCorridors: true` in pipeline options
- Verify `includeCorridors: true` in export options

### Radiators Not Showing
- Verify floor plan has walls array
- Check walls have start and end points
- Ensure `generateRadiators: true` in pipeline options
- Verify `includeRadiators: true` in export options

### PDF Export Issues
- Ensure pdf-lib is installed: `npm install pdf-lib`
- Check floor plan has valid bounds
- Verify solution has boxes, corridors, radiators arrays
- Check console for export errors

## Performance Considerations

- **Corridor Generation**: O(n²) for n boxes, optimized with grouping
- **Radiator Generation**: O(w) for w walls, very fast
- **PDF Export**: O(n + c + r) for n boxes, c corridors, r radiators
- **Recommended**: Process in batches for large projects (>500 boxes)

## Future Enhancements

1. **Corridor Optimization**: Merge adjacent corridors into single paths
2. **Radiator Placement**: Smart placement based on box density
3. **Multi-Floor Connectivity**: Stairwell and elevator corridor connections
4. **Interactive PDF**: Clickable boxes with datasheets
5. **3D Export**: Export to 3D formats (OBJ, GLTF)

## Support

For issues or questions:
1. Check console logs for error messages
2. Run test script to verify installation
3. Review AGENTS.md for project structure
4. Check COSTO_V1_COMPLETE.md for specification details

---

**Last Updated**: 2026-02-10
**Version**: 1.0.0
**Status**: Production Ready
