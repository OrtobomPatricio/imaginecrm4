/**
 * WhatsApp Embedded Signup Button
 *
 * Loads the Meta JS SDK, launches the Embedded Signup flow,
 * captures the response via postMessage, and calls the backend
 * to complete the connection.
 *
 * Usage:
 *   <EmbeddedSignupButton onSuccess={(data) => ...} />
 *
 * References:
 *   https://developers.facebook.com/docs/whatsapp/embedded-signup
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// ── Types ──

type SignupResult = {
  success: boolean;
  connectionId?: number;
  phone?: string;
  verifiedName?: string;
  wabaId?: string;
};

type EmbeddedSignupStatus = "idle" | "loading-sdk" | "waiting-popup" | "completing" | "success" | "error";

interface EmbeddedSignupButtonProps {
  onSuccess?: (result: SignupResult) => void;
  onError?: (error: string) => void;
  className?: string;
  /** Optional: show compact version */
  compact?: boolean;
}

// ── SDK loader (singleton) ──

let sdkLoadPromise: Promise<void> | null = null;
let sdkLoadedAppId: string | null = null;

function loadMetaSDK(appId: string, graphVersion: string): Promise<void> {
  // Re-init if appId changed since last load
  if (sdkLoadPromise && sdkLoadedAppId === appId) return sdkLoadPromise;
  if (sdkLoadPromise && sdkLoadedAppId !== appId) {
    // SDK already loaded but with different appId — re-init it
    if ((window as any).FB) {
      (window as any).FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: graphVersion,
      });
      sdkLoadedAppId = appId;
      return Promise.resolve();
    }
  }

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    // Check if already loaded
    if ((window as any).FB) {
      (window as any).FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: graphVersion,
      });
      sdkLoadedAppId = appId;
      resolve();
      return;
    }

    // Inject script tag
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";

    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: graphVersion,
      });
      sdkLoadedAppId = appId;
      resolve();
    };

    script.onerror = () => {
      sdkLoadPromise = null;
      reject(new Error("No se pudo cargar el SDK de Meta"));
    };

    document.head.appendChild(script);

    // Timeout
    setTimeout(() => {
      if (!(window as any).FB) {
        sdkLoadPromise = null;
        reject(new Error("Timeout al cargar el SDK de Meta"));
      }
    }, 15000);
  });

  return sdkLoadPromise;
}

// ── Component ──

export function EmbeddedSignupButton({ onSuccess, onError, className, compact }: EmbeddedSignupButtonProps) {
  const [status, setStatus] = useState<EmbeddedSignupStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [resultData, setResultData] = useState<SignupResult | null>(null);
  const sessionTokenRef = useRef<string>("");

  // Listen for postMessage from Meta's Embedded Signup popup
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Only process messages from official Facebook/Meta domains
      // Use strict URL origin comparison to prevent spoofing (e.g. evil-facebook.com)
      try {
        const origin = new URL(event.origin);
        const hostname = origin.hostname;
        if (
          !hostname.endsWith(".facebook.com") &&
          !hostname.endsWith(".fb.com") &&
          hostname !== "facebook.com" &&
          hostname !== "fb.com"
        ) {
          return;
        }
      } catch {
        return; // malformed origin
      }

      // The Embedded Signup sends a message with structure:
      // { type: "WA_EMBEDDED_SIGNUP", event: "FINISH" | "CANCEL" | "ERROR", data: { ... } }
      const payload = event.data;
      if (!payload || typeof payload !== "object") return;

      // Handle different message formats from Meta SDK
      if (payload.type === "WA_EMBEDDED_SIGNUP") {
        if (payload.event === "FINISH" || payload.event === "FINISH_ONLY_WABA") {
          // Success — data.phone_number_id and data.waba_id are available
          // But we rely on the FB.login callback for the code
          // This is mainly for UX feedback
          return;
        }

        if (payload.event === "CANCEL") {
          setStatus("idle");
          toast.info("Conexión cancelada por el usuario");
          return;
        }

        if (payload.event === "ERROR") {
          setStatus("error");
          setErrorMsg("Error en el flujo de Meta. Intenta de nuevo.");
          onError?.("Meta signup error");
          return;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onError]);

  const startSignup = useCallback(async () => {
    setStatus("loading-sdk");
    setErrorMsg("");
    setResultData(null);

    try {
      // 1. Fetch config from our backend
      const configRes = await fetch("/api/whatsapp/embedded-signup/config", {
        credentials: "include",
      });
      if (!configRes.ok) {
        const body = await configRes.json().catch(() => ({ error: "Error desconocido" }));
        // Show user-friendly message for platform not configured
        if (body.code === "PLATFORM_META_NOT_CONFIGURED") {
          throw new Error("La integración con Meta aún no está habilitada. Contacta al administrador de la plataforma para activarla.");
        }
        throw new Error(body.error || `HTTP ${configRes.status}`);
      }

      const config = await configRes.json();
      const { appId, configId, graphVersion } = config;

      if (!appId) {
        throw new Error("META_APP_ID no está configurado.");
      }

      // 2. Load Meta JS SDK
      await loadMetaSDK(appId, graphVersion || "v21.0");

      // 3. Generate session nonce for security
      sessionTokenRef.current = crypto.randomUUID?.() || Math.random().toString(36).slice(2);

      // 4. Launch Embedded Signup via FB.login
      setStatus("waiting-popup");

      const FB = (window as any).FB;
      if (!FB) {
        throw new Error("SDK de Meta no cargado");
      }

      FB.login(
        (response: any) => {
          // Embedded Signup can return either a code or accessToken
          const authResponse = response.authResponse;
          const hasCode = authResponse?.code;
          const hasToken = authResponse?.accessToken;

          if (response.status !== "connected" || (!hasCode && !hasToken)) {
            // User cancelled or error
            if (response.status === "not_authorized" || !authResponse) {
              setStatus("idle");
              toast.info("Conexión cancelada");
              return;
            }
            setStatus("error");
            setErrorMsg("No se recibió autorización de Meta");
            return;
          }

          // 5. Try to extract waba_id and phone_number_id from the Embedded Signup extras
          // These are only available when using a config_id; otherwise the backend auto-discovers them
          const waba_id = authResponse?.waba_id || authResponse?.wabaId || "";
          const phone_number_id = authResponse?.phone_number_id || authResponse?.phoneNumberId || "";

          // 6. Send to backend to complete the flow
          // Send both code and access_token — backend uses whichever is available
          setStatus("completing");

          fetch("/api/whatsapp/embedded-signup/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              code: hasCode || undefined,
              access_token: hasToken || undefined,
              waba_id,
              phone_number_id,
            }),
          })
            .then((completeRes) => completeRes.json().then((result) => ({ ok: completeRes.ok, result })))
            .then(({ ok, result }) => {
              if (!ok || !result.success) {
                const msg = result.detail
                  ? `${result.error}: ${result.detail}`
                  : (result.error || "Error al completar el registro");
                throw new Error(msg);
              }

              setStatus("success");
              setResultData(result);
              toast.success(
                `¡WhatsApp conectado! Número: ${result.phone || phone_number_id}`,
                { duration: 5000 }
              );
              onSuccess?.(result);
            })
            .catch((err: any) => {
              setStatus("error");
              setErrorMsg(err.message || "Error al completar la conexión");
              onError?.(err.message);
            });
        },
        {
          // Meta Embedded Signup specific options
          config_id: configId || undefined,
          response_type: "code",
          override_default_response_type: true,
          scope: "whatsapp_business_management,whatsapp_business_messaging,business_management",
          extras: {
            setup: {},
            featureType: "phone_number_sharing",
            sessionInfoVersion: "3",
          },
        }
      );

    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Error inesperado");
      onError?.(err.message);
    }
  }, [onSuccess, onError]);

  // ── Render ──

  if (status === "success" && resultData) {
    return (
      <div className={`flex items-center gap-3 p-4 border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 rounded-xl ${className || ""}`}>
        <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-green-800 dark:text-green-300 text-sm">
            WhatsApp conectado correctamente
          </p>
          <p className="text-xs text-green-600 dark:text-green-400 truncate">
            {resultData.verifiedName ? `${resultData.verifiedName} — ` : ""}
            {resultData.phone}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setStatus("idle");
            setResultData(null);
          }}
          className="text-green-600 hover:text-green-700"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={`space-y-3 ${className || ""}`}>
        <div className="flex items-start gap-3 p-4 border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-red-800 dark:text-red-300 text-sm">Error de conexión</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errorMsg}</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={startSignup}
          className="w-full"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Reintentar
        </Button>
      </div>
    );
  }

  const isLoading = status === "loading-sdk" || status === "waiting-popup" || status === "completing";

  const statusLabels: Record<EmbeddedSignupStatus, string> = {
    idle: "",
    "loading-sdk": "Cargando Meta SDK...",
    "waiting-popup": "Completa el flujo en la ventana de Meta...",
    completing: "Configurando tu número...",
    success: "",
    error: "",
  };

  return (
    <div className={`space-y-2 ${className || ""}`}>
      <Button
        onClick={startSignup}
        disabled={isLoading}
        className={`bg-[#25D366] hover:bg-[#20BA5A] text-white font-medium ${compact ? "h-10" : "h-12 text-base"} w-full`}
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        ) : (
          <MessageCircle className="w-5 h-5 mr-2" />
        )}
        {isLoading ? statusLabels[status] : "Conectar WhatsApp"}
      </Button>
      {status === "waiting-popup" && (
        <p className="text-xs text-muted-foreground text-center animate-pulse">
          Si no ves la ventana de Meta, revisa tu bloqueador de popups.
        </p>
      )}
    </div>
  );
}
