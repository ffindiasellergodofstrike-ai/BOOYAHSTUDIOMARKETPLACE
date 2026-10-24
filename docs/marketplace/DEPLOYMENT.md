# Separate marketplace deployment

This repository is a new project. Keep the existing storefront repository and production database separate until a deliberate migration. The source includes no live credentials or paid archives. Local/synthetic tests do not establish live account activation or provider approval.

## 1. Supabase

Create a separate project. Save `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` only in server environment settings. The service-role key must never be public or prefixed `VITE_`. This application uses server-managed HttpOnly sessions with Supabase email/password authentication; the customer does not need a mobile OTP.

Apply `supabase/schema.sql` first. It contains the current base financial store. Then apply the new creator, Easebuzz and subscription SQL migrations in version order from `supabase/migrations`. The older `20261005_payment_security.sql` and `202610220001_cashfree.sql` are historical upgrades already represented in the current base schema; do not apply an older function definition after a newer one. The historical `202610030001_marketplace_store.sql` is legacy document-store scaffolding, not the active marketplace persistence layer. New modules use the service-only `store_state` and dedicated atomic RPCs. Review migration names before applying; do not skip a required new RPC.

Ensure the `products` bucket is **private**. Upload each of the 25 original company archives as `<productId>.zip`; IDs come from `src/data/products.ts`. These files are intentionally excluded from GitHub and deployments. Checkout checks file availability before accepting payment. Creator ZIPs are uploaded privately, validated and approved through the marketplace workflow. Browser source URLs are never download entitlements.

Generate and securely back up a 32-byte base64 `MARKETPLACE_ENCRYPTION_KEY`. It encrypts private creator identity and payout details. Do not rotate it without a data migration. Public profiles do not expose PAN, bank accounts or private seller provider references.

In Supabase Authentication set the final Site URL and allowed redirect URLs for the new HTTPS domain. Install the email confirmation and password reset templates according to the existing `docs` authentication guides. Preserve token-hash recovery/default fragment recovery compatibility. Use verified SMTP/Resend sending configuration for auth emails. Test sign-up confirmation, login, reset from an existing account, invalid/expired link and sign-out on the new domain.

Create the owner's ordinary account, then assign its admin role server-side in the Supabase store using the owner setup guide. There is no public admin password, secret browser toggle or default admin credential. Admin access uses the same verified password login plus a server-checked admin role. Never accept a role from client metadata.

## 2. Vercel

Import `BOOYAHSTUDIOMARKETPLACE` as a separate Vercel project. Use Node 24.x and the committed pnpm lockfile. The included `vercel.json` supplies native serverless API routing, dynamic HTML/SEO routing and a daily reconciliation fallback.

Set `APP_URL=https://YOUR-FINAL-DOMAIN` and `VITE_SITE_URL=https://YOUR-FINAL-DOMAIN` to the same origin, with no path/query/fragment. `VITE_SITE_URL` is public; only public configuration belongs there. Explicit `APP_URL` controls trusted checkout, email and recovery redirects. Vercel deployment host values are a trusted fallback for server redirects; a request Host header is not. Never leave the example canonical domain in a production build. Environment changes require redeployment.

Add Supabase, encryption, chosen provider and email secrets from `.env.example`. Do not paste secrets into the admin panel, product descriptions, GitHub or logs. Do not reuse the original store's database for development.

## 3. Provider activation and switching

All providers start disabled. Configure credentials first, then enable a provider and choose the default in **Admin → Marketplace → Gateways**. Readiness checks prevent enabling incomplete server configuration. New checkout chooses an available enabled provider; an existing order cannot switch provider or test/live environment. Disabling a gateway stops new checkout but does not disable its historical webhooks, refunds, reconciliation or existing subscription cancellation.

### Cashfree

Set app ID, secret, environment and API version. Keep sandbox and production credentials separate. Configure the signed payment and dispute webhook URLs documented by the route modules. Standard company-product sales use ordinary PG checkout. Third-party sales require Cashfree Easy Split activation, `CASHFREE_EASYSPLIT_APPROVED=true`, and provider-verified vendor onboarding; the order records the exact seller/commission split. Automatic subscriptions additionally require a separately activated subscription product and `CASHFREE_SUBSCRIPTIONS_APPROVED=true`.

Official references:
- https://www.cashfree.com/docs/api-reference/payments/latest/split/easy-split-overview
- https://www.cashfree.com/docs/payments/online/webhooks
- https://www.cashfree.com/docs/api-reference/subscriptions/overview
- https://www.cashfree.com/docs/api-reference/payments/latest/disputes/overview

### Razorpay

Set key ID, secret and webhook secret. Third-party splits require Route activation, `RAZORPAY_ROUTE_APPROVED=true`, and a linked account whose actual provider state has been verified. Subscriptions require the separately approved product and `RAZORPAY_SUBSCRIPTIONS_APPROVED=true`. A successful mandate authorization without a verified matching charge does not grant a paid plan.

Official references:
- https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
- https://razorpay.com/docs/payments/route/
- https://razorpay.com/docs/payments/subscriptions/
- https://razorpay.com/docs/payments/disputes/

### Easebuzz

Set merchant key, salt and test/prod mode. Server-side verification uses the documented request/response hashes and transaction lookup before fulfillment. Third-party split checkout requires Slices activation, `EASEBUZZ_MARKETPLACE_APPROVED=true`, and `EASEBUZZ_APPROVED_SPLIT_LABELS_JSON` containing only provider-issued labels approved for the actual sellers. The admin cannot invent verified seller labels. Publicly verifiable submerchant and recurring APIs are limited; this build does not pretend that a dashboard switch completes onboarding or provides automatic recurring debit. Easebuzz renewal is manual and must be described as manual in the offer and checkout.

Official references:
- https://docs.easebuzz.in/
- https://easebuzz.in/slices/
- https://easebuzz.in/smartbilling/
- https://github.com/easebuzz/paywitheasebuzz-php-lib

Provider product approval, entity eligibility, charges, underwriting, settlement schedules and reserve policies are decided by that provider. Marketplace support in code does not establish approval for an individual operator. Obtain explicit approval for your disclosed business model and creator payouts before taking third-party live payments.

## 4. Data sent to the payment provider

Checkout sends the amount/currency, merchant order reference, required buyer name/email/phone, return/notification URL and limited internal references. Approved marketplace flows additionally send the provider-issued seller reference and exact split allocations. Subscription flows send the plan, interval, mandate/authorization references and verified period data required by the chosen API. Necessary private seller identity/payout details are supplied during approved onboarding, never in public product metadata. No customer password, service-role key, UPI PIN, card CVV or unrelated customer database is sent as metadata.

The ordinary payment request does not automatically report email delivery or a completed file download. Resend status, account entitlement and download-authorization records are stored separately. Dispute evidence uses the recorded events and states their limits. An email accepted by Resend or a signed URL being generated is not proof of inbox delivery or completed file transfer.

## 5. Email, fulfillment, refunds and disputes

Configure verified `RESEND_FROM_EMAIL`, API key and webhook secret. Add the signed Resend webhook for delivery/bounce updates. After a canonical verified live payment, a durable idempotent email job sends the styled order receipt and authenticated download links. The buyer can also use **My downloads**. Payment callbacks, retries and duplicate notifications must not send duplicate receipts or mint duplicate entitlements. A pending/test payment or browser success URL grants no paid files.

Configure `CRON_SECRET`. The Vercel cron fallback runs daily; for prompt reconciliation/email retries/deadline checks configure an authenticated 5-minute scheduler supported by your hosting plan, then verify actual last-run status in admin. Do not expose the job without its bearer secret. Confirmed refunds and lost disputes update affected access and seller ledger; uncertain results stay pending/requiring review. Admin cannot manufacture a successful payment or bank settlement.

Cashfree disputes use signed notifications, current provider lookup, deadlines, evidence generation and reviewed submission with idempotency keys. Razorpay dispute events are signature-verified and reconciled from its API. Evidence and deadline tracking can be automated; the provider/bank decides the case. Unsupported provider dispute actions require its dashboard/manual review. Do not auto-contest an actually unauthorized or undelivered payment merely because a download link exists.

## 6. Plans and customer memberships

Both modules are included. Free Starter does not require a payment. Configure paid plan prices, listing limits and enabled state in admin before publishing; default draft amounts are not a business pricing recommendation. Creator membership offers are tied to that creator and eligible approved products. Checkout discloses price, interval and automatic/manual renewal mode. A matching server-verified live charge grants only its recorded paid period. Cancellation is confirmed with the original provider and does not silently migrate mandates when the default gateway changes. Membership expiry never revokes unrelated valid one-time purchases.

## 7. Before accepting real payments

Apply SQL, private Storage, role setup and environment configuration; deploy to the correct domain; confirm public policy/operator details. In provider sandbox, exercise successful, failed, pending and duplicate payments, retries, wrong amount/reference, stale events, full/partial refunds, dispute events, cancellation and expiry. Verify the admin displays actual payment, email, access and ledger states. Test mobile navigation, creator submission, moderator rejection/approval and private data isolation. Then complete provider live activation and use its prescribed go-live checks. No live payment or email has been sent as part of source validation.

## Future merge

New features are isolated in creator marketplace, gateway control, subscription and dispute modules, new UI pages/components, SQL migrations and documented route mounts. Merge through a reviewed branch; back up both databases, reconcile IDs and existing provider bindings, and never replace production store state with a development snapshot. Keep immutable old payment/refund/subscription references intact.
