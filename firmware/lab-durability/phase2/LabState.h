#pragma once
// LAB ONLY. Shared by firmware and native fault tests. No device/network services.
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include "CoinPaymentCore.h"
#include "CoinEventReviewCore.h"

namespace lab2 {
static constexpr uint32_t Schema=2, CreditLimit=8;
static constexpr int32_t Transaction=900182;
static constexpr const char *Keys[]={"init-intent","case-header","journal-v2","receiver-v2","review-archive","review-pointer"};
struct Header {
  uint32_t schema,complete,journalSize,receiverSize,archiveSize,pointerSize;
  char caseId[7],board[13],nonce[17];
  uint32_t checksum;
};
struct Receiver {
  uint32_t schema,context,sequence,count,total,dispensePending,hasLast;
  StoredCoin credits[CreditLimit],last;
  char reviewAck[33];
  uint32_t checksum;
};
struct Archive {uint32_t schema,context;CoinReviewArchive proof;uint32_t checksum;};
struct Pointer {uint32_t schema,context,phase,archiveChecksum;char reviewId[33];uint32_t checksum;};
enum {Waiting=1,Acknowledged=2};
struct State {Header intent,header;CoinJournal journal;Receiver receiver;Archive archive;Pointer pointer;bool archived,pointed;};
struct IO {
  virtual ~IO()=default;
  virtual bool exists(const char*)=0;
  virtual size_t length(const char*)=0;
  virtual bool read(const char*,void*,size_t)=0;
  // Must commit and read back exactly. Never normalize/erase on failure.
  virtual bool write(const char*,const void*,size_t)=0;
};
enum class Result {OK,AlreadyDone,Rejected,Blocked};
inline bool text(const char *s,size_t cap,size_t required=0) {
  for(size_t i=0;i<cap;i++)if(!s[i])return required?i==required:true;
  return false;
}
inline bool zeroText(const char *s,size_t n){for(size_t i=0;i<n;i++)if(s[i])return false;return true;}
inline bool hexText(const char *s,size_t n){if(!text(s,n+1,n))return false;for(size_t i=0;i<n;i++)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='A'&&s[i]<='F')))return false;return true;}
inline bool caseText(const char *s){if(!text(s,7)||!s[0])return false;for(size_t i=0;s[i];i++)if(!((s[i]>='a'&&s[i]<='z')||(s[i]>='0'&&s[i]<='9')))return false;return true;}
inline uint32_t hash(const void *p,size_t n){return coinCoreHash(p,n);}
template<class T> inline void seal(T &r){r.checksum=hash(&r,offsetof(T,checksum));}
template<class T> inline bool sealed(const T &r){return r.checksum==hash(&r,offsetof(T,checksum));}
inline uint32_t parseHex8(const char *p){uint32_t v=0;for(unsigned i=0;i<8;i++){char c=p[i];if(!((c>='0'&&c<='9')||(c>='A'&&c<='F')))return 0;v=(v<<4)|(c<='9'?c-'0':c-'A'+10);}return v;}
inline bool sameHeader(const Header&a,const Header&b){return a.schema==b.schema&&a.journalSize==b.journalSize&&a.receiverSize==b.receiverSize&&a.archiveSize==b.archiveSize&&a.pointerSize==b.pointerSize&&!strcmp(a.caseId,b.caseId)&&!strcmp(a.board,b.board)&&!strcmp(a.nonce,b.nonce);}
inline bool validHeader(const Header &h){return sealed(h)&&h.schema==Schema&&h.journalSize==sizeof(CoinJournal)&&h.receiverSize==sizeof(Receiver)&&h.archiveSize==sizeof(Archive)&&h.pointerSize==sizeof(Pointer)&&caseText(h.caseId)&&hexText(h.board,12)&&hexText(h.nonce,16);}
inline bool validEvent(const State&s,const StoredCoin&e,bool reviewAllowed=true){
  // This bounds every string/boolean before strcmp, indexing or other typed use.
  if(!coinCoreEventsValid(&e,1,false)||e.transactionId!=Transaction||e.pulses!=5||e.amount!=5||(!reviewAllowed&&e.requiresReview)||strlen(e.eventId)!=52)return false;
  if(strncmp(e.eventId,"coin-",5)||strncmp(e.eventId+5,s.header.board,12)||e.eventId[17]!='-'||e.eventId[26]!='-'||strncmp(e.eventId+27,s.header.nonce,16)||e.eventId[43]!='-')return false;
  uint32_t boot=parseHex8(e.eventId+18),sequence=parseHex8(e.eventId+44);
  return boot&&boot<=s.journal.bootCounter&&sequence&&sequence<=s.receiver.sequence;
}
inline bool emptyEvent(const StoredCoin&e){return e.transactionId==0&&e.pulses==0&&e.amount==0&&reinterpret_cast<const uint8_t*>(&e)[offsetof(StoredCoin,requiresReview)]==0&&zeroText(e.eventId,sizeof(e.eventId));}
inline void expectedReviewId(const State&s,char (&id)[33]){memcpy(id,s.header.nonce,16);memcpy(id+16,s.header.nonce,16);id[32]=0;}
inline const char *consistent(const State&s){
  if(!validHeader(s.intent)||!validHeader(s.header)||s.intent.complete!=0||s.header.complete!=1||!sameHeader(s.intent,s.header))return "HEADER_OR_INCOMPLETE_INITIALIZATION";
  const auto &j=s.journal;const auto&r=s.receiver;
  if(!coinCoreValid(&j)||!j.bootCounter||j.boundTransactionId!=Transaction||j.bindingFrom!=Transaction||j.bindingTarget!=Transaction||j.bindingPhase!=COIN_BIND_STABLE||j.overflowEvents||j.overflowPulses)return "JOURNAL_INVALID";
  if(!sealed(r)||r.schema!=Schema||r.context!=s.intent.checksum||r.count>CreditLimit||r.total!=r.count*5||r.dispensePending>1||r.hasLast>1||!text(r.reviewAck,sizeof(r.reviewAck)))return "RECEIVER_INVALID";
  uint32_t previous=0;
  for(uint32_t i=0;i<r.count;i++){
    if(!validEvent(s,r.credits[i],false))return "CREDIT_INVALID";
    uint32_t sequence=parseHex8(r.credits[i].eventId+44);
    if(sequence<=previous)return "CREDIT_ORDER_OR_DUPLICATE";
    previous=sequence;
  }
  if(!r.count){if(r.hasLast||!emptyEvent(r.last))return "UNBACKED_LAST_RECEIPT";}
  else if(!r.hasLast||!validEvent(s,r.last,false)||!coinReviewSameEvent(&r.last,&r.credits[r.count-1]))return "LAST_RECEIPT_MISMATCH";
  uint32_t queueSequence=0;
  for(uint32_t i=0;i<j.count;i++){
    if(!validEvent(s,j.events[i]))return "QUEUE_EVENT_INVALID";
    uint32_t sequence=parseHex8(j.events[i].eventId+44);
    if(sequence<=queueSequence)return "QUEUE_ORDER_INVALID";
    queueSequence=sequence;
    if(j.events[i].requiresReview&&!j.reconcile)return "REVIEW_LATCH_MISSING";
    // A credited event can remain queued only as the original unacknowledged head.
    if(r.count&&sequence<=previous){if(i||!coinReviewSameEvent(&j.events[i],&r.last))return "ACKNOWLEDGED_EVENT_REAPPEARED";}
  }
  if(!s.archived){if(s.pointed||r.reviewAck[0])return "REVIEW_EVIDENCE_MISSING";return nullptr;}
  const auto &a=s.archive;
  if(!sealed(a)||a.schema!=Schema||a.context!=s.intent.checksum||!validEvent(s,a.proof.original)||!coinReviewArchiveValid(&a.proof)||!a.proof.original.requiresReview||!j.reconcile)return "ARCHIVE_INVALID";
  char id[33];expectedReviewId(s,id);
  if(strcmp(id,a.proof.reviewId))return "ARCHIVE_CASE_MISMATCH";
  bool queued=false;
  for(uint32_t i=0;i<j.count;i++)if(!strcmp(j.events[i].eventId,a.proof.original.eventId)){
    if(i||!coinReviewSameEvent(&j.events[i],&a.proof.original))return "ARCHIVE_HEAD_MISMATCH";queued=true;
  }
  if(r.reviewAck[0]&&(!text(r.reviewAck,sizeof(r.reviewAck),32)||strcmp(r.reviewAck,id)||queued))return "REVIEW_RECEIPT_MISMATCH";
  if(!s.pointed){if(!queued||r.reviewAck[0])return "POINTER_MISSING_AFTER_ADVANCE";return nullptr;}
  const auto &p=s.pointer;
  if(!sealed(p)||p.schema!=Schema||p.context!=s.intent.checksum||!text(p.reviewId,sizeof(p.reviewId),32)||strcmp(p.reviewId,id)||p.archiveChecksum!=a.checksum||(p.phase!=Waiting&&p.phase!=Acknowledged))return "POINTER_INVALID";
  if(p.phase==Acknowledged&&(queued||!r.reviewAck[0]))return "POINTER_ACK_WITHOUT_RECEIPT";
  return nullptr;
}

class Engine {
  IO &io;
  State scratch={};
  bool readExact(const char*k,void*p,size_t n){return io.exists(k)&&io.length(k)==n&&io.read(k,p,n);}
  bool put(const char*k,const void*p,size_t n){if(!io.write(k,p,n)){block("STORAGE_COMMIT_OR_READBACK_FAILED");return false;}return true;}
  bool receiverWrite(){seal(state.receiver);return put(Keys[3],&state.receiver,sizeof(state.receiver));}
  bool pointerWrite(){seal(state.pointer);return put(Keys[5],&state.pointer,sizeof(state.pointer));}
  static bool journalCallback(CoinJournal*j,void*c){auto&e=*static_cast<Engine*>(c);j->checksum=coinCoreChecksum(j);if(!coinCoreValid(j)){e.block("JOURNAL_WRITE_REFUSED");return false;}return e.put(Keys[2],j,sizeof(*j));}
  static bool archiveCallback(const CoinReviewArchive*a,void*c){
    auto&e=*static_cast<Engine*>(c);
    if(e.state.archived){if(memcmp(&e.state.archive.proof,a,sizeof(*a))){e.block("IMMUTABLE_ARCHIVE_CONFLICT");return false;}}
    else {e.state.archive={};e.state.archive.schema=Schema;e.state.archive.context=e.state.intent.checksum;e.state.archive.proof=*a;seal(e.state.archive);
      if(!e.put(Keys[4],&e.state.archive,sizeof(e.state.archive)))return false;e.state.archived=true;}
    if(!e.state.pointed){e.state.pointer={};e.state.pointer.schema=Schema;e.state.pointer.context=e.state.intent.checksum;e.state.pointer.phase=Waiting;e.state.pointer.archiveChecksum=e.state.archive.checksum;memcpy(e.state.pointer.reviewId,a->reviewId,33);
      if(!e.pointerWrite())return false;e.state.pointed=true;}
    return true;
  }
  bool guard(){if(!healthy)return false;if(!load(expectedCase,expectedBoard))return false;if(state.receiver.dispensePending){reason="DISPENSE_PENDING_NO_RETRY";return false;}return true;}
  Result rejected(const char*r){reason=r;return healthy?Result::Rejected:Result::Blocked;}
  Result done(const char*r,Result result=Result::OK){reason=r;return result;}
public:
  State state={};bool healthy=false;const char *reason="CASE_NOT_OPEN";
  char expectedCase[7]={},expectedBoard[13]={};
  explicit Engine(IO &store):io(store){}
  void block(const char*r){healthy=false;reason=r;}
  bool load(const char*caseId,const char*board){
    healthy=false;
    if(!caseText(caseId)||!hexText(board,12)){reason="BAD_CASE_OR_BOARD";return false;}
    // Use scratch for validation, so a malformed load never becomes live RAM state.
    memset(&scratch,0,sizeof(scratch));
    if(!readExact(Keys[0],&scratch.intent,sizeof(Header))||!readExact(Keys[1],&scratch.header,sizeof(Header))||!readExact(Keys[2],&scratch.journal,sizeof(CoinJournal))||!readExact(Keys[3],&scratch.receiver,sizeof(Receiver))){reason="MISSING_OR_SHORT_MANDATORY_RECORD";return false;}
    if(!validHeader(scratch.header)||strcmp(scratch.header.caseId,caseId)||strcmp(scratch.header.board,board)){reason="HEADER_CASE_BOARD_OR_ABI";return false;}
    scratch.archived=io.exists(Keys[4]);scratch.pointed=io.exists(Keys[5]);
    if((scratch.archived&&!readExact(Keys[4],&scratch.archive,sizeof(Archive)))||(scratch.pointed&&!readExact(Keys[5],&scratch.pointer,sizeof(Pointer)))){reason="SHORT_REVIEW_RECORD";return false;}
    if(const char*r=consistent(scratch)){reason=r;return false;}
    memcpy(&state,&scratch,sizeof(state));memmove(expectedCase,caseId,strlen(caseId)+1);memmove(expectedBoard,board,13);healthy=true;reason="VALIDATED";return true;
  }
  Result initialize(const char*caseId,const char*board,const char*nonce){
    healthy=false;if(!caseText(caseId)||!hexText(board,12)||!hexText(nonce,16))return rejected("BAD_INITIALIZATION_INPUT");
    for(const char*k:Keys)if(io.exists(k))return rejected("EXISTING_CASE_NOT_REPLACED");
    memset(&state,0,sizeof(state));auto&h=state.intent;
    h.schema=Schema;h.complete=0;h.journalSize=sizeof(CoinJournal);h.receiverSize=sizeof(Receiver);h.archiveSize=sizeof(Archive);h.pointerSize=sizeof(Pointer);
    memcpy(h.caseId,caseId,strlen(caseId)+1);memcpy(h.board,board,13);memcpy(h.nonce,nonce,17);seal(h);
    auto&j=state.journal;j.version=2;j.boundTransactionId=Transaction;j.bindingFrom=Transaction;j.bindingTarget=Transaction;j.bootCounter=1;j.checksum=coinCoreChecksum(&j);
    state.receiver.schema=Schema;state.receiver.context=h.checksum;seal(state.receiver);
    state.header=h;state.header.complete=1;seal(state.header);
    if(!put(Keys[0],&h,sizeof(h))||!put(Keys[3],&state.receiver,sizeof(Receiver))||!put(Keys[2],&j,sizeof(j))||!put(Keys[1],&state.header,sizeof(Header)))return Result::Blocked;
    if(!load(caseId,board))return Result::Blocked;return done("INITIALIZED_EXPLICITLY");
  }
  Result resume(){if(!healthy)return rejected(reason);if(!coinCoreStartBoot(&state.journal)){block("BOOT_COUNTER_OR_JOURNAL");return Result::Blocked;}
    if(!journalCallback(&state.journal,this))return Result::Blocked;return done("RESUMED_BOOT_PERSISTED");}
  Result append(bool review){
    if(!guard())return rejected(reason);
    if(state.journal.count>=16||state.receiver.sequence==UINT32_MAX)return rejected("CAPACITY_OR_SEQUENCE_LIMIT");
    state.receiver.sequence++;if(!receiverWrite())return Result::Blocked;
    CapturedCoin event={Transaction,5,state.receiver.sequence,!review};
    if(!coinCoreAppendDurably(&state.journal,event,expectedBoard,state.header.nonce,journalCallback,this))return rejected("APPEND_NOT_CONFIRMED");
    return done("EVENT_COMMIT_READBACK_CONFIRMED");
  }
  Result credit(){
    if(!guard())return rejected(reason);auto&j=state.journal;auto&r=state.receiver;
    if(!j.count)return rejected("EMPTY_QUEUE");const StoredCoin &head=j.events[0];
    if(head.requiresReview)return rejected("HEAD_REQUIRES_REVIEW_NO_CREDIT");
    for(uint32_t i=0;i<r.count;i++)if(!strcmp(r.credits[i].eventId,head.eventId)){
      if(!coinReviewSameEvent(&r.credits[i],&head)||!coinReviewSameEvent(&r.last,&head)){block("CREDIT_PAYLOAD_CONFLICT");return Result::Blocked;}
      return done("EXISTING_CREDIT_NO_WRITE",Result::AlreadyDone);
    }
    if(r.count==CreditLimit)return rejected("CREDIT_CAPACITY");r.credits[r.count++]=head;r.total+=5;r.last=head;r.hasLast=1;
    if(!receiverWrite())return Result::Blocked;return done("SYNTHETIC_RECEIVER_COMMIT_CONFIRMED");
  }
  Result acknowledge(){
    if(!guard())return rejected(reason);auto&j=state.journal;auto&r=state.receiver;
    if(!r.hasLast)return rejected("NO_DURABLE_RECEIPT");
    if(!j.count)return done("RECEIPT_ALREADY_APPLIED",Result::AlreadyDone);
    if(!coinReviewSameEvent(&j.events[0],&r.last))return rejected("RECEIPT_NOT_CURRENT_HEAD");
    if(!coinCoreAcknowledge(&j,&r.last,true,journalCallback,this))return rejected("ACK_NOT_CONFIRMED");
    return done("HEAD_ACK_COMMIT_CONFIRMED");
  }
  Result review(){
    if(!guard())return rejected(reason);auto&j=state.journal;
    if(state.archived){
      bool queued=false;for(uint32_t i=0;i<j.count;i++)if(!strcmp(j.events[i].eventId,state.archive.proof.original.eventId))queued=true;
      if(!queued)return done("ORIGINAL_ALREADY_ARCHIVED_NO_ADVANCE",Result::AlreadyDone);
    }
    if(!j.count)return rejected("EMPTY_QUEUE");if(!j.events[0].requiresReview)return rejected("HEAD_NOT_REVIEW_REQUIRED");
    CoinReviewArchive a={};
    if(state.archived)a=state.archive.proof;
    else {a.version=1;a.original=j.events[0];expectedReviewId(state,a.reviewId);memset(a.nonce,'C',32);memset(a.challenge,'D',32);memset(a.archiveHash,'E',64);memset(a.signature,'F',64);a.checksum=coinReviewChecksum(&a);}
    if(!coinReviewApply(&j,&a,true,true,archiveCallback,journalCallback,this))return rejected("REVIEW_NOT_CONFIRMED");
    return done("SYNTHETIC_REVIEW_COMMITTED_KEEP_BLOCKED");
  }
  Result reviewAck(){
    if(!guard())return rejected(reason);
    if(!state.archived||!state.pointed)return rejected("ARCHIVE_OR_POINTER_MISSING");
    for(uint32_t i=0;i<state.journal.count;i++)if(!strcmp(state.journal.events[i].eventId,state.archive.proof.original.eventId))return rejected("ORIGINAL_STILL_QUEUED");
    if(state.pointer.phase==Acknowledged)return done("REVIEW_RECEIPT_ALREADY_APPLIED",Result::AlreadyDone);
    if(!state.receiver.reviewAck[0]){memcpy(state.receiver.reviewAck,state.archive.proof.reviewId,33);if(!receiverWrite())return Result::Blocked;}
    state.pointer.phase=Acknowledged;if(!pointerWrite())return Result::Blocked;
    return done("REVIEW_RECEIPT_COMMITTED_ARCHIVE_RETAINED");
  }
  Result markDispense(){if(!guard())return rejected(reason);state.receiver.dispensePending=1;if(!receiverWrite())return Result::Blocked;return done("SYNTHETIC_DISPENSE_PENDING_NO_ACTUATION");}
};
} // namespace lab2
