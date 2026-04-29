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
  ROWS_PER_PAGE: 10,
};

// ================= PAGINATION STATE =================
let currentPage = 1;
let filteredData = [];
let statusChart = null;
let historyData = {};
let stats = { layak: 0, kurang: 0, bocor: 0, total: 0 };

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

// ================= STATUS =================
const VERDICT = {
  LAYAK: { cls: 'v-layak', icon: 'LAYAK', code: 'LAYAK JUAL', desc: 'Tabung aman dan sesuai standar.' },
  KURANG: { cls: 'v-kurang', icon: 'KURANG', code: 'ISI KURANG', desc: 'Isi LPG kurang dari standar.' },
  BOCOR: { cls: 'v-bocor', icon: 'BOCOR', code: 'GAS BOCOR', desc: 'TERDETEKSI KEBOCORAN GAS!' },
  KOSONG: { cls: 'v-menunggu', icon: '—', code: 'MENUNGGU', desc: 'Letakkan tabung.' },
};

// ================= HELPER =================
function getStatus(ppm, berat) {
  if (berat <= CFG.BERAT_KURANG) return 'KOSONG';
  if (ppm >= CFG.PPM_BOCOR) return 'BOCOR';
  if (berat >= CFG.BERAT_LAYAK) return 'LAYAK';
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

function getThemeColor(varName) {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return style.getPropertyValue('--' + varName).trim();
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

// ================= REALTIME DATA =================
onValue(ref(db, '/live'), (snap) => {
  const data = snap.val();
  if (!data) return;

  const berat = parseFloat(data.berat) || 0;
  const isi = parseFloat(data.isi) || 0;
  const ppm = parseFloat(data.ppm) || 0;
  const suhu = parseFloat(data.suhu) || 0;
  const humid = parseFloat(data.humidity) || 0;

  setEl('val-berat', berat.toFixed(2));
  setEl('val-isi', isi.toFixed(2));
  setEl('val-ppm', ppm.toFixed(0));
  setEl('val-suhu', suhu.toFixed(1));
  setEl('val-humid', humid.toFixed(0));

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

  const beratPct = Math.min(100, (berat / CFG.BERAT_MAX) * 100);
  const wf = document.querySelector('#gauge-track-berat .gauge-fill');
  if (wf) {
    wf.style.width = beratPct + '%';
    wf.style.background = beratColor(berat);
  }

  setEl('weight-val', berat.toFixed(2) + ' kg');
  setEl('weight-pct', beratPct.toFixed(0) + '%');

  updateVerdict(getStatus(ppm, berat));

  if (data.timestamp) {
    let time = Number(data.timestamp);
    if (time < 10000000000) time = Date.now();
    const t = new Date(time);
    if (!isNaN(t)) setEl('time-badge', t.toLocaleTimeString('id-ID'));
  }

  if (data.device_id) setEl('footer-device', data.device_id);
});

// ================= CONNECTION STATUS =================
onValue(ref(db, '.info/connected'), (snap) => {
  const badge = $('conn-badge');
  if (!badge) return;

  if (snap.val()) {
    badge.textContent = '● ONLINE';
    badge.className = 'hchip hchip-conn live';
  } else {
    badge.textContent = '○ OFFLINE';
    badge.className = 'hchip hchip-conn offline';
  }
});

// ================= HISTORY DATA =================
onValue(ref(db, '/history'), (snap) => {
  const data = snap.val();
  if (!data) return;

  historyData = data;
  stats = { layak: 0, kurang: 0, bocor: 0, total: 0 };

  Object.values(data).forEach(r => {
    stats.total++;
    const s = (r.status || '').toUpperCase();
    if (s === 'LAYAK') stats.layak++;
    if (s === 'KURANG') stats.kurang++;
    if (s === 'BOCOR') stats.bocor++;
  });

  // Update summary stats
  setEl('summary-total', stats.total);
  setEl('summary-layak', stats.layak);
  setEl('summary-kurang', stats.kurang);
  setEl('summary-bocor', stats.bocor);

  // Update chart
  updateStatusChart();

  // Render table
  currentPage = 1;
  applyFiltersAndRender();

  // ✅ Display latest history data on dashboard if live data not available yet
  const latestEntry = Object.entries(data)
    .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))[0];
  
  if (latestEntry) {
    const record = latestEntry[1];
    const berat = parseFloat(record.berat) || 0;
    const isi = parseFloat(record.isi) || 0;
    const ppm = parseFloat(record.ppm) || 0;
    const suhu = parseFloat(record.suhu) || 0;
    const humid = parseFloat(record.humidity) || 0;

    // Update sensor display with latest history data
    setEl('val-berat', berat.toFixed(2));
    setEl('val-isi', isi.toFixed(2));
    setEl('val-ppm', ppm.toFixed(0));
    setEl('val-suhu', suhu.toFixed(1));
    setEl('val-humid', humid.toFixed(0));
    
    // Update session count
    setEl('session-count', stats.total);
  }
});

// ================= TABLE FUNCTIONS =================
function getHistoryTableData() {
  const rows = [];
  let index = 1;

  Object.entries(historyData)
    .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))
    .forEach(([key, record]) => {
      rows.push({
        index: index++,
        timestamp: record.timestamp,
        berat: parseFloat(record.berat || 0),
        isi: parseFloat(record.isi || 0),
        ppm: parseFloat(record.ppm || 0),
        suhu: parseFloat(record.suhu || 0),
        humidity: parseFloat(record.humidity || 0),
        status: (record.status || '—').toUpperCase(),
        formattedDate: formatDate(record.timestamp)
      });
    });

  return rows;
}

function applyFiltersAndRender() {
  const searchText = $('search-input')?.value?.toLowerCase() || '';
  const statusFilter = $('filter-status')?.value || '';

  const allData = getHistoryTableData();

  filteredData = allData.filter(row => {
    const matchSearch = !searchText || 
      row.formattedDate.toLowerCase().includes(searchText) ||
      row.status.toLowerCase().includes(searchText) ||
      row.berat.toString().includes(searchText) ||
      row.ppm.toString().includes(searchText);

    const matchStatus = !statusFilter || row.status === statusFilter;

    return matchSearch && matchStatus;
  });

  currentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = $('table-body');
  if (!tbody) return;

  if (filteredData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-3);">
          <i class="fas fa-inbox" style="font-size: 32px; margin-bottom: 10px;"></i><br>
          Tidak ada data
        </td>
      </tr>
    `;
    updatePaginationUI();
    return;
  }

  const startIdx = (currentPage - 1) * CFG.ROWS_PER_PAGE;
  const endIdx = startIdx + CFG.ROWS_PER_PAGE;
  const pageData = filteredData.slice(startIdx, endIdx);

  tbody.innerHTML = pageData.map(row => {
    const statusClass = row.status.toLowerCase();
    return `
      <tr>
        <td>${row.index}</td>
        <td>${row.formattedDate}</td>
        <td>${row.berat.toFixed(2)}</td>
        <td>${row.isi.toFixed(2)}</td>
        <td>${row.ppm.toFixed(0)}</td>
        <td>${row.suhu.toFixed(1)}</td>
        <td>${row.humidity.toFixed(0)}</td>
        <td><span class="status-badge ${statusClass}">${row.status}</span></td>
      </tr>
    `;
  }).join('');

  updatePaginationUI();
}

function updatePaginationUI() {
  const totalPages = Math.ceil(filteredData.length / CFG.ROWS_PER_PAGE);
  const startIdx = (currentPage - 1) * CFG.ROWS_PER_PAGE + 1;
  const endIdx = Math.min(currentPage * CFG.ROWS_PER_PAGE, filteredData.length);

  setEl('pagination-start', filteredData.length === 0 ? 0 : startIdx);
  setEl('pagination-end', endIdx);
  setEl('pagination-total', filteredData.length);
  setEl('current-page', currentPage);
  setEl('total-pages', totalPages);

  const prevBtn = $('prev-btn');
  const nextBtn = $('next-btn');
  if (prevBtn) prevBtn.disabled = currentPage === 1;
  if (nextBtn) nextBtn.disabled = currentPage === totalPages || totalPages === 0;
}

window.previousPage = function() {
  if (currentPage > 1) {
    currentPage--;
    renderTable();
    window.scrollTo(0, 0);
  }
};

window.nextPage = function() {
  const totalPages = Math.ceil(filteredData.length / CFG.ROWS_PER_PAGE);
  if (currentPage < totalPages) {
    currentPage++;
    renderTable();
    window.scrollTo(0, 0);
  }
};

// ================= SEARCH & FILTER =================
const searchInput = $('search-input');
const filterStatus = $('filter-status');

if (searchInput) {
  searchInput.addEventListener('input', () => applyFiltersAndRender());
}

if (filterStatus) {
  filterStatus.addEventListener('change', () => applyFiltersAndRender());
}

// ================= STATUS CHART =================
function updateStatusChart() {
  if (!window.Chart) return;

  const canvas = $('summary-chart-status');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  if (statusChart) {
    statusChart.data.datasets[0].data = [stats.layak, stats.kurang, stats.bocor];
    statusChart.update();
  } else {
    statusChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Layak', 'Kurang', 'Bocor'],
        datasets: [{
          data: [stats.layak, stats.kurang, stats.bocor],
          backgroundColor: [
            getThemeColor('ok-light'),
            getThemeColor('warn-light'),
            getThemeColor('danger-light')
          ],
          borderColor: getThemeColor('surface'),
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: getThemeColor('text-3'),
              padding: 15,
              font: { size: 12, weight: 'bold' }
            }
          }
        }
      }
    });
  }
}

// ================= EXPORT FUNCTIONS =================
function getExportData() {
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
  alert('Gunakan Unduh CSV untuk mengunduh data');
};

window.exportToExcel = function() {
  alert('Gunakan Unduh CSV untuk mengunduh data');
};

window.exportToCSV = function() {
  const data = getExportData();
  if (!data) return;

  try {
    const headers = Object.keys(data[0]);
    const rows = data.map(row => 
      headers.map(header => {
        const val = row[header];
        const escaped = String(val).replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(',')
    );
    
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `QC-LPG-${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Gagal mengunduh CSV: ' + err.message);
  }
};

// ================= SWITCH CHART TAB =================
window.switchChartTab = function(tab) {
  const tabButtons = document.querySelectorAll('.ctab');
  tabButtons.forEach(btn => btn.classList.remove('active'));
  
  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (activeBtn) activeBtn.classList.add('active');
};
