# Creator plans and customer memberships

Both modules use Supabase's **service-role-only** `subscription_operation` RPC and the isolated `marketplace_billing_state` ledger. Apply `supabase/migrations/202610230004_subscriptions.sql` after the main store schema. The application does not fall back to a local file or Firebase when billing storage is unavailable.

Creator plans increase a creator's listing limit only during a verified, live paid period. The free Starter limit is 5. Creator (25) and Studio (100) are seeded as **unpublished drafts** with placeholder prices; the operator must review the amount, features, billing mode and publication before offering them. Existing creator/customer login is reused.

Customer memberships belong to one approved creator. A verified, live paid period unlocks only that creator's active listings explicitly marked `membershipEligible: true`. Memberships do not become permanent product purchases, do not unlock another creator's files, and stop unlocking downloads on expiry, refund, dispute restriction or creator suspension. An ordinary purchased-product entitlement remains separate.

## Implemented capabilities

| Provider | Creator paid plans | Customer creator memberships |
|---|---|---|
| Cashfree | Manual period payments; native PERIODIC subscriptions after activation | Manual payments with Easy Split; native PERIODIC subscriptions with approved subscription splits |
| Razorpay | Manual period payments; native Plans + Subscriptions after activation | Manual period payments with Route order transfers |
| Easebuzz | Manual period payments through hosted checkout | Manual period payments with activated Slices and provider-issued bank label |

Razorpay automatic third-party membership transfers and Easebuzz automatic billing are deliberately unavailable in this version. They must not be represented to a customer as automatic renewal. A manual plan charges one period only and requires the customer to actively pay again. Native Razorpay creator-plan billing uses the documented subscription checkout; a bare `active` subscription status never grants access.

Cashfree automatic checkout requests a **refundable ₹1 mandate authorisation**. It does not grant plan access. Access begins only after a full successful CHARGE is fetched and verified. Cashfree's earliest first debit depends on authorisation time and payment method (UPI/card can be T+1/T+2, eNACH can be T+4). The confirmation dialog explains this before checkout opens.

## Activation and immutable contracts

Credentials are configured on the server once. Admin gateway settings enable/disable new checkout and select the preferred available gateway. Existing subscriptions retain their original provider, environment, plan amount, listing limit, interval and seller split snapshot. Changing the default gateway or editing a plan does not migrate an existing mandate or change its price. Existing callbacks, refunds, reconciliation and cancellation continue after a gateway is disabled for new checkout.

Native creator-plan billing additionally requires `CASHFREE_SUBSCRIPTIONS_APPROVED=true` or `RAZORPAY_SUBSCRIPTIONS_APPROVED=true` after the provider activates the relevant product. Customer collections also require the applicable marketplace capability, verified creator payout account, and a fresh provider verification before checkout. Cashfree automatic customer memberships additionally require `CASHFREE_SUBSCRIPTION_SPLITS_APPROVED=true`. These flags record external merchant activation; they cannot grant it.

Plan publication is controlled by the admin. Approved creators can create and edit their own customer offers; creation or editing returns the offer to unpublished review. Creators cannot self-approve offers or edit another creator's plan. Existing paid subscriptions retain their original immutable plan snapshot.

## Lifecycle and recovery

- Checkout amounts are looked up from the server plan. The browser supplies a plan ID, never a price, creator entitlement or paid flag.
- Durable checkout leases prevent simultaneous mandate creation. An uncertain native request is reconciled before another mandate is attempted. Razorpay recovery searches provider records by the server-generated billing reference; unmatched requests remain pending for support rather than being charged again blindly.
- Cashfree native payments require CHARGE/SUCCESS and the exact bound subscription amount. Razorpay native access requires a paid invoice, its bound subscription, exact INR total, invoice billing period and captured payment. Manual payments require a server-created billing attempt and its immutable period/order binding.
- Provider payment IDs are unique across subscriptions. Payment retries and duplicate webhooks cannot add a second period from the same payment. Refund/dispute restrictions are monotonic; a later successful-payment replay cannot restore a revoked receipt.
- Cancellation stops future renewal. Access already paid for lasts to its own period end. Failed or overdue collections do not extend access. A bank-side cancellation or completed/expired native subscription is reconciled as stopping renewals.
- The reconciliation job calls `reconcileSubscriptions(limit = 20)`, retries pending webhook events and refreshes existing subscriptions in oldest-check order. The root notification cron invokes this job. Persisted events are marked done only after a verified provider snapshot is committed.
- Access helpers refresh payment verification after 15 minutes; an unavailable provider fails closed for that refresh. Keep the authenticated reconciliation cron enabled and watch its `failed` count.
- Subscription records are separate from product orders. They do not trigger the product download-email outbox. Membership files are available in the account's membership/download section; product-order Resend emails continue through the existing order fulfilment flow.

Webhook URLs (POST, exact raw body signatures required):

```
/api/marketplace/subscriptions/webhooks/cashfree
/api/marketplace/subscriptions/webhooks/razorpay
```

Easebuzz hosted return URL (signed callback plus server lookup):

```
/api/marketplace/subscriptions/easebuzz/return
```

Select subscription lifecycle/payment/refund events in the corresponding provider dashboard. A callback is a verification hint, not proof of access. Store and fulfilment do not trust query parameters or an SDK success callback. Provider activation, live mandate setup, emails, refunds and payouts were **not** performed against real accounts during development.

## Relevant official documentation

Reviewed 23 October 2026:

- [Cashfree subscription lifecycle and first-charge rules](https://www.cashfree.com/docs/payments/subscription/create)
- [Cashfree Create Subscription API, including periodic plan fields and subscription payment splits](https://www.cashfree.com/docs/api-reference/payments/latest/subscription/create-subscription)
- [Cashfree maintained OpenAPI SDK models](https://github.com/cashfree/cashfree-pg) (`SubscriptionPaymentEntity`, `SubscriptionPaymentRefundEntity`, create/manage subscription APIs)
- [Cashfree subscription checkout playground](https://www.cashfree.com/devstudio/preview/subs/web/checkout)
- [Razorpay Create Plan](https://razorpay.com/docs/api/payments/subscriptions/create-plan/)
- [Razorpay Create Subscription](https://razorpay.com/docs/api/payments/subscriptions/create-subscription/)
- [Razorpay subscription invoice lookup](https://razorpay.com/docs/api/payments/subscriptions/fetch-invoices)
- [Razorpay subscription checkout integration](https://razorpay.com/docs/payments/subscriptions/integration-guide/)
- [Easebuzz Smartbilling](https://easebuzz.in/smartbilling/) and [Slices](https://easebuzz.in/slices/): product availability is not an implemented public recurring API contract. This implementation uses manual hosted PG renewal and the server-side official SDK lookup documented in the gateway implementation.
