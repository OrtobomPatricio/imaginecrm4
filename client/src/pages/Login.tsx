import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/contexts/ThemeContext";
import { MessageCircle, Moon, Sun, Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  google_auth_failed: "Error al autenticar con Google. Intentá de nuevo.",
  facebook_auth_failed: "Error al autenticar con Facebook. Intentá de nuevo.",
  microsoft_auth_failed: "Error al autenticar con Microsoft. Intentá de nuevo.",
  microsoft_init_failed: "No se pudo iniciar la autenticación con Microsoft.",
  no_user_data: "No se recibieron datos del proveedor. Intentá de nuevo.",
  not_provisioned: "No se encontró una cuenta con este email. ¿Necesitás crear una cuenta nueva?",
  ambiguous_tenant: "Tu email está asociado a múltiples organizaciones. Contactá soporte.",
  callback_failed: "Error durante la autenticación. Intentá de nuevo.",
  provider_not_configured: "Este método de inicio de sesión no está configurado.",
};

export default function Login() {
  const { theme, toggleTheme } = useTheme();
  const canDevLogin = import.meta.env.VITE_DEV_BYPASS_AUTH === "1";
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [enabledProviders, setEnabledProviders] = useState<string[]>([]);

  // Fetch enabled OAuth providers + handle URL error params
  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.ok ? r.json() : { providers: [] })
      .then((data) => setEnabledProviders(data.providers ?? []))
      .catch(() => setEnabledProviders([]));

    // Show error from OAuth redirect
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      const msg = ERROR_MESSAGES[error] || `Error de autenticación: ${error}`;
      toast.error(msg);
      // Clean URL
      window.history.replaceState({}, "", "/login");
    }
  }, []);

  const login = trpc.auth.loginWithCredentials.useMutation({
    onSuccess: (data) => {
      if (data?.success) {
        window.location.href = "/";
        return;
      }
      toast.error(data?.error || "Error de autenticación");
    },
    onError: (e) => {
      // Show the real error, not a generic fallback
      const msg = e.message || "";
      if (msg.includes("rate") || msg.includes("limit") || msg.includes("Demasiados")) {
        toast.error("Demasiados intentos. Esperá unos minutos e intentá de nuevo.");
      } else if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed")) {
        toast.error("Error de conexión. Verificá tu internet e intentá de nuevo.");
      } else {
        toast.error(msg || "Error de autenticación. Intentá de nuevo.");
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const email = formData.email.trim();
    if (!email || !formData.password) {
      toast.error("Ingresá email y contraseña");
      return;
    }

    login.mutate({ email, password: formData.password });
  };

  const handleOAuthLogin = (provider: 'google' | 'microsoft' | 'facebook') => {
    const width = 500;
    const height = 600;
    const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - height) / 2);

    const popup = window.open(
      `/api/auth/${provider}`,
      'oauth-popup',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
    );

    if (!popup || popup.closed) {
      // Popup blocked — fallback to redirect
      window.location.href = `/api/auth/${provider}`;
    }
  };

  // Listen for OAuth popup completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'oauth-success') {
        window.location.href = '/';
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleDevLogin = () => {
    window.location.href = "/api/dev/login";
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
        <div className="absolute w-2 h-2 bg-green-500/20 rounded-full animate-pulse" style={{ top: '50%', left: '40%', animationDelay: '1.5s' }} />
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
        <div className="w-full max-w-md">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 mb-4 shadow-lg shadow-purple-500/25">
              <MessageCircle className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent">
              Imagine CRM
            </h1>
            <p className="text-muted-foreground mt-2">
              Sistema de Gestión WhatsApp
            </p>
          </div>

          {/* Login Card */}
          <Card className="glass-card border-border/50 shadow-2xl shadow-purple-500/10">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-xl">
                Iniciar Sesión
              </CardTitle>
              <CardDescription>
                Accede a tu cuenta para continuar
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* OAuth Buttons */}
              <div className="grid gap-3">
                {canDevLogin && (
                  <Button
                    className="w-full h-11 bg-muted/60 hover:bg-muted border border-border/50 text-foreground transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98]"
                    onClick={handleDevLogin}
                  >
                    Entrar como DEV (sin Google)
                  </Button>
                )}
                {enabledProviders.includes('google') && (
                <Button
                  variant="outline"
                  className="w-full h-11 bg-card/50 hover:bg-card border-border/50 transition-all duration-300 hover:border-blue-500/30 hover:shadow-md hover:shadow-blue-500/10 transform hover:scale-[1.02] active:scale-[0.98] group"
                  onClick={() => handleOAuthLogin('google')}
                >
                  <svg className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continuar con Google
                </Button>
                )}

                {enabledProviders.includes('facebook') && (
                <Button
                  variant="outline"
                  className="w-full h-11 bg-card/50 hover:bg-card border-border/50 transition-all duration-300 hover:border-blue-600/30 hover:shadow-md hover:shadow-blue-600/10 transform hover:scale-[1.02] active:scale-[0.98] group"
                  onClick={() => handleOAuthLogin('facebook')}
                >
                  <svg className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                    <path
                      fill="#1877F2"
                      d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
                    />
                  </svg>
                  Continuar con Facebook
                </Button>
                )}

                {enabledProviders.includes('microsoft') && (
                <Button
                  variant="outline"
                  className="w-full h-11 bg-card/50 hover:bg-card border-border/50 transition-all duration-300 hover:border-blue-700/30 hover:shadow-md hover:shadow-blue-700/10 transform hover:scale-[1.02] active:scale-[0.98] group"
                  onClick={() => handleOAuthLogin('microsoft')}
                >
                  <svg className="w-5 h-5 mr-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                    <path fill="#F25022" d="M1 1h10v10H1z" />
                    <path fill="#00A4EF" d="M1 13h10v10H1z" />
                    <path fill="#7FBA00" d="M13 1h10v10H13z" />
                    <path fill="#FFB900" d="M13 13h10v10H13z" />
                  </svg>
                  Continuar con Microsoft
                </Button>
                )}
              </div>

              {(enabledProviders.length > 0 || canDevLogin) && (
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-muted" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background/80 backdrop-blur-sm px-2 text-muted-foreground/70">
                    O continúa con email
                  </span>
                </div>
              </div>
              )}

              {/* Email Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="tu@email.com"
                      className="pl-10 bg-card/50 border-border/50 focus:border-primary"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Contraseña</Label>
                    <a href="/forgot-password" className="text-xs text-primary hover:underline">
                      ¿Olvidaste tu contraseña?
                    </a>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      className="pl-10 bg-card/50 border-border/50 focus:border-primary"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={login.isPending}
                  className="w-full h-11 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/25 transition-all duration-300 hover:shadow-xl hover:shadow-purple-500/30"
                >
                  {login.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Ingresando...
                    </>
                  ) : (
                    <>
                      Iniciar Sesión
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>

                <div className="text-center text-sm">
                  <span className="text-muted-foreground">¿No tienes cuenta? </span>
                  <a href="/signup" className="text-primary hover:underline font-medium">
                    Crear cuenta
                  </a>
                </div>

                <div className="text-center">
                  <a href="/" className="text-xs text-muted-foreground hover:text-primary transition-colors">
                    ← Volver al inicio
                  </a>
                </div>
              </form>


            </CardContent>
          </Card>

          {/* Footer */}
          <p className="text-center text-xs text-muted-foreground mt-6">
            Al continuar, aceptas nuestros{" "}
            <a href="/terms" className="text-primary hover:underline">Términos de Servicio</a>
            {" "}y{" "}
            <a href="/privacy" className="text-primary hover:underline">Política de Privacidad</a>
          </p>
        </div>
      </div>
    </div>
  );
}
