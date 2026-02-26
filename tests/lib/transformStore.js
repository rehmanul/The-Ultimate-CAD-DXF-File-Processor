const path = require('path');
const fs = require('fs');

const STORE_FILE = process.env.TRANSFORM_STORE || path.join(__dirname, '..', 'transforms.json');
const DB_FILE = process.env.TRANSFORM_DB || path.join(__dirname, '..', 'transforms.db');

const sqliteAdapter = require('./sqliteAdapter');
let usingSqlite = false;
let dbAdapter = null;
let initError = null;

// initialize adapter (SQLite only)
(async function initAdapters() {
    if (process.env.DATABASE_URL) {
        initError = new Error('Transform store does not support DATABASE_URL; configure SQLite');
        return;
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
            return;
        }
        initError = new Error('SQLite adapter failed to initialize');
    } catch (e) {
        initError = e;
    }
})();

function ensureDbReady() {
    if (initError) {
        throw new Error(`Transform store initialization failed: ${initError.message || initError}`);
    }
    if (!dbAdapter) {
        throw new Error('Transform store not initialized');
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
        ensureDbReady();
        const row = dbAdapter.get('SELECT transform, meta FROM transforms WHERE urn = ?', [urn]);
        if (!row) return null;
        return { transform: row.transform ? JSON.parse(row.transform) : null, meta: row.meta ? JSON.parse(row.meta) : {} };
    },
    // Save transform with optional metadata. meta may contain savedBy and comment. savedAt will be set server-side if not provided.
    saveTransform: function (urn, transformObj, meta = {}) {
        ensureDbReady();
        const now = new Date().toISOString();
        const existing = dbAdapter.get('SELECT meta FROM transforms WHERE urn = ?', [urn]);
        const mergedMeta = Object.assign({}, existing && existing.meta ? JSON.parse(existing.meta) : {}, meta || {}, { savedAt: (meta && meta.savedAt) ? meta.savedAt : now });
        dbAdapter.run('INSERT OR REPLACE INTO transforms(urn, transform, meta, updatedAt) VALUES(?,?,?,?)', [urn, JSON.stringify(transformObj || null), JSON.stringify(mergedMeta || {}), mergedMeta.savedAt]);
        return { transform: transformObj, meta: mergedMeta };
    },
    listTransforms: function () {
        ensureDbReady();
        const rows = dbAdapter.all('SELECT urn, transform, meta, updatedAt FROM transforms');
        const out = {};
        rows.forEach(r => {
            out[r.urn] = { transform: r.transform ? JSON.parse(r.transform) : null, meta: r.meta ? JSON.parse(r.meta) : {} };
        });
        return out;
    },
    // Expose migration helper
    migrateJsonToSqlite
};
