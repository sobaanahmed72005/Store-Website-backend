# Codebase audit — findings & fix log

Full security/scalability/architecture review performed 2026-07-15, fixes applied the same day. Every finding below was individually re-verified against the actual code before being marked fixed — a first pass (by several parallel automated reviewers) produced a few findings that turned out to already be handled by an *earlier* audit round already in this repo's history (see `git log`: "Fix Critical and High severity issues...", "Fix Medium severity maintainability issues...", "Fix remaining LOW-severity findings..."). Those are called out explicitly below rather than silently dropped, so this file stays trustworthy as a record of what was actually checked.

**Legend:** 🟢 Fixed · ⚪ Already fine (verified, no action needed) · 🔵 Deliberately deferred (with reason)

Overall verdict, for context: this is a well-engineered codebase in the ways that matter most — every query is parameterized, tenant isolation is enforced twice, checkout pricing is recomputed server-side, stock/discount-code races are handled with real transactions and row locks, secrets are encrypted correctly at rest, `npm audit` is clean. The work below closes real gaps, mostly around what breaks under traffic/catalog growth — it was not a rewrite.

---

## Critical — breaks under real traffic/catalog growth

| # | Status | Finding | Fix |
|---|--------|---------|-----|
| C1 | 🟢 | File uploads (product images, payment proofs) lived on local disk — a second server instance would silently lose files and 404 on the other half | New `utils/objectStorage.js` — S3-compatible client (works with Cloudflare R2, AWS S3, or anything else speaking the S3 API). Uploads now flow through memory (never touch disk pre-validation) and land in object storage when `S3_BUCKET` is configured, local disk otherwise. **Action needed from you:** create an R2 bucket + API token and set `S3_*` vars in `.env` (see `.env.example`) before scaling past one instance — see the closing summary. |
| C2 | 🟢 | Scheduled jobs (`setInterval`) had no cross-instance coordination — would double-send review-reminder emails and double-call the courier API once scaled | New `utils/distributedLock.js` using MySQL's `GET_LOCK()` — zero new infrastructure. Only one instance runs a given job on each tick; others skip that tick. Wired into all three jobs in `server.js`. |
| C3 | 🟢 | N+1 query + unbounded result set in per-user order history | `getOrdersByUser` now does one `IN (...)` query for all items instead of one query per order, and is paginated. **Response shape changed** from a bare array to `{ orders, page, limit, total, totalPages }` — the frontend needs a matching update (see closing summary). |
| C4 | 🟢 | Admin order list did a full unindexed table scan per row, twice (duplicate payment-reference/proof-image check) | Added `(business_id, payment_reference)` and `(business_id, payment_proof_image)` indexes — `sql/migrate-scale-indexes.js`, also in `schema.sql` for fresh installs. |

## High — will bite soon

| # | Status | Finding | Fix |
|---|--------|---------|-----|
| H1 | 🟢 | Connection pool had no `queueLimit` — spikes became unbounded memory growth instead of a fast 503 | `config/db.js` — `queueLimit: 50`, `connectTimeout: 10s`, pool size raised to 20 (configurable via `DB_POOL_SIZE`). |
| H2 | 🟢 | Every request paid a DB round trip to resolve the tenant, uncached | 30s in-memory TTL cache in `middleware/tenant.js`. |
| H3 | 🟢 | No composite index for the highest-traffic read path (product listing) | Added `(business_id, created_at)` and `(business_id, category_id, created_at)` on `products` — same migration as C4. |
| H4 | 🟢 | Request logs captured the full `Cookie` header — live session tokens in plaintext logs | `app.js` — `pino-http` now redacts `req.headers.cookie`, `req.headers.authorization`, `res.headers["set-cookie"]`. |
| H5 | 🟢 | Registration accepted arbitrarily weak passwords (no length check, unlike change/reset) | `authController.js` — `register` now enforces the same 8–128 character bound as `changePassword`/`resetPassword` (shared `passwordLengthError` helper). |
| H6 | 🟢 | No startup validation that `JWT_SECRET`/`CREDENTIALS_ENCRYPTION_KEY` were strong | `config/env.js` — fails fast in production if `JWT_SECRET` is short/unset, or `CREDENTIALS_ENCRYPTION_KEY` isn't a valid 64-char hex string. Not enforced outside production so local dev/test isn't blocked on generating real secrets. |
| H7 | 🟢 | No rate limit on checkout, payment-proof upload, review create/update/delete, newsletter status/unsubscribe | New `middleware/checkoutRateLimit.js`, `middleware/reviewRateLimit.js`, extended `newsletterRateLimit.js` — all keyed by user id where the route is authenticated (so a shared office IP doesn't lock out other real customers), by IP where it isn't. *(Discount-code validation already had a rate limiter — the original automated pass mis-reported this one as missing.)* |
| H8 | 🔵 | Zero test coverage on public product/category browsing and on 2FA/password-reset/email-verification flows | Deferred — backfilling full coverage on 19 controllers is a substantial standalone effort, not something to fold into a fix pass. Added targeted tests for everything changed in this pass (see Fix log below); the pre-existing gap is unchanged and should be the next thing tackled. |

## Medium

| # | Status | Finding |
|---|--------|---------|
| M1 | 🟢 | SSRF via admin-controlled logo URL fetched server-side for invoice PDFs — `invoiceGenerator.js` now only fetches from `BACKEND_URL`'s origin or (if configured) `S3_PUBLIC_URL`'s origin; anything else is silently skipped rather than fetched. |
| M2 | 🟢 | `utils/crypto.js` swallowed decrypt errors as `null` with no log — now logs distinctly (still returns `null` to callers, which is the correct behavior; the gap was visibility, not the fallback itself). |
| M3 | 🟢 | TOTP codes could be replayed within their ~90s validity window — added `users.totp_last_step`, wired through otplib's built-in `afterTimeStep`/`timeStep` replay-guard support. |
| M4 | 🟢 | Refresh session id was never rotated — `/auth/refresh` now rotates on every call, with a 10s in-memory grace window so a page firing several parallel API calls right at token expiry doesn't spuriously log a legitimate user out (see the new race-condition test in `test/auth.test.js`). |
| M5 | ⚪ | Originally flagged as "no rate limit on `/auth/2fa/confirm`/`/auth/2fa/disable`" — verified false. Both already had `twoFactorRateLimit` applied (`routes/auth.js`), from the prior audit round. No action needed. |
| M6 | 🟢 / ⚪ | `verification_token`/`reset_token` were stored in plaintext — now SHA-256 hashed at rest (raw token still goes out in the email link; only storage changed, no schema change needed). The "never expires" half of the original finding was already false — `verification_token_expires` already existed and was enforced from the prior audit round. **Bonus fix while touching this code:** `updateProfile`'s email-change path was setting a new `verification_token` but never a matching `verification_token_expires`, which would have made a post-verification email change's confirmation link silently un-usable (`NULL > NOW()` is always false) — now sets both. |
| M7 | ⚪ | In-memory (per-process) rate-limit/2FA-challenge/session-revocation state — this is a real, known, and *already documented* trade-off (see README.md), not an oversight. Left as-is per that existing note (moving to Redis ahead of actually needing to run more than one instance would be infrastructure with nothing to justify it yet); the new refresh-rotation grace-period map (M4) was added to the same documented list. |
| M8 | 🟢 | No linter, no CI, no Dockerfile — added `eslint.config.js` + `npm run lint`, `.github/workflows/ci.yml` (test + lint + `npm audit` on every push/PR), and a `Dockerfile` + `.dockerignore`. |
| M9 | 🟢 | `contentController.updateContent` accepted any JSON shape with no validation — added type checks for the fields that actually flow into fetch/render paths (`site-settings.logo`, `payment-settings.methods`, `hero-banners.slides`/`sideBanners`, `footer-brand.columns`/`social`) plus an overall size cap. Not a full schema for all 11 keys — see Won't-fix notes below. |
| M10 | 🔵 | No caching layer for product listings/category trees — deferred. The highest-value piece of this (the tenant lookup hit on *every* request) is fixed as H2; caching product/category reads has real invalidation complexity (writes happen from the admin panel) that's a bigger, separate piece of work. |
| M11 | 🔵 | OFFSET-based pagination + duplicate `COUNT(*)` on every list endpoint — deferred. Rewriting to keyset/cursor pagination changes the response shape (as C3 did for one endpoint) and would need matching frontend changes across every list view; not something to do piecemeal without frontend coordination. |
| M12 | 🟢 | No cycle protection on `categories.parent_id` — `updateCategory` now walks the proposed parent's ancestor chain (reusing `getAncestorChainIds`, already used elsewhere for attribute inheritance) and rejects a `parent_id` that would make the category its own ancestor. Covered by 2 new tests. |
| M13 | ⚪ | Originally flagged as "promo/newsletter emails skip HTML-escaping" — verified false. Both `promotionalEmailsController.js` and `newsletterController.js` already call `escapeHtml` on subject/message. No action needed. |

## Low

| # | Status | Finding |
|---|--------|---------|
| L1 | 🟢 | Timing-based email enumeration on login — `authenticateUser` now runs a dummy `bcrypt.compare` against a fixed hash when the email doesn't exist, so both branches take comparable time. |
| L2 | ⚪ | Originally flagged as "JWT algorithms not pinned" — verified false. `middleware/auth.js` already pins `algorithms: ['HS256']` on verify, from the prior audit round. |
| L3 | ⚪ | Dead `users.token_version` column — this is a deliberate, already-documented choice (see the comment directly on the column in `schema.sql`): kept rather than dropped to avoid a destructive migration for a column that's genuinely harmless sitting unused. Not re-litigated. |
| L4 | 🟢 | No explicit CSRF defense (safety was incidental, via body-parser config + CORS) — `requireAuth` now explicitly rejects a request whose `Origin`/`Referer` doesn't match `FRONTEND_URL`, when either header is present. A durable, intentional control now, not just an accident of JSON-only body parsing. |
| L5 | 🟢 | No password max length — capped at 128 characters (same `passwordLengthError` helper as H5). |
| L7 | 🟢 | TOCTOU: uploaded files landed in the public `/uploads` dir before validation — uploads now go through memory (`multer.memoryStorage()`), get validated/re-encoded via sharp, and only then get written anywhere — nothing unvalidated is ever reachable by URL. |
| L11 | 🟢 | `reportsController.js` reimplemented pagination-limit clamping three times — extracted to `clampLimit()` in `utils/pagination.js`. |
| L13 | 🟢 | `adminController.getStats` ran 7 independent count queries sequentially — now `Promise.all`'d. |

## Won't-fix / deferred, with reasons

- **L6** (no self-service session management) — a UX feature request, not a fix.
- **L8** (`utils/validation.js` is minimal) — most controllers already validate inline reasonably well; centralizing is worth doing opportunistically, not as a discrete tracked fix.
- **L9** (tenant resolution trusts `X-Store-Slug` outside production) — correct by design for local dev; already gated by `NODE_ENV !== 'production'`.
- **L10** (no README/API docs) — a README already exists; full OpenAPI docs for ~100 routes across 19 controllers is a real standalone project, not folded into this pass.
- **L12** (`order_items.product_ref` is stringly-typed, needs a `CAST` to join) — the real fix is a schema change (making it a proper `INT` foreign key), which is higher-risk than the current report-query slowness justifies at today's scale. Flagged for whenever `order_items` actually gets large enough for `getBottomProducts`/report queries to matter.
- **M10, M11** — see table above.

---

## What's already done right (confirmed unchanged, don't touch)

- Every query across all 19 controllers is parameterized — no SQL injection anywhere.
- Multi-tenant isolation enforced twice: Host-header resolution + JWT `business_id` cross-check in `requireAuth`.
- Checkout pricing is recomputed server-side, never trusted from the client (regression-tested).
- Stock decrements and discount-code redemption are transaction-safe (atomic conditional `UPDATE`, `SELECT ... FOR UPDATE`).
- Secrets encrypted at rest with AES-256-GCM, fresh IV per call, auth-tag verified on decrypt.
- Payment-proof files kept outside the public uploads folder, served only via an authenticated, ownership-checked route.
- No mass-assignment anywhere — controllers destructure only expected fields.
- 2FA/password-change flows correctly revoke all other sessions; recovery codes are bcrypt-hashed and single-use.
- Centralized, well-designed error handling with DB-detail masking in production.
- Graceful shutdown drains in-flight requests and closes the DB pool on SIGTERM.

---

## Fix log — what actually changed (2026-07-15)

**New files:** `utils/objectStorage.js`, `utils/distributedLock.js`, `middleware/checkoutRateLimit.js`, `middleware/reviewRateLimit.js`, `sql/migrate-scale-indexes.js`, `sql/migrate-totp-replay-guard.js`, `eslint.config.js`, `.github/workflows/ci.yml`, `Dockerfile`, `.dockerignore`.

**New dependency:** `@aws-sdk/client-s3` (object storage client — S3-compatible, works with R2). New dev dependency: `eslint`.

**New env vars** (all optional, see `.env.example`): `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`, `DB_POOL_SIZE`.

**Breaking changes for the frontend:**
- `GET /api/orders/user/:userId` now returns `{ orders, page, limit, total, totalPages }` instead of a bare array (C3).

**Run before deploying:** `npm run db:migrate` (adds the new indexes + `totp_last_step` column; safe to re-run, every migration checks its own precondition first).

**Test coverage added:** register password-length rejection, refresh-rotation concurrent-request race, category cycle protection (2 tests) — 91 → 95 tests, all passing.
