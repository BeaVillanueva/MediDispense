import { phpBase, demoEnabled } from "../phpApi";
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { hasPermission, type EmployeeRole } from "@shared/rbac";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export function permissionProcedure(permission: string) {
  return t.procedure.use(t.middleware(async ({ ctx, next }) => {
    // Keep the isolated in-memory demo usable in development. Production
    // requires the PHP profile bridge and a server-verified employee role.
    if (demoEnabled()) return next();
    if (!ctx.employeeRole) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    if (!hasPermission(ctx.employeeRole as EmployeeRole, permission)) throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    return next();
  }));
}

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
