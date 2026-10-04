import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const database = readFileSync("tmp/kiosk-test-database.txt", "utf8").trim();
assert.match(database, /^medidispense_kiosk_test_[a-f0-9]+$/);
const key = randomBytes(32).toString("hex");
const env = { ...process.env, DB_HOST:"127.0.0.1", DB_PORT:"33317", DB_NAME:database, DB_USER:"root", DB_PASSWORD:"", HARDWARE_API_KEY:key, APP_ENV:"test", CORS_ORIGINS:"http://localhost:3000" };
const fixture=spawnSync("php",["-r",`require 'backend/src/Database.php'; $db=Database::connect(require 'backend/config/config.php'); if(strpos($db->query('SELECT DATABASE()')->fetchColumn(),'medidispense_kiosk_test_')!==0) exit(1); $db->exec('UPDATE inventory SET quantity=8,reserved_quantity=0 WHERE medicine_id=1');`],{env,encoding:"utf8"});
assert.equal(fixture.status,0,"isolated fixture setup");
const php=spawn("php",["-S","127.0.0.1:33318","-t","backend/public","backend/public/index.php"],{env,stdio:"ignore"});
let checks=0;
async function api(path, {body, token, hardware, origin, method}={}) {
  const response=await fetch(`http://127.0.0.1:33318/api${path}`,{method:method??(body===undefined?"GET":"POST"),headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(token?{"X-Kiosk-Token":token}:{}),...(hardware?{"X-Hardware-Key":hardware}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const json=await response.json().catch(()=>null);return {status:response.status,json,headers:response.headers};
}
function check(value,label){assert.ok(value,label);checks++;console.log(`PASS: ${label}`);}
try {
  let ready=false;
  for(let i=0;i<60;i++){try{ready=(await api('/health')).status===200;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,"test PHP API starts");
  const catalog=await api('/medicines?available=1',{origin:"http://localhost:3000"});
  check(catalog.status===200&&catalog.json.data[0].price===12,"HTTP catalog reads stored price");
  check(catalog.headers.get('access-control-allow-origin')==='http://localhost:3000',"configured CORS origin accepted");
  check((await api('/medicines?available=1',{origin:'https://untrusted.invalid'})).status===403,"unknown CORS origin rejected");
  const token=randomBytes(32).toString('hex'), request_id=randomUUID();
  let response=await api('/transactions/checkout',{token,body:{request_id,items:[{medicine_id:1,quantity:2}],total:0}});
  check(response.status===201&&response.json.data.total===24,"HTTP checkout calculates authoritative total");
  const t=response.json.data,id=t.databaseId;
  response=await api('/transactions/checkout',{token,body:{request_id,items:[{medicine_id:1,quantity:2}]}});
  check(response.json.data.databaseId===id,"HTTP retry recovers same checkout");
  check((await api(`/transactions/${id}`)).status===404,"transaction requires private recovery token");
  check((await api('/transactions/recover?request_id='+request_id,{token})).json.data.paymentStatus==='pending',"HTTP reload recovers pending state");
  check((await api('/payments/verify',{body:{transaction_id:id,amount_inserted:9999}})).status===401,"browser cannot assert successful payment");
  check((await api('/payments/verify',{hardware:'incorrect',body:{transaction_id:id,event_id:'coin',coin_amount:24}})).status===401,"incorrect hardware credential rejected");
  check((await api('/dispense/1/sensor',{body:{unit_number:1,success:true}})).status===401,"browser cannot assert sensor success");
  response=await api('/transactions/checkout',{token,body:{request_id:randomUUID(),items:[{medicine_id:1,quantity:999}]}});
  check(response.status===409&&response.json.error.code==='OUT_OF_STOCK',"structured stock error and HTTP status");
  response=await api('/transactions/checkout',{token,body:{request_id:randomUUID(),items:[{medicine_id:1,quantity:0.5}]}});
  check(response.status===422&&response.json.error.code==='INVALID_QUANTITY',"fractional quantity rejected");
  response=await api('/payments/verify',{hardware:key,body:{transaction_id:id,event_id:'coin-1',coin_amount:10}});
  check(response.status===200&&response.json.data.insertedAmount===10,"trusted coin delta persisted");
  check((await api(`/transactions/${id}/cancel`,{token,body:{}})).status===409,"cannot cancel after coins");
  response=await api('/payments/verify',{hardware:key,body:{transaction_id:id,event_id:'coin-2',coin_amount:20}});
  const request=response.json.data.dispensingRequestId;
  check(response.json.data.overpaymentAmount===6&&response.json.data.change===0,"HTTP overpayment has no fake change");
  check(response.json.data.dispensingStatus==='dispensing'&&response.json.data.dispensedQuantity===0,"paid is distinct from dispensed");
  response=await api(`/dispense/${request}`,{hardware:key,body:{}});
  check(response.json.data.mapping.motor_id==='MOTOR-1'&&response.json.data.unit_number===1,"hardware mapping comes from database request");
  response=await api(`/dispense/${request}/sensor`,{hardware:key,body:{unit_number:1,success:true}});
  check(response.json.data.dispensedQuantity===1&&response.json.data.dispensingStatus==='dispensing',"one unit confirmation does not show success");
  response=await api(`/dispense/${request}/sensor`,{hardware:key,body:{unit_number:2,success:false}});
  check(response.json.data.dispensedQuantity===1&&response.json.data.dispensingStatus==='failed',"HTTP partial failure is authoritative");
  check((await api('/medicines')).status===401,"admin inventory still requires authentication");
  console.log(`Passed ${checks} HTTP integration checks. No physical hardware used.`);
} finally { php.kill(); }
