# Sistem IoT Analisis Kualitas LPG
## Panduan Setup Lengkap

---

## Struktur Folder Project

```
lpg-iot-system/
├── dashboard.html         ← Dashboard utama (buka di browser)
├── dummy_sender.html      ← Testing tanpa ESP32
├── firebase_structure.json ← Contoh struktur database
├── firebase_rules.json    ← Security rules Firebase
├── apps_script.gs         ← Google Apps Script (copy ke GAS Editor)
└── README.md              ← Panduan ini
```

---

## Alur Sistem

```
ESP32 Sensor
    │
    ▼
Firebase Realtime Database
    ├── /live     ← Data terbaru (1 record, terus dioverwrite)
    ├── /raw      ← Semua data mentah (push, bertambah terus)
    └── /history  ← Rata-rata per periode (dari ESP32 atau manual)
         │
         ▼
    Google Apps Script (trigger 15 menit)
         │
         ▼
    Google Spreadsheet
```

---

## LANGKAH 1: Setup Firebase

### 1.1 Buat Project Firebase
1. Buka https://console.firebase.google.com
2. Klik **Add Project** → beri nama, klik Continue
3. Nonaktifkan Google Analytics (opsional) → Create Project

### 1.2 Aktifkan Realtime Database
1. Di sidebar kiri: **Build → Realtime Database**
2. Klik **Create Database**
3. Pilih lokasi (pilih **Singapore** agar latency rendah dari Indonesia)
4. Mode: pilih **Start in test mode** (untuk development)
5. Klik Enable

### 1.3 Ambil Firebase Config
1. Di sidebar: klik ikon **gear** → **Project settings**
2. Scroll ke bawah → **Your apps**
3. Klik ikon **</>** (Web app) → Register app
4. Copy config yang muncul (apiKey, authDomain, databaseURL, dll.)
5. Paste ke bagian `firebaseConfig` di `dashboard.html` dan `dummy_sender.html`

### 1.4 Upload Firebase Security Rules
1. Di Realtime Database: klik tab **Rules**
2. Hapus isi yang ada
3. Copy isi `firebase_rules.json` → Paste → Publish

---

## LANGKAH 2: Jalankan Dashboard

1. Buka `dashboard.html` di browser (double-click atau via VS Code Live Server)
2. Jika koneksi berhasil, badge di pojok kanan atas berubah jadi **● LIVE**
3. Untuk testing: buka `dummy_sender.html` → geser slider → klik **Kirim → /live**
4. Dashboard akan otomatis update tanpa refresh

---

## LANGKAH 3: Setup Google Apps Script

### 3.1 Buat Spreadsheet
1. Buka https://sheets.google.com
2. Buat spreadsheet baru, beri nama misalnya **"Data LPG Monitor"**

### 3.2 Buka Apps Script Editor
1. Di Spreadsheet: klik **Extensions → Apps Script**
2. Hapus kode default (`function myFunction() {}`)
3. Copy seluruh isi `apps_script.gs` → Paste

### 3.3 Konfigurasi
Di baris paling atas script, ganti:
```javascript
const FIREBASE_URL = 'https://NAMA_PROJECT-default-rtdb.firebaseio.com';
```
Ganti `NAMA_PROJECT` dengan nama project Firebase Anda.

### 3.4 Jalankan Setup Pertama Kali
1. Di dropdown function, pilih `setupSpreadsheet` → klik **Run ▶**
2. Izinkan permission yang diminta (Google akan minta konfirmasi)
3. Header kolom akan otomatis terbuat di Sheet

### 3.5 Aktifkan Trigger Otomatis
1. Pilih function `setupTrigger` → klik **Run ▶**
2. Script akan berjalan otomatis setiap **15 menit**
3. Cek di **Triggers** (ikon jam di sidebar kiri) untuk konfirmasi

### 3.6 Test Manual
1. Pilih function `syncHistoryToSheet` → klik **Run ▶**
2. Cek Spreadsheet — data dari Firebase /history akan muncul
3. Baris akan berwarna: Hijau = AMAN, Kuning = WASPADA, Merah = BAHAYA

---

## LANGKAH 4: Testing Tanpa ESP32

Gunakan `dummy_sender.html`:

| Button | Fungsi |
|--------|--------|
| Kirim → /live | Kirim data ke /live (dashboard update realtime) |
| Kirim → /raw  | Simpan 1 record ke /raw |
| Kirim → /history | Simpan rata-rata ke /history |
| Auto Send (5s) | Kirim ke /live tiap 5 detik (simulasi ESP32) |

Untuk testing Apps Script: jalankan `sendDummyHistoryToFirebase()` dari GAS editor.

---

## Tips Keamanan Firebase (Production)

Setelah selesai testing, ganti rules Firebase dengan yang lebih ketat:

```json
{
  "rules": {
    "live": {
      ".read":  true,
      ".write": "auth != null"
    },
    "raw": {
      ".read":  "auth != null",
      ".write": "auth != null"
    },
    "history": {
      ".read":  true,
      ".write": "auth != null"
    }
  }
}
```

Lalu di ESP32 dan Apps Script gunakan **Service Account** atau **Database Secret** untuk autentikasi.

---

## Struktur Database Firebase

```
/live
  berat      : float   — berat tabung (kg)
  ppm        : float   — konsentrasi gas (ppm)
  suhu       : float   — suhu (°C)
  humidity   : float   — kelembapan (%RH)
  timestamp  : integer — Unix timestamp ms
  device_id  : string  — ID perangkat ESP32

/raw/{auto-key}
  (field sama dengan /live)

/history/{auto-key}
  berat_avg    : float
  ppm_avg      : float
  ppm_max      : float
  ppm_min      : float
  suhu_avg     : float
  humidity_avg : float
  status       : string  — "AMAN" | "WASPADA" | "BAHAYA"
  sample_count : integer
  timestamp    : integer
  device_id    : string
```

---

## Status PPM

| Range PPM | Status   | Warna    |
|-----------|----------|----------|
| 0 – 499   | AMAN     | Hijau    |
| 500 – 699 | WASPADA  | Kuning   |
| 700+      | BAHAYA   | Merah    |
