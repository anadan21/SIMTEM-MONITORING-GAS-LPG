/**
 * ================================================================
 * ESP32 — LPG Quality Monitor
 * Sistem Baru: Firebase Realtime Database (tanpa Blynk)
 * ================================================================
 *
 * PERUBAHAN DARI VERSI LAMA:
 *  - Hapus Blynk → pakai Firebase REST API langsung
 *  - Hapus HTTP ke Google Apps Script → data masuk Firebase /history
 *    (Apps Script akan tarik dari Firebase otomatis via trigger)
 *  - Tambah field: isi (berat LPG tanpa tabung), id unik per record
 *  - /live  → update tiap 1 detik (realtime dashboard)
 *  - /raw   → catat setiap pembacaan (opsional, bisa dimatikan)
 *  - /history → catat saat tabung diangkat (sama seperti sebelumnya)
 *
 * LIBRARY YANG DIBUTUHKAN (install via Library Manager):
 *  - HX711 by Bogdan Necula           (load cell)
 *  - DHT sensor library by Adafruit   (DHT22)
 *  - LiquidCrystal I2C by Frank de Brabander
 *  - ArduinoJson by Benoit Blanchon   ← BARU (untuk build JSON)
 *
 * LIBRARY YANG DIHAPUS:
 *  - BlynkSimpleEsp32  (tidak dipakai lagi)
 *
 * ================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>
#include "HX711.h"
#include "DHT.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ── PIN ───────────────────────────────────────────────────────────
#define HX_DT       4
#define HX_SCK      5
#define PIN_GAS_A0  34
#define LED_RED     25
#define LED_YELLOW  26
#define LED_GREEN   33
#define BUZZER_PIN  27
#define DHTPIN      14
#define DHTTYPE     DHT22

// ── WIFI ──────────────────────────────────────────────────────────
const char* WIFI_SSID = "bots";
const char* WIFI_PASS = "12345678";

// ── FIREBASE ─────────────────────────────────────────────────────
// Ganti dengan URL project Firebase Anda
// Firebase Console → Realtime Database → (copy URL di bagian atas)
const char* FIREBASE_HOST = "https://pangkalan-lpg-a6406-default-rtdb.asia-southeast1.firebasedatabase.app";

// Berat tabung kosong (kg) — sesuaikan jika berbeda
const float BERAT_TABUNG = 5.0;

// Skala HX711 — sesuaikan hasil kalibrasi Anda
const float HX711_SCALE  = 23483.0;

// Threshold status — sama dengan Arduino versi lama
const int   PPM_BOCOR    = 300;
const float BERAT_LAYAK  = 7.80;
const float BERAT_KURANG = 4.80;

// Kirim /raw setiap N detik (0 = nonaktif)
const int   RAW_INTERVAL_SEC = 10;

// ── OBJEK ─────────────────────────────────────────────────────────
LiquidCrystal_I2C lcd(0x27, 16, 2);
HX711 scale;
DHT   dht(DHTPIN, DHTTYPE);

// ── VARIABEL GLOBAL ───────────────────────────────────────────────
float  b_stabil = 0, b_sebelum = 0;
float  g_stabil = 0, t_stabil = 0, h_stabil = 0;
float  suhuNow  = 0, humidNow  = 0;
int    gasNow   = 0;
int    rawCounter = 0;

unsigned long waktuMulaiDiam = 0;
unsigned long lastRawSend    = 0;
unsigned long lastLiveSend   = 0;

bool adaTabung     = false;
bool sistemReady   = false;
bool sudahBipStabil = false;

String statusTerakhir = "";


// ================================================================
//  SETUP
// ================================================================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);

  // Init LCD
  lcd.init();
  lcd.backlight();

  // Init pin
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_RED,    OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN,  OUTPUT);

  // Init sensor
  scale.begin(HX_DT, HX_SCK);
  scale.set_scale(HX711_SCALE);
  scale.tare();
  dht.begin();

  // Warm-up MQ sensor (3 menit)
  for (int i = 180; i > 0; i--) {
    lcd.clear();
    lcdCenter("WARM-UP SENSOR", 0);
    lcdCenter("Tunggu: " + String(i) + "s", 1);
    Serial.printf("Warm-up: %d s\n", i);
    delay(1000);
  }

  // Koneksi WiFi
  lcd.clear();
  lcdCenter("KONEKSI WIFI...", 0);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 30) {
    delay(500);
    Serial.print(".");
    timeout++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi OK: " + WiFi.localIP().toString());
    lcdCenter("WIFI OK!", 1);
  } else {
    Serial.println("\nWiFi GAGAL — lanjut offline");
    lcdCenter("WIFI GAGAL", 1);
  }

  delay(2000);
  sistemReady = true;
  lcd.clear();
}


// ================================================================
//  LOOP
// ================================================================
void loop() {
  if (!sistemReady) return;

  unsigned long now = millis();

  // ── 1. Baca sensor ─────────────────────────────────────────────
  float b_total = scale.get_units(5);
  if (b_total < 0.15) b_total = 0;

  float b_isi = (b_total > BERAT_TABUNG) ? b_total - BERAT_TABUNG : 0;

  gasNow = analogRead(PIN_GAS_A0);

  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) { suhuNow = t; humidNow = h; }

  // ── 2. Tentukan status ─────────────────────────────────────────
  String status = hitungStatus(gasNow, b_total);

  // ── 3. LED & Buzzer ────────────────────────────────────────────
  updateLEDAndBuzzer(status);

  // ── 4. Update LCD (anti-kedip / overwrite) ────────────────────
  lcd.setCursor(0, 0);
  lcd.print("T:");  lcd.print(b_total, 1);
  lcd.print(" B:"); lcd.print(b_isi, 1);
  lcd.print("kg    ");

  lcd.setCursor(0, 1);
  lcd.print(gasNow); lcd.print("ppm ");
  lcd.print(suhuNow, 1); lcd.print("C   ");

  // ── 5. Kirim /live setiap 1 detik ─────────────────────────────
  if (now - lastLiveSend >= 1000) {
    lastLiveSend = now;
    kirimLive(b_total, b_isi, gasNow, suhuNow, humidNow, status);
  }

  // ── 6. Kirim /raw setiap RAW_INTERVAL_SEC (jika aktif) ────────
  if (RAW_INTERVAL_SEC > 0 && (now - lastRawSend >= (unsigned long)RAW_INTERVAL_SEC * 1000)) {
    lastRawSend = now;
    kirimRaw(b_total, b_isi, gasNow, suhuNow, humidNow, status);
  }

  // ── 7. Deteksi stabilisasi berat ──────────────────────────────
  if (b_total >= BERAT_KURANG) {
    adaTabung = true;
    if (abs(b_total - b_sebelum) < 0.05) {
      if (now - waktuMulaiDiam > 3000) {
        // Berat stabil selama 3 detik → simpan snapshot
        b_stabil = b_total;
        g_stabil = gasNow;
        t_stabil = suhuNow;
        h_stabil = humidNow;
        statusTerakhir = status;

        if (!sudahBipStabil) {
          tone(BUZZER_PIN, 2000, 200);
          sudahBipStabil = true;
          Serial.println("Berat stabil: " + String(b_stabil) + " kg | status: " + statusTerakhir);
        }
      }
    } else {
      // Berat berubah → reset timer stabilisasi
      waktuMulaiDiam = now;
      b_sebelum      = b_total;
      sudahBipStabil = false;
    }
  } else {
    sudahBipStabil = false;
  }

  // ── 8. Kirim /history saat tabung diangkat ────────────────────
  if (adaTabung && b_total < 1.00) {
    if (b_stabil >= BERAT_KURANG) {
      float isi_stabil = b_stabil > BERAT_TABUNG ? b_stabil - BERAT_TABUNG : 0;
      kirimHistory(b_stabil, isi_stabil, g_stabil, statusTerakhir, t_stabil, h_stabil);

      // Bip dua kali — tanda berhasil kirim
      tone(BUZZER_PIN, 2500, 100); delay(150);
      tone(BUZZER_PIN, 2500, 100);
      Serial.println("History terkirim.");
    }
    adaTabung = false;
    b_stabil  = 0;
  }

  delay(1000);
}


// ================================================================
//  LOGIKA STATUS (persis seperti versi lama)
// ================================================================
String hitungStatus(int gas, float berat) {
  if (gas > PPM_BOCOR)        return "BOCOR";
  if (berat >= BERAT_LAYAK)   return "LAYAK";
  if (berat >= BERAT_KURANG)  return "KURANG";
  return "KOSONG";
}


// ================================================================
//  LED & BUZZER
// ================================================================
void updateLEDAndBuzzer(String status) {
  if (status == "BOCOR") {
    digitalWrite(LED_RED,    HIGH);
    digitalWrite(LED_GREEN,  LOW);
    digitalWrite(LED_YELLOW, LOW);
    tone(BUZZER_PIN, 1000);
  } else {
    noTone(BUZZER_PIN);
    digitalWrite(LED_RED, LOW);

    if (status == "LAYAK") {
      digitalWrite(LED_GREEN,  HIGH);
      digitalWrite(LED_YELLOW, LOW);
    } else if (status == "KURANG") {
      digitalWrite(LED_GREEN,  LOW);
      digitalWrite(LED_YELLOW, HIGH);
    } else {  // KOSONG
      digitalWrite(LED_GREEN,  LOW);
      digitalWrite(LED_YELLOW, LOW);
    }
  }
}


// ================================================================
//  FIREBASE REST API HELPERS
// ================================================================

/**
 * Kirim PUT ke Firebase — overwrite path yang ditentukan
 * Digunakan untuk: /live, /history/{key}
 */
bool firebasePut(String path, String jsonBody) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi terputus, skip: " + path);
    return false;
  }

  HTTPClient http;
  String url = String(FIREBASE_HOST) + path + ".json";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int code = http.PUT(jsonBody);
  bool ok  = (code == 200);

  if (!ok) Serial.printf("Firebase PUT error %d: %s\n", code, path.c_str());

  http.end();
  return ok;
}

/**
 * Kirim POST ke Firebase — push dengan key unik otomatis
 * Digunakan untuk: /raw
 */
bool firebasePost(String path, String jsonBody) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(FIREBASE_HOST) + path + ".json";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(jsonBody);
  bool ok  = (code == 200 || code == 200);

  http.end();
  return ok;
}

/**
 * Build JSON payload sensor — field sesuai struktur /live dan /raw
 */
String buildSensorJson(float berat, float isi, int ppm,
                       float suhu, float humid, String status,
                       String id = "") {
  StaticJsonDocument<256> doc;

  if (id.length() > 0) doc["id"] = id;
  doc["berat"]     = serialized(String(berat, 2));
  doc["isi"]       = serialized(String(isi, 2));
  doc["ppm"]       = ppm;
  doc["suhu"]      = serialized(String(suhu, 1));
  doc["humidity"]  = serialized(String(humid, 1));
  doc["status"]    = status;
  doc["timestamp"] = (long long)millis();  // ganti dengan NTP timestamp jika ada modul RTC
  doc["device_id"] = "ESP32-LPG-01";

  String out;
  serializeJson(doc, out);
  return out;
}

/**
 * Kirim ke /live — overwrite dengan data terkini
 */
void kirimLive(float berat, float isi, int ppm,
               float suhu, float humid, String status) {
  String body = buildSensorJson(berat, isi, ppm, suhu, humid, status);
  if (firebasePut("/live", body)) {
    Serial.printf("Live: berat=%.2f isi=%.2f ppm=%d status=%s\n",
                  berat, isi, ppm, status.c_str());
  }
}

/**
 * Kirim ke /raw — push record baru (tidak overwrite)
 */
void kirimRaw(float berat, float isi, int ppm,
              float suhu, float humid, String status) {
  String body = buildSensorJson(berat, isi, ppm, suhu, humid, status);
  firebasePost("/raw", body);
}

/**
 * Kirim ke /history — satu record per pengangkatan tabung
 * Berisi rata-rata (dalam konteks ini = nilai stabil saat tabung diam)
 */
void kirimHistory(float berat, float isi, int ppm,
                  String status, float suhu, float humid) {
  long long ts = (long long)millis();
  String id    = "HIST-" + String(ts);

  StaticJsonDocument<384> doc;
  doc["id"]           = id;
  doc["berat_avg"]    = serialized(String(berat, 2));
  doc["isi_avg"]      = serialized(String(isi, 2));
  doc["ppm_avg"]      = ppm;
  doc["ppm_max"]      = ppm;  // Untuk versi sederhana: isi sama
  doc["ppm_min"]      = ppm;  // Anda bisa track min/max selama stabil jika perlu
  doc["suhu_avg"]     = serialized(String(suhu, 1));
  doc["humidity_avg"] = serialized(String(humid, 1));
  doc["status"]       = status;
  doc["sample_count"] = 1;
  doc["timestamp"]    = ts;
  doc["device_id"]    = "ESP32-LPG-01";

  String body;
  serializeJson(doc, body);

  // PUT ke /history/{id} — key = ID unik
  String path = "/history/" + id;
  if (firebasePut(path, body)) {
    Serial.printf("History terkirim: %s | status=%s\n", id.c_str(), status.c_str());
  }
}


// ================================================================
//  HELPER LCD
// ================================================================
void lcdCenter(String text, int row) {
  int len = text.length();
  int pos = (16 - len) / 2;
  if (pos < 0) pos = 0;
  lcd.setCursor(pos, row);
  lcd.print(text);
}