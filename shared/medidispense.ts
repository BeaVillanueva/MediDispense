export type Role = "super_admin" | "admin" | "staff";
export type InventoryStatus = "in_stock" | "low_stock" | "out_of_stock" | "near_expiry" | "expired";
export type TransactionStatus = "payment_pending" | "payment_successful" | "dispensing" | "dispensed" | "failed";

export interface Medicine {
  id: number;
  name: string;
  genericName: string;
  category: string;
  description: string;
  dosage: string;
  instructions: string;
  stockQuantity: number;
  minimumStockLevel: number;
  price: number;
  expiryDate: string;
  imageUrl: string;
  slotNumber: number | null;
  status: InventoryStatus;
  enabled: boolean;
  dateAdded: string;
  updatedAt: string;
}

export interface TransactionItem {
  medicineId: number;
  medicineName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface Transaction {
  databaseId?: number;
  insertedAmount?: number;
  remainingAmount?: number;
  overpaymentAmount?: number;
  dispensingRequestId?: number | null;
  /** Unit-level preview progress; optional for legacy ledger records. */
  requestedQuantity?: number;
  dispensedQuantity?: number;
  id: string;
  items: TransactionItem[];
  total: number;
  amountPaid: number;
  change: number;
  paymentStatus: "pending" | "successful" | "failed" | "cancelled";
  dispensingStatus: "pending" | "dispensing" | "dispensed" | "failed" | "timeout" | "cancelled";
  createdAt: string;
  slotNumber: number | null;
}

export interface DashboardSummary {
  totalMedicines: number;
  totalStock: number;
  lowStock: number;
  outOfStock: number;
  nearExpiry: number;
  expired: number;
  todaysTransactions: number;
  todaysSales: number;
  pendingDispensing: number;
  salesTrend: { label: string; value: number }[];
  categoryMix: { label: string; value: number }[];
}

export interface MachineSlot {
  slotNumber: number;
  medicineId: number | null;
  medicineName: string | null;
  motorId: string;
  sensorId: string;
  quantity: number;
  status: "ready" | "low" | "empty" | "blocked";
  lastDispensingAt: string | null;
}

export interface MachineStatus {
  machineName: string;
  machineId: string;
  online: boolean;
  lastCommunication: string;
  esp32Status: string;
  motorStatus: string;
  sensorStatus: string;
  coinAcceptorStatus: string;
  slots: MachineSlot[];
}

export interface Alert {
  id: number;
  kind: "low_stock" | "out_of_stock" | "near_expiry" | "expired" | "dispensing_failure" | "system";
  title: string;
  message: string;
  severity: "info" | "warning" | "danger";
  createdAt: string;
  read: boolean;
}
