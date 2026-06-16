/**
 * db/database.js — SQLite via sql.js (Pure JS, no native build)
 */

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '..', 'data', 'navara.sqlite');
let db = null;

async function initDB() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Tabel utama laporan (lat_end/lng_end opsional = rute kejadian)
  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id          TEXT PRIMARY KEY,
      latitude    REAL NOT NULL,
      longitude   REAL NOT NULL,
      lat_end     REAL,
      lng_end     REAL,
      category    TEXT NOT NULL,
      description TEXT NOT NULL,
      waktu       TEXT NOT NULL,
      kota        TEXT NOT NULL,
      upvotes     INTEGER DEFAULT 0,
      downvotes   INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now','localtime')),
      ip_hash     TEXT NOT NULL,
      is_active   INTEGER DEFAULT 1,
      status      TEXT DEFAULT 'bahaya'
    )
  `);

  // Migrasi jika kolom lat_end/lng_end/status belum ada (upgrade dari versi lama)
  try { db.run(`ALTER TABLE reports ADD COLUMN lat_end REAL`); } catch { /* kolom sudah ada */ }
  try { db.run(`ALTER TABLE reports ADD COLUMN lng_end REAL`); } catch { /* kolom sudah ada */ }
  try { db.run(`ALTER TABLE reports ADD COLUMN status TEXT DEFAULT 'bahaya'`); } catch { /* kolom sudah ada */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS votes (
      report_id  TEXT NOT NULL,
      ip_hash    TEXT NOT NULL,
      vote_type  TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (report_id, ip_hash)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id            TEXT PRIMARY KEY,
      report_id     TEXT NOT NULL,
      comment       TEXT NOT NULL,
      status_update TEXT,
      created_at    TEXT DEFAULT (datetime('now','localtime')),
      ip_hash       TEXT NOT NULL
    )
  `);

  // Index untuk query yang sering
  db.run(`CREATE INDEX IF NOT EXISTS idx_reports_active ON reports(is_active, created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category, is_active)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reports_waktu ON reports(waktu, is_active)`);

  saveDB();
  console.log('✅ Database SQLite siap digunakan di:', DB_PATH);
  return db;
}

function saveDB() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('❌ Gagal menyimpan DB:', e.message);
  }
}

function getDB() {
  if (!db) throw new Error('Database belum diinisialisasi');
  return db;
}

function startAutoCleanup() {
  setInterval(() => {
    try {
      const dbInstance = getDB();
      dbInstance.run(`UPDATE reports SET is_active = 0 WHERE downvotes > 10 AND is_active = 1`);
      dbInstance.run(`DELETE FROM reports WHERE datetime(created_at) < datetime('now', '-30 days')`);
      saveDB();
      console.log('🧹 Auto cleanup selesai');
    } catch (e) { /* silent */ }
  }, 6 * 60 * 60 * 1000);
}

module.exports = { initDB, getDB, saveDB, startAutoCleanup };
