// These execute source/packaging and driver-contract checks, not the C++ runtime tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {run} from './native-tests.mjs';
const root=resolve(import.meta.dirname,'../../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const base='firmware/lab-durability/phase2/';
test('candidate explicitly opts in only retired board; original identity guard denies production even with opt-in',()=>{
  const config=read(base+'LabBuildConfig.h'),guard=read('firmware/lab-durability/MediDispenseDurabilityLab/LabIdentity.h');
  assert.match(config,/MEDIDISPENSE_LAB_STORAGE_APPROVED 1/);assert.match(config,/MEDIDISPENSE_LAB_BOARD_ID "20799D470968"/);
  assert.match(guard,/!labIdentityAllowed\("2C8C6AF3AF48","2C8C6AF3AF48",true\)/);
});
test('sketch startup does not open storage; no network, vending GPIO, or explicit erase APIs',()=>{
  const code=read(base+'MediDispenseDurabilityLab.ino');const setup=code.slice(code.indexOf('void setup()'));
  assert.doesNotMatch(setup,/\.begin\([^1]|nvs_open|initialize\(/);
  assert.doesNotMatch(code,/WiFi\.|HTTPClient|Firebase\.|digitalWrite\(|pinMode\(|nvs_flash_erase|\.clear\(|\.remove\(|esp_partition_erase|esptool/);
  assert.match(code,/WRITE_BEGIN/);assert.match(code,/WRITE_END/);assert.match(code,/READBACK/);
});
test('new schema validates receipt, archive, pointer and init-intent; no fallback repair',()=>{
  const code=read(base+'LabState.h');for(const marker of ['Schema=2','UNBACKED_LAST_RECEIPT','LAST_RECEIPT_MISMATCH','POINTER_ACK_WITHOUT_RECEIPT','POINTER_MISSING_AFTER_ADVANCE','ACKNOWLEDGED_EVENT_REAPPEARED','EXISTING_CASE_NOT_REPLACED','HEAD_REQUIRES_REVIEW_NO_CREDIT'])assert.ok(code.includes(marker));
  assert.doesNotMatch(code,/nvs_|WiFi|Firebase|https?:|\.erase\(/);
});
test('preparation closure includes both portable cores and exact baseline partition CSV',()=>{
  const p=read(base+'prepare.mjs');for(const file of ['LabState.h','LabIdentity.h','LabBuildConfig.h','CoinPaymentCore.h','CoinEventReviewCore.h','partitions.csv'])assert.ok(p.includes(file));
  assert.match(p,/existsSync\(target\)/);assert.doesNotMatch(p,/child_process|serialport|fetch\(/);
});
test('native driver compiles and runs normal plus ASan/UBSan with clean environment',()=>{
  const calls=[];const results=run(root,resolve(root,'tmp/lab-phase2-driver-contract'),(cmd,args,opts)=>{calls.push({cmd,args,opts});return {status:0};});
  assert.equal(calls.length,16);assert.equal(results.length,14);assert.ok(results.every(r=>r.result==='PASS'));
  assert.ok(calls[8].args.includes('-fsanitize=address,undefined'));assert.ok(calls[0].args.some(a=>a.endsWith('state.test.cpp')));
  assert.equal(new Set(calls.slice(1,8).map(c=>c.args[0])).size,7);
  assert.deepEqual(Object.keys(calls[0].opts.env).sort(),['ASAN_OPTIONS','HOME','LANG','PATH','UBSAN_OPTIONS']);
});
test('native compile failure never executes failed binary, runtime failure is not reported as pass',()=>{
  let calls=0;const failed=run(root,resolve(root,'tmp/lab-phase2-driver-contract'),()=>{calls++;return {status:1};});assert.equal(calls,2);assert.ok(failed.every(r=>r.result==='FAIL compile'));
  const runtime=run(root,resolve(root,'tmp/lab-phase2-driver-contract'),(cmd)=>({status:cmd==='g++'?0:1}));assert.ok(runtime.every(r=>r.result==='FAIL runtime'));
});
