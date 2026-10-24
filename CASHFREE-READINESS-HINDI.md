# Cashfree readiness — 23 October 2026

Website के code और policies की समीक्षा की गई है। इससे Cashfree approval की guarantee नहीं मिलती: entity/KYC, bank details, product category, risk review और live activation का अंतिम निर्णय Cashfree करता है। इस workspace में production Cashfree, Supabase या Resend credentials नहीं हैं; live merchant dashboard, वास्तविक payment और inbox delivery का परीक्षण यहाँ नहीं किया गया।

## Merchant identity

- **MANISH KUMAR SONKAR — Owner of Booyahstudio**
- Address: **S-8/88 A-1, Panchkosi Road, PURANI CHUNGI, SHIVPUR, Varanasi, Varanasi, Uttar Pradesh, 221003**
- Customer support and grievances: **connectbooyahstudio@gmail.com**
- WhatsApp: **+91 7393845435**, https://wa.me/917393845435
- Grievance contact: **MANISH KUMAR SONKAR**, इसी email और address पर।

Storefront के owner/support disclosures में किसी दूसरे व्यक्ति को merchant या grievance contact नहीं बनाया गया है। Product demos के sample characters और editable placeholders merchant identities नहीं हैं। PAN, bank account और private keys website या GitHub पर publish न करें; Cashfree के सुरक्षित dashboard में ही दें।

## Public pages and policies

About, Contact, product descriptions/prices और चार canonical policies मौजूद हैं:

- `/policies/terms`: business identity, payment, digital delivery, copyright/license, support and grievances.
- `/policies/refund`: digital-sale finality, legitimate exceptions, cancellation, duplicate payment and refund procedure.
- `/policies/privacy`: account/payment/support data, service providers, storage and privacy requests.
- `/policies/disclaimer`: technical requirements and limitations, without removing mandatory consumer remedies.

Footer में delivery और copyright links भी हैं। `/policies/delivery`, `/policies/copyright`, `/policies/license` और `/policies/grievance` संबंधित canonical terms पर जाते हैं। Digital-only delivery और shipping fee न होने की बात स्पष्ट है। Verified payment के बाद downloads सामान्यतः तुरंत उपलब्ध होते हैं; delay के लिए 24 hours और support/remedy process बताया गया है। Published grievance targets 48 hours / one month हैं। Refund review, merchant initiation और bank-credit timing अलग लिखे हैं। इन service commitments को वास्तविक business operations में निभाना जरूरी है।

Original Booyahstudio products, designs, source-code contributions और documentation का copyright MANISH KUMAR SONKAR के नाम से स्पष्ट है। Purchase से copyright transfer नहीं होता। Included third-party/open-source libraries और fonts की licenses/required notices अपने-अपने नियमों के तहत रहती हैं।

## Payment → email → download

1. Customer sign in करके checkout करता है; price/discount/total server तय करता है।
2. Cashfree order server पर बनता है। Browser success URL अकेला payment proof नहीं है।
3. Signed webhook/server API verification में order/payment references, successful status, amount, currency और environment मिलते हैं। Duplicate events दोबारा purchase नहीं बनाते। Browser बंद हो तब भी webhook fulfillment कर सकता है।
4. Verified live purchase में account download access मिलता है और durable Resend email notification बनती है। Pending, failed, sandbox और revoked purchases paid files नहीं खोलते।
5. Branded email का **View your downloads** button `/account/downloads` खोलता है। Signed out होने पर sign in/create-account के बाद customer उसी section में लौटता है। Permanent public ZIP या लंबे समय तक valid bearer token email में नहीं जाता।
6. Customer account से download माँगने पर ownership और item access फिर verify होते हैं; short-lived private Storage URL बनता है। Refunded/restricted item का access रोका जाता है; unrelated paid items उपलब्ध रहते हैं।
7. Email API acceptance और actual delivery अलग statuses हैं। Resend signed events से delivered/bounced status आता है। Temporary failures queue/retry में जाते हैं; accepted payloads freeze/dedupe रहते हैं।

## Production में जरूरी configuration

- Vercel में trusted `APP_URL=https://www.booyahstudio.shop` रखें। अपनी domain configuration इसी canonical URL के अनुरूप रखें।
- Supabase baseline तथा repository की Cashfree migrations लागू हों; server keys केवल server environment में हों। `products` Storage bucket private हो और हर active product की सही `<productId>.zip` file upload/verify हो। Checkout missing file मिलने पर payment शुरू करने से रोकता है।
- Cashfree onboarding में वही proprietor/brand/address दें जो ऊपर है। PAN/identity, address/business proof और settlement-bank proof की exact list अपने entity-specific dashboard से पूरी करें; GST या registration number मनगढ़ंत न भरें। Account activation और domain whitelisting पूरी करें।
- Matching production `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV=production` और API version configure करें। Payment/refund webhook URL: `https://www.booyahstudio.shop/api/payments/cashfree/webhook`। Dashboard में relevant events enable करें और signature/retry logs verify करें।
- Resend में sending domain verify करें; `RESEND_API_KEY` और verified-domain `RESEND_FROM_EMAIL` set करें। Store support Gmail address sender-domain verification का विकल्प नहीं है। Delivery events के लिए `RESEND_WEBHOOK_SECRET` और `https://www.booyahstudio.shop/api/emails/resend/webhook` configure करें। Supabase Auth SMTP और application order-email API अलग settings हैं।
- `CRON_SECRET` set करें। `vercel.json` में authenticated reconciliation/email-retry endpoint `/api/jobs/reconcile` का daily fallback है। जल्दी retries के लिए Vercel Pro या external scheduler से हर 5 minutes इसी endpoint पर `Authorization: Bearer <CRON_SECRET>` भेजें। Hobby की daily limit के कारण repository में 5-minute cron hardcode नहीं किया गया। Daily fallback prompt delivery-retry guarantee नहीं है। Admin Readiness में last-run और actual email/payment status देखें।
- Low-value real transaction से success, account download, receipt और real inbox जाँचें; फिर refund/duplicate webhook/pending recovery भी verify करें। ये checks बिना production access के complete बताना सही नहीं होगा।

## Sources checked

- [Cashfree merchant onboarding and website review](https://www.cashfree.com/blog/merchant-onboarding-process/)
- [Cashfree webhook idempotency and SUCCESS verification](https://www.cashfree.com/docs/payments/online/webhooks/webhook-indempotency)
- [Cashfree Create Order API](https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order)
- [Cashfree customer-query and refund guidance](https://www.cashfree.com/customer-query-resolution-guide/)
- [Government of India: grievance acknowledgement/resolution](https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1639925)
- [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
