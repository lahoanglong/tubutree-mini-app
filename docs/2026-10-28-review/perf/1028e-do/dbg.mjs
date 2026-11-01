import { createRequire } from 'node:module';
const WT='/Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028e-do';
const { chromium } = createRequire(WT + '/apps/e2e/package.json')('@playwright/test');
const b=await chromium.launch();const p=await b.newPage({viewport:{width:375,height:812}});
await p.goto('http://localhost:3232/san-pham',{waitUntil:'networkidle'});
const i=p.locator('input[type=search]').first();await i.click();await i.pressSequentially('mat',{delay:80});await p.waitForTimeout(3000);
console.log(await p.evaluate(()=>[...document.querySelectorAll('[role=listbox],[role=option],li button')].slice(0,6).map(e=>e.outerHTML.slice(0,160))));
await p.screenshot({path:'/private/tmp/claude-501/dbg.png'});await b.close();
