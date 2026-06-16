/**
 * server.js — Entry point Begal Alert API
 * Node.js + Express + SQLite (sql.js) + Helmet + Rate Limiting
 */

'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
const path = require('path');

const { initDB, startAutoCleanup } = require('./db/database');
const { globalLimiter, helmetConfig, preventLFI, strictOriginCheck, preventHPP, parseCookies, csrfProtection } = require('./middleware/security');
const reportsRouter = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 8080;

// ─── Trust proxy (untuk rate limit di balik nginx/reverse proxy) ──────────────
app.set('trust proxy', 1);

// ─── Security Headers via Helmet ──────────────────────────────────────────────
app.use(helmet(helmetConfig));

// ─── CORS — hanya izinkan same-origin (deploy lokal) ─────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || `http://localhost:${PORT}`,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: false
}));

// ─── Body Parser ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));       // Batasi body size max 10KB
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ─── Logger ───────────────────────────────────────────────────────────────────
app.use(morgan('[:date[clf]] :method :url :status :response-time ms - :res[content-length]'));

// ─── Security Middleware Tambahan ─────────────────────────────────────────────
app.use(preventLFI);
app.use(strictOriginCheck);
app.use(preventHPP); // Mencegah HTTP Parameter Pollution
app.use(parseCookies); // Parse cookies untuk CSRF
app.use(csrfProtection); // Perlindungan CSRF Double Submit Cookie

// ─── CSRF Token Endpoint ──────────────────────────────────────────────────────
app.get('/api/csrf-token', (req, res) => {
  // Generate random token
  const token = crypto.randomBytes(32).toString('hex');
  // Set cookie dengan atribut keamanan
  res.cookie('_csrf', token, {
    httpOnly: false, // Harus false agar bisa dibaca JS frontend untuk dikirim balik via Header
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });
  res.json({ success: true, token });
});

// ─── Rate Limiter Global ──────────────────────────────────────────────────────
app.use(globalLimiter);

// ─── Static Frontend ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '1h',
  index: 'index.html'
}));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/reports', reportsRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'begal-alert' });
});

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan' });
  }
  // SPA fallback — serve index.html untuk semua path non-API
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err.message);
  res.status(500).json({
    success: false,
    message: 'Terjadi kesalahan server. Silakan coba lagi.'
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDB();
    startAutoCleanup();

    app.listen(PORT, () => {
      const banner = `
\x1b[36m _   _    _     __     __    _    ____      _    
| \\ | |  / \\    \\ \\   / /   / \\  |  _ \\    / \\   
|  \\| | / _ \\    \\ \\ / /   / _ \\ | |_) |  / _ \\  
| |\\  |/ ___ \\    \\ V /   / ___ \\|  _ <  / ___ \\ 
|_| \\_/_/   \\_\\    \\_/   /_/   \\_\\_| \\_\\/_/   \\_\\\x1b[0m

   \x1b[32m🛡️  NAVIGASI AMAN BERKENDARA 🛡️\x1b[0m
=========================================
      `;
      console.log(banner);
      console.log(`✅ Server berjalan di: \x1b[33mhttp://localhost:${PORT}\x1b[0m`);
      console.log(`🔒 Security Level: \x1b[32mEnterprise Grade\x1b[0m`);
      console.log(`🗄️ Database: \x1b[36mSQLite\x1b[0m`);
      console.log(`📡 API: \x1b[33mhttp://localhost:${PORT}/api/reports\x1b[0m`);
      console.log('=========================================\n');
    });
  } catch (err) {
    console.error('❌ Gagal menjalankan server:', err.message);
    process.exit(1);
  }
}

start();
