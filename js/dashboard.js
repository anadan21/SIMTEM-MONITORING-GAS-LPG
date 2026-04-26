/**
 * js/dashboard.js
 * Logic utama dashboard QC Pangkalan LPG
 *
 * Konteks sistem:
 *   Tabung LPG datang dari SPBE → ditimbang + sensor gas baca PPM
 *   → Dashboard tampilkan kondisi tabung secara realtime
 *   → Saat tabung diangkat dari timbangan, hasil dikirim ke Spreadsheet
 *
 * Status:
 *   LAYAK  — PPM ≤ 300 DAN berat ≥ 7.80 kg → siap dijual
 *   KURANG — PPM ≤ 300 DAN berat 4.80–7.79 kg → isi tidak standar
 *   BOCOR  — PPM > 300 → gas bocor, JANGAN DIJUAL
 *   KOSONG — tidak ada tabung di timbangan (berat < 4.80 kg)
 */

import { db } from './firebase-init.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── Shorthand ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Threshold (sesuai Arduino) ────────────────────────────────────
const CFG = {
  PPM_BOCOR:    300,
  BERAT_LAYAK:  7.80,
  BERAT_KURANG: 4.80,
  BERAT_TABUNG: 5.0,
  BERAT_MAX:    12,
  PPM_MAX:      1000,
};

// ── Teks & style per status ───────────────────────────────────────
const VERDICT = {
  LAYAK: {
    panelCls:  'v-layak',
    icon:      'LAYAK',
    code:      'LAYAK JUAL',
    desc:      'Tabung memenuhi standar distribusi. Berat isi sesuai dan tidak terdeteksi kebocoran gas. Aman untuk dijual ke konsumen.',
  },
  KURANG: {
    panelCls:  'v-kurang',
    icon:      'KURANG',
    code:      'ISI KURANG',
    desc:      'Berat isi LPG di bawah standar penjualan. Tabung perlu dikembalikan ke SPBE untuk pengisian ulang sebelum didistribusikan.',
  },
  BOCOR: {
    panelCls:  'v-bocor',
    icon:      'BOCOR',
    code:      'GAS BOCOR',
    desc:      'PERINGATAN: Terdeteksi kebocoran gas (PPM melebihi batas aman). Jangan dijual. Amankan tabung dan jauhkan dari sumber api.',
  },
  KOSONG: {
    panelCls:  'v-menunggu',
    icon:      '—',
    code:      'MENUNGGU',
    desc:      'Belum ada tabung di atas timbangan. Letakkan tabung LPG yang baru datang dari SPBE untuk memulai pemeriksaan.',
  },
};

// ── Hitung status ─────────────────────────────────────────────────
function getStatus(ppm, berat) {
  if (berat < CFG.BERAT_KURANG) return 'KOSONG';
  if (ppm > CFG.PPM_BOCOR)      return 'BOCOR';
  if (berat >= CFG.BERAT_LAYAK) return 'LAYAK';
  return 'KURANG';
}

function ppmColor(ppm) {
  if (ppm <= CFG.PPM_BOCOR) return 'var(--ok)';
  if (ppm <= 600)            return 'var(--warn)';
  return 'var(--danger)';
}

function beratColor(berat) {
  if (berat >= CFG.BERAT_LAYAK)  return 'var(--ok)';
  if (berat >= CFG.BERAT_KURANG) return 'var(--warn)';
  return 'var(--idle)';
}

// ── Flash ─────────────────────────────────────────────────────────
function flash(el) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// ── Update verdict panel ──────────────────────────────────────────
function updateVerdict(status) {
  const v = VERDICT[status] || VERDICT.KOSONG;
  const panel = $('verdict-panel');
  if (panel) panel.className = 'verdict-panel ' + v.panelCls;

  const ind = $('verdict-indicator');
  if (ind) {
    ind.textContent = v.icon;
    ind.className   = 'verdict-indicator' + (status === 'BOCOR' ? ' pulsing' : '');
  }

  const code = $('verdict-code');
  if (code) code.textContent = v.code;

  const desc = $('verdict-desc');
  if (desc) desc.textContent = v.desc;
}

// ── Expose update stats ke chart.js ──────────────────────────────
let _statsInitialized = false;
export function initStatsFromHistory(records) {
  if (_statsInitialized) return;
  _statsInitialized = true;

  let layak = 0, kurang = 0, bocor = 0, total = 0;
  records.forEach(s => {
    total++;
    if (s === 'LAYAK')  layak++;
    if (s === 'KURANG') kurang++;
    if (s === 'BOCOR')  bocor++;
  });

  const setVal = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  setVal('stat-layak',  layak);
  setVal('stat-kurang', kurang);
  setVal('stat-bocor',  bocor);
  setVal('stat-total',  total);
  setVal('session-count', total);
}

// ── Listen /live ──────────────────────────────────────────────────
const liveRef = ref(db, '/live');
onValue(liveRef, (snap) => {
  const data = snap.val();
  if (!data) return;

  const berat = Number(data.berat    ?? 0);
  const isi   = Number(data.isi      ?? 0);
  const ppm   = Number(data.ppm      ?? 0);
  const suhu  = Number(data.suhu     ?? 0);
  const humid = Number(data.humidity ?? 0);

  // Nilai kartu
  const setEl = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  setEl('val-berat', berat.toFixed(2));
  setEl('val-isi',   isi.toFixed(2));
  setEl('val-ppm',   ppm.toFixed(0));
  setEl('val-suhu',  suhu.toFixed(1));
  setEl('val-humid', humid.toFixed(0));

  // Flash semua kartu
  ['val-berat','val-isi','val-ppm','val-suhu','val-humid'].forEach(id => flash($(id)));

  // Mini bar berat
  const beratPct = Math.min(100, (berat / CFG.BERAT_MAX) * 100);
  const bf = $('berat-fill');
  if (bf) { bf.style.width = beratPct + '%'; bf.style.background = beratColor(berat); }

  const isiMax  = CFG.BERAT_MAX - CFG.BERAT_TABUNG;
  const isiPct  = Math.min(100, (isi / isiMax) * 100);
  const ibf = $('isi-fill');
  if (ibf) { ibf.style.width = isiPct + '%'; ibf.style.background = beratColor(berat); }

  // Gas gauge
  const ppmPct   = Math.min(100, (ppm / CFG.PPM_MAX) * 100);
  const ppmClr   = ppmColor(ppm);
  const ppmBigEl = $('ppm-big');
  if (ppmBigEl) { ppmBigEl.textContent = ppm.toFixed(0); ppmBigEl.style.color = ppmClr; }
  const gf = $('gas-fill');
  if (gf) { gf.style.width = ppmPct + '%'; gf.style.background = ppmClr; }
  const gp = $('gas-pct');
  if (gp) gp.textContent = ppmPct.toFixed(0) + '%';

  // Berat panel
  const wv = $('weight-val');
  if (wv) { wv.textContent = berat.toFixed(2); wv.style.color = beratColor(berat); }
  const wt = $('gauge-track-berat');
  if (wt) {
    const wf = wt.querySelector('.gauge-fill');
    if (wf) { wf.style.width = beratPct + '%'; wf.style.background = beratColor(berat); }
  }
  const wp = $('weight-pct');
  if (wp) wp.textContent = beratPct.toFixed(0) + '%';

  // Verdict
  updateVerdict(getStatus(ppm, berat));

  // Timestamp
  if (data.timestamp) {
    const dt  = new Date(Number(data.timestamp));
    const el  = $('time-badge');
    if (el) el.textContent = dt.toLocaleTimeString('id-ID');
  }

  if (data.device_id) {
    const el = $('footer-device');
    if (el) el.textContent = data.device_id;
  }
});

// ── Koneksi badge ─────────────────────────────────────────────────
const connRef = ref(db, '.info/connected');
onValue(connRef, (snap) => {
  const badge = $('conn-badge');
  if (!badge) return;
  if (snap.val() === true) {
    badge.textContent = '● CONNECTED';
    badge.className   = 'hchip hchip-conn live';
  } else {
    badge.textContent = '○ OFFLINE';
    badge.className   = 'hchip hchip-conn offline';
  }
});

// ── Load history untuk stats ──────────────────────────────────────
const histRef = ref(db, '/history');
onValue(histRef, (snap) => {
  const data = snap.val();
  if (!data) return;
  const statuses = Object.values(data).map(r => (r.status ?? '').toUpperCase());
  initStatsFromHistory(statuses);
});