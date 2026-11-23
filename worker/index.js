/**
 * MailPilot stateless send proxy. No database, no user accounts and no exposed provider API keys.
 * Only use this with opt-in/permission-confirmed recipients, consistent with Resend's AUP.
 */
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function json(body, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin"
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return new Response(JSON.stringify(body), {status, headers});
}
function safeCompare(a, b) {
  const one = new TextEncoder().encode(String(a));
  const two = new TextEncoder().encode(String(b));
  if (one.length !== two.length) return false;
  let mismatch = 0;
  for (let i = 0; i < one.length; i++) mismatch |= one[i] ^ two[i];
  return mismatch === 0;
}
function escapeHtml(value) {
  return String(value || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  }
  return btoa(binary);
}
function encodeEmailHeader(value) {
  return "=?UTF-8?B?" + base64Utf8(value).replace(/\r?\n/g,"") + "?=";
}
function gmailMime(payload,env) {
  const boundary = "mailpilot_" + crypto.randomUUID().replace(/-/g,"");
  const address = env.GMAIL_USER_EMAIL;
  const lines = [
    "From: " + encodeEmailHeader(String(env.FROM_NAME).replace(/[\r\n]/g,"")) + " <" + address + ">",
    "To: <" + payload.to[0] + ">",
    "Subject: " + encodeEmailHeader(payload.subject),
    "Reply-To: <" + env.UNSUBSCRIBE_EMAIL + ">",
    "List-Unsubscribe: <mailto:" + env.UNSUBSCRIBE_EMAIL + "?subject=Unsubscribe>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    "",
    "--" + boundary,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Utf8(payload.text),
    "--" + boundary,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Utf8(payload.html),
    "--" + boundary + "--",
    ""
  ];
  return base64Utf8(lines.join("\r\n")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function sendViaGmail(payload,env) {
  const oauth = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      grant_type:"refresh_token",
      refresh_token:env.GMAIL_REFRESH_TOKEN,
      client_id:env.GMAIL_CLIENT_ID,
      client_secret:env.GMAIL_CLIENT_SECRET
    }).toString()
  });
  if (!oauth.ok) return {status:502, error:"Gmail OAuth token exchange failed. Verify the refresh token and OAuth configuration."};
  const auth = await oauth.json().catch(() => ({}));
  if (!auth.access_token) return {status:502,error:"Gmail access token unavailable."};
  const result = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method:"POST",
    headers:{"Authorization":"Bearer " + auth.access_token,"Content-Type":"application/json"},
    body:JSON.stringify({raw:gmailMime(payload,env)})
  });
  if (!result.ok) return {status:result.status===429 ? 429:502,
    error:result.status===429 ? "Gmail rate limit reached. Try later." : "Gmail rejected this message. Check the sender address, OAuth permissions, account and sending policy."};
  const body = await result.json().catch(() => ({}));
  return {status:200,id:String(body.id||"")};
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin") || "";
    const originAllowed = !!env.ALLOWED_ORIGIN && requestOrigin === env.ALLOWED_ORIGIN;
    const origin = originAllowed ? requestOrigin : "";
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return originAllowed ? new Response(null, {
        status:204,
        headers:{
          "Access-Control-Allow-Origin":origin,
          "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
          "Access-Control-Allow-Headers":"Authorization, Content-Type",
          "Access-Control-Max-Age":"600",
          "Vary":"Origin"
        }
      }) : json({error:"Origin not allowed."},403,"");
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ok:true, service:"MailPilot send proxy", storage:"none"},200,origin);
    }
    if (request.method !== "POST" || url.pathname !== "/send") return json({error:"Not found."},404,origin);
    if (!originAllowed) return json({error:"Origin not allowed."},403,"");
    const provider = String(env.EMAIL_PROVIDER || "resend").toLowerCase();
    if (!["resend","gmail"].includes(provider)) return json({error:"Email provider configuration is invalid."},503,origin);
    const required = ["SEND_ACCESS_TOKEN","ALLOWED_ORIGIN","SENDER_EMAIL","FROM_NAME","COMPANY_NAME","POSTAL_ADDRESS","UNSUBSCRIBE_EMAIL"];
    required.push(...(provider === "gmail" ? ["GMAIL_CLIENT_ID","GMAIL_CLIENT_SECRET","GMAIL_REFRESH_TOKEN","GMAIL_USER_EMAIL"] : ["RESEND_API_KEY"]));
    if (required.some(name => !env[name])) return json({error:"Worker secrets are incomplete."},503,origin);
    if (provider === "gmail" && String(env.GMAIL_USER_EMAIL).toLowerCase() !== String(env.SENDER_EMAIL).toLowerCase()) return json({error:"Gmail sender email must match the authorized Gmail account."},503,origin);
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!safeCompare(token, env.SEND_ACCESS_TOKEN)) return json({error:"Invalid send passphrase."},401,origin);
    const size = Number(request.headers.get("Content-Length") || "0");
    if (size > 110000) return json({error:"Message too large."},413,origin);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 110000) return json({error:"Message too large."},413,origin);
      body = JSON.parse(raw);
    } catch (_) {return json({error:"Invalid JSON."},400,origin);}
    const to = String(body?.to || "").trim().toLowerCase();
    const subject = String(body?.subject || "").trim();
    const html = String(body?.html || "");
    const textBody = String(body?.text || "");
    if (body?.consentConfirmed !== true) return json({error:"Confirmed recipient marketing permission is required."},422,origin);
    if (!emailPattern.test(to) || to.length > 254) return json({error:"Invalid recipient email."},422,origin);
    if (!subject || subject.length > 180 || /[\r\n]/.test(subject)) return json({error:"Invalid subject."},422,origin);
    if ((!html && !textBody) || html.length > 65000 || textBody.length > 35000) return json({error:"Invalid message size."},422,origin);
    if (/<script\b|on[a-z]+\s*=|javascript\s*:/i.test(html)) return json({error:"Active HTML content is not permitted."},422,origin);
    if (!emailPattern.test(env.SENDER_EMAIL) || !emailPattern.test(env.UNSUBSCRIBE_EMAIL)) return json({error:"Sender setup is invalid."},503,origin);

    // Always attach sender identity, postal address and an opt-out route at the server.
    const optOutAddress = env.UNSUBSCRIBE_EMAIL;
    const footerHtml = '<div style="border-top:1px solid #e5e7eb;margin-top:28px;padding-top:16px;font-size:12px;color:#657080;line-height:1.6">' +
      escapeHtml(env.COMPANY_NAME) + ' · ' + escapeHtml(env.POSTAL_ADDRESS) +
      '<br>To stop further emails, reply <strong>unsubscribe</strong> or email <a href="mailto:' +
      encodeURIComponent(optOutAddress) + '?subject=Unsubscribe">' + escapeHtml(optOutAddress) + '</a>.</div>';
    const finalHtml = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, footerHtml + "</body>") : html + footerHtml;
    const finalText = textBody + '\n\n—\n' + env.COMPANY_NAME + ' | ' + env.POSTAL_ADDRESS +
      '\nTo opt out, reply unsubscribe or email ' + optOutAddress + '.';
    const payload = {
      from: String(env.FROM_NAME).slice(0,90).replace(/[<>\r\n]/g,"") + " <" + env.SENDER_EMAIL + ">",
      to:[to], subject,
      html:finalHtml,
      text:finalText,
      reply_to:optOutAddress,
      headers:{"List-Unsubscribe":"<mailto:" + optOutAddress + "?subject=Unsubscribe>"}
    };
    try {
      if (provider === "gmail") {
        const result = await sendViaGmail(payload,env);
        if (result.status !== 200) return json({error:result.error},result.status,origin);
        return json({ok:true,id:result.id,provider:"gmail"},200,origin);
      }
      const result = await fetch("https://api.resend.com/emails", {
        method:"POST",
        headers:{"Authorization":"Bearer " + env.RESEND_API_KEY, "Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      const response = await result.json().catch(() => ({}));
      if (!result.ok) {
        if (result.status === 429) return json({error:"Provider rate limit. Stop and try later."},429,origin);
        return json({error:"Email provider rejected the request. Check verified domain, consent and provider dashboard."},502,origin);
      }
      return json({ok:true,id:String(response.id || ""),provider:"resend"},200,origin);
    } catch (_) {
      return json({error:"Email provider is temporarily unreachable."},502,origin);
    }
  }
};