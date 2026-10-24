# Booyahstudio: GitHub + Vercel deployment

**Final integration update:** follow `SETUP-HINDI.md` for Cashfree, current email recovery template and Resend delivery tracking. Historic Razorpay instructions below apply only if retaining those credentials.

**Admin/Vercel update, 23 October:** see `ADMIN-GUIDE-HINDI.md` for password access and operational management, and `VERCEL-DEPLOYMENT-CHECK.md` for current function budgets, routing and upload limits.

MANISH KUMAR SONKAR | Booyahstudio
connectbooyahstudio@gmail.com · WhatsApp +91 7393845435

## 1. Project files and GitHub

1. Extract the final ZIP. Use its `booyahstudio/` folder as the GitHub repository root (where `package.json` lives).
2. Use a PRIVATE GitHub repository because this complete owner project includes paid product source/archive files. Create it in your GitHub account, or copy the files into your existing private project. Never publish the owner ZIP or product sources as public repository assets. Keep the provided lockfile.
3. Never upload `.env`, secret keys, customer exports or `node_modules`. `.env.example` contains names only.
4. The ZIP includes `demofiles/`, `templates/` and `owner-files/` for preservation. These are not public Vercel output. Customer ZIPs prepared for private upload are also supplied separately in the final ZIP.
5. Use Node 24 and pnpm 10.34.5. Run `pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm test`, `pnpm build`.

## 2. Supabase database

1. Create a Supabase project under your account and save its database password privately.
2. For a new installation, open SQL Editor and run `supabase/schema.sql` completely. For an existing installation, back up first, ensure `supabase/migrations/20261005_payment_security.sql` is applied, then run `supabase/migrations/202610220001_cashfree.sql`. The baseline creates or upgrades the server-only store, private products bucket and public thumbnail bucket; the second migration adds the required Cashfree payment/refund/dispute and email operations. Both preserve stored records. Browser roles cannot directly read/write paid objects.
3. Under project API settings, copy the project URL, anon key and service-role key into Vercel environment settings (next section). The service-role key must never go in browser code, a `VITE_` variable or GitHub.
4. The `store_state` table has RLS enabled. Anonymous/authenticated browser roles have no direct access to store rows or the store function. Only the backend service role executes the function.
5. This is a new Supabase store. Existing accounts/orders are not silently imported. Preserve historical transaction records privately; plan any migration separately rather than copying old password hashes or sessions.
6. Enable database backups appropriate for your account and test recovery. The JSON store uses one locked row for atomic writes; it suits a small store. Monitor growth and move to indexed per-entity tables before high-volume operation.

## 3. Supabase login and password recovery

1. Enable email/password sign-in and **email confirmation** in Supabase Auth. Keep password strength at least 8 characters.
2. Set Auth **Site URL** to your final HTTPS domain, provisionally `https://www.booyahstudio.shop` from the existing repository.
3. Add allowed redirect URLs `https://www.booyahstudio.shop/login` and `https://www.booyahstudio.shop/forgot-password`. Add your exact development URLs separately if needed.
4. Configure custom SMTP using your **Resend SMTP** settings shown in the Resend dashboard. Verify its sending domain and sender. The Vercel Resend API key alone does not configure Supabase email.
5. In the **Reset Password** email template, this token-hash link is recommended:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}">Reset your Booyahstudio password</a>
```

6. Keep Supabase's supported confirmation link in the **Confirm signup** template, and brand its text as Booyahstudio. After confirming, the customer signs in on `/login`.
7. Test signup, confirmation, login, logout and password recovery for an existing account. Both the custom token-hash link and Supabase's default implicit recovery link are supported. Opening the page never changes the password; the customer explicitly submits a new password and the server verifies the recovery proof. Credentials are removed from the URL and not stored in browser storage. Expired/replayed links fail, and earlier store sessions become invalid after reset. See `RECOVERY-FIX.md`.

## 4. Private product ZIPs

1. In Supabase Storage, verify `products` is **private**. Do not add public download policies.
2. Upload each sellable product as exactly `<catalog-product-id>.zip` at the bucket root. Examples: `linknest-pro.zip`, `neura-ai.zip`, `finora.zip`, `learnify.zip`, `velora.zip`, `margin-portfolio.zip`.
3. The final ZIP's `private-product-uploads/` contains prepared copies and a checksum manifest. The 20 static packages can be regenerated with `python3 scripts/package-template-collection.py`.
4. Keep all paid ZIPs out of `public/` and the public `product-images` bucket. The latter is only for catalog thumbnails.
5. Checkout refuses to initiate when an ordered file is missing. After a verified **live captured payment**, the customer's account can request a 60-second signed URL. Test transactions never unlock paid files. Links are expiring, not single-use.
6. Test large actual ZIP downloads from deployed Supabase Storage; the API returns a URL rather than streaming file bytes through a Vercel function.

## 5. Razorpay

1. Create/activate your Razorpay merchant account with your actual business details and approved digital-product activity. Provider activation and website approval are separate from this code.
2. Use **Test Mode** keys first. Configure automatic capture according to your Razorpay account settings. Authorised but uncaptured payments do not fulfil orders.
3. Add a webhook: `https://www.booyahstudio.shop/api/payments/razorpay/webhook`.
4. Subscribe to `payment.captured`, `payment.authorized`, `payment.failed`, `order.paid`, `refund.processed`, `payment.dispute.created`, `payment.dispute.won`, `payment.dispute.lost`, `payment.dispute.closed`, `payment.dispute.under_review`, and `payment.dispute.action_required`. Create a strong webhook secret and put the same value in Vercel's `RAZORPAY_WEBHOOK_SECRET`.
5. `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` must belong to the same mode/account. The key ID determines `test` versus `live`. The server creates Razorpay orders and calculates totals; the client cannot choose a payment amount.
6. Test checkout success/cancellation/failure, repeated webhook deliveries and returning after closing the browser. Test orders must display test status and no real downloads.
7. For production, replace Test keys with Live keys in **Production** only, configure the matching live webhook and redeploy. Keep Preview on separate test credentials/database, not live production data.
8. Make a controlled genuine purchase after approval. Confirm captured status, account access, correct ZIP, notification email and payment receipt. Do not claim production launch passed before this check.
9. Approve refunds through your Razorpay Dashboard after reviewing the request. This application does not automatically decide or submit refunds. `refund.processed` causes the app to fetch current payment state and restrict further downloads for refunded/partially refunded orders. If webhook delivery fails, use Admin → Verify with Razorpay to reconcile. Monitor failed webhooks and refund status.
10. Disputes are handled in Razorpay's dispute interface within the deadline shown there. Use necessary order, listing, access-authorisation and support records. Admin → Orders → Download dispute evidence exports necessary stored references, listing/policy snapshots, payment/refund/dispute history and download authorisations. Review/redact it and add relevant support correspondence before submission. The app does not automatically submit evidence or treat an issued link as proof of completed receipt. Open disputes do not automatically revoke access; a provider-confirmed lost dispute on the order payment restricts further downloads. After a won/closed resolution, reconcile and use Restore access after review with a reason. Refunds/unpaid orders cannot be restored with that control.

## 6. Resend transaction emails

1. Verify a sending domain in Resend and add its required DNS records.
2. Create a suitably scoped API key. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Vercel.
3. Sender example: `Booyahstudio <orders@your-verified-domain>`; replace with your actual authorised address. Do not assume a Gmail address is an approved sender.
4. Customer support remains `connectbooyahstudio@gmail.com` and WhatsApp `7393845435`.
5. Order mail links to `/account`; it does not expose persistent private download URLs. Delivery failures do not remove paid access. Reconcile a paid order to retry failed notification sending. Provider acceptance is recorded, not actual inbox receipt or reading. Verified refunds can also send a notification. Atomic notification claims and Resend idempotency prevent concurrent duplicates. If the first attempt is more than 23 hours old, automatic retry stops for manual review of the provider delivery record; do not delete the record and blindly resend.

## 7. Vercel

1. Import the GitHub repository into Vercel.
2. Root directory: the folder containing `package.json`. Framework preset: Vite (the included `vercel.json` supplies routes).
3. Node version: **24.x**. Install command: `pnpm install --frozen-lockfile`. Build: `pnpm build`. Output: `dist`.
4. Add these **server-side** environment variables:

| Variable | Value source |
| --- | --- |
| APP_URL | Exact final HTTPS origin, no trailing path |
| SUPABASE_URL | Supabase project URL |
| SUPABASE_ANON_KEY | Supabase anon key, used by the server Auth client |
| SUPABASE_SERVICE_ROLE_KEY | Private Supabase service-role key |
| CASHFREE_APP_ID | Matching sandbox or live Cashfree app ID |
| CASHFREE_SECRET_KEY | Matching private Cashfree secret |
| CASHFREE_ENV | sandbox or production |
| CASHFREE_API_VERSION | 2026-01-01 |
| RAZORPAY_KEY_ID | Matching Razorpay mode key ID |
| RAZORPAY_KEY_SECRET | Matching private API secret |
| RAZORPAY_WEBHOOK_SECRET | Secret entered for that webhook |
| RESEND_API_KEY | Private Resend key |
| RESEND_FROM_EMAIL | Verified sender |
| RESEND_WEBHOOK_SECRET | Resend webhook endpoint signing secret |
| CRON_SECRET | Strong secret for the external reconciliation scheduler |

5. Redeploy after setting variables. The full `pnpm build` command now generates `build/api-app.mjs` and runs a native Node startup/registration check. Keep the `vercel.json` function include rules: both API entrypoints import this private bundle. Do not override the build command with `vite build` or deploy `dist` alone. See `VERCEL-REGISTRATION-FIX.md` for this fix and its validation limits. `api/index.ts` is the API entrypoint; `api/page.ts` renders current product metadata (including admin-added products) and includes the built HTML shell; `/api/*` routes must reach it. Paid archives are never inside `dist`.
6. Add your domain and configure the DNS records Vercel shows. Confirm HTTPS. If the domain differs, update `src/config/business.ts`, `src/seo/seoMetadata.ts`, `index.html`, Auth redirect/template URLs, APP_URL and the webhook; rebuild the sitemap and canonical metadata.
7. Verify `/api/health`, `/api/products`, every policy route, direct product links and `/sitemap.xml` on the deployed domain. Check browser console/network failures and 404 pages.

## 8. Owner admin account

1. Register and confirm your own account, then sign in once to create its store profile.
2. In Supabase Auth, copy your account UUID.
3. In the SQL Editor, run the following after replacing the placeholder with that exact UUID. Never use a customer's UUID:

```sql
select public.store_operation('update', 'users/YOUR_AUTH_UUID/profile', '{"role":"admin"}'::jsonb);
```

4. Sign out/in and visit `/admin`. Registering publicly cannot choose an admin role.
5. Built-in products remain source-controlled in `src/data/products.ts` and `src/data/newProducts.ts`. Admin catalog overrides are stored in Supabase; use matching IDs. New product ZIPs must use the same ID and be uploaded privately.
6. Support-form messages are stored under `supportRequests` in the server-only database. Review them in Supabase SQL Editor with `select public.store_operation('get','supportRequests',null);`. Newsletter opt-outs must be processed manually in the stored subscriber records and any actual mailing list.

## 9. Content and GST before launch

The supplied name, owner, GSTIN, address and support contacts are displayed as provided; this work does not independently verify the registration.

The app issues **payment receipts**, not GST tax invoices. Confirm tax-inclusive/exclusive prices, GST rate, SAC/classification, place-of-supply handling and invoice process with your accountant before live selling; none are invented. Current checkout charges the displayed product total without an added computed GST line. Issue legally required tax documents through your confirmed accounting process.

The 20 static products retain their actual included single-project licenses. Other imported products must have their actual permitted use and included files reviewed. Do not invent rights for third-party material. Policies preserve mandatory consumer rights and should be checked against the way you operate the launched business.

## 10. Launch and recovery checklist

- Confirm email delivery to a real inbox, not just API acceptance.
- Test account recovery and old-session invalidation.
- Test uncaptured, failed, wrong-account and test orders cannot download.
- Test a captured live order gets only its purchased files.
- Replay webhook; verify no duplicate entitlement. Process refund and check no new download links.
- Try phone/tablet/desktop layouts and Chrome, Edge, Firefox and Safari on your supported devices. Current local browser evidence is in VALIDATION.md; universal compatibility is not claimed.
- Keep database and product-file backups. Monitor provider webhooks, API failures and support requests.
- Roll back a bad Vercel deployment if necessary. Do not restore stale paid/refunded state blindly: reconcile provider transactions after a data restoration.

## Official sources checked on 5 October 2026

- [Razorpay Standard Checkout and server verification](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
- [Webhook signatures, duplicate delivery and ordering](https://razorpay.com/docs/webhooks/validate-test/)
- [Refunds](https://razorpay.com/docs/payments/refunds/)
- [Disputes](https://razorpay.com/docs/payments/disputes/)
- [Business website details](https://razorpay.com/docs/payments/dashboard/account-settings/business-website-details/)
- [Razorpay terms](https://razorpay.com/terms/)
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase expiring Storage links](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl)

Provider documentation governs provider-specific setup. Merchant policies are independently drafted, not copies of provider contracts.

## Upgrade audit and important operating details

- `FINAL-AUDIT.md` compares every audited requirement before/after and distinguishes local simulated-provider tests from real provider checks.
- Failed/authorised/created attempts remain recorded under the order payment history. The order stays pending until a captured payment verifies. Closing checkout records a browser-reported event, never a financial cancellation.
- Different captured payment IDs for one order are retained and flagged for duplicate-payment review. Refund a confirmed duplicate through Razorpay after checking references. Refunding a duplicate does not revoke the primary paid purchase.
- Partial or full refunds on the primary payment restrict further download links. Review the customer's agreed remedy; refunds do not require abandoning statutory rights.
- Suspending/restoring a customer in Admin invalidates earlier store sessions. Supabase password authentication backs opaque store cookies; revoking Supabase tokens alone does not revoke an existing store cookie. For provider-dashboard password/ban actions, also suspend the store profile or set its `sessionValidAfter` cutoff via the protected store function.
- Full policy documents are saved under the accepted content-derived version on new checkouts. Historical orders from before this upgrade may only have their original version label; retain backups and never invent an earlier policy snapshot.
- New products stay draft until price, actual license, included files, version, description and technical requirements are complete. Upload the exact `<product-id>.zip` privately before sale. Admin-added products appear in dynamic metadata; the generated sitemap lists source-controlled products, so add permanent catalog entries to source and rebuild to include them in the sitemap.
- The server-only JSON store preserves the existing architecture. All writes lock one row; monitor size and contention, and plan a separately tested data migration if growth requires it.
- Clean install uses **pnpm**, as declared by the project. Do not mix npm and pnpm lockfiles. The validation report records the exact package-manager command used.

Additional official references verified for this upgrade:
- [Dispute webhook payloads/events](https://razorpay.com/docs/webhooks/payloads/disputes/)
- [Fetch a dispute](https://razorpay.com/docs/api/disputes/fetch/)
- [Vercel function files and configuration](https://vercel.com/docs/project-configuration/vercel-json)
