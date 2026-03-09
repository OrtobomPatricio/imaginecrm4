import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export default function VerifyEmail() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  const params = new URLSearchParams(window.location.search);
  const tenantSlug = params.get("tenant") || "";

  const verifyMutation = trpc.account.verifyEmail.useMutation({
    onSuccess: (data) => {
      setStatus("success");
      setMessage(data.message);
      // Persist tenant so login page pre-fills the organization field
      if (tenantSlug) {
        localStorage.setItem("tenant-slug", tenantSlug);
      }
    },
    onError: (err) => {
      setStatus("error");
      setMessage(err.message || "Token de verificación inválido o expirado.");
    },
  });

  const [verified, setVerified] = useState(false);
  useEffect(() => {
    if (verified) return;
    const token = params.get("token");
    if (token) {
      setVerified(true);
      verifyMutation.mutate({ token });
    } else {
      setStatus("error");
      setMessage("No se proporcionó un token de verificación.");
    }
  }, [verified]);

  const loginUrl = tenantSlug
    ? `/login?tenant=${encodeURIComponent(tenantSlug)}`
    : "/login";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Verificación de Email</CardTitle>
          <CardDescription>Imagine CRM</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          {status === "loading" && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">Verificando tu email...</p>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-center font-medium">{message}</p>
              <Button onClick={() => window.location.href = loginUrl} className="mt-4">
                Iniciar Sesión
              </Button>
            </>
          )}
          {status === "error" && (
            <>
              <XCircle className="h-12 w-12 text-red-500" />
              <p className="text-center text-red-600">{message}</p>
              <Button variant="outline" onClick={() => window.location.href = loginUrl} className="mt-4">
                Volver al Login
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
