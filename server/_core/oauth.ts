import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

import { logger } from "./logger";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  const isProd = process.env.NODE_ENV === "production";
  const allowDevLogin = !isProd && process.env.ALLOW_DEV_LOGIN === "1";

  if (allowDevLogin) {
    app.get("/api/dev/login", async (req: Request, res: Response) => {
      const openId = process.env.OWNER_OPEN_ID;
      if (!openId) return res.status(500).json({ error: "OWNER_OPEN_ID missing" });

      const provisionedUser = await db.getUserByOpenId(openId);
      if (!provisionedUser) return res.status(403).json({ error: "dev user not provisioned" });

      await db.upsertUser({
        tenantId: provisionedUser.tenantId,
        openId,
        name: provisionedUser.name || "Dev User",
        email: provisionedUser.email ?? null,
        loginMethod: "dev",
        lastSignedIn: new Date(),
        role: provisionedUser.role,
      });

      const sessionToken = await sdk.createSessionToken(openId, { name: provisionedUser.name || "Dev User" });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      return res.redirect(302, "/");
    });
  }

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      let provisionedUser;
      try {
        provisionedUser = await db.resolveProvisionedOAuthUser(userInfo.openId, userInfo.email ?? null);
      } catch (error: any) {
        if (error?.code === "AMBIGUOUS_TENANT") {
          return res.status(409).json({ error: "ambiguous tenant" });
        }
        throw error;
      }

      if (!provisionedUser) {
        return res.status(403).json({ error: "not provisioned" });
      }

      await db.upsertUser({
        tenantId: provisionedUser.tenantId,
        openId: provisionedUser.openId,
        name: userInfo.name || provisionedUser.name || null,
        email: userInfo.email ?? provisionedUser.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? provisionedUser.loginMethod ?? null,
        lastSignedIn: new Date(),
        role: provisionedUser.role,
      });

      const sessionToken = await sdk.createSessionToken(provisionedUser.openId, {
        name: userInfo.name || provisionedUser.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      logger.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
