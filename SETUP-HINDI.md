# Final setup — Supabase + Cashfree + Resend

Is project ka design, branding, product data/prices, screenshots aur demos preserve kiye gaye hain. Changes authentication, payments, delivery/email records, related admin controls, tests aur setup tak limited hain. Original product archives ko edit nahi kiya gaya.

Yeh source-code implementation hai. Live credentials/accounts is ZIP mein nahi hain. Cashfree approval, live settlement aur actual inbox delivery local tests se confirm nahi hote.

Admin panel `/admin` par email/password se khulta hai. Owner role ki first-time setup aur saare management controls `ADMIN-GUIDE-HINDI.md` mein hain. GitHub + Vercel API deployment checks `VERCEL-DEPLOYMENT-CHECK.md` mein hain.

## 1. Supabase

1. New project: SQL Editor mein `supabase/schema.sql` poora run karein. Ismein original schema aur Cashfree migration dono included hain.
2. Existing project: backup lekar pehle existing baseline migration ki requirement check karein, phir `supabase/migrations/202610220001_cashfree.sql` run karein. Yeh current Store schema ko extend karti hai; existing records delete nahi karti. Historical Firebase data is migration se automatically import nahi hota.
3. Hosting par SUPABASE_URL, SUPABASE_ANON_KEY aur SUPABASE_SERVICE_ROLE_KEY set karein. Service-role key browser/VITE_ variable mein na rakhein.
4. Auth mein Email/password aur Confirm Email enable karein. Phone/SMS OTP ki zaroorat nahi. Mobile sirf unverified contact field hai.
5. Site URL: exact final HTTPS origin, jaise `https://www.booyahstudio.shop`. APP_URL bhi yahi origin ho; path/query mat daalein.
6. Redirect allowlist mein final origin ke `/login` aur `/forgot-password` add karein. Local development/preview ke exact origins alag add karein; production mein broad wildcard mat use karein.
7. Confirm signup email template ke button mein `{{ .ConfirmationURL }}` use karein. App signup confirmation ke baad `/login` bhejta hai; user email/password se login karega.
8. **Reset Password email template** ke liye recommended token-hash link:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}">Reset your password</a>
```

Backend redirectTo ko trusted APP_URL + `/forgot-password` set karta hai. Is custom token-hash flow mein page kholne par app OTP verify nahi karta; password submit hone par token verify hota hai. Supabase ka default `{{ .ConfirmationURL }}` recovery link bhi supported hai: provider email verify karke `#access_token=...&type=recovery` bhejta hai aur page new-password form kholta hai. App original bearer ko server par verify karta hai; refresh token retain/send nahi karta. Recovery credentials address bar/history se hata di jaati hain. Invalid/expired/reused links par naya email request karein. Success ke baad purane app sessions invalidate hote hain aur fresh login chahiye. Existing account ko dobara register karne ki zaroorat nahi. See `RECOVERY-FIX.md`.

## 2. Supabase Auth email via Resend SMTP

Resend mein apna sending domain verify karein aur uske required DNS records complete karein. Domain ke verified address ko sender banayein. Gmail support address ko verified SMTP sender assume na karein.

Supabase Auth ki custom SMTP settings:

- Host: `smtp.resend.com`
- Port: `465`, SSL
- Username: `resend`
- Password: authorized Resend API key
- Sender email/name: apne verified domain ka address aur Booyahstudio

Resend dashboard integration bhi SMTP configure kar sakti hai. SMTP settings Supabase mein save honi chahiye; hosting ka RESEND_API_KEY alone Auth emails configure nahi karta. Auth rate limits aur delivery logs check karein. Sensitive Auth links ke liye link tracking disable rakhein.

## 3. Private product ZIPs

- Supabase Storage bucket `products` private rahe.
- Har active catalog product ke liye exact `<product-id>.zip` root object upload karein.
- `private-product-uploads/upload-manifest.json` mapping/checksums owner release mein verify karein; owner-only ZIPs is public repository update mein add nahi ki gayi hain. Existing owner copies ya admin Products upload use karein.
- New product add karne par uski matching ZIP privately upload karni hogi. Checkout missing ZIP par payment start nahi karega.
- Download links 60 seconds ke signed links hain; purchaser/session/active entitlement required hai. Link generation log actual completed download ka proof nahi hai.

## 4. Cashfree

1. Merchant account ka correct single-seller digital-template business/KYC aur website approval complete karein.
2. Pehle sandbox keys use karein. Hosting variables:
   CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV=`sandbox`, CASHFREE_API_VERSION=`2026-01-01`.
3. Production ke liye matching live keys aur CASHFREE_ENV=`production`; domain whitelisting complete karke redeploy karein. Preview ko live credentials/data na dein.
4. Payment/refund webhook: `APP_URL/api/payments/cashfree/webhook`. Dashboard mein PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK aur REFUND_STATUS_WEBHOOK events configure karein. Signature verification exact raw body par Cashfree PG secret key se hoti hai.
5. Dispute webhook: `APP_URL/api/payments/cashfree/disputes/webhook`; DISPUTE_CREATED, DISPUTE_UPDATED aur DISPUTE_CLOSED events enable karein.
6. Cashfree configured ho to customer checkout use prefer karta hai. Historic verified Razorpay purchases aur reconciliation supported hain. PayU/Paddle aur retired Easebuzz checkout current flow mein available nahi hain.
7. Success redirect proof nahi: server provider API se order/payment/refund verify karke atomic access deta hai. Test transactions paid files nahi kholti.
8. Admin Orders mein actual provider se Verify action use karein. Cashfree dispute panel se case refresh, PDF review aur explicit reviewed submission kar sakte hain. Is app mein automatic refund initiation/acceptance/arbitration nahi hai.
9. Confirmed funding-payment partial refunds item allocation ke review mein aate hain. Small partial refund unrelated items ko automatically revoke nahi karta. Admin exact per-item paise amounts aur reason record kare; fully refunded item restrict hota hai. Full funding refund sab affected access revoke karta hai. Duplicate captured payment ki refund original purchase cancel nahi karti.
10. Cashfree fees/risk limits/settlement holds provider control mein hain. Records/evidence account suspension ya settlement release guarantee nahi karte.

## 5. Order emails via Resend API

- Hosting par RESEND_API_KEY aur RESEND_FROM_EMAIL set karein. Sender verified domain ka ho.
- Successful verified live payment aur available access ke baad email mein order, products, amount, payment reference, account/download link aur support details jaati hain. ZIP attachment ya permanent source link nahi.
- Stable provider idempotency aur database claims repeated events se duplicates prevent karte hain. Email failure purchase access cancel nahi karti.
- Resend webhook URL: `APP_URL/api/emails/resend/webhook`; us endpoint ka signing secret RESEND_WEBHOOK_SECRET mein set karein.
- Events: email.sent, email.delivered, email.delivery_delayed, email.bounced, email.failed, email.complained, email.suppressed.
- API acceptance aur inbox delivery alag statuses hain. Auth emails order emails mein mix nahi hote.

## 6. Background reconciliation/retries

Hosting par strong CRON_SECRET configure karein. Apne scheduler se har 5 minute (plan/support ke hisaab se) yeh request bhejein:

```text
GET APP_URL/api/jobs/reconcile
Authorization: Bearer YOUR_CRON_SECRET
```

Endpoint bound pending/failed aur paid/partially refunded Cashfree orders rotate karke reconcile karta hai, taaki missed payment/refund webhooks recover ho sakein; due email retries bhi process hoti hain. Webhooks primary immediate flow hain. Scheduler externally configure karna zaroori hai; ZIP deployment kisi paid cron plan ko assume nahi karta. Route unauthorized calls reject karta hai. Bounded batches ko monitor karein; growing volume par dedicated queue/worker use karein. Resend ke idempotency window ke near uncertain emails manual review mein rukte hain; blindly resend na karein.

## 7. Hosting and launch check

Node 24, project-pinned pnpm version aur frozen lockfile use karein. `pnpm typecheck`, `pnpm test`, `pnpm build` run karein. Express/API runtime required hai; static-only preview backend ko replace nahi kar sakta. Existing Vercel routes aur private-output boundary retained hain.

Verify real setup ke baad:
- Signup -> confirmation -> email/password login; mobile OTP kahin nahi.
- Confirmation resend aur invalid/expired links.
- Forgot-password email -> new-password page -> reset -> old password rejected/new password accepted.
- Browser close ke baad verified payment se account access.
- Correct ZIP, wrong-user denial, pending/failed/sandbox access denial.
- Resend accepted vs delivered/bounced status.
- Provider-confirmed partial/full refunds and reviewed allocation.
- Dispute deadline/evidence acknowledgment and retry alerts.

Local/mock tests ke results `IMPLEMENTATION-NOTES.md` mein diye gaye hain. Actual Supabase, SMTP, Cashfree activation aur bank settlement ko apne real accounts se verify karna baki hai.

Official references:
https://supabase.com/docs/guides/auth/auth-email-templates
https://supabase.com/docs/guides/auth/auth-smtp
https://www.cashfree.com/docs/payments/online/web/redirect
https://www.cashfree.com/docs/payments/online/webhooks/signature-verification
https://www.cashfree.com/docs/api-reference/payments/latest/disputes/dispute-webhooks
https://www.cashfree.com/docs/api-reference/payments/latest/disputes/submit-evidence-to-contest-the-dispute-by-dispute-id
