import { db } from './firebase-init.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const $ = id => document.getElementById(id);

// ================= THEME TOGGLE =================
function initThemeToggle() {
  const toggle = $('theme-toggle');
  if (!toggle) return;

  // Load theme preference from localStorage
  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);

  // Toggle button click handler
  toggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    const toggle = $('theme-toggle');
    if (toggle) {
      toggle.innerHTML = '<i class="fas fa-sun"></i>';
      toggle.title = 'Switch to Dark Mode';
    }
  } else {
    document.documentElement.removeAttribute('data-theme');
    const toggle = $('theme-toggle');
    if (toggle) {
      toggle.innerHTML = '<i class="fas fa-moon"></i>';
      toggle.title = 'Switch to Light Mode';
    }
  }
}

// Initialize theme on page load
initThemeToggle();

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
let historyData = {};

onValue(ref(db, '/history'), (snap) => {
  const data = snap.val();
  if (!data) return;

  historyData = data;

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

  // Update export stats
  setEl('export-total', total);
  setEl('export-layak', layak);
  setEl('export-kurang', kurang);
  setEl('export-bocor', bocor);
});

// ================= EXPORT FUNCTIONS =================
function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('id-ID', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getHistoryTableData() {
  if (!historyData || Object.keys(historyData).length === 0) {
    alert('Tidak ada data untuk diunduh');
    return null;
  }

  const rows = [];
  let index = 1;

  Object.entries(historyData)
    .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))
    .forEach(([key, record]) => {
      rows.push({
        'No.': index++,
        'Tanggal Waktu': formatDate(record.timestamp),
        'Berat (kg)': parseFloat(record.berat || 0).toFixed(2),
        'Isi (kg)': parseFloat(record.isi || 0).toFixed(2),
        'Gas PPM': parseFloat(record.ppm || 0).toFixed(0),
        'Suhu (°C)': parseFloat(record.suhu || 0).toFixed(1),
        'Kelembapan (%)': parseFloat(record.humidity || 0).toFixed(0),
        'Status': record.status?.toUpperCase() || '—'
      });
    });

  return rows;
}

window.exportToPDF = function() {
  const data = getHistoryTableData();
  if (!data) return;

  const element = document.createElement('div');
  element.style.padding = '20px';
  element.style.fontFamily = 'Arial, sans-serif';
  
  // Header
  const header = `
    <h1 style="text-align: center; color: #1a2540; margin-bottom: 10px;">Laporan QC Tabung Gas LPG</h1>
    <p style="text-align: center; color: #666; margin-bottom: 20px;">Pangkalan Gas LPG - ${new Date().toLocaleDateString('id-ID')}</p>
    <hr style="border: 1px solid #ddd; margin-bottom: 20px;">
  `;

  // Summary stats
  const stats = `
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;">
      <div style="border: 1px solid #ddd; padding: 10px; text-align: center;">
        <strong style="color: #666;">Total Data</strong><br>
        <span style="font-size: 18px; font-weight: bold; color: #5b5cef;">${data.length}</span>
      </div>
      <div style="border: 1px solid #ddd; padding: 10px; text-align: center;">
        <strong style="color: #666;">Layak</strong><br>
        <span style="font-size: 18px; font-weight: bold; color: #10b981;">${data.filter(d => d['Status'] === 'LAYAK').length}</span>
      </div>
      <div style="border: 1px solid #ddd; padding: 10px; text-align: center;">
        <strong style="color: #666;">Kurang</strong><br>
        <span style="font-size: 18px; font-weight: bold; color: #f97316;">${data.filter(d => d['Status'] === 'KURANG').length}</span>
      </div>
      <div style="border: 1px solid #ddd; padding: 10px; text-align: center;">
        <strong style="color: #666;">Bocor</strong><br>
        <span style="font-size: 18px; font-weight: bold; color: #ef4444;">${data.filter(d => d['Status'] === 'BOCOR').length}</span>
      </div>
    </div>
  `;

  // Table
  let table = '<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;"><thead>';
  table += '<tr style="background-color: #5b5cef; color: white;">';
  Object.keys(data[0]).forEach(key => {
    table += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px;">${key}</th>`;
  });
  table += '</tr></thead><tbody>';

  data.forEach((row, i) => {
    const bgColor = i % 2 === 0 ? '#fff' : '#f9f9f9';
    table += `<tr style="background-color: ${bgColor};">`;
    Object.values(row).forEach(val => {
      table += `<td style="border: 1px solid #ddd; padding: 8px; font-size: 11px;">${val}</td>`;
    });
    table += '</tr>';
  });

  table += '</tbody></table>';

  element.innerHTML = header + stats + table;

  const opt = {
    margin: 10,
    filename: `QC-LPG-${new Date().getTime()}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { orientation: 'landscape', unit: 'mm', format: 'a4' }
  };

  html2pdf().set(opt).from(element).save();
};

window.exportToExcel = function() {
  const data = getHistoryTableData();
  if (!data) return;

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);

  // Style header
  const headerRange = XLSX.utils.decode_range(worksheet['!ref']);
  for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    worksheet[cellAddress].s = {
      fill: { fgColor: { rgb: 'FF5B5CEF' } },
      font: { bold: true, color: { rgb: 'FFFFFFFF' } }
    };
  }

  // Set column widths
  const colWidths = [
    { wch: 5 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 }
  ];
  worksheet['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(workbook, worksheet, 'History');
  XLSX.writeFile(workbook, `QC-LPG-${new Date().getTime()}.xlsx`);
};

window.exportToCSV = function() {
  const data = getHistoryTableData();
  if (!data) return;

  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(row => 
    Object.values(row).map(val => `"${val}"`).join(',')
  );
  
  const csv = [headers, ...rows].join('\\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `QC-LPG-${new Date().getTime()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};