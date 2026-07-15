# Computer Zone — Backend

Express + MySQL/MariaDB API for the storefront and admin panel. Multi-tenant (business scoped via the `X-Store-Slug` header), httpOnly-cookie session auth.

## Setup

```
npm install
cp .env.example .env   # fill in real values
npm run db:init         # applies schema.sql + seeds the store admin account
npm run db:migrate      # applies incremental migrations (safe to re-run)
npm run dev
```

## Known scaling limitation: in-memory caches assume a single process

Several pieces of middleware currently keep their state in a plain in-memory `Map`, scoped to whichever Node process handles the request:

- **`middleware/loginRateLimit.js`** — per-IP+email failed-login lockout.
- **`utils/sessionRevocation.js`** — makes logout/password-change/2FA-disable revoke an access token immediately instead of waiting out its 15-minute lifetime (see `middleware/auth.js`).
- **`utils/challengeStore.js`** — the short-lived password-verified-pending-2FA challenge issued during login.
- **`middleware/tenant.js`** — a 30s cache of slug → business, to avoid a DB round trip on every request (see `docs/AUDIT.md`).
- **`authController.js`'s `recentRotations` map** — a 10s grace window on refresh-token rotation, so a page firing several parallel requests right at token expiry doesn't get spuriously logged out (see `docs/AUDIT.md`, finding M4).

All are correct and sufficient **as long as this backend runs as a single Node process.** Each keeps its own separate copy of this state — so the day this app is deployed as **more than one backend instance behind a load balancer**, all of them would start behaving inconsistently:

- A login lockout on one instance wouldn't apply to attempts routed to another instance.
- A logout handled by one instance wouldn't revoke the token on the others, silently reopening the exact multi-minute window `sessionRevocation.js` was built to close.
- The tenant cache and refresh-rotation grace window would each have a per-instance view — mostly harmless (short TTLs, self-healing), but worth knowing about.

**Fix when that day comes:** move these to a shared store (Redis is the natural choice — a single `SET key value EX <ttl>` / `EXISTS key` per check, no other infra changes needed) so every instance reads from the same place. Do them together, since they'd share the same Redis instance and connection setup. Not worth building ahead of time — there's no Redis in this stack today, and adding it now would just be infrastructure with nothing to justify it yet.

## Object storage for uploads (recommended before scaling past one instance)

Product images and payment-proof screenshots default to local disk (`./uploads`, `./payment-proofs`), which only works for a single instance — see `docs/AUDIT.md` (finding C1) and `utils/objectStorage.js`. Set `S3_BUCKET` + credentials in `.env` to switch to S3-compatible object storage (Cloudflare R2, AWS S3, etc.) instead; see the comments in `.env.example` for exact setup steps.
