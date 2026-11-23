import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

const env = {
  RESEND_API_KEY:"test-only",
  SEND_ACCESS_TOKEN:"this-is-a-long-test-secret-12345",
  ALLOWED_ORIGIN:"https://kothakula-sagar.github.io",
  SENDER_EMAIL:"marketing@example.com",
  FROM_NAME:"Example Team",
  COMPANY_NAME:"Example Business",
  POSTAL_ADDRESS:"123 Test Road, Bengaluru, India",
  UNSUBSCRIBE_EMAIL:"unsubscribe@example.com"
};
function request(overrides = {}, origin = env.ALLOWED_ORIGIN, token = env.SEND_ACCESS_TOKEN) {
  return new Request("https://worker.example.com/send", {
    method:"POST",
    headers:{"Origin":origin,"Authorization":"Bearer " + token,"Content-Type":"application/json"},
    body:JSON.stringify({
      to:"person@example.com",subject:"Hi there",
      html:"<p>Hello!</p>",text:"Hello!",consentConfirmed:true,...overrides
    })
  });
}
test("rejects unauthorized origins", async () => {
  const response = await worker.fetch(request({},"https://untrusted.example"),env);
  assert.equal(response.status,403);
  assert.equal(response.headers.get("access-control-allow-origin"),null);
});
test("rejects bad passphrase", async () => {
  const response = await worker.fetch(request({},env.ALLOWED_ORIGIN,"invalid-token"),env);
  assert.equal(response.status,401);
});
test("rejects unconfirmed permission", async () => {
  const response = await worker.fetch(request({consentConfirmed:false}),env);
  assert.equal(response.status,422);
});
test("rejects HTML containing scripts", async () => {
  const response = await worker.fetch(request({html:"<script>alert(1)</script>"}),env);
  assert.equal(response.status,422);
});
test("sends exactly one message using server identity and opt-out footer", async (t) => {
  let captured;
  t.mock.method(globalThis,"fetch",async (uri,options) => {
    assert.equal(uri,"https://api.resend.com/emails");
    captured = JSON.parse(options.body);
    return new Response(JSON.stringify({id:"example-send-id"}),{status:200,headers:{"content-type":"application/json"}});
  });
  const response = await worker.fetch(request(),env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).id,"example-send-id");
  assert.deepEqual(captured.to,["person@example.com"]);
  assert.equal(captured.from,"Example Team <marketing@example.com>");
  assert.match(captured.html,/123 Test Road/);
  assert.match(captured.html,/unsubscribe@example.com/);
  assert.match(captured.text,/unsubscribe@example.com/);
  assert.match(captured.headers["List-Unsubscribe"],/mailto:/);
});
test("preflight responds only for allowed origin", async () => {
  const response = await worker.fetch(new Request("https://worker.example.com/send",{
    method:"OPTIONS",headers:{"Origin":env.ALLOWED_ORIGIN}
  }),env);
  assert.equal(response.status,204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"),env.ALLOWED_ORIGIN);
});

test("Gmail provider exchanges refresh token and sends multipart HTML and plain-text MIME", async (t) => {
  const gmailEnv = {
    ...env,
    EMAIL_PROVIDER:"gmail",
    GMAIL_CLIENT_ID:"example-client-id",
    GMAIL_CLIENT_SECRET:"example-client-secret",
    GMAIL_REFRESH_TOKEN:"example-refresh-token",
    GMAIL_USER_EMAIL:"marketing@example.com"
  };
  let mime = "";
  const calls = [];
  t.mock.method(globalThis,"fetch",async (uri,options) => {
    calls.push(uri);
    if (uri === "https://oauth2.googleapis.com/token") {
      assert.equal(options.method,"POST");
      assert.match(options.body,/grant_type=refresh_token/);
      return new Response(JSON.stringify({access_token:"temporary-token"}),{status:200});
    }
    assert.equal(uri,"https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(options.headers.Authorization,"Bearer temporary-token");
    const raw = JSON.parse(options.body).raw;
    mime = Buffer.from(raw.replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8");
    return new Response(JSON.stringify({id:"gmail-message-1"}),{status:200});
  });
  const response = await worker.fetch(request(),gmailEnv);
  assert.equal(response.status,200);
  assert.equal((await response.json()).provider,"gmail");
  assert.deepEqual(calls,["https://oauth2.googleapis.com/token","https://gmail.googleapis.com/gmail/v1/users/me/messages/send"]);
  assert.match(mime,/Content-Type: multipart\/alternative/);
  assert.match(mime,/Content-Type: text\/plain/);
  assert.match(mime,/Content-Type: text\/html/);
  assert.match(mime,/List-Unsubscribe:/);
  assert.match(mime,/From: =\?UTF-8\?B\?/);
});
test("Gmail provider prevents mismatch with authorized sender account",async()=>{
  const gmailEnv={...env,EMAIL_PROVIDER:"gmail",GMAIL_CLIENT_ID:"id",GMAIL_CLIENT_SECRET:"secret",
    GMAIL_REFRESH_TOKEN:"refresh",GMAIL_USER_EMAIL:"different@example.com"};
  const response=await worker.fetch(request(),gmailEnv);
  assert.equal(response.status,503);
});
