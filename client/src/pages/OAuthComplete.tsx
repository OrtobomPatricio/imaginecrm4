import { useEffect, useState } from "react";

/**
 * Intermediate page after OAuth callback.
 * If opened as popup → notifies parent window and closes.
 * If opened as redirect (popup blocked) → navigates to dashboard.
 */
export default function OAuthComplete() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for error in URL params
    const params = new URLSearchParams(window.location.search);
    const errParam = params.get("error");
    if (errParam) {
      setError(errParam === "auth_failed" ? "Error de autenticación. Intente de nuevo." : errParam);
      // Auto-close popup after 3s on error
      const timer = setTimeout(() => {
        if (window.opener && !window.opener.closed) window.close();
        else window.location.replace("/login");
      }, 3000);
      return () => clearTimeout(timer);
    }

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "oauth-success" }, window.location.origin);
      window.close();
      return;
    }
    // Fallback: popup was blocked or direct navigation — go to dashboard
    window.location.replace("/");
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center p-6">
          <div className="text-red-500 text-4xl mb-4">✕</div>
          <p className="text-destructive font-medium">{error}</p>
          <p className="text-muted-foreground text-sm mt-2">Cerrando ventana...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
        <p className="text-muted-foreground text-sm mt-4">Completando inicio de sesión...</p>
      </div>
    </div>
  );
}
