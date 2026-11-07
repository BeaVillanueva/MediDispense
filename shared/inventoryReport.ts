export interface InventoryReportItem {
  id: number; name: string; quantity: number; reserved: number; available: number;
  threshold: number; expiry: string | null; updatedAt: string;
}
export interface StockMovement {
  id: number; medicineId: number; name: string; previous: number; next: number;
  change: number; type: string; reason: string; actor: string; createdAt: string;
}
export interface InventoryReportData { items: InventoryReportItem[]; movements: StockMovement[] }
export function inventoryStockStatus(item: InventoryReportItem) {
  return item.available === 0 ? "out_of_stock" : item.available <= item.threshold ? "low_stock" : "in_stock";
}
