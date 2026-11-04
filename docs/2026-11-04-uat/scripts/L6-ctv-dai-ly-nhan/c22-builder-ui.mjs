// C22: CTV dựng gian hàng bằng trình dựng (Mini 375 và web 375): Thêm khối > Lưới > đặt tên > "Tạo và thêm món" > bấm "Thêm" ở một sản phẩm,
// rồi đối chiếu SQL (storefront_collections, storefront_items) và trang công khai /s/uatctv (khách thấy khối và món vừa thêm). Cuối script xoá khối thử qua API.
// Luật: storefront.service.ts (khối thuộc gian hàng của chính CTV; khối mới layout GRID khi chọn Lưới; món thêm vào khối ghi storefront_items).
// Chạy sau c4: node c22-builder-ui.mjs (từ gốc worktree uat-1104). Dùng persona ctv (gian hàng uatctv đã LIVE từ c4).
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, call, short, sql, check, done, sleep } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);

const T = (title, size, step, expect) => ({ title, persona: 'ctv', size, journey: title, step, expect });
const SLUG = 'uatctv';
const sess = (surface, persona, route) => (surface === 'mini375'
  ? open(6, persona, { path: route, viewport: { width: 375, height: 812, isMobile: true } })
  : openWeb(6, persona, { path: route, viewport: { width: 375, height: 812, isMobile: true } }));
const builderRoute = { mini375: '/storefront', web375: '/ctv/gian-hang' };
const publicRoute = { mini375: `/s/${SLUG}`, web375: `/s/${SLUG}` };

const stale = await sql(`SELECT c.id FROM storefront_collections c JOIN storefronts s ON s.id=c."storefrontId" WHERE s.slug=$1 AND c.title LIKE 'Khối UAT%'`, SLUG);
for (const r of stale) await call('ctv', 'DELETE', `/storefront/me/collections/${r.id}`);

const seen = {};
for (const surface of ['mini375', 'web375']) {
  const name = `Khối UAT ${surface}`;
  const info = { surface, name };
  const s = await sess(surface, 'ctv', builderRoute[surface]);
  try {
    await s.page.waitForTimeout(3500);
    await s.page.getByText('Thêm khối', { exact: true }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(1200);
    await s.page.getByText('Lưới', { exact: true }).first().click({ timeout: 8000 });
    await s.page.locator('xpath=//*[normalize-space(text())="Tên khối"]/following::input[1]').first().fill(name);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-dung-khoi-dat-ten.png`) });
    await s.page.getByRole('button', { name: 'Tạo và thêm món' }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(2500);
    info.empty = await s.page.evaluate(() => document.body.innerText);
    const addBtn = s.page.getByRole('button', { name: /^\+?\s*Thêm(?! khối| sản phẩm)(\s.+)?$/ }).first();
    info.productName = await addBtn.evaluate((el) => {
      let n = el;
      for (let i = 0; i < 5 && n; i += 1) {
        n = n.parentElement;
        const lines = (n?.innerText ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
        if (lines.length >= 3) return lines[0];
      }
      return '';
    });
    await addBtn.click({ timeout: 8000 });
    await s.page.waitForTimeout(2500);
    info.after = await s.page.evaluate(() => document.body.innerText);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-dung-khoi-sau-them-mon.png`) });
  } catch (e) {
    info.error = String(e.message).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 400);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-dung-khoi-loi-thao-tac.png`) }).catch(() => undefined);
  } finally { await s.close(); }
  const [col] = await sql(`SELECT c.id, c.title, c.layout::text l, c.kind::text k FROM storefront_collections c JOIN storefronts s ON s.id=c."storefrontId" WHERE s.slug=$1 AND c.title=$2`, SLUG, name);
  info.col = col ?? null;
  info.items = col ? await sql(`SELECT i."productId" pid, p.name pname, i."isHidden" hid FROM storefront_items i JOIN products p ON p.id=i."productId" WHERE i."collectionId"=$1`, col.id) : [];
  const g = await sess(surface, 'new', publicRoute[surface]);
  try {
    await g.page.waitForTimeout(4000);
    info.public = await g.page.evaluate(() => document.body.innerText);
    await g.page.screenshot({ path: path.join(SHOTS, `${surface}-gian-hang-cong-khai-sau-dung-khoi.png`) });
  } catch (e) { info.error = `${info.error ?? ''} public: ${String(e.message).slice(0, 200)}`; } finally { await g.close(); }
  seen[surface] = info;
  const size = surface === 'mini375' ? 'Mini 375' : 'web 375';
  const sqlOk = !!col && col.l === 'GRID' && info.items.length === 1 && !info.items[0].hid;
  const emptyOk = /0 món/.test(info.empty ?? '');
  const pub = info.public ?? '';
  const pubOk = pub.includes(name) && !!info.items[0] && pub.includes(info.items[0].pname);
  check(surface === 'mini375' ? 'L6-U40' : 'L6-U41', T(`CTV dựng khối bằng trình dựng ${size}: tạo khối Lưới, thêm một món, trang công khai hiện khối và món`, size, `Thêm khối > Lưới > tên "${name}" > Tạo và thêm món > bấm Thêm ở món đầu > mở /s/${SLUG} bằng khách`,
    'màn khối mới ghi "0 món"; storefront_collections có khối layout GRID; storefront_items đúng 1 dòng, không ẩn; trang công khai hiện tên khối và tên món'),
  !info.error && emptyOk && sqlOk && pubOk,
  `${info.error ? `lỗi: ${info.error}; ` : ''}khối trống ghi "0 món"=${emptyOk}; khối=${short(col, 160)}; món=${short(info.items, 200)}; công khai có tên khối=${pub.includes(name)}, có tên món=${!!info.items[0] && pub.includes(info.items[0].pname)}`,
  `shots/L6-ctv-dai-ly-nhan/${surface}-dung-khoi-sau-them-mon.png, ${surface}-gian-hang-cong-khai-sau-dung-khoi.png + SQL storefront_collections/storefront_items`);
}

const made = Object.values(seen).map((x) => x.col?.id).filter(Boolean);
const dels = [];
for (const id of made) dels.push(await call('ctv', 'DELETE', `/storefront/me/collections/${id}`));
const left = await sql(`SELECT c.id FROM storefront_collections c JOIN storefronts s ON s.id=c."storefrontId" WHERE s.slug=$1 AND c.title LIKE 'Khối UAT%'`, SLUG);
const leftItems = made.length ? await sql(`SELECT id FROM storefront_items WHERE "collectionId" = ANY($1::text[])`, made) : [];
check('L6-U42', T('Xoá khối thử: khối và các món trong khối biến mất khỏi SQL', 'API', 'ctv DELETE /storefront/me/collections/:id cho từng khối', 'mọi lệnh xoá trả 2xx; không còn khối "Khối UAT…" và không còn dòng storefront_items của khối đó'),
  made.length === 2 && dels.every((r) => r.ok) && left.length === 0 && leftItems.length === 0,
  `khối đã tạo=${made.length}; xoá=${dels.map((r) => r.status).join(',')}; còn khối=${left.length}; còn món=${leftItems.length}`, 'SQL storefront_collections/storefront_items');
fs.writeFileSync(path.join(SHOTS, 'dung-khoi-ket-qua.json'), JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, { ...v, empty: undefined, after: undefined, public: undefined }])), null, 2));
await done();
