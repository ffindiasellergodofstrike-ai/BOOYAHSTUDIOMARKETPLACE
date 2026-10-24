# BOOYAH STUDIO — marketplace setup and launch guide

## What is included

The original 26 products remain. The new marketplace adds:

- `/sell`: Starter, Creator and Studio plans, each ₹0/month (5/25/100 submitted products).
- `/seller`: authenticated registration, typed electronic agreement acceptance, private PAN/bank details, hosted verification link, product submission, sales, settlement records, complaints and agreement download.
- `/sellers/<seller-id>`: public approved seller storefront and product links.
- `/admin/marketplace`: seller review, product review/private ZIP inspection, complaint handling, reserves/suspension, split/settlement requests, refund reconciliation, and recorded chargeback notices.
- `/complaints`: authenticated buyer complaints for their own marketplace orders; other reports and attachments use the existing support email.
- Detailed marketplace, seller, settlement, prohibited-product, copyright and privacy policies linked in the footer. Support and grievance use the same existing email, telephone and address.
- Supabase Postgres persistence for existing accounts/orders/products and new marketplace data. Browser clients cannot read the private database directly.
- Verified live payment → idempotent seller ledger → account/email delivery. A browser success message never authorizes fulfillment.
- Email-based single-use password recovery, replacing insecure email + mobile reset.

**This source package does not activate a payment account, deploy a Supabase project, obtain regulatory approval, or prove a live bank settlement.** Complete the provider checks below before enabling seller checkout. No real payment, refund or bank payout was performed during local validation.

## Architecture and file storage

GitHub stores source; Vercel runs the frontend and same-origin Express APIs; Supabase stores server-side records. This implementation retains the existing application’s bcrypt passwords and opaque session cookies. It does **not** use Supabase Auth, so do not configure a second login system or expect Supabase Auth user rows to appear.

There is no Supabase Storage bucket and no seller ZIP upload to the marketplace. Each seller supplies its private file source. MEGA file links are supported by default; additional exact HTTPS object-storage hosts require explicit administrator configuration. Google Drive web-view/folder links are not direct ZIP delivery sources. Direct source redirects are rejected. Paid source links and seller identity/bank fields are encrypted at rest and never included in public product responses.

File bytes are streamed through the application after access checks. This consumes Vercel bandwidth/runtime resources even though files are not retained there. Free seller plans do not promise free or unlimited infrastructure. Use a Vercel plan whose terms permit commercial use; Hobby is for personal/non-commercial use. Review actual Supabase capacity, backups and retention as usage grows. The initial document model reads seller collections for catalog/admin operations; it is suitable for an initial deployment, not a claim of unlimited scale.

## 1. Prepare Supabase

1. Create the project in your own Supabase account. Save its database password privately.
2. In **SQL Editor**, run `supabase/migrations/202610030001_marketplace_store.sql` in full.
3. Confirm `public.store_documents` exists and RLS is enabled. The migration revokes table/function access from `anon` and `authenticated`; only the server’s `service_role` has access. Do not add public read/write policies.
4. In the project settings, copy the project URL and server **service_role** API key into the corresponding Vercel server environment variables. Do not put the service-role key in browser code, GitHub, `VITE_*` variables or a public screenshot.
5. No browser anon key, Storage bucket, Auth redirect URL, Supabase OAuth provider or Edge Function deployment is needed for this implementation.
6. For a disposable local PostgreSQL verification database only, `supabase/verify.sql` checks nested writes, mirrored orders, rollback, CAS and permissions. It rolls its synthetic records back. It is not a data migration from Firebase.

### Existing customer/order data

Bundled products are seeded without overwriting existing product edits. Existing Firebase accounts, orders, download tokens and sessions are **not automatically transferred** to a new Supabase project. If there are real orders, export a backup and perform a controlled migration during a write freeze before changing `DATABASE_PROVIDER`. Keep user IDs, password hashes and order ownership intact; verify counts and representative records before cutover. Never seed fake paid orders to work around a missing migration.

## 2. Add Vercel environment variables

Use **Project → Settings → Environment Variables**. Add server secrets for the intended environment, then redeploy. Production and Preview must use separate databases/provider credentials. `.env.example` contains names and empty examples, not working secrets.

| Variable | Where its value comes from / purpose |
|---|---|
| `APP_URL` | Your final HTTPS canonical domain, e.g. `https://www.booyahstudio.shop`. Used for callbacks and reset/delivery links. |
| `DATABASE_PROVIDER` | Set to `supabase`. Required for transactional marketplace operation in production. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Private server service-role API key from that project. |
| `MARKETPLACE_LEGAL_NAME` | Actual legal business/entity/person operating the marketplace. Required before registration opens. |
| `MARKETPLACE_ENCRYPTION_KEY` | A new cryptographically random 32-byte key encoded as base64; generate below. |
| `MARKETPLACE_COMMISSION_BPS` | Commission in basis points, 0–5000. Default `0`; `500` means 5%. The accepted fee is snapshotted per seller and order. |
| `EASEBUZZ_KEY` / `EASEBUZZ_SALT` | Private credentials supplied for the approved merchant account. |
| `EASEBUZZ_ENV` | `test` for provider sandbox verification; `prod` for production. Public checkout accepts only live-capable configurations. |
| `EASEBUZZ_MARKETPLACE_APPROVED` | `true` only after approval for this digital-marketplace model and submerchant/split APIs. Otherwise `false`. |
| `EASEBUZZ_ONDEMAND_APPROVED` | `true` only after on-demand settlement is enabled and its deadlines/reserve arrangement are confirmed. |
| `EASEBUZZ_MERCHANT_EMAIL` | Email registered with the merchant settlement account. |
| `EASEBUZZ_PLATFORM_SPLIT_LABEL` | Exact platform label confirmed in the provider’s split configuration; not an arbitrary merchant ID. |
| `SELLER_DOWNLOAD_HOSTS` | Exact allowed private download hosts, comma-separated. Default `mega.nz`. Do not allow arbitrary domains or internal hosts. |
| `CRON_SECRET` | New long random secret. Vercel cron sends it as a Bearer token. |
| `RESEND_API_KEY` | Private Resend key with permission to send from your verified domain. |
| `RESEND_FROM_EMAIL` | Verified sender, e.g. `BOOYAH STUDIO <orders@your-domain>`. Needed for purchase and password-reset email. |
| `PURCHASE_EMAIL_LINK_TTL_HOURS` | Existing download-email link TTL, 1–720; example `168`. |
| `INVOICE_BUSINESS_NAME` / `INVOICE_BUSINESS_ADDRESS` | Actual invoice issuer details; ensure they match your legal/tax arrangement. |
| `INVOICE_GSTIN` | Actual GSTIN if applicable; never invent one. |
| `INVOICE_SUPPORT_EMAIL` | Existing support email. |
| `PRODUCT_DOWNLOAD_URL_<PRODUCT_ID>` | Private source URLs for each existing store product. Hyphens become underscores and IDs uppercase. Seller product URLs are encrypted database records instead. |

Generate keys locally; save the output directly in your password manager and Vercel, not a repository file:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use the first command for the encryption key and the second for `CRON_SECRET`. **Keep an offline secure backup of the encryption key.** Changing it without decrypting/re-encrypting existing records makes identity details and seller source links unreadable. Rotation needs a controlled migration; there is no automatic key-rotation job.

### Existing optional provider variables

`PAYU_KEY`, `PAYU_SALT`, `PAYU_ENV`, `PADDLE_*` and `FIREBASE_*` remain for the original store’s integrations and compatibility. They are not required for the new Supabase/Easebuzz marketplace. Seller orders cannot be paid through PayU/Paddle. Do not enable a provider merely by adding dummy credentials. `FIREBASE_STORAGE_BUCKET` is not used as marketplace ZIP storage. No secret needs a `VITE_` prefix.

## 3. Confirm Easebuzz enablement and dashboard configuration

Ask Easebuzz to approve your exact digital categories, merchant legal identity, seller/submerchant KYC flow, Slices/post-transaction splits, on-demand settlement, refund APIs and any reserve arrangement. Supply your real website, seller agreement, permitted-product policy, customer policies, expected volumes and business/KYC documents. PAN, bank proof, entity/address documents and GST information depend on business type; final approval belongs to the provider.

Configure these production endpoints using your `APP_URL`:

| Purpose | Endpoint |
|---|---|
| Payment webhook | `/api/payments/easebuzz/webhook` (confirm your account’s existing payment integration settings) |
| Payment success/failure redirect | Set by the server’s initiate request; inspect the generated request for your configured canonical domain. |
| Submerchant KYC approval webhook | `/api/marketplace/kyc-webhook` |
| Existing payment reconciliation cron | `/api/payments/easebuzz/reconcile-cron` |
| Marketplace split/settlement/refund reconciliation cron | `/api/marketplace/reconcile-cron` |

The existing `vercel.json` runs payment reconciliation daily at 03:00 UTC and marketplace reconciliation at 03:15 UTC. Confirm cron availability for your hosting plan. The marketplace job handles at most 20 attempted records per run; monitor returned `requiresReview`, pending rows and job logs. Increase job cadence/worker capacity before higher volume. An API health response alone does not prove database, email or banking readiness.

### Seller verification and approval sequence

1. Seller creates an ordinary website account, then opens `/seller`.
2. Seller provides legal/store/contact/PAN/bank data, chooses a free plan, types the legal name, and accepts the agreement and declarations.
3. The recorded document includes operator, seller, plan, fee, exact text/version, timestamp and hash. This is recorded electronic acceptance, **not a certified digital signature/eSign service**.
4. Seller creates a separate payment-onboarding password (never reuse or ask for their banking password). The backend creates a submerchant and does not persist that password.
5. Seller opens the provider-hosted KYC link and uploads required documents there. PAN formatting is not verification.
6. A signed KYC webhook must match the linked submerchant and recorded name/email/mobile. It only updates KYC; it does not restore a suspended seller or publish products.
7. Admin verifies the provider-approved seller split label and evidence reference in `/admin/marketplace`, then approves the seller.
8. Admin inspects product ownership, preview, ZIP contents, license and malware screening before publication. The authenticated private ZIP inspection endpoint does not disclose the seller’s underlying source URL.

If submerchant creation times out, the account is marked unknown. Reconcile the existing account in the provider dashboard; the admin can attach its verified ID/reference. Do not create repeated submerchant accounts blindly. Bank/identity changes require support and renewed provider review; the UI does not silently change previously verified banking data.

### Important provider limits and documentation caveats

Official documentation inspected:

- [Marketplace use case](https://easebuzz.in/use-cases/payment-gateway-marketplace/)
- [Express onboarding](https://easebuzz.in/express-onboarding-api/)
- [Create submerchant API](https://docs.easebuzz.in/docs/payment-gateway/af94640eeae86-create-sub-merchant-api)
- [KYC access link](https://docs.easebuzz.in/docs/payment-gateway/2b48a38b084b9-generate-sub-merchant-kyc-access-key-api)
- [KYC approval webhook](https://docs.easebuzz.in/docs/payment-gateway/ydk17g4xurhhp-submerchant-kyc-approval-webhook)
- [Post-transaction split](https://docs.easebuzz.in/docs/payment-gateway/e383e3fb60ce3-create-api)
- [On-demand settlement process](https://docs.easebuzz.in/docs/payment-gateway/zdzd4lnxr28sb-settlement-process)
- [Merchant terms](https://easebuzz.in/terms/)

The on-demand settlement documentation describes automatic settlement after **45 days** if an instruction is not received. An internal **120-day review flag cannot override this**. Obtain an explicit provider-approved reserve mechanism before promising or attempting a bank-side hold. The implementation stops automatic instructions near the deadline and records restrictions; contact the provider immediately where funds must be held. It does not guarantee funds remain at the bank for 120 days.

The KYC access-link schema calls the field `phone`, while one published example uses `mobile_number`; the adapter follows the schema. Confirm the enabled version with your provider and run a real sandbox onboarding. Split labels must be confirmed by the provider, not assumed to equal submerchant IDs. If your account uses a different enabled API/version, adjust the adapter against that account’s official specification and revalidate before launch.

## 4. Create the first administrator

Register your own normal account on the deployed site. In Supabase SQL Editor, identify the exact user record by your known email; do not share credential columns:

```sql
select id, data->'profile'->>'email' as email
from public.store_documents
where collection='users';
```

Then promote only the intended account (replace the example ID):

```sql
select public.store_write('users/YOUR_EXACT_USER_ID/profile/role', '"admin"'::jsonb, 'set');
```

Sign out/in. Open `/admin/marketplace`. Admin authorization is enforced by the backend profile check; a browser role change does not grant access. No default administrator password is shipped.

## 5. Operations and exceptions

- **Checkout:** one seller per order; no independent-seller store coupons. Existing store products remain available. Prices come from the server; accepted seller commission is snapshotted.
- **Delivery:** only verified live paid orders unlock account/email access. Keep each approved product version/source stable for existing buyers. Changing a product version should use a new listing; source repair or retired products require support review and may require refunds.
- **Settlements:** seven-day initial eligibility, approved KYC/splits, no applicable restriction. Expected gross/commission/share are immutable sale snapshots. Processing charges and taxes require reconciliation to actual bank amounts. Accepted instructions are pending until provider status confirms settlement and a reference.
- **Unknown instructions:** timeouts are recorded. Existing split/settlement references are queried; no blind repeat bank instruction. Interrupted split work is recovered to an unknown state for lookup.
- **Refunds:** admin requests an amount against a verified sale before settlement; provider ID/status is reconciled. Unknown refund requests can be linked by admin only after the provider’s refund-status API confirms the transaction and amount. One automated refund request per sale is supported. Partial refunds proportionately adjust commission/seller share and route the remaining balance to review. Already settled refunds and additional refunds need provider-assisted reconciliation; the application does not silently claw back a bank account.
- **Chargebacks:** no undocumented generic chargeback webhook is trusted. Admin records a verified provider/bank notice and evidence reference; affected delivery/settlement is restricted for reconciliation. This records a dispute, not an automatic debit. Buyers retain legitimate statutory/bank rights; the merchant’s own provider liability is not transferred wholesale to buyers.
- **Complaints:** open → under review / waiting for seller → resolved/rejected. An unverified complaint alone does not permanently ban a seller. Confirmed fraud/serious violations can justify permanent suspension. Actual bank-side restrictions need provider confirmation. An internal hold does not freeze money already sent.
- **Moderation:** manual ownership/content/malware review is required. No automatic malware-scanner certification is claimed.
- **Appeals, identity changes and closure:** use the shared support/grievance contact and retain reasons/evidence. Keep records needed for legitimate disputes and law; there is no automatic deletion of outstanding financial evidence.
- **Tax:** existing receipts identify the seller but are not a complete marketplace tax, GST/TCS/TDS or seller-tax-invoice engine. Confirm your actual invoicing/withholding obligations before launch; do not assume a zero `tax` field proves exemption.

## 6. Run locally and verify before production

```bash
pnpm install --frozen-lockfile
# Copy .env.example to private .env and configure your own development services.
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

Do not use real customer data in development. Missing provider credentials must not be bypassed with fake success responses. The application’s local development database is a convenience, not the production marketplace database.

Before enabling live seller purchases verify:

- [ ] Actual legal operator name, grievance responsible person, business address and support contacts are confirmed.
- [ ] Commission is decided; agreement snapshot and product restrictions match the approved contract.
- [ ] Supabase migration, service-key privacy, backups and account/order migration (if any) verified.
- [ ] Domain/HTTPS, commercial hosting plan and sender-domain DNS verified.
- [ ] Register/login/password-recovery emails work with your verified sender.
- [ ] Provider approves actual digital categories, submerchant KYC, Slices and on-demand settlement.
- [ ] Seller KYC callback and exact split labels validated in the provider environment.
- [ ] A provider-approved transaction, duplicate callback, failed payment, refund and settlement are reconciled end-to-end.
- [ ] Private seller ZIP can be retrieved, streamed, revoked after full refund, and remains inaccessible without entitlement.
- [ ] Support can handle provider deadlines, unknown requests, chargebacks, complaints and appeals.
- [ ] Tax invoicing, retention and any proposed 120-day reserve arrangement are confirmed for your real business.

No Supabase/payment account has been created for you by this package. Add the real environment values and complete account approval in your own dashboards. Never send PAN scans, API secrets or banking credentials through a public repository or support screenshot.
