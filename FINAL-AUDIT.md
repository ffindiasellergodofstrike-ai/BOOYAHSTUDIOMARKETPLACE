# FINAL AUDIT — Booyahstudio

> Historical report from the supplied project (5 October 2026). Current implementation and verification are documented in IMPLEMENTATION-NOTES.md and SETUP-HINDI.md. The later native Vercel API startup fix is preserved; VERCEL-REGISTRATION-FIX.md records its earlier investigation. Statements below describe the historical version.

MANISH KUMAR SONKAR | Booyahstudio

Audit date: 5 October 2026. Repository: `ffindiasellergodofstrike-ai/booyahstudio`. Base revision: `9e434ad1d993c3aac1760833bf122b35d7a66ab1`.

**Result: updated source builds and passes local checks. This is not a claim of a tested production deployment or real successful payment.** The existing integrations/catalog/policies were inspected before edits. A 656-file baseline, seven original source ZIPs, archive content scans and 66-area requirement matrix were recorded first. No project files were modified before that matrix.

The before state is the supplied current working tree (including the previous implementation), not a clean checkout of the historical Git commit. Changes below are from this audit follow-up. Existing legitimate product files and the React/Vite + Express architecture are retained. Supabase remains Auth/data/storage; Razorpay is the only active gateway; Resend remains transactional email.

## SECTION 1 — REQUIREMENT STATUS

Before counts: IMPLEMENTED: 34, INCORRECT: 6, PARTIALLY IMPLEMENTED: 21, MISSING: 2, NEEDS CONFIGURATION: 3.

After: 63 areas have implementations/preserved working code; 3 areas remain NEEDS CONFIGURATION. “IMPLEMENTED” describes the source and stated local coverage, not successful operation against unconfigured production services. Operational prerequisites apply to all affected features.

| Requirement | Status BEFORE | Status AFTER | Files changed / existing implementation | Notes |
|---|---|---|---|---|
| Preserve existing framework, legitimate catalog and original files | IMPLEMENTED | IMPLEMENTED | package.json; src/data; templates; demofiles | Preserved; React/Vite + existing Express Vercel adapter; 25 active products; seven original archives. |
| Single seller, digital goods only, no physical fulfilment | IMPLEMENTED | IMPLEMENTED | src/data; server/app.ts; src/config/business.ts | Preserved; Direct merchant checkout; account ZIP delivery. |
| Remove retired payment gateway everywhere | IMPLEMENTED | IMPLEMENTED | Entire source and seven archive-content scans | Recheck final archive. See detailed sections for actual coverage and limitations. |
| Accurate name, GST, owner, address, support | INCORRECT | IMPLEMENTED | src/config/business.ts; src/pages/AboutPage.tsx; src/seo/seoMetadata.ts | Correct to Varanasi. See detailed sections for actual coverage and limitations. |
| Server priced order and product snapshot | IMPLEMENTED | IMPLEMENTED | server/app.ts | Bound checkout fields and rate limit order creation. See detailed sections for actual coverage and limitations. |
| Razorpay order creation and policy consent | IMPLEMENTED | IMPLEMENTED | server/razorpay.ts | Add atomic lifecycle record. See detailed sections for actual coverage and limitations. |
| Server signature and current captured payment verification | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/razorpay.ts | Reject mismatches explicitly. See detailed sections for actual coverage and limitations. |
| Webhook raw signature and idempotent delivery | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/razorpay.ts; supabase/schema.sql | Store safe event identifiers and timestamps atomically. See detailed sections for actual coverage and limitations. |
| Failed payment and pending/authorised payment | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/razorpay.ts | Record trusted attempt states without blocking later captured retry. See detailed sections for actual coverage and limitations. |
| Cancelled browser checkout | PARTIALLY IMPLEMENTED | IMPLEMENTED | src/pages/CheckoutPage.tsx | Record customer-reported closure separately from financial state. See detailed sections for actual coverage and limitations. |
| Duplicate captured payments and refunds | INCORRECT | IMPLEMENTED | supabase/schema.sql | Retain each payment; flag duplicate for review; refund only affects its payment. See detailed sections for actual coverage and limitations. |
| Payment/order/amount/currency/environment mismatch | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/razorpay.ts; supabase/schema.sql | Strict required fields and payment binding; negative tests. See detailed sections for actual coverage and limitations. |
| Atomic access after verified payment only | IMPLEMENTED | IMPLEMENTED | supabase/schema.sql; server/paymentAccess.ts | Preserve and expand tests. See detailed sections for actual coverage and limitations. |
| Refund processing and reconciliation | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/razorpay.ts; supabase/schema.sql | Persist processed totals/history; transactional refund email. See detailed sections for actual coverage and limitations. |
| Chargeback events and safe access rules | MISSING | IMPLEMENTED | server/razorpay.ts | Verified dispute events, no automatic guilt/revocation for open dispute; lost dispute restricts access. See detailed sections for actual coverage and limitations. |
| Authenticated owner-only downloads | IMPLEMENTED | IMPLEMENTED | server/downloads.ts; server/paymentAccess.ts | Preserve and test A–I boundaries. See detailed sections for actual coverage and limitations. |
| Private paid storage, no permanent public URLs | INCORRECT | IMPLEMENTED | supabase/schema.sql | Force products bucket private, inspect public storage policies before launch. See detailed sections for actual coverage and limitations. |
| Download authorization and accurate access records | IMPLEMENTED | IMPLEMENTED | server/downloads.ts; policies/download-records | Preserve honest records; do not invent completed downloads; document provider-log boundary. See detailed sections for actual coverage and limitations. |
| Supabase signup/email confirmation | IMPLEMENTED | IMPLEMENTED | server/auth.ts; src/pages/RegisterPage.tsx | Correct hint; add HTTP auth simulations. See detailed sections for actual coverage and limitations. |
| Supabase login and session persistence | IMPLEMENTED | IMPLEMENTED | server/auth.ts | Document separate app-session scope. See detailed sections for actual coverage and limitations. |
| Logout | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/app.ts; src/services/AuthService.ts | Report failure and allow retry; clear browser state on success. See detailed sections for actual coverage and limitations. |
| Supabase forgot/reset password and session invalidation | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/auth.ts | Invalidate after update too; bind session age to auth request start. See detailed sections for actual coverage and limitations. |
| Account blocking and protected admin/user routes | INCORRECT | IMPLEMENTED | server/adminRoutes.ts; server/auth.ts | Unify blocking, validate admin updates; expose reviewable suspend/restore. See detailed sections for actual coverage and limitations. |
| RLS customer isolation profiles/orders/payments/logs | IMPLEMENTED | IMPLEMENTED | supabase/schema.sql | Retest SQL roles and preserve schema. See detailed sections for actual coverage and limitations. |
| Supabase migrations and credentials | NEEDS CONFIGURATION | NEEDS CONFIGURATION | supabase/schema.sql; .env.example | Owner project credentials/deployed RLS not available. Add idempotent upgrade SQL and exact migration steps. |
| Resend server-only transactional email | IMPLEMENTED | IMPLEMENTED | server/orderEmail.ts | Preserve plus configured-only refunds. See detailed sections for actual coverage and limitations. |
| Email concurrency and state | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/orderEmail.ts; supabase/schema.sql | Atomic email claim/status, stable content and retry lease. See detailed sections for actual coverage and limitations. |
| Resend real sender, SMTP and inbox | NEEDS CONFIGURATION | NEEDS CONFIGURATION | DEPLOYMENT.md | Real credentials/domain/inbox unavailable. Document and test local emulator only. |
| Order/payment/access transaction trail | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/audit.ts; supabase/schema.sql | Atomic safe lifecycle/events, admin evidence export. See detailed sections for actual coverage and limitations. |
| No card secrets/passwords stored in evidence | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/audit.ts | Allowlisted provider fields; add OTP/PIN redaction. See detailed sections for actual coverage and limitations. |
| Fraud prevention, throttling and manual review | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/app.ts; downloads.ts; adminRoutes.ts; policies/fraud | Repair controls, retain safe suspicious/mismatch events; manual decisions. See detailed sections for actual coverage and limitations. |
| Dispute evidence export and minimisation | MISSING | IMPLEMENTED | server/adminRoutes.ts | Admin-only allowlisted JSON evidence, no raw tokens or unrelated customer data. See detailed sections for actual coverage and limitations. |
| Policy: terms | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/terms.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: refund | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/refund.md | UPDATED to match refund/dispute access handling. |
| Policy: delivery | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/delivery.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: fraud | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/fraud.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: chargebacks | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/chargebacks.md | UPDATED to match refund/dispute access handling. |
| Policy: license | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/license.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: copyright | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/copyright.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: acceptable-use | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/acceptable-use.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: account-security | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/account-security.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: payments | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/payments.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: product-requirements | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/product-requirements.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: download-records | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/download-records.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: duplicate-payments | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/duplicate-payments.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: privacy | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/privacy.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: grievance | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/grievance.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: disclaimer | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/disclaimer.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: updates | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/updates.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: purchase | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/purchase.md | IMPLEMENTED already; preserved substantive text and supplied identity. |
| Policy: cancellation | IMPLEMENTED | IMPLEMENTED | src/data/policies.json; docs/policies/cancellation.md | UPDATED to match refund/dispute access handling. |
| License and third-party rights, legitimate project use | IMPLEMENTED | IMPLEMENTED | templates/*/LICENSE.txt; product listings; policies/license | Preserve licenses and product data. See detailed sections for actual coverage and limitations. |
| Environment names and secret separation | PARTIALLY IMPLEMENTED | IMPLEMENTED | .env.example; server/adminRoutes.ts | Remove dead variable; validate server origin; document exact names. See detailed sections for actual coverage and limitations. |
| Vercel routes and deployment suitability | PARTIALLY IMPLEMENTED | IMPLEMENTED | api/index.ts; vercel.json; scripts/generate-product-pages.ts | Route generated static pages and private noindex headers; remote deployment manual. See detailed sections for actual coverage and limitations. |
| SEO title/description/canonical/OG/Twitter/schema | PARTIALLY IMPLEMENTED | IMPLEMENTED | src/seo/seoMetadata.ts; SEOHead.tsx | Fix identity, noindex and missing-route handling. See detailed sections for actual coverage and limitations. |
| SEO robots/sitemap/private exclusions | PARTIALLY IMPLEMENTED | IMPLEMENTED | scripts/generate-product-pages.ts; server/app.ts; vercel.json | Exclude private/search URLs; add headers and private static metadata. See detailed sections for actual coverage and limitations. |
| Semantic navigation, forms, alt text | PARTIALLY IMPLEMENTED | IMPLEMENTED | src/components; src/pages | Associate login/register labels; preserve styling. See detailed sections for actual coverage and limitations. |
| Responsive desktop/tablet/mobile | IMPLEMENTED | IMPLEMENTED | src/index.css; responsive pages | Run shared Chromium checks; no universal claim. See detailed sections for actual coverage and limitations. |
| Chrome/Edge/Firefox/Safari practical verification | NEEDS CONFIGURATION | NEEDS CONFIGURATION | VALIDATION.md | Other browser engines/physical devices not available. Record untested browsers and owner checklist. |
| Admin products complete listing fields | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/adminRoutes.ts; AdminProductsView.tsx | Preserve fields, add editable requirements/license/included files and publish validation. See detailed sections for actual coverage and limitations. |
| Admin downloads/settings truthful UI | INCORRECT | IMPLEMENTED | src/pages/AdminPage.tsx | Use actual order access view and configuration guidance. See detailed sections for actual coverage and limitations. |
| Admin coupons and checkout consistency | INCORRECT | IMPLEMENTED | server/adminRoutes.ts; src/services/CartService.ts; server/app.ts | Use server coupon validation; remove unsupported limited-use fields. See detailed sections for actual coverage and limitations. |
| Install, build, typecheck and tests | IMPLEMENTED | IMPLEMENTED | package.json; pnpm-lock.yaml; *.test.ts | Use declared pnpm; run all after shared backend changes. See detailed sections for actual coverage and limitations. |
| Security tests A–I and API/auth/error paths | PARTIALLY IMPLEMENTED | IMPLEMENTED | server/flow.test.ts; database.test.ts; razorpay.test.ts | Expand meaningful simulated-provider HTTP/SQL tests; no live-payment claim. See detailed sections for actual coverage and limitations. |
| Complete setup documentation and final comparison report | PARTIALLY IMPLEMENTED | IMPLEMENTED | README.md; DEPLOYMENT.md; START-HERE-HINDI.md | Create report with all ten sections and exact manual gates. See detailed sections for actual coverage and limitations. |
| Secret-free complete updated project ZIP | PARTIALLY IMPLEMENTED | IMPLEMENTED | Previous output archives | New zip with source, report, migrations, env example, private upload files; verify CRC/secrets. See detailed sections for actual coverage and limitations. |

### Changes in this audit follow-up

Changed: **41** existing files; added: **6**; removed: **0**. No product source file or original archive was removed. Build/dependency folders are excluded from delivery; they are generated during setup.

Changed files:

- `.env.example`
- `DEPLOYMENT.md`
- `README.md`
- `START-HERE-HINDI.md`
- `VALIDATION.md`
- `docs/policies/cancellation.md`
- `docs/policies/chargebacks.md`
- `docs/policies/refund.md`
- `scripts/check-built-catalog.ts`
- `scripts/generate-product-pages.ts`
- `server/adminRoutes.ts`
- `server/app.ts`
- `server/audit.ts`
- `server/auth.ts`
- `server/database.test.ts`
- `server/flow.test.ts`
- `server/orderEmail.ts`
- `server/razorpay.ts`
- `server/seoMiddleware.ts`
- `server/store.ts`
- `server/templateCollection.test.ts`
- `src/App.tsx`
- `src/components/SEOHead.tsx`
- `src/components/admin/AdminCouponsView.tsx`
- `src/components/admin/AdminCustomersView.tsx`
- `src/components/admin/AdminOrdersView.tsx`
- `src/components/admin/AdminProductsView.tsx`
- `src/context/AppContext.tsx`
- `src/data/policies.json`
- `src/pages/AboutPage.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/CheckoutPage.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/RegisterPage.tsx`
- `src/seo/seoMetadata.ts`
- `src/services/AuthService.ts`
- `src/services/CartPersistence.test.ts`
- `src/services/PaymentVerification.ts`
- `src/services/ProductService.ts`
- `supabase/schema.sql`
- `vercel.json`

Added files:

- `FINAL-AUDIT.md`
- `api/page.ts`
- `server/config.ts`
- `server/policies.ts`
- `server/seo.test.ts`
- `supabase/migrations/20261005_payment_security.sql`

Removed files: None.

## SECTION 2 — PAYMENT

### Order creation and verification

`POST /api/orders/create` (also `/api/user/orders`) reads server catalog prices, validates product membership/quantity and the account email, bounds customer details, stores the listing snapshot and creates a pending order. Admin coupons are now used by both public catalog display and server calculation; invalid/expired discounts cannot silently change the charged total.

`POST /api/payments/razorpay/initiate` requires authentication/ownership and explicit policy acceptance, checks each private product object exists, creates a Razorpay order with the server INR amount, and atomically binds it. The accepted content-derived policy version and complete documents are retained. Concurrent initiations may leave an unused provider order, but only one bound order is returned/accepted; no duplicate local purchase is created.

`POST /api/payments/razorpay/verify` validates the checkout HMAC using the stored provider order ID and fetches current provider state. Payment ID, order, amount, currency, environment and captured state are checked. Client prices, screenshots and “success” messages cannot grant access. Created/authorised/failed attempts are retained without fulfilment. A later captured retry can still complete the pending order.

### Webhook and duplicate handling

Endpoint: **`POST /api/payments/razorpay/webhook`**. URL for the repository's current domain: **`https://www.booyahstudio.shop/api/payments/razorpay/webhook`**. Replace the domain only if your real domain differs.

Raw request bytes are used for HMAC validation. Invalid signatures return400. Trusted notifications fetch current provider payment state; events are recorded using a hashed event identifier/body fingerprint. Fulfilment is atomic under a PostgreSQL row lock with deterministic order/product entitlement IDs. Repeated delivery does not create duplicate orders/access. A separate captured payment ID is retained and flagged for duplicate-payment review. Refund of that separate duplicate does not revoke access funded by the primary payment.

Subscribe to: `payment.captured`, `payment.authorized`, `payment.failed`, `order.paid`, `refund.processed`, `payment.dispute.created`, `payment.dispute.won`, `payment.dispute.lost`, `payment.dispute.closed`, `payment.dispute.under_review`, `payment.dispute.action_required`.

Checkout dismissal is recorded through `/api/payments/razorpay/checkout-closed` as customer-browser information. It is never treated as proof that a debit was cancelled. `/api/payments/razorpay/reconcile/:orderId` fetches attempts and known disputes for the owner/admin.

### Refunds, disputes and evidence

The merchant reviews and initiates refunds in Razorpay Dashboard. The website does not invent approval decisions or automatically initiate a refund. Confirmed refunds/partial refunds on the primary payment restrict new download links and maintain history; support reviews the agreed resolution. Refunding a duplicate is isolated from the original paid entitlement. No frontend/admin route can mark an unpaid order paid.

Dispute notifications fetch `GET /v1/disputes/{id}` and retain an allowlist of references, amount/currency, status, reason and response deadline. An open dispute does not automatically accuse the customer or revoke access. A verified lost dispute on the primary payment restricts access. Later won/closed cases require reconciliation and explicit admin restoration with a reason; unpaid/refunded orders and unresolved disputes cannot use this restoration route.

Admin → Orders provides **Download dispute evidence** (`GET /api/admin/orders/:id/evidence`). It includes the relevant order/listing/policy snapshot, payment history, verification/access times, dispute records, refund total/history, email status and download authorisations. Review/redact it and add necessary support correspondence manually. No raw gateway payload, card authentication details, secrets or unrelated account records are included. The export is not automatically submitted to Razorpay.

A signed link being issued is not proof of completed receipt. The application does not observe all bytes delivered directly by Storage, whether a file was saved/opened, or whether an email was read. It deliberately does not fabricate download-start/completed evidence. Actual provider Storage logs may supplement a legitimate case where available.

## SECTION 3 — SUPABASE

- Signup, email/password login, confirmation and recovery use Supabase Auth. There is no alternate password database or plaintext-password storage.
- The existing opaque store-session wrapper remains: randomly generated cookie, hashed server record, HttpOnly, SameSite Lax, Secure in production, expiry and profile cutoff checks. Server authorization checks profile/account ownership and admin role.
- `/api/auth/forgot-password` requests a Supabase recovery email; `/api/auth/reset-password` requires a valid recovery token before updating the password. Session cutoffs before/after update and authentication-start timestamps prevent an overlapping old-password login from producing a valid new store session.
- Logout reports server failure honestly instead of claiming success. Suspend/restore now uses the same fields checked by login and session validation, and invalidates previous sessions.
- Provider-dashboard token revocation alone does not invalidate an existing opaque store cookie. For a provider-dashboard ban/password action, also suspend the store profile or set `sessionValidAfter`. This operational boundary is documented.
- `store_state` has RLS and no direct grants to anon/authenticated. The security-definer RPC has a fixed search path and execute permission only for service_role. Every user API obtains the identity from the verified cookie, not a submitted user ID.
- The private `products` bucket is forced private on upgrade. A restrictive `storage.objects` policy prevents direct paid-object access by browser roles even if an older broad policy permits other buckets. Only server service-role code signs links.
- Downloads require the authenticated order owner, a live verified paid order, active delivery, and purchased product membership. URLs expire after60seconds; requests are limited to20 per account/product/hour. Links are bearer links valid until expiry, not single-use links; revoke/suspend prevents new links but cannot instantly cancel an already issued link.
- Schema for new installations: `supabase/schema.sql`. Existing installations: backup then run `supabase/migrations/20261005_payment_security.sql`. Upgrade preserves existing records and synchronises entitlement restriction state. Both were executed locally in PostgreSQL-compatible PGlite; actual hosted deployment/RLS must still be checked.
- Existing single-row JSON architecture is retained. Writes serialize; monitor growth/latency and backups. Large-scale per-entity migration is a separate project, not silently introduced here.

## SECTION 4 — RESEND

`server/orderEmail.ts` uses the server Resend SDK for verified order/test notices and primary-payment refund notices. No paid-order email is sent for a browser success event or unverified/pending order. Messages link to the signed-in account, never a permanent paid ZIP URL.

Atomic notification claims prevent concurrent sends. Stable provider idempotency keys and a bounded retry window avoid blind duplicates; after23hours from the first attempt, automatic retries require manual inspection. A failed notification does not remove paid access. Provider acceptance/ID is recorded; inbox receipt and reading are not claimed.

Set `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL`. Separately configure **Supabase custom SMTP** using the Resend dashboard settings for confirmation/recovery emails. The application API key alone does not configure Auth email. Support remains the supplied Gmail/WhatsApp contacts; do not assume Gmail is an authorised Resend sender.

Local verification used the actual Resend SDK with the pinned CodeRabbit emulator release v0.0.1 and actual local SQL: three notifications accepted (order/test/refund), concurrent duplicate attempts suppressed, unpaid notification suppressed. No real customer email was sent; real sender/DNS/SMTP/inbox checks remain manual.

## SECTION 5 — POLICIES

All18 requested policy topics already existed in19 complete pages. The additional cancellation URL is retained for compatibility. Source: `src/data/policies.json`; copy-ready publication text: `docs/policies/`; website: `/policies/<slug>`. Every page starts its identity section with the supplied owner/trade/store names and includes GST/address/support/grievance details.

| Policy | Result |
|---|---|
| Terms & Conditions | IMPLEMENTED, preserved |
| Refund & Cancellation | UPDATED: precise partial/duplicate refund access handling and configured email |
| Digital Product Delivery | IMPLEMENTED, preserved |
| Fraud Prevention & Transaction Security | IMPLEMENTED, preserved |
| Chargeback & Payment Dispute | UPDATED: open/lost disputes and reviewable access handling |
| Digital Product License & Usage | IMPLEMENTED, preserved |
| Copyright & Intellectual Property | IMPLEMENTED, preserved |
| Acceptable Use | IMPLEMENTED, preserved |
| Account Security & Access | IMPLEMENTED, preserved |
| Order, Payment & Transaction | IMPLEMENTED, preserved |
| Product Description & Technical Requirements | IMPLEMENTED, preserved |
| Download, Access & Delivery Record | IMPLEMENTED, preserved |
| Duplicate Payment & Payment Error | IMPLEMENTED, preserved |
| Privacy / Data Handling | IMPLEMENTED, preserved |
| Customer Support & Grievance Redressal | IMPLEMENTED, preserved |
| Disclaimer & Limitation of Liability | IMPLEMENTED, preserved |
| Policy Updates / Modifications | IMPLEMENTED, preserved |
| Consolidated Digital Goods Purchase Policy | IMPLEMENTED, preserved |
| Separate cancellation compatibility page | UPDATED consistently with refund page |

Consistency check: refund exceptions and mandatory rights remain consistent across terms/refund/cancellation/disputes; chargebacks are not prohibited; no guaranteed bank/provider outcome; account/private-link delivery matches code; privacy describes actual Supabase/Resend/Razorpay/Vercel data, cookies, optional newsletter and support processing; no invented completed-download/read evidence; actual product licenses and third-party rights remain intact; no physical fulfilment workflow or unrelated catalog was introduced. No fixed invented tax rate, support SLA or refund-credit deadline is asserted.

## SECTION 6 — SECURITY AND VERIFICATION

| Check performed | Result / boundary |
|---|---|
| `pnpm install --frozen-lockfile` | PASS, exact declared manager. npm was not used; no second lockfile. |
| `pnpm typecheck` | PASS. Earlier fixture typing error corrected and rerun. |
| `pnpm test` | PASS28/28, expanded assertions in HTTP and SQL scenarios. |
| `pnpm build` | PASS, production assets and server bundle. Existing main-chunk warning (~758kB before gzip) remains. |
| `pnpm exec tsx scripts/check-built-catalog.ts` | PASS25 product pages/assets,80 template demo pages,19 readable policy pages,51 public sitemap URLs and private source exclusions. |
| Test A: verified paid → order/access/download | PASS simulated Razorpay/Storage HTTP responses + real local SQL. No actual money moved. |
| Test B: forged frontend/signature | PASS denied, no access. |
| Test C: pending/authorised payment | PASS no access. Failed attempt and browser closure also remain unfulfilled. |
| Test D: repeated webhook/concurrent fulfilment | PASS one entitlement and stable event history. |
| Test E: another customer downloads | PASS403. |
| Test F: unauthenticated download | PASS401. |
| Test G: invalid webhook signature | PASS400. |
| Test H: wrong payment/order/amount/currency/capture/product | PASS mismatch rejected or access denied. |
| Test I: refund/chargeback | PASS primary refund/lost dispute restricts access; duplicate refund preserves primary; late capture cannot restore; manual restoration gated. |
| Supabase Auth routes | Signup/confirmation gate, login/cookie, logout, suspension, forgot/recovery and invalid token cases passed with synthetic Auth responses. Real hosted email flow remains untested. |
| Database/storage security | anon/authenticated table/RPC denial and restrictive paid-object policy passed even with broad old permissive policy. Upgrade reapplied to an initially public bucket and made it private. |
| Email | Real SDK/local emulator + actual SQL passed3 notifications, concurrency deduplication and unpaid suppression. |
| Shared Chromium | PASS97 route/viewport combinations:61 desktop routes;18 layouts each at390px and768px; no overflow or broken loaded images; private/missing pages noindex. |
| Source/package checks | Retired-provider scan, original ZIP CRC, secret-pattern/config review, policy copies, and `git diff --check`; final ZIP packaging integrity results are recorded alongside the delivered archive. |

No credentials were supplied for real Razorpay payment/refund, hosted Supabase/Auth/Storage, real Resend inbox or deployed Vercel. These are **BLOCKED pending owner configuration**, not passed. Expiry is requested from the Storage signing API; an actual hosted expired-link test remains manual. Chromium does not establish Firefox, Safari/WebKit, branded Edge or every physical-device compatibility. Those were not run.

## SECTION 7 — SEO

Corrected the old city to Varanasi. Retained page titles/descriptions/canonical URLs, Open Graph/Twitter metadata, product/organisation/breadcrumb structured data and image text. Private/search/missing routes now use noindex; API/private Vercel headers reinforce it. Search is excluded from the sitemap;51 public source-catalog URLs remain. Private-route HTML shells are generated but never placed in the public sitemap.

The product serverless page reads current catalog data, so admin product additions and price/title edits can render current metadata. JSON-LD escapes script delimiters; client navigation removes stale structured data. Static pages/category routes now resolve to their generated metadata pages on Vercel. Login/register labels are associated with fields, the incorrect password-length hint is corrected, and admin action wrapping supports narrow layouts.

The generated sitemap covers source-controlled products; add permanent admin-created products to the source catalog and rebuild for sitemap inclusion. Confirm the final domain matches `src/config/business.ts`, metadata, APP_URL, Auth redirects and webhook settings. Actual Vercel edge routing remains a deployment check.

## SECTION 8 — ENVIRONMENT VARIABLES

No secret values appear in this report or `.env.example`. No VITE client variable is required.

| Variable | Purpose | Client or server | Where to configure |
|---|---|---|---|
| APP_URL | Trusted absolute site origin for Auth/email/CSRF | Server, non-secret | Vercel environment; `.env` locally |
| SUPABASE_URL | Project endpoint | Server, non-secret | Vercel environment from Supabase API settings |
| SUPABASE_ANON_KEY | Supabase Auth client | Used server-side; public-safe key | Vercel environment |
| SUPABASE_SERVICE_ROLE_KEY | Private database/storage operations | Server-only secret | Vercel environment; never VITE/public files |
| RAZORPAY_KEY_ID | Provider account/mode | Server config; returned to checkout as required | Vercel environment |
| RAZORPAY_KEY_SECRET | Provider API + checkout signature | Server-only secret | Vercel environment |
| RAZORPAY_WEBHOOK_SECRET | Raw webhook authentication | Server-only secret | Matching Vercel and Razorpay webhook settings |
| RESEND_API_KEY | Transactional sending | Server-only secret | Vercel environment |
| RESEND_FROM_EMAIL | Verified sender address | Server configuration | Vercel environment after domain verification |

Vercel supplies runtime NODE_ENV/platform variables. PORT is optional for local startup. RESEND_BASE_URL was used only by the local test process to target the emulator; do not set it in production. Supabase SMTP settings live in the Supabase dashboard, not in frontend variables.

## SECTION 9 — VERCEL DEPLOYMENT: EXACT OWNER STEPS

1. **Push project to a PRIVATE GitHub repository.** The complete owner project contains paid product sources; a public repository would disclose them. Never publish the owner ZIP as a site asset. Extract the ZIP; use `booyahstudio/` as repository root (contains package.json). Preserve all source/config/SQL/docs. Do not commit `.env`, customer records, dependencies or build output. Keep the supplied pnpm lockfile. This task did not push or deploy anything.
2. **Import into Vercel.** Select that GitHub repository; root directory containing package.json; Node24.x; install `pnpm install --frozen-lockfile`; build `pnpm build`; output `dist`. Retain vercel.json and both API adapters.
3. **Add environment variables.** Add the nine variables above. Start with matching Razorpay Test keys and a separate test Supabase project for Preview. Never share production database/live credentials with untrusted previews. APP_URL must be your exact trusted HTTPS origin; only local development permits HTTP localhost.
4. **Deploy.** Redeploy after variables change. Configure the domain/DNS that Vercel supplies and check HTTPS, `/api/health`, public products, policy pages, direct product pages, robots and sitemap. A health response alone does not verify provider connections.
5. **Configure Razorpay webhook.** Use your HTTPS origin plus `/api/payments/razorpay/webhook`, all events in Section2, and the same webhook secret as Vercel. Configure payment capture in your merchant account. Track failed webhook deliveries.
6. **Configure Supabase Auth.** Enable email/password and email confirmation. Site URL: exact final origin. Allowed redirects: `/login` and `/forgot-password` under that origin. Recovery email link: `https://YOUR-DOMAIN/forgot-password?token_hash={{ .TokenHash }}`. Preserve the supported signup confirmation template; see DEPLOYMENT.md for the complete example.
7. **Configure Resend.** Verify your own sending domain and required DNS records; use an authorised sender/API key in Vercel. Configure Supabase custom SMTP separately with Resend dashboard settings. Send actual confirmation/recovery/transaction emails to a controlled inbox and check receipt/spam placement. Support contacts remain those supplied by the owner.
8. **Run database migration and upload files before accepting orders.** New project: schema.sql. Existing project: backup then migration SQL. Verify RLS and products bucket is private. Upload all25 matching ZIP filenames from `private-product-uploads/`. Confirm ordinary anon/authenticated direct object access fails. Register/confirm/sign in your owner account; grant its exact UUID admin through the documented SQL, never through public registration.
9. **Test Razorpay Test Mode.** Test successful capture, pending/failure, invalid signatures, retry/webhook replay and closing checkout. Test-mode payments intentionally do not unlock real paid archives or create a live purchase. Check the account/test notice honestly.
10. **Verify digital delivery.** Local automated tests verify the live-shaped flow with synthetic provider responses. For real production delivery, after merchant approval and the preceding checks, use a controlled genuine live transaction with your own authorised payment method. Confirm capture, owner access, exact ZIP,60-second expiry, cross-user denial, email, refund restriction and reconciliation. Do not claim this step complete before doing it.
11. **Enable live use only after successful checks.** Configure matching Live credentials/webhook in Production only, redeploy, perform the controlled delivery check, then make the store available to customers. Verify the supplied identity/GST and actual rights to each supplied product. The application issues payment receipts, not GST tax invoices: confirm tax classification/rate, place-of-supply and legal invoice process with your accountant; no tax rate was invented.

See **START-HERE-HINDI.md** for Hindi guidance and **DEPLOYMENT.md** for detailed copyable settings. Steps involving external accounts are manual actions; the ZIP contains no credentials and does not activate merchant/provider accounts.

## SECTION 10 — ROLLBACK / TROUBLESHOOTING

- **Checkout unavailable /503:** check matching mode keys, required environment names, Supabase RPC and each private `<product-id>.zip`. Inspect safe server errors and provider dashboard. Never bypass verification to fix availability.
- **Order pending after debit:** reconcile the recorded order/provider reference and check webhook capture delivery. An authorised, failed or browser-closed attempt is not proof of final capture/cancellation. Do not immediately create another charge.
- **Invalid webhook:** confirm the endpoint secret and exact raw JSON request bytes; ensure proxy/body middleware has not changed them. Do not replace server HMAC checks with a browser flag.
- **Database operation failed:** apply the full matching SQL/migration, check service-role settings/permissions and backups. Existing data is preserved; do not delete store_state to fix a permission problem.
- **Download403:** check signed-in owner, mode, verified paid order, purchased product, refund/dispute/revoked/account status. Reconcile first. Admin restoration requires reviewed reason and eligible paid state. Old links may remain valid until expiry.
- **Download503/expired:** ensure the correct private ZIP object exists, then request a fresh account link. Verify the actual deployed Storage policy and60-second expiry.
- **Email failure:** verify Resend domain/sender/API permissions. Supabase recovery requires its separate SMTP/template settings. Check notification records/provider IDs before retrying; old ambiguous sends are left for manual review rather than silently duplicated.
- **Recovery link invalid:** request a fresh email; confirm the TokenHash template, origin allowlist and one-time-token behavior. Knowing an email/mobile never authorises a reset. Invalidate opaque store sessions when handling a provider-dashboard account compromise.
- **Admin changes not saved:** inspect returned validation errors. Published products require actual license/requirements/included files/version/positive price. Drafts may be incomplete. Source-controlled public sitemap changes require rebuild.
- **Incorrect product metadata/404:** confirm `api/page.ts` is deployed with `dist/index.html`, route rewrites match the included configuration, and the catalog entry is published. Check Vercel function logs; do not expose source folders as public assets.
- **Performance:** the current build warns about main bundle size; monitor real loading performance. The single-row store also serialises writes; monitor database volume before scaling.
- **Rollback:** preserve database/product backups and the previous Vercel deployment. Prefer redeploying the earlier application build while retaining the compatible upgraded schema. Never restore stale paid/refund/dispute data blindly; reconcile provider records after any data restoration. Do not turn the paid bucket public or remove RLS to make a rollback appear healthy.

### Official sources used

Provider-specific behavior was checked using official documentation, including direct HTTPS retrieval when the search tool returned401:

- [Razorpay Standard Checkout verification](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
- [Webhook validation, duplicates and ordering](https://razorpay.com/docs/webhooks/validate-test/)
- [Payment webhook events](https://razorpay.com/docs/webhooks/payments/)
- [Dispute webhook payloads](https://razorpay.com/docs/webhooks/payloads/disputes/)
- [Fetch dispute API](https://razorpay.com/docs/api/disputes/fetch/)
- [Refunds](https://razorpay.com/docs/payments/refunds/), [disputes](https://razorpay.com/docs/payments/disputes/), [merchant terms](https://razorpay.com/terms/)
- [Supabase recovery templates](https://supabase.com/docs/guides/auth/auth-email-templates), [signed Storage links](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl)
- [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json)

The merchant policies remain independent of provider contracts. There is no promise of universal browser compatibility, guaranteed legal protection, payment acceptance, refund credit date or dispute outcome.


### Final archive checks

`Booyahstudio-Updated-Audited-Website.zip` contains the complete `booyahstudio/` project (662 source/config/documentation files), 25 separately prepared private product ZIPs and the Hindi guide. Packaging CRC, required-file checks, source-to-archive SHA256 comparisons, retired-provider scan, credential-pattern scan and policy-copy consistency passed. No `.env`, Git internals, dependency/build folders or customer data are included. Formatting-only blank lines in the preserved policy identity header were normalised for the consistency comparison. A separate `.sha256` file provides the final archive checksum.
