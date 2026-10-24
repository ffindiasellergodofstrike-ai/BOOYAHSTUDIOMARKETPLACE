# Customer website design refresh

The customer site now shares a warm ivory, olive and burnt-orange design across the home page, collection, product details, account, cart, checkout, support and policy pages. Product information, prices, merchant identity and policy content are unchanged.

Customer-facing labels use plain language: account, orders, purchases and downloads. Forms show real pending states, prevent duplicate submission and provide completion/error feedback. The fixed 450 ms navigation delay and blocking page overlay are removed. Mobile navigation and dialogs support Escape, focus restoration and keyboard focus containment. Animation respects reduced-motion preferences.

Verification:

- TypeScript check and production build pass, including native Vercel API startup checks.
- All 138 automated tests pass, including password recovery, payment/refund access, email retries and HTML escaping.
- Built catalog check verifies 25 product pages, 80 demo pages, four policy pages and private-source boundaries.
- Chromium checks at 1440, 768, 390 and 360 px cover customer routes, menu/search behavior, pending auth/contact forms, populated cart/checkout and payment-result states. Synthetic API fixtures were used; no real payment, customer account, email or support request was created.

The branded Supabase confirmation and password-reset email bodies are in [email-templates](email-templates/README.md). Paste these into Supabase Authentication → Emails → Templates to apply their appearance; a GitHub/Vercel deploy does not change Supabase-hosted templates. Existing link placeholders and the website's working recovery flow are preserved. New application order/refund emails include branded HTML automatically; existing frozen retry payloads are unchanged.
