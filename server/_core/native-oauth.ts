import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { OIDCStrategy } from 'passport-azure-ad';
import type { Express, Request, Response } from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { COOKIE_NAME, ONE_YEAR_MS } from '@shared/const';
import * as db from '../db';
import { getSessionCookieOptions } from './cookies';
import { sdk } from './sdk';
import { createOAuthSessionStore } from './redis-session-store';

import { logger } from "./logger";

// Extend Express User type
declare global {
    namespace Express {
        interface User {
            openId: string;
            name?: string;
            email?: string;
            platform?: string;
        }
    }
}

// Serialize user for session
passport.serializeUser((user: any, done: any) => {
    done(null, user.openId);
});

passport.deserializeUser(async (openId: string, done: any) => {
    try {
        const user = await db.getUserByOpenId(openId);
        done(null, user || null);
    } catch (error) {
        done(error, null);
    }
});

/**
 * Register OAuth routes for Google and Microsoft authentication
 */
export function registerNativeOAuth(app: Express) {
    const isProd = process.env.NODE_ENV === 'production';
    const baseUrl = process.env.VITE_OAUTH_PORTAL_URL || 'http://localhost:3000';
    const sessionSecret = process.env.COOKIE_SECRET || process.env.JWT_SECRET;

    if (isProd && !sessionSecret) {
        throw new Error("COOKIE_SECRET (or JWT_SECRET fallback) is required in production for OAuth sessions");
    }

    // Cookie parser and sessions (memory store for dev, Redis for prod)
    app.use(cookieParser());
    const redisSessionStore = createOAuthSessionStore();

    const sessionConfig: any = {
        secret: sessionSecret || 'dev-cookie-secret-local-only',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: isProd,
            httpOnly: true,
            maxAge: ONE_YEAR_MS,
        },
    };

    if (redisSessionStore) {
        sessionConfig.store = redisSessionStore;
    }

    app.use(session(sessionConfig));

    app.use(passport.initialize());
    app.use(passport.session());

    // ==========================================
    // GOOGLE OAUTH STRATEGY
    // ==========================================
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (googleClientId && googleClientSecret) {
        passport.use(
            new GoogleStrategy(
                {
                    clientID: googleClientId,
                    clientSecret: googleClientSecret,
                    callbackURL: `${baseUrl}/api/auth/google/callback`,
                    proxy: true,
                },
                async (accessToken: any, refreshToken: any, profile: any, done: any) => {
                    try {
                        logger.info('[GoogleOAuth] Profile received:', profile.id);
                        const user: Express.User = {
                            openId: profile.id,
                            name: profile.displayName,
                            email: profile.emails?.[0]?.value,
                            platform: 'google',
                        };
                        done(null, user);
                    } catch (error) {
                        done(error as Error, undefined);
                    }
                }
            )
        );

        // Google Login Route
        app.get(
            '/api/auth/google',
            passport.authenticate('google', {
                scope: ['profile', 'email'],
            })
        );

        // Google Callback Route
        app.get(
            '/api/auth/google/callback',
            passport.authenticate('google', { failureRedirect: '/login?error=google_auth_failed' }),
            async (req: Request, res: Response) => {
                try {
                    const user = req.user as Express.User;
                    if (!user || !user.openId) {
                        return res.redirect('/login?error=no_user_data');
                    }

                    let provisionedUser;
                    try {
                        provisionedUser = await db.resolveProvisionedOAuthUser(user.openId, user.email || null);
                    } catch (error: any) {
                        if (error?.code === "AMBIGUOUS_TENANT") {
                            return res.redirect('/login?error=ambiguous_tenant');
                        }
                        throw error;
                    }

                    if (!provisionedUser) {
                        return res.redirect('/login?error=not_provisioned');
                    }

                    const ownerEmail = process.env.OWNER_EMAIL;
                    const isOwner = ownerEmail && user.email && user.email.toLowerCase() === ownerEmail.toLowerCase();

                    await db.upsertUser({
                        tenantId: provisionedUser.tenantId,
                        openId: provisionedUser.openId,
                        name: user.name || provisionedUser.name || null,
                        email: user.email || provisionedUser.email || null,
                        loginMethod: 'google',
                        lastSignedIn: new Date(),
                        role: isOwner ? 'owner' : provisionedUser.role,
                    });

                    // Create session token
                    const sessionToken = await sdk.createSessionToken(provisionedUser.openId, {
                        name: user.name || '',
                        expiresInMs: ONE_YEAR_MS,
                        ipAddress: req.ip,
                        userAgent: req.headers["user-agent"] as string,
                    });

                    // Set cookie
                    const cookieOptions = getSessionCookieOptions(req);
                    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

                    res.redirect('/');
                } catch (error) {
                    logger.error('[OAuth] Google callback failed:', error);
                    res.redirect('/login?error=callback_failed');
                }
            }
        );

        logger.info('✅ Google OAuth enabled');
    } else {
        logger.info('⚠️  Google OAuth disabled (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)');
    }

    // ==========================================
    // MICROSOFT OAUTH STRATEGY
    // ==========================================
    const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
    const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const microsoftTenantId = process.env.MICROSOFT_TENANT_ID || 'common';

    if (microsoftClientId && microsoftClientSecret) {
        passport.use(
            new OIDCStrategy(
                {
                    identityMetadata: `https://login.microsoftonline.com/${microsoftTenantId}/v2.0/.well-known/openid-configuration`,
                    clientID: microsoftClientId,
                    clientSecret: microsoftClientSecret,
                    responseType: 'code',
                    responseMode: 'query',
                    redirectUrl: `${baseUrl}/api/auth/microsoft/callback`,
                    allowHttpForRedirectUrl: !isProd,
                    scope: ['profile', 'email', 'openid'],
                    validateIssuer: true,
                    passReqToCallback: false,
                },
                async (iss: any, sub: any, profile: any, accessToken: any, refreshToken: any, done: any) => {
                    try {
                        const user: Express.User = {
                            openId: profile.oid || profile.sub || sub,
                            name: profile.displayName || profile.name,
                            email: profile.upn || profile.email,
                            platform: 'microsoft',
                        };
                        done(null, user);
                    } catch (error) {
                        done(error as Error, undefined);
                    }
                }
            )
        );

        // Microsoft Login Route
        app.get(
            '/api/auth/microsoft',
            passport.authenticate('azuread-openidconnect', {
                failureRedirect: '/login?error=microsoft_init_failed',
            })
        );

        // Microsoft Callback Route
        app.get(
            '/api/auth/microsoft/callback',
            passport.authenticate('azuread-openidconnect', {
                failureRedirect: '/login?error=microsoft_auth_failed',
            }),
            async (req: Request, res: Response) => {
                try {
                    const user = (req as any).user;
                    if (!user || !user.openId) {
                        return res.redirect('/login?error=no_user_data');
                    }

                    let provisionedUser;
                    try {
                        provisionedUser = await db.resolveProvisionedOAuthUser(user.openId, user.email || null);
                    } catch (error: any) {
                        if (error?.code === "AMBIGUOUS_TENANT") {
                            return res.redirect('/login?error=ambiguous_tenant');
                        }
                        throw error;
                    }

                    if (!provisionedUser) {
                        return res.redirect('/login?error=not_provisioned');
                    }

                    const ownerEmail = process.env.OWNER_EMAIL;
                    const isOwner = ownerEmail && user.email && user.email.toLowerCase() === ownerEmail.toLowerCase();

                    await db.upsertUser({
                        tenantId: provisionedUser.tenantId,
                        openId: provisionedUser.openId,
                        name: user.name || provisionedUser.name || null,
                        email: user.email || provisionedUser.email || null,
                        loginMethod: 'microsoft',
                        lastSignedIn: new Date(),
                        role: isOwner ? 'owner' : provisionedUser.role,
                    });

                    // Create session token
                    const sessionToken = await sdk.createSessionToken(provisionedUser.openId, {
                        name: user.name || '',
                        expiresInMs: ONE_YEAR_MS,
                    });

                    // Set cookie
                    const cookieOptions = getSessionCookieOptions(req);
                    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

                    res.redirect('/');
                } catch (error) {
                    logger.error('[OAuth] Microsoft callback failed:', error);
                    res.redirect('/login?error=callback_failed');
                }
            }
        );

        logger.info('✅ Microsoft OAuth enabled');
    } else {
        logger.info('⚠️  Microsoft OAuth disabled (missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET)');
    }

    // Logout route
    app.get('/api/auth/logout', (req: Request, res: Response) => {
        res.clearCookie(COOKIE_NAME);
        (req as any).logout((err: any) => {
            if (err) {
                logger.error('[OAuth] Logout error:', err);
            }
            res.redirect('/login');
        });
    });
}
