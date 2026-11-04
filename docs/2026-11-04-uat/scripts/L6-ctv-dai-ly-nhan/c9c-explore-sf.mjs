import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, done } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);
const VP = { mini375: { w: 375, h: 812 }, web375: { w: 375, h: 812 }, web1280: { w: 1280, h: 800 } };
const routes = { mini375: '/storefront', web375: '/ctv/gian-hang', web1280: '/ctv/gian-hang' };
const steps = [['Sửa hồ sơ', 'sua-ho-so'], ['Cài đặt', 'cai-dat'], ['Thêm khối', 'them-khoi'], ['Theo sản phẩm', 'theo-san-pham']];
for (const surface of ['mini375', 'web375', 'web1280']) {
  const vp = VP[surface];
  for (const [label, slug] of steps) {
    const s = surface === 'mini375' ? await open(6, 'ctv', { path: routes[surface], viewport: { width: vp.w, height: 1900, isMobile: true } }) : await openWeb(6, 'ctv', { path: routes[surface], viewport: { width: vp.w, height: vp.h, isMobile: surface === 'web375' } });
    try {
      await s.page.waitForTimeout(2500);
      await s.page.getByText(label, { exact: true }).first().click({ timeout: 8000 }).catch((e) => console.log('click lỗi', surface, label, String(e.message).slice(0, 60)));
      await s.page.waitForTimeout(1500);
      await s.page.screenshot({ path: path.join(SHOTS, `${surface}-gian-hang-${slug}.png`), fullPage: true });
      fs.writeFileSync(path.join(SHOTS, `${surface}-gian-hang-${slug}.txt`), await s.page.evaluate(() => document.body.innerText));
    } finally { await s.close(); }
  }
}
await done();
