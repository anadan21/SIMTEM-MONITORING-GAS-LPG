import { db } from './firebase-init.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const $ = id => document.getElementById(id);

// ================= CONFIG =================
const CFG = {
  PPM_BOCOR:    50,
  BERAT_LAYAK:  7.91,
  BERAT_KURANG: 5.1,
  BERAT_TABUNG: 5.0,
  BERAT_MAX:    10.0,
  PPM_MAX:      2000,
};

// ================= STATUS =================
const VERDICT = {
  LAYAK: {
    cls:  'v-layak',
    icon: 'LAYAK',
    code: 'LAYAK JUAL',
    desc: 'Tabung aman dan sesuai standar.',
  },
  KURANG: {
    cls:  'v-kurang',
    icon: 'KURANG',
    code: 'ISI KURANG',
    desc: 'Isi LPG kurang dari standar.',
  },
  BOCOR: {
    cls:  'v-bocor',
    icon: 'BOCOR',
    code: 'GAS BOCOR',
    desc: 'TERDETEKSI KEBOCORAN GAS!',
  },
  KOSONG: {
    cls:  'v-menunggu',
    icon: '—',
    code: 'MENUNGGU',
    desc: 'Letakkan tabung.',
  },
};

// ================= HELPER =================
function getStatus(ppm, berat) {
  if (berat <= CFG.BERAT_KURANG) return 'KOSONG';
  if (ppm >= CFG.PPM_BOCOR)      return 'BOCOR';
  if (berat >= CFG.BERAT_LAYAK)  return 'LAYAK';
  return 'KURANG';
}

function ppmColor(ppm) {
  if (ppm < 20) return 'var(--ok)';
  if (ppm < CFG.PPM_BOCOR) return 'var(--warn)';
  return 'var(--danger)';
}

function beratColor(berat) {
  if (berat >= CFG.BERAT_LAYAK) return 'var(--ok)';
  if (berat > CFG.BERAT_KURANG) return 'var(--warn)';
  return 'var(--idle)';
}

function setEl(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

// ================= VERDICT =================
function updateVerdict(status) {
  const v = VERDICT[status] || VERDICT.KOSONG;

  const panel = $('verdict-panel');
  if (panel) panel.className = 'verdict-panel ' + v.cls;

  const ind = $('verdict-indicator');
  if (ind) {
    ind.textContent = v.icon;
    ind.className = 'verdict-indicator' + (status === 'BOCOR' ? ' pulsing' : '');
  }

  setEl('verdict-code', v.code);
  setEl('verdict-desc', v.desc);
}

// ================= REALTIME =================
onValue(ref(db, '/live'), (snap) => {
  const data = snap.val();
  if (!data) return;

  // ✅ FIX: parsing aman
  const berat = parseFloat(data.berat)    || 0;
  const isi   = parseFloat(data.isi)      || 0;
  const ppm   = parseFloat(data.ppm)      || 0;
  const suhu  = parseFloat(data.suhu)     || 0;
  const humid = parseFloat(data.humidity) || 0;

  // ===== TEXT =====
  setEl('val-berat', berat.toFixed(2));
  setEl('val-isi',   isi.toFixed(2));
  setEl('val-ppm',   ppm.toFixed(0));
  setEl('val-suhu',  suhu.toFixed(1));
  setEl('val-humid', humid.toFixed(0));

  // ===== GAS =====
  const ppmPct = Math.min(100, (ppm / CFG.PPM_MAX) * 100);
  const clr = ppmColor(ppm);

  const ppmBig = $('ppm-big');
  if (ppmBig) {
    ppmBig.textContent = ppm.toFixed(0);
    ppmBig.style.color = clr;
  }

  const gf = $('gas-fill');
  if (gf) {
    gf.style.width = ppmPct + '%';
    gf.style.background = clr;
  }

  setEl('gas-pct', ppmPct.toFixed(0) + '%');

  // ===== BERAT =====
  const beratPct = Math.min(100, (berat / CFG.BERAT_MAX) * 100);

  const wf = document.querySelector('#gauge-track-berat .gauge-fill');
  if (wf) {
    wf.style.width = beratPct + '%';
    wf.style.background = beratColor(berat);
  }

  setEl('weight-val', berat.toFixed(2) + ' kg');
  setEl('weight-pct', beratPct.toFixed(0) + '%');

  // ===== STATUS =====
  updateVerdict(getStatus(ppm, berat));

  // ===== TIME (FIX NTP) =====
  if (data.timestamp) {
    let time = Number(data.timestamp);

    // kalau masih millis dari ESP lama
    if (time < 10000000000) {
      time = Date.now();
    }

    const t = new Date(time);
    if (!isNaN(t)) {
      setEl('time-badge', t.toLocaleTimeString('id-ID'));
    }
  }

  // ===== DEVICE =====
  if (data.device_id) {
    setEl('footer-device', data.device_id);
  }
});

// ================= CONNECT =================
onValue(ref(db, '.info/connected'), (snap) => {
  const badge = $('conn-badge');
  if (!badge) return;

  if (snap.val()) {
    badge.textContent = '● ONLINE';
    badge.className   = 'hchip hchip-conn live';
  } else {
    badge.textContent = '○ OFFLINE';
    badge.className   = 'hchip hchip-conn offline';
  }
});

// ================= HISTORY (REALTIME FIX) =================
onValue(ref(db, '/history'), (snap) => {
  const data = snap.val();
  if (!data) return;

  let layak = 0, kurang = 0, bocor = 0, total = 0;

  Object.values(data).forEach(r => {
    total++;
    const s = (r.status || '').toUpperCase();

    if (s === 'LAYAK')  layak++;
    if (s === 'KURANG') kurang++;
    if (s === 'BOCOR')  bocor++;
  });

  setEl('stat-layak', layak);
  setEl('stat-kurang', kurang);
  setEl('stat-bocor', bocor);
  setEl('stat-total', total);
  setEl('session-count', total);
});