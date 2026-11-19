import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {inspect} from './inspect-partitions.mjs';
function fixture(offset=0x8000,entries=[[0,'nvs',1,2,0x9000,0x5000],[1,'app0',0,0x10,0x10000,0x140000]]){
  const image=Buffer.alloc(0x400000,0xFF);
  for(const [i,label,type,subtype,start,size] of entries){
    const at=offset+i*32;image.fill(0,at,at+32);image.writeUInt16LE(0x50AA,at);image[at+2]=type;image[at+3]=subtype;image.writeUInt32LE(start,at+4);image.writeUInt32LE(size,at+8);image.write(label,at+12,'ascii');
  }
  const end=offset+entries.length*32;
  image.writeUInt16LE(0xEBEB,end);createHash('md5').update(image.subarray(offset,end)).digest().copy(image,end+16);
  return image;
}
test('reads synthetic partition metadata without exposing NVS data',()=>{
  const r=inspect(fixture());assert.equal(r.table.offset,0x8000);assert.equal(r.table.md5Verified,true);assert.deepEqual(r.proposals[1].overlaps,['app0']);assert.equal(r.table.entries[0].label,'nvs');
});
test('corrupt table checksum is rejected',()=>{const b=fixture();b[0x8010]^=1;assert.throws(()=>inspect(b),/Missing/);});
test('truncated/full-size mismatch is rejected',()=>assert.throws(()=>inspect(Buffer.alloc(1024)),/4 MiB/));
test('does not assume default table offset',()=>assert.equal(inspect(fixture(0x3000)).table.offset,0x3000));
test('ambiguous valid maps are rejected',()=>{const b=fixture();fixture(0x3000).copy(b,0x3000,0x3000,0x4000);assert.throws(()=>inspect(b),/ambiguous/);});
test('valid checksum does not permit overlapping partitions',()=>{
  const b=fixture();b.writeUInt32LE(0x20000,0x8008);
  createHash('md5').update(b.subarray(0x8000,0x8040)).digest().copy(b,0x8050);
  assert.throws(()=>inspect(b),/Missing/);
});
test('out-of-image region with valid checksum is rejected',()=>{
  const b=fixture();b.writeUInt32LE(0x500000,0x8000+32+8);
  createHash('md5').update(b.subarray(0x8000,0x8040)).digest().copy(b,0x8050);
  assert.throws(()=>inspect(b),/Missing/);
});
test('synthetic six-partition geometry reproduces reported protected evidence overlaps',()=>{
  // Geometry from operator metadata only; bytes are generated, not from a backup.
  const b=fixture(0x8000,[[0,'nvs',1,2,0x9000,0x5000],[1,'otadata',1,0,0xE000,0x2000],
    [2,'app0',0,0x10,0x10000,0x140000],[3,'app1',0,0x11,0x150000,0x140000],
    [4,'spiffs',1,0x82,0x290000,0x160000],[5,'coredump',1,3,0x3F0000,0x10000]]);
  const r=inspect(b);
  assert.equal(r.table.entries.length,6);
  assert.deepEqual(r.proposals[1].overlaps,['app0','app1']);
  assert.deepEqual(r.proposals[2].overlaps,['spiffs','coredump']);
});
test('lab source has no network SDK, production namespace or destructive erase API',()=>{
  const code=readFileSync(new URL('./MediDispenseDurabilityLab/MediDispenseDurabilityLab.ino',import.meta.url),'utf8');
  assert.ok(!/#include\s*[<"](?:WiFi|HTTPClient|Firebase)|\.clear\(|\.remove\(|nvs_flash_erase|esp_partition_erase|digitalWrite\(|pinMode\(|md-coins|BACKEND_BASE_URL|HARDWARE_API_KEY/.test(code));
  assert.match(code,/#define MEDIDISPENSE_LAB_STORAGE_APPROVED 0/);
  assert.ok(code.includes('labIdentityAllowed(board,MEDIDISPENSE_LAB_BOARD_ID,MEDIDISPENSE_LAB_RETIRED_REPURPOSE_APPROVED==1)'));
  assert.match(code,/store.begin\(ns.c_str\(\),!create,"labstore"\)/);
});
test('lab identity gate defaults closed and keeps production blocked under retired opt-in',()=>{
  const code=readFileSync(new URL('./MediDispenseDurabilityLab/LabIdentity.h',import.meta.url),'utf8');
  assert.match(code,/#define MEDIDISPENSE_LAB_BOARD_ID ""/);
  assert.match(code,/#define MEDIDISPENSE_LAB_RETIRED_REPURPOSE_APPROVED 0/);
  assert.ok(code.includes('labSameId(actual,"2C8C6AF3AF48")||labSameId(configured,"2C8C6AF3AF48")'));
  assert.ok(code.includes('static_assert(!labIdentityAllowed("2C8C6AF3AF48","2C8C6AF3AF48",true)'));
  assert.ok(code.includes('static_assert(labIdentityAllowed("20799D470968","20799D470968",true)'));
  assert.ok(code.includes('labPackedMac(retiredRomMac)==0x20799D470968ULL'));
  assert.ok(code.includes('static_assert(labIdentityAllowed("AABBCCDDEEFF","AABBCCDDEEFF")'));
});
test('retired-review configuration enables only exact identity and not storage',()=>{
  const c=readFileSync(new URL('./MediDispenseDurabilityLab/LabRetiredReviewConfig.h',import.meta.url),'utf8');
  assert.match(c,/#define MEDIDISPENSE_LAB_BOARD_ID "20799D470968"/);
  assert.match(c,/#define MEDIDISPENSE_LAB_RETIRED_REPURPOSE_APPROVED 1/);
  assert.match(c,/#define MEDIDISPENSE_LAB_STORAGE_APPROVED 0/);
});
