/**
 * Centralized Password Policy
 *
 * Single source of truth for password rules.
 * Used by server-side validation (auth, account routers) and client UI (PasswordStrengthMeter).
 */

export const PASSWORD_RULES = [
    { regex: /.{8,}/, label: "Mínimo 8 caracteres" },
    { regex: /[A-Z]/, label: "Una letra mayúscula" },
    { regex: /[a-z]/, label: "Una letra minúscula" },
    { regex: /[0-9]/, label: "Un número" },
] as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Validate a password against all rules. Returns list of failed rule labels. */
export function validatePassword(password: string): { valid: boolean; failures: string[] } {
    const failures = PASSWORD_RULES
        .filter(r => !r.regex.test(password))
        .map(r => r.label);
    return { valid: failures.length === 0, failures };
}
