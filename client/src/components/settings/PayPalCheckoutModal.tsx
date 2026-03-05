import React, { useState } from "react";
import {
    PayPalScriptProvider,
    PayPalButtons,
    PayPalCardFieldsProvider,
    PayPalNameField,
    PayPalNumberField,
    PayPalExpiryField,
    PayPalCVVField,
    usePayPalCardFields,
} from "@paypal/react-paypal-js";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, X, ShieldCheck } from "lucide-react";
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

/**
 * PayPal inline checkout — shows BOTH PayPal button and direct card form.
 * Card fields use vault flow: setup-token → payment-token → subscription.
 * PayPal button uses standard subscription redirect flow.
 */
export function PayPalCheckoutModal({
    planKey,
    planName,
    price,
    paypalClientId,
    paypalMode,
    onSubscriptionCreated,
    onCancel,
}: PayPalCheckoutModalProps) {
    const [paymentMethod, setPaymentMethod] = useState<"paypal" | "card">("card");
    const [error, setError] = useState<string | null>(null);

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

                {/* Payment method tabs */}
                <div className="flex border-b">
                    <button
                        className={`flex-1 py-3 text-sm font-medium text-center border-b-2 transition-colors ${
                            paymentMethod === "card"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => { setPaymentMethod("card"); setError(null); }}
                    >
                        <CreditCard className="h-4 w-4 inline-block mr-2" />
                        Tarjeta de Crédito/Débito
                    </button>
                    <button
                        className={`flex-1 py-3 text-sm font-medium text-center border-b-2 transition-colors ${
                            paymentMethod === "paypal"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => { setPaymentMethod("paypal"); setError(null); }}
                    >
                        <PayPalIcon className="h-4 w-4 inline-block mr-2" />
                        PayPal
                    </button>
                </div>

                <div className="p-5">
                    {error && (
                        <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
                            {error}
                        </div>
                    )}

                    <PayPalScriptProvider
                        options={{
                            clientId: paypalClientId,
                            vault: true,
                            intent: "subscription",
                            components: "buttons,card-fields",
                            locale: "es_ES",
                        }}
                    >
                        {/* PayPal Button */}
                        <div className={paymentMethod === "paypal" ? "block" : "hidden"}>
                            <PayPalSubscriptionButtons
                                planKey={planKey}
                                onApprove={(subId) => onSubscriptionCreated(subId, planKey)}
                                onError={(msg) => setError(msg)}
                            />
                        </div>

                        {/* Card Fields (vault flow) */}
                        <div className={paymentMethod === "card" ? "block" : "hidden"}>
                            <CardFieldsForm
                                planKey={planKey}
                                price={price}
                                planName={planName}
                                onApprove={(subId) => onSubscriptionCreated(subId, planKey)}
                                onError={(msg) => setError(msg)}
                            />
                        </div>
                    </PayPalScriptProvider>

                    <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Pago seguro procesado por PayPal. No almacenamos datos de tarjeta.
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── PayPal Buttons (subscription popup) ──────────────── */
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
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground mb-3">
                Se abrirá una ventana de PayPal para completar el pago.
            </p>
            <PayPalButtons
                style={{
                    shape: "rect",
                    color: "blue",
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
        </div>
    );
}

/* ── Card Fields (vault flow) ─────────────────────────── */
function CardFieldsForm({
    planKey,
    price,
    planName,
    onApprove,
    onError,
}: {
    planKey: string;
    price: number;
    planName: string;
    onApprove: (subscriptionId: string) => void;
    onError: (msg: string) => void;
}) {
    const [isPaying, setIsPaying] = useState(false);
    const createVault = trpc.billing.createVaultSetupToken.useMutation();
    const completeCard = trpc.billing.completeCardSubscription.useMutation();

    return (
        <PayPalCardFieldsProvider
            createVaultSetupToken={async () => {
                try {
                    const result = await createVault.mutateAsync({
                        plan: planKey as "starter" | "pro" | "enterprise",
                    });
                    return result.setupTokenId;
                } catch {
                    onError("Error al preparar el formulario. Intenta de nuevo.");
                    throw new Error("Failed to create vault setup token");
                }
            }}
            onApprove={async (data) => {
                // data.vaultSetupToken contains the approved setup token
                try {
                    setIsPaying(true);
                    const vaultSetupToken = (data as any).vaultSetupToken ?? (data as any).orderID ?? "";
                    const result = await completeCard.mutateAsync({
                        plan: planKey as "starter" | "pro" | "enterprise",
                        vaultSetupToken,
                    });
                    if (result.subscriptionId) {
                        onApprove(result.subscriptionId);
                    }
                } catch {
                    onError("Error al procesar el pago. Intenta de nuevo.");
                } finally {
                    setIsPaying(false);
                }
            }}
            onError={() => {
                setIsPaying(false);
                onError("Error al procesar la tarjeta. Verifica los datos e intenta de nuevo.");
            }}
            style={{
                input: {
                    "font-size": "14px",
                    "font-family": "inherit",
                    color: "#1a1a1a",
                    padding: "12px",
                },
                "input:focus": {
                    color: "#1a1a1a",
                },
            }}
        >
            <div className="space-y-4">
                <div>
                    <label className="text-sm font-medium mb-1.5 block">Nombre en la tarjeta</label>
                    <PayPalNameField className="w-full rounded-md border border-input" />
                </div>

                <div>
                    <label className="text-sm font-medium mb-1.5 block">Número de tarjeta</label>
                    <PayPalNumberField className="w-full rounded-md border border-input" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-sm font-medium mb-1.5 block">Vencimiento</label>
                        <PayPalExpiryField className="w-full rounded-md border border-input" />
                    </div>
                    <div>
                        <label className="text-sm font-medium mb-1.5 block">CVV</label>
                        <PayPalCVVField className="w-full rounded-md border border-input" />
                    </div>
                </div>

                <SubmitPayment
                    isPaying={isPaying}
                    setIsPaying={setIsPaying}
                    price={price}
                    planName={planName}
                    onError={onError}
                />
            </div>
        </PayPalCardFieldsProvider>
    );
}

/* Submit button that uses the card fields context */
function SubmitPayment({
    isPaying,
    setIsPaying,
    price,
    planName,
    onError,
}: {
    isPaying: boolean;
    setIsPaying: (v: boolean) => void;
    price: number;
    planName: string;
    onError: (msg: string) => void;
}) {
    const { cardFieldsForm } = usePayPalCardFields();

    const handleClick = async () => {
        if (!cardFieldsForm) return;
        setIsPaying(true);
        try {
            await cardFieldsForm.submit();
        } catch {
            onError("Error al procesar el pago. Verifica los datos de tu tarjeta.");
        } finally {
            setIsPaying(false);
        }
    };

    return (
        <Button
            onClick={handleClick}
            disabled={isPaying}
            className="w-full h-12 text-base"
        >
            {isPaying ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando...
                </>
            ) : (
                <>
                    <CreditCard className="mr-2 h-4 w-4" />
                    Pagar ${price}/mes — Plan {planName}
                </>
            )}
        </Button>
    );
}

/* ── PayPal SVG icon ───────────── */
function PayPalIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797H9.603c-.564 0-1.04.408-1.13.964L7.076 21.337z" />
        </svg>
    );
}
