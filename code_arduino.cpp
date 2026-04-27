/**
 * ================================================================
 * ESP32 — Sistem QC LPG Pangkalan Gas
 * Tabung Melon 3 kg | Sensor MQ-6 + HX711 + DHT22
 * ================================================================
 *
 * SPESIFIKASI TABUNG LPG 3 KG (Regulasi Pertamina / SNI):
 *   Berat tabung kosong (tare)     : ±5.0  kg
 *   Berat isi LPG (netto)          :  3.0  kg
 *   Berat total ideal (bruto)      :  8.0  kg
 *   Toleransi pengurangan maks     :  90   gram
 *   Berat minimum LAYAK JUAL       :  7.91 kg
 *
 * SENSOR GAS MQ-6:
 *   Target gas    : LPG (Propane, Butane)
 *   Library       : MQUnifiedsensor
 *   Output        : ppm LPG (bukan raw ADC)
 *   Ambang bocor  : >= 1000 ppm
 *   Referensi     : OSHA & standar industri LPG
 *                   LEL LPG = 18.000 ppm
 *                   Alarm awal praktis di lapangan = 1000 ppm
 *
 * CATATAN KALIBRASI:
 *   1. Jalankan sketch kalibrasi_mq6.ino TERLEBIH DAHULU
 *      di udara bersih luar ruangan selama 24 jam
 *   2. Catat nilai R0 yang didapat dari Serial Monitor
 *   3. Isi nilai R0 di bawah (konstanta MQ6_R0)
 *   4. Untuk HX711: kalibrasi ulang dengan beban 8 kg
 *      untuk validasi akurasi di range berat tabung penuh
 *
 * LIBRARY YANG DIBUTUHKAN (Arduino IDE → Library Manager):
 *   - MQUnifiedsensor by Miguel A Califa U  ← WAJIB untuk MQ-6
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
#include <MQUnifiedsensor.h>
#include "HX711.h"
#include "DHT.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ================================================================
//  PIN MAPPING
// ================================================================
#define HX_DT       4
#define HX_SCK      5
#define PIN_GAS_A0  34    // Pin ADC untuk MQ-6 (input analog)
#define LED_RED     25
#define LED_YELLOW  26
#define LED_GREEN   33
#define BUZZER_PIN  27
#define DHTPIN      14
#define DHTTYPE     DHT22

// ================================================================
//  KONFIGURASI MQ-6
// ================================================================
#define MQ6_BOARD       "ESP32"
#define MQ6_PIN         "A0"      // label pin (untuk library)
#define MQ6_TYPE        "MQ-6"
#define MQ6_VOLT_RES    5.0       // tegangan supply sensor (5V)
#define MQ6_ADC_BIT     12        // resolusi ADC ESP32 = 12 bit (0-4095)
#define MQ6_RATIO_CLEAN 10.0      // Rs/R0 di udara bersih (dari datasheet MQ-6)

// ── NILAI R0 — WAJIB DIISI setelah menjalankan sketch kalibrasi ──
// Petunjuk: jalankan kalibrasi_mq6.ino, baca nilai dari Serial Monitor
// Contoh nilai: jika Serial menampilkan "R0 = 4.56", isi 4.56
#define MQ6_R0  4.0   // <-- GANTI dengan nilai R0 hasil kalibrasi Anda

// ================================================================
//  KONFIGURASI CLOUD
// ================================================================
const char* WIFI_SSID     = "bots";
const char* WIFI_PASS     = "12345678";

const char* FIREBASE_HOST =
  "https://pangkalan-lpg-a6406-default-rtdb.asia-southeast1.firebasedatabase.app";

// Isi setelah Apps Script di-deploy
// Format: https://script.google.com/macros/s/AKfycby.../exec
const char* GAS_ENDPOINT  =
  "GANTI_DENGAN_URL_APPS_SCRIPT_ANDA";

// ================================================================
//  KALIBRASI HARDWARE
// ================================================================
const float HX711_SCALE       = 23483.0;  // Ganti setelah kalibrasi ulang 8 kg
const float BERAT_TABUNG_KOSONG = 5.0;    // kg — berat tabung melon kosong

// ================================================================
//  THRESHOLD STATUS — HARUS SAMA dengan dashboard.js & apps_script.gs
// ================================================================
const float PPM_BOCOR    = 1000.0; // ppm — ambang batas bocor MQ-6
const float BERAT_LAYAK  = 7.91;   // kg  — batas minimum layak jual Pertamina
const float BERAT_KURANG = 5.1;    // kg  — batas bawah ada isi LPG

// ================================================================
//  INTERVAL & PARAMETER
// ================================================================
const unsigned long LIVE_INTERVAL  = 1000;   // ms — update /live
const unsigned long RAW_INTERVAL   = 10000;  // ms — simpan /raw (0=nonaktif)
const float         STABIL_DELTA   = 0.05;   // kg — toleransi gerak
const unsigned long STABIL_DURASI  = 3000;   // ms — durasi stabil

// ================================================================
//  OBJEK HARDWARE
// ================================================================
LiquidCrystal_I2C lcd(0x27, 16, 2);
HX711 scale;
DHT   dht(DHTPIN, DHTTYPE);

// Inisialisasi MQ-6 dengan library MQUnifiedsensor
MQUnifiedsensor MQ6(MQ6_BOARD, MQ6_VOLT_RES, MQ6_ADC_BIT, PIN_GAS_A0, MQ6_TYPE);

// ================================================================
//  VARIABEL STATE
// ================================================================
float  suhuNow = 0, humidNow = 0;
float  ppmNow  = 0;

float  b_stabil = 0, ppm_stabil = 0;
float  t_stabil = 0, h_stabil   = 0;
String statusTerakhir = "";

float         b_sebelum      = 0;
unsigned long waktuMulaiDiam = 0;
bool          sudahBipStabil = false;
bool          adaTabung      = false;
bool          sistemReady    = false;

unsigned long lastLiveSend = 0;
unsigned long lastRawSend  = 0;

// ================================================================
//  FORWARD DECLARATIONS
// ================================================================
String hitungStatus(float ppm, float berat);
void   updateLEDAndBuzzer(String status);
void   updateLCD(float b_total, float b_isi, float ppm, String status);
void   kirimLive(float berat, float isi, float ppm, float suhu, float humid, String status);
void   kirimRaw(float berat, float isi, float ppm, float suhu, float humid, String status);
void   kirimHistory(float berat, float isi, float ppm, String status, float suhu, float humid);
void   kirimKeAppsScript(float berat, float isi, float ppm, String status, float suhu, float humid);
bool   firebasePut(String path, String body);
bool   firebasePost(String path, String body);
String buildLiveJson(float berat, float isi, float ppm, float suhu, float humid, String status);
String buildHistoryJson(String id, float berat, float isi, float ppm, String status, float suhu, float humid, unsigned long ts);
void   lcdCenter(String text, int row);

// ================================================================
//  SETUP
// ================================================================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(500);
  Serial.println("\n=========================================");
  Serial.println("  Sistem QC LPG — Pangkalan Gas");
  Serial.println("  Tabung LPG 3 kg | Sensor MQ-6");
  Serial.println("=========================================");

  // Init hardware
  lcd.init(); lcd.backlight();
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_RED,    OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN,  OUTPUT);
  digitalWrite(LED_RED,    LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_GREEN,  LOW);

  // Init HX711
  scale.begin(HX_DT, HX_SCK);
  scale.set_scale(HX711_SCALE);
  scale.tare();
  Serial.println("[HX711]  Timbangan di-tare (zeroed)");

  // Init DHT22
  dht.begin();
  Serial.println("[DHT22]  Init OK");

  // ── Init MQ-6 dengan MQUnifiedsensor ──────────────────────────
  MQ6.setRegressionMethod(1);     // Gunakan metode regresi eksponensial
  MQ6.setA(1000.5);               // Koefisien A dari datasheet/kurva LPG MQ-6
  MQ6.setB(-2.186);               // Koefisien B dari datasheet/kurva LPG MQ-6
  //
  // Catatan kurva LPG MQ-6 (dari datasheet):
  //   Gas LPG: A = 1000.5, B = -2.186
  //   (didapat dari fitting kurva karakteristik Rs/Ro vs ppm)
  //
  MQ6.init();
  MQ6.setR0(MQ6_R0);             // Set nilai R0 hasil kalibrasi
  Serial.printf("[MQ-6]   Init OK | R0 = %.2f\n", MQ6_R0);

  if (MQ6_R0 == 4.0) {
    Serial.println("[MQ-6]   PERINGATAN: Masih menggunakan R0 default!");
    Serial.println("         Jalankan kalibrasi_mq6.ino untuk nilai akurat.");
  }

  // ── Warm-up MQ-6 (3 menit wajib) ──────────────────────────────
  Serial.println("[MQ-6]   Warm-up 3 menit dimulai...");
  for (int i = 180; i > 0; i--) {
    lcd.clear();
    lcdCenter("WARM-UP MQ-6", 0);
    lcdCenter("Tunggu: " + String(i) + "s", 1);
    if (i % 30 == 0) Serial.printf("[MQ-6]   Warm-up: %d detik lagi\n", i);
    delay(1000);
  }
  Serial.println("[MQ-6]   Warm-up selesai");

  // ── Koneksi WiFi ──────────────────────────────────────────────
  lcd.clear();
  lcdCenter("KONEKSI WIFI...", 0);
  Serial.printf("[WiFi]   Menghubungkan ke: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 30) {
    delay(500); Serial.print("."); timeout++;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    lcdCenter("WIFI OK!", 1);
    Serial.printf("[WiFi]   OK — IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    lcdCenter("WIFI GAGAL", 1);
    Serial.println("[WiFi]   GAGAL — mode offline");
  }
  delay(1500);

  // Print konfigurasi aktif
  Serial.println("\n[CONFIG] Threshold aktif (Regulasi Pertamina LPG 3 kg):");
  Serial.printf("  Tabung kosong     : %.1f kg\n",  BERAT_TABUNG_KOSONG);
  Serial.printf("  Berat total ideal : 8.00 kg\n");
  Serial.printf("  LAYAK JUAL        : >= %.2f kg\n", BERAT_LAYAK);
  Serial.printf("  KURANG ISI        : %.1f – %.2f kg\n", BERAT_KURANG, BERAT_LAYAK - 0.01f);
  Serial.printf("  KOSONG            : <= %.1f kg\n",  BERAT_KURANG);
  Serial.printf("  BOCOR (MQ-6)      : >= %.0f ppm\n", PPM_BOCOR);
  Serial.printf("  GAS endpoint      : %s\n",
    String(GAS_ENDPOINT).indexOf("GANTI") >= 0 ? "BELUM DIISI!" : "OK");

  sistemReady = true;
  lcd.clear();
  Serial.println("\n[SISTEM] Siap — letakkan tabung untuk pemeriksaan");
  Serial.println("=========================================\n");
}

// ================================================================
//  LOOP UTAMA
// ================================================================
void loop() {
  if (!sistemReady) return;
  unsigned long now = millis();

  // 1. Baca berat
  float b_total = scale.get_units(5);
  if (b_total < 0.10) b_total = 0;
  float b_isi = (b_total > BERAT_TABUNG_KOSONG)
                ? b_total - BERAT_TABUNG_KOSONG : 0.0;

  // 2. Baca sensor MQ-6 (output dalam ppm)
  MQ6.update();           // Update nilai ADC dari sensor
  ppmNow = MQ6.readSensor(); // Hitung ppm berdasarkan kurva karakteristik
  if (ppmNow < 0) ppmNow = 0; // Sanitasi nilai negatif

  // 3. Baca DHT22
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) { suhuNow = t; humidNow = h; }

  // 4. Hitung status
  String status = hitungStatus(ppmNow, b_total);

  // 5. LED & Buzzer
  updateLEDAndBuzzer(status);

  // 6. LCD
  updateLCD(b_total, b_isi, ppmNow, status);

  // 7. Kirim /live tiap 1 detik
  if (now - lastLiveSend >= LIVE_INTERVAL) {
    lastLiveSend = now;
    kirimLive(b_total, b_isi, ppmNow, suhuNow, humidNow, status);
    Serial.printf("[LIVE]  berat=%.2f isi=%.2f ppm=%.0f %s\n",
                  b_total, b_isi, ppmNow, status.c_str());
  }

  // 8. Simpan /raw
  if (RAW_INTERVAL > 0 && (now - lastRawSend >= RAW_INTERVAL)) {
    lastRawSend = now;
    kirimRaw(b_total, b_isi, ppmNow, suhuNow, humidNow, status);
  }

  // 9. Deteksi stabilisasi berat
  if (b_total >= BERAT_KURANG) {
    adaTabung = true;
    if (abs(b_total - b_sebelum) < STABIL_DELTA) {
      if (now - waktuMulaiDiam >= STABIL_DURASI) {
        b_stabil   = b_total;
        ppm_stabil = ppmNow;
        t_stabil   = suhuNow;
        h_stabil   = humidNow;
        statusTerakhir = status;
        if (!sudahBipStabil) {
          tone(BUZZER_PIN, 2000, 200);
          sudahBipStabil = true;
          float isi_s = b_stabil > BERAT_TABUNG_KOSONG
                        ? b_stabil - BERAT_TABUNG_KOSONG : 0;
          Serial.println("\n[STABIL] Nilai terkunci:");
          Serial.printf("         Total=%.2fkg | Isi=%.2fkg | PPM=%.0f | %s\n",
                        b_stabil, isi_s, ppm_stabil, statusTerakhir.c_str());
        }
      }
    } else {
      waktuMulaiDiam = now;
      b_sebelum      = b_total;
      sudahBipStabil = false;
    }
  } else {
    sudahBipStabil = false;
  }

  // 10. Tabung diangkat → kirim hasil
  if (adaTabung && b_total < 1.0) {
    if (b_stabil >= BERAT_KURANG) {
      float isi_stabil = b_stabil > BERAT_TABUNG_KOSONG
                         ? b_stabil - BERAT_TABUNG_KOSONG : 0;
      Serial.println("\n[KIRIM]  Tabung diangkat — kirim hasil pemeriksaan...");

      kirimKeAppsScript(b_stabil, isi_stabil, ppm_stabil,
                        statusTerakhir, t_stabil, h_stabil);
      kirimHistory(b_stabil, isi_stabil, ppm_stabil,
                   statusTerakhir, t_stabil, h_stabil);

      tone(BUZZER_PIN, 2500, 100); delay(150);
      tone(BUZZER_PIN, 2500, 100);
      Serial.println("[KIRIM]  Selesai — siap tabung berikutnya\n");
    } else {
      Serial.println("[INFO]   Tabung diangkat, data stabil belum ada — skip");
    }
    adaTabung      = false;
    b_stabil       = 0;
    b_sebelum      = 0;
    ppm_stabil     = 0;
    statusTerakhir = "";
    waktuMulaiDiam = millis();
  }

  delay(1000);
}

// ================================================================
//  LOGIKA STATUS
// ================================================================
String hitungStatus(float ppm, float berat) {
  if (berat <= BERAT_KURANG) return "KOSONG";
  if (ppm >= PPM_BOCOR)      return "BOCOR";
  if (berat >= BERAT_LAYAK)  return "LAYAK";
  return "KURANG";
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
//  LCD
// ================================================================
void updateLCD(float b_total, float b_isi, float ppm, String status) {
  lcd.setCursor(0, 0);
  lcd.print("T:"); lcd.print(b_total, 1);
  lcd.print(" I:"); lcd.print(b_isi, 1);
  lcd.print("kg   ");
  lcd.setCursor(0, 1);
  lcd.print((int)ppm); lcd.print("ppm ");
  lcd.print(status.substring(0, 6));
  lcd.print("      ");
}

// ================================================================
//  FIREBASE REST API
// ================================================================
bool firebasePut(String path, String body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(FIREBASE_HOST) + path + ".json");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);
  int code = http.PUT(body);
  http.end();
  if (code != 200) Serial.printf("[Firebase] PUT error HTTP %d: %s\n", code, path.c_str());
  return code == 200;
}

bool firebasePost(String path, String body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(FIREBASE_HOST) + path + ".json");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);
  int code = http.POST(body);
  http.end();
  return (code == 200 || code == 201);
}

String buildLiveJson(float berat, float isi, float ppm,
                     float suhu, float humid, String status) {
  StaticJsonDocument<300> doc;
  doc["berat"]    = serialized(String(berat, 2));
  doc["isi"]      = serialized(String(isi,   2));
  doc["ppm"]      = (int)ppm;
  doc["suhu"]     = serialized(String(suhu,  1));
  doc["humidity"] = serialized(String(humid, 1));
  doc["status"]   = status;
  doc["timestamp"]= (unsigned long)millis();
  doc["device_id"]= "ESP32-LPG-01";
  String out; serializeJson(doc, out);
  return out;
}

String buildHistoryJson(String id, float berat, float isi, float ppm,
                        String status, float suhu, float humid,
                        unsigned long ts) {
  StaticJsonDocument<400> doc;
  doc["id"]           = id;
  doc["berat_avg"]    = serialized(String(berat, 2));
  doc["isi_avg"]      = serialized(String(isi,   2));
  doc["ppm_avg"]      = (int)ppm;
  doc["ppm_max"]      = (int)ppm;
  doc["ppm_min"]      = (int)ppm;
  doc["suhu_avg"]     = serialized(String(suhu,  1));
  doc["humidity_avg"] = serialized(String(humid, 1));
  doc["status"]       = status;
  doc["sample_count"] = 1;
  doc["timestamp"]    = ts;
  doc["device_id"]    = "ESP32-LPG-01";
  String out; serializeJson(doc, out);
  return out;
}

void kirimLive(float berat, float isi, float ppm,
               float suhu, float humid, String status) {
  firebasePut("/live", buildLiveJson(berat, isi, ppm, suhu, humid, status));
}

void kirimRaw(float berat, float isi, float ppm,
              float suhu, float humid, String status) {
  firebasePost("/raw", buildLiveJson(berat, isi, ppm, suhu, humid, status));
}

void kirimHistory(float berat, float isi, float ppm,
                  String status, float suhu, float humid) {
  unsigned long ts = millis();
  String id   = "HIST-" + String(ts);
  String body = buildHistoryJson(id, berat, isi, ppm, status, suhu, humid, ts);
  if (firebasePut("/history/" + id, body))
    Serial.println("[Firebase] /history OK: " + id);
}

void kirimKeAppsScript(float berat, float isi, float ppm,
                       String status, float suhu, float humid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[GAS] Skip — WiFi tidak terhubung");
    return;
  }
  if (String(GAS_ENDPOINT).indexOf("GANTI") >= 0) {
    Serial.println("[GAS] Skip — URL Apps Script belum diisi");
    return;
  }
  unsigned long ts = millis();
  String id   = "HIST-" + String(ts);
  String body = buildHistoryJson(id, berat, isi, ppm, status, suhu, humid, ts);

  Serial.println("[GAS] Mengirim ke Spreadsheet...");
  HTTPClient http;
  http.begin(GAS_ENDPOINT);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);
  int    code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("[GAS] HTTP %d | %s\n", code, resp.c_str());
  if (code == 200) Serial.println("[GAS] Spreadsheet berhasil!");
}

// ================================================================
//  LCD HELPER
// ================================================================
void lcdCenter(String text, int row) {
  int pos = max(0, (16 - (int)text.length()) / 2);
  lcd.setCursor(pos, row);
  lcd.print(text);
}