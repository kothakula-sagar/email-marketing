import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {once} from "node:events";

process.env.NODE_ENV="test";
process.env.APP_PORT="3000";
process.env.SMTP_HOST="mail.example.test";
process.env.SMTP_PORT="465";
process.env.SMTP_SECURE="true";
process.env.SMTP_USER="support@example.test";
process.env.SMTP_PASS="test-only-unused";
process.env.SENDER_EMAIL="support@example.test";
process.env.REPLY_TO_EMAIL="support@example.test";
process.env.UNSUBSCRIBE_EMAIL="support@example.test";
process.env.COMPANY_NAME="ABRA LOGISTIC";
process.env.BUSINESS_ADDRESS="Example Road, Bengaluru, India";

const {app,status,cleanHtml,footer,checkRate}=await import("../server.js");

test("SMTP configuration comes from environment without exposing password",()=>{
  const info=status();
  assert.equal(info.configured,true);
  assert.equal(info.from,"support@example.test");
  assert.equal(info.secure,true);
  assert.equal(info.port,465);
  assert.equal(info.storage,"browser-localStorage");
  assert.equal(JSON.stringify(info).includes("test-only-unused"),false);
});

test("Email HTML is sanitized and malicious URLs/events are removed",()=>{
  const html=cleanHtml('<p onclick="alert(1)">Hello</p><script>alert(2)</script><a href="javascript:alert(1)">Click</a>');
  assert.doesNotMatch(html,/onclick|<script|javascript:/i);
  assert.match(html,/Hello/);
});

test("Opt-out and postal business details are included in email footer",()=>{
  const f=footer();
  assert.match(f.text,/ABRA LOGISTIC/);
  assert.match(f.text,/Example Road/);
  assert.match(f.text,/support@example\.test/);
  assert.match(f.html,/unsubscribe/i);
});

test("Safe initial local rate state",()=>{
  assert.equal(checkRate(),null);
});

async function request(server,method,path,payload,headers={}){
  const port=server.address().port;
  const body=payload===undefined ? "" : JSON.stringify(payload);
  return new Promise((resolve,reject)=>{
    const req=http.request({
      hostname:"127.0.0.1",port,path,method,
      headers:{
        Host:"localhost:3000",
        ...(body?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}:{}),
        ...headers
      }
    },res=>{
      let out="";
      res.on("data",chunk=>out+=chunk);
      res.on("end",()=>resolve({status:res.statusCode,body:JSON.parse(out)}));
    });
    req.on("error",reject);
    req.end(body);
  });
}
test("Local API has health checks and rejects unauthorized browser mutations",async()=>{
  const server=app.listen(0,"127.0.0.1");
  await once(server,"listening");
  try{
    const health=await request(server,"GET","/api/health");
    assert.equal(health.status,200);
    assert.equal(health.body.configured,true);
    assert.equal(health.body.from,"support@example.test");
    const noHeader=await request(server,"POST","/api/send",{to:"test@example.test"});
    assert.equal(noHeader.status,403);
    const wrongOrigin=await request(server,"POST","/api/send",{to:"test@example.test"},{
      "X-Abra-Local":"1",Origin:"https://untrusted.example"
    });
    assert.equal(wrongOrigin.status,403);
    const noPermission=await request(server,"POST","/api/send",{
      to:"test@example.test",subject:"Hello",html:"<b>Hello</b>",text:"Hello",consentConfirmed:false
    },{"X-Abra-Local":"1",Origin:"http://localhost:3000"});
    assert.equal(noPermission.status,422);
  }finally{
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});
