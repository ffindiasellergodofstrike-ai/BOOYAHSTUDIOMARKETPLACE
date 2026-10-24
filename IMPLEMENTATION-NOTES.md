# Implementation notes — 23 October 2026

The supplied Pagecraft project now includes the requested Supabase email/password flow, Cashfree checkout and Resend order-email tracking. Read `SETUP-HINDI.md` before configuring deployment. The owner release contains source and private product packages. This public repository update publishes app/setup code without the new owner-only ZIP binaries; it does not activate external accounts.

The latest update adds the password-protected operational admin console and GitHub/Vercel deployment fixes described in `ADMIN-GUIDE-HINDI.md` and `VERCEL-DEPLOYMENT-CHECK.md`.

## Preserved

The original catalog, product prices, branding, shared styles, screenshots, demos, templates, original product archives and storefront content are unchanged. Authentication, checkout/account status, related admin controls, payment/refund/privacy wording and setup documentation have scoped changes. `docs/verification/change-manifest.json` records hashes and changes against the uploaded `pagecraft.zip`.

The owner release contains 25 files in `private-product-uploads/`, intentionally excluded from this public repository update. These are prepared upload copies: five original product ZIPs and twenty packages generated from the preserved templates. Upload them to the private `products` bucket using the manifest filenames. Keep this owner project and all paid sources private. An older project archive already present in the original upload is retained as historical material; deploy the current top-level source.

## Implemented behavior

- Signup, email confirmation/resend, email/password login and password recovery use Supabase Auth. A phone number is contact information; mobile OTP is not required. Recovery opens the existing forgot-password page, verifies the token when submitting the new password and invalidates previous app sessions. Auth redirects stay within allowed site routes.
- Cashfree is preferred when configured. The server calculates prices, checks private files before checkout and binds each provider order to its buyer and environment. The browser return never authorizes delivery. Raw signed webhooks and authenticated reconciliation fetch authoritative order, payment and refund state.
- A provider snapshot applies payments and refunds within one SQL transaction. A missing refund response or invalid refund cannot leave a newly granted paid entitlement. Replay, concurrent callbacks, wrong amounts/references and sandbox transactions are covered. Only verified live purchases unlock expiring protected downloads.
- Full funding refunds revoke future access. A partial refund retains unaffected access and records an allocation-review task; an admin records exact item amounts and a review reason. Fully refunded items are restricted. Refunding a duplicate payment does not cancel the original purchase. This app does not automatically decide or initiate refunds.
- Resend order/refund emails use durable claims, stable payloads/idempotency and retry backoff. Signed Resend events distinguish API acceptance from delivery/bounce/complaint. A protected scheduled worker rotates Cashfree reconciliation and recovers due or missing email jobs. Email problems do not erase a valid purchase.
- Cashfree dispute webhooks fetch the current provider case and bind it to a known payment. Admin can refresh a case, review an evidence PDF and explicitly submit reviewed evidence before the provider deadline. Download authorization is recorded honestly as authorization, without claiming completed receipt. Risk ratios show their actual denominators; they are not asserted to be Cashfree limits.
- Existing verified Razorpay support is retained. Retired PayU/Paddle/Easebuzz routes cannot fulfill purchases. Five obsolete route suites were replaced by a retired-gateway security regression suite; legacy helper tests remain.
- The new migration adds service-role-only Cashfree references and operations while preserving existing stored records. Fresh installs run the complete schema; upgrades apply the baseline and then the Cashfree migration as documented.

## Verification

Environment: Node 24.19.0; project dependencies installed from the supplied lockfile.

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 129 tests, 0 failed, 0 skipped |
| `npm run build` | PASS: client assets, 36 public canonical page metadata outputs and server bundle |
| `node --import tsx scripts/check-built-catalog.ts` | PASS: 25 products, 80 new demo pages, four canonical policies and private-source boundaries |
| Product package checksums / ZIP CRC | Checked during final packaging; see `docs/verification/current-results.txt` |
| Catalog, design assets and original source archive preservation | Compared byte for byte against the upload; see change manifest |
| Chromium admin smoke | PASS: 11 checks using the actual built React UI and synthetic API responses; see `docs/verification/admin-browser-results.json` |

The tests execute actual SQL in local PostgreSQL-compatible PGlite and simulated Cashfree/Supabase/Resend HTTP responses. They cover refund rollback, duplicate concurrent events, ownership, rejected signatures, test isolation, reviewed partial refunds, auth recovery, email ordering and retired gateway denial. They did not send a real email, make a real payment, connect to the owner's Supabase project or submit a real dispute. Build retains the existing large JavaScript chunk warning; no unrelated performance redesign was made.

## Admin and Vercel update

- `/admin` has a real email/password form using Supabase Auth; the server checks the administrator role on every admin endpoint. Expired sessions, customer denial and network failures show clear states instead of redirecting silently to home. No default password or client-side bypass is provided.
- The console manages products and private ZIPs, orders, customers, coupons, support requests, subscriber status, download authorizations and audit records. Orders expose payment, account access, email provider status, timeline, access review and verified refund/dispute controls. Visible pages poll every 30 seconds and have manual refresh/retry.
- Failed sections retain earlier records with an error state. The dashboard uses the correct stats response shape; verified access labels agree with download permission checks. A manual email retry honors existing idempotency/backoff and never blindly resends accepted mail.
- Private ZIP bytes upload directly to a staged private Supabase object (up to 50 MiB). Publishing checks exact size and ZIP signature, requires a review/reason, rejects stale replacements, and preserves the former object in a private backup. Full archive/malware validation is not claimed. Expired staging objects and backups need owner review/cleanup. Support/subscriber/download history responses are bounded to 1,000 latest records; stored orders remain available in Orders.
- Vercel receives explicit install/framework configuration, API routing before SPA fallback, generated HTML file tracing, function budgets and deployment exclusions for private owner files. Dynamic categories and policy aliases reach the SPA rather than a missing static file. SDK requests are bounded by a timeout; malformed/oversized requests return safe JSON errors with references.
- API-proxied image/evidence uploads are capped at 4 MB for the Vercel payload limit. Larger dispute evidence must use the provider dashboard. Secrets, DNS, SMTP and merchant activation remain in their respective dashboards; the admin Settings view reports configuration without exposing key values.
- The actual Chromium UI passed anonymous login, customer denial, owner access, paid/pending/email states, detail records, partial API-outage recovery, retry, support/settings navigation and logout, with zero uncaught JavaScript errors. This used synthetic API responses; deployed Vercel and live provider behavior still need owner configuration and verification.

## Configuration still required

Configure the owner's Supabase schema/Auth redirects/recovery template/private storage, verified Resend domain and SMTP/API/webhook settings, Cashfree account/domain approval and matching sandbox/live keys, and a protected scheduler. Set the owner admin role using the documented SQL. Run a real signup/recovery/inbox test and a controlled purchase/download/refund test after deployment. No live credentials or account access were provided here.

Cashfree decides merchant approval, dispute outcomes, risk limits and settlement holds. These changes provide verified records and reviewed evidence; they cannot guarantee approval, prevent all disputes or guarantee settlement release. No automatic acceptance, arbitration or refund action is enabled.

`FINAL-AUDIT.md` and `VALIDATION.md` preserve historical reports from the uploaded project. This document and `SETUP-HINDI.md` describe the current implementation.

## GitHub update validation

The update is based on main commit `20dff7772c0a15f5e596888f495d237a37bb93a8` and preserves its generated Node-compatible API bundle and automatic native startup check. The merged source passed all 129 tests, TypeScript, production build including native API/registration/webhook checks, catalog checks and `git diff --check`. See `docs/verification/github-update.json`. New owner-only paid ZIP binaries were excluded from the public repository update. Existing remote product/design files were preserved. Live Vercel/Supabase/Cashfree/Resend account verification is still external configuration.
