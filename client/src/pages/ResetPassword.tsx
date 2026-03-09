import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, CheckCircle2, XCircle } from "lucide-react";
import PasswordStrengthMeter, { validatePassword } from "@/components/PasswordStrengthMeter";
import { useState, useEffect } from "react";

export default function ResetPassword() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    const tenant = params.get("tenant");
    if (tenant) {
      localStorage.setItem("tenant-slug", tenant);
    }
    if (t) {
      setToken(t);
    } else {
      setInvalidToken(true);
    }
  }, []);

  const [expired, setExpired] = useState(false);
  const resetMutation = trpc.account.resetPassword.useMutation({
    onSuccess: () => {
      setDone(true);
    },
    onError: (err) => {
      const msg = err.message || "";
      if (msg.toLowerCase().includes("expirado") || msg.toLowerCase().includes("expired")) {
        setExpired(true);
      } else {
        toast.error(msg || "Error al restablecer la contraseña");
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatePassword(password)) {
      toast.error("La contraseña no cumple los requisitos de seguridad");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    resetMutation.mutate({ token, newPassword: password });
  };

  const forgotUrl = (() => {
    const tenant = localStorage.getItem("tenant-slug");
    return tenant ? `/forgot-password?tenant=${encodeURIComponent(tenant)}` : "/forgot-password";
  })();

  if (invalidToken || expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <XCircle className="h-12 w-12 text-red-500" />
            <p className="text-center text-red-600">
              {expired ? "Tu enlace de recuperación ha expirado." : "Enlace de recuperación inválido."}
            </p>
            <p className="text-center text-sm text-muted-foreground">
              {expired ? "Por seguridad, los enlaces expiran después de un tiempo. Solicitá uno nuevo." : "Es posible que el enlace ya fue usado o que la URL esté incompleta."}
            </p>
            <Button variant="outline" onClick={() => { window.location.href = forgotUrl; }}>
              Solicitar nuevo enlace
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-center font-medium">Contraseña actualizada exitosamente.</p>
            <Button onClick={() => {
              const tenant = localStorage.getItem("tenant-slug");
              window.location.href = tenant ? `/login?tenant=${encodeURIComponent(tenant)}` : "/login";
            }} className="mt-4">
              Iniciar Sesión
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Nueva Contraseña</CardTitle>
          <CardDescription>Ingresa tu nueva contraseña</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nueva Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <PasswordStrengthMeter password={password} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmar Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm"
                  type="password"
                  placeholder="Repite la contraseña"
                  className="pl-10"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={resetMutation.isPending || !validatePassword(password) || password !== confirmPassword}>
              {resetMutation.isPending ? "Actualizando..." : "Restablecer Contraseña"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
