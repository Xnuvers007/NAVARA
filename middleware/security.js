/**
 * middleware/security.js
 * Semua middleware keamanan: Rate limiting, sanitasi input, CSP, anti-spam
 */

const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const xss = require('xss');
const crypto = require('crypto');

// ─── Helper: Hash IP untuk privasi user ──────────────────────────────────────
function hashIP(ip) {
  const salt = process.env.IP_SALT || 'begal-alert-salt-2024-x9z';
  return crypto.createHash('sha256').update(ip + salt).digest('hex').slice(0, 16);
}

// ─── Rate Limiter: Global semua endpoint ─────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Terlalu banyak permintaan. Coba lagi dalam 15 menit.',
    code: 'RATE_LIMIT_GLOBAL'
  },
  skip: (req) => req.path === '/health'
});

// ─── Rate Limiter: Laporan baru (ketat banget) ───────────────────────────────
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 jam
  max: 5,                    // max 5 laporan per IP per jam
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip || req.socket.remoteAddress || ''),
  message: {
    success: false,
    message: 'Batas laporan tercapai. Maksimal 5 laporan per jam.',
    code: 'RATE_LIMIT_REPORT'
  }
});

// ─── Rate Limiter: Vote ───────────────────────────────────────────────────────
const voteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 menit
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => hashIP(req.ip || req.socket.remoteAddress || ''),
  message: {
    success: false,
    message: 'Terlalu banyak vote. Coba lagi nanti.',
    code: 'RATE_LIMIT_VOTE'
  }
});

// ─── Rate limiter untuk komentar ─────────────────────────────────────────────
const commentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  max: 10, // Maksimal 10 komentar per IP per 5 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak komentar dari IP ini. Harap tunggu sebentar.' }
});

// ─── XSS Sanitizer ───────────────────────────────────────────────────────────
const xssOptions = {
  whiteList: {},           // Tidak ada tag HTML yang diizinkan
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed']
};

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return xss(str.trim(), xssOptions);
}

// ─── Middleware: Sanitasi semua body string & cegah Prototype Pollution ───────
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    // Cegah Prototype Pollution
    const forbiddenKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key of Object.keys(req.body)) {
      if (forbiddenKeys.includes(key)) {
        delete req.body[key];
        continue;
      }
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    }
  }
  next();
}

// ─── Kategori & Kota Valid ────────────────────────────────────────────────────
const VALID_CATEGORIES = [
  'begal', 'copet', 'rampok', 'jambret',
  'pencurian_kendaraan', 'pemerasan', 'tawuran', 'lainnya'
];

const VALID_CITIES = [
  'Jakarta Pusat', 'Jakarta Utara', 'Jakarta Barat', 'Jakarta Selatan',
  'Jakarta Timur', 'Bogor', 'Depok', 'Tangerang', 'Bekasi',
  'Bandung', 'Surabaya', 'Medan', 'Makassar', 'Semarang',
  'Palembang', 'Batam', 'Pekanbaru', 'Bandar Lampung', 'Malang',
  'Yogyakarta', 'Solo', 'Denpasar', 'Balikpapan', 'Samarinda',
  'Pontianak', 'Banjarmasin', 'Manado', 'Kupang', 'Ambon', 'Lainnya'
];

const VALID_WAKTU = ['pagi', 'siang', 'sore', 'malam', 'dini_hari'];

// ─── Validasi Laporan Baru ────────────────────────────────────────────────────
const validateReport = [
  body('latitude')
    .notEmpty().withMessage('Latitude wajib diisi')
    .isNumeric().withMessage('Latitude harus berupa angka')
    .toFloat()
    .isFloat({ min: -11.5, max: 6.5 })
    .withMessage('Koordinat latitude tidak valid untuk wilayah Indonesia'),

  body('longitude')
    .notEmpty().withMessage('Longitude wajib diisi')
    .isNumeric().withMessage('Longitude harus berupa angka')
    .toFloat()
    .isFloat({ min: 94.0, max: 141.5 })
    .withMessage('Koordinat longitude tidak valid untuk wilayah Indonesia'),

  // Opsional: titik akhir rute kejadian
  body('lat_end')
    .optional({ nullable: true, checkFalsy: true })
    .toFloat()
    .isFloat({ min: -11.5, max: 6.5 })
    .withMessage('Koordinat lat_end tidak valid'),

  body('lng_end')
    .optional({ nullable: true, checkFalsy: true })
    .toFloat()
    .isFloat({ min: 94.0, max: 141.5 })
    .withMessage('Koordinat lng_end tidak valid'),

  body('category')
    .trim()
    .isIn(VALID_CATEGORIES)
    .withMessage('Kategori kejadian tidak valid'),

  body('description')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Deskripsi harus antara 10-500 karakter')
    .not().matches(/<[^>]*>/)
    .withMessage('Deskripsi tidak boleh mengandung HTML'),

  body('waktu')
    .trim()
    .isIn(VALID_WAKTU)
    .withMessage('Waktu kejadian tidak valid'),

  body('kota')
    .trim()
    .isIn(VALID_CITIES)
    .withMessage('Kota tidak valid. Pilih dari daftar yang tersedia'),
];

// ─── Validasi Vote ────────────────────────────────────────────────────────────
const validateVote = [
  param('id')
    .trim()
    .matches(/^[0-9a-f-]{36}$/)
    .withMessage('ID laporan tidak valid'),

  body('vote')
    .trim()
    .isIn(['up', 'down'])
    .withMessage('Tipe vote tidak valid'),
];

// ─── Validasi Komentar ────────────────────────────────────────────────────────
const validateComment = [
  param('id')
    .isUUID(4)
    .withMessage('Format ID laporan tidak valid'),

  body('comment')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 300 })
    .withMessage('Komentar maksimal 300 karakter')
    .not().matches(/<[^>]*>/)
    .withMessage('Komentar tidak boleh mengandung HTML'),

  body('status_update')
    .optional({ checkFalsy: true })
    .trim()
    .isIn(['aman', 'bahaya', 'default'])
    .withMessage('Status update tidak valid')
];

// ─── Validasi Query GET laporan ───────────────────────────────────────────────
const VALID_DATE_FILTERS = ['today', 'week', 'month', 'all'];

const validateGetReports = [
  query('lat').optional().toFloat().isFloat({ min: -11.5, max: 6.5 }),
  query('lng').optional().toFloat().isFloat({ min: 94.0, max: 141.5 }),
  query('radius').optional().toFloat().isFloat({ min: 0.1, max: 100 }),
  query('category').optional().trim().isIn([...VALID_CATEGORIES, 'all']),
  query('waktu').optional().trim().isIn([...VALID_WAKTU, 'all']),
  query('date_filter').optional().trim().isIn(VALID_DATE_FILTERS),
  query('limit').optional().toInt().isInt({ min: 1, max: 500 }),
];

// ─── Handler error validasi ───────────────────────────────────────────────────
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Data tidak valid',
      errors: errors.array().map(e => ({
        field: e.path,
        message: e.msg
      }))
    });
  }
  next();
}

// ─── Anti SQL Injection pattern check ────────────────────────────────────────
function detectSQLInjection(req, res, next) {
  const suspiciousPatterns = [
    /(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bUNION\b|\bEXEC\b|\bTRUNCATE\b)/i,
    /(--|;--|\/\*|\*\/|xp_|0x[0-9a-fA-F]+)/i,
    /(\bOR\b\s+[\d'"]+=[\d'"]+|\bAND\b\s+[\d'"]+=[\d'"]+)/i,
    /char\s*\(\s*\d+/i,
    /WAITFOR\s+DELAY/i
  ];

  const checkValue = (val) => {
    if (typeof val !== 'string') return false;
    return suspiciousPatterns.some(p => p.test(val));
  };

  const allValues = [
    ...Object.values(req.body || {}),
    ...Object.values(req.query || {}),
    ...Object.values(req.params || {})
  ];

  if (allValues.some(checkValue)) {
    return res.status(400).json({
      success: false,
      message: 'Request ditolak: terdeteksi karakter mencurigakan.',
      code: 'INJECTION_DETECTED'
    });
  }

  next();
}

// ─── LFI & Path Traversal Prevention ──────────────────────────────────────────
function preventLFI(req, res, next) {
  const pathAndQuery = req.originalUrl;
  // Deteksi pola ../, %2e%2e%2f, Null Byte %00, dsb
  const lfiPattern = /(?:\.\.(\/|\\))|(?:\%2e\%2e(?:\%2f|\%5c))|(?:\%00)/i;
  
  if (lfiPattern.test(pathAndQuery)) {
    return res.status(400).json({
      success: false,
      message: 'Request ditolak: LFI / Path Traversal terdeteksi.',
      code: 'LFI_DETECTED'
    });
  }
  next();
}

// ─── CSRF Token Middleware (Double Submit Cookie) ─────────────────────────────

// Middleware parsing cookie secara mandiri
function parseCookies(req, res, next) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  req.cookies = list;
  next();
}

function csrfProtection(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const headerToken = req.headers['x-csrf-token'];
    const cookieToken = req.cookies['_csrf'];

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      return res.status(403).json({ success: false, message: 'Forbidden: Invalid or missing CSRF Token.' });
    }
  }
  next();
}

// ─── Strict Origin/Referer Check (CSRF Mitigation) ────────────────────────────
function strictOriginCheck(req, res, next) {
  // Hanya berlaku untuk metode POST, PUT, DELETE, PATCH
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const allowedOrigin = process.env.ALLOWED_ORIGIN || `http://localhost:${process.env.PORT || 8080}`;

    // Memastikan Origin atau Referer valid (sama dengan allowedOrigin)
    // Jika origin tidak ada, kita bisa menggunakan referer
    if (origin && !origin.startsWith(allowedOrigin)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Invalid Origin' });
    }
    if (!origin && referer && !referer.startsWith(allowedOrigin)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Invalid Referer' });
    }
  }
  next();
}

// ─── HTTP Parameter Pollution (HPP) Prevention ────────────────────────────────
function preventHPP(req, res, next) {
  // Jika parameter dikirim ganda, ambil yang terakhir
  ['query', 'body'].forEach(key => {
    if (req[key]) {
      for (let param in req[key]) {
        if (Array.isArray(req[key][param])) {
          req[key][param] = req[key][param].pop();
        }
      }
    }
  });
  next();
}

// ─── Helmet CSP config ────────────────────────────────────────────────────────
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://unpkg.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://cdn.redoc.ly",
        "'unsafe-inline'"
      ],
      styleSrc: [
        "'self'",
        "https://unpkg.com",
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "'unsafe-inline'"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https://*.tile.openstreetmap.org",
        "https://unpkg.com",
        "https://cdnjs.cloudflare.com"
      ],
      // Allow source maps & SSE from CDNs + self
      connectSrc: [
        "'self'",
        "https://unpkg.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://cdn.redoc.ly",
        "https://fonts.googleapis.com"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      workerSrc: ["'self'", "blob:"],
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true
  }
};

// ─── Admin Auth Middleware ────────────────────────────────────────────────────
const adminAuth = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  const secret = process.env.ADMIN_SECRET || 'admin123';
  if (!adminKey || adminKey !== secret) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid Admin Password' });
  }
  next();
};

module.exports = {
  globalLimiter,
  reportLimiter,
  voteLimiter,
  commentLimiter,
  sanitizeBody,
  sanitizeString,
  validateReport,
  validateVote,
  validateComment,
  validateGetReports,
  handleValidationErrors,
  detectSQLInjection,
  preventLFI,
  strictOriginCheck,
  preventHPP,
  parseCookies,
  csrfProtection,
  helmetConfig,
  hashIP,
  adminAuth,
  VALID_CATEGORIES,
  VALID_CITIES,
  VALID_WAKTU
};
