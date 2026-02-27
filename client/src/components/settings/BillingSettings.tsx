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
    Clock
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

    const usagePercentages = {
        users: limits.maxUsers > 0 ? Math.min(100, Math.round((usage.activeUsers / limits.maxUsers) * 100)) : 0,
        numbers: limits.maxWhatsappNumbers > 0 ? Math.min(100, Math.round((usage.activeNumbers / limits.maxWhatsappNumbers) * 100)) : 0,
        messages: limits.maxMessagesPerMonth > 0 ? Math.min(100, Math.round((usage.messagesThisMonth / limits.maxMessagesPerMonth) * 100)) : 0,
    };

    const planNames: Record<string, string> = {
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
                                <div>
                                    <p className="font-medium text-amber-800 dark:text-amber-200">
                                        Estás en modo de prueba
                                    </p>
                                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                                        Actualiza a un plan pagado para desbloquear todos los límites y funcionalidades.
                                    </p>
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
                            name="Webhooks" 
                            included={license.plan === 'pro' || license.plan === 'enterprise'}
                            description="Integraciones con n8n, Zapier"
                        />
                        <FeatureRow 
                            name="Reportes Avanzados" 
                            included={license.plan === 'enterprise'}
                            description="Analytics y exportación"
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
 * Connects to Stripe Checkout for upgrades and Billing Portal for management.
 */
function BillingActions({ isActive }: { isActive: boolean }) {
    const billingPlan = trpc.billing.getCurrentPlan.useQuery();
    const checkout = trpc.billing.createCheckoutSession.useMutation({
        onSuccess: (data) => {
            if (data.url) {
                window.location.href = data.url;
            }
        },
        onError: (e) => {
            // If Stripe is not configured, show plans comparison
            if (e.message.includes("no est\u00e1 configurado")) {
                setShowPlans(true);
            }
        },
    });
    const portal = trpc.billing.getBillingPortal.useMutation({
        onSuccess: (data) => {
            if (data.url) {
                window.location.href = data.url;
            }
        },
    });

    const [showPlans, setShowPlans] = React.useState(false);
    const allPlans = billingPlan.data?.allPlans;
    const currentPlan = billingPlan.data?.plan || "free";

    return (
        <div className="space-y-4 pt-2">
            <div className="flex gap-3">
                {isActive ? (
                    <Button
                        onClick={() => portal.mutate()}
                        disabled={portal.isPending}
                    >
                        {portal.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Gestionar Suscripci\u00f3n
                    </Button>
                ) : (
                    <Button
                        onClick={() => setShowPlans(!showPlans)}
                    >
                        Actualizar Plan
                    </Button>
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
                                    <li>Hasta {plan.maxWaNumbers} n\u00fameros WhatsApp</li>
                                    <li>Hasta {plan.maxMessages.toLocaleString()} mensajes/mes</li>
                                </ul>
                                <Button
                                    className="w-full"
                                    variant={isCurrent ? "outline" : "default"}
                                    disabled={isCurrent || checkout.isPending}
                                    onClick={() => checkout.mutate({ plan: planKey })}
                                >
                                    {isCurrent ? "Plan Actual" : checkout.isPending ? "Procesando..." : "Seleccionar"}
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
