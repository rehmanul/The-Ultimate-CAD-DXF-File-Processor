const path = require('path');
const fs = require('fs');

const DB_FILE = process.env.WEBHOOK_DB || path.join(__dirname, '..', 'webhooks.db');
const JSON_STORE = path.join(__dirname, '..', 'webhooks.json');

const sqliteAdapter = require('./sqliteAdapter');
const postgresAdapter = require('./postgresAdapter');
let usingSqlite = false;
let usingPostgres = false;
let dbAdapter = null;

(async function initAdapters() {
    try {
        const pgInfo = await postgresAdapter.init();
        if (pgInfo && pgInfo.usingPostgres) {
            usingPostgres = true;
            dbAdapter = postgresAdapter;
            await dbAdapter.run(`CREATE TABLE IF NOT EXISTS hooks (id TEXT PRIMARY KEY, system TEXT, event TEXT, callbackUrl TEXT, scope TEXT, secret TEXT, location TEXT, createdAt TEXT);`);
            await dbAdapter.run(`CREATE TABLE IF NOT EXISTS processed_events (eventId TEXT PRIMARY KEY, createdAt TEXT);`);
            return;
        }
    } catch (e) {
        console.warn('Postgres init for webhookStore failed:', e && e.message);
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
        }
    } catch (e) { /* ignore failures and keep using JSON fallback */ }
})();

function readJsonStore() {
    try {
        if (!fs.existsSync(JSON_STORE)) return { hooks: [], processed: [] };
        const raw = fs.readFileSync(JSON_STORE, 'utf8') || '{}';
        const parsed = JSON.parse(raw || '{}');
        return { hooks: parsed.hooks || [], processed: parsed.processed || [] };
    } catch (e) {
        console.warn('Failed to read JSON webhook store:', e.message);
        return { hooks: [], processed: [] };
    }
}

function writeJsonStore(store) {
    try {
        fs.writeFileSync(JSON_STORE, JSON.stringify({ hooks: store.hooks || [], processed: store.processed || [] }, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to write JSON webhook store:', e.message);
    }
}

module.exports = {
    addHook: function (h) {
        if (usingSqlite && dbAdapter) {
            try {
                dbAdapter.run('INSERT OR REPLACE INTO hooks(id, system, event, callbackUrl, scope, secret, location, createdAt) VALUES(?,?,?,?,?,?,?,?)', [h.id, h.system, h.event, h.callbackUrl, JSON.stringify(h.scope || {}), h.secret || null, h.location || null, h.createdAt || new Date().toISOString()]);
                return;
            } catch (e) { /* fall back to JSON */ }
        }
        const store = readJsonStore();
        // replace if exists
        const idx = store.hooks.findIndex(x => x.id === h.id);
        const entry = { ...h, scope: h.scope || {}, createdAt: h.createdAt || new Date().toISOString() };
        if (idx !== -1) store.hooks[idx] = entry; else store.hooks.push(entry);
        writeJsonStore(store);
    },
    getHooks: function () {
        if (usingSqlite && dbAdapter) {
            try {
                const rows = dbAdapter.all('SELECT * FROM hooks');
                return rows.map(r => ({ ...r, scope: JSON.parse(r.scope || '{}') }));
            } catch (e) { /* fall back */ }
        }
        const store = readJsonStore();
        return store.hooks.map(h => ({ ...h, scope: h.scope || {} }));
    },
    getHookById: function (id) {
        if (usingSqlite && dbAdapter) {
            try {
                const row = dbAdapter.get('SELECT * FROM hooks WHERE id = ?', [id]);
                if (!row) return null;
                return { ...row, scope: JSON.parse(row.scope || '{}') };
            } catch (e) { /* fall back */ }
        }
        const store = readJsonStore();
        const h = store.hooks.find(x => x.id === id);
        return h ? { ...h, scope: h.scope || {} } : null;
    },
    deleteHook: function (id) {
        if (usingSqlite && dbAdapter) {
            try { dbAdapter.run('DELETE FROM hooks WHERE id = ?', [id]); return; } catch (e) { /* fall back */ }
        }
        const store = readJsonStore();
        const idx = store.hooks.findIndex(x => x.id === id);
        if (idx !== -1) store.hooks.splice(idx, 1);
        writeJsonStore(store);
    },
    rotateSecret: function (id, newSecret) {
        if (usingSqlite && dbAdapter) {
            try { dbAdapter.run('UPDATE hooks SET secret = ? WHERE id = ?', [newSecret, id]); return; } catch (e) { /* fall back */ }
        }
        const store = readJsonStore();
        const h = store.hooks.find(x => x.id === id);
        if (h) { h.secret = newSecret; writeJsonStore(store); }
    },
    markEventProcessed: function (eventId) {
        if (usingSqlite && dbAdapter) {
            try { dbAdapter.run('INSERT OR IGNORE INTO processed_events(eventId, createdAt) VALUES(?,?)', [eventId, new Date().toISOString()]); return; } catch (e) { /* fall back */ }
        }
        const store = readJsonStore();
        store.processed = store.processed || [];
        if (!store.processed.includes(eventId)) { store.processed.push(eventId); writeJsonStore(store); }
    },
    isEventProcessed: function (eventId) {
        if (usingSqlite && dbAdapter) {
            try { const row = dbAdapter.get('SELECT eventId FROM processed_events WHERE eventId = ?', [eventId]); return !!row; } catch (e) { /* fall back */ }
        }
        const store = readJsonStore();
        store.processed = store.processed || [];
        return store.processed.includes(eventId);
    }
};
