/**
 * ================================================================
 * Google Apps Script — Sistem QC LPG Pangkalan Gas
 * Versi Final — doPost (push langsung dari ESP32) + sync Firebase
 * ================================================================
 *
 * CARA KERJA:
 *   ESP32 → POST JSON ke URL /exec → Apps Script → Spreadsheet (instan)
 *   ESP32 → PUT JSON → Firebase /history (backup log)
 *
 * CARA DEPLOY:
 *   1. Extensions → Apps Script → paste kode ini
 *   2. Ganti FIREBASE_URL di bawah
 *   3. Run setupSpreadsheet() — SEKALI
 *   4. Deploy → New deployment → Web App
 *      Execute as : Me | Who has access : Anyone
 *   5. Copy URL /exec → paste ke code_arduino.cpp (GAS_ENDPOINT)
 *
 * CATATAN:
 *   setupTrigger() bersifat opsional sebagai backup sync.
 *   Dengan doPost, data masuk ke sheet INSTAN saat tabung diangkat.
 * ================================================================
 */

// ── KONFIGURASI ───────────────────────────────────────────────────
const FIREBASE_URL  = 'https://pangkalan-lpg-a6406-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_AUTH = '';   // Isi Database Secret jika rules sudah diperketat
const SHEET_NAME    = 'QC Tabung LPG';

const HEADERS = [
  'ID',               // A
  'Timestamp',        // B — plain number, tidak auto-convert ke Date
  'Tanggal',          // C
  'Jam',              // D
  'Berat Total (kg)', // E
  'Berat Isi (kg)',   // F
  'PPM',              // G
  'PPM Max',          // H
  'PPM Min',          // I
  'Suhu (°C)',        // J
  'Humidity (%)',     // K
  'Status',           // L — LAYAK / KURANG / BOCOR
  'Jumlah Sampel',    // M
  'Device ID',        // N
  'Sumber'            // O — ESP32 / FIREBASE_SYNC / TEST
];

// ── Status logic (sama persis dengan Arduino) ─────────────────────
function hitungStatus(ppm, berat) {
  if (ppm > 300)      return 'BOCOR';
  if (berat >= 7.80)  return 'LAYAK';
  if (berat >= 4.80)  return 'KURANG';
  return 'KOSONG';
}


// ================================================================
//  doPost — endpoint utama, dipanggil ESP32 saat tabung diangkat
// ================================================================
function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const sheet  = getOrCreateSheet();
    ensureHeader(sheet);

    // Cek duplikat
    const existing = getExistingTimestamps(sheet);
    const tsKey    = String(data.timestamp ?? '');
    if (tsKey && existing.has(tsKey)) {
      return jsonResponse({ status: 'skip', reason: 'duplicate' });
    }

    const rowNum = writeRow(sheet, data, 'ESP32');
    colorRow(sheet, rowNum, data.status ?? '');
    SpreadsheetApp.flush();

    return jsonResponse({ status: 'ok', row: rowNum });
  } catch (err) {
    Logger.log('doPost ERROR: ' + err.message);
    return jsonResponse({ status: 'error', message: err.message });
  }
}


// ================================================================
//  doGet — test endpoint via browser
// ================================================================
function doGet() {
  const sheet = getOrCreateSheet();
  return jsonResponse({
    status:   'ok',
    sheet:    SHEET_NAME,
    dataRows: Math.max(0, sheet.getLastRow() - 1),
    time:     new Date().toISOString()
  });
}


// ================================================================
//  syncHistoryToSheet — backup pull dari Firebase (opsional)
//  Jalankan manual atau via trigger jika ada data yang terlewat
// ================================================================
function syncHistoryToSheet() {
  const sheet = getOrCreateSheet();
  ensureHeader(sheet);

  const url  = FIREBASE_URL + '/history.json' + (FIREBASE_AUTH ? '?auth=' + FIREBASE_AUTH : '');
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (resp.getResponseCode() !== 200) {
    Logger.log('ERROR Firebase: HTTP ' + resp.getResponseCode());
    return;
  }

  const raw = JSON.parse(resp.getContentText());
  if (!raw) { Logger.log('INFO: /history kosong'); return; }

  const existing = getExistingTimestamps(sheet);
  let   newRows  = 0;

  Object.entries(raw).forEach(([fbKey, rec]) => {
    if (!rec || !rec.timestamp) return;
    const tsKey = String(rec.timestamp);
    if (existing.has(tsKey)) return;

    const rowNum = writeRow(sheet, rec, 'FIREBASE_SYNC');
    colorRow(sheet, rowNum, rec.status ?? '');
    existing.add(tsKey);
    newRows++;
  });

  SpreadsheetApp.flush();
  Logger.log('Sync selesai. Baris baru: ' + newRows);
}


// ================================================================
//  SETUP FUNCTIONS
// ================================================================

function setupSpreadsheet() {
  const sheet = getOrCreateSheet();
  ensureHeader(sheet);
  Logger.log('Setup selesai: ' + SHEET_NAME);
}

// Trigger backup opsional
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncHistoryToSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncHistoryToSheet').timeBased().everyMinutes(15).create();
  Logger.log('Trigger backup aktif: setiap 15 menit.');
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncHistoryToSheet') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Trigger dihapus.');
    }
  });
}


// ================================================================
//  DEBUG & TEST
// ================================================================

function debugLengkap() {
  const url  = FIREBASE_URL + '/history.json';
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const raw  = JSON.parse(resp.getContentText());

  Logger.log('=== FIREBASE ===');
  Logger.log('HTTP  : ' + resp.getResponseCode());
  Logger.log('Record: ' + (raw ? Object.keys(raw).length : 0));

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  Logger.log('\n=== SHEET ===');
  Logger.log('Ada  : ' + (sheet !== null));
  if (sheet) Logger.log('Baris: ' + sheet.getLastRow());

  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('\n=== TRIGGER ===');
  Logger.log('Jumlah: ' + triggers.length);
  triggers.forEach(t => Logger.log(' - ' + t.getHandlerFunction()));
}

// Simulasi doPost dari Editor (tanpa deploy)
function testDoPost() {
  const ts = Date.now();
  const data = {
    id:           'HIST-' + ts,
    berat_avg:    8.42,
    isi_avg:      3.42,
    ppm_avg:      87,
    ppm_max:      102,
    ppm_min:      74,
    suhu_avg:     29.1,
    humidity_avg: 64.0,
    status:       'LAYAK',
    sample_count: 1,
    timestamp:    ts,
    device_id:    'ESP32-LPG-01'
  };
  const sheet  = getOrCreateSheet();
  ensureHeader(sheet);
  const rowNum = writeRow(sheet, data, 'TEST');
  colorRow(sheet, rowNum, data.status);
  SpreadsheetApp.flush();
  Logger.log('testDoPost OK → baris ' + rowNum);
}

function sendDummyHistoryToFirebase() {
  const ts  = Date.now();
  const key = 'HIST-' + ts;
  const data = {
    id:           key,
    berat_avg:    8.42,   isi_avg:      3.42,
    ppm_avg:      87,     ppm_max:      102,     ppm_min: 74,
    suhu_avg:     29.1,   humidity_avg: 64.0,
    status:       'LAYAK',
    sample_count: 1,
    timestamp:    ts,
    device_id:    'ESP32-LPG-01'
  };
  const url  = FIREBASE_URL + '/history/' + key + '.json';
  const resp = UrlFetchApp.fetch(url, {
    method: 'PUT', contentType: 'application/json',
    payload: JSON.stringify(data), muteHttpExceptions: true
  });
  Logger.log('Firebase dummy: HTTP ' + resp.getResponseCode());
}


// ================================================================
//  HELPER FUNCTIONS
// ================================================================

function getOrCreateSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    Logger.log('Sheet baru: ' + SHEET_NAME);
  }
  return sheet;
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() >= 1 && sheet.getRange(1,1).getValue() === 'ID') return;
  if (sheet.getLastRow() >= 1) sheet.insertRowBefore(1);

  const r = sheet.getRange(1, 1, 1, HEADERS.length);
  r.setValues([HEADERS]);
  r.setBackground('#0a0c0f')
   .setFontColor('#fbbf24')
   .setFontWeight('bold')
   .setHorizontalAlignment('center')
   .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 32);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
  Logger.log('Header dibuat.');
}

function writeRow(sheet, data, source) {
  const ts      = Number(data.timestamp ?? Date.now());
  const dt      = new Date(ts);
  const tanggal = Utilities.formatDate(dt, 'Asia/Makassar', 'dd/MM/yyyy');
  const jam     = Utilities.formatDate(dt, 'Asia/Makassar', 'HH:mm:ss');

  const beratTotal = Number(data.berat_avg ?? 0);
  const beratIsi   = Number(data.isi_avg   ?? (beratTotal > 5 ? beratTotal - 5 : 0));
  const ppmAvg     = Number(data.ppm_avg   ?? 0);
  const status     = data.status ?? hitungStatus(ppmAvg, beratTotal);
  const id         = data.id     ?? ('HIST-' + ts);

  const row = [
    id,                               // A
    ts,                               // B — plain number
    tanggal,                          // C
    jam,                              // D
    beratTotal,                       // E
    parseFloat(beratIsi.toFixed(2)), // F
    ppmAvg,                           // G
    Number(data.ppm_max      ?? 0),  // H
    Number(data.ppm_min      ?? 0),  // I
    Number(data.suhu_avg     ?? 0),  // J
    Number(data.humidity_avg ?? 0),  // K
    status,                           // L
    Number(data.sample_count ?? 1),  // M
    data.device_id ?? '',             // N
    source                            // O
  ];

  const rowNum = sheet.getLastRow() + 1;
  sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  sheet.getRange(rowNum, 2).setNumberFormat('0'); // Kolom B tetap angka, bukan Date
  return rowNum;
}

function getExistingTimestamps(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return new Set();
  const vals = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  return new Set(vals.map(r => {
    const v = r[0];
    if (v instanceof Date)       return String(v.getTime());
    if (typeof v === 'number')   return String(Math.round(v));
    return String(v);
  }).filter(Boolean));
}

function colorRow(sheet, rowNum, status) {
  const range = sheet.getRange(rowNum, 1, 1, HEADERS.length);
  switch (status.toUpperCase().trim()) {
    case 'LAYAK':  range.setBackground('#d4edda'); break;  // hijau muda
    case 'KURANG': range.setBackground('#fff3cd'); break;  // kuning muda
    case 'BOCOR':  range.setBackground('#f8d7da'); break;  // merah muda
    case 'KOSONG': range.setBackground('#e9ecef'); break;  // abu
    default:       range.setBackground(null);
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}