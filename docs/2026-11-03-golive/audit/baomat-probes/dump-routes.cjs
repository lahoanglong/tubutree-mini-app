const Module = require('module');
const path = require('path');
const dist = process.env.WORKTREE+'/apps/api/dist';
const origResolve = Module._resolveFilename;
require('reflect-metadata');
const val = require(path.join(dist, 'config/env.validation.js'));
val.validateEnv = (c) => c;
const { AppModule } = require(path.join(dist, 'app.module.js'));
const { MODULE_METADATA } = require('@nestjs/common/constants');
const rg = { collectControllers(root){ const seen=new Set(), ctl=new Set(); const visit=(ref)=>{ if(!ref||ref instanceof Promise) return; const mod=typeof ref==='function'?ref:ref.module; const extra=typeof ref==='function'?[]:(ref.controllers||[]); const ei=typeof ref==='function'?[]:(ref.imports||[]); for(const c of extra) ctl.add(c); for(const c of Reflect.getMetadata(MODULE_METADATA.CONTROLLERS,mod)||[]) ctl.add(c); if(seen.has(mod)) return; seen.add(mod); for(const ch of [...(Reflect.getMetadata(MODULE_METADATA.IMPORTS,mod)||[]),...ei]) visit(ch);}; visit(root); return [...ctl]; } };
const { RequestMethod } = require('@nestjs/common');
const { METHOD_METADATA, PATH_METADATA } = require('@nestjs/common/constants');
const PUB = require(path.join(dist,'common/decorators/public.decorator.js')).IS_PUBLIC_KEY;
const ROLES = require(path.join(dist,'common/decorators/roles.decorator.js')).ROLES_KEY;
const SP = require(path.join(dist,'common/staff-permissions.js')).STAFF_PERMISSIONS_KEY;
const out=[];
for (const c of rg.collectControllers(AppModule)) {
  const prefix = Reflect.getMetadata(PATH_METADATA, c) ?? '';
  const prefixes = Array.isArray(prefix)?prefix:[prefix];
  const cGuards=(Reflect.getMetadata('__guards__',c)||[]).map(g=>g.name);
  const cPub=Reflect.getMetadata(PUB,c), cRoles=Reflect.getMetadata(ROLES,c), cSP=Reflect.getMetadata(SP,c);
  const proto=c.prototype;
  for (const n of Object.getOwnPropertyNames(proto)) {
    const h=proto[n]; if(typeof h!=='function') continue;
    const m=Reflect.getMetadata(METHOD_METADATA,h); if(m===undefined) continue;
    const p=Reflect.getMetadata(PATH_METADATA,h);
    const pub=Reflect.getMetadata(PUB,h)??cPub; const roles=Reflect.getMetadata(ROLES,h)??cRoles; const sp=Reflect.getMetadata(SP,h)??cSP;
    const hg=(Reflect.getMetadata('__guards__',h)||[]).map(g=>g.name);
    const keys=Reflect.getMetadataKeys(h).filter(k=>/THROTTL|SkipThrottle|tubu/i.test(String(k)));
    for(const pre of prefixes) for(const pp of (Array.isArray(p)?p:[p])){
      const joined=[pre,pp].filter(Boolean).join('/').replace(/\/+/g,'/').replace(/^\/|\/$/g,'');
      out.push({method:RequestMethod[m],route:'/'+joined,ctrl:c.name,handler:n,pub:!!pub,roles:roles||[],staff:sp||[],guards:[...cGuards,...hg],thr:keys});
    }
  }
}
require('fs').writeFileSync(process.argv[2], JSON.stringify(out,null,1));
console.log(out.length);
