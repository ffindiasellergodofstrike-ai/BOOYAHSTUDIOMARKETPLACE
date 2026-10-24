# Admin panel aur GitHub + Vercel setup

Updated: 23 October 2026 (India).

## Admin kaise kholein

Apne final domain par `/admin` kholein. Is page par **Admin email + Password** form hai. Wahi Supabase email/password use hota hai jo aapne register kiya hai. Mobile OTP nahi hai. Customer account ka login hone se admin access nahi milta; server har admin API par role verify karta hai.

Pehli baar apna owner account taiyar karein:

1. Website par apni email se register karein, confirmation email verify karein aur ek baar login karein.
2. Supabase Auth mein apne account ka exact UUID copy karein.
3. Supabase SQL Editor mein sirf apne UUID ke saath yeh command run karein:

```sql
select public.store_operation('update', 'users/YOUR_AUTH_UUID/profile', '{"role":"admin"}'::jsonb);
```

4. `/admin` par apni email aur password se sign in karein. Public registration se admin role choose nahi kiya ja sakta.
5. Password bhoolne par admin sign-in ka **Forgot password?** link use karein. Supabase recovery/SMTP setup `SETUP-HINDI.md` ke hisaab se hona chahiye. ZIP mein koi shared/default admin password nahi hai.

## Panel se kya manage hoga

| Section | Available controls / records |
| --- | --- |
| Dashboard | Live paid revenue, order counts, account delivery, order-email status, recent orders and audit records |
| Products | Add/edit, price/content/license/requirements, publish/draft/archive, clone, thumbnail upload and private ZIP upload/replacement |
| Orders | All stored orders, buyer/contact, items, amount, payment reference, pending/failed/paid/refund state, account access and email state; search and filters |
| Order details | Timeline, recorded download authorizations, retry eligible queued email, provider reconciliation, access review/revoke/restore and confirmed partial-refund allocation |
| Cashfree disputes | Current cases, reviewed evidence export/submission and provider acknowledgment; no automatic refund/acceptance/arbitration |
| Customers | Contact/order metrics, suspend/restore and promote/demote; own admin access cannot accidentally be removed through these controls |
| Coupons | Create/edit, discount/minimum spend, expiry, enable/disable and actual current status |
| Downloads | Recorded download-link authorizations and retained legacy token history; raw tokens/private signed URLs are hidden |
| Support | Customer support requests, open/in-progress/resolved status and private admin notes |
| Subscribers | Existing newsletter consent/subscription records and subscription-status controls |
| Audit | Stored security/admin activity and request references |
| Settings | Database/private bucket/configuration checks, last recorded scheduled reconciliation and password-recovery link |

The dashboard refreshes every 30 seconds while visible; a manual Refresh is also available. A failed section shows an error/retry state and retains earlier records. It does not silently replace failed requests with zero orders. The support/subscriber/download history views show up to the latest 1,000 records per request; full historical data remains in the server-only database. Monitor growth and extend pagination before that limit is reached.

## Delivered ka exact matlab

- **Available in account:** verified live payment ke baad customer ki file access active hai.
- **Not delivered / Access pending:** payment ya access abhi verified/ready nahi hai.
- **Some products available:** affected refunded/revoked items ke alawa baaki purchased items available hain.
- **Access revoked / Refunded:** future download permission restricted hai.
- **Test only:** sandbox transaction se paid source download nahi milta.
- **Accepted by Resend:** provider ne email sending request accept ki; inbox delivery abhi confirmed nahi.
- **Email delivered / bounced / delayed:** signed Resend event se recorded actual provider status.
- **Download authorized:** expiring link issue hua. Isse completed file transfer ya customer ke file padhne ka proof nahi milta.

Payment/delivery ko fake Paid/Delivered toggle se change nahi kiya jata. **Verify with gateway** trusted provider state fetch karta hai. Refund initiation/review provider dashboard mein hota hai; yahan confirmed refund aur uska access effect dikhte hain.

## GitHub + Vercel

Private GitHub repository mein `booyahstudio/` ke andar wala project root use karein, jahan `package.json`, `vercel.json` aur `api/` hain. Sirf `dist` upload karne se backend nahi chalega. Node 24.x aur pinned pnpm/frozen lockfile use karein. Vercel routes, runtime budget aur private-source exclusions included hain.

Vercel mein `.env.example` ke server variables set karke redeploy karein. APP_URL exact final HTTPS host ho; www/non-www ek canonical host par redirect hon. Production aur Preview ki settings alag rakhein. Supabase SQL, Auth redirects/recovery template, private ZIPs, Cashfree webhook/keys, Resend verified sender/SMTP/webhook aur protected scheduler `SETUP-HINDI.md` ke hisaab se configure karein.

Thumbnail/evidence proxy uploads ki limit **4 MB** hai. Private product ZIPs **50 MiB** tak signed upload se seedhe private Supabase Storage mein jaati hain, Vercel request body se nahi. Replacing an existing ZIP needs an explicit review and reason. Server staging file ki size aur ZIP signature check karke publish karta hai; yeh full archive/malware certification nahi hai. Private `_backups/` aur expired `_staging/` objects ko Supabase mein review/clean up karein. Publish failure mein backup recovery ki zaroorat ho sakti hai; blind retry/overwrite na karein.

API credentials aur SMTP/DNS/merchant settings apne Vercel/Supabase/Cashfree/Resend dashboards mein manage hoti hain. Settings screen secret values browser mein expose nahi karti. `VERCEL-DEPLOYMENT-CHECK.md` actual domain ke API checks aur safe error references samjhata hai. External service outage ya missing/wrong credentials ko source-code ZIP se guarantee ke saath eliminate nahi kiya ja sakta; live verification deployment ke baad karni hogi.
