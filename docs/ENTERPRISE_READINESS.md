# Enterprise Readiness Checklist

## 1) Config hardening (blocking)
- Enforce strong secrets at startup (`JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `COOKIE_SECRET`).
- GitHub Actions must use repository/environment secrets (no inline secret-like values in workflow yaml).
- Fail startup when `ALLOW_DEV_LOGIN=1` or `ENABLE_DEV_BYPASS=1` in production.
- Validate cookie policy values (`COOKIE_SAMESITE`, `COOKIE_SECURE`) before boot.

## 2) Production guardrails
- `ENABLE_DEV_BYPASS` must never be enabled in production.
- Keep `ALLOW_DEV_LOGIN=0` in production environments.

## 3) Test strategy
- Use `vi.stubEnv` and `vi.unstubAllEnvs` in tests to avoid global env leakage.
- Keep role-based tests explicit (owner/admin/agent/viewer).

## 4) Real DB parity
- Run parity test against real MySQL before release:
  - `RUN_REAL_DB_PARITY=1 DATABASE_URL=... pnpm test:real-db`

## 5) Security baseline (cookies/session)
- Configure cookie settings explicitly for deployment model:
  - `COOKIE_SAMESITE=lax|strict|none`
  - `COOKIE_SECURE=1` (recommended in production)
  - `COOKIE_DOMAIN=<your-domain>` (optional)
- If `COOKIE_SAMESITE=none`, secure cookies are mandatory.

## 6) Operational readiness
- Enable alerting (Sentry + uptime checks + pager channel).
- Decide Redis enforcement policy (`REQUIRE_REDIS_IN_PROD=1` for strict production environments).
- Keep structured logs and retention policy (30–90 days).
- Run periodic backup restore smoke test (weekly recommended):
  - `deploy/backup_restore_smoke.sh`

## Suggested release gate
1. `pnpm check`
2. `pnpm test`
3. `pnpm validate:prod-config`
4. `pnpm test:real-db` (in staging/prod-like env)
5. Weekly `backup_restore_smoke.sh` evidence attached to ops log


## 7) Automated evidence in CI
- `ci.yml` and `ci-cd.yml` run a **Real DB Parity** job with MySQL service.
- Weekly (and manual) **Backup Restore Smoke** workflow:
  - `.github/workflows/backup-restore-smoke.yml`
- Keep artifacts/log links in your ops audit trail per run.


## 8) SRE governance
- Adopt and maintain `docs/SRE_OPERATIONS_RUNBOOK.md` with on-call ownership, SLAs and evidence cadence.
