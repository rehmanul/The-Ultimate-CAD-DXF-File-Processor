const http = require('http');
const fs = require('fs');
const dxfPath = 'uploads/Test2.dxf';
const boundary = '----FB' + Date.now();
const dxfData = fs.readFileSync(dxfPath);
const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="Test2.dxf"\r\nContent-Type: application/octet-stream\r\n\r\n'),
    dxfData, Buffer.from('\r\n--' + boundary + '--\r\n')
]);
const req = http.request({
    hostname: 'localhost', port: 3000, path: '/api/jobs', method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }
}, (res) => {
    let data = ''; res.on('data', c => data += c); res.on('end', () => {
        const j = JSON.parse(data), ad = j.cadData || j;
        const fp = { walls: ad.walls || [], forbiddenZones: ad.forbiddenZones || [], bounds: ad.bounds, entities: ad.entities || [], entrances: ad.entrances || [] };
        const E = require('./lib/ProfessionalGridLayoutEngine');
        const e = new E(fp, { corridorWidth: 1.2 });
        const g = e.generate({});

        const lines = [];
        // Find unit 138 (0-indexed = 137, or search by label)
        const u138 = g.units.find(u => u.id === 138 || u.label?.includes('138'));
        // Also check by index
        const u137idx = g.units[137]; // 0-indexed

        lines.push('=== ILOT 138 SEARCH ===');
        lines.push('Total units: ' + g.units.length);

        if (u138) {
            lines.push('Found by id/label: x=' + u138.x.toFixed(3) + ' y=' + u138.y.toFixed(3) +
                ' w=' + u138.width.toFixed(3) + ' h=' + u138.height.toFixed(3) +
                ' cx=' + (u138.x + u138.width / 2).toFixed(3) + ' cy=' + (u138.y + u138.height / 2).toFixed(3));
        }
        if (u137idx) {
            lines.push('Index 137: x=' + u137idx.x.toFixed(3) + ' y=' + u137idx.y.toFixed(3) +
                ' w=' + u137idx.width.toFixed(3) + ' h=' + u137idx.height.toFixed(3) +
                ' cx=' + (u137idx.x + u137idx.width / 2).toFixed(3) + ' cy=' + (u137idx.y + u137idx.height / 2).toFixed(3));
        }

        // Find the target box - it's near the stairwell entrance (around x=14, y=20-23)
        // From the screenshot, it appears to be between the stairwell walls
        const suspects = g.units.filter(u => {
            return u.x > 12 && u.x < 16 && u.y > 18 && u.y < 25;
        });
        lines.push('\n=== BOXES NEAR STAIRWELL (x:12-16, y:18-25) ===');
        suspects.forEach((u, i) => {
            const cx = u.x + u.width / 2, cy = u.y + u.height / 2;
            lines.push('  [' + g.units.indexOf(u) + '] x=' + u.x.toFixed(2) + ' y=' + u.y.toFixed(2) +
                ' w=' + u.width.toFixed(2) + ' h=' + u.height.toFixed(2) +
                ' cx=' + cx.toFixed(2) + ' cy=' + cy.toFixed(2) + ' area=' + (u.width * u.height).toFixed(1));
        });

        // Check nearby FZ rects
        lines.push('\n=== FZ RECTS NEAR STAIRWELL (x:10-17, y:18-25) ===');
        e.fzRects.forEach((fz, i) => {
            if (fz.x + fz.w > 10 && fz.x < 17 && fz.y + fz.h > 18 && fz.y < 25) {
                lines.push('  FZ[' + i + ']: x=' + fz.x.toFixed(2) + ' y=' + fz.y.toFixed(2) +
                    ' w=' + fz.w.toFixed(2) + ' h=' + fz.h.toFixed(2) + ' type=' + (fz.type || ''));
            }
        });

        // Check nearby wall segments
        lines.push('\n=== WALL SEGS NEAR STAIRWELL (x:10-17, y:18-25) ===');
        const nearSegs = e.wallSegs.filter(s => {
            const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
            return mx > 10 && mx < 17 && my > 18 && my < 25;
        });
        nearSegs.forEach((s, i) => {
            const isH = Math.abs(s.y1 - s.y2) < 0.3;
            lines.push('  seg: (' + s.x1.toFixed(2) + ',' + s.y1.toFixed(2) + ')->(' +
                s.x2.toFixed(2) + ',' + s.y2.toFixed(2) + ') len=' + s.len.toFixed(2) + (isH ? ' H' : ' V'));
        });

        fs.writeFileSync('C:/tmp/diag_ilot138.txt', lines.join('\n'));
        console.log('Done - see C:/tmp/diag_ilot138.txt');
    });
});
req.write(body); req.end();
