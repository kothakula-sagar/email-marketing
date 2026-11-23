import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function openApp() {
  const source = fs.readFileSync(new URL("../site/app.js",import.meta.url),"utf8");
  const marker = /\s*render\(\);\s*\}\)\(\);\s*$/;
  assert.match(source,marker);
  const exposed = source.replace(marker,
    "\n  globalThis.testHooks = {parseCSV,parseContacts,replaceTokens,toCSV,newCampaign,switchCampaign,plainBody,htmlEmail,getData:()=>data};\n  render();\n})();");
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
  let saved = null;
  const context = {
    console, Date, Math, JSON, Map, Set, RegExp,
    localStorage:{getItem(){return saved},setItem(_,value){saved=value}},
    document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},
    window:{scrollTo(){}},
    confirm:()=>true,
    setTimeout:()=>1,clearTimeout:()=>{}
  };
  vm.runInNewContext(exposed,context,{filename:"site/app.js"});
  return {hooks:context.testHooks,saved:()=>JSON.parse(saved)};
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
