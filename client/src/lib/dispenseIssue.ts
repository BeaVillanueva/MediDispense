import type { Transaction } from "@shared/medidispense";

export function canReviewDispensingIssue(t: Transaction) {
  return !!t.databaseId && t.paymentStatus === 'successful' && (['dispensing','failed'].includes(t.dispensingStatus) || !!t.issueRecovery);
}
export function recoveryRequestKey() {
  const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export function validPhysicalQuantity(outcome:string,value:string,sensor:number,previous:number,requested:number) {
  if(!/^[0-3]$/.test(value))return false;
  const n=Number(value);
  return n>=sensor && n>=previous && n<=requested && (outcome==='dispensed_sensor_missed'?n===requested:outcome==='not_dispensed'?n===0:outcome==='partial'&&n<requested);
}

export type PhysicalOutcome = 'dispensed_sensor_missed'|'not_dispensed'|'partial';
export type CustomerObligation = 'pending'|'refund_documented'|'replacement_documented';
export interface RecoveryForm {
  outcome: PhysicalOutcome|''; quantity:string; stock:string; notes:string;
  obligation:CustomerObligation; reference:string; complete:boolean;
  inspected:boolean; stopped:boolean; disconnected:boolean;
}
export function recoveryFormErrors(f:RecoveryForm,sensor:number,previous:number,requested:number):string[] {
  const errors:string[]=[];
  if(!f.outcome)errors.push('Choose what happened to the medicine.');
  if(!f.quantity)errors.push('Enter how many tablets came out.');
  else if(!validPhysicalQuantity(f.outcome,f.quantity,sensor,previous,requested))errors.push('The count must match your choice and include tablets already recorded.');
  if(f.stock&&!/^(?:[0-9]|10)$/.test(f.stock))errors.push('Enter a stock count from 0 to 10.');
  if(f.notes.trim().length<5||f.notes.length>1000)errors.push('Add a short note (5 to 1,000 characters).');
  if(f.outcome!=='dispensed_sensor_missed'&&f.obligation!=='pending'&&f.reference.trim().length<5)errors.push('Add proof or a reference for the refund or replacement.');
  if(!f.inspected)errors.push('Confirm that you checked the machine and medicine.');
  if(!f.stopped)errors.push('Confirm that all moving parts have stopped.');
  if(!f.disconnected)errors.push('Confirm that the control board is switched off or disconnected.');
  return errors;
}
/** Changed facts need saving again; transient confirmations, keys and revisions are excluded. */
export function recoveryFormSignature(f:RecoveryForm):string {
  return JSON.stringify({outcome:f.outcome,quantity:f.quantity===''?null:Number(f.quantity),stock:f.stock===''?null:Number(f.stock),notes:f.notes.trim(),obligation:f.outcome==='dispensed_sensor_missed'?'delivery_verified':f.obligation,reference:f.outcome!=='dispensed_sensor_missed'&&f.obligation!=='pending'?f.reference.trim():'',complete:f.outcome==='partial'?f.complete:true});
}
