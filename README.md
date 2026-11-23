# ABRA LOGISTIC | Email Marketing

A no-login, no-database email dashboard built with static HTML, CSS and JavaScript. Contacts, campaigns, settings, status, history and backups use **browser localStorage**. The optional sending API is a stateless Cloudflare Worker with Gmail OAuth (like the existing CRM) or Resend.

## Features

- Import CSV, XLSX/XLS CRM customer exports or paste CSV rows; max 10,000 customers
- Add customers with Name, Email, Mobile, Company and Source; merge duplicate emails, search/filter and export CRM-style CSV
- Review / Permission confirmed / Unsubscribed statuses; opt-outs preserved on reimport
- Multiple saved campaigns with text/HTML composer and sandboxed live preview
- Personalization: {{name}}, {{first_name}}, {{email}}, {{company}}, {{sender_name}}, {{website}}, plus CSV columns
- Individual cold outreach through reviewed mailto drafts (manual sending)
- Optional opt-in campaign sending: 25 contacts per run, 8 seconds apart; stop button and local history
- Avoid repeat sends within one campaign, export history, JSON backup/restore
- Responsive navy and gold ABRA CRM-like interface; no login and no database (Excel import uses SheetJS from CDN)

**Cold email policy:** The automated provider integration is **only for permission-confirmed contacts**. Resend explicitly prohibits unsolicited cold outreach, scraped data and purchased lists: https://resend.com/legal/acceptable-use . Use the individual mailto draft workflow for lawful, personalized outreach using your own email app and its policies.

## 1. Start with the website

1. GitHub repository Settings → Pages → Source: **GitHub Actions**.
2. Actions → **Deploy MailPilot website** → Run workflow (or push a change to site/).
3. After successful deployment, the expected public URL is:
   https://kothakula-sagar.github.io/email-marketing/
4. Import CSV/Excel from Customers, create an email in Email Marketing, then open an individual draft from the customer row.

CRM customer CSV example:

    Import Code,Name,Email,Mobile,Company,Source,Email Status,Consent
    ,Priya Sharma,priya@example.com,9876543210,Example Industries,Lead,Subscribed,no
    ,Ravi Kumar,ravi@example.com,9123456789,Sample Company,Referral,Subscribed,yes

- consent=yes/true/consented means permission-confirmed **only if you have evidence of opt-in**.
- consent=no/blank/missing means Needs review, not eligible for automated sending.
- consent=unsubscribed/opt_out OR Email Status=Unsubscribed/Not Interested means suppressed. A CRM Subscribed field alone is treated as Needs review, not permission evidence.
- Previously unsubscribed emails remain suppressed on future imports.

## 2. Optional permission-based automated sending

**Recommended for Abra Logistics:** use authorized Gmail OAuth email sending, like your [existing Abra Logistics CRM](https://github.com/kothakula-sagar/Abra-logistics-crm). The CRM documentation identifies `abralogisticsupport@gmail.com` as the sending account. The Gmail API sends HTML and plain-text MIME in a single email. You can alternatively select Resend.

**This is a separate frontend with localStorage only. It does not read CRM data automatically or connect to the live CRM login/database.** Import fresh CRM customer exports into this app.

To send via Gmail, you need Cloudflare Workers, Google Cloud Gmail API enabled, an authorized OAuth 2.0 client and a Gmail refresh token authorized with the `gmail.send` scope. The sending account's authorization/consent must be completed by the account owner. Gmail's provider policies and consent requirements still apply.

Create a GitHub Environment named **production** in repo Settings → Environments. Add these values as **individual Environment secrets**:

| Secret | Value |
| --- | --- |
| CLOUDFLARE_API_TOKEN | Cloudflare API token with Workers Scripts editing permission |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare account ID |
| EMAIL_PROVIDER | `gmail` for CRM-style sending, or `resend` (default if omitted) |
| GMAIL_CLIENT_ID | Google Cloud OAuth client ID (for gmail) |
| GMAIL_CLIENT_SECRET | OAuth client secret (for gmail) |
| GMAIL_REFRESH_TOKEN | OAuth refresh token from the authorized Gmail account (for gmail) |
| GMAIL_USER_EMAIL | Authorized account, e.g. abralogisticsupport@gmail.com (for gmail) |
| RESEND_API_KEY | Resend API key (only for resend) |
| SEND_ACCESS_TOKEN | Random 24+ character send passphrase; separate from provider credentials |
| ALLOWED_ORIGIN | https://kothakula-sagar.github.io (without trailing slash or repo path) |
| SENDER_EMAIL | Gmail: same as GMAIL_USER_EMAIL; Resend: verified sender |
| FROM_NAME | Sender display name, e.g. ABRA LOGISTIC |
| COMPANY_NAME | Business name |
| POSTAL_ADDRESS | Accurate business mailing address |
| UNSUBSCRIBE_EMAIL | Monitored mailbox for marketing opt-outs |

Run Actions → **Deploy mail Worker** → Run workflow. The workflow validates provider-specific secrets and deploys them to Cloudflare, **not** GitHub Pages. Copy the resulting Worker URL and append `/send`.

In the app Settings, set the secure `/send` HTTPS endpoint and sender details. In Send center, provide the SEND_ACCESS_TOKEN for each send session (not stored in localStorage), confirm actual recipient opt-in, and approve the real send.

**Never commit credentials or refresh tokens.** The `.env.example` is placeholders only; Environment secrets are runtime deployment inputs and cannot be injected into publicly hosted static JavaScript.

Docs: [Gmail API sending](https://developers.google.com/workspace/gmail/api/guides/sending), [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Resend API](https://resend.com/docs/api-reference/emails/send-email).

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
    site/app.js                      CRM imports, contact fields, campaigns, localStorage and send UI
    worker/index.js                  Stateless Resend Worker
    wrangler.toml                    Worker settings
    tests/worker.test.js             Worker security, Gmail MIME and API forwarding tests
    tests/frontend.test.js           CRM CSV parsing and campaign tests
    .github/workflows/test.yml       CI tests
    .github/workflows/deploy-pages.yml  Pages deployment
    .github/workflows/deploy-worker.yml Worker deployment
    .env.example                     Secret names only, no credentials

**No automatic cold-email blasts, no contact harvesting and no account/login system.**
