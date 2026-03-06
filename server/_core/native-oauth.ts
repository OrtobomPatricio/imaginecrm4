import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { OIDCStrategy } from 'passport-azure-ad';
import type { Express, Request, Response } from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { COOKIE_NAME, ONE_YEAR_MS } from '@shared/const';
import * as db from '../db';
import { autoProvisionOAuthUser, createOAuthSignupTenant } from '../db';
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

// Note: serializeUser/deserializeUser not needed since all passport.authenticate
// calls use session: false. The app uses its own JWT-based session system.

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

    // Track which providers are enabled
    const enabledProviders: string[] = [];

    // Cookie parser and sessions (memory store for dev, Redis for prod)
    app.use(cookieParser());
    const redisSessionStore = createOAuthSessionStore();

    const sessionConfig: any = {
        secret: sessionSecret || (isProd ? undefined : 'dev-cookie-secret-local-only'),
        resave: false,
        saveUninitialized: false,
        name: 'oauth.sid',
        proxy: isProd, // Trust X-Forwarded-Proto behind reverse proxy
        cookie: {
            secure: isProd,
            httpOnly: true,
            maxAge: 10 * 60 * 1000, // 10 min for OAuth state
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

        // Google Signup Route (stores company data in session before OAuth redirect)
        app.get('/api/auth/google/signup', (req: Request, res: Response, next) => {
            const { companyName, slug, timezone, language, currency, termsVersion } = req.query;
            if (typeof companyName === 'string' && typeof slug === 'string') {
                (req.session as any).pendingSignup = {
                    companyName: companyName.slice(0, 200),
                    slug: slug.toLowerCase().slice(0, 50),
                    timezone: typeof timezone === 'string' ? timezone : 'America/Asuncion',
                    language: typeof language === 'string' ? language : 'es',
                    currency: typeof currency === 'string' ? currency : 'USD',
                    termsVersion: typeof termsVersion === 'string' ? termsVersion : '1.0.0',
                };
            }
            req.session.save(() => {
                passport.authenticate('google', {
                    scope: ['profile', 'email'],
                    state: true,
                })(req, res, next);
            });
        });

        // Google Login Route
        app.get(
            '/api/auth/google',
            passport.authenticate('google', {
                scope: ['profile', 'email'],
                state: true, // CSRF protection via session-backed state parameter
            })
        );

        // Google Callback Route
        app.get(
            '/api/auth/google/callback',
            passport.authenticate('google', { failureRedirect: '/login?error=google_auth_failed', session: false }),
            async (req: Request, res: Response) => {
                try {
                    const user = req.user as Express.User;
                    logger.info({ openId: user?.openId, email: user?.email }, '[OAuth] Google callback - user from passport');
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

                    logger.info({ found: !!provisionedUser, openId: provisionedUser?.openId }, '[OAuth] Google - resolveProvisionedOAuthUser result');

                    if (!provisionedUser) {
                        const pendingSignup = (req.session as any)?.pendingSignup;
                        if (pendingSignup) {
                            delete (req.session as any).pendingSignup;
                            provisionedUser = await createOAuthSignupTenant(user, pendingSignup);
                            if (!provisionedUser) {
                                return res.redirect('/signup?error=oauth_signup_failed');
                            }
                        }
                    }

                    if (!provisionedUser) {
                        provisionedUser = await autoProvisionOAuthUser(user);
                        if (!provisionedUser) {
                            return res.redirect('/login?error=not_provisioned');
                        }
                    }

                    const ownerEmail = process.env.OWNER_EMAIL;
                    const isOwner = ownerEmail && user.email && user.email.toLowerCase() === ownerEmail.toLowerCase() && provisionedUser.tenantId === 1;

                    // Only update loginMethod and lastSignedIn on returning logins.
                    // Name/email only filled if the DB record is empty (avoid overwriting admin edits).
                    // Role: only promote to owner on first login when matching OWNER_EMAIL on tenant 1.
                    const upsertData: Parameters<typeof db.upsertUser>[0] = {
                        tenantId: provisionedUser.tenantId,
                        openId: provisionedUser.openId,
                        name: provisionedUser.name ? undefined : (user.name || null),
                        email: provisionedUser.email ? undefined : (user.email || null),
                        loginMethod: 'google',
                        lastSignedIn: new Date(),
                    };
                    if (isOwner && provisionedUser.role !== 'owner') {
                        upsertData.role = 'owner';
                    }
                    await db.upsertUser(upsertData);

                    // Create session token
                    const sessionToken = await sdk.createSessionToken(provisionedUser.openId, {
                        name: user.name || '',
                        expiresInMs: ONE_YEAR_MS,
                        ipAddress: req.ip,
                        userAgent: req.headers["user-agent"] as string,
                    });

                    // Set cookie
                    const cookieOptions = getSessionCookieOptions(req);
                    logger.info({ cookieSecure: cookieOptions.secure, sameSite: cookieOptions.sameSite, tokenLength: sessionToken.length }, '[OAuth] Google - setting session cookie');
                    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

                    res.redirect('/oauth-complete');
                } catch (error) {
                    logger.error('[OAuth] Google callback failed:', error);
                    res.redirect('/login?error=callback_failed');
                }
            }
        );

        enabledProviders.push('google');
        logger.info('✅ Google OAuth enabled');
    } else {
        logger.info('⚠️  Google OAuth disabled (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)');
    }

    // ==========================================
    // FACEBOOK OAUTH STRATEGY
    // ==========================================
    const facebookAppId = process.env.FACEBOOK_APP_ID;
    const facebookAppSecret = process.env.FACEBOOK_APP_SECRET;

    if (facebookAppId && facebookAppSecret) {
        passport.use(
            new FacebookStrategy(
                {
                    clientID: facebookAppId,
                    clientSecret: facebookAppSecret,
                    callbackURL: `${baseUrl}/api/auth/facebook/callback`,
                    profileFields: ['id', 'displayName', 'emails'],
                    enableProof: true,
                },
                async (accessToken: string, refreshToken: string, profile: any, done: any) => {
                    try {
                        logger.info('[FacebookOAuth] Profile received:', profile.id);
                        const user: Express.User = {
                            openId: `fb_${profile.id}`,
                            name: profile.displayName,
                            email: profile.emails?.[0]?.value,
                            platform: 'facebook',
                        };
                        done(null, user);
                    } catch (error) {
                        done(error as Error, undefined);
                    }
                }
            )
        );

        // Facebook Signup Route
        app.get('/api/auth/facebook/signup', (req: Request, res: Response, next) => {
            const { companyName, slug, timezone, language, currency, termsVersion } = req.query;
            if (typeof companyName === 'string' && typeof slug === 'string') {
                (req.session as any).pendingSignup = {
                    companyName: companyName.slice(0, 200),
                    slug: slug.toLowerCase().slice(0, 50),
                    timezone: typeof timezone === 'string' ? timezone : 'America/Asuncion',
                    language: typeof language === 'string' ? language : 'es',
                    currency: typeof currency === 'string' ? currency : 'USD',
                    termsVersion: typeof termsVersion === 'string' ? termsVersion : '1.0.0',
                };
            }
            req.session.save(() => {
                passport.authenticate('facebook', {
                    scope: ['email'],
                    state: true,
                })(req, res, next);
            });
        });

        // Facebook Login Route
        app.get(
            '/api/auth/facebook',
            passport.authenticate('facebook', {
                scope: ['email'],
                state: true, // CSRF protection via session-backed state parameter
            })
        );

        // Facebook Callback Route
        app.get(
            '/api/auth/facebook/callback',
            passport.authenticate('facebook', { failureRedirect: '/login?error=facebook_auth_failed', session: false }),
            async (req: Request, res: Response) => {
                try {
                    const user = req.user as Express.User;
                    logger.info({ openId: user?.openId, email: user?.email }, '[OAuth] Facebook callback - user from passport');
                    if (!user || !user.openId) {
                        return res.redirect('/login?error=no_user_data');
                    }

                    let provisionedUser;
                    try {
                        provisionedUser = await db.resolveProvisionedOAuthUser(user.openId, user.email || null);
                    } catch (error: any) {
                        if (error?.code === 'AMBIGUOUS_TENANT') {
                            return res.redirect('/login?error=ambiguous_tenant');
                        }
                        throw error;
                    }

                    logger.info({ found: !!provisionedUser, openId: provisionedUser?.openId }, '[OAuth] Facebook - resolveProvisionedOAuthUser result');

                    if (!provisionedUser) {
                        const pendingSignup = (req.session as any)?.pendingSignup;
                        if (pendingSignup) {
                            delete (req.session as any).pendingSignup;
                            provisionedUser = await createOAuthSignupTenant(user, pendingSignup);
                            if (!provisionedUser) {
                                return res.redirect('/signup?error=oauth_signup_failed');
                            }
                        }
                    }

                    if (!provisionedUser) {
                        provisionedUser = await autoProvisionOAuthUser(user);
                        if (!provisionedUser) {
                            return res.redirect('/login?error=not_provisioned');
                        }
                    }

                    const ownerEmail = process.env.OWNER_EMAIL;
                    const isOwner = ownerEmail && user.email && user.email.toLowerCase() === ownerEmail.toLowerCase() && provisionedUser.tenantId === 1;

                    const upsertData: Parameters<typeof db.upsertUser>[0] = {
                        tenantId: provisionedUser.tenantId,
                        openId: provisionedUser.openId,
                        name: provisionedUser.name ? undefined : (user.name || null),
                        email: provisionedUser.email ? undefined : (user.email || null),
                        loginMethod: 'facebook',
                        lastSignedIn: new Date(),
                    };
                    if (isOwner && provisionedUser.role !== 'owner') {
                        upsertData.role = 'owner';
                    }
                    await db.upsertUser(upsertData);

                    // Create session token
                    const sessionToken = await sdk.createSessionToken(provisionedUser.openId, {
                        name: user.name || '',
                        expiresInMs: ONE_YEAR_MS,
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'] as string,
                    });

                    // Set cookie
                    const cookieOptions = getSessionCookieOptions(req);
                    logger.info({ cookieSecure: cookieOptions.secure, sameSite: cookieOptions.sameSite, tokenLength: sessionToken.length }, '[OAuth] Facebook - setting session cookie');
                    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

                    res.redirect('/oauth-complete');
                } catch (error) {
                    logger.error('[OAuth] Facebook callback failed:', error);
                    res.redirect('/login?error=callback_failed');
                }
            }
        );

        enabledProviders.push('facebook');
        logger.info('✅ Facebook OAuth enabled');
    } else {
        logger.info('⚠️  Facebook OAuth disabled (missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET)');
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

        // Microsoft Signup Route
        app.get('/api/auth/microsoft/signup', (req: Request, res: Response, next) => {
            const { companyName, slug, timezone, language, currency, termsVersion } = req.query;
            if (typeof companyName === 'string' && typeof slug === 'string') {
                (req.session as any).pendingSignup = {
                    companyName: companyName.slice(0, 200),
                    slug: slug.toLowerCase().slice(0, 50),
                    timezone: typeof timezone === 'string' ? timezone : 'America/Asuncion',
                    language: typeof language === 'string' ? language : 'es',
                    currency: typeof currency === 'string' ? currency : 'USD',
                    termsVersion: typeof termsVersion === 'string' ? termsVersion : '1.0.0',
                };
            }
            req.session.save(() => {
                passport.authenticate('azuread-openidconnect', {
                    failureRedirect: '/login?error=microsoft_init_failed',
                })(req, res, next);
            });
        });

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
                session: false,
            }),
            async (req: Request, res: Response) => {
                try {
                    const user = (req as any).user;
                    logger.info({ openId: user?.openId, email: user?.email }, '[OAuth] Microsoft callback - user from passport');
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
                        const pendingSignup = (req.session as any)?.pendingSignup;
                        if (pendingSignup) {
                            delete (req.session as any).pendingSignup;
                            provisionedUser = await createOAuthSignupTenant(user, pendingSignup);
                            if (!provisionedUser) {
                                return res.redirect('/signup?error=oauth_signup_failed');
                            }
                        }
                    }

                    if (!provisionedUser) {
                        provisionedUser = await autoProvisionOAuthUser(user);
                        if (!provisionedUser) {
                            return res.redirect('/login?error=not_provisioned');
                        }
                    }

                    const ownerEmail = process.env.OWNER_EMAIL;
                    const isOwner = ownerEmail && user.email && user.email.toLowerCase() === ownerEmail.toLowerCase() && provisionedUser.tenantId === 1;

                    const upsertData: Parameters<typeof db.upsertUser>[0] = {
                        tenantId: provisionedUser.tenantId,
                        openId: provisionedUser.openId,
                        name: provisionedUser.name ? undefined : (user.name || null),
                        email: provisionedUser.email ? undefined : (user.email || null),
                        loginMethod: 'microsoft',
                        lastSignedIn: new Date(),
                    };
                    if (isOwner && provisionedUser.role !== 'owner') {
                        upsertData.role = 'owner';
                    }
                    await db.upsertUser(upsertData);

                    // Create session token
                    const sessionToken = await sdk.createSessionToken(provisionedUser.openId, {
                        name: user.name || '',
                        expiresInMs: ONE_YEAR_MS,
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'] as string,
                    });

                    // Set cookie
                    const cookieOptions = getSessionCookieOptions(req);
                    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

                    res.redirect('/oauth-complete');
                } catch (error) {
                    logger.error('[OAuth] Microsoft callback failed:', error);
                    res.redirect('/login?error=callback_failed');
                }
            }
        );

        enabledProviders.push('microsoft');
        logger.info('✅ Microsoft OAuth enabled');
    } else {
        logger.info('⚠️  Microsoft OAuth disabled (missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET)');
    }

    // Endpoint to expose which OAuth providers are enabled
    app.get('/api/auth/providers', (_req: Request, res: Response) => {
        res.json({ providers: enabledProviders });
    });

    // Logout route
    app.get('/api/auth/logout', async (req: Request, res: Response) => {
        // Revoke JWT session from DB (same as tRPC logout)
        const token = req.cookies?.[COOKIE_NAME];
        if (token) {
            try { await sdk.revokeSession(token); } catch (e) {
                logger.error({ err: e }, '[OAuth] Failed to revoke session during logout');
            }
        }
        res.clearCookie(COOKIE_NAME);
        (req as any).logout((err: any) => {
            if (err) {
                logger.error('[OAuth] Logout error:', err);
            }
            res.redirect('/login');
        });
    });

    // Fallback for unconfigured providers — redirect with clear error
    // MUST be last /api/auth/* route since :provider is a catch-all param
    app.get('/api/auth/:provider', (req: Request, res: Response) => {
        const provider = req.params.provider;
        logger.warn(`[OAuth] Attempt to use unconfigured provider: ${provider}`);
        res.redirect(`/login?error=provider_not_configured&provider=${encodeURIComponent(provider)}`);
    });
}
