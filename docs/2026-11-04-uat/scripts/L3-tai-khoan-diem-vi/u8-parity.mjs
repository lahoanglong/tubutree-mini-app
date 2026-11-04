// U8: so chữ Mini và web 375 ở hai chỗ: ngày giờ dòng Lịch sử Ví; chữ trong form thêm địa chỉ.
import { makeRec, sql, A, done, SHOTS } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
const { check } = makeRec('u8-parity');
const J = 'Parity Mini và web 375';
// 1) Lịch sử Ví
const wal = {};
for (const [surface, route] of [['mini375', '/wallet'], ['web375', '/tai-khoan/vi-tubu']]) {
  const s = await openSurface(surface, 'returning', route);
  const p = s.s.page;
  await p.waitForTimeout(3500);
  const t = await p.locator('body').innerText();
  const m = t.match(/(\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}(?:\/\d{4})? \d{2}:\d{2})\s*·/);
  wal[surface] = m ? m[1] : null;
  await s.s.close();
}
const shape = (x) => (x ? x.replace(/\d/g, 'd') : null);
check('U8-wallet-time', 'returning', 'mini375 vs web375', J, 'dòng Lịch sử Ví hiện ngày giờ cùng một dạng ở Mini và web 375', 'apps/miniapp/src/pages/wallet.tsx:270 formatWalletTxTime vs apps/web/src/app/tai-khoan/vi-tubu/page.tsx:246 formatDateTime', shape(wal.mini375) === shape(wal.web375), `Mini="${wal.mini375}" (${shape(wal.mini375)}) web="${wal.web375}" (${shape(wal.web375)}); cả hai là giờ VN (04:04)`);
// 2) Form thêm địa chỉ
const txt = {};
for (const [surface, route] of [['mini375', '/addresses'], ['web375', '/tai-khoan/dia-chi']]) {
  for (const a of (await sql(`SELECT id FROM addresses WHERE "userId"='uat_ctv'`))) await A('ctv', 'DELETE', `/me/addresses/${a.id}`);
  const s = await openSurface(surface, 'ctv', route);
  const p = s.s.page;
  await p.waitForTimeout(3000);
  await p.getByText('Thêm địa chỉ mới').first().click();
  await p.waitForTimeout(1500);
  const labels = await p.locator('label').allInnerTexts();
  const btns = (await p.getByRole('button').allInnerTexts()).filter((x) => /^Lưu/.test(x));
  txt[surface] = { labels: labels.map((x) => x.trim()).filter(Boolean), save: btns };
  await s.s.close();
}
const same = JSON.stringify(txt.mini375.save) === JSON.stringify(txt.web375.save) && txt.mini375.labels.some((l) => /đường/.test(l)) && txt.web375.labels.some((l) => /đường/.test(l)) && txt.mini375.labels.find((l) => /đường/.test(l)) === txt.web375.labels.find((l) => /đường/.test(l));
check('U8-address-text', 'ctv', 'mini375 vs web375', J, 'form thêm địa chỉ: nút lưu và nhãn ô đường giống nhau ở Mini và web 375', 'apps/miniapp/src/i18n/vi.ts:267 vs apps/web/src/components/address-form.tsx:101,119', same, `Mini=${JSON.stringify(txt.mini375)} web=${JSON.stringify(txt.web375)}`);
await done();
