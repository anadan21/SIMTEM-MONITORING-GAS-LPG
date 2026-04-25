/**
 * ================================================================
 * Google Apps Script: Firebase /history → Google Spreadsheet
 * Versi 2 — ID unik, status logika Arduino, header fix
 * ================================================================
 * CARA SETUP:
 * 1. Buka Google Spreadsheet → Extensions → Apps Script
 * 2. Paste seluruh kode ini, hapus kode lama
 * 3. Ganti FIREBASE_URL di bawah
 * 4. Run: setupSpreadsheet()  ← SEKALI untuk buat header
 * 5. Run: setupTrigger()      ← SEKALI untuk aktifkan jadwal otomatis
 * ================================================================
 */

// ── KONFIGURASI — WAJIB DIGANTI ──────────────────────────────────
const FIREBASE_URL  = 'https://pangkalan-lpg-a6406-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_AUTH = '';   // Kosong = rules publik. Isi jika pakai Database Secret.
const SHEET_NAME    = 'History LPG';
// ─────────────────────────────────────────────────────────────────

// Header kolom — urutan ini HARUS sama dengan array `row` di syncHistoryToSheet()
const HEADERS = [
  'ID',             // A — ID unik dari Firebase atau generate otomatis
  'Timestamp',      // B — Unix ms (untuk de-duplikasi)
  'Tanggal',        // C
  'Jam',            // D
  'Berat Total (kg)',// E — berat tabung + isi
  'Berat Isi (kg)', // F — berat isi LPG saja
  'PPM Avg',        // G
  'PPM Max',        // H
  'PPM Min',        // I
  'Suhu Avg (°C)',  // J
  'Humidity Avg (%)',// K
  'Status',         // L — LAYAK / KURANG / BOCOR / KOSONG
  'Jumlah Sampel',  // M
  'Device ID'       // N
];

// ── Status logic persis seperti Arduino ──────────────────────────
// gasGlobal > 300 → BOCOR
// berat >= 7.80   → LAYAK
// berat >= 4.80   → KURANG
// else            → KOSONG
function hitungStatus(ppm, berat) {
  if (ppm > 300)        return 'BOCOR';
  if (berat >= 7.80)    return 'LAYAK';
  if (berat >= 4.80)    return 'KURANG';
  return 'KOSONG';
}


/**
 * FUNGSI UTAMA — dipanggil trigger otomatis tiap 15 menit
 * Ambil data baru dari Firebase /history, masukkan ke Sheet
 */
function syncHistoryToSheet() {
  const sheet = getOrCreateSheet();

  // Fetch dari Firebase
  const url  = FIREBASE_URL + '/history.json' + (FIREBASE_AUTH ? '?auth=' + FIREBASE_AUTH : '');
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (resp.getResponseCode() !== 200) {
    Logger.log('ERROR Firebase: HTTP ' + resp.getResponseCode() + '\n' + resp.getContentText());
    return;
  }

  const raw = JSON.parse(resp.getContentText());
  if (!raw) { Logger.log('INFO: /history kosong'); return; }

  // Kumpulkan timestamp yang sudah ada (kolom B) untuk skip duplikat
  const existing = getExistingTimestamps(sheet);
  Logger.log('Sudah ada di sheet: ' + existing.size + ' record');

  let newRows = 0;
  const entries = Object.entries(raw);

  entries.forEach(([fbKey, rec]) => {
    // De-duplikasi pakai timestamp
    const tsKey = String(rec.timestamp ?? '');
    if (!tsKey || existing.has(tsKey)) return;

    const dt      = new Date(rec.timestamp);
    const tanggal = Utilities.formatDate(dt, 'Asia/Makassar', 'dd/MM/yyyy');
    const jam     = Utilities.formatDate(dt, 'Asia/Makassar', 'HH:mm:ss');

    // Hitung isi dari berat total (berat tabung kosong = 5 kg)
    const beratTotal = rec.berat_avg ?? 0;
    const beratIsi   = rec.isi_avg   ?? (beratTotal > 5 ? +(beratTotal - 5).toFixed(2) : 0);

    // Status: pakai dari record jika ada, fallback hitung ulang
    const ppmAvg = rec.ppm_avg ?? 0;
    const status = rec.status ?? hitungStatus(ppmAvg, beratTotal);

    // Buat ID: pakai field 'id' dari record, fallback ke key Firebase
    const id = rec.id ?? fbKey;

    const row = [
      id,                         // A
      rec.timestamp,              // B
      tanggal,                    // C
      jam,                        // D
      beratTotal,                 // E
      beratIsi,                   // F
      ppmAvg,                     // G
      rec.ppm_max      ?? '',     // H
      rec.ppm_min      ?? '',     // I
      rec.suhu_avg     ?? '',     // J
      rec.humidity_avg ?? '',     // K
      status,                     // L
      rec.sample_count ?? '',     // M
      rec.device_id    ?? ''      // N
    ];

    sheet.appendRow(row);
    newRows++;
  });

  // Warna baris sesuai status (re-render semua setiap sync)
  colorStatusRows(sheet);
  SpreadsheetApp.flush();

  Logger.log('Selesai. Baris baru: ' + newRows + ' | Total: ' + (sheet.getLastRow() - 1));
}


/**
 * Setup header — JALANKAN SEKALI PERTAMA KALI
 * Akan skip jika header sudah ada
 */
function setupSpreadsheet() {
  const sheet = getOrCreateSheet();

  // Cek apakah header baris pertama sudah benar
  if (sheet.getLastRow() >= 1) {
    const val = sheet.getRange(1, 1).getValue();
    if (val === 'ID') {
      Logger.log('Header sudah ada, tidak perlu setup ulang.');
      return;
    }
    // Jika ada data lain di baris 1, sisipkan baris baru di atas
    sheet.insertRowBefore(1);
  }

  // Tulis header di baris 1
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);

  // Styling header
  headerRange
    .setBackground('#1a1d27')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(1, 30);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);

  Logger.log('Header berhasil dibuat di sheet: ' + SHEET_NAME);
}


/**
 * Setup trigger otomatis — JALANKAN SEKALI untuk aktifkan jadwal
 */
function setupTrigger() {
  // Hapus trigger lama agar tidak duplikat
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncHistoryToSheet') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('syncHistoryToSheet')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Trigger aktif: syncHistoryToSheet setiap 15 menit.');
}


/**
 * Hapus trigger (untuk reset / nonaktifkan)
 */
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncHistoryToSheet') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Trigger dihapus.');
    }
  });
}


/**
 * TEST: Kirim satu record dummy ke /history Firebase
 * Jalankan dari Editor untuk verifikasi koneksi
 */
function sendDummyHistoryToFirebase() {
  const ts  = Date.now();
  const key = '-Test' + ts;
  const data = {
    id:           'HIST-' + ts,
    berat_avg:    7.84,
    isi_avg:      2.84,
    ppm_avg:      120,
    ppm_max:      145,
    ppm_min:      98,
    suhu_avg:     28.7,
    humidity_avg: 65.0,
    status:       'LAYAK',
    sample_count: 10,
    timestamp:    ts,
    device_id:    'ESP32-LPG-01'
  };

  const url  = FIREBASE_URL + '/history/' + key + '.json' + (FIREBASE_AUTH ? '?auth=' + FIREBASE_AUTH : '');
  const opts = {
    method:             'PUT',
    contentType:        'application/json',
    payload:            JSON.stringify(data),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(url, opts);
  Logger.log('Response: ' + resp.getResponseCode());
  Logger.log(resp.getContentText());
}


// ── HELPER FUNCTIONS ─────────────────────────────────────────────

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
  // Timestamp di kolom B (index 2), mulai baris 2
  const vals = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  return new Set(vals.map(r => String(r[0])).filter(Boolean));
}

function colorStatusRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  // Status ada di kolom L (index 12)
  const statusVals = sheet.getRange(2, 12, lastRow - 1, 1).getValues();

  statusVals.forEach((row, i) => {
    const status = String(row[0]).toUpperCase().trim();
    const rowNum = i + 2;
    const range  = sheet.getRange(rowNum, 1, 1, HEADERS.length);

    switch (status) {
      case 'LAYAK':  range.setBackground('#d4edda'); break; // hijau muda
      case 'KURANG': range.setBackground('#fff3cd'); break; // kuning muda
      case 'BOCOR':  range.setBackground('#f8d7da'); break; // merah muda
      case 'KOSONG': range.setBackground('#e2e3e5'); break; // abu-abu muda
      default:       range.setBackground(null);      break;
    }
  });
}