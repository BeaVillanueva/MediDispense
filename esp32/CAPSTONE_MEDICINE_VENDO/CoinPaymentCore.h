#pragma once
/* Portable safety core shared verbatim by ESP32 code and native fault tests. */
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#ifndef __cplusplus
#include <stdbool.h>
#endif

typedef struct CapturedCoin { int32_t transactionId; uint32_t pulses; uint32_t sequence; bool paymentSessionOpen; } CapturedCoin;
typedef struct StoredCoin { int32_t transactionId; uint32_t pulses; int32_t amount; char eventId[80]; bool requiresReview; } StoredCoin;
typedef struct CoinJournalV1 {
  uint32_t version,bootCounter; int32_t boundTransactionId; uint32_t count,overflowEvents,overflowPulses;
  bool reconcile; StoredCoin events[16]; uint32_t checksum;
} CoinJournalV1;
typedef struct CoinJournal {
  uint32_t version,bootCounter; int32_t boundTransactionId; uint32_t count,overflowEvents,overflowPulses;
  bool reconcile; StoredCoin events[16];
  uint32_t bindingPhase; int32_t bindingFrom,bindingTarget; uint32_t checksum;
} CoinJournal;
enum { COIN_BIND_STABLE=0, COIN_BIND_PREPARED=1 };
static uint32_t coinCoreHash(const void *data,size_t length) {
  uint32_t value=2166136261u;const uint8_t *bytes=(const uint8_t*)data;
  size_t i;for(i=0;i<length;i++)value=(value^bytes[i])*16777619u;return value;
}
static uint32_t coinCoreChecksum(const CoinJournal *j) {return coinCoreHash(j,offsetof(CoinJournal,checksum));}
static int32_t coinCoreAmount(uint32_t pulses) {return pulses==5||pulses==10||pulses==20?(int32_t)pulses:0;}
static bool coinCoreIdValid(const char *id) {
  size_t i;for(i=0;i<80;i++){char c=id[i];if(!c)return i>0;if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-'||c=='_'||c==':'))return false;}return false;
}
static bool coinCoreEventsValid(const StoredCoin *events,uint32_t count,bool legacy) {
  uint32_t i,k;for(i=0;i<count;i++) {
    const StoredCoin *e=&events[i];
    if(((const uint8_t*)e)[offsetof(StoredCoin,requiresReview)]>1)return false;
    if(e->transactionId<0||!e->pulses||!coinCoreIdValid(e->eventId)||e->amount!=coinCoreAmount(e->pulses))return false;
    if(!legacy && (!e->transactionId||!e->amount) && !e->requiresReview)return false;
    for(k=0;k<i;k++)if(!strcmp(e->eventId,events[k].eventId))return false;
  }return true;
}
static bool coinCoreValid(const CoinJournal *j) {
  if(j->version!=2||j->count>16||j->boundTransactionId<0||j->bindingFrom<0||j->bindingTarget<0||j->checksum!=coinCoreChecksum(j))return false;
  if(((const uint8_t*)j)[offsetof(CoinJournal,reconcile)]>1)return false;
  if(j->bindingPhase==COIN_BIND_STABLE) {
    if(j->bindingTarget!=j->boundTransactionId)return false;
  }else if(j->bindingPhase==COIN_BIND_PREPARED) {
    if(j->bindingTarget<=0||j->bindingTarget==j->bindingFrom||(j->boundTransactionId!=j->bindingFrom&&j->boundTransactionId!=j->bindingTarget))return false;
  }else return false;
  if((j->overflowEvents||j->overflowPulses)&&!j->reconcile)return false;
  return coinCoreEventsValid(j->events,j->count,false);
}
static bool coinCoreUpgrade(const CoinJournalV1 *old,CoinJournal *out) {
  if(old->version!=1||old->count>16||old->boundTransactionId<0||old->checksum!=coinCoreHash(old,offsetof(CoinJournalV1,checksum))||!coinCoreEventsValid(old->events,old->count,true))return false;
  if(((const uint8_t*)old)[offsetof(CoinJournalV1,reconcile)]>1)return false;
  memset(out,0,sizeof(*out));out->version=2;out->bootCounter=old->bootCounter;out->boundTransactionId=old->boundTransactionId;out->bindingTarget=old->boundTransactionId;out->bindingFrom=old->boundTransactionId;
  out->count=old->count;out->overflowEvents=old->overflowEvents;out->overflowPulses=old->overflowPulses;out->reconcile=old->reconcile||old->overflowEvents||old->overflowPulses;
  memcpy(out->events,old->events,sizeof(out->events));
  {uint32_t i;for(i=0;i<out->count;i++)if(!out->events[i].transactionId||!out->events[i].amount){out->events[i].requiresReview=true;out->reconcile=true;}}
  out->checksum=coinCoreChecksum(out);return coinCoreValid(out);
}
static bool coinCorePush(CapturedCoin *queue,uint32_t head,uint32_t *count,CapturedCoin event) {
  if(*count>=64)return false;queue[(head+*count)%64]=event;(*count)++;return true;
}
static bool coinCoreAppend(CoinJournal *j,CapturedCoin event,const char *device,const char *nonce) {
  StoredCoin *stored;
  if(j->count>=16||!event.pulses||!event.sequence)return false;
  stored=&j->events[j->count++];memset(stored,0,sizeof(*stored));stored->transactionId=event.transactionId;stored->pulses=event.pulses;stored->amount=coinCoreAmount(event.pulses);
  stored->requiresReview=!event.paymentSessionOpen||event.transactionId<=0||!stored->amount;
  snprintf(stored->eventId,sizeof(stored->eventId),"coin-%s-%08lX-%s-%08lX",device,(unsigned long)j->bootCounter,nonce,(unsigned long)event.sequence);
  if(stored->requiresReview)j->reconcile=true;
  return true;
}
static bool coinCoreConfirm(CoinJournal *j,const StoredCoin *confirmed) {
  const StoredCoin *head;uint32_t i;
  if(!j->count)return false;head=&j->events[0];
  if(head->requiresReview||strcmp(head->eventId,confirmed->eventId)||head->transactionId!=confirmed->transactionId||head->amount!=confirmed->amount)return false;
  for(i=1;i<j->count;i++)j->events[i-1]=j->events[i];j->count--;memset(&j->events[j->count],0,sizeof(StoredCoin));return true;
}
static bool coinCorePrepareBinding(CoinJournal *j,int32_t next) {
  if(j->count||j->reconcile||j->overflowEvents||j->bindingPhase!=COIN_BIND_STABLE||next<=0||next==j->boundTransactionId)return false;
  j->bindingFrom=j->boundTransactionId;j->bindingTarget=next;j->bindingPhase=COIN_BIND_PREPARED;return true;
}
// A controlled demonstration policy, never evidence of physical coin inhibition.
static bool coinCoreDemoCanAuthorize(const CoinJournal *j,bool firmwareOptIn,bool backendOptIn,bool storageHealthy,bool quiet) {
  return firmwareOptIn && backendOptIn && storageHealthy && quiet && coinCoreValid(j) &&
    !j->count && !j->reconcile && !j->overflowEvents && !j->overflowPulses && j->bindingPhase==COIN_BIND_STABLE;
}
static int32_t coinCoreCaptureOwner(const CoinJournal *j) {return j->bindingPhase==COIN_BIND_PREPARED?j->bindingFrom:j->boundTransactionId;}

typedef bool (*CoinPersistFn)(CoinJournal*,void*);
static bool coinCoreAppendDurably(CoinJournal *j,CapturedCoin event,const char *device,const char *nonce,CoinPersistFn persist,void *context) {
  CoinJournal previous;memcpy(&previous,j,sizeof(previous));
  if(!coinCoreAppend(j,event,device,nonce))return false;
  if(!persist(j,context)){memcpy(j,&previous,sizeof(previous));return false;}return true;
}
static bool coinCoreAcknowledge(CoinJournal *j,const StoredCoin *event,bool receiptValid,CoinPersistFn persist,void *context) {
  CoinJournal previous;memcpy(&previous,j,sizeof(previous));
  if(!receiptValid||!coinCoreConfirm(j,event))return false;
  if(!persist(j,context)){memcpy(j,&previous,sizeof(previous));return false;}return true;
}
typedef struct CoinBindIO {
  CoinPersistFn persist;
  void (*freeze)(void*);
  bool (*clean)(void*);
  void (*selectOwner)(int32_t,void*);
  bool (*enableIfClean)(void*);
  void (*abortOwner)(int32_t,void*);
} CoinBindIO;
static bool coinCoreBindReviewed(CoinJournal *j,int32_t next,const CoinBindIO *io,void *context) {
  CoinJournal previous;memcpy(&previous,j,sizeof(previous));
  if(!coinCorePrepareBinding(j,next))return false;
  io->freeze(context);
  if(!io->persist(j,context)||!io->clean(context))goto failed;
  j->boundTransactionId=next; // still prepared: reboot recovers previous capture owner
  if(!io->persist(j,context)||!io->clean(context))goto failed;
  io->selectOwner(next,context); // capture remains frozen/ambiguous until final durable validation
  j->bindingPhase=COIN_BIND_STABLE;
  if(!io->persist(j,context)||!io->enableIfClean(context))goto failed;
  return true;
failed:
  memcpy(j,&previous,sizeof(previous));j->bindingPhase=COIN_BIND_PREPARED;j->bindingFrom=previous.boundTransactionId;j->bindingTarget=next;j->reconcile=true;
  io->abortOwner(previous.boundTransactionId,context);
  io->persist(j,context); // real writer refuses all further writes after storage uncertainty
  return false;
}
#ifdef __cplusplus
static_assert(sizeof(StoredCoin)==96,"Review NVS binary compatibility before deploying a changed event format");
static_assert(sizeof(CoinJournalV1)==1568,"Legacy journal layout must remain compatible");
#endif
static bool coinCoreStartBoot(CoinJournal *j) {
  if(!coinCoreValid(j)||j->bootCounter==UINT32_MAX)return false;
  if(j->bindingPhase!=COIN_BIND_STABLE)j->reconcile=true;
  j->bootCounter++;j->checksum=coinCoreChecksum(j);return true;
}
