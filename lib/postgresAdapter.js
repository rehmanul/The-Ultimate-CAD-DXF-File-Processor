
let Client = null;
try {
    Client = require('pg').Client;
} catch (e) {
    // pg not installed; will gracefully fall back to non-postgres behavior
    Client = null;
}

let client = null;
let connected = false;

async function init(options = {}) {
    const conn = process.env.DATABASE_URL || options.connectionString || options.databaseUrl;
    if (!conn) return { usingPostgres: false };
    if (!Client) {
        console.warn('pg driver not installed; Postgres adapter disabled');
        return { usingPostgres: false };
    }
    client = new Client({ connectionString: conn });
    try {
        await client.connect();
        connected = true;
        return { usingPostgres: true };
    } catch (e) {
        console.warn('Postgres adapter failed to connect:', e.message);
        client = null;
        connected = false;
        return { usingPostgres: false };
    }
}

function ensureConnected() {
    if (!connected || !client) throw new Error('Postgres client not connected');
}

function run(sql, params = []) {
    ensureConnected();
    return client.query(sql, params);
}

async function get(sql, params = []) {
    ensureConnected();
    const res = await client.query(sql, params);
    return res.rows && res.rows[0] ? res.rows[0] : null;
}

async function all(sql, params = []) {
    ensureConnected();
    const res = await client.query(sql, params);
    return res.rows || [];
}

async function exec(sql) {
    ensureConnected();
    // exec many statements; run inside a transaction
    try {
        await client.query('BEGIN');
        const stmts = sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
        for (const s of stmts) await client.query(s);
        await client.query('COMMIT');
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (e2) { /* ignore */ }
        throw e;
    }
}

function usingPostgres() {
    return !!connected;
}

function close() {
    if (client) {
        try { client.end(); } catch (e) { /* ignore */ }
        client = null; connected = false;
    }
}

module.exports = { init, run, get, all, exec, usingPostgres, close };
