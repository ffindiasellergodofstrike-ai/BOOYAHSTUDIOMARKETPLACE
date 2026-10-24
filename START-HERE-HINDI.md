# Pehle yeh padhein — Booyahstudio final setup

**Current setup:** pehle `SETUP-HINDI.md` aur `IMPLEMENTATION-NOTES.md` padhein. Cashfree ab preferred checkout hai; neeche ke historical Razorpay notes sirf us gateway ko retain karne par apply hote hain.

**MANISH KUMAR SONKAR | Booyahstudio**  

## Kahan kya milega

- `booyahstudio/`: poora GitHub/Vercel project.
- `booyahstudio/docs/policies/`: har policy alag Markdown page mein, copy karne ke liye.
- `private-product-uploads/`: customer ko dene wali ZIP files; Supabase ke private bucket mein upload karein.
- `booyahstudio/supabase/schema.sql`: Supabase SQL Editor mein chalana hai.
- `booyahstudio/.env.example`: required keys ke naam. Real keys ZIP/GitHub mein nahi dalni.
- `booyahstudio/DEPLOYMENT.md`: har setting ki detailed instructions.

## Step by step

1. ZIP extract karein. `booyahstudio/` ke andar ke files apne GitHub repository mein upload/push karein.
2. Supabase project banayein. SQL Editor mein `supabase/schema.sql` run karein.
3. Supabase Storage ka `products` bucket **private** rakhein. `private-product-uploads/` ki ZIPs exact filename ke saath upload karein. `product-images` sirf public thumbnails ke liye hai.
4. Supabase Auth mein email/password aur email confirmation on karein. Site URL aur allowed redirects apne domain ke set karein.
5. Resend mein apna sending domain verify karein. Supabase Auth SMTP mein Resend SMTP details set karein. Password-reset template ka exact link DEPLOYMENT.md se copy karein.
6. Cashfree sandbox keys configure karein. Payment/refund webhook `/api/payments/cashfree/webhook` aur dispute webhook `/api/payments/cashfree/disputes/webhook` set karein; exact events `SETUP-HINDI.md` mein hain.
7. Vercel par GitHub repo import karein. Node 24.x, build `pnpm build`, output `dist`. Environment Variables mein `.env.example` wale naam aur apni actual values set karein. `APP_URL` final HTTPS domain hoga.
8. Deploy/redeploy karein. Signup, confirmation email, login aur forgot-password test karein. Test payment se real download unlock nahi hota.
9. Apna owner account confirm karke ek baar login karein. Uska Supabase UUID lekar DEPLOYMENT.md wali SQL command se admin role set karein. Phir `/admin` kholein.
10. Live payment se pehle tax rate/SAC, invoice process, har product ka license aur files confirm karein. Current app payment receipt banata hai, tax invoice nahi.
11. Cashfree account/website approval ke baad Vercel Production mein matching live keys aur CASHFREE_ENV=production set karein. Controlled real purchase, file download, email aur refund check karein. Resend delivery webhook aur protected reconciliation scheduler bhi configure karein.

## Zaroori baatein

Domain abhi repository ka `www.booyahstudio.shop` rakha gaya hai. Agar aapka domain alag hai to DEPLOYMENT.md ke domain-change steps follow karein.

Private API secrets ko kabhi `VITE_` prefix na dein. Customer ZIPs `public/` folder mein na rakhein. Sirf browser mein “success” dikhne se download nahi milta; server actual provider se payment/refund verify karta hai.

Support: connectbooyahstudio@gmail.com · WhatsApp 7393845435. Actual provider account setup aur live verification owner ko apne accounts mein karna hai. Is package se site automatically live nahi hoti.

## Is updated ZIP mein kya naya hai

- `IMPLEMENTATION-NOTES.md` mein current changes aur verification hain; `FINAL-AUDIT.md` pehle ki report hai.
- Pehle se Supabase database hai to backup lekar baseline `supabase/migrations/20261005_payment_security.sql` ke baad `supabase/migrations/202610220001_cashfree.sql` apply karein. Naya database ho to `supabase/schema.sql` poora run karein.
- Cashfree webhook ki current event list `SETUP-HINDI.md` se select karein. Historical Razorpay ke notes `DEPLOYMENT.md` section 5 mein hain.
- Resend sender/domain aur Supabase custom SMTP dono alag configure karne hain. Sirf API key add karne se password-reset email setup poora nahi hota.
- Admin mein account suspend/restore, order access review, Cashfree partial-refund allocation aur dispute evidence review/submission milta hai. Refund actual provider Dashboard se review karke karein.
- Local automated tests provider responses simulate karte hain. Aapke account par real payment, actual email inbox aur live Supabase Storage abhi verify nahi hue. Live launch se pehle deployment guide ke checks karein.
- ZIP mein actual website source, SQL, policies aur private upload ZIPs hain; `node_modules`, build output aur secret keys nahi hain.

**GitHub repository PRIVATE rakhein.** Owner project mein paid product source files bhi hain; public GitHub repo banane se ye files sabko dikhengi. Final ZIP ko public website asset na banayein.
