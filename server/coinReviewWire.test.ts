import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
let v:any;
beforeAll(()=>{v=JSON.parse(execFileSync(process.env.TEST_PHP_BINARY??'C:\\xampp\\php\\php.exe',['backend/tests/coin-review-wire-vectors.php'],{encoding:'utf8'}));});
const key=Buffer.from('a'.repeat(64),'hex');
const mac=(text:string)=>createHmac('sha256',key).update(text).digest('hex');
it('matches the PHP decision canonical text, archive hash and HMAC using independent Node crypto',()=>{
  const d=v.decision;
  const text=`review-v1|${d.id}|${d.device_id}|${d.event_id}|${d.transaction_id}|${d.pulses}|${d.amount}|${d.nonce}|no_additional_payment|keep_blocked`;
  expect(v.decision_text).toBe(text);expect(v.archive_hash).toBe(createHash('sha256').update(text).digest('hex'));expect(v.decision_signature).toBe(mac(`${text}|${v.challenge}`));
});
it('matches the PHP acknowledgment proof for the exact immutable archive',()=>{
  const text=`ack-v1|${v.decision.id}|${v.decision.device_id}|${v.archive_hash}|0|archived|journal_persisted|keep_blocked`;
  expect(v.ack_text).toBe(text);expect(v.ack_signature).toBe(mac(text));
});
it('does not accept a different event, transaction, challenge or acknowledgment domain as the original proof',()=>{
  for(const text of [v.decision_text.replace('00000002','00000003'),v.decision_text.replace('900182','900183')])expect(mac(`${text}|${v.challenge}`)).not.toBe(v.decision_signature);
  expect(mac(`${v.decision_text}|${'e'.repeat(32)}`)).not.toBe(v.decision_signature);expect(mac(v.ack_text)).not.toBe(v.decision_signature);
});
