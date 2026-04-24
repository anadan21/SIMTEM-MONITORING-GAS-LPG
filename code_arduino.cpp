//ini hanya dokumentasi code agar bisa di push ke github

#include <WiFi.h>
#include <BlynkSimpleEsp32.h>
#include <LiquidCrystal_I2C.h>
#include <HTTPClient.h>
#include "HX711.h"
#include "DHT.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// --- PIN SETTINGS ---
#define HX_DT          4
#define HX_SCK         5
#define PIN_GAS_A0     34 
#define LED_RED        25   
#define LED_YELLOW     26   
#define LED_GREEN      33   
#define BUZZER_PIN     27
#define DHTPIN         14
#define DHTTYPE        DHT22

char auth[] = BLYNK_AUTH_TOKEN;
char ssid[] = "bots";
char pass[] = "12345678";
String G_ID = "AKfycbyC20F4-jRUUlUoPjV4mgsbj3-nTpQCYG4IIhBmFrLQdWDKyn1VQ9IrM6tGvEdCcZbByQ"; 

LiquidCrystal_I2C lcd(0x27, 16, 2);
HX711 scale;
BlynkTimer timer;
DHT dht(DHTPIN, DHTTYPE);

float b_stabil = 0, b_sebelum = 0, g_stabil = 0, t_stabil = 0, h_stabil = 0;
float suhuSekarang = 0, lembapSekarang = 0;
unsigned long waktuMulaiDiam = 0;
int gasGlobal = 0, nomorData = 0;
bool adaTabung = false, sistemReady = false, sudahBipStabil = false;
String statusTerakhir = "";

void lcdCenter(String text, int row) {
  int len = text.length();
  int pos = (16 - len) / 2;
  if (pos < 0) pos = 0;
  lcd.setCursor(pos, row);
  lcd.print(text);
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); 
  Serial.begin(115200);
  lcd.init(); lcd.backlight();
  pinMode(BUZZER_PIN, OUTPUT); 
  pinMode(LED_RED, OUTPUT); pinMode(LED_YELLOW, OUTPUT); pinMode(LED_GREEN, OUTPUT);

  scale.begin(HX_DT, HX_SCK);
  scale.set_scale(23483.0); 
  scale.tare();
  dht.begin();

  for (int i = 180; i > 0; i--) {
    lcd.clear();
    lcdCenter("WARM-UP SENSOR", 0);
    lcdCenter("Tunggu: " + String(i) + "s", 1);
    delay(1000);
  }

  lcd.clear();
  lcdCenter("KONEKSI WIFI", 0);
  WiFi.begin(ssid, pass);
  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 20) { delay(500); timeout++; }

  if (WiFi.status() == WL_CONNECTED) {
    lcdCenter("CONNECTED!", 1);
    Blynk.config(auth);
    Blynk.connect();
  } else {
    lcdCenter("WIFI ERROR", 1);
  }
  
  delay(2000);
  sistemReady = true;
  lcd.clear();
  timer.setInterval(1000L, prosesSistem); 
}

void prosesSistem() {
  if (!sistemReady) return;

  // 1. BACA DATA
  float b_total = scale.get_units(5); 
  if (b_total < 0.15) b_total = 0;
  float b_isi = (b_total > 5.0) ? b_total - 5.0 : 0; 
  gasGlobal = analogRead(PIN_GAS_A0);
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) { suhuSekarang = t; lembapSekarang = h; }

  // 2. UPDATE BLYNK (Sinkron)
  Blynk.virtualWrite(V0, b_total);
  Blynk.virtualWrite(V1, gasGlobal);
  Blynk.virtualWrite(V4, suhuSekarang);
  Blynk.virtualWrite(V5, lembapSekarang);
  Blynk.virtualWrite(V6, b_isi);

  // 3. LCD ANTI-KEDIP (Overwrite)
  lcd.setCursor(0, 0);
  lcd.print("T:"); lcd.print(b_total, 1); 
  lcd.print(" B:"); lcd.print(b_isi, 1); lcd.print("    ");

  lcd.setCursor(0, 1);
  lcd.print(gasGlobal); lcd.print("PPM  ");
  lcd.print(suhuSekarang, 1); lcd.print("C   ");

  // 4. LOGIKA STATUS
  String statusSekarang = "";
  if (gasGlobal > 300) {
    statusSekarang = "BOCOR";
    digitalWrite(LED_RED, HIGH); tone(BUZZER_PIN, 1000);
  } else {
    digitalWrite(LED_RED, LOW); noTone(BUZZER_PIN);
    if (b_total >= 7.80) { statusSekarang = "LAYAK"; digitalWrite(LED_GREEN, HIGH); digitalWrite(LED_YELLOW, LOW); }
    else if (b_total >= 4.80) { statusSekarang = "KURANG"; digitalWrite(LED_GREEN, LOW); digitalWrite(LED_YELLOW, HIGH); }
    else { statusSekarang = "KOSONG"; digitalWrite(LED_GREEN, LOW); digitalWrite(LED_YELLOW, LOW); }
  }

  // 5. STABILISASI & LOCK
  if (b_total >= 4.80) {
    adaTabung = true;
    if (abs(b_total - b_sebelum) < 0.05) {
      if (millis() - waktuMulaiDiam > 3000) {
        b_stabil = b_total; g_stabil = gasGlobal;
        t_stabil = suhuSekarang; h_stabil = lembapSekarang;
        statusTerakhir = statusSekarang;
        if (!sudahBipStabil) { tone(BUZZER_PIN, 2000, 200); sudahBipStabil = true; }
      }
    } else { waktuMulaiDiam = millis(); b_sebelum = b_total; sudahBipStabil = false; }
  } else { sudahBipStabil = false; }

  // 6. KIRIM KE SPREADSHEET SAAT DIANGKAT
  if (adaTabung && b_total < 1.00) {
    if (b_stabil > 4.00) {
      nomorData++;
      float isi_stabil = b_stabil - 5.0;
      kirimKeDatabase(nomorData, b_stabil, isi_stabil, g_stabil, statusTerakhir, t_stabil, h_stabil);
      tone(BUZZER_PIN, 2500, 100); delay(150); tone(BUZZER_PIN, 2500, 100);
    }
    adaTabung = false; b_stabil = 0;
  }
}

void kirimKeDatabase(int n, float b, float i, float g, String s, float t, float h) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = "https://script.google.com/macros/s/" + G_ID + "/exec?" 
                 + "nomor=" + String(n) + "&berat=" + String(b) + "&isi=" + String(i) 
                 + "&gas=" + String(g) + "&status=" + s + "&temp=" + String(t) + "&humi=" + String(h);
    http.begin(url.c_str());
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.GET();
    http.end();
  }
}

void loop() { if (Blynk.connected()) { Blynk.run(); } timer.run(); }