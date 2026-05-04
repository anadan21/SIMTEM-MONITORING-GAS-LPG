#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <HX711.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>
#include <time.h>

// ================= WIFI =================
const char* WIFI_SSID = "bots";
const char* WIFI_PASS = "12345678";

const char* FIREBASE_HOST =
"https://pangkalan-lpg-a6406-default-rtdb.asia-southeast1.firebasedatabase.app";

// ================= PIN =================
#define HX_DT       4
#define HX_SCK      5
#define PIN_GAS     34
#define LED_RED     25
#define LED_YELLOW  26
#define LED_GREEN   33
#define BUZZER_PIN  27
#define DHTPIN      14
#define DHTTYPE     DHT22

// ================= OBJECT =================
HX711 scale;
DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ================= MQ6 =================
float R0 = 30.7;
const float RL = 10.0;
const float A  = 1000.0;
const float B  = -2.186;

// ================= CONFIG =================
#define SAMPLE_COUNT 10
const float HX711_SCALE = 23656.0;  // Hasil kalibrasi linier

float bufferBerat[SAMPLE_COUNT];
float bufferPPM[SAMPLE_COUNT];

int sampleIndex = 0;
bool bufferFull = false;

// ================= STATE =================
float ppmFiltered = 0;
unsigned long lastLive = 0;

float b_lock=0, ppm_lock=0, t_lock=0, h_lock=0;
String status_lock="";

bool locked=false;
bool sent=false;
bool adaTabung=false;

// ================= LCD =================
void lcdCenter(String txt, int row){
  lcd.setCursor(0,row);
  lcd.print("                ");
  int pos = (16 - txt.length())/2;
  if(pos < 0) pos = 0;
  lcd.setCursor(pos,row);
  lcd.print(txt);
}

// ================= BUZZER =================
void beep1(){
  digitalWrite(BUZZER_PIN,HIGH);
  delay(150);
  digitalWrite(BUZZER_PIN,LOW);
}

void beep2(){
  for(int i=0;i<2;i++){
    digitalWrite(BUZZER_PIN,HIGH);
    delay(150);
    digitalWrite(BUZZER_PIN,LOW);
    delay(150);
  }
}

void alarmBocor(){
  digitalWrite(BUZZER_PIN,HIGH);
}

// ================= MQ6 =================
float bacaADC(){
  float t=0;
  for(int i=0;i<10;i++){
    t+=analogRead(PIN_GAS);
    delay(3);
  }
  return t/10;
}

float hitungPPM(){
  float adc=bacaADC();
  float v=(adc/4095.0)*3.3;
  if(v<0.001) v=0.001;

  float rs=RL*(3.3-v)/v;
  float ratio=rs/R0;
  if(ratio<0.001) ratio=0.001;

  float ppm=A*pow(ratio,B);
  if(ppm<0) ppm=0;

  ppmFiltered = ppmFiltered*0.7 + ppm*0.3;
  return ppmFiltered;
}

// ================= UTIL =================
float avg(float arr[]){
  float sum=0;
  for(int i=0;i<SAMPLE_COUNT;i++) sum+=arr[i];
  return sum/SAMPLE_COUNT;
}

bool isStable(float arr[], float threshold){
  float minVal=arr[0];
  float maxVal=arr[0];

  for(int i=1;i<SAMPLE_COUNT;i++){
    if(arr[i]<minVal) minVal=arr[i];
    if(arr[i]>maxVal) maxVal=arr[i];
  }

  return (maxVal-minVal) < threshold;
}

// ================= STATUS =================
String getStatus(float ppm, float berat){
  if(berat <= 5.1) return "KOSONG";
  if(ppm >= 50) return "BOCOR";
  if(berat >= 7.91) return "LAYAK";
  return "KURANG";
}

// ================= TRAFFIC =================
void updateTraffic(String status){
  digitalWrite(LED_RED,LOW);
  digitalWrite(LED_YELLOW,LOW);
  digitalWrite(LED_GREEN,LOW);
  digitalWrite(BUZZER_PIN,LOW);

  if(status=="BOCOR"){
    digitalWrite(LED_RED,HIGH);
    alarmBocor();
  }
  else if(status=="LAYAK"){
    digitalWrite(LED_GREEN,HIGH);
  }
  else if(status=="KURANG"){
    digitalWrite(LED_YELLOW,HIGH);
  }
}

// ================= FIREBASE =================
bool firebasePut(String path, String body){
  HTTPClient http;
  http.begin(String(FIREBASE_HOST)+path+".json");
  http.addHeader("Content-Type","application/json");
  int code=http.PUT(body);
  http.end();
  return code==200;
}

bool firebasePost(String path, String body){
  HTTPClient http;
  http.begin(String(FIREBASE_HOST)+path+".json");
  http.addHeader("Content-Type","application/json");
  int code=http.POST(body);
  http.end();
  return (code==200||code==201);
}

// ================= TIME =================
unsigned long getTS(){
  time_t now;
  time(&now);
  return now*1000;
}

// ================= SEND =================
void kirimLive(float berat,float isi,float ppm,float t,float h,String status){
  StaticJsonDocument<200> doc;

  doc["berat"]=String(berat,2);
  doc["isi"]=String(isi,2);
  doc["ppm"]=(int)ppm;
  doc["suhu"]=String(t,1);
  doc["humidity"]=String(h,1);
  doc["status"]=status;
  doc["timestamp"]=getTS();
  doc["device_id"]="ESP32-LPG-01";

  String body;
  serializeJson(doc,body);

  firebasePut("/live",body);
}

void kirimRaw(float berat,float ppm,float t,float h,String status){
  StaticJsonDocument<200> doc;

  doc["berat_avg"]=String(berat,2);
  doc["isi_avg"]=String(berat-5.0,2);
  doc["ppm_avg"]=(int)ppm;
  doc["suhu_avg"]=String(t,1);
  doc["humidity_avg"]=String(h,1);
  doc["status"]=status;
  doc["timestamp"]=getTS();
  doc["device_id"]="ESP32-LPG-01";

  String body;
  serializeJson(doc,body);

  firebasePost("/raw",body); // 🔥 FIX: POST
}

void kirimHistory(){
  String id="HIST-"+String(getTS());

  StaticJsonDocument<300> doc;

  doc["id"]=id;
  doc["berat_avg"]=String(b_lock,2);
  doc["isi_avg"]=String(b_lock-5.0,2);
  doc["ppm_avg"]=(int)ppm_lock;
  doc["suhu_avg"]=String(t_lock,1);
  doc["humidity_avg"]=String(h_lock,1);
  doc["status"]=status_lock;
  doc["timestamp"]=getTS();
  doc["device_id"]="ESP32-LPG-01";

  String body;
  serializeJson(doc,body);

  firebasePut("/history/"+id,body);
}

// ================= SETUP =================
void setup(){
  Serial.begin(115200);

  pinMode(LED_RED,OUTPUT);
  pinMode(LED_YELLOW,OUTPUT);
  pinMode(LED_GREEN,OUTPUT);
  pinMode(BUZZER_PIN,OUTPUT);

  lcd.init();
  lcd.backlight();

  lcdCenter("SISTEM QC LPG",0);
  lcdCenter("Starting...",1);
  delay(2000);

  // WARMUP MQ6
  for(int i=120;i>0;i--){
    lcdCenter("WARMING MQ-6",0);
    lcdCenter(String(i)+" detik",1);
    delay(1000);
  }

  lcdCenter("CONNECT WIFI",0);
  lcdCenter(WIFI_SSID,1);

  WiFi.begin(WIFI_SSID,WIFI_PASS);
  while(WiFi.status()!=WL_CONNECTED){
    delay(500);
  }

  lcdCenter("WIFI OK",0);
  lcdCenter(WiFi.localIP().toString(),1);
  delay(2000);

  configTime(8*3600,0,"pool.ntp.org");
  while(time(nullptr)<100000) delay(500);

  scale.begin(HX_DT,HX_SCK);
  scale.set_scale(HX711_SCALE);
  scale.tare();

  dht.begin();

  lcdCenter("SIAP",0);
  lcdCenter("Letakkan tabung",1);
}

// ================= LOOP =================
void loop(){

  float berat=scale.get_units(5);
  if(berat<0.1) berat=0;

  float isi=(berat>5.0)?berat-5.0:0;
  float ppm=hitungPPM();

  float t=dht.readTemperature();
  float h=dht.readHumidity();
  if(isnan(t)) t=0;
  if(isnan(h)) h=0;

  String status=getStatus(ppm,berat);

  updateTraffic(status);

  // 📺 Update LCD dengan status real-time
  if(locked){
    // Saat data sudah di-lock/siap
    lcdCenter("STATUS: "+status,0);
    lcdCenter("Angkat tabung",1);
  } else if(berat > 5.1 && bufferFull){
    // Saat sedang stabilisasi
    lcdCenter("Stabilizing...",0);
    lcdCenter("Jangan gerak!",1);
  } else {
    // Normal monitoring
    lcdCenter("T:"+String(berat,2)+" I:"+String(isi,2),0);
    lcdCenter(String((int)ppm)+"ppm "+status,1);
  }

  // SAMPLE
  bufferBerat[sampleIndex]=berat;
  bufferPPM[sampleIndex]=ppm;

  sampleIndex++;
  if(sampleIndex>=SAMPLE_COUNT){
    sampleIndex=0;
    bufferFull=true;
  }

  // LIVE (Kirim real-time setiap 1 detik)
  if(millis()-lastLive>1000){
    kirimLive(berat,isi,ppm,t,h,status);
    lastLive=millis();
    Serial.print("📡 Live: ");
    Serial.print(berat,2); Serial.print(" kg, ");
    Serial.print(ppm,0); Serial.println(" ppm");
  }

  // ===== LOCK (SAAT DATA STABIL & DIKIRIM) =====
  if(berat>5.1 && bufferFull && !locked){

    if(isStable(bufferBerat,0.1)){ // 🔥 Data stabil

      b_lock=avg(bufferBerat);
      ppm_lock=avg(bufferPPM);
      t_lock=t;
      h_lock=h;
      status_lock=getStatus(ppm_lock,b_lock);

      locked=true;
      sent=false;
      adaTabung=true;

      Serial.println("✅ LOCK TERJADI - Mengirim ke /raw...");

      // Kirim ke Firebase /raw (log data)
      kirimRaw(b_lock,ppm_lock,t,h,status_lock);

      // 🔊 BUNYI 1 KALI = Data sudah dikirim (READY)
      delay(100);
      beep1();
      delay(100);
      
      Serial.println("🔊 BEEP 1x - Data terkirim ke /raw, siap pengecekan");
    }
  }

  // ===== ANGKAT (SAAT TABUNG DIANGKAT) =====
  if(adaTabung && berat<1.0 && locked && !sent){

    Serial.println("⬆️ TABUNG DIANGKAT - Mengirim ke /history...");

    // Kirim ke Firebase /history (final record)
    kirimHistory();
    
    delay(200);

    // 🔊 BUNYI 2 KALI = Pengecekan selesai, siap pengecekan baru
    beep2();
    delay(200);

    sent=true;
    locked=false;
    adaTabung=false;
    bufferFull=false;
    sampleIndex=0;

    Serial.println("🔊 BEEP 2x - Pengecekan selesai, data tersimpan di /history");
    
    lcdCenter("Letakkan tabung",0);
    lcdCenter("untuk pengecekan",1);
  }

  delay(700);
}