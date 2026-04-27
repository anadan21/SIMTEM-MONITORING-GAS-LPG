/**
 * js/chart.js
 * Grafik realtime — PPM, Berat, Suhu, Kelembapan
 * Setiap update /live dari Firebase langsung dipush ke grafik
 * Library: Chart.js 4 (CDN di index.html)
 */

import { db } from './firebase-init.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const MAX_POINTS = 30;

const DATASETS = {
  ppm: {
    label: 'PPM Gas (MQ-6)',
    color: '#fbbf24',
    field: 'ppm',
    unit:  'ppm',
    yMax:  5000,
  },
  berat: {
    label: 'Berat Total',
    color: '#22c55e',
    field: 'berat',
    unit:  'kg',
    yMax:  10,
  },
  suhu: {
    label: 'Suhu',
    color: '#38bdf8',
    field: 'suhu',
    unit:  '°C',
    yMax:  50,
  },
  humid: {
    label: 'Kelembapan',
    color: '#a78bfa',
    field: 'humidity',
    unit:  '%',
    yMax:  100,
  },
};

let activeTab     = 'ppm';
let chartInstance = null;
const history = { labels: [], ppm: [], berat: [], suhu: [], humid: [] };

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildOptions(cfg) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1c2330',
        titleColor: '#8899aa',
        bodyColor:  '#f0f4f8',
        borderColor:'rgba(255,255,255,0.06)',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: ctx => ` ${ctx.parsed.y} ${cfg.unit}`,
        },
      },
    },
    scales: {
      x: {
        grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        ticks: { color: '#445566', font: { family: "'Share Tech Mono'", size: 9 }, maxRotation: 0, maxTicksLimit: 8 },
      },
      y: {
        min: 0, max: cfg.yMax,
        grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        ticks: { color: '#445566', font: { family: "'Share Tech Mono'", size: 9 }, callback: v => v + ' ' + cfg.unit },
      },
    },
  };
}

function initChart() {
  const canvas = document.getElementById('realtime-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const cfg = DATASETS[activeTab];
  chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels:   history.labels,
      datasets: [{
        label:                cfg.label,
        data:                 history[activeTab],
        borderColor:          cfg.color,
        backgroundColor:      hexToRGBA(cfg.color, 0.07),
        borderWidth:          2,
        pointRadius:          2.5,
        pointHoverRadius:     5,
        pointBackgroundColor: cfg.color,
        pointBorderColor:     'transparent',
        tension:              0.4,
        fill:                 true,
      }],
    },
    options: buildOptions(cfg),
  });
}

function switchTab(tab) {
  if (tab === activeTab || !chartInstance) return;
  activeTab = tab;
  const cfg = DATASETS[tab];
  const ds  = chartInstance.data.datasets[0];
  ds.label           = cfg.label;
  ds.data            = history[tab];
  ds.borderColor     = cfg.color;
  ds.backgroundColor = hexToRGBA(cfg.color, 0.07);
  ds.pointBackgroundColor = cfg.color;
  chartInstance.options = buildOptions(cfg);
  chartInstance.update('none');
}

function pushData(data) {
  const dt    = new Date(Number(data.timestamp ?? Date.now()));
  const label = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  history.labels.push(label);
  history.ppm.push(Number(data.ppm      ?? 0));
  history.berat.push(Number(data.berat  ?? 0));
  history.suhu.push(Number(data.suhu    ?? 0));
  history.humid.push(Number(data.humidity ?? 0));

  if (history.labels.length > MAX_POINTS) {
    ['labels','ppm','berat','suhu','humid'].forEach(k => history[k].shift());
  }

  if (chartInstance) {
    chartInstance.data.labels           = history.labels;
    chartInstance.data.datasets[0].data = history[activeTab];
    chartInstance.update();
  }
}

onValue(ref(db, '/live'), snap => {
  const data = snap.val();
  if (data) pushData(data);
});

window.switchChartTab = function(tab) {
  switchTab(tab);
  document.querySelectorAll('.ctab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChart);
} else {
  initChart();
}