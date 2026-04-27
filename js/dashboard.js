/**
 * js/dashboard.js
 * Logic dashboard QC LPG Pangkalan Gas
 *
 * Konteks sistem:
 *   Tabung LPG 3 kg datang dari SPBE → diletakkan di timbangan
 *   → ESP32 timbang + baca PPM gas (sensor MQ-6)
 *   → Dashboard tampilkan kondisi tabung secara realtime
 *   → Saat tabung diangkat → hasil otomatis terkirim ke Spreadsheet
 *
 * Threshold (Regulasi Pertamina tabung LPG 3 kg):
 *   Berat tabung kosong  : 5.0  kg
 *   Berat total ideal    : 8.0  kg
 *   Berat minimum LAYAK  : 7.91 kg (toleransi 90 gram dari standar 8 kg)
 *   Batas KURANG ISI     : > 5.1 kg (ada isi tapi di bawah standar)
 *   KOSONG               : <= 5.1 kg (hanya tabung kosong)
 *
 * Ambang batas gas MQ-6 (ppm LPG):
 *   Normal (aman)        : < 1000 ppm
 *   BOCOR                : >= 1000 ppm
 *   Referensi: OSHA & standar industri LPG
 *              LEL LPG = 18.000 ppm, alarm awal di 10% LEL = 1800 ppm
 *              Praktis di lapangan: 1000 ppm sudah perlu tindakan
 */

import { db } from './firebase-init.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const $ = id => document.getElementById(id);

// ── Threshold — HARUS SAMA dengan code_arduino.cpp ───────────────
const CFG = {
  PPM_BOCOR:    1000,   // ppm — ambang batas bocor MQ-6 output nyata
  BERAT_LAYAK:  7.91,   // kg  — batas minimum layak jual (Pertamina)
  BERAT_KURANG: 5.1,    // kg  — batas bawah ada isi LPG
  BERAT_TABUNG: 5.0,    // kg  — berat tabung kosong
  BERAT_MAX:    10.0,   // kg  — skala maksimum gauge
  PPM_MAX:      5000,   // ppm — skala maksimum gauge
};

// ── Konfigurasi teks per status ───────────────────────────────────
const VERDICT = {
  LAYAK: {
    panelCls: 'v-layak',
    icon:     'LAYAK',
    code:     'LAYAK JUAL',
    desc:     'Tabung memenuhi standar Pertamina. Berat isi sesuai (>= 7.91 kg) dan kadar gas dalam batas aman. Tabung siap didistribusikan ke konsumen.',
  },
  KURANG: {
    panelCls: 'v-kurang',
    icon:     'KURANG',
    code:     'ISI KURANG',
    desc:     'Berat isi LPG di bawah standar minimum Pertamina (7.91 kg). Tabung perlu dikembalikan ke SPBE untuk pengisian ulang sebelum dijual.',
  },
  BOCOR: {
    panelCls: 'v-bocor',
    icon:     'BOCOR',
    code:     'GAS BOCOR',
    desc:     'PERINGATAN: Kadar gas LPG terdeteksi melebihi ambang batas (>= 1000 ppm). Tabung DILARANG DIJUAL. Amankan tabung, jauhkan dari api, dan laporkan ke SPBE.',
  },
  KOSONG: {
    panelCls: 'v-menunggu',
    icon:     '—',
    code:     'MENUNGGU',
    desc:     'Belum ada tabung di atas timbangan. Letakkan tabung LPG yang baru datang dari SPBE untuk memulai pemeriksaan kualitas.',
  },
};

function getStatus(ppm, berat) {
  if (berat <= CFG.BERAT_KURANG) return 'KOSONG';
  if (ppm >= CFG.PPM_BOCOR)      return 'BOCOR';
  if (berat >= CFG.BERAT_LAYAK)  return 'LAYAK';
  return 'KURANG';
}

function ppmColor(ppm) {
  if (ppm < CFG.PPM_BOCOR * 0.5) return 'var(--ok)';    // < 500 ppm — aman
  if (ppm < CFG.PPM_BOCOR)       return 'var(--warn)';  // 500-999 ppm — waspada
  return 'var(--danger)';                                 // >= 1000 ppm — bocor
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

// ── Listen /live realtime ─────────────────────────────────────────
const liveRef = ref(db, '/live');
onValue(liveRef, (snap) => {
  const data = snap.val();
  if (!data) return;

  const berat = Number(data.berat    ?? 0);
  const isi   = Number(data.isi      ?? 0);
  const ppm   = Number(data.ppm      ?? 0);
  const suhu  = Number(data.suhu     ?? 0);
  const humid = Number(data.humidity ?? 0);

  // Update kartu nilai
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('val-berat', berat.toFixed(2));
  set('val-isi',   isi.toFixed(2));
  set('val-ppm',   ppm.toFixed(0));
  set('val-suhu',  suhu.toFixed(1));
  set('val-humid', humid.toFixed(0));

  ['val-berat','val-isi','val-ppm','val-suhu','val-humid'].forEach(id => flash($(id)));

  // Mini bar berat
  const beratPct = Math.min(100, (berat / CFG.BERAT_MAX) * 100);
  const bf = $('berat-fill');
  if (bf) { bf.style.width = beratPct + '%'; bf.style.background = beratColor(berat); }

  const isiMax = CFG.BERAT_MAX - CFG.BERAT_TABUNG;
  const isiPct = Math.min(100, (isi / isiMax) * 100);
  const ibf = $('isi-fill');
  if (ibf) { ibf.style.width = isiPct + '%'; ibf.style.background = beratColor(berat); }

  // Gas gauge
  const ppmPct = Math.min(100, (ppm / CFG.PPM_MAX) * 100);
  const ppmClr = ppmColor(ppm);
  const ppmBig = $('ppm-big');
  if (ppmBig) { ppmBig.textContent = ppm.toFixed(0); ppmBig.style.color = ppmClr; }
  const gf = $('gas-fill');
  if (gf) { gf.style.width = ppmPct + '%'; gf.style.background = ppmClr; }
  const gp = $('gas-pct');
  if (gp) gp.textContent = ppmPct.toFixed(0) + '%';

  // Berat gauge
  const wv = $('weight-val');
  if (wv) { wv.textContent = berat.toFixed(2) + ' kg'; wv.style.color = beratColor(berat); }
  const wTrack = $('gauge-track-berat');
  if (wTrack) {
    const wf = wTrack.querySelector('.gauge-fill');
    if (wf) { wf.style.width = beratPct + '%'; wf.style.background = beratColor(berat); }
  }
  const wp = $('weight-pct');
  if (wp) wp.textContent = beratPct.toFixed(0) + '%';

  // Verdict
  updateVerdict(getStatus(ppm, berat));

  // Timestamp
  if (data.timestamp) {
    const dt = new Date(Number(data.timestamp));
    const tb = $('time-badge');
    if (tb) tb.textContent = dt.toLocaleTimeString('id-ID');
  }

  const fd = $('footer-device');
  if (fd && data.device_id) fd.textContent = data.device_id;
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

  const setVal = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setVal('stat-layak',    layak);
  setVal('stat-kurang',   kurang);
  setVal('stat-bocor',    bocor);
  setVal('stat-total',    total);
  setVal('session-count', total);
});