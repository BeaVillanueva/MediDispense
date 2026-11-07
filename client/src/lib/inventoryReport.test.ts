import { expect, it } from "vitest";
import { inventoryStockStatus, type InventoryReportItem } from "@shared/inventoryReport";
it("classifies available stock independently of expiry and handles threshold boundaries", () => {
  const item: InventoryReportItem = {id:1,name:"Medicine",quantity:10,reserved:5,available:5,threshold:5,expiry:"2020-01-01",updatedAt:"2026-11-01"};
  expect(inventoryStockStatus(item)).toBe("low_stock");
  expect(inventoryStockStatus({...item,available:6})).toBe("in_stock");
  expect(inventoryStockStatus({...item,available:0})).toBe("out_of_stock");
});
