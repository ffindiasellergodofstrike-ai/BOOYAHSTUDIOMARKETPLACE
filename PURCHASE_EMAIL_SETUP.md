# Email setup

Current setup: read `SETUP-HINDI.md` sections 2, 5 and 6 for Resend SMTP, signed delivery events and the retry scheduler. Admin shows provider acceptance separately from delivered/bounced/complained states.

Verify a sending domain in Resend and publish its required DNS records. Set server-only `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Vercel. Use an approved sender on that domain; the support Gmail address is the contact address, not automatically an authorised sender.

Order confirmation emails link to the signed-in account. They do not embed private product files or persistent file URLs. The order records `sent`, `failed` or `not_configured`; `sent` means provider acceptance, not inbox receipt/read. Provider idempotency keys reduce duplicate notifications. Reconcile an order through Admin or its checkout return page to retry failed notifications while the provider idempotency window applies.

Supabase Auth sends confirmation and password-recovery emails. Configure **Supabase Auth → SMTP** with the Resend SMTP settings shown in your Resend dashboard. The application's Resend API variable alone does not configure Supabase SMTP. Turn email confirmation on. Configure the recovery template exactly as shown in DEPLOYMENT.md.
