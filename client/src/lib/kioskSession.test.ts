import { afterEach, describe, expect, it, vi } from "vitest";
import { newPurchaseSession,persistPurchaseSession,readPurchaseSession } from "./kioskSession";

const random=globalThis.crypto.getRandomValues.bind(globalThis.crypto);
afterEach(()=>vi.unstubAllGlobals());
describe("LAN purchase credentials",()=>{
  it("creates secure credentials on HTTP LAN browsers without randomUUID",()=>{
    vi.stubGlobal("crypto",{getRandomValues:random});
    const first=newPurchaseSession(1,2),second=newPurchaseSession(1,2);
    expect(first.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect(first.requestId).not.toBe(second.requestId);expect(first.token).not.toBe(second.token);
  });
  it("fails closed without a secure random source",()=>{
    vi.stubGlobal("crypto",{});
    expect(()=>newPurchaseSession(1,1)).toThrow("securely create a purchase");
  });
  it("persists and restores exactly the same request and token, including legacy URL keys",()=>{
    const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
    const session=newPurchaseSession(1,1);persistPurchaseSession("legacy-localhost",session,storage);
    expect(readPurchaseSession(["lan","legacy-localhost"],storage)).toEqual(session);
    expect(readPurchaseSession(["missing"],storage)).toBeNull();
  });
  it("does not silently replace corrupt or unwritable saved sessions",()=>{
    const storage={getItem:()=>"{broken",setItem:()=>{throw new Error("blocked");},removeItem:()=>{}};
    expect(()=>readPurchaseSession(["key"],storage)).toThrow("saved purchase cannot be read");
    expect(()=>persistPurchaseSession("key",newPurchaseSession(1,1),storage)).toThrow("No checkout was sent");
    expect(()=>readPurchaseSession(["key"],{...storage,getItem:()=>JSON.stringify({...newPurchaseSession(1,1),quantity:999})})).toThrow("credentials are invalid");
  });
});
