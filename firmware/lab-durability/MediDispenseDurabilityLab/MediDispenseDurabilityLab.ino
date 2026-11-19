// LAB ONLY. Production controller always denied; retired reuse requires explicit opt-in.
// No Wi-Fi, HTTP, Firebase, GPIO, motors, coin acceptor or live accounts.
// Build preparation copies the two reviewed portable cores, never production settings.
#include <Arduino.h>
#include <Preferences.h>
#include <esp_partition.h>
#include <nvs_flash.h>
#include <esp_mac.h>
#if __has_include("LabBuildConfig.h")
#include "LabBuildConfig.h"
#endif
#include "CoinPaymentCore.h"
#include "CoinEventReviewCore.h"
#include "LabIdentity.h"

#ifndef MEDIDISPENSE_LAB_STORAGE_APPROVED
#define MEDIDISPENSE_LAB_STORAGE_APPROVED 0
#endif
static const int32_t fixtureTransaction = 900182;
static Preferences store;
static CoinJournal journal = {};
static bool identityOK=false, layoutOK=false, opened=false, healthy=false;
static String checkpointName;
static char board[13];

// Synthetic persistent receiver ledger. Not a PHP service or proof of real payment.
struct FixtureLedger {
  uint32_t version, sequence, credits, amount, dispensePending;
  StoredCoin lastReceipt;
  char creditIds[8][80];
  char reviewAck[33];
  uint32_t checksum;
};
static FixtureLedger ledger={};
static uint32_t ledgerChecksum(const FixtureLedger &v) { return coinCoreHash(&v,offsetof(FixtureLedger,checksum)); }
static bool ledgerValid(const FixtureLedger &v) {
  if(v.version!=1 || v.credits>8 || v.amount!=v.credits*5 || v.dispensePending>1 || v.reviewAck[32]!=0 || v.checksum!=ledgerChecksum(v))return false;
  for(uint32_t i=0;i<v.credits;i++){
    if(!coinCoreIdValid(v.creditIds[i]))return false;
    for(uint32_t k=0;k<i;k++)if(!strcmp(v.creditIds[k],v.creditIds[i]))return false;
  }
  return true;
}
static void stopLab(const char *reason) { healthy=false;Serial.printf("BLOCKED: %s; no repair/erase attempted.\n",reason); }
static void checkpoint(const char *name) {
  Serial.printf("POINT %s\n",name);Serial.flush();
  if(checkpointName!=name)return;
  Serial.println("PAUSED: approved supply cut OR CONTINUE. Reset is not supply loss.");Serial.flush();
  while(true){if(Serial.available()){String s=Serial.readStringUntil('\n');s.trim();if(s=="CONTINUE")break;}delay(10);}
}
static bool putVerified(const char *key,const void *value,size_t size) {
  uint8_t verify[sizeof(FixtureLedger)>sizeof(CoinJournal)?sizeof(FixtureLedger):sizeof(CoinJournal)];
  if(!healthy || size>sizeof(verify))return false;
  String before=String(key)+":before",after=String(key)+":after";
  checkpoint(before.c_str());
  bool ok=store.putBytes(key,value,size)==size;
  checkpoint(after.c_str());
  ok=ok&&store.getBytesLength(key)==size&&store.getBytes(key,verify,size)==size&&!memcmp(value,verify,size);
  if(!ok)stopLab("write/readback mismatch");
  return ok;
}
static bool persistJournal(CoinJournal *j,void*) {
  j->version=2;j->checksum=coinCoreChecksum(j);
  if(!coinCoreValid(j)){stopLab("invalid journal write refused");return false;}
  return putVerified("journal-v2",j,sizeof(*j));
}
static bool persistLedger(){ledger.checksum=ledgerChecksum(ledger);return putVerified("receiver",&ledger,sizeof(ledger));}
// Synthetic receipt evidence uses deterministic public fixture bytes. This does NOT
// test production HMAC auth; protocol signatures are covered by separate PHP tests.
static CoinReviewArchive fixtureArchive() {
  CoinReviewArchive a={};a.version=1;a.original=journal.events[0];
  memset(a.reviewId,'b',32);memset(a.nonce,'c',32);memset(a.challenge,'d',32);
  memset(a.archiveHash,'e',64);memset(a.signature,'f',64);a.checksum=coinReviewChecksum(&a);return a;
}
static bool persistArchive(const CoinReviewArchive *a,void*) {
  CoinReviewArchive check={};String pending=store.getString("review-pending","");
  if(pending.length()&&pending!="archive")return false;
  if(store.isKey("archive")) {
    if(store.getBytesLength("archive")!=sizeof(check)||store.getBytes("archive",&check,sizeof(check))!=sizeof(check)||memcmp(&check,a,sizeof(check))){stopLab("immutable archive conflict");return false;}
  } else if(!putVerified("archive",a,sizeof(*a)))return false;
  if(store.getBytes("archive",&check,sizeof(check))!=sizeof(check)||!coinReviewArchiveValid(&check)||memcmp(&check,a,sizeof(check)))return false;
  checkpoint("pointer:before");store.putString("review-pending","archive");checkpoint("pointer:after");
  if(store.getString("review-pending","")!="archive"){stopLab("pending pointer failed");return false;}
  return true;
}
static void status() {
  Serial.printf("LAB board=%s identity=%d layout=%d writes_compiled=%d open=%d healthy=%d\n",board,identityOK,layoutOK,MEDIDISPENSE_LAB_STORAGE_APPROVED,opened,healthy);
  if(!opened||!healthy)return;
  Serial.printf("case_tx=%ld boot=%lu count=%lu reconcile=%d binding=%lu credits=%lu amount=%lu dispense_pending=%lu checksum=%08lX\n",
    (long)journal.boundTransactionId,(unsigned long)journal.bootCounter,(unsigned long)journal.count,journal.reconcile,
    (unsigned long)journal.bindingPhase,(unsigned long)ledger.credits,(unsigned long)ledger.amount,(unsigned long)ledger.dispensePending,(unsigned long)journal.checksum);
  for(uint32_t i=0;i<journal.count;i++)Serial.printf("EVENT %s tx=%ld pulses=%lu amount=%ld review=%d\n",journal.events[i].eventId,(long)journal.events[i].transactionId,(unsigned long)journal.events[i].pulses,(long)journal.events[i].amount,journal.events[i].requiresReview);
  Serial.printf("pending=%s archive=%d review_ack=%s\n",store.getString("review-pending","").c_str(),store.isKey("archive"),ledger.reviewAck);
}
static bool validCase(String s);
static void inspectCase(String name) {
  if(!MEDIDISPENSE_LAB_STORAGE_APPROVED||!identityOK||!layoutOK||opened||!validCase(name))return;
  Preferences read;String ns=String("lab-")+name;
  if(!read.begin(ns.c_str(),true,"labstore")){Serial.println("No readable case. No initialization/repair attempted.");return;}
  const char *keys[]={"journal-v2","receiver","archive"};
  uint8_t bytes[sizeof(FixtureLedger)>sizeof(CoinJournal)?sizeof(FixtureLedger):sizeof(CoinJournal)];
  for(const char *key:keys){size_t n=read.getBytesLength(key);Serial.printf("DUMP %s size=%u ",key,(unsigned)n);
    if(n&&n<=sizeof(bytes)&&read.getBytes(key,bytes,n)==n){for(size_t i=0;i<n;i++)Serial.printf("%02X",bytes[i]);}
    Serial.println();}
  Serial.printf("POINTER %s\n",read.getString("review-pending","").c_str());read.end();
}
static bool validCase(String s){if(!s.length()||s.length()>6)return false;for(char c:s)if(!((c>='a'&&c<='z')||(c>='0'&&c<='9')))return false;return true;}
static void openCase(String name,bool create) {
  if(!MEDIDISPENSE_LAB_STORAGE_APPROVED||!identityOK||!layoutOK||opened||!validCase(name)){Serial.println("BLOCKED: build approval, exact board/layout, unopened session and case a-z/0-9 (1..6) required.");return;}
  String ns=String("lab-")+name;
  if(!store.begin(ns.c_str(),!create,"labstore")){Serial.println("BLOCKED: case/partition unavailable; no format attempted.");return;}
  // RESUME first opens read-only: missing/corrupt bytes must never initialize a case.
  bool exists=store.isKey("journal-v2"),receiver=store.isKey("receiver");
  if(create) {
    if(exists||receiver||store.isKey("journal")||store.isKey("archive")||store.isKey("review-pending")){store.end();Serial.println("BLOCKED: existing case cannot be reseeded.");return;}
    healthy=true;opened=true;
    journal={};journal.version=2;journal.boundTransactionId=fixtureTransaction;journal.bindingFrom=fixtureTransaction;journal.bindingTarget=fixtureTransaction;journal.bootCounter=1;
    ledger={};ledger.version=1;
    // Interrupted initialization stays incomplete and blocks RESUME; use a new case.
    if(!persistLedger()||!persistJournal(&journal,nullptr))return;
  } else {
    bool valid=exists&&receiver&&store.getBytesLength("journal-v2")==sizeof(journal)&&store.getBytes("journal-v2",&journal,sizeof(journal))==sizeof(journal)&&coinCoreValid(&journal)&&journal.boundTransactionId==fixtureTransaction&&store.getBytesLength("receiver")==sizeof(ledger)&&store.getBytes("receiver",&ledger,sizeof(ledger))==sizeof(ledger)&&ledgerValid(ledger);
    bool archived=store.isKey("archive");String pending=store.getString("review-pending","");
    if(pending.length()&&pending!="archive")valid=false;
    if((pending.length()||ledger.reviewAck[0])&&!archived)valid=false;
    if(archived){
      CoinReviewArchive a={};bool queued=false;
      if(store.getBytesLength("archive")!=sizeof(a)||store.getBytes("archive",&a,sizeof(a))!=sizeof(a)||!coinReviewArchiveValid(&a)||a.original.transactionId!=fixtureTransaction)valid=false;
      // Malformed journal must not drive an unbounded array walk.
      if(valid)for(uint32_t i=0;i<journal.count;i++)if(coinReviewSameEvent(&journal.events[i],&a.original))queued=true;
      if(!queued&&(!journal.reconcile||(!pending.length()&&!ledger.reviewAck[0])))valid=false;
    }
    store.end();
    if(!valid){Serial.println("BLOCKED: missing/corrupt fixture; original bytes retained; no fallback.");return;}
    if(!store.begin(ns.c_str(),false,"labstore")){Serial.println("BLOCKED: reopen failed.");return;}
    opened=true;healthy=true;
    // Same actual portable boot validation, no legacy production-journal migration.
    if(!coinCoreStartBoot(&journal)||!persistJournal(&journal,nullptr)){stopLab("boot restore failed");return;}
  }
  status();
}
static bool creditHead() {
  if(!journal.count||journal.events[0].requiresReview)return false;
  StoredCoin head=journal.events[0];bool credited=false;
  for(uint32_t i=0;i<ledger.credits;i++)if(!strcmp(ledger.creditIds[i],head.eventId))credited=true;
  if(!credited){if(ledger.credits==8)return false;strcpy(ledger.creditIds[ledger.credits++],head.eventId);ledger.amount+=head.amount;}
  ledger.lastReceipt=head;
  // Simulate server commit before receipt: drop/cut here, then retry same event.
  if(!persistLedger())return false;checkpoint("receipt:committed");return true;
}
static void reviewHead() {
  if(!journal.count||!journal.events[0].requiresReview)return;
  CoinReviewArchive a=fixtureArchive();
  if(store.isKey("archive")){
    CoinReviewArchive old={};
    if(store.getBytesLength("archive")!=sizeof(old)||store.getBytes("archive",&old,sizeof(old))!=sizeof(old)||!coinReviewArchiveValid(&old)||!coinReviewSameEvent(&old.original,&a.original)){stopLab("archive mismatch");return;}
    a=old;
  }
  bool ok=coinReviewApply(&journal,&a,true,true,persistArchive,persistJournal,nullptr);
  Serial.printf("LAB REVIEW applied=%d (local synthetic authorization only)\n",ok);
}
static void ackReview() {
  CoinReviewArchive a={};
  if(!store.isKey("archive")||store.getBytesLength("archive")!=sizeof(a)||store.getBytes("archive",&a,sizeof(a))!=sizeof(a)||!coinReviewArchiveValid(&a)||!journal.reconcile)return;
  for(uint32_t i=0;i<journal.count;i++)if(!strcmp(journal.events[i].eventId,a.original.eventId)){Serial.println("BLOCKED: original event still queued; no ack.");return;}
  if(ledger.reviewAck[0]&&strcmp(ledger.reviewAck,a.reviewId)){stopLab("receipt conflict");return;}
  strcpy(ledger.reviewAck,a.reviewId);if(!persistLedger())return;checkpoint("ack:committed");
  // Mirrors matching acknowledged pending-pointer reset; archive is not removed.
  checkpoint("pointer-reset:before");store.putString("review-pending","");checkpoint("pointer-reset:after");
  if(store.getString("review-pending","missing")!="")stopLab("pointer reset failed");
  else Serial.println("LAB ack durable; no payment, dispense or readiness granted.");
}
static void command(String s) {
  s.trim();
  if(s=="STATUS"){status();return;}
  if(s.startsWith("INSPECT ISOLATED ")){inspectCase(s.substring(17));return;}
  if(s.startsWith("POINT ")){checkpointName=s.substring(6);Serial.println("Checkpoint selected.");return;}
  if(s.startsWith("INIT ISOLATED ")){openCase(s.substring(14),true);return;}
  if(s.startsWith("RESUME ISOLATED ")){openCase(s.substring(16),false);return;}
  if(!opened||!healthy){Serial.println("BLOCKED: no healthy approved case.");return;}
  if(s=="ACK REVIEW"){ackReview();return;}
  if(ledger.dispensePending){Serial.println("BLOCKED: simulated interrupted dispense; no automatic retry/completion.");return;}
  if(s=="ADD"||s=="RETAIN") {
    if(journal.count==16||ledger.sequence==UINT32_MAX)return;
    ledger.sequence++;if(!persistLedger())return;
    CapturedCoin c={fixtureTransaction,5,ledger.sequence,s=="ADD"};
    Serial.printf("LAB APPEND %d\n",coinCoreAppendDurably(&journal,c,board,"0011223344556677",persistJournal,nullptr));
  } else if(s=="CREDIT HEAD"){Serial.printf("LAB CREDIT %d\n",creditHead());}
  else if(s=="ACK HEAD"){
    if(journal.count&&coinReviewSameEvent(&journal.events[0],&ledger.lastReceipt))Serial.printf("LAB ACK %d\n",coinCoreAcknowledge(&journal,&ledger.lastReceipt,true,persistJournal,nullptr));
  } else if(s=="REPLAY RECEIPT"){Serial.printf("LAB REPLAY %d\n",coinCoreAcknowledge(&journal,&ledger.lastReceipt,true,persistJournal,nullptr));}
  else if(s=="REVIEW HEAD"){reviewHead();}
  else if(s=="MARK DISPENSE PENDING"){ledger.dispensePending=1;persistLedger();}
  else if(s=="CORRUPT LAB JOURNAL") {
    // Explicit fault injection into this synthetic case only; no repair command.
    CoinJournal bad=journal;bad.checksum^=1;putVerified("journal-v2",&bad,sizeof(bad));stopLab("injected corruption; power-cycle then RESUME must refuse");
  } else Serial.println("Unknown lab command. No action.");
}
void setup() {
  Serial.begin(115200);Serial.setTimeout(1000);
  uint8_t mac[6]={};bool macOK=esp_efuse_mac_get_default(mac)==ESP_OK;
  uint64_t packed=labPackedMac(mac);
  snprintf(board,sizeof(board),"%012llX",(unsigned long long)packed);
  identityOK=macOK&&packed==(ESP.getEfuseMac()&0xffffffffffffULL)&&labIdentityAllowed(board,MEDIDISPENSE_LAB_BOARD_ID,MEDIDISPENSE_LAB_RETIRED_REPURPOSE_APPROVED==1);
  Serial.printf("ROM MAC %02X:%02X:%02X:%02X:%02X:%02X; retired_opt_in=%d\n",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5],MEDIDISPENSE_LAB_RETIRED_REPURPOSE_APPROVED);
  const esp_partition_t *p=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_NVS,"labstore");
  const esp_partition_t *app=esp_partition_find_first(ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_FACTORY,"labapp");
  size_t count=0;for(esp_partition_iterator_t it=esp_partition_find(ESP_PARTITION_TYPE_ANY,ESP_PARTITION_SUBTYPE_ANY,nullptr);it;it=esp_partition_next(it))count++;
  layoutOK=count==2&&ESP.getFlashChipSize()==0x400000&&p&&p->address==0x3E0000&&p->size==0x20000&&app&&app->address==0x10000&&app->size==0x1F0000&&!esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_NVS,"nvs");
  Serial.println("REVIEW-ONLY LAB CANDIDATE: radios never initialized; no GPIO outputs; no automatic NVS open/seed. Physical isolation is operator-verified, not sensed by software.");
  status();
}
void loop(){if(Serial.available()){String s=Serial.readStringUntil('\n');if(s.length()<=100)command(s);}delay(10);}
