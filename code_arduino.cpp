/**
 * ================================================================
 * ESP32 — Sistem QC LPG Pangkalan Gas
 * Versi Final — Firebase + Apps Script Web App
 * ================================================================
 *
 * KONTEKS:
 *   Tabung LPG datang dari SPBE → diletakkan di timbangan
 *   → ESP32 baca berat + gas PPM secara realtime
 *   → Saat tabung diangkat (pemeriksaan selesai):
 *       1. Kirim ke Firebase /history (backup)
 *       2. Kirim ke Apps Script → langsung masuk Spreadsheet
 *
 * ALUR DATA:
 *   /live    → Firebase, tiap 1 detik  (dashboard web realtime)
 *   /raw     → Firebase, tiap 10 detik (log mentah opsional)
 *   /history → Firebase, saat diangkat (backup)
 *   GAS URL  → Apps Script doPost, saat diangkat (Spreadsheet instan)
 *
 * LIBRARY (Arduino IDE Library Manager):
 *   - HX711 by Bogdan Necula
 *   - DHT sensor library by Adafruit
 *   - LiquidCrystal I2C by Frank de Brabander
 *   - ArduinoJson by Benoit Blanchon
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

// ── KONFIGURASI JARINGAN & CLOUD ──────────────────────────────────
const char* WIFI_SSID     = "bots";
const char* WIFI_PASS     = "12345678";

const char* FIREBASE_HOST = "https://pangkalan-lpg-a6406-default-rtdb.asia-southeast1.firebasedatabase.app";

// Isi setelah Apps Script di-deploy
// Format: https://script.google.com/macros/s/AKfycby.../exec
const char* GAS_ENDPOINT  = "GANTI_DENGAN_URL_DEPLOY_APPS_SCRIPT";

// ── KALIBRASI SENSOR ─────────────────────────────────────────────
const float BERAT_TABUNG  = 5.0;     // kg — berat tabung kosong 3kg atau 12kg
const float HX711_SCALE   = 23483.0; // hasil kalibrasi load cell

// ── THRESHOLD STATUS ─────────────────────────────────────────────
const int   PPM_BOCOR     = 300;   // PPM > nilai ini → BOCOR
const float BERAT_LAYAK   = 7.80;  // kg — layak jual (tabung 3kg isi penuh = 8kg)
const float BERAT_KURANG  = 4.80;  // kg — isi di bawah standar

// ── INTERVAL ─────────────────────────────────────────────────────
const unsigned long LIVE_INTERVAL = 1000;  // ms — update /live
const unsigned long RAW_INTERVAL  = 10000; // ms — simpan /raw (0 = nonaktif)

// ── OBJEK HARDWARE ───────────────────────────────────────────────
LiquidCrystal_I2C lcd(0x27, 16, 2);
HX711 scale;
DHT   dht(DHTPIN, DHTTYPE);

// ── STATE VARIABEL ────────────────────────────────────────────────
float  b_stabil = 0, b_sebelum = 0;
float  g_stabil = 0, t_stabil  = 0, h_stabil = 0;
float  suhuNow  = 0, humidNow  = 0;
int    gasNow   = 0;

unsigned long waktuMulaiDiam = 0;
unsigned long lastRawSend    = 0;
unsigned long lastLiveSend   = 0;

bool adaTabung      = false;
bool sistemReady    = false;
bool sudahBipStabil = false;
String statusTerakhir = "";


// ================================================================
//  SETUP
// ================================================================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);

  lcd.init(); lcd.backlight();
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_RED,    OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN,  OUTPUT);

  scale.begin(HX_DT, HX_SCK);
  scale.set_scale(HX711_SCALE);
  scale.tare();
  dht.begin();

  // Warm-up sensor MQ (3 menit — sensor gas butuh pemanasan)
  for (int i = 180; i > 0; i--) {
    lcd.clear();
    lcdCenter("WARM-UP SENSOR", 0);
    lcdCenter("Tunggu: " + String(i) + "s", 1);
    delay(1000);
  }

  // Koneksi WiFi
  lcd.clear();
  lcdCenter("KONEKSI WIFI...", 0);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 30) {
    delay(500); timeout++;
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    lcdCenter("WIFI OK!", 1);
    Serial.println("\nWiFi: " + WiFi.localIP().toString());
  } else {
    lcdCenter("WIFI GAGAL", 1);
    Serial.println("\nWiFi gagal — mode offline");
  }

  delay(2000);
  sistemReady = true;
  lcd.clear();
  Serial.println("Sistem siap. Letakkan tabung untuk mulai pemeriksaan.");
}


// ================================================================
//  LOOP UTAMA
// ================================================================
void loop() {
  if (!sistemReady) return;
  unsigned long now = millis();

  // 1. Baca sensor
  float b_total = scale.get_units(5);
  if (b_total < 0.15) b_total = 0;
  float b_isi = (b_total > BERAT_TABUNG) ? b_total - BERAT_TABUNG : 0;

  gasNow = analogRead(PIN_GAS_A0);

  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) { suhuNow = t; humidNow = h; }

  // 2. Hitung status
  String status = hitungStatus(gasNow, b_total);

  // 3. LED & Buzzer
  updateLEDAndBuzzer(status);

  // 4. Update LCD (anti-kedip — overwrite karakter)
  lcd.setCursor(0, 0);
  lcd.print("T:"); lcd.print(b_total, 1);
  lcd.print(" I:"); lcd.print(b_isi, 1); lcd.print("kg  ");
  lcd.setCursor(0, 1);
  lcd.print(gasNow); lcd.print("ppm ");
  lcd.print(suhuNow, 1); lcd.print("C ");
  lcd.print(status.substring(0, 5)); lcd.print("  ");

  // 5. Kirim /live setiap 1 detik
  if (now - lastLiveSend >= LIVE_INTERVAL) {
    lastLiveSend = now;
    kirimLive(b_total, b_isi, gasNow, suhuNow, humidNow, status);
  }

  // 6. Kirim /raw (jika aktif)
  if (RAW_INTERVAL > 0 && (now - lastRawSend >= RAW_INTERVAL)) {
    lastRawSend = now;
    kirimRaw(b_total, b_isi, gasNow, suhuNow, humidNow, status);
  }

  // 7. Deteksi stabilisasi berat
  if (b_total >= BERAT_KURANG) {
    adaTabung = true;
    if (abs(b_total - b_sebelum) < 0.05) {
      // Berat tidak berubah signifikan
      if (now - waktuMulaiDiam > 3000) {
        // Stabil > 3 detik → lock nilai
        b_stabil = b_total; g_stabil = gasNow;
        t_stabil = suhuNow; h_stabil = humidNow;
        statusTerakhir = status;

        if (!sudahBipStabil) {
          tone(BUZZER_PIN, 2000, 200);
          sudahBipStabil = true;
          Serial.printf("Stabil: %.2f kg | isi: %.2f kg | status: %s\n",
                        b_stabil, b_stabil - BERAT_TABUNG, statusTerakhir.c_str());
        }
      }
    } else {
      // Berat bergerak → reset stabilisasi
      waktuMulaiDiam = now;
      b_sebelum      = b_total;
      sudahBipStabil = false;
    }
  } else {
    sudahBipStabil = false;
  }

  // 8. Tabung diangkat → kirim hasil pemeriksaan
  if (adaTabung && b_total < 1.00) {
    if (b_stabil >= BERAT_KURANG) {
      float isi_stabil = b_stabil > BERAT_TABUNG ? b_stabil - BERAT_TABUNG : 0;

      // Kirim ke Apps Script → Spreadsheet (instan)
      kirimKeAppsScript(b_stabil, isi_stabil, g_stabil, statusTerakhir, t_stabil, h_stabil);

      // Kirim ke Firebase /history (backup)
      kirimHistory(b_stabil, isi_stabil, g_stabil, statusTerakhir, t_stabil, h_stabil);

      // Bip dua kali = konfirmasi terkirim
      tone(BUZZER_PIN, 2500, 100); delay(150);
      tone(BUZZER_PIN, 2500, 100);
      Serial.println("Hasil pemeriksaan terkirim.");
    }
    adaTabung = false;
    b_stabil  = 0;
  }

  delay(1000);
}


// ================================================================
//  LOGIKA STATUS (sama dengan versi sebelumnya)
// ================================================================
String hitungStatus(int gas, float berat) {
  if (gas > PPM_BOCOR)       return "BOCOR";
  if (berat >= BERAT_LAYAK)  return "LAYAK";
  if (berat >= BERAT_KURANG) return "KURANG";
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
    } else {
      digitalWrite(LED_GREEN,  LOW);
      digitalWrite(LED_YELLOW, LOW);
    }
  }
}


// ================================================================
//  FIREBASE REST API
// ================================================================
bool firebasePut(String path, String body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(FIREBASE_HOST) + path + ".json");
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(body);
  http.end();
  return code == 200;
}

bool firebasePost(String path, String body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(FIREBASE_HOST) + path + ".json");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  return (code == 200 || code == 201);
}

String buildJson(float berat, float isi, int ppm,
                 float suhu, float humid, String status, String id = "") {
  StaticJsonDocument<300> doc;
  if (id.length() > 0) doc["id"] = id;
  doc["berat"]     = serialized(String(berat, 2));
  doc["isi"]       = serialized(String(isi,   2));
  doc["ppm"]       = ppm;
  doc["suhu"]      = serialized(String(suhu,  1));
  doc["humidity"]  = serialized(String(humid, 1));
  doc["status"]    = status;
  doc["timestamp"] = (unsigned long)millis();
  doc["device_id"] = "ESP32-LPG-01";
  String out; serializeJson(doc, out);
  return out;
}

void kirimLive(float berat, float isi, int ppm, float suhu, float humid, String status) {
  firebasePut("/live", buildJson(berat, isi, ppm, suhu, humid, status));
}

void kirimRaw(float berat, float isi, int ppm, float suhu, float humid, String status) {
  firebasePost("/raw", buildJson(berat, isi, ppm, suhu, humid, status));
}

void kirimHistory(float berat, float isi, int ppm,
                  String status, float suhu, float humid) {
  unsigned long ts = millis();
  String id = "HIST-" + String(ts);

  StaticJsonDocument<400> doc;
  doc["id"]           = id;
  doc["berat_avg"]    = serialized(String(berat, 2));
  doc["isi_avg"]      = serialized(String(isi,   2));
  doc["ppm_avg"]      = ppm;
  doc["ppm_max"]      = ppm;
  doc["ppm_min"]      = ppm;
  doc["suhu_avg"]     = serialized(String(suhu,  1));
  doc["humidity_avg"] = serialized(String(humid, 1));
  doc["status"]       = status;
  doc["sample_count"] = 1;
  doc["timestamp"]    = ts;
  doc["device_id"]    = "ESP32-LPG-01";

  String body; serializeJson(doc, body);
  if (firebasePut("/history/" + id, body)) {
    Serial.println("Firebase /history OK: " + id);
  }
}


// ================================================================
//  APPS SCRIPT doPost — langsung ke Spreadsheet
// ================================================================
void kirimKeAppsScript(float berat, float isi, int ppm,
                       String status, float suhu, float humid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skip GAS: WiFi tidak terhubung");
    return;
  }
  if (String(GAS_ENDPOINT).indexOf("GANTI") >= 0) {
    Serial.println("Skip GAS: URL belum diisi");
    return;
  }

  unsigned long ts = millis();
  String id = "HIST-" + String(ts);

  StaticJsonDocument<400> doc;
  doc["id"]           = id;
  doc["berat_avg"]    = serialized(String(berat, 2));
  doc["isi_avg"]      = serialized(String(isi,   2));
  doc["ppm_avg"]      = ppm;
  doc["ppm_max"]      = ppm;
  doc["ppm_min"]      = ppm;
  doc["suhu_avg"]     = serialized(String(suhu,  1));
  doc["humidity_avg"] = serialized(String(humid, 1));
  doc["status"]       = status;
  doc["sample_count"] = 1;
  doc["timestamp"]    = ts;
  doc["device_id"]    = "ESP32-LPG-01";

  String body; serializeJson(doc, body);

  HTTPClient http;
  http.begin(GAS_ENDPOINT);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.addHeader("Content-Type", "application/json");

  int    code = http.POST(body);
  String resp = http.getString();
  http.end();

  Serial.printf("GAS doPost: HTTP %d | %s\n", code, resp.c_str());
}


// ================================================================
//  HELPER LCD
// ================================================================
void lcdCenter(String text, int row) {
  int pos = max(0, (16 - (int)text.length()) / 2);
  lcd.setCursor(pos, row);
  lcd.print(text);
}