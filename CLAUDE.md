# Project context for Claude

This file exists so a Claude session on a **different machine** has the context
needed to help immediately — local dev setup and the real production deployment
this app is already running on. Read this before assuming anything about how the
app is deployed or configured.

## What this is

Express + MySQL backend for `itsolutions.com.pk`, an e-commerce store. Multi-tenant
capable in the code, but this deployment runs as a **single store** (see
"Single-store deployment" below). Paired with a separate frontend repo,
`Store-Website-frontend` (Vite/React, served as a static build via `serve`).

## Local dev setup

See `README.md` for the basic `npm install` / `.env` / `npm run dev` steps.
Nothing production-specific needed for local dev — `CLOUDFLARE_SHARED_SECRET`,
`S3_*`, `SENTRY_DSN` are all unused outside `NODE_ENV=production`, safe to leave
blank locally.

## Production deployment (already live)

**Hosting:** Railway. Two services in one Railway project:
- Backend (this repo) — Docker build (uses the repo's `Dockerfile`, not the
  Nixpacks buildpack), custom domain `api.itsolutions.com.pk`.
- Frontend (`Store-Website-frontend`) — `npm run build` then `npm start`
  (`serve -s dist -l $PORT`), custom domain `itsolutions.com.pk` (+ `www`).
- MySQL — Railway's own MySQL plugin, same project. Backend's `DB_*` vars
  reference it via Railway's `${{MySQL.MYSQLHOST}}` etc. syntax, not hardcoded.

**DNS/CDN:** Both domains are on Cloudflare, proxied (orange cloud). SSL/TLS
mode is **Full (strict)**. `itsolutions.com.pk` (registered via PKNIC) is this
project's zone; there are other unrelated domains on the same Cloudflare
account, be careful not to touch them when working in the Cloudflare
dashboard. (This app previously ran on `itnetwork.pk`, fully migrated away
from — that domain/zone is no longer wired to anything in this project.)

**Object storage:** Cloudflare R2, bucket `itnetwork-uploads` (bucket name is
a leftover from before the domain migration, harmless — bucket names aren't
customer-visible), public access via custom domain `cdn.itsolutions.com.pk`
(not the `r2.dev` URL — that one is rate-limited and was deliberately not
used for this production deployment).

**Outgoing email:** Resend — prefers the HTTPS API (`RESEND_API_KEY`) over
SMTP when both are set, since some hosts (Railway included) block outbound
SMTP at the connection level regardless of credentials (see `utils/mailer.js`,
commit `96ca438`). Domain `itsolutions.com.pk` is verified on a **second,
separate Resend account** (not the account used by another, unrelated site)
— Resend's free tier only allows 1 verified domain per account, which is why
there are two accounts. (The `itnetwork.pk` domain verification on that
account was deleted to free the slot when migrating to `itsolutions.com.pk`.)

**Admin panel:** served at a non-default obfuscated path — see `ADMIN_PATH` in
the actual `.env`/Railway vars (not documented here on purpose, since this file
may be more widely readable than the real secret). Must match
`VITE_ADMIN_PATH` on the frontend exactly.

## The Cloudflare origin-trust setup (important — don't remove without reading this)

`middleware/cloudflare.js` (`requireCloudflare`) rejects any production request
that doesn't carry a shared-secret header, and overrides `req.ip` from
Cloudflare's `CF-Connecting-IP` header. This exists because:

- Two proxy hops sit in front of this app in production (Cloudflare, then
  Railway's own edge) — `trust proxy` is set to `2` in `app.js` to match.
- Without the shared-secret check, anyone who found the raw Railway
  `*.up.railway.app` URL could hit the app directly, bypassing Cloudflare, and
  forge `CF-Connecting-IP` themselves — defeating every IP-keyed rate limiter
  and poisoning `audit_logs.ip_address`.
- The secret is sent via a Cloudflare **Request Header Transform Rule** (Rules
  → Transform Rules → Request Header Transform Rule), header name
  `X-Origin-Shared-Secret` — **not** `X-CF-...`, because Cloudflare rejects
  setting any custom header with that reserved prefix (this was tried first
  and failed; see commit `6b3c720`). Must match `CLOUDFLARE_SHARED_SECRET` on
  Railway exactly.
- `/api/health` is intentionally placed *before* this middleware in `app.js`,
  since Railway's own container healthcheck hits it directly, bypassing
  Cloudflare.
- Entirely gated on `NODE_ENV=production` — a no-op in dev/test, so this
  never needs configuring locally.

If `api.itsolutions.com.pk` ever starts returning 403 "Forbidden" on
everything, the first thing to check is whether the Transform Rule is still
active (recreated on the current zone during the domain migration — Transform
Rules don't carry over automatically between zones) and the secret values
still match on both sides — not a code bug by default.

## Single-store deployment: `DEFAULT_STORE_SLUG`

`middleware/tenant.js` normally derives the "store" from the request's
hostname (splits on `.`, takes the first segment) — that works for
subdomain-per-tenant setups, but breaks here because the frontend
(`itsolutions.com.pk`) and backend (`api.itsolutions.com.pk`) are on different
hostnames/subdomains. `DEFAULT_STORE_SLUG=main` is set on the backend to skip
that hostname-guessing entirely and always resolve to the one business seeded
by `db:init` (slug `main`). If this ever gets unset, every API request will
start 404ing with `"Store not found"` — this bit us once already during setup.

## Known one-time gotchas already hit and fixed (context, not action items)

- `npm start` used to depend on `cross-env`, a devDependency — crash-looped on
  any host that installs with `--omit=dev`. Fixed in commit `6472145`; `start`
  now just runs `node server.js` directly, relying on `NODE_ENV=production`
  already being set as a platform env var (which it is, on Railway).
- The R2 API secret key was originally mis-pasted with an extra character
  (`Credential access key has length 33, should be 32`) — if this error ever
  reappears, it's almost always a copy-paste issue with `S3_SECRET_ACCESS_KEY`
  or `S3_ACCESS_KEY_ID`, not a code problem.
- Migrated production from `itnetwork.pk` to `itsolutions.com.pk` (2026-07).
  Pure config/DNS migration, no code changes were needed — every domain
  reference in this app is env-var driven. Two Railway-specific snags hit
  along the way, in case they recur on a future migration: (1) Railway caps
  custom domains per service, so `www.<domain>` couldn't be added to the
  frontend service until the old domain's entry was removed first; (2)
  Cloudflare Transform Rules are per-zone, so the `X-Origin-Shared-Secret`
  rule had to be recreated by hand on the new zone — it doesn't carry over
  from the old one.

## Where to look for more

- `docs/AUDIT.md` — full security/scalability audit history and rationale for
  a lot of existing design decisions (rate limiting, session revocation,
  encryption, etc.) — check here before assuming something is an oversight.
- `.env.example` — the authoritative list of every env var this app reads,
  with setup instructions inline for the less obvious ones (Cloudflare
  Transform Rule steps, R2/S3 setup for either provider).
- `README.md` — local dev quickstart and the single-process in-memory state
  caveat (matters if this is ever scaled to more than one backend instance).
