# FloorPlan Pro - Production System

## 🚀 Production-Ready Features

### ✅ Core Functionality
- **Auto-Hide Header** with pin/unpin capability
- **Responsive Design** - works on desktop, tablet, mobile
- **Real-time CAD Processing** - DXF/DWG file support
- **Îlot Generation** - intelligent box placement with collision detection
- **Corridor Generation** - automatic circulation paths
- **Multi-Floor Stack** - vertical building management
- **Professional Export** - PDF, PNG, 4K, SVG, DXF, 3D models
- **Interactive Editing** - drag, resize, rotate with undo/redo
- **Measurement Tools** - distance, area, angle measurements
- **Visual Effects** - grid, shadows, ambient occlusion, bloom
- **Keyboard Shortcuts** - efficient workflow

### 🎨 UI/UX Features
- **Auto-hide header** - appears on mouse hover (top 80px)
- **Pin button** - lock header in place
- **Collapsible sidebars** - maximize canvas space
- **Responsive layout** - adapts to screen size
- **Visual feedback** - active states, hover effects
- **Accessibility** - ARIA labels, keyboard navigation

## 📋 Quick Start

### Prerequisites
```bash
Node.js >= 18
npm or yarn
```

### Installation
```bash
# Clone repository
git clone <repository-url>
cd floorplan-pro-clean-main

# Install dependencies
npm install

# Start development server
npm start
```

### Access Application
Open browser to: `http://localhost:5000`

## 🎯 Usage Guide

### 1. Upload Floor Plan
- Click **Upload** button in header
- Select DXF or DWG file
- Wait for processing (progress shown)

### 2. Configure Distribution
- Set îlot size percentages (must total 100%)
- Click **Apply Distribution**
- Or select from **Distribution Presets**

### 3. Generate Îlots
- Click **Generate Îlots** button
- System places boxes automatically
- Respects walls, entrances, forbidden zones

### 4. Generate Corridors
- Configure corridor width (1-3m)
- Click **Generate Corridors**
- Toggle circulation arrows on/off

### 5. Edit & Refine
- Drag îlots to move
- Resize handles for dimensions
- Undo/Redo available (Ctrl+Z / Ctrl+Y)
- Delete selected (Del key)

### 6. Export Results
- **PDF** - professional documentation
- **Image** - standard resolution
- **4K Image** - high-resolution print
- **SVG** - scalable vector
- **DXF** - CAD software import
- **3D Model** - glTF format

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `G` | Toggle Grid |
| `B` | Toggle Bloom Effect |
| `3` | Toggle 3D View |
| `R` | Reset Camera |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Del` | Delete Selected |
| `Esc` | Cancel Action |
| `?` | Show Shortcuts |

## 🏗️ Architecture

### Frontend Stack
- **Three.js** - 3D rendering engine
- **Vanilla JavaScript** - no framework overhead
- **ES6 Modules** - clean code organization
- **CSS Variables** - consistent theming

### Backend Stack
- **Node.js + Express** - API server
- **Multer** - file upload handling
- **Sharp** - image processing
- **jsPDF** - PDF generation

### Key Modules
- `threeRenderer.js` - 3D scene management
- `interactiveEditor.js` - user interaction
- `gridIlotPlacer.js` - box placement algorithm
- `productionCorridorGenerator.js` - circulation paths
- `professionalExport.js` - export functionality
- `undoRedo.js` - history management

## 🔧 Configuration

### Environment Variables
Create `.env` file:
```env
PORT=5000
NODE_ENV=production

# Optional: Autodesk Platform Services
APS_CLIENT_ID=your_client_id
APS_CLIENT_SECRET=your_secret
APS_BASE_URL=https://developer.api.autodesk.com

# Optional: Python for advanced corridor generation
PYTHON_EXECUTABLE=python3
```

### Corridor Configuration
```javascript
corridorWidth: 1.2  // meters (adjustable 1-3m)
generateArrows: true
showMainCorridors: true
showAccessCorridors: true
```

### Distribution Presets
```javascript
{
  "0-1m²": 10,   // 10%
  "1-3m²": 25,   // 25%
  "3-5m²": 30,   // 30%
  "5-10m²": 35   // 35%
}
```

## 🚢 Deployment

### Production Build
```bash
npm run build
```

### Deploy to Render
```bash
# Already configured in render.yaml
git push origin main
```

### Deploy to Heroku
```bash
heroku create floorplan-pro
git push heroku main
```

### Docker Deployment
```bash
docker build -t floorplan-pro .
docker run -p 5000:5000 floorplan-pro
```

## 📊 Performance

### Optimization Features
- **Chunked file writing** - prevents memory issues
- **Lazy loading** - modules load on demand
- **Debounced interactions** - smooth user experience
- **Efficient rendering** - only update when needed
- **Web Workers** - heavy calculations off main thread

### Benchmarks
- File upload: < 2s for typical DXF
- Îlot generation: < 1s for 100 boxes
- Corridor generation: < 500ms
- Export PDF: < 3s for full document

## 🐛 Troubleshooting

### Header Not Hiding
- Check browser console for errors
- Verify `initHeaderAutoHide()` called
- Ensure CSS classes applied correctly

### File Upload Fails
- Check file size (< 50MB recommended)
- Verify DXF/DWG format valid
- Check server logs for parsing errors

### Rendering Issues
- Clear browser cache
- Check WebGL support: `chrome://gpu`
- Update graphics drivers
- Try different browser

### Performance Issues
- Reduce îlot count
- Disable visual effects
- Use 2D view instead of 3D
- Close other browser tabs

## 🧪 Testing

### Run Tests
```bash
npm test
```

### Test Coverage
```bash
npm run coverage
```

### Manual Testing Checklist
- [ ] Upload DXF file
- [ ] Generate îlots (all sizes)
- [ ] Generate corridors
- [ ] Edit îlot (move, resize)
- [ ] Undo/Redo operations
- [ ] Export all formats
- [ ] Test keyboard shortcuts
- [ ] Test on mobile device
- [ ] Test header auto-hide
- [ ] Test panel collapse

## 📱 Mobile Support

### Responsive Breakpoints
- Desktop: > 1200px
- Tablet: 768px - 1200px
- Mobile: < 768px

### Touch Gestures
- **Tap** - Select îlot
- **Drag** - Move îlot
- **Pinch** - Zoom camera
- **Two-finger drag** - Pan view

## 🔐 Security

### File Upload Security
- Extension validation (.dxf, .dwg only)
- MIME type checking
- File size limits (50MB)
- Sanitized file names
- Temporary storage cleanup

### API Security
- CORS configured
- Rate limiting enabled
- Input validation
- Error handling (no stack traces to client)

## 📈 Analytics

### Key Metrics Tracked
- File uploads per day
- Average processing time
- Export format preferences
- Feature usage statistics
- Error rates

## 🤝 Contributing

### Development Workflow
1. Fork repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

### Code Standards
- ES6+ JavaScript
- Descriptive variable names
- JSDoc comments for functions
- Console logs for debugging only
- No console.log in production

## 📄 License

Copyright © 2025 FloorPlan Pro
All rights reserved.

## 🆘 Support

### Documentation
- [API Documentation](./docs/API.md)
- [Architecture Guide](./COMPLETE_SYSTEM_ARCHITECTURE.md)
- [Deployment Guide](./DEPLOYMENT.md)

### Contact
- Issues: GitHub Issues
- Email: support@floorplanpro.com
- Discord: [Join Server](#)

## 🎉 Acknowledgments

Built with:
- Three.js - 3D graphics
- Express.js - Web framework
- Sharp - Image processing
- jsPDF - PDF generation
- Font Awesome - Icons

---

**Status**: Production Ready ✅
**Version**: 1.0.0
**Last Updated**: 2025-01-27
