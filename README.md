# ABRA LOGISTIC — Local Email Marketing

A simple desktop-friendly web app that runs **on your own computer**. No login, no database, no GitHub Pages and no Cloudflare required.

**Start:** npm install once, create your private local .env, then npm start → http://localhost:3000

The app uses the **support@abra-logistic.com** mailbox's SMTP login to send email. This is the same email account shown in Roundcube at webmail.abra-logistic.com, but Roundcube is only the mailbox interface; the outgoing server hostname must be obtained from cPanel separately.

## 1. Download and start

Requires **Node.js 20 or newer** and npm.

1. Download the repository as a ZIP and extract it, or clone:

   git clone https://github.com/kothakula-sagar/email-marketing.git

2. Open a terminal in the project folder:

   cd email-marketing
   npm install

3. Create your private **.env** file from **.env.example**.

   Windows PowerShell:
   
       Copy-Item .env.example .env

   Windows Command Prompt:

       copy .env.example .env

   macOS/Linux:

       cp .env.example .env

4. In .env, fill in the correct values from cPanel (instructions below).
5. Start:

       npm start

6. Open http://localhost:3000 in a browser. Leave the terminal window open while using the app.
7. In **Send center**, select **Check SMTP connection**. After success, use **Send test email** to your own configured TEST_EMAIL before any customer campaign.

To stop, press **Ctrl + C** in the terminal. When you open it another day, run **npm start** (npm install is usually needed only after downloading or changing dependencies).

### Do not use the Roundcube web address as SMTP_HOST

Open cPanel → Email Accounts → find **support@abra-logistic.com** → **Connect Devices** → *Mail Client Manual Settings*.

Use the **Outgoing Server** and SMTP port/encryption shown there. Depending on your hosting configuration, this may be:
- Port **465** with SSL/TLS, **SMTP_SECURE=true**, or
- Port **587** with STARTTLS, **SMTP_SECURE=false**.

Use the exact server hostname shown in cPanel. Do **not** assume that webmail.abra-logistic.com is the SMTP hostname.

SMTP_USER is support@abra-logistic.com. SMTP_PASS is the mailbox's email-account password or the provider-supported SMTP credential. **Never post this password in chat or commit it to GitHub.**

## 2. Local .env example

Copy .env.example and replace placeholders locally:

    APP_PORT=3000

    SMTP_HOST=YOUR_OUTGOING_MAIL_SERVER_FROM_CPANEL
    SMTP_PORT=465
    SMTP_SECURE=true
    SMTP_USER=support@abra-logistic.com
    SMTP_PASS=YOUR_PRIVATE_MAILBOX_PASSWORD

    SENDER_EMAIL=support@abra-logistic.com
    SENDER_NAME=ABRA LOGISTIC
    REPLY_TO_EMAIL=support@abra-logistic.com
    UNSUBSCRIBE_EMAIL=support@abra-logistic.com

    COMPANY_NAME=ABRA LOGISTIC
    BUSINESS_ADDRESS=YOUR_REAL_BUSINESS_POSTAL_ADDRESS
    TEST_EMAIL=YOUR_OWN_TEST_EMAIL

    SEND_INTERVAL_MS=8000
    SEND_DAILY_LIMIT=50

Save the file, then restart npm start. The real .env is excluded by .gitignore.

**Secrets stay on your friend's computer.** The frontend never reads SMTP_PASS, and browser data contains only contacts, campaigns, statuses, previews and local send history. There is no GitHub Environment deployment.

## 3. What is included

### Customers
- Add individually: **Name, Email, Mobile, Company, Source, Email subscription**
- Import customers from **CSV** or **XLSX** (Excel read in memory by the local Node server); paste CSV rows
- Supports familiar Abra Logistics CRM columns: **Import Code, Name, Email, Mobile, Company, Source, Email Status, Consent**
- Search and filter, deduplicate by email and export customer CSV
- Three statuses: **Needs review, Permission confirmed, Unsubscribed**
- Preserve previous Unsubscribed statuses when importing more data or restoring a backup

**Permission reminder:** a legacy CRM column that simply says "Subscribed" is not proof of opt-in. An imported customer is marked Needs review unless the Consent column clearly records verified permission. Not Interested/Unsubscribed always overrides any consent.

### Email Marketing
- Create and switch between multiple locally saved email campaigns
- Campaign name, subject, message body, plain text or HTML source
- Live sandboxed preview and personalization tokens:
  {{Name}}, {{Company}}, {{Email}}, {{Phone}}, {{Source}}, {{sender_name}}, plus imported columns such as {{city}}
- Individual email draft opens in your normal email client
- Automated sends only to recipients confirmed as opted in
- Maximum **10 recipients per UI run**, **8 seconds between accepted sends**, plus a **50-per-day process cap by default**
- "Stop after current email" control
- Per-campaign duplicate prevention, SMTP accepted/failed logs and local CSV history export
- All outgoing messages include business identity, physical mailing address, and manual email unsubscribe instructions
- Check SMTP Connection and Send Test Email

### Local storage and backups
- Customers, subscribed/unsubscribed choices, campaigns, settings and send history are stored in the **browser's localStorage** only.
- Export full JSON backup, restore it or export CSV.
- Clearing browser site data can erase your local data. Different browsers/devices/origins do not sync.
- The Node server handles SMTP and XLSX parsing **in memory only**. It does not create or use an SQL or cloud database.
- SMTP credentials are only in your local .env and are **never stored in localStorage**.
- For consistent data, always use **http://localhost:3000**, not a mixture of localhost and 127.0.0.1.

## 4. Important before sending — failed deliveries in Roundcube

The screenshot of the support mailbox shows many messages with the subject **"Mail delivery failed: returning message to..."**. This suggests messages have bounced, but the screenshot itself does not show the underlying reason or which addresses failed.

Before sending to customers:
1. Open one of the Mail Delivery System notices in Roundcube.
2. Find the diagnostic text or SMTP status code, e.g. recipient not found, mailbox full, policy rejected, rate-limited or blocked.
3. In cPanel, review **Email Deliverability** (SPF, DKIM, DMARC), **Track Delivery**, SMTP quota and any domain/IP blocklists.
4. Stop or suppress undeliverable addresses, honor unsubscribe replies, and test with an email you control.
5. Start with a very small permission-based campaign. Check for delayed bounces.

**SMTP accepted does not mean delivered.** The local app records the server's accepted response, not inbox placement. Mailbox provider limits are still in force, even if you change the local app's safety caps.

## 5. Limitations

- Automated bulk sending is for permission-confirmed recipients only. Use individual, reviewed outreach where permitted by law and the hosting provider.
- **No automatic opt-out sync:** customers replying "unsubscribe" must be manually marked Unsubscribed in the local Customers screen. Do not contact them again.
- **No durable server-side suppression**: this is a no-database local app. A deleted browser profile or an old backup can lose opt-outs. Maintain a secure current backup.
- No open or click tracking, no bounce webhooks, no reply reading, no background send queue and no automatic delivery confirmations.
- **Roundcube Sent folder:** sending via SMTP does not automatically insert messages into the webmail IMAP Sent folder. Use this app's local send log unless IMAP Sent-folder archiving is added later.
- This is a **single-computer/single-browser** tool. The Node server binds to 127.0.0.1 only; it must not be publicly exposed or placed on a production server without additional authentication and durable compliance controls.
- The per-process local safety cap resets when the program restarts; it does not replace hosting quotas.

## 6. Code and tests

    server.js               Local Express + Nodemailer SMTP service, test endpoints, Excel importer
    site/index.html         User interface
    site/styles.css         Abra Logistics-themed styling
    site/app.js             Contacts, campaigns, localStorage, email preview, SMTP UI
    tests/frontend.test.js  CRM column parsing, consent, templates, campaigns
    tests/local.test.js     Local API request protection and SMTP formatting
    .env.example            Local placeholders (never contains secrets)
    .gitignore              Excludes .env and node_modules
    package.json            npm start, npm test and dependencies

Run checks:

    npm test

The project tests use fake test-only environment values. They do not contact the actual mailbox or send real emails. Actual end-to-end delivery must be tested on the user's computer after setting up the real cPanel credentials.
