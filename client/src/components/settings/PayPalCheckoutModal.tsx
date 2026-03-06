import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, X, ShieldCheck, CreditCard } from "lucide-react";
import { trpc } from "@/lib/trpc";

/* ── PayPal SDK type (minimal) ── */
interface PayPalNamespace {
    Buttons?: (opts: Record<string, unknown>) => {
        render: (el: HTMLElement) => Promise<void>;
        close: () => Promise<void>;
    };
}

declare global {
    interface Window {
        paypal?: PayPalNamespace;
    }
}

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
    const [sdkReady, setSdkReady] = useState(false);
    const [sdkError, setSdkError] = useState(false);
    const buttonsContainerRef = useRef<HTMLDivElement>(null);
    const buttonsInstanceRef = useRef<{ close: () => Promise<void> } | null>(null);
    const createSub = trpc.billing.createSubscription.useMutation();

    // Load PayPal SDK script
    useEffect(() => {
        if (!paypalClientId) return;

        // Check if SDK already loaded with correct client ID
        const existingScript = document.querySelector<HTMLScriptElement>(
            'script[data-paypal-sdk]'
        );
        if (existingScript && window.paypal?.Buttons) {
            setSdkReady(true);
            return;
        }

        // Remove any old PayPal script
        if (existingScript) {
            existingScript.remove();
            delete window.paypal;
        }

        const script = document.createElement("script");
        script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId)}&vault=true&intent=subscription&locale=es_ES`;
        script.setAttribute("data-paypal-sdk", "true");
        script.async = true;
        script.onload = () => setSdkReady(true);
        script.onerror = () => setSdkError(true);
        document.head.appendChild(script);

        return () => {
            // Don't remove on unmount — PayPal SDK should stay cached
        };
    }, [paypalClientId]);

    // Render PayPal Buttons when SDK is ready
    useEffect(() => {
        if (!sdkReady || !window.paypal?.Buttons || !buttonsContainerRef.current || success) return;

        const container = buttonsContainerRef.current;
        container.innerHTML = "";

        const buttons = window.paypal.Buttons({
            style: {
                shape: "rect",
                color: "gold",
                layout: "vertical",
                label: "subscribe",
            },
            createSubscription: async () => {
                try {
                    setError(null);
                    const result = await createSub.mutateAsync({
                        plan: planKey as "starter" | "pro" | "enterprise",
                    });
                    return result.subscriptionId;
                } catch {
                    setError("Error al crear la suscripción. Intenta de nuevo.");
                    throw new Error("Failed to create subscription");
                }
            },
            onApprove: async (data: { subscriptionID?: string }) => {
                if (data.subscriptionID) {
                    setSuccess(true);
                    onSubscriptionCreated(data.subscriptionID, planKey);
                }
            },
            onError: () => {
                setError("Error en el pago con PayPal. Intenta de nuevo.");
            },
            onCancel: () => {
                setError("Pago cancelado.");
            },
        });

        buttonsInstanceRef.current = buttons;
        buttons.render(container);

        return () => {
            buttonsInstanceRef.current?.close().catch(() => {});
            buttonsInstanceRef.current = null;
        };
    }, [sdkReady, planKey, success]);

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
                    ) : sdkError ? (
                        <div className="text-center py-6">
                            <p className="text-destructive text-sm">No se pudo cargar PayPal. Recarga la página e intenta de nuevo.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <CreditCard className="h-4 w-4 shrink-0" />
                                <span>Paga con PayPal o tarjeta de crédito/débito a través de la ventana segura de PayPal.</span>
                            </div>

                            {!sdkReady && (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    <span className="ml-2 text-sm text-muted-foreground">Cargando PayPal...</span>
                                </div>
                            )}

                            <div ref={buttonsContainerRef} className={sdkReady ? "min-h-[150px]" : "hidden"} />
                        </div>
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
