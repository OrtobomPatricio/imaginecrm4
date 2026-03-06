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
import PasswordStrengthMeter, { validatePassword } from "@/components/PasswordStrengthMeter";
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
        if (!validatePassword(form.password)) {
            toast.error("La contraseña no cumple los requisitos de seguridad");
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
            termsVersion: "1.0.0",
        });
    };

    const canProceedCompany = form.companyName.length >= 2 && form.slug.length >= 3 && slugCheck.data?.available;
    const canProceedAccount = form.ownerName.length >= 2 && /^[^@]+@[^@]+\.[^@]+$/.test(form.email) && validatePassword(form.password) && form.password === form.confirmPassword;

    // OAuth provider discovery
    const [enabledProviders, setEnabledProviders] = useState<string[]>([]);

    useEffect(() => {
        fetch("/api/auth/providers")
            .then((r) => r.ok ? r.json() : { providers: [] })
            .then((data) => setEnabledProviders(data.providers ?? []))
            .catch(() => setEnabledProviders([]));

        // Handle OAuth signup error redirect
        const params = new URLSearchParams(window.location.search);
        const error = params.get("error");
        if (error === "oauth_signup_failed") {
            toast.error("No se pudo crear la cuenta. El nombre o email ya está en uso.");
            window.history.replaceState({}, "", "/signup");
        }
    }, []);

    // Listen for OAuth signup completion
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === 'oauth-success') {
                toast.success("Cuenta creada exitosamente");
                setTimeout(() => { window.location.href = "/"; }, 800);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleOAuthSignup = (provider: 'google' | 'facebook' | 'microsoft') => {
        const params = new URLSearchParams({
            companyName: form.companyName,
            slug: form.slug,
            timezone: form.timezone,
            language: form.language,
            currency: form.currency,
        });
        const width = 500;
        const height = 600;
        const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
        const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
        const popup = window.open(
            `/api/auth/${provider}/signup?${params}`,
            'oauth-signup-popup',
            `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
        );
        if (!popup || popup.closed) {
            window.location.href = `/api/auth/${provider}/signup?${params}`;
        }
    };

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
                                    Elige cómo crear tu cuenta
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {enabledProviders.length > 0 && (
                                    <>
                                        <div className="grid gap-3">
                                            {enabledProviders.includes('google') && (
                                                <Button
                                                    variant="outline"
                                                    className="w-full h-11 bg-card/50 hover:bg-card border-border/50 transition-all duration-300 hover:border-blue-500/30 hover:shadow-md transform hover:scale-[1.02] active:scale-[0.98] group"
                                                    onClick={() => handleOAuthSignup('google')}
                                                >
                                                    <svg className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                                    </svg>
                                                    Registrarse con Google
                                                </Button>
                                            )}
                                            {enabledProviders.includes('facebook') && (
                                                <Button
                                                    variant="outline"
                                                    className="w-full h-11 bg-card/50 hover:bg-card border-border/50 transition-all duration-300 hover:border-blue-600/30 hover:shadow-md transform hover:scale-[1.02] active:scale-[0.98] group"
                                                    onClick={() => handleOAuthSignup('facebook')}
                                                >
                                                    <svg className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                                                        <path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                                                    </svg>
                                                    Registrarse con Facebook
                                                </Button>
                                            )}
                                            {enabledProviders.includes('microsoft') && (
                                                <Button
                                                    variant="outline"
                                                    className="w-full h-11 bg-card/50 hover:bg-card border-border/50 transition-all duration-300 hover:border-blue-700/30 hover:shadow-md transform hover:scale-[1.02] active:scale-[0.98] group"
                                                    onClick={() => handleOAuthSignup('microsoft')}
                                                >
                                                    <svg className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                                                        <path fill="#F25022" d="M1 1h10v10H1z" />
                                                        <path fill="#00A4EF" d="M1 13h10v10H1z" />
                                                        <path fill="#7FBA00" d="M13 1h10v10H13z" />
                                                        <path fill="#FFB900" d="M13 13h10v10H13z" />
                                                    </svg>
                                                    Registrarse con Microsoft
                                                </Button>
                                            )}
                                        </div>
                                        <p className="text-center text-xs text-muted-foreground">
                                            Al registrarte, aceptas nuestros{" "}
                                            <a href="/terms" target="_blank" className="text-primary hover:underline">Términos</a>
                                            {" "}y{" "}
                                            <a href="/privacy" target="_blank" className="text-primary hover:underline">Política de Privacidad</a>
                                        </p>
                                        <div className="relative my-2">
                                            <div className="absolute inset-0 flex items-center">
                                                <span className="w-full border-t border-muted" />
                                            </div>
                                            <div className="relative flex justify-center text-xs uppercase">
                                                <span className="bg-background/80 backdrop-blur-sm px-2 text-muted-foreground/70">
                                                    O completa manualmente
                                                </span>
                                            </div>
                                        </div>
                                    </>
                                )}
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
                                    <PasswordStrengthMeter password={form.password}
                                    />
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
