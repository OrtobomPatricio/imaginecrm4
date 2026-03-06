import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  sessionJti?: string;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // DEV BYPASS: En desarrollo, usar usuario automático si existe
  // SECURITY: Positive match only — bypass ONLY if NODE_ENV is explicitly "development"
  const isDev = process.env.NODE_ENV === "development";
  const devBypassUser = (opts.req as any).devBypassUser;
  
  if (isDev && devBypassUser) {
    return {
      req: opts.req,
      res: opts.res,
      user: devBypassUser as User,
      sessionJti: "dev-bypass",
    };
  }

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    sessionJti: (opts.req as any).sessionJti,
  };
}
