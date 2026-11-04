import { done, SHOTS, sql } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
const routes = { mini375: '/orders?tab=subscriptions', web375: '/tai-khoan/don-hang?tab=subscriptions' };
for (const surface of ['mini375', 'web375']) {
  const s = await openSurface(surface, 'ctv_pending', routes[surface]);
  const p = s.s.page;
  await p.waitForTimeout(3000);
  await p.getByRole('button', { name: 'Sửa', exact: true }).first().click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${SHOTS}/subs-2-sua-${surface}.png` });
  console.log(surface, 'SỬA', JSON.stringify(await p.getByRole('button').allInnerTexts()));
  console.log((await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 900));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(800);
  const close = p.getByRole('button', { name: /Đóng|Huỷ bỏ|Thôi/ });
  if (await close.count()) await close.first().click().catch(() => {});
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Huỷ', exact: true }).first().click({ timeout: 5000 }).catch((e) => console.log('click huỷ lỗi', String(e).slice(0, 120)));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${SHOTS}/subs-3-huy-${surface}.png` });
  console.log(surface, 'HUỶ', JSON.stringify(await p.getByRole('button').allInnerTexts()));
  await s.s.close();
}
await done();
