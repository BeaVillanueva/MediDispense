// Offline metadata reader. Never opens a serial port; never prints NVS contents.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function tableAt(image,offset) {
  if(offset%0x1000||offset<0x1000||offset+0x1000>image.length)return null;
  const entries=[];const ranges=[];
  for(let at=offset;at<offset+0xC00;at+=32){
    const magic=image.readUInt16LE(at);
    if(magic===0xEBEB){
      if(!entries.length)return null;
      if(!image.subarray(at+2,at+16).every(b=>b===0xFF))return null;
      const digest=createHash('md5').update(image.subarray(offset,at)).digest();
      if(!digest.equals(image.subarray(at+16,at+32)))return null;
      return {offset,md5Verified:true,entries};
    }
    // Do not treat an unverified/legacy/no-MD5 candidate as a verified partition map.
    if(magic!==0x50AA)return null;
    const type=image[at+2],subtype=image[at+3],start=image.readUInt32LE(at+4),size=image.readUInt32LE(at+8);
    const label=image.subarray(at+12,at+28).toString('ascii').split('\0')[0];
    if(!size||start%0x1000||size%0x1000||start+size>image.length||start<0x1000||!/^[\w-]{1,16}$/.test(label))return null;
    if(type===0&&start%0x10000)return null;
    if(ranges.some(([a,b])=>start<b&&start+size>a))return null;
    if(start<offset+0x1000&&start+size>offset)return null;
    if(entries.some(e=>e.label===label))return null;
    ranges.push([start,start+size]);
    entries.push({label,type,subtype,offset:start,size,flags:image.readUInt32LE(at+28)});
  }
  return null;
}
export function inspect(image){
  if(image.length!==0x400000)throw new Error('Expected the operator-verified full 4 MiB backup. No size guessing.');
  const candidates=[];
  for(let at=0x1000;at<image.length;at+=0x1000){const table=tableAt(image,at);if(table)candidates.push(table);}
  if(candidates.length!==1)throw new Error('Missing/ambiguous verified partition map; specialist review required, no upload recommendation.');
  const table=candidates[0];
  const proposals=[{name:'proposed partition-table sector',offset:0x8000,size:0x1000},{name:'proposed application maximum region',offset:0x10000,size:0x1F0000},{name:'proposed labstore',offset:0x3E0000,size:0x20000}];
  return {imageBytes:image.length,sha256:createHash('sha256').update(image).digest('hex'),table,
    proposals:proposals.map(p=>({...p,overlaps:table.entries.filter(e=>p.offset<e.offset+e.size&&p.offset+p.size>e.offset).map(e=>e.label)})),
    warning:'Metadata only, NOT authorization. Bootloader writes depend on the actual reviewed upload manifest; application size is not the whole partition. Unallocated ranges may contain evidence. Do not send the backup or credentials.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{if(process.argv.length!==3)throw new Error('Usage (offline, review only): node inspect-partitions.mjs PRIVATE_FULL_BACKUP.bin');console.log(JSON.stringify(inspect(readFileSync(process.argv[2])),null,2));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
