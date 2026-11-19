// Synthetic only. Compile/run on an approved native Linux runner, including ASan/UBSan.
#include <map>
#include <vector>
#include <string>
#include <stdexcept>
#include <cstdlib>
#include "LabState.h"
static unsigned checks=0;
#define CHECK(x) do{++checks;if(!(x)){fprintf(stderr,"FAIL line %d: %s\n",__LINE__,#x);exit(1);}}while(0)
struct Cut{};
struct Memory:lab2::IO{
  std::map<std::string,std::vector<uint8_t>> data;
  unsigned writes=0,cut=0;int mode=0;
  bool exists(const char*k)override{return data.count(k)!=0;}
  size_t length(const char*k)override{return exists(k)?data.at(k).size():0;}
  bool read(const char*k,void*p,size_t n)override{if(length(k)!=n)return false;memcpy(p,data.at(k).data(),n);return true;}
  bool write(const char*k,const void*p,size_t n)override{
    ++writes;bool fault=cut&&writes==cut;
    if(fault&&mode==0)throw Cut{}; // before write
    if(fault&&mode==3)return false; // ordinary API failure, nothing committed
    const uint8_t*b=static_cast<const uint8_t*>(p);
    data[k]=std::vector<uint8_t>(b,b+(fault&&mode==2?n/2:n));
    if(fault&&mode==4)return false; // durable write, failed confirmation
    if(fault)throw Cut{}; // mode1 durable commit, lost response; mode2 torn write
    return true;
  }
  template<class T>T get(const char*k){T t={};CHECK(read(k,&t,sizeof(t)));return t;}
  template<class T>void set(const char*k,const T&t){const uint8_t*b=reinterpret_cast<const uint8_t*>(&t);data[k]={b,b+sizeof(t)};}
};
static constexpr auto Board="20799D470968",Case="test1",Nonce="0011223344556677";
static Memory fresh(){Memory m;lab2::Engine e(m);CHECK(e.initialize(Case,Board,Nonce)==lab2::Result::OK);return m;}
static void open(lab2::Engine&e){CHECK(e.load(Case,Board));}
static void basic(){
  auto m=fresh();lab2::Engine e(m);open(e);unsigned w=m.writes;
  CHECK(e.review()==lab2::Result::Rejected);CHECK(e.reviewAck()==lab2::Result::Rejected);CHECK(e.acknowledge()==lab2::Result::Rejected);CHECK(m.writes==w);
  CHECK(e.append(false)==lab2::Result::OK);std::string first=e.state.journal.events[0].eventId;
  CHECK(e.append(false)==lab2::Result::OK);std::string second=e.state.journal.events[1].eventId;CHECK(first!=second);
  CHECK(e.credit()==lab2::Result::OK);w=m.writes;CHECK(e.credit()==lab2::Result::AlreadyDone);CHECK(m.writes==w);CHECK(e.state.receiver.total==5);
  CHECK(e.acknowledge()==lab2::Result::OK);CHECK(second==e.state.journal.events[0].eventId);
  w=m.writes;CHECK(e.acknowledge()==lab2::Result::Rejected);CHECK(m.writes==w);CHECK(e.state.journal.count==1);
  lab2::Engine reboot(m);open(reboot);CHECK(reboot.resume()==lab2::Result::OK);CHECK(second==reboot.state.journal.events[0].eventId);
  CHECK(reboot.credit()==lab2::Result::OK);CHECK(reboot.acknowledge()==lab2::Result::OK);CHECK(reboot.state.receiver.total==10);
  CHECK(reboot.acknowledge()==lab2::Result::AlreadyDone);
  auto n=fresh();lab2::Engine other(n);CHECK(!other.load(Case,"2C8C6AF3AF48"));
  Memory different;lab2::Engine d(different);CHECK(d.initialize(Case,Board,"1011223344556677")==lab2::Result::OK);CHECK(d.append(false)==lab2::Result::OK);CHECK(first!=d.state.journal.events[0].eventId);
}
static void review(){
  auto m=fresh();lab2::Engine e(m);open(e);CHECK(e.append(true)==lab2::Result::OK);CHECK(e.append(true)==lab2::Result::OK);
  std::string second=e.state.journal.events[1].eventId;
  CHECK(e.credit()==lab2::Result::Rejected);CHECK(e.reviewAck()==lab2::Result::Rejected);
  CHECK(e.review()==lab2::Result::OK);CHECK(e.state.receiver.total==0);CHECK(e.state.journal.count==1);CHECK(second==e.state.journal.events[0].eventId);
  unsigned w=m.writes;CHECK(e.review()==lab2::Result::AlreadyDone);CHECK(m.writes==w);CHECK(e.state.journal.count==1);
  CHECK(e.reviewAck()==lab2::Result::OK);w=m.writes;CHECK(e.reviewAck()==lab2::Result::AlreadyDone);CHECK(m.writes==w);
  lab2::Engine reboot(m);open(reboot);CHECK(reboot.state.pointed&&reboot.state.archived);CHECK(reboot.state.pointer.phase==lab2::Acknowledged);CHECK(reboot.state.journal.reconcile);
}
static void initializationCuts(){
  for(int mode=0;mode<3;mode++)for(unsigned point=1;point<=4;point++){
    Memory m;m.cut=point;m.mode=mode;lab2::Engine e(m);try{e.initialize(Case,Board,Nonce);CHECK(false);}catch(Cut&){}
    m.cut=0;unsigned w=m.writes;auto bytes=m.data;lab2::Engine reboot(m);bool valid=reboot.load(Case,Board);CHECK(m.writes==w);CHECK(m.data==bytes);
    CHECK(valid==(mode==1&&point==4));
    if(!valid&&m.exists(lab2::Keys[0])){CHECK(reboot.initialize(Case,Board,Nonce)==lab2::Result::Blocked);CHECK(m.writes==w);}
  }
}
enum Operation{Append,Credit,Ack,Review,ReviewAck,Resume};
static lab2::Result perform(lab2::Engine&e,Operation op){switch(op){case Append:return e.append(false);case Credit:return e.credit();case Ack:return e.acknowledge();case Review:return e.review();case ReviewAck:return e.reviewAck();default:return e.resume();}}
static Memory setup(Operation op){auto m=fresh();lab2::Engine e(m);open(e);
  if(op==Credit||op==Ack){CHECK(e.append(false)==lab2::Result::OK);CHECK(e.append(false)==lab2::Result::OK);if(op==Ack)CHECK(e.credit()==lab2::Result::OK);}
  if(op==Review||op==ReviewAck){CHECK(e.append(true)==lab2::Result::OK);CHECK(e.append(true)==lab2::Result::OK);if(op==ReviewAck)CHECK(e.review()==lab2::Result::OK);}
  return m;
}
static void operationCuts(){
  for(auto op:{Append,Credit,Ack,Review,ReviewAck,Resume}){
    auto source=setup(op);Memory control=source;lab2::Engine ok(control);open(ok);unsigned before=control.writes;CHECK(perform(ok,op)==lab2::Result::OK);unsigned count=control.writes-before;
    for(int mode=0;mode<3;mode++)for(unsigned point=1;point<=count;point++){
      Memory m=source;lab2::Engine e(m);open(e);m.mode=mode;m.cut=m.writes+point;
      try{perform(e,op);CHECK(false);}catch(Cut&){}
      m.cut=0;unsigned w=m.writes;auto bytes=m.data;lab2::Engine reboot(m);bool valid=reboot.load(Case,Board);CHECK(m.writes==w);CHECK(bytes==m.data);
      if(mode==2){CHECK(!valid);continue;}CHECK(valid);
      if(op==Credit){auto expected=reboot.state.receiver.count?lab2::Result::AlreadyDone:lab2::Result::OK;CHECK(reboot.credit()==expected);CHECK(reboot.state.receiver.total==5);}
      if(op==Ack){std::string next=source.get<CoinJournal>(lab2::Keys[2]).events[1].eventId;if(reboot.state.journal.count==2)CHECK(reboot.acknowledge()==lab2::Result::OK);CHECK(reboot.state.journal.count==1);CHECK(next==reboot.state.journal.events[0].eventId);CHECK(reboot.acknowledge()==lab2::Result::Rejected);}
      if(op==Review){if(reboot.state.journal.count==2)CHECK(reboot.review()==lab2::Result::OK);CHECK(reboot.state.journal.count==1);CHECK(reboot.state.receiver.total==0);CHECK(reboot.reviewAck()==lab2::Result::OK);}
      if(op==ReviewAck){auto r=reboot.reviewAck();CHECK(r==lab2::Result::OK||r==lab2::Result::AlreadyDone);CHECK(reboot.state.pointer.phase==lab2::Acknowledged);}
      if(op==Append)CHECK(reboot.state.journal.count<=1&&reboot.state.receiver.total==0);
    }
  }
}
static void corruption(){
  auto source=setup(ReviewAck);
  for(const char*k:lab2::Keys){if(!source.exists(k))continue;auto m=source;m.data[k][0]^=0x80;unsigned w=m.writes;auto bytes=m.data;lab2::Engine e(m);CHECK(!e.load(Case,Board));CHECK(m.data==bytes&&m.writes==w);}
  auto m=setup(Ack);auto r=m.get<lab2::Receiver>(lab2::Keys[3]);r.last.amount=10;lab2::seal(r);m.set(lab2::Keys[3],r);lab2::Engine e(m);CHECK(!e.load(Case,Board));
  auto n=source;auto p=n.get<lab2::Pointer>(lab2::Keys[5]);p.phase=lab2::Acknowledged;lab2::seal(p);n.set(lab2::Keys[5],p);lab2::Engine b(n);CHECK(!b.load(Case,Board));
  auto z=source;z.data[lab2::Keys[4]].resize(2);lab2::Engine c(z);CHECK(!c.load(Case,Board));
  auto v=source;auto a=v.get<lab2::Archive>(lab2::Keys[4]);reinterpret_cast<uint8_t*>(&a.proof.original)[offsetof(StoredCoin,requiresReview)]=2;lab2::seal(a);v.set(lab2::Keys[4],a);lab2::Engine d(v);CHECK(!d.load(Case,Board));
}
static void repeated(){auto m=fresh();for(unsigned i=0;i<8;i++){lab2::Engine e(m);open(e);CHECK(e.resume()==lab2::Result::OK);CHECK(e.append(false)==lab2::Result::OK);CHECK(e.credit()==lab2::Result::OK);CHECK(e.acknowledge()==lab2::Result::OK);CHECK(e.state.receiver.total==(i+1)*5);}lab2::Engine e(m);open(e);CHECK(e.markDispense()==lab2::Result::OK);unsigned w=m.writes;CHECK(e.append(false)==lab2::Result::Rejected);CHECK(m.writes==w);}
static void failedConfirmation(){for(auto op:{Append,Credit,Ack,Review,ReviewAck,Resume})for(int mode:{3,4}){
  auto m=setup(op);lab2::Engine e(m);open(e);m.cut=m.writes+1;m.mode=mode;
  CHECK(perform(e,op)==lab2::Result::Blocked);CHECK(!e.healthy);unsigned w=m.writes;
  CHECK(e.credit()==lab2::Result::Blocked);CHECK(e.reviewAck()==lab2::Result::Blocked);CHECK(m.writes==w);
  m.cut=0;lab2::Engine reboot(m);open(reboot);CHECK(reboot.state.receiver.total<=5);CHECK(m.writes==w);
}}
struct TestCase {const char*name;void(*run)();};
static const TestCase cases[]={
  {"payments-fifo-receipts",basic},{"review-ack-replay",review},
  {"initialization-power-cuts",initializationCuts},{"operation-power-cuts",operationCuts},
  {"failed-confirmation",failedConfirmation},{"corruption",corruption},{"repeated-reboot",repeated}
};
int main(int argc,char**argv){
  if(argc>2){fprintf(stderr,"Use one exact synthetic case name, or no argument for all cases\n");return 2;}
  unsigned ran=0;
  for(const auto &c:cases)if(argc==1||!strcmp(argv[1],c.name)){
    unsigned before=checks;c.run();++ran;printf("PASS case=%s checks=%u\n",c.name,checks-before);
  }
  if(!ran){fprintf(stderr,"Unknown synthetic test case\n");return 2;}
  printf("PASS Phase2 synthetic engine: cases=%u checks=%u skipped=0\n",ran,checks);
}
