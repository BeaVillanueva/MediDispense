// Local artifact integrity and geometry checks only; never connects to a device.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tableAt} from '../inspect-partitions.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const artifact='tmp/lab-durability-phase2-v2';
const get=p=>readFileSync(resolve(root,p));
const digest=p=>({path:p,bytes:get(p).length,sha256:createHash('sha256').update(get(p)).digest('hex')});
const baseline=JSON.parse(get('tmp/lab-phase2-baseline-fingerprint.json'));
for(const f of baseline)if(digest(f.path).sha256!==f.sha256)throw Error('Baseline mismatch: '+f.path);
const sourceFiles=readdirSync(resolve(root,'firmware/lab-durability/phase2')).filter(f=>/\.(h|ino|cpp|mjs)$/.test(f)).map(f=>'firmware/lab-durability/phase2/'+f);
sourceFiles.push('docs/lab-durability-phase2.md');
const closure=JSON.parse(get(artifact+'/MediDispenseDurabilityLab/source-manifest.json'));
for(const f of closure){if(digest(f.source).sha256!==f.sha256||digest(artifact+'/MediDispenseDurabilityLab/'+f.file).sha256!==f.sha256)throw Error('Prepared source mismatch: '+f.file);}
const build=artifact+'/build/';
const partition=build+'MediDispenseDurabilityLab.ino.partitions.bin';
if(digest(partition).sha256!==baseline.find(f=>f.path.endsWith('.partitions.bin')).sha256)throw Error('Partition table differs from baseline');
const synthetic=Buffer.alloc(0x400000,255);get(partition).copy(synthetic,0x8000);
const table=tableAt(synthetic,0x8000);
if(!table||table.entries.length!==2||table.entries[0].label!=='labapp'||table.entries[0].offset!==0x10000||table.entries[0].size!==0x1F0000||table.entries[1].label!=='labstore'||table.entries[1].offset!==0x3E0000||table.entries[1].size!==0x20000)throw Error('Unexpected layout');
const app=digest(build+'MediDispenseDurabilityLab.ino.bin');
if(app.bytes>0x1F0000||app.bytes>1310720)throw Error('Application does not fit');
const binaries=readdirSync(resolve(root,build)).filter(f=>f.endsWith('.bin')).map(f=>({...digest(build+f),uploadAuthorized:false}));
const report={phase:'2 SOFTWARE ONLY',hardwareOperationsPerformed:false,baselineUnchanged:true,baseline,
  sources:sourceFiles.map(digest),dependencyClosure:closure,partitionTable:table,
  binaries,proposedApplicationOnly:{...app,offset:0x10000,endExclusive:0x10000+app.bytes,sectorEndExclusive:Math.ceil((0x10000+app.bytes)/4096)*4096,uploadAuthorized:false},
  validation:{javascriptChecks:'21 passed; source/packaging/driver mocks, not C++ execution',nativeSyntax:'passed Xtensa C++17 syntax-only',nativeRuntime:'BLOCKED pending approved Linux execution',sanitizers:'NOT EXECUTED for new Phase2 engine',physicalDurability:'NOT EXECUTED'},recommendation:'NO-GO pending native runtime + sanitizer results and separate hardware authorization'};
const output=artifact+'/candidate-manifest.json';writeFileSync(resolve(root,output),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({manifest:output,application:report.proposedApplicationOnly,baselineUnchanged:true,sources:sourceFiles.length,binaries:binaries.length},null,2));
