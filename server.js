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
const presetRoutes = require('./lib/presetRoutes');
const CrossFloorRouter = require('./lib/crossFloorRouter');
const MultiFloorProfiler = require('./lib/multiFloorProfiler');
const MultiFloorReporter = require('./lib/multiFloorReporter');
const { performance } = require('perf_hooks');
const MultiFloorManager = require('./lib/multiFloorManager');
const floorPlanStore = require('./lib/floorPlanStore');
const ProductionInitializer = require('./lib/productionInitializer');
const UnitMixParser = require('./lib/unitMixParser');
const UnitMixReport = require('./lib/unitMixReport');
const ComplianceReport = require('./lib/complianceReport');
const RuleManager = require('./lib/ruleManager');
const { sanitizeIlot, sanitizeCorridor, sanitizeArrow } = require('./lib/sanitizers');
const { extractGridCells } = require('./lib/gridCellExtractor');
const CostoAPI = require('./lib/costoAPI');
const CostoLayerStandard = require('./lib/costoLayerStandard');
const CostoBoxCatalog = require('./lib/costoBoxCatalog');
const CostoExports = require('./lib/costoExports');
const CostoNumbering = require('./lib/costoNumbering');
const CostoProjectManager = require('./lib/costoProjectManager');



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

const indexHtmlPath = path.join(PUBLIC_DIR, 'index.html');
if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`[Startup] Missing index.html at ${indexHtmlPath}`);
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
    if (!floorPlanData || !floorPlanData.bounds) {
        throw new Error('Floor plan bounds required for corridor generation');
    }
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
                engine: 'js-production-engine',
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
        bounds: floorPlanData.bounds,
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
        ? arrowGenerator.generateArrows(corridors, ilots)
        : [];

    return {
        corridors,
        arrows,
        statistics: {
            corridorCount: corridors.length,
            arrowCount: arrows.length,
            corridorWidth,
            reason: 'success'
        },
        metadata: {
            engine: 'js-production-engine',
            timestamp: new Date().toISOString()
        }
    };
}

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
const PORT = process.env.PORT || 3000;
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
    }

}

checkProductionRequirements();

// Rest of initialization

const webhookStore = require('./lib/webhookStore');
let libreDwgModule = null;

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

                // Attempt to derive from segment fields (startX/startY/endX/endY)
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

async function convertDwgToDxfBuffer(buffer) {
    // Lazy-load libredwg wasm converter
    if (!libreDwgModule) {
        try {
            const mod = require('@mlightcad/libredwg-web');
            // module may export a factory (.default) or direct API
            libreDwgModule = typeof mod === 'function' ? await mod() : (mod.default ? await mod.default() : mod);
        } catch (e) {
            throw new Error('DWG->DXF converter not available: ' + (e.message || e));
        }
    }

    const converter = libreDwgModule;
    if (!converter) throw new Error('DWG->DXF converter module missing');

    // Try known API shapes
    if (typeof converter.convertDwgToDxf === 'function') {
        const out = await converter.convertDwgToDxf(buffer);
        return Buffer.isBuffer(out) ? out : Buffer.from(out);
    }
    if (typeof converter.convert === 'function') {
        const out = await converter.convert(buffer, 'dxf');
        return Buffer.isBuffer(out) ? out : Buffer.from(out);
    }
    throw new Error('DWG->DXF converter API not found');
}

function normalizeDistribution(distribution) {
    if (!distribution || typeof distribution !== 'object') {
        throw new Error('Distribution must be an object with numeric weights');
    }

    const ordered = Object.entries(distribution).map(([range, value]) => {
        let weight = Number(value);
        if (Number.isNaN(weight) || weight < 0) {
            throw new Error(`Invalid distribution weight for ${range}`);
        }
        if (weight > 1.01) weight = weight / 100;
        return [range, weight];
    }).sort((a, b) => {
        const aMin = parseFloat(a[0].split('-')[0]);
        const bMin = parseFloat(b[0].split('-')[0]);
        return aMin - bMin;
    });

    if (!ordered.length) {
        throw new Error('Distribution must include at least one size range');
    }

    const total = ordered.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) {
        throw new Error('Distribution weights must sum to a positive value');
    }

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
            console.error('No webhook secret available for verification');
            return false;
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
app.use('/Samples', express.static(path.join(__dirname, 'Samples')));

// Phase 2: Register preset management routes
app.use('/api', presetRoutes);

// ML training routes are disabled in production builds.

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

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
    dest: uploadsDir,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// No APS functions needed - using local DXF processing only

// Unit Mix Import Endpoint
app.post('/api/import/mix', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const mix = UnitMixParser.parseFile(req.file.path, req.file.originalname);

        // Clean up
        try { fs.unlinkSync(req.file.path); } catch (e) { }

        res.json({ success: true, mix });
    } catch (error) {
        if (req.file && req.file.path) try { fs.unlinkSync(req.file.path); } catch (e) { }
        console.error('Unit mix import error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Enhanced CAD processing endpoint
app.post('/api/jobs', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const cleanupUpload = () => {
            try {
                if (file && file.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (e) {
                // ignore cleanup errors
            }
        };

        console.log('Processing file:', file.originalname);

        const fileExtension = file.originalname.toLowerCase().split('.').pop();
        let cadData = null;
        let filePathToProcess = file.path;

        // If DWG, process directly via libredwg (silent conversion to DXF-like entities)
        if (fileExtension === 'dwg') {
            try {
                console.log('[DWG] Processing DWG via libredwg...');
                const cadProcessor = new ProfessionalCADProcessor();
                cadData = await cadProcessor.processDWG(filePathToProcess);
                console.log(`CAD processing (DWG): ${cadData.walls.length} walls, ${cadData.forbiddenZones.length} forbidden zones, ${cadData.entrances.length} entrances, ${cadData.rooms.length} rooms`);
            } catch (convErr) {
                console.error('[DWG] Conversion failed:', convErr.message || convErr);
                cleanupUpload();
                return res.status(200).json({
                    success: false,
                    error: 'Unable to process DWG automatically. Please provide a DXF export from CAD.',
                    detail: convErr.message || String(convErr)
                });
            }
        } else if (fileExtension !== 'dxf') {
            cleanupUpload();
            return res.status(415).json({
                success: false,
                error: 'Unsupported file type. Upload a DXF or DWG file.'
            });
        }

        try {
            const cadProcessor = new ProfessionalCADProcessor();
            if (fileExtension === 'dwg' && cadData) {
                // already processed above
            } else {
                cadData = await cadProcessor.processDXF(filePathToProcess);
            }

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

            if (!cadData || !Array.isArray(cadData.walls) || cadData.walls.length === 0) {
                console.warn('CAD processing produced no walls; rejecting upload');
                cleanupUpload();
                return res.status(200).json({
                    success: false,
                    error: 'Unable to extract geometry from this file. Please ensure the DXF contains wall linework (or convert DWG to DXF with wall layers).'
                });
            }

            console.log(`CAD processing: ${cadData.walls.length} walls, ${cadData.forbiddenZones.length} forbidden zones, ${cadData.entrances.length} entrances, ${cadData.rooms.length} rooms`);
        } catch (e) {
            console.warn('CAD processing failed:', e.message);
            cleanupUpload();
            return res.status(200).json({ success: false, error: 'CAD processing failed: ' + e.message });
        }

        // Return CAD data directly - no APS upload needed
        const urn = `local_${Date.now()}`;

        const normalizedCadData = normalizeCadData(cadData);
        if (!cadData) {
            cleanupUpload();
            return res.status(200).json({
                success: false,
                error: 'CAD processing returned empty data. Please provide a DXF with wall linework or retry conversion.'
            });
        }

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
        setTimeout(() => cleanupUpload(), 1000);

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
        const { floorPlan, distribution, unitMix, rules, options = {} } = req.body || {};

        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }
        let resolvedDistribution = distribution;
        if (!resolvedDistribution || typeof resolvedDistribution !== 'object' || Object.keys(resolvedDistribution).length === 0) {
            resolvedDistribution = {
                '0-2': 25,
                '2-5': 35,
                '5-10': 30,
                '10-20': 10
            };
            console.warn('[Ilots] Distribution missing; using default distribution.');
        }
        if (!floorPlan.bounds) {
            return res.status(400).json({ error: 'Floor plan bounds required' });
        }

        // Ensure required arrays exist (even if empty)
        const normalizedFloorPlan = {
            walls: floorPlan.walls || [],
            forbiddenZones: floorPlan.forbiddenZones || [],
            entrances: floorPlan.entrances || [],
            bounds: floorPlan.bounds,
            rooms: floorPlan.rooms || [],
            urn: floorPlan.urn || floorPlan.id
        };

        const minX = Number(normalizedFloorPlan.bounds.minX);
        const minY = Number(normalizedFloorPlan.bounds.minY);
        const maxX = Number(normalizedFloorPlan.bounds.maxX);
        const maxY = Number(normalizedFloorPlan.bounds.maxY);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
            return res.status(400).json({ error: 'Floor plan bounds must be numeric' });
        }
        if (maxX <= minX || maxY <= minY) {
            return res.status(400).json({ error: 'Floor plan bounds must have positive width and height' });
        }

        const planId = normalizedFloorPlan.urn || floorPlan.urn || floorPlan.id;
        normalizedFloorPlan.urn = planId;

        let normalizedDistribution;
        try {
            normalizedDistribution = normalizeDistribution(resolvedDistribution);
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Invalid distribution' });
        }

        const generatorOptions = Object.assign({}, options);

        if (typeof generatorOptions.seed === 'undefined' || generatorOptions.seed === null) {
            const seedSource = planId || `${normalizedFloorPlan.bounds.minX},${normalizedFloorPlan.bounds.minY},${normalizedFloorPlan.bounds.maxX},${normalizedFloorPlan.bounds.maxY}`;
            let h = 5381;
            for (let i = 0; i < seedSource.length; i++) { h = ((h << 5) + h) + seedSource.charCodeAt(i); }
            generatorOptions.seed = Math.abs(h) % 1000000000;
        }

        const totalIlots = Number(generatorOptions.totalIlots);
        if (!Number.isFinite(totalIlots) || totalIlots <= 0) {
            return res.status(400).json({ error: 'options.totalIlots must be a positive number' });
        }
        generatorOptions.totalIlots = Math.floor(totalIlots);
        generatorOptions.corridorWidth = typeof generatorOptions.corridorWidth === 'number' ? generatorOptions.corridorWidth : 1.2;
        generatorOptions.margin = typeof generatorOptions.margin === 'number' ? generatorOptions.margin : (generatorOptions.minRowDistance || 1.0);
        generatorOptions.spacing = typeof generatorOptions.spacing === 'number' ? generatorOptions.spacing : 0.3;
        generatorOptions.allowPartial = true;

        const buildEnvelopeRoom = (bounds) => {
            const minX = Number(bounds.minX);
            const minY = Number(bounds.minY);
            const maxX = Number(bounds.maxX);
            const maxY = Number(bounds.maxY);
            return {
                id: 'envelope_room',
                name: 'Envelope',
                type: 'hall',
                bounds: { minX, minY, maxX, maxY },
                polygon: [
                    [minX, minY],
                    [maxX, minY],
                    [maxX, maxY],
                    [minX, maxY]
                ],
                area: Math.max(0, (maxX - minX) * (maxY - minY)),
                center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
            };
        };

        let ilotsRaw = null;
        let placementSummary = null;

        try {
            const ilotPlacer = new RowBasedIlotPlacer(normalizedFloorPlan, generatorOptions);
            ilotsRaw = await ilotPlacer.generateIlots(normalizedDistribution, generatorOptions.totalIlots, unitMix);
            placementSummary = ilotPlacer.stats || null;
        } catch (error) {
            const msg = (error && error.message) ? error.message : String(error);
            const shouldFallback =
                msg.includes('No placements available within detected rooms') ||
                msg.includes('No rooms detected');

            if (!shouldFallback) throw error;

            console.warn('[Ilots] Primary placement failed, retrying with envelope fallback:', msg);

            const fallbackFloorPlan = {
                ...normalizedFloorPlan,
                rooms: [buildEnvelopeRoom(normalizedFloorPlan.bounds)]
            };

            const fallbackOptions = {
                ...generatorOptions,
                // Relax constraints for envelope fallback
                wallClearance: typeof generatorOptions.wallClearance === 'number' ? Math.min(0.2, generatorOptions.wallClearance) : 0.2,
                margin: typeof generatorOptions.margin === 'number' ? Math.min(0.8, generatorOptions.margin) : 0.8,
                spacing: typeof generatorOptions.spacing === 'number' ? Math.min(0.3, generatorOptions.spacing) : 0.3,
                corridorWidth: typeof generatorOptions.corridorWidth === 'number' ? Math.max(1.0, generatorOptions.corridorWidth) : 1.0,
                allowPartial: true
            };

            const ilotPlacer = new RowBasedIlotPlacer(fallbackFloorPlan, fallbackOptions);
            ilotsRaw = await ilotPlacer.generateIlots(normalizedDistribution, fallbackOptions.totalIlots, unitMix);
            placementSummary = ilotPlacer.stats || { fallback: true };

            // persist fallback floor plan for downstream corridor generation consistency
            normalizedFloorPlan.rooms = fallbackFloorPlan.rooms;
        }

        // sanitize placements to ensure numeric fields for client
        let ilots = Array.isArray(ilotsRaw) ? ilotsRaw.map(sanitizeIlot).filter(Boolean) : [];

        if (Number.isFinite(generatorOptions.totalIlots)) {
            if (ilots.length > generatorOptions.totalIlots) {
                ilots = ilots.slice(0, generatorOptions.totalIlots);
            }
        }

        // If placement is extremely sparse, switch to grid-cell extraction (fills coverage like COSTO reference)
        const minExpected = Math.max(20, Math.floor(generatorOptions.totalIlots * 0.35));
        console.log(`[Ilots] Checking sparse: ilots=${ilots.length}, minExpected=${minExpected}, totalIlots=${generatorOptions.totalIlots}`);
        if (ilots.length < minExpected) {
            try {
                console.log('[Ilots] Attempting grid extraction...');
                const corridorWidth = Number.isFinite(generatorOptions.corridorWidth) ? generatorOptions.corridorWidth : 1.2;
                const gridCells = extractGridCells(
                    normalizedFloorPlan,
                    resolvedDistribution,
                    unitMix,
                    {
                        snapTolerance: 0.15, // increased tolerance for better matching
                        minCellSize: 0.4,    // smaller minimum cell size
                        minCellArea: 0.2,    // smaller minimum area to capture small cells
                        maxCellArea: 60,     // larger maximum area
                        strictValidation: false, // relaxed edge validation
                        corridorWidth,
                        seed: generatorOptions.seed, // Pass seed for reproducible distribution-based generation
                        entranceClearance: 1.2,
                        forbiddenClearance: 0.25,
                        wallClearance: 0.3
                    }
                ).map(sanitizeIlot).filter(Boolean);

                console.log(`[Ilots] Grid extraction returned ${gridCells.length} cells`);

                if (gridCells.length > ilots.length) {
                    console.warn(`[Ilots] Sparse placement (${ilots.length}); using grid extraction (${gridCells.length}) for full coverage.`);
                    ilots = gridCells;
                    placementSummary = Object.assign({}, placementSummary || {}, {
                        mode: 'grid-extraction',
                        placedCount: ilots.length
                    });
                } else {
                    console.log(`[Ilots] Grid extraction did not improve (${gridCells.length} <= ${ilots.length})`);
                }
            } catch (gridErr) {
                console.warn('[Ilots] Grid extraction failed, keeping sparse placement:', gridErr.message || gridErr);
            }
        }

        // Calculate total area
        const totalArea = ilots.reduce((sum, ilot) => sum + (Number(ilot.area) || 0), 0);
        const unitMixReport = UnitMixReport.buildReport(ilots, unitMix);

        global.lastPlacedIlots = ilots;
        if (planId) {
            floorPlanStore.saveFloorPlan(normalizedFloorPlan);
            floorPlanStore.updateLayout(planId, {
                ilots,
                distribution: normalizedDistribution,
                options: generatorOptions,
                unitMixReport,
                placementSummary
            });
        }

        console.log(`Îlot generation: ${ilots.length} placed, total area: ${totalArea.toFixed(2)} m²`);


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
            unitMixReport: unitMixReport,
            placementSummary: placementSummary,
            validation: validationReport,
            suggestions: suggestions,
            message: `Generated ${ilots.length} ilots with ${totalArea.toFixed(2)} m² total area`
        });


    } catch (error) {
        console.error('Îlot generation error:', error);
        res.status(500).json({ error: 'Îlot generation failed: ' + error.message });
    }
});

// Compliance report endpoint
app.post('/api/report/compliance', (req, res) => {
    try {
        const { floorPlan, ilots, corridors, unitMixReport, validation } = req.body || {};
        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }
        const ilotList = Array.isArray(ilots) ? ilots : [];
        const corridorList = Array.isArray(corridors) ? corridors : [];

        let validationReport = validation;
        if (!validationReport) {
            const validator = new ArchitecturalValidator({ ...floorPlan, ilots: ilotList, corridors: corridorList });
            validationReport = validator.validate();
        }

        const report = ComplianceReport.buildComplianceReport({
            floorPlan,
            ilots: ilotList,
            corridors: corridorList,
            unitMixReport,
            validation: validationReport
        });

        res.json({ success: true, report });
    } catch (error) {
        console.error('Compliance report error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Layout optimization endpoint
app.post('/api/optimize/layout', (req, res) => {
    try {
        const { floorPlan, ilots } = req.body;

        if (!floorPlan || !ilots) {
            return res.status(400).json({ error: 'Floor plan and ilots data required' });
        }
        if (!floorPlan.bounds) {
            return res.status(400).json({ error: 'Floor plan bounds required' });
        }

        // Normalize floor plan
        const normalizedFloorPlan = {
            walls: floorPlan.walls || [],
            forbiddenZones: floorPlan.forbiddenZones || [],
            entrances: floorPlan.entrances || [],
            bounds: floorPlan.bounds,
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
        if (!floorPlan.bounds) {
            return res.status(400).json({ error: 'Floor plan bounds required' });
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
            bounds: floorPlan.bounds,
            rooms: floorPlan.rooms || [],
            urn: floorPlan.urn
        };

        const corridorGenerator = new ProductionCorridorGenerator(normalizedFloorPlan, ilotsToUse, {});
        let optimizedPaths = corridorGenerator.generateCorridors();

        if (!optimizedPaths.length) {
            const advancedGenerator = new AdvancedCorridorGenerator(normalizedFloorPlan, ilotsToUse, {
                corridorWidth: 1.5,
                generateVertical: true,
                generateHorizontal: true
            });
            const advancedResult = advancedGenerator.generate();
            optimizedPaths = Array.isArray(advancedResult.corridors) ? advancedResult.corridors : [];
        }

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

// Advanced corridor generation backed by JS corridor generator
app.post('/api/corridors/advanced', async (req, res) => {
    try {
        const body = req.body || {};
        const floorPlan = body.floorPlan;
        const options = body.options || {};

        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan data required' });
        }
        if (!floorPlan.bounds) {
            return res.status(400).json({ error: 'Floor plan bounds required' });
        }

        const normalizedFloorPlan = {
            walls: Array.isArray(floorPlan.walls) ? floorPlan.walls : [],
            forbidden_zones: Array.isArray(floorPlan.forbidden_zones) ? floorPlan.forbidden_zones : (Array.isArray(floorPlan.forbiddenZones) ? floorPlan.forbiddenZones : []),
            forbiddenZones: Array.isArray(floorPlan.forbiddenZones) ? floorPlan.forbiddenZones : (Array.isArray(floorPlan.forbidden_zones) ? floorPlan.forbidden_zones : []),
            entrances: Array.isArray(floorPlan.entrances) ? floorPlan.entrances : [],
            bounds: floorPlan.bounds,
            rooms: Array.isArray(floorPlan.rooms) ? floorPlan.rooms : [],
            urn: floorPlan.urn || floorPlan.id || null,
            id: floorPlan.id || floorPlan.urn || null
        };

        const generationOptions = {
            corridor_width: typeof options.corridor_width === 'number'
                ? options.corridor_width
                : (typeof options.corridorWidth === 'number' ? options.corridorWidth : 1.5),
            generate_arrows: options.generate_arrows !== false,
            margin: 0.5,
            corridorWidth: typeof options.corridor_width === 'number' ? options.corridor_width : 1.5
        };

        // Use the last placed ilots or empty array
        const ilots = global.lastPlacedIlots || [];

        // Generate corridors using ProductionCorridorGenerator
        const corridorGenerator = new ProductionCorridorGenerator(normalizedFloorPlan, ilots, generationOptions);
        const corridors = corridorGenerator.generateCorridors();

        // Generate circulation arrows (green arrows showing flow direction)
        const arrows = [];
        if (generationOptions.generate_arrows && corridors.length > 0) {
            corridors.forEach((corridor, idx) => {
                // Add arrows along corridor centerline
                const numArrows = Math.max(1, Math.floor(corridor.length / 5)); // 1 arrow per 5m
                const isHorizontal = corridor.width > corridor.height;

                for (let i = 0; i < numArrows; i++) {
                    const progress = (i + 0.5) / numArrows;
                    const x = corridor.x + (isHorizontal ? corridor.width * progress : corridor.width / 2);
                    const y = corridor.y + (isHorizontal ? corridor.height / 2 : corridor.height * progress);

                    arrows.push({
                        x, y, z: 0.6,
                        direction: isHorizontal ? 'right' : 'up',
                        color: 'green',
                        size: 'small',
                        type: 'circulation'
                    });
                }
            });
        }

        const statistics = {
            total_corridors: corridors.length,
            total_area: corridors.reduce((sum, c) => sum + (c.area || 0), 0),
            total_length: corridors.reduce((sum, c) => sum + (c.length || 0), 0),
            average_width: corridors.length > 0
                ? corridors.reduce((sum, c) => sum + (isNaN(c.width) ? 0 : c.width), 0) / corridors.length
                : 0
        };

        const metadata = {
            engine: 'js-production',
            version: '2.0',
            timestamp: new Date().toISOString()
        };

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

        let corridors = result.corridors.map(sanitizeCorridor).filter(Boolean);
        let totalArea = result.totalArea;

        // Strict production mode requires actual generation
        if (!corridors.length && options.strictMode) {
            console.warn('[Corridor API] No corridors generated.');
        }

        res.json({
            success: true,
            corridors,
            totalArea,
            count: corridors.length,
            statistics: result.statistics,
            metadata: result.metadata,
            invalid: result.invalid || [],
            message: `Generated ${corridors.length} corridors (${result.statistics.vertical} vertical, ${result.statistics.horizontal} horizontal)`
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

// Viewer token endpoint for Autodesk Viewer integration

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
    if (!distribution) return res.status(400).json({ error: 'Distribution data required' });

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
async function runAutomationForUrn(urn, { distribution, options = {}, corridorWidth = 1.2, timeoutMs = 120000, waitForAPS = false, analysisData: providedAnalysis = null } = {}) {
    if (!urn) throw new Error('URN required');
    if (!distribution) throw new Error('Distribution data required');

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
    if (!analysisData.bounds) {
        throw new Error('Analysis bounds missing; cannot run automation');
    }

    const floorPlan = {
        walls: analysisData.walls || [],
        forbiddenZones: analysisData.forbiddenZones || [],
        entrances: analysisData.entrances || [],
        bounds: analysisData.bounds,
        rooms: analysisData.rooms || [],
        placementTransform: analysisData.placementTransform || null
    };

    const normalizedDistribution = normalizeDistribution(distribution);
    const totalIlots = Number(options.totalIlots);
    if (!Number.isFinite(totalIlots) || totalIlots <= 0) {
        throw new Error('options.totalIlots must be a positive number');
    }

    const ilotPlacer = new RowBasedIlotPlacer(floorPlan, options || {});
    const ilots = ilotPlacer.generateIlots(normalizedDistribution, Math.floor(totalIlots));
    global.lastPlacedIlots = ilots;

    const corridorGenerator = new ProductionCorridorGenerator(floorPlan, ilots, { corridorWidth });
    const corridors = corridorGenerator.generateCorridors();

    // expose last placed corridors for overlays
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
                await webhookWorker.enqueue(urn, eventId, payload);
                console.log('Enqueued webhook job for urn', urn, 'eventId', eventId);
            } catch (e) {
                console.error('Webhook queue error:', e && e.message ? e.message : e);
                return res.status(500).json({ success: false, error: 'Webhook queue unavailable' });
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

app.get('/api/auth/token', async (req, res) => {
    try {
        const token = await getAPSToken();
        res.json({
            access_token: token,
            expires_in: 3600
        });
    } catch (error) {
        const message = error && error.message === 'APS_NOT_CONFIGURED'
            ? 'APS credentials not configured'
            : (error && error.message ? error.message : 'Failed to acquire APS token');
        res.status(500).json({ error: message });
    }
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
        sqlite: Boolean(sqliteAdapter && typeof sqliteAdapter.dbFilePath === 'function' && sqliteAdapter.dbFilePath())
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

// Per-URN transform endpoints
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

// Create a webhook on APS and store the secret locally
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

async function startServer() {
    try {
        await ProductionInitializer.initialize();
    } catch (error) {
        console.error('[Startup] Production initializer failed, continuing in fallback mode:', error.message || error);
    }
    return new Promise((resolve, reject) => {
        const server = app.listen(PORT, BIND_ADDRESS, () => {
            console.log(`FloorPlan Pro Clean with Three.js running on http://${BIND_ADDRESS}:${PORT}`);
            console.log('✅ Server Startup Complete');
            resolve(server);
        });

        server.on('error', (err) => {
            console.error('Server failed to start:', err);
            reject(err);
        });
    });
}

// Start server automatically only when run directly
if (require.main === module) {
    startServer()
        .catch((error) => {
            console.error('Failed to start server:', error);
            process.exit(1);
        });
}

// ===== COSTO V1 API ENDPOINTS =====

// COSTO: Process CAD file with layer standard
app.post('/api/costo/process', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const layerMapping = req.body.layerMapping ? JSON.parse(req.body.layerMapping) : null;
        const floorPlan = await CostoAPI.processCADFile(req.file.path, layerMapping);

        // Cleanup
        try { fs.unlinkSync(req.file.path); } catch (e) { }

        res.json({
            success: true,
            floorPlan,
            layerMapping: CostoAPI.getLayerMapping()
        });
    } catch (error) {
        if (req.file && req.file.path) try { fs.unlinkSync(req.file.path); } catch (e) { }
        console.error('COSTO process error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Generate optimized layout
app.post('/api/costo/generate', async (req, res) => {
    try {
        const { floorPlan, unitMix, rules, options } = req.body;

        if (!floorPlan || !unitMix) {
            return res.status(400).json({ error: 'Floor plan and unit mix required' });
        }

        const result = CostoAPI.generateLayout(floorPlan, unitMix, rules, options);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('COSTO generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Get/Update box catalog
app.get('/api/costo/catalog', (req, res) => {
    try {
        const catalog = CostoAPI.getCatalog();
        res.json({ success: true, catalog });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/costo/catalog', (req, res) => {
    try {
        const { catalog } = req.body;
        CostoAPI.updateCatalog(catalog);
        res.json({ success: true, message: 'Catalog updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Get/Update layer mapping
app.get('/api/costo/layers', (req, res) => {
    try {
        const mapping = CostoAPI.getLayerMapping();
        const standardTypes = CostoLayerStandard.getStandardTypes();
        res.json({ success: true, mapping, standardTypes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/costo/layers', (req, res) => {
    try {
        const { mapping } = req.body;
        CostoAPI.setLayerMapping(mapping);
        res.json({ success: true, message: 'Layer mapping updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Export to DWG
app.post('/api/costo/export/dwg', async (req, res) => {
    try {
        const { solution, floorPlan, options } = req.body;
        if (!solution || !floorPlan) {
            return res.status(400).json({ error: 'Solution and floor plan required' });
        }

        const dwgContent = CostoExports.exportToDWG(solution, floorPlan, options);
        const filename = `costo_layout_${Date.now()}.dxf`;
        const filepath = path.join(__dirname, 'exports', filename);

        if (!fs.existsSync(path.dirname(filepath))) {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
        }
        fs.writeFileSync(filepath, dwgContent);

        res.json({
            success: true,
            filename,
            filepath,
            message: 'DWG exported successfully'
        });
    } catch (error) {
        console.error('COSTO DWG export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Export to PDF
app.post('/api/costo/export/pdf', async (req, res) => {
    try {
        const { solution, floorPlan, metrics, options } = req.body;
        if (!solution || !floorPlan) {
            return res.status(400).json({ error: 'Solution and floor plan required' });
        }

        const pdfBytes = await CostoExports.exportToPDF(solution, floorPlan, metrics, options);
        const filename = `costo_layout_${Date.now()}.pdf`;
        const filepath = path.join(__dirname, 'exports', filename);

        if (!fs.existsSync(path.dirname(filepath))) {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
        }
        fs.writeFileSync(filepath, pdfBytes);

        res.json({
            success: true,
            filename,
            filepath,
            message: 'PDF exported successfully'
        });
    } catch (error) {
        console.error('COSTO PDF export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Export to Interactive SVG
app.post('/api/costo/export/svg', (req, res) => {
    try {
        const { solution, floorPlan, options } = req.body;
        if (!solution || !floorPlan) {
            return res.status(400).json({ error: 'Solution and floor plan required' });
        }

        const svgContent = CostoExports.exportToInteractiveSVG(solution, floorPlan, options);
        const filename = `costo_layout_${Date.now()}.svg`;
        const filepath = path.join(__dirname, 'exports', filename);

        if (!fs.existsSync(path.dirname(filepath))) {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
        }
        fs.writeFileSync(filepath, svgContent);

        res.json({
            success: true,
            filename,
            filepath,
            message: 'SVG exported successfully'
        });
    } catch (error) {
        console.error('COSTO SVG export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Export to Excel
app.post('/api/costo/export/excel', (req, res) => {
    try {
        const { solution, unitMix, deviation, options } = req.body;
        if (!solution) {
            return res.status(400).json({ error: 'Solution required' });
        }

        const excelBuffer = CostoExports.exportToExcel(solution, unitMix, deviation, options);
        const filename = `costo_data_${Date.now()}.xlsx`;
        const filepath = path.join(__dirname, 'exports', filename);

        if (!fs.existsSync(path.dirname(filepath))) {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
        }
        fs.writeFileSync(filepath, excelBuffer);

        res.json({
            success: true,
            filename,
            filepath,
            message: 'Excel exported successfully'
        });
    } catch (error) {
        console.error('COSTO Excel export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Export to CSV
app.post('/api/costo/export/csv', (req, res) => {
    try {
        const { solution, options } = req.body;
        if (!solution) {
            return res.status(400).json({ error: 'Solution required' });
        }

        const csvContent = CostoExports.exportToCSV(solution, options);
        const filename = `costo_data_${Date.now()}.csv`;
        const filepath = path.join(__dirname, 'exports', filename);

        if (!fs.existsSync(path.dirname(filepath))) {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
        }
        fs.writeFileSync(filepath, csvContent);

        res.json({
            success: true,
            filename,
            filepath,
            message: 'CSV exported successfully'
        });
    } catch (error) {
        console.error('COSTO CSV export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Export Report PDF
app.post('/api/costo/export/report', async (req, res) => {
    try {
        const { solution, metrics, compliance, deviation, options } = req.body;
        if (!solution) {
            return res.status(400).json({ error: 'Solution required' });
        }

        const pdfBytes = await CostoExports.exportReportPDF(solution, metrics, compliance, deviation, options);
        const filename = `costo_report_${Date.now()}.pdf`;
        const filepath = path.join(__dirname, 'exports', filename);

        if (!fs.existsSync(path.dirname(filepath))) {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
        }
        fs.writeFileSync(filepath, pdfBytes);

        res.json({
            success: true,
            filename,
            filepath,
            message: 'Report PDF exported successfully'
        });
    } catch (error) {
        console.error('COSTO Report PDF export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Export Reference-Style PDF (matches architectural floor plan reference)
app.post('/api/costo/export/reference-pdf', async (req, res) => {
    try {
        const { solution, floorPlan, metrics, options = {} } = req.body;
        if (!solution) {
            return res.status(400).json({ error: 'Solution required' });
        }
        if (!floorPlan) {
            return res.status(400).json({ error: 'Floor plan required' });
        }

        const pdfBytes = await CostoExports.exportToReferencePDF(solution, floorPlan, metrics, options);
        const filename = `costo_reference_${Date.now()}.pdf`;
        const filepath = path.join(__dirname, 'exports', filename);

        if (!fs.existsSync(path.dirname(filepath))) {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
        }
        fs.writeFileSync(filepath, pdfBytes);

        res.json({
            success: true,
            filename,
            filepath,
            message: 'Reference-style PDF exported successfully'
        });
    } catch (error) {
        console.error('COSTO Reference PDF export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Apply numbering
app.post('/api/costo/numbering', (req, res) => {
    try {
        const { boxes, options } = req.body;
        if (!boxes || !Array.isArray(boxes)) {
            return res.status(400).json({ error: 'Boxes array required' });
        }

        const numberedBoxes = CostoNumbering.applyNumbering(boxes, options);
        const statistics = CostoNumbering.getStatistics(numberedBoxes);

        res.json({
            success: true,
            boxes: numberedBoxes,
            statistics,
            message: `Numbered ${numberedBoxes.length} boxes`
        });
    } catch (error) {
        console.error('COSTO numbering error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COSTO: Project management
app.post('/api/costo/project/save', (req, res) => {
    try {
        const { projectId, projectData } = req.body;
        if (!projectId || !projectData) {
            return res.status(400).json({ error: 'Project ID and data required' });
        }

        const filepath = CostoProjectManager.saveProject(projectId, projectData);
        res.json({
            success: true,
            projectId,
            filepath,
            message: 'Project saved successfully'
        });
    } catch (error) {
        console.error('COSTO project save error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/costo/project/:projectId', (req, res) => {
    try {
        const { projectId } = req.params;
        const project = CostoProjectManager.loadProject(projectId);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({ success: true, project });
    } catch (error) {
        console.error('COSTO project load error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/costo/projects', (req, res) => {
    try {
        const projects = CostoProjectManager.listProjects();
        res.json({ success: true, projects });
    } catch (error) {
        console.error('COSTO projects list error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/costo/project/:projectId', (req, res) => {
    try {
        const { projectId } = req.params;
        const deleted = CostoProjectManager.deleteProject(projectId);

        if (!deleted) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({ success: true, message: 'Project deleted successfully' });
    } catch (error) {
        console.error('COSTO project delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export automation helper and server controls for tests/worker scripts
app.startServer = startServer;
app.runAutomationForUrn = runAutomationForUrn;

module.exports = app;
