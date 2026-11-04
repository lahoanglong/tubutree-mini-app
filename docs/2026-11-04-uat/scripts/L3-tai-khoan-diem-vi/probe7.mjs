import { done, SHOTS } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
for (const [surface, route] of [['mini375', '/addresses'], ['web375', '/tai-khoan/dia-chi']]) {
  const s = await openSurface(surface, 'ctv', route);
  const p = s.s.page;
  await p.waitForTimeout(3000);
  await p.getByText('Thêm địa chỉ mới').first().click();
  await p.waitForTimeout(1800);
  await p.screenshot({ path: `${SHOTS}/addr-1-form-${surface}.png`, fullPage: true });
  console.log(surface, 'BUTTONS', JSON.stringify(await p.getByRole('button').allInnerTexts()));
  console.log(surface, 'INPUTS', JSON.stringify(await p.locator('input,textarea,select').evaluateAll((els) => els.map((e) => ({ t: e.tagName, ty: e.type, ph: e.placeholder, name: e.name, label: e.getAttribute('aria-label'), id: e.id })))));
  console.log((await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 700));
  await s.s.close();
}
await done();
