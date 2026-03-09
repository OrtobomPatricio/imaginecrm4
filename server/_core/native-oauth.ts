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

/** Build a login/signup error redirect preserving the tenant slug when available. */
function loginErrorUrl(path: string, req: Request): string {
    const slug = (req.session as any)?.oauthTenantSlug;
    if (slug && !path.includes('tenant=')) {
        const sep = path.includes('?') ? '&' : '?';
        return `${path}${sep}tenant=${encodeURIComponent(slug)}`;
    }
    return path;
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
            sameSite: 'lax', // Required for OAuth redirects back from provider
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

            // Validate required company data before proceeding
            if (typeof companyName !== 'string' || !companyName.trim() || typeof slug !== 'string' || !slug.trim()) {
                logger.warn('[OAuth] Google signup missing companyName or slug');
                return res.redirect('/signup?error=oauth_signup_failed');
            }

            (req.session as any).pendingSignup = {
                companyName: companyName.slice(0, 200),
                slug: slug.toLowerCase().slice(0, 50),
                timezone: typeof timezone === 'string' ? timezone : 'America/Asuncion',
                language: typeof language === 'string' ? language : 'es',
                currency: typeof currency === 'string' ? currency : 'USD',
                termsVersion: typeof termsVersion === 'string' ? termsVersion : '1.0.0',
            };

            req.session.save((err) => {
                if (err) {
                    logger.error({ err }, '[OAuth] Failed to save session before Google signup redirect');
                    return res.redirect('/signup?error=session_save_failed');
                }
                passport.authenticate('google', {
                    scope: ['profile', 'email'],
                    state: true,
                } as any)(req, res, (authErr: any) => {
                    if (authErr) {
                        logger.error({ err: authErr }, '[OAuth] Google authenticate error');
                        return res.redirect('/signup?error=google_auth_failed');
                    }
                    next();
                });
            });
        });

        // Google Login Route
        app.get(
            '/api/auth/google',
            (req: Request, res: Response, next) => {
                // Store tenant slug in session so callback can scope user resolution
                const tenant = typeof req.query.tenant === 'string' ? req.query.tenant.trim().toLowerCase().slice(0, 50) : '';
                if (tenant) {
                    (req.session as any).oauthTenantSlug = tenant;
                }
                req.session.save((saveErr) => {
                    if (saveErr) {
                        logger.error({ err: saveErr }, '[OAuth] Failed to save session before Google login redirect');
                    }
                    passport.authenticate('google', {
                        scope: ['profile', 'email'],
                        state: true,
                    } as any)(req, res, (err: any) => {
                        if (err) {
                            logger.error({ err }, '[OAuth] Google login authenticate error');
                            return res.redirect(loginErrorUrl('/login?error=google_auth_failed', req));
                        }
                        next();
                    });
                });
            }
        );

        // Google Callback Route
        app.get(
            '/api/auth/google/callback',
            passport.authenticate('google', { failureRedirect: '/login?error=google_auth_failed', session: false }),
            async (req: Request, res: Response) => {
                try {
                    const user = req.user as Express.User;
                    logger.info({ openId: user?.openId, email: user?.email }, '[OAuth] Google callback - user from passport');

                    const oauthTenantSlug = (req.session as any)?.oauthTenantSlug || null;
                    if (oauthTenantSlug) delete (req.session as any).oauthTenantSlug;
                    const tenantParam = oauthTenantSlug ? `&tenant=${encodeURIComponent(oauthTenantSlug)}` : '';

                    if (!user || !user.openId) {
                        return res.redirect(`/login?error=no_user_data${tenantParam}`);
                    }

                    let provisionedUser;
                    try {
                        provisionedUser = await db.resolveProvisionedOAuthUser(user.openId, user.email || null, oauthTenantSlug);
                    } catch (error: any) {
                        if (error?.code === "AMBIGUOUS_TENANT") {
                            return res.redirect(`/login?error=ambiguous_tenant${tenantParam}`);
                        }
                        throw error;
                    }

                    logger.info({ found: !!provisionedUser, openId: provisionedUser?.openId, tenantSlug: oauthTenantSlug }, '[OAuth] Google - resolveProvisionedOAuthUser result');

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
                            return res.redirect(`/login?error=not_provisioned${tenantParam}`);
                        }
                    }

                    const ownerEmail = process.env.OWNER_EMAIL;
                    const ownerEmailValid = ownerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail);
                    const isOwner = ownerEmailValid && user.email && user.email.toLowerCase() === ownerEmail!.toLowerCase() && provisionedUser.tenantId === 1;

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
                    res.redirect(loginErrorUrl('/login?error=callback_failed', req));
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

            // Validate required company data before proceeding
            if (typeof companyName !== 'string' || !companyName.trim() || typeof slug !== 'string' || !slug.trim()) {
                logger.warn('[OAuth] Facebook signup missing companyName or slug');
                return res.redirect('/signup?error=oauth_signup_failed');
            }

            (req.session as any).pendingSignup = {
                companyName: companyName.slice(0, 200),
                slug: slug.toLowerCase().slice(0, 50),
                timezone: typeof timezone === 'string' ? timezone : 'America/Asuncion',
                language: typeof language === 'string' ? language : 'es',
                currency: typeof currency === 'string' ? currency : 'USD',
                termsVersion: typeof termsVersion === 'string' ? termsVersion : '1.0.0',
            };

            req.session.save((err) => {
                if (err) {
                    logger.error('Failed to save session before Facebook signup redirect', { error: err.message });
                    return res.redirect('/signup?error=session_save_failed');
                }
                passport.authenticate('facebook', {
                    scope: ['email'],
                    state: true,
                } as any)(req, res, (authErr: any) => {
                    if (authErr) {
                        logger.error({ err: authErr }, '[OAuth] Facebook authenticate error');
                        return res.redirect('/signup?error=facebook_auth_failed');
                    }
                    next();
                });
            });
        });

        // Facebook Login Route
        app.get(
            '/api/auth/facebook',
            (req: Request, res: Response, next) => {
                // Store tenant slug in session so callback can scope user resolution
                const tenant = typeof req.query.tenant === 'string' ? req.query.tenant.trim().toLowerCase().slice(0, 50) : '';
                if (tenant) {
                    (req.session as any).oauthTenantSlug = tenant;
                }
                req.session.save((saveErr) => {
                    if (saveErr) {
                        logger.error({ err: saveErr }, '[OAuth] Failed to save session before Facebook login redirect');
                    }
                    passport.authenticate('facebook', {
                        scope: ['email'],
                        state: true,
                    } as any)(req, res, (err: any) => {
                        if (err) {
                            logger.error({ err }, '[OAuth] Facebook login authenticate error');
                            return res.redirect(loginErrorUrl('/login?error=facebook_auth_failed', req));
                        }
                        next();
                    });
                });
            }
        );

        // Facebook Callback Route
        app.get(
            '/api/auth/facebook/callback',
            passport.authenticate('facebook', { failureRedirect: '/login?error=facebook_auth_failed', session: false }),
            async (req: Request, res: Response) => {
                try {
                    const user = req.user as Express.User;
                    logger.info({ openId: user?.openId, email: user?.email }, '[OAuth] Facebook callback - user from passport');

                    const oauthTenantSlug = (req.session as any)?.oauthTenantSlug || null;
                    if (oauthTenantSlug) delete (req.session as any).oauthTenantSlug;
                    const tenantParam = oauthTenantSlug ? `&tenant=${encodeURIComponent(oauthTenantSlug)}` : '';

                    if (!user || !user.openId) {
                        return res.redirect(`/login?error=no_user_data${tenantParam}`);
                    }

                    let provisionedUser;
                    try {
                        provisionedUser = await db.resolveProvisionedOAuthUser(user.openId, user.email || null, oauthTenantSlug);
                    } catch (error: any) {
                        if (error?.code === 'AMBIGUOUS_TENANT') {
                            return res.redirect(`/login?error=ambiguous_tenant${tenantParam}`);
                        }
                        throw error;
                    }

                    logger.info({ found: !!provisionedUser, openId: provisionedUser?.openId, tenantSlug: oauthTenantSlug }, '[OAuth] Facebook - resolveProvisionedOAuthUser result');

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
                            return res.redirect(`/login?error=not_provisioned${tenantParam}`);
                        }
                    }

                    const ownerEmail = process.env.OWNER_EMAIL;
                    const ownerEmailValid = ownerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail);
                    const isOwner = ownerEmailValid && user.email && user.email.toLowerCase() === ownerEmail!.toLowerCase() && provisionedUser.tenantId === 1;

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
                    res.redirect(loginErrorUrl('/login?error=callback_failed', req));
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
            req.session.save((err) => {
                if (err) {
                    logger.error('Failed to save session before Microsoft signup redirect', { error: err.message });
                    return res.redirect('/signup?error=session_save_failed');
                }
                passport.authenticate('azuread-openidconnect', {
                    failureRedirect: '/login?error=microsoft_init_failed',
                })(req, res, next);
            });
        });

        // Microsoft Login Route
        app.get(
            '/api/auth/microsoft',
            (req: Request, res: Response, next) => {
                // Store tenant slug in session so callback can scope user resolution
                const tenant = typeof req.query.tenant === 'string' ? req.query.tenant.trim().toLowerCase().slice(0, 50) : '';
                if (tenant) {
                    (req.session as any).oauthTenantSlug = tenant;
                }
                req.session.save((saveErr) => {
                    if (saveErr) {
                        logger.error({ err: saveErr }, '[OAuth] Failed to save session before Microsoft login redirect');
                    }
                    passport.authenticate('azuread-openidconnect', {
                        failureRedirect: '/login?error=microsoft_init_failed',
                    })(req, res, next);
                });
            }
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

                    const oauthTenantSlug = (req.session as any)?.oauthTenantSlug || null;
                    if (oauthTenantSlug) delete (req.session as any).oauthTenantSlug;
                    const tenantParam = oauthTenantSlug ? `&tenant=${encodeURIComponent(oauthTenantSlug)}` : '';

                    if (!user || !user.openId) {
                        return res.redirect(`/login?error=no_user_data${tenantParam}`);
                    }

                    let provisionedUser;
                    try {
                        provisionedUser = await db.resolveProvisionedOAuthUser(user.openId, user.email || null, oauthTenantSlug);
                    } catch (error: any) {
                        if (error?.code === "AMBIGUOUS_TENANT") {
                            return res.redirect(`/login?error=ambiguous_tenant${tenantParam}`);
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
                            return res.redirect(`/login?error=not_provisioned${tenantParam}`);
                        }
                    }

                    const ownerEmail = process.env.OWNER_EMAIL;
                    const ownerEmailValid = ownerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail);
                    const isOwner = ownerEmailValid && user.email && user.email.toLowerCase() === ownerEmail!.toLowerCase() && provisionedUser.tenantId === 1;

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
                    res.redirect(loginErrorUrl('/login?error=callback_failed', req));
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
