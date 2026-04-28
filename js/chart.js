import { db } from './firebase-init.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const MAX_POINTS = 30;

const DATASETS = {
  ppm:   { label: 'PPM Gas (MQ-6)', color: 'warn-light', unit: 'ppm', yMax: 200 },
  berat: { label: 'Berat Total',    color: 'ok-light', unit: 'kg',  yMax: 10  },
  suhu:  { label: 'Suhu',           color: 'accent-light', unit: '°C',  yMax: 50  },
  humid: { label: 'Kelembapan',     color: 'accent', unit: '%',   yMax: 100 },
};

let activeTab = 'ppm';
let chartInstance = null;

const history = {
  labels: [],
  ppm: [],
  berat: [],
  suhu: [],
  humid: []
};

// ================= HELPER =================
function safeNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function getThemeColor(varName) {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return style.getPropertyValue('--' + varName).trim();
}

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ================= OPTIONS =================
function buildOptions(cfg) {
  const textColor = getThemeColor('text-3');
  const gridColor = getThemeColor('border');
  const bgColor = getThemeColor('surface-2');
  
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 150 },

    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: bgColor,
        titleColor: textColor,
        bodyColor: getThemeColor('text-2'),
        borderColor: getThemeColor('border-2'),
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: ctx => ` ${ctx.parsed.y} ${cfg.unit}`
        }
      }
    },

    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: textColor, maxTicksLimit: 6 }
      },
      y: {
        min: 0,
        max: cfg.yMax,
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          callback: v => v + ' ' + cfg.unit
        }
      }
    }
  };
}

// ================= INIT =================
function initChart() {
  const canvas = document.getElementById('realtime-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const cfg = DATASETS[activeTab];
  const color = getThemeColor(cfg.color);

  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: history.labels,
      datasets: [{
        label: cfg.label,
        data: history[activeTab],
        borderColor: color,
        backgroundColor: hexToRGBA(color, 0.08),
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.35,
        fill: true
      }]
    },
    options: buildOptions(cfg)
  });
}

// ================= SWITCH TAB =================
function switchTab(tab) {
  if (tab === activeTab || !chartInstance) return;

  activeTab = tab;
  const cfg = DATASETS[tab];
  const color = getThemeColor(cfg.color);

  const ds = chartInstance.data.datasets[0];
  ds.label = cfg.label;
  ds.data = history[tab];
  ds.borderColor = color;
  ds.backgroundColor = hexToRGBA(color, 0.08);

  chartInstance.options = buildOptions(cfg);
  chartInstance.update('none'); // 🔥 smooth
}

// ================= PUSH DATA =================
function pushData(data) {

  let ts = Number(data.timestamp);

  // 🔥 FIX timestamp fallback
  if (!ts || ts < 10000000000) {
    ts = Date.now();
  }

  const dt = new Date(ts);

  const label = dt.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  history.labels.push(label);
  history.ppm.push(safeNum(data.ppm));
  history.berat.push(safeNum(data.berat));
  history.suhu.push(safeNum(data.suhu));
  history.humid.push(safeNum(data.humidity));

  if (history.labels.length > MAX_POINTS) {
    ['labels','ppm','berat','suhu','humid'].forEach(k => history[k].shift());
  }

  if (chartInstance) {
    chartInstance.data.labels = history.labels;
    chartInstance.data.datasets[0].data = history[activeTab];

    chartInstance.update('none'); // 🔥 FIX smooth realtime
  }
}

// ================= REALTIME =================
onValue(ref(db, '/live'), snap => {
  const data = snap.val();
  if (data) pushData(data);
});

// ================= GLOBAL =================
window.switchChartTab = function(tab) {
  switchTab(tab);

  document.querySelectorAll('.ctab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
};

// ================= INIT =================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChart);
} else {
  initChart();
}