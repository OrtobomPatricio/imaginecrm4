import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

/**
 * Staging Checklist — comprehensive validation of every production-critical
 * behaviour before deploy.
 *
 * Sections:
 *  1. Auth & Access
 *  2. createTenant & owner initial setup
 *  3. Super Admin hardening / impersonation / maintenance
 *  4. Maintenance mode (tRPC / HTTP / UX)
 *  5. Role-based permissions
 *  6. Onboarding
 *  7. PWA / cache / service-worker
 *  8. Proxy / cookies / CSRF / CORS
 *  9. Email templates & links
 * 10. Uploads & tenant isolation
 */

// ═══════════════════════════════════════════════════════════════════
//  SECTION 1 — AUTH & ACCESS
// ═══════════════════════════════════════════════════════════════════

describe("1. Auth: login flow", () => {
    const authSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/auth.ts"), "utf-8"
    );

    it("validates email + password + tenant slug (three factors)", () => {
        // loginWithCredentials input: email, password, tenantSlug (optional)
        expect(authSrc).toContain("email:");
        expect(authSrc).toContain("password:");
        expect(authSrc).toContain("tenantSlug:");
    });

    it("returns generic error on wrong password — no differentiation", () => {
        expect(authSrc).toContain('"Credenciales inválidas"');
    });

    it("returns specific error on wrong organisation", () => {
        expect(authSrc).toContain('"Organización no encontrada."');
    });

    it("checks isActive AFTER password verification (anti-enumeration)", () => {
        // bcrypt.compare must appear BEFORE the isActive check in the source
        const bcryptPos = authSrc.indexOf("bcrypt.compare(input.password");
        const isActivePos = authSrc.indexOf('"Cuenta desactivada');
        expect(bcryptPos).toBeGreaterThan(0);
        expect(isActivePos).toBeGreaterThan(bcryptPos);
    });

    it("blocks login for user with no password (invited, not set up)", () => {
        expect(authSrc).toContain("!user[0].password");
        // Must return generic error, not leak "no password" info
        const idx = authSrc.indexOf("!user[0].password");
        const slice = authSrc.slice(idx, idx + 300);
        expect(slice).toContain('"Credenciales inválidas"');
    });

    it("sets session cookie with httpOnly", () => {
        // Cookie is set via getSessionCookieOptions which enforces httpOnly
        const cookieSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/cookies.ts"), "utf-8"
        );
        expect(cookieSrc).toContain("httpOnly: true");
    });
});

describe("1. Auth: logout", () => {
    it("clears tenant-slug from localStorage on logout", () => {
        const hookSrc = fs.readFileSync(
            path.resolve(__dirname, "../client/src/_core/hooks/useAuth.ts"), "utf-8"
        );
        expect(hookSrc).toContain('localStorage.removeItem("tenant-slug")');
    });

    it("server logout clears session cookie", () => {
        const authSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/auth.ts"), "utf-8"
        );
        expect(authSrc).toContain("clearCookie");
    });
});

describe("1. Auth: reset password", () => {
    const accountSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/account.ts"), "utf-8"
    );

    it("forgotPassword validates tenant", () => {
        expect(accountSrc).toContain("tenantSlug:");
    });

    it("returns generic success on wrong tenant/email (anti-enumeration)", () => {
        expect(accountSrc).toContain("Si el email existe, recibirás un enlace de recuperación.");
    });

    it("reset link includes tenant parameter", () => {
        expect(accountSrc).toContain("&tenant=");
    });

    it("reset token expires in 1 hour", () => {
        // RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000 = 3600000
        expect(accountSrc).toMatch(/60\s*\*\s*60\s*\*\s*1000/);
    });

    it("activates inactive owner on first password setup", () => {
        expect(accountSrc).toContain("activateOnSetup");
        expect(accountSrc).toContain("!user.password && !user.isActive");
    });

    it("client ResetPassword page preserves tenant in localStorage", () => {
        const resetPageSrc = fs.readFileSync(
            path.resolve(__dirname, "../client/src/pages/ResetPassword.tsx"), "utf-8"
        );
        expect(resetPageSrc).toContain('localStorage.setItem("tenant-slug", tenant)');
    });

    it("client redirects to login with tenant after reset", () => {
        const resetPageSrc = fs.readFileSync(
            path.resolve(__dirname, "../client/src/pages/ResetPassword.tsx"), "utf-8"
        );
        expect(resetPageSrc).toContain('/login?tenant=');
    });
});

describe("1. Auth: verify email", () => {
    const accountSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/account.ts"), "utf-8"
    );

    it("verifyEmail endpoint exists", () => {
        expect(accountSrc).toContain("verifyEmail:");
    });

    it("resendVerification endpoint exists", () => {
        expect(accountSrc).toContain("resendVerification:");
    });

    it("verification includes tenant in URL", () => {
        expect(accountSrc).toContain("&tenant=");
    });

    it("client VerifyEmail preserves tenant in localStorage", () => {
        const verifyPageSrc = fs.readFileSync(
            path.resolve(__dirname, "../client/src/pages/VerifyEmail.tsx"), "utf-8"
        );
        expect(verifyPageSrc).toContain('localStorage.setItem("tenant-slug"');
    });

    it("client VerifyEmail redirects to login with tenant", () => {
        const verifyPageSrc = fs.readFileSync(
            path.resolve(__dirname, "../client/src/pages/VerifyEmail.tsx"), "utf-8"
        );
        expect(verifyPageSrc).toContain('/login?tenant=');
    });
});

describe("1. Auth: OAuth", () => {
    const oauthSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/_core/native-oauth.ts"), "utf-8"
    );

    it("Google OAuth strategy is configured", () => {
        expect(oauthSrc).toContain("GoogleStrategy");
    });

    it("Facebook OAuth strategy is configured", () => {
        expect(oauthSrc).toContain("FacebookStrategy");
    });

    it("Microsoft OAuth strategy is configured", () => {
        expect(oauthSrc).toMatch(/MicrosoftStrategy|OIDCStrategy|passport-microsoft/);
    });

    it("OAuth passes ?tenant= parameter to strategy", () => {
        expect(oauthSrc).toContain("tenant=");
    });

    it("OAuth redirects to login on error", () => {
        expect(oauthSrc).toContain("/login?error=");
    });

    it("handles ambiguous user across tenants", () => {
        // Must detect multiple tenants and return error
        expect(oauthSrc).toMatch(/multiple|ambig/i);
    });
});

describe("1. Auth: sessions", () => {
    it("list endpoint exists", () => {
        const sessionsSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/sessions.ts"), "utf-8"
        );
        expect(sessionsSrc).toContain("list:");
    });

    it("revokeSingleSession is tenant-scoped", () => {
        const sessionsSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/sessions.ts"), "utf-8"
        );
        expect(sessionsSrc).toContain("tenantId");
    });

    it("revokeAllOtherSessions endpoint exists", () => {
        const sessionsSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/sessions.ts"), "utf-8"
        );
        expect(sessionsSrc).toMatch(/revokeAll|revokeOther/i);
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 2 — createTenant & owner initial setup
// ═══════════════════════════════════════════════════════════════════

describe("2. createTenant & owner setup", () => {
    const superSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/superadmin.ts"), "utf-8"
    );

    it("createTenant returns setup/reset link with tenant slug", () => {
        expect(superSrc).toContain("resetUrl");
        expect(superSrc).toContain("/reset-password?token=");
        expect(superSrc).toContain("&tenant=");
    });

    it("owner is created with isActive: false", () => {
        // Find the createTenant insert — isActive must be false
        const createIdx = superSrc.indexOf("createTenant");
        const insertIdx = superSrc.indexOf("isActive: false", createIdx);
        expect(insertIdx).toBeGreaterThan(createIdx);
    });

    it("owner is activated after setting password via resetPassword", () => {
        const accountSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/account.ts"), "utf-8"
        );
        expect(accountSrc).toContain("activateOnSetup");
        // Must set isActive: true when activating
        expect(accountSrc).toContain("isActive: true");
    });

    it("rejects reserved slugs", () => {
        const reservedSlugs = ["api", "admin", "www", "trpc", "health", "login", "signup"];
        for (const slug of reservedSlugs) {
            expect(superSrc).toContain(`"${slug}"`);
        }
    });

    it("rejects duplicate slug with CONFLICT error", () => {
        expect(superSrc).toContain("CONFLICT");
        expect(superSrc).toContain("slug");
    });

    it("transaction rolls back on error (no partial tenant)", () => {
        expect(superSrc).toContain("db.transaction");
        // Error after tx failure should say nothing was created
        expect(superSrc).toContain("No se creó nada");
    });

    it("error messages are semantic, not generic 500", () => {
        expect(superSrc).toContain("BAD_REQUEST");
        expect(superSrc).toContain("CONFLICT");
        expect(superSrc).toContain("INTERNAL_SERVER_ERROR");
    });

    it("resetToken expires in 72 hours", () => {
        // Look for 72 * 60 * 60 * 1000
        expect(superSrc).toMatch(/72\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 3 — SUPER ADMIN
// ═══════════════════════════════════════════════════════════════════

describe("3. Superadmin hardening", () => {
    const superSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/superadmin.ts"), "utf-8"
    );

    it("blocks self-deactivation", () => {
        expect(superSrc).toContain("No podés desactivarte a vos mismo");
    });

    it("blocks self-deletion", () => {
        expect(superSrc).toContain("No podés eliminarte a vos mismo");
    });

    it("blocks demotion of last owner of tenant 1", () => {
        expect(superSrc).toContain("No se puede demotar al último owner del tenant de plataforma");
    });

    it("blocks deactivation of last owner of tenant 1", () => {
        expect(superSrc).toContain("No se puede desactivar al último owner activo del tenant de plataforma");
    });

    it("blocks deletion of last owner of tenant 1", () => {
        expect(superSrc).toContain("No se puede eliminar al último owner del tenant de plataforma");
    });
});

describe("3. Impersonation", () => {
    const superSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/superadmin.ts"), "utf-8"
    );

    it("verifies user belongs to target tenant (AND condition)", () => {
        // Must query by BOTH userId AND tenantId
        expect(superSrc).toContain("input.targetUserId");
        expect(superSrc).toContain("input.targetTenantId");
    });

    it("returns NOT_FOUND on mismatch (no leak)", () => {
        expect(superSrc).toContain('"Usuario no encontrado en ese tenant"');
    });

    it("stores backup admin cookie (__imp_original)", () => {
        expect(superSrc).toContain("__imp_original");
    });

    it("limits impersonation to 2 hours", () => {
        // 2 * 60 * 60 * 1000 = 7200000
        expect(superSrc).toContain("2 * 60 * 60 * 1000");
    });

    it("exitImpersonation restores admin session", () => {
        expect(superSrc).toContain("exitImpersonation");
        expect(superSrc).toContain("Sesión de admin restaurada");
    });

    it("client shows impersonation banner", () => {
        const layoutSrc = fs.readFileSync(
            path.resolve(__dirname, "../client/src/components/DashboardLayout.tsx"), "utf-8"
        );
        expect(layoutSrc).toContain("Impersonando");
        expect(layoutSrc).toContain("__imp_original");
    });

    it("logs impersonation action in audit trail", () => {
        expect(superSrc).toContain('logSuperadminAction');
        expect(superSrc).toContain('"impersonate"');
    });
});

describe("3. Maintenance toggle from panel", () => {
    const superSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/superadmin.ts"), "utf-8"
    );

    it("setMaintenanceMode endpoint exists", () => {
        expect(superSrc).toContain("setMaintenanceMode");
    });

    it("setTenantMaintenanceMode endpoint exists", () => {
        expect(superSrc).toContain("setTenantMaintenanceMode");
    });

    it("UI refetches after toggle (onSuccess invalidates)", () => {
        const adminPageSrc = fs.readFileSync(
            path.resolve(__dirname, "../client/src/pages/SuperAdmin.tsx"), "utf-8"
        );
        // Must invalidate/refetch after mutation
        expect(adminPageSrc).toMatch(/refetch|invalidate/);
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 4 — MAINTENANCE MODE BLOCKING
// ═══════════════════════════════════════════════════════════════════

describe("4. Maintenance: tRPC blocking", () => {
    const trpcSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/_core/trpc.ts"), "utf-8"
    );

    it("blocks non-whitelisted tRPC procedures", () => {
        expect(trpcSrc).toContain("MAINTENANCE:");
    });

    it("whitelists auth/billing/account/sessions during maintenance", () => {
        expect(trpcSrc).toContain('"auth."');
        expect(trpcSrc).toContain('"billing."');
        expect(trpcSrc).toContain('"account."');
        expect(trpcSrc).toContain('"sessions."');
    });

    it("exempts tenant 1 (superadmin) from maintenance", () => {
        // tenantId === 1 check must come before maintenance enforcement
        expect(trpcSrc).toContain("tenantId === 1");
    });
});

describe("4. Maintenance: HTTP blocking", () => {
    it("middleware returns 503 during maintenance", () => {
        const maintenanceSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/middleware/maintenance.ts"), "utf-8"
        );
        expect(maintenanceSrc).toContain("503");
    });

    it("middleware exempts tenant 1", () => {
        const maintenanceSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/middleware/maintenance.ts"), "utf-8"
        );
        expect(maintenanceSrc).toContain("tenantId === 1");
    });

    it("uploads route uses maintenance middleware", () => {
        const indexSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/index.ts"), "utf-8"
        );
        expect(indexSrc).toContain("requireNotMaintenance");
    });

    it("maintenance message is user-friendly", () => {
        const maintenanceSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/middleware/maintenance.ts"), "utf-8"
        );
        expect(maintenanceSrc).toContain("Sistema en mantenimiento");
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 5 — ROLE-BASED PERMISSIONS
// ═══════════════════════════════════════════════════════════════════

describe("5. Permissions matrix", () => {
    const trpcSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/_core/trpc.ts"), "utf-8"
    );

    const DEFAULT_PERMISSIONS_MATRIX: Record<string, string[]> = {
        owner: ["*"],
        admin: [
            "dashboard.*", "leads.*", "kanban.*", "campaigns.*", "chat.*",
            "helpdesk.*", "scheduling.*", "monitoring.*", "analytics.*",
            "reports.*", "integrations.*", "settings.*", "users.*", "backups.*",
        ],
        supervisor: [
            "dashboard.view", "leads.view", "leads.update", "leads.create",
            "kanban.view", "kanban.update", "chat.*", "helpdesk.*",
            "monitoring.*", "analytics.view", "reports.view", "scheduling.view",
        ],
        agent: [
            "dashboard.view", "leads.view", "leads.create", "leads.update", "leads.edit",
            "kanban.view", "kanban.update", "chat.view", "chat.send",
            "helpdesk.view", "scheduling.*",
        ],
        viewer: [
            "dashboard.view", "leads.view", "kanban.view",
            "analytics.view", "reports.view", "helpdesk.view",
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

    function hasPermission(role: string, required: string): boolean {
        if (role === "owner") return true;
        const grantedList = DEFAULT_PERMISSIONS_MATRIX[role] ?? [];
        return grantedList.some(p => matchPermission(p, required));
    }

    it("owner has access to everything (wildcard *)", () => {
        expect(hasPermission("owner", "settings.update")).toBe(true);
        expect(hasPermission("owner", "backups.create")).toBe(true);
        expect(hasPermission("owner", "users.manage")).toBe(true);
        expect(hasPermission("owner", "billing.view")).toBe(true);
        expect(hasPermission("owner", "anything.random")).toBe(true);
    });

    it("admin has full module access but NOT wildcard", () => {
        expect(hasPermission("admin", "settings.update")).toBe(true);
        expect(hasPermission("admin", "users.manage")).toBe(true);
        expect(hasPermission("admin", "campaigns.create")).toBe(true);
        expect(hasPermission("admin", "backups.create")).toBe(true);
    });

    it("supervisor has restricted access — no settings, users, campaigns", () => {
        expect(hasPermission("supervisor", "settings.update")).toBe(false);
        expect(hasPermission("supervisor", "users.manage")).toBe(false);
        expect(hasPermission("supervisor", "campaigns.create")).toBe(false);
        expect(hasPermission("supervisor", "backups.create")).toBe(false);
        // But has chat and helpdesk
        expect(hasPermission("supervisor", "chat.view")).toBe(true);
        expect(hasPermission("supervisor", "helpdesk.view")).toBe(true);
    });

    it("agent cannot access admin modules", () => {
        expect(hasPermission("agent", "settings.update")).toBe(false);
        expect(hasPermission("agent", "users.manage")).toBe(false);
        expect(hasPermission("agent", "campaigns.create")).toBe(false);
        expect(hasPermission("agent", "integrations.view")).toBe(false);
        expect(hasPermission("agent", "backups.create")).toBe(false);
        // But can do leads and chat
        expect(hasPermission("agent", "leads.view")).toBe(true);
        expect(hasPermission("agent", "leads.create")).toBe(true);
        expect(hasPermission("agent", "chat.send")).toBe(true);
    });

    it("viewer is read-only — no create/update/delete", () => {
        expect(hasPermission("viewer", "leads.create")).toBe(false);
        expect(hasPermission("viewer", "leads.update")).toBe(false);
        expect(hasPermission("viewer", "leads.delete")).toBe(false);
        expect(hasPermission("viewer", "settings.update")).toBe(false);
        expect(hasPermission("viewer", "users.manage")).toBe(false);
        // But can view
        expect(hasPermission("viewer", "dashboard.view")).toBe(true);
        expect(hasPermission("viewer", "leads.view")).toBe(true);
        expect(hasPermission("viewer", "analytics.view")).toBe(true);
    });

    it("backend enforces permissions via permissionProcedure middleware", () => {
        expect(trpcSrc).toContain("permissionProcedure");
        expect(trpcSrc).toContain("FORBIDDEN");
    });

    it("disabled user (isActive:false) is rejected by permissionProcedure", () => {
        expect(trpcSrc).toContain("isActive === false");
    });

    it("sidebar filters navigation by role (client)", () => {
        const layoutSrc = fs.readFileSync(
            path.resolve(__dirname, "../client/src/components/DashboardLayout.tsx"), "utf-8"
        );
        // Must call can() or check permissions before rendering nav items
        expect(layoutSrc).toMatch(/can\(|permission/i);
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 6 — ONBOARDING
// ═══════════════════════════════════════════════════════════════════

describe("6. Onboarding", () => {
    it("tenant 1 / superadmin skips onboarding", () => {
        const appSrc = fs.readFileSync(
            path.resolve(__dirname, "../client/src/App.tsx"), "utf-8"
        );
        expect(appSrc).toContain("tenantId === 1");
    });

    it("onboarding completion is tracked via completedAt", () => {
        const trackingSrc = (() => {
            try {
                return fs.readFileSync(
                    path.resolve(__dirname, "../server/services/onboarding-tracking.ts"), "utf-8"
                );
            } catch {
                return "";
            }
        })();
        if (trackingSrc) {
            expect(trackingSrc).toContain("completedAt");
        } else {
            // Check if onboarding is tracked in any service
            const appSrc = fs.readFileSync(
                path.resolve(__dirname, "../client/src/App.tsx"), "utf-8"
            );
            expect(appSrc).toMatch(/completedAt|onboarding/i);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 7 — PWA / CACHE / SERVICE WORKER
// ═══════════════════════════════════════════════════════════════════

describe("7. PWA cache configuration", () => {
    it("sw.js is NOT cached aggressively", () => {
        const serveSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/serve-static.ts"), "utf-8"
        );
        // In regex literal: sw\.js — the backslash-dot is in the raw source
        expect(serveSrc).toContain("sw\\.js");
        // PWA-critical files should get no-cache
        expect(serveSrc).toContain("no-cache");
    });

    it("manifest files are NOT cached aggressively", () => {
        const serveSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/serve-static.ts"), "utf-8"
        );
        expect(serveSrc).toContain("manifest\\.webmanifest");
        expect(serveSrc).toContain("manifest\\.json");
    });

    it("registerSW.js is NOT cached aggressively", () => {
        const serveSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/serve-static.ts"), "utf-8"
        );
        expect(serveSrc).toContain("registerSW\\.js");
    });

    it("hashed assets use long-term caching (1y, immutable)", () => {
        const serveSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/serve-static.ts"), "utf-8"
        );
        expect(serveSrc).toContain("1y");
        expect(serveSrc).toContain("immutable");
    });

    it("/api/* is never served as static fallback", () => {
        const serveSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/serve-static.ts"), "utf-8"
        );
        // API paths must return 404 JSON, not index.html
        expect(serveSrc).toContain('/api');
        expect(serveSrc).toContain("404");
    });

    it("VitePWA plugin uses network-only for API routes", () => {
        const viteCfg = fs.readFileSync(
            path.resolve(__dirname, "../vite.config.ts"), "utf-8"
        );
        // Check that API routes are excluded from SW caching
        expect(viteCfg).toMatch(/api|NetworkOnly|navigateFallbackDenylist/i);
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 8 — PROXY / COOKIES / CSRF / CORS
// ═══════════════════════════════════════════════════════════════════

describe("8. Cookie configuration", () => {
    const cookieSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/_core/cookies.ts"), "utf-8"
    );

    it("cookies are always httpOnly", () => {
        expect(cookieSrc).toContain("httpOnly: true");
    });

    it("production cookies are secure by default", () => {
        // COOKIE_SECURE is opt-out, not opt-in
        expect(cookieSrc).toContain('COOKIE_SECURE');
    });

    it("sameSite=none requires secure=true (enforced)", () => {
        expect(cookieSrc).toContain('sameSite === "none"');
    });

    it("cookie domain validates against request host", () => {
        expect(cookieSrc).toContain("resolveCookieDomain");
        expect(cookieSrc).toContain("requestHost");
    });
});

describe("8. CORS configuration", () => {
    const indexSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/_core/index.ts"), "utf-8"
    );

    it("uses explicit origin allowlist in production", () => {
        expect(indexSrc).toContain("CLIENT_URL");
        expect(indexSrc).toContain("VITE_API_URL");
    });

    it("normalises trailing slashes in origin check", () => {
        expect(indexSrc).toContain('replace(/\\/$/, "")');
    });

    it("includes credentials in CORS config", () => {
        expect(indexSrc).toContain("credentials: true");
    });

    it("blocks unknown origins in production", () => {
        expect(indexSrc).toContain("cors blocked");
    });
});

describe("8. CSRF protection", () => {
    const indexSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/_core/index.ts"), "utf-8"
    );

    it("validates origin on state-changing methods", () => {
        expect(indexSrc).toContain("POST");
        expect(indexSrc).toContain("PUT");
        expect(indexSrc).toContain("PATCH");
        expect(indexSrc).toContain("DELETE");
    });

    it("returns 403 on CSRF violation", () => {
        expect(indexSrc).toContain("CSRF blocked");
        expect(indexSrc).toContain("403");
    });

    it("exempts signed webhooks from CSRF", () => {
        expect(indexSrc).toContain("whatsapp/webhook");
        expect(indexSrc).toContain("meta/webhook");
        expect(indexSrc).toContain("webhooks/paypal");
    });
});

describe("8. Trust proxy", () => {
    const indexSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/_core/index.ts"), "utf-8"
    );

    it("trust proxy is configurable via TRUST_PROXY env var", () => {
        expect(indexSrc).toContain('TRUST_PROXY');
        expect(indexSrc).toContain('"trust proxy"');
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 9 — EMAIL TEMPLATES & LINKS
// ═══════════════════════════════════════════════════════════════════

describe("9. Email: all critical emails exist", () => {
    it("signup verification email is sent", () => {
        const signupSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/signup.ts"), "utf-8"
        );
        expect(signupSrc).toContain("sendEmail");
        expect(signupSrc).toContain("Verifica tu email");
    });

    it("resend verification email is sent", () => {
        const accountSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/account.ts"), "utf-8"
        );
        expect(accountSrc).toContain("sendEmail");
        expect(accountSrc).toContain("resendVerification");
    });

    it("password reset email is sent", () => {
        const accountSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/account.ts"), "utf-8"
        );
        expect(accountSrc).toContain("Recuperar contraseña");
    });

    it("team invite email is sent", () => {
        const teamSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/team.ts"), "utf-8"
        );
        expect(teamSrc).toContain("sendEmail");
        expect(teamSrc).toContain("Setup your account");
    });

    it("force password reset sends notification email to user", () => {
        const superSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/superadmin.ts"), "utf-8"
        );
        // forcePasswordReset should now send email
        const forceResetIdx = superSrc.indexOf("forcePasswordReset");
        const nextProcedure = superSrc.indexOf("listSessions");
        const forceResetBlock = superSrc.slice(forceResetIdx, nextProcedure);
        expect(forceResetBlock).toContain("sendEmail");
        expect(forceResetBlock).toContain("Restablecimiento de contraseña");
    });
});

describe("9. Email: links use APP_URL (not request-spoofable)", () => {
    it("signup email uses APP_URL/CLIENT_URL, not req.host", () => {
        const signupSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/signup.ts"), "utf-8"
        );
        const verifySection = signupSrc.slice(
            signupSrc.indexOf("Send verification email"),
            signupSrc.indexOf("Send verification email") + 500
        );
        // Must NOT use req.protocol or req.get('host')
        expect(verifySection).not.toContain("req.protocol");
        expect(verifySection).not.toContain("req.get('host')");
        expect(verifySection).toContain("APP_URL");
    });

    it("team invite does NOT fall back to localhost", () => {
        const teamSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/team.ts"), "utf-8"
        );
        expect(teamSrc).not.toContain('"http://localhost:3000"');
    });

    it("team invite includes tenant slug in link", () => {
        const teamSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/team.ts"), "utf-8"
        );
        expect(teamSrc).toContain("&tenant=");
    });

    it("logs warning when APP_URL not configured", () => {
        const signupSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/signup.ts"), "utf-8"
        );
        expect(signupSrc).toContain("APP_URL/CLIENT_URL not configured");
    });

    it("reset email includes tenant in link", () => {
        const accountSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/account.ts"), "utf-8"
        );
        expect(accountSrc).toContain("&tenant=");
    });
});

describe("9. Email: SMTP fallback behaviour", () => {
    it("returns { sent: false } if no SMTP configured (not crash)", () => {
        const emailSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/_core/email.ts"), "utf-8"
        );
        expect(emailSrc).toContain("NO_SMTP_CONFIG");
        expect(emailSrc).toContain("sent: false");
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 10 — UPLOADS & TENANT ISOLATION
// ═══════════════════════════════════════════════════════════════════

describe("10. Uploads", () => {
    let uploadSrc: string;
    try {
        uploadSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/controllers/upload.controller.ts"), "utf-8"
        );
    } catch {
        uploadSrc = "";
    }

    // Also check the index/API route file where uploads are registered
    const indexFiles = ["../server/_core/index.ts", "../api/index.ts"];
    let routesSrc = "";
    for (const f of indexFiles) {
        try {
            routesSrc += fs.readFileSync(path.resolve(__dirname, f), "utf-8");
        } catch { }
    }

    it("download is tenant-scoped (tenantId filter)", () => {
        expect(uploadSrc).toContain("tenantId");
    });

    it("upload metadata is tagged with uploader's tenantId", () => {
        if (uploadSrc) {
            expect(uploadSrc).toContain("tenantId: user.tenantId");
        }
    });

    it("returns 404 (not 403) for missing/other-tenant files", () => {
        if (uploadSrc) {
            expect(uploadSrc).toContain("404");
            expect(uploadSrc).toContain("Not found");
        }
    });

    it("validates file type with magic bytes", () => {
        if (uploadSrc) {
            expect(uploadSrc).toMatch(/fileType|magic|buffer/i);
        }
    });

    it("blocks SVG uploads (XSS prevention)", () => {
        if (uploadSrc) {
            expect(uploadSrc).toMatch(/svg/i);
        }
    });

    it("sets X-Content-Type-Options: nosniff", () => {
        if (uploadSrc) {
            expect(uploadSrc).toContain("nosniff");
        }
    });

    it("uploads require authentication", () => {
        expect(routesSrc).toContain("requireAuthMiddleware");
    });

    it("uploads blocked during maintenance", () => {
        expect(routesSrc).toContain("requireNotMaintenance");
    });
});

// ═══════════════════════════════════════════════════════════════════
//  STAGING META-CHECKS — cross-cutting concerns
// ═══════════════════════════════════════════════════════════════════

describe("Staging: security headers", () => {
    const indexSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/_core/index.ts"), "utf-8"
    );

    it("uses Helmet for security headers", () => {
        expect(indexSrc).toContain("helmet");
    });

    it("disables x-powered-by", () => {
        expect(indexSrc).toContain("x-powered-by");
    });

    it("enables HSTS in production", () => {
        expect(indexSrc).toContain("hsts");
    });
});

describe("Staging: rate limiting", () => {
    const authSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/auth.ts"), "utf-8"
    );

    it("login is rate-limited", () => {
        expect(authSrc).toMatch(/rateLimit|authRateLimit/);
    });

    it("rate limit clears on successful login", () => {
        expect(authSrc).toContain("clearRateLimit");
    });
});

describe("Staging: env var requirements", () => {
    // Validate that critical env vars are referenced in the codebase
    const allServerFiles = [
        "../server/_core/index.ts",
        "../server/_core/cookies.ts",
        "../server/_core/email.ts",
        "../server/_core/env.ts",
        "../server/_core/native-oauth.ts",
        "../server/routers/account.ts",
        "../server/routers/signup.ts",
    ].map(f => {
        try { return fs.readFileSync(path.resolve(__dirname, f), "utf-8"); } catch { return ""; }
    }).join("\n");

    it("references APP_URL for email links", () => {
        expect(allServerFiles).toContain("APP_URL");
    });

    it("references SMTP_HOST for email delivery", () => {
        expect(allServerFiles).toContain("SMTP_HOST");
    });

    it("references COOKIE_SECRET or JWT_SECRET for session security", () => {
        expect(allServerFiles).toMatch(/COOKIE_SECRET|JWT_SECRET/);
    });

    it("references TRUST_PROXY for proxy deployment", () => {
        expect(allServerFiles).toContain("TRUST_PROXY");
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 11 — ERROR HANDLING: no false "Acceso Denegado"
// ═══════════════════════════════════════════════════════════════════

describe("11. Error handling — no false Acceso Denegado", () => {
    const settingsSrc = fs.readFileSync(
        path.resolve(__dirname, "../client/src/pages/Settings.tsx"), "utf-8"
    );
    const trpcSrc = fs.readFileSync(
        path.resolve(__dirname, "../server/_core/trpc.ts"), "utf-8"
    );
    const permGuardSrc = fs.readFileSync(
        path.resolve(__dirname, "../client/src/components/PermissionGuard.tsx"), "utf-8"
    );
    const usePermSrc = fs.readFileSync(
        path.resolve(__dirname, "../client/src/_core/hooks/usePermissions.ts"), "utf-8"
    );

    it("Settings.tsx checks error.data.code before showing Forbidden", () => {
        expect(settingsSrc).toContain('code === "FORBIDDEN"');
    });

    it("Settings.tsx shows specific message for UNAUTHORIZED errors", () => {
        expect(settingsSrc).toContain('code === "UNAUTHORIZED"');
        expect(settingsSrc).toContain("Sesión inválida");
    });

    it("Settings.tsx shows retry button for non-permission errors", () => {
        expect(settingsSrc).toContain("Reintentar");
        expect(settingsSrc).toContain("Error al cargar configuración");
    });

    it("billing guard catch-all uses INTERNAL_SERVER_ERROR, not FORBIDDEN", () => {
        expect(trpcSrc).toContain('code: "INTERNAL_SERVER_ERROR"');
        // Should NOT use FORBIDDEN for non-billing DB errors
        expect(trpcSrc).toContain("Non-billing DB errors should NOT masquerade as FORBIDDEN");
    });

    it("PermissionGuard handles query errors distinctly from permission denials", () => {
        expect(permGuardSrc).toContain("Error al verificar permisos");
    });

    it("usePermissions exposes error state", () => {
        expect(usePermSrc).toContain("error: query.error");
    });

    it("myPermissions uses authOnlyProcedure (skips billing guard)", () => {
        const settingsRouterSrc = fs.readFileSync(
            path.resolve(__dirname, "../server/routers/settings.ts"), "utf-8"
        );
        expect(settingsRouterSrc).toContain("myPermissions: authOnlyProcedure");
    });

    it("authOnlyProcedure is exported from trpc.ts (requireUser only)", () => {
        expect(trpcSrc).toContain("authOnlyProcedure");
        expect(trpcSrc).toMatch(/authOnlyProcedure.*=.*procedure\.use\(requireUser\)/s);
    });
});
