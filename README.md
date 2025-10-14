# FloorPlan Pro - Intelligent Office Layout Generator

Automatic floor plan analysis and workspace optimization using Three.js and intelligent geometry detection.

## Features

- **Automatic DWG/DXF Processing** - Converts and analyzes CAD files
- **Intelligent Detection** - Automatically finds doors, stairs, forbidden zones
- **Smart Ilot Placement** - Generates optimal workspace layouts
- **Corridor Generation** - Creates efficient circulation paths
- **3D Visualization** - Interactive 2D/3D view with Three.js
- **Professional Exports** - PDF, SVG, DXF, GLTF, 4K images

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
