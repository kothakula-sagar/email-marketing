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
  const emailKey = (value) => String(value ?? "").trim().toLowerCase();
  const IMPORT_HEADERS = ["Email","Name","Mobile","Company","Source","Email Status","Consent","Import Code"];
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
  let importSummary = "";
  let running = false;
  let stopRequested = false;
  let progress = {done: 0, total: 0, accepted: 0, failed: 0};
  let smtpStatus = null;
  let toastTimer = null;
  const pages = {
    overview: ["Overview", "Add customers, write a campaign, then review and send."],
    contacts: ["Customers", "Import a list, add a customer, or manage email subscriptions."],
    compose: ["Campaigns", "Write and preview your email before sending."],
    send: ["Send campaign", "Review eligible customers and send your campaign."],
    settings: ["Settings", "View mailbox settings and manage workspace backups."],
    guide: ["Getting started", "Download locally, configure .env and start emailing through your cPanel mailbox."]
  };
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && Array.isArray(raw.contacts) && raw.campaign && raw.settings && Array.isArray(raw.logs)) {
        const fresh = defaultState();
        return {version: 1, contacts: uniqueContacts(raw.contacts), campaigns: Array.isArray(raw.campaigns) ? raw.campaigns : [], campaign: {...fresh.campaign, ...raw.campaign}, settings: {...fresh.settings, ...raw.settings}, logs: raw.logs.slice(-2000)};
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
    return data.logs.some(x => x.result === "accepted" && x.campaignId === data.campaign.id && emailKey(x.email) === emailKey(email));
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
    $("#endpointStatus").textContent = configured ? "Mailbox configured" : "Mailbox setup required";
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
    if (running && to !== "send") return toast("Stop the current batch or wait for it to finish.", true);
    page = to;
    render();
    window.scrollTo({top:0, behavior:"instant"});
  }
  function overview() {
    const c = counts();
    const kpis = [
      ["Customers", c.total],
      ["Opted in", c.consented],
      ["Needs review", c.review],
      ["Emails accepted", c.accepted]
    ].map(x => '<div class="card stat"><div class="label">' + x[0] + '</div><div class="value">' + x[1].toLocaleString() + '</div></div>').join("");
    return '<div class="grid four">' + kpis + '</div>' +
      '<div class="section-heading"><h2>Start in three steps</h2></div>' +
      '<div class="card"><div class="steps">' +
        '<div class="step"><div class="number">1</div><strong>Import contacts</strong><p>Upload a CSV or Excel file. Existing email addresses are skipped.</p><br>' + makeButton("go-contacts", "Open customers", "secondary small") + '</div>' +
        '<div class="step"><div class="number">2</div><strong>Write your email</strong><p>Personalize with {{name}}, {{company}} and any CSV columns.</p><br>' + makeButton("go-compose", "Open campaigns", "secondary small") + '</div>' +
        '<div class="step"><div class="number">3</div><strong>Review and send</strong><p>Open an individual email, or send to verified opt-in contacts through the local SMTP mailbox.</p><br>' + makeButton("go-send", "Review and send", "primary small") + '</div>' +
      '</div></div>' +
      '<div class="section-heading"><h2>Recent activity</h2></div><div class="card">' + logsHtml(5) + '</div>';
  }
  function contactsView() {
    return '<div class="grid two">' +
      '<section class="card"><h3 style="margin:0">Import customers</h3>' +
        '<p class="help">Download the template, fill in your customer details, then upload it here. Email is required. Repeated email addresses are skipped.</p>' +
        '<div class="row">' + makeButton("download-template", "Download import template", "secondary small") + '</div><div class="file-picker" style="margin-top:16px"><label for="csvFile"><strong>Choose customer file</strong></label><p class="help">.csv / .xlsx • up to 10,000 customers</p><input id="csvFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Choose CRM customer export"></div>' +
        '<details style="margin:12px 0"><summary>Paste CSV instead</summary><div class="field"><label for="csvPaste">CSV rows</label><textarea id="csvPaste" class="textarea" rows="4" placeholder="Name,Email,Mobile,Company,Source,Consent&#10;Priya,priya@example.com,9876543210,Acme,Lead,no"></textarea></div></details>' +
        '<div class="row">' + makeButton("import-csv", "Import customers", "primary") + '</div>' +
        (importSummary ? '<p class="help" role="status">' + esc(importSummary) + '</p>' : '') + '</section>' +
      '<section class="card"><h3 style="margin-top:0">Add customer</h3>' +
        '<div class="grid two" style="gap:10px"><div class="field"><label for="newEmail">Email (required)</label><input id="newEmail" class="input" type="email" required placeholder="name@company.com"></div>' +
        '<div class="field"><label for="newName">Name</label><input id="newName" class="input" placeholder="Customer name"></div>' +
        '<div class="field"><label for="newPhone">Mobile</label><input id="newPhone" class="input" inputmode="tel" placeholder="+91..."></div>' +
        '<div class="field"><label for="newCompany">Company</label><input id="newCompany" class="input" placeholder="Company name"></div></div>' +
        '<div class="field"><label for="newSource">Source</label><select id="newSource" class="select"><option value="Manual">Manual</option><option value="Lead">Lead</option><option value="Website">Website</option><option value="Import">Import</option><option value="Referral">Referral</option></select></div>' +
        '<div class="field"><label for="newStatus">Email subscription</label><select id="newStatus" class="select"><option value="review">Needs review / cold contact</option><option value="consented">Permission confirmed</option><option value="unsubscribed">Unsubscribed</option></select></div>' +
        makeButton("add-contact", "Add customer", "primary") + '<p class="help">Only mark permission confirmed when you have actual marketing opt-in evidence.</p></section></div>' +
      '<div class="section-heading"><h2>Customers <span class="count">' + data.contacts.length + '</span></h2><div class="row">' + makeButton("export-csv", "Export customers", "secondary small") + '</div></div>' +
      '<div class="card"><div class="searchbar"><input id="searchContact" class="input" type="search" placeholder="Search by email, name, or company" value="' + esc(contactQuery) + '" aria-label="Search customers">' +
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
      const sent = data.logs.filter(l => emailKey(l.email) === c.email && l.result === "accepted").length;
      const action = c.status === "unsubscribed" ? makeButton("re-consent","Re-subscribe","secondary small",attr) :
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
    const campaigns = [data.campaign, ...data.campaigns.slice().reverse()];
    const library = campaigns.map(c => {
      const current = c.id === data.campaign.id;
      return '<li><div><strong>' + esc(c.name || "Untitled campaign") + '</strong>' +
        '<span>' + esc(c.subject || "No subject yet") + '</span></div>' +
        (current ? '<span class="status consented">Editing</span>' :
          makeButton("open-campaign", "Open", "secondary small", 'data-campaign="' + esc(c.id) + '"')) + '</li>';
    }).join("");
    return '<div class="stack"><section class="card"><div class="row between">' +
      '<h2>Saved campaigns</h2>' + makeButton("new-campaign", "+ New campaign", "primary") +
      '</div><ul class="campaign-list">' + library + '</ul></section>' +
      '<div class="split campaign-editor"><section class="card"><div class="row between">' +
      '<h2>Write your email</h2><span class="pill">Changes save automatically</span></div>' +
      field("Campaign name", "campaign.name", data.campaign.name, "input", "For your team’s reference") +
      field("Email subject", "campaign.subject", data.campaign.subject) +
      '<div class="field"><label for="modeInput">Message format</label>' +
      '<select class="select" id="modeInput" data-field="campaign.mode" aria-describedby="formatHelp">' +
      '<option value="text">Plain text</option><option value="html"' +
      (data.campaign.mode === "html" ? " selected" : "") + '>HTML source</option></select>' +
      '<p class="help" id="formatHelp">Choose HTML source to paste an email template into the message box below.</p></div>' +
      '<div class="field"><label for="bodyInput">Message</label><textarea id="bodyInput" class="textarea campaign-message" data-field="campaign.body">' + esc(data.campaign.body) + '</textarea></div>' +
      '<details><summary>Templates and personalization</summary><p>Insert customer details at the cursor.</p><div class="template-tools">' +
      [["Name","{{Name}}"],["Company","{{Company}}"],["Email","{{Email}}"],["Phone","{{Phone}}"],["Source","{{Source}}"],["Sender name","{{sender_name}}"]].map(([label,token]) =>
        makeButton("insert-token", label, "", 'data-token="' + token + '"')).join("") +
      '</div><div class="row">' +
      makeButton("template-intro", "Use introduction template", "secondary small") +
      makeButton("template-followup", "Use follow-up template", "secondary small") + '</div></details>' +
      '<div class="campaign-actions">' + makeButton("review-campaign", "Review recipients", "primary") + '</div></section>' +
      '<section class="card"><h2>Email preview</h2><div class="preview"><div class="preview-subject" id="previewSubject"></div>' +
      '<iframe id="previewFrame" title="Email preview" sandbox="" referrerpolicy="no-referrer"></iframe></div></section></div></div>';
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
  function campaignReady() {
    return ["name", "subject", "body"].every(key => String(data.campaign[key] || "").trim());
  }
  function sendView() {
    const recipients = eligible();
    const batch = recipients.slice(0, MAX_RUN);
    const logs = data.logs.filter(log => log.campaignId === data.campaign.id);
    const accepted = new Set(logs.filter(log => log.result === "accepted").map(log => emailKey(log.email)));
    const failed = new Set(logs.filter(log => log.result === "failed" && !accepted.has(emailKey(log.email))).map(log => emailKey(log.email)));
    const summary = [["Waiting to send", recipients.length], ["Accepted by mailbox", accepted.size], ["Failed recipients", failed.size]]
      .map(([label,total]) => '<div class="ghost-box"><span>' + label + '</span><strong>' + total + '</strong></div>').join("");
    const issue = !campaignReady() ? "Add a campaign name, subject, and message before sending." :
      !smtpStatus?.configured ? "Set up the sending mailbox in Settings." :
      !batch.length ? "No opted-in customers are waiting for this campaign." : "";
    return '<div class="stack"><section class="card"><div class="row between"><h2>' +
      esc(data.campaign.name || "Untitled campaign") + '</h2>' + makeButton("go-compose", "Edit campaign", "secondary small", running ? "disabled" : "") +
      '</div><p><strong>Subject</strong> · ' + esc(data.campaign.subject || "No subject yet") + '</p>' +
      '<p class="help">From ' + esc(smtpStatus?.from || "Mailbox setup required") + '</p>' +
      '<div class="send-summary">' + summary + '</div></section>' +
      '<div class="split"><section class="card"><h2>Review and send</h2>' +
      '<p class="help">Each batch sends to up to ' + MAX_RUN + ' opted-in customers. Failed emails may appear in the next batch.</p>' +
      (batch.length && !running ? '<details><summary>View next ' + batch.length + ' recipients</summary><ul class="recipient-list">' +
        batch.map(c => '<li>' + esc(c.email) + '</li>').join("") + '</ul></details>' : '') +
      (issue && !running ? '<p class="note">' + esc(issue) + '</p>' : '') +
      (!running && !issue ? '<label class="checkrow campaign-actions"><input type="checkbox" id="confirmPermission"><span>I reviewed the message and confirmed these customers opted in.</span></label>' : '') +
      '<div class="row campaign-actions">' +
        (running ? makeButton("stop-send", "Stop after current email", "danger") :
          makeButton("start-send", "Send " + batch.length + (batch.length === 1 ? " email" : " emails"), "primary", issue ? "disabled" : "")) +
      '</div><div class="progress-track campaign-actions"><div class="progress-fill" id="progressFill"></div></div>' +
      '<p class="help" id="progressLabel" role="status"></p></section>' +
      '<section class="card"><div class="row between"><h2>Campaign activity</h2>' + makeButton("export-log", "Export campaign log", "secondary small") + '</div>' +
      '<p class="help">Accepted means the sending mailbox accepted the email. Delivery can still fail later.</p>' +
      logsHtml(12, logs) + '</section></div></div>';
  }
  function updateProgress() {
    if (!$("#progressFill")) return;
    $("#progressFill").style.width = (progress.total ? Math.round(progress.done / progress.total * 100) : 0) + "%";
    $("#progressLabel").textContent = progress.total ?
      (running ? "Sending · " : progress.stopped ? "Stopped · " : "Batch finished · ") +
      progress.done + " of " + progress.total + " processed · " + progress.accepted + " accepted · " + progress.failed + " failed" : "";
  }
  function logsHtml(n, logs = data.logs) {
    const items = logs.slice().reverse().slice(0, n);
    if (!items.length) return '<p class="help">No emails sent yet.</p>';
    return '<div class="log-list">' + items.map(l =>
      '<div class="log"><div><strong>' + esc(l.email) + '</strong><span>' + esc(l.campaignName || "Campaign") + ' · ' + fmtDate(l.at) + '</span>' +
      (l.error ? '<p class="help">' + esc(l.error) + '</p>' : '') + '</div>' +
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
      '<details style="margin-top:16px"><summary>Mailbox setup instructions</summary><p class="help">Copy the outgoing server settings from cPanel → Email Accounts → Connect Devices into the local .env file, then restart the app.</p></details></section>' +
      '<section class="card"><h3 style="margin-top:0">Campaign preview details</h3><p class="help">These values are only for local preview/personalization. The actual SMTP sender and mandatory footer come from .env.</p><hr>' +
      field("Company name (preview)", "settings.company", s.company) +
      field("Sender name (personalization)", "settings.senderName", s.senderName) +
      field("Website (optional)", "settings.website", s.website) +
      '<div class="note warning">Actual FROM address: <b>' + esc(smtp?.from || "Not configured") + '</b>. Update SENDER_EMAIL, COMPANY_NAME, BUSINESS_ADDRESS and UNSUBSCRIBE_EMAIL in the local .env file—not here.</div>' +
      '<hr><h3>Customer and campaign backup</h3><div class="row">' +
      makeButton("export-backup","Download JSON backup","secondary small") +
      '<label class="btn secondary small" for="restoreBackup">Restore backup <input id="restoreBackup" type="file" accept=".json,application/json" style="display:none"></label></div>' +
      '<p class="help">Backups contain customer email addresses. Restoring a backup preserves current unsubscribes.</p>' +
      makeButton("remove-active", "Clear active contacts", "danger small") + '</section></div>';
  }
  function guideView() {
    return '<div class="grid two">' +
      '<section class="card"><h3>Using the workspace</h3><ol class="guide-list">' +
      '<li>Open Customers and download the import template. Fill in each customer’s email and upload the file.</li>' +
      '<li>Open Campaigns to write your message and review its preview.</li>' +
      '<li>Open Send campaign and review the customers who have opted in.</li></ol>' +
      '<p class="help">Change a customer to Unsubscribed in Customers when they opt out.</p></section>' +
      '<section class="card"><h3>Keeping your data</h3>' +
      '<p>Customers, campaigns and send history are saved in this browser. Download a backup before clearing browser data or switching computers.</p>' +
      makeButton("go-settings", "Open settings", "secondary small") + '</section></div>';
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
      const email = emailKey(row[emailAt]);
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
  function addNewCustomers(existing, incoming) {
    const customers = new Map();
    let added = 0;
    let duplicates = 0;
    for (const [index, group] of [existing, incoming].entries()) {
      for (const contact of group) {
        const email = emailKey(contact?.email);
        if (!validEmail(email)) continue;
        const saved = customers.get(email);
        if (saved) {
          if (index === 1) duplicates++;
          if (contact.status === "unsubscribed") saved.status = "unsubscribed";
          continue;
        }
        customers.set(email, {...contact, email});
        if (index === 1) added++;
      }
    }
    return {contacts: [...customers.values()], added, duplicates};
  }
  function uniqueContacts(contacts) {
    return addNewCustomers(contacts, []).contacts;
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
          if (!/\.xlsx$/i.test(file.name)) throw Error("Legacy .xls files are not supported. Save the file as .xlsx or CSV first.");
          const response = await fetch("/api/parse-xlsx",{
            method:"POST",headers:{"Content-Type":"application/octet-stream","X-Abra-Local":"1"},
            body:await file.arrayBuffer(),cache:"no-store"
          });
          const result=await response.json().catch(()=>({}));
          if(!response.ok) throw Error(result.error || "Excel parsing failed.");
          raw=result.csv;
        } else raw = await file.text();
      }
      const {list, invalid} = parseContacts(raw);
      const {contacts, added, duplicates} = addNewCustomers(data.contacts, list);
      if (contacts.length > MAX_CONTACTS) throw Error("Customer limit is 10,000.");
      data.contacts = contacts;
      importSummary = added + " added · " + duplicates + " duplicates skipped · " + invalid + " invalid emails skipped.";
      save(); render();
    } catch (error) {toast(error.message || "Customer import failed.",true);}
  }
  function addContact() {
    const email = emailKey($("#newEmail").value);
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
    if (c.status === "unsubscribed" && status !== "unsubscribed" && status !== "consented") return toast("An unsubscribed address remains suppressed until a fresh opt-in.", true);
    if (c.status === "unsubscribed" && status === "consented" && !confirm("Re-subscribe " + c.email + "? Confirm you have NEW documented, explicit marketing permission from this customer since they opted out.")) return;
    if (c.status !== "unsubscribed" && status === "consented" && !confirm("Confirm " + c.email + " explicitly opted in to marketing emails?")) return;
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
      ...data.logs.filter(l => l.campaignId === data.campaign.id).map(l => [l.at,l.email,l.campaignName,l.result,l.providerId || "",l.error || ""])];
    downloadFile("ABRA_Logistics_Send_History.csv", toCSV(rows), "text/csv;charset=utf-8");
  }
  async function restoreBackup(file) {
    if (!file) return;
    try {
      if (file.size > 6 * 1024 * 1024) throw Error("Backup too large.");
      const raw = JSON.parse(await file.text());
      if (!raw || !Array.isArray(raw.contacts) || !raw.campaign || !raw.settings || !Array.isArray(raw.logs)) throw Error("Not a valid ABRA Logistics email marketing backup.");
      if (raw.contacts.length > MAX_CONTACTS) throw Error("Too many contacts in backup.");
      const suppressedBefore = data.contacts.filter(c => c.status === "unsubscribed");
      if (!confirm("Restore this backup? Existing contacts and drafts will be replaced, but current opt-outs will remain suppressed.")) return;
      const restored = uniqueContacts(raw.contacts).map(c => ({
        ...c, status:["consented", "unsubscribed"].includes(c.status) ? c.status : "review"
      }));
      data = {version:1, contacts:addNewCustomers(restored, suppressedBefore).contacts,
        campaign:{...defaultState().campaign,...raw.campaign}, campaigns:Array.isArray(raw.campaigns) ? raw.campaigns : [], settings:{...defaultState().settings,...raw.settings}, logs:raw.logs.slice(-2000)};
      save(); render(); toast("Backup restored. Existing unsubscribed emails were preserved.");
    } catch (error) {toast(error.message || "Could not restore this backup.", true);}
  }
  function newCampaign() {
    if (running) return toast("Finish sending before switching campaigns.",true);
    if (!Array.isArray(data.campaigns)) data.campaigns = [];
    data.campaigns.push({...data.campaign});
    data.campaign = {id:id(), name:"", subject:"", mode:"text", body:""};
    progress = {done:0,total:0,accepted:0,failed:0};
    save(); render(); $("#campaign-name")?.focus?.();
  }
  function switchCampaign(campaignId) {
    if (running) return toast("Finish sending before switching campaigns.",true);
    if (!campaignId || campaignId === "current") return;
    const selectedIndex = data.campaigns.findIndex(c => c.id === campaignId);
    if (selectedIndex < 0) return toast("Campaign not found.",true);
    const selected = data.campaigns.splice(selectedIndex,1)[0];
    data.campaigns.push({...data.campaign});
    data.campaign = selected;
    progress = {done:0,total:0,accepted:0,failed:0};
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
  async function refreshSmtpStatus() {
    try {
      const response=await fetch("/api/health",{cache:"no-store"});
      if(!response.ok) throw Error("Local server unavailable.");
      smtpStatus=await response.json();
      if (notify) toast(smtpStatus.configured ? "Local SMTP settings found. Check connection to verify the password." : "Local SMTP not configured. Update .env and restart npm start.",!smtpStatus.configured);
      const here=page;
      if(here==="send" || here==="settings") render();
      else {
        $("#endpointDot").className="dot"+(smtpStatus.configured?" on":"");
        $("#endpointStatus").textContent=smtpStatus.configured?"Mailbox configured":"Mailbox setup required";
      }
    } catch (_) {
      smtpStatus={configured:false};

    }
  }
  async function startSending() {
    if (running) return;
    if (!campaignReady()) return toast("Add a campaign name, subject, and message before sending.", true);
    if(!smtpStatus?.configured) return toast("Open Settings for mailbox setup instructions.",true);
    const ready=eligible();
    if(!ready.length) return toast("No consent-confirmed unsent customers for this campaign.",true);
    if(!$("#confirmPermission")?.checked) return toast("Confirm customer permission and opt-out review first.",true);
    const batch=ready.slice(0,MAX_RUN);
    const campaign={...data.campaign};
    if(!confirm("This will send "+batch.length+" real emails from your local SMTP mailbox, spaced at least "+(SEND_INTERVAL/1000)+" seconds apart. Are you sure these customers opted in?")) return;
    running=true;stopRequested=false;
    progress={done:0,total:batch.length,accepted:0,failed:0};
    render();
    for(const contact of batch){
      if(stopRequested) break;
      const payload={
        to:contact.email,
        subject:replaceTokens(campaign.subject,contact,false),
        html:htmlEmail(contact,false),
        text:plainBody(contact,false),
        consentConfirmed:true
      };
      let outcome="failed",errorText="",providerId="";
      try {
        const response=await fetch("/api/send",{
          method:"POST",
          headers:{"Content-Type":"application/json","X-Abra-Local":"1"},
          body:JSON.stringify(payload),cache:"no-store"
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok){
          errorText=String(result.error||"HTTP "+response.status).slice(0,200);
          if([429,403,503].includes(response.status)) stopRequested=true;
        }else{
          outcome="accepted";
          providerId=String(result.id||"").slice(0,180);
        }
      }catch(e){errorText=String(e.message||"SMTP request failed").slice(0,180);stopRequested=true;}
      data.logs.push({at:new Date().toISOString(),email:contact.email,campaignId:campaign.id,
        campaignName:campaign.name,result:outcome,error:errorText,providerId});
      data.logs=data.logs.slice(-2000);
      save();
      progress.done++;
      if(outcome==="accepted") progress.accepted++;else progress.failed++;
      render();
      if(!stopRequested && progress.done<batch.length) await sleep(SEND_INTERVAL);
    }
    running=false;
    const endedEarly=stopRequested;
    progress.stopped=endedEarly;
    stopRequested=false;
    render();
    toast("Finished: "+progress.accepted+" accepted by SMTP, "+progress.failed+" failed."+(endedEarly?" Stopped early.":""));
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
    if (action === "re-consent") return setStatus(email,"consented");
    if (action === "export-csv") return exportCSV();
    if (action === "export-log") return exportLog();
    if (action === "export-backup") return downloadFile("ABRA_Logistics_Backup-" + new Date().toISOString().slice(0,10) + ".json",JSON.stringify({...data,backedUpAt:new Date().toISOString()},null,2),"application/json;charset=utf-8");
    if (action === "download-template") return downloadFile("ABRA_Customer_Import_Template.csv",toCSV([IMPORT_HEADERS]),"text/csv;charset=utf-8");
    if (action === "remove-active") {
      if (confirm("Remove all active and review contacts? Unsubscribed contacts will be kept as a suppression list.")) {
        data.contacts = data.contacts.filter(c => c.status === "unsubscribed");save();render();toast("Active contacts removed. Opt-outs preserved.");
      }
      return;
    }
    if (action === "review-campaign") {
      if (!campaignReady()) return toast("Add a campaign name, subject, and message first.", true);
      return go("send");
    }
    if (action === "open-campaign") return switchCampaign(target.dataset.campaign);
    if (action === "new-campaign") return newCampaign();
    if (action === "template-intro") return loadTemplate("intro");
    if (action === "template-followup") return loadTemplate("followup");
    if (action === "insert-token") return appendToken(target.dataset.token);
    if (action === "start-send") return startSending();
    if (action === "stop-send") {stopRequested = true; toast("Stopping after the current request."); return;}
  });
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "searchContact") {contactQuery = target.value; renderContactRows(); return;}
    if (!running && target.dataset.field) {
      saveField(target.dataset.field,target.value);
      if (page === "compose") {
        updatePreview();
        const active = $(".campaign-list li");
        if (active?.querySelector) {
          active.querySelector("strong").textContent = data.campaign.name || "Untitled campaign";
          active.querySelector("div span").textContent = data.campaign.subject || "No subject yet";
        }
      }

    }
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "contactFilter") {contactFilter = target.value;renderContactRows();}
    if (target.id === "restoreBackup") restoreBackup(target.files[0]);
    if (!running && target.dataset.field) {saveField(target.dataset.field,target.value);if(page === "compose") updatePreview();}
  });
  render();
  refreshSmtpStatus();
})();