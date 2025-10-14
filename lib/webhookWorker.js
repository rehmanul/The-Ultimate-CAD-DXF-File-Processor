const path = require('path');
const fs = require('fs');
let usingSqlite = false;
let db = null;
const DB_FILE = process.env.WEBHOOK_DB || path.join(__dirname, '..', 'webhooks.db');
try {
    const Database = require('better-sqlite3');
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_FILE);
    db.pragma('journal_mode = WAL');
    db.exec(`
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
    usingSqlite = true;
} catch (e) {
    // fallback to file queue
}

const QUEUE_FILE = path.join(__dirname, '..', 'webhook_jobs.json');

function now() { return new Date().toISOString(); }

module.exports = {
    enqueue: function (urn, eventId, payload) {
        if (usingSqlite && db) {
            const stmt = db.prepare('INSERT INTO jobs(urn,eventId,payload,status,attempts,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)');
            stmt.run(urn, eventId || null, JSON.stringify(payload || {}), 'pending', 0, now(), now());
            return;
        }
        let store = { jobs: [] };
        try { if (fs.existsSync(QUEUE_FILE)) store = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8') || '{}'); } catch (e) { store = { jobs: [] }; }
        store.jobs = store.jobs || [];
        store.jobs.push({ id: Date.now() + Math.floor(Math.random() * 1000), urn, eventId, payload, status: 'pending', attempts: 0, createdAt: now(), updatedAt: now() });
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(store, null, 2), 'utf8');
    },
    fetchPending: function (limit = 10) {
        if (usingSqlite && db) {
            const rows = db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY createdAt ASC LIMIT ?').all('pending', limit);
            return rows;
        }
        try {
            const store = fs.existsSync(QUEUE_FILE) ? JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) : { jobs: [] };
            return (store.jobs || []).filter(j => j.status === 'pending').slice(0, limit);
        } catch (e) { return []; }
    },
    markInProgress: function (id) {
        if (usingSqlite && db) { db.prepare('UPDATE jobs SET status=?,updatedAt=? WHERE id=?').run('inprogress', now(), id); return; }
        try {
            const store = fs.existsSync(QUEUE_FILE) ? JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) : { jobs: [] };
            const idx = (store.jobs || []).findIndex(j => j.id === id);
            if (idx !== -1) { store.jobs[idx].status = 'inprogress'; store.jobs[idx].updatedAt = now(); fs.writeFileSync(QUEUE_FILE, JSON.stringify(store, null, 2), 'utf8'); }
        } catch (e) { }
    },
    markDone: function (id) {
        if (usingSqlite && db) { db.prepare('UPDATE jobs SET status=?,updatedAt=? WHERE id=?').run('done', now(), id); return; }
        try {
            const store = fs.existsSync(QUEUE_FILE) ? JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) : { jobs: [] };
            const idx = (store.jobs || []).findIndex(j => j.id === id);
            if (idx !== -1) { store.jobs[idx].status = 'done'; store.jobs[idx].updatedAt = now(); fs.writeFileSync(QUEUE_FILE, JSON.stringify(store, null, 2), 'utf8'); }
        } catch (e) { }
    },
    markFailed: function (id, err) {
        if (usingSqlite && db) { db.prepare('UPDATE jobs SET status=?,attempts=attempts+1,lastError=?,updatedAt=? WHERE id=?').run('failed', String(err).slice(0, 1000), now(), id); return; }
        try {
            const store = fs.existsSync(QUEUE_FILE) ? JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) : { jobs: [] };
            const idx = (store.jobs || []).findIndex(j => j.id === id);
            if (idx !== -1) { store.jobs[idx].status = 'failed'; store.jobs[idx].attempts = (store.jobs[idx].attempts || 0) + 1; store.jobs[idx].lastError = String(err).slice(0, 1000); store.jobs[idx].updatedAt = now(); fs.writeFileSync(QUEUE_FILE, JSON.stringify(store, null, 2), 'utf8'); }
        } catch (e) { }
    }
};
