import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";
import * as Sentry from "@sentry/react";
import { toast } from "sonner";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
  });
}

function loadAnalytics() {
  try {
    const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT as string | undefined;
    const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID as string | undefined;

    if (!endpoint || !websiteId) return;
    if (typeof document === "undefined") return;

    const cleaned = endpoint.replace(/\/+$/, "");

    const s = document.createElement("script");
    s.defer = true;
    s.src = `${cleaned}/umami`;
    s.setAttribute("data-website-id", websiteId);
    document.head.appendChild(s);
  } catch {
    // ignore analytics issues
  }
}

loadAnalytics();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Do not retry on auth errors
        if (error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG) return false;
        // Do not retry on permission errors
        if (error instanceof TRPCClientError && error.data?.code === "FORBIDDEN") return false;
        // Retry up to 2 times for other errors
        return failureCount < 2;
      },
      staleTime: 30_000, // 30 seconds
    },
    mutations: {
      retry: false,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

/**
 * Global error handler for all tRPC queries and mutations.
 * - Redirects to login on 401 (unauthorized)
 * - Shows toast notification for user-facing errors on mutations
 * - Reports to Sentry in production
 */
const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Tu sesión ha expirado. Redirigiendo al login...",
  FORBIDDEN: "No tienes permisos para realizar esta acción.",
  NOT_FOUND: "El recurso solicitado no fue encontrado.",
  TIMEOUT: "La operación tardó demasiado. Intenta de nuevo.",
  TOO_MANY_REQUESTS: "Demasiadas solicitudes. Espera un momento.",
  INTERNAL_SERVER_ERROR: "Error interno del servidor. Intenta más tarde.",
  BAD_REQUEST: "Datos inválidos. Verifica la información ingresada.",
  CONFLICT: "Conflicto: el recurso ya existe o fue modificado.",
  PARSE_ERROR: "Error al procesar la solicitud.",
  PRECONDITION_FAILED: "No se cumplen las condiciones para esta operación.",
};

function handleGlobalError(error: unknown, context: "query" | "mutation") {
  redirectToLoginIfUnauthorized(error);

  if (error instanceof TRPCClientError) {
    // Skip unauthorized errors (already handled by redirect)
    if (error.message === UNAUTHED_ERR_MSG) return;

    const code = error.data?.code as string | undefined;
    const friendlyMessage = (code && ERROR_MESSAGES[code]) || error.message;

    // Show toast for mutations (queries fail silently to avoid spam on network issues)
    if (context === "mutation") {
      toast.error(friendlyMessage, { duration: 5000 });
    }

    // Report to Sentry if available
    if (import.meta.env.VITE_SENTRY_DSN) {
      Sentry.captureException(error, {
        tags: { context, trpcCode: code },
      });
    }
  }
}

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    handleGlobalError(event.query.state.error, "query");
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    handleGlobalError(event.mutation.state.error, "mutation");
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson as any,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => {})
      .catch(() => {});
  });
}
