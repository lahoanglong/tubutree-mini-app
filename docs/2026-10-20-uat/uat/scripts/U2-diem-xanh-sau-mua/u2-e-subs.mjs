#!/usr/bin/env node
// U2-18..U2-22: đặt định kỳ trên Mini App (tạo + đơn đầu, sửa, bỏ qua kỳ, job tạo đơn kỳ, huỷ), giảm giá định kỳ và Điểm Xanh của đơn kỳ.
// Dùng: node u2-e-subs.mjs [lane=7] [--headed]
import path from 'node:path';
import { L, prisma, kase, main, ledger, open, api, runJob, q, x, sleep, headless, SHOTS, deliver, pct, rowsFor } from './u2lib.mjs';

const R = 'uat_returning';
const SKU = 'FUWA-HW-500';
const SLUG = 'nuoc-rua-tay-fuwa3e';

const subOf = async () => prisma.subscription.findFirst({ where: { userId: R, variation: { sku: SKU } }, orderBy: { createdAt: 'desc' } });

async function onSubsPanel(fn, shot) {
  const s = await open(L.n, R, { headless, path: '/orders?tab=subscriptions' });
  try {
    await s.page.getByRole('button', { name: 'Sửa', exact: true }).first().waitFor({ timeout: 20_000 });
    const out = await fn(s.page, s);
    await sleep(1200);
    if (shot) await s.page.screenshot({ path: path.join(SHOTS, `${shot}.png`) });
    return out;
  } finally {
    await s.close();
  }
}

await main(async (results) => {
  const v = await prisma.variation.findUnique({ where: { sku: SKU }, select: { id: true, stock: true, retailPrice: true, salePrice: true } });
  const unit = v.salePrice ?? v.retailPrice;

  {
    const c = kase('U2-18', 'Tạo gói định kỳ 4 tuần trên Mini App (giao ngay, COD): đơn đầu giảm 12%, phí giao không tính điểm, điểm = 2% × 1,2 × tiền hàng sau giảm');
    try {
      const stock0 = v.stock;
      const s = await open(L.n, R, { headless, path: `/product/${SLUG}` });
      let created;
      try {
        const p = s.page;
        await p.getByRole('button', { name: /Đặt định kỳ — tiết kiệm/ }).click({ timeout: 25_000 });
        await p.getByRole('group', { name: 'Chu kỳ giao' }).getByText('4 tuần', { exact: true }).click();
        await p.getByRole('group', { name: 'Đơn đầu tiên' }).getByText('Giao ngay', { exact: true }).click();
        await p.getByRole('radio', { name: /Thanh toán khi nhận hàng/ }).click();
        await sleep(500);
        await p.screenshot({ path: path.join(SHOTS, 'U2-18-subscribe-sheet.png') });
        const resp = p.waitForResponse((r) => r.url().endsWith('/api/me/subscriptions') && r.request().method() === 'POST', { timeout: 30_000 });
        await p.getByRole('button', { name: 'Bắt đầu đặt định kỳ' }).click();
        const r = await resp;
        created = { status: r.status(), body: await r.json() };
        await sleep(1200);
        await p.screenshot({ path: path.join(SHOTS, 'U2-18-subscribe-done.png') });
      } finally {
        await s.close();
      }
      c.ev('POST /me/subscriptions', { status: created.status, sub: { id: created.body.id, intervalWeeks: created.body.intervalWeeks, nextRunAt: created.body.nextRunAt, status: created.body.status }, firstOrder: created.body.firstOrder });
      c.check('201, gói ACTIVE 4 tuần, có đơn đầu', created.status === 201 && created.body.status === 'ACTIVE' && created.body.intervalWeeks === 4 && created.body.firstOrder?.code, { status: created.status });
      const o = await prisma.order.findUnique({ where: { code: created.body.firstOrder.code }, select: { id: true, code: true, subtotal: true, discount: true, shippingFee: true, total: true, pointsEarned: true, status: true, source: true, paymentMethod: true } });
      const disc = Math.floor(unit * 0.12);
      const goods = unit - disc;
      const ship = unit >= 99000 ? 0 : 19000;
      c.ev('đơn đầu', o);
      c.check(`đơn đầu: subtotal ${unit}, giảm 12% = ${disc}, phí giao ${ship}, total = ${goods + ship}`, o.subtotal === unit && o.discount === disc && o.shippingFee === ship && o.total === goods + ship, o);
      c.check(`điểm đơn kỳ = floor(${goods} × 2% × 1,2) = ${pct(goods, 2, 1.2)} (không tính ship)`, o.pointsEarned === pct(goods, 2, 1.2), o.pointsEarned);
      const st = await prisma.variation.findUnique({ where: { id: v.id }, select: { stock: true } });
      c.check('tồn kho −1', st.stock === stock0 - 1, { before: stock0, after: st.stock });
      const sub = await subOf();
      const days = (new Date(sub.nextRunAt).getTime() - Date.now()) / 86_400_000;
      c.check('nextRunAt ≈ hôm nay + 28 ngày', days > 27.9 && days < 28.1, { nextRunAt: sub.nextRunAt, days: Number(days.toFixed(2)) });
      c.ev('deliver đơn đầu', await deliver(o.code));
      const rows = await rowsFor(R, `ORDER_DELIVERED:${o.code}`);
      c.check('giao đơn đầu: dòng sổ = pointsEarned', rows.length === 1 && rows[0].delta === o.pointsEarned, rows.map((r) => r.delta));
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-19', 'Sửa gói trên Mini App: số lượng 1 → 2 → PATCH 200, DB quantity 2');
    try {
      const r = await onSubsPanel(async (p) => {
        await p.getByRole('button', { name: 'Sửa', exact: true }).first().click();
        await p.getByRole('button', { name: 'Tăng số lượng' }).last().click();
        const resp = p.waitForResponse((r2) => /\/api\/me\/subscriptions\/[^/]+$/.test(new URL(r2.url()).pathname) && r2.request().method() === 'PATCH', { timeout: 20_000 });
        await p.getByRole('button', { name: 'Lưu thay đổi' }).click();
        const rr = await resp;
        return { status: rr.status(), body: await rr.json() };
      }, 'U2-19-edit');
      const sub = await subOf();
      c.ev('PATCH (UI)', { status: r.status, quantity: r.body.quantity });
      c.check('UI sửa số lượng: 200, DB quantity 2', r.status < 300 && sub.quantity === 2, { status: r.status, quantity: sub.quantity });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-19b', 'Sửa kỳ (Q22: đổi chu kỳ giao 4 → 6 tuần) trên màn Sửa gói Mini App: ngày giao kế tính lại từ đơn kỳ gần nhất (0h VN + chu kỳ, sớm nhất ngày mai); chu kỳ ngoài 4/6/8/10 bị từ chối');
    try {
      const sub = await subOf();
      const lastOrder = await prisma.order.findUnique({ where: { id: sub.lastOrderId }, select: { code: true, createdAt: true } });
      const vnDay = (d) => new Date(Math.floor((d.getTime() + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000);
      const earliest = new Date(vnDay(new Date()).getTime() + 86_400_000);
      const due = new Date(vnDay(lastOrder.createdAt).getTime() + 6 * 7 * 86_400_000);
      const expectNext = due < earliest ? earliest : due;
      c.ev('trước', { intervalWeeks: sub.intervalWeeks, nextRunAt: sub.nextRunAt, lastOrder, expectNext });
      const ui = await onSubsPanel(async (p) => {
        await p.getByRole('button', { name: 'Sửa', exact: true }).first().click();
        await sleep(800);
        const sheet = (await p.evaluate(() => document.body.innerText)).split('\n').filter((t) => /Sửa gói|Số lượng|Chu kỳ|tuần|Thanh toán|Giao tới|Giao kế|kỳ tới/i.test(t));
        const options = await p.getByRole('group', { name: 'Chu kỳ giao' }).last().getByText(/^\d+ tuần$/).allInnerTexts();
        await p.getByRole('group', { name: 'Chu kỳ giao' }).last().getByText('6 tuần', { exact: true }).click();
        await sleep(300);
        const hint = (await p.evaluate(() => document.body.innerText)).split('\n').filter((t) => /kế tiếp|tiếp theo|ngày giao|Giao kỳ/i.test(t));
        const resp = p.waitForResponse((r2) => /\/api\/me\/subscriptions\/[^/]+$/.test(new URL(r2.url()).pathname) && r2.request().method() === 'PATCH', { timeout: 20_000 });
        await p.getByRole('button', { name: 'Lưu thay đổi' }).click();
        const rr = await resp;
        return { sheet, options, hint, status: rr.status(), reqBody: rr.request().postData(), body: await rr.json() };
      }, 'U2-19b-edit-sheet');
      c.ev('màn Sửa gói định kỳ (bấm "6 tuần" rồi "Lưu thay đổi")', { sheet: ui.sheet, options: ui.options, hint: ui.hint, status: ui.status, reqBody: ui.reqBody, resp: { intervalWeeks: ui.body.intervalWeeks, nextRunAt: ui.body.nextRunAt } });
      c.check('màn sửa có đủ 4 lựa chọn chu kỳ 4/6/8/10 tuần', ['4 tuần', '6 tuần', '8 tuần', '10 tuần'].every((o) => ui.options.includes(o)), ui.options);
      const sub2 = await subOf();
      c.check('UI: PATCH 200, DB intervalWeeks 6', ui.status < 300 && sub2.intervalWeeks === 6, { status: ui.status, intervalWeeks: sub2.intervalWeeks });
      const driftMs = Math.abs(new Date(sub2.nextRunAt).getTime() - expectNext.getTime());
      c.check('nextRunAt tính lại từ đơn kỳ gần nhất: 0h VN ngày tạo đơn + 42 ngày, sớm nhất 0h VN ngày mai', driftMs < 1000, { nextRunAt: sub2.nextRunAt, expectNext, driftMs });
      c.check('API trả nextRunAt khớp DB', ui.body.nextRunAt && Math.abs(new Date(ui.body.nextRunAt).getTime() - new Date(sub2.nextRunAt).getTime()) < 1000, ui.body.nextRunAt);
      const bad = await api(L, 'PATCH', `/me/subscriptions/${sub.id}`, { user: R, body: { intervalWeeks: 5 } });
      const sub3 = await subOf();
      c.ev('PATCH intervalWeeks 5 (API)', { status: bad.status, message: bad.body?.message, intervalWeeks: sub3.intervalWeeks });
      c.check('chu kỳ 5 tuần bị từ chối 400, DB giữ 6', bad.status === 400 && sub3.intervalWeeks === 6, { status: bad.status, intervalWeeks: sub3.intervalWeeks });
      const orders = await prisma.order.count({ where: { subscriptionId: sub.id } });
      c.check('đổi chu kỳ không tạo đơn', orders === 1, orders);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-20', 'Bỏ qua kỳ trên Mini App ("Huỷ" → "Bỏ qua kỳ này"): nextRunAt lùi đúng 1 chu kỳ, gói vẫn ACTIVE');
    try {
      const s0 = await subOf();
      const r = await onSubsPanel(async (p) => {
        await p.getByRole('button', { name: 'Huỷ', exact: true }).first().click();
        const resp = p.waitForResponse((r2) => /\/skip$/.test(new URL(r2.url()).pathname) && r2.request().method() === 'POST', { timeout: 20_000 });
        await p.getByRole('button', { name: 'Bỏ qua kỳ này' }).click();
        const rr = await resp;
        return { status: rr.status() };
      }, 'U2-20-skip');
      const s1 = await subOf();
      const diff = (new Date(s1.nextRunAt).getTime() - new Date(s0.nextRunAt).getTime()) / 86_400_000;
      c.ev('skip', { http: r.status, before: s0.nextRunAt, after: s1.nextRunAt, diffDays: diff, intervalWeeks: s1.intervalWeeks, status: s1.status });
      c.check(`nextRunAt + ${s1.intervalWeeks * 7} ngày, status ACTIVE`, r.status < 300 && Math.abs(diff - s1.intervalWeeks * 7) < 0.01 && s1.status === 'ACTIVE', { diff, status: s1.status });
      const orders = await prisma.order.count({ where: { subscriptionId: s1.id } });
      c.check('bỏ qua không tạo đơn', orders === 1, orders);
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-21', 'Job subscriptions.process-due: tới hạn → tạo đơn kỳ (số lượng 2, giảm 12%, điểm đúng); chạy lại không tạo trùng; giao → cộng điểm');
    try {
      const s0 = await subOf();
      await x(`UPDATE subscriptions SET "nextRunAt" = now() - interval '1 minute' WHERE id = $1`, s0.id);
      const st0 = (await prisma.variation.findUnique({ where: { id: v.id }, select: { stock: true } })).stock;
      const j1 = runJob('subscriptions.process-due');
      const orders = await prisma.order.findMany({ where: { subscriptionId: s0.id }, orderBy: { createdAt: 'asc' }, select: { code: true, subtotal: true, discount: true, shippingFee: true, total: true, pointsEarned: true, status: true, source: true, items: { select: { quantity: true, unitPrice: true } } } });
      const s1 = await subOf();
      c.ev('job 1', { result: j1.result, harness: j1.harnessExitError, orders, nextRunAt: s1.nextRunAt });
      const cyc = orders[orders.length - 1];
      const sub2 = unit * 2;
      const disc = Math.floor(sub2 * 0.12);
      c.check('job tạo đúng 1 đơn kỳ mới (tổng 2 đơn), số lượng 2', orders.length === 2 && cyc.items[0].quantity === 2, { n: orders.length, qty: cyc?.items?.[0]?.quantity });
      c.check(`đơn kỳ: subtotal ${sub2}, giảm 12% ${disc}, điểm = floor(${sub2 - disc} × 2% × 1,2)`, cyc.subtotal === sub2 && cyc.discount === disc && cyc.pointsEarned === pct(sub2 - disc, 2, 1.2), cyc);
      const days = (new Date(s1.nextRunAt).getTime() - Date.now()) / 86_400_000;
      c.check(`nextRunAt ≈ hôm nay + ${s1.intervalWeeks * 7} ngày`, Math.abs(days - s1.intervalWeeks * 7) < 0.1, { days: Number(days.toFixed(2)) });
      const st1 = (await prisma.variation.findUnique({ where: { id: v.id }, select: { stock: true } })).stock;
      c.check('tồn kho −2', st1 === st0 - 2, { before: st0, after: st1 });
      runJob('subscriptions.process-due');
      c.check('chạy job lần 2: không tạo đơn trùng', (await prisma.order.count({ where: { subscriptionId: s0.id } })) === 2);
      c.ev('giao đơn kỳ', await deliver(cyc.code));
      const rows = await rowsFor(R, `ORDER_DELIVERED:${cyc.code}`);
      const led = await ledger(R);
      c.check('giao đơn kỳ: dòng sổ = pointsEarned, số dư = SUM sổ', rows.length === 1 && rows[0].delta === cyc.pointsEarned && led.balance === led.stdSum, { rows: rows.map((r) => r.delta), balance: led.balance, sum: led.stdSum });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }

  {
    const c = kase('U2-22', 'Huỷ gói trên Mini App ("Huỷ" → "Vẫn huỷ"): CANCELLED; tới hạn chạy job không tạo đơn');
    try {
      const r = await onSubsPanel(async (p) => {
        await p.getByRole('button', { name: 'Huỷ', exact: true }).first().click();
        const resp = p.waitForResponse((r2) => /\/status$/.test(new URL(r2.url()).pathname) && r2.request().method() === 'POST', { timeout: 20_000 });
        await p.getByRole('button', { name: 'Vẫn huỷ' }).click();
        const rr = await resp;
        return { status: rr.status(), body: await rr.json() };
      }, 'U2-22-cancel');
      const s = await subOf();
      c.check('POST status CANCELLED → DB CANCELLED', r.status < 300 && s.status === 'CANCELLED', { http: r.status, status: s.status });
      const n0 = await prisma.order.count({ where: { subscriptionId: s.id } });
      await x(`UPDATE subscriptions SET "nextRunAt" = now() - interval '1 minute' WHERE id = $1`, s.id);
      runJob('subscriptions.process-due');
      const n1 = await prisma.order.count({ where: { subscriptionId: s.id } });
      c.check('gói đã huỷ: job không tạo đơn', n1 === n0, { before: n0, after: n1 });
    } catch (e) {
      c.error(e);
    }
    results.push(c.finish());
  }
});
