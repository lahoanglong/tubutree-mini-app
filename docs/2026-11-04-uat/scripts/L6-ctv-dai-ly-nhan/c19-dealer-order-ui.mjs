// C19: đại lý đặt hàng bằng giao diện (Mini 375 và web 375): "Dán đơn" (SKU viết thường, dòng trùng, SKU lạ), tổng tiền trên thanh đặt hàng,
// bấm "Ghi công nợ", rồi đối chiếu SQL (đơn, dòng hàng, sổ công nợ); sau đó huỷ hai đơn thử qua admin và kiểm công nợ trở về.
// Luật: dealer.service.ts unitPrice (giá lẻ × (1 - chiết khấu bậc), DEALER_2 = 30%), đơn tối thiểu 3.000.000đ, phí giao 19.000đ khi tiền hàng < 5.000.000đ,
// đơn Ghi công nợ ghi dòng dealer_credit_ledgers refType=ORDER +tổng đơn; huỷ ghi ORDER_CANCEL âm đúng số đó.
// Chạy sau c15 (công nợ đã có số): node c19-dealer-order-ui.mjs (từ gốc worktree uat-1104). Cần persona dealer ở bậc DEALER_2.
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, call, short, sql, check, done, sleep } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);

const D = 'uat_dealer';
const T = (title, size, step, expect) => ({ title, persona: 'dealer', size, journey: title, step, expect });
const fmt = (n) => `${n.toLocaleString('vi-VN')}đ`;
const PASTE = 'SOK-CT-150, 45\nkhong-co-sku, 3\n\nsok-ct-150 5';
const [{ r: retail }] = await sql(`SELECT "retailPrice"::int r FROM variations WHERE sku='SOK-CT-150'`);
const unit = Math.round(retail * 0.7);
const goods = unit * 50;
const total = goods + 19_000;
const debt = async () => (await sql(`SELECT COALESCE(SUM(delta),0)::int s FROM dealer_credit_ledgers WHERE "userId"=$1`, D))[0].s;
const sess = (surface) => (surface === 'mini375'
  ? open(6, 'dealer', { path: '/dealer', viewport: { width: 375, height: 812, isMobile: true } })
  : openWeb(6, 'dealer', { path: '/dai-ly', viewport: { width: 375, height: 812, isMobile: true } }));

const made = [];
const seen = {};
for (const surface of ['mini375', 'web375']) {
  const debt0 = await debt();
  const [{ t0 }] = await sql(`SELECT now()::text t0`);
  const s = await sess(surface);
  const info = { surface, debt0 };
  try {
    await s.page.waitForTimeout(3500);
    await s.page.getByRole('button', { name: 'Dán đơn' }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(800);
    await s.page.locator('textarea').first().fill(PASTE);
    await s.page.getByRole('button', { name: 'Thêm vào đơn' }).first().click({ timeout: 8000 });
    await s.page.waitForTimeout(800);
    info.pasteText = await s.page.evaluate(() => document.body.innerText);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-dai-ly-dan-don.png`) });
    await s.page.keyboard.press('Escape');
    await s.page.waitForTimeout(700);
    if (await s.page.locator('textarea').first().isVisible().catch(() => false)) {
      await s.page.getByRole('button', { name: /Đóng/ }).first().click({ timeout: 4000 }).catch(() => undefined);
      await s.page.waitForTimeout(700);
    }
    info.cartText = await s.page.evaluate(() => document.body.innerText);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-dai-ly-thanh-dat-hang.png`) });
    await s.page.getByRole('button', { name: 'Ghi công nợ' }).last().click({ timeout: 8000 });
    await s.page.waitForTimeout(3500);
    info.afterText = await s.page.evaluate(() => document.body.innerText);
    await s.page.screenshot({ path: path.join(SHOTS, `${surface}-dai-ly-sau-khi-dat.png`) });
  } catch (e) {
    info.error = String(e.message).slice(0, 200);
  } finally { await s.close(); }
  const [o] = await sql(`SELECT id, code, total::int t, subtotal::int sub, "shippingFee"::int ship, "paymentMethod"::text pm, status::text s FROM orders WHERE "userId"=$1 AND type::text='DEALER' AND "createdAt" > $2::timestamptz ORDER BY "createdAt" DESC LIMIT 1`, D, t0);
  info.order = o ?? null;
  if (o) {
    made.push(o);
    info.items = await sql(`SELECT quantity::int q, "unitPrice"::int u FROM order_items WHERE "orderId"=$1`, o.id);
    info.ledger = await sql(`SELECT delta::int d, "refType" t FROM dealer_credit_ledgers WHERE "refId"=$1`, o.id);
  }
  info.debt1 = await debt();
  seen[surface] = info;
  fs.writeFileSync(path.join(SHOTS, `${surface}-dai-ly-dat-hang.json`), JSON.stringify({ ...info, pasteText: undefined, cartText: undefined, afterText: undefined }, null, 2));
  const id = surface === 'mini375' ? 'L6-U33' : 'L6-U34';
  const pasteOk = /Khớp 2 dòng/.test(info.pasteText ?? '') && /Không khớp: KHONG-CO-SKU/.test(info.pasteText ?? '');
  const barOk = (info.cartText ?? '').includes(fmt(total)) && (info.cartText ?? '').includes(`Tiền hàng ${fmt(goods)} + Phí giao ${fmt(19_000)}`);
  const sqlOk = !!o && o.t === total && o.sub === goods && o.ship === 19_000 && o.pm === 'BANK_TRANSFER' && info.items.length === 1 && info.items[0].q === 50 && info.items[0].u === unit
    && info.ledger.length === 1 && info.ledger[0].t === 'ORDER' && info.ledger[0].d === total && info.debt1 === debt0 + total;
  check(id, T(`Đại lý đặt hàng bằng giao diện ${surface === 'mini375' ? 'Mini 375' : 'web 375'}: dán đơn, tổng tiền, Ghi công nợ khớp SQL`, surface === 'mini375' ? 'Mini 375' : 'web 375', 'Dán đơn "SOK-CT-150, 45 / khong-co-sku, 3 / sok-ct-150 5" rồi Thêm vào đơn, xem thanh đặt hàng, bấm Ghi công nợ',
    `báo "Khớp 2 dòng · Không khớp: KHONG-CO-SKU"; thanh đặt hàng "Tiền hàng ${fmt(goods)} + Phí giao ${fmt(19_000)}" tổng ${fmt(total)} (50 × ${fmt(unit)}, giá lẻ ${fmt(retail)} giảm 30%); đơn 1 dòng 50 × ${unit} (đơn đại lý lưu paymentMethod BANK_TRANSFER, dealer.service.ts:372; công nợ thể hiện bằng dòng sổ ORDER); sổ ORDER +${total}; công nợ tăng ${total}`),
  !info.error && pasteOk && barOk && sqlOk,
  `${info.error ? `lỗi thao tác: ${info.error}; ` : ''}dán=${pasteOk}; thanh=${barOk}; đơn=${short(o, 200)}; dòng=${short(info.items, 80)}; sổ=${short(info.ledger, 80)}; công nợ ${debt0}→${info.debt1} (kỳ vọng +${total})`, `shots/L6-ctv-dai-ly-nhan/${surface}-dai-ly-thanh-dat-hang.png + SQL orders/order_items/dealer_credit_ledgers`);
}

const strip = (t) => (t ?? '').split('\n').map((x) => x.trim()).filter((x) => /Khớp \d+ dòng|Tiền hàng|Miễn phí giao|Đơn tối thiểu|Vượt hạn mức/.test(x));
const uniq = (l) => [...new Set(l)].sort();
const a = uniq(strip(seen.mini375.pasteText).concat(strip(seen.mini375.cartText)));
const b = uniq(strip(seen.web375.pasteText).concat(strip(seen.web375.cartText)));
check('L6-U35', T('Đặt hàng đại lý: chữ báo kết quả dán và dòng tiền ở Mini 375 giống web 375', 'Mini 375 vs web 375', 'so các dòng "Khớp…", "Tiền hàng…", "Miễn phí giao…" sau bước dán', 'hai bên cùng các dòng'), JSON.stringify(a) === JSON.stringify(b) && a.length >= 2, `Mini=${short(a, 260)}; web=${short(b, 260)}`, 'shots/L6-ctv-dai-ly-nhan/*-dai-ly-dan-don.png');

const debtBeforeCancel = await debt();
const cancels = [];
for (const o of made) cancels.push(await call('admin', 'PUT', `/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: 'UAT dọn đơn thử giao diện' }));
const rows = made.length ? await sql(`SELECT "refId" r, delta::int d, "refType" t FROM dealer_credit_ledgers WHERE "refType"='ORDER_CANCEL' AND "refId" = ANY($1::text[])`, made.map((o) => o.id)) : [];
const states = made.length ? await sql(`SELECT status::text s FROM orders WHERE id = ANY($1::text[])`, made.map((o) => o.id)) : [];
const debtAfter = await debt();
check('L6-U36', T('Huỷ hai đơn thử của đại lý: đơn CANCELLED, sổ ghi ORDER_CANCEL âm đúng số đơn, công nợ trở về như trước khi đặt', 'API', 'admin PUT /admin/orders/:id/status CANCELLED cho từng đơn', `mỗi đơn một dòng ORDER_CANCEL -${total}; công nợ = ${debtBeforeCancel} - ${total * made.length}`),
  made.length === 2 && cancels.every((r) => r.ok) && states.every((x) => x.s === 'CANCELLED') && rows.length === 2 && rows.every((r) => r.d === -total) && debtAfter === debtBeforeCancel - total * made.length,
  `đơn=${made.map((o) => o.code).join(', ')}; huỷ=${cancels.map((r) => r.status).join(',')}; trạng thái=${states.map((x) => x.s).join(',')}; ORDER_CANCEL=${short(rows, 200)}; công nợ ${debtBeforeCancel}→${debtAfter}`, 'SQL dealer_credit_ledgers + orders');
await done();
