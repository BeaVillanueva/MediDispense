// Isolated Phase 2 candidate. No radio, network client, vending GPIO or production configuration.
#include <Arduino.h>
#include <Preferences.h>
#include <esp_partition.h>
#include <esp_mac.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <nvs.h>
#include "LabBuildConfig.h"
#include "LabIdentity.h"
#include "LabState.h"
static_assert(MEDIDISPENSE_LAB_STORAGE_APPROVED==1,"Separate storage-enabled candidate only");
static_assert(labSameId(MEDIDISPENSE_LAB_BOARD_ID,"20799D470968"),"Exact retired board only");
static bool identityOK=false,layoutOK=false,opened=false;
static char board[13]={},caseId[7]={};
static String pausePoint;
static uint32_t operation=0;
static void checkpoint(const String &name){
  Serial.printf("POINT %s us=%llu\n",name.c_str(),(unsigned long long)esp_timer_get_time());Serial.flush();
  if(pausePoint!=name)return;
  Serial.println("PAUSED outside NVS API; CONTINUE only. Not proof of during-write power loss.");Serial.flush();
  while(true){if(Serial.available()){String line=Serial.readStringUntil('\n');line.trim();if(line=="CONTINUE")break;}delay(10);}
}
struct NvsIO final:lab2::IO {
  Preferences prefs;
  uint8_t verify[sizeof(lab2::Receiver)>sizeof(CoinJournal)?sizeof(lab2::Receiver):sizeof(CoinJournal)]={};
  bool exists(const char*k)override{return prefs.isKey(k);}
  size_t length(const char*k)override{return prefs.getBytesLength(k);}
  bool read(const char*k,void*p,size_t n)override{return prefs.getBytes(k,p,n)==n;}
  bool begin(const char*space,bool readOnly){
    Serial.printf("NVS_INIT_OPEN_BEGIN case=%s read_only=%d us=%llu\n",space,readOnly,(unsigned long long)esp_timer_get_time());Serial.flush();
    bool ok=prefs.begin(space,readOnly,"labstore");
    Serial.printf("NVS_INIT_OPEN_END ok=%d us=%llu\n",ok,(unsigned long long)esp_timer_get_time());Serial.flush();return ok;
  }
  bool write(const char*k,const void*p,size_t n)override{
    if(!identityOK||!layoutOK||!opened||n>sizeof(verify))return false;
    checkpoint(String(k)+":before");
    // Use explicit NVS calls so SET and COMMIT errors are independently visible.
    nvs_handle_t handle=0;
    char space[11];snprintf(space,sizeof(space),"p2-%s",caseId);
    uint32_t seq=++operation;
    Serial.printf("WRITE_BEGIN op=%lu case=%s key=%s bytes=%u hash=%08lX us=%llu\n",(unsigned long)seq,caseId,k,(unsigned)n,(unsigned long)lab2::hash(p,n),(unsigned long long)esp_timer_get_time());Serial.flush();
    esp_err_t op=nvs_open_from_partition("labstore",space,NVS_READWRITE,&handle);
    if(op!=ESP_OK){Serial.printf("WRITE_END op=%lu open=%d no_set=1\n",(unsigned long)seq,op);return false;}
    // Serial markers delimit API calls; actual flash programming/GC occurs inside.
    esp_err_t set=nvs_set_blob(handle,k,p,n);
    esp_err_t commit=set==ESP_OK?nvs_commit(handle):ESP_FAIL;
    Serial.printf("WRITE_END op=%lu set=%d commit=%d us=%llu\n",(unsigned long)seq,set,commit,(unsigned long long)esp_timer_get_time());Serial.flush();
    nvs_close(handle);
    checkpoint(String(k)+":after-api");
    bool ok=set==ESP_OK&&commit==ESP_OK&&length(k)==n&&read(k,verify,n)&&!memcmp(p,verify,n);
    Serial.printf("READBACK op=%lu ok=%d hash=%08lX\n",(unsigned long)seq,ok,(unsigned long)(ok?lab2::hash(verify,n):0));Serial.flush();
    checkpoint(String(k)+":after-readback");return ok;
  }
} storage;
static lab2::Engine engine(storage);
static void result(const char*cmd,lab2::Result r){
  const char*names[]={"OK","ALREADY_DONE","REJECTED","BLOCKED"};
  Serial.printf("RESULT command=%s status=%s reason=%s\n",cmd,names[(unsigned)r],engine.reason);
}
static void status(){
  Serial.printf("LAB board=%s identity=%d layout=%d writes_compiled=1 open=%d healthy=%d schema=2\n",board,identityOK,layoutOK,opened,engine.healthy);
  if(!opened||!engine.healthy)return;
  auto&s=engine.state;
  Serial.printf("CASE %s nonce=%s boot=%lu count=%lu credits=%lu total=%lu reconcile=%d archive=%d pointer=%lu reason=%s\n",caseId,s.header.nonce,(unsigned long)s.journal.bootCounter,(unsigned long)s.journal.count,(unsigned long)s.receiver.count,(unsigned long)s.receiver.total,s.journal.reconcile,s.archived,(unsigned long)s.pointer.phase,engine.reason);
  for(unsigned i=0;i<s.journal.count;i++)Serial.printf("EVENT %u id=%s review=%d\n",i,s.journal.events[i].eventId,s.journal.events[i].requiresReview);
  if(s.receiver.hasLast)Serial.printf("LAST_RECEIPT %s\n",s.receiver.last.eventId);
}
static void openCase(const String &id,bool initialize){
  if(!identityOK||!layoutOK||opened||id.length()>6||!lab2::caseText(id.c_str())){engine.reason="IDENTITY_LAYOUT_OR_CASE_GUARD";result("OPEN",lab2::Result::Rejected);return;}
  strcpy(caseId,id.c_str());char space[11];snprintf(space,sizeof(space),"p2-%s",caseId);
  // Preferences.begin initializes labstore; even read-only NVS init can write recovery metadata.
  if(!storage.begin(space,!initialize)){engine.reason="EXPLICIT_NVS_OPEN_FAILED_NO_REPAIR";result("OPEN",lab2::Result::Blocked);return;}
  if(!initialize){
    bool valid=engine.load(caseId,board);storage.prefs.end();
    if(!valid){result("RESUME",lab2::Result::Blocked);return;}
    if(!storage.begin(space,false)){engine.block("RW_OPEN_FAILED");result("RESUME",lab2::Result::Blocked);return;}
  }
  opened=true;
  if(initialize){char nonce[17];snprintf(nonce,sizeof(nonce),"%08lX%08lX",(unsigned long)esp_random(),(unsigned long)esp_random());result("INIT",engine.initialize(caseId,board,nonce));}
  else result("RESUME",engine.resume());
  status();
}
static void command(String line){
  line.trim();
  if(line=="STATUS"){status();return;}
  if(line.startsWith("INIT ISOLATED ")){openCase(line.substring(14),true);return;}
  if(line.startsWith("RESUME ISOLATED ")){openCase(line.substring(16),false);return;}
  if(line.startsWith("POINT ")){pausePoint=line.substring(6);Serial.println("RESULT command=POINT status=OK scope=RAM_ONLY");return;}
  if(!opened||!engine.healthy){engine.reason="NO_HEALTHY_CASE";result(line.c_str(),lab2::Result::Blocked);return;}
  lab2::Result r;
  if(line=="ADD")r=engine.append(false);
  else if(line=="RETAIN")r=engine.append(true);
  else if(line=="CREDIT HEAD")r=engine.credit();
  else if(line=="ACK HEAD"||line=="REPLAY RECEIPT")r=engine.acknowledge();
  else if(line=="REVIEW HEAD")r=engine.review();
  else if(line=="ACK REVIEW")r=engine.reviewAck();
  else if(line=="MARK DISPENSE PENDING")r=engine.markDispense();
  else {engine.reason="UNKNOWN_COMMAND_NO_ACTION";r=lab2::Result::Rejected;}
  result(line.c_str(),r);
}
void setup(){
  Serial.begin(115200);Serial.setTimeout(1000);
  uint8_t mac[6]={};bool macOK=esp_efuse_mac_get_default(mac)==ESP_OK;
  uint64_t packed=labPackedMac(mac);snprintf(board,sizeof(board),"%012llX",(unsigned long long)packed);
  identityOK=macOK&&packed==0x20799D470968ULL&&packed==(ESP.getEfuseMac()&0xffffffffffffULL)&&labIdentityAllowed(board,MEDIDISPENSE_LAB_BOARD_ID,true);
  auto*p=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_NVS,"labstore");
  auto*a=esp_partition_find_first(ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_FACTORY,"labapp");
  unsigned count=0;for(auto it=esp_partition_find(ESP_PARTITION_TYPE_ANY,ESP_PARTITION_SUBTYPE_ANY,nullptr);it;it=esp_partition_next(it))count++;
  layoutOK=count==2&&ESP.getFlashChipSize()==0x400000&&p&&p->address==0x3E0000&&p->size==0x20000&&a&&a->address==0x10000&&a->size==0x1F0000;
  Serial.println("PHASE2 synthetic lab only; no radios or vending GPIO. No automatic case open, init, repair or erase. UART uses GPIO1/3.");
  status();
}
void loop(){if(Serial.available()){String line=Serial.readStringUntil('\n');if(line.length()<=100)command(line);else Serial.println("RESULT command=INPUT status=REJECTED reason=TOO_LONG");}delay(10);}
