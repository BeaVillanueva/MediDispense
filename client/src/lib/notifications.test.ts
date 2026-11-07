import { describe, expect, it } from "vitest";
import type { Alert } from "@shared/medidispense";
import { notificationSummary, productionNotifications } from "./notifications";

const alert: Alert = { id:1,kind:"low_stock",title:"Low Stock Alert",message:"Long incident description",severity:"warning",createdAt:"2026-11-08 01:15:00",read:false,details:{medicine_name:"Cetirizine 10mg",slot_number:3,available_stock:3,threshold:3} };
describe("notification presentation",()=>{
  it("excludes structured and legacy TEST records from the visible list and unread count",()=>{
    const visible=productionNotifications([alert,{...alert,id:2,details:{is_test:true}},{...alert,id:3,title:"[TEST] Low Stock"},{...alert,id:4,message:"[TEST run] Synthetic"}]);
    expect(visible.map(a=>a.id)).toEqual([1]);
    expect(productionNotifications([{...alert,message:"[TEST] synthetic"}])).toEqual([]);
  });
  it("uses short medicine-specific stock details and correct priority styling",()=>{
    expect(notificationSummary(alert)).toMatchObject({medicine:"Cetirizine 10mg — Slot 3",description:"3 units remaining.",tone:"stock",highPriority:false});
    expect(notificationSummary({...alert,kind:"out_of_stock",details:{...alert.details,available_stock:0}}).description).toContain("Out of stock");
    expect(notificationSummary({...alert,kind:"dispensing_failure",severity:"danger"})).toMatchObject({title:"Dispensing Issue Alert",tone:"urgent",highPriority:true});
  });
});
