import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./apiConfig",()=>({apiBaseUrl:"http://192.168.1.81/medidispense/backend/public"}));
import { kioskApi, newPurchaseSession } from "./kioskApi";
import { persistPurchaseSession,readPurchaseSession } from "./kioskSession";
import { logKioskDiagnostic } from "./kioskDiagnostics";

beforeEach(()=>{vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
describe("LAN checkout and recovery",()=>{
  it("recovers a committed checkout after its response is lost without creating another purchase",async()=>{
    const session=newPurchaseSession(1,1);const map=new Map<string,string>();
    const storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}};
    persistPurchaseSession("saved",session,storage);
    let created=0;let stored:Record<string,unknown>|undefined;
    const fetcher=vi.fn(async(url:string,init:RequestInit)=>{
      expect(url).toMatch(/^http:\/\/192\.168\.1\.81\/medidispense\/backend\/public\/api\/transactions\//);
      expect(init.headers).toMatchObject({"X-Kiosk-Token":session.token});
      if(init.method==="POST") {created++;stored={databaseId:99,id:"TEST-ORIGINAL",paymentStatus:"pending",dispensingStatus:"pending"};throw new TypeError("response lost after commit");}
      expect(new URL(url).searchParams.get("request_id")).toBe(session.requestId);
      return Response.json({data:stored});
    });vi.stubGlobal("fetch",fetcher);
    await expect(kioskApi.checkout(session)).rejects.toMatchObject({code:"NETWORK_ERROR"});
    const saved=readPurchaseSession(["saved"],storage)!;
    expect(await kioskApi.recover(saved)).toMatchObject({databaseId:99});
    expect(await kioskApi.recover(saved)).toMatchObject({databaseId:99});
    expect(created).toBe(1);expect(fetcher).toHaveBeenCalledTimes(3);
    const logs=JSON.stringify([vi.mocked(console.info).mock.calls,vi.mocked(console.warn).mock.calls]);
    expect(logs).not.toContain(session.token);expect(logs).not.toContain(session.requestId);
  });
  it("reports recovery 404 without silently retrying checkout",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({error:{code:"TRANSACTION_NOT_FOUND",message:"Purchase not found."}},{status:404}));vi.stubGlobal("fetch",fetcher);
    await expect(kioskApi.recover(newPurchaseSession(1,1))).rejects.toMatchObject({status:404,code:"TRANSACTION_NOT_FOUND"});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1].method).toBe("GET");
  });
  it("distinguishes HTML/wrong API paths from structured business errors",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("<html>Wrong endpoint</html>",{status:200})));
    await expect(kioskApi.checkout(newPurchaseSession(1,1))).rejects.toMatchObject({code:"INVALID_RESPONSE",status:200});
  });
  it("reports mixed content before sending any request",async()=>{
    vi.stubGlobal("location",{origin:"https://kiosk.example",protocol:"https:"});const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await expect(kioskApi.checkout(newPurchaseSession(1,1))).rejects.toMatchObject({code:"MIXED_CONTENT"});expect(fetcher).not.toHaveBeenCalled();
  });
  it("identifies successful JSON from a wrong endpoint as an invalid API response",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({status:"ok"})));
    await expect(kioskApi.recover(newPurchaseSession(1,1))).rejects.toMatchObject({code:"INVALID_RESPONSE",status:200});
  });
  it("keeps the existing timeout and works without AbortSignal.timeout",async()=>{
    vi.useFakeTimers();vi.stubGlobal("AbortSignal",{});
    vi.stubGlobal("fetch",vi.fn((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError"))))));
    const request=kioskApi.recover(newPurchaseSession(1,1));const assertion=expect(request).rejects.toMatchObject({code:"REQUEST_TIMEOUT"});
    await vi.advanceTimersByTimeAsync(10000);await assertion;
  });
  it("redacts URL queries, user credentials and internal transaction ids in diagnostics",()=>{
    logKioskDiagnostic({operation:"recover",url:"http://user:secret@192.168.1.81/api/transactions/123?token=private&request_id=key",status:200,category:"success",durationMs:5});
    const log=JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(log).toContain("/transactions/:id");expect(log).not.toContain("secret");expect(log).not.toContain("private");expect(log).not.toContain("request_id");
  });
});
