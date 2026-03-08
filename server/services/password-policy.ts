/**
 * Password Policy Service — thin shim over shared/password-policy.ts
 * Kept for backward compatibility with any code importing from this path.
 */
import { validatePassword as validateSharedPassword } from "../../shared/password-policy";

export interface PasswordValidation {
    valid: boolean;
    errors: string[];
    strength: "weak" | "fair" | "strong" | "excellent";
}

export function validatePassword(password: string): PasswordValidation {
    const result = validateSharedPassword(password);
    const passed = 4 - result.failures.length;

    const strength: PasswordValidation["strength"] =
        passed <= 1 ? "weak" :
            passed <= 2 ? "fair" :
                passed <= 3 ? "strong" :
                    "excellent";

    return {
        valid: result.valid,
        errors: result.failures,
        strength,
    };
}
