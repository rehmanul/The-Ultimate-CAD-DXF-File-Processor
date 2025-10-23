d+Z`: Undo last action
   - `Ctrl/Cmd+Shift+Z`: Redo action
   - `Escape`: Cancel current tool
   - `Delete`: Remove selected elements
   - `Ctrl/Cmd+A`: Select all

## API Integration Examples

### Upload and Process CAD File

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('/api/jobs', {
    method: 'POST',
    body: formData
});

const result = await response.json();
// result.cadData contains: walls, rooms, forbiddenZones, entrances, bounds
```

### Generate Îlots with Custom Distribution

```javascript
const response = await fetch('/api/ilots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        floorPlan: cadData,
        distribution: {
            '0-1': 10,
            '1-3': 25,
            '3-5': 30,
            '5-10': 35
        },
        options: {
            totalIlots: 50,
            corridorWidth: 1.2,
            margin: 1.0,
            spacing: 0.3
        }
    })
});

const result = await response.json();
// result.ilots contains array of placed îlots with polygon, center, area
```

### Generate Corridor Network

```javascript
const response = await fetch('/api/corridors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        floorPlan: cadData,
        ilots: placedIlots,
        corridorWidth: 1.2,
        options: {
            generateVertical: true,
            generateHorizontal: true,
            margin: 0.5
        }
    })
});

const result = await response.json();
// result.corridors contains array with orientation, polygon, area
// result.statistics contains horizontal/vertical counts
```

## Data Structures

### Floor Plan Object
```javascript
{
    urn: "local_1234567890",
    walls: [
        { start: {x: 0, y: 0}, end: {x: 10, y: 0}, polygon: [[0,0], [10,0]] }
    ],
    forbiddenZones: [
        { polygon: [[x1,y1], [x2,y2], ...], type: "stairs" }
    ],
    entrances: [
        { polygon: [[x1,y1], [x2,y2], ...], type: "main" }
    ],
    rooms: [
        { id: "room_1", name: "Office", area: 25.5, center: {x: 5, y: 5}, polygon: [...] }
    ],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    totalArea: 2500.0
}
```

### Îlot Object
```javascript
{
    id: "ilot_1",
    polygon: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]],
    center: { x: 5.5, y: 5.5 },
    area: 3.5,
    width: 2.0,
    height: 1.75,
    sizeRange: "3-5"
}
```

### Corridor Object
```javascript
{
    id: "corridor_1",
    polygon: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]],
    orientation: "horizontal", // or "vertical"
    area: 15.0,
    length: 10.0,
    width: 1.5,
    touchingIlots: ["ilot_1", "ilot_2"]
}
```

## Customization Guide

### Custom Îlot Distribution

Edit distribution presets in `lib/distributionPresets.js`:

```javascript
module.exports = {
    standard: {
        '0-1': 10,
        '1-3': 25,
        '3-5': 30,
        '5-10': 35
    },
    custom: {
        '0-1': 5,
        '1-3': 20,
        '3-5': 40,
        '5-10': 35
    }
};
```

### Custom Color Schemes

Edit color palette in `public/modernStyles.css`:

```css
:root {
    --primary-color: #2196F3;    /* Change primary color */
    --secondary-color: #4CAF50;  /* Change secondary color */
    --accent-color: #FF9800;     /* Change accent color */
    /* ... other colors */
}
```

### Custom Rendering

Modify Three.js rendering in `public/modernApp.js`:

```javascript
// Change îlot color
renderIlot(ilot) {
    const material = new THREE.MeshBasicMaterial({ 
        color: 0x4CAF50,  // Custom color
        transparent: true, 
        opacity: 0.6 
    });
    // ... rest of rendering
}
```

## Performance Optimization

### Large Floor Plans (>5000m²)

Adjust processing options for better performance:

```javascript
{
    totalIlots: 30,        // Reduce from default 50
    margin: 1.5,           // Increase margin for faster collision detection
    spacing: 0.5,          // Increase spacing
    maxIterations: 5000    // Reduce iterations if placement takes too long
}
```

### Multi-Floor Performance

For buildings with 10+ floors, use batch processing:

```javascript
// Process floors in batches of 5
for (let i = 0; i < floors.length; i += 5) {
    const batch = floors.slice(i, i + 5);
    await fetch('/api/multi-floor/stack', {
        method: 'POST',
        body: JSON.stringify({ floors: batch })
    });
}
```

## Production Deployment

### Docker Deployment

Build and run with Docker:

```bash
docker build -t floorplan-pro .
docker run -p 5000:5000 -e NODE_ENV=production floorplan-pro
```

### Environment Variables for Production

```env
NODE_ENV=production
PORT=5000
BIND_ADDRESS=0.0.0.0

# Database (use PostgreSQL for multi-instance)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Security
ADMIN_API_KEY=secure_random_key_here
MASTER_KEY=encryption_key_for_secrets

# CORS (if frontend is on different domain)
CORS_ORIGIN=https://yourdomain.com

# Optional: Enable APS integration
# APS_CLIENT_ID=your_client_id
# APS_CLIENT_SECRET=your_client_secret
```

### Render.com Deployment

1. Connect GitHub repository to Render.com
2. Create new Web Service
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Add environment variables from production config above
6. Deploy

### Health Check Endpoints

Monitor application health:

```bash
# Basic health check
curl http://localhost:5000/health

# Detailed health status
curl http://localhost:5000/healthz

# Response format:
{
    "status": "ok",
    "timestamp": "2025-01-15T10:30:00.000Z",
    "bootTime": "2025-01-15T10:00:00.000Z",
    "uptimeSeconds": 1800,
    "cachedFloorPlans": 5,
    "sqliteReady": true,
    "mlBootstrapFinished": true
}
```

## Troubleshooting

### Common Issues

**1. DXF parsing fails**
- Ensure file is valid DXF/DWG format (ASCII R2000-R2018)
- Check file size (max 50MB by default)
- Verify file isn't corrupted

**2. No rooms detected**
- Walls must form closed polygons
- Check layer naming (MUR for walls)
- Ensure proper line connectivity

**3. Îlots not placing**
- Verify floor plan bounds are valid
- Check distribution totals 100%
- Increase margin if collision detection is too strict

**4. Corridors not generating**
- Ensure îlots are placed first
- Check facing row tolerance settings
- Verify corridor width isn't too large for available space

**5. Export fails**
- Check exports/ directory exists and is writable
- Verify Sharp library is installed for image processing
- Ensure sufficient disk space

### Debug Mode

Enable detailed logging:

```javascript
// In browser console:
localStorage.setItem('debug', 'true');

// In server (add to .env):
DEBUG=floorplan:*
```

### Performance Profiling

```javascript
// Profile multi-floor stack
const response = await fetch('/api/multi-floor/profile', {
    method: 'POST',
    body: JSON.stringify({ floors: stackData })
});

const profile = await response.json();
// Contains timing data for each processing stage
```

## Security Best Practices

### 1. Input Validation
All file uploads are validated for:
- File type (DXF/DWG only)
- File size (50MB limit)
- Malicious content

### 2. API Authentication
Protect admin endpoints with API key:

```javascript
// Add to requests:
headers: {
    'x-admin-api-key': 'your_secure_key'
}
```

### 3. Rate Limiting
Implement rate limiting for production:

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

### 4. HTTPS Only
Always use HTTPS in production:

```javascript
// Redirect HTTP to HTTPS
app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https' && process.env.NODE_ENV === 'production') {
        res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
        next();
    }
});
```

## Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
npm run test:integration
```

### Manual Testing Checklist

- [ ] Upload DXF file successfully
- [ ] Room detection works
- [ ] Îlot generation with custom distribution
- [ ] Corridor network generation
- [ ] Multi-floor stack alignment
- [ ] PDF export produces valid file
- [ ] Image export at different resolutions
- [ ] Keyboard shortcuts work
- [ ] Panel collapse/expand
- [ ] Camera reset functionality
- [ ] Measurement tools
- [ ] Undo/redo operations

## Support & Documentation

### Additional Resources

- **Architecture Documentation**: See `COMPLETE_SYSTEM_ARCHITECTURE.md`
- **API Reference**: All endpoints documented in `server.js`
- **Phase Guides**: See `PHASE2_COMPLETE.md` for feature evolution

### Getting Help

For issues or questions:
1. Check this integration guide
2. Review architecture documentation
3. Examine server logs for errors
4. Test with sample DXF files first

## Advanced Features

### Machine Learning Integration (Optional)

Enable ML-based layout optimization:

```javascript
// Train ML model on existing layouts
const response = await fetch('/api/ml/train', {
    method: 'POST',
    body: JSON.stringify({ layouts: trainingData })
});

// Use ML for predictions
const prediction = await fetch('/api/ml/predict', {
    method: 'POST',
    body: JSON.stringify({ floorPlan: cadData })
});
```

### Webhook Integration (Optional)

Setup webhooks for async processing:

```javascript
// Register webhook
await fetch('/api/aps/webhooks/register', {
    method: 'POST',
    headers: {
        'x-admin-api-key': 'your_key',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        callbackUrl: 'https://yourdomain.com/webhook',
        event: 'extraction.finished',
        system: 'derivative'
    })
});
```

### Custom Export Templates

Create custom PDF templates in `lib/exportManager.js`:

```javascript
async exportToPDF(floorPlan, ilots, corridors, options) {
    // Add custom header
    doc.fontSize(20).text('Custom Company Name', 50, 50);
    
    // Add custom footer
    doc.fontSize(10).text('Custom Footer Text', 50, 750);
    
    // ... rest of export logic
}
```

## Conclusion

This FloorPlan Pro system provides a complete, production-ready solution for CAD floor plan processing with intelligent îlot placement and corridor generation. The modern UI, robust backend, and professional visualization capabilities make it suitable for architectural firms, space planning consultants, and facility management applications.

All processing uses real CAD geometry with no simulations or mock data. The system is designed for scalability, reliability, and ease of integration into existing workflows.

For additional customization or enterprise features, the modular architecture allows easy extension of any component without disrupting core functionality.
