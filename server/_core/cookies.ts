import type { CookieOptions, Request } from "express";

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

function getConfiguredSameSite(): CookieOptions["sameSite"] {
  const raw = (process.env.COOKIE_SAMESITE || "lax").toLowerCase();
  if (raw === "strict" || raw === "lax" || raw === "none") return raw;
  return "lax";
}

function resolveCookieDomain(req: Request): string | undefined {
  const configured = (process.env.COOKIE_DOMAIN || "").trim().toLowerCase();
  if (!configured) return undefined;

  const hostHeader = String(req.headers.host || "").toLowerCase();
  const requestHost = hostHeader.split(":")[0];

  if (!requestHost) return undefined;

  if (requestHost === configured || requestHost.endsWith(`.${configured}`)) {
    return configured;
  }

  return undefined;
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const isDev = process.env.NODE_ENV !== "production";
  const sameSite = getConfiguredSameSite();

  if (isDev) {
    const domain = resolveCookieDomain(req);
    return {
      httpOnly: true,
      path: "/",
      sameSite,
      secure: sameSite === "none" ? true : false,
      ...(domain ? { domain } : {}),
    };
  }

  const secure = process.env.COOKIE_SECURE === "0" ? false : true;
  if (sameSite === "none" && !secure && !isSecureRequest(req)) {
    throw new Error("COOKIE_SAMESITE=none requires secure cookies (COOKIE_SECURE!=0) in production");
  }

  const domain = resolveCookieDomain(req);

  return {
    httpOnly: true,
    path: "/",
    sameSite,
    secure,
    ...(domain ? { domain } : {}),
  };
}
