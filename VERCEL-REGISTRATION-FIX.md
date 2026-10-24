# Vercel registration 500 — fixed source and deployment instructions

Source: https://github.com/ffindiasellergodofstrike-ai/booyahstudio.git
Latest `main` downloaded for this fix: `81d4e973f9b745eeee0ba8c1ac464d579de020bd`.
Date: 5 October 2026.

## Kya fix hua

Vercel log mein `ERR_MODULE_NOT_FOUND: /var/task/server/app` tha. API entrypoint native Node ESM mein extension ke bina TypeScript source import kar raha tha. Local tsx/Vite is problem ko hide kar dete the. Same error original latest source par plain Node se reproduce hua.

Ab `pnpm build` poore backend ke local TypeScript modules aur JSON ko private `build/api-app.mjs` mein bundle karta hai. Dono Vercel functions explicit `.mjs` file import karte hain; Vercel configuration is file ko function package mein include karti hai. Product metadata function apne built HTML shell ko bhi include karta hai. Backend bundle public `dist` ke andar nahi hai.

Har build ke end mein native Node API startup aur synthetic registration checks run hote hain. Check fail hua to build fail hoga. Node version `24.x` package manifest mein set hai. Invalid product requests bhi native Vercel response se correctly 404 return karte hain.

## GitHub / Vercel par kya karna hai

1. Is ZIP ko extract karein. `package.json`, `vercel.json`, `api/`, `server/`, `src/` ek hi project root mein hone chahiye. Yeh complete latest source project hai.
2. Updated files apne existing private GitHub repository mein replace karke commit/push karein. Apna local `.env` GitHub par upload na karein.
3. Vercel project ka Root Directory wahi folder ho jisme `package.json` hai. Framework preset Vite; Node.js version **24.x**.
4. Install command: `pnpm install --frozen-lockfile`.
5. Build command: **`pnpm build`**. Sirf `vite build` mat rakhein: usse backend bundle nahi banega. Output Directory: **`dist`**. Poora repository deploy karein, sirf dist folder upload na karein.
6. Existing Vercel Production environment variables preserve karein. Registration ke liye `APP_URL` (exact HTTPS origin), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` required hain. `.env.example` mein baaki existing application settings hain. Secret values browser/VITE_ variables mein na daalein.
7. Vercel par new deployment karein. Manual Redeploy karte waqt build cache disable karke clean deployment karein. Build log mein API bundle aur `PASS: native Node API startup` dikhna chahiye.
8. `https://www.booyahstudio.shop/api/health` kholein. JSON mein `status: "ok"` aana chahiye. Health sirf process startup check hai; Supabase readiness ka proof nahi.
9. `/register` se apne test account ka signup karein. Network response successful ho aur actual confirmation email aaye; confirm karke login karein. Supabase Auth Site URL/redirects aur SMTP configuration existing DEPLOYMENT.md ke according check karein.
10. Agar JSON 503 aaye, Supabase URL/service-role key aur `supabase/schema.sql` ka `store_operation` function check karein. Agar 400 aaye, form/password details aur Supabase Auth/email settings check karein. Supabase SMTP ke liye separate Resend SMTP configuration required hai; application Resend API key alone sufficient nahi.

Is import fix ke liye database reset ya nayi migration required nahi hai. Existing Supabase setup/data preserve karein. Original schema files complete project ke saath included hain.

## Changed files

| File | Change |
| --- | --- |
| `api/index.ts` | Import generated Node-compatible private API bundle |
| `api/page.ts` | Same bundle import; native response for invalid slug |
| `package.json` | API bundling, automatic runtime check, check:vercel script, Node 24.x |
| `vercel.json` | Explicit private API bundle inclusion for both functions |
| `scripts/check-vercel-runtime.mjs` | New native-runtime and synthetic Supabase registration regression check |
| `README.md`, `DEPLOYMENT.md` | Build and redeployment instructions |
| `FINAL-AUDIT.md` | Mark earlier report as historical rather than claiming it verifies latest main |
| `VERCEL-REGISTRATION-FIX.md` | This current fix report |

No source files removed. No dependency versions or lockfile changed. Generated dependency/build/cache files are excluded from the source ZIP; deployment regenerates them.

## Verification performed

Environment: Node 24.14.1, pnpm 10.34.5, Linux.

| Check | Result |
| --- | --- |
| Original plain Node entrypoint import | Failed with same ERR_MODULE_NOT_FOUND as supplied Vercel log |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS including automatic native-runtime check; existing large frontend chunk warning remains |
| Native bundled API | Health200, unknown API404, valid product HTML200, invalid product404 |
| Registration with missing database configuration | Handled JSON503, no module startup crash |
| Registration with synthetic Supabase HTTP responses | Valid signup201, invalid input400, provider rejection400, rate limiting429; no authenticated cookie before confirmation |
| `pnpm exec tsx scripts/check-built-catalog.ts` | PASS on latest catalog/static output |
| Existing `pnpm test` | 80 passed, 7 failed, 87 total |
| Unmodified latest GitHub baseline `pnpm test` | Same 80 passed, same 7 failed; failures predate this patch |
| `git diff --check` | PASS |

Pre-existing failures are in `server/adminRoutes.test.ts` (1), `server/easebuzzTestMode.test.ts` (1), `server/paymentAccess.test.ts` (2), `server/paymentProdRoutes.test.ts` (1), `server/paymentRoutes.test.ts` (1), and `server/payuRoutes.test.ts` (1). They concern existing admin/payment fixtures and expectations; the latest source contains legacy provider code as well. These are outstanding broader-project issues, not a passing whole-site audit. The existing Supabase/Razorpay HTTP flow test passed, including signup, login, logout, recovery and ownership checks, using simulated provider responses and local PostgreSQL-compatible SQL.

No actual Vercel deployment, hosted Supabase signup, real confirmation inbox or real financial transaction was executed for this fix. The user must verify those after redeployment. Fixing this confirmed startup error cannot guarantee that configuration changes or provider outages will never cause another error.

## Troubleshooting / rollback

- Same module error after deployment: check that the deployment uses the new commit and both updated API files. Confirm the full build command and function include rules were deployed together.
- Missing `build/api-app.mjs`: backend build was skipped or only static files were uploaded. Use the full repository and `pnpm build`.
- 403 on form requests: `APP_URL` must exactly match the browser HTTPS origin, including www when used.
- Health200 but signup503: database credentials/schema/rate-limiter operation need checking; health alone does not test them.
- Signup succeeds but email does not arrive: inspect Supabase Auth logs, confirmation settings, SMTP sender and Resend domain/DNS. This module fix does not change email configuration.
- Restore the previous Vercel deployment if an unrelated regression occurs, but that older deployment may still contain the confirmed import error. Do not roll back or reset production customer/payment data for this code-only fix.
