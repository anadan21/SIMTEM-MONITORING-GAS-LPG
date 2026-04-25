# Sistem IoT Analisis Kualitas LPG
## Panduan Setup — Versi 2 (Firebase Native)

---

## Struktur Folder Project

```
lpg-iot-system/
├── dashboard.html              ← Dashboard utama realtime
├── dummy_sender.html           ← Testing tanpa ESP32
├── apps_script.gs              ← Google Apps Script (copy ke GAS Editor)
├── code_arduino.cpp            ← Kode ESP32 (buka di Arduino IDE)
├── firebase-config.js          ← Config Firebase RAHASIA ← ada di .gitignore
├── firebase-config.example.js  ← Template config (di-commit ke git)
├── firebase_structure.json     ← Contoh struktur database
├── firebase_rules.json         ← Security rules Firebase
├── .gitignore                  ← Mengecualikan firebase-config.js
└── README.md                   ← Panduan ini
```

---

## Alur Sistem

```
ESP32 Sensor (1 detik)
    │
    ├──→ Firebase /live      ← Dashboard HTML baca ini (realtime)
    ├──→ Firebase /raw       ← Setiap 10 detik (log mentah)
    └──→ Firebase /history   ← Saat tabung diangkat (data stabil)
                │
                ▼
         Google Apps Script
         (trigger 15 menit)
                │
                ▼
         Google Spreadsheet
         (pewarnaan otomatis)
```

---

## Logika Status (sesuai Arduino)

| Kondisi | Status | LED |
|---------|--------|-----|
| PPM > 300 | **BOCOR** | Merah + Buzzer |
| Berat ≥ 7.80 kg | **LAYAK** | Hijau |
| Berat ≥ 4.80 kg | **KURANG** | Kuning |
| Berat < 4.80 kg | **KOSONG** | Mati |

---

## LANGKAH 1: Setup Keamanan Firebase Config

### 1a. Clone / download project
```bash
git clone ...
cd lpg-iot-system
```

### 1b. Buat firebase-config.js dari template
Salin `firebase-config.example.js` → `firebase-config.js`:
```bash
cp firebase-config.example.js firebase-config.js
```

### 1c. Isi config di firebase-config.js
Buka Firebase Console → Project Settings → Your apps → SDK setup and configuration.
Copy nilai ke `firebase-config.js`:
```js
export const firebaseConfig = {
  apiKey:            "ISI_API_KEY",
  authDomain:        "project.firebaseapp.com",
  databaseURL:       "https://project-rtdb.asia-southeast1.firebasedatabase.app",
  ...
};
```

> File ini **sudah di .gitignore** — tidak akan ter-push ke GitHub.

---

## LANGKAH 2: Setup Firebase

### 2.1 Buat Project Firebase
1. https://console.firebase.google.com → Add Project
2. Build → Realtime Database → Create Database
3. Pilih region **asia-southeast1 (Singapore)** agar cepat dari Indonesia
4. Mode: Start in test mode

### 2.2 Deploy Security Rules
1. Realtime Database → tab **Rules**
2. Copy isi `firebase_rules.json` → Publish

---

## LANGKAH 3: Jalankan Dashboard

```
Buka dashboard.html di browser (atau via VS Code Live Server)
```

Karena menggunakan ES Module (`import`), file **tidak bisa dibuka langsung** dengan `file://` di beberapa browser. Gunakan salah satu cara:
- VS Code → Install **Live Server** extension → klik **Go Live**
- Python: `python -m http.server 8080` lalu buka `http://localhost:8080/dashboard.html`

---

## LANGKAH 4: Testing Tanpa ESP32

Buka `dummy_sender.html` (dengan Live Server juga):
- Geser slider → status preview langsung berubah
- Klik **Kirim → /live** → lihat dashboard update
- Klik **Auto Send (5s)** → simulasi ESP32 berjalan

---

## LANGKAH 5: Setup Google Apps Script

### 5.1 Buat Spreadsheet
Buka https://sheets.google.com → buat spreadsheet baru.

### 5.2 Buka Apps Script
Extensions → Apps Script → hapus kode default.

### 5.3 Paste & Konfigurasi
Copy isi `apps_script.gs` → paste. Ganti:
```js
const FIREBASE_URL = 'https://NAMA_PROJECT-rtdb.asia-southeast1.firebasedatabase.app';
```

### 5.4 Jalankan Sekali
1. Pilih `setupSpreadsheet` → Run ▶ → izinkan permission
2. Pilih `setupTrigger` → Run ▶

### 5.5 Test Manual
Pilih `sendDummyHistoryToFirebase` → Run → cek Spreadsheet.

---

## LANGKAH 6: Upload Kode ke ESP32

### 6.1 Install Library (Arduino IDE)
Buka Library Manager, install:
- `HX711` by Bogdan Necula
- `DHT sensor library` by Adafruit
- `LiquidCrystal I2C` by Frank de Brabander
- `ArduinoJson` by Benoit Blanchon ← **BARU**

### 6.2 Konfigurasi di code_arduino.cpp
Edit baris berikut sesuai setup Anda:
```cpp
const char* WIFI_SSID     = "NAMA_WIFI";
const char* WIFI_PASS     = "PASSWORD_WIFI";
const char* FIREBASE_HOST = "https://NAMA_PROJECT-rtdb.asia-southeast1.firebasedatabase.app";
const float BERAT_TABUNG  = 5.0;    // berat tabung kosong (kg)
const float HX711_SCALE   = 23483.0; // hasil kalibrasi HX711
```

### 6.3 Upload
Board: ESP32 Dev Module → Upload.

---

## Tips Keamanan Firebase (Production)

Setelah selesai testing, ganti rules dengan:
```json
{
  "rules": {
    "live":    { ".read": true,  ".write": "auth != null" },
    "raw":     { ".read": "auth != null", ".write": "auth != null" },
    "history": { ".read": true,  ".write": "auth != null" }
  }
}
```

Untuk ESP32, gunakan **Database Secret** (Project Settings → Service Accounts → Database secrets) dan kirim sebagai query param `?auth=SECRET`.

---

## Struktur Database Firebase

```
/live                       ← 1 record, terus di-overwrite tiap detik
  berat      : float        — berat total (tabung + isi)
  isi        : float        — berat isi LPG (berat - BERAT_TABUNG)
  ppm        : int          — pembacaan sensor MQ
  suhu       : float        — °C
  humidity   : float        — %RH
  status     : string       — LAYAK | KURANG | BOCOR | KOSONG
  timestamp  : long         — millis() ESP32
  device_id  : string

/raw/{push-key}             ← Push tiap RAW_INTERVAL_SEC detik
  (field sama dengan /live)

/history/{id}               ← Push saat tabung diangkat
  id           : string     — HIST-{timestamp}
  berat_avg    : float
  isi_avg      : float
  ppm_avg      : int
  ppm_max      : int
  ppm_min      : int
  suhu_avg     : float
  humidity_avg : float
  status       : string
  sample_count : int
  timestamp    : long
  device_id    : string
```