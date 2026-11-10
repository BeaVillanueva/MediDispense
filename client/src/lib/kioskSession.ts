import { MAX_PURCHASE_QUANTITY } from "./kioskPurchase";

export type PurchaseSession = { requestId:string; token:string; medicineId:number; quantity:number };
type SessionStorage = Pick<Storage,"getItem"|"setItem"|"removeItem">;
export class KioskSessionError extends Error {
  constructor(public code:string,message:string){super(message);}
}
export function newPurchaseSession(medicineId:number,quantity:number):PurchaseSession {
  if(typeof globalThis.crypto?.getRandomValues !== "function") throw new KioskSessionError("SECURE_RANDOM_UNAVAILABLE","This browser cannot securely create a purchase. Use an updated browser. No checkout was sent.");
  const bytes=globalThis.crypto.getRandomValues(new Uint8Array(48));
  const token=Array.from(bytes.subarray(0,32),b=>b.toString(16).padStart(2,"0")).join("");
  const id=bytes.subarray(32);id[6]=(id[6]&15)|64;id[8]=(id[8]&63)|128;
  const hex=Array.from(id,b=>b.toString(16).padStart(2,"0")).join("");
  return {requestId:`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`,token,medicineId,quantity};
}
export function validatePurchaseSession(value:unknown):PurchaseSession {
  const s=value as Partial<PurchaseSession>|null;
  if(!s || typeof s!=="object" || typeof s.requestId!=="string" || !/^[a-zA-Z0-9-]{16,64}$/.test(s.requestId) || typeof s.token!=="string" || !/^[a-f0-9]{64}$/.test(s.token) || typeof s.medicineId!=="number" || !Number.isSafeInteger(s.medicineId) || s.medicineId<=0 || typeof s.quantity!=="number" || !Number.isInteger(s.quantity) || s.quantity<1 || s.quantity>MAX_PURCHASE_QUANTITY) {
    throw new KioskSessionError("INVALID_SAVED_SESSION","The saved purchase credentials are invalid. Keep this browser open and ask staff for assistance; do not insert coins.");
  }
  return s as PurchaseSession;
}
export function readPurchaseSession(keys:string[],storage?:SessionStorage):PurchaseSession|null {
  let raw:string|null=null;
  try { const target=storage??globalThis.localStorage;for(const key of keys){raw=target.getItem(key);if(raw!==null)break;} }
  catch {throw new KioskSessionError("STORAGE_UNAVAILABLE","Browser storage is unavailable. Allow site storage before purchasing; do not insert coins.");}
  if(raw===null)return null;
  try{return validatePurchaseSession(JSON.parse(raw));}
  catch(e){if(e instanceof KioskSessionError)throw e;throw new KioskSessionError("INVALID_SAVED_SESSION","The saved purchase cannot be read. Ask staff for assistance; do not clear site data or insert coins.");}
}
export function persistPurchaseSession(key:string,session:PurchaseSession,storage?:SessionStorage) {
  validatePurchaseSession(session);
  try { const target=storage??globalThis.localStorage;const raw=JSON.stringify(session);target.setItem(key,raw);if(target.getItem(key)!==raw)throw new Error(); }
  catch {throw new KioskSessionError("STORAGE_UNAVAILABLE","The browser could not save purchase recovery credentials. Allow site storage and retry. No checkout was sent.");}
}
export function removePurchaseSession(keys:string[],storage?:SessionStorage) {
  try {const target=storage??globalThis.localStorage;for(const key of keys)target.removeItem(key);}
  catch {throw new KioskSessionError("STORAGE_UNAVAILABLE","The saved session could not be cleared. Keep this browser open and ask staff for assistance.");}
}
