#include <stdlib.h>
#include "../CAPSTONE_MEDICINE_VENDO/CoinPaymentCore.h"
static int checks=0;
#define CHECK(test,label) do{if(!(test)){fprintf(stderr,"FAIL: %s (line %d)\n",label,__LINE__);exit(1);}checks++;printf("PASS %s\n",label);}while(0)
typedef struct Store {CoinJournal durable;int writes,failWrite,pulseWrite;bool uncertainCommit,healthy,frozen,allowed,pulse,fault;int32_t owner;} Store;
static void seal(CoinJournal *j){j->version=2;j->checksum=coinCoreChecksum(j);}
static CoinJournal emptyJournal(int32_t owner){CoinJournal j;memset(&j,0,sizeof(j));j.boundTransactionId=owner;j.bindingFrom=owner;j.bindingTarget=owner;j.bootCounter=1;seal(&j);return j;}
static bool persist(CoinJournal *j,void *ctx){Store *s=(Store*)ctx;if(!s->healthy)return false;s->writes++;seal(j);if(!coinCoreValid(j)){s->healthy=false;return false;}if(s->pulseWrite==s->writes)s->pulse=true;if(s->failWrite==s->writes){if(s->uncertainCommit)s->durable=*j;s->healthy=false;return false;}s->durable=*j;return true;}
static Store storeFor(CoinJournal j){Store s;memset(&s,0,sizeof(s));s.durable=j;s.healthy=true;s.owner=j.boundTransactionId;return s;}
static void freeze(void *ctx){Store *s=(Store*)ctx;s->frozen=true;s->allowed=false;}
static bool clean(void *ctx){return !((Store*)ctx)->pulse;}
static void selectOwner(int32_t owner,void *ctx){((Store*)ctx)->owner=owner;}
static bool enable(void *ctx){Store *s=(Store*)ctx;if(s->pulse)return false;s->allowed=true;s->frozen=false;return true;}
static void abortOwner(int32_t owner,void *ctx){Store *s=(Store*)ctx;s->owner=owner;s->allowed=false;s->frozen=false;s->fault=true;}
static CoinBindIO io={persist,freeze,clean,selectOwner,enable,abortOwner};
static CapturedCoin event(int32_t owner,uint32_t pulses,uint32_t seq){CapturedCoin e={owner,pulses,seq,true};return e;}
int main(void){
 CoinJournal j=emptyJournal(7);Store s=storeFor(j);CapturedCoin e=event(7,5,1);
 CHECK(coinCoreDemoCanAuthorize(&j,true,true,true,true),"Empty valid journal permits supervised demo authorization with both opt-ins");
 CHECK(!coinCoreDemoCanAuthorize(&j,false,true,true,true)&&!coinCoreDemoCanAuthorize(&j,true,false,true,true),"Production and missing backend permission retain manual authorization");
 CHECK(!coinCoreDemoCanAuthorize(&j,true,true,false,true)&&!coinCoreDemoCanAuthorize(&j,true,true,true,false),"Unhealthy storage or active pulse capture blocks demo startup");
 CHECK(coinCoreAppendDurably(&j,e,"AABBCCDDEEFF","0011223344556677",persist,&s),"P5 event is durably journaled");
 CHECK(j.events[0].amount==5&&j.events[0].transactionId==7,"P5 denomination and detected transaction retained");
 CHECK(!coinCoreDemoCanAuthorize(&j,true,true,true,true),"Pending durable events prevent demo rebinding and startup");
 CHECK(coinCoreAppendDurably(&j,event(7,10,2),"AABBCCDDEEFF","0011223344556677",persist,&s),"P10 consecutive event appended");
 CHECK(j.count==2&&j.events[0].amount==5&&j.events[1].amount==10,"Consecutive coin FIFO ordering");
 {StoredCoin head=j.events[0];CoinJournal before=j;int writes=s.writes;
  CHECK(!coinCoreAcknowledge(&j,&head,false,persist,&s)&&!memcmp(&j,&before,sizeof(j))&&s.writes==writes,"Wi-Fi/PHP unavailable or lost receipt never removes an event");
  CHECK(!coinCoreAcknowledge(&j,&j.events[1],true,persist,&s)&&j.count==2,"Out-of-order receipt cannot pop FIFO head");
  {StoredCoin wrong=head;wrong.transactionId=99;CHECK(!coinCoreAcknowledge(&j,&wrong,true,persist,&s),"Wrong transaction receipt rejected");wrong=head;wrong.amount=10;CHECK(!coinCoreAcknowledge(&j,&wrong,true,persist,&s),"Wrong amount receipt rejected");}
  CHECK(coinCoreStartBoot(&s.durable),"Restart validates and restores the durable journal");
  CHECK(!strcmp(s.durable.events[0].eventId,head.eventId)&&s.durable.events[0].transactionId==7,"Restart preserves immutable event ID and transaction");
  s.failWrite=s.writes+1;s.uncertainCommit=true;
  CHECK(!coinCoreAcknowledge(&j,&head,true,persist,&s)&&j.count==2&&!strcmp(j.events[0].eventId,head.eventId),"Uncertain acknowledgement persistence keeps RAM head for idempotent retry");
 }
 {CoinJournal before=emptyJournal(7);j=before;s=storeFor(j);s.failWrite=1;
  CHECK(!coinCoreAppendDurably(&j,e,"AABBCCDDEEFF","0011223344556677",persist,&s)&&!memcmp(&j,&before,sizeof(j)),"Failed append write cannot advance durable queue");
  CHECK(s.durable.count==0,"Failed pre-commit write leaves previous durable records unchanged");
 }
 {CapturedCoin queue[64],before[64];uint32_t head=0,count=0,i;memset(queue,0,sizeof(queue));
  for(i=0;i<64;i++)CHECK(coinCorePush(queue,head,&count,event(7,5,i+1)),"Capture FIFO accepts within capacity");
  memcpy(before,queue,sizeof(queue));CHECK(!coinCorePush(queue,head,&count,event(8,10,99))&&count==64&&!memcmp(before,queue,sizeof(queue)),"Overflow never overwrites an existing capture");
  CHECK(queue[0].transactionId==7&&queue[63].sequence==64,"Old captures are never reassigned to a new transaction");
 }
 j=emptyJournal(7);s=storeFor(j);
 CHECK(coinCoreAppendDurably(&j,event(7,7,1),"AABBCCDDEEFF","0011223344556677",persist,&s)&&j.events[0].amount==0&&j.events[0].requiresReview&&j.reconcile,"Unknown pulse count is retained for review, never guessed as valid money");
 CHECK(!coinCorePrepareBinding(&j,8)&&j.boundTransactionId==7,"New session blocked by unresolved coin evidence");
 {CapturedCoin orphan=event(0,5,1);j=emptyJournal(0);s=storeFor(j);CHECK(coinCoreAppendDurably(&j,orphan,"AABBCCDDEEFF","0011223344556677",persist,&s)&&j.events[0].requiresReview&&j.events[0].transactionId==0,"Orphan coin stays unassigned; no automatic new-customer credit");}
 {int failed;for(failed=1;failed<=3;failed++){int uncertain;for(uncertain=0;uncertain<=1;uncertain++){
    j=emptyJournal(7);s=storeFor(j);s.failWrite=failed;s.uncertainCommit=uncertain;
    CHECK(!coinCoreBindReviewed(&j,8,&io,&s),"Binding storage fault aborts before/during/after persistence");
    CHECK(!s.allowed&&s.owner==7&&s.fault&&j.reconcile&&coinCoreCaptureOwner(&j)==7,"Failed binding preserves previous capture owner and stays disabled");
    CHECK(coinCoreValid(&s.durable),"Power-loss durable snapshot is recognizable, not silently corrupted");
    CHECK(coinCoreStartBoot(&s.durable),"Interrupted binding snapshot can be inspected after restart");
    if(s.durable.bindingPhase==COIN_BIND_PREPARED)CHECK(s.durable.reconcile&&coinCoreCaptureOwner(&s.durable)==7,"Prepared binding recovery keeps original owner and requires reconciliation");
  }}}
 {int pulse;for(pulse=1;pulse<=3;pulse++){
   j=emptyJournal(7);s=storeFor(j);s.pulseWrite=pulse;
   CHECK(!coinCoreBindReviewed(&j,8,&io,&s)&&!s.allowed&&s.owner==7&&j.reconcile,"Pulse during binding interrupts authorization at every persistence boundary");
 }}
 j=emptyJournal(7);s=storeFor(j);
 CHECK(coinCoreBindReviewed(&j,8,&io,&s)&&j.boundTransactionId==8&&s.owner==8&&s.allowed,"Explicit reviewed binding commits consistently in RAM and NVS");
 CHECK(j.bindingFrom==7&&j.bindingTarget==8&&coinCoreValid(&s.durable),"Committed binding retains previous/target forensic identity");
 {CoinJournalV1 old;char id[80];memset(&old,0,sizeof(old));old.version=1;old.bootCounter=9;old.boundTransactionId=7;old.count=1;old.events[0].transactionId=7;old.events[0].pulses=5;old.events[0].amount=5;strcpy(old.events[0].eventId,"legacy-stable-event");strcpy(id,old.events[0].eventId);old.checksum=coinCoreHash(&old,offsetof(CoinJournalV1,checksum));
   CHECK(coinCoreUpgrade(&old,&j)&&j.count==1&&!strcmp(j.events[0].eventId,id)&&j.events[0].amount==5,"Legacy upgrade preserves unresolved event IDs, amounts and ownership");
   CHECK(old.version==1&&!strcmp(old.events[0].eventId,id),"Legacy source bytes are not modified by upgrade");
   old.checksum++;CHECK(!coinCoreUpgrade(&old,&j),"Corrupt legacy journal is not upgraded or reset");
 }
 j=emptyJournal(7);j.count=17;seal(&j);CHECK(!coinCoreValid(&j),"Invalid event count rejected despite matching checksum");
 j=emptyJournal(7);j.bindingPhase=99;seal(&j);CHECK(!coinCoreValid(&j),"Incompatible binding phase rejected");
 j=emptyJournal(7);j.bootCounter=UINT32_MAX;seal(&j);CHECK(!coinCoreStartBoot(&j)&&j.bootCounter==UINT32_MAX,"Boot counter never silently wraps");
 j=emptyJournal(7);j.overflowEvents=4;j.overflowPulses=20;j.reconcile=true;seal(&j);CHECK(coinCoreStartBoot(&j)&&j.overflowEvents==4&&j.overflowPulses==20&&j.reconcile,"Reboot preserves overflow evidence and reconciliation latch");
 j=emptyJournal(7);j.boundTransactionId=8;CHECK(!coinCoreValid(&j),"Journal integrity detects partial/corrupt writes");
 printf("%d portable firmware-core checks passed. No physical hardware or NVS used.\n",checks);return 0;
}
