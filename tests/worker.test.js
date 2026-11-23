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
