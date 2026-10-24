# Booyahstudio migration

- One directly operated digital-products store, with supplied merchant identity and grievance details.
- Supabase email/password authentication and token-verified recovery, server-only PostgreSQL storage and private product ZIPs.
- Razorpay order creation, signature verification, capture/amount/currency checks, webhook reconciliation and refund-state handling.
- Atomic payment fulfilment prevents duplicate purchase records and preserves refund/revocation restrictions.
- Resend order notifications; Supabase SMTP instructions for confirmation/recovery mail.
- Nineteen policy routes, copy-ready documents, policy HTML and updated search metadata.
- Retired product preview/source files are kept privately for the owner.

Production readiness still requires provider configuration, files, domain, real email checks and controlled live payment/refund verification. This source update does not itself deploy the website or verify GST registration. See DEPLOYMENT.md and VALIDATION.md.
