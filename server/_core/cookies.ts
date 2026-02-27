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

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const isDev = process.env.NODE_ENV !== "production";
  const sameSite = getConfiguredSameSite();

  if (isDev) {
    return {
      httpOnly: true,
      path: "/",
      sameSite,
      secure: sameSite === "none" ? true : false,
      ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    };
  }

  const secure = process.env.COOKIE_SECURE === "0" ? false : true;
  if (sameSite === "none" && !secure && !isSecureRequest(req)) {
    throw new Error("COOKIE_SAMESITE=none requires secure cookies (COOKIE_SECURE!=0) in production");
  }

  return {
    httpOnly: true,
    path: "/",
    sameSite,
    secure,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
}
