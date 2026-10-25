# Free plans, Supabase connection और 10 MB files

**चुना गया free-commercial deployment: [Netlify setup guide](DEPLOY-NETLIFY-HINDI.md)**। Vercel adapter रखा गया है; paid selling को Hobby पर deploy करने की सलाह नहीं दी जाती।

जाँच: **24 October 2026**। नीचे दी गई limits official published plans की हैं; account dashboard और current provider terms निर्णायक हैं। इस review में किसी live account, billing plan या credentials को बदला नहीं गया है।

## सीधे जवाब

**10–20 नए accounts/month के लिए Supabase Free का Auth/database हिस्सा पर्याप्त हो सकता है। छह महीने पूरी marketplace free रहेगी, इसकी guarantee signup count से नहीं बनती।** Paid files का कुल size, downloads, email और hosting terms अलग limits हैं। अभी Supabase Auth/Postgres को हटाने की जरूरत नहीं दिखती। Working login, private access और financial transactions की migration केवल कम signup count के कारण करना उचित नहीं होगा।

**Vercel Hobby commercial marketplace के लिए सही free plan नहीं है।** Vercel अपनी Hobby terms में personal/non-commercial use रखता है। Products बेचने और seller subscription/commission लेने वाली live site के लिए उस hosting agreement के अनुसार commercial plan या commercial use की अनुमति वाला दूसरा host चाहिए। Database बदलने से यह Vercel restriction खत्म नहीं होती। Development/demo और live commercial launch को अलग समझें। [Official Hobby plan](https://vercel.com/docs/plans/hobby)

## Supabase Free में क्या मिलता है

| Resource | Published Free allowance | इस project पर असर |
| --- | --- | --- |
| Auth | 50,000 monthly active users | 60–120 cumulative signups बहुत कम हैं; usage फिर भी monitor करें। |
| Database | 500 MB | Profiles/orders/agreements/audit metadata यहाँ हैं; ZIP binaries database में नहीं रखनी हैं। |
| File Storage | 1 GB | Company ZIPs, seller ZIPs, images और retained staging copies मिलकर जगह लेते हैं। |
| Egress | 5 GB uncached और 5 GB cached | Paid private downloads के लिए पूरे cached allowance का benefit assume न करें। |
| Inactivity | लगभग एक सप्ताह inactive रहने पर free project pause हो सकता है | Dormant demo पर login/webhook/storage unavailable हो सकते हैं; production uptime SLA मत मानें। |
| Active projects | Free पर 2 projects | Original store और separate marketplace के projects/organization limits जाँचें। |

ये allowances [Supabase pricing](https://supabase.com/pricing) से हैं। Unlimited API requests का मतलब unlimited storage, compute, bandwidth या guaranteed availability नहीं है।

## छह महीने की वास्तविक capacity

Accounts की संख्या और files की संख्या अलग हैं। दस sellers भी बहुत files बना सकते हैं। नीचे लगभग 10 MB प्रति file के illustrative estimates हैं; actual bytes, bucket usage और plan meter जाँचें।

| Stored files | लगभग raw file data | Practical interpretation |
| --- | --- | --- |
| 25 company products | 250 MB | Original archives के असली sizes इससे अलग हो सकते हैं। |
| 25 company + 30 seller products | 550 MB | Limited images/staging के साथ शुरुआती use fit हो सकता है। |
| 25 company + 60 seller products | 850 MB | कम headroom; publish के समय staging+canonical copy साथ होने पर limit लग सकती है। |
| 25 company + 100 seller products | 1.25 GB | 1 GB Free storage में fit नहीं होता। |

यदि **केवल एक seller हर महीने दस 10 MB files** डालता है, छह महीने में 60 files लगभग 600 MB जोड़ेंगी। कई sellers यह quota भरें तो growth काफी ज्यादा होगी। ₹899 वाला unlimited-products business plan infrastructure को unlimited/free नहीं बनाता। उस plan का अर्थ product-count entitlement है; per-file size, fair use, approved-content rules और platform capacity फिर भी लागू हैं।

5 GB uncached bandwidth पर करीब 500 downloads × 10 MB केवल एक rough ceiling है; database/API responses और दूसरे traffic का हिस्सा भी इसी budget में आ सकता है। Repeat downloads और previews का असर होगा। Protected file को public करके quota बचाने की कोशिश न करें।

Supabase Dashboard → organization/project **Usage/Billing** में database, Storage और egress अलग देखें। Storage में कम-से-कम 15–20% headroom रखें। Failed/obsolete staged objects की safe cleanup करें; valid prior purchases के canonical files बिना access-preserving migration के न हटाएँ।

## 10 MB upload कहाँ जाती है

Vercel की normal Function request/response body limit **4.5 MB** है। इसलिए 10 MB ZIP को website API पर multipart body के रूप में भेजना `413 FUNCTION_PAYLOAD_TOO_LARGE` दे सकता है। [Official function limits](https://vercel.com/docs/functions/limitations)

यह flow इस्तेमाल करें:

1. Seller login करके अपनी listing खोलता है।
2. छोटा authenticated API request private object के लिए upload authorization देता है।
3. Browser file bytes को सीधे **Supabase Storage के private `products` bucket** में server-owned staging path पर भेजता है; Vercel API 10 MB file को relay नहीं करती।
4. Finalize/review step actual object size और allowed ZIP format जाँचता है। Successful upload अपने आप published/paid access नहीं बनता।
5. Admin review के बाद canonical private product file publish होती है। Buyer को purchase/membership entitlement verify होने पर short-lived signed download URL मिलता है।

Existing staging convention `products/_creators/<creator-id>/<listing-id>/<server-generated-id>.zip` और published convention `products/<product-id>.zip` है। New upload module path का server-owned revision बदले तो उसका current implementation/guide मानें; seller arbitrary bucket/path चुनकर दूसरे की file overwrite नहीं कर सकता। Files GitHub repository, Vercel's temporary filesystem या public website folder में नहीं जानी चाहिए।

Direct file-link option को भी validated private import समझें। Allowed HTTPS source से bytes private Storage में copy होने पर Storage quota लगता है। Public external download link को सीधे paid-delivery entitlement बना देना access control और disputes को खराब करेगा। Unsafe/internal/oversized/redirecting sources reject होने पर seller browser upload का उपयोग करे।

## Postgres password खाली है तो क्या गलत है

इस app का runtime `@supabase/supabase-js` के HTTPS APIs/RPC/Storage/Auth का उपयोग करता है। इसे direct PostgreSQL socket/Prisma connection की जरूरत नहीं है। इसलिए **सिर्फ `POSTGRES_PASSWORD` खाली होने से runtime connection गलत साबित नहीं होता**। Raw SQL clients, `psql`, कुछ migration/CLI commands या direct connection strings के लिए database password अलग से आवश्यक हो सकता है।

[Official Supabase–Vercel integration](https://supabase.com/docs/guides/integrations/vercel-marketplace) environment variables sync करती है। Current integration `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` और कई `POSTGRES_*` variables दे सकती है। पुराने projects में `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` रहते हैं। App की server configuration को सही pair resolve करना चाहिए:

| Purpose | Current key name | Legacy equivalent |
| --- | --- | --- |
| Project HTTPS URL | `SUPABASE_URL` | वही |
| Server-only privileged operations | `SUPABASE_SECRET_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| Auth/public API access level | `SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_ANON_KEY` |

Privileged key को `VITE_` या `NEXT_PUBLIC_` नाम में कभी न रखें। Vercel env का value मौजूद होना सिर्फ presence है, working authorization का प्रमाण नहीं। Correct project URL, valid key, applied RPC/schema, private bucket और actual health/admin readiness checks भी चाहिए।

## Automatic connection में क्या होगा, क्या manually करना है

Vercel → Marketplace/Storage → Supabase → existing correct project connect करें। Integration को intended **Production/Preview/Development** environments के लिए attach करें। सही marketplace project का backend चुनें; पुराने live store का database development के लिए reuse न करें। Env changes के बाद redeploy करें। [Supabase integration guide](https://supabase.com/docs/guides/integrations/vercel-marketplace)

Integration Supabase resources और env sync कर सकती है, लेकिन इस app के SQL RPCs, policies, private file rules, owner admin role, custom SMTP, payment account activation और provider webhooks अपने आप सही नहीं बन जाते। Current [deployment guide](DEPLOYMENT.md) के अनुसार base schema और required migrations क्रम से apply करें। SQL को public startup/API request पर auto-run न करें।

Owner के computer पर Vercel CLI configured हो तो ये commands उपयोगी हैं:

```sh
vercel link
vercel env ls
vercel env pull .env.development.local
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

`.env.development.local` में downloaded secrets होते हैं; इसे GitHub पर commit न करें और उसके contents/screenshots share न करें। `vercel env ls` names/metadata देखने के लिए है। Missing variables को dashboard में भरें या interactive prompt के साथ जोड़ें, secret को shell command argument में न लिखें:

```sh
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SECRET_KEY production
vercel env add SUPABASE_PUBLISHABLE_KEY production
vercel env add APP_URL production
vercel env add VITE_SITE_URL production
vercel env add RESEND_API_KEY production
vercel env add RESEND_FROM_EMAIL production
vercel env add RESEND_WEBHOOK_SECRET production
vercel env add MARKETPLACE_ENCRYPTION_KEY production
vercel env add CRON_SECRET production
vercel --prod
```

ये examples current key names के लिए हैं; legacy pair मौजूद/working है तो unnecessarily duplicate secrets न जोड़ें। `APP_URL` और public `VITE_SITE_URL` final HTTPS origin होने चाहिए। Provider-specific merchant secrets और approval flags अलग setup हैं। CLI login/link/project selection owner के account में authorized होना जरूरी है; source code किसी provider account को बिना authorization auto-connect नहीं कर सकता।

## Resend Free और login emails

[Resend Free](https://resend.com/pricing) में 3,000 emails/month और 100/day हैं। Sign-up confirmation, forgot-password, paid-order receipt, refund/status messages और retries का total देखें। 10–20 registrations/month अकेले छोटा load है; orders और email spikes असली budget तय करेंगे। One order retry को duplicate emails का कारण न बनने दें; app का durable email/idempotency workflow बनाए रखें।

Supabase का default SMTP public production users के लिए पर्याप्त नहीं है: team-address restrictions और बहुत छोटा sending limit है। Public signup/reset के लिए custom SMTP configure करें। [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp)

Resend verified sending domain के बाद Supabase Authentication → Email/SMTP में `smtp.resend.com`, username `resend`, port `465` (TLS) या `587` (STARTTLS), और SMTP password में Resend API key इस्तेमाल की जा सकती है। Domain verification/DNS और From address सही होना जरूरी है। SMTP email भी sending quota/rate limits में आती है। API credential Vercel में भरने से Supabase Auth SMTP automatically configure होने का दावा न करें। [Resend SMTP](https://resend.com/docs/send-with-smtp)

## Redis और scheduled automation

इस project की authoritative financial state, rate-limit records, idempotency और jobs PostgreSQL/Supabase में हैं। अभी Redis जोड़ना जरूरी नहीं दिखता। Redis जोड़ने से Storage quota, email cap या Vercel commercial-plan restriction ठीक नहीं होगी। “Resend” email service है; “Redis” cache/datastore है—दोनों अलग हैं।

[Vercel Hobby cron](https://vercel.com/docs/cron-jobs/usage-and-pricing) daily interval और approximate timing तक सीमित है। Existing daily fallback deployable है; इसे exact-minute, guaranteed three-day payout scheduler न समझें। More frequent authenticated scheduler/allowed hosting plan चाहिए और actual successful last-run monitoring जरूरी है। Gateway webhooks और provider-approved payout/hold policy अलग हैं; a scheduled job ledger को bank settlement proof नहीं बनाता।

## अभी backend बदलें या नहीं

**Recommendation: Supabase Auth/database रखें**, usage कम हो तो free allowance में start/test करें, और Storage/egress actively measure करें। यदि product archives इसका budget पार करने लगें, private object storage को अलग करने का architecture विकल्प है; पूरी authentication/payment database हटाना जरूरी नहीं।

[Cloudflare R2 Standard](https://developers.cloudflare.com/r2/pricing/) 10 GB-month storage तथा bounded operation allowances का free tier देता है और direct egress charges नहीं लगाता। लेकिन R2 activation/subscription checkout और billing rules लागू हैं; इसे बिना billing setup अथवा forever-unlimited free guarantee न मानें। [R2 setup](https://developers.cloudflare.com/r2/get-started/). इस source review में R2 migration या billing activation नहीं की गई है।

Files/provider quota से बाहर हों या Vercel commercial hosting जरूरी हो तो “छह महीने बिल्कुल zero cost” का वादा सही नहीं होगा। बेहतर है real usage के हिसाब से storage/hosting budget रखें और paid plans बेचते समय operational limits साफ बताएं।

## Netlify Free: current plan, not old allowances

Commercial projects are permitted on Netlify Free. New accounts use300monthlycredits withahardcap; currentratesare15/productiondeploy,20/GBbandwidth,2/10krequestsand10/GB-hourcompute. Older announcements with100GB/300buildminutes are legacy pricing, not a current promise. API60s,schedule30s,background15minlimits apply. The committed hourly schedule queues an authenticated background reconciliation worker; a202 is acceptance, not job/payout completion. See [currentcreditdocs](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) andthe[step-by-stepguide](DEPLOY-NETLIFY-HINDI.md). No live hosting account was configured here.
