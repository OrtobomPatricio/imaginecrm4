import React, { useState } from "react";
import {
    PayPalScriptProvider,
    PayPalButtons,
} from "@paypal/react-paypal-js";
import { Button } from "@/components/ui/button";
import { Loader2, X, ShieldCheck, CreditCard } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface PayPalCheckoutModalProps {
    planKey: "starter" | "pro" | "enterprise";
    planName: string;
    price: number;
    paypalClientId: string;
    paypalMode: string;
    onSubscriptionCreated: (subscriptionId: string, plan: string) => void;
    onCancel: () => void;
}

export function PayPalCheckoutModal({
    planKey,
    planName,
    price,
    paypalClientId,
    paypalMode,
    onSubscriptionCreated,
    onCancel,
}: PayPalCheckoutModalProps) {
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    if (!paypalClientId) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="bg-background rounded-xl p-6 max-w-md w-full shadow-2xl">
                    <p className="text-destructive">PayPal no está configurado. Contacta al administrador.</p>
                    <Button onClick={onCancel} className="mt-4 w-full">Cerrar</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
            <div className="bg-background rounded-xl max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b">
                    <div>
                        <h3 className="text-lg font-semibold">Suscribirse al Plan {planName}</h3>
                        <p className="text-sm text-muted-foreground">${price}/mes · Cancela cuando quieras</p>
                    </div>
                    <button onClick={onCancel} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-5">
                    {error && (
                        <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
                            {error}
                        </div>
                    )}

                    {success ? (
                        <div className="text-center py-6">
                            <div className="text-green-600 text-lg font-semibold mb-2">¡Suscripción activada!</div>
                            <p className="text-sm text-muted-foreground">Tu Plan {planName} ya está activo.</p>
                        </div>
                    ) : (
                        <PayPalScriptProvider
                            options={{
                                clientId: paypalClientId,
                                vault: true,
                                intent: "subscription",
                                components: "buttons",
                                locale: "es_ES",
                            }}
                        >
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <CreditCard className="h-4 w-4 shrink-0" />
                                    <span>Paga con PayPal o tarjeta de crédito/débito a través de la ventana segura de PayPal.</span>
                                </div>

                                <PayPalSubscriptionButtons
                                    planKey={planKey}
                                    onApprove={(subId) => {
                                        setSuccess(true);
                                        onSubscriptionCreated(subId, planKey);
                                    }}
                                    onError={(msg) => setError(msg)}
                                />
                            </div>
                        </PayPalScriptProvider>
                    )}

                    <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Pago seguro procesado por PayPal. No almacenamos datos de tarjeta.
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── PayPal Buttons (subscription) ──────────────── */
function PayPalSubscriptionButtons({
    planKey,
    onApprove,
    onError,
}: {
    planKey: string;
    onApprove: (subscriptionId: string) => void;
    onError: (msg: string) => void;
}) {
    const createSub = trpc.billing.createSubscription.useMutation();

    return (
        <PayPalButtons
            style={{
                shape: "rect",
                color: "gold",
                layout: "vertical",
                label: "subscribe",
            }}
            createSubscription={async () => {
                try {
                    const result = await createSub.mutateAsync({
                        plan: planKey as "starter" | "pro" | "enterprise",
                    });
                    return result.subscriptionId;
                } catch {
                    onError("Error al crear la suscripción. Intenta de nuevo.");
                    throw new Error("Failed to create subscription");
                }
            }}
            onApprove={async (data) => {
                if (data.subscriptionID) {
                    onApprove(data.subscriptionID);
                }
            }}
            onError={() => {
                onError("Error en el pago con PayPal. Intenta de nuevo.");
            }}
            onCancel={() => {
                onError("Pago cancelado.");
            }}
        />
    );
}
