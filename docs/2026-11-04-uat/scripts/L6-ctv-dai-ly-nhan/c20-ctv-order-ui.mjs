// C20: CTV lên đơn hộ khách bằng giao diện (Mini 375 và web 375): điền người nhận, chọn tỉnh và phường, tìm sản phẩm, chọn phân loại, COD, bấm Tạo đơn hộ khách;
// đối chiếu SQL (đơn mang tên CTV và ghi công CTV, tổng khớp con số trên form, hoa hồng 8%, kho trừ 1); rồi huỷ hai đơn thử qua admin và kiểm kho, hoa hồng.
// Luật: affiliate.service.ts placeOrderForCustomer (userId = referrer = CTV, placedForCustomer, COD tối đa COD_MAX_PER_ORDER 5.000.000đ, SĐT khách khác SĐT CTV),
// hoa hồng mặc định affiliate.default_rate_pct = 8 trên tiền hàng thực trả, không gồm phí giao.
// Chạy sau c10 và c17: node c20-ctv-order-ui.mjs (từ gốc worktree uat-1104). Dùng persona returning (CTV thứ hai) để không đụng số của ctv.
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, call, short, sql, check, done } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);

const CTV = 'uat_returning';
const SKU = 'FUWA-HW-500';
const T = (title, size, step, expect) => ({ title, persona: 'returning', size, journey: title, step, expect });
const stock = async () => (await sql(`SELECT stock::int s FROM variations WHERE sku=$1`, SKU))[0].s;
const [{ r: retail, name: vname }] = await sql(`SELECT "retailPrice"::int r, p.name FROM variations v JOIN products p ON p.id=v."productId" WHERE v.sku=$1`, SKU);
const input = (page, label) => page.locator(`xpath=//*[normalize-space(text())="${label}"]/following::input[1]`).first();
const sess = (surface) => (surface === 'mini375'
  ? open(6, 'returning', { path: '/affiliate', viewport: { width: 375, height: 812, isMobile: true } })
  : openWeb(6, 'returning', { path: '/ctv', viewport: { width: 375, height: 812, isMobile: true } }));

const geo = async (page, surface) => {
  if (surface === 'web375') {
    await page.locator('select[aria-label="Tỉnh/thành"]').selectOption({ label: 'Thành phố Hồ Chí Minh' });
    await page.waitForTimeout(1500);
    await page.locator('select[aria-label="Phường/xã"]').selectOption({ index: 1 });
    return;
  }
  await page.getByText('Chọn tỉnh/thành', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByText('Thành phố Hồ Chí Minh', { exact: true }).last().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.getByText('Chọn phường/xã', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  const ward = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].pop()?.innerText.split('\n').map((x) => x.trim()).filter(Boolean)[1]);
  await page.getByText(ward, { exact: true }).last().click({ timeout: 8000 });
  await page.waitForTimeout(800);
};

const made = [];
const seen = {};
for (const [i, surface] of ['mini375', 'web375'].entries()) {
  const stock0 = await stock();
  const [{ t0 }] = await sql(`SELECT now()::text t0`);
  const phone = `09010000${70 + i}`;
  const s = await sess(surface);
  const info = { surface, stock0, phone };
  try {
    await s.page.waitForTimeout(3500);
    await s.page.getByText('Lên đơn hộ', { exact: true }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(1500);
    await input(s.page, 'Tên người nhận').fill(`Khách UAT ${surface}`);
    await input(s.page, 'Số điện thoại').fill(phone);
    await geo(s.page, surface);
    await input(s.page, 'Địa chỉ (số nhà, đường)').fill('12 Lê Lợi');
    await s.page.getByPlaceholder('Tìm sản phẩm để thêm…').fill('rửa tay');
    await s.page.waitForTimeout(2500);
    await s.page.getByText(vname, { exact: false }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(1500);
    await s.page.getByRole('button', { name: /\d\.\d{3}\s?đ/ }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(2500);
    info.form = await s.page.evaluate(() => document.body.innerText);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-len-don-ho-da-dien.png`) });
    await s.page.getByRole('button', { name: 'Tạo đơn hộ khách' }).last().click({ timeout: 8000 });
    await s.page.waitForTimeout(3500);
    info.done = await s.page.evaluate(() => document.body.innerText);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-len-don-ho-xong.png`) });
  } catch (e) {
    info.error = String(e.message).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 600);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-len-don-ho-loi-thao-tac.png`), fullPage: false }).catch(() => undefined);
  } finally { await s.close(); }
  const [o] = await sql(`SELECT id, code, status::text st, total::int t, subtotal::int sub, "shippingFee"::int ship, "paymentMethod"::text pm, "userId" uid, "referrerUserId" ref, "placedForCustomer" pfc, source::text src FROM orders WHERE "userId"=$1 AND "createdAt" > $2::timestamptz ORDER BY "createdAt" DESC LIMIT 1`, CTV, t0);
  info.order = o ?? null;
  if (o) {
    made.push(o);
    info.items = await sql(`SELECT quantity::int q, "unitPrice"::int u FROM order_items WHERE "orderId"=$1`, o.id);
    info.comm = (await sql(`SELECT amount::int a, status::text s, rate::float r FROM commissions WHERE "orderId"=$1`, o.id))[0] ?? null;
  }
  info.stock1 = await stock();
  seen[surface] = info;
  fs.writeFileSync(path.join(SHOTS, `${surface}-len-don-ho-ket-qua.json`), JSON.stringify({ ...info, form: undefined, done: undefined }, null, 2));
  const size = surface === 'mini375' ? 'Mini 375' : 'web 375';
  const total = o?.t;
  const okForm = (info.form ?? '').includes('Tạm tính hàng') && (total ? (info.form ?? '').includes(`${total.toLocaleString('vi-VN')}đ`) || (info.form ?? '').includes(`${o.sub.toLocaleString('vi-VN')}đ`) : false);
  const okDone = /Đã tạo đơn hộ khách/.test(info.done ?? '') && !!o && (info.done ?? '').includes(o.code);
  const okSql = !!o && o.uid === CTV && o.ref === CTV && o.pfc === true && o.pm === 'COD' && o.sub === retail && o.ship + o.sub === o.t
    && info.items.length === 1 && info.items[0].q === 1 && info.comm?.s === 'PENDING' && info.comm.a === Math.floor((retail * 8) / 100) && info.stock1 === stock0 - 1;
  check(surface === 'mini375' ? 'L6-U37' : 'L6-U38', T(`CTV lên đơn hộ khách bằng giao diện ${size}: điền form, tạo đơn, khớp SQL`, size, `điền người nhận, SĐT ${phone}, tỉnh/phường, địa chỉ, tìm "rửa tay", chọn phân loại ${SKU}, COD, bấm Tạo đơn hộ khách`,
    `form hiện Tạm tính hàng; màn xong hiện "Đã tạo đơn hộ khách" kèm mã đơn; đơn thuộc ${CTV}, ghi công ${CTV}, placedForCustomer, COD, 1 dòng × ${retail}; tổng = tiền hàng + phí giao; hoa hồng PENDING ${Math.floor((retail * 8) / 100)}đ (8%); kho -1`),
  !info.error && okForm && okDone && okSql,
  `${info.error ? `lỗi thao tác: ${info.error}; ` : ''}form=${okForm}; màn xong=${okDone}; đơn=${short(o, 260)}; dòng=${short(info.items, 80)}; hoa hồng=${short(info.comm, 80)}; kho ${stock0}→${info.stock1}`, `shots/L6-ctv-dai-ly-nhan/${surface}-len-don-ho-da-dien.png, ${surface}-len-don-ho-xong.png + SQL orders/order_items/commissions`);
}

const stockBefore = await stock();
const cancels = [];
for (const o of made) cancels.push(await call('admin', 'PUT', `/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: 'UAT dọn đơn thử giao diện' }));
const after = made.length ? await sql(`SELECT o.status::text st, c.status::text cs FROM orders o LEFT JOIN commissions c ON c."orderId"=o.id WHERE o.id = ANY($1::text[])`, made.map((o) => o.id)) : [];
const stockAfter = await stock();
check('L6-U39', T('Huỷ hai đơn lên hộ thử: đơn CANCELLED, hoa hồng REJECTED, kho cộng lại', 'API', 'admin PUT /admin/orders/:id/status CANCELLED cho từng đơn', 'đơn CANCELLED; hoa hồng REJECTED; kho +2'),
  made.length === 2 && cancels.every((r) => r.ok) && after.every((x) => x.st === 'CANCELLED' && x.cs === 'REJECTED') && stockAfter === stockBefore + 2,
  `đơn=${made.map((o) => o.code).join(', ')}; huỷ=${cancels.map((r) => r.status).join(',')}; sau=${short(after, 200)}; kho ${stockBefore}→${stockAfter}`, 'SQL orders/commissions/variations');
await done();
