import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";
import {
    MessageCircle, Moon, Sun, Building2, User, Mail, Lock,
    ArrowRight, ArrowLeft, Loader2, Check, X, Globe
} from "lucide-react";

type Step = "company" | "account" | "confirm";

export default function Signup() {
    const [, setLocation] = useLocation();
    const { theme, toggleTheme } = useTheme();
    const [step, setStep] = useState<Step>("company");
    const [acceptedTerms, setAcceptedTerms] = useState(false);

    const [form, setForm] = useState({
        companyName: "",
        slug: "",
        ownerName: "",
        email: "",
        password: "",
        confirmPassword: "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Asuncion",
        language: "es",
        currency: "USD",
    });

    // Auto-generate slug from company name
    useEffect(() => {
        if (step === "company") {
            const generated = form.companyName
                .toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 50);
            setForm(prev => ({ ...prev, slug: generated }));
        }
    }, [form.companyName, step]);

    // Slug availability check (debounced)
    const [slugToCheck, setSlugToCheck] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => {
            if (form.slug.length >= 3) {
                setSlugToCheck(form.slug);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [form.slug]);

    const slugCheck = trpc.signup.checkSlug.useQuery(
        { slug: slugToCheck },
        { enabled: slugToCheck.length >= 3, retry: false }
    );

    const register = trpc.signup.register.useMutation({
        onSuccess: (data) => {
            if (data.success) {
                toast.success(data.message || "Cuenta creada exitosamente");
                setTimeout(() => {
                    window.location.href = "/";
                }, 800);
            } else {
                toast.error(data.error || "Error al crear la cuenta");
            }
        },
        onError: (e) => toast.error(e.message || "Error al crear la cuenta"),
    });

    const handleSubmit = () => {
        if (form.password !== form.confirmPassword) {
            toast.error("Las contraseñas no coinciden");
            return;
        }
        if (form.password.length < 8) {
            toast.error("La contraseña debe tener al menos 8 caracteres");
            return;
        }
        if (!acceptedTerms) {
            toast.error("Debes aceptar los términos y condiciones");
            return;
        }

        register.mutate({
            companyName: form.companyName,
            slug: form.slug,
            ownerName: form.ownerName,
            email: form.email,
            password: form.password,
            timezone: form.timezone,
            language: form.language,
            currency: form.currency,
            termsVersion: "1.0",
        });
    };

    const canProceedCompany = form.companyName.length >= 2 && form.slug.length >= 3 && slugCheck.data?.available;
    const canProceedAccount = form.ownerName.length >= 2 && form.email.includes("@") && form.password.length >= 8 && form.password === form.confirmPassword;

    const updateField = (field: string, value: string) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    return (
        <div className="min-h-screen relative overflow-hidden bg-background">
            {/* Animated Background */}
            <div className="animated-bg" />

            {/* Floating particles */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute w-2 h-2 bg-purple-500/30 rounded-full animate-pulse" style={{ top: '20%', left: '10%' }} />
                <div className="absolute w-3 h-3 bg-blue-500/20 rounded-full animate-pulse" style={{ top: '60%', left: '80%', animationDelay: '1s' }} />
                <div className="absolute w-2 h-2 bg-pink-500/25 rounded-full animate-pulse" style={{ top: '80%', left: '20%', animationDelay: '2s' }} />
                <div className="absolute w-4 h-4 bg-cyan-500/15 rounded-full animate-pulse" style={{ top: '30%', left: '70%', animationDelay: '0.5s' }} />
            </div>

            {/* Theme Toggle */}
            <div className="absolute top-4 right-4 z-10">
                <Button
                    variant="outline"
                    size="icon"
                    onClick={toggleTheme}
                    className="rounded-full bg-card/50 backdrop-blur-sm border-border/50 hover:bg-card"
                >
                    {theme === "dark" ? (
                        <Sun className="h-5 w-5 text-yellow-400" />
                    ) : (
                        <Moon className="h-5 w-5 text-purple-500" />
                    )}
                </Button>
            </div>

            {/* Main Content */}
            <div className="min-h-screen flex items-center justify-center p-4">
                <div className="w-full max-w-lg">
                    {/* Logo and Title */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 mb-4 shadow-lg shadow-purple-500/25">
                            <MessageCircle className="h-8 w-8 text-white" />
                        </div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent">
                            Crear Cuenta
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Registra tu empresa y comienza a usar Imagine CRM
                        </p>
                    </div>

                    {/* Progress Steps */}
                    <div className="flex items-center justify-center gap-2 mb-6">
                        {(["company", "account", "confirm"] as Step[]).map((s, i) => (
                            <div key={s} className="flex items-center gap-2">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                                    step === s
                                        ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg"
                                        : (["company", "account", "confirm"].indexOf(step) > i)
                                            ? "bg-green-500 text-white"
                                            : "bg-muted text-muted-foreground"
                                }`}>
                                    {["company", "account", "confirm"].indexOf(step) > i ? (
                                        <Check className="w-4 h-4" />
                                    ) : (
                                        i + 1
                                    )}
                                </div>
                                {i < 2 && (
                                    <div className={`w-12 h-0.5 ${
                                        ["company", "account", "confirm"].indexOf(step) > i
                                            ? "bg-green-500"
                                            : "bg-muted"
                                    }`} />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Step 1: Company Info */}
                    {step === "company" && (
                        <Card className="glass-card border-border/50 shadow-2xl shadow-purple-500/10">
                            <CardHeader className="text-center pb-4">
                                <CardTitle className="text-xl flex items-center justify-center gap-2">
                                    <Building2 className="w-5 h-5" />
                                    Datos de la Empresa
                                </CardTitle>
                                <CardDescription>
                                    Ingresa el nombre de tu empresa o negocio
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="companyName">Nombre de la Empresa</Label>
                                    <div className="relative">
                                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="companyName"
                                            placeholder="Mi Empresa S.A."
                                            className="pl-10 bg-card/50 border-border/50 focus:border-primary"
                                            value={form.companyName}
                                            onChange={(e) => updateField("companyName", e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="slug">URL de tu CRM</Label>
                                    <div className="relative">
                                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="slug"
                                            placeholder="mi-empresa"
                                            className="pl-10 bg-card/50 border-border/50 focus:border-primary"
                                            value={form.slug}
                                            onChange={(e) => updateField("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="text-muted-foreground">
                                            {form.slug}.imaginecrm.com
                                        </span>
                                        {slugToCheck && slugCheck.data && (
                                            slugCheck.data.available ? (
                                                <span className="text-green-500 flex items-center gap-1">
                                                    <Check className="w-3 h-3" /> Disponible
                                                </span>
                                            ) : (
                                                <span className="text-red-500 flex items-center gap-1">
                                                    <X className="w-3 h-3" /> {slugCheck.data.reason}
                                                </span>
                                            )
                                        )}
                                        {slugCheck.isLoading && (
                                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                                        )}
                                    </div>
                                </div>

                                <Button
                                    className="w-full h-11 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg"
                                    disabled={!canProceedCompany}
                                    onClick={() => setStep("account")}
                                >
                                    Siguiente
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>

                                <div className="text-center text-sm">
                                    <span className="text-muted-foreground">¿Ya tienes cuenta? </span>
                                    <a href="/login" className="text-primary hover:underline font-medium">
                                        Iniciar Sesión
                                    </a>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Step 2: Account Info */}
                    {step === "account" && (
                        <Card className="glass-card border-border/50 shadow-2xl shadow-purple-500/10">
                            <CardHeader className="text-center pb-4">
                                <CardTitle className="text-xl flex items-center justify-center gap-2">
                                    <User className="w-5 h-5" />
                                    Tu Cuenta
                                </CardTitle>
                                <CardDescription>
                                    Datos del administrador principal
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="ownerName">Nombre Completo</Label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="ownerName"
                                            placeholder="Juan Pérez"
                                            className="pl-10 bg-card/50 border-border/50 focus:border-primary"
                                            value={form.ownerName}
                                            onChange={(e) => updateField("ownerName", e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="tu@email.com"
                                            className="pl-10 bg-card/50 border-border/50 focus:border-primary"
                                            value={form.email}
                                            onChange={(e) => updateField("email", e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="password">Contraseña</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="password"
                                            type="password"
                                            placeholder="Mínimo 8 caracteres"
                                            className="pl-10 bg-card/50 border-border/50 focus:border-primary"
                                            value={form.password}
                                            onChange={(e) => updateField("password", e.target.value)}
                                        />
                                    </div>
                                    {form.password.length > 0 && form.password.length < 8 && (
                                        <p className="text-xs text-red-500">Mínimo 8 caracteres</p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="confirmPassword">Confirmar Contraseña</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="confirmPassword"
                                            type="password"
                                            placeholder="Repetir contraseña"
                                            className="pl-10 bg-card/50 border-border/50 focus:border-primary"
                                            value={form.confirmPassword}
                                            onChange={(e) => updateField("confirmPassword", e.target.value)}
                                        />
                                    </div>
                                    {form.confirmPassword.length > 0 && form.password !== form.confirmPassword && (
                                        <p className="text-xs text-red-500">Las contraseñas no coinciden</p>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    <Button
                                        variant="outline"
                                        className="flex-1 h-11"
                                        onClick={() => setStep("company")}
                                    >
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        Atrás
                                    </Button>
                                    <Button
                                        className="flex-1 h-11 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg"
                                        disabled={!canProceedAccount}
                                        onClick={() => setStep("confirm")}
                                    >
                                        Siguiente
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Step 3: Confirm */}
                    {step === "confirm" && (
                        <Card className="glass-card border-border/50 shadow-2xl shadow-purple-500/10">
                            <CardHeader className="text-center pb-4">
                                <CardTitle className="text-xl flex items-center justify-center gap-2">
                                    <Check className="w-5 h-5" />
                                    Confirmar Registro
                                </CardTitle>
                                <CardDescription>
                                    Revisa los datos antes de crear tu cuenta
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="bg-muted/30 rounded-lg p-4 space-y-3 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Empresa:</span>
                                        <span className="font-medium">{form.companyName}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">URL:</span>
                                        <span className="font-medium">{form.slug}.imaginecrm.com</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Administrador:</span>
                                        <span className="font-medium">{form.ownerName}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Email:</span>
                                        <span className="font-medium">{form.email}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Plan:</span>
                                        <span className="font-medium text-green-500">Gratis</span>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 p-3 bg-muted/20 rounded-lg">
                                    <Checkbox
                                        id="terms"
                                        checked={acceptedTerms}
                                        onCheckedChange={(c) => setAcceptedTerms(c as boolean)}
                                    />
                                    <Label htmlFor="terms" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                                        Acepto los{" "}
                                        <a href="/terms" target="_blank" className="text-primary hover:underline">
                                            Términos de Servicio
                                        </a>{" "}
                                        y la{" "}
                                        <a href="/privacy" target="_blank" className="text-primary hover:underline">
                                            Política de Privacidad
                                        </a>
                                        . Entiendo que mis datos serán procesados de acuerdo con estas políticas.
                                    </Label>
                                </div>

                                <div className="flex gap-3">
                                    <Button
                                        variant="outline"
                                        className="flex-1 h-11"
                                        onClick={() => setStep("account")}
                                    >
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        Atrás
                                    </Button>
                                    <Button
                                        className="flex-1 h-11 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg"
                                        disabled={!acceptedTerms || register.isPending}
                                        onClick={handleSubmit}
                                    >
                                        {register.isPending ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Creando...
                                            </>
                                        ) : (
                                            <>
                                                Crear Cuenta
                                                <ArrowRight className="ml-2 h-4 w-4" />
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Footer */}
                    <p className="text-center text-xs text-muted-foreground mt-6">
                        Powered by Imagine Lab CRM
                    </p>
                </div>
            </div>
        </div>
    );
}
