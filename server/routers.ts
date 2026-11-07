import type { InventoryReportData } from "@shared/inventoryReport";
import {
  demoEnabled,
  phpRequest,
  phpMedicines,
  phpSummary,
  phpTransactions,
  phpAlerts,
  phpMachine,
} from "./phpApi";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME, DEFAULT_LOW_STOCK_THRESHOLD } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { permissionProcedure, publicProcedure, router } from "./_core/trpc";
import { store } from "./medidispenseStore";
import { storagePut } from "./storage";
import { Buffer } from "node:buffer";

const medicineInput = z.object({
  name: z.string().min(2),
  genericName: z.string().min(2),
  category: z.string().min(2),
  description: z.string().min(5),
  dosage: z.string().min(5),
  instructions: z.string().min(5),
  stockQuantity: z.number().int().min(0).max(10),
  minimumStockLevel: z.number().int().min(0).default(DEFAULT_LOW_STOCK_THRESHOLD),
  price: z.number().min(0),
  expiryDate: z.string(),
  imageUrl: z.string().url().or(z.literal("")),
  slotNumber: z.number().int().min(1).nullable(),
  enabled: z.boolean(),
});

const profilePhotoInput = z.object({
  dataBase64: z.string().min(1).max(2_800_000),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
function decodeProfilePhoto(dataBase64: string, contentType: string) {
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024)
    throw new Error("Profile photos must be no larger than 2 MB.");
  const valid =
    contentType === "image/png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : contentType === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid)
    throw new Error("The uploaded file does not match its image type.");
  return bytes;
}
async function uploadProfilePhoto(
  uid: string,
  dataBase64: string,
  contentType: string
) {
  const bytes = decodeProfilePhoto(dataBase64, contentType);
  const extension =
    contentType === "image/jpeg"
      ? "jpg"
      : contentType === "image/png"
        ? "png"
        : "webp";
  return storagePut(`profile-photos/${uid}.${extension}`, bytes, contentType);
}
async function saveOwnPhoto(
  ctx: { req: { headers: { authorization?: string; cookie?: string } } },
  url: string
) {
  const apiUrl = process.env.MEDIDISPENSE_PHP_API_URL?.replace(/\/$/, "");
  const authorization = ctx.req.headers.authorization;
  if (!apiUrl || !authorization)
    throw new Error("Profile photo storage is not configured.");
  const response = await fetch(`${apiUrl}/api/profile/photo`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      Cookie: ctx.req.headers.cookie ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ profile_image_url: url }),
  });
  if (!response.ok)
    throw new Error(
      "Could not save the profile photo to the employee profile."
    );
}

const previewProcedure = publicProcedure.use(async ({ next }) => {
  if (!demoEnabled())
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "In-memory kiosk simulation is disabled.",
    });
  return next();
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const options = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...options, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  profile: router({
    uploadPhoto: permissionProcedure("profile.manage")
      .input(profilePhotoInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.employeeFirebaseUid)
          throw new Error("The employee profile is not available.");
        const uploaded = await uploadProfilePhoto(
          ctx.employeeFirebaseUid,
          input.dataBase64,
          input.contentType
        );
        await saveOwnPhoto(ctx, uploaded.url);
        return { profileImageUrl: uploaded.url };
      }),
    uploadEmployeePhoto: permissionProcedure("employees.edit")
      .input(
        profilePhotoInput.extend({ firebaseUid: z.string().min(1).max(128) })
      )
      .mutation(async ({ input }) => {
        const uploaded = await uploadProfilePhoto(
          input.firebaseUid,
          input.dataBase64,
          input.contentType
        );
        return { profileImageUrl: uploaded.url };
      }),
  }),
  dashboard: router({
    summary: permissionProcedure("dashboard.view").query(({ ctx }) =>
      demoEnabled() ? store.summary() : phpSummary(ctx)
    ),
  }),
  medicines: router({
    options: permissionProcedure("medicines.edit").query(({ ctx }) => phpRequest<{ categories: string[]; slots: { slot_number: number; medicine_id: number | null }[] }>(ctx, "/api/medicine-options")),
    update: permissionProcedure("medicines.edit")
      .input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(2).max(180), category: z.string().trim().min(1), price: z.number().finite().min(0).max(99999999.99), expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slotNumber: z.number().int().positive().nullable() }))
      .mutation(({ ctx, input }) => {
        if (demoEnabled()) throw new TRPCError({ code: "BAD_REQUEST", message: "Catalog editing requires the PHP database connection." });
        return phpRequest(ctx, `/api/medicines/${input.id}`, "PATCH", { name: input.name, category_name: input.category, unit_price: input.price, expiry_date: input.expiryDate, slot_number: input.slotNumber });
      }),
    archive: permissionProcedure("medicines.archive")
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ ctx, input }) => {
        if (demoEnabled()) throw new TRPCError({ code: "BAD_REQUEST", message: "Catalog deletion requires the PHP database connection." });
        return phpRequest(ctx, `/api/medicines/${input.id}`, "DELETE");
      }),
    list: permissionProcedure("medicines.view").query(({ ctx }) =>
      demoEnabled() ? store.listMedicines(true) : phpMedicines(ctx)
    ),
    create: permissionProcedure("medicines.create")
      .input(medicineInput)
      .mutation(async ({ ctx, input }) => {
        if (demoEnabled()) return store.createMedicine(input);
        const created = await phpRequest<{ id: number }>(
          ctx,
          "/api/medicines",
          "POST",
          {
            name: input.name,
            generic_name: input.genericName,
            category_name: input.category,
            description: input.description,
            dosage_information: input.dosage,
            usage_instructions: input.instructions,
            unit_price: input.price,
            expiry_date: input.expiryDate,
            minimum_stock_level: input.minimumStockLevel,
            stock_quantity: input.stockQuantity,
            image_url: input.imageUrl,
            is_enabled: input.enabled,
            slot_number: input.slotNumber,
          }
        );
        return (await phpMedicines(ctx)).find(item => item.id === created.id)!;
      }),
  }),
  inventory: router({
    restock: permissionProcedure("inventory.adjust")
      .input(z.object({ medicineId: z.number().int().positive(), quantity: z.number().int().positive().max(10) }))
      .mutation(async ({ ctx, input }) => {
        if (demoEnabled()) { const current = store.getMedicine(input.medicineId); if (!current || current.stockQuantity + input.quantity > 10) throw new TRPCError({ code: "BAD_REQUEST", message: "Stock cannot exceed 10 items." }); return store.adjustStock(input.medicineId, input.quantity, "Restock"); }
        await phpRequest(ctx, "/api/inventory/adjust", "PATCH", {
          medicine_id: input.medicineId, delta: input.quantity, reason: "Restock", operation: "restock",
        });
        return (await phpMedicines(ctx)).find(item => item.id === input.medicineId)!;
      }),
    adjust: permissionProcedure("inventory.adjust")
      .input(
        z.object({
          medicineId: z.number().int(),
          delta: z.number().int(),
          reason: z.string().min(2),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (demoEnabled()) { const current = store.getMedicine(input.medicineId); if (input.delta > 0 && (!current || current.stockQuantity + input.delta > 10)) throw new TRPCError({ code: "BAD_REQUEST", message: "Stock cannot exceed 10 items." }); return store.adjustStock(input.medicineId, input.delta, input.reason); }
        await phpRequest(ctx, "/api/inventory/adjust", "PATCH", {
          medicine_id: input.medicineId,
          delta: input.delta,
          reason: input.reason,
        });
        return (await phpMedicines(ctx)).find(
          item => item.id === input.medicineId
        )!;
      }),
  }),
  transactions: router({
    recoverStopped: permissionProcedure("inventory.adjust")
      .input(z.object({ id: z.number().int().positive(), transactionCode: z.string().min(1), motorStopped: z.literal(true), controllerDisconnected: z.literal(true), reason: z.string().trim().min(5).max(500), physicalStock: z.number().int().min(0).max(10).optional() }))
      .mutation(({ ctx, input }) => phpRequest(ctx, `/api/transactions/${input.id}/recover-stopped`, "POST", {
        transaction_code: input.transactionCode, motor_stopped: input.motorStopped,
        controller_disconnected: input.controllerDisconnected, reason: input.reason,
        ...(input.physicalStock === undefined ? {} : { physical_stock: input.physicalStock }),
      })),
    list: permissionProcedure("transactions.view").query(({ ctx }) =>
      demoEnabled() ? store.listTransactions() : phpTransactions(ctx)
    ),
  }),
  kiosk: router({
    medicines: previewProcedure.query(() => store.listMedicines(false)),
    checkout: previewProcedure
      .input(
        z.object({
          items: z
            .array(
              z.object({
                medicineId: z.number().int(),
                quantity: z.number().int().min(1),
              })
            )
            .length(1),
        })
      )
      .mutation(({ input }) => store.checkout(input.items)),
    verifyPayment: previewProcedure
      .input(
        z.object({ transactionId: z.string(), amountPaid: z.number().min(0) })
      )
      .mutation(({ input }) =>
        store.verifyPayment(input.transactionId, input.amountPaid)
      ),
    requestDispense: previewProcedure
      .input(z.object({ transactionId: z.string() }))
      .mutation(({ input }) => store.requestDispense(input.transactionId)),
    verifyDispense: previewProcedure
      .input(
        z.object({
          transactionId: z.string(),
          success: z.boolean(),
          unitNumber: z.number().int().min(1).optional(),
        })
      )
      .mutation(({ input }) =>
        store.verifyDispense(
          input.transactionId,
          input.success,
          input.unitNumber
        )
      ),
  }),
  machine: router({
    status: permissionProcedure("machine.view").query(({ ctx }) =>
      demoEnabled() ? store.getMachine() : phpMachine(ctx)
    ),
    ping: permissionProcedure("machine.operate").mutation(({ ctx }) =>
      demoEnabled() ? store.pingMachine() : phpMachine(ctx)
    ),
  }),
  notifications: router({
    dismissAll: permissionProcedure("dashboard.view")
      .input(z.object({throughId:z.number().int().positive()}))
      .mutation(({ctx,input})=>phpRequest<{dismissed:number}>(ctx,"/api/notifications/dismiss-all","POST",{through_id:input.throughId})),
    manage: permissionProcedure("dashboard.view")
      .input(z.object({ id: z.number().int().positive(), action: z.enum(["read","acknowledge","resolve"]), reason: z.string().max(500).optional() }))
      .mutation(({ctx,input})=>phpRequest(ctx, `/api/notifications/${input.id}/${input.action}`, "POST", { reason: input.reason ?? "" })),
    status: permissionProcedure("dashboard.view").query(({ctx})=>phpRequest<{installed:boolean;smtpConfigured:boolean;workerLastSeen:string|null;workerOnline:boolean}>(ctx,"/api/notifications/status")),
    recipients: permissionProcedure("settings.manage").query(({ctx})=>phpRequest<{id:number;display_name:string;email:string;role_code:string;low_stock:number;dispensing_failure:number}[]>(ctx,"/api/notifications/recipients")),
    saveRecipients: permissionProcedure("settings.manage")
      .input(z.array(z.object({user_id:z.number().int().positive(),low_stock:z.boolean(),dispensing_failure:z.boolean()})).max(100))
      .mutation(({ctx,input})=>phpRequest(ctx,"/api/notifications/recipients","PUT",{recipients:input})),
    emailJobs: permissionProcedure("settings.manage").query(({ctx})=>phpRequest<{id:number;incident_id:number;recipient:string;status:string;attempts:number;last_error:string|null;history:{attempted_at:string;outcome:string;detail:string|null}[]}[]>(ctx,"/api/notifications/email-jobs")),
    retryEmail: permissionProcedure("settings.manage")
      .input(z.object({id:z.number().int().positive(),reason:z.string().min(5).max(500),providerNotAccepted:z.literal(true)}))
      .mutation(({ctx,input})=>phpRequest(ctx,`/api/notifications/email-jobs/${input.id}/retry`,"POST",{reason:input.reason,provider_not_accepted:input.providerNotAccepted})),
    list: permissionProcedure("dashboard.view").query(({ ctx }) =>
      demoEnabled() ? store.listAlerts() : phpAlerts(ctx)
    ),
  }),
  reports: router({
    inventory: permissionProcedure("reports.view").query(({ ctx }) => phpRequest<InventoryReportData>(ctx, "/api/reports/inventory")),
    activity: permissionProcedure("reports.export")
      .input(z.object({ event: z.enum(["generated", "exported"]), report_type: z.enum(["all", "inventory", "transactions", "sales"]), record_count: z.number().int().nonnegative(), start_date: z.string(), end_date: z.string(), status: z.string(), payment: z.string(), medicine: z.string().max(200), search: z.string().max(200) }))
      .mutation(({ ctx, input }) => phpRequest(ctx, "/api/reports/activity", "POST", input)),
    basic: permissionProcedure("reports.basic.view").query(async ({ ctx }) => {
      if (!demoEnabled()) {
        const r = await phpRequest<any>(ctx, "/api/reports/basic");
        return {
          date: r.date,
          inventory: {
            medicineCount: r.inventory.medicine_count,
            unitCount: r.inventory.unit_count,
          },
          lowStock: r.low_stock,
          outOfStock: r.out_of_stock,
          dailyTransactions: (await phpTransactions(ctx)).filter(
            transaction => transaction.createdAt.slice(0, 10) === r.date
          ),
        };
      }
      const medicines = store.listMedicines(true);
      const today = new Date().toISOString().slice(0, 10);
      const dailyTransactions = store
        .listTransactions()
        .filter(transaction => transaction.createdAt.slice(0, 10) === today);
      return {
        date: today,
        inventory: {
          medicineCount: medicines.length,
          unitCount: medicines.reduce(
            (total, item) => total + item.stockQuantity,
            0
          ),
        },
        lowStock: medicines.filter(item => item.status === "low_stock"),
        outOfStock: medicines.filter(item => item.status === "out_of_stock"),
        dailyTransactions,
      };
    }),
    inventoryCsv: permissionProcedure("reports.export").query(
      async ({ ctx }) => {
        if (demoEnabled()) return store.inventoryCsv();
        const rows = await phpMedicines(ctx);
        return (
          "Medicine,Category,Quantity,Price,Expiry,Status,Slot\n" +
          rows
            .map(r =>
              [
                r.name,
                r.category,
                r.stockQuantity,
                r.price,
                r.expiryDate,
                r.status,
                r.slotNumber ?? "",
              ]
                .map(v => `"${String(v).replaceAll('"', '""')}"`)
                .join(",")
            )
            .join("\n")
        );
      }
    ),
  }),
});
export type AppRouter = typeof appRouter;
