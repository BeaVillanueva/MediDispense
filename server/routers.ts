import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { store } from "./medidispenseStore";

const medicineInput = z.object({ name: z.string().min(2), genericName: z.string().min(2), category: z.string().min(2), description: z.string().min(5), dosage: z.string().min(5), instructions: z.string().min(5), stockQuantity: z.number().int().min(0), minimumStockLevel: z.number().int().min(0), price: z.number().min(0), expiryDate: z.string(), imageUrl: z.string().url().or(z.literal("")), slotNumber: z.number().int().min(1).nullable(), enabled: z.boolean() });

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { const options = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...options, maxAge: -1 }); return { success: true } as const; }),
  }),
  dashboard: router({ summary: publicProcedure.query(() => store.summary()) }),
  medicines: router({ list: publicProcedure.query(() => store.listMedicines(true)), create: publicProcedure.input(medicineInput).mutation(({ input }) => store.createMedicine(input)) }),
  inventory: router({ adjust: publicProcedure.input(z.object({ medicineId: z.number().int(), delta: z.number().int(), reason: z.string().min(2) })).mutation(({ input }) => store.adjustStock(input.medicineId, input.delta, input.reason)) }),
  transactions: router({ list: publicProcedure.query(() => store.listTransactions()) }),
  kiosk: router({ medicines: publicProcedure.query(() => store.listMedicines(false)), checkout: publicProcedure.input(z.object({ items: z.array(z.object({ medicineId: z.number().int(), quantity: z.number().int().min(1) })).min(1) })).mutation(({ input }) => store.checkout(input.items)), verifyPayment: publicProcedure.input(z.object({ transactionId: z.string(), amountPaid: z.number().min(0) })).mutation(({ input }) => store.verifyPayment(input.transactionId, input.amountPaid)), requestDispense: publicProcedure.input(z.object({ transactionId: z.string() })).mutation(({ input }) => store.requestDispense(input.transactionId)), verifyDispense: publicProcedure.input(z.object({ transactionId: z.string(), success: z.boolean() })).mutation(({ input }) => store.verifyDispense(input.transactionId, input.success)) }),
  machine: router({ status: publicProcedure.query(() => store.getMachine()), ping: publicProcedure.mutation(() => store.pingMachine()) }),
  notifications: router({ list: publicProcedure.query(() => store.listAlerts()) }),
  reports: router({ inventoryCsv: publicProcedure.query(() => store.inventoryCsv()) }),
});
export type AppRouter = typeof appRouter;
