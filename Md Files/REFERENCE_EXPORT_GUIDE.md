# Reference-Style Export Guide

## Overview

The system now includes an enhanced export function that produces floor plans matching the architectural reference style. This export includes:

- **Unit size labels** (0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25)
- **Comprehensive legend** with Unit/Group/Size columns
- **Color-coded elements** (walls, boxes, corridors, staircases)
- **Dimension annotations** 
- **Specialized areas** (Loading Bay, Trolley Store, etc.)
- **Staircases** with red outlines
- **Entrance/exit annotations**
- **Scale information** ([01] 1:100 on A1 format)

## API Endpoint

### POST `/api/costo/export/reference-pdf`

Exports a floor plan in the reference architectural style.

**Request Body:**
```json
{
  "solution": {
    "boxes": [
      {
        "id": "BOX_001",
        "x": 10,
        "y": 10,
        "width": 2.5,
        "height": 3.0,
        "area": 7.5,
        "type": "M",
        "zone": "ZONE_1",
        "row": 1
      }
    ],
    "corridors": [
      {
        "corners": [[x1, y1], [x2, y2], ...],
        "width": 1.2
      }
    ]
  },
  "floorPlan": {
    "walls": [
      {
        "start": {"x": 0, "y": 0},
        "end": {"x": 100, "y": 0}
      }
    ],
    "forbiddenZones": [],
    "entrances": [
      {
        "start": {"x": 50, "y": 0},
        "end": {"x": 52, "y": 0},
        "label": "ENTREE"
      }
    ],
    "staircases": [
      {
        "polygon": [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
      }
    ],
    "bounds": {
      "minX": 0,
      "minY": 0,
      "maxX": 100,
      "maxY": 100
    }
  },
  "metrics": {
    "totalArea": 1000,
    "yieldRatio": 0.85,
    "unitMixCompliance": 0.95
  },
  "options": {
    "pageSize": "A1",
    "title": "COSTO V1 - Storage Layout",
    "showLegend": true,
    "showTitleBlock": true,
    "scale": "1:100",
    "drawingNumber": "[01]",
    "showDimensions": true,
    "showUnitLabels": true,
    "specializedAreas": [
      {
        "type": "LOADING_BAY",
        "polygon": [[x1, y1], [x2, y2], [x3, y3], [x4, y4]],
        "label": "LOADING BAY"
      },
      {
        "type": "TROLLEY_STORE",
        "polygon": [[x1, y1], [x2, y2], [x3, y3], [x4, y4]],
        "label": "Trolley Store"
      }
    ]
  }
}
```

**Response:**
```json
{
  "success": true,
  "filename": "costo_reference_1234567890.pdf",
  "filepath": "/path/to/exports/costo_reference_1234567890.pdf",
  "message": "Reference-style PDF exported successfully"
}
```

## Features

### Unit Size Labels

Units are automatically labeled with their size based on area:
- Calculates closest standard size (0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25)
- Labels are displayed centered in each unit
- For areas > 25 m², rounds to nearest 0.5

### Legend

The legend includes:
- **Unit/Group/Size table**: Lists all unit sizes with their group classification and count
- **Line style samples**: Shows Tôle Blanche, Tôle Grise, and Ligne circulation styles

### Color Coding

- **Walls**: Black thin lines (Tôle Blanche)
- **Boxes**: Blue thick lines (Tôle Grise)
- **Corridors**: Red dashed lines (Ligne circulation)
- **Staircases**: Red outlines
- **Entrances**: Green lines with labels
- **Forbidden zones**: Blue outlines
- **Dimensions**: Magenta lines and text

### Specialized Areas

Support for specialized areas like:
- Loading Bay
- Trolley Store
- Ex50 (large unpartitioned space)
- Any custom labeled area

### Scale Information

Displays scale information in bottom-left corner:
- Format: `[01] 1:100 on A1`
- Drawing number and page size included

## Usage Example

```javascript
// In your automation pipeline or frontend
const response = await fetch('/api/costo/export/reference-pdf', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    solution: {
      boxes: generatedBoxes,
      corridors: generatedCorridors
    },
    floorPlan: extractedFloorPlan,
    metrics: calculatedMetrics,
    options: {
      pageSize: 'A1',
      scale: '1:100',
      drawingNumber: '[01]',
      showDimensions: true,
      showUnitLabels: true,
      specializedAreas: [
        {
          type: 'LOADING_BAY',
          polygon: [[90, 0], [100, 0], [100, 10], [90, 10]],
          label: 'LOADING BAY'
        }
      ]
    }
  })
});

const result = await response.json();
// Download or display the PDF from result.filepath
```

## Integration with Automation Pipeline

To use this export in the automation pipeline, modify the export step in `runAutomationForUrn`:

```javascript
// Instead of:
const pdfBytes = await exportManager.exportToPDF(floorPlan, ilots, corridors, {});

// Use:
const solution = {
  boxes: numberedBoxes,
  corridors: corridors.map(c => ({
    corners: c.polygon || [...],
    width: c.width || 1.2
  }))
};

const pdfBytes = await CostoExports.exportToReferencePDF(
  solution,
  floorPlan,
  metrics,
  {
    scale: '1:100',
    drawingNumber: '[01]',
    showDimensions: true,
    showUnitLabels: true
  }
);
```

## DXF Export Enhancement

The DXF export has also been enhanced to include unit size labels automatically. When exporting to DXF, units will be labeled with their calculated size instead of just IDs.

## Notes

- Unit sizes are calculated automatically from box areas
- Groups (A, B, C, D, E, F) are assigned based on size ranges
- The legend dynamically builds from the actual solution data
- All dimensions are in meters
- PDF uses A1 page size by default for architectural drawings
