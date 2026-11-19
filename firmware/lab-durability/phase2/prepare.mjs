// Offline source copying only. No subprocess, serial, network, private configuration or backup access.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const base='firmware/lab-durability/phase2/';
const target=resolve(root,process.argv[2]??'tmp/lab-durability-phase2-v1/MediDispenseDurabilityLab');
if(process.argv.length>3||!target.startsWith(resolve(root,'tmp')+sep)||existsSync(target))throw Error('New workspace tmp directory required; no overwrites.');
const files={
 'MediDispenseDurabilityLab.ino':base+'MediDispenseDurabilityLab.ino',
 'LabBuildConfig.h':base+'LabBuildConfig.h','LabState.h':base+'LabState.h',
 'LabIdentity.h':'firmware/lab-durability/MediDispenseDurabilityLab/LabIdentity.h',
 'partitions.csv':'firmware/lab-durability/MediDispenseDurabilityLab/partitions.csv',
 'CoinPaymentCore.h':'esp32/CAPSTONE_MEDICINE_VENDO/CoinPaymentCore.h',
 'CoinEventReviewCore.h':'firmware/coin-review/CoinEventReviewCore.h'
};
mkdirSync(target,{recursive:true});const manifest=[];
for(const[file,source]of Object.entries(files)){const b=readFileSync(resolve(root,source));writeFileSync(resolve(target,file),b);manifest.push({file,source,sha256:createHash('sha256').update(b).digest('hex')});}
writeFileSync(resolve(target,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Prepared separate storage-enabled synthetic lab candidate; no tools or hardware invoked.');
console.log(target);
