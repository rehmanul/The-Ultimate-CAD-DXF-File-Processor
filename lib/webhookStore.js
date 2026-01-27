const path = require('path');
const fs = require('fs');

// Use /tmp for production (Render), project dir for local dev
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
const writableDir = isProduction ? '/tmp' : path.join(__dirname, '..');
const DB_FILE = process.env.WEBHOOK_DB || path.join(writableDir, 'webhooks.db');
const JSON_STORE = path.join(__dirname, '..', 'webhooks.json');

const sqliteAdapter = require('./sqliteAdapter');
let usingSqlite = false;
let dbAdapter = null;
let initError = null;

(async function initAdapters() {
    if (process.env.DATABASE_URL) {
        initError = new Error('Webhook store does not support DATABASE_URL; configure SQLite');
        return;
    }
    try {
        const info = await sqliteAdapter.init({ dbFile: DB_FILE, fileName: path.basename(DB_FILE) });
        if (info && info.usingSqlite) {
            usingSqlite = true;
            dbAdapter = sqliteAdapter;
            try {
                dbAdapter.exec(`
                    CREATE TABLE IF NOT EXISTS hooks (
                        id TEXT PRIMARY KEY,
                        system TEXT,
                        event TEXT,
                        callbackUrl TEXT,
                        scope TEXT,
                        secret TEXT,
                        location TEXT,
                        createdAt TEXT
                    );
                `);
                dbAdapter.exec(`
                    CREATE TABLE IF NOT EXISTS processed_events (
                        eventId TEXT PRIMARY KEY,
                        createdAt TEXT
                    );
                `);
            } catch (e) { /* ignore table creation errors */ }
            return;
        }
        initError = new Error('SQLite adapter failed to initialize');
    } catch (e) {
        initError = e;
    }
})();

function ensureDbReady() {
    if (initError) {
        throw new Error(`Webhook store initialization failed: ${initError.message || initError}`);
    }
    if (!dbAdapter) {
        throw new Error('Webhook store not initialized');
    }
}

module.exports = {
    addHook: function (h) {
        ensureDbReady();
        dbAdapter.run('INSERT OR REPLACE INTO hooks(id, system, event, callbackUrl, scope, secret, location, createdAt) VALUES(?,?,?,?,?,?,?,?)', [h.id, h.system, h.event, h.callbackUrl, JSON.stringify(h.scope || {}), h.secret || null, h.location || null, h.createdAt || new Date().toISOString()]);
    },
    getHooks: function () {
        ensureDbReady();
        const rows = dbAdapter.all('SELECT * FROM hooks');
        return rows.map(r => ({ ...r, scope: JSON.parse(r.scope || '{}') }));
    },
    getHookById: function (id) {
        ensureDbReady();
        const row = dbAdapter.get('SELECT * FROM hooks WHERE id = ?', [id]);
        if (!row) return null;
        return { ...row, scope: JSON.parse(row.scope || '{}') };
    },
    deleteHook: function (id) {
        ensureDbReady();
        dbAdapter.run('DELETE FROM hooks WHERE id = ?', [id]);
    },
    rotateSecret: function (id, newSecret) {
        ensureDbReady();
        dbAdapter.run('UPDATE hooks SET secret = ? WHERE id = ?', [newSecret, id]);
    },
    markEventProcessed: function (eventId) {
        ensureDbReady();
        dbAdapter.run('INSERT OR IGNORE INTO processed_events(eventId, createdAt) VALUES(?,?)', [eventId, new Date().toISOString()]);
    },
    isEventProcessed: function (eventId) {
        ensureDbReady();
        const row = dbAdapter.get('SELECT eventId FROM processed_events WHERE eventId = ?', [eventId]);
        return !!row;
    }
};
