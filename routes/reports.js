/**
 * routes/reports.js — API: GET, POST, VOTE, STATS, SSE Stream
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDB, saveDB } = require('../db/database');
const {
  reportLimiter, voteLimiter, commentLimiter, sanitizeBody,
  validateReport, validateVote, validateComment, validateGetReports,
  handleValidationErrors, detectSQLInjection, hashIP, adminAuth,
  adminLimiter, verifyCaptcha
} = require('../middleware/security');

// ─── SSE Clients ──────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastSSE(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead = [];
  for (const client of sseClients) {
    try { client.write(payload); }
    catch { dead.push(client); }
  }
  dead.forEach(c => sseClients.delete(c));
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────
function dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbRun(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
}

// ─── GET /stream — SSE Real-time Feed ────────────────────────────────────────
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Kirim event koneksi awal
  res.write(`event: connected\ndata: {"ts":${Date.now()},"clients":${sseClients.size + 1}}\n\n`);

  sseClients.add(res);

  // Ping keepalive setiap 20 detik
  const ping = setInterval(() => {
    try { res.write(`:ping ${Date.now()}\n\n`); }
    catch { clearInterval(ping); sseClients.delete(res); }
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// ─── GET /stats — Statistik global ───────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    const db = getDB();
    const total = dbAll(db, `SELECT COUNT(*) as count FROM reports WHERE is_active = 1`);
    const byCategory = dbAll(db, `SELECT category, COUNT(*) as count FROM reports WHERE is_active=1 GROUP BY category ORDER BY count DESC`);
    const byKota = dbAll(db, `SELECT kota, COUNT(*) as count FROM reports WHERE is_active=1 GROUP BY kota ORDER BY count DESC LIMIT 10`);
    const today = dbAll(db, `SELECT COUNT(*) as count FROM reports WHERE is_active=1 AND date(created_at)=date('now','localtime')`);
    const thisWeek = dbAll(db, `SELECT COUNT(*) as count FROM reports WHERE is_active=1 AND datetime(created_at)>datetime('now','-7 days')`);
    const thisMonth = dbAll(db, `SELECT COUNT(*) as count FROM reports WHERE is_active=1 AND datetime(created_at)>datetime('now','-30 days')`);
    const byWaktu = dbAll(db, `SELECT waktu, COUNT(*) as count FROM reports WHERE is_active=1 GROUP BY waktu ORDER BY count DESC`);

    return res.json({
      success: true,
      data: {
        total: total[0].count,
        today: today[0].count,
        thisWeek: thisWeek[0].count,
        thisMonth: thisMonth[0].count,
        activeClients: sseClients.size,
        byCategory, byWaktu,
        topKota: byKota
      }
    });
  } catch (err) {
    console.error('GET /stats error:', err.message);
    return res.status(500).json({ success: false, message: 'Gagal mengambil statistik' });
  }
});

// ─── GET / — Ambil laporan (dengan filter) ────────────────────────────────────
router.get('/', validateGetReports, handleValidationErrors, (req, res) => {
  try {
    const db = getDB();
    const { category = 'all', waktu = 'all', date_filter = 'all', lat, lng, radius } = req.query;
    
    // Clamp limit to prevent excessive DB load (max 500)
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit <= 0) limit = 500;
    if (limit > 500) limit = 500;

    let sql = `
      SELECT id, latitude, longitude, lat_end, lng_end,
             category, description, waktu, kota,
             upvotes, downvotes, created_at, status
      FROM reports
      WHERE is_active = 1
    `;
    const params = [];

    if (category && category !== 'all') {
      sql += ` AND category = ?`;
      params.push(category);
    }

    if (waktu && waktu !== 'all') {
      sql += ` AND waktu = ?`;
      params.push(waktu);
    }

    // Filter tanggal
    if (date_filter === 'today') {
      sql += ` AND date(created_at) = date('now','localtime')`;
    } else if (date_filter === 'week') {
      sql += ` AND datetime(created_at) > datetime('now','-7 days')`;
    } else if (date_filter === 'month') {
      sql += ` AND datetime(created_at) > datetime('now','-30 days')`;
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(Number(limit));

    let rows = dbAll(db, sql, params);

    // Filter radius Haversine jika lat/lng/radius diberikan
    if (lat && lng && radius) {
      const R = 6371;
      const toRad = x => (x * Math.PI) / 180;
      const uLat = Number(lat), uLng = Number(lng), r = Number(radius);
      rows = rows.filter(row => {
        const dL = toRad(row.latitude - uLat);
        const dG = toRad(row.longitude - uLng);
        const a = Math.sin(dL / 2) ** 2 + Math.cos(toRad(uLat)) * Math.cos(toRad(row.latitude)) * Math.sin(dG / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= r;
      });
    }

    return res.json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    console.error('GET /reports error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST / — Buat laporan baru ───────────────────────────────────────────────
router.post('/',
  verifyCaptcha, reportLimiter, sanitizeBody, detectSQLInjection,
  validateReport, handleValidationErrors,
  (req, res) => {
    try {
      const db = getDB();
      const { latitude, longitude, lat_end, lng_end, category, description, waktu, kota } = req.body;
      const ip = req.ip || req.socket.remoteAddress || '';
      const ipHash = hashIP(ip);
      const id = crypto.randomUUID();

      // Anti-duplikat: koordinat sama, IP sama, dalam 10 menit
      const dup = dbAll(db, `
        SELECT id FROM reports
        WHERE ip_hash=? AND ABS(latitude-?)< 0.001 AND ABS(longitude-?)<0.001
          AND datetime(created_at)>datetime('now','-10 minutes') AND is_active=1
        LIMIT 1
      `, [ipHash, Number(latitude), Number(longitude)]);

      if (dup.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Laporan serupa dari lokasi ini sudah dikirim dalam 10 menit terakhir.',
          code: 'DUPLICATE_REPORT'
        });
      }

      // Simpan — lat_end/lng_end opsional (rute)
      const latEnd = lat_end ? Number(lat_end) : null;
      const lngEnd = lng_end ? Number(lng_end) : null;

      dbRun(db, `
        INSERT INTO reports (id, latitude, longitude, lat_end, lng_end, category, description, waktu, kota, ip_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, Number(latitude), Number(longitude), latEnd, lngEnd, category, description, waktu, kota, ipHash]);

      saveDB();

      const newReport = dbAll(db, `
        SELECT id, latitude, longitude, lat_end, lng_end,
               category, description, waktu, kota,
               upvotes, downvotes, created_at
        FROM reports WHERE id = ?
      `, [id]);

      // Broadcast SSE ke semua klien yang terkoneksi
      broadcastSSE('new-report', newReport[0]);

      return res.status(201).json({
        success: true,
        message: 'Laporan berhasil dikirim! Terima kasih telah membantu sesama pengendara.',
        data: newReport[0]
      });
    } catch (err) {
      console.error('POST /reports error:', err.message);
      return res.status(500).json({ success: false, message: 'Gagal menyimpan laporan' });
    }
  }
);

// ─── POST /:id/vote ───────────────────────────────────────────────────────────
router.post('/:id/vote',
  voteLimiter, detectSQLInjection,
  validateVote, handleValidationErrors,
  (req, res) => {
    try {
      const db = getDB();
      const { id } = req.params;
      const { vote } = req.body;
      const ipHash = hashIP(req.ip || req.socket.remoteAddress || '');

      const reports = dbAll(db, `SELECT id, upvotes, downvotes FROM reports WHERE id=? AND is_active=1`, [id]);
      if (reports.length === 0) return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan' });

      const existing = dbAll(db, `SELECT vote_type FROM votes WHERE report_id=? AND ip_hash=?`, [id, ipHash]);
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'Anda sudah memberikan vote.', code: 'ALREADY_VOTED' });
      }

      dbRun(db, `INSERT INTO votes (report_id, ip_hash, vote_type) VALUES (?,?,?)`, [id, ipHash, vote]);
      if (vote === 'up') {
        dbRun(db, `UPDATE reports SET upvotes=upvotes+1 WHERE id=?`, [id]);
      } else {
        dbRun(db, `UPDATE reports SET downvotes=downvotes+1 WHERE id=?`, [id]);
        dbRun(db, `UPDATE reports SET is_active=0 WHERE id=? AND downvotes>10`, [id]);
      }

      saveDB();

      const updated = dbAll(db, `SELECT upvotes, downvotes FROM reports WHERE id=?`, [id]);

      // Broadcast vote update
      broadcastSSE('vote-update', { reportId: id, ...updated[0] });

      return res.json({ success: true, message: vote === 'up' ? 'Vote positif diterima!' : 'Vote negatif diterima.', data: updated[0] });
    } catch (err) {
      console.error('POST /vote error:', err.message);
      return res.status(500).json({ success: false, message: 'Gagal memproses vote' });
    }
  }
);

// ─── GET /:id/comments ────────────────────────────────────────────────────────
router.get('/:id/comments', (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const comments = dbAll(db, `SELECT id, comment, status_update, created_at FROM comments WHERE report_id = ? ORDER BY created_at ASC`, [id]);
    return res.json({ success: true, data: comments });
  } catch (err) {
    console.error('GET /comments error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /:id/comments ───────────────────────────────────────────────────────
router.post('/:id/comments',
  commentLimiter, sanitizeBody, detectSQLInjection,
  validateComment, handleValidationErrors,
  (req, res) => {
    try {
      const db = getDB();
      const { id } = req.params;
      let { comment, status_update } = req.body;
      const ipHash = hashIP(req.ip || req.socket.remoteAddress || '');
      const commentId = crypto.randomUUID();

      const reports = dbAll(db, `SELECT id FROM reports WHERE id=? AND is_active=1`, [id]);
      if (reports.length === 0) return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan' });

      // Jika komentar kosong tapi ada status update, otomatis isi komentar
      if (!comment && status_update) {
        let statusText = 'Aman';
        if (status_update === 'bahaya') statusText = 'Bahaya';
        else if (status_update === 'default') statusText = 'Direset (Default)';
        comment = `Status diperbarui menjadi ${statusText}`;
      }

      if (!comment && !status_update) {
        return res.status(400).json({ success: false, message: 'Komentar tidak boleh kosong' });
      }

      dbRun(db, `
        INSERT INTO comments (id, report_id, comment, status_update, ip_hash)
        VALUES (?, ?, ?, ?, ?)
      `, [commentId, id, comment || '', status_update || null, ipHash]);

      // Jika ada update status, update tabel reports
      if (status_update === 'aman') {
        dbRun(db, `UPDATE reports SET status = 'aman' WHERE id = ?`, [id]);
        broadcastSSE('status-update', { reportId: id, status: 'aman' });
      } else if (status_update === 'bahaya') {
        dbRun(db, `UPDATE reports SET status = 'bahaya' WHERE id = ?`, [id]);
        broadcastSSE('status-update', { reportId: id, status: 'bahaya' });
      } else if (status_update === 'default') {
        dbRun(db, `UPDATE reports SET status = 'default' WHERE id = ?`, [id]);
        broadcastSSE('status-update', { reportId: id, status: 'default' });
      }

      saveDB();

      const newComment = { id: commentId, report_id: id, comment: comment || '', status_update: status_update || null, created_at: new Date().toISOString() };

      // Broadcast komentar baru
      broadcastSSE('new-comment', newComment);

      return res.status(201).json({ success: true, message: 'Komentar berhasil ditambahkan', data: newComment });
    } catch (err) {
      console.error('POST /comments error:', err.message);
      return res.status(500).json({ success: false, message: 'Gagal memproses komentar' });
    }
  }
);

// ─── Hapus Laporan (Admin Only) ───────────────────────────────────────────────
router.delete('/:id',
  adminLimiter, adminAuth,
  (req, res) => {
    try {
      const db = getDB();
      const id = req.params.id;

      const report = dbAll(db, `SELECT id FROM reports WHERE id=? AND is_active=1`, [id]);
      if (report.length === 0) {
        return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan' });
      }

      // Soft delete: set is_active = 0
      dbRun(db, `UPDATE reports SET is_active = 0 WHERE id = ?`, [id]);
      saveDB();

      // Broadcast event penghapusan ke klien
      broadcastSSE('delete-report', { reportId: id });

      return res.json({ success: true, message: 'Laporan berhasil dihapus (soft delete)' });
    } catch (err) {
      console.error('DELETE /reports error:', err.message);
      return res.status(500).json({ success: false, message: 'Gagal menghapus laporan' });
    }
  }
);

// ─── POST /chat — Tanya AI Interaktif ─────────────────────────────────────────
router.post('/chat', commentLimiter, sanitizeBody, (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'Pesan tidak valid' });
    }
    
    const db = getDB();
    const reports = dbAll(db, `SELECT * FROM reports WHERE is_active=1 ORDER BY created_at DESC`);
    
    const msgLower = message.toLowerCase();
    let reply = "";

    // 1. Cek jika pesan mengandung sapaan
    if (/^(halo|hai|hi|pagi|siang|sore|malam|bot)/i.test(msgLower) && msgLower.length < 15) {
      return res.json({ success: true, reply: `Halo! 👋 Saya AI Navara. Anda bisa menanyakan keamanan suatu kota, misalnya: *"Apakah Jakarta Selatan aman?"* atau *"Cek kondisi di Bogor"*.` });
    }

    // 2. Gunakan Regex Global untuk mencari kecocokan Kota dari Database
    const cities = [...new Set(reports.map(r => r.kota.toLowerCase()))];
    
    // Cari kota yang cocok (meskipun user ngetik "jakarta", bakal match ke "Jakarta Selatan", "Jakarta Pusat" dll)
    let matchedCities = cities.filter(c => {
      // buat regex per kata dari kota di DB, misal "jakarta selatan"
      // kalau user ngetik "jakarta", match.
      const words = c.split(' ');
      return words.some(w => msgLower.includes(w)) || msgLower.includes(c);
    });

    if (matchedCities.length > 0) {
      // Ambil kota yang paling relevan (kita ambil index 0)
      let mentionedCity = matchedCities[0];
      // Jika user ngetik "jakarta selatan" secara utuh, prioritaskan itu
      const exactMatch = matchedCities.find(c => msgLower.includes(c));
      if (exactMatch) mentionedCity = exactMatch;

      const cityReports = reports.filter(r => r.kota.toLowerCase() === mentionedCity);
      if (cityReports.length > 0) {
        reply = `Berdasarkan pantauan saya, di area **${mentionedCity.replace(/\b\w/g, l => l.toUpperCase())}** terdapat **${cityReports.length} laporan** kejahatan aktif. ⚠️ Laporan terbaru adalah kejadian **"${cityReports[0].category}"** pada waktu ${cityReports[0].waktu}. Harap waspada jika Anda harus melewati rute tersebut!`;
      } else {
        reply = `Kabar baik! Area **${mentionedCity.replace(/\b\w/g, l => l.toUpperCase())}** saat ini terpantau **aman** dari laporan kejahatan di sistem Navara. Namun ingat, tetap utamakan keselamatan dan jangan lengah.`;
      }
    } 
    // 3. Keyword "aman" / "bahaya" secara global
    else if (/aman|bahaya|rawan|kondisi|info/i.test(msgLower)) {
      if (reports.length > 0) {
        reply = `Saat ini sistem Navara mencatat total **${reports.length} titik rawan** di berbagai daerah. 📍 Lokasi kejadian paling baru ada di **${reports[0].kota}** (Kasus: ${reports[0].category}). Saya sarankan Anda menggunakan fitur **Rute Aman** (ikon rute di kiri bawah peta) untuk mencari jalan yang terhindar dari zona merah ini.`;
      } else {
        reply = "Mantap! 🛡️ Saat ini database Navara bersih dari laporan kejahatan. Jalanan terpantau aman terkendali.";
      }
    } 
    // 4. Default Fallback
    else {
      reply = `Hmm, saya kurang memahami spesifik pertanyaannya. Tapi sebagai info, ada **${reports.length} laporan** aktif saat ini. Anda bisa langsung sebutkan nama daerah yang ingin Anda ketahui statusnya! (Contoh: "Apakah area Bogor aman?")`;
    }

    // Simulasi delay ketikan AI
    setTimeout(() => {
      return res.json({ success: true, reply });
    }, 800);

  } catch (err) {
    console.error('POST /chat error:', err.message);
    return res.status(500).json({ success: false, message: 'Gagal memproses AI' });
  }
});

module.exports = router;
