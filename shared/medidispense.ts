export type Role = "super_admin" | "admin" | "staff";
export type InventoryStatus = "in_stock" | "low_stock" | "out_of_stock" | "near_expiry" | "expired";
export type TransactionStatus = "payment_pending" | "payment_successful" | "dispensing" | "dispensed" | "failed";

export interface Medicine {
  /** Server-published pharmacist approval only; research drafts are never customer instructions. */
  usageGuidance?: MedicineUsageGuidance | null;
  /** Live backend readiness of the shared dispensing channel. */
  machineReady?: boolean;
  slotReady?: boolean;
  availableForPurchase?: boolean;
  unavailableReason?: string | null;
  id: number;
  name: string;
  genericName: string;
  category: string;
  description: string;
  dosage: string;
  instructions: string;
  stockQuantity: number;
  /** Available after active reservations; stockQuantity remains recorded on-hand stock in admin views. */
  availableStockQuantity?: number;
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

export interface MedicineUsageGuidance {
  approvalStatus: "approved";
  medicineName: string;
  strength: string;
  formulation: string;
  purpose: string;
  ageGroup: string;
  dose: string;
  frequency: string;
  minimumInterval?: string | null;
  maximumDailyDose?: string | null;
  precautions: string;
  sourceLabel: string;
  sourceUrl: string;
  approvedAt: string;
  reviewDueAt: string;
}

export interface TransactionItem {
  medicineId: number;
  medicineName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface DispenseIssueDetails {
  transaction: Transaction;
  recordedStock: number;
  returnEligibility: { ready: boolean; blockers: Array<{code:string;message:string}>; warnings?:Array<{code:string;message:string}> };
  history: Array<{
    revision: number; adminId: number; createdAt: string; outcome: string;
    originalDispensingStatus: string; verifiedQuantity: number; sensorConfirmedQuantity: number;
    notes: string; obligationStatus: string; obligationReference: string; reviewRequired: boolean;
    physicalStock?: number | null; inspectionComplete?: boolean; request_key?: string;
  }>;
}

export interface Transaction {
  receipt?: {
    eligible:boolean; blockers:string[]; paymentFinalized:boolean;
    paymentMethod:'coins'|null; deliveredQuantity:number;
    recordedPaymentMethod?:string|null;
    deliveryVerification:'sensor'|'admin_physical'|null;
  };
  /** Backend confirmation of physical session isolation; never inferred from payment success. */
  customerHandoffSafe?: boolean;
  customerHandoffMode?: "controlled_demo_assumption" | "unverified";
  customerHandoffBlocker?: string | null;
  /** Present only after persisted backend expiry, never inferred from a zero balance. */
  paymentExpiry?: { confirmed: true; returnAtMs: number } | null;
  /** Advisory only until hardware can inhibit and reconcile buffered coin pulses. */
  paymentWindow?: {
    controlledDemonstration?: boolean;
    controlledDemoAutoBinding?: boolean;
    expirationBlockers?: string[];
    serverNowMs: number;
    deadlineMs: number;
    automaticExpirationEnabled: boolean;
    hardwarePauseSupported: false;
  };
  /** Server-measured seconds since dispatch (or request creation while queued). */
  dispensingWaitSeconds?: number;
  /** Explicit admin recovery, never inferred from motor timeout or Firebase alone. */
  adminRecovered?: boolean;
  /** Persisted physical count audit; recovery alone does not reopen a slot. */
  stockReconciled?: boolean;
  sensorConfirmedQuantity?: number;
  issueRecovery?: {
    revision: number;
    outcome: "dispensed_sensor_missed" | "not_dispensed" | "partial";
    verifiedQuantity: number;
    sensorConfirmedQuantity: number;
    requestedQuantity: number;
    reviewRequired: boolean;
    machineReviewRequired?: boolean;
    customerObligationPending?: boolean;
    inspectionComplete: boolean;
    stockVerified: boolean;
    returnRequested: boolean;
    machineReuseReady: boolean;
    obligationStatus: "pending" | "delivery_verified" | "refund_documented" | "replacement_documented";
  } | null;
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
  currency?: string;
  total: number;
  amountPaid: number;
  change: number;
  paymentStatus: "pending" | "successful" | "failed" | "cancelled";
  dispensingStatus: "pending" | "dispensing" | "dispensed" | "failed" | "timeout" | "cancelled";
  createdAt: string;
  slotNumber: number | null;
}

export interface TransactionRecordDetails {
  transaction:Transaction;
  reason:string|null;
  history:Array<{id:number;actorId:number|null;action:string;description:string;createdAt:string;details:Record<string,unknown>}>;
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
  availableQuantity?: number;
  minimumStockLevel?: number;
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
  monitoringSource?: string;
  controllerDeviceId?: string | null;
  controllerAmbiguous?: boolean;
  heartbeatAgeSeconds?: number | null;
  heartbeatAtMs?: number | null;
  componentReports?: { controller: boolean; dispenser: boolean; detection: boolean; payment: boolean };
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
  incidentId?: number;
  details?: Record<string, unknown>;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  emailStatus?: string | null;
  id: number;
  kind: "low_stock" | "out_of_stock" | "near_expiry" | "expired" | "dispensing_failure" | "stock_added" | "system";
  title: string;
  message: string;
  severity: "info" | "warning" | "danger";
  createdAt: string;
  read: boolean;
}
