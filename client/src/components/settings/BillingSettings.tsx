import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { 
    Loader2, 
    CreditCard, 
    Users, 
    Phone, 
    MessageSquare, 
    AlertTriangle,
    CheckCircle2,
    Clock,
    Sparkles
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function BillingSettings() {
    const { data, isLoading, error } = trpc.licensing.getStatus.useQuery();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <Card>
                <CardContent className="pt-6">
                    <div className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="h-5 w-5" />
                        <p>Error al cargar información de licencia: {error.message}</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const license = data?.license ?? { status: 'trial', plan: 'starter', expiresAt: null, features: [] };
    const usage = data?.usage ?? { messagesThisMonth: 0, activeUsers: 0, activeNumbers: 0 };
    const limits = data?.limits ?? { maxUsers: 5, maxWhatsappNumbers: 3, maxMessagesPerMonth: 10000 };

    const isExpired = Boolean(license.expiresAt && new Date(license.expiresAt) < new Date());
    const isTrial = license.status === 'trial';
    const isActive = license.status === 'active' && !isExpired;

    // Calculate trial days remaining
    const trialEndsAt = license.trialEndsAt ? new Date(license.trialEndsAt) : null;
    const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000)) : null;

    const usagePercentages = {
        users: limits.maxUsers > 0 ? Math.min(100, Math.round((usage.activeUsers / limits.maxUsers) * 100)) : 0,
        numbers: limits.maxWhatsappNumbers > 0 ? Math.min(100, Math.round((usage.activeNumbers / limits.maxWhatsappNumbers) * 100)) : 0,
        messages: limits.maxMessagesPerMonth > 0 ? Math.min(100, Math.round((usage.messagesThisMonth / limits.maxMessagesPerMonth) * 100)) : 0,
    };

    const planNames: Record<string, string> = {
        free: 'Gratis',
        starter: 'Starter',
        pro: 'Pro',
        enterprise: 'Enterprise',
    };

    return (
        <div className="space-y-6">
            {/* License Status Card */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <CreditCard className="h-5 w-5" />
                                Estado de Suscripción
                            </CardTitle>
                            <CardDescription>
                                Gestiona tu plan y límites de uso
                            </CardDescription>
                        </div>
                        <StatusBadge status={license.status} isExpired={isExpired} />
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm text-muted-foreground">Plan Actual</p>
                            <p className="text-lg font-semibold">{planNames[license.plan] || license.plan}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Estado</p>
                            <p className="text-lg font-semibold capitalize">
                                {isExpired ? 'Expirado' : license.status === 'active' ? 'Activo' : 'Prueba'}
                            </p>
                        </div>
                    </div>
                    
                    {license.expiresAt && (
                        <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">
                                {isExpired ? 'Expiró el' : 'Expira el'}:{' '}
                                <span className={isExpired ? 'text-destructive font-medium' : ''}>
                                    {format(new Date(license.expiresAt), 'dd MMMM yyyy', { locale: es })}
                                </span>
                            </span>
                        </div>
                    )}

                    {isTrial && (
                        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                                <div className="flex-1">
                                    <p className="font-medium text-amber-800 dark:text-amber-200">
                                        Estás en modo de prueba
                                        {trialDaysLeft !== null && (
                                            <span className="ml-2 inline-flex items-center rounded-full bg-amber-200 dark:bg-amber-800 px-2.5 py-0.5 text-xs font-semibold">
                                                {trialDaysLeft === 0 ? "Expira hoy" : `${trialDaysLeft} día${trialDaysLeft !== 1 ? 's' : ''} restante${trialDaysLeft !== 1 ? 's' : ''}`}
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                                        {trialDaysLeft !== null && trialDaysLeft <= 3
                                            ? "Tu periodo de prueba está por terminar. Actualiza ahora para no perder acceso."
                                            : "Actualiza a un plan pagado para desbloquear todos los límites y funcionalidades."}
                                    </p>
                                    {trialEndsAt && (
                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                            Vence el {format(trialEndsAt, 'dd MMMM yyyy', { locale: es })}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {isExpired && (
                        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                                <div>
                                    <p className="font-medium text-destructive">
                                        Tu licencia ha expirado
                                    </p>
                                    <p className="text-sm text-destructive/80 mt-1">
                                        Renueva tu suscripción para continuar usando todas las funcionalidades.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    <BillingActions isActive={isActive} />
                </CardContent>
            </Card>

            {/* Usage Limits */}
            <Card>
                <CardHeader>
                    <CardTitle>Uso del Mes</CardTitle>
                    <CardDescription>
                        Resumen de tu consumo actual respecto a los límites del plan
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Users */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Users className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">Usuarios Activos</span>
                            </div>
                            <span className="text-sm text-muted-foreground">
                                {usage.activeUsers} / {limits.maxUsers}
                            </span>
                        </div>
                        <Progress value={usagePercentages.users} className="h-2" />
                        {usagePercentages.users >= 90 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                ⚠️ Cerca del límite de usuarios
                            </p>
                        )}
                    </div>

                    {/* WhatsApp Numbers */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">Números WhatsApp</span>
                            </div>
                            <span className="text-sm text-muted-foreground">
                                {usage.activeNumbers} / {limits.maxWhatsappNumbers}
                            </span>
                        </div>
                        <Progress value={usagePercentages.numbers} className="h-2" />
                        {usagePercentages.numbers >= 90 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                ⚠️ Cerca del límite de números
                            </p>
                        )}
                    </div>

                    {/* Messages */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">Mensajes Enviados</span>
                            </div>
                            <span className="text-sm text-muted-foreground">
                                {usage.messagesThisMonth.toLocaleString()} / {limits.maxMessagesPerMonth.toLocaleString()}
                            </span>
                        </div>
                        <Progress value={usagePercentages.messages} className="h-2" />
                        {usagePercentages.messages >= 90 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                ⚠️ Cerca del límite de mensajes
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Features */}
            <Card>
                <CardHeader>
                    <CardTitle>Características del Plan</CardTitle>
                    <CardDescription>
                        Funcionalidades incluidas en tu suscripción
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-3">
                        <FeatureRow 
                            name="WhatsApp QR (Baileys)" 
                            included={true}
                            description="Conexión vía escaneo de QR"
                        />
                        <FeatureRow 
                            name="WhatsApp Cloud API" 
                            included={license.plan === 'pro' || license.plan === 'enterprise'}
                            description="API oficial de Meta"
                        />
                        <FeatureRow 
                            name="Campañas Multicanal" 
                            included={true}
                            description="WhatsApp y Email marketing"
                        />
                        <FeatureRow 
                            name="Automatizaciones" 
                            included={true}
                            description="Flujos y triggers automáticos"
                        />
                        <FeatureRow 
                            name="Webhooks" 
                            included={license.plan === 'pro' || license.plan === 'enterprise'}
                            description="Integraciones con n8n, Zapier"
                        />
                        <FeatureRow 
                            name="Inteligencia Artificial" 
                            included={license.plan === 'pro' || license.plan === 'enterprise'}
                            description="Asistente IA con OpenAI, Anthropic o Gemini"
                        />
                        <FeatureRow 
                            name="Reportes Avanzados" 
                            included={license.plan === 'pro' || license.plan === 'enterprise'}
                            description="Analytics y exportación CSV"
                        />
                        <FeatureRow 
                            name="Soporte Prioritario" 
                            included={license.plan === 'enterprise'}
                            description="Atención 24/7"
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

/**
 * Billing Actions Component
 * Connects to PayPal for subscription upgrades and management.
 */
function BillingActions({ isActive }: { isActive: boolean }) {
    const billingPlan = trpc.billing.getCurrentPlan.useQuery();
    const licensingStatus = trpc.licensing.getStatus.useQuery();
    const createSub = trpc.billing.createSubscription.useMutation({
        onSuccess: (data) => {
            if (data.url) {
                // Store subscriptionId so we can confirm later
                sessionStorage.setItem("pp_sub_id", data.subscriptionId);
                window.location.href = data.url;
            }
        },
        onError: (e) => {
            // If PayPal is not configured, show plans comparison
            if (e.message.includes("no está configurado")) {
                setShowPlans(true);
            }
        },
    });
    const manageUrl = trpc.billing.getManageUrl.useMutation({
        onSuccess: (data) => {
            if (data.url) {
                window.open(data.url, "_blank");
            }
        },
    });
    const confirmSub = trpc.billing.confirmSubscription.useMutation({
        onSuccess: () => {
            billingPlan.refetch();
        },
    });

    const [showPlans, setShowPlans] = React.useState(false);
    const [cancelled, setCancelled] = React.useState(false);
    const allPlans = billingPlan.data?.allPlans;
    const currentPlan = billingPlan.data?.plan || "free";
    const isTrial = licensingStatus.data?.license?.status === 'trial';

    // On mount, check if returning from PayPal success/cancel redirect
    React.useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const success = params.get("success");
        const plan = params.get("plan");
        const storedSubId = sessionStorage.getItem("pp_sub_id");
        const cleanUrl = `${window.location.pathname}?tab=billing`;

        if (success === "true" && plan && storedSubId) {
            sessionStorage.removeItem("pp_sub_id");
            confirmSub.mutate({
                subscriptionId: storedSubId,
                plan: plan as "starter" | "pro" | "enterprise",
            });
            window.history.replaceState({}, "", cleanUrl);
        } else if (params.get("cancelled") === "true") {
            sessionStorage.removeItem("pp_sub_id");
            setCancelled(true);
            setShowPlans(true);
            window.history.replaceState({}, "", cleanUrl);
        }
    }, []);

    return (
        <div className="space-y-4 pt-2">
            {confirmSub.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-muted/50 rounded">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Confirmando suscripción con PayPal...
                </div>
            )}
            {confirmSub.isSuccess && (
                <div className="flex items-center gap-2 text-sm text-green-600 p-2 bg-green-50 dark:bg-green-950/30 rounded">
                    <CheckCircle2 className="h-4 w-4" />
                    ¡Suscripción activada correctamente!
                </div>
            )}            {cancelled && (
                <div className="flex items-center gap-2 text-sm text-amber-600 p-2 bg-amber-50 dark:bg-amber-950/30 rounded">
                    <AlertTriangle className="h-4 w-4" />
                    El pago fue cancelado. Puedes intentarlo de nuevo seleccionando un plan.
                </div>
            )}
            <div className="flex gap-3">
                {isActive ? (
                    <Button
                        onClick={() => manageUrl.mutate()}
                        disabled={manageUrl.isPending}
                    >
                        {manageUrl.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Gestionar Suscripción
                    </Button>
                ) : (
                    <>
                        <Button
                            onClick={() => setShowPlans(!showPlans)}
                        >
                            Actualizar Plan
                        </Button>
                        {isTrial && (
                            <Button
                                variant="outline"
                                className="border-primary text-primary hover:bg-primary/10"
                                onClick={() => setShowPlans(true)}
                            >
                                <Sparkles className="mr-2 h-4 w-4" />
                                Terminar prueba y pasar a pago
                            </Button>
                        )}
                    </>
                )}
            </div>

            {showPlans && allPlans && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    {(["starter", "pro", "enterprise"] as const).map((planKey) => {
                        const plan = allPlans[planKey];
                        const isCurrent = currentPlan === planKey;
                        return (
                            <div
                                key={planKey}
                                className={`border rounded-lg p-4 space-y-3 ${
                                    isCurrent ? "border-primary bg-primary/5" : "border-border"
                                }`}
                            >
                                <div>
                                    <h4 className="font-semibold text-lg">{plan.name}</h4>
                                    <p className="text-2xl font-bold">
                                        ${plan.priceMonthly}
                                        <span className="text-sm font-normal text-muted-foreground">/mes</span>
                                    </p>
                                </div>
                                <ul className="text-sm space-y-1 text-muted-foreground">
                                    <li>Hasta {plan.maxUsers} usuarios</li>
                                    <li>Hasta {plan.maxWaNumbers} números WhatsApp</li>
                                    <li>Hasta {plan.maxMessages.toLocaleString()} mensajes/mes</li>
                                </ul>
                                <Button
                                    className="w-full"
                                    variant={isCurrent ? "outline" : "default"}
                                    disabled={isCurrent || createSub.isPending}
                                    onClick={() => createSub.mutate({ plan: planKey })}
                                >
                                    {isCurrent ? "Plan Actual" : createSub.isPending ? "Procesando..." : "Seleccionar"}
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function StatusBadge({ status, isExpired }: { status: string; isExpired: boolean }) {
    if (isExpired) {
        return (
            <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Expirado
            </Badge>
        );
    }

    switch (status) {
        case 'active':
            return (
                <Badge variant="default" className="bg-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Activo
                </Badge>
            );
        case 'trial':
            return (
                <Badge variant="outline" className="border-amber-500 text-amber-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Prueba
                </Badge>
            );
        case 'canceled':
            return (
                <Badge variant="secondary" className="flex items-center gap-1">
                    Cancelado
                </Badge>
            );
        default:
            return (
                <Badge variant="outline">{status}</Badge>
            );
    }
}

function FeatureRow({ 
    name, 
    included, 
    description 
}: { 
    name: string; 
    included: boolean;
    description: string;
}) {
    return (
        <div className="flex items-center justify-between py-2 border-b last:border-0">
            <div>
                <p className={`font-medium ${included ? '' : 'text-muted-foreground'}`}>{name}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            {included ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
                <span className="text-xs text-muted-foreground">No incluido</span>
            )}
        </div>
    );
}
