#pragma once
#include "CoinPaymentCore.h"
// Append-only archive written before advancing one reviewed queue entry.
typedef struct CoinReviewArchive {
  uint32_t version;
  StoredCoin original;
  char reviewId[33],nonce[33],challenge[33],archiveHash[65],signature[65];
  uint32_t checksum;
} CoinReviewArchive;
static uint32_t coinReviewChecksum(const CoinReviewArchive *a){return coinCoreHash(a,offsetof(CoinReviewArchive,checksum));}
static bool coinReviewArchiveValid(const CoinReviewArchive *a){return a->version==1&&a->checksum==coinReviewChecksum(a)&&a->original.requiresReview&&coinCoreEventsValid(&a->original,1,false)&&a->reviewId[32]==0&&a->nonce[32]==0&&a->challenge[32]==0&&a->archiveHash[64]==0&&a->signature[64]==0&&strlen(a->reviewId)==32&&strlen(a->nonce)==32&&strlen(a->challenge)==32&&strlen(a->archiveHash)==64&&strlen(a->signature)==64;}
static bool coinReviewSameEvent(const StoredCoin *a,const StoredCoin *b){return !strcmp(a->eventId,b->eventId)&&a->transactionId==b->transactionId&&a->pulses==b->pulses&&a->amount==b->amount&&a->requiresReview==b->requiresReview;}
typedef bool (*CoinArchivePersistFn)(const CoinReviewArchive*,void*);
// archive() must save, read back and authenticate evidence AND its pending-ack pointer.
static bool coinReviewApply(CoinJournal *j,const CoinReviewArchive *a,bool proofVerified,bool captureQuiet,CoinArchivePersistFn archive,CoinPersistFn persist,void *context){
  if(!proofVerified||!captureQuiet||!coinCoreValid(j)||!coinReviewArchiveValid(a)||j->bindingPhase!=COIN_BIND_STABLE||j->overflowEvents||j->overflowPulses||!j->count||!coinReviewSameEvent(&j->events[0],&a->original)||j->boundTransactionId!=a->original.transactionId)return false;
  if(!archive(a,context))return false;
  CoinJournal previous=*j;
  for(uint32_t i=1;i<j->count;i++)j->events[i-1]=j->events[i];
  j->count--;memset(&j->events[j->count],0,sizeof(StoredCoin));
  j->reconcile=true; // Never clear generic, boot, storage, overflow or binding faults here.
  if(!persist(j,context)){*j=previous;return false;}
  return true;
}
