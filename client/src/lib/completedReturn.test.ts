import { expect, it } from "vitest";
import type { Transaction } from "@shared/medidispense";
import { completedReturnMessage } from "./completedReturn";
const transaction={paymentWindow:{controlledDemoAutoBinding:true}} as Transaction;
it("explains controller ambiguity rather than waiting indefinitely without a reason",()=>{
 expect(completedReturnMessage({...transaction,customerHandoffBlockers:["MULTIPLE_CONTROLLER_REPORTS"]})).toContain("Another machine connection needs staff verification");
 expect(completedReturnMessage({...transaction,customerHandoffBlocker:"CONTROLLER_DIAGNOSTICS_STALE"})).toContain("out of date");
 expect(completedReturnMessage({...transaction,customerHandoffBlockers:["UNCONFIRMED_PAYMENT_EVENTS"]})).toContain("recorded coins");
});
