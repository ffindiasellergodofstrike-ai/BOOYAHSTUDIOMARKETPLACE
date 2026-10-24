# Table Notes — Booyahstudio

A readable digital menu for a neighbourhood café, from a first morning coffee to a slow afternoon plate.

## Included
Four HTML pages (`index.html`, `work.html`, `about.html`, `contact.html`), editable CSS and JavaScript, four original SVG geometric illustrations, Vercel configuration and license.

## Working feature
Menu search, category filters and dietary labels. Browse the Explore page for the interactive workspace. The contact page prepares an enquiry draft without sending it. Demo names, service rates, events and records are fictional. No real customer reviews are supplied.

## Run locally
Use `python3 -m http.server 8080` in this folder, then open http://localhost:8080. No packages, build tools, external fonts, stock photos or CDN scripts are needed. Opening HTML directly may limit browser storage and clipboard functionality.

## Deploy to Vercel
Import this folder as its own project. Framework preset: Other. Build command: leave empty. Output directory: `.` (project root). No environment variables are required. Each HTML page is a real static file. Confirm `/index.html`, `/work.html`, `/about.html` and `/contact.html` after deploying.

## Customise
- Edit page text and the JSON in `#template-data` within each HTML file. Keep the four pages' JSON consistent.
- Edit the colour variables in each page's head and layout rules in `styles.css`.
- Replace `art-0.svg` through `art-3.svg` with your own licensed images if desired.
- Set your real title, description, canonical URL and absolute social image URL before publishing.
- Local workspace data is stored with key `booyah-template:table-notes`. It is not synced between users or devices. Export it where the tool offers export. Clearing browser storage deletes local state.

## Scope and launch checklist
This is a static frontend, not a backend service. It includes no authentication, merchant account, database, stock management, real bookings, payment processing or email delivery. Sample storefront prices are separate from this template's Booyahstudio sale price. Connect your own backend when needed, validate requests server-side and never expose secret keys in browser code.

Before accepting payments, publish your true merchant/contact identity and accurate product descriptions, delivery, refund, cancellation and privacy policies; complete provider approval and your own integration tests. Buying this template does not confer gateway approval. Review local requirements for your actual business. Replace illustrative content before claiming it as real trading activity.

## Provenance
Code, copy and SVG shapes in this package were authored for the Booyahstudio collection. No third-party photographs, fonts, logos, audio recordings, celebrity identities or copied website layouts are bundled. This provenance statement is not a global trademark or legal clearance opinion. See LICENSE.txt.
