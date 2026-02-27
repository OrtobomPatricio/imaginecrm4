import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useState } from "react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const requestReset = trpc.account.requestPasswordReset.useMutation({
    onSuccess: () => {
      setSent(true);
    },
    onError: (err) => toast.error(err.message || "Error al enviar el email"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Ingresa tu email");
      return;
    }
    requestReset.mutate({ email });
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Email Enviado</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-center text-muted-foreground">
              Si el email <strong>{email}</strong> está registrado, recibirás un enlace para restablecer tu contraseña.
              Revisa tu bandeja de entrada y spam.
            </p>
            <Button variant="outline" onClick={() => window.location.href = "/login"} className="mt-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver al Login
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
          <CardTitle className="text-2xl">Recuperar Contraseña</CardTitle>
          <CardDescription>Ingresa tu email y te enviaremos un enlace para restablecer tu contraseña</CardDescription>
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
            <Button type="submit" className="w-full" disabled={requestReset.isPending}>
              {requestReset.isPending ? "Enviando..." : "Enviar Enlace de Recuperación"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => window.location.href = "/login"}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver al Login
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
