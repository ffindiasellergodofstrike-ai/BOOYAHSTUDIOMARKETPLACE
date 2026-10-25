# Free commercial hosting: Netlify + Supabase + Resend

जाँच: **24 October 2026**। यह repository Netlify पर deploy करने के लिए तैयार है। इस session में कोई Netlify account/site, billing setting या production credential नहीं बनाया/बदला गया है। Vercel वाला adapter भी उपलब्ध है; paid marketplace के लिए Vercel Hobby की non-commercial शर्त से बचने का रास्ता database बदलना नहीं है।

Netlify ने [Free पर commercial projects की अनुमति](https://www.netlify.com/blog/introducing-netlify-free-plan/) प्रकाशित की है। उस पुराने announcement की पुरानी bandwidth/build allowances को आज की quota न समझें। नए accounts की [current Free pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) **300 credits/month hard limit** है, auto-recharge नहीं। Limit भरने पर service रुक सकती है; छोटा account count छह महीने uptime/free रहने की guarantee नहीं है।

## 1. GitHub से Netlify import

1. Netlify पर अपना account खोलें → **Add new project → Import an existing project → GitHub**।
2. `ffindiasellergodofstrike-ai/BOOYAHSTUDIOMARKETPLACE` और `main` चुनें।
3. Repository का `netlify.toml` पढ़ा जाएगा: build `pnpm build`, publish `dist`, functions `netlify/functions`, Node 24। `pnpm-lock.yaml` commit होना चाहिए।
4. पहले अपना final Netlify domain या existing domain का marketplace subdomain चुनें। Free `your-name.netlify.app` domain और SSL उपलब्ध हैं; merchant approval के लिए provider का domain verification अलग है।
5. नीचे के environment variables **Netlify UI → Environment variables** में server/function scope सहित भरें। Secrets `netlify.toml`, GitHub, browser JS या chat में न डालें।

| Variable | क्या देना है |
| --- | --- |
| `APP_URL` | इस नए marketplace का final HTTPS origin; path/query नहीं |
| `VITE_SITE_URL` | वही public origin; यह अकेला public client setting है |
| `SUPABASE_URL` | सही separate Supabase project URL |
| `SUPABASE_SECRET_KEY` | server-only modern privileged key; legacy `SUPABASE_SERVICE_ROLE_KEY` supported |
| `SUPABASE_PUBLISHABLE_KEY` | modern Auth/public-level key; legacy `SUPABASE_ANON_KEY` supported |
| `MARKETPLACE_ENCRYPTION_KEY` | securely generated 32-byte base64 encryption key; existing data के बिना migration इसे न बदलें |
| `CRON_SECRET` | strong random server-only secret; scheduled jobs और background worker दोनों में same value |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` | verified sending domain की actual values |
| Payment-provider keys/approval flags | `.env.example` के अनुसार; activation से पहले new checkout/provider features बंद रखें |
| `AWS_LAMBDA_JS_RUNTIME` | existing site पर override चाहिए तो UI/CLI से `nodejs24.x`; `netlify.toml` में इस runtime override को न रखें |

`POSTGRES_PASSWORD` इस app के HTTPS SDK/RPC/Auth/Storage connection के लिए जरूरी नहीं है। Raw SQL/CLI direct connection अलग है। Modern/legacy Supabase key names resolve होते हैं, लेकिन env में value मौजूद होना working database/schema का प्रमाण नहीं है।

## 2. Supabase और email setup

[Current deployment guide](DEPLOYMENT.md) के अनुसार current base schema और required migrations सही क्रम में apply करें। Public startup/request पर arbitrary SQL चलाने वाला endpoint नहीं दिया गया है। Supabase dashboard SQL Editor या authorized CLI migration इस्तेमाल करें। पुराने source की superseded RPC definition को नए migration के बाद न चलाएँ।

- `products` bucket **private** रहे। Company files `<productId>.zip` हों। Seller uploads server-owned staging paths पर जाती हैं; approved publish के बाद canonical private file बनती है।
- Supabase Auth में final Site URL/allowed redirect URLs इस नए domain पर बदलें। Existing confirmation/recovery templates और email/password flow रखें।
- Supabase default SMTP public customers के लिए पर्याप्त नहीं है; verified custom SMTP configure करें। Resend SMTP credentials Supabase की email settings में जाते हैं, जबकि order email backend HTTPS Resend API इस्तेमाल करता है।
- Owner का ordinary verified account बनाकर server-side admin role दें। Public role/password shortcut नहीं है। Seller PAN private/encrypted है; buyer से PAN नहीं लिया जाता।
- Gateway return/webhook URLs इस domain पर register करें; Resend delivery webhook भी configure करें। GitHub push से provider account approval नहीं होता।

## 3. 10 MB files: API body के बाहर

Netlify buffered function payload 6 MB है और binary/base64 overhead के कारण practical binary body cap लगभग **4.5 MB** है। [Official limits](https://docs.netlify.com/build/functions/configuration/)

Seller browser **सीधे signed private Supabase Storage upload** करता है। Function केवल छोटा intent/finalize request लेती है। Finalize actual size/ZIP और owner/path जाँचता है; max 10 MB है। Direct URL option validated HTTPS import करके private Storage में copy करता है; unsafe/internal/oversized URLs reject होते हैं। External public URL अपने-आप buyer entitlement नहीं बनता। Files Netlify's temporary filesystem, GitHub या public `dist` folder में नहीं रखी जातीं। Storage quota पर company files, seller files और temporary staging सभी गिने जाते हैं।

## 4. Actual scheduled automation

इस repository में तीन functions हैं:

- `api`: existing Express app का HTTP adapter; original webhook bytes, cookies और API/HTML error status रखता है।
- `reconcile-schedule`: हर घंटे UTC minute `15` पर छोटा scheduled invocation। यह authenticated request से background job queue करता है।
- `reconcile-background`: `CRON_SECRET` verify करने के बाद existing reconciliation endpoint को **in-process** चलाता है। It does not manufacture successful payments, payouts or KYC.

Netlify की current limits: HTTP function **60 seconds**, scheduled function **30 seconds**, background function **15 minutes**। इसलिए long reconciliation को scheduled function के अंदर या self-HTTP `/api/jobs/reconcile` call में रखकर timeout नहीं छिपाया गया है। [Scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/) · [Background functions](https://docs.netlify.com/build/functions/background-functions/)

Netlify का background HTTP `202` केवल request स्वीकार होना है। Actual completion और review-required स्थिति app के private operations/admin records तथा Netlify logs में देखें। Missing SQL, provider rejection, expired credentials या insufficient quota को completed settlement न समझें। Published production deploy पर ही schedule चलता है; preview पर automatic schedule नहीं चलता। Provider webhooks primary real-time signal हैं; hourly recovery job fallback है। 72-hour eligibility के बाद अगले job/provider banking cycle में action होगा; exact 72-hour bank credit की guarantee नहीं है।

Netlify UI → Functions में schedule के **Run now** से पहली authenticated run जाँचें। Provider history और admin last-run records मिलाएँ। ज्यादा frequent schedule तभी करें जब जरूरत और compute-credit budget दोनों समझें।

## 5. Owner CLI commands

ये commands owner के terminal में authenticated Netlify CLI के साथ चलें; passwords/secrets chat में paste न करें। `.env` Git-ignored private file है।

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
# Fill the private .env values locally.
pnpm setup:check
pnpm setup:sql
# Review build/marketplace-fresh.sql OR build/marketplace-upgrade.sql.
# Apply ONLY the matching file in Supabase SQL Editor. No SQL is executed automatically.
pnpm setup:check --online
pnpm typecheck
pnpm test
pnpm build
npx netlify-cli login
npx netlify-cli link
npx netlify-cli env:import .env
npx netlify-cli deploy --build --prod
```

या केवल GitHub import करके Netlify UI में env भरें और `main` push से continuous deploy होने दें। दोनों रास्ते SQL migrations, private paid files, sending-domain verification और provider activation को replace नहीं करते। Secret/environment changes के बाद redeploy करें।

## 6. Free budget

[Current credit accounting](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/):

| Meter | Current rate |
| --- | --- |
| Production deployment | 15 credits each |
| Preview/branch deployment | 0 deployment credits |
| Bandwidth | 20 credits per GB |
| Requests | 2 credits per 10,000 |
| Compute | 10 credits per GB-hour |

Illustration: four production deploys = 60 credits; 3 GB CDN bandwidth = 60; 100,000 requests = 20; 5 GB-hours compute = 50; total 190 credits before other use. This is a budgeting example, not a usage forecast. Twenty production deploys alone consume all 300 credits. Preview builds are useful while designing. Private paid download bytes travel from Supabase to the buyer, so they use Supabase's storage/egress rather than serving ZIPs through Netlify.

Supabase Free still has 1 GB Storage, 500 MB database and published bandwidth limits. Roughly 70–80 maximum-size 10 MB files plus existing company files/images/staging can exhaust practical headroom. Signup count is not a file-capacity guarantee. Resend Free is 3,000 emails/month and 100/day, shared by configured account use; check quota and verified SMTP. [Detailed quota/connection guide](FREE-TIER-AND-CONNECTION-HINDI.md)

Redis is not required by this app: durable state/rate limits are in Supabase. Adding an unnecessary free Redis service would add another quota/connection to maintain. A paid creator plan with unlimited product count does not mean unlimited free infrastructure, storage or guaranteed service availability.
