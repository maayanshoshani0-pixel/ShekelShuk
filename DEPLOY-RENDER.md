# Deploy ShekelShuk on Render

## What is already prepared

- `index.html`
- `register.html`
- `render.yaml`

This project is set up to deploy as a Render static site.

## 1. Put the project in GitHub

Create a GitHub repo, then upload these files from this folder:

- `index.html`
- `register.html`
- `render.yaml`
- `DEPLOY-RENDER.md`

## 2. Create the Render site

In Render:

1. Sign in and connect your GitHub account.
2. Click `New` -> `Blueprint`.
3. Select the repo that contains this project.
4. Render should detect `render.yaml`.
5. Deploy the Blueprint.

That will create a static site named `shekelshuk-site`.

## 3. Buy the domain

You need to register `shekelshuk.com` with a domain registrar such as:

- Namecheap
- Porkbun
- Cloudflare Registrar
- GoDaddy

I could not reliably verify live availability from here, so check and buy it directly at a registrar as soon as possible if you want that exact name.

## 4. Connect the custom domain in Render

According to Render's current docs, static sites support custom domains and Render automatically provisions TLS/HTTPS after verification.

In Render:

1. Open your `shekelshuk-site` service.
2. Go to `Settings`.
3. Find `Custom Domains`.
4. Add `shekelshuk.com`.
5. Render will also add the matching `www` redirect automatically for a root domain.

## 5. Update DNS at your registrar

Render's current custom-domain docs say the flow is:

1. Add the domain in Render.
2. Configure DNS with your domain provider.
3. Verify in Render.

Important note from Render's docs:

- Remove any `AAAA` records while configuring the domain, because Render uses IPv4 and those records can cause issues.

Use the exact DNS values Render shows you in the dashboard for your service. Do not guess them.

## 6. Verify and go live

Back in Render:

1. Click `Verify` next to the domain.
2. Wait for DNS propagation.
3. Once verified, Render issues TLS automatically.
4. Visit `https://shekelshuk.com`.

## Notes

- Domain names are case-insensitive, so `ShekelShuk.com` and `shekelshuk.com` are the same domain.
- Your app is currently a static frontend only.
- The admin email restriction is only client-side right now and is not secure without a backend/auth system.

## Official docs used

- https://render.com/docs/static-sites
- https://render.com/docs/custom-domains
- https://render.com/docs/blueprint-spec
