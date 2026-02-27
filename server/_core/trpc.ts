import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getDb } from "../db";
import { appSettings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { computeEffectiveRole } from "./rbac";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next, path } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // If user is disabled, treat as logged out
  if ((ctx.user as any).isActive === false) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // BILLING LOCK: Query tenant status and trial expiry to enforce suspension
  const db = await getDb();
  if (db && ctx.user.tenantId !== 1) { // Skip platform tenant
    const { tenants } = await import("../../drizzle/schema");
    const tenantRows = await db.select({
      status: tenants.status,
      plan: tenants.plan,
      trialEndsAt: (tenants as any).trialEndsAt,
    }).from(tenants).where(eq(tenants.id, ctx.user.tenantId)).limit(1);

    const tenant = tenantRows[0];
    if (tenant) {
      // Check if tenant is suspended
      if (tenant.status === "suspended") {
        const isAllowed = path.startsWith("auth.") || path.startsWith("billing.") || path.startsWith("settings.getBilling") || path.startsWith("trial.");
        if (!isAllowed) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "PAYMENT_REQUIRED: Su cuenta se encuentra suspendida. Por favor, actualice su método de pago."
          });
        }
      }

      // Check if trial has expired (auto-downgrade to free)
      const trialEnd = (tenant as any).trialEndsAt as Date | null;
      if (trialEnd && new Date() > trialEnd && tenant.plan !== "free") {
        // Auto-downgrade: set plan to free and clear trial
        await db.update(tenants).set({
          plan: "free",
          trialEndsAt: null,
        } as any).where(eq(tenants.id, ctx.user.tenantId));
      }
    }
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      tenantId: ctx.user.tenantId,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

// --- Pro RBAC / Permissions ---

export type Role = "owner" | "admin" | "supervisor" | "agent" | "viewer";

/**
 * DEFAULT_PERMISSIONS_MATRIX
 * 
 * Complete permissions matrix covering ALL modules in the system.
 * FIX (RBAC-01): Added helpdesk.*, backups.*, and ensured all router-used
 * permission domains are represented.
 * 
 * FIX (PROD-01): Agent role restricted — no leads.delete, no leads.export,
 * no leads.import by default. Agents can view, create, update leads and
 * use chat/scheduling. Deletion is reserved for supervisor+.
 */
const DEFAULT_PERMISSIONS_MATRIX: Record<Role, string[]> = {
  owner: ["*"],
  admin: [
    "dashboard.*",
    "leads.*",
    "kanban.*",
    "campaigns.*",
    "chat.*",
    "helpdesk.*",
    "scheduling.*",
    "monitoring.*",
    "analytics.*",
    "reports.*",
    "integrations.*",
    "settings.*",
    "users.*",
    "backups.*",
  ],
  supervisor: [
    "dashboard.view",
    "leads.view",
    "leads.update",
    "leads.create",
    "kanban.view",
    "kanban.update",
    "chat.*",
    "helpdesk.*",
    "monitoring.*",
    "analytics.view",
    "reports.view",
    "scheduling.view",
  ],
  agent: [
    "dashboard.view",
    "leads.view",
    "leads.create",
    "leads.update",
    "leads.edit",
    "kanban.view",
    "kanban.update",
    "chat.view",
    "chat.send",
    "helpdesk.view",
    "scheduling.*",
  ],
  viewer: [
    "dashboard.view",
    "leads.view",
    "kanban.view",
    "analytics.view",
    "reports.view",
    "helpdesk.view",
  ],
};

function matchPermission(granted: string, required: string): boolean {
  if (granted === "*") return true;
  if (granted === required) return true;
  if (granted.endsWith(".*")) {
    const base = granted.slice(0, -2);
    return required.startsWith(base + ".");
  }
  return false;
}

async function loadPermissionsMatrix(tenantId: number): Promise<Record<string, string[]>> {
  const db = await getDb();
  if (!db) return DEFAULT_PERMISSIONS_MATRIX;

  const existing = await db.select().from(appSettings).where(eq(appSettings.tenantId, tenantId)).limit(1);
  if (existing.length === 0) {
    await db.insert(appSettings).values({
      tenantId,
      companyName: "Imagine Lab CRM",
      timezone: "America/Asuncion",
      language: "es",
      currency: "PYG",
      permissionsMatrix: DEFAULT_PERMISSIONS_MATRIX,
      scheduling: { slotMinutes: 15, maxPerSlot: 6, allowCustomTime: true },
    });
    return DEFAULT_PERMISSIONS_MATRIX;
  }

  return existing[0]?.permissionsMatrix ?? DEFAULT_PERMISSIONS_MATRIX;
}

async function hasPermission(role: string, required: string, tenantId: number): Promise<boolean> {
  // Owner is god mode
  if (role === "owner") return true;
  const matrix = await loadPermissionsMatrix(tenantId);
  const grantedList = matrix[role] ?? [];
  return grantedList.some(p => matchPermission(p, required));
}

export const permissionProcedure = (permission: string) =>
  protectedProcedure.use(
    t.middleware(async opts => {
      const { ctx, next } = opts;

      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
      }

      // Disabled user cannot access anything
      if ((ctx.user as any).isActive === false) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
      }

      const baseRole = (ctx.user as any).role ?? "agent";
      const customRole = (ctx.user as any).customRole as string | undefined;

      // Permission check logged at debug level only (no console.log in production)

      // Load permissions matrix for validation
      const matrix = await loadPermissionsMatrix(ctx.user.tenantId);

      // CRITICAL: Use helper to prevent owner escalation via customRole
      const effectiveRole = computeEffectiveRole({
        baseRole,
        customRole,
        permissionsMatrix: matrix,
      });

      const allowed = await hasPermission(effectiveRole, permission, ctx.user.tenantId);
      if (!allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }

      return next({
        ctx: {
          ...ctx,
          user: ctx.user,
          tenantId: ctx.user.tenantId,
        },
      });
    })
  );

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || (ctx.user.role !== 'admin' && (ctx.user as any).role !== 'owner')) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        tenantId: ctx.user.tenantId,
      },
    });
  }),
);
