import { trpc } from "@/lib/trpc";
import { AlertTriangle, Mail, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export default function EmailVerificationBanner() {
    const { data: user } = trpc.auth.me.useQuery();
    const [dismissed, setDismissed] = useState(false);

    const resend = trpc.account.resendVerification.useMutation({
        onSuccess: (data) => {
            if (data.success) {
                toast.success(data.message || "Email de verificación reenviado");
            } else {
                toast.error(data.message || "Error al reenviar");
            }
        },
        onError: (e) => toast.error(e.message),
    });

    if (!user || (user as any).emailVerified !== false || dismissed) return null;

    return (
        <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                    Tu email no está verificado.{" "}
                    <button
                        onClick={() => resend.mutate()}
                        disabled={resend.isPending}
                        className="font-medium underline hover:no-underline inline-flex items-center gap-1"
                    >
                        {resend.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                        Reenviar email de verificación
                    </button>
                </span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setDismissed(true)}>
                <X className="h-3.5 w-3.5" />
            </Button>
        </div>
    );
}
