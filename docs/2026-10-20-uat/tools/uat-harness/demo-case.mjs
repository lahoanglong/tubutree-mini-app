#!/usr/bin/env node
// Ca ví dụ đầu-cuối trên một lane (cần lane-up.sh <N> --web):
//   1. khách quay lại (uat_returning) đặt đơn COD trên Mini App thật: trang chủ → "Mua lại" → "Thêm vào giỏ" → "Thanh toán" → "Đặt hàng"
//   2. đơn lên giả Pancake (API tự đẩy lúc đặt)
//   3. admin xử lý đơn trên web admin thật (/admin?tab=orders): tìm mã đơn → mở đơn → "Đã đóng gói" (PUT /admin/orders/:id/status).
//      Đơn COD vào thẳng CONFIRMED lúc đặt (apps/api/src/modules/checkout/checkout.service.ts: status = COD → CONFIRMED),
//      nên bước "xác nhận" của admin là chuyển đơn sang khâu kho.
//   4. giả Pancake báo shipped rồi delivered (webhook ký x-webhook-token, worker BullMQ của API lane xử lý)
//   5. chạy job orders.delivered-effects-resync (run-job.mjs, gọi resyncPending để có kết quả) — đơn đã xong việc sau giao thì
//      job không cộng lần hai
//   6. đối chiếu SQL: dòng sổ điểm ORDER_DELIVERED:<mã> = điểm báo giá hứa; users.pointsBalance = trước + điểm đơn = SUM(delta)
// Dùng: node demo-case.mjs <lane> [--headed]   → in từng bước, ảnh trong state/lane-<N>/shots/demo-*.png, dòng cuối PASS/FAIL.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { api, closePrisma, findUser, lane, prismaFor, sleep, STATE, HARNESS } from './lib.mjs';
import { open } from './miniapp-session.mjs';
import { openWeb } from './web-session.mjs';
import { sendOrderStatus } from './pancake-webhook.mjs';

const L = lane(process.argv[2] ?? '');
const headless = !process.argv.includes('--headed');
const SHOTS = path.join(STATE, `lane-${L.n}`, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const prisma = prismaFor(L);
const t0 = Date.now();
const log = (step, msg, data) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${step} ${msg}${data !== undefined ? ` ${JSON.stringify(data)}` : ''}`);
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  log(ok ? 'OK  ' : 'FAIL', name, detail);
};

async function ledger(userId) {
  const [bal] = await prisma.$queryRawUnsafe(`SELECT "pointsBalance"::int AS balance FROM users WHERE id = $1`, userId);
  const [sum] = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(delta), 0)::int AS sum, COUNT(*)::int AS n FROM points_transactions WHERE "userId" = $1 AND lot = 'STANDARD'`,
    userId,
  );
  return { balance: bal.balance, ledgerSum: sum.sum, rows: sum.n };
}

let mini;
let web;
try {
  const user = await findUser(L, 'returning');
  const before = await ledger(user.id);
  log('0', 'sổ điểm trước', before);

  // Giỏ còn hàng từ lần chạy trước thì "Thêm vào giỏ (1)" và tổng tiền sẽ lệch: dọn giỏ bằng chính API giỏ của khách.
  const cart = await api(L, 'GET', '/cart', { user: user.id });
  for (const it of cart.body?.items ?? []) await api(L, 'DELETE', `/cart/items/${it.id}`, { user: user.id });
  log('0', `dọn giỏ: ${cart.body?.items?.length ?? 0} dòng`);

  // 1. Mini App thật
  mini = await open(L.n, 'returning', { headless });
  const p = mini.page;
  const rail = p.getByRole('region', { name: 'Mua lại' });
  await rail.getByRole('button', { name: 'Mua lại', exact: true }).first().click();
  await p.getByRole('button', { name: /Thêm vào giỏ/ }).first().click();
  const pay = p.getByRole('button', { name: /^Thanh toán \(\d+\)$/ });
  await pay.waitFor({ timeout: 15_000 });
  const quoteResp = p.waitForResponse((r) => r.url().endsWith('/api/checkout/quote') && r.request().method() === 'POST', { timeout: 20_000 });
  await pay.click();
  await p.waitForURL(/\/checkout$/, { timeout: 15_000 });
  const quote = await (await quoteResp).json();
  const place = p.getByRole('button', { name: /^Đặt hàng · / });
  await place.waitFor({ timeout: 15_000 });
  const cod = await p.getByRole('radio', { name: /Thanh toán khi nhận hàng/ }).isChecked();
  check('Mini App: phương thức COD đang chọn', cod);
  await p.screenshot({ path: path.join(SHOTS, 'demo-1-checkout.png') });
  log('1', 'báo giá', { subtotal: quote.subtotal, shippingFee: quote.shippingFee, total: quote.total, pointsEarned: quote.pointsEarned });
  const placedResp = p.waitForResponse((r) => r.url().endsWith('/api/checkout/place-order') && r.request().method() === 'POST', { timeout: 30_000 });
  await place.click();
  const placedR = await placedResp;
  const placed = await placedR.json();
  const code = placed.code ?? placed.order?.code ?? placed.orders?.[0]?.code;
  check('Mini App: POST /checkout/place-order', placedR.status() < 300 && code, { status: placedR.status(), code });
  await p.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await p.screenshot({ path: path.join(SHOTS, 'demo-1-placed.png') });
  const miniApi = mini.requests.filter((r) => !r.mocked);
  check('Mini App: mọi request API (trừ đổi token Zalo) đi tới API lane thật, không lỗi', miniApi.length > 0 && miniApi.every((r) => r.status > 0 && r.status < 400), {
    total: miniApi.length,
    mocked: mini.requests.filter((r) => r.mocked).map((r) => r.path),
    bad: miniApi.filter((r) => !(r.status > 0 && r.status < 400)),
  });
  check('Mini App: không request nào ra ngoài (api.tubutree.com/Zalo/Sentry)', mini.blocked.length === 0, { blocked: mini.blocked, staticCdn: mini.staticCdn });
  await mini.close();
  mini = null;

  let order = await prisma.order.findUnique({ where: { code } });
  check('DB: đơn mới COD, CONFIRMED, của uat_returning', order?.status === 'CONFIRMED' && order.paymentMethod === 'COD' && order.userId === user.id, {
    status: order?.status,
    paymentMethod: order?.paymentMethod,
    total: order?.total,
  });

  // 2. Lên giả Pancake
  for (let i = 0; i < 40 && !order.pancakeOrderId; i++) {
    await sleep(500);
    order = await prisma.order.findUnique({ where: { code } });
  }
  const found = await (await fetch(`${L.pancakeUrl}/__uat/find?code=${code}`)).json().catch(() => null);
  const fake = found?.kind === 'app' ? found.order : null;
  check('giả Pancake: đã nhận đơn (pancakeOrderId)', order.pancakeOrderId && String(fake?.id) === String(order.pancakeOrderId), {
    pancakeOrderId: order.pancakeOrderId,
    fake: fake && { id: fake.id, status: fake.status, cod: fake.cod, custom_id: fake.custom_id },
  });

  // 3. Admin trên web thật
  web = await openWeb(L.n, 'admin', { width: 1440, path: '/admin?tab=orders', headless });
  const w = web.page;
  const search = w.getByPlaceholder(/Tìm mã đơn/);
  await search.waitFor({ timeout: 60_000 });
  await search.fill(code);
  await w.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  const row = w.getByRole('row').filter({ hasText: code });
  await row.first().waitFor({ timeout: 30_000 });
  await row.first().getByRole('button', { name: /Xem & Sửa/ }).click();
  const packBtn = w.getByRole('button', { name: 'Đã đóng gói', exact: true });
  await packBtn.waitFor({ timeout: 15_000 });
  const putResp = w.waitForResponse((r) => /\/api\/admin\/orders\/[^/]+\/status$/.test(new URL(r.url()).pathname) && r.request().method() === 'PUT', { timeout: 20_000 });
  await packBtn.click();
  const put = await putResp;
  check('web admin: PUT /admin/orders/:id/status → PACKED', put.status() < 300, { status: put.status() });
  await w.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await w.screenshot({ path: path.join(SHOTS, 'demo-3-admin.png') });
  check('web admin: không request nào ra ngoài', web.blocked.length === 0, web.blocked);
  await web.close();
  web = null;
  order = await prisma.order.findUnique({ where: { code } });
  check('DB: đơn PACKED sau thao tác admin', order.status === 'PACKED', { status: order.status });

  // 4. Pancake giao
  const shipped = await sendOrderStatus(L, code, 'shipped');
  log('4', 'webhook shipped', { http: shipped.http, event: shipped.event?.status, order: shipped.order?.status });
  const delivered = await sendOrderStatus(L, code, 'delivered');
  log('4', 'webhook delivered', { http: delivered.http, event: delivered.event?.status, order: delivered.order?.status });
  order = await prisma.order.findUnique({ where: { code } });
  check('DB: đơn DELIVERED, deliveredEffectsAt đã ghi', order.status === 'DELIVERED' && order.deliveredEffectsAt, {
    status: order.status,
    deliveredEffectsAt: order.deliveredEffectsAt,
  });

  // 5. Job
  // resyncPending = thân của cron orders.delivered-effects-resync nhưng trả {scanned, repaired, failed} để in được.
  const job = JSON.parse(
    execFileSync('node', [path.join(HARNESS, 'run-job.mjs'), String(L.n), 'DeliveredEffectsResyncCron.resyncPending'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  );
  log('5', 'run-job DeliveredEffectsResyncCron.resyncPending', job);
  check('job: không có đơn nào phải cộng điểm lại (webhook đã xong việc sau giao)', job.result && job.result.repaired === 0 && job.result.failed === 0, job.result);

  // 6. Đối chiếu
  const rows = await prisma.$queryRawUnsafe(
    `SELECT delta::int AS delta, reason, lot, "refId" FROM points_transactions WHERE "userId" = $1 AND reason = $2`,
    user.id,
    `ORDER_DELIVERED:${code}`,
  );
  const after = await ledger(user.id);
  log('6', 'sổ điểm sau', { after, rows });
  check('SQL: đúng 1 dòng ORDER_DELIVERED:<mã> trỏ tới đơn', rows.length === 1 && rows[0].refId === order.id, rows);
  check('SQL: điểm dòng sổ = điểm báo giá hứa (quote.pointsEarned)', rows[0]?.delta === quote.pointsEarned, { ledger: rows[0]?.delta, quote: quote.pointsEarned });
  check('SQL: users.pointsBalance = trước + điểm đơn', after.balance === before.balance + (rows[0]?.delta ?? NaN), { before: before.balance, after: after.balance });
  check('SQL: users.pointsBalance = SUM(delta) sổ STANDARD', after.balance === after.ledgerSum, after);
  const loyalty = await api(L, 'GET', '/me/loyalty', { user: user.id });
  log('6', 'GET /me/loyalty (khách thấy)', { status: loyalty.status, body: loyalty.body && Object.fromEntries(Object.entries(loyalty.body).filter(([, v]) => typeof v !== 'object')) });
} catch (e) {
  check('ca ví dụ chạy hết', false, e instanceof Error ? e.message : String(e));
  const pg = mini?.page ?? web?.page;
  if (pg) await pg.screenshot({ path: path.join(SHOTS, 'demo-error.png') }).catch(() => undefined);
} finally {
  await mini?.close().catch(() => undefined);
  await web?.close().catch(() => undefined);
  await closePrisma();
}
const failed = checks.filter((c) => !c.ok);
console.log(failed.length === 0 ? `PASS (${checks.length} kiểm tra)` : `FAIL (${failed.length}/${checks.length} kiểm tra hỏng: ${failed.map((c) => c.name).join('; ')})`);
process.exit(failed.length === 0 ? 0 : 1);
