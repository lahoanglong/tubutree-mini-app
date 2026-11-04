require('reflect-metadata');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { GuestLoginDto } = require(process.env.WORKTREE+'/apps/api/dist/modules/auth/auth.controller.js');
const { translateValidationErrors } = require(process.env.WORKTREE+'/apps/api/dist/common/validation-pipe.js');
(async()=>{
for (const n of [2500,5000,10000,20000]) {
  const o={}; for(let i=0;i<n;i++) o['k'+i]=1;
  let t=process.hrtime.bigint();
  const inst=plainToInstance(GuestLoginDto,o);
  const t1=Number(process.hrtime.bigint()-t)/1e6; t=process.hrtime.bigint();
  const errs=await validate(inst,{whitelist:true,forbidNonWhitelisted:true});
  const t2=Number(process.hrtime.bigint()-t)/1e6; t=process.hrtime.bigint();
  const msgs=translateValidationErrors(errs);
  const t3=Number(process.hrtime.bigint()-t)/1e6;
  console.log(`n=${n} transform=${t1.toFixed(0)}ms validate=${t2.toFixed(0)}ms translate=${t3.toFixed(0)}ms errors=${errs.length} msgs=${msgs.length}`);
}})();
