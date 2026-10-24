# Registration500 / Vercel API startup patch

Yeh patch pehle diye gaye Booyahstudio project ke liye hai.

## Kya confirm hua

Live GET https://www.booyahstudio.shop/api/health ne500 FUNCTION_INVOCATION_FAILED diya. Is endpoint ko Supabase ki zarurat nahi hoti. Registration screenshot bhi500 dikhata hai. Isliye function startup problem confirm hai; exact production exception ke liye Vercel Logs chahiye.

Purana unbundled API entrypoint native Node24 mein ERR_MODULE_NOT_FOUND (server/app) se fail hua. Patch local TypeScript/JSON imports ko build ke samay resolve karke build/api-app.mjs banata hai. Dono Vercel entrypoints isi bundle ko load karte hain; Vercel config bundle ko function mein include karta hai. Product-page invalid-input branch native response methods use karti hai.

## In4 files ko replace karein

Project root wahi folder hai jahan package.json hai (purane ZIP mein booyahstudio/).

1. package.json → project root/package.json
2. vercel.json → project root/vercel.json
3. api/index.ts → project root/api/index.ts
4. api/page.ts → project root/api/page.ts

ZIP ke api folder ki files existing api folder mein replace karein. package.json/vercel.json root mein replace karein. Agar aapne apni dependencies/scripts badle hain, package.json ka backup rakhein aur build-script change merge karein; dependencies is patch mein pehle wale project ke hi hain.

## Vercel par

1. Files apne GitHub repository mein save/commit/push karein.
2. Vercel project Root Directory wahi ho jahan package.json hai.
3. Build Command `pnpm build` (sirf `vite build` mat rakhein). Output Directory `dist`, Node24.x.
4. Redeploy karein. Pehli baar build cache reuse band karke redeploy karein.
5. Build logs mein `build/api-app.mjs` generate hone ka output check karein. Is generated file ko manually upload karna zaroori nahi; build banayega.
6. https://www.booyahstudio.shop/api/health kholein:200 aur JSON mein status ok aana chahiye.
7. Phir registration try karein. Actual signup verification email aur Supabase Auth user record check karein.

Database tables reset/delete karne ki zarurat is patch mein nahi hai. Existing Vercel environment variables ko preserve karein. Secret values kisi file/chat mein paste na karein.

## Agar error rahe

- Health abhi bhi500: Vercel → Project → Logs → failed function ka exact exception/stack bhejein; Network Response bhi bhejein. Secrets/password hide karein.
- Health200 lekin registration503: function start ho gaya; ab Vercel Supabase URL/service-role key aur store_operation SQL permissions check karne hain.
- Registration400: Response message aur Supabase Auth/SMTP logs check karein. Provider configuration errors ke liye database bypass nahi kiya gaya.

## Verification

Production build PASS; TypeScript PASS; existing28 tests PASS. Native Node runtime smoke: health200, missing database config handled JSON503 (not function crash), invalid API404, invalid product404, valid product HTML200. No real user/account/email/payment was created during these checks. Live deployment after patch is not yet verified; exact original production exception remains awaiting Vercel logs.
