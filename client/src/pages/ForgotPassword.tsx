import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, CheckCircle2, Building2 } from "lucide-react";
import { useEffect, useState } from "react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tenantFromQuery = params.get("tenant")?.trim().toLowerCase() ?? "";
    const tenantFromStorage = localStorage.getItem("tenant-slug")?.trim().toLowerCase() ?? "";
    setTenantSlug(tenantFromQuery || tenantFromStorage);
  }, []);

  const requestReset = trpc.account.requestPasswordReset.useMutation({
    onSuccess: () => {
      localStorage.setItem("tenant-slug", tenantSlug.trim().toLowerCase());
      setSent(true);
    },
    onError: (err) => toast.error(err.message || "Error al enviar el email"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast.error("Ingresá tu email");
      return;
    }

    requestReset.mutate({
      email: email.trim(),
      tenantSlug: tenantSlug.trim().toLowerCase() || undefined,
    });
  };

  const loginHref = tenantSlug.trim()
    ? `/login?tenant=${encodeURIComponent(tenantSlug.trim().toLowerCase())}`
    : "/login";

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Email enviado</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-center text-muted-foreground">
              Si el email <strong>{email}</strong> existe,
              recibirás un enlace para restablecer tu contraseña.
            </p>
            <Button
              variant="outline"
              onClick={() => (window.location.href = loginHref)}
              className="mt-4"
              type="button"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver al login
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
          <CardTitle className="text-2xl">Recuperar contraseña</CardTitle>
          <CardDescription>
            Ingresá tu email para enviarte el enlace de recuperación
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@email.com"
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenantSlug" className="text-muted-foreground text-xs">
                Organización <span className="opacity-60">(opcional)</span>
              </Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="tenantSlug"
                  type="text"
                  placeholder="solo si tenés varias organizaciones"
                  className="pl-10 text-sm"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={requestReset.isPending}>
              {requestReset.isPending ? "Enviando..." : "Enviar enlace de recuperación"}
            </Button>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => (window.location.href = loginHref)}
              type="button"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver al login
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
