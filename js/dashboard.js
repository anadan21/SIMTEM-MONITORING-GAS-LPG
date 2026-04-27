/**
 * js/dashboard.js
 * Logic dashboard QC LPG Pangkalan Gas
 *
 * Membaca data dari Firebase /live secara realtime.
 * Field yang dibaca dari Firebase:
 *   berat    — berat total tabung (kg)
 *   isi      — berat isi LPG tanpa tabung (kg)
 *   ppm      — kadar gas LPG dari sensor MQ-6
 *   suhu     — suhu dari DHT22 (°C)
 *   humidity — kelembapan dari DHT22 (%RH)
 *   status   — LAYAK / KURANG / BOCOR / KOSONG
 *   timestamp, device_id
 *
 * Threshold Regulasi Pertamina tabung LPG 3 kg:
 *   BOCOR  : ppm >= 1000
 *   LAYAK  : berat >= 7.91 kg
 *   KURANG : berat >= 5.1  kg
 *   KOSONG : berat <  5.1  kg
 */

import { db } from './firebase-init.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── Shorthand ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Threshold ─────────────────────────────────────────────────────
const CFG = {
  PPM_BOCOR:    1000,
  BERAT_LAYAK:  7.91,
  BERAT_KURANG: 5.1,
  BERAT_TABUNG: 5.0,
  BERAT_MAX:    10.0,
  PPM_MAX:      5000,
};

// ── Teks per status ───────────────────────────────────────────────
const VERDICT = {
  LAYAK: {
    cls:  'v-layak',
    icon: 'LAYAK',
    code: 'LAYAK JUAL',
    desc: 'Tabung memenuhi standar Pertamina. Berat isi sesuai (≥ 7.91 kg) dan kadar gas dalam batas aman. Siap didistribusikan ke konsumen.',
  },
  KURANG: {
    cls:  'v-kurang',
    icon: 'KURANG',
    code: 'ISI KURANG',
    desc: 'Berat isi LPG di bawah standar minimum Pertamina (7.91 kg). Tabung perlu dikembalikan ke SPBE untuk pengisian ulang.',
  },
  BOCOR: {
    cls:  'v-bocor',
    icon: 'BOCOR',
    code: 'GAS BOCOR',
    desc: 'PERINGATAN: Kadar gas LPG melebihi ambang batas (≥ 1000 ppm). Tabung DILARANG DIJUAL. Jauhkan dari api dan laporkan ke SPBE.',
  },
  KOSONG: {
    cls:  'v-menunggu',
    icon: '—',
    code: 'MENUNGGU',
    desc: 'Belum ada tabung di atas timbangan. Letakkan tabung LPG yang baru datang dari SPBE untuk memulai pemeriksaan.',
  },
};

// ── Helper ────────────────────────────────────────────────────────
function getStatus(ppm, berat) {
  if (berat <= CFG.BERAT_KURANG) return 'KOSONG';
  if (ppm >= CFG.PPM_BOCOR)      return 'BOCOR';
  if (berat >= CFG.BERAT_LAYAK)  return 'LAYAK';
  return 'KURANG';
}

function ppmColor(ppm) {
  if (ppm < 500)              return 'var(--ok)';
  if (ppm < CFG.PPM_BOCOR)   return 'var(--warn)';
  return 'var(--danger)';
}

function beratColor(berat) {
  if (berat >= CFG.BERAT_LAYAK)  return 'var(--ok)';
  if (berat >  CFG.BERAT_KURANG) return 'var(--warn)';
  return 'var(--idle)';
}

function flash(el) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function setEl(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

// ── Update Verdict Panel ──────────────────────────────────────────
function updateVerdict(status) {
  const v = VERDICT[status] || VERDICT.KOSONG;
  const panel = $('verdict-panel');
  if (panel) panel.className = 'verdict-panel ' + v.cls;
  const ind = $('verdict-indicator');
  if (ind) {
    ind.textContent = v.icon;
    ind.className   = 'verdict-indicator' + (status === 'BOCOR' ? ' pulsing' : '');
  }
  setEl('verdict-code', v.code);
  setEl('verdict-desc', v.desc);
}

// ── Listen /live ──────────────────────────────────────────────────
onValue(ref(db, '/live'), (snap) => {
  const data = snap.val();
  if (!data) return;

  const berat = Number(data.berat    ?? 0);
  const isi   = Number(data.isi      ?? 0);
  const ppm   = Number(data.ppm      ?? 0);
  const suhu  = Number(data.suhu     ?? 0);
  const humid = Number(data.humidity ?? 0);

  // Update nilai kartu
  setEl('val-berat', berat.toFixed(2));
  setEl('val-isi',   isi.toFixed(2));
  setEl('val-ppm',   ppm.toFixed(0));
  setEl('val-suhu',  suhu.toFixed(1));
  setEl('val-humid', humid.toFixed(0));

  // Animasi flash
  ['val-berat','val-isi','val-ppm','val-suhu','val-humid']
    .forEach(id => flash($(id)));

  // Mini bar berat total
  const beratPct = Math.min(100, (berat / CFG.BERAT_MAX) * 100);
  const bf = $('berat-fill');
  if (bf) { bf.style.width = beratPct + '%'; bf.style.background = beratColor(berat); }

  // Mini bar berat isi
  const isiPct = Math.min(100, (isi / (CFG.BERAT_MAX - CFG.BERAT_TABUNG)) * 100);
  const ibf = $('isi-fill');
  if (ibf) { ibf.style.width = isiPct + '%'; ibf.style.background = beratColor(berat); }

  // Gas gauge
  const ppmPct = Math.min(100, (ppm / CFG.PPM_MAX) * 100);
  const ppmClr = ppmColor(ppm);
  const ppmBig = $('ppm-big');
  if (ppmBig) { ppmBig.textContent = ppm.toFixed(0); ppmBig.style.color = ppmClr; }
  const gf = $('gas-fill');
  if (gf)  { gf.style.width = ppmPct + '%'; gf.style.background = ppmClr; }
  setEl('gas-pct', ppmPct.toFixed(0) + '%');

  // Berat gauge
  const wv = $('weight-val');
  if (wv) { wv.textContent = berat.toFixed(2) + ' kg'; wv.style.color = beratColor(berat); }
  const wTrack = $('gauge-track-berat');
  if (wTrack) {
    const wf = wTrack.querySelector('.gauge-fill');
    if (wf) { wf.style.width = beratPct + '%'; wf.style.background = beratColor(berat); }
  }
  setEl('weight-pct', beratPct.toFixed(0) + '%');

  // Verdict
  updateVerdict(getStatus(ppm, berat));

  // Timestamp
  if (data.timestamp) {
    const dt = new Date(Number(data.timestamp));
    setEl('time-badge', dt.toLocaleTimeString('id-ID'));
  }

  // Device ID
  if (data.device_id) setEl('footer-device', data.device_id);
});

// ── Koneksi badge ─────────────────────────────────────────────────
onValue(ref(db, '.info/connected'), (snap) => {
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

// ── Stats dari /history ───────────────────────────────────────────
let statsLoaded = false;
onValue(ref(db, '/history'), (snap) => {
  if (statsLoaded) return;
  statsLoaded = true;
  const data = snap.val();
  if (!data) return;

  let layak = 0, kurang = 0, bocor = 0, total = 0;
  Object.values(data).forEach(r => {
    total++;
    const s = (r.status ?? '').toUpperCase();
    if (s === 'LAYAK')  layak++;
    if (s === 'KURANG') kurang++;
    if (s === 'BOCOR')  bocor++;
  });

  setEl('stat-layak',    layak);
  setEl('stat-kurang',   kurang);
  setEl('stat-bocor',    bocor);
  setEl('stat-total',    total);
  setEl('session-count', total);
});