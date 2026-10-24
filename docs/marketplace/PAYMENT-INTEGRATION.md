# Payment integration and activation

This project has three purchase adapters: Cashfree PG, Razorpay Checkout and Easebuzz hosted checkout. They are integrations, not promises of merchant, marketplace, recurring-product or seller approval. No live payment was made during implementation.

All new gateways default to disabled. Configure credentials on the server once, finish provider onboarding, then use the admin Gateways screen to enable an available provider and choose the default. Commission is recorded in integer paise on each creator order; later admin changes do not rewrite an existing order. Company products from Booyahstudio use normal PG checkout with no creator split.

The settings are stored under `marketplace/gateway-settings`, alongside an audit entry in the same store transaction. Admin APIs never accept credentials or arbitrary capability/approval flags. Disabling a gateway blocks new checkout while its existing reconciliation, signed callbacks and refunds continue to use the original order provider. Keep its credentials and the matching live/test environment configured while historical orders or mandates still need reconciliation. A gateway switch does not migrate subscriptions or mandates.

## Creator settlement prerequisites

- Cashfree requires separately activated Easy Split (`CASHFREE_EASYSPLIT_APPROVED=true`). The server fetches the vendor from `easy-split/vendors/{vendor_id}` and requires an active vendor whose bank number and IFSC match the creator’s submitted KYC. Order creation passes the immutable seller amount through `order_splits`.
- Razorpay requires activated Route (`RAZORPAY_ROUTE_APPROVED=true`). The admin supplies the linked account and Route product reference. The server fetches the product configuration through Razorpay v2 and requires an activated Route product for that account, with matching bank details. Orders include `transfers` in paise. The product reference is retained in the server-only verified provider record.
- Easebuzz requires Slices activation (`EASEBUZZ_MARKETPLACE_APPROVED=true`). Its official integration kit documents `split_payments` as a label-to-rupee-amount map. Labels must be issued and approved by Easebuzz for the actual bank account. Public submerchant lookup documentation could not be reliably verified, so this build does not invent an onboarding/verification API. Install the provider-confirmed registry in the server environment, then verify the creator binding in admin. The registry is not an admin approval checkbox.

Example registry structure (replace every example with real provider-confirmed data):

```json
{
  "CREATOR_ID": {
    "label": "PROVIDER_ISSUED_BANK_LABEL",
    "environment": "live",
    "accountLast4": "1234",
    "providerConfirmedAt": "2026-10-23T00:00:00.000Z"
  }
}
```

Set this JSON as `EASEBUZZ_APPROVED_SPLIT_LABELS_JSON`. The label and final four bank digits must match that creator. No creator bank details or decrypted KYC are returned by the gateway-control APIs. New third-party checkouts recheck provider activation and the seller reference before requesting payment. The earnings ledger is not evidence that a bank settlement has occurred.

## Payment confirmation and delivery

Cashfree and Razorpay keep their existing signed-webhook plus provider-lookup verification, atomic financial transitions and refund handling. All adapters call the creator ledger hook only after saving a canonical financial result. Emails are independent of financial acceptance and use the existing durable email workflow.

Easebuzz initiation posts a SHA-512 signed form to its fixed live/test host. The hosted URL is constructed only from a valid 64-character access key. Return and webhook forms require reverse-hash verification and are followed by an independent signed Transaction V2 lookup. The returned transaction, merchant key, order UDF, email, phone, product description, amount and environment must match the bound order. Browser success text never grants access. A service-only PostgreSQL RPC binds the transaction and confirms payment under a database lock, enforces unique payment references and grants files only for a verified live success. Duplicate or concurrent callbacks cannot duplicate purchases. Test payments never unlock files.

Easebuzz callback paths are `/api/payments/easebuzz/return` and `/api/payments/easebuzz/webhook`. Configure the provider webhook as supported for the account. The return callback redirects to the normal checkout confirmation page; that page reconciles with the server. Account-level delivery/download and email delivery statuses come from the application; they are not automatically communicated to every gateway as settlement evidence.

## Refunds, disputes and recurring payments

Existing Cashfree refund/dispute APIs and Razorpay refund/dispute verification remain active for historical orders when a gateway is disabled. Creator split refunds must account for vendor adjustments or Route transfer reversals; an ordinary merchant refund is not proof that a seller transfer was reversed. Use provider-supported operations and reconciliation before marking money as returned or settled.

The Easebuzz official kit documents refund initiation/status endpoints, but publicly verifiable response/settlement schemas were insufficient to add an automatic refund or dispute submission workflow safely. These operations require the provider dashboard/support workflow. A refund indication in a verified transaction lookup restricts further download access and records a review requirement rather than silently treating the payment as unrefunded. Do not claim automated Easebuzz dispute submission or bank settlement confirmation.

Automatic recurring billing needs its own activated subscription product. Cashfree and Razorpay subscription capability flags are separate from PG/marketplace activation. Easebuzz plans are explicitly manual renewal in this build. A mandate authorization, generic subscription status or an admin toggle never grants a paid period without a matching verified charge.

## Primary references checked

- Cashfree Create Order: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order
- Cashfree Easy Split: https://www.cashfree.com/docs/api-reference/payments/latest/split/easy-split-overview
- Cashfree vendor lookup: https://www.cashfree.com/docs/api-reference/payments/latest/easy-split/get-vendor-all-details
- Razorpay Route order transfers: https://razorpay.com/docs/api/payments/route/create-transfers-orders/
- Razorpay Route configuration lookup: https://razorpay.com/docs/api/payments/route/fetch-product-config/
- Easebuzz official integration kit: https://github.com/easebuzz/paywitheasebuzz-php-lib
- Easebuzz hosted initiation: https://github.com/easebuzz/paywitheasebuzz-php-lib/blob/master/easebuzz-lib/initiate_payment.php
- Easebuzz Transaction V2 lookup: https://github.com/easebuzz/paywitheasebuzz-php-lib/blob/master/easebuzz-lib/transaction.php
- Easebuzz refund/status: https://github.com/easebuzz/paywitheasebuzz-php-lib/blob/master/easebuzz-lib/refund.php and https://github.com/easebuzz/paywitheasebuzz-php-lib/blob/master/easebuzz-lib/refund_status.php
- Easebuzz Slices: https://easebuzz.in/slices/

Synthetic tests cover signatures, amount/reference/environment mismatches, admin switching and readiness, provider-issued seller references, concurrent/replayed callbacks, refunds and test/live entitlement isolation. Production onboarding and a sandbox end-to-end test with the actual merchant account remain deployment requirements.

## Refund automation boundaries

Cashfree supports confirmed per-item allocation for partial refunds. The inherited Razorpay refund path conservatively restricts the affected order after a nonzero refund; it does not implement Cashfree-style per-item allocation. Easebuzz refund indicators require provider review and do not establish a confirmed refund or transfer reversal. Do not advertise automatic per-item refunds or fully automated dispute submission for all three providers. Cashfree evidence submission requires a reviewed document; Razorpay/Easebuzz provider-dashboard actions remain explicit where implemented APIs are unavailable.

Tax output is a payment receipt, explicitly not a GST tax invoice. This project is not an automated GST/TDS/TCS compliance engine. Resolve the applicable registrations, seller invoicing and any withholding/reporting obligations before enabling third-party live sales; provider approval does not itself complete those obligations.
