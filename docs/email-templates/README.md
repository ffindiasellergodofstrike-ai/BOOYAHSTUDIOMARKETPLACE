# Branded account emails

These English templates match the website's ivory, ink and burnt-orange design. They use inline styles, responsive presentation tables and text branding, so no external images or fonts are required. They are copy-ready email bodies; they are not automatically installed by a GitHub/Vercel deployment.

In Supabase → Authentication → Emails → Templates:

1. Open **Confirm signup**. Use subject **Confirm your Booyahstudio email** and replace the HTML body with `confirm-signup.html`.
2. Open **Reset Password**. Use subject **Reset your Booyahstudio password** and replace the HTML body with `reset-password.html`.
3. Save each template. Keep the existing custom SMTP settings and trusted redirect configuration.
4. Request a new test email and check it on a phone and desktop. Test actual confirmation and password recovery on the final website domain. Mail clients may render spacing or rounded corners differently.

The confirmation link remains `{{ .ConfirmationURL }}`. The reset link remains `{{ .RedirectTo }}?token_hash={{ .TokenHash }}`. Do not replace these values with a fixed website URL; they preserve the working account-verification flow. The application also supports Supabase's default implicit recovery links.

The new order/refund emails sent through the application's Resend API include a matching HTML version and the existing plain-text fallback. New notifications get the design automatically after deployment. Existing frozen retry payloads and already accepted emails are preserved to keep delivery idempotent. No real emails were sent while preparing these templates.
