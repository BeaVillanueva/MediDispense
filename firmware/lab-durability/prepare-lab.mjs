// Local source-only preparation. Never reads private configs/backups or runs tools.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const retiredReview=process.argv[3]==='--retired-review';
if(process.argv.length>4||(process.argv[3]&&!retiredReview))throw new Error('Only optional --retired-review is supported. No upload or storage-enable option.');
const target=resolve(root,process.argv[2]??'tmp/lab-durability-review/MediDispenseDurabilityLab');
if(!target.startsWith(resolve(root,'tmp')+sep)||existsSync(target))throw new Error('Use a new directory under workspace tmp; never overwrite evidence.');
const files={
  'MediDispenseDurabilityLab.ino':'firmware/lab-durability/MediDispenseDurabilityLab/MediDispenseDurabilityLab.ino',
  'partitions.csv':'firmware/lab-durability/MediDispenseDurabilityLab/partitions.csv',
  'LabIdentity.h':'firmware/lab-durability/MediDispenseDurabilityLab/LabIdentity.h',
  'CoinPaymentCore.h':'esp32/CAPSTONE_MEDICINE_VENDO/CoinPaymentCore.h',
  'CoinEventReviewCore.h':'firmware/coin-review/CoinEventReviewCore.h',
};
if(retiredReview)files['LabBuildConfig.h']='firmware/lab-durability/MediDispenseDurabilityLab/LabRetiredReviewConfig.h';
mkdirSync(target,{recursive:true});
const manifest=[];
for(const [name,source] of Object.entries(files)){
  const bytes=readFileSync(resolve(root,source));writeFileSync(resolve(target,name),bytes);
  manifest.push({file:name,source,sha256:createHash('sha256').update(bytes).digest('hex')});
}
writeFileSync(resolve(target,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(retiredReview?'Prepared exact retired-board opt-in REVIEW source, storage disabled. Production ID always denied. NO upload/erase/connection performed.':'Prepared unconfigured compile-only lab source. No board allowed; storage disabled. NO upload/erase/connection performed.');
console.log(target);
