/**
 * ABRA LOGISTIC — local-only email campaign SMTP bridge.
 *
 * Contacts, campaigns, opt-outs and logs remain in each browser's localStorage.
 * This process keeps no customer database and binds to 127.0.0.1 by default.
 * Never expose this server on a public IP or deploy it to a public hosting service.
 */
import "dotenv/config";
import express from "express";
import nodemailer from "nodemailer";
import ExcelJS from "exceljs";
import sanitizeHtml from "sanitize-html";
import {fileURLToPath} from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_HOST = "127.0.0.1"; // deliberately loopback only
const APP_PORT = Number(process.env.APP_PORT || 3000);
const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || (SMTP_PORT === 465 ? "true" : "false")).toLowerCase() === "true";
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = (process.env.SMTP_PASS || "").trim();
const SENDER_EMAIL = (process.env.SENDER_EMAIL || SMTP_USER).trim();
const SENDER_NAME = (process.env.SENDER_NAME || "ABRA LOGISTIC").trim();
const REPLY_TO_EMAIL = (process.env.REPLY_TO_EMAIL || SMTP_USER).trim();
const UNSUBSCRIBE_EMAIL = (process.env.UNSUBSCRIBE_EMAIL || SMTP_USER).trim();
const COMPANY_NAME = (process.env.COMPANY_NAME || "ABRA LOGISTIC").trim();
const BUSINESS_ADDRESS = (process.env.BUSINESS_ADDRESS || "").trim();
const TEST_EMAIL = (process.env.TEST_EMAIL || SMTP_USER).trim();
const SEND_INTERVAL_MS = Math.max(8000, Number(process.env.SEND_INTERVAL_MS || 8000));
const SEND_DAILY_LIMIT = Math.min(100, Math.max(1, Number(process.env.SEND_DAILY_LIMIT || 50)));
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const isEmail = x => typeof x === "string" && x.length <= 254 && EMAIL.test(x);
const esc = x => String(x || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const app = express();
app.disable("x-powered-by");
app.set("trust proxy",false);
app.use((req,res,next) => {
  res.set("Cache-Control","no-store");
  res.set("X-Content-Type-Options","nosniff");
  res.set("X-Frame-Options","DENY");
  res.set("Referrer-Policy","no-referrer");
  res.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  // Restrict local HTTP service against DNS rebinding and cross-origin mutation.
  const host = String(req.headers.host || "");
  if (host !== "127.0.0.1:" + APP_PORT && host !== "localhost:" + APP_PORT) {
    return res.status(403).json({error:"This app is only available on localhost."});
  }
  if (!["GET","HEAD"].includes(req.method)) {
    const origin = req.headers.origin || "";
    if (origin && origin !== "http://127.0.0.1:" + APP_PORT && origin !== "http://localhost:" + APP_PORT) {
      return res.status(403).json({error:"Cross-origin requests are not allowed."});
    }
    if (req.headers["x-abra-local"] !== "1") return res.status(403).json({error:"Open this app in its localhost browser tab."});
  }
  next();
});

let mailer;
function missingSmtpFields() {
  const missing=[];
  for(const [name,val] of Object.entries({SMTP_HOST,SMTP_USER,SMTP_PASS,BUSINESS_ADDRESS})) if(!val) missing.push(name);
  if(!isEmail(SMTP_USER)) missing.push("valid SMTP_USER");
  if(!isEmail(SENDER_EMAIL)) missing.push("valid SENDER_EMAIL");
  if(!isEmail(REPLY_TO_EMAIL)) missing.push("valid REPLY_TO_EMAIL");
  if(!isEmail(UNSUBSCRIBE_EMAIL)) missing.push("valid UNSUBSCRIBE_EMAIL");
  if(!isEmail(TEST_EMAIL)) missing.push("valid TEST_EMAIL");
  if(!Number.isInteger(SMTP_PORT) || SMTP_PORT < 1 || SMTP_PORT > 65535) missing.push("valid SMTP_PORT");
  // A different sender can be rejected by mailbox security / SPF / DMARC.
  if(SENDER_EMAIL.toLowerCase() !== SMTP_USER.toLowerCase()) missing.push("SENDER_EMAIL must match SMTP_USER");
  if(!["localhost","127.0.0.1"].includes(APP_HOST)) missing.push("local host");
  return [...new Set(missing)];
}
function transporter(){
  if (!mailer) {
    mailer=nodemailer.createTransport({
      host:SMTP_HOST,port:SMTP_PORT,secure:SMTP_SECURE,
      auth:{user:SMTP_USER,pass:SMTP_PASS},
      requireTLS: !SMTP_SECURE,
      tls:{rejectUnauthorized:true,servername:SMTP_HOST},
      connectionTimeout:12000,greetingTimeout:12000,socketTimeout:20000,
      pool:false,logger:false,debug:false
    });
  }
  return mailer;
}
function status() {
  return {
    configured:missingSmtpFields().length===0,
    from: SMTP_USER ? SENDER_EMAIL : "",
    host:SMTP_HOST || "",
    port:SMTP_PORT,
    secure:SMTP_SECURE,
    testRecipient: isEmail(TEST_EMAIL) ? TEST_EMAIL : "",
    sendIntervalMs:SEND_INTERVAL_MS,
    dailyLimit:SEND_DAILY_LIMIT,
    // No passwords, no database and no recipient information in health.
    storage:"browser-localStorage"
  };
}
app.get("/api/health",(req,res)=>res.json({ok:true, ...status()}));

const dateKey=()=>new Date().toISOString().slice(0,10);
let lastAcceptedAt=0, lastDate=dateKey(), sentToday=0, inFlight=false;
function checkRate() {
  if(lastDate!==dateKey()){lastDate=dateKey();sentToday=0;}
  if(inFlight) return {code:429,error:"An email request is already running."};
  if(sentToday>=SEND_DAILY_LIMIT) return {code:429,error:"Local daily send safety limit reached."};
  const wait=SEND_INTERVAL_MS-(Date.now()-lastAcceptedAt);
  if(wait>0) return {code:429,error:"Please wait " + Math.ceil(wait/1000) + " seconds before the next email."};
  return null;
}
function footer(){
  const text = "\n\n--\n" + COMPANY_NAME + "\n" + BUSINESS_ADDRESS +
    "\nTo stop emails, reply 'unsubscribe' or email " + UNSUBSCRIBE_EMAIL + ".";
  const html = '<hr style="border:0;border-top:1px solid #e5e7eb;margin-top:26px">' +
    '<div style="font-size:12px;color:#667085;line-height:1.6"><strong>' + esc(COMPANY_NAME) +
    '</strong><div>' + esc(BUSINESS_ADDRESS) + '</div><div>To stop emails, reply "unsubscribe" or email ' +
    '<a href="mailto:' + encodeURIComponent(UNSUBSCRIBE_EMAIL) + '?subject=Unsubscribe">' +
    esc(UNSUBSCRIBE_EMAIL) + '</a>.</div></div>';
  return {text,html};
}
function cleanHtml(html){
  return sanitizeHtml(html,{
    allowedTags:[
      ...sanitizeHtml.defaults.allowedTags,
      "html","head","body","table","thead","tbody","tr","td","th","img","div","span","center","hr",
      "h1","h2","h3","h4","h5","h6"
    ],
    allowedAttributes:{
      ...sanitizeHtml.defaults.allowedAttributes,
      "*":["style","align","width","height","valign","bgcolor"],
      a:["href","name","target","style"],
      img:["src","alt","width","height","style"]
    },
    allowedSchemes:["https","http","mailto"],
    allowedSchemesByTag:{img:["https"]},
    allowProtocolRelative:false,
    disallowedTagsMode:"discard"
  });
}
async function sendOne({to,subject,html,text}){
  const bodyFooter=footer();
  const sanitized = cleanHtml(html || "");
  const htmlBody = sanitized ? (
    /<\/body\s*>/i.test(sanitized)
      ? sanitized.replace(/<\/body\s*>/i,bodyFooter.html + "</body>")
      : sanitized + bodyFooter.html
  ) : undefined;
  const sent = await transporter().sendMail({
    from:{name:SENDER_NAME,address:SENDER_EMAIL},
    to,replyTo:REPLY_TO_EMAIL,subject,
    text:String(text || "").trim() + bodyFooter.text,
    ...(htmlBody ? {html:htmlBody}:{}),
    headers:{"List-Unsubscribe":"<mailto:" + UNSUBSCRIBE_EMAIL + "?subject=Unsubscribe>"}
  });
  const accepted = Array.isArray(sent.accepted) && sent.accepted.some(x=>String(x).toLowerCase()===to.toLowerCase());
  if(!accepted) throw Error("SMTP server did not accept this recipient.");
  lastAcceptedAt=Date.now();
  sentToday++;
  // SMTP acceptance does not guarantee inbox delivery or that Roundcube's Sent folder is updated.
  return {ok:true,id:String(sent.messageId||""),status:"accepted",accepted:true};
}
const jsonOnly = express.json({limit:"120kb",type:"application/json"});
app.post("/api/send",jsonOnly,async(req,res)=>{
  if(missingSmtpFields().length) return res.status(503).json({error:"Complete your local .env SMTP settings and restart npm start."});
  const {to,subject,html,text,consentConfirmed}=req.body || {};
  if(consentConfirmed!==true) return res.status(422).json({error:"Recipients must have verified marketing opt-in."});
  if(!isEmail(to) || !subject || typeof subject !== "string" || subject.length>180 ||
    /[\r\n]/.test(subject) || typeof html !== "string" || typeof text !== "string" ||
    html.length > 65000 || text.length > 35000 || (!html.trim() && !text.trim())) {
    return res.status(422).json({error:"Invalid recipient or message content."});
  }
  const rate=checkRate();
  if(rate) return res.status(rate.code).json({error:rate.error});
  inFlight=true;
  try {res.json(await sendOne({to:to.trim().toLowerCase(),subject,html,text}));}
  catch(err){console.error("[SMTP] Send failed:",err?.code || err?.responseCode || "smtp_error");
    res.status(502).json({error:"SMTP send failed. Review .env settings, mailbox quota and the server logs for the error code."});}
  finally {inFlight=false;}
});
app.post("/api/test-smtp",jsonOnly,async(req,res)=>{
  if(missingSmtpFields().length) return res.status(503).json({error:"Missing SMTP settings in local .env: "+missingSmtpFields().join(", ")});
  try {await transporter().verify();res.json({ok:true,message:"SMTP connection and authentication succeeded. This has not sent an email."});}
  catch(err){console.error("[SMTP] Verification failed:",err?.code || err?.responseCode || "smtp_error");
    res.status(502).json({error:"SMTP connection or authentication failed. Check the cPanel Connect Devices settings, port, SSL/TLS, and mailbox password."});}
});
app.post("/api/test-email",jsonOnly,async(req,res)=>{
  if(missingSmtpFields().length) return res.status(503).json({error:"Configure SMTP in .env first."});
  const rate=checkRate();
  if(rate) return res.status(rate.code).json({error:rate.error});
  inFlight=true;
  try{
    const sent=await sendOne({
      to:TEST_EMAIL,subject:"ABRA Logistics Email Marketing — SMTP Test",
      html:"<p>This is a test email from your local ABRA Logistics email marketing app.</p>",
      text:"This is a test email from your local ABRA Logistics email marketing app."
    });
    res.json({...sent,to:TEST_EMAIL});
  }catch(err){console.error("[SMTP] Test failed:",err?.code || err?.responseCode || "smtp_error");
    res.status(502).json({error:"Test email failed. Inspect SMTP configuration and cPanel mail-delivery reports."});}
  finally{inFlight=false;}
});

function csvCell(value){
  const text=String(value??"");
  return '"' + text.replace(/"/g,'""') + '"';
}
app.post("/api/parse-xlsx",
  express.raw({type:"application/octet-stream",limit:"5mb"}),
  async(req,res)=>{
    try{
      if(!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({error:"Select a valid .xlsx file."});
      const workbook=new ExcelJS.Workbook();
      await workbook.xlsx.load(req.body);
      const sheet=workbook.worksheets[0];
      if(!sheet) return res.status(422).json({error:"No worksheet found."});
      if(sheet.rowCount > 11000 || sheet.columnCount > 60) return res.status(413).json({error:"Workbook is too large. Maximum 10,000 customers and 60 columns."});
      const rows=[];
      sheet.eachRow({includeEmpty:false},(row)=>{
        const vals=[];
        for(let c=1;c<=Math.min(sheet.columnCount,60);c++){
          const cell=row.getCell(c);
          const value=cell.value;
          let txt=cell.text || "";
          if(value && typeof value==="object" && value.formula && value.result!=null) txt=String(value.result);
          vals.push(csvCell(txt));
        }
        rows.push(vals.join(","));
      });
      if(rows.length<2) return res.status(422).json({error:"Include a header row and at least one customer."});
      // Data is parsed in memory and returned. Nothing is stored or logged on this server.
      res.json({csv:rows.join("\r\n")});
    }catch(err){console.error("[IMPORT] Unable to read Excel workbook");
      res.status(422).json({error:"Could not read this file. Export it as a .xlsx or CSV from Excel."});}
  }
);

// Keep the app available at http://localhost:3000/ after npm start.
app.use(express.static(path.join(ROOT,"site"),{index:"index.html",etag:false,maxAge:0}));
app.use((req,res)=>res.status(404).json({error:"Not found."}));

if(process.env.NODE_ENV !== "test"){
  app.listen(APP_PORT, APP_HOST, () => {
    console.log("\nABRA LOGISTIC | Email Marketing");
    console.log("Open: http://localhost:"+APP_PORT);
    console.log("SMTP: "+(status().configured ? "configured (not yet verified)" : "not configured — edit your local .env file"));
    console.log("Storage: browser localStorage only; no login or database\n");
  });
}
export {app, status, cleanHtml, footer, checkRate};
