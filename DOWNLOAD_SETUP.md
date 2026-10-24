# Private product delivery

Run `supabase/schema.sql`. In Supabase Storage, use the **private** `products` bucket.
Upload each archive as `<product-id>.zip`, for example `margin-portfolio.zip` or `linknest-pro.zip`.
Run `python3 scripts/package-template-collection.py` to generate the 20 static packages and upload manifest.
The other original packages are in `demofiles/`; rename a copy to the catalog ID before upload.

The checkout checks that all ordered files exist before accepting payment. Captured live payments create account access in one database transaction. The download endpoint authenticates the account, checks order ownership/payment/refund/revocation status, records authorisation and returns a 60-second Supabase signed URL. ZIP bytes are served directly by Storage, avoiding Vercel function response limits.

A signed URL is usable during its validity, not single-use. A refund/revocation prevents new authorisations; a link already issued may work until expiry. The app records authorisation, not completed file receipt. Test payments never grant actual file access.

Do not upload private ZIPs to `public/` or the public `product-images` bucket. Keep backups. See DEPLOYMENT.md for testing and refund operation.
