const path = require('path');
const fs = require('fs');
const sqliteAdapter = require('./sqliteAdapter');

// Use /tmp for production (Render), project dir for local dev
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
const writableDir = isProduction ? '/tmp' : path.join(__dirname, '..');
const DB_FILE = process.env.WEBHOOK_DB || path.join(writableDir, 'webhooks.db');

let initPromise = null;
let initError = null;
let ready = false;

function now() { return new Date().toISOString(); }

async function init() {
    if (ready) return;
    if (!initPromise) {
        initPromise = (async () => {
            const dir = path.dirname(DB_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const info = await sqliteAdapter.init({ dbFile: DB_FILE, fileName: path.basename(DB_FILE) });
            if (!info || !info.usingSqlite) {
                throw new Error('SQLite adapter unavailable for webhook queue');
            }
            sqliteAdapter.exec(`
                CREATE TABLE IF NOT EXISTS jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    urn TEXT,
                    eventId TEXT,
                    payload TEXT,
                    status TEXT,
                    attempts INTEGER,
                    lastError TEXT,
                    createdAt TEXT,
                    updatedAt TEXT
                );
            `);
            ready = true;
        })().catch((e) => {
            initError = e;
            throw e;
        });
    }
    return initPromise;
}

async function ensureReady() {
    if (initError) {
        throw new Error(`Webhook worker initialization failed: ${initError.message || initError}`);
    }
    await init();
    if (!ready) {
        throw new Error('Webhook worker not initialized');
    }
}

module.exports = {
    enqueue: async function (urn, eventId, payload) {
        await ensureReady();
        sqliteAdapter.run('INSERT INTO jobs(urn,eventId,payload,status,attempts,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',
            [urn, eventId || null, JSON.stringify(payload || {}), 'pending', 0, now(), now()]);
    },
    fetchPending: async function (limit = 10) {
        await ensureReady();
        return sqliteAdapter.all('SELECT * FROM jobs WHERE status = ? ORDER BY createdAt ASC LIMIT ?', ['pending', limit]);
    },
    markInProgress: async function (id) {
        await ensureReady();
        sqliteAdapter.run('UPDATE jobs SET status=?,updatedAt=? WHERE id=?', ['inprogress', now(), id]);
    },
    markDone: async function (id) {
        await ensureReady();
        sqliteAdapter.run('UPDATE jobs SET status=?,updatedAt=? WHERE id=?', ['done', now(), id]);
    },
    markFailed: async function (id, err) {
        await ensureReady();
        sqliteAdapter.run('UPDATE jobs SET status=?,attempts=attempts+1,lastError=?,updatedAt=? WHERE id=?', ['failed', String(err).slice(0, 1000), now(), id]);
    }
};
