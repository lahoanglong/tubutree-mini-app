import { done, SHOTS, sql } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
const routes = { mini375: '/orders?tab=subscriptions', web375: '/tai-khoan/don-hang?tab=subscriptions', web1280: '/tai-khoan/don-hang?tab=subscriptions' };
for (const surface of ['mini375', 'web375', 'web1280']) {
  const s = await openSurface(surface, 'ctv_pending', routes[surface]);
  const p = s.s.page;
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${SHOTS}/subs-1-danh-sach-${surface}.png`, fullPage: true });
  const btns = await p.getByRole('button').allInnerTexts();
  console.log(surface, p.url(), JSON.stringify(btns.slice(0, 20)));
  console.log((await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 700));
  await s.s.close();
}
await done();
