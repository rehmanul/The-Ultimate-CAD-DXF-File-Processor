# FloorPlan Pro - Intelligent Office Layout Generator

Automatic floor plan analysis and workspace optimization using Three.js and intelligent geometry detection.

## Features

- **Automatic DWG/DXF Processing** - Converts and analyzes CAD files
- **Intelligent Detection** - Automatically finds doors, stairs, forbidden zones
- **Smart Ilot Placement** - Generates optimal workspace layouts
- **Corridor Generation** - Creates efficient circulation paths
- **3D Visualization** - Interactive 2D/3D view with Three.js
- **Professional Exports** - PDF, SVG, DXF, GLTF, 4K images
- **Performance Profiling & Reporting** - Stack/corridor benchmarking with downloadable analytics

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:5000

## Usage

1. Upload DXF/DWG file
2. System automatically detects walls, doors, forbidden zones
3. Click "Generate Ilots" for workspace layout
4. Click "Generate Corridors" for circulation paths
5. Export to PDF, SVG, DXF, or 3D model

## Color Coding

- **Gray** - Walls (MUR)
- **Red** - Doors/Entrances (ENTRÉE/SORTIE)
- **Blue** - Forbidden zones (NO ENTREE - stairs, elevators)
- **Green** - Generated workspaces (ilots)
- **Yellow** - Corridors

## Multi-Floor Building Support

FloorPlan Pro now provides production-grade stacking for multi-level buildings.

- Align an arbitrary number of processed floors
- Detect matching stair/elevator connectors across levels
- Build a vertical circulation graph and cross-floor paths
- Retrieve statistics and warnings for misaligned CAD inputs
- Evaluate egress distance and accessibility compliance for every stacked floor
- Generate cross-floor corridor segments with weighted A* routing across connectors

### API

`POST /api/multi-floor/stack`

```json
{
  "floors": [
    {
      "id": "L1",
      "level": 0,
      "floorPlan": { "...": "single-floor result from /api/upload processing" }
    },
    {
      "id": "L2",
      "level": 1,
      "floorPlan": { "...": "second floor result" }
    }
  ],
  "options": {
    "floorHeight": 3.2,
    "connectorMatchTolerance": 1.25
  }
}
```

**Response**
- `floors`: normalized floor metadata with stacking order
- `connectors`: detected stairs/elevators with centroids and areas
- `edges`: matched vertical transitions between floors
- `graph`: adjacency list for traversal
- `crossFloorPaths`: multi-level connector sequences
- `warnings`: alignment notes when bounds differ
- `compliance`: egress and accessibility metrics with pass/fail summaries

Use the same payload to drive 3D visualizations or validation workflows.

#### Cross-Floor Corridors

`POST /api/multi-floor/corridors`

```json
{
  "floors": [...],
  "connectors": [...],
  "edges": [...],
  "options": { "floorHeight": 3.2 }
}
```

Returns A*-computed corridor routes between all connected floors:

- `segments`: deduplicated 3D line segments (horizontal + vertical)
- `routes`: connector pair paths referencing segment indices
- `summary`: route count, segment count, unreachable connectors

#### Performance Profiling

`POST /api/multi-floor/profile`

```json
{
  "floors": [...],
  "options": {
    "iterations": 5,
    "targetFloorCount": 6,
    "autoExpand": true
  }
}
```

Runs repeated stack/routing cycles (auto-duplicating floors to meet the target count) and returns timing distributions:

- `parameters`: iterations, floor count, stack/router options used
- `stack` / `routing`: per-iteration samples, average/min/max durations
- `lastStackResult`, `lastRouteResult`: final computation snapshots

#### Report Generation

`POST /api/multi-floor/report`

```json
{
  "floors": [...],
  "options": {
    "stackOptions": {},
    "routeOptions": {},
    "profile": { "...": "optional profiler output for embedding" }
  }
}
```

Produces a publication-ready JSON+Markdown payload summarising floors, connectors, compliance, warnings, metrics, and (optionally) profiling highlights.

### Frontend Workflow

- Use the **Multi-Floor Stack** panel to capture named levels, configure stacking options, and run compliance checks.
- Inspect alignment warnings, connector summaries, and per-floor egress/accessibility status directly in the sidebar.
- Selecting any stacked floor instantly loads its geometry, îlots, corridors, and vertical connectors in the viewer for navigation.
- Toggle **Preview Stack** to render layered floors, connectors, and cross-floor routes in both 2D and 3D camera modes.
- Run **Profile Stack** to benchmark stack + routing on 6+ floors and review averages directly in the sidebar.
- Generate a **Multi-Floor Report** to download the latest metrics in JSON/Markdown form for stakeholders.

## Requirements

- Node.js 16+
- ODA File Converter (optional, for DWG support)

## Configuration

Edit `.env` file:
```
PORT=5000
NODE_ENV=development
```

## Architecture

- **Backend**: Express.js + DXF parser
- **Frontend**: Three.js + OrbitControls
- **Detection**: Intelligent geometry analysis
- **Export**: PDF/SVG/DXF/GLTF

## License

Proprietary
