/**
 * COSTO Pipeline Diagnostic
 * Tests the complete flow from file upload to COSTO output
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const TEST_FILES = [
    'Samples/Test2.dxf',
    'Samples/Files/Test2.dwg',
    'Samples/Files/Test.dxf'
];

const BASE_URL = 'http://localhost:3000';

async function uploadAndProcess(filePath) {
    return new Promise((resolve, reject) => {
        const fullPath = path.resolve(filePath);

        if (!fs.existsSync(fullPath)) {
            return resolve({ error: `File not found: ${fullPath}` });
        }

        const boundary = '----FormBoundary' + Date.now();
        const fileName = path.basename(fullPath);
        const fileContent = fs.readFileSync(fullPath);

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

async function generateIlots(cadData) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            floorPlan: {
                walls: cadData.walls || [],
                forbiddenZones: cadData.forbiddenZones || [],
                entrances: cadData.entrances || [],
                bounds: cadData.bounds,
                rooms: cadData.rooms || [],
                entities: cadData.entities || []
            },
            distribution: { '0-2': 25, '2-5': 35, '5-10': 30, '10-20': 10 },
            options: {
                totalIlots: 100,
                corridorWidth: 1.2,
                style: 'COSTO',
                strictMode: true,
                fillPlan: true
            }
        });

        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/ilots',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
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
        req.write(postData);
        req.end();
    });
}

async function runDiagnostics() {
    console.log('='.repeat(70));
    console.log('COSTO Pipeline Diagnostic');
    console.log('='.repeat(70));

    for (const file of TEST_FILES) {
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`Testing: ${file}`);
        console.log('─'.repeat(70));

        // Step 1: Upload and process
        console.log('\n[1/3] Uploading file...');
        const uploadResult = await uploadAndProcess(file);

        if (uploadResult.error) {
            console.log(`  ❌ Upload failed: ${uploadResult.error}`);
            continue;
        }

        if (!uploadResult.cadData) {
            console.log(`  ❌ No cadData in response`);
            console.log(`  Response keys: ${Object.keys(uploadResult).join(', ')}`);
            continue;
        }

        const cadData = uploadResult.cadData;
        console.log(`  ✅ Upload successful`);
        console.log(`     Walls: ${cadData.walls?.length || 0}`);
        console.log(`     Rooms: ${cadData.rooms?.length || 0}`);
        console.log(`     Bounds: ${JSON.stringify(cadData.bounds)}`);

        // Step 2: Generate ilots with COSTO style
        console.log('\n[2/3] Generating COSTO ilots...');
        const ilotResult = await generateIlots(cadData);

        if (ilotResult.error) {
            console.log(`  ❌ Ilot generation failed: ${ilotResult.error}`);
            continue;
        }

        console.log(`  ✅ Generated ${ilotResult.ilots?.length || 0} ilots`);
        console.log(`     useCostoCorridors: ${ilotResult.useCostoCorridors}`);
        console.log(`     COSTO Corridors: ${ilotResult.costoCorridors?.length || 0}`);
        console.log(`     COSTO Radiators: ${ilotResult.costoRadiators?.length || 0}`);
        console.log(`     Circulation Paths: ${ilotResult.costoCirculationPaths?.length || 0}`);

        // Step 3: Analysis
        console.log('\n[3/3] Analysis:');
        if (ilotResult.useCostoCorridors && ilotResult.costoRadiators?.length > 0) {
            console.log(`  ✅ COSTO output generated correctly!`);
            console.log(`     - ${ilotResult.costoRadiators.length} red zigzag radiators`);
            console.log(`     - ${ilotResult.costoCorridors.length} corridors`);
            console.log(`     - ${ilotResult.costoCirculationPaths?.length || 0} circulation paths`);
        } else {
            console.log(`  ⚠️  NOT proper COSTO output`);
            if (!ilotResult.useCostoCorridors) {
                console.log(`     - useCostoCorridors is false (should be true)`);
            }
            if (!ilotResult.costoRadiators?.length) {
                console.log(`     - No radiators generated (should have red zigzags)`);
            }
        }
    }

    console.log('\n' + '='.repeat(70));
    console.log('Diagnostic Complete');
    console.log('='.repeat(70));
}

runDiagnostics().catch(err => {
    console.error('Diagnostic failed:', err.message);
    process.exit(1);
});
