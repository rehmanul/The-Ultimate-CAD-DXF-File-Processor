const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const emitter = new EventEmitter();

const DEFAULT_DB_DIR = path.join(__dirname, '..');

let usingSqlite = false;
let usingBetter = false;
let db = null; // either better-sqlite3 Database or sql.js Database
let SQL = null; // sql.js namespace
let dbFile = null;

function isBetterAvailable() {
    try {
        require.resolve('better-sqlite3');
        return true;
    } catch (e) {
        return false;
    }
}

async function init(options = {}) {
    dbFile = options.dbFile || path.join(DEFAULT_DB_DIR, options.fileName || 'fallback.db');

    if (isBetterAvailable()) {
        try {
            const Database = require('better-sqlite3');
            db = new Database(dbFile);
            db.pragma('journal_mode = WAL');
            usingBetter = true;
            usingSqlite = true;
            emitter.emit('ready');
            return { usingSqlite, usingBetter };
        } catch (e) {
            // fall through to sql.js
            console.warn('better-sqlite3 require succeeded but construction failed; falling back to sql.js:', e.message);
        }
    }

    // Fallback: use sql.js (WASM)
    try {
        const initSqlJs = require('sql.js');
        SQL = await initSqlJs();
        if (fs.existsSync(dbFile)) {
            const bytes = fs.readFileSync(dbFile);
            db = new SQL.Database(new Uint8Array(bytes));
        } else {
            db = new SQL.Database();
        }
        usingSqlite = true;
        usingBetter = false;
        emitter.emit('ready');
        return { usingSqlite, usingBetter };
    } catch (e) {
        console.warn('sql.js fallback failed to initialize:', e && e.message);
        usingSqlite = false;
        db = null;
        emitter.emit('ready');
        return { usingSqlite, usingBetter };
    }
}

function ensureInitCalled() {
    // noop - init should be called by server; nothing to do here
}

function _saveSqlJsFile() {
    if (!SQL || !db || usingBetter) return;
    try {
        const u8 = db.export();
        fs.writeFileSync(dbFile, Buffer.from(u8));
    } catch (e) {
        console.warn('Failed to persist sql.js DB file:', e.message);
    }
}

function run(sql, params = []) {
    if (!usingSqlite || !db) throw new Error('sqlite not available');
    if (usingBetter) {
        const stmt = db.prepare(sql);
        return stmt.run(...(Array.isArray(params) ? params : [params]));
    }
    // sql.js: emulate run -> run without returning rows
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const res = stmt.step();
    stmt.free();
    _saveSqlJsFile();
    return res;
}

function get(sql, params = []) {
    if (!usingSqlite || !db) throw new Error('sqlite not available');
    if (usingBetter) {
        const row = db.prepare(sql).get(...(Array.isArray(params) ? params : [params]));
        return row;
    }
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const has = stmt.step();
    const row = has ? stmt.getAsObject() : null;
    stmt.free();
    return row;
}

function all(sql, params = []) {
    if (!usingSqlite || !db) throw new Error('sqlite not available');
    if (usingBetter) {
        const rows = db.prepare(sql).all(...(Array.isArray(params) ? params : [params]));
        return rows;
    }
    const stmt = db.prepare(sql);
    const out = [];
    stmt.bind(params);
    while (stmt.step()) {
        out.push(stmt.getAsObject());
    }
    stmt.free();
    return out;
}

function exec(sql) {
    if (!usingSqlite || !db) throw new Error('sqlite not available');
    if (usingBetter) {
        return db.exec(sql);
    }
    const res = db.exec(sql);
    _saveSqlJsFile();
    return res;
}

module.exports = {
    emitter,
    init,
    ensureInitCalled,
    usingSqlite: () => usingSqlite,
    usingBetter: () => usingBetter,
    run,
    get,
    all,
    exec,
    dbFilePath: () => dbFile
};
