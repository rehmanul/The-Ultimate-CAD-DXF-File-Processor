const path = require('path');
const fs = require('fs');

const STORE_FILE = process.env.TRANSFORM_STORE || path.join(__dirname, '..', 'transforms.json');
const DB_FILE = process.env.TRANSFORM_DB || path.join(__dirname, '..', 'transforms.db');

const sqliteAdapter = require('./sqliteAdapter');
const postgresAdapter = require('./postgresAdapter');
let usingSqlite = false;
let usingPostgres = false;
let dbAdapter = null;

// initialize adapters (prefer Postgres if DATABASE_URL provided)
(async function initAdapters() {
    try {
        const pgInfo = await postgresAdapter.init();
        if (pgInfo && pgInfo.usingPostgres) {
            usingPostgres = true;
            dbAdapter = postgresAdapter;
            // ensure transforms table exists
            await dbAdapter.run(`CREATE TABLE IF NOT EXISTS transforms (urn TEXT PRIMARY KEY, transform TEXT, meta TEXT, updatedAt TEXT);`);
            return;
        }
    } catch (e) {
        // ignore postgres init failure and fallback to sqlite
        console.warn('Postgres init failed:', e && e.message);
    }
    try {
        const info = await sqliteAdapter.init({ dbFile: DB_FILE, fileName: path.basename(DB_FILE) });
        if (info && info.usingSqlite) {
            usingSqlite = true;
            dbAdapter = sqliteAdapter;
            try {
                dbAdapter.exec(`
                    CREATE TABLE IF NOT EXISTS transforms (
                        urn TEXT PRIMARY KEY,
                        transform TEXT,
                        meta TEXT,
                        updatedAt TEXT
                    );
                `);
            } catch (e) { /* ignore */ }
        }
    } catch (e) {
        // nothing; JSON fallback will be used
    }
})();

function readJsonStore() {
    try {
        if (!fs.existsSync(STORE_FILE)) return { transforms: {} };
        const raw = fs.readFileSync(STORE_FILE, 'utf8') || '{}';
        const parsed = JSON.parse(raw || '{}');
        return { transforms: parsed.transforms || {} };
    } catch (e) {
        console.warn('Failed to read transform store JSON:', e.message);
        return { transforms: {} };
    }
}

function writeJsonStore(store) {
    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify({ transforms: store.transforms || {} }, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to write transform store JSON:', e.message);
    }
}

function migrateJsonToSqlite() {
    if (!usingSqlite || !dbAdapter) return 0;
    try {
        if (!fs.existsSync(STORE_FILE)) return 0;
        const raw = fs.readFileSync(STORE_FILE, 'utf8') || '{}';
        const parsed = JSON.parse(raw || '{}');
        const transforms = parsed.transforms || {};
        const insertSql = 'INSERT OR REPLACE INTO transforms(urn, transform, meta, updatedAt) VALUES(?,?,?,?)';
        let count = 0;
        for (const urn of Object.keys(transforms)) {
            const entry = transforms[urn] || {};
            try {
                dbAdapter.run(insertSql, [urn, JSON.stringify(entry.transform || null), JSON.stringify(entry.meta || {}), (entry.meta && entry.meta.savedAt) || new Date().toISOString()]);
                count++;
            } catch (e) {
                // ignore individual failures
            }
        }
        return count;
    } catch (e) {
        console.warn('Failed to migrate transforms JSON to SQLite:', e.message);
        return 0;
    }
}

module.exports = {
    // Returns an object { transform: <object>, meta: { savedBy, savedAt, comment } } or null
    getTransform: function (urn) {
        if (usingSqlite && dbAdapter) {
            try {
                const row = dbAdapter.get('SELECT transform, meta FROM transforms WHERE urn = ?', [urn]);
                if (!row) return null;
                return { transform: row.transform ? JSON.parse(row.transform) : null, meta: row.meta ? JSON.parse(row.meta) : {} };
            } catch (e) {
                return { transform: null, meta: {} };
            }
        }
        const store = readJsonStore();
        return store.transforms[urn] || null;
    },
    // Save transform with optional metadata. meta may contain savedBy and comment. savedAt will be set server-side if not provided.
    saveTransform: function (urn, transformObj, meta = {}) {
        const now = new Date().toISOString();
        if (usingSqlite && dbAdapter) {
            try {
                const existing = dbAdapter.get('SELECT meta FROM transforms WHERE urn = ?', [urn]);
                let mergedMeta = Object.assign({}, existing && existing.meta ? JSON.parse(existing.meta) : {}, meta || {}, { savedAt: (meta && meta.savedAt) ? meta.savedAt : now });
                dbAdapter.run('INSERT OR REPLACE INTO transforms(urn, transform, meta, updatedAt) VALUES(?,?,?,?)', [urn, JSON.stringify(transformObj || null), JSON.stringify(mergedMeta || {}), mergedMeta.savedAt]);
                return { transform: transformObj, meta: mergedMeta };
            } catch (e) {
                // fall through to JSON
            }
        }
        const store = readJsonStore();
        store.transforms = store.transforms || {};
        const entry = Object.assign({}, store.transforms[urn] || {}, {
            transform: transformObj,
            meta: Object.assign({}, store.transforms[urn] && store.transforms[urn].meta || {}, meta, { savedAt: (meta && meta.savedAt) ? meta.savedAt : now })
        });
        store.transforms[urn] = entry;
        writeJsonStore(store);
        return store.transforms[urn];
    },
    listTransforms: function () {
        if (usingSqlite && dbAdapter) {
            try {
                const rows = dbAdapter.all('SELECT urn, transform, meta, updatedAt FROM transforms');
                const out = {};
                rows.forEach(r => {
                    try {
                        out[r.urn] = { transform: r.transform ? JSON.parse(r.transform) : null, meta: r.meta ? JSON.parse(r.meta) : {} };
                    } catch (e) {
                        out[r.urn] = { transform: null, meta: {} };
                    }
                });
                return out;
            } catch (e) {
                // fall back
            }
        }
        const store = readJsonStore();
        return store.transforms || {};
    },
    // Expose migration helper
    migrateJsonToSqlite
};
