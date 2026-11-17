#pragma once
// Standalone, transport/storage/crypto-free candidate. No production includes.
#include <cstdint>
#include <cinttypes>
#include <cstddef>
#include <cstdio>
#include <cstring>

namespace cfr {
enum class Phase : uint32_t { Prepared=1, Applied=2, Acknowledged=3 };
enum class Result { Disabled, Rejected, StorageUnconfirmed, Prepared, Applied, Acknowledged, AlreadyDone };
struct Authorization {
  char decision[33], device[13], machine[33], event[80];
  char archive[65], before[65], after[65], nonce[33];
  uint32_t transaction, boot, generation, fence, expires;
};
struct Record { uint32_t version; Phase phase; Authorization auth; uint32_t checksum; };
struct Evidence {
  Authorization binding; // Exact current evidence bindings; expiry/nonce are decision fields.
  uint32_t now;
  bool journalValid, archiveAcknowledged, accountingReviewed, isolated, motorsStopped;
  bool emptyQueues, quiet, storageHealthy, bindingStable;
  bool readerFault, bootReview, overflow, incompletePulses, unrelatedFault;
  bool latch; // True before; false only for exact authorized after-image.
  char journal[65];
};
// Callbacks must persist AND read back complete bytes; false may mean committed.
struct IO {
  bool (*store)(const Record&, void*);
  bool (*journal)(const Authorization&, void*);
  bool (*observe)(Evidence&, void*);
  void* context;
};
inline bool token(const char* p, size_t n, size_t exact=0, int hex=0) {
  size_t i=0;
  for (; i<n && p[i]; ++i) {
    const char c=p[i];
    const bool ok=hex==1 ? ((c>='0'&&c<='9')||(c>='a'&&c<='f')) :
      hex==2 ? ((c>='0'&&c<='9')||(c>='A'&&c<='F')) :
      ((c>='0'&&c<='9')||(c>='a'&&c<='z')||(c>='A'&&c<='Z')||c=='-'||c=='_');
    if (!ok) return false;
  }
  return i>0 && i<n && (!exact || i==exact);
}
inline bool valid(const Authorization& a) {
  return token(a.decision,sizeof a.decision,32,1) && token(a.device,sizeof a.device,12,2) &&
    token(a.machine,sizeof a.machine) && token(a.event,sizeof a.event) &&
    token(a.archive,sizeof a.archive,64,1) && token(a.before,sizeof a.before,64,1) &&
    token(a.after,sizeof a.after,64,1) && token(a.nonce,sizeof a.nonce,32,1) &&
    std::strcmp(a.before,a.after)!=0 && a.transaction && a.boot && a.expires;
}
inline bool canonical(const Authorization& a, bool ack, char* out, size_t size) {
  if (!valid(a) || !out || !size) return false;
  const int n=std::snprintf(out,size,"%s|%s|%s|%s|%" PRIu32 "|%s|%s|%s|%s|%s|%" PRIu32 "|%" PRIu32 "|%" PRIu32 "|%" PRIu32 "|%s|keep-held",
    ack?"cfr-ack-v1":"cfr-auth-v1",a.decision,a.device,a.machine,a.transaction,a.event,
    a.archive,a.before,a.after,a.nonce,a.boot,a.generation,a.fence,a.expires,
    ack?"applied":"residual-legacy-latch");
  return n>=0 && static_cast<size_t>(n)<size;
}
inline uint32_t checksum(const Record& r) {
  char bytes[768]={};
  if (!canonical(r.auth,false,bytes,sizeof bytes)) return 0;
  uint32_t h=2166136261u;
  for (const char* p=bytes; *p; ++p) h=(h^static_cast<uint8_t>(*p))*16777619u;
  h=(h^r.version)*16777619u;
  return (h^static_cast<uint32_t>(r.phase))*16777619u;
}
inline bool valid(const Record& r) {
  return r.version==1 && valid(r.auth) && static_cast<uint32_t>(r.phase)>=1 &&
    static_cast<uint32_t>(r.phase)<=3 && r.checksum==checksum(r);
}
inline bool same(const Authorization& a,const Authorization& b) {
  char x[768]={},y[768]={};
  return canonical(a,false,x,sizeof x)&&canonical(b,false,y,sizeof y)&&std::strcmp(x,y)==0;
}
inline bool safe(const Evidence& e,const Authorization& a,bool requireBoot=true) {
  // Decision id/nonce/expiry checked separately; live bindings cannot be replaced.
  return valid(a) && token(e.binding.device,sizeof e.binding.device,12,2) &&
    token(e.binding.machine,sizeof e.binding.machine) && token(e.binding.event,sizeof e.binding.event) &&
    token(e.binding.archive,sizeof e.binding.archive,64,1) && token(e.journal,sizeof e.journal,64,1) &&
    std::strcmp(e.binding.device,a.device)==0 && std::strcmp(e.binding.machine,a.machine)==0 &&
    std::strcmp(e.binding.event,a.event)==0 && std::strcmp(e.binding.archive,a.archive)==0 &&
    e.binding.transaction==a.transaction && (!requireBoot || e.binding.boot==a.boot) &&
    e.binding.generation==a.generation && e.binding.fence==a.fence &&
    e.journalValid && e.archiveAcknowledged && e.accountingReviewed && e.isolated && e.motorsStopped &&
    e.emptyQueues && e.quiet && e.storageHealthy && e.bindingStable && !e.readerFault &&
    !e.bootReview && !e.overflow && !e.incompletePulses && !e.unrelatedFault;
}
inline bool image(const Evidence& e,const Authorization& a,bool after) {
  return e.latch!=after && std::strcmp(e.journal,after?a.after:a.before)==0;
}
inline bool hold() { return true; } // No release/reopening API in Milestone 1.
inline bool write(Record& r,Phase p,const IO& io) {
  Record next=r; next.phase=p; next.checksum=checksum(next);
  if (!io.store || !io.store(next,io.context)) return false;
  r=next; return true;
}
inline Result prepare(bool enabled,const Authorization& a,bool signatureVerified,
                      const Evidence& e,Record& r,bool occupied,const IO& io) {
  if (!enabled) return Result::Disabled;
  if (!signatureVerified || !safe(e,a) || e.now>=a.expires) return Result::Rejected;
  if (occupied) return valid(r)&&same(r.auth,a)?Result::AlreadyDone:Result::Rejected;
  if (!image(e,a,false)) return Result::Rejected;
  Record next={}; next.version=1; next.phase=Phase::Prepared; next.auth=a; next.checksum=checksum(next);
  if (!io.store || !io.store(next,io.context)) return Result::StorageUnconfirmed;
  r=next; return Result::Prepared;
}
inline Result apply(bool enabled,Record& r,const IO& io) {
  if (!enabled) return Result::Disabled;
  if (!valid(r) || !io.observe) return Result::Rejected;
  Evidence e={};
  if (!io.observe(e,io.context)||!safe(e,r.auth)||e.now>=r.auth.expires) return Result::Rejected;
  if (r.phase!=Phase::Prepared) return image(e,r.auth,true)?Result::AlreadyDone:Result::Rejected;
  if (image(e,r.auth,false)) {
    if (!io.journal || !io.journal(r.auth,io.context)) return Result::StorageUnconfirmed;
    if (!io.observe(e,io.context)||!safe(e,r.auth)||e.now>=r.auth.expires) return Result::Rejected;
  }
  if (!image(e,r.auth,true)) return Result::Rejected;
  return write(r,Phase::Applied,io)?Result::Applied:Result::StorageUnconfirmed;
}
inline Result acknowledge(bool enabled,Record& r,const Authorization& receipt,
                          bool backendReceiptVerified,const Evidence& e,const IO& io) {
  if (!enabled) return Result::Disabled;
  if (!valid(r)||!backendReceiptVerified||!same(r.auth,receipt)||!safe(e,r.auth,false)||
      !image(e,r.auth,true)||r.phase==Phase::Prepared) return Result::Rejected;
  if (r.phase==Phase::Acknowledged) return Result::AlreadyDone;
  return write(r,Phase::Acknowledged,io)?Result::Acknowledged:Result::StorageUnconfirmed;
}
} // namespace cfr
