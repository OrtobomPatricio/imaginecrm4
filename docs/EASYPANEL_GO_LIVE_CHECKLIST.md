# EasyPanel Go-Live Checklist (ImagineCRM)

## 1) Environment (must pass)
- `NODE_ENV=production`
- `TRUST_PROXY=1`
- `ALLOW_DEV_LOGIN=0`
- `VITE_DEV_BYPASS_AUTH=0`
- `ENABLE_DEV_BYPASS=0`
- `ALLOW_MOCK_DB=0`
- `REQUIRE_REDIS_IN_PROD=1`
- `COOKIE_SAMESITE=lax`
- `COOKIE_SECURE=1`
- `RUN_MIGRATIONS=1` on first deploy only

## 2) Required URLs (HTTPS)
- `CLIENT_URL=https://<your-domain>`
- `VITE_API_URL=https://<your-domain>`
- `VITE_OAUTH_PORTAL_URL=https://<your-domain>`
- `OAUTH_SERVER_URL=https://<your-domain>`

## 3) Required secrets
- `JWT_SECRET` (64+ random chars)
- `COOKIE_SECRET` (64+ random chars)
- `DATA_ENCRYPTION_KEY` (32+ random chars)

## 4) Connectivity checks
- `DATABASE_URL` points to EasyPanel MySQL service
- `REDIS_URL` points to EasyPanel Redis service
- App logs show successful DB and Redis initialization

## 5) First start sequence
1. Deploy with `RUN_MIGRATIONS=1`
2. Verify `/api/health` is healthy
3. Run `pnpm verify:tenant-indexes` with production `DATABASE_URL`
4. Confirm login works and session cookie is set
5. Set `RUN_MIGRATIONS=0` and redeploy

## 5.1) Performance sanity check (recommended)
- Run `TENANT_ID=<existing_tenant_id> pnpm verify:tenant-performance`
- Ensure there are no `Critical query plan issue (full scan/no key)` errors

## 6) Post-deploy smoke tests
- Create tenant/user and login
- Create lead and move stage in pipeline
- Send one chat message / create one appointment
- Verify role permissions (`owner/admin/agent`)

## 7) Security quick checks
- No HTTP-only public URL in production auth config
- No default/dev secrets
- No dev bypass flags enabled
