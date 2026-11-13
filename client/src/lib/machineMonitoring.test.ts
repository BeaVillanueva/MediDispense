import { describe, expect, it, vi } from "vitest";
import { connectionState,componentState,slotStock,checkMonitoringConnection } from "./machineMonitoring";
import type { MachineSlot,MachineStatus } from "@shared/medidispense";
const machine={online:true,heartbeatAgeSeconds:20} as MachineStatus;
describe("staff machine monitoring",()=>{
  it("distinguishes controller connectivity from readiness and live ambiguity",()=>{
    expect(componentState('Connected',true,true)).toMatchObject({label:'Connected',tone:'info'});
    expect(componentState('Unknown',false,true).label).toBe('Not Yet Verified');
    expect(connectionState({...machine,controllerAmbiguous:true}).label).toBe('Status Unknown');
  });
  it("requires a recent heartbeat for Online",()=>{
    expect(connectionState(machine).label).toBe("Online");
    expect(connectionState({...machine,heartbeatAgeSeconds:91}).label).toBe("Offline");
    expect(connectionState(machine,71).label).toBe("Offline");
    expect(connectionState({...machine,online:false}).label).toBe("Offline");
  });
  it("missing/future/unavailable evidence remains unknown",()=>{
    expect(connectionState().label).toBe("Status Unknown");
    expect(connectionState({...machine,heartbeatAgeSeconds:null}).tone).toBe("neutral");
    expect(connectionState({...machine,heartbeatAgeSeconds:-1}).tone).toBe("neutral");
    expect(componentState("Ready",false,true).tone).toBe("neutral");
    expect(componentState("Ready",true,false).tone).toBe("neutral");
  });
  it("disconnected coin payment never has a green indicator",()=>{
    expect(componentState("Not Connected",true,true)).toMatchObject({label:"Disconnected",tone:"bad"});
    expect(componentState("Ready",true,true).label).toBe("Not Yet Verified");
    expect(componentState("Idle",true,true).tone).toBe("neutral");
    expect(componentState("Monitoring",true,true).tone).toBe("neutral");
    expect(componentState("unrecognized raw code",true,true).label).toBe("Not Yet Verified");
  });
  it.each([[0,"Out of Stock"],[1,"Low Stock"],[3,"Low Stock"],[4,"In Stock"]])("uses recorded available stock %i correctly",(quantity,label)=>{
    expect(slotStock({quantity:7,availableQuantity:quantity,minimumStockLevel:3} as MachineSlot).label).toBe(label);
  });
  it("honors per-medicine thresholds and does not infer availability from slot readiness",()=>{
    expect(slotStock({quantity:7,availableQuantity:4,minimumStockLevel:5,status:"ready"} as MachineSlot).label).toBe("Low Stock");
    expect(slotStock({quantity:7,status:"ready"} as MachineSlot).label).toBe("Status Unknown");
  });
  it("Check Connection only refreshes data, never claims to have received a heartbeat",async()=>{
    const refetch=vi.fn().mockResolvedValue({error:null});
    const result=await checkMonitoringConnection(refetch);
    expect(refetch).toHaveBeenCalledOnce();expect(result).toBe("Connection status updated.");
    expect(await checkMonitoringConnection(async()=>{throw new Error("PRIVATE ERROR CODE");})).not.toContain("PRIVATE ERROR CODE");
  });
});
