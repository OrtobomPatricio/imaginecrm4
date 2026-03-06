import { useMemo } from "react";
import { Check, X } from "lucide-react";

const PASSWORD_RULES = [
    { test: (p: string) => p.length >= 8, label: "Mínimo 8 caracteres" },
    { test: (p: string) => /[A-Z]/.test(p), label: "Una letra mayúscula" },
    { test: (p: string) => /[a-z]/.test(p), label: "Una letra minúscula" },
    { test: (p: string) => /[0-9]/.test(p), label: "Un número" },
];

export function validatePassword(password: string): boolean {
    return PASSWORD_RULES.every(r => r.test(password));
}

export default function PasswordStrengthMeter({ password }: { password: string }) {
    const results = useMemo(
        () => PASSWORD_RULES.map(r => ({ ...r, passed: r.test(password) })),
        [password],
    );
    const passed = results.filter(r => r.passed).length;
    const strength = passed / PASSWORD_RULES.length;

    if (!password) return null;

    return (
        <div className="space-y-2 mt-1">
            {/* Strength bar */}
            <div className="flex gap-1">
                {[0, 1, 2, 3].map(i => (
                    <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                            i < passed
                                ? strength <= 0.25
                                    ? "bg-red-500"
                                    : strength <= 0.5
                                        ? "bg-orange-500"
                                        : strength <= 0.75
                                            ? "bg-yellow-500"
                                            : "bg-green-500"
                                : "bg-muted"
                        }`}
                    />
                ))}
            </div>
            {/* Rule checklist */}
            <ul className="space-y-0.5">
                {results.map(r => (
                    <li key={r.label} className={`flex items-center gap-1.5 text-xs ${r.passed ? "text-green-600" : "text-muted-foreground"}`}>
                        {r.passed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {r.label}
                    </li>
                ))}
            </ul>
        </div>
    );
}
