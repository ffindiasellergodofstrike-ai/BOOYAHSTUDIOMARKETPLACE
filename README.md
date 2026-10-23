# Booyahstudio Marketplace

Independent marketplace project based on the Booyahstudio storefront. It preserves the existing design, Supabase email/password authentication, password recovery, 25 original company products, protected downloads, order email delivery and server-verified admin access. The original storefront repository remains separate.

## Included

- Creator directory, storefronts, onboarding, encrypted payout details, private ZIP uploads, draft listings and admin moderation.
- All existing products published by **Booyahstudio**. Independent creators retain copyright in their work.
- Creator paid plans and creator-specific customer memberships, verified paid periods, cancellation and expiry. Free Starter is available; paid creator plans start unpublished until the owner configures prices and enables them.
- Cashfree, Razorpay and Easebuzz adapters, with admin controls for enabled/default providers after credentials and approvals are configured. Historical orders, refunds and subscriptions stay with their original provider.
- Approved marketplace split flows: Cashfree Easy Split, Razorpay Route and Easebuzz Slices. Separate marketplace activation and verified seller references are required.
- Verified payment fulfillment, Resend order email with download links, short-lived private download URLs, refunds, dispute evidence, reconciliation and audit controls.
- Responsive customer, creator and admin screens; loading/error/retry states; public SEO HTML, canonicals, sitemap and private-page noindex.

## Run and verify

Use Node **24.x** and pnpm **10.34.5**.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Configure a separate Supabase project and apply SQL in the order in the [deployment guide](docs/marketplace/DEPLOYMENT.md). Public browsing works without credentials; account, admin and financial operations require configured services and fail closed when unavailable. Do not point this development project at the original store’s production database.

```sh
pnpm typecheck
pnpm test
pnpm build
```

## GitHub → Vercel

Import this repository as a separate Vercel project. Set `APP_URL` and public `VITE_SITE_URL` to the final HTTPS origin. Configure server credentials, Supabase redirect URLs, private company product files, payment and Resend webhooks, and scheduled reconciliation. Redeploy after changing environment settings. Follow [deployment and activation instructions](docs/marketplace/DEPLOYMENT.md).

No live credentials, private database contents or paid ZIP archives are included. Admin switches do not create provider accounts, complete KYC, migrate mandates, or guarantee approval or settlements. Easebuzz automatic subscription renewal is unavailable without a documented, approved integration; manual renewal is explicitly identified.

## Documentation

- [Implementation contracts](docs/marketplace/CONTRACT.md)
- [Deployment, official provider references and activation](docs/marketplace/DEPLOYMENT.md)
- Public Terms, Refund, Privacy, Disclaimer and Creator Agreement: `src/data/policies.json`, versioned with checkout acceptance.

Platform operator: **MANISH KUMAR SONKAR**, Owner of **Booyahstudio**. Support/grievances: **connectbooyahstudio@gmail.com**, WhatsApp **+91 7393845435**. Address: **S-8/88 A-1, Panchkosi Road, PURANI CHUNGI, SHIVPUR, Varanasi, Varanasi, Uttar Pradesh, 221003**.
