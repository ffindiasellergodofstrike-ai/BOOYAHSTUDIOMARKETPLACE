# Cashfree website/readiness verification — 23 October 2026

Scope: current repository source and local production build. The requested MANISH KUMAR SONKAR merchant identity is checked across policy headers/body, visible About/Contact/Footer, receipts, email and SEO. Original copyright ownership is stated without taking ownership of third-party licenses.

Verified changes:

- Explicit digital delivery, refund/cancellation exceptions and timelines, grievance acknowledgement/resolution and support-contact disclosures; synchronized policy documentation and new content-hash version.
- Server-side Cashfree minimum INR1 validation before a provider request; existing signed-webhook, amount/currency/reference verification, atomic replay/refund and live/test-isolation paths retained.
- Item-level restricted access is honored even when an older purchase record remains active. Invalid download-order selectors are rejected; ownership, rate limits and short-lived signing are covered.
- Branded order email links directly to Downloads; strict symbolic login return hints preserve the destination without accepting arbitrary redirect URLs. Refund email links to Orders. Confirmed partial/full-refund receipts work without restoring download access.
- Durable email delivery re-reads the stored order, freezes/deduplicates payloads and preserves retry handling. API acceptance is distinct from actual Resend delivery.
- Contact form returns only a receipt of the newly validated, persisted request. The customer can view/download that copy; storage failures do not falsely acknowledge a complaint.
- Readable public HTML, current public product metadata, real404 responses, policy301 aliases, private/demos noindex, safe routing and active-only sitemap. Policy dictionaries do not accidentally treat inherited JavaScript object keys as routes.
- Daily authenticated Vercel reconciliation fallback, with prompt5-minute retry scheduling documented separately for supported/external schedulers.

Validation completed:

- Full TypeScript check passes.
- All149 automated tests pass, including Cashfree HTTP/SQL, refunds/access, auth/recovery, email delivery/escaping/retry, receipts, support persistence, policy identity and SEO HTTP cases.
- Production build and native Node/Vercel entrypoint checks pass: health, safe unconfigured/errors, raw signed webhook, productGET/HEAD/405, public HTML/404/301 and simulated Supabase lifecycle.
- Built product/demo/policy/private-source boundaries pass:25products,80newdemo pages and4canonicalpolicies.
- Chromium:27merchant/policy layout renders at1440/390/360px, plus Contact receipt/copy, signup confirmation/login/forgot return hint and protected download outage/retry. No uncaught JavaScript errors or document overflow observed.
- Compiled production HTTP:11publicpages/product/category with readable content and correct canonical/identity;6policyredirects;4unknown404paths;11private noindex paths;robots/sitemap andHEAD behavior.

Synthetic API fixtures were used for purchase/account/email tests. No real payment, customer account, support request, email or hosted database operation was created. Production credentials, provider dashboard configuration, private uploads, genuine inbox delivery and Cashfree activation remain unverified here. Vercel deployment status is checked separately after the commit is pushed. See [Cashfree readiness guide](../../CASHFREE-READINESS-HINDI.md) for exact production setup and official references.
