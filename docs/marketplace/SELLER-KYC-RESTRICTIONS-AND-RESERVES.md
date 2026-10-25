# Seller KYC, restricted products and reserve policy

Reviewed **24 October 2026**. The current public Terms, Privacy and Creator Agreement in `src/data/policies.json` are the customer-facing source. This document explains the source comparison and operating limits; it does not establish provider activation or a government KYC verification.

## PAN and the Topmate comparison

The owner confirmed that PAN/KYC applies to **sellers who earn proceeds**, not ordinary buyers. Buyer accounts retain the email/password login flow. Seller PAN, legal/tax and registered payout details belong in the private onboarding workflow. Submitted PAN format is not itself completed identity verification. Provider-verified seller activation and platform listing approval remain different states.

Topmate’s [public privacy notice](https://topmate.io/privacy), last revised 10 September 2026, names Razorpay, Payglocal and PayPal for payment data. It does **not** establish a complete seller-PAN collection flow, exact verification recipient, retention period or storage location. Its reference to payment data must not be treated as proof that one specific company verifies PAN or that every buyer must supply PAN. No claim that Booyahstudio copies an undisclosed Topmate PAN workflow is made. Use the actual contracted gateway’s approved seller onboarding instead.

For this project, seller legal/PAN/payout inputs are encrypted before server-side Supabase persistence. Public business/contact disclosures are a separate, consented set of fields; they do not publish the private PAN/bank values. Additional documents should be collected only when necessary for the actual approved verification purpose, through an appropriately private workflow. Do not put PAN images in product archives, public file links, transactional emails or routine logs. The configured Supabase project region and provider contracts determine processing locations; no unverified Mumbai/India-only storage promise is made.

## What the official prohibited lists establish

| Source | Important implications for this digital marketplace |
| --- | --- |
| [Cashfree merchant terms, Attachment A](https://www.cashfree.com/tnc) | Its negative, risky and restricted categories include unlawful/infringing products and categories that can be restricted despite being lawful. Business-model changes are not implicitly approved merely because old credentials continue to work. |
| [Razorpay terms, prohibited list and submerchant obligations](https://razorpay.com/terms/) | The platform must perform the applicable seller due diligence, ensure submerchants comply with the service rules and restrict prohibited goods/services. Route activation is separate from accepting ordinary merchant payments. |
| [Easebuzz terms, prohibited categories](https://easebuzz.in/terms/) | The public list covers infringement, bulk spam, chance/gambling products, misleading claims and other restricted models; the categories also include specific businesses outside this digital-only store. [Its disclaimer](https://easebuzz.in/disclaimer/) separately states its real-money gaming restriction. |

The public policy therefore bans unlawful/infringing content, malicious or stolen-data products, adult/exploitative content, prohibited physical goods, gambling/deceptive schemes and unapproved regulated products. It expressly distinguishes **platform/provider restrictions** from a legal conclusion that every category is always illegal. The list is not exhaustive; actual current provider approval and category rules control checkout. A generic code template is not permission to run a prohibited live business. Each new seller/listing must be reviewed against the real offering, not just a keyword in its title.

Do not claim that all digital downloads are automatically approved or that switching the default provider bypasses a declined category. Maintain actual ownership/licence evidence and the provider’s written marketplace/category activation. Seller suspension should prevent new sales as appropriate without deleting buyer orders or legitimate refund obligations.

## Three-day eligibility and 120-day review

The standard platform target is **72 hours after both the canonical verified live payment and digital access**. The provider’s approved hold/release capability controls whether that target can be implemented. Bank credit, hold-release acceptance and an internal payable ledger are different events. Registered bank settlement is the default supported beneficiary model; UPI requires a separately approved payout capability and verified destination. Paying both the bank account and UPI for the same sale would be a duplicate payout, not a second entitlement.

A justified risk case records its reason, affected/proportionate unsettled exposure, notice, opened date, target review date and next action. The initial review target is up to **120 calendar days** from restriction, not an automatic penalty or forfeiture. Complaints can justify investigation, but are not a final fraud finding. There must be an evidence/appeal route. Expiry triggers review; unresolved binding legal/provider holds do not automatically vanish. Resolved eligible proceeds may enter the approved release process without necessarily re-enabling new seller sales. A local flag cannot freeze money already credited to a bank or undo a provider transfer.

Topmate’s current official [payout guidelines](https://topmate72420835211887570.freshdesk.com/support/solutions/articles/1070000141051-topmate-payout-guidelines), modified 21 October and effective 22 October 2026, describe reviewed INR withdrawals processed within seven days, with bank-holiday/third-party timing caveats. That is **not** evidence that all marketplaces can promise automatic three-day bank credit. Its statements about its review process must not be copied as a universal legal mandate for every provider.

## Plans and charges disclosed in this build

- ₹499/month: 10 **new product creations** per verified paid monthly period; draft creations count and deleting does not reset the allowance.
- ₹899/month: no product-count limit and the implemented higher-tier seller tools, including customer-membership offer creation. It does not grant admin access or unlimited infrastructure resources.
- Product ZIP maximum: **10 MB = 10,485,760 bytes**, plus actual disclosed storage/traffic capacity. A safe direct-link import is privately copied and reviewed; the external URL is not a paid download entitlement.
- Independent-creator commission: **₹20 per paid digital item**, separate from the plan. Disclosed provider fees, tax obligations and verified refund/dispute adjustments remain applicable.

Historic accepted order/plan/agreement snapshots must remain immutable. Material new terms require prospective acceptance. No subscription plan is sold as approval, income, limitless storage or guaranteed settlement. Tax output remains a payment receipt, not automatic GST/TDS/TCS compliance.
