# Booyahstudio Marketplace

Independent marketplace project based on the Booyahstudio storefront. It preserves the existing design, Supabase email/password authentication, password recovery, 25 original company products, protected downloads, order email delivery and server-verified admin access. The original storefront repository remains separate. This fix integrates the user’s bda3899 changes and preserves the updated design and /store/<slug> URLs.

## Included

- Creator directory, storefronts, onboarding, encrypted payout details, private ZIP uploads, draft listings and admin moderation.
- All existing products published by **Booyahstudio**. Independent creators retain copyright in their work.
- Creator paid plans and creator-specific customer memberships, verified paid periods, cancellation and expiry. Creator costs ₹499/month for 10 new products per verified paid period; Studio costs ₹899/month for unlimited product count and premium creator features. Product files are limited to 10 MB and available platform storage.
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

- [Agreements, Topmate comparison and gateway approval risks](docs/marketplace/TOPMATE-AND-PAYMENT-READINESS.md)
- [Release validation](docs/marketplace/VALIDATION.md)
- [Implementation contracts](docs/marketplace/CONTRACT.md)
- [Deployment, official provider references and activation](docs/marketplace/DEPLOYMENT.md)
- Public Terms, Refund, Privacy, Disclaimer and Creator Agreement: `src/data/policies.json`, versioned with checkout acceptance.

Platform operator: **MANISH KUMAR SONKAR**, Owner of **Booyahstudio**. Support/grievances: **connectbooyahstudio@gmail.com**, WhatsApp **+91 7393845435**. Address: **S-8/88 A-1, Panchkosi Road, PURANI CHUNGI, SHIVPUR, Varanasi, Varanasi, Uttar Pradesh, 221003**.

Earlier top-level setup/audit documents were carried from the original storefront as migration background. For this independent marketplace, use the current `docs/marketplace` guides and active `creatorMarketplace`, `gatewayControl`, `gatewaySplits`, `subscriptions` and `disputeAutomation` modules. Legacy Firebase/Easebuzz-only scaffolding is retired and is not mounted.

## Fix release: 24 October 2026

Run `pnpm setup:sql` to prepare reviewed fresh/upgrade SQL, then apply the appropriate output in Supabase SQL Editor. Run `pnpm setup:check` and `pnpm setup:check --online` to check configuration without printing keys. Supabase modern secret/publishable names and legacy service-role/anon names both work; the HTTPS SDK does not require POSTGRES_PASSWORD.

Free commercial hosting instructions: [Netlify setup](docs/marketplace/DEPLOY-NETLIFY-HINDI.md). Vercel deployment remains supported for an eligible commercial plan. No live hosting or merchant activation was performed.

New seller files and direct HTTPS ZIP links use private Storage imports with a 10 MB ingress cap. New sales deduct ₹20 per item. Settlement controls use actual approved provider capabilities: Razorpay bank Route holds/release; Cashfree approved schedule monitoring/manual risk review; unsupported Easebuzz third-party reserve and UPI payout routes remain blocked. A ledger entry or elapsed 120 days never proves bank settlement or automatically resolves an open legal hold.
