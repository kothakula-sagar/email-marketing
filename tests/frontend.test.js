import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function openApp(initialState = null) {
  const source = fs.readFileSync(new URL("../site/app.js",import.meta.url),"utf8");
  const marker = /\s*render\(\);\s*refreshSmtpStatus\(\);\s*\}\)\(\);\s*$/;
  assert.match(source,marker);
  const exposed = source.replace(marker,
    "\n  globalThis.testHooks = {parseCSV,parseContacts,replaceTokens,toCSV,newCampaign,switchCampaign,plainBody,htmlEmail,importCSV,addContact,restoreBackup,eligible,go,saveField,deleteCampaign,getData:()=>data};\n  render();\n})();");
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) {
      nodes.set(selector,{
        innerHTML:"",textContent:"",value:"",style:{},className:"",
        classList:{add(){},remove(){},toggle(){}},
      });
    }
    return nodes.get(selector);
  };
  let saved = JSON.stringify(initialState);
  const context = {
    console, Date, Math, JSON, Map, Set, RegExp,
    localStorage:{getItem(){return saved},setItem(_,value){saved=value}},
    document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},
    window:{scrollTo(){}},
    confirm:()=>true,
    setTimeout:()=>1,clearTimeout:()=>{}
  };
  vm.runInNewContext(exposed,context,{filename:"site/app.js"});
  return {hooks:context.testHooks,node,saved:()=>JSON.parse(saved)};
}

test("CRM customer spreadsheet headers, mobile, source, quoted values and email normalization",()=>{
  const {hooks}=openApp();
  const csv='Import Code,Name,Email,Mobile,Company,Source,Email Status,Consent,City\n' +
    '"Sagar Kothakula","Priya, K",PRIYA@Example.com,9988112233,"Acme, Inc",Lead,Subscribed,no,Bengaluru\n' +
    ',"Ravi",ravi@example.com,9123456789,Sample,Referral,Subscribed,yes,Chennai\n';
  const result=hooks.parseContacts(csv);
  assert.equal(result.list.length,2);
  assert.equal(result.list[0].name,"Priya, K");
  assert.equal(result.list[0].company,"Acme, Inc");
  assert.equal(result.list[0].email,"priya@example.com");
  assert.equal(result.list[0].phone,"9988112233");
  assert.equal(result.list[0].source,"Lead");
  assert.equal(result.list[0].status,"review");
  assert.equal(result.list[0].extras.city,"Bengaluru");
  assert.equal(result.list[1].status,"consented");
});

test("CRM unsubscribe / not interested wins over any consent value",()=>{
  const {hooks}=openApp();
  const result=hooks.parseContacts(
    "Name,Email,Email Status,Consent\nA,a@example.com,Unsubscribed,yes\nB,b@example.com,Not Interested,yes");
  assert.equal(result.list[0].status,"unsubscribed");
  assert.equal(result.list[1].status,"unsubscribed");
});

test("CRM personalization supports Name, Email, Phone, Source and additional CSV fields",()=>{
  const {hooks}=openApp();
  const rendered=hooks.replaceTokens(
    "{{Name}} | {{Email}} | {{Phone}} | {{Company}} | {{Source}} | {{pickup_city}}",
    {name:"Priya",email:"priya@example.com",phone:"123",company:"Acme",source:"Lead",extras:{pickup_city:"Bengaluru"}},false);
  assert.equal(rendered,"Priya | priya@example.com | 123 | Acme | Lead | Bengaluru");
});

test("New campaign saves previous campaign and switching restores it",()=>{
  const {hooks,saved}=openApp();
  const initial=hooks.getData().campaign.id;
  hooks.newCampaign();
  assert.equal(hooks.getData().campaigns.length,1);
  assert.equal(hooks.getData().campaign.name,"");
  assert.equal(hooks.getData().campaign.subject,"");
  assert.equal(hooks.getData().campaign.body,"");
  const another=hooks.getData().campaign.id;
  assert.notEqual(another,initial);
  hooks.switchCampaign(initial);
  assert.equal(hooks.getData().campaign.id,initial);
  assert.equal(hooks.getData().campaigns[0].id,another);
  assert.equal(saved().campaigns.length,1);
});

test("Customer CSV export escapes spreadsheet formula cells",()=>{
  const {hooks}=openApp();
  const csv=hooks.toCSV([["Name","Email"],["=HYPERLINK(1)","foo@example.com"]]);
  assert.match(csv,/'=HYPERLINK\(1\)/);
});

test("import skips existing and repeated email IDs while reporting invalid rows", async () => {
  const {hooks,node,saved}=openApp();
  hooks.go("contacts");
  node("#csvFile").files=[];
  node("#csvPaste").value="Email,Name,Consent\nfirst@example.com,Original,yes";
  await hooks.importCSV();
  node("#csvPaste").value="Email,Name,Consent\n FIRST@example.com ,Replacement,no\nsecond@example.com,First row,no\nSECOND@example.com,Second row,yes\ninvalid,Invalid,no";
  await hooks.importCSV();
  assert.equal(saved().contacts.length,2);
  assert.equal(saved().contacts[0].name,"Original");
  assert.equal(saved().contacts[1].name,"First row");
  assert.equal(saved().contacts[1].status,"review");
  assert.match(node("#view").innerHTML,/1 added · 2 duplicates skipped · 1 invalid emails skipped/);
  node("#newEmail").value=" FIRST@EXAMPLE.COM ";
  hooks.addContact();
  assert.equal(saved().contacts.length,2);
  assert.match(node("#toast").textContent,/already exists/);
  node("#csvPaste").value="Email,Email Status\nFIRST@example.com,Unsubscribed";
  await hooks.importCSV();
  assert.equal(saved().contacts.length,2);
  assert.equal(saved().contacts[0].status,"unsubscribed");
});

test("existing and restored contacts are deduplicated and opt-outs remain suppressed", async () => {
  const {hooks,saved}=openApp({contacts:[
    {email:" Example@Example.com ",status:"consented"},
    {email:"example@example.com",status:"unsubscribed"}
  ],campaign:{},settings:{},logs:[]});
  assert.equal(hooks.getData().contacts.length,1);
  assert.equal(hooks.eligible().length,0);
  const backup={contacts:[
    {email:"EXAMPLE@example.com",status:"consented"},
    {email:"other@example.com",status:"consented"},
    {email:"OTHER@example.com",status:"consented"}
  ],campaign:{},settings:{},logs:[]};
  await hooks.restoreBackup({text:async()=>JSON.stringify(backup)});
  assert.deepEqual(saved().contacts.map(c=>[c.email,c.status]),[
    ["example@example.com","unsubscribed"],["other@example.com","consented"]
  ]);
});

test("test audience requires a selected, opted-in tester and separates live send history", () => {
  const {hooks}=openApp({contacts:[
    {email:"tester@example.com",status:"consented",testCustomer:true},
    {email:"other@example.com",status:"consented"},
    {email:"unselected@example.com",status:"consented",testCustomer:true},
    {email:"optout@example.com",status:"unsubscribed",testCustomer:true}
  ],campaign:{id:"campaign-1",testEmails:["tester@example.com","other@example.com","optout@example.com"]},
  settings:{},logs:[]});
  const emails=()=>[...hooks.eligible()].map(c=>c.email);
  assert.deepEqual(emails(),["tester@example.com"]);
  hooks.getData().logs.push({campaignId:"campaign-1",email:"tester@example.com",audience:"test",result:"accepted"});
  assert.deepEqual(emails(),[]);
  hooks.saveField("campaign.body","Revised message");
  assert.deepEqual(emails(),["tester@example.com"]);
  hooks.getData().campaign.audience="all";
  assert.deepEqual(emails(),["tester@example.com","other@example.com","unselected@example.com"]);
  hooks.getData().logs.push({campaignId:"campaign-1",email:"other@example.com",result:"accepted"});
  assert.deepEqual(emails(),["tester@example.com","unselected@example.com"]);
});

test("deleting active and saved campaigns preserves the send log", () => {
  const {hooks,saved}=openApp({contacts:[],campaign:{id:"active"},settings:{},
    campaigns:[{id:"first"},{id:"last"}],logs:[{campaignId:"active",result:"accepted"}]});
  hooks.deleteCampaign("first");
  assert.deepEqual(saved().campaigns.map(c=>c.id),["last"]);
  hooks.deleteCampaign("active");
  assert.equal(saved().campaign.id,"last");
  assert.equal(saved().logs.length,1);
  hooks.deleteCampaign("last");
  assert.equal(saved().campaign.audience,"test");
  assert.deepEqual(saved().campaign.testEmails,[]);
});
