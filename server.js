const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const ProfessionalCADProcessor = require('./lib/professionalCADProcessor');
const RowBasedIlotPlacer = require('./lib/RowBasedIlotPlacer');
const ProductionCorridorGenerator = require('./lib/productionCorridorGenerator');
const AdvancedCorridorGenerator = require('./lib/advancedCorridorGenerator');
const ExportManager = require('./lib/exportManager');
const ArchitecturalValidator = require('./lib/architecturalValidator');
const AnnotationAndCorrection = require('./lib/annotationAndCorrection');
const sqliteAdapter = require('./lib/sqliteAdapter');
const CrossFloorRouter = require('./lib/crossFloorRouter');
const MultiFloorProfiler = require('./lib/multiFloorProfiler');
const MultiFloorReporter = require('./lib/multiFloorReporter');
const { performance } = require('perf_hooks');
const MultiFloorManager = require('./lib/multiFloorManager');
const floorPlanStore = require('./lib/floorPlanStore');
const ML_BOOT_PREFIX = '[Production ML System]';

// --- RESTORED INITIALIZATION ---
const PUBLIC_DIR = path.join(__dirname, 'public');
const DIST_DIR = path.join(PUBLIC_DIR, 'dist');
// Always serve from public directory (new clean build)
const STATIC_ROOT = PUBLIC_DIR;
const USING_DIST_BUILD = false;
const SERVER_BOOT_TIME = new Date();
const app = express();
app.locals.staticRoot = STATIC_ROOT;
app.locals.bootTime = SERVER_BOOT_TIME.toISOString();

// DEBUG: Verify public directory and index.html
console.log('[Startup] PUBLIC_DIR:', PUBLIC_DIR);
const indexHtmlPath = path.join(PUBLIC_DIR, 'index.html');
console.log('[Startup] Checking index.html at:', indexHtmlPath);
if (fs.existsSync(indexHtmlPath)) {
    console.log('[Startup] index.html exists!');
} else {
    console.error('[Startup] index.html MISSING!');
    // List contents of public dir
    if (fs.existsSync(PUBLIC_DIR)) {
        console.log('[Startup] Contents of public:', fs.readdirSync(PUBLIC_DIR));
    } else {
        console.error('[Startup] public directory MISSING!');
    }
}
// -------------------------------

const PYTHON_GENERATOR_PATH = path.join(__dirname, 'lib', 'corridor-generator-complete.py');
const PYTHON_CANDIDATES = (() => {
    const envSpec = process.env.PYTHON_EXECUTABLE || process.env.PYTHON_PATH;
    const candidates = [];
    if (envSpec) candidates.push(envSpec);
    if (process.platform === 'win32') {
        candidates.push('python', 'python3', 'py -3', 'py');
    } else {
        candidates.push('python3', 'python', 'python2');
    }
    return candidates;
})();

function tokenizeCommand(spec) {
    const matches = spec.match(/"([^"]*)"|[^\s"]+/g);
    if (!matches) return [];
    return matches.map((token) => {
        if (token.startsWith('"') && token.endsWith('"')) {
            return token.slice(1, -1);
        }
        return token;
    });
}

function parsePythonSpec(spec) {
    if (!spec || typeof spec !== 'string') return null;
    const parts = tokenizeCommand(spec.trim());
    if (!parts.length) return null;
    return { command: parts[0], args: parts.slice(1) };
}

function resolvePythonExecutable() {
    for (const candidate of PYTHON_CANDIDATES) {
        const parsed = parsePythonSpec(candidate);
        if (!parsed) continue;
        try {
            const check = spawnSync(parsed.command, [...parsed.args, '--version'], { stdio: 'ignore' });
            if (check && check.status === 0) {
                return parsed;
            }
        } catch (error) {
            // Ignore detection errors and continue with next candidate
        }
    }
    return null;
}

const PYTHON_EXECUTION_SPEC = resolvePythonExecutable();
if (!PYTHON_EXECUTION_SPEC) {
    console.log('[Corridor Generator] Python not detected. Using production JavaScript corridor engine.');
} else {
    const argsPreview = PYTHON_EXECUTION_SPEC.args.length ? ` ${PYTHON_EXECUTION_SPEC.args.join(' ')}` : '';
    console.log(`[Corridor Generator] Python available: ${PYTHON_EXECUTION_SPEC.command}${argsPreview}`);
}

function resolveStoredIlots(planId) {
    if (Array.isArray(global.lastPlacedIlots) && global.lastPlacedIlots.length) {
        return global.lastPlacedIlots;
    }
    if (!planId) return [];
    try {
        const storedLayout = floorPlanStore.getLayout(planId);
        if (storedLayout && Array.isArray(storedLayout.ilots) && storedLayout.ilots.length) {
            return storedLayout.ilots;
        }
    } catch (error) {
        console.warn('[Corridor Generator] Unable to load cached îlots:', error.message || error);
    }
    return [];
}

function buildProductionCorridorNetwork(floorPlanData, generationOptions = {}) {
    const corridorWidth = typeof generationOptions.corridor_width === 'number'
        ? generationOptions.corridor_width
        : (typeof generationOptions.corridorWidth === 'number' ? generationOptions.corridorWidth : 1.5);

    const planId = floorPlanData?.urn || floorPlanData?.id || null;
    const ilots = resolveStoredIlots(planId);

    if (!Array.isArray(ilots) || ilots.length === 0) {
        return {
            corridors: [],
            arrows: [],
            statistics: {
                corridorCount: 0,
                arrowCount: 0,
                corridorWidth,
                reason: 'no-ilots-available'
            },
            metadata: {
                engine: 'production-js',
                timestamp: new Date().toISOString()
            }
        };
    }

    const normalizedFloorPlan = {
        walls: Array.isArray(floorPlanData?.walls) ? floorPlanData.walls : [],
        forbiddenZones: Array.isArray(floorPlanData?.forbiddenZones)
            ? floorPlanData.forbiddenZones
            : (Array.isArray(floorPlanData?.forbidden_zones) ? floorPlanData.forbidden_zones : []),
        entrances: Array.isArray(floorPlanData?.entrances) ? floorPlanData.entrances : [],
        bounds: floorPlanData?.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        rooms: Array.isArray(floorPlanData?.rooms) ? floorPlanData.rooms : [],
        urn: planId
    };

    const corridorGenerator = new ProductionCorridorGenerator(normalizedFloorPlan, ilots, { corridorWidth });
    const rawCorridors = corridorGenerator.generateCorridors() || [];
    const corridors = rawCorridors.map(sanitizeCorridor).filter(Boolean);

    // 🎯 ADVANCED ARROW GENERATION - TRUE PRODUCTION SYSTEM
    const AdvancedCorridorArrowGenerator = require('./lib/advancedCorridorArrowGenerator');
    const arrowGenerator = new AdvancedCorridorArrowGenerator({
        arrowLength: 2.0,
        arrowSpacing: 3.0,
        arrowWidth: 0.5,
        corridorWidth: corridorWidth
    });

    const arrows = generationOptions.generate_arrows !== false
        ? arrowGenerator.generateArrows(corridors, normalizedFloorPlan.entrances, ilots)
        : [];

    const totalArea = corridors.reduce((sum, corridor) => sum + (Number(corridor.area) || 0), 0);
    const totalLength = corridors.reduce((sum, corridor) => sum + (Number(corridor.length) || 0), 0);

    return {
        corridors,
        arrows,
        statistics: {
            corridorCount: corridors.length,
            arrowCount: arrows.length,
            corridorWidth,
            totalCorridorArea: Number.isFinite(totalArea) ? parseFloat(totalArea.toFixed(2)) : totalArea,
            totalCorridorLength: Number.isFinite(totalLength) ? parseFloat(totalLength.toFixed(2)) : totalLength,
            fallback: true,
            arrowsGenerated: arrows.length > 0
        },
        metadata: {
            engine: 'js-advanced-arrows',
            sourceIlotCount: ilots.length,
            timestamp: new Date().toISOString()
        }
    };
}
let mlBootstrapPromise = null;
let mlBootstrapFinished = false;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 10000;

// In-memory CAD cache keyed by URN for request-scoped analysis
const cadCache = new Map();

// Load environment variables
require('dotenv').config();

const APS_BASE_URL = process.env.APS_BASE_URL || 'https://developer.api.autodesk.com';
const APS_CLIENT_ID = process.env.APS_CLIENT_ID || '';
const APS_CLIENT_SECRET = process.env.APS_CLIENT_SECRET || '';
let cachedApsToken = null;
let tokenExpiry = 0;

// Production readiness checks
function checkProductionRequirements() {
    const env = process.env.NODE_ENV || 'development';
    if (env === 'production') {
        const required = [];
        const missing = [];
        if (missing.length) {
            console.error('Missing required environment variables for production:', missing.join(', '));
            console.error('Set them in your environment or use Docker Compose with appropriate env vars.');
            process.exit(1);
        }
    } else {
        // In non-production warn when critical secrets are missing
        if (!process.env.APS_CLIENT_ID || !process.env.APS_CLIENT_SECRET) console.warn('APS_CLIENT_ID/APS_CLIENT_SECRET not set; APS operations will fail.');
    }
}

// Ensure necessary directories exist
function ensureDirectories() {
    const exportsDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
}

function runPythonCorridorGenerator(floorPlanData, generationOptions) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const useFallback = (reason) => {
            if (settled) return;
            settled = true;
            if (reason) {
                console.log('[Corridor Generator] Using JavaScript engine:', reason);
            }
            try {
                const jsNetwork = buildProductionCorridorNetwork(floorPlanData, generationOptions);
                resolve(jsNetwork);
            } catch (jsError) {
                reject(jsError);
            }
        };

        try {
            if (!fs.existsSync(PYTHON_GENERATOR_PATH) || !PYTHON_EXECUTION_SPEC) {
                return useFallback('Python not available, using JavaScript engine');
            }

            const pythonArgs = [...PYTHON_EXECUTION_SPEC.args, PYTHON_GENERATOR_PATH];
            const python = spawn(PYTHON_EXECUTION_SPEC.command, pythonArgs, {
                cwd: path.dirname(PYTHON_GENERATOR_PATH)
            });

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            python.on('error', (err) => {
                useFallback(`Failed to start Python generator: ${err.message}`);
            });

            python.on('close', (code) => {
                if (settled) return;
                if (code !== 0) {
                    return useFallback(stderr || `Python generator exited with code ${code}`);
                }

                try {
                    const parsed = JSON.parse(stdout || '{}');
                    if (parsed && parsed.error) {
                        const message = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
                        return useFallback(message);
                    }
                    if (parsed && parsed.metadata && parsed.metadata.error) {
                        const message = typeof parsed.metadata.error === 'string'
                            ? parsed.metadata.error
                            : JSON.stringify(parsed.metadata.error);
                        return useFallback(message);
                    }
                    if (stderr && stderr.trim().length) {
                        console.warn('[Python Corridor Generator]', stderr.trim());
                    }
                    settled = true;
                    resolve(parsed);
                } catch (parseError) {
                    useFallback(`Failed to parse Python generator output: ${parseError.message}`);
                }
            });

            // Handle stdin errors (EPIPE, etc.)
            python.stdin.on('error', (err) => {
                if (!settled) {
                    console.warn('[Python Corridor Generator] Stdin error:', err.message);
                    // Don't fail immediately - the process might still produce output
                }
            });

            const payload = JSON.stringify({
                floor_plan: floorPlanData,
                options: generationOptions
            });

            try {
                python.stdin.write(payload);
                python.stdin.end();
            } catch (writeError) {
                console.warn('[Python Corridor Generator] Write error:', writeError.message);
                // Process might have already exited - wait for close event
            }
        } catch (error) {
            useFallback(error.message || error);
        }
    });
}

checkProductionRequirements();
ensureDirectories();

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err && err.stack ? err.stack : err);
    // In production exit to allow supervisor to restart
    if ((process.env.NODE_ENV || 'development') === 'production') process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    if ((process.env.NODE_ENV || 'development') === 'production') process.exit(1);
});

// Pure Three.js - no Autodesk APS needed

const crypto = require('crypto');
const os = require('os');
const { safeNum, safePoint, sanitizeIlot, sanitizeCorridor, sanitizeArrow } = require('./lib/sanitizers');



// Webhook storage: switched to SQLite-backed store (lib/webhookStore)
const webhookStore = require('./lib/webhookStore');

function encryptSecret(plain) {
    const key = _getMasterKeyBuffer();
    if (!key) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(token) {
    const key = _getMasterKeyBuffer();
    if (!key) return null;
    try {
        const [ivHex, tagHex, encHex] = token.split(':');
        if (!ivHex || !tagHex || !encHex) return null;
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const encrypted = Buffer.from(encHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return out.toString('utf8');
    } catch (e) {
        console.warn('Failed to decrypt secret:', e.message);
        return null;
    }
}

function isEncryptedToken(s) {
    return typeof s === 'string' && s.split(':').length === 3;
}

// Normalize CAD geometry to a canonical shape expected by the frontend.
// Ensures each wall has .start and .end with numeric {x,y} and preserves polygon when present.
function normalizeCadData(cad) {
    if (!cad || typeof cad !== 'object') return cad;

    const norm = Object.assign({}, cad);

    if (!norm.urn && cad && (cad.urn || cad.id)) {
        norm.urn = cad.urn || cad.id;
    }

    // Preserve rooms array with proper structure
    if (Array.isArray(cad.rooms)) {
        norm.rooms = cad.rooms.map(r => ({
            id: r.id,
            name: r.name,
            area: Number(r.area) || 0,
            type: r.type,
            bounds: r.bounds,
            center: r.center,
            polygon: r.polygon
        }));
    }

    // Calculate totalArea from rooms or bounds
    if (Array.isArray(norm.rooms) && norm.rooms.length > 0) {
        norm.totalArea = norm.rooms.reduce((sum, r) => sum + (Number(r.area) || 0), 0);
    } else if (cad.bounds) {
        const width = (cad.bounds.maxX || 0) - (cad.bounds.minX || 0);
        const height = (cad.bounds.maxY || 0) - (cad.bounds.minY || 0);
        norm.totalArea = width * height;
    } else {
        norm.totalArea = cad.totalArea || 0;
    }

    // normalize walls
    if (Array.isArray(cad.walls)) {
        norm.walls = cad.walls.map(w => {
            try {
                const out = Object.assign({}, w);
                // if already has numeric start/end, use them
                if (out.start && typeof out.start.x === 'number' && typeof out.start.y === 'number' && out.end && typeof out.end.x === 'number' && typeof out.end.y === 'number') {
                    return out;
                }

                // if polygon present, take first two points as start/end
                if (Array.isArray(out.polygon) && out.polygon.length >= 2) {
                    const s = out.polygon[0];
                    const e = out.polygon[1];
                    if (Array.isArray(s) && typeof s[0] === 'number' && typeof s[1] === 'number' && Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number') {
                        out.start = { x: Number(s[0]), y: Number(s[1]) };
                        out.end = { x: Number(e[0]), y: Number(e[1]) };
                        return out;
                    }
                }

                // if line-like shape with start/end as objects but maybe strings, coerce
                if (out.start && out.end) {
                    const sx = Number(out.start.x);
                    const sy = Number(out.start.y);
                    const ex = Number(out.end.x);
                    const ey = Number(out.end.y);
                    if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(ex) && Number.isFinite(ey)) {
                        out.start = { x: sx, y: sy };
                        out.end = { x: ex, y: ey };
                        return out;
                    }
                }

                // fallback: try to infer from segment fields (startX/startY/endX/endY)
                if (typeof out.x1 === 'number' && typeof out.y1 === 'number' && typeof out.x2 === 'number' && typeof out.y2 === 'number') {
                    out.start = { x: Number(out.x1), y: Number(out.y1) };
                    out.end = { x: Number(out.x2), y: Number(out.y2) };
                    return out;
                }

                // give an explicit minimal start/end if nothing else
                return out;
            } catch (e) {
                return w;
            }
        }).filter(Boolean);
    }

    // normalize forbiddenZones and entrances polygons to arrays of [x,y]
    if (Array.isArray(cad.forbiddenZones)) {
        norm.forbiddenZones = cad.forbiddenZones.map(z => {
            if (Array.isArray(z.polygon)) {
                return Object.assign({}, z, { polygon: z.polygon.map(pt => Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : pt).filter(Boolean) });
            }
            return z;
        }).filter(Boolean);
    }

    if (Array.isArray(cad.entrances)) {
        norm.entrances = cad.entrances.map(e => {
            if (Array.isArray(e.polygon)) {
                return Object.assign({}, e, { polygon: e.polygon.map(pt => Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : pt).filter(Boolean) });
            }
            return e;
        }).filter(Boolean);
    }

    return norm;
}

function normalizeDistribution(distribution) {
    const fallback = { '1-3': 0.25, '3-5': 0.35, '5-10': 0.40 };
    if (!distribution || typeof distribution !== 'object') return fallback;

    const ordered = Object.entries(distribution).map(([range, value]) => {
        let weight = Number(value);
        if (Number.isNaN(weight) || weight < 0) weight = 0;
        if (weight > 1.01) weight = weight / 100;
        return [range, weight];
    }).sort((a, b) => {
        const aMin = parseFloat(a[0].split('-')[0]);
        const bMin = parseFloat(b[0].split('-')[0]);
        return aMin - bMin;
    });

    const total = ordered.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) return fallback;

    const normalized = {};
    ordered.forEach(([range, weight]) => {
        normalized[range] = weight / total;
    });

    return normalized;
}

async function getAPSToken(scopes = 'data:read data:write') {
    if (!APS_CLIENT_ID || !APS_CLIENT_SECRET) {
        throw new Error('APS_NOT_CONFIGURED');
    }

    if (cachedApsToken && tokenExpiry && (Date.now() < tokenExpiry - 60000)) {
        return cachedApsToken;
    }

    const params = new URLSearchParams();
    params.append('client_id', APS_CLIENT_ID);
    params.append('client_secret', APS_CLIENT_SECRET);
    params.append('grant_type', 'client_credentials');
    params.append('scope', scopes);

    const response = await axios.post(`${APS_BASE_URL}/authentication/v2/token`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const expiresIn = Number(response.data.expires_in) || 1800;
    cachedApsToken = response.data.access_token;
    tokenExpiry = Date.now() + expiresIn * 1000;

    return cachedApsToken;
}


// If there is an existing webhooks.json (dev store), migrate entries into SQLite on first run
function migrateJsonStoreToSqlite() {
    const jsonFile = path.join(__dirname, 'webhooks.json');
    if (!fs.existsSync(jsonFile)) return;
    try {
        const raw = fs.readFileSync(jsonFile, 'utf8') || '{}';
        const store = JSON.parse(raw || '{}');
        const hooks = store.hooks || [];
        hooks.forEach(h => {
            // Ensure secret is encrypted when MASTER_KEY is present
            let secretToStore = h.secret || null;
            if (secretToStore && MASTER_KEY && !isEncryptedToken(secretToStore)) {
                const enc = encryptSecret(secretToStore);
                if (enc) secretToStore = enc;
            }
            const entry = {
                id: h.id || h.location || `${h.system}:${h.event}:${Date.now()}`,
                system: h.system,
                event: h.event,
                callbackUrl: h.callbackUrl,
                scope: h.scope || {},
                secret: secretToStore,
                location: h.location || null,
                createdAt: h.createdAt || new Date().toISOString()
            };
            try { webhookStore.addHook(entry); } catch (e) { /* ignore individual failures */ }
        });
        // Optionally keep the json file for backup purposes; do not delete automatically.
        console.log(`Migrated ${hooks.length} hooks from webhooks.json into SQLite store.`);
    } catch (e) {
        console.warn('Failed to migrate webhooks.json into SQLite store:', e.message);
    }
}

// Run migration once at startup
migrateJsonStoreToSqlite();

// Attempt to migrate transforms.json into SQLite-backed transform store if available
try {
    if (transformStore && typeof transformStore.migrateJsonToSqlite === 'function') {
        const migrated = transformStore.migrateJsonToSqlite();
        if (migrated && migrated > 0) console.log(`Migrated ${migrated} transform entries into SQLite transform store.`);
    }
} catch (e) { /* ignore */ }

function generateSecret(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

function verifyWebhookSignature(req) {
    // Accept signatures in common headers
    const sigHeader = req.headers['x-aps-signature'] || req.headers['x-hook-signature'] || req.headers['x-signature'] || req.headers['x-adsk-signature'];
    if (!sigHeader) return false;

    try {
        const raw = req.rawBody || (req.body ? Buffer.from(JSON.stringify(req.body)) : Buffer.from(''));

        // Determine which secret to use: prefer global APS_WEBHOOK_SECRET, else lookup per-hook secret from payload/hook id
        let secretToUse = APS_WEBHOOK_SECRET || null;
        if (!secretToUse) {
            // Try to find hook id in common locations
            const payload = req.body || {};
            const hookId = payload.id || payload.hookId || payload.notificationId || payload.hook?.id || req.headers['x-hook-id'] || null;
            if (hookId) {
                try {
                    const hook = webhookStore.getHookById(hookId) || webhookStore.getHooks().find(h => (h.location && h.location.endsWith(hookId)) || h.id === hookId);
                    if (hook && hook.secret) {
                        // decrypt if encrypted
                        if (isEncryptedToken(hook.secret)) {
                            const dec = decryptSecret(hook.secret);
                            if (dec) secretToUse = dec;
                        } else {
                            secretToUse = hook.secret;
                        }
                    }
                } catch (e) {
                    // ignore lookup errors
                }
            }
        }

        if (!secretToUse) {
            // In non-production allow missing secret only for local demos
            if ((process.env.NODE_ENV || 'development') === 'production') {
                console.error('No webhook secret available for verification');
                return false;
            } else {
                console.warn('No webhook secret available; skipping verification in non-production');
                return true;
            }
        }

        // header may be like 'sha256=...' or 'sha1=...'
        const header = sigHeader.trim();
        let algo = 'sha256';
        let incoming = header;
        const m = header.match(/^(sha1|sha256)=(.+)$/i);
        if (m) {
            algo = m[1].toLowerCase();
            incoming = m[2];
        }

        let computed;
        if (algo === 'sha1') {
            computed = crypto.createHmac('sha1', secretToUse).update(raw).digest('hex');
        } else {
            computed = crypto.createHmac('sha256', secretToUse).update(raw).digest('hex');
        }

        const a = Buffer.from(computed, 'hex');
        const b = Buffer.from(incoming, 'hex');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch (e) {
        console.error('Webhook verification error:', e.message);
        return false;
    }
}

// Admin API key middleware - if ADMIN_API_KEY is set, require it on admin routes
function adminAuth(req, res, next) {
    if (!ADMIN_API_KEY) return next();
    // Accept api key via header x-admin-api-key, query param admin_api_key, or Bearer token
    const key = (req.headers['x-admin-api-key'] || req.query.admin_api_key || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '').toString();
    if (!key) return res.status(401).json({ error: 'Missing admin API key' });
    if (key !== ADMIN_API_KEY) return res.status(403).json({ error: 'Invalid admin API key' });
    return next();
}

app.use(cors());
// Capture raw body for webhook signature verification
app.use(express.json({
    limit: '50mb',
    verify: function (req, res, buf) {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({
    limit: '50mb',
    extended: true,
    verify: function (req, res, buf) {
        req.rawBody = buf;
    }
}));

// DEBUG: Explicit root route to diagnose 404
app.get('/', (req, res) => {
    console.log('[Debug] GET / request received');
    const indexHtmlPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
        console.log('[Debug] Serving index.html from:', indexHtmlPath);
        res.sendFile(indexHtmlPath);
    } else {
        console.error('[Debug] index.html NOT FOUND at:', indexHtmlPath);
        res.status(404).send('Debug: index.html not found on server at ' + indexHtmlPath);
    }
});

// Fix MIME types for ES modules - CRITICAL for Three.js
express.static.mime.define({
    'application/javascript': ['js', 'mjs'],
    'text/javascript': ['js', 'mjs']
});

// Set correct MIME type for all .js files
app.use((req, res, next) => {
    if (req.path.endsWith('.js') || req.path.endsWith('.mjs')) {
        res.type('application/javascript');
    }
    next();
});

const staticCacheMaxAge = USING_DIST_BUILD ? '1h' : 0;
app.use(express.static(STATIC_ROOT, {
    maxAge: staticCacheMaxAge,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
    }
}));
// Serve static assets
app.use('/libs', express.static(path.join(PUBLIC_DIR, 'libs'), {
    maxAge: staticCacheMaxAge,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
    }
}));
app.use('/exports', express.static(path.join(__dirname, 'exports')));

// Phase 2: Register preset management routes
app.use('/api', presetRoutes);

// Phase 3: Register ML training and optimization routes
app.use('/api/ml', mlRoutes);

// Phase 4 foundation: stack multiple floors and compute vertical circulation
app.post('/api/multi-floor/stack', (req, res) => {
    try {
        const { floors, options = {} } = req.body || {};

        if (!Array.isArray(floors) || floors.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Request must include a non-empty floors array'
            });
        }

        const manager = new MultiFloorManager(options);
        const startedAt = performance.now();
        const result = manager.stackFloors(floors);
        const durationMs = performance.now() - startedAt;

        res.json({
            success: true,
            result,
            metrics: {
                durationMs,
                floorCount: result.floors?.length || 0,
                connectorCount: result.connectors?.length || 0,
                edgeCount: result.edges?.length || 0,
                warningCount: result.warnings?.length || 0
            }
        });
    } catch (error) {
        console.error('Multi-floor stacking error:', error && error.stack ? error.stack : error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to stack floors'
        });
    }
});

app.post('/api/multi-floor/corridors', (req, res) => {
    try {
        const { floors = [], connectors = [], edges = [], options = {} } = req.body || {};

        if (!Array.isArray(connectors) || connectors.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Connector data required'
            });
        }

        const startedAt = performance.now();
        const routes = CrossFloorRouter.computeRoutes(floors, connectors, edges, options);
        const durationMs = performance.now() - startedAt;
        res.json({
            success: true,
            routes,
            metrics: {
                durationMs,
                connectorCount: connectors.length,
                edgeCount: edges.length,
                routeCount: routes.routes?.length || 0,
                segmentCount: routes.segments?.length || 0,
                unreachable: routes.summary?.unreachable?.length || 0
            }
        });
    } catch (error) {
        console.error('Cross-floor routing error:', error && error.stack ? error.stack : error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to compute cross-floor corridors'
        });
    }
});

app.post('/api/multi-floor/profile', (req, res) => {
    try {
        const { floors = [], options = {} } = req.body || {};
        const startedAt = performance.now();
        const profile = MultiFloorProfiler.profileMultiFloor(floors, options);
        const durationMs = performance.now() - startedAt;
        res.json({
            success: true,
            profile,
            metrics: {
                durationMs
            }
        });
    } catch (error) {
        console.error('Multi-floor profiling error:', error && error.stack ? error.stack : error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to profile multi-floor stack'
        });
    }
});

app.post('/api/multi-floor/report', (req, res) => {
    try {
        const { floors = [], options = {} } = req.body || {};
        const report = MultiFloorReporter.buildReport(floors, options);
        res.json({
            success: true,
            report
        });
    } catch (error) {
        console.error('Multi-floor report error:', error && error.stack ? error.stack : error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate multi-floor report'
        });
    }
});

const upload = multer({ dest: 'uploads/' });

// No APS functions needed - using local DXF processing only

// Enhanced CAD processing endpoint
app.post('/api/jobs', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log('Processing file:', file.originalname);

        let cadData = null;

        // Process CAD files
        const fileExtension = file.originalname.toLowerCase().split('.').pop();
        let fileToProcess = file.path;

        // DWG to DXF conversion using ODA with ASCII format
        if (fileExtension === 'dxf') {
            try {
                const cadProcessor = new ProfessionalCADProcessor();
                cadData = await cadProcessor.processDXF(fileToProcess);

                // Run room detection on the processed CAD data
                if (cadData && cadData.walls && cadData.walls.length > 0) {
                    try {
                        const roomDetector = require('./lib/roomDetector');
                        const detectedRooms = await roomDetector.detectRooms(
                            cadData.walls,
                            cadData.entrances || [],
                            cadData.forbiddenZones || [],
                            cadData.bounds
                        );
                        cadData.rooms = detectedRooms || [];
                        console.log(`Room detection: ${cadData.rooms.length} rooms detected`);
                    } catch (roomError) {
                        console.warn('Room detection failed:', roomError.message);
                        cadData.rooms = [];
                    }
                }

                console.log(`CAD processing: ${cadData.walls.length} walls, ${cadData.forbiddenZones.length} forbidden zones, ${cadData.entrances.length} entrances, ${cadData.rooms.length} rooms`);
            } catch (e) {
                console.warn('CAD processing failed:', e.message);
                cadData = null;
            }
        } else {
            cadData = null;
        }

        // Return CAD data directly - no APS upload needed
        const urn = `local_${Date.now()}`;

        const normalizedCadData = normalizeCadData(cadData);
        if (normalizedCadData) {
            normalizedCadData.urn = urn;
            cadCache.set(urn, normalizedCadData);
            global.lastProcessedCAD = normalizedCadData;
            floorPlanStore.saveFloorPlan(normalizedCadData);
        } else {
            cadCache.delete(urn);
            global.lastProcessedCAD = null;
        }

        res.json({
            success: true,
            urn: urn,
            processing: false,
            cadData: normalizedCadData,
            message: 'File processed locally with Three.js'
        });

        // Clean up local files after a small delay
        setTimeout(() => {
            try {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            } catch (e) { /* ignore cleanup errors */ }
        }, 1000);

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
});

// Enhanced analysis endpoint
app.post('/api/analyze', async (req, res) => {
    try {
        const { urn } = req.body;

        if (!urn) {
            return res.status(400).json({ error: 'URN required' });
        }

        console.log('Analyzing:', urn);

        // Retrieve cached CAD data for this URN
        const cachedCad = cadCache.get(urn);
        if (!cachedCad) {
            return res.status(400).json({ error: 'No CAD data available. Please upload a DXF file.' });
        }

        const totalArea = Array.isArray(cachedCad.rooms) && cachedCad.rooms.length > 0
            ? cachedCad.rooms.reduce((sum, r) => sum + (r.area || 0), 0)
            : cachedCad.bounds
                ? (cachedCad.bounds.maxX - cachedCad.bounds.minX) *
                (cachedCad.bounds.maxY - cachedCad.bounds.minY)
                : 0;

        const analysisData = normalizeCadData({
            ...cachedCad,
            totalArea,
            urn
        });
        analysisData.urn = urn;
        floorPlanStore.saveFloorPlan(analysisData);
        console.log(`Analysis using cached CAD: ${analysisData.rooms?.length || 0} rooms, ${analysisData.walls?.length || 0} walls, ${totalArea.toFixed(2)} m²`);

        const validator = new ArchitecturalValidator(analysisData);
        const validationReport = validator.validate();

        const corrector = new AnnotationAndCorrection(analysisData, validationReport.issues);
        const suggestions = corrector.generateSuggestions();

        res.json({
            success: true,
            ...analysisData,
            validation: validationReport,
            suggestions: suggestions,
            message: 'Analysis completed successfully'
        });

    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ error: 'Analysis failed: ' + error.message });
    }
});

// Advanced îlot generation endpoint
app.post('/api/ilots', async (req, res) => {
    try {
        const { floorPlan, distribution = {
            '1-3': 0.25,
            '3-5': 0.35,
            '5-10': 0.40
        }, options = {} } = req.body;

        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }

        // Ensure required arrays exist (even if empty)
        const normalizedFloorPlan = {
            walls: floorPlan.walls || [],
            forbiddenZones: floorPlan.forbiddenZones || [],
            entrances: floorPlan.entrances || [],
            bounds: floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
            rooms: floorPlan.rooms || [],
            urn: floorPlan.urn || floorPlan.id
        };

        const planId = normalizedFloorPlan.urn || floorPlan.urn || floorPlan.id;
        normalizedFloorPlan.urn = planId;

        const normalizedDistribution = normalizeDistribution(distribution);

        const generatorOptions = Object.assign({}, options);

        if (typeof generatorOptions.seed === 'undefined' || generatorOptions.seed === null) {
            const seedSource = planId || `${normalizedFloorPlan.bounds.minX},${normalizedFloorPlan.bounds.minY},${normalizedFloorPlan.bounds.maxX},${normalizedFloorPlan.bounds.maxY}`;
            let h = 5381;
            for (let i = 0; i < seedSource.length; i++) { h = ((h << 5) + h) + seedSource.charCodeAt(i); }
            generatorOptions.seed = Math.abs(h) % 1000000000;
        }

        generatorOptions.totalIlots = generatorOptions.totalIlots || 50;
        generatorOptions.corridorWidth = typeof generatorOptions.corridorWidth === 'number' ? generatorOptions.corridorWidth : 1.2;
        generatorOptions.margin = typeof generatorOptions.margin === 'number' ? generatorOptions.margin : (generatorOptions.minRowDistance || 1.0);
        generatorOptions.spacing = typeof generatorOptions.spacing === 'number' ? generatorOptions.spacing : 0.3;

        const ilotPlacer = new RowBasedIlotPlacer(normalizedFloorPlan, generatorOptions);
        const ilotsRaw = ilotPlacer.generateIlots(normalizedDistribution, generatorOptions.totalIlots);

        // sanitize placements to ensure numeric fields for client
        const ilots = Array.isArray(ilotsRaw) ? ilotsRaw.map(sanitizeIlot).filter(Boolean) : [];

        // Calculate total area - ilots now have area field from professionalIlotPlacer
        const totalArea = ilots.reduce((sum, ilot) => sum + (Number(ilot.area) || 0), 0);

        global.lastPlacedIlots = ilots;
        if (planId) {
            floorPlanStore.saveFloorPlan(normalizedFloorPlan);
            floorPlanStore.updateLayout(planId, {
                ilots,
                distribution: normalizedDistribution,
                options: generatorOptions
            });
        }

        console.log(`Îlot generation: ${ilots.length} placed, total area: ${totalArea.toFixed(2)} m²`);
        if (ilots.length > 0) console.log('First ilot sample:', JSON.stringify(ilots[0]));

        const validator = new ArchitecturalValidator({ ...normalizedFloorPlan, ilots });
        const validationReport = validator.validate();
        const corrector = new AnnotationAndCorrection({ ...normalizedFloorPlan, ilots }, validationReport.issues);
        const suggestions = corrector.generateSuggestions();

        res.json({
            success: true,
            ilots: ilots,
            totalArea: totalArea,
            count: ilots.length,
            distribution: normalizedDistribution,
            options: generatorOptions,
            validation: validationReport,
            suggestions: suggestions,
            message: `Generated ${ilots.length} ilots with ${totalArea.toFixed(2)} m² total area`
        });

    } catch (error) {
        console.error('Îlot generation error:', error);
        res.status(500).json({ error: 'Îlot generation failed: ' + error.message });
    }
});

// Layout optimization endpoint
app.post('/api/optimize/layout', (req, res) => {
    try {
        const { floorPlan, ilots } = req.body;

        if (!floorPlan || !ilots) {
            return res.status(400).json({ error: 'Floor plan and ilots data required' });
        }

        // Normalize floor plan
        const normalizedFloorPlan = {
            walls: floorPlan.walls || [],
            forbiddenZones: floorPlan.forbiddenZones || [],
            entrances: floorPlan.entrances || [],
            bounds: floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
            rooms: floorPlan.rooms || [],
            urn: floorPlan.urn
        };

        global.lastPlacedIlots = ilots;

        res.json({
            success: true,
            ilots: ilots,
            totalArea: ilots.reduce((sum, ilot) => sum + (Number(ilot.area) || 0), 0),
            count: ilots.length
        });

    } catch (error) {
        console.error('Layout optimization error:', error);
        res.status(500).json({ error: 'Layout optimization failed: ' + error.message });
    }
});

// Path optimization endpoint
app.post('/api/optimize/paths', (req, res) => {
    try {
        const { floorPlan, ilots } = req.body;

        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }

        const ilotsToUse = ilots || global.lastPlacedIlots || [];
        if (!ilotsToUse || ilotsToUse.length === 0) {
            return res.status(400).json({ error: 'Ilots data required' });
        }

        // Normalize floor plan
        const normalizedFloorPlan = {
            walls: floorPlan.walls || [],
            forbiddenZones: floorPlan.forbiddenZones || [],
            entrances: floorPlan.entrances || [],
            bounds: floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
            rooms: floorPlan.rooms || [],
            urn: floorPlan.urn
        };

        const corridorGenerator = new ProductionCorridorGenerator(normalizedFloorPlan, ilotsToUse, {});
        const optimizedPaths = corridorGenerator.generateCorridors();

        res.json({
            success: true,
            paths: optimizedPaths,
            totalLength: optimizedPaths.reduce((sum, path) => sum + (Number(path.length) || 0), 0),
            count: optimizedPaths.length
        });

    } catch (error) {
        console.error('Path optimization error:', error);
        res.status(500).json({ error: 'Path optimization failed: ' + error.message });
    }
});

// Advanced corridor generation backed by Python corridor generator
app.post('/api/corridors/advanced', async (req, res) => {
    try {
        const body = req.body || {};
        const floorPlan = body.floorPlan;
        const options = body.options || {};

        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }

        const normalizedFloorPlan = {
            walls: Array.isArray(floorPlan.walls) ? floorPlan.walls : [],
            forbidden_zones: Array.isArray(floorPlan.forbidden_zones) ? floorPlan.forbidden_zones : (Array.isArray(floorPlan.forbiddenZones) ? floorPlan.forbiddenZones : []),
            forbiddenZones: Array.isArray(floorPlan.forbiddenZones) ? floorPlan.forbiddenZones : (Array.isArray(floorPlan.forbidden_zones) ? floorPlan.forbidden_zones : []),
            entrances: Array.isArray(floorPlan.entrances) ? floorPlan.entrances : [],
            bounds: floorPlan.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
            rooms: Array.isArray(floorPlan.rooms) ? floorPlan.rooms : [],
            urn: floorPlan.urn || floorPlan.id || null,
            id: floorPlan.id || floorPlan.urn || null
        };

        const generationOptions = {
            corridor_width: typeof options.corridor_width === 'number'
                ? options.corridor_width
                : (typeof options.corridorWidth === 'number' ? options.corridorWidth : 1.5),
            generate_arrows: options.generate_arrows !== false,
            min_corridor_length: typeof options.min_corridor_length === 'number' ? options.min_corridor_length : 3.0,
            max_corridor_spacing: typeof options.max_corridor_spacing === 'number' ? options.max_corridor_spacing : 8.0
        };

        const corridorNetwork = await runPythonCorridorGenerator(normalizedFloorPlan, generationOptions);

        const corridors = Array.isArray(corridorNetwork.corridors)
            ? corridorNetwork.corridors.map(sanitizeCorridor).filter(Boolean)
            : [];
        const arrows = Array.isArray(corridorNetwork.arrows)
            ? corridorNetwork.arrows.map(sanitizeArrow).filter(Boolean)
            : [];
        const statistics = corridorNetwork.statistics || {};
        const metadata = corridorNetwork.metadata || {};

        global.lastGeneratedCorridors = corridors;
        global.lastGeneratedArrows = arrows;
        global.lastAdvancedCorridorStats = statistics;

        const planId = normalizedFloorPlan.urn || normalizedFloorPlan.id;
        if (planId) {
            floorPlanStore.saveFloorPlan(normalizedFloorPlan);
            const existingLayout = floorPlanStore.getLayout(planId) || {};
            floorPlanStore.updateLayout(planId, Object.assign({}, existingLayout, {
                corridors,
                arrows,
                corridor_statistics: statistics,
                corridor_metadata: metadata
            }));
        }

        res.json({
            success: true,
            corridors,
            arrows,
            statistics,
            metadata,
            message: `Generated ${corridors.length} corridors with ${arrows.length} circulation arrows`
        });
    } catch (error) {
        console.error('Advanced corridor generation error:', error);
        res.status(500).json({ error: 'Advanced corridor generation failed: ' + error.message });
    }
});

// Fetch the most recently generated corridor arrows for a floor plan
app.get('/api/corridors/arrows/:urn', (req, res) => {
    try {
        const urn = req.params.urn;
        if (!urn) {
            return res.status(400).json({ error: 'URN parameter required' });
        }

        const layout = floorPlanStore.getLayout(urn);
        if (layout && Array.isArray(layout.arrows) && layout.arrows.length) {
            const arrows = layout.arrows.map(sanitizeArrow).filter(Boolean);
            return res.json({
                success: true,
                arrows,
                count: arrows.length,
                source: 'store'
            });
        }

        if (Array.isArray(global.lastGeneratedArrows) && global.lastGeneratedArrows.length) {
            return res.json({
                success: true,
                arrows: global.lastGeneratedArrows,
                count: global.lastGeneratedArrows.length,
                source: 'memory'
            });
        }

        res.status(404).json({
            success: false,
            arrows: [],
            count: 0,
            error: 'No corridor arrows available for requested URN'
        });
    } catch (error) {
        console.error('Corridor arrow retrieval error:', error);
        res.status(500).json({ error: 'Failed to retrieve corridor arrows: ' + error.message });
    }
});

// Advanced corridor generation endpoint with facing row detection
app.post('/api/corridors', (req, res) => {
    try {
        const { floorPlan, ilots, corridorWidth = 1.5, options = {} } = req.body;

        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }

        if (!Array.isArray(ilots) || ilots.length === 0) {
            return res.status(400).json({ error: 'Îlots data required (provide an array of îlots).' });
        }

        const ilotsToUse = ilots.map(sanitizeIlot).filter(Boolean);
        global.lastPlacedIlots = ilotsToUse;

        // Use Advanced Corridor Generator with facing row detection
        const advancedOptions = {
            corridorWidth,
            margin: options.margin || 0.5,
            rowTolerance: options.rowTolerance || 3.0,
            minRowDistance: options.minRowDistance || 2.0,
            maxRowDistance: options.maxRowDistance || 8.0,
            minOverlap: options.minOverlap || 0.6,
            horizontalPriority: options.horizontalPriority || 1.5,
            verticalPriority: options.verticalPriority || 1.0,
            generateVertical: options.generateVertical !== false,
            generateHorizontal: options.generateHorizontal !== false
        };

        const corridorGenerator = new AdvancedCorridorGenerator(floorPlan, ilotsToUse, advancedOptions);
        const result = corridorGenerator.generate();

        console.log(`[Corridor API] Generated ${result.corridors.length} corridors (${result.statistics.vertical}V + ${result.statistics.horizontal}H)`);

        res.json({
            success: true,
            corridors: result.corridors.map(sanitizeCorridor).filter(Boolean),
            totalArea: result.totalArea,
            count: result.corridors.length,
            statistics: result.statistics,
            metadata: result.metadata,
            invalid: result.invalid || [],
            message: `Generated ${result.corridors.length} corridors (${result.statistics.vertical} vertical, ${result.statistics.horizontal} horizontal)`
        });

    } catch (error) {
        console.error('Corridor generation error:', error);
        res.status(500).json({ error: 'Corridor generation failed: ' + error.message });
    }
});

// Status endpoint - local processing is instant
app.get('/api/jobs/:urn/status', async (req, res) => {
    res.json({
        status: 'success',
        progress: '100%',
        ready: true
    });
});

// Proxy endpoint to fetch Model Derivative manifest via server (avoids CORS issues in development)
app.get('/api/aps/manifest', async (req, res) => {
    try {
        const urnRaw = (req.query.urn || req.query.u || '').toString();
        if (!urnRaw) return res.status(400).json({ error: 'urn query parameter required' });

        // Ensure CORS headers are present for both normal and error responses (manifest proxy is used by the Viewer)
        const setProxyCors = () => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept');
        };
        setProxyCors();

        // Normalize: if the client sent urn: prefix, strip it for APS API which expects the base64/object id
        let urnForApi = urnRaw.startsWith('urn:') ? urnRaw.replace(/^urn:/i, '') : urnRaw;

        // Basic validation - expect either base64-like string or short urn
        if (urnForApi.length < 6) return res.status(400).json({ error: 'urn appears malformed', urn: urnRaw });

        const token = await getAPSToken();
        try {
            const manifestResponse = await axios.get(
                `${APS_BASE_URL}/modelderivative/v2/designdata/${encodeURIComponent(urnForApi)}/manifest`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            return res.json(manifestResponse.data);
        } catch (upstreamErr) {
            // Surface upstream status and body so the client can understand APS diagnostics
            console.error('APS manifest proxy upstream error for urn', urnRaw, upstreamErr.response?.data || upstreamErr.message || upstreamErr);
            const statusCode = upstreamErr.response?.status || 502;
            const body = upstreamErr.response?.data || { error: upstreamErr.message || 'Failed to fetch APS manifest' };
            setProxyCors();
            return res.status(statusCode).json({ error: 'failed_to_fetch_manifest', detail: body });
        }
    } catch (e) {
        console.error('APS manifest proxy error:', e && e.stack ? e.stack : e);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(500).json({ error: 'Failed to fetch manifest', detail: String(e) });
    }
});

// Respond to CORS preflight directly for the manifest proxy
app.options('/api/aps/manifest', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept');
    return res.status(204).send();
});

// Viewer token endpoint removed - using Three.js instead of Autodesk Viewer

// Viewer transform endpoints - store/retrieve overlay transforms used by the frontend viewer
app.get('/viewer/transform/:urn', async (req, res) => {
    try {
        const urn = req.params.urn;
        if (!urn) return res.status(400).json({ error: 'URN required' });
        const t = transformStore.getTransform(urn);
        return res.json({ urn, transform: t ? t.transform : null, meta: t ? t.meta : null });
    } catch (e) {
        console.error('Viewer transform get error:', e && e.stack ? e.stack : e);
        return res.status(500).json({ error: 'Failed to fetch transform', detail: e.message || String(e) });
    }
});

app.post('/viewer/transform/:urn', adminAuth, async (req, res) => {
    try {
        const urn = req.params.urn;
        const transform = req.body.transform;
        const comment = req.body.comment || null;
        const savedBy = req.body.savedBy || req.headers['x-admin-user'] || null;
        if (!urn || !transform) return res.status(400).json({ error: 'URN and transform required' });
        const saved = transformStore.saveTransform(urn, transform, { savedBy: savedBy, comment: comment, savedAt: new Date().toISOString() });
        return res.json({ success: true, urn, transform: saved.transform, meta: saved.meta });
    } catch (e) {
        console.error('Viewer transform save error:', e && e.stack ? e.stack : e);
        return res.status(500).json({ error: 'Failed to save transform', detail: e.message || String(e) });
    }
});

// Automation endpoint: wait for APS translation to finish then run analyze -> ilot -> corridor -> export
app.post('/api/jobs/:urn/automate', async (req, res) => {
    const { urn } = req.params;
    const { distribution, options = {}, corridorWidth = 1.2, timeoutMs = 120000 } = req.body || {};

    if (!urn) return res.status(400).json({ error: 'URN required' });

    try {
        // Use helper to run the full pipeline with APS polling (default behavior)
        const result = await runAutomationForUrn(urn, { distribution, options, corridorWidth, timeoutMs, waitForAPS: true });
        return res.json(result);

    } catch (error) {
        console.error('Automation error:', error);
        return res.status(500).json({ success: false, error: error.message || 'Automation failed' });
    }
});

// Helper: runs the analysis -> ilot placement -> corridor generation -> export pipeline for a URN
async function runAutomationForUrn(urn, { distribution = { '1-3': 10 }, options = {}, corridorWidth = 1.2, timeoutMs = 120000, waitForAPS = false, analysisData: providedAnalysis = null } = {}) {
    if (!urn) throw new Error('URN required');

    console.log(`runAutomationForUrn called for urn=${urn} providedAnalysisPresent=${!!providedAnalysis} waitForAPS=${waitForAPS}`);

    let analysisData = providedAnalysis || null;

    if (!analysisData) {
        if (waitForAPS) {
            const start = Date.now();
            // Poll APS via apsProcessor.extractGeometry which throws 'APS_NOT_READY' until ready
            while (true) {
                try {
                    console.log('runAutomationForUrn: polling APS.extractGeometry for urn', urn);
                    analysisData = await apsProcessor.extractGeometry(urn);
                    console.log('runAutomationForUrn: APS.extractGeometry returned data for urn', urn);
                    break;
                } catch (e) {
                    console.log('runAutomationForUrn: APS.extractGeometry error:', e.message);
                    if (e.message === 'APS_NOT_READY') {
                        if (Date.now() - start > timeoutMs) {
                            throw new Error('APS_TIMEOUT');
                        }
                        // wait 3s then retry
                        await new Promise(r => setTimeout(r, 3000));
                        continue;
                    }
                    throw e;
                }
            }
        } else {
            // Assume APS already reported readiness and we can extract geometry immediately
            try {
                console.log('runAutomationForUrn: calling APS.extractGeometry immediately for urn', urn);
                analysisData = await apsProcessor.extractGeometry(urn);
                console.log('runAutomationForUrn: APS.extractGeometry returned data for urn', urn);
            } catch (e) {
                console.log('runAutomationForUrn: APS.extractGeometry immediate call error:', e.message);
                throw e;
            }
        }
    }

    // analysisData now contains walls, forbiddenZones, entrances, bounds, totalArea
    const floorPlan = {
        walls: analysisData.walls || [],
        forbiddenZones: analysisData.forbiddenZones || [],
        entrances: analysisData.entrances || [],
        bounds: analysisData.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        rooms: analysisData.rooms || [],
        placementTransform: analysisData.placementTransform || null
    };

    const ilotPlacer = new RowBasedIlotPlacer(floorPlan, options || {});
    const ilots = ilotPlacer.generateIlots(distribution || { '1-3': 0.25, '3-5': 0.35, '5-10': 0.40 }, options.totalIlots || 100);
    global.lastPlacedIlots = ilots;

    const corridorGenerator = new ProductionCorridorGenerator(floorPlan, ilots, { corridorWidth });
    const corridors = corridorGenerator.generateCorridors();

    // expose last placed corridors for demo/debug overlays
    global.lastPlacedCorridors = corridors;

    // Export results (PDF + SVG)
    const exportManager = new ExportManager();
    const pdfBytes = await exportManager.exportToPDF(floorPlan, ilots, corridors, {});
    const pdfPath = await exportManager.saveToFile(pdfBytes, `auto_${Date.now()}`, 'pdf');

    const svgBuffer = await exportManager.exportToSVG(floorPlan, ilots, corridors, {});
    const svgPath = await exportManager.saveToFile(svgBuffer, `auto_${Date.now()}`, 'svg');
    // Return a consolidated result for the automation run
    return {
        success: true,
        urn,
        pdf: { path: pdfPath, filename: path.basename(pdfPath) },
        svg: { path: svgPath, filename: path.basename(svgPath) },
        ilots,
        corridors
    };
}

app.post('/api/aps/webhook/callback', async (req, res) => {
    try {
        // Verify webhook signature if configured
        const verified = verifyWebhookSignature(req);
        if (!verified) {
            console.warn('Rejected APS webhook callback due to invalid signature');
            return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
        }

        const payload = req.body || {};
        // The exact APS webhook payload varies; try common fields
        const urn = payload.urn || payload.resourceUrn || payload.data?.urn || payload.payload?.urn;
        const event = payload.event || payload.eventType || payload.type || payload.activity;

        console.log('Received APS webhook callback:', { urn, event });

        // Basic idempotency: APS may post duplicate notifications. Try to get event id from payload and skip if processed.
        const eventId = payload.id || payload.notificationId || payload.hookId || payload.data?.id || payload.payload?.id || null;
        if (eventId && webhookStore.isEventProcessed(eventId)) {
            console.log('Duplicate webhook event received, skipping:', eventId);
            return res.status(200).json({ success: true, message: 'Duplicate event ignored' });
        }

        if (!urn) {
            // allow for webhook health checks
            return res.status(200).json({ success: true, message: 'Callback received (no URN)' });
        }

        // If the webhook indicates a successful translation, trigger the pipeline without polling
        // We'll accept several truthy indicators: event contains 'success' or 'finished' or payload.status === 'success'
        const status = payload.status || payload.data?.status || payload.payload?.status || '';
        const ready = String(status).toLowerCase().includes('success') || String(event || '').toLowerCase().includes('finished') || String(event || '').toLowerCase().includes('success');

        if (ready) {
            // Enqueue into webhook worker for reliable processing
            try {
                const webhookWorker = require('./lib/webhookWorker');
                webhookWorker.enqueue(urn, eventId, payload);
                console.log('Enqueued webhook job for urn', urn, 'eventId', eventId);
            } catch (e) {
                // fallback to fire-and-forget
                runAutomationForUrn(urn, { distribution: { '1-3': 10 }, options: {}, corridorWidth: 1.2, waitForAPS: false })
                    .then(result => console.log('Webhook automation finished for', urn, result))
                    .catch(err => console.error('Webhook automation error for', urn, err.message || err));
            }

            // mark the event processed (best-effort)
            if (eventId) {
                try { webhookStore.markEventProcessed(eventId); } catch (e) { /* ignore */ }
            }

            return res.status(200).json({ success: true, message: 'Automation queued' });
        }

        return res.status(200).json({ success: true, message: 'Webhook received but not a ready event' });
    } catch (error) {
        console.error('Webhook callback error:', error);
        return res.status(500).json({ success: false, error: error.message || 'Webhook handling failed' });
    }
});

// Simulation endpoints removed to enforce processing only from real APS translations and uploaded CAD files.

// Debug endpoint to return last placed ilots/corridors (useful for viewer overlay demo)
app.get('/api/debug/last-placements', adminAuth, (req, res) => {
    try {
        const rawIlots = Array.isArray(global.lastPlacedIlots) ? global.lastPlacedIlots : [];
        const rawCorridors = Array.isArray(global.lastPlacedCorridors) ? global.lastPlacedCorridors : [];
        const ilots = rawIlots.map(sanitizeIlot).filter(Boolean);
        const corridors = rawCorridors.map(sanitizeCorridor).filter(Boolean);

        // If any items were filtered, log details to logs/filtered_placements.log for debugging
        try {
            const pathLogs = path.join(__dirname, 'logs');
            if (!fs.existsSync(pathLogs)) fs.mkdirSync(pathLogs, { recursive: true });
            const now = new Date().toISOString();
            const filteredIlots = rawIlots.length - ilots.length;
            const filteredCorr = rawCorridors.length - corridors.length;
            if (filteredIlots > 0 || filteredCorr > 0) {
                const entry = { timestamp: now, filteredIlots, filteredCorr, rawIlots: rawIlots.filter((r, i) => !ilots[i]), rawCorridors: rawCorridors.filter((r, i) => !corridors[i]) };
                try { fs.appendFileSync(path.join(pathLogs, 'filtered_placements.log'), JSON.stringify(entry) + '\n'); } catch (e) { /* ignore logging errors */ }
            }
        } catch (e) { /* ignore logging errors */ }

        return res.json({ ilots, corridors });
    } catch (e) {
        return res.status(500).json({ error: 'Failed to fetch last placements', detail: e.message || String(e) });
    }
});

// No auth token needed for Three.js
app.get('/api/auth/token', async (req, res) => {
    res.json({
        access_token: 'not_needed_for_threejs',
        expires_in: 3600
    });
});

// Health endpoint
app.get('/health', (req, res) => {
    const summaries = floorPlanStore.listSummaries();
    res.json({
        status: 'ok',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        bootTime: app.locals.bootTime,
        uptimeSeconds: Math.round(process.uptime()),
        usingDist: USING_DIST_BUILD,
        staticRoot: path.relative(__dirname, STATIC_ROOT),
        cachedFloorPlans: summaries.length,
        sqliteReady: Boolean(sqliteAdapter && typeof sqliteAdapter.dbFilePath === 'function' && sqliteAdapter.dbFilePath()),
        sqlite: Boolean(sqliteAdapter && typeof sqliteAdapter.dbFilePath === 'function' && sqliteAdapter.dbFilePath()),
        mlBootstrapFinished
    });
});


// Rich healthcheck - reports persistence and APS health
app.get('/healthz', async (req, res) => {
    try {
        const transformDbPath = path.join(__dirname, 'transforms.db');
        const webhookDbPath = path.join(__dirname, 'webhooks.db');

        const persistence = {
            sqliteAdapterDb: sqliteAdapter && typeof sqliteAdapter.dbFilePath === 'function' ? sqliteAdapter.dbFilePath() : null,
            transformDbExists: fs.existsSync(transformDbPath),
            webhookDbExists: fs.existsSync(webhookDbPath),
            usingSqlite: sqliteAdapter && typeof sqliteAdapter.usingSqlite === 'function' ? !!sqliteAdapter.usingSqlite() : false,
            usingBetter: sqliteAdapter && typeof sqliteAdapter.usingBetter === 'function' ? !!sqliteAdapter.usingBetter() : false
        };

        const apsInfo = { configured: !!(APS_CLIENT_ID && APS_CLIENT_SECRET), tokenOk: false, tokenExpiry: null, error: null };
        if (apsInfo.configured) {
            try {
                const token = await getAPSToken();
                apsInfo.tokenOk = !!token;
                apsInfo.tokenExpiry = tokenExpiry ? new Date(tokenExpiry).toISOString() : null;
            } catch (e) {
                apsInfo.error = String(e && e.message ? e.message : e);
            }
        }

        const status = (persistence.usingSqlite && (!apsInfo.configured || apsInfo.tokenOk)) ? 'ok' : 'degraded';

        return res.json({ status, timestamp: new Date().toISOString(), persistence, aps: apsInfo, server: { pid: process.pid, uptime: process.uptime() } });
    } catch (e) {
        console.error('Healthz error:', e && e.stack ? e.stack : e);
        return res.status(500).json({ status: 'error', error: String(e) });
    }
});

// Admin: trigger transform migration from JSON to SQLite (idempotent)
app.post('/api/admin/migrate-transforms', adminAuth, (req, res) => {
    try {
        if (!transformStore || typeof transformStore.migrateJsonToSqlite !== 'function') return res.status(400).json({ success: false, message: 'SQLite transform store not available' });
        const count = transformStore.migrateJsonToSqlite();
        return res.json({ success: true, migrated: count });
    } catch (e) {
        console.error('Transform migration error:', e.message || e);
        return res.status(500).json({ success: false, error: e.message || String(e) });
    }
});

// Per-URN transform debug endpoints
app.get('/api/transforms/:urn', async (req, res) => {
    try {
        const urn = req.params.urn;
        if (!urn) return res.status(400).json({ error: 'URN required' });
        const t = transformStore.getTransform(urn);
        // t may be null or { transform, meta }
        if (!t) return res.json({ urn, transform: null, meta: null });
        return res.json({ urn, transform: t.transform || null, meta: t.meta || null });
    } catch (e) {
        console.error('Get transform error:', e.message);
        return res.status(500).json({ error: 'Failed to get transform', detail: e.message });
    }
});

app.post('/api/transforms/:urn', adminAuth, async (req, res) => {
    try {
        const urn = req.params.urn;
        const transform = req.body.transform;
        const comment = req.body.comment || null;
        // Optionally accept savedBy from body, or derive from adminAuth header if present
        const savedBy = req.body.savedBy || req.headers['x-admin-user'] || req.query.savedBy || null;
        if (!urn || !transform) return res.status(400).json({ error: 'URN and transform required' });
        // Save transform with metadata
        const saved = transformStore.saveTransform(urn, transform, { savedBy: savedBy || null, comment: comment || null });
        return res.json({ success: true, urn, transform: saved.transform || null, meta: saved.meta || null });
    } catch (e) {
        console.error('Save transform error:', e.message);
        return res.status(500).json({ error: 'Failed to save transform', detail: e.message });
    }
});

app.get('/api/transforms', adminAuth, (req, res) => {
    try {
        const all = transformStore.listTransforms();
        // Normalize list to { urn: { transform, meta } }
        res.json({ transforms: all });
    } catch (e) {
        console.error('List transforms error:', e.message);
        res.status(500).json({ error: 'Failed to list transforms' });
    }
});

// Effective transform endpoint: returns saved override if present, otherwise attempts to read APS placementTransform
app.get('/api/transforms/:urn/effective', async (req, res) => {
    try {
        const urn = req.params.urn;
        if (!urn) return res.status(400).json({ error: 'URN required' });

        // 1) prefer saved transform
        const savedEntry = transformStore.getTransform(urn);
        if (savedEntry) return res.json({ urn, transform: savedEntry.transform || null, meta: savedEntry.meta || null, source: 'saved' });

        // 2) attempt to read placementTransform from APS if configured
        if (APS_CLIENT_ID && APS_CLIENT_SECRET) {
            try {
                const analysis = await apsProcessor.extractGeometry(urn);
                if (analysis && analysis.placementTransform) {
                    return res.json({ urn, transform: analysis.placementTransform, source: 'aps' });
                }
            } catch (e) {
                // APS may be still processing (400 = not ready, 404 = not found)
                // Do not log as warning unless it's an unexpected error
                if (e.message !== 'APS_NOT_READY' && !e.message.includes('400')) {
                    console.warn('Effective transform: APS lookup failed for', urn, e.message || e);
                }
            }
        }

        // 3) nothing available
        return res.json({ urn, transform: null, source: 'none' });
    } catch (e) {
        console.error('Effective transform error:', e.message || e);
        return res.status(500).json({ error: 'Failed to resolve effective transform' });
    }
});

// Create a webhook on APS and store the secret locally (demo only)
app.post('/api/aps/webhooks/register', adminAuth, async (req, res) => {
    try {
        const { system = 'derivative', event = 'extraction.finished', callbackUrl, scope = {}, secret } = req.body || {};

        if (!callbackUrl) return res.status(400).json({ error: 'callbackUrl required' });

        // Generate secret if not provided
        const hookSecret = secret || generateSecret(32);

        // Acquire APS token with required scopes for webhooks
        // webhooks require data:read and data:create to create hooks
        const params = new URLSearchParams();
        params.append('client_id', APS_CLIENT_ID);
        params.append('client_secret', APS_CLIENT_SECRET);
        params.append('grant_type', 'client_credentials');
        params.append('scope', 'data:read data:create');

        const tokenResponse = await axios.post(`${APS_BASE_URL}/authentication/v2/token`, params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const token = tokenResponse.data.access_token;

        // Create the hook
        const createUrl = `${APS_BASE_URL}/webhooks/v1/systems/${system}/events/${event}/hooks`;
        const body = {
            callbackUrl,
            scope
        };

        const createResp = await axios.post(createUrl, body, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });

        // On success APS returns 201 and Location header with hook id
        const location = createResp.headers['location'] || null;

        // Persist to SQLite-backed webhook store
        const hookEntry = {
            id: location || `${system}:${event}:${Date.now()}`,
            system,
            event,
            callbackUrl,
            scope,
            secret: MASTER_KEY ? encryptSecret(hookSecret) : hookSecret,
            createdAt: new Date().toISOString(),
            location
        };
        try {
            webhookStore.addHook(hookEntry);
        } catch (e) {
            console.warn('Failed to persist hook to SQLite store:', e.message);
        }

        // Return the secret plaintext to the caller (they must store it securely)
        return res.status(201).json({ success: true, hook: hookEntry });

    } catch (error) {
        console.error('Webhook register error:', error.response?.data || error.message || error);
        return res.status(500).json({ success: false, error: error.response?.data || error.message || 'Failed to register webhook' });
    }
});

// List locally stored webhooks
app.get('/api/aps/webhooks', adminAuth, (req, res) => {
    try {
        const hooks = webhookStore.getHooks();
        const safe = { hooks: hooks.map(h => ({ ...h, secret: h.secret ? (isEncryptedToken(h.secret) ? '[encrypted]' : '[redacted]') : null })) };
        res.json(safe);
    } catch (e) {
        console.error('Failed to list webhooks:', e.message);
        res.status(500).json({ error: 'Failed to list webhooks' });
    }
});

// Delete webhook by location or id (calls APS delete if location is present)
app.delete('/api/aps/webhooks/:id', adminAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const hook = webhookStore.getHookById(id) || webhookStore.getHooks().find(h => h.location === id || (h.location && h.location.endsWith(id)));
        if (!hook) return res.status(404).json({ error: 'Hook not found' });
        if (hook.location) {
            try {
                const token = await getAPSToken();
                await axios.delete(hook.location, { headers: { Authorization: `Bearer ${token}` } });
            } catch (e) {
                console.warn('APS delete failed:', e.response?.data || e.message);
            }
        }
        webhookStore.deleteHook(hook.id);
        return res.json({ success: true });
    } catch (e) {
        console.error('Delete hook error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// Rotate secret for a webhook: generate new secret, update APS if needed (APS doesn't store secret), return the new secret (only in HTTPS/admin flows)
app.post('/api/aps/webhooks/:id/rotate', adminAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const { secret: providedSecret } = req.body || {};
        const hook = webhookStore.getHookById(id) || webhookStore.getHooks().find(h => h.location === id || (h.location && h.location.endsWith(id)));
        if (!hook) return res.status(404).json({ error: 'Hook not found' });

        const newSecretPlain = providedSecret || generateSecret(32);
        const stored = MASTER_KEY ? encryptSecret(newSecretPlain) : newSecretPlain;
        webhookStore.rotateSecret(hook.id, stored);

        return res.json({ success: true, secret: newSecretPlain });
    } catch (e) {
        console.error('Rotate hook error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// Export endpoints
app.post('/api/export/pdf', async (req, res) => {
    try {
        const { floorPlan, ilots, corridors, options = {} } = req.body;

        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }

        const exportManager = new ExportManager();
        const pdfBytes = await exportManager.exportToPDF(floorPlan, ilots, corridors, options);

        const filename = `floorplan_${Date.now()}`;
        const filepath = await exportManager.saveToFile(pdfBytes, filename, 'pdf');

        res.json({
            success: true,
            filename: `${filename}.pdf`,
            filepath: filepath,
            message: 'PDF exported successfully'
        });

    } catch (error) {
        console.error('PDF export error:', error);
        res.status(500).json({ error: 'PDF export failed: ' + error.message });
    }
});

app.post('/api/export/image', async (req, res) => {
    try {
        const { floorPlan, ilots, corridors, options = {} } = req.body;

        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }

        const exportManager = new ExportManager();
        const imageBuffer = await exportManager.exportToImage(floorPlan, ilots, corridors, options);

        const format = 'svg'; // Using SVG for Windows compatibility
        const filename = `floorplan_${Date.now()}`;
        const filepath = await exportManager.saveToFile(imageBuffer, filename, format);

        res.json({
            success: true,
            filename: `${filename}.${format}`,
            filepath: filepath,
            message: 'Image exported successfully'
        });

    } catch (error) {
        console.error('Image export error:', error);
        res.status(500).json({ error: 'Image export failed: ' + error.message });
    }
});

const SPA_EXCLUDE_PATTERNS = [
    /^\/api\//,
    /^\/health/,
    /^\/healthz/,
    /^\/metrics/,
    /^\/viewer\//,
    /^\/exports\//,
    /^\/uploads\//
];

app.get('*', (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (SPA_EXCLUDE_PATTERNS.some((pattern) => pattern.test(req.path))) return next();
    const targetIndex = USING_DIST_BUILD ? path.join(STATIC_ROOT, 'index.html') : path.join(PUBLIC_DIR, 'index.html');
    res.sendFile(targetIndex, (err) => {
        if (err) next(err);
    });
});

// Bind address - default to 0.0.0.0 so cloud hosts (Render, Docker) can detect the port
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';
const parsedPortRetryLimit = parseInt(process.env.PORT_RETRY_LIMIT || '5', 10);
const PORT_RETRY_LIMIT = Number.isFinite(parsedPortRetryLimit) && parsedPortRetryLimit >= 0 ? parsedPortRetryLimit : 5;

function checkPortAvailability(port, bindAddress) {
    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', (error) => {
                if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
                    resolve(false);
                } else {
                    resolve(false);
                }
            })
            .once('listening', () => {
                tester.close(() => resolve(true));
            });

        try {
            tester.listen(port, bindAddress);
        } catch (error) {
            resolve(false);
        }
    });
}

async function findAvailablePort(preferredPort, bindAddress) {
    const maxPort = 65535;
    let candidate = preferredPort;
    for (let attempt = 0; attempt <= PORT_RETRY_LIMIT && candidate <= maxPort; attempt += 1, candidate += 1) {
        // eslint-disable-next-line no-await-in-loop
        const isAvailable = await checkPortAvailability(candidate, bindAddress);
        if (isAvailable) {
            return { port: candidate, attempts: attempt };
        }
    }
    throw new Error(`No open TCP port found starting from ${preferredPort}. Increase PORT_RETRY_LIMIT to scan a wider range.`);
}

async function startServer(port = PORT, bindAddress = BIND_ADDRESS) {
    const { port: resolvedPort, attempts } = await findAvailablePort(port, bindAddress);
    if (attempts > 0) {
        console.warn(`Port ${port} is busy. Using ${resolvedPort} instead. Set PORT to override or adjust PORT_RETRY_LIMIT.`);
    }

    return new Promise((resolve, reject) => {
        let started = false;
        const server = app.listen(resolvedPort, bindAddress, () => {
            started = true;
            const host = bindAddress === '0.0.0.0' ? '0.0.0.0' : bindAddress;
            console.log(`FloorPlan Pro Clean with Three.js running on http://${host}:${resolvedPort}`);
            console.log('✅ Local DXF Processing Ready');
            console.log('✅ Three.js 2D Rendering Ready');
            console.log('✅ Intelligent Îlot Placement Ready');
            console.log('✅ Corridor Network Generation Ready');
            console.log('✅ PDF/Image Export Ready');
            if (bindAddress === '127.0.0.1') {
                console.log('This instance is bound to localhost (127.0.0.1). It is suitable for single-PC personal use.');
            } else {
                console.log('This instance is bound to', bindAddress);
            }
            // Note: admin-only simulate endpoints/scripts were removed to avoid demo/fake behaviors.
            console.log('Pure Three.js - No Autodesk APS required');

            setImmediate(() => scheduleMLBootstrap());
            resolve(server);
        });

        server.on('error', (err) => {
            if (!started) {
                if (err && err.code === 'EADDRINUSE') {
                    reject(Object.assign(new Error(`Port ${resolvedPort} is already in use.`), { code: 'EADDRINUSE', port: resolvedPort }));
                } else {
                    reject(err);
                }
            } else {
                console.error('Server error:', err && err.stack ? err.stack : err);
            }
        });
    });
}

// Start server automatically only when run directly
if (require.main === module) {
    startServer()
        .then((server) => {
            server.on('close', () => {
                console.log('HTTP server closed');
            });
        })
        .catch((error) => {
            if (error && error.code === 'EADDRINUSE') {
                console.error(`Unable to bind – port ${error.port || 'unknown'} is already in use.`);
            } else {
                console.error('Failed to start server:', error && error.stack ? error.stack : error);
            }
            process.exit(1);
        });
}

// Export automation helper and server controls for tests/worker scripts
app.startServer = startServer;
app.runAutomationForUrn = runAutomationForUrn;

module.exports = app;

function scheduleMLBootstrap(reason = 'server-start') {
    if (process.env.SKIP_ML_BOOTSTRAP === '1') {
        if (!mlBootstrapFinished) {
            console.log(`${ML_BOOT_PREFIX} Skipped (SKIP_ML_BOOTSTRAP=1)`);
        }
        return;
    }

    const env = (process.env.NODE_ENV || '').toLowerCase();
    if (env === 'test' && !process.env.FORCE_ML_BOOTSTRAP) {
        if (!mlBootstrapFinished) {
            console.log(`${ML_BOOT_PREFIX} Skipped (NODE_ENV=test)`);
        }
        return;
    }

    if (mlBootstrapFinished) return;

    if (!mlBootstrapPromise) {
        mlBootstrapPromise = (async () => {
            const startedAt = Date.now();
            console.log(`${ML_BOOT_PREFIX} Initializing production ML models (${reason})...`);
            try {
                const success = await ProductionInitializer.initialize();
                const duration = Date.now() - startedAt;
                if (success) {
                    mlBootstrapFinished = true;
                    console.log(`${ML_BOOT_PREFIX} Production system ready in ${duration}ms`);
                } else {
                    mlBootstrapFinished = true;
                    console.log(`${ML_BOOT_PREFIX} System ready with rule-based algorithms after ${duration}ms`);
                }
            } catch (error) {
                console.error(`${ML_BOOT_PREFIX} Initialization error:`, error && error.stack ? error.stack : error);
                mlBootstrapFinished = true;
            }
        })().finally(() => {
            mlBootstrapPromise = null;
        });
    }
}
