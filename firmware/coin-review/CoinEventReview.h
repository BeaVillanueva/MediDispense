#pragma once
#include <mbedtls/md.h>
#include "CoinEventReviewCore.h"
#if __has_include("CoinReview.local.h")
#include "CoinReview.local.h"
#endif
#ifndef MEDIDISPENSE_COIN_REVIEW_ENABLED
#define MEDIDISPENSE_COIN_REVIEW_ENABLED 0
#define MEDIDISPENSE_COIN_REVIEW_KEY_HEX ""
#endif
extern bool dispenseInProgress;
static int reviewHex(char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;}
static bool reviewConfigured(){if(!MEDIDISPENSE_COIN_REVIEW_ENABLED||strlen(MEDIDISPENSE_COIN_REVIEW_KEY_HEX)!=64)return false;for(int i=0;i<64;i++)if(reviewHex(MEDIDISPENSE_COIN_REVIEW_KEY_HEX[i])<0)return false;return true;}
static String reviewDigest(const String &text,bool keyed){
  unsigned char out[32],key[32];const auto *md=mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if(keyed){if(!reviewConfigured())return "";for(int i=0;i<32;i++)key[i]=(reviewHex(MEDIDISPENSE_COIN_REVIEW_KEY_HEX[i*2])<<4)|reviewHex(MEDIDISPENSE_COIN_REVIEW_KEY_HEX[i*2+1]);if(mbedtls_md_hmac(md,key,32,(const unsigned char*)text.c_str(),text.length(),out))return "";memset(key,0,sizeof(key));}
  else if(mbedtls_md(md,(const unsigned char*)text.c_str(),text.length(),out))return "";
  char hex[65];for(int i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",out[i]);return String(hex);
}
static bool reviewEqual(const String &a,const String &b){if(a.length()!=64||b.length()!=64)return false;uint8_t diff=0;for(int i=0;i<64;i++)diff|=a[i]^b[i];return !diff;}
static String reviewRandom(){char b[33];snprintf(b,sizeof(b),"%08lx%08lx%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random());return String(b);}
static String reviewText(const CoinReviewArchive &a){return String("review-v1|")+a.reviewId+"|"+coinDeviceId+"|"+a.original.eventId+"|"+String(a.original.transactionId)+"|"+String(a.original.pulses)+"|"+String(a.original.amount)+"|"+a.nonce+"|no_additional_payment|keep_blocked";}
static bool reviewArchiveAuthenticated(const CoinReviewArchive &a){return coinReviewArchiveValid(&a)&&reviewEqual(reviewDigest(reviewText(a),false),a.archiveHash)&&reviewEqual(reviewDigest(reviewText(a)+"|"+a.challenge,true),a.signature);}
static bool reviewHttp(const String &path,JsonDocument &response,const JsonDocument *body=nullptr,const String &proof=""){
  if(WiFi.status()!=WL_CONNECTED)return false;WiFiClient client;HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(5000);
  if(!http.begin(client,String(BACKEND_BASE_URL)+path))return false;http.addHeader("X-Hardware-Key",HARDWARE_API_KEY);if(proof.length())http.addHeader("X-Coin-Review-Proof",proof);
  int code;if(body){String text;serializeJson(*body,text);http.addHeader("Content-Type","application/json");code=http.POST(text);}else code=http.GET();
  String text=code>0?http.getString():"";http.end();Serial.printf("[Coin review] HTTP %d; no payment credit or machine reopening inferred.\n",code);
  return code==200&&deserializeJson(response,text)==DeserializationError::Ok&&response["data"].is<JsonObject>();
}
static String reviewArchiveKey(const CoinReviewArchive &a){return String("rv")+String(a.reviewId).substring(0,12);}
static bool reviewPersistArchive(const CoinReviewArchive *a,void*){
  String key=reviewArchiveKey(*a),pending=coinPreferences.getString("review-pending","");CoinReviewArchive readback={};
  if(pending.length()&&pending!=key)return false;
  if(coinPreferences.isKey(key.c_str())){if(coinPreferences.getBytesLength(key.c_str())!=sizeof(readback)||coinPreferences.getBytes(key.c_str(),&readback,sizeof(readback))!=sizeof(readback)||memcmp(&readback,a,sizeof(readback)))return false;}
  else if(coinPreferences.putBytes(key.c_str(),a,sizeof(*a))!=sizeof(*a))return false;
  if(coinPreferences.getBytes(key.c_str(),&readback,sizeof(readback))!=sizeof(readback)||!reviewArchiveAuthenticated(readback)||memcmp(&readback,a,sizeof(readback)))return false;
  coinPreferences.putString("review-pending",key);return coinPreferences.getString("review-pending","")==key;
}
static void serviceCoinReviewAck(){
  static uint32_t next=0;if(!reviewConfigured()||!storageHealthy||!coinCoreValid(&coinJournal)||WiFi.status()!=WL_CONNECTED||(int32_t)(millis()-next)<0)return;next=millis()+5000;
  String key=coinPreferences.getString("review-pending","");if(!key.length())return;CoinReviewArchive a={};
  if(coinPreferences.getBytesLength(key.c_str())!=sizeof(a)||coinPreferences.getBytes(key.c_str(),&a,sizeof(a))!=sizeof(a)||!reviewArchiveAuthenticated(a)){Serial.println("[Coin review] Archive verification failed; machine remains blocked.");return;}
  for(uint32_t i=0;i<coinJournal.count;i++)if(!strcmp(coinJournal.events[i].eventId,a.original.eventId))return;
  if(!coinJournal.reconcile)return; // No acknowledgment may claim we kept the machine blocked otherwise.
  JsonDocument body,response;body["id"]=a.reviewId;body["device_id"]=coinDeviceId;body["archive_hash"]=a.archiveHash;body["count"]=coinJournal.count;
  String text=String("ack-v1|")+a.reviewId+"|"+coinDeviceId+"|"+a.archiveHash+"|"+String(coinJournal.count)+"|archived|journal_persisted|keep_blocked";body["signature"]=reviewDigest(text,true);
  if(reviewHttp("/api/payments/coin-reviews/ack",response,&body)&&response["data"]["acknowledged"].is<bool>()&&response["data"]["acknowledged"].as<bool>()&&String(response["data"]["id"].as<const char*>())==a.reviewId){coinPreferences.putString("review-pending","");Serial.println("[Coin review] Durable event archive acknowledged. Reconciliation and kiosk pause remain; no new payment recorded.");}
}
static void reportCoinReviewAttestation(){
  if(!reviewConfigured()||dispenseInProgress||!storageHealthy||!coinCoreValid(&coinJournal)||!coinJournal.count){Serial.println("[Coin review] Review configuration, healthy journal and a retained event are required.");return;}
  JsonDocument response;if(!reviewHttp(String("/api/payments/coin-reviews/challenge?device_id=")+coinDeviceId,response))return;
  JsonObject data=response["data"];if(!data["challenge"].is<const char*>()||!data["expires"].is<int>()||!data["signature"].is<const char*>())return;
  String nonce=data["challenge"].as<const char*>();int expires=data["expires"];String proof=String("challenge-v1|")+coinDeviceId+"|"+nonce+"|"+String(expires);if(nonce.length()!=32||!reviewEqual(reviewDigest(proof,true),String(data["signature"].as<const char*>())))return;
  StoredCoin head=coinJournal.events[0];int quiet=captureIsQuiet()?1:0,healthy=storageHealthy?1:0,stable=coinJournal.bindingPhase==COIN_BIND_STABLE?1:0,overflow=(coinJournal.overflowEvents||coinJournal.overflowPulses)?1:0,review=head.requiresReview?1:0;
  JsonDocument p,result;p["device_id"]=coinDeviceId;p["challenge"]=nonce;p["expires"]=expires;p["challenge_signature"]=data["signature"];p["event_id"]=head.eventId;p["transaction_id"]=head.transactionId;p["bound_transaction_id"]=coinJournal.boundTransactionId;p["pulses"]=head.pulses;p["amount"]=head.amount;p["count"]=coinJournal.count;p["quiet"]=quiet;p["healthy"]=healthy;p["binding_stable"]=stable;p["overflow"]=overflow;p["requires_review"]=review;
  String text=String("attest-v1|")+coinDeviceId+"|"+nonce+"|"+String(expires)+"|"+head.eventId+"|"+String(head.transactionId)+"|"+String(coinJournal.boundTransactionId)+"|"+String(head.pulses)+"|"+String(head.amount)+"|"+String(coinJournal.count)+"|"+String(quiet)+"|"+String(healthy)+"|"+String(stable)+"|"+String(overflow)+"|"+String(review);p["signature"]=reviewDigest(text,true);
  if(reviewHttp("/api/payments/coin-reviews/attest",result,&p))Serial.printf("[Coin review] Exact-event evidence submitted: %s. Super Admin approval still required.\n",head.eventId);
}
static void handleCoinReviewCommand(const String &command){
  if(command=="REVIEW COIN STATUS"){reportCoinReviewAttestation();return;}
  if(!command.startsWith("APPLY COIN REVIEW "))return;
  String id=command.substring(18); // prefix is 18 characters including its final space
  if(id.length()!=32||!reviewConfigured()||dispenseInProgress||!storageHealthy||!captureIsQuiet()){Serial.println("[Coin review] Apply blocked; verify exact review ID, power isolation and quiet capture.");return;}
  for(unsigned i=0;i<id.length();i++)if(reviewHex(id[i])<0)return;
  if(!coinJournal.count)return;const StoredCoin head=coinJournal.events[0];String nonce=reviewRandom();JsonDocument response;
  String proof=reviewDigest(String("fetch-v1|")+id+"|"+coinDeviceId+"|"+nonce,true);
  if(!reviewHttp(String("/api/payments/coin-reviews/")+id+"?device_id="+coinDeviceId+"&challenge="+nonce,response,nullptr,proof))return;
  JsonObject d=response["data"];if(!d["id"].is<const char*>()||!d["device_id"].is<const char*>()||!d["event_id"].is<const char*>()||!d["nonce"].is<const char*>()||!d["archive_hash"].is<const char*>()||!d["signature"].is<const char*>()||!d["transaction_id"].is<int>()||!d["pulses"].is<unsigned int>()||!d["amount"].is<int>())return;
  if(String(d["id"].as<const char*>())!=id||String(d["device_id"].as<const char*>())!=coinDeviceId||String(d["event_id"].as<const char*>())!=head.eventId||d["transaction_id"].as<int>()!=head.transactionId||d["pulses"].as<unsigned int>()!=head.pulses||d["amount"].as<int>()!=head.amount)return;
  CoinReviewArchive a={};a.version=1;a.original=head;strlcpy(a.reviewId,id.c_str(),sizeof(a.reviewId));strlcpy(a.nonce,d["nonce"].as<const char*>(),sizeof(a.nonce));strlcpy(a.challenge,nonce.c_str(),sizeof(a.challenge));strlcpy(a.archiveHash,d["archive_hash"].as<const char*>(),sizeof(a.archiveHash));strlcpy(a.signature,d["signature"].as<const char*>(),sizeof(a.signature));a.checksum=coinReviewChecksum(&a);
  bool verified=reviewArchiveAuthenticated(a);
  String storedKey=reviewArchiveKey(a);
  if(coinPreferences.isKey(storedKey.c_str())){
    CoinReviewArchive existing={};
    if(coinPreferences.getBytesLength(storedKey.c_str())!=sizeof(existing)||coinPreferences.getBytes(storedKey.c_str(),&existing,sizeof(existing))!=sizeof(existing)||!reviewArchiveAuthenticated(existing)||strcmp(existing.reviewId,a.reviewId)||strcmp(existing.nonce,a.nonce)||strcmp(existing.archiveHash,a.archiveHash)||!coinReviewSameEvent(&existing.original,&a.original))return;
    a=existing; // Reuse durable evidence after interrupted writes; do not overwrite it with a new fetch challenge.
  }
  if(coinReviewApply(&coinJournal,&a,verified,captureIsQuiet(),reviewPersistArchive,persistCoreJournal,nullptr)){Serial.printf("[Coin review] Archived exact event %s. Machine remains blocked.\n",head.eventId);serviceCoinReviewAck();}
  else Serial.println("[Coin review] No queue advance confirmed. Evidence retained; do not clear NVS.");
}
