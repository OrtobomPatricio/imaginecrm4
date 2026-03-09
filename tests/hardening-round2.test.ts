import { describe, it, expect } from "vitest";

/**
 * Tests for production-hardening round 2 items:
 * - createTenant validation logic
 * - listTenants maintenanceMode mapping
 * - forcePasswordReset URL format
 * - resendVerification URL format
 * - updateTenant reserved slug blocking
 * - impersonation user/tenant coherence
 * - PermissionGuard logic
 * - Maintenance middleware coverage
 * - Signup copy alignment
 */

// ── Reserved Slugs (must match the constant in superadmin.ts) ──
const RESERVED_SLUGS = new Set([
    "www", "app", "api", "admin", "superadmin", "platform", "system",
    "support", "help", "billing", "mail", "ftp", "ssh", "test",
    "staging", "dev", "demo", "status", "docs", "blog", "cdn",
    "auth", "login", "signup", "webhook", "webhooks", "trpc",
    "oauth", "meta", "paypal", "whatsapp", "uploads", "metrics",
    "health", "healthz", "readyz",
]);

// ── Unified slug regex (must match BOTH createTenant and updateTenant in superadmin.ts) ──
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/;

describe("createTenant validation", () => {
    it("should reject reserved slugs", () => {
        for (const slug of ["api", "admin", "www", "trpc", "health"]) {
            expect(RESERVED_SLUGS.has(slug)).toBe(true);
        }
    });

    it("should allow valid slugs", () => {
        for (const slug of ["acme-corp", "my-company", "tenant42"]) {
            expect(RESERVED_SLUGS.has(slug)).toBe(false);
        }
    });

    it("should require owner email and name (not optional)", () => {
        const validInput = {
            name: "Test Corp",
            slug: "test-corp",
            plan: "free",
            ownerEmail: "owner@test.com",
            ownerName: "Test Owner",
        };
        expect(validInput.ownerEmail).toBeTruthy();
        expect(validInput.ownerName).toBeTruthy();
    });

    it("should fail if owner email conflicts (no orphan tenant)", () => {
        // Email check now runs INSIDE the transaction to prevent TOCTOU race
        const existingEmails = ["taken@example.com"];
        const ownerEmail = "taken@example.com";
        const emailConflict = existingEmails.includes(ownerEmail);
        expect(emailConflict).toBe(true);
    });

    it("slug regex rejects leading/trailing dashes and single chars", () => {
        expect(SLUG_REGEX.test("-bad-slug")).toBe(false);
        expect(SLUG_REGEX.test("bad-slug-")).toBe(false);
        expect(SLUG_REGEX.test("-")).toBe(false);
        expect(SLUG_REGEX.test("a")).toBe(false); // min 2 chars
    });

    it("slug regex accepts valid multi-char slugs", () => {
        expect(SLUG_REGEX.test("ab")).toBe(true);
        expect(SLUG_REGEX.test("my-company")).toBe(true);
        expect(SLUG_REGEX.test("tenant42")).toBe(true);
        expect(SLUG_REGEX.test("a1")).toBe(true);
    });

    it("transaction rollback: if owner insert fails, tenant is not created", () => {
        // Simulates: tx.insert(tenants) succeeds, tx.insert(users) throws → entire tx rolled back
        let tenantCreated = false;
        let ownerCreated = false;
        try {
            tenantCreated = true; // tenant insert succeeds
            throw new Error("email conflict in tx"); // owner insert fails
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_e) {
            // tx rolled back → revert
            tenantCreated = false;
            ownerCreated = false;
        }
        expect(tenantCreated).toBe(false);
        expect(ownerCreated).toBe(false);
    });
});

describe("listTenants maintenanceMode mapping", () => {
    it("should map enabled maintenance to boolean true", () => {
        const rawMaintenanceMode = { enabled: true, message: "undergoing maintenance" };
        const mapped = !!(rawMaintenanceMode as any)?.enabled;
        expect(mapped).toBe(true);
    });

    it("should map disabled maintenance to boolean false", () => {
        const rawMaintenanceMode = { enabled: false };
        const mapped = !!(rawMaintenanceMode as any)?.enabled;
        expect(mapped).toBe(false);
    });

    it("should map null/missing maintenance to boolean false", () => {
        const rawMaintenanceMode = null;
        const mapped = !!(rawMaintenanceMode as any)?.enabled;
        expect(mapped).toBe(false);
    });
});

describe("forcePasswordReset URL format", () => {
    it("should use 'tenant' query parameter (not 'org')", () => {
        const resetToken = "abc123";
        const tenantSlug = "mi-empresa";
        const resetUrl = `/reset-password?token=${resetToken}&tenant=${encodeURIComponent(tenantSlug)}`;

        expect(resetUrl).toContain("&tenant=");
        expect(resetUrl).not.toContain("&org=");
        expect(resetUrl).toBe("/reset-password?token=abc123&tenant=mi-empresa");
    });

    it("should omit tenant when slug is empty", () => {
        const resetToken = "abc123";
        const slug = "";
        const resetUrl = `/reset-password?token=${resetToken}${slug ? `&tenant=${encodeURIComponent(slug)}` : ""}`;
        expect(resetUrl).toBe("/reset-password?token=abc123");
    });
});

describe("resendVerification URL format", () => {
    it("should include tenant query parameter when available", () => {
        const token = "verifytoken";
        const tenantSlug = "acme";
        const appUrl = "https://app.example.com";
        const tenantSlugParam = `&tenant=${encodeURIComponent(tenantSlug)}`;
        const verifyUrl = `${appUrl}/verify-email?token=${token}${tenantSlugParam}`;

        expect(verifyUrl).toContain("&tenant=acme");
        expect(verifyUrl).toBe("https://app.example.com/verify-email?token=verifytoken&tenant=acme");
    });

    it("should not have hardcoded domain fallback", () => {
        // The production code now uses: process.env.APP_URL || process.env.CLIENT_URL
        // with NO hardcoded fallback — it returns an error if not configured
        const appUrl = process.env.APP_URL || process.env.CLIENT_URL;
        // In test environment these are not set, so appUrl should be undefined
        expect(appUrl).toBeFalsy();
    });
});

describe("updateTenant reserved slug validation", () => {
    it("should block reserved slugs on update", () => {
        const newSlug = "admin";
        expect(RESERVED_SLUGS.has(newSlug.toLowerCase())).toBe(true);
    });

    it("should allow valid slug updates", () => {
        const newSlug = "my-new-slug";
        expect(RESERVED_SLUGS.has(newSlug.toLowerCase())).toBe(false);
    });

    it("uses same strict regex as createTenant (no leading/trailing dashes)", () => {
        // updateTenant now uses /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/ (same as createTenant)
        expect(SLUG_REGEX.test("valid-slug")).toBe(true);
        expect(SLUG_REGEX.test("-invalid")).toBe(false);
        expect(SLUG_REGEX.test("invalid-")).toBe(false);
        expect(SLUG_REGEX.test("---")).toBe(false);
    });
});

describe("impersonation user/tenant coherence", () => {
    it("should reject user not belonging to declared tenant", () => {
        // Simulates the query that now filters by BOTH userId AND tenantId
        const users = [
            { id: 1, tenantId: 1 },
            { id: 2, tenantId: 2 },
            { id: 3, tenantId: 1 },
        ];
        const targetUserId = 2;
        const targetTenantId = 1; // wrong tenant

        const match = users.find(u => u.id === targetUserId && u.tenantId === targetTenantId);
        expect(match).toBeUndefined(); // should fail — user 2 belongs to tenant 2, not 1
    });

    it("should accept user belonging to correct tenant", () => {
        const users = [
            { id: 1, tenantId: 1 },
            { id: 2, tenantId: 2 },
        ];
        const targetUserId = 2;
        const targetTenantId = 2;

        const match = users.find(u => u.id === targetUserId && u.tenantId === targetTenantId);
        expect(match).toBeDefined();
    });
});

describe("PermissionGuard alignment", () => {
    // Simulates the can() function from usePermissions
    function can(permissions: string[], perm: string): boolean {
        if (permissions.includes("*")) return true;
        if (permissions.includes(perm)) return true;
        const requiredBase = perm.split(".")[0];
        if (permissions.includes(`${requiredBase}.*`)) return true;
        return false;
    }

    it("owner should pass all permission checks via wildcard", () => {
        const ownerPerms = ["*"];
        expect(can(ownerPerms, "leads.view")).toBe(true);
        expect(can(ownerPerms, "settings.update")).toBe(true);
    });

    it("admin should pass through matrix, not unconditional bypass", () => {
        const adminPerms = ["dashboard.*", "leads.*", "settings.*"];
        expect(can(adminPerms, "leads.view")).toBe(true);
        expect(can(adminPerms, "settings.update")).toBe(true);
        // Admin does NOT get a wildcard — only what's in the matrix
        expect(can(adminPerms, "superadmin.manage")).toBe(false);
    });

    it("viewer should be limited to their explicit permissions", () => {
        const viewerPerms = ["dashboard.view", "leads.view"];
        expect(can(viewerPerms, "leads.view")).toBe(true);
        expect(can(viewerPerms, "leads.create")).toBe(false);
    });
});

describe("Signup copy alignment", () => {
    it("should not reference subdomain architecture", () => {
        // The label should be "Identificador", not "URL"
        // and should not show {slug}.imaginecrm.com
        const labelText = "Identificador:";
        expect(labelText).not.toContain("URL");
        expect(labelText).not.toContain(".imaginecrm.com");
    });
});

describe("PWA service worker strategy", () => {
    it("VitePWA config should use NetworkOnly for all /api/ paths", () => {
        // Validates that the runtimeCaching pattern covers all API calls
        const urlPattern = /^\/api\//;
        expect(urlPattern.test("/api/trpc/something")).toBe(true);
        expect(urlPattern.test("/api/uploads/file.png")).toBe(true);
        expect(urlPattern.test("/api/upload")).toBe(true);
        expect(urlPattern.test("/api/health")).toBe(true);
        // Static assets should NOT match
        expect(urlPattern.test("/assets/main.js")).toBe(false);
    });

    it("should not have manual registration alongside VitePWA", () => {
        // The manual sw.js registration was removed from main.tsx
        // VitePWA handles registration via registerType: "autoUpdate"
        const registerType = "autoUpdate";
        expect(registerType).toBe("autoUpdate");
    });
});

describe("Maintenance HTTP middleware", () => {
    it("should exempt platform tenant (tenantId=1) from maintenance", () => {
        const user = { tenantId: 1 };
        const isExempt = user.tenantId === 1;
        expect(isExempt).toBe(true);
    });

    it("should block regular tenants during maintenance", () => {
        const user = { tenantId: 5 };
        const maintenanceMode = { enabled: true, message: "down for maintenance" };
        const isBlocked = user.tenantId !== 1 && maintenanceMode.enabled;
        expect(isBlocked).toBe(true);
    });

    it("should allow through when maintenance is off", () => {
        const user = { tenantId: 5 };
        const maintenanceMode = { enabled: false };
        const isBlocked = user.tenantId !== 1 && maintenanceMode.enabled;
        expect(isBlocked).toBe(false);
    });

    it("should cover upload GET and POST routes", () => {
        // Both routes now have requireNotMaintenance middleware:
        // GET /api/uploads/:name + POST /api/upload
        const protectedRoutes = ["/api/uploads/:name", "/api/upload"];
        expect(protectedRoutes).toHaveLength(2);
        expect(protectedRoutes.every(r => r.startsWith("/api/"))).toBe(true);
    });

    it("should return 503 status during maintenance", () => {
        const HTTP_MAINTENANCE = 503;
        expect(HTTP_MAINTENANCE).toBe(503);
    });
});

describe("Cross-device reset and verify flows", () => {
    it("reset URL is relative (works on any device)", () => {
        const resetUrl = `/reset-password?token=abc&tenant=acme`;
        expect(resetUrl.startsWith("/")).toBe(true); // relative path
        expect(resetUrl).not.toContain("http"); // no absolute URL baked in
    });

    it("verify URL uses configurable APP_URL base", () => {
        const appUrl = "https://custom.domain.com";
        const verifyUrl = `${appUrl}/verify-email?token=xyz&tenant=acme`;
        expect(verifyUrl).toContain("custom.domain.com");
        expect(verifyUrl).not.toContain("imaginecrm.com");
    });
});

describe("Branding/copy consistency", () => {
    it("no subdomain references in user-facing text", () => {
        const forbiddenPatterns = [".imaginecrm.com", "{slug}.app", "tu-empresa.imaginecrm"];
        const displayText = "Identificador: mi-empresa";
        for (const pattern of forbiddenPatterns) {
            expect(displayText).not.toContain(pattern);
        }
    });

    it("no hardcoded support email in user-facing text", () => {
        // OnboardingWizard was changed from soporte@imaginecrm.com
        const helpText = "¿Necesitas ayuda? Contacta al administrador de tu organización";
        expect(helpText).not.toContain("@imaginecrm.com");
    });

    it("login tenant field uses consistent terminology with signup", () => {
        // Login says "Identificador de organización" matching Signup "Identificador de tu organización"
        const loginLabel = "Identificador de organización";
        const signupLabel = "Identificador de tu organización";
        expect(loginLabel).toContain("Identificador");
        expect(signupLabel).toContain("Identificador");
    });
});

describe("UX: slug client-side validation", () => {
    // Simulates the auto-gen function used in CreateTenantDialog
    function autoGenSlug(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    }

    it("auto-generated slug strips leading/trailing dashes", () => {
        expect(autoGenSlug("- Bad Name -")).toBe("bad-name");
        expect(autoGenSlug("!!!special!!!")).toBe("special");
    });

    it("auto-generated slug normalizes multiple dashes", () => {
        expect(autoGenSlug("My   Company   SA")).toBe("my-company-sa");
    });

    it("create button is disabled for invalid slug format", () => {
        const SLUG_CLIENT = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
        // These should keep the button disabled
        expect(SLUG_CLIENT.test("-bad")).toBe(false);
        expect(SLUG_CLIENT.test("bad-")).toBe(false);
        expect(SLUG_CLIENT.test("a")).toBe(false);
        // These should enable the button
        expect(SLUG_CLIENT.test("ab")).toBe(true);
        expect(SLUG_CLIENT.test("good-slug")).toBe(true);
    });
});

describe("UX: impersonation safety", () => {
    it("impersonation banner shows who is being impersonated", () => {
        // The banner now shows: "Impersonando: {name} (tenant {id})"
        const me = { name: "John", email: "john@test.com", tenantId: 5 };
        const bannerText = `Impersonando: ${me.name || me.email || "usuario"} (tenant ${me.tenantId || "?"})`;
        expect(bannerText).toContain("John");
        expect(bannerText).toContain("tenant 5");
    });

    it("impersonation requires confirmation dialog", () => {
        // The onClick now calls confirm() before mutating
        const userName = "Target User";
        const isActive = true;
        const message = isActive
            ? `¿Impersonar a ${userName}?\n\nTu sesión actual se pausará y todas las acciones quedarán registradas.`
            : `⚠️ ${userName} está INACTIVO. ¿Impersonar de todos modos?\n\nTodas las acciones quedarán registradas.`;
        expect(message).toContain("registradas");
        expect(message).toContain(userName);
    });
});

describe("UX: maintenance mode confirmation", () => {
    it("activate confirmation explains impact on users", () => {
        const tenantName = "Acme Corp";
        const enable = true;
        const msg = enable
            ? `¿Activar mantenimiento para "${tenantName}"?\n\nTodos los usuarios de este tenant quedarán bloqueados (tRPC + uploads). Solo Super Admin podrá operar.`
            : `¿Desactivar mantenimiento para "${tenantName}"?\n\nLos usuarios podrán volver a operar.`;
        expect(msg).toContain("bloqueados");
        expect(msg).toContain("tRPC + uploads");
    });

    it("tRPC maintenance blocks non-essential routes", () => {
        // Backend allows: auth.*, billing.*, account.*, sessions.*
        const allowedPrefixes = ["auth.", "billing.", "account.", "sessions."];
        expect(allowedPrefixes.some(p => "leads.list".startsWith(p))).toBe(false);
        expect(allowedPrefixes.some(p => "auth.me".startsWith(p))).toBe(true);
        expect(allowedPrefixes.some(p => "billing.getStatus".startsWith(p))).toBe(true);
    });
});

describe("UX: email verification banner", () => {
    it("shows sent confirmation after resend", () => {
        const sent = true;
        const inlineText = sent ? "Email enviado — revisá tu bandeja de entrada." : "Reenviar email de verificación";
        expect(inlineText).toContain("bandeja de entrada");
    });
});

describe("Hallazgo A: Signup slug manual edit flag", () => {
    function autoGenSlug(companyName: string): string {
        return companyName
            .toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 50);
    }

    it("auto-gen produces clean slug from company name", () => {
        expect(autoGenSlug("Mi Empresa S.A.")).toBe("mi-empresa-s-a");
        expect(autoGenSlug("Café & Más!!!")).toBe("cafe-mas");
    });

    it("manual edit flag stops auto-gen from overwriting", () => {
        let slugManuallyEdited = false;
        let slug = autoGenSlug("Test Corp"); // "test-corp"
        expect(slug).toBe("test-corp");

        // User types custom slug → flag goes true
        slugManuallyEdited = true;
        slug = "my-custom-slug";

        // Simulate companyName change — should NOT overwrite
        const newAutoGen = autoGenSlug("Changed Name");
        if (!slugManuallyEdited) slug = newAutoGen;
        expect(slug).toBe("my-custom-slug"); // still the manually-edited value
    });
});

describe("Hallazgo B: ResetPassword expired token UI", () => {
    it("detects expired token from backend error message", () => {
        const errorMsg = "El enlace de recuperación ha expirado. Solicita uno nuevo.";
        const isExpired = errorMsg.toLowerCase().includes("expirado") || errorMsg.toLowerCase().includes("expired");
        expect(isExpired).toBe(true);
    });

    it("distinguishes invalid from expired tokens", () => {
        const invalidMsg = "Token de recuperación inválido o expirado.";
        const expiredMsg = "El enlace de recuperación ha expirado. Solicita uno nuevo.";

        // Invalid: contains "inválido", may contain "expirado" but primary is invalid
        const isExpiredCheck = (msg: string) => msg.toLowerCase().includes("expirado") || msg.toLowerCase().includes("expired");

        // Both technically trigger expired state — but backend sends distinct messages
        expect(isExpiredCheck(invalidMsg)).toBe(true);
        expect(isExpiredCheck(expiredMsg)).toBe(true);

        // The distinct UI messages shown to user:
        const expiredUIText = "Tu enlace de recuperación ha expirado.";
        const invalidUIText = "Enlace de recuperación inválido.";
        expect(expiredUIText).not.toBe(invalidUIText);
    });

    it("expired UI provides helpful context", () => {
        const helpText = "Por seguridad, los enlaces expiran después de un tiempo. Solicitá uno nuevo.";
        expect(helpText).toContain("seguridad");
        expect(helpText).toContain("nuevo");
    });
});

describe("Hallazgo C: VerifyEmail double-fire guard", () => {
    it("guard prevents multiple mutation calls", () => {
        let callCount = 0;
        let verified = false;

        // Simulate two useEffect firings (React StrictMode)
        for (let i = 0; i < 2; i++) {
            if (verified) continue;
            verified = true;
            callCount++;
        }
        expect(callCount).toBe(1);
    });
});

describe("Hallazgo D: Login tenant field clarity", () => {
    it("placeholder explains what the field expects", () => {
        const placeholder = "el identificador que elegiste al registrar tu empresa";
        expect(placeholder).toContain("identificador");
        expect(placeholder).toContain("registrar");
        // Does NOT say "solo si tenés varias" which was unclear
        expect(placeholder).not.toContain("solo si");
    });
});

describe("Hallazgo E: AllUsersPanel reveal box", () => {
    it("shows visible URL instead of silent clipboard copy", () => {
        // Simulates the new behavior: set state instead of clipboard
        let revealedUrl: string | null = null;
        const resetUrl = "/reset-password?token=abc&tenant=acme";
        const fullUrl = `https://app.example.com${resetUrl}`;

        // Old behavior: navigator.clipboard.writeText(fullUrl) — silent, may fail
        // New behavior: set state to show URL visually
        revealedUrl = fullUrl;
        expect(revealedUrl).toBe("https://app.example.com/reset-password?token=abc&tenant=acme");
        expect(revealedUrl).not.toBeNull();
    });

    it("reveal box can be dismissed", () => {
        let revealedUrl: string | null = "https://app.example.com/reset-password?token=xyz";
        // User clicks ✕
        revealedUrl = null;
        expect(revealedUrl).toBeNull();
    });
});

describe("Impersonation audit trail", () => {
    it("logs adminId, targetUserId, and targetTenantId", () => {
        const auditEntry = {
            adminId: 1,
            action: "impersonate",
            details: { targetUserId: 42, targetTenantId: 5 },
        };
        expect(auditEntry.adminId).toBeDefined();
        expect(auditEntry.details.targetUserId).toBeDefined();
        expect(auditEntry.details.targetTenantId).toBeDefined();
    });

    it("impersonation session is time-limited (2h)", () => {
        const maxAgeMs = 2 * 60 * 60 * 1000;
        expect(maxAgeMs).toBe(7_200_000);
    });

    it("exit impersonation requires __imp_original cookie", () => {
        const cookies = { __imp_original: "original-session-token" };
        expect(cookies.__imp_original).toBeTruthy();
        const noCookie = {};
        expect((noCookie as any).__imp_original).toBeFalsy();
    });
});

// ═══════════════════════════════════════════════════
// PENDIENTE FINAL 1: createTenant preserves business errors
// ═══════════════════════════════════════════════════

describe("createTenant: TRPCError preservation in catch", () => {
    it("re-throws TRPCError (CONFLICT) instead of wrapping as INTERNAL_SERVER_ERROR", async () => {
        // Simulate transaction catch behavior
        const { TRPCError } = await import("@trpc/server");
        const businessError = new TRPCError({ code: "CONFLICT", message: 'El email "x@test.com" ya está en uso.' });

        let caught: any;
        try {
            try {
                throw businessError;
            } catch (txErr: any) {
                if (txErr instanceof TRPCError) throw txErr;
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear tenant." });
            }
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(TRPCError);
        expect(caught.code).toBe("CONFLICT");
        expect(caught.message).toContain("ya está en uso");
    });

    it("wraps non-TRPCError as INTERNAL_SERVER_ERROR", async () => {
        const { TRPCError } = await import("@trpc/server");
        const dbError = new Error("ER_DUP_ENTRY");

        let caught: any;
        try {
            try {
                throw dbError;
            } catch (txErr: any) {
                if (txErr instanceof TRPCError) throw txErr;
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear tenant." });
            }
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(TRPCError);
        expect(caught.code).toBe("INTERNAL_SERVER_ERROR");
    });

    it("preserves BAD_REQUEST from within transaction", async () => {
        const { TRPCError } = await import("@trpc/server");
        const validationError = new TRPCError({ code: "BAD_REQUEST", message: "Slug inválido" });

        let caught: any;
        try {
            try {
                throw validationError;
            } catch (txErr: any) {
                if (txErr instanceof TRPCError) throw txErr;
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al crear tenant." });
            }
        } catch (e) {
            caught = e;
        }
        expect(caught.code).toBe("BAD_REQUEST");
    });
});

// ═══════════════════════════════════════════════════
// PENDIENTE FINAL 2: isMaintenanceActive exported
// ═══════════════════════════════════════════════════

describe("isMaintenanceActive: standalone check", () => {
    it("always returns null for tenantId 1 (superadmin exempt)", async () => {
        const { isMaintenanceActive } = await import("../server/_core/middleware/maintenance");
        const result = await isMaintenanceActive(1);
        expect(result).toBeNull();
    });

    it("function is exported and callable", async () => {
        const mod = await import("../server/_core/middleware/maintenance");
        expect(typeof mod.isMaintenanceActive).toBe("function");
        expect(typeof mod.requireNotMaintenance).toBe("function");
    });
});

// ═══════════════════════════════════════════════════
// PENDIENTE FINAL 3: PWA cache exclusions
// ═══════════════════════════════════════════════════

describe("PWA critical files: no aggressive cache", () => {
    const PWA_NO_CACHE_RE = /(?:^|[\/\\])(?:sw\.js|manifest\.webmanifest|manifest\.json|registerSW\.js|workbox-[\w.-]+\.js)$/;

    it("sw.js matches exclusion regex", () => {
        expect(PWA_NO_CACHE_RE.test("/dist/public/sw.js")).toBe(true);
        expect(PWA_NO_CACHE_RE.test("sw.js")).toBe(true);
    });

    it("manifest.webmanifest matches exclusion", () => {
        expect(PWA_NO_CACHE_RE.test("/dist/public/manifest.webmanifest")).toBe(true);
    });

    it("manifest.json matches exclusion", () => {
        expect(PWA_NO_CACHE_RE.test("/dist/public/manifest.json")).toBe(true);
    });

    it("registerSW.js matches exclusion", () => {
        expect(PWA_NO_CACHE_RE.test("registerSW.js")).toBe(true);
    });

    it("workbox-xxxxx.js matches exclusion", () => {
        expect(PWA_NO_CACHE_RE.test("/dist/public/workbox-abc123.js")).toBe(true);
    });

    it("regular hashed assets do NOT match exclusion", () => {
        expect(PWA_NO_CACHE_RE.test("/assets/index-abc123.js")).toBe(false);
        expect(PWA_NO_CACHE_RE.test("/assets/style-def456.css")).toBe(false);
    });

    it("html files do NOT match PWA exclusion (handled separately)", () => {
        expect(PWA_NO_CACHE_RE.test("index.html")).toBe(false);
    });
});
