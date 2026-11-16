#include <assert.h>
#include <stdio.h>
#include "CoinEventReviewCore.h"
static int archives=0,writes=0;static bool archiveOK=true,writeOK=true;static CoinReviewArchive diskArchive;static CoinJournal diskJournal;
static bool archive(const CoinReviewArchive *a,void *context){archives++;if(!archiveOK)return false;diskArchive=*a;return true;}
static bool persist(CoinJournal *j,void *context){writes++;if(!writeOK)return false;j->checksum=coinCoreChecksum(j);diskJournal=*j;return true;}
static CoinJournal journal(){CoinJournal j={};j.version=2;j.boundTransactionId=7001;j.bindingTarget=7001;j.bindingFrom=7001;j.bootCounter=14;j.bindingPhase=COIN_BIND_STABLE;CapturedCoin event={7001,5,2,false};assert(coinCoreAppend(&j,event,"AABBCCDDEEFF","0011223344556677"));j.checksum=coinCoreChecksum(&j);return j;}
static CoinReviewArchive evidence(CoinJournal j){CoinReviewArchive a={};a.version=1;a.original=j.events[0];memset(a.reviewId,'b',32);memset(a.nonce,'c',32);memset(a.challenge,'d',32);memset(a.archiveHash,'e',64);memset(a.signature,'f',64);a.checksum=coinReviewChecksum(&a);return a;}
int main(){
  CoinJournal j=journal(),before=j;CoinReviewArchive a=evidence(j);
  assert(!coinReviewApply(&j,&a,false,true,archive,persist,0));assert(!coinReviewApply(&j,&a,true,false,archive,persist,0));assert(archives==0&&writes==0);
  CoinReviewArchive wrong=a;wrong.original.transactionId=7002;wrong.checksum=coinReviewChecksum(&wrong);assert(!coinReviewApply(&j,&wrong,true,true,archive,persist,0));
  wrong=a;strcpy(wrong.original.eventId,"different-event");wrong.checksum=coinReviewChecksum(&wrong);assert(!coinReviewApply(&j,&wrong,true,true,archive,persist,0));
  archiveOK=false;assert(!coinReviewApply(&j,&a,true,true,archive,persist,0));assert(!memcmp(&j,&before,sizeof(j))&&writes==0);
  archiveOK=true;writeOK=false;assert(!coinReviewApply(&j,&a,true,true,archive,persist,0));assert(!memcmp(&j,&before,sizeof(j)));assert(coinReviewArchiveValid(&diskArchive));
  // Power loss after archive but before journal advance: original event and durable evidence survive.
  j=before;writeOK=true;assert(coinReviewApply(&j,&a,true,true,archive,persist,0));assert(j.count==0&&j.reconcile&&coinCoreValid(&j));assert(coinReviewArchiveValid(&diskArchive));
  int previous=writes;assert(!coinReviewApply(&j,&a,true,true,archive,persist,0));assert(writes==previous); // duplicate cannot consume the next event
  // Power loss after journal write/before network ack: archive + journal allow exact receipt retry.
  j=diskJournal;assert(j.count==0&&coinCoreValid(&j)&&coinReviewArchiveValid(&diskArchive));
  j=journal();CapturedCoin another={7001,10,3,false};assert(coinCoreAppend(&j,another,"AABBCCDDEEFF","0011223344556677"));j.checksum=coinCoreChecksum(&j);a=evidence(j);StoredCoin preserved=j.events[1];
  assert(coinReviewApply(&j,&a,true,true,archive,persist,0));assert(j.count==1&&coinReviewSameEvent(&j.events[0],&preserved)&&j.reconcile);
  j=journal();a=evidence(j);j.overflowPulses=1;j.reconcile=true;j.checksum=coinCoreChecksum(&j);assert(!coinReviewApply(&j,&a,true,true,archive,persist,0));
  j=journal();a=evidence(j);j.bindingPhase=COIN_BIND_PREPARED;j.bindingTarget=7002;j.checksum=coinCoreChecksum(&j);assert(!coinReviewApply(&j,&a,true,true,archive,persist,0));
  puts("PASS exact-event review core: forged/changed proof, quiet capture, archive failure, journal failure, reboot, duplicate apply, other events, overflow and binding guards.");
}
