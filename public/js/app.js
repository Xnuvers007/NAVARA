/**
 * public/js/app.js — Begal Alert Frontend v3.0
 * Author: Xnuvers007 | saweria.co/Xnuvers007
 * Features: SSE real-time, Font Awesome markers, route/polyline,
 *           time+date filters, tips modal on open, accessibility/a11y,
 *           TalkBack-friendly, expandable stats panel, responsive
 */

'use strict';

/* ─── LocalStorage safe wrapper (Edge Tracking Prevention fix) ─────────────── */
const LS = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
  }
};

/* ─── Category config ─────────────────────────────────────────────────────── */
const CAT = {
  begal:               { color: '#ef4444', icon: 'fa-skull-crossbones', label: 'Begal' },
  copet:               { color: '#f97316', icon: 'fa-hand-holding',    label: 'Copet' },
  rampok:              { color: '#eab308', icon: 'fa-sack-dollar',     label: 'Rampok' },
  jambret:             { color: '#a855f7', icon: 'fa-person-running',  label: 'Jambret' },
  pencurian_kendaraan: { color: '#06b6d4', icon: 'fa-car-burst',       label: 'Curanmor' },
  pemerasan:           { color: '#84cc16', icon: 'fa-hand-fist',       label: 'Pemerasan' },
  tawuran:             { color: '#ec4899', icon: 'fa-burst',           label: 'Tawuran' },
  lainnya:             { color: '#94a3b8', icon: 'fa-circle-question', label: 'Lainnya' }
};

const WAKTU_LABELS = {
  dini_hari: { icon: 'fa-moon',              label: 'Dini Hari (00-05)' },
  pagi:      { icon: 'fa-sun',               label: 'Pagi (05-12)' },
  siang:     { icon: 'fa-cloud-sun',         label: 'Siang (12-16)' },
  sore:      { icon: 'fa-cloud-sun-rain',    label: 'Sore (16-19)' },
  malam:     { icon: 'fa-star-and-crescent', label: 'Malam (19-00)' }
};

const INDONESIA_CENTER = [-2.5, 117.8];
const INDONESIA_BOUNDS = L.latLngBounds(L.latLng(-11.5, 94.0), L.latLng(6.5, 141.5));

/* ─── State ───────────────────────────────────────────────────────────────── */
let map, clusterLayer, heatLayer, myLocMarker;
let allReports = [];
let routePolylines = [];
let activeMarkers = new Map();
let selectedCategory = 'all';
let selectedWaktu = 'all';
let selectedDate = 'all';
let mapMode = 'cluster';
let isSubmitting = false;
let locationMode = 'single';
let clickStep = 0;
let pendingLat = null, pendingLng = null;
let pendingLatEnd = null, pendingLngEnd = null;
let tempMarkers = [];
let tempLine = null;
let csrfToken = '';
let votedReports = new Set(LS.get('ba_voted', []));
let deferredInstallPrompt = null;
let sseConn = null;
let panelCollapsed = false;
let panelExpanded = false;

/* ─── CSRF Token ──────────────────────────────────────────────────────────── */
async function fetchCsrfToken() {
  try {
    const res = await fetch('/api/csrf-token');
    const data = await res.json();
    if (data.success && data.token) {
      csrfToken = data.token;
    }
  } catch (err) {
    console.error('Gagal mengambil CSRF token:', err);
  }
}

/* ─── INIT ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await fetchCsrfToken();
  initPWA();
  initMap();
  initSSE();
  initEventListeners();
  initTipsModal();
  loadReports();
  loadStats();
});

/* ─── ACCESSIBILITY: Screen Reader Announcement ───────────────────────────── */
function announceToSR(msg, urgent = false) {
  const el = document.getElementById(urgent ? 'sr-alert' : 'sr-announce');
  if (!el) return;
  el.textContent = '';
  // Small delay forces re-read by screen reader
  setTimeout(() => { el.textContent = msg; }, 50);
}

/* ─── FOCUS TRAP (modal accessibility) ───────────────────────────────────── */
function trapFocus(modalEl) {
  const focusable = modalEl.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return () => {};
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  function handler(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  modalEl.addEventListener('keydown', handler);
  return () => modalEl.removeEventListener('keydown', handler);
}

/* ─── PWA ─────────────────────────────────────────────────────────────────── */
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(r => console.log('✅ SW registered:', r.scope))
      .catch(e => console.warn('SW error:', e));
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.remove('hidden');
  });
  document.getElementById('btn-install')?.addEventListener('click', () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => {
      deferredInstallPrompt = null;
      document.getElementById('install-banner').classList.add('hidden');
    });
  });
  document.getElementById('btn-install-dismiss')?.addEventListener('click', () => {
    document.getElementById('install-banner').classList.add('hidden');
  });
}

/* ─── TIPS MODAL ──────────────────────────────────────────────────────────── */
let tipsReleaseFocus = null;

function initTipsModal() {
  // Show unless user opted out
  const noShow = LS.get('ba_tips_no_show', false);
  if (!noShow) {
    setTimeout(() => openTipsModal(), 500);
  }

  // Tab navigation
  document.querySelectorAll('.tips-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTipsTab(tab.dataset.tips));
    tab.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTipsTab(tab.dataset.tips); }
    });
  });

  // Close buttons
  document.getElementById('tips-close')?.addEventListener('click', closeTipsModal);
  document.getElementById('btn-close-tips')?.addEventListener('click', closeTipsModal);
  document.getElementById('btn-tips-header')?.addEventListener('click', openTipsModal);
  document.getElementById('footer-tips-btn')?.addEventListener('click', openTipsModal);

  // "Don't show again" checkbox
  document.getElementById('tips-no-show-cb')?.addEventListener('change', e => {
    LS.set('ba_tips_no_show', e.target.checked);
  });

  // Overlay click to close
  document.getElementById('tips-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTipsModal();
  });

  // Keyboard: Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('tips-overlay').classList.contains('open')) {
        closeTipsModal();
      }
    }
  });
}

function openTipsModal() {
  const overlay = document.getElementById('tips-overlay');
  const modal = document.getElementById('tips-modal');
  overlay.classList.add('open');
  overlay.removeAttribute('hidden');
  // Focus first focusable element
  setTimeout(() => {
    modal?.focus();
    tipsReleaseFocus = trapFocus(modal);
  }, 200);
  announceToSR('Tips keselamatan berkendara terbuka. Gunakan tab untuk navigasi.', false);
}

function closeTipsModal() {
  const overlay = document.getElementById('tips-overlay');
  overlay.classList.remove('open');
  if (tipsReleaseFocus) { tipsReleaseFocus(); tipsReleaseFocus = null; }
  // Return focus to trigger
  document.getElementById('btn-tips-header')?.focus();
  announceToSR('Tips keselamatan ditutup. Selamat berkendara dengan aman.', false);
}

function switchTipsTab(tabKey) {
  // Update tabs
  document.querySelectorAll('.tips-tab').forEach(t => {
    const isSelected = t.dataset.tips === tabKey;
    t.classList.toggle('active', isSelected);
    t.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
  // Update panels
  document.querySelectorAll('.tips-panel').forEach(p => {
    const isActive = p.id === `tips-${tabKey}`;
    p.classList.toggle('active', isActive);
    p.hidden = !isActive;
  });
  const tabLabels = {
    begal: 'Tips menghindari begal',
    copet: 'Tips menghindari copet',
    jambret: 'Tips menghindari jambret',
    malam: 'Tips perjalanan malam hari',
    umum: 'Tips umum keselamatan dan nomor darurat'
  };
  announceToSR(tabLabels[tabKey] || 'Tips dibuka', false);
}

/* ─── SSE REAL-TIME ───────────────────────────────────────────────────────── */
function initSSE() {
  if (sseConn) { sseConn.close(); }
  const rtDot = document.getElementById('rt-dot');
  const rtStatus = document.getElementById('rt-status');
  const rtCount = document.getElementById('rt-count');

  try {
    sseConn = new EventSource('/api/reports/stream');

    sseConn.addEventListener('connected', (e) => {
      const d = JSON.parse(e.data);
      rtDot.className = 'rt-dot connected';
      rtStatus.textContent = 'Real-time aktif';
      rtCount.textContent = `${d.clients} online`;
      rtCount.classList.remove('hidden');
      announceToSR(`Terhubung ke Begal Alert. ${d.clients} pengguna online.`);
    });

    sseConn.addEventListener('new-report', (e) => {
      const report = JSON.parse(e.data);
      if (!allReports.find(r => r.id === report.id)) {
        allReports.unshift(report);
        addMarker(report);
        loadStats();
        const msg = `Laporan baru: ${CAT[report.category]?.label || 'Kejadian'} di ${report.kota}`;
        showToast(msg, 'info');
        announceToSR(msg, true);
      }
    });

    sseConn.addEventListener('vote-update', (e) => {
      const { reportId, upvotes, downvotes } = JSON.parse(e.data);
      const upEl = document.getElementById(`up-${reportId}`);
      const dnEl = document.getElementById(`dn-${reportId}`);
      if (upEl) upEl.textContent = upvotes;
      if (dnEl) dnEl.textContent = downvotes;
      const rep = allReports.find(r => r.id === reportId);
      if (rep) { rep.upvotes = upvotes; rep.downvotes = downvotes; }
    });

    sseConn.onerror = () => {
      rtDot.className = 'rt-dot error';
      rtStatus.textContent = 'Koneksi terputus — mencoba ulang...';
      rtCount.classList.add('hidden');
      setTimeout(initSSE, 5000);
    };
  } catch {
    rtStatus.textContent = 'SSE tidak tersedia';
  }
}

/* ─── MAP ─────────────────────────────────────────────────────────────────── */
function initMap() {
  map = L.map('map', {
    center: INDONESIA_CENTER, zoom: 5, minZoom: 4, maxZoom: 18,
    maxBounds: INDONESIA_BOUNDS.pad(0.3),
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> | 🛡️ Begal Alert by <a href="https://github.com/Xnuvers007" target="_blank" rel="noopener">Xnuvers007</a>',
    maxZoom: 19, crossOrigin: true
  }).addTo(map);

  clusterLayer = L.markerClusterGroup({
    chunkedLoading: true, spiderfyOnMaxZoom: true,
    showCoverageOnHover: false, maxClusterRadius: 50,
    iconCreateFunction: (cluster) => {
      const count = cluster.getChildCount();
      const size = count < 10 ? 36 : count < 50 ? 44 : 52;
      return L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;background:rgba(239,68,68,0.75);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:${size > 40 ? 14 : 12}px;font-family:Inter,sans-serif;border:2px solid rgba(255,255,255,0.3);box-shadow:0 3px 10px rgba(0,0,0,0.4)" role="img" aria-label="${count} kejadian di area ini">${count}</div>`,
        className: '', iconSize: L.point(size, size)
      });
    }
  });
  map.addLayer(clusterLayer);
  map.on('click', onMapClick);
  map.on('zoomend', updateHeatLayer);

  // Keyboard navigation on map
  map.getContainer().addEventListener('keydown', (e) => {
    const step = 0.05;
    const c = map.getCenter();
    const moves = {
      ArrowUp:    [c.lat + step, c.lng],
      ArrowDown:  [c.lat - step, c.lng],
      ArrowLeft:  [c.lat, c.lng - step],
      ArrowRight: [c.lat, c.lng + step],
      '+': null, '=': null, '-': null
    };
    if (e.key in moves) {
      if (moves[e.key]) { e.preventDefault(); map.setView(moves[e.key]); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); map.zoomIn(); }
      else if (e.key === '-') { e.preventDefault(); map.zoomOut(); }
    }
  });
}

function onMapClick(e) {
  if (!document.getElementById('modal-overlay').classList.contains('open')) return;
  if (locationMode === 'single') {
    setStartPoint(e.latlng.lat, e.latlng.lng);
  } else {
    if (clickStep === 0) {
      setStartPoint(e.latlng.lat, e.latlng.lng);
      clickStep = 1;
      updateTipText('Sekarang klik titik <strong>akhir</strong> rute kejadian pada peta.');
      announceToSR('Titik awal dipilih. Klik lokasi akhir kejadian di peta.');
    } else {
      setEndPoint(e.latlng.lat, e.latlng.lng);
      clickStep = 0;
      announceToSR('Titik akhir rute dipilih. Silakan isi formulir dan kirim laporan.');
    }
  }
}

/* ─── EVENT LISTENERS ────────────────────────────────────────────────────── */
function initEventListeners() {
  // Report modal
  document.getElementById('btn-open-report').addEventListener('click', openModal);
  document.getElementById('fab-report').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // GPS
  document.getElementById('btn-gps').addEventListener('click', useGPS);

  // Char counter
  document.getElementById('field-desc').addEventListener('input', e => {
    const len = e.target.value.length;
    document.getElementById('char-count').textContent = len;
    if (len >= 450) {
      announceToSR(`${len} dari 500 karakter terisi.`);
    }
  });

  // Form
  document.getElementById('report-form').addEventListener('submit', handleSubmit);

  // Mode toggle
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      locationMode = btn.dataset.mode;
      clickStep = 0;
      clearTempMarkers();
      resetLocationFields();

      const locIndicator = document.getElementById('location-indicator');
      if (locationMode === 'route') {
        locIndicator.classList.add('route-mode');
        document.getElementById('loc-group-end').classList.remove('hidden');
        updateTipText('<i class="fa-solid fa-route" aria-hidden="true"></i> Mode Rute: Klik <strong>titik awal</strong>, lalu <strong>titik akhir</strong> kejadian.');
        announceToSR('Mode rute aktif. Klik titik awal kejadian di peta, lalu klik titik akhir.');
      } else {
        locIndicator.classList.remove('route-mode');
        document.getElementById('loc-group-end').classList.add('hidden');
        updateTipText('<i class="fa-solid fa-location-dot" aria-hidden="true"></i> Klik lokasi kejadian pada peta, atau gunakan GPS.');
        announceToSR('Mode satu titik aktif. Klik lokasi kejadian di peta.');
      }
    });
  });

  // Category filters
  document.querySelectorAll('.filter-btn[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-cat]').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      selectedCategory = btn.dataset.cat;
      renderMarkers();
      const label = btn.textContent.trim();
      announceToSR(`Filter kategori: ${label}. ${getFilteredCount()} laporan ditampilkan.`);
    });
  });

  // Waktu filters
  document.querySelectorAll('.filter-waktu[data-waktu]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-waktu').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      selectedWaktu = btn.dataset.waktu;
      renderMarkers();
      announceToSR(`Filter waktu: ${btn.textContent.trim()}. ${getFilteredCount()} laporan ditampilkan.`);
    });
  });

  // Date filters
  document.querySelectorAll('.filter-date[data-date]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-date').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      selectedDate = btn.dataset.date;
      loadReports();
      announceToSR(`Filter tanggal: ${btn.textContent.trim()}.`);
    });
  });

  // Map mode controls
  document.getElementById('ctrl-cluster').addEventListener('click', () => {
    setMapMode('cluster');
    announceToSR('Mode tampilan diubah ke Cluster. Laporan dikelompokkan.');
  });
  document.getElementById('ctrl-heat').addEventListener('click', () => {
    setMapMode('heat');
    announceToSR('Mode tampilan diubah ke Heatmap. Menampilkan area rawan dengan warna.');
  });
  document.getElementById('ctrl-myloc').addEventListener('click', () => {
    showMyLocation();
    announceToSR('Mencari lokasi Anda di peta...');
  });

  // Stats panel toggle & expand
  document.getElementById('btn-toggle-stats').addEventListener('click', toggleStatsPanel);
  document.getElementById('btn-expand-stats').addEventListener('click', expandStatsPanel);

  // Filter Bar toggle
  document.getElementById('filter-bar-header')?.addEventListener('click', () => {
    const filterBar = document.getElementById('filter-bar');
    const header = document.getElementById('filter-bar-header');
    const isCollapsed = filterBar.classList.toggle('collapsed');
    header.setAttribute('aria-expanded', !isCollapsed);
    announceToSR(isCollapsed ? 'Filter disembunyikan.' : 'Filter ditampilkan.');
  });
  document.getElementById('filter-bar-header')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }
  });

  // Legend toggle
  document.getElementById('legend-header')?.addEventListener('click', () => {
    const legend = document.getElementById('map-legend');
    const header = document.getElementById('legend-header');
    const isCollapsed = legend.classList.toggle('collapsed');
    header.setAttribute('aria-expanded', !isCollapsed);
    announceToSR(isCollapsed ? 'Legenda disembunyikan.' : 'Legenda ditampilkan.');
  });
  document.getElementById('legend-header')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }
  });


  // AI Modal
  document.getElementById('btn-ai-header')?.addEventListener('click', analyzeWithAI);
  document.getElementById('ai-modal-close')?.addEventListener('click', () => {
    const overlay = document.getElementById('ai-modal-overlay');
    overlay.classList.remove('open');
    setTimeout(() => overlay.setAttribute('hidden', 'true'), 300);
  });

  // Keyboard: Escape for report modal and AI modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('modal-overlay').classList.contains('open')) {
        closeModal();
      }
      if (document.getElementById('ai-modal-overlay').classList.contains('open')) {
        document.getElementById('ai-modal-close').click();
      }
    }
  });
}

function getFilteredCount() {
  return allReports.filter(r => {
    if (selectedCategory !== 'all' && r.category !== selectedCategory) return false;
    if (selectedWaktu !== 'all' && r.waktu !== selectedWaktu) return false;
    return true;
  }).length;
}

/* ─── STATS PANEL ─────────────────────────────────────────────────────────── */
function toggleStatsPanel() {
  const panel = document.getElementById('stats-panel');
  const icon = document.getElementById('toggle-icon');
  const btn = document.getElementById('btn-toggle-stats');

  panelCollapsed = !panelCollapsed;
  panel.classList.toggle('collapsed', panelCollapsed);

  icon.className = panelCollapsed ? 'fa-solid fa-plus' : 'fa-solid fa-minus';
  btn.setAttribute('aria-expanded', panelCollapsed ? 'false' : 'true');
  btn.setAttribute('aria-label', panelCollapsed ? 'Tampilkan panel statistik' : 'Sembunyikan panel statistik');

  announceToSR(panelCollapsed ? 'Panel statistik disembunyikan.' : 'Panel statistik ditampilkan.');
}

function expandStatsPanel() {
  const panel = document.getElementById('stats-panel');
  const icon = document.getElementById('expand-icon');
  const btn = document.getElementById('btn-expand-stats');

  panelExpanded = !panelExpanded;
  panel.classList.toggle('expanded', panelExpanded);

  icon.className = panelExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
  btn.setAttribute('aria-expanded', panelExpanded ? 'true' : 'false');
  btn.setAttribute('aria-label', panelExpanded ? 'Perkecil panel statistik' : 'Perbesar panel statistik');
  btn.classList.toggle('active', panelExpanded);

  // If collapsed, expand first
  if (panelCollapsed) {
    panelCollapsed = false;
    panel.classList.remove('collapsed');
    document.getElementById('toggle-icon').className = 'fa-solid fa-minus';
    document.getElementById('btn-toggle-stats').setAttribute('aria-expanded', 'true');
  }

  announceToSR(panelExpanded ? 'Panel statistik diperbesar, menutupi peta.' : 'Panel statistik dikembalikan ke ukuran normal.');
}

/* ─── MODAL ───────────────────────────────────────────────────────────────── */
let reportReleaseFocus = null;

function openModal() {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('report-modal');
  overlay.classList.add('open');
  overlay.removeAttribute('hidden');
  setTimeout(() => {
    modal?.focus();
    reportReleaseFocus = trapFocus(modal);
  }, 200);
  showToast('Klik peta untuk pilih lokasi kejadian', 'info');
  announceToSR('Form laporan kejadian terbuka. Klik lokasi di peta atau gunakan tombol GPS.');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  clearTempMarkers();
  clickStep = 0;
  if (reportReleaseFocus) { reportReleaseFocus(); reportReleaseFocus = null; }
  document.getElementById('btn-open-report')?.focus();
  announceToSR('Form laporan ditutup.');
}

function updateTipText(html) {
  document.getElementById('tip-text').innerHTML = html;
}

/* ─── LOCATION POINTS ────────────────────────────────────────────────────── */
function setStartPoint(lat, lng) {
  pendingLat = lat; pendingLng = lng;
  document.getElementById('field-lat').value = lat.toFixed(6);
  document.getElementById('field-lng').value = lng.toFixed(6);

  const dot = document.getElementById('loc-dot-start');
  dot.classList.add('active');
  document.getElementById('loc-text-start').innerHTML =
    `<i class="fa-solid fa-circle-dot" style="color:#22c55e;font-size:10px" aria-hidden="true"></i> ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  document.getElementById('location-indicator').classList.add('has-start');

  if (tempMarkers[0]) map.removeLayer(tempMarkers[0]);
  tempMarkers[0] = L.circleMarker([lat, lng], {
    radius: 8, fillColor: '#22c55e', fillOpacity: 0.9, color: 'white', weight: 2
  }).addTo(map);
  updateTempLine();
}

function setEndPoint(lat, lng) {
  pendingLatEnd = lat; pendingLngEnd = lng;
  document.getElementById('field-lat-end').value = lat.toFixed(6);
  document.getElementById('field-lng-end').value = lng.toFixed(6);

  document.getElementById('loc-dot-end').classList.add('active');
  document.getElementById('loc-text-end').innerHTML =
    `<i class="fa-solid fa-flag-checkered" style="color:#ef4444;font-size:10px" aria-hidden="true"></i> ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  if (tempMarkers[1]) map.removeLayer(tempMarkers[1]);
  tempMarkers[1] = L.circleMarker([lat, lng], {
    radius: 8, fillColor: '#ef4444', fillOpacity: 0.9, color: 'white', weight: 2
  }).addTo(map);
  updateTempLine();
  updateTipText('<i class="fa-solid fa-check-circle" style="color:#22c55e" aria-hidden="true"></i> Titik awal & akhir dipilih. Klik lagi untuk mengubah.');
}

function updateTempLine() {
  if (tempLine) { map.removeLayer(tempLine); tempLine = null; }
  if (pendingLat && pendingLatEnd) {
    const category = document.getElementById('field-category').value;
    const color = (CAT[category] || CAT.lainnya).color;
    tempLine = L.polyline(
      [[pendingLat, pendingLng], [pendingLatEnd, pendingLngEnd]],
      { color, weight: 3, opacity: 0.7, dashArray: '8 5' }
    ).addTo(map);
  }
}

function clearTempMarkers() {
  tempMarkers.forEach(m => m && map.removeLayer(m));
  tempMarkers = [];
  if (tempLine) { map.removeLayer(tempLine); tempLine = null; }
  resetLocationFields();
}

function resetLocationFields() {
  pendingLat = null; pendingLng = null;
  pendingLatEnd = null; pendingLngEnd = null;
  ['field-lat','field-lng','field-lat-end','field-lng-end'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('loc-dot-start').classList.remove('active');
  document.getElementById('loc-dot-end').classList.remove('active');
  document.getElementById('loc-text-start').textContent = 'Belum ada lokasi dipilih';
  document.getElementById('loc-text-end').textContent = 'Titik akhir rute belum dipilih';
  document.getElementById('location-indicator').classList.remove('has-start');
}

/* ─── GPS ─────────────────────────────────────────────────────────────────── */
function useGPS() {
  const btn = document.getElementById('btn-gps');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Mencari...';
  btn.disabled = true;
  btn.setAttribute('aria-label', 'Sedang mencari lokasi GPS...');
  announceToSR('Sedang mencari lokasi GPS Anda...');

  if (!navigator.geolocation) {
    showToast('Browser tidak mendukung GPS', 'error');
    resetGPSBtn(btn);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      setStartPoint(latitude, longitude);
      map.setView([latitude, longitude], 15);
      btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Ditemukan';
      btn.setAttribute('aria-label', 'Lokasi GPS ditemukan');
      announceToSR('Lokasi GPS ditemukan dan ditandai di peta.');
      setTimeout(() => resetGPSBtn(btn), 2000);
    },
    err => {
      const msg = err.code === 1 ? 'Akses GPS ditolak' : 'Gagal mendapatkan lokasi GPS';
      showToast(msg, 'error');
      announceToSR(msg, true);
      resetGPSBtn(btn);
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

function resetGPSBtn(btn) {
  btn.innerHTML = '<i class="fa-solid fa-satellite-dish" aria-hidden="true"></i> GPS';
  btn.disabled = false;
  btn.setAttribute('aria-label', 'Gunakan GPS untuk menentukan lokasi saya');
}

/* ─── MY LOCATION ─────────────────────────────────────────────────────────── */
function showMyLocation() {
  navigator.geolocation?.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      if (myLocMarker) map.removeLayer(myLocMarker);
      myLocMarker = L.marker([latitude, longitude], {
        icon: L.divIcon({
          html: '<div class="my-loc-marker" role="img" aria-label="Posisi saya"></div>',
          className: '', iconSize: [16, 16], iconAnchor: [8, 8]
        }),
        zIndexOffset: 9999,
        alt: 'Posisi saya'
      }).addTo(map).bindPopup('<b>📍 Lokasi Anda saat ini</b>');
      map.setView([latitude, longitude], 15);
      announceToSR('Posisi Anda ditandai di peta.');
    },
    () => {
      showToast('Gagal mendapatkan lokasi', 'error');
      announceToSR('Gagal mendapatkan lokasi GPS.', true);
    }
  );
}

/* ─── SUBMIT ──────────────────────────────────────────────────────────────── */
async function handleSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;

  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  const errors = [];

  if (!pendingLat || !pendingLng) {
    errors.push('location');
    showToast('Pilih lokasi kejadian pada peta terlebih dahulu', 'error');
    announceToSR('Kesalahan: belum memilih lokasi kejadian di peta.', true);
  }
  const category = document.getElementById('field-category').value;
  if (!category) { errors.push('category'); document.getElementById('err-category').textContent = 'Pilih kategori'; }
  const kota = document.getElementById('field-kota').value;
  if (!kota) { errors.push('kota'); document.getElementById('err-kota').textContent = 'Pilih kota'; }
  const waktuEl = document.querySelector('input[name="waktu"]:checked');
  if (!waktuEl) { errors.push('waktu'); document.getElementById('err-waktu').textContent = 'Pilih waktu kejadian'; }
  const description = document.getElementById('field-desc').value.trim();
  if (description.length < 10) { errors.push('desc'); document.getElementById('err-desc').textContent = 'Deskripsi minimal 10 karakter'; }

  if (errors.length > 0) {
    const errorList = [];
    if (errors.includes('location')) errorList.push('lokasi belum dipilih');
    if (errors.includes('category')) errorList.push('kategori belum dipilih');
    if (errors.includes('kota')) errorList.push('kota belum dipilih');
    if (errors.includes('waktu')) errorList.push('waktu kejadian belum dipilih');
    if (errors.includes('desc')) errorList.push('deskripsi terlalu pendek');
    announceToSR(`Formulir memiliki kesalahan: ${errorList.join(', ')}. Harap perbaiki.`, true);
    return;
  }

  if (tempLine) updateTempLine();

  isSubmitting = true;
  const btn = document.getElementById('btn-submit');
  const submitText = document.getElementById('submit-text');
  const spinner = document.getElementById('submit-spinner');

  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  submitText.classList.add('hidden');
  spinner.classList.remove('hidden');
  announceToSR('Sedang mengirim laporan...');

  try {
    const payload = { latitude: pendingLat, longitude: pendingLng, category, description, waktu: waktuEl.value, kota };
    if (locationMode === 'route' && pendingLatEnd && pendingLngEnd) {
      payload.lat_end = pendingLatEnd;
      payload.lng_end = pendingLngEnd;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;

    const res = await fetch('/api/reports', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast(data.message, 'success');
      announceToSR('Laporan berhasil dikirim! Terima kasih telah membantu sesama pengendara.', false);
      closeModal();
      resetForm();
    } else {
      if (data.errors) {
        data.errors.forEach(err => {
          const el = document.getElementById(`err-${err.field}`);
          if (el) el.textContent = err.message;
        });
      }
      const errMsg = data.message || 'Gagal mengirim laporan';
      showToast(errMsg, 'error');
      announceToSR(errMsg, true);
    }
  } catch {
    showToast('Koneksi gagal. Periksa internet Anda.', 'error');
    announceToSR('Koneksi gagal. Periksa koneksi internet Anda.', true);
  } finally {
    isSubmitting = false;
    btn.disabled = false;
    btn.setAttribute('aria-busy', 'false');
    submitText.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}

function resetForm() {
  document.getElementById('report-form').reset();
  document.getElementById('char-count').textContent = '0';
  clearTempMarkers();
  locationMode = 'single'; clickStep = 0;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  document.getElementById('mode-single').classList.add('active');
  document.getElementById('mode-single').setAttribute('aria-pressed', 'true');
  document.getElementById('location-indicator').classList.remove('route-mode');
  document.getElementById('loc-group-end').classList.add('hidden');
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  updateTipText('<i class="fa-solid fa-location-dot" aria-hidden="true"></i> Klik lokasi kejadian pada peta, atau gunakan GPS.');
}

/* ─── LOAD REPORTS ────────────────────────────────────────────────────────── */
async function loadReports() {
  try {
    const params = new URLSearchParams({ limit: 500 });
    if (selectedDate !== 'all') params.set('date_filter', selectedDate);
    const res = await fetch(`/api/reports?${params}`);
    const data = await res.json();
    if (data.success) {
      allReports = data.data;
      renderMarkers();
    }
  } catch (err) { console.error('Load reports error:', err); }
}

/* ─── SSE INIT ────────────────────────────────────────────────────────────── */
function initSSE() {
  try {
    sseConn = new EventSource('/api/reports/stream');
    
    sseConn.addEventListener('open', () => {
      document.getElementById('rt-status').textContent = 'Online';
      document.getElementById('rt-dot').style.background = '#10b981'; // green
      document.getElementById('rt-count').classList.remove('hidden');
    });

    sseConn.addEventListener('error', () => {
      document.getElementById('rt-status').textContent = 'Terputus...';
      document.getElementById('rt-dot').style.background = '#ef4444'; // red
      document.getElementById('rt-count').classList.add('hidden');
    });

    sseConn.addEventListener('init', (e) => {
      const data = JSON.parse(e.data);
      const clientsEl = document.getElementById('sp-clients');
      if (clientsEl) clientsEl.textContent = data.activeClients;
      const countEl = document.getElementById('rt-count');
      if (countEl) countEl.textContent = data.activeClients + ' Online';
    });

    sseConn.addEventListener('delete-report', (e) => {
      const data = JSON.parse(e.data);
      allReports = allReports.filter(r => r.id !== data.reportId);
      renderMarkers();
      showToast('Sebuah laporan telah dihapus oleh Admin.', 'info');
      announceToSR('Laporan dihapus oleh admin.');
      loadStats();
    });


    sseConn.addEventListener('new-report', (e) => {
      const report = JSON.parse(e.data);
      allReports.unshift(report);
      addMarker(report);
      updateHeatLayer();
      showToast('Laporan baru ditambahkan!', 'success');
      announceToSR('Laporan baru ditambahkan di peta.');
      loadStats();
    });

    sseConn.addEventListener('vote-update', (e) => {
      const data = JSON.parse(e.data);
      const report = allReports.find(r => r.id === data.reportId);
      if (report) {
        report.upvotes = data.upvotes;
        report.downvotes = data.downvotes;
      }
      const elUp = document.getElementById(`up-${data.reportId}`);
      if (elUp) elUp.textContent = data.upvotes;
      const elDn = document.getElementById(`dn-${data.reportId}`);
      if (elDn) elDn.textContent = data.downvotes;
      
      const marker = activeMarkers.get(data.reportId);
      if (marker._popup && marker._popup.isOpen()) {
        marker.closePopup();
        setTimeout(() => marker.openPopup(), 100);
      }
      loadStats();
    });

    sseConn.addEventListener('new-comment', (e) => {
      const comment = JSON.parse(e.data);
      appendComment(comment.report_id, comment);
    });

    sseConn.addEventListener('status-update', (e) => {
      const data = JSON.parse(e.data);
      const report = allReports.find(r => r.id === data.reportId);
      if (report) {
        report.status = data.status;
        renderMarkers();
        if (data.status === 'aman') {
          showToast('Status sebuah jalan telah diperbarui menjadi Aman!', 'success');
          announceToSR('Status jalan diperbarui menjadi Aman.');
        } else if (data.status === 'bahaya') {
          showToast('Peringatan: Jalan dilaporkan kembali Bahaya!', 'error');
          announceToSR('Status jalan diperbarui menjadi Bahaya.');
        } else if (data.status === 'default') {
          showToast('Status jalan telah dihapus / kembali normal.', 'info');
          announceToSR('Status jalan direset ke default.');
        }
      }
    });

  } catch (err) { console.error('SSE Init error:', err); }
}

/* ─── RENDER MARKERS ──────────────────────────────────────────────────────── */
function renderMarkers() {
  clusterLayer.clearLayers();
  routePolylines.forEach(p => map.removeLayer(p));
  routePolylines = [];
  activeMarkers.clear();
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

  const filtered = allReports.filter(r => {
    if (selectedCategory !== 'all' && r.category !== selectedCategory) return false;
    if (selectedWaktu !== 'all' && r.waktu !== selectedWaktu) return false;
    return true;
  });

  filtered.forEach(r => addMarker(r));

  if (mapMode === 'heat') {
    renderHeatmap(filtered);
    clusterLayer.clearLayers();
  }
}

function setMapMode(mode) {
  mapMode = mode;
  document.getElementById('ctrl-cluster').classList.toggle('active', mode === 'cluster');
  document.getElementById('ctrl-cluster').setAttribute('aria-pressed', mode === 'cluster' ? 'true' : 'false');
  document.getElementById('ctrl-heat').classList.toggle('active', mode === 'heat');
  document.getElementById('ctrl-heat').setAttribute('aria-pressed', mode === 'heat' ? 'true' : 'false');
  renderMarkers();
}

function renderHeatmap(reports) {
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (!reports.length) return;
  const heatData = reports.map(r => [r.latitude, r.longitude, 0.6]);
  heatLayer = L.heatLayer(heatData, {
    radius: 30, blur: 18, maxZoom: 17,
    gradient: { 0.3: '#3b82f6', 0.6: '#f97316', 1: '#ef4444' }
  }).addTo(map);
}

function updateHeatLayer() {
  if (mapMode !== 'heat') return;
  renderHeatmap(allReports.filter(r => {
    if (selectedCategory !== 'all' && r.category !== selectedCategory) return false;
    if (selectedWaktu !== 'all' && r.waktu !== selectedWaktu) return false;
    return true;
  }));
}

/* ─── ADD MARKER ──────────────────────────────────────────────────────────── */
function addMarker(report) {
  if (activeMarkers.has(report.id)) return;
  if (mapMode === 'heat') return;

  const cfg = CAT[report.category] || CAT.lainnya;
  const hasVoted = votedReports.has(report.id);
  const hasRoute = report.lat_end && report.lng_end;
  const isAman = report.status === 'aman';
  const isBahaya = report.status === 'bahaya';
  const isDefault = report.status === 'default' || (!isAman && !isBahaya); // fallback to default if not aman or bahaya

  // Default is the category color and icon.
  // Bahaya adds a blinking effect or red warning styling? Let's just use marker-bahaya class.
  const statusLabel = isAman ? 'Aman' : isBahaya ? 'Tidak Aman / Bahaya' : 'Default';
  const ariaLabel = `${cfg.label} di ${report.kota}, ${WAKTU_LABELS[report.waktu]?.label || report.waktu} - Status: ${statusLabel}`;

  let iconHtml = '';
  if (isAman) {
    iconHtml = `<div class="map-marker-fa marker-aman" role="img" aria-label="${ariaLabel}"><i class="fa-solid fa-check" aria-hidden="true"></i></div>`;
  } else if (isBahaya) {
    iconHtml = `<div class="map-marker-fa marker-bahaya" role="img" aria-label="${ariaLabel}"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></div>`;
  } else {
    iconHtml = `<div class="map-marker-fa" style="background:${cfg.color};box-shadow:0 3px 12px ${cfg.color}88" role="img" aria-label="${ariaLabel}"><i class="fa-solid ${cfg.icon}" aria-hidden="true"></i></div>`;
  }

  const icon = L.divIcon({
    html: iconHtml,
    className: '', iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -36]
  });

  const marker = L.marker([report.latitude, report.longitude], { icon, alt: ariaLabel });

  const dateStr = new Date(report.created_at).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const w = WAKTU_LABELS[report.waktu] || { icon: 'fa-clock', label: report.waktu };

  marker.bindPopup(() => {
    const div = document.createElement('div');
    div.className = 'popup-content';
    div.setAttribute('role', 'region');
    div.setAttribute('aria-label', `Detail laporan ${cfg.label} di ${report.kota}`);
    div.innerHTML = `
      <div class="popup-badge" style="background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">
        <i class="fa-solid ${cfg.icon}" aria-hidden="true"></i> ${cfg.label}
      </div>
      ${hasRoute ? `<div class="route-badge" aria-label="Laporan ini memiliki data rute kejadian"><i class="fa-solid fa-route" aria-hidden="true"></i> Ada data rute</div>` : ''}
      <div class="popup-desc" aria-label="Deskripsi: ${escapeHtml(report.description)}">${escapeHtml(report.description)}</div>
      <div class="popup-meta" aria-label="Detail laporan">
        <span aria-label="Waktu kejadian: ${w.label}"><i class="fa-solid ${w.icon}" aria-hidden="true"></i> ${w.label}</span>
        <span aria-label="Kota: ${escapeHtml(report.kota)}"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(report.kota)}</span>
        <span aria-label="Dilaporkan pada ${dateStr}"><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${dateStr}</span>
      </div>
      <div class="popup-votes" role="group" aria-label="Vote konfirmasi laporan">
        <button class="vote-btn ${hasVoted ? 'voted' : ''}" id="vote-up-${report.id}"
          data-id="${report.id}" data-vote="up"
          aria-label="Vote setuju, saat ini ${report.upvotes} vote positif"
          ${hasVoted ? 'disabled aria-disabled="true"' : ''}>
          <i class="fa-solid fa-thumbs-up" aria-hidden="true"></i>
          <span id="up-${report.id}" aria-live="polite">${report.upvotes}</span>
        </button>
        <button class="vote-btn ${hasVoted ? 'voted' : ''}" id="vote-dn-${report.id}"
          data-id="${report.id}" data-vote="down"
          aria-label="Vote tidak setuju, saat ini ${report.downvotes} vote negatif"
          ${hasVoted ? 'disabled aria-disabled="true"' : ''}>
          <i class="fa-solid fa-thumbs-down" aria-hidden="true"></i>
          <span id="dn-${report.id}" aria-live="polite">${report.downvotes}</span>
        </button>
      </div>
      ${hasVoted ? '<p class="voted-note" aria-label="Anda sudah memberikan vote">Anda sudah memberi vote</p>' : ''}
      
      <!-- Comments Section -->
      <div class="popup-comments">
        <div class="popup-comments-title">Update Status & Komentar</div>
        <div class="comment-list" id="comments-${report.id}">
          <div style="text-align:center;font-size:10px;color:#8b949e">Memuat komentar...</div>
        </div>
        <div class="comment-form">
          <input type="text" id="input-comment-${report.id}" class="comment-input" placeholder="Tulis komentar atau update..." aria-label="Komentar">
          <div class="comment-actions">
            <button class="btn-comment" id="btn-send-comment-${report.id}"><i class="fa-solid fa-paper-plane"></i> Kirim</button>
          </div>
          <div class="comment-actions" style="margin-top: 4px;">
            <button class="btn-comment btn-mark-safe" id="btn-mark-safe-${report.id}" title="Tandai Aman"><i class="fa-solid fa-shield-check"></i> Aman</button>
            <button class="btn-comment btn-mark-danger" id="btn-mark-danger-${report.id}" title="Tandai Bahaya"><i class="fa-solid fa-triangle-exclamation"></i> Bahaya</button>
            <button class="btn-comment btn-mark-default" id="btn-mark-default-${report.id}" title="Hapus Status"><i class="fa-solid fa-eraser"></i> Hapus</button>
          </div>
          <div class="comment-actions" style="margin-top: 4px;">
            <button class="btn-comment btn-admin-delete" id="btn-admin-delete-${report.id}" title="Hapus Laporan Secara Permanen (Admin)"><i class="fa-solid fa-trash-can"></i> Hapus Laporan (Admin)</button>
          </div>
        </div>
      </div>
    `;

    if (!hasVoted) {
      div.querySelectorAll('.vote-btn').forEach(btn => {
        btn.addEventListener('click', () => handleVote(report.id, btn.dataset.vote));
      });
    }

    // Attach event listeners for comments
    setTimeout(() => {
      const btnSend = div.querySelector(`#btn-send-comment-${report.id}`);
      const btnSafe = div.querySelector(`#btn-mark-safe-${report.id}`);
      const btnDanger = div.querySelector(`#btn-mark-danger-${report.id}`);
      const btnDefault = div.querySelector(`#btn-mark-default-${report.id}`);
      const btnAdminDel = div.querySelector(`#btn-admin-delete-${report.id}`);
      const input = div.querySelector(`#input-comment-${report.id}`);

      btnSend?.addEventListener('click', () => submitComment(report.id, input.value, null));
      btnSafe?.addEventListener('click', () => submitComment(report.id, input.value, 'aman'));
      btnDanger?.addEventListener('click', () => submitComment(report.id, input.value, 'bahaya'));
      btnDefault?.addEventListener('click', () => submitComment(report.id, input.value, 'default'));
      btnAdminDel?.addEventListener('click', () => deleteReportAdmin(report.id));
      
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnSend.click();
      });

      loadComments(report.id);
    }, 100);

    return div;
  }, { maxWidth: 300 });

  // Route polyline
  let polyline = null;
  if (hasRoute) {
    polyline = L.polyline(
      [[report.latitude, report.longitude], [report.lat_end, report.lng_end]],
      { color: cfg.color, weight: 3.5, opacity: 0.75, dashArray: '10 6', lineCap: 'round' }
    ).addTo(map);
    routePolylines.push(polyline);
    polyline.on('click', () => marker.openPopup());
  }

  clusterLayer.addLayer(marker);
  activeMarkers.set(report.id, { marker, polyline });
}

/* ─── VOTE ────────────────────────────────────────────────────────────────── */
async function handleVote(reportId, voteType) {
  if (votedReports.has(reportId)) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    
    const res = await fetch(`/api/reports/${reportId}/vote`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ vote: voteType })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      votedReports.add(reportId);
      LS.set('ba_voted', [...votedReports]);
      showToast(data.message, 'success');
      announceToSR(data.message, false);
      [`vote-up-${reportId}`, `vote-dn-${reportId}`].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = true; el.classList.add('voted'); el.setAttribute('aria-disabled', 'true'); }
      });
    } else {
      showToast(data.message || 'Gagal vote', 'error');
      announceToSR(data.message || 'Gagal memberikan vote.', true);
    }
  } catch {
    showToast('Gagal terhubung ke server', 'error');
    announceToSR('Gagal terhubung ke server.', true);
  }
}

/* ─── STATS ───────────────────────────────────────────────────────────────── */
async function loadStats() {
  try {
    const res = await fetch('/api/reports/stats');
    const data = await res.json();
    if (!data.success) return;
    const s = data.data;

    document.getElementById('stat-total').textContent = s.total.toLocaleString('id-ID');
    document.getElementById('stat-today').textContent = s.today.toLocaleString('id-ID');
    document.getElementById('stat-week').textContent = s.thisWeek.toLocaleString('id-ID');
    document.getElementById('sp-total').textContent = s.total.toLocaleString('id-ID');
    document.getElementById('sp-today').textContent = s.today.toLocaleString('id-ID');
    document.getElementById('sp-week').textContent = s.thisWeek.toLocaleString('id-ID');
    const clientsEl = document.getElementById('sp-clients');
    if (clientsEl) clientsEl.textContent = s.activeClients;

    const maxCat = s.byCategory[0]?.count || 1;
    document.getElementById('stats-cats').innerHTML = s.byCategory.map(cat => {
      const cfg = CAT[cat.category] || CAT.lainnya;
      const pct = Math.round((cat.count / maxCat) * 100);
      return `<div class="cat-bar-item" aria-label="${cfg.label}: ${cat.count} laporan, ${pct} persen">
        <div class="cat-bar-label">
          <span><i class="fa-solid ${cfg.icon}" style="color:${cfg.color};font-size:10px;margin-right:3px" aria-hidden="true"></i>${cfg.label}</span>
          <span aria-hidden="true">${cat.count}</span>
        </div>
        <div class="cat-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${pct} persen">
          <div class="cat-bar-fill" style="width:${pct}%;background:${cfg.color}"></div>
        </div>
      </div>`;
    }).join('');

    if (s.topKota?.length > 0) {
      const maxK = s.topKota[0]?.count || 1;
      document.getElementById('stats-kota').innerHTML =
        `<div style="font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">
          <i class="fa-solid fa-city" aria-hidden="true" style="margin-right:4px"></i>Top Kota
        </div>` +
        s.topKota.slice(0, 5).map(k => {
          const pct = Math.round((k.count / maxK) * 100);
          return `<div class="cat-bar-item" aria-label="${escapeHtml(k.kota)}: ${k.count} laporan">
            <div class="cat-bar-label"><span>${escapeHtml(k.kota)}</span><span>${k.count}</span></div>
            <div class="cat-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
              <div class="cat-bar-fill" style="width:${pct}%;background:#3b82f6"></div>
            </div>
          </div>`;
        }).join('');
    }
  } catch (err) { console.error('Stats error:', err); }
}

/* ─── COMMENTS & STATUS UPDATE ─────────────────────────────────────────────── */
async function loadComments(reportId) {
  try {
    const res = await fetch(`/api/reports/${reportId}/comments`);
    const data = await res.json();
    const container = document.getElementById(`comments-${reportId}`);
    if (!container) return;
    
    container.innerHTML = '';
    if (data.success && data.data.length > 0) {
      data.data.forEach(c => appendComment(reportId, c, true));
    } else {
      container.innerHTML = '<div style="text-align:center;font-size:10px;color:#8b949e">Belum ada komentar.</div>';
    }
  } catch (err) { console.error('Load comments error:', err); }
}

async function submitComment(reportId, text, statusUpdate) {
  const input = document.getElementById(`input-comment-${reportId}`);
  if (input) input.disabled = true;
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;

    const res = await fetch(`/api/reports/${reportId}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ comment: text, status_update: statusUpdate })
    });
    const data = await res.json();
    
    if (data.success) {
      if (input) { input.value = ''; input.disabled = false; input.focus(); }
      showToast(data.message, 'success');
      if (statusUpdate === 'aman') {
        announceToSR('Status berhasil diperbarui menjadi Aman.');
      }
    } else {
      showToast(data.message || 'Gagal mengirim', 'error');
      if (input) input.disabled = false;
    }
  } catch (err) {
    showToast('Koneksi gagal', 'error');
    if (input) input.disabled = false;
  }
}

function appendComment(reportId, comment, isLoad = false) {
  const container = document.getElementById(`comments-${reportId}`);
  if (!container) return;
  
  if (container.innerHTML.includes('Belum ada komentar') || container.innerHTML.includes('Memuat komentar')) {
    container.innerHTML = '';
  }
  
  const div = document.createElement('div');
  div.className = `comment-item ${comment.status_update ? 'status-update' : ''}`;
  
  const dateStr = new Date(comment.created_at).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
  
  const icon = comment.status_update === 'aman' ? '<i class="fa-solid fa-shield-check" style="color:#4ade80;"></i> ' : 
               comment.status_update === 'bahaya' ? '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;"></i> ' : 
               comment.status_update === 'default' ? '<i class="fa-solid fa-eraser" style="color:#9ca3af;"></i> ' : '';
               
  div.innerHTML = `
    <div>${icon}${escapeHtml(comment.comment)}</div>
    <span class="comment-time">${dateStr}</span>
  `;
  
  container.appendChild(div);
  if (!isLoad) container.scrollTop = container.scrollHeight;
}

/* ─── TOAST (SweetAlert2) ─────────────────────────────────────────────────── */
const Toast = Swal.mixin({
  toast: true,
  position: 'bottom-end',
  showConfirmButton: false,
  timer: 3800,
  timerProgressBar: true,
  background: '#161b22',
  color: '#c9d1d9',
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
  }
});

function showToast(message, type = 'info') {
  // Map type if needed (success, error, info, warning)
  Toast.fire({
    icon: type,
    title: String(message)
  });
}

/* ─── SECURITY: Escape HTML ───────────────────────────────────────────────── */
function escapeHtml(str) {
  if (!str) return '';
  // Jika DOMPurify tersedia via CDN, gunakan itu untuk sanitasi berlapis
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(String(str));
  }
  // Fallback standar
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[m]);
}

/* ─── ADMIN DELETE ────────────────────────────────────────────────────────── */
async function deleteReportAdmin(reportId) {
  const { value: adminPwd } = await Swal.fire({
    title: 'Akses Admin',
    text: 'Masukkan Password Admin untuk menghapus laporan ini',
    input: 'password',
    inputPlaceholder: 'Password Admin',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-trash-can"></i> Hapus',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#ef4444',
    background: '#161b22',
    color: '#c9d1d9',
    inputAttributes: {
      autocapitalize: 'off',
      autocorrect: 'off'
    }
  });

  if (!adminPwd) return; // Dibatalkan

  try {
    const headers = { 'x-admin-key': adminPwd };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;

    const res = await fetch(`/api/reports/${reportId}`, {
      method: 'DELETE',
      headers
    });
    const data = await res.json();
    if (data.success) {
      showToast('Laporan berhasil dihapus!', 'success');
      const marker = activeMarkers.get(reportId);
      if (marker && marker._popup && marker._popup.isOpen()) {
        map.closePopup(marker._popup);
      }
    } else {
      showToast(data.message || 'Gagal menghapus laporan.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan jaringan.', 'error');
  }
}

/* ─── AI INSIGHT ──────────────────────────────────────────────────────────── */
function analyzeWithAI() {
  const overlay = document.getElementById('ai-modal-overlay');
  overlay.removeAttribute('hidden');
  overlay.classList.add('open');
  
  const content = document.getElementById('ai-content');
  content.innerHTML = `
    <div class="ai-typing">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      Menganalisis ${allReports.length} laporan...
    </div>
  `;
  announceToSR('Modal AI Insight terbuka. Menganalisis laporan...', false);

  setTimeout(() => {
    if (allReports.length === 0) {
      content.innerHTML = '<p>Belum ada data laporan untuk dianalisis saat ini. Harap tunggu laporan masuk.</p>';
      announceToSR('Belum ada data laporan untuk dianalisis saat ini.');
      return;
    }

    const categories = {};
    const times = {};
    let latest = allReports[0];
    
    allReports.forEach(r => {
      categories[r.category] = (categories[r.category] || 0) + 1;
      times[r.waktu] = (times[r.waktu] || 0) + 1;
    });

    const topCategory = Object.keys(categories).sort((a,b) => categories[b] - categories[a])[0];
    const topTime = Object.keys(times).sort((a,b) => times[b] - times[a])[0];

    const html = `
      <p>Berikut adalah hasil analisis AI berdasarkan data terkini:</p>
      <ul>
        <li><strong>Titik Rawan Utama:</strong> Kategori kejahatan tertinggi saat ini adalah <strong>${CAT[topCategory]?.label || topCategory}</strong> (${categories[topCategory]} kejadian).</li>
        <li><strong>Waktu Rawan:</strong> Sebagian besar insiden terjadi pada <strong>${topTime.replace('_', ' ')}</strong>.</li>
        <li><strong>Tren Terbaru:</strong> Kejadian terakhir dilaporkan di daerah <strong>${latest.kota || 'Tidak diketahui'}</strong>.</li>
      </ul>
      <p><strong>Rekomendasi AI:</strong> Hindari berpergian sendirian di area sepi pada ${topTime.replace('_', ' ')}. Pastikan kendaraan terkunci ganda dan selalu waspada terhadap lingkungan sekitar.</p>
    `;
    content.innerHTML = html;
    announceToSR('Analisis AI selesai. Kategori tertinggi adalah ' + (CAT[topCategory]?.label || topCategory) + '.');
  }, 1800);
}
