#pragma once
#include <Preferences.h>
#include <esp_system.h>
#include <stddef.h>

#include "CoinPaymentCore.h"
#if __has_include("PaymentDemo.local.h")
#include "PaymentDemo.local.h"
#endif
#ifndef MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND
#define MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND 0
#endif

static Preferences coinPreferences;
static CoinJournal coinJournal = {};
static portMUX_TYPE coinMux = portMUX_INITIALIZER_UNLOCKED;
static CapturedCoin capturedCoins[64];
static uint32_t capturedHead=0, capturedCount=0, coinSequence=0;
static uint32_t overflowEvents=0, overflowPulses=0;
static int32_t captureTransactionId=0;
static bool capturePaymentAllowed=false, bindingInProgress=false;
static uint32_t captureFence=0;
static int32_t proposedTransactionId=0, staffApprovedTarget=0;
static uint32_t approvalAt=0, lastSessionCheckAt=0;
static bool pulseSequencePending=false, readerFault=false;
static bool bootReviewRequired=true, storageHealthy=false, paymentSessionVerified=false;
static bool activePaymentSession=false, sessionStaffAuthorized=false;
static bool backendDemoAutoBinding=false, sessionDemoAuthorized=false;
static const char *automaticBindingBlocker="BACKEND_SESSION_UNVERIFIED";
static bool sessionDeadlineKnown=false;
static uint32_t sessionDeadlineAt=0;
static bool paymentDeadlineElapsed(){return sessionDeadlineKnown && (int32_t)(millis()-sessionDeadlineAt)>=0;}
static int activePaymentTransactionId=0;
static uint32_t lastReaderActivity=0, sessionQuietSince=0;
static char coinDeviceId[13], coinBootNonce[17];

static bool persistCoinJournal() {
  static CoinJournal verified;
  if(!storageHealthy)return false;
  coinJournal.version=2;coinJournal.checksum=coinCoreChecksum(&coinJournal);
  bool ok=coinCoreValid(&coinJournal) && coinPreferences.putBytes("journal-v2",&coinJournal,sizeof(coinJournal))==sizeof(coinJournal) &&
    coinPreferences.getBytesLength("journal-v2")==sizeof(coinJournal) && coinPreferences.getBytes("journal-v2",&verified,sizeof(verified))==sizeof(verified) &&
    coinCoreValid(&verified) && memcmp(&verified,&coinJournal,sizeof(verified))==0;
  if(!ok) {storageHealthy=false;bootReviewRequired=true;portENTER_CRITICAL(&coinMux);capturePaymentAllowed=false;portEXIT_CRITICAL(&coinMux);Serial.println("COIN STORAGE FAULT: no queue advanced; retained evidence needs staff reconciliation.");}
  return ok;
}
static bool persistCoreJournal(CoinJournal *,void *) {return persistCoinJournal();}
static void flagCoinTaskFailure() {
  portENTER_CRITICAL(&coinMux);readerFault=true;portEXIT_CRITICAL(&coinMux);
  Serial.println("COIN READER TASK FAILED. Do not insert coins.");
}
static void initializeCoinPayments() {
  uint64_t mac=ESP.getEfuseMac();
  snprintf(coinDeviceId,sizeof(coinDeviceId),"%012llX",(unsigned long long)(mac&0xffffffffffffULL));
  snprintf(coinBootNonce,sizeof(coinBootNonce),"%08lX%08lX",(unsigned long)esp_random(),(unsigned long)esp_random());
  storageHealthy=coinPreferences.begin("md-coins",false);
  bool loaded=false;
  if(storageHealthy && coinPreferences.isKey("journal-v2")) {
    loaded=coinPreferences.getBytesLength("journal-v2")==sizeof(coinJournal) && coinPreferences.getBytes("journal-v2",&coinJournal,sizeof(coinJournal))==sizeof(coinJournal) && coinCoreValid(&coinJournal);
    if(!loaded)storageHealthy=false; // Never fall back to an older journal after v2 corruption.
  }else if(storageHealthy && coinPreferences.isKey("journal")) {
    static CoinJournalV1 old;
    loaded=coinPreferences.getBytesLength("journal")==sizeof(old) && coinPreferences.getBytes("journal",&old,sizeof(old))==sizeof(old) && coinCoreUpgrade(&old,&coinJournal);
    if(!loaded)storageHealthy=false; // Legacy bytes stay untouched in their original key.
  }else if(storageHealthy) {
    memset(&coinJournal,0,sizeof(coinJournal));coinJournal.version=2;coinJournal.bindingPhase=COIN_BIND_STABLE;coinJournal.checksum=coinCoreChecksum(&coinJournal);
  }
  if(!storageHealthy) {
    memset(&coinJournal,0,sizeof(coinJournal));
    Serial.println("COIN JOURNAL INVALID/UNAVAILABLE. No NVS bytes overwritten; assistance required.");
  }else {
    if(!coinCoreStartBoot(&coinJournal)){storageHealthy=false;Serial.println("Journal invalid or boot counter exhausted; no journal write/session binding allowed.");}
    else persistCoinJournal();
  }
  captureTransactionId=coinCoreCaptureOwner(&coinJournal);activePaymentTransactionId=captureTransactionId;
  overflowEvents=coinJournal.overflowEvents;overflowPulses=coinJournal.overflowPulses;
  Serial.println(MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND?"CONTROLLED DEMO: awaiting fresh backend permission and healthy empty journal; faults still require recovery.":"COIN BOOT REVIEW REQUIRED: check accepted/unrecorded coins before enabling a new session.");
}

void coinReaderTask(void *) {
  bool countedLow=false;
  uint32_t lowAt=0, highAt=0, lastPulse=0;
  CapturedCoin current={};
  while(true) {
    const uint32_t now=millis(); const bool low=digitalRead(COIN_PIN)==LOW;
    portENTER_CRITICAL(&coinMux);
    if(low) {
      highAt=0;
      if(!lowAt) {
        lowAt=now;
        if(!pulseSequencePending) { current={bindingInProgress?0:captureTransactionId,0,0,capturePaymentAllowed&&!bindingInProgress}; pulseSequencePending=true;captureFence++;if(bindingInProgress)readerFault=true; }
      }
      lastReaderActivity=now;
      if(!countedLow && now-lowAt>=5) {
        if(current.pulses<0xffffffffu)current.pulses++;else readerFault=true;
        countedLow=true;lastPulse=now;
      }
    } else {
      lowAt=0;
      if(countedLow) {
        if(!highAt)highAt=now;
        if(now-highAt>=5)countedLow=false;
      }
      if(pulseSequencePending && !countedLow && now-lastPulse>=2000) {
        if(current.pulses) {
          current.sequence=coinSequence==UINT32_MAX?0:++coinSequence;
          if(current.sequence && coinCorePush(capturedCoins,capturedHead,&capturedCount,current)) {}
          else {
            // Capacity loss is explicit and latches reconciliation; never silently overwrite.
            if(overflowEvents<0xffffffffu)overflowEvents++;
            if(0xffffffffu-overflowPulses>=current.pulses)overflowPulses+=current.pulses;
            else overflowPulses=0xffffffffu;
            readerFault=true;
          }
        } else readerFault=true; // Ambiguous short pulse: do not pretend it never happened.
        pulseSequencePending=false;current={};sessionQuietSince=now;
      }
    }
    portEXIT_CRITICAL(&coinMux);
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

static bool captureIsQuiet() {
  bool idle;
  portENTER_CRITICAL(&coinMux);
  idle=digitalRead(COIN_PIN)==HIGH && !pulseSequencePending && capturedCount==0 && !readerFault && overflowEvents==0 &&
    millis()-lastReaderActivity>=2000 && millis()-sessionQuietSince>=2000;
  portEXIT_CRITICAL(&coinMux);
  return idle;
}
static bool captureIsQuiescent() {
  return captureIsQuiet() && coinJournal.bindingPhase==COIN_BIND_STABLE && coinJournal.count==0 && !coinJournal.reconcile && storageHealthy && !bootReviewRequired;
}

// Explicit receipt validation is required. A 2xx response alone is not an event acknowledgement.
bool sendCoinPayment(const StoredCoin &event) {
  if(WiFi.status()!=WL_CONNECTED)return false;
  WiFiClient client;HTTPClient http;
  http.setConnectTimeout(3000);http.setTimeout(5000);
  if(!http.begin(client,String(BACKEND_BASE_URL)+"/api/payments/verify"))return false;
  http.addHeader("Content-Type","application/json");http.addHeader("X-Hardware-Key",HARDWARE_API_KEY);
  JsonDocument payload;payload["transaction_id"]=event.transactionId;payload["event_id"]=event.eventId;payload["coin_amount"]=event.amount;
  String body;serializeJson(payload,body);
  int code=http.POST(body);String response=code>0?http.getString():"";http.end();
  JsonDocument doc;
  if(code>=200 && code<300 && !deserializeJson(doc,response)) {
    JsonObject receipt=doc["data"]["paymentEvent"].as<JsonObject>();
    if(receipt["recorded"].is<bool>() && receipt["recorded"].as<bool>() &&
       receipt["transactionId"].is<int>() && receipt["transactionId"].as<int>()==event.transactionId &&
       receipt["eventId"].is<const char*>() && String(receipt["eventId"].as<const char*>())==event.eventId &&
       (receipt["amount"].is<int>()||receipt["amount"].is<double>()) && receipt["amount"].as<double>()==event.amount) return true;
  }
  Serial.printf("COIN EVENT RETAINED: HTTP %d; event %s. No credit/cancellation inferred.\n",code,event.eventId);
  if(code>=400 && code<500 && !coinJournal.reconcile) {coinJournal.reconcile=true;persistCoinJournal();}
  return false;
}

void processDetectedCoin() {
  // Main loop only: durable journal writes never run in the 1ms capture critical section.
  if(!storageHealthy)return;
  uint32_t lostEvents,lostPulses;bool fault;
  portENTER_CRITICAL(&coinMux);lostEvents=overflowEvents;lostPulses=overflowPulses;fault=readerFault;portEXIT_CRITICAL(&coinMux);
  if(fault && !coinJournal.reconcile){coinJournal.reconcile=true;if(!persistCoinJournal())return;}
  if(lostEvents && (coinJournal.overflowEvents!=lostEvents || coinJournal.overflowPulses!=lostPulses)) {
    coinJournal.overflowEvents=lostEvents;coinJournal.overflowPulses=lostPulses;coinJournal.reconcile=true;if(!persistCoinJournal())return;
  }
  for(int drained=0;drained<16 && coinJournal.count<16;drained++) {
    CapturedCoin event;bool pending;
    portENTER_CRITICAL(&coinMux);pending=capturedCount>0;if(pending)event=capturedCoins[capturedHead];portEXIT_CRITICAL(&coinMux);
    if(!pending)break;
    if(!coinCoreAppendDurably(&coinJournal,event,coinDeviceId,coinBootNonce,persistCoreJournal,nullptr))return;
    portENTER_CRITICAL(&coinMux);capturedHead=(capturedHead+1)%64;capturedCount--;portEXIT_CRITICAL(&coinMux);
  }
  static uint32_t nextAttempt=0;
  if(!coinJournal.count || WiFi.status()!=WL_CONNECTED || (int32_t)(millis()-nextAttempt)<0)return;
  nextAttempt=millis()+5000;
  const StoredCoin event=coinJournal.events[0];
  if(event.transactionId<=0 || event.amount<=0 || event.requiresReview) {Serial.println("ORPHAN/UNKNOWN COIN RETAINED. Staff reconciliation required; no automatic reassignment.");return;}
  if(!sendCoinPayment(event))return;
  if(!coinCoreAcknowledge(&coinJournal,&event,true,persistCoreJournal,nullptr))return;
  Serial.printf("PAYMENT EVENT CONFIRMED: %s\n",event.eventId);
}

static bool bindingFenceClean(uint32_t fence) {
  bool clean;portENTER_CRITICAL(&coinMux);
  clean=captureFence==fence&&digitalRead(COIN_PIN)==HIGH&&!pulseSequencePending&&!capturedCount&&!readerFault;
  portEXIT_CRITICAL(&coinMux);return clean;
}
struct CoinBindingContext {uint32_t fence;};
static void freezeBinding(void *context) {
  CoinBindingContext *state=static_cast<CoinBindingContext*>(context);
  portENTER_CRITICAL(&coinMux);capturePaymentAllowed=false;bindingInProgress=true;state->fence=captureFence;portEXIT_CRITICAL(&coinMux);
}
static bool cleanBinding(void *context) {return bindingFenceClean(static_cast<CoinBindingContext*>(context)->fence);}
static void selectBindingOwner(int32_t next,void *) {portENTER_CRITICAL(&coinMux);captureTransactionId=next;portEXIT_CRITICAL(&coinMux);}
static bool enableCleanBinding(void *context) {
  uint32_t fence=static_cast<CoinBindingContext*>(context)->fence;bool clean;
  portENTER_CRITICAL(&coinMux);clean=captureFence==fence&&digitalRead(COIN_PIN)==HIGH&&!pulseSequencePending&&!capturedCount&&!readerFault;
  if(clean){capturePaymentAllowed=true;bindingInProgress=false;}portEXIT_CRITICAL(&coinMux);return clean;
}
static void abortBinding(int32_t previous,void *) {
  portENTER_CRITICAL(&coinMux);captureTransactionId=previous;capturePaymentAllowed=false;bindingInProgress=false;readerFault=true;portEXIT_CRITICAL(&coinMux);
  bootReviewRequired=true;sessionStaffAuthorized=false;
}
static bool bindReviewedSession(int next) {
  if(!captureIsQuiescent())return false;
  CoinBindingContext context={};
  CoinBindIO io={persistCoreJournal,freezeBinding,cleanBinding,selectBindingOwner,enableCleanBinding,abortBinding};
  if(!coinCoreBindReviewed(&coinJournal,next,&io,&context)){
    Serial.println("BINDING INTERRUPTED: no session enabled; previous owner retained; reconciliation required.");return false;
  }
  activePaymentTransactionId=next;activePaymentSession=true;sessionStaffAuthorized=true;return true;
}
static void invalidatePaymentSession(const char *reason) {
  paymentSessionVerified=false;backendDemoAutoBinding=false;staffApprovedTarget=0;automaticBindingBlocker=reason;sessionDeadlineKnown=false;
  portENTER_CRITICAL(&coinMux);capturePaymentAllowed=false;portEXIT_CRITICAL(&coinMux);
}
void checkPaymentSession() {
  if(WiFi.status()!=WL_CONNECTED){invalidatePaymentSession("WIFI_DISCONNECTED");return;}
  WiFiClient client;HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(5000);
  int owner=coinCoreCaptureOwner(&coinJournal);
  char freshness[17];snprintf(freshness,sizeof(freshness),"%08lX%08lX",(unsigned long)esp_random(),(unsigned long)esp_random());
  uint32_t requestAt=millis();
  String url=String(BACKEND_BASE_URL)+"/api/payments/session?bound_transaction_id="+String(owner)+"&session_check="+freshness;
  if(!http.begin(client,url)){invalidatePaymentSession("SESSION_REQUEST_FAILED");return;}
  http.addHeader("X-Hardware-Key",HARDWARE_API_KEY);
  int code=http.GET();String response=code==200?http.getString():"";http.end();
  JsonDocument doc;
  if(code!=200 || deserializeJson(doc,response) || !doc["data"]["active"].is<bool>() || millis()-requestAt>8000 ||
     !doc["data"]["session_check"].is<const char*>() || strcmp(doc["data"]["session_check"].as<const char*>(),freshness)){
    invalidatePaymentSession("SESSION_RESPONSE_INVALID_OR_STALE");return;
  }
  paymentSessionVerified=true;lastSessionCheckAt=millis();
  backendDemoAutoBinding=doc["data"]["controlled_demo_autobind"].is<bool>() && doc["data"]["controlled_demo_autobind"].as<bool>();
  bool demo=MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND && backendDemoAutoBinding;
  if(sessionDemoAuthorized && !demo){sessionStaffAuthorized=false;sessionDemoAuthorized=false;}
  bool ownerConfirmed=owner==0 || (doc["data"]["previous_session_closed"].is<bool>() && doc["data"]["previous_session_closed"].as<bool>()) ||
    (doc["data"]["active"].as<bool>() && doc["data"]["transaction_id"].is<int>() && doc["data"]["transaction_id"].as<int>()==owner);
  bool demoClean=ownerConfirmed && coinCoreDemoCanAuthorize(&coinJournal,MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND,backendDemoAutoBinding,storageHealthy,captureIsQuiet());
  if(demoClean)bootReviewRequired=false; // Empty healthy durable journal only; no evidence is cleared.
  automaticBindingBlocker=!demo?"CONTROLLED_DEMO_OPT_IN_REQUIRED":!storageHealthy?"PAYMENT_STORAGE_UNHEALTHY":coinJournal.reconcile?"PAYMENT_RECONCILIATION_REQUIRED":coinJournal.count?"UNCONFIRMED_PAYMENT_EVENTS":!demoClean?"COIN_PATH_OR_BINDING_NOT_QUIET":"NONE";
  if(!doc["data"]["active"].as<bool>()){
    sessionDeadlineKnown=false;
    if(doc["data"]["binding_blocker"].is<const char*>())automaticBindingBlocker="TRANSACTION_REQUIRES_EXPLICIT_STAFF_APPROVAL";
    activePaymentSession=false;sessionStaffAuthorized=false;proposedTransactionId=0;staffApprovedTarget=0;
    portENTER_CRITICAL(&coinMux);capturePaymentAllowed=false;portEXIT_CRITICAL(&coinMux);return;
  }
  if(!doc["data"]["transaction_id"].is<int>() || doc["data"]["transaction_id"].as<int>()<=0 ||
     !doc["data"]["payment_status"].is<const char*>() || strcmp(doc["data"]["payment_status"].as<const char*>(),"pending")){
    invalidatePaymentSession("INVALID_ACTIVE_TRANSACTION");return;
  }
  int next=doc["data"]["transaction_id"].as<int>();
  if(!doc["data"]["server_now_ms"].is<double>() || !doc["data"]["payment_deadline_ms"].is<double>()){
    invalidatePaymentSession("PAYMENT_DEADLINE_UNVERIFIED");return;
  }
  double remainingMs=doc["data"]["payment_deadline_ms"].as<double>()-doc["data"]["server_now_ms"].as<double>();
  if(!isfinite(remainingMs) || remainingMs>300000){invalidatePaymentSession("PAYMENT_DEADLINE_UNVERIFIED");return;}
  sessionDeadlineAt=millis()+(uint32_t)(remainingMs>0?remainingMs:0);sessionDeadlineKnown=true;
  if(next==owner && sessionStaffAuthorized && coinJournal.bindingPhase==COIN_BIND_STABLE){
    bool elapsed=demo && paymentDeadlineElapsed();
    portENTER_CRITICAL(&coinMux);capturePaymentAllowed=!elapsed&&!bootReviewRequired&&!coinJournal.reconcile&&storageHealthy&&!readerFault;portEXIT_CRITICAL(&coinMux);return;
  }
  // Production requires staff approval. Supervised demo can use the same durable bind after both opt-ins.
  sessionStaffAuthorized=false;
  portENTER_CRITICAL(&coinMux);capturePaymentAllowed=false;portEXIT_CRITICAL(&coinMux);
  if(proposedTransactionId!=next)staffApprovedTarget=0;
  proposedTransactionId=next;
  if(owner && next!=owner && !(doc["data"]["previous_session_closed"].is<bool>() && doc["data"]["previous_session_closed"].as<bool>())){automaticBindingBlocker="PREVIOUS_SESSION_NOT_CLOSED";return;}
  bool autoApproval=demo && demoClean;
  if(autoApproval && next!=owner && (!doc["data"]["amount_paid"].is<const char*>() || strcmp(doc["data"]["amount_paid"].as<const char*>(),"0.00"))){
    automaticBindingBlocker="PARTIAL_PAYMENT_OWNERSHIP_REVIEW_REQUIRED";return;
  }
  if((!autoApproval && (staffApprovedTarget!=next || millis()-approvalAt>30000)) || !captureIsQuiescent())return;
  staffApprovedTarget=0; // approval is single-use and bound to this exact fresh backend proposal
  if(next==owner) {
    bool clean;
    portENTER_CRITICAL(&coinMux);clean=digitalRead(COIN_PIN)==HIGH&&!pulseSequencePending&&!capturedCount&&!readerFault;
    if(clean)capturePaymentAllowed=true;portEXIT_CRITICAL(&coinMux);
    if(!clean)return;
    sessionStaffAuthorized=true;activePaymentSession=true;activePaymentTransactionId=owner;
  }else if(!bindReviewedSession(next))return;
  proposedTransactionId=0;
  sessionDemoAuthorized=autoApproval;automaticBindingBlocker="NONE";
  if(autoApproval && paymentDeadlineElapsed()){portENTER_CRITICAL(&coinMux);capturePaymentAllowed=false;portEXIT_CRITICAL(&coinMux);}
  Serial.printf("%s SESSION: %d. Physical coin inhibition NOT supported.\n",autoApproval?"CONTROLLED DEMO AUTO-BOUND":"STAFF-REVIEWED",next);
}

static void coinDiagnostics(JsonDocument &doc) {
  uint32_t queued;bool incomplete,fault;
  portENTER_CRITICAL(&coinMux);queued=capturedCount;incomplete=pulseSequencePending;fault=readerFault;portEXIT_CRITICAL(&coinMux);
  doc["device_id"]=coinDeviceId;doc["bound_transaction_id"]=coinCoreCaptureOwner(&coinJournal);doc["binding_phase"]=coinJournal.bindingPhase;doc["previous_binding_transaction_id"]=coinJournal.bindingFrom;doc["proposed_transaction_id"]=proposedTransactionId;doc["binding_review_required"]=coinJournal.bindingPhase!=COIN_BIND_STABLE || (!sessionStaffAuthorized && !(MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND && backendDemoAutoBinding && proposedTransactionId==0 && !bootReviewRequired));
  doc["controlled_demo_autobind"]=bool(MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND && backendDemoAutoBinding);
  doc["automatic_binding_blocker"]=automaticBindingBlocker;
  doc["expiration_check_ready"]=bool(MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND && backendDemoAutoBinding && paymentSessionVerified && millis()-lastSessionCheckAt<15000 && paymentDeadlineElapsed() && captureIsQuiescent());
  doc["pending_events"]=queued+coinJournal.count;doc["durable_events"]=coinJournal.count;
  doc["incomplete_pulses"]=incomplete;doc["reconciliation_required"]=coinJournal.reconcile||fault||bootReviewRequired||!storageHealthy;
  doc["boot_review_required"]=bootReviewRequired;doc["storage_healthy"]=storageHealthy;
  doc["backend_session_verified"]=paymentSessionVerified;doc["inhibit_supported"]=false;doc["automatic_handoff_safe"]=false;
  if(coinJournal.count){const StoredCoin &head=coinJournal.events[0];doc["oldest_event_id"]=head.eventId;doc["oldest_event_transaction_id"]=head.transactionId;doc["oldest_event_pulses"]=head.pulses;doc["oldest_event_amount"]=head.amount;doc["oldest_event_requires_review"]=head.requiresReview;}
  doc["overflow_events"]=coinJournal.overflowEvents;doc["overflow_pulses"]=coinJournal.overflowPulses;
}
void reportCoinDiagnostics() {
  static uint32_t last=0;if(millis()-last<10000)return;last=millis();
  JsonDocument doc;coinDiagnostics(doc);String body;serializeJson(doc,body);Serial.println(body);
  if(WiFi.status()!=WL_CONNECTED){Serial.println("[Diagnostics] POST skipped: Wi-Fi is offline; local JSON is not a server acknowledgement.");return;}
  WiFiClient client;HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(5000);
  const uint32_t started=millis();
  if(!http.begin(client,String(BACKEND_BASE_URL)+"/api/payments/diagnostics")){Serial.println("[Diagnostics] POST initialization failed.");return;}
  http.addHeader("Content-Type","application/json");http.addHeader("X-Hardware-Key",HARDWARE_API_KEY);
  int code=http.POST(body);
  bool saved=false;
  if(code==200){JsonDocument ack;String response=http.getString();if(deserializeJson(ack,response)==DeserializationError::Ok)saved=ack["data"]["saved"].is<bool>()&&ack["data"]["saved"].as<bool>();}
  Serial.printf("[Diagnostics] POST /api/payments/diagnostics HTTP=%d duration=%lu ms result=%s\n",code,(unsigned long)(millis()-started),saved?"saved":(code<0?"transport_error":code==401||code==403?"authentication_failed":code==200?"acknowledgement_unverified":"server_rejected"));
  http.end();
}
void handleCoinMaintenance() {
  static String command;static bool commandOverflow=false;
  while(Serial.available()) {
    char c=Serial.read();
    if(c=='\n') {
      if(commandOverflow){Serial.println("Maintenance command rejected: line too long.");command="";commandOverflow=false;continue;}
      command.trim();
      if(command=="PAYMENT STATUS"){JsonDocument doc;coinDiagnostics(doc);serializeJson(doc,Serial);Serial.println();}
      if(command=="REVIEWED EMPTY COIN PATH") {
        bool idle;
        portENTER_CRITICAL(&coinMux);idle=digitalRead(COIN_PIN)==HIGH&&!capturedCount&&!pulseSequencePending&&!readerFault;portEXIT_CRITICAL(&coinMux);
        if(idle && coinJournal.bindingPhase==COIN_BIND_STABLE && !coinJournal.count && !coinJournal.reconcile && storageHealthy && !coinJournal.overflowEvents) {
          bootReviewRequired=false;
          Serial.println("Staff boot review acknowledged. No events cleared; no inhibit capability claimed.");
        }else Serial.println("Boot review NOT cleared: pending/ambiguous events need reconciliation.");
      }
      if(command.startsWith("BIND PAYMENT ")) {
        String number=command.substring(13);bool digits=number.length()>0&&number.length()<=10;for(unsigned int i=0;i<number.length();i++)if(number[i]<'0'||number[i]>'9')digits=false;
        int32_t requested=0;if(digits){for(unsigned int i=0;i<number.length();i++){int digit=number[i]-'0';if(requested>(INT32_MAX-digit)/10){digits=false;break;}requested=requested*10+digit;}}if(!digits)requested=0;
        if(requested>0 && requested==proposedTransactionId && paymentSessionVerified && millis()-lastSessionCheckAt<10000 && captureIsQuiescent()) {
          staffApprovedTarget=requested;approvalAt=millis();Serial.println("Staff binding approval queued for the exact proposed transaction. No inhibit claimed.");
        }else Serial.println("Binding NOT approved: verify exact proposed ID, fresh PHP status, boot review and unresolved events.");
      }
      command="";
    } else if(command.length()<64)command+=c;else commandOverflow=true;
  }
}
