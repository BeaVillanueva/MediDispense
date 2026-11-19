export interface SlotMaintenance {
  request_key: string;
  status: "active" | "completed";
  action: "add" | "remove" | "replace" | "restock";
  slot_id: number;
  slot_number: number;
  old_medicine_id: number | null;
  old_name: string | null;
  old_quantity: number;
  actor_id: number;
  started_at: string;
}
export interface SlotOverview {
  slots: {
    id: number;
    slot_number: number;
    medicine_id: number | null;
    name: string | null;
    quantity: number;
    reserved_quantity: number;
    minimum_stock_level: number | null;
    assignment_status: "AVAILABLE" | "OCCUPIED" | "BLOCKED" | "DISABLED";
    slot_status: string;
  }[];
  operation: SlotMaintenance | null;
}
