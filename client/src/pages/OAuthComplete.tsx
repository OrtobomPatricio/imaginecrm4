import { useEffect } from "react";

/**
 * Intermediate page after OAuth callback.
 * If opened as popup → notifies parent window and closes.
 * If opened as redirect (popup blocked) → navigates to dashboard.
 */
export default function OAuthComplete() {
  useEffect(() => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "oauth-success" }, window.location.origin);
      window.close();
      return;
    }
    // Fallback: popup was blocked or direct navigation — go to dashboard
    window.location.replace("/");
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
    </div>
  );
}
