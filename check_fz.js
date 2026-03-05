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
        const lines = ['WALLS: ' + fp.walls.length, 'WALL_SEGS: ' + e.wallSegs.length + ' (all: ' + e.allWallSegs.length + ')', 'FZ_RECTS: ' + e.fzRects.length];
        e.fzRects.forEach((fz, i) => {
            const aspect = (Math.max(fz.w, fz.h) / Math.min(fz.w, fz.h)).toFixed(1);
            lines.push('  FZ[' + i + ']: x=' + fz.x.toFixed(1) + ' y=' + fz.y.toFixed(1) + ' w=' + fz.w.toFixed(1) + ' h=' + fz.h.toFixed(1) + ' area=' + (fz.w * fz.h).toFixed(1) + ' aspect=' + aspect + ' ' + (fz.type || ''));
        });
        lines.push('UNITS: ' + g.units.length);
        lines.push('UNIQUE_WIDTHS: ' + new Set(g.units.map(u => u.width.toFixed(3))).size);
        fs.writeFileSync('C:/tmp/diag3.txt', lines.join('\n'));
        console.log('Done - see C:/tmp/diag3.txt');
    });
});
req.write(body); req.end();
