#pragma once
// LAB ONLY. Production controller is always denied. Retired reuse requires opt-in.
#include <stdint.h>
#ifndef MEDIDISPENSE_LAB_BOARD_ID
#define MEDIDISPENSE_LAB_BOARD_ID ""
#endif
#ifndef MEDIDISPENSE_LAB_RETIRED_REPURPOSE_APPROVED
#define MEDIDISPENSE_LAB_RETIRED_REPURPOSE_APPROVED 0
#endif
// Same packing as EspClass::getEfuseMac() on this little-endian ESP32 target.
constexpr uint64_t labPackedMac(const uint8_t *bytes) {
  uint64_t value=0;
  for(unsigned i=0;i<6;i++)value|=uint64_t(bytes[i])<<(8*i);
  return value;
}
constexpr bool labIdValid(const char *id) {
  if(!id)return false;
  for(unsigned i=0;i<12;i++)if(!((id[i]>='0'&&id[i]<='9')||(id[i]>='A'&&id[i]<='F')))return false;
  return id[12]==0;
}
constexpr bool labSameId(const char *a,const char *b) {
  for(unsigned i=0;i<13;i++){if(a[i]!=b[i])return false;if(a[i]==0)return true;}
  return false;
}
constexpr bool labIdentityAllowed(const char *actual,const char *configured,bool retiredOptIn=false) {
  if(!labIdValid(actual)||!labIdValid(configured))return false;
  if(labSameId(actual,"2C8C6AF3AF48")||labSameId(configured,"2C8C6AF3AF48"))return false;
  if(!labSameId(actual,configured))return false;
  if(labSameId(actual,"20799D470968"))return retiredOptIn;
  return true;
}
// Compile-time regression checks: no native executable or hardware required.
static_assert(!labIdentityAllowed("AABBCCDDEEFF",""),"Unconfigured lab must block");
static_assert(!labIdentityAllowed("20799D470968","20799D470968"),"Retired evidence board is protected");
static_assert(labIdentityAllowed("20799D470968","20799D470968",true),"Exact retired-board opt-in is explicit");
static_assert(!labIdentityAllowed("2C8C6AF3AF48","2C8C6AF3AF48"),"Installed controller is protected");
static_assert(!labIdentityAllowed("2C8C6AF3AF48","2C8C6AF3AF48",true),"Repurposing never authorizes production");
static_assert(!labIdentityAllowed("AABBCCDDEEFF","20799D470968",true),"Opt-in never authorizes another board");
static_assert(!labIdentityAllowed("AABBCCDDEEFF","112233445566"),"Wrong dedicated board must block");
static_assert(!labIdentityAllowed("aabbccddeeff","aabbccddeeff"),"Require canonical uppercase IDs");
static_assert(!labIdentityAllowed("ABC","ABC"),"Truncated ID must block");
static_assert(!labIdentityAllowed("AABBCCDDEEFF0","AABBCCDDEEFF0"),"Oversized ID must block");
static_assert(labIdentityAllowed("AABBCCDDEEFF","AABBCCDDEEFF"),"Matching synthetic dedicated ID must work");
constexpr uint8_t retiredRomMac[]={0x68,0x09,0x47,0x9D,0x79,0x20};
static_assert(labPackedMac(retiredRomMac)==0x20799D470968ULL,"Verified ROM MAC maps to historical firmware ID");
