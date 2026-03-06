
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";
import { MessageCircle, Moon, Sun, Lock, Loader2, ShieldCheck, MailWarning, ArrowLeft } from "lucide-react";
import PasswordStrengthMeter, { validatePassword } from "@/components/PasswordStrengthMeter";

export default function SetupAccount() {
    const [, setLocation] = useLocation();
    const { theme, toggleTheme } = useTheme();
    const search = useSearch();
    const params = new URLSearchParams(search);
    const token = params.get("token");

    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");

    const accept = trpc.auth.acceptInvitation.useMutation({
        onSuccess: () => {
            toast.success("Cuenta configurada correctamente. Iniciando sesión...");
            setTimeout(() => setLocation("/"), 1200);
        },
        onError: (e) => toast.error(e.message),
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!validatePassword(password)) {
            toast.error("La contraseña no cumple los requisitos de seguridad");
            return;
        }
        if (password !== confirm) {
            toast.error("Las contraseñas no coinciden");
            return;
        }
        if (!token) {
            toast.error("Token inválido");
            return;
        }
        accept.mutate({ token, password });
    };

    const passwordValid = validatePassword(password);
    const passwordsMatch = password === confirm && confirm.length > 0;

    if (!token) {
        return (
            <div className="min-h-screen relative overflow-hidden bg-background">
                <div className="animated-bg" />
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute w-2 h-2 bg-purple-500/30 rounded-full animate-pulse" style={{ top: '20%', left: '10%' }} />
                    <div className="absolute w-3 h-3 bg-blue-500/20 rounded-full animate-pulse" style={{ top: '60%', left: '80%', animationDelay: '1s' }} />
                    <div className="absolute w-2 h-2 bg-pink-500/25 rounded-full animate-pulse" style={{ top: '80%', left: '20%', animationDelay: '2s' }} />
                </div>

                <div className="absolute top-4 right-4 z-10">
                    <Button variant="outline" size="icon" onClick={toggleTheme} className="rounded-full bg-card/50 backdrop-blur-sm border-border/50 hover:bg-card">
                        {theme === "dark" ? <Sun className="h-5 w-5 text-yellow-400" /> : <Moon className="h-5 w-5 text-purple-500" />}
                    </Button>
                </div>

                <div className="min-h-screen flex items-center justify-center p-4">
                    <div className="w-full max-w-md">
                        <div className="text-center mb-8">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 mb-4 shadow-lg shadow-amber-500/25">
                                <MailWarning className="h-8 w-8 text-white" />
                            </div>
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 bg-clip-text text-transparent">
                                Registro Privado
                            </h1>
                            <p className="text-muted-foreground mt-2">
                                El registro público no está habilitado actualmente
                            </p>
                        </div>

                        <Card className="glass-card border-border/50 shadow-2xl shadow-amber-500/10">
                            <CardContent className="pt-6">
                                <div className="text-sm text-muted-foreground bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
                                    <p className="font-medium text-amber-700 dark:text-amber-300 mb-2">Se necesita una invitación</p>
                                    <p>Necesitas una invitación del administrador para crear una cuenta.</p>
                                    <p className="mt-2">Si ya tienes una invitación, por favor revisa tu correo y haz clic en el enlace proporcionado.</p>
                                </div>
                                <div className="flex gap-3">
                                    <Button variant="outline" className="flex-1 border-border/50" onClick={() => setLocation("/")}>
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        Volver al Inicio
                                    </Button>
                                    <Button className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/25" onClick={() => setLocation("/login")}>
                                        Iniciar Sesión
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <p className="text-center text-sm text-muted-foreground mt-6">
                            ¿Ya tienes cuenta?{" "}
                            <a href="/login" className="text-purple-400 hover:text-purple-300 font-medium transition-colors">
                                Iniciar Sesión
                            </a>
                        </p>
                    </div>
                </div>
            </div>
        );
    }

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
                <Button variant="outline" size="icon" onClick={toggleTheme} className="rounded-full bg-card/50 backdrop-blur-sm border-border/50 hover:bg-card">
                    {theme === "dark" ? <Sun className="h-5 w-5 text-yellow-400" /> : <Moon className="h-5 w-5 text-purple-500" />}
                </Button>
            </div>

            {/* Main Content */}
            <div className="min-h-screen flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    {/* Logo and Title */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 mb-4 shadow-lg shadow-purple-500/25">
                            <MessageCircle className="h-8 w-8 text-white" />
                        </div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent">
                            Bienvenido al Equipo
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Configurá tu contraseña para activar tu cuenta
                        </p>
                    </div>

                    <Card className="glass-card border-border/50 shadow-2xl shadow-purple-500/10">
                        <CardContent className="pt-6">
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="password" className="text-sm font-medium">Nueva Contraseña</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="password"
                                            type="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="••••••••"
                                            required
                                            minLength={8}
                                            className="pl-10"
                                        />
                                    </div>
                                    <PasswordStrengthMeter password={password} />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="confirm" className="text-sm font-medium">Confirmar Contraseña</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="confirm"
                                            type="password"
                                            value={confirm}
                                            onChange={(e) => setConfirm(e.target.value)}
                                            placeholder="••••••••"
                                            required
                                            minLength={8}
                                            className="pl-10"
                                        />
                                    </div>
                                    {confirm.length > 0 && (
                                        <p className={`text-xs ${passwordsMatch ? "text-green-500" : "text-red-400"}`}>
                                            {passwordsMatch ? "Las contraseñas coinciden ✓" : "Las contraseñas no coinciden"}
                                        </p>
                                    )}
                                </div>

                                <Button
                                    type="submit"
                                    className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/25 transition-all"
                                    disabled={accept.isPending || !passwordValid || !passwordsMatch}
                                >
                                    {accept.isPending ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <ShieldCheck className="mr-2 h-4 w-4" />
                                    )}
                                    Activar Cuenta
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    <p className="text-center text-sm text-muted-foreground mt-6">
                        ¿Ya tienes cuenta?{" "}
                        <a href="/login" className="text-purple-400 hover:text-purple-300 font-medium transition-colors">
                            Iniciar Sesión
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
}
