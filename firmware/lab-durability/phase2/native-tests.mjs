// Synthetic native tests only. The calling approved Linux environment must enforce network isolation.
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const cases=['payments-fifo-receipts','review-ack-replay','initialization-power-cuts','operation-power-cuts','failed-confirmation','corruption','repeated-reboot'];
export function run(root,output,execute=spawnSync){
  mkdirSync(output,{recursive:true});
  const opts={env:{PATH:'/usr/bin:/bin',HOME:output,LANG:'C.UTF-8',ASAN_OPTIONS:'halt_on_error=1:detect_leaks=1',UBSAN_OPTIONS:'halt_on_error=1:print_stacktrace=1'},timeout:60000,stdio:'inherit'};
  const results=[];
  for(const sanitize of [false,true]){
    const name=sanitize?'phase2-asan-ubsan':'phase2-normal';
    const binary=resolve(output,name);
    const args=['-std=c++17','-O1','-g','-Wall','-Wextra','-Wpedantic',
      ...['esp32/CAPSTONE_MEDICINE_VENDO','firmware/coin-review','firmware/lab-durability/phase2'].flatMap(p=>['-I',resolve(root,p)]),
      ...(sanitize?['-fsanitize=address,undefined','-fno-omit-frame-pointer']:[]),
      resolve(root,'firmware/lab-durability/phase2/state.test.cpp'),'-o',binary];
    const compiled=execute('g++',args,opts);
    if(compiled.error||compiled.status!==0){
      const result=compiled.error?.code==='ENOENT'?'BLOCKED compiler missing':'FAIL compile';
      for(const test of cases)results.push({name,test,result});
      continue;
    }
    // Separate processes keep one assertion/sanitizer failure from hiding later cases.
    for(const test of cases){
      console.log(`CONFIG ${name} CASE ${test}`);
      const executed=execute(binary,[test],opts);
      results.push({name,test,result:!executed.error&&executed.status===0?'PASS':'FAIL runtime'});
    }
  }
  return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.platform!=='linux'||process.argv.length!==4){console.error('Approved network-isolated Linux environment required; no Windows execution.');process.exitCode=2;}
  else {const results=run(resolve(process.argv[2]),resolve(process.argv[3]));console.log(results);console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.result==='PASS').length,failed:results.filter(r=>r.result.startsWith('FAIL')).length,blocked:results.filter(r=>r.result.startsWith('BLOCKED')).length,skipped:0}));process.exitCode=results.every(r=>r.result==='PASS')?0:1;}
}
