import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, done } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);
const VP = { mini375: { w: 375, h: 812 }, web375: { w: 375, h: 812 }, web1280: { w: 1280, h: 800 } };
const targets = [
  ['dealer', { mini375: '/dealer', web375: '/dai-ly', web1280: '/dai-ly' }, 'dai-ly', ['Đơn hàng', 'Công nợ', 'Báo cáo', 'Dán đơn']],
  ['brand', { mini375: '/brand-owner', web375: '/chu-thuong-hieu', web1280: '/chu-thuong-hieu' }, 'chu-nhan', ['Doanh thu']],
];
for (const [persona, routes, name, tabs] of targets) {
  for (const surface of ['mini375', 'web375', 'web1280']) {
    const vp = VP[surface];
    const s = surface === 'mini375' ? await open(6, persona, { path: routes[surface], viewport: { width: vp.w, height: 1900, isMobile: true } }) : await openWeb(6, persona, { path: routes[surface], viewport: { width: vp.w, height: vp.h, isMobile: surface === 'web375' } });
    try {
      await s.page.waitForTimeout(2500);
      for (const t of tabs) {
        await s.page.getByText(t, { exact: true }).first().click({ timeout: 8000 }).catch((e) => console.log('click lỗi', surface, t, String(e.message).slice(0, 80)));
        await s.page.waitForTimeout(1500);
        const slug = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, '-');
        await s.page.screenshot({ path: path.join(SHOTS, `${surface}-${name}-tab-${slug}.png`), fullPage: true });
        fs.writeFileSync(path.join(SHOTS, `${surface}-${name}-tab-${slug}.txt`), await s.page.evaluate(() => document.body.innerText));
      }
    } finally { await s.close(); }
  }
}
await done();
