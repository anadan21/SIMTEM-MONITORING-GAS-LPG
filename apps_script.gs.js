/**
 * ================================================================
 * Google Apps Script: Firebase /history → Google Spreadsheet
 * ================================================================
 * CARA SETUP:
 * 1. Buka Google Spreadsheet Anda
 * 2. Extensions → Apps Script
 * 3. Paste seluruh kode ini
 * 4. Ganti FIREBASE_URL di bawah
 * 5. Jalankan setupSpreadsheet() sekali untuk membuat header
 * 6. Deploy trigger otomatis dengan setupTrigger()
 * ================================================================
 */

// ---- KONFIGURASI — WAJIB DIGANTI ----
const FIREBASE_URL  = 'https://NAMA_PROJECT-default-rtdb.firebaseio.com';
const FIREBASE_AUTH = '';   // Kosongkan jika pakai Firebase Rules publik
                             // Atau isi dengan Database Secret (Settings > Service Accounts)
const SHEET_NAME    = 'History LPG';

// ---- HEADER KOLOM SPREADSHEET ----
const HEADERS = [
  'No',
  'Timestamp',
  'Tanggal',
  'Jam',
  'Berat Avg (kg)',
  'PPM Avg',
  'PPM Max',
  'PPM Min',
  'Suhu Avg (°C)',
  'Humidity Avg (%)',
  'Status',
  'Jumlah Sampel',
  'Device ID'
];


/**
 * Fungsi utama: ambil data /history dari Firebase, masukkan ke Spreadsheet
 * Fungsi ini yang dipanggil oleh trigger otomatis
 */
function syncHistoryToSheet() {
  const sheet = getOrCreateSheet();

  // Ambil data dari Firebase
  const url    = FIREBASE_URL + '/history.json' + (FIREBASE_AUTH ? '?auth=' + FIREBASE_AUTH : '');
  const resp   = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const status = resp.getResponseCode();

  if (status !== 200) {
    Logger.log('ERROR: Firebase response ' + status + ' — ' + resp.getContentText());
    return;
  }

  const raw  = JSON.parse(resp.getContentText());
  if (!raw) {
    Logger.log('INFO: Tidak ada data di /history');
    return;
  }

  // Kumpulkan key yang sudah ada di sheet (kolom A: nomor urut → kita pakai timestamp sebagai ID unik)
  const existingKeys = getExistingTimestamps(sheet);
  Logger.log('Data sudah ada di sheet: ' + existingKeys.size + ' baris');

  // Proses data baru
  const entries = Object.entries(raw);
  let newRows   = 0;

  entries.forEach(([key, rec]) => {
    const tsKey = String(rec.timestamp);

    // Skip jika sudah ada di sheet
    if (existingKeys.has(tsKey)) return;

    const dt     = new Date(rec.timestamp);
    const no     = getNextRowNumber(sheet);
    const tanggal = Utilities.formatDate(dt, 'Asia/Makassar', 'dd/MM/yyyy');
    const jam     = Utilities.formatDate(dt, 'Asia/Makassar', 'HH:mm:ss');

    const row = [
      no,
      rec.timestamp,
      tanggal,
      jam,
      rec.berat_avg     ?? '',
      rec.ppm_avg       ?? '',
      rec.ppm_max       ?? '',
      rec.ppm_min       ?? '',
      rec.suhu_avg      ?? '',
      rec.humidity_avg  ?? '',
      rec.status        ?? '',
      rec.sample_count  ?? '',
      rec.device_id     ?? ''
    ];

    sheet.appendRow(row);
    newRows++;
  });

  // Pewarnaan baris status (opsional, bisa dimatikan)
  colorStatusRows(sheet);

  Logger.log('Selesai. Baris baru ditambahkan: ' + newRows);
  SpreadsheetApp.flush();
}


/**
 * Setup header spreadsheet — jalankan SEKALI saja saat pertama kali
 */
function setupSpreadsheet() {
  const sheet = getOrCreateSheet();

  // Cek apakah header sudah ada
  if (sheet.getLastRow() > 0) {
    const firstCell = sheet.getRange(1, 1).getValue();
    if (firstCell === 'No') {
      Logger.log('Header sudah ada, skip setup.');
      return;
    }
  }

  // Tulis header
  sheet.insertRowBefore(1);
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);

  // Format header
  headerRange
    .setBackground('#1a1d27')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Freeze baris header
  sheet.setFrozenRows(1);

  // Auto-resize kolom
  sheet.autoResizeColumns(1, HEADERS.length);

  Logger.log('Header spreadsheet berhasil dibuat.');
}


/**
 * Buat trigger otomatis — jalankan SEKALI untuk set jadwal
 * Default: setiap 15 menit
 */
function setupTrigger() {
  // Hapus trigger lama agar tidak duplikat
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'syncHistoryToSheet') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Buat trigger baru — setiap 15 menit
  ScriptApp.newTrigger('syncHistoryToSheet')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Trigger otomatis aktif: setiap 15 menit.');
}


/**
 * Hapus semua trigger (untuk reset)
 */
function removeTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'syncHistoryToSheet') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Trigger dihapus.');
    }
  });
}


// ================================================================
// FUNGSI HELPER (tidak perlu diubah)
// ================================================================

function getOrCreateSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    Logger.log('Sheet baru dibuat: ' + SHEET_NAME);
  }
  return sheet;
}

function getExistingTimestamps(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return new Set();

  // Timestamp ada di kolom B (index 2)
  const values = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  return new Set(values.map(r => String(r[0])));
}

function getNextRowNumber(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1;

  // Ambil nomor terakhir di kolom A
  const lastNo = sheet.getRange(lastRow, 1).getValue();
  return (Number(lastNo) || 0) + 1;
}

function colorStatusRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  // Kolom K (index 11) = Status
  const statusRange = sheet.getRange(2, 11, lastRow - 1, 1);
  const statusValues = statusRange.getValues();

  statusValues.forEach((row, i) => {
    const status = String(row[0]).toUpperCase();
    const rowNum = i + 2;
    const range  = sheet.getRange(rowNum, 1, 1, HEADERS.length);

    if (status === 'BAHAYA') {
      range.setBackground('#fde8e8');
    } else if (status === 'WASPADA') {
      range.setBackground('#fef3cd');
    } else if (status === 'AMAN') {
      range.setBackground('#d4edda');
    }
  });
}


/**
 * TEST: Kirim data dummy ke /history Firebase (untuk testing tanpa ESP32)
 * Jalankan dari Apps Script Editor
 */
function sendDummyHistoryToFirebase() {
  const key       = '-Test' + Date.now();
  const timestamp = Date.now();
  const data = {
    berat_avg:    3.22,
    ppm_avg:      425.5,
    ppm_max:      480,
    ppm_min:      380,
    suhu_avg:     28.7,
    humidity_avg: 65.0,
    status:       'AMAN',
    sample_count: 10,
    timestamp:    timestamp,
    device_id:    'ESP32-LPG-01'
  };

  const url  = FIREBASE_URL + '/history/' + key + '.json' + (FIREBASE_AUTH ? '?auth=' + FIREBASE_AUTH : '');
  const opts = {
    method:      'PUT',
    contentType: 'application/json',
    payload:     JSON.stringify(data),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(url, opts);
  Logger.log('Dummy data sent. Response: ' + resp.getResponseCode());
  Logger.log(resp.getContentText());
}
