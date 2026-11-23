# MailPilot | Simple Email Outreach

A no-login, no-database email dashboard built with static HTML, CSS and JavaScript. Contacts, campaigns, settings, status, history and backups use **browser localStorage**. The optional sending API is a stateless Cloudflare Worker.

## Features

- Import CSV by selecting a file or pasting rows; max 10,000 contacts
- Add single contacts, merge duplicate emails, search/filter and export CSV
- Review / Permission confirmed / Unsubscribed statuses; opt-outs preserved on reimport
- Subject and text/HTML composer with live safe iframe preview
- Personalization: {{name}}, {{first_name}}, {{email}}, {{company}}, {{sender_name}}, {{website}}, plus CSV columns
- Individual cold outreach through reviewed mailto drafts (manual sending)
- Optional opt-in campaign sending: 25 contacts per run, 8 seconds apart; stop button and local history
- Avoid repeat sends within one campaign, export history, JSON backup/restore
- Responsive UI; no login, no database, no third-party frontend libraries

**Cold email policy:** The automated provider integration is **only for permission-confirmed contacts**. Resend explicitly prohibits unsolicited cold outreach, scraped data and purchased lists: https://resend.com/legal/acceptable-use . Use the individual mailto draft workflow for lawful, personalized outreach using your own email app and its policies.

## 1. Start with the website

1. GitHub repository Settings → Pages → Source: **GitHub Actions**.
2. Actions → **Deploy MailPilot website** → Run workflow (or push a change to site/).
3. After successful deployment, the expected public URL is:
   https://kothakula-sagar.github.io/email-marketing/
4. Import CSV from Contacts, create your email in Composer, then open a personal email in your own mail app from the contact row.

CSV example:

    name,email,company,consent,city
    Priya Sharma,priya@example.com,Example Industries,no,Bengaluru
    Ravi Kumar,ravi@example.com,Sample Company,yes,Chennai

- consent=yes/true/consented means permission-confirmed **only if you have evidence of opt-in**.
- consent=no/blank/missing means Needs review, not eligible for automated sending.
- consent=unsubscribed/opt_out means suppressed.
- Previously unsubscribed emails remain suppressed on future imports.

## 2. Optional permission-based automated sending

You need Cloudflare Workers and Resend with a verified sending domain. Configure domain SPF/DKIM (and preferably DMARC).

Create a GitHub Environment named **production** in repo Settings → Environments. Add these *individual Environment secrets*:

| Secret | Value |
| --- | --- |
| CLOUDFLARE_API_TOKEN | Worker deployment token (Workers Scripts edit) |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare account identifier |
| RESEND_API_KEY | Resend sending key, for permission-based marketing only |
| SEND_ACCESS_TOKEN | A random 24+ character send passphrase, different from API key |
| ALLOWED_ORIGIN | https://kothakula-sagar.github.io (do not include repo path or final slash) |
| SENDER_EMAIL | Mailbox verified with your sending domain |
| FROM_NAME | Sender display name |
| COMPANY_NAME | Your organization |
| POSTAL_ADDRESS | Your physical business mailing address |
| UNSUBSCRIBE_EMAIL | Monitored mailbox for opt-out requests |

**Deploy:** Actions → **Deploy mail Worker** → Run workflow. The workflow uses the production Environment and securely deploys the secrets to Cloudflare, not to GitHub Pages. Copy the resulting Worker URL and append **/send**.

In MailPilot → Settings, enter that HTTPS /send endpoint and sender identity. In Send center, enter SEND_ACCESS_TOKEN each time you start a send (it is not stored in localStorage), confirm recipient consent and approve the batch.

**Important:** GitHub Environment secrets cannot be used safely in a browser-only public .env file. A separate Worker protects your provider key. Never commit actual keys. The tracked .env.example contains placeholders only.

Docs: https://developers.cloudflare.com/workers/configuration/secrets/ and https://resend.com/docs/api-reference/emails/send-email

## 3. Local data and delivery limitations

- localStorage belongs to the current browser and website origin. Clearing site data erases contact data. Export a private JSON backup regularly.
- Replies to UNSUBSCRIBE_EMAIL **must be processed manually**. Mark them Unsubscribed inside Contacts before any future send and keep a backup suppression list.
- There is no server database, centralized suppression list, webhook, automatic unsubscribe landing page, multi-device sync, open/click pixel, or server-side daily rate limiter. For large-scale marketing, use an approved purpose-built platform with durable opt-outs.
- “Accepted” means the email provider accepted the API request, **not** that the email was delivered or read.
- A public Worker URL is protected by a separate send passphrase and exact browser origin check; CORS alone is not access control.
- The Worker enforces verified sender identity and appends business mailing address and unsubscribe guidance to messages.
- Keep exported CSV/JSON data confidential and respect all applicable email/privacy laws.

## 4. Run tests locally

Requires Node.js 22+.

    npm test
    npm run serve

No frontend build step. npm test runs JavaScript syntax checks and Worker security unit tests.

## Files

    site/index.html                  Static web app
    site/styles.css                  Responsive styles
    site/app.js                      Contact import, templates, localStorage, send UI
    worker/index.js                  Stateless Resend Worker
    wrangler.toml                    Worker settings
    tests/worker.test.js             Security and API forwarding tests
    .github/workflows/test.yml       CI tests
    .github/workflows/deploy-pages.yml  Pages deployment
    .github/workflows/deploy-worker.yml Worker deployment
    .env.example                     Secret names only, no credentials

**No automatic cold-email blasts, no contact harvesting and no account/login system.**
