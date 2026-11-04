import fs from 'node:fs';
const A='http://localhost:3261/api';
const tok=process.argv[2];
const rows=JSON.parse(fs.readFileSync('routes-rt.json','utf8'));
const FAKE='zzzzzzzzzzzzzzzzzzzzzzzzz';
async function one(method,p,withTok){
  const url=A+p.replace(/:[A-Za-z]+/g,FAKE);
  const init={method,headers:{'content-type':'application/json',...(withTok?{authorization:'Bearer '+tok}:{})}};
  if(method!=='GET'&&method!=='DELETE'&&method!=='HEAD') init.body='{"__probe":1}';
  try{const r=await fetch(url,init); return r.status;}catch(e){return 'ERR';}
}
const out=[];
for(const r of rows){
  if(/^\/(webhooks|internal)/.test(r.route)) continue;
  if(['/auth/guest','/auth/refresh','/auth/logout','/auth/zalo-mini-app','/auth/zalo-oauth'].includes(r.route)) continue;
  const noTok=await one(r.method,r.route,false);
  const withTok=await one(r.method,r.route,true);
  out.push({...r,noTok,withTok});
}
fs.writeFileSync('sweep2.json',JSON.stringify(out,null,1));
console.log('A) non-public, no token, status!=401:');
out.filter(o=>!o.pub&&o.noTok!==401).forEach(o=>console.log(' ',o.method,o.route,o.noTok,o.ctrl));
console.log('B) roles set, guest token, status!=403 (401 would be bad):');
out.filter(o=>o.roles.length&&o.withTok!==403).forEach(o=>console.log(' ',o.method,o.route,o.withTok,o.roles,o.ctrl));
console.log('C) staff/roles route not 403:');
console.log('D) public routes with 5xx:');
out.filter(o=>[500,502,503,'ERR'].includes(o.noTok)||[500,502,503].includes(o.withTok)).forEach(o=>console.log(' ',o.method,o.route,o.noTok,o.withTok));
