import { afterEach,describe,expect,it,vi } from "vitest";
import { phpMachine } from "./phpApi";
import { appRouter } from './routers';
import type { TrpcContext } from "./_core/context";
const context={req:{headers:{}}} as TrpcContext;
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function response(machine:Record<string,unknown>){
  vi.stubEnv("MEDIDISPENSE_PHP_API_URL","http://php.test");
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:{machine,slots:[{slot_number:1,medicine_id:1,quantity:7,available_quantity:3,minimum_stock_level:3,slot_status:"ready"}]}})});
  vi.stubGlobal("fetch",fetch);return fetch;
}
describe("machine monitoring data mapping",()=>{
  it.each(['admin','staff'] as const)('restricts controller maintenance from %s on the server',async role=>{
    const fetch=response({});const caller=appRouter.createCaller({...context,employeeRole:role});
    await expect(caller.machine.controllers()).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(caller.machine.retireController({old_device_id:'20799D470968',new_device_id:'2C8C6AF3AF48',old_disconnected:true,no_unrecorded_coins:true,new_physically_verified:true})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("maps authenticated diagnostics without inheriting legacy component readiness",async()=>{
    response({connection_status:'online',heartbeat_age_seconds:2,heartbeat_at_ms:100000,monitoring_source:'authenticated_controller_diagnostics',controller_device_id:'2C8C6AF3AF48',controller_ambiguous:false,esp32_status:'Connected',motor_status:'Unknown',coin_acceptor_status:'Unknown',last_payload:JSON.stringify({esp32_status:'Connected'})});
    const result=await phpMachine(context);expect(result.online).toBe(true);expect(result.controllerDeviceId).toBe('2C8C6AF3AF48');expect(result.componentReports).toMatchObject({controller:true,payment:false,dispenser:false,detection:false});
  });
  it("uses recent explicit heartbeat reports, available quantity and real thresholds",async()=>{
    response({name:"MediDispense-01",connection_status:"online",heartbeat_age_seconds:10,heartbeat_at_ms:1000,esp32_status:"Ready",coin_acceptor_status:"Not Connected",last_payload:JSON.stringify({esp32_status:"Ready",coin_acceptor_status:"Not Connected"})});
    const result=await phpMachine(context);
    expect(result.online).toBe(true);
    expect(result.componentReports).toMatchObject({controller:true,payment:true,dispenser:false,detection:false});
    expect(result.slots[0]).toMatchObject({quantity:7,availableQuantity:3,minimumStockLevel:3});
  });
  it("stale online flags and missing payloads do not verify readiness",async()=>{
    response({connection_status:"online",heartbeat_age_seconds:91,esp32_status:"Ready",last_payload:null});
    const result=await phpMachine(context);
    expect(result.online).toBe(false);expect(result.componentReports?.controller).toBe(false);
  });
  it("missing heartbeat and malformed payload are treated as unverified",async()=>{
    response({connection_status:"online",esp32_status:"Ready",last_payload:"not json"});
    const result=await phpMachine(context);expect(result.online).toBe(false);expect(result.heartbeatAgeSeconds).toBeNull();expect(result.componentReports?.controller).toBe(false);
  });
});
