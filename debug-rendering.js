/**
 * Debug Rendering Issue
 * Analyzes why uploaded files render incorrectly
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const filePath = process.argv[2] || 'Samples/Test2.dxf';

function uploadFile(filePath) {
    return new Promise((resolve, reject) => {
        const fullPath = path.resolve(filePath);
        if (!fs.existsSync(fullPath)) {
            return resolve({ error: `File not found: ${fullPath}` });
        }

        const fileContent = fs.readFileSync(fullPath);
        const boundary = '----FormBoundary' + Date.now();
        const fileName = path.basename(fullPath);

        const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
            fileContent,
            Buffer.from(`\r\n--${boundary}--\r\n`)
        ]);

        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/jobs',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ error: 'Invalid JSON', raw: data.substring(0, 500) });
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function debugRendering() {
    console.log('='.repeat(70));
    console.log('RENDERING DEBUG: ' + path.basename(filePath));
    console.log('='.repeat(70));

    const result = await uploadFile(filePath);
    
    if (result.error || !result.cadData) {
        console.log('Upload failed:', result.error);
        return;
    }

    const data = result.cadData;
    
    console.log('\n📊 BASIC STATS:');
    console.log(`   Walls: ${data.walls?.length || 0}`);
    console.log(`   Rooms: ${data.rooms?.length || 0}`);
    console.log(`   Entrances: ${data.entrances?.length || 0}`);
    console.log(`   Forbidden: ${data.forbiddenZones?.length || 0}`);
    console.log(`   Envelope: ${data.envelope?.length || 0}`);
    console.log(`   Bounds: ${JSON.stringify(data.bounds)}`);

    // Check wall format
    console.log('\n🧱 WALL ANALYSIS:');
    if (data.walls?.length > 0) {
        const sample = data.walls[0];
        console.log(`   Sample wall: ${JSON.stringify(sample).substring(0, 200)}`);
        
        // Check for valid coordinates
        let validWalls = 0;
        let invalidWalls = 0;
        let wallsWithPolygon = 0;
        let wallsWithStartEnd = 0;
        
        data.walls.forEach((wall, i) => {
            if (wall.polygon) wallsWithPolygon++;
            if (wall.start && wall.end) wallsWithStartEnd++;
            
            const hasValidCoords = wall.start?.x !== undefined && 
                                   wall.start?.y !== undefined &&
                                   wall.end?.x !== undefined && 
                                   wall.end?.y !== undefined;
            
            if (hasValidCoords) {
                validWalls++;
            } else {
                invalidWalls++;
                if (invalidWalls <= 3) {
                    console.log(`   Invalid wall #${i}: ${JSON.stringify(wall)}`);
                }
            }
        });
        
        console.log(`   Valid walls: ${validWalls}`);
        console.log(`   Invalid walls: ${invalidWalls}`);
        console.log(`   With polygon: ${wallsWithPolygon}`);
        console.log(`   With start/end: ${wallsWithStartEnd}`);
        
        // Check coordinate ranges
        const allX = [];
        const allY = [];
        data.walls.forEach(wall => {
            if (wall.start) { allX.push(wall.start.x); allY.push(wall.start.y); }
            if (wall.end) { allX.push(wall.end.x); allY.push(wall.end.y); }
        });
        
        if (allX.length > 0) {
            console.log(`\n   Coordinate ranges:`);
            console.log(`   X: ${Math.min(...allX).toFixed(2)} to ${Math.max(...allX).toFixed(2)}`);
            console.log(`   Y: ${Math.min(...allY).toFixed(2)} to ${Math.max(...allY).toFixed(2)}`);
        }
    } else {
        console.log('   ❌ NO WALLS DETECTED!');
    }

    // Check bounds vs actual coordinates
    console.log('\n📐 BOUNDS ANALYSIS:');
    if (data.bounds) {
        const { minX, minY, maxX, maxY } = data.bounds;
        const width = maxX - minX;
        const height = maxY - minY;
        console.log(`   Bounds: ${width.toFixed(2)} x ${height.toFixed(2)} m`);
        
        if (width < 1 || height < 1) {
            console.log('   ⚠️  WARNING: Bounds are very small! Scale issue?');
        }
        if (width > 1000 || height > 1000) {
            console.log('   ⚠️  WARNING: Bounds are very large! Scale issue?');
        }
    }

    // Check rooms
    console.log('\n🏠 ROOM ANALYSIS:');
    if (data.rooms?.length > 0) {
        console.log(`   Total rooms: ${data.rooms.length}`);
        const sample = data.rooms[0];
        console.log(`   Sample room: ${JSON.stringify(sample).substring(0, 200)}`);
        
        // Check if rooms have bounds
        const roomsWithBounds = data.rooms.filter(r => r.bounds).length;
        const roomsWithPolygon = data.rooms.filter(r => r.polygon).length;
        console.log(`   With bounds: ${roomsWithBounds}`);
        console.log(`   With polygon: ${roomsWithPolygon}`);
    } else {
        console.log('   ❌ NO ROOMS DETECTED!');
    }

    // Check envelope
    console.log('\n📦 ENVELOPE ANALYSIS:');
    if (data.envelope?.length > 0) {
        console.log(`   Envelope segments: ${data.envelope.length}`);
        const sample = data.envelope[0];
        console.log(`   Sample: ${JSON.stringify(sample)}`);
    } else {
        console.log('   No envelope - will be generated from bounds');
    }

    // Diagnostic conclusion
    console.log('\n' + '='.repeat(70));
    console.log('DIAGNOSIS');
    console.log('='.repeat(70));
    
    const issues = [];
    
    if (!data.walls || data.walls.length === 0) {
        issues.push('❌ CRITICAL: No walls detected - floor plan will be empty!');
    } else if (data.walls.length < 10) {
        issues.push(`⚠️  WARNING: Only ${data.walls.length} walls - may be incomplete`);
    }
    
    if (data.walls?.length > 0 && data.walls.filter(w => !w.start || !w.end).length > data.walls.length * 0.5) {
        issues.push('⚠️  WARNING: Most walls lack start/end coordinates');
    }
    
    if (!data.rooms || data.rooms.length === 0) {
        issues.push('⚠️  WARNING: No rooms detected - ilot placement may fail');
    }
    
    if (issues.length === 0) {
        console.log('✅ Data looks correct - issue is likely in frontend rendering');
        console.log('\nPossible frontend issues:');
        console.log('   - Camera not positioned correctly');
        console.log('   - Walls drawn with wrong color (invisible)');
        console.log('   - Scale mismatch between walls and bounds');
    } else {
        issues.forEach(issue => console.log(issue));
    }
    
    console.log('\n' + '='.repeat(70));
}

debugRendering().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
