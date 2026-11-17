#include "ControllerFaultResolutionCore.h"
#include <cassert>
#include <cstdlib>
#include <iostream>
using namespace cfr;
static unsigned tests=0;
#define CHECK(x) do { if (!(x)) { std::cerr<<"FAIL line "<<__LINE__<<"\n"; std::abort(); } } while(false)
struct Disk {
  Record record={}; Evidence live={}; unsigned writes=0,journalWrites=0;
  int failPhase=0; bool commitFailure=false,failJournal=false,injectFault=false;
};
static bool store(const Record& r,void* v) {
  auto& d=*static_cast<Disk*>(v); ++d.writes;
  const bool fail=d.failPhase==static_cast<int>(r.phase);
  if (!fail||d.commitFailure) d.record=r;
  return !fail;
}
static bool journal(const Authorization& a,void* v) {
  auto& d=*static_cast<Disk*>(v); ++d.journalWrites;
  if (!d.failJournal||d.commitFailure) {
    d.live.latch=false; std::strcpy(d.live.journal,a.after);
  }
  if (d.injectFault) d.live.readerFault=true;
  return !d.failJournal;
}
static bool observe(Evidence& e,void* v) { e=static_cast<Disk*>(v)->live; return true; }
static Authorization auth() {
  Authorization a={};
  std::memset(a.decision,'a',32); std::strcpy(a.device,"AABBCCDDEEFF");
  std::strcpy(a.machine,"SYNTHETIC-MACHINE"); std::strcpy(a.event,"synthetic-event-2");
  std::memset(a.archive,'b',64); std::memset(a.before,'c',64); std::memset(a.after,'d',64);
  std::memset(a.nonce,'e',32); a.transaction=900001; a.boot=7; a.generation=4;a.fence=12;a.expires=100;
  return a;
}
static Disk disk() {
  Disk d; d.live.binding=auth(); d.live.now=50;
  d.live.journalValid=d.live.archiveAcknowledged=d.live.accountingReviewed=d.live.isolated=true;
  d.live.motorsStopped=d.live.emptyQueues=d.live.quiet=d.live.storageHealthy=d.live.bindingStable=true;
  d.live.latch=true;std::strcpy(d.live.journal,d.live.binding.before); return d;
}
static IO io(Disk& d) { return {store,journal,observe,&d}; }
static Record prepared(Disk& d) {
  Record r={};CHECK(prepare(true,auth(),true,d.live,r,false,io(d))==Result::Prepared);return r;
}
static void done(const char* name) { ++tests;std::cout<<"PASS "<<name<<"\n"; }
int main() {
  {
    auto d=disk();Record r={};CHECK(prepare(false,auth(),true,d.live,r,false,io(d))==Result::Disabled);
    CHECK(!d.writes&&hold());done("disabled default policy");
  }
  {
    char text[768];CHECK(canonical(auth(),false,text,sizeof text));
    CHECK(std::strstr(text,"cfr-auth-v1|")==text); CHECK(std::strstr(text,"|residual-legacy-latch|keep-held"));
    CHECK(canonical(auth(),true,text,sizeof text));CHECK(std::strstr(text,"|applied|keep-held"));
    CHECK(!canonical(auth(),false,text,10));auto a=auth();a.event[0]='|';CHECK(!valid(a));
    done("canonical domains and bounds");
  }
  for (int bad=0;bad<19;++bad) {
    auto d=disk();auto a=auth();Record r={};bool signature=true;
    switch(bad) {
      case 0:signature=false;break; case 1:d.live.now=100;break;
      case 2:d.live.binding.device[0]='B';break;case 3:++d.live.binding.transaction;break;
      case 4:++d.live.binding.boot;break;case 5:++d.live.binding.generation;break;
      case 6:++d.live.binding.fence;break;case 7:d.live.readerFault=true;break;
      case 8:d.live.emptyQueues=false;break;case 9:d.live.storageHealthy=false;break;
      case 10:d.live.bootReview=true;break;case 11:d.live.overflow=true;break;
      case 12:d.live.incompletePulses=true;break;case 13:d.live.bindingStable=false;break;
      case 14:d.live.archiveAcknowledged=false;break;case 15:d.live.accountingReviewed=false;break;
      case 16:d.live.unrelatedFault=true;break;case 17:d.live.journal[0]='a';break;
      case 18:d.live.isolated=false;break;
    }
    CHECK(prepare(true,a,signature,d.live,r,false,io(d))==Result::Rejected);CHECK(!d.writes);
  }
  done("19 invalid authorization and safety cases");
  for(int change=0;change<4;++change) {
    auto d=disk();auto r=prepared(d);
    if(change==0) d.live.emptyQueues=false;
    if(change==1) ++d.live.binding.fence;
    if(change==2) ++d.live.binding.generation;
    if(change==3) d.live.incompletePulses=true;
    CHECK(apply(true,r,io(d))==Result::Rejected);CHECK(!d.journalWrites&&hold());
  }
  done("new events activity and faults after preparation");
  for (int phase=1;phase<=3;++phase) for (bool committed:{false,true}) {
    auto d=disk();Record r={};
    if (phase>1) r=prepared(d);
    if (phase>2) CHECK(apply(true,r,io(d))==Result::Applied);
    d.failPhase=phase;d.commitFailure=committed;
    Result result= phase==1?prepare(true,auth(),true,d.live,r,false,io(d)):
      phase==2?apply(true,r,io(d)):acknowledge(true,r,auth(),true,d.live,io(d));
    CHECK(result==Result::StorageUnconfirmed);CHECK(hold());
    if(phase==1) CHECK(!d.journalWrites);
    d.failPhase=0;r=d.record; // Reconstruct RAM from persisted synthetic evidence.
    if(valid(r)) {
      if(r.phase==Phase::Prepared) CHECK(apply(true,r,io(d))==Result::Applied);
      const Result expected=r.phase==Phase::Acknowledged?Result::AlreadyDone:Result::Acknowledged;
      CHECK(acknowledge(true,r,auth(),true,d.live,io(d))==expected);
      CHECK(hold());
    } else CHECK(apply(true,r,io(d))==Result::Rejected);
  }
  done("six phase persistence interruptions and retries");
  for (bool committed:{false,true}) {
    auto d=disk();auto r=prepared(d);d.failJournal=true;d.commitFailure=committed;
    CHECK(apply(true,r,io(d))==Result::StorageUnconfirmed);CHECK(r.phase==Phase::Prepared&&hold());
    d.failJournal=false;CHECK(apply(true,r,io(d))==Result::Applied);
    CHECK(d.journalWrites==(committed?1u:2u));
  }
  done("journal before commit and lost readback");
  {
    auto d=disk();auto r=prepared(d);++d.live.binding.boot;
    CHECK(apply(true,r,io(d))==Result::Rejected&&d.journalWrites==0);
    done("prepared reboot blocks application");
  }
  {
    auto d=disk();auto r=prepared(d);d.injectFault=true;
    CHECK(apply(true,r,io(d))==Result::Rejected);CHECK(r.phase==Phase::Prepared&&hold());
    done("new fault during journal write");
  }
  {
    auto d=disk();auto r=prepared(d);CHECK(apply(true,r,io(d))==Result::Applied);
    const auto writes=d.writes;CHECK(apply(true,r,io(d))==Result::AlreadyDone);CHECK(writes==d.writes);
    CHECK(acknowledge(true,r,auth(),false,d.live,io(d))==Result::Rejected);
    ++d.live.binding.boot;d.live.now=200;
    CHECK(acknowledge(true,r,auth(),true,d.live,io(d))==Result::Acknowledged);
    CHECK(acknowledge(true,r,auth(),true,d.live,io(d))==Result::AlreadyDone);
    auto wrong=auth();wrong.nonce[0]='f';CHECK(acknowledge(true,r,wrong,true,d.live,io(d))==Result::Rejected);
    d.live.readerFault=true;CHECK(acknowledge(true,r,auth(),true,d.live,io(d))==Result::Rejected);
    CHECK(hold());done("lost ack reboot expiry replay and permanent hold");
  }
  {
    auto d=disk();auto r=prepared(d);auto other=auth();other.decision[0]='f';
    CHECK(prepare(true,other,true,d.live,r,true,io(d))==Result::Rejected);
    CHECK(prepare(true,auth(),true,d.live,r,true,io(d))==Result::AlreadyDone);
    for(size_t offset=0;offset<sizeof r;++offset) {
      Record corrupt=r;reinterpret_cast<unsigned char*>(&corrupt)[offset]^=0x80;
      // Padding is intentionally excluded from the canonical integrity checksum.
      if (!valid(corrupt)) CHECK(apply(true,corrupt,io(d))==Result::Rejected);
    }
    Record missing={};CHECK(apply(true,missing,io(d))==Result::Rejected);
    done("conflicting decisions corrupt and missing records");
  }
  {
    auto d=disk();auto r=prepared(d);
    std::strcpy(d.live.journal,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    CHECK(apply(true,r,io(d))==Result::Rejected);CHECK(!d.journalWrites);
    r.checksum^=1;CHECK(apply(true,r,io(d))==Result::Rejected);
    CHECK(hold());done("unexpected journal and corrupt durable checksum");
  }
  std::cout<<"SUMMARY groups="<<tests<<" failed=0 hardware=NOT_EXECUTED\n";
}
