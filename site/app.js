/* ABRA LOGISTIC — localhost email marketing frontend. Contacts and campaigns use localStorage; SMTP credentials stay only in local .env. */
(function () {
  "use strict";
  const KEY = "mailpilot.workspace.v1";
  const MAX_CONTACTS = 10000;
  const MAX_RUN = 10;
  const SEND_INTERVAL = 8000;
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
  const id = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const defaultState = () => ({
    version: 1,
    contacts: [],
    campaigns: [],
    campaign: {
      id: id(),
      name: "ABRA Logistics | B2B Introduction",
      subject: "Freight solutions for {{Company}}",
      mode: "text",
      body: "Hi {{Name}},\n\nI am reaching out from {{sender_name}} at ABRA LOGISTIC. We offer FTL and PTL freight solutions for business shipments across South India.\n\nWould you be open to a brief conversation about logistics requirements at {{Company}}?\n\nRegards,\n{{sender_name}}"
    },
    settings: {
      company: "Abra Logistics", senderName: "ABRA LOGISTIC", senderEmail: "support@abra-logistic.com", website: "https://www.abra-logistic.com",
      address: "", optOutEmail: "support@abra-logistic.com", endpoint: ""
    },
    logs: []
  });
  let data = load();
  let page = "overview";
  let contactQuery = "";
  let contactFilter = "all";
  let running = false;
  let stopRequested = false;
  let progress = {done: 0, total: 0, accepted: 0, failed: 0};
  let smtpStatus = null;
  let toastTimer = null;
  const pages = {
    overview: ["Overview", "A clear picture of your contact list, campaigns and next steps."],
    contacts: ["Customers", "The CRM-style customer directory, now with simple local file imports."],
    compose: ["Email Marketing", "Create campaigns, personalize customer emails and preview before sending."],
    send: ["Send center", "Prepare individual outreach or carefully send to permission-confirmed contacts."],
    settings: ["Settings", "Check local SMTP configuration and manage private browser backups."],
    guide: ["Getting started", "Download locally, configure .env and start emailing through your cPanel mailbox."]
  };
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && Array.isArray(raw.contacts) && raw.campaign && raw.settings && Array.isArray(raw.logs)) {
        const fresh = defaultState();
        return {version: 1, contacts: raw.contacts, campaigns: Array.isArray(raw.campaigns) ? raw.campaigns : [], campaign: {...fresh.campaign, ...raw.campaign}, settings: {...fresh.settings, ...raw.settings}, logs: raw.logs.slice(-2000)};
      }
    } catch (_) {}
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (_) { toast("Browser storage is full or blocked. Export a backup and make room.", true); }
  }
  function toast(message, error) {
    const el = $("#toast");
    el.textContent = message;
    el.style.background = error ? "#a52b41" : "#162842";
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 4400);
  }
  function fmtDate(date) {
    if (!date) return "—";
    const d = new Date(date);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, {dateStyle:"medium", timeStyle:"short"});
  }
  function makeButton(action, label, css, attr) {
    return '<button class="btn ' + (css || "secondary small") + '" data-act="' + esc(action) + '" ' + (attr || "") + '>' + esc(label) + '</button>';
  }
  function saveField(field, value) {
    if (field.startsWith("settings.")) data.settings[field.slice(9)] = value;
    else if (field.startsWith("campaign.")) data.campaign[field.slice(9)] = value;
    save();
  }
  function counts() {
    return {
      total: data.contacts.length,
      consented: data.contacts.filter(x => x.status === "consented").length,
      review: data.contacts.filter(x => x.status === "review").length,
      unsubscribed: data.contacts.filter(x => x.status === "unsubscribed").length,
      accepted: data.logs.filter(x => x.result === "accepted").length
    };
  }
  function campaignAccepted(email) {
    return data.logs.some(x => x.result === "accepted" && x.campaignId === data.campaign.id && x.email === email);
  }
  function eligible() {
    return data.contacts.filter(x => x.status === "consented" && validEmail(x.email) && !campaignAccepted(x.email));
  }
  function render() {
    $("#pageTitle").textContent = pages[page][0];
    $("#pageSubtitle").textContent = pages[page][1];
    document.querySelectorAll("[data-nav]").forEach(btn => btn.classList.toggle("active", btn.dataset.nav === page));
    const configured = !!smtpStatus?.configured;
    $("#endpointDot").className = "dot" + (configured ? " on" : "");
    $("#endpointStatus").textContent = configured ? "SMTP configured" : "SMTP setup required";
    $("#view").innerHTML = page === "overview" ? overview() :
      page === "contacts" ? contactsView() :
      page === "compose" ? composeView() :
      page === "send" ? sendView() :
      page === "settings" ? settingsView() : guideView();
    if (page === "contacts") renderContactRows();
    if (page === "compose") updatePreview();
    if (page === "send") updateProgress();
  }
  function go(to) {
    if (!pages[to]) return;
    page = to;
    render();
    window.scrollTo({top:0, behavior:"instant"});
  }
  function overview() {
    const c = counts();
    const kpis = [
      ["Total contacts", c.total, "Imported into this browser", "♧"],
      ["Permission confirmed", c.consented, "Eligible for automated sending", "✓"],
      ["Needs review", c.review, "Use personal outreach", "⌕"],
      ["Provider accepted", c.accepted, "Not verified deliveries", "➤"]
    ].map(x => '<div class="card stat"><div class="iconbox">' + x[3] + '</div><div class="label">' + x[0] + '</div><div class="value">' + x[1].toLocaleString() + '</div><div class="note">' + x[2] + '</div></div>').join("");
    return '<div class="grid four">' + kpis + '</div>' +
      '<div class="section-heading"><h2>Start in three steps</h2><small>No registration required</small></div>' +
      '<div class="card"><div class="steps">' +
        '<div class="step"><div class="number">1</div><strong>Import contacts</strong><p>Upload a CSV or paste new rows. Duplicate addresses are merged.</p><br>' + makeButton("go-contacts", "Import CSV", "secondary small") + '</div>' +
        '<div class="step"><div class="number">2</div><strong>Write your email</strong><p>Personalize with {{name}}, {{company}} and any CSV columns.</p><br>' + makeButton("go-compose", "Open composer", "secondary small") + '</div>' +
        '<div class="step"><div class="number">3</div><strong>Review and send</strong><p>Open an individual email, or send to verified opt-in contacts through your own secure endpoint.</p><br>' + makeButton("go-send", "Send center", "primary small") + '</div>' +
      '</div></div>' +
      '<div class="section-heading"><h2>Workspace notes</h2></div>' +
      '<div class="grid two">' +
        '<div class="card"><h3 style="margin-top:0">📥 Your data stays here</h3><p class="muted">Contacts, template drafts, permission statuses and send history live in localStorage on this device and browser. Nothing syncs across devices. Export backups before clearing browser data.</p>' + makeButton("export-backup", "Download JSON backup", "secondary small") + '</div>' +
        '<div class="card"><h3 style="margin-top:0">🛡 Responsible sending</h3><p class="muted">Cold contacts can be approached individually through your mail app where permitted. Automated marketing sends only include permission-confirmed contacts. Always honor unsubscribe requests and your provider rules.</p>' + makeButton("go-guide", "Read setup guide", "secondary small") + '</div>' +
      '</div><div class="section-heading"><h2>Recent activity</h2></div><div class="card">' + logsHtml(5) + '</div>';
  }
  function contactsView() {
    return '<div class="grid two">' +
      '<section class="card"><div class="row between"><h3 style="margin:0">Import CRM customers</h3><span class="crm-tag">CSV / Excel</span></div>' +
        '<p class="help">Upload a CSV or Excel export from the ABRA Logistics CRM. Supported fields: Import Code, Name, Email, Mobile, Company, Source, Email Status, Consent. Old unsubscribe statuses stay blocked. A CRM “Subscribed” field alone does not prove marketing consent.</p>' +
        '<div class="file-picker" style="margin-top:16px"><label for="csvFile"><strong>Choose customer file</strong></label><p class="help">.csv / .xlsx / .xls • up to 10,000 customers</p><input id="csvFile" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Choose CRM customer export"></div>' +
        '<div class="field" style="margin-top:16px"><label for="csvPaste">Or paste CSV rows</label><textarea id="csvPaste" class="textarea" rows="4" placeholder="Name,Email,Mobile,Company,Source,Consent&#10;Priya,priya@example.com,9876543210,Acme,Lead,no"></textarea></div>' +
        '<div class="row">' + makeButton("import-csv", "Import customers", "primary") + makeButton("sample-csv", "CRM sample CSV", "secondary") + '</div></section>' +
      '<section class="card"><h3 style="margin-top:0">Add customer</h3>' +
        '<div class="grid two" style="gap:10px"><div class="field"><label for="newName">Name</label><input id="newName" class="input" placeholder="Customer name"></div>' +
        '<div class="field"><label for="newEmail">Email *</label><input id="newEmail" class="input" type="email" placeholder="name@company.com"></div>' +
        '<div class="field"><label for="newPhone">Mobile</label><input id="newPhone" class="input" inputmode="tel" placeholder="+91..."></div>' +
        '<div class="field"><label for="newCompany">Company</label><input id="newCompany" class="input" placeholder="Company name"></div></div>' +
        '<div class="field"><label for="newSource">Source</label><select id="newSource" class="select"><option value="Manual">Manual</option><option value="Lead">Lead</option><option value="Website">Website</option><option value="Import">Import</option><option value="Referral">Referral</option></select></div>' +
        '<div class="field"><label for="newStatus">Email subscription</label><select id="newStatus" class="select"><option value="review">Needs review / cold contact</option><option value="consented">Permission confirmed</option><option value="unsubscribed">Unsubscribed</option></select></div>' +
        makeButton("add-contact", "Add customer", "primary") + '<p class="help">Only mark permission confirmed when you have actual marketing opt-in evidence.</p></section></div>' +
      '<div class="section-heading"><h2>Customers <span class="count">' + data.contacts.length + '</span></h2><div class="row">' + makeButton("export-csv", "Export customers", "secondary small") + makeButton("remove-active", "Clear active contacts", "danger small") + '</div></div>' +
      '<div class="card"><div class="searchbar"><input id="searchContact" class="input" type="search" placeholder="Search customer, mobile, company or source" value="' + esc(contactQuery) + '" aria-label="Search customers">' +
      '<select id="contactFilter" class="select" style="max-width:175px" aria-label="Filter contact status"><option value="all">All statuses</option><option value="review">Needs review</option><option value="consented">Permission confirmed</option><option value="unsubscribed">Unsubscribed</option></select></div>' +
      '<div id="contactRows"></div><p class="help">Manual messages open in your email app. Permission-based automated campaigns exclude unsubscribed and unverified contacts.</p></div>';
  }
  function renderContactRows() {
    if (!$("#contactRows")) return;
    const filtered = data.contacts.filter(c => (contactFilter === "all" || c.status === contactFilter) &&
      [c.name,c.email,c.phone,c.company,c.source].join(" ").toLowerCase().includes(contactQuery.toLowerCase()));
    const el = $("#contactRows");
    if ($("#contactFilter")) $("#contactFilter").value = contactFilter;
    if (!filtered.length) {
      el.innerHTML = '<div class="empty"><div class="emoji">📭</div><h3>No matching customers</h3><p>Import a CRM file or change the search and filter.</p></div>';
      return;
    }
    const rows = filtered.slice(0, 250).map((c, i) => {
      const attr = 'data-email="' + esc(c.email) + '"';
      const sent = data.logs.filter(l => l.email === c.email && l.result === "accepted").length;
      const action = c.status === "unsubscribed" ? '<span class="muted small-text">Opted out</span>' :
        makeButton("manual-mail", "✉ Email", "secondary small", attr) +
        (c.status === "review" ? makeButton("mark-consent", "✓ Opt-in", "secondary small", attr) : makeButton("mark-review", "Review", "secondary small", attr)) +
        makeButton("mark-optout", "Opt out", "danger small", attr);
      return '<tr><td>' + (i+1) + '</td><td><div class="person"><span class="avatar">' + esc((c.name || c.email || "?").slice(0,1)) +
      '</span><div><strong>' + esc(c.name || "Unnamed") + '</strong><small>' + esc(c.email) + '</small></div></div></td>' +
        '<td>' + esc(c.phone || "—") + '</td><td>' + esc(c.company || "—") + '</td><td>' + esc(c.source || "Import") + '</td>' +
        '<td><span class="status ' + esc(c.status) + '">' + (c.status === "consented" ? "Subscribed*" : c.status === "review" ? "Needs review" : "Unsubscribed") + '</span></td>' +
        '<td>' + sent + '</td><td><div class="actions">' + action + '</div></td></tr>';
    }).join("");
    el.innerHTML = '<div class="table-wrap"><table class="crm-customers"><thead><tr><th>Sl No</th><th>Name & Email</th><th>Mobile</th><th>Company</th><th>Source</th><th>Email status</th><th>Sent</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="help">*Subscribed means verified opt-in in this workspace, not merely a “Subscribed” label imported from the CRM.</p>' +
      (filtered.length > 250 ? '<p class="help">Showing first 250 of ' + filtered.length + ' matches. Refine search to find more.</p>' : "");
  }
  function composeView() {
    const past = (data.campaigns || []).slice().reverse();
    const options = '<option value="current">' + esc(data.campaign.name || "Current campaign") + ' — editing</option>' +
      past.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name || "Untitled campaign") + ' — saved</option>').join("");
    return '<div class="campaign-strip"><span class="crm-tag">Email Marketing</span><label for="campaignSwitch"><b>Campaign</b></label>' +
      '<select class="select" id="campaignSwitch" aria-label="Choose saved email campaign">' + options + '</select>' +
      makeButton("new-campaign", "+ New campaign", "primary small") +
      '<span class="pill">' + (1+past.length) + ' locally saved</span></div>' +
      '<div class="split"><section class="card"><div class="row between"><h3 style="margin:0">Create / Edit Campaign</h3><span class="pill">Auto-saved</span></div>' +
      '<p class="help">Just like the ABRA Logistics CRM: campaign name, subject, message and customer personalization.</p><hr>' +
      field("Campaign name", "campaign.name", data.campaign.name, "input", "Saved in this browser only") +
      field("Subject", "campaign.subject", data.campaign.subject, "input", "Use {{Name}}, {{Company}} or other CRM customer details") +
      '<div class="field"><label for="modeInput">Email format</label><select class="select" id="modeInput" data-field="campaign.mode"><option value="text"' + (data.campaign.mode === "text" ? " selected" : "") + '>Plain text — simple outreach</option><option value="html"' + (data.campaign.mode === "html" ? " selected" : "") + '>HTML template code</option></select></div>' +
      '<div class="field"><label for="bodyInput">Campaign body</label><textarea id="bodyInput" class="textarea" style="min-height:285px" data-field="campaign.body" spellcheck="true">' + esc(data.campaign.body) + '</textarea></div>' +
      '<div class="template-tools"><button data-act="insert-token" data-token="{{Name}}">{{Name}}</button><button data-act="insert-token" data-token="{{Company}}">{{Company}}</button><button data-act="insert-token" data-token="{{Email}}">{{Email}}</button><button data-act="insert-token" data-token="{{Phone}}">{{Phone}}</button><button data-act="insert-token" data-token="{{Source}}">{{Source}}</button><button data-act="insert-token" data-token="{{sender_name}}">{{sender_name}}</button></div>' +
      '<div class="row">' + makeButton("template-intro", "Intro template", "secondary small") + makeButton("template-followup", "Follow-up template", "secondary small") + makeButton("go-send", "Review sending →", "primary small") + '</div></section>' +
      '<section class="card"><div class="row between"><h3 style="margin:0">Email preview</h3><span class="pill">Personalized</span></div>' +
      '<p class="help">HTML rendering uses a sandboxed, script-blocked frame. The automatic-sending footer includes opt-out information.</p><hr>' +
      '<div class="preview"><div class="preview-subject" id="previewSubject"></div><iframe id="previewFrame" title="Email preview" sandbox="" referrerpolicy="no-referrer"></iframe></div>' +
      '<p class="help">Other imported CSV columns also work: {{city}}, {{industry}}, {{pickup_city}} and more.</p></section></div>';
  }
  function field(label, key, value, type, hint) {
    const formId = key.replace(".", "-");
    return '<div class="field"><label for="' + esc(formId) + '">' + esc(label) + '</label><input id="' + esc(formId) + '" class="' + (type || "input") + '" data-field="' + esc(key) + '" value="' + esc(value || "") + '">' + (hint ? '<p class="help">' + esc(hint) + '</p>' : "") + '</div>';
  }
  function replaceTokens(text, contact, html) {
    const ctx = {
      name: contact.name || "there", first_name: (contact.name || "there").split(" ")[0],
      company: contact.company || "your team", email: contact.email || "", phone:contact.phone || "", source:contact.source || "",
      sender_name: data.settings.senderName || data.settings.company || "Our team",
      website: data.settings.website || ""
    };
    if (contact.extras && typeof contact.extras === "object") Object.keys(contact.extras).forEach(k => {ctx[k] = contact.extras[k]});
    return String(text || "").replace(/\{\{\s*([a-z0-9_ -]+)\s*\}\}/gi, (token, key) => {
      const value = ctx[key.trim().toLowerCase().replace(/[\s-]+/g, "_")];
      return value === undefined ? "" : (html ? esc(value) : String(value));
    });
  }
  function footerText(contact) {
    const s = data.settings;
    const company = s.company || s.senderName || "Sender";
    const unsubscribe = validEmail(s.optOutEmail) ? s.optOutEmail : (validEmail(s.senderEmail) ? s.senderEmail : "");
    return "\n\n—\n" + company + (s.address ? " | " + s.address : "") + "\n" +
      (unsubscribe ? "To stop further outreach, reply 'unsubscribe' or email " + unsubscribe + "." : "Reply 'unsubscribe' to stop further outreach.");
  }
  function htmlEmail(contact, includeFooter) {
    const s = data.settings;
    const unsub = validEmail(s.optOutEmail) ? s.optOutEmail : s.senderEmail;
    const body = data.campaign.mode === "html"
      ? replaceTokens(data.campaign.body, contact, true)
      : '<div style="white-space:pre-wrap">' + esc(replaceTokens(data.campaign.body, contact, false)) + '</div>';
    const footer = '<div style="font-size:12px;line-height:1.7;color:#6b7280;margin-top:30px;border-top:1px solid #e8eaf0;padding-top:15px">' +
      esc(s.company || s.senderName || "Sender") + (s.address ? ' · ' + esc(s.address) : "") +
      '<div>To opt out, reply <b>unsubscribe</b>' +
      (validEmail(unsub) ? ' or <a href="mailto:' + encodeURIComponent(unsub) + '?subject=Unsubscribe">email us</a>' : "") + '.</div></div>';
    return '<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#1f2937;max-width:650px;padding:22px;margin:auto">' + body + (includeFooter === false ? '' : footer) + '</body></html>';
  }
  function plainBody(contact, includeFooter) {
    const body = replaceTokens(data.campaign.body, contact, false);
    const text = data.campaign.mode === "html"
      ? body.replace(/<br\s*\/?>/gi,"\n").replace(/<\/p>/gi,"\n\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      : body;
    return text + (includeFooter === false ? '' : footerText(contact));
  }
  function updatePreview() {
    const sample = data.contacts.find(c => c.status !== "unsubscribed") || {name:"Priya Sharma",email:"priya@example.com",company:"Example Industries",extras:{}};
    const subject = $("#previewSubject");
    const frame = $("#previewFrame");
    if (subject) subject.textContent = "Subject: " + replaceTokens(data.campaign.subject, sample, false);
    if (frame) frame.srcdoc = htmlEmail(sample);
  }
  function sendView() {
    const ready = eligible().length;
    const c=counts();
    const smtp = smtpStatus;
    const badge = smtp?.configured ? '<span class="status consented">SMTP configured</span>' : '<span class="status review">SMTP setup required</span>';
    return '<div class="grid two">' +
      '<section class="card"><h3 style="margin:0 0 12px">✉ Mailbox connection</h3><p class="muted">Send through <b>support@abra-logistic.com</b> with the SMTP details in your local <code>.env</code> file. Nothing is hosted on GitHub or Cloudflare.</p>' +
      '<div class="row" style="margin:15px 0">' + badge + '<span class="pill">' + esc(smtp?.host || "SMTP host not configured") + (smtp?.port ? ":"+smtp.port : "") + '</span></div>' +
      '<div class="row">' + makeButton("verify-smtp", "Check SMTP connection", "secondary small") + makeButton("test-email", "Send test email", "primary small") + '</div>' +
      '<p class="help">Connection check logs in to SMTP but does not send. Test email sends one real email to the address set as TEST_EMAIL in your local .env (or SMTP_USER by default).</p>' +
      '<div class="note warning" style="margin-top:16px"><b>Delivery warning:</b> Your Roundcube screenshot shows multiple mail-delivery failure notices. Before a customer campaign, inspect those bounce messages and the hosting provider’s mail-delivery reports. SMTP acceptance is not delivery.</div></section>' +
      '<section class="card"><h3 style="margin:0 0 12px">✅ Campaign recipients</h3>' +
      '<p class="muted">Only customers marked permission confirmed are eligible for automated sending. Unsubscribed addresses and already accepted recipients for this campaign are excluded.</p>' +
      '<div class="grid two"><div class="ghost-box"><div class="muted small-text">Eligible to send</div><div style="font-size:29px;font-weight:800">' + ready + '</div></div>' +
      '<div class="ghost-box"><div class="muted small-text">Excluded</div><div style="font-size:29px;font-weight:800">' + (c.total-ready) + '</div></div></div>' +
      '<div style="margin-top:15px">' + makeButton("go-contacts", "View customer list", "secondary small") + '</div></section></div>' +
      '<div class="section-heading"><h2>Campaign sending</h2><span class="pill">Max ' + MAX_RUN + ' per run · at least ' + SEND_INTERVAL / 1000 + ' seconds between sends</span></div>' +
      '<div class="split"><section class="card">' +
      '<div class="field"><label>Campaign name</label><input class="input" value="' + esc(data.campaign.name) + '" readonly></div>' +
      '<div class="field"><label>Subject</label><input class="input" value="' + esc(data.campaign.subject) + '" readonly></div>' +
      '<label class="checkrow"><input type="checkbox" id="confirmPermission"><span>I have verified that these specific customers have agreed to receive marketing messages, checked the unsubscribe requests and delivery errors, and previewed the email content.</span></label><br>' +
      '<div class="row">' + makeButton("start-send", "Start email campaign", "primary", running?"disabled":"") +
        makeButton("stop-send", "Stop after current email", "danger",running?"":"disabled") + '</div>' +
      '<div class="help" id="sendNote" style="margin-top:12px">The Node server reads the local .env automatically. No passwords or mail keys are entered or saved in this page.</div>' +
      '<hr><div class="note warning">Without a database, incoming unsubscribe replies and bounced addresses must be handled manually in Customers. Server sending limits are temporary safety caps, not a replacement for your hosting provider limits.</div></section>' +
      '<section class="card"><div class="row between"><h3 style="margin:0">Send progress</h3><span class="pill" id="progressLabel">Ready</span></div>' +
      '<p class="help">“Accepted” means the SMTP server accepted the message. It may still bounce later. The webmail Sent folder may not automatically show SMTP API sends.</p>' +
      '<div class="progress-track" style="margin:24px 0 12px"><div class="progress-fill" id="progressFill"></div></div>' +
      '<div class="grid two"><div><span class="muted small-text">Accepted</span><div id="progressAccepted" style="font-size:26px;font-weight:800">0</div></div>' +
      '<div><span class="muted small-text">Failed</span><div id="progressFailed" style="font-size:26px;font-weight:800">0</div></div></div><hr>' +
      '<div class="row between"><b>Recent send history</b>' + makeButton("export-log", "Export log", "secondary small") + '</div>' + logsHtml(9) + '</section></div>';
  }
  function updateProgress() {
    if (!$("#progressFill")) return;
    $("#progressFill").style.width = (progress.total ? Math.round(progress.done / progress.total * 100) : 0) + "%";
    $("#progressAccepted").textContent = progress.accepted;
    $("#progressFailed").textContent = progress.failed;
    $("#progressLabel").textContent = running ? progress.done + " / " + progress.total : (progress.done ? "Finished" : "Ready");
    const start = document.querySelector('[data-act="start-send"]');
    const stop = document.querySelector('[data-act="stop-send"]');
    if (start) start.disabled = running;
    if (stop) stop.disabled = !running;
  }
  function logsHtml(n) {
    const items = data.logs.slice().reverse().slice(0, n);
    if (!items.length) return '<div class="empty"><div class="emoji">🗂</div><h3>No send history yet</h3><p>Any API sending results will appear here, saved locally.</p></div>';
    return '<div class="log-list">' + items.map(l =>
      '<div class="log"><div><strong>' + esc(l.email) + '</strong><span>' + esc(l.campaignName || "Campaign") + ' · ' + fmtDate(l.at) + '</span></div>' +
      '<span class="status ' + (l.result === "accepted" ? "consented" : "unsubscribed") + '">' + (l.result === "accepted" ? "Accepted" : "Failed") + '</span></div>'
    ).join("") + '</div>';
  }
  function settingsView() {
    const s=data.settings;
    const smtp=smtpStatus;
    return '<div class="split"><section class="card"><h3 style="margin-top:0">Local SMTP mailbox settings</h3>' +
      '<p class="muted">Your friend should create a file named <code>.env</code> beside <code>package.json</code> on their own computer. Never upload their mailbox password to GitHub.</p><hr>' +
      '<div class="grid two" style="gap:13px">' +
      '<div class="ghost-box"><div class="muted small-text">Email account</div><b>' + esc(smtp?.from || "Set SMTP_USER in .env") + '</b></div>' +
      '<div class="ghost-box"><div class="muted small-text">Mail server</div><b>' + esc(smtp?.host || "Not configured") + ':' + esc(smtp?.port || "—") + '</b></div></div>' +
      '<div class="row" style="margin:16px 0">' +
      makeButton("refresh-smtp", "Refresh SMTP settings", "secondary small") +
      makeButton("verify-smtp", "Check connection", "secondary small") +
      makeButton("test-email", "Send test email", "primary small") + '</div>' +
      '<div class="note">Open cPanel → Email Accounts → <b>support@abra-logistic.com</b> → Connect Devices. Copy the actual SMTP hostname, port and SSL/TLS settings into .env. The Node server must be restarted after changes.</div>' +
      '<p class="help">Current test recipient: ' + esc(smtp?.testRecipient || "Not configured") + '. The password is never sent to the browser or stored in localStorage.</p></section>' +
      '<section class="card"><h3 style="margin-top:0">Campaign preview details</h3><p class="help">These values are only for local preview/personalization. The actual SMTP sender and mandatory footer come from .env.</p><hr>' +
      field("Company name (preview)", "settings.company", s.company) +
      field("Sender name (personalization)", "settings.senderName", s.senderName) +
      field("Website (optional)", "settings.website", s.website) +
      '<div class="note warning">Actual FROM address: <b>' + esc(smtp?.from || "Not configured") + '</b>. Update SENDER_EMAIL, COMPANY_NAME, BUSINESS_ADDRESS and UNSUBSCRIBE_EMAIL in the local .env file—not here.</div>' +
      '<hr><h3>Customer and campaign backup</h3><div class="row">' +
      makeButton("export-backup","Download JSON backup","secondary small") +
      '<label class="btn secondary small" for="restoreBackup">Restore backup <input id="restoreBackup" type="file" accept=".json,application/json" style="display:none"></label></div>' +
      '<p class="help">Backups include customer emails. Keep them private. Previously unsubscribed addresses are preserved on restore.</p></section></div>';
  }
  function guideView() {
    return '<div class="grid two"><section class="card"><h3 style="margin-top:0">Start locally in five steps</h3><ol class="guide-list">' +
      '<li>Download or clone <b>kothakula-sagar/email-marketing</b> on your computer.</li>' +
      '<li>Open the project in a terminal and run <code>npm install</code> once.</li>' +
      '<li>Copy <code>.env.example</code> to <code>.env</code>. Set actual SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and business address.</li>' +
      '<li>Run <code>npm start</code>, then open <b>http://localhost:3000</b>.</li>' +
      '<li>In Send center, check SMTP and send one test email. Once that works, import customers and write an email campaign.</li>' +
      '</ol><div class="note">No account or database. Data lives in the current browser at localhost. Different computers, ports and browsers have different localStorage.</div></section>' +
      '<section class="card"><h3 style="margin-top:0">Use the website mailbox</h3>' +
      '<p class="muted">The screenshot is Roundcube Webmail for <b>support@abra-logistic.com</b>. Roundcube is a mail interface; sending from this app uses the same mailbox’s outgoing SMTP service through Node.js.</p>' +
      '<ol class="guide-list"><li>Find the outgoing server details in cPanel <b>Connect Devices</b> (not just the URL of Roundcube).</li>' +
      '<li>Set SMTP_PORT=465 and SMTP_SECURE=true for SSL/TLS, <i>if that is what cPanel lists</i>, or use the cPanel supplied settings.</li>' +
      '<li>Use the mailbox password or the provider-approved mail credential. Do not enter a cPanel dashboard password into this website.</li>' +
      '<li>If the test fails, check MX/SPF/DKIM/DMARC, mailbox quota, firewall, and bounce reason codes.</li></ol></section></div>' +
      '<div class="section-heading"><h2>FAQ</h2></div><div class="card">' +
      '<details open><summary>Does it send from support@abra-logistic.com?</summary><p>Yes, after the mailbox SMTP settings authenticate correctly. The actual sender is SMTP_USER/SENDER_EMAIL from your .env. A successful SMTP request is not a delivery guarantee.</p></details>' +
      '<details><summary>Are contacts and campaigns saved in a database?</summary><p>No. Customers, subscriptions, campaigns, drafts and send history remain in localStorage for the browser and localhost origin. Use Export backup before changing browsers or clearing site data.</p></details>' +
      '<details><summary>Will sent messages appear in Roundcube Sent?</summary><p>Not necessarily. SMTP transmits messages but does not save a copy into Roundcube’s IMAP Sent folder. Use the local send log; automatic IMAP Sent-folder copying requires additional configuration.</p></details>' +
      '<details><summary>How do unsubscribes work?</summary><p>Messages provide a monitored email address for unsubscribe requests. Check that mailbox regularly and manually set those customers to Unsubscribed before the next campaign. Do not re-import opted-out customers as subscribed.</p></details>' +
      '<details><summary>Can I use this for mass cold emails?</summary><p>The automatic sender only handles verified opt-in recipients. For new business prospects, review individual outreach and comply with the mailbox host’s policies, email laws and any opt-out requests.</p></details></div>';
  }
  function parseCSV(input) {
    const csv = String(input || "").replace(/^\uFEFF/, "");
    const rows = [], row = [];
    let value = "", quoted = false;
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i];
      if (ch === '"') {
        if (quoted && csv[i+1] === '"') {value += '"'; i++;}
        else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        row.push(value.trim()); value = "";
      } else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && csv[i+1] === "\n") i++;
        row.push(value.trim()); value = "";
        if (row.some(x => x !== "")) rows.push(row.slice());
        row.length = 0;
      } else value += ch;
    }
    if (quoted) throw Error("The CSV has an unclosed quoted cell.");
    row.push(value.trim());
    if (row.some(x => x !== "")) rows.push(row);
    return rows;
  }
  function fieldKey(s) {return String(s || "").toLowerCase().trim().replace(/[\s-]+/g,"_").replace(/[^a-z0-9_]/g,"");}
  function parseContacts(raw) {
    const rows = parseCSV(raw);
    if (rows.length < 2) throw Error("Include a header row and at least one customer.");
    const header = rows.shift().map(fieldKey);
    const indexOf = keys => header.findIndex(h => keys.includes(h));
    const emailAt = indexOf(["email","email_address","emailid","email_id","e_mail"]);
    const nameAt = indexOf(["name","full_name","customer_name","contact_name","first_name"]);
    const companyAt = indexOf(["company","company_name","business","business_name","organization"]);
    const phoneAt = indexOf(["mobile","phone","phone_number","phonenum","mobile_number","contact_number","contact"]);
    const sourceAt = indexOf(["source","lead_source","customer_source"]);
    const consentAt = indexOf(["consent","marketing_consent","opt_in","permission","permission_confirmed"]);
    const statusAt = indexOf(["email_status","emailstatus","marketing_status","marketingstatus","status","subscribed"]);
    if (emailAt < 0) throw Error("CRM file must include an Email column.");
    const list = [];
    let invalid = 0;
    for (const row of rows) {
      const email = (row[emailAt] || "").trim().toLowerCase();
      if (!validEmail(email)) {invalid++; continue;}
      const consent = fieldKey(consentAt < 0 ? "" : row[consentAt]);
      const emailStatus = fieldKey(statusAt < 0 ? "" : row[statusAt]);
      const optedOut = ["unsubscribed","not_interested","opted_out","opt_out","blocked","do_not_contact"].includes(emailStatus) ||
        ["unsubscribed","not_interested","opted_out","opt_out","blocked","do_not_contact"].includes(consent);
      // A default “Subscribed” CRM field does not itself prove marketing opt-in.
      const optedIn = ["yes","true","1","opted_in","opt_in","consented","permission_confirmed"].includes(consent);
      const status = optedOut ? "unsubscribed" : optedIn ? "consented" : "review";
      const extras = {};
      header.forEach((h,i) => {if (h && ![emailAt,nameAt,companyAt,phoneAt,sourceAt,consentAt,statusAt].includes(i)) extras[h] = row[i] || "";});
      list.push({email, name: nameAt < 0 ? "" : row[nameAt] || "", company: companyAt < 0 ? "" : row[companyAt] || "",
        phone:phoneAt < 0 ? "" : row[phoneAt] || "", source:sourceAt < 0 ? "Import" : (row[sourceAt] || "Import"),
        status, extras, createdAt:new Date().toISOString()});
    }
    return {list, invalid};
  }
  async function importCSV() {
    const file = $("#csvFile") && $("#csvFile").files[0];
    const pasted = $("#csvPaste") && $("#csvPaste").value.trim();
    if (!file && !pasted) return toast("Select a CRM customer file or paste CSV rows.", true);
    try {
      if (file && file.size > 5 * 1024 * 1024) throw Error("File must be under 5 MB.");
      let raw = pasted;
      if (!raw && file) {
        if (/\.(xlsx|xls)$/i.test(file.name)) {
          if (!window.XLSX) throw Error("Excel reader unavailable. Connect to the internet or export a CSV from the CRM.");
          const workbook = window.XLSX.read(await file.arrayBuffer(), {type:"array",cellDates:false});
          if (!workbook.SheetNames.length) throw Error("Excel workbook is empty.");
          raw = window.XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
        } else raw = await file.text();
      }
      const {list, invalid} = parseContacts(raw);
      if (data.contacts.length + list.length > MAX_CONTACTS * 2) throw Error("Too many rows. Keep under 10,000 customers.");
      const map = new Map(data.contacts.map(c => [c.email,c]));
      let added=0, updated=0;
      for (const contact of list) {
        const old = map.get(contact.email);
        if (old) {
          map.set(contact.email,{...old,name:contact.name || old.name,company:contact.company || old.company,
            phone:contact.phone || old.phone || "",source:contact.source || old.source || "Import",
            extras:{...(old.extras || {}),...contact.extras},
            status:old.status === "unsubscribed" || contact.status === "unsubscribed" ? "unsubscribed" :
              old.status === "consented" || contact.status === "consented" ? "consented" : "review"});
          updated++;
        } else {map.set(contact.email,contact);added++;}
      }
      if (map.size > MAX_CONTACTS) throw Error("Customer limit is 10,000.");
      data.contacts = [...map.values()];
      save();render();
      toast("Imported " + added + " new customers; updated " + updated + ". " + invalid + " invalid rows skipped.");
    } catch (error) {toast(error.message || "Customer import failed.",true);}
  }
  function addContact() {
    const email = ($("#newEmail").value || "").trim().toLowerCase();
    if (!validEmail(email)) return toast("Enter a valid email address.", true);
    if (data.contacts.some(x => x.email === email)) return toast("This email already exists. Use its actions instead.", true);
    if (data.contacts.length >= MAX_CONTACTS) return toast("Reached 10,000 contact limit.", true);
    const status = $("#newStatus").value;
    if (status === "consented" && !confirm("Confirm this person explicitly agreed to receive marketing emails?")) return;
    data.contacts.unshift({email, name:$("#newName").value.trim(), company:$("#newCompany").value.trim(),
      phone:$("#newPhone").value.trim(), source:$("#newSource").value, status,extras:{},createdAt:new Date().toISOString()});
    save(); render(); toast("Contact added.");
  }
  function findContact(email) {return data.contacts.find(c => c.email === email);}
  function setStatus(email, status) {
    const c = findContact(email);
    if (!c) return;
    if (c.status === "unsubscribed" && status !== "unsubscribed") return toast("An unsubscribed address remains suppressed. Obtain a new, documented opt-in before making changes.", true);
    if (status === "consented" && !confirm("Confirm " + c.email + " explicitly opted in to marketing emails?")) return;
    c.status = status; save(); renderContactRows(); toast("Contact updated.");
  }
  function manualMail(email) {
    const c = findContact(email);
    if (!c || c.status === "unsubscribed") return toast("This address is unsubscribed and cannot be contacted.", true);
    const subject = replaceTokens(data.campaign.subject, c, false);
    const body = plainBody(c);
    if (subject.length + body.length > 4800) return toast("Message is too long for a mailto link. Shorten it in Composer.", true);
    window.location.href = "mailto:" + encodeURIComponent(c.email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    toast("Email draft opened. Sending is handled by your mail app.");
  }
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], {type:mime || "text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function toCSV(rows) {
    return "\uFEFF" + rows.map(row => row.map(v => {let cell = String(v == null ? "" : v); if (/^[\t\r\n ]*[=+@-]/.test(cell)) cell = "'" + cell; return '"' + cell.replace(/"/g, '""') + '"';}).join(",")).join("\r\n");
  }
  function exportCSV() {
    const extras = [...new Set(data.contacts.flatMap(c => Object.keys(c.extras || {})))].sort();
    const rows = [["Name","Email","Mobile","Company","Source","Email Status","Consent",...extras],
      ...data.contacts.map(c => [c.name,c.email,c.phone || "",c.company,c.source || "",c.status === "unsubscribed" ? "Unsubscribed" : "Subscribed",c.status === "consented" ? "yes" : c.status === "unsubscribed" ? "unsubscribed" : "no",...extras.map(x => (c.extras || {})[x] || "")])];
    downloadFile("ABRA_Logistics_Customers.csv", toCSV(rows), "text/csv;charset=utf-8");
  }
  function exportLog() {
    const rows = [["date","email","campaign","result","provider_id","error"],
      ...data.logs.map(l => [l.at,l.email,l.campaignName,l.result,l.providerId || "",l.error || ""])];
    downloadFile("mailpilot-send-history.csv", toCSV(rows), "text/csv;charset=utf-8");
  }
  async function restoreBackup(file) {
    if (!file) return;
    try {
      if (file.size > 6 * 1024 * 1024) throw Error("Backup too large.");
      const raw = JSON.parse(await file.text());
      if (!raw || !Array.isArray(raw.contacts) || !raw.campaign || !raw.settings || !Array.isArray(raw.logs)) throw Error("Not a MailPilot backup.");
      if (raw.contacts.length > MAX_CONTACTS) throw Error("Too many contacts in backup.");
      const suppressedBefore = data.contacts.filter(c => c.status === "unsubscribed");
      if (!confirm("Restore this backup? Existing contacts and drafts will be replaced, but current opt-outs will remain suppressed.")) return;
      const optouts = new Set(data.contacts.filter(x => x.status === "unsubscribed").map(x => x.email));
      data = {version:1, contacts:raw.contacts.filter(x => x && validEmail(x.email)).map(c =>
        ({...c, status:optouts.has(c.email) || c.status === "unsubscribed" ? "unsubscribed" :
          c.status === "consented" ? "consented" : "review"})),
        campaign:{...defaultState().campaign,...raw.campaign}, campaigns:Array.isArray(raw.campaigns) ? raw.campaigns : [], settings:{...defaultState().settings,...raw.settings}, logs:raw.logs.slice(-2000)};
      for (const old of optouts) if (!data.contacts.some(c => c.email === old)) {
        const original = suppressedBefore.find(c => c.email === old);
        data.contacts.push(original || {email:old,name:"",company:"",phone:"",source:"Backup",status:"unsubscribed",extras:{}});
      }
      save(); render(); toast("Backup restored. Existing unsubscribed emails were preserved.");
    } catch (error) {toast(error.message || "Could not restore this backup.", true);}
  }
  function newCampaign() {
    if (running) return toast("Finish sending before switching campaigns.",true);
    if (!confirm("Create a new campaign? The current draft will be saved to the campaign library.")) return;
    if (!Array.isArray(data.campaigns)) data.campaigns = [];
    data.campaigns.push({...data.campaign});
    data.campaign = defaultState().campaign;
    save(); render(); toast("New campaign ready. Previous campaign saved.");
  }
  function switchCampaign(campaignId) {
    if (running) return toast("Finish sending before switching campaigns.",true);
    if (!campaignId || campaignId === "current") return;
    const selectedIndex = data.campaigns.findIndex(c => c.id === campaignId);
    if (selectedIndex < 0) return toast("Campaign not found.",true);
    const selected = data.campaigns.splice(selectedIndex,1)[0];
    data.campaigns.push({...data.campaign});
    data.campaign = selected;
    save();render();toast("Opened campaign: " + data.campaign.name);
  }
  function loadTemplate(which) {
    if (!confirm("Replace the current subject and body with this template?")) return;
    if (which === "intro") {
      data.campaign.subject = "Introduction — {{company}}";
      data.campaign.body = "Hi {{first_name}},\n\nI am {{sender_name}}. I wanted to introduce our team and see if our services could be relevant to {{company}}.\n\nIf this is of interest, would a quick introduction call be useful?\n\nRegards,\n{{sender_name}}";
    } else {
      data.campaign.subject = "Following up with {{company}}";
      data.campaign.body = "Hi {{first_name}},\n\nFollowing up on our earlier conversation. Is there a good time this week to discuss whether we can help {{company}}?\n\nIf this is not relevant, please let me know and I will not follow up.\n\nRegards,\n{{sender_name}}";
    }
    data.campaign.mode = "text"; save(); render(); toast("Template loaded.");
  }
  function appendToken(token) {
    const area = $("#bodyInput");
    if (!area) return;
    const start = area.selectionStart, end = area.selectionEnd;
    data.campaign.body = area.value.slice(0,start) + token + area.value.slice(end);
    area.value = data.campaign.body;
    area.focus(); area.setSelectionRange(start+token.length,start+token.length);
    save(); updatePreview();
  }
  function sleep(ms) {return new Promise(resolve => setTimeout(resolve, ms));}
  async function startSending() {
    if (running) return;
    const ready = eligible();
    if (!ready.length) return toast("No permission-confirmed unsent contacts for this campaign.", true);
    const endpoint = data.settings.endpoint.trim();
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(endpoint)) return toast("Configure a valid HTTPS Worker /send URL in Settings.", true);
    if (!data.settings.company.trim() || !data.settings.address.trim() || !validEmail(data.settings.senderEmail) || !validEmail(data.settings.optOutEmail)) {
      return toast("Complete company, address, sender email and unsubscribe email in Settings.", true);
    }
    const access = $("#sendAccessToken").value.trim();
    if (!access) return toast("Enter the send passphrase. It is never saved in your browser.", true);
    if (!$("#confirmPermission").checked) return toast("Confirm recipient permission and suppression review first.", true);
    const batch = ready.slice(0, MAX_RUN);
    if (!confirm("Send " + batch.length + " marketing emails, one every " + SEND_INTERVAL/1000 + " seconds? This is a real send. Continue?")) return;
    running = true; stopRequested = false;
    progress = {done:0,total:batch.length,accepted:0,failed:0};
    render();
    for (const contact of batch) {
      if (stopRequested) break;
      const payload = {
        to:contact.email,
        subject:replaceTokens(data.campaign.subject,contact,false),
        html:htmlEmail(contact, false),
        text:plainBody(contact, false),
        consentConfirmed:true
      };
      let outcome = "failed", errorText = "", providerId = "";
      try {
        const response = await fetch(endpoint, {
          method:"POST",
          headers:{"Content-Type":"application/json","Authorization":"Bearer " + access},
          body:JSON.stringify(payload),
          cache:"no-store"
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          errorText = String(result.error || "HTTP " + response.status).slice(0,180);
          if ([401,403,429].includes(response.status)) stopRequested = true;
        } else {
          outcome = "accepted";
          providerId = String(result.id || "").slice(0,160);
        }
      } catch (e) {errorText = String(e.message || "Network request failed").slice(0,180); stopRequested = true;}
      data.logs.push({at:new Date().toISOString(),email:contact.email,campaignId:data.campaign.id,
        campaignName:data.campaign.name,result:outcome,error:errorText,providerId});
      data.logs = data.logs.slice(-2000);
      save();
      progress.done++;
      if (outcome === "accepted") progress.accepted++; else progress.failed++;
      render();
      if (!stopRequested && progress.done < batch.length) await sleep(SEND_INTERVAL);
    }
    running = false;
    const endedEarly = stopRequested;
    stopRequested = false;
    render();
    toast("Send run complete: " + progress.accepted + " accepted, " + progress.failed + " failed." + (endedEarly ? " Stopped early." : ""));
  }
  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {go(nav.dataset.nav); return;}
    const target = event.target.closest("[data-act]");
    if (!target) return;
    const action = target.dataset.act, email = target.dataset.email;
    if (action.startsWith("go-")) return go(action.slice(3));
    if (action === "import-csv") return importCSV();
    if (action === "add-contact") return addContact();
    if (action === "manual-mail") return manualMail(email);
    if (action === "mark-consent") return setStatus(email,"consented");
    if (action === "mark-review") return setStatus(email,"review");
    if (action === "mark-optout") return setStatus(email,"unsubscribed");
    if (action === "export-csv") return exportCSV();
    if (action === "export-log") return exportLog();
    if (action === "export-backup") return downloadFile("mailpilot-backup-" + new Date().toISOString().slice(0,10) + ".json",JSON.stringify({...data,backedUpAt:new Date().toISOString()},null,2),"application/json;charset=utf-8");
    if (action === "sample-csv") return downloadFile("ABRA_Logistics_Customer_Import.csv",toCSV([["Import Code","Name","Email","Mobile","Company","Source","Email Status","Consent"],["","Priya Sharma","priya@example.com","9876543210","Example Industries","Lead","Subscribed","no"],["","Ravi Kumar","ravi@example.com","9123456789","Sample Company","Referral","Subscribed","yes"]]),"text/csv;charset=utf-8");
    if (action === "remove-active") {
      if (confirm("Remove all active and review contacts? Unsubscribed contacts will be kept as a suppression list.")) {
        data.contacts = data.contacts.filter(c => c.status === "unsubscribed");save();render();toast("Active contacts removed. Opt-outs preserved.");
      }
      return;
    }
    if (action === "new-campaign") return newCampaign();
    if (action === "template-intro") return loadTemplate("intro");
    if (action === "template-followup") return loadTemplate("followup");
    if (action === "insert-token") return appendToken(target.dataset.token);
    if (action === "start-send") return startSending();
    if (action === "verify-smtp") return verifySmtp();
    if (action === "test-email") return sendTestEmail();
    if (action === "refresh-smtp") return refreshSmtpStatus(true);
    if (action === "stop-send") {stopRequested = true; toast("Stopping after the current request."); return;}
  });
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "searchContact") {contactQuery = target.value; renderContactRows(); return;}
    if (target.dataset.field) {
      saveField(target.dataset.field,target.value);
      if (page === "compose") updatePreview();

    }
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "contactFilter") {contactFilter = target.value;renderContactRows();}
    if (target.id === "campaignSwitch") return switchCampaign(target.value);
    if (target.id === "restoreBackup") restoreBackup(target.files[0]);
    if (target.dataset.field) {saveField(target.dataset.field,target.value);if(page === "compose") updatePreview();}
  });
  render();
  refreshSmtpStatus(false);
})();