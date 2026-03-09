import { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { appSettings } from "../../../drizzle/schema";
import { logger } from "../logger";

/**
 * Express middleware that blocks requests when the tenant (or platform) is in maintenance mode.
 * Must run AFTER requireAuthMiddleware so that req.user is populated.
 * Exempt: tenant 1 (platform admin) is never blocked.
 */
export const requireNotMaintenance = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        if (!user || user.tenantId === 1) return next(); // platform admin or unauthenticated (let auth middleware handle)

        const db = await getDb();
        if (!db) return next();

        // Check tenant-specific maintenance
        const [settings] = await db.select({ maintenanceMode: appSettings.maintenanceMode })
            .from(appSettings).where(eq(appSettings.tenantId, user.tenantId)).limit(1);

        // Check platform-wide maintenance (tenant 1)
        const [platformSettings] = await db.select({ maintenanceMode: appSettings.maintenanceMode })
            .from(appSettings).where(eq(appSettings.tenantId, 1)).limit(1);

        const tenantMaint = (settings?.maintenanceMode as any);
        const platformMaint = (platformSettings?.maintenanceMode as any);
        const active = tenantMaint?.enabled ? tenantMaint : (platformMaint?.enabled ? platformMaint : null);

        if (active) {
            return res.status(503).json({
                error: "Maintenance",
                message: active.message || "Sistema en mantenimiento. Volvemos pronto.",
            });
        }

        next();
    } catch (err) {
        logger.warn({ err }, "[Maintenance] HTTP middleware check failed, allowing through");
        next();
    }
};
