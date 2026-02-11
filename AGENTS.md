# FloorPlan Pro - Agent Guide

## Project Overview

FloorPlan Pro is a **Node.js/Express-based CAD processing system** for warehouse/storage floor plan optimization. It processes DXF/DWG files, generates intelligent storage unit (îlot) placements, creates circulation corridors, and exports professional documentation.

**Key Domain Terms:**
- **Îlot**: A storage unit/box placed on the floor plan
- **Corridor**: Circulation path between îlots (rendered in pink)
- **COSTO**: Client-specific V1 specification for storage layout optimization
- **Unit Mix**: Distribution of storage unit sizes (S, M, L, XL typologies)

---

## Technology Stack

### Backend
- **Runtime**: Node.js >= 18
- **Framework**: Express.js 4.x
- **File Upload**: Multer (with memory storage)
- **Image Processing**: Sharp
- **PDF Generation**: jsPDF, pdf-lib
- **DXF Parsing**: dxf-parser, dxf
- **Machine Learning**: TensorFlow.js (@tensorflow/tfjs)
- **Database**: SQLite (via better-sqlite3), optional PostgreSQL support
- **Python Integration**: Optional Python scripts for corridor generation (falls back to JS)

### Frontend
- **3D Rendering**: Three.js (bundled in `public/libs/`)
- **Module System**: ES6 modules (import/export)
- **Build Tool**: Vite 7.x
- **Styling**: Vanilla CSS with CSS variables
- **UI Components**: Font Awesome icons

### Testing
- **Framework**: Jest 29.x
- **Assertions**: Built-in Jest matchers
- **Mocking**: Jest mocks + Sinon for spies/stubs
- **Coverage**: Istanbul/NYC via Jest

---

## Project Structure

```
.
├── server.js                  # Express entry point, API routes, middleware
├── package.json               # Dependencies and npm scripts
├── jest.config.js             # Test configuration
├── vite.config.js             # Frontend build configuration
├── nodemon.json               # Development reload configuration
├── Dockerfile                 # Container build definition
├── render.yaml                # Render.com deployment config
│
├── lib/                       # Backend modules (CommonJS)
│   ├── dxfProcessor.js        # DXF file parsing and entity extraction
│   ├── productionCorridorGenerator.js  # Vertical corridor generation
│   ├── advancedCorridorGenerator.js    # Horizontal/vertical corridor engine
│   ├── advancedCorridorArrowGenerator.js  # Directional arrow generation
│   ├── RowBasedIlotPlacer.js  # Grid-based îlot placement
│   ├── COSTOLayoutPlacer.js   # COSTO-specific layout engine
│   ├── costoAPI.js            # COSTO V1 API integration
│   ├── costoLayerStandard.js  # Layer mapping standardization
│   ├── costoBoxCatalog.js     # Box template definitions
│   ├── costoOptimizationEngine.js  # Multi-criteria optimizer
│   ├── costoComplianceChecker.js   # Layout validation
│   ├── costoExports.js        # Export system (DWG, PDF, SVG, Excel)
│   ├── professionalCADProcessor.js # Main CAD processing pipeline
│   ├── exportManager.js       # Export orchestration
│   ├── roomDetector.js        # Room/zone detection from CAD
│   ├── sanitizer.js           # Data sanitization utilities
│   ├── geometryHelpers.js     # Geometric calculations
│   ├── sqliteAdapter.js       # Database abstraction layer
│   └── ... (95+ modules)
│
├── public/                    # Frontend assets (ES modules)
│   ├── index.html             # Main HTML entry
│   ├── main.css               # Global styles
│   ├── app.js                 # Main application logic
│   ├── threeRenderer.js       # Three.js scene management
│   ├── interactiveEditor.js   # User interaction handling
│   ├── professionalExport.js  # Client-side export utilities
│   ├── undoRedo.js            # History management
│   ├── keyboardShortcuts.js   # Keyboard event handling
│   ├── collisionDetection.js  # Box collision logic
│   ├── libs/                  # Three.js library files
│   └── ... (395+ JS files)
│
├── tests/                     # Test suite
│   ├── setup.js               # Test environment initialization
│   ├── unit/lib/              # Unit tests for lib modules
│   ├── integration/           # API/integration tests
│   └── e2e/                   # End-to-end tests
│
├── scripts/                   # Utility scripts
│   ├── costoBatchProduction.js    # Batch processing
│   ├── costoCompleteProduction.js # Full pipeline runner
│   └── processTest2Dwg.js         # Test file processor
│
├── uploads/                   # Runtime: uploaded DXF/DWG files
├── exports/                   # Runtime: generated exports (PDF, DXF, etc.)
├── models/                    # Runtime: ML model storage
├── checkpoints/               # Runtime: training checkpoints
├── fixtures/                  # Test data and sample files
└── Samples/                   # Reference/sample DXF files
```

---

## Build and Development Commands

### Production
```bash
npm start                    # Start production server on PORT (default 3000)
```

### Development
```bash
npm run dev                  # Start server with nodemon (auto-reload)
npm run vite-dev             # Start Vite dev server for frontend only (port 4000)
```

### Build
```bash
npm run build                # Build frontend assets to public/dist/
npm run vite-build           # Alias for above
npm run vite-preview         # Preview built frontend
```

### Testing
```bash
npm test                     # Run full Jest test suite
npm test -- --coverage      # Generate coverage report in coverage/
npm test -- --watch         # Run tests in watch mode
```

### COSTO Processing
```bash
npm run process-test2        # Process Test2.dwg with COSTO pipeline
```

---

## Code Style Guidelines

### General
- **Indentation**: 4 spaces (no tabs)
- **Semicolons**: Required
- **Line endings**: Platform default (LF on Unix, CRLF on Windows acceptable)

### Backend (CommonJS)
```javascript
// Class names: PascalCase
class ProductionCorridorGenerator {
    // Methods: camelCase
    generateCorridors() {
        // Variables: camelCase
        const corridorWidth = 1.2;
        // Constants: UPPER_SNAKE_CASE or const with camelCase
        const MAX_CORRIDOR_LENGTH = 50;
    }
}

// Module exports
module.exports = ProductionCorridorGenerator;

// Module imports (destructured)
const { sanitizeIlot } = require('./sanitizers');
```

### Frontend (ES Modules)
```javascript
// Named exports preferred
export class FloorPlanRenderer {
    // ...
}

// Imports with explicit paths
import { FloorPlanRenderer } from './threeRenderer.js';
import * as THREE from 'three';

// Global variables tracked at module level
let currentFloorPlan = null;
let generatedIlots = [];
```

### JSDoc
Document complex functions with JSDoc:
```javascript
/**
 * Generate corridor network between îlot groups
 * @param {Object} floorPlan - Floor plan data with walls, bounds
 * @param {Array} ilots - Array of îlot objects
 * @param {Object} options - Generation options
 * @param {number} options.corridorWidth - Width in meters (default 1.2)
 * @returns {Array} Corridor segments
 */
```

---

## Testing Strategy

### Test Organization
- **Unit tests**: `tests/unit/lib/*.test.js` - Test individual modules
- **Integration tests**: `tests/integration/api/*.test.js` - Test API endpoints
- **E2E tests**: `tests/e2e/*.test.js` - Test complete workflows

### Test Utilities
Global `testUtils` available via `tests/setup.js`:
```javascript
// Create mock floor plan data
const floorPlan = testUtils.createMockFloorPlan({
    walls: [...],  // Override defaults
});

// Create mock îlots
const ilots = testUtils.createMockIlots(5, { width: 2 });
```

### Writing Tests
```javascript
const ModuleUnderTest = require('../../../lib/moduleName');

describe('ModuleName', () => {
    let instance;
    
    beforeEach(() => {
        instance = new ModuleUnderTest();
    });
    
    test('should behave correctly', () => {
        const result = instance.method();
        expect(result).toBe(expectedValue);
    });
});
```

### Test Environment
- TensorFlow.js backend set to 'cpu' for tests
- `NODE_ENV=test` during test execution
- Console.log/warn mocked to reduce noise (error preserved)
- Test timeout: 10 seconds

---

## Key API Endpoints

### File Processing
```
POST   /api/upload              # Upload DXF/DWG file
GET    /api/floorplan/:id       # Retrieve processed floor plan
DELETE /api/floorplan/:id       # Delete floor plan
```

### Layout Generation
```
POST   /api/generate-ilots      # Generate îlot placements
POST   /api/generate-corridors  # Generate corridor network
POST   /api/optimize-layout     # Run optimization engine
```

### COSTO V1 API
```
POST   /api/costo/process       # Process CAD with COSTO standard
POST   /api/costo/generate      # Generate optimized layout
GET    /api/costo/catalog       # Get box catalog
POST   /api/costo/export/pdf    # Export PDF
POST   /api/costo/export/dwg    # Export DWG/DXF
POST   /api/costo/export/excel  # Export Excel
```

### System
```
GET    /health                 # Health check (for Render/Docker)
GET    /api/status             # System status
```

---

## Configuration

### Environment Variables (`.env`)
```env
PORT=5000                      # Server port
NODE_ENV=production            # Environment mode

# Optional: Autodesk Platform Services
APS_CLIENT_ID=...
APS_CLIENT_SECRET=...

# Optional: Vision/Gemini API for zone detection
VISION_API_KEY=...
VISION_API_PROVIDER=gemini

# Optional: Python for corridor generation
PYTHON_EXECUTABLE=python3
```

### COSTO Layer Standard
Layer names are normalized and classified:
- `walls`, `MUR` → Walls (black)
- `ENTREE`, `DOORS` → Entrances (red)
- `NO_ENTREE`, `STAIRS` → Forbidden zones (blue)
- ` boxes`, `units` → Storage units

See `lib/costoLayerStandard.js` for full mapping.

---

## Security Considerations

### File Upload
- Extension validation: `.dxf`, `.dwg` only
- MIME type checking
- File size limit: 50MB
- Sanitized filenames (hashed storage)
- Temporary file cleanup

### API Security
- CORS configured via `cors` middleware
- Rate limiting on upload endpoints
- Input validation via sanitizers
- No stack traces exposed to client

### Deployment
- Non-root user in Docker container (`node` user)
- Health check endpoint for container orchestration
- `NODE_ENV=production` in production builds

---

## Deployment

### Docker
```bash
docker build -t floorplan-pro .
docker run -p 5000:10000 -e PORT=10000 floorplan-pro
```

### Render.com
Already configured in `render.yaml`:
```bash
git push origin main  # Auto-deploys on Render
```

### Vercel
```bash
npm run build
vercel --prod
```

---

## Development Workflow

1. **Start backend**: `npm run dev` (port 3000)
2. **Start frontend**: `npm run vite-dev` (port 4000, proxies `/api` to 3000)
3. **Make changes**: Edit files in `lib/` or `public/`
4. **Run tests**: `npm test`
5. **Build for prod**: `npm run build`

### Adding New Features
1. Add backend logic to `lib/` (CommonJS, PascalCase class names)
2. Add API route in `server.js` if needed
3. Add frontend code to `public/` (ES modules)
4. Write tests in `tests/unit/lib/` or `tests/integration/`
5. Update this AGENTS.md if conventions change

---

## Debugging

### Server Logs
- Console logs use prefixes: `[ModuleName] Message`
- Check `api-server.log` and `dev-server.log` for runtime logs
- Error logs: `api-server.err.log`

### Common Issues
- **Header not hiding**: Check `initHeaderAutoHide()` called in app.js
- **File upload fails**: Verify multer temp directory exists
- **Corridor generation fails**: Check Python availability or JS fallback
- **3D rendering issues**: Verify WebGL support, check browser console

---

## Related Documentation

- `README.md` - User-facing documentation
- `COSTO_V1_COMPLETE.md` - COSTO specification implementation
- `REFERENCE_EXPORT_GUIDE.md` - Export format documentation
- `lib/` module JSDoc comments - API reference

---

**Last Updated**: 2026-02-09
**Version**: 1.0.0
