# Validation and launch status

> Historical validation supplied with the original project. Current 23 October 2026 results are in `IMPLEMENTATION-NOTES.md` and `docs/verification/current-results.txt`; current provider setup is in `SETUP-HINDI.md`.

Validated on 5 October 2026 against base commit `9e434ad1d993c3aac1760833bf122b35d7a66ab1` plus the included changes.

## Passed

- Node 24.14.1, pnpm 10.34.5: TypeScript check and production build.
- Automated test suite: 28 tests passed, covering signatures, mismatched amounts/currency/orders, test-payment isolation, ownership checks, refund/revocation ordering, duplicate fulfilment, SQL role isolation, verified recovery invalidation, guest-cart persistence, catalog and receipts.
- The actual PostgreSQL functions execute in PGlite. HTTP integration uses synthetic Razorpay and Supabase Auth/Storage responses and real store SQL. This is not a live provider certification.
- All 80 source pages of the 20 static templates passed local asset/script structure checks. Existing imported product functionality has not been exhaustively retested.
- Production build generates 51 public metadata pages and sitemap/robots; 19 policy pages also contain readable static policy text.
- Shared Chromium: 97 route/viewport combinations (61 desktop routes at 1440px; 18 representative layouts each at 390px and 768px). No horizontal overflow or broken loaded images; private/search/missing pages have noindex. Earlier unchanged guest-cart browser persistence evidence is retained; automated cart/logout regression passed again.
- Resend SDK sent three synthetic order/test/refund notices to CodeRabbit's pinned v0.0.1 email emulator with actual local SQL, concurrent-attempt deduplication and unpaid-email suppression, and retrieved them locally. No real email was sent.
- ZIP integrity checks for product packages and final archive; no `.env`, Git internals, customer database or dependencies in the delivery archive.

## Remaining before production

Configure the owner’s Supabase, Razorpay, Resend, GitHub and Vercel accounts, private files, sender DNS, Supabase SMTP/templates and exact domain. Test confirmation/recovery in a real inbox, a controlled captured live payment, file receipt and refund processing after deployment. Provider account approval is outside the code package.

The emulator catalog does not include Razorpay or Supabase. Their live flows remain unverified against owner credentials. Firefox, Safari, Edge and physical iOS/Android devices were not exercised here; no universal browser guarantee is made.

Confirm GST pricing/classification/rate and the invoice process before selling. The application currently provides payment receipts, not tax invoices. Merchant details are shown as supplied, not independently certified.

The build reports a JavaScript bundle-size warning above 500 kB. The small-store database uses a single locked JSON row for atomic writes; monitor size/load and migrate to indexed per-entity tables before high volume. Contact-form records and newsletter opt-outs require owner review as described in DEPLOYMENT.md.

The latest follow-up also verifies signup/login/logout with simulated Auth responses, failed/pending attempts, duplicate-payment refund isolation, dispute restrictions/restoration, a private-bucket upgrade over an initially public bucket, and restrictive RLS alongside a broad old object policy. See FINAL-AUDIT.md for the complete before/after requirement matrix.
