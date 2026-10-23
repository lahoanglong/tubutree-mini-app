// Thư viện chung cho ca test U1 (mua hàng: khách mới quét thẻ hộp hàng sàn, khách quay lại) trên lane UAT.
// Mọi thao tác UI đi qua Mini App thật (miniapp-session của uat-harness), mọi đối chiếu tiền/điểm đọc thẳng DB lane.
// Dùng: import { ... } from './u1-lib.mjs'. Biến môi trường U1_LANE (mặc định 1), U1_BROWSER (chromium|webkit).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS = path.resolve(HERE, '../../../tools/uat-harness');
export const SHOTS = path.resolve(HERE, '../../shots/U1-mua-hang');
export const RESULTS = path.join(HERE, 'results');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RESULTS, { recursive: true });

const H = await import(path.join(HARNESS, 'lib.mjs'));
const MS = await import(path.join(HARNESS, 'miniapp-session.mjs'));
const PW = await import(path.join(HARNESS, 'pancake-webhook.mjs'));
export const { api, apiOk, prismaFor, closePrisma, findUser, sleep, laneEnv, realLogin } = H;
export const { open } = MS;
export const { sendOrderStatus, postWebhook } = PW;

export const LANE_N = Number(process.env.U1_LANE ?? 1);
export const L = H.lane(LANE_N);
export const BROWSER = process.env.U1_BROWSER ?? 'chromium';
export const prisma = () => prismaFor(L);

const t0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));

/** SQL thô trên DB lane (đã chặn DB khác trong lib.prismaFor). BigInt → Number để in. */
export async function sql(q, ...params) {
  const rows = await prisma().$queryRawUnsafe(q, ...params);
  return JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}

/** Chạy job/method Nest trên lane (run-job.mjs), trả JSON kết quả. */
export function runJob(target, args) {
  const argv = [path.join(HARNESS, 'run-job.mjs'), String(L.n), target, ...(args ? ['--args', JSON.stringify(args)] : [])];
  const out = execFileSync('node', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
  return JSON.parse(out);
}

/** Giả khoản chuyển khoản (bank-webhook.mjs của bộ khung): trả JSON in ra. */
export function bankTransfer(code, amount, content) {
  const argv = [path.join(HARNESS, 'bank-webhook.mjs'), String(L.n), code, String(amount), ...(content ? [content] : [])];
  const out = execFileSync('node', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
  return JSON.parse(out);
}

/**
 * Khách mới "vừa đăng nhập Zalo lần đầu": chèn dòng users như AuthService tạo (bộ khung không giả được Zalo phía server, xem
 * README giới hạn 1). Mỗi lần chạy một id/SĐT mới để chạy lại không đụng dữ liệu cũ. `welcome: true` gọi đúng đường cấp voucher
 * chào mừng lúc tạo tài khoản (VouchersService.grantWelcomeNow, becameRealNow) như auth.service.ts:207.
 */
export async function freshCustomer(tag, { phone = true, name, welcome = false, tierId = null } = {}) {
  const stamp = Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 36 ** 2).toString(36).padStart(2, '0');
  const id = `u1_${tag}_${stamp}`;
  let ph = null;
  if (phone) {
    for (;;) {
      ph = `093${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
      if (!(await prisma().user.findUnique({ where: { phone: ph } }))) break;
    }
  }
  const u = await prisma().user.create({
    data: {
      id,
      zaloId: `uat-zalo-${id.replace(/_/g, '-')}`,
      fullName: name ?? `Khách U1 ${tag}`,
      phone: ph,
      phoneVerifiedAt: ph ? new Date() : null,
      referralCode: `U1${stamp.toUpperCase()}`.slice(0, 16),
      role: 'CUSTOMER',
      tierId,
    },
  });
  if (welcome) u.welcome = runJob('VouchersService.grantWelcomeNow', [id, { becameRealNow: true }]);
  return u;
}

export const HCM_ADDRESS = {
  recipient: 'Khách UAT U1',
  province: 'Thành phố Hồ Chí Minh',
  district: '',
  ward: 'Phường Bến Thành',
  street: '25 Lê Lợi',
  provinceCode: '84_VN79',
  districtCode: '',
  wardCode: '84_VN7926743',
  isDefault: true,
};

export async function addAddress(user, extra = {}) {
  return apiOk(L, 'POST', '/me/addresses', { user: user.id ?? user, body: { ...HCM_ADDRESS, phone: user.phone ?? '0939000000', ...extra } });
}

export async function clearCart(userId) {
  const cart = await api(L, 'GET', '/cart', { user: userId });
  for (const it of cart.body?.items ?? []) await api(L, 'DELETE', `/cart/items/${it.id}`, { user: userId });
  if (cart.body?.couponCode) await api(L, 'DELETE', '/cart/coupon', { user: userId });
}

export async function variation(sku) {
  return prisma().variation.findUnique({ where: { sku }, include: { product: { select: { slug: true, name: true } } } });
}

export async function addToCart(userId, sku, quantity = 1) {
  const v = await variation(sku);
  return apiOk(L, 'POST', '/cart/items', { user: userId, body: { variationId: v.id, quantity } });
}

/** Đơn + dòng + lượt mã + sổ điểm của đơn, để dán làm bằng chứng. */
export async function orderEvidence(code) {
  const [o] = await sql(
    `SELECT o.id, o.code, o."userId", o.status, o."paymentMethod", o."paymentStatus", o.subtotal, o.discount, o."couponDiscount", o."comboDiscount",
            o."tierDiscount", o."pointsDiscount", o."shippingFee", o.total, o."pointsEarned", o."pointsUsed", o."couponCode", o."pancakeOrderId",
            o."paidAt", o."pancakeAttention", o."pancakePaidReported", o."createdAt"
       FROM orders o WHERE o.code = $1`,
    code,
  );
  if (!o) return null;
  const items = await sql(
    `SELECT v.sku, i.quantity, i."unitPrice", i.total, i."paidTotal", i."pointsDiscount", i."flashSaleItemId" IS NOT NULL AS flash
       FROM order_items i JOIN variations v ON v.id = i."variationId" WHERE i."orderId" = $1 ORDER BY v.sku`,
    o.id,
  );
  const redemptions = await sql(
    `SELECT c.code, c."usedCount", c."usageLimit" FROM coupon_redemptions r JOIN coupons c ON c.id = r."couponId" WHERE r."orderId" = $1`,
    o.id,
  );
  const ledger = await sql(
    `SELECT delta, reason, lot FROM points_transactions WHERE "refId" = $1 OR reason LIKE $2 ORDER BY "createdAt"`,
    o.id,
    `%:${code}`,
  );
  return { ...o, items, redemptions, ledger };
}

/** Số dư điểm và tổng sổ STANDARD/CONVERTED của khách. */
export async function pointsState(userId) {
  const [r] = await sql(
    `SELECT u."pointsBalance" AS balance, u."pointsConvertedBalance" AS converted,
            COALESCE((SELECT SUM(delta) FROM points_transactions p WHERE p."userId" = u.id AND p.lot = 'STANDARD'), 0)::int AS "ledgerStd",
            COALESCE((SELECT SUM(delta) FROM points_transactions p WHERE p."userId" = u.id AND p.lot = 'CONVERTED'), 0)::int AS "ledgerConv",
            (SELECT COUNT(*) FROM points_transactions p WHERE p."userId" = u.id)::int AS rows
       FROM users u WHERE u.id = $1`,
    userId,
  );
  return r;
}

export async function stockOf(sku) {
  const [r] = await sql(`SELECT stock, "reservedStock" FROM variations WHERE sku = $1`, sku);
  return r;
}

export async function couponState(code) {
  const [c] = await sql(
    `SELECT c.code, c."usedCount", c."usageLimit", c."perUserLimit", c."endAt", c."isActive",
            (SELECT COUNT(*) FROM coupon_redemptions r WHERE r."couponId" = c.id)::int AS redemptions,
            (SELECT COUNT(*) FROM coupon_claims k WHERE k."couponId" = c.id)::int AS claims
       FROM coupons c WHERE c.code = $1`,
    code,
  );
  return c;
}

/** Một mã thẻ HOPSAN chưa ai nhận, chưa ai dùng, còn hạn (lô 30 mã trong DB mẫu). */
export async function unusedCardCode(skip = []) {
  const rows = await sql(
    `SELECT c.code FROM coupons c WHERE c.code LIKE 'HOPSAN-%' AND c."endAt" > now() AND c."isActive"
       AND NOT EXISTS (SELECT 1 FROM coupon_claims k WHERE k."couponId" = c.id)
       AND NOT EXISTS (SELECT 1 FROM coupon_redemptions r WHERE r."couponId" = c.id)
     ORDER BY c.code`,
  );
  const code = rows.map((r) => r.code).find((c) => !skip.includes(c));
  if (!code) throw new Error('Hết mã HOPSAN chưa dùng trong lane — lane-up.sh --fresh');
  return code;
}

export const shot = async (page, name) => {
  const p = path.join(SHOTS, `${name}${BROWSER === 'webkit' ? '-webkit' : ''}.png`);
  await page.screenshot({ path: p });
  return path.relative(path.resolve(HERE, '../..'), p);
};

/** Bỏ hộp thoại onboarding "Chào mừng đến Tubu Tree" của khách mới nếu có. */
export async function dismissOnboarding(page) {
  const later = page.getByRole('dialog', { name: /Chào mừng đến Tubu Tree/ }).getByRole('button', { name: 'Để sau' });
  if (await later.isVisible().catch(() => false)) {
    await later.click();
    await page.waitForTimeout(300);
  }
}

/** Chữ snackbar zmp-ui đang hiện (đợi tối đa ms). */
export async function snackbarText(page, ms = 6000) {
  const sb = page.locator('.zaui-snackbar').filter({ hasText: /\S/ }).last();
  try {
    await sb.waitFor({ state: 'visible', timeout: ms });
    return (await sb.innerText()).trim();
  } catch {
    return null;
  }
}

/** Chờ response API khớp đường dẫn + method. */
export function waitApi(page, method, re, timeout = 20_000) {
  const w = page.waitForResponse((r) => r.request().method() === method && re.test(new URL(r.url()).pathname), { timeout });
  // Bước trước lỗi thì promise này không bao giờ được await: không để nó thành unhandled rejection làm sập cả bộ ca.
  w.catch(() => undefined);
  return w;
}

/**
 * Khung một bộ ca: mỗi ca có id, role, journey, steps, expected; thân ca gọi c.check(...) và c.evidence(...).
 * Lỗi ném ra giữa ca → FAIL (hoặc BLOCKED nếu ném BlockedError). Kết quả ghi results/<id>.json cho render-report.mjs.
 */
export class BlockedError extends Error {}
/** Ca chạy trên WebKit ghi kết quả riêng (<id>-WK) để không đè kết quả Chromium. */
const rid = (id) => (BROWSER === 'webkit' ? `${id}-WK` : id);
export class HarnessError extends Error {}

export async function runCases(cases, filter = process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const summary = [];
  for (const def of cases) {
    if (filter.length && !filter.some((f) => def.id.includes(f))) continue;
    const checks = [];
    const evidence = [];
    const notes = [];
    const c = {
      check(name, ok, detail) {
        checks.push({ name, ok: Boolean(ok), detail });
        log(ok ? 'OK  ' : 'FAIL', `${def.id} ${name}`, detail ?? '');
        return Boolean(ok);
      },
      evidence(label, data) {
        evidence.push({ label, data });
        log('EVID', `${def.id} ${label}`, data);
      },
      note(t) {
        notes.push(t);
        log('NOTE', `${def.id} ${t}`);
      },
    };
    let status = 'PASS';
    let error = null;
    log('=====', def.id, def.title ?? def.journey);
    try {
      await def.run(c);
      if (checks.some((x) => !x.ok)) status = 'FAIL';
      if (def.expectFail && status === 'PASS') notes.push('ca được đánh dấu expectFail nhưng đã PASS — lỗi có thể đã sửa');
    } catch (e) {
      error = e instanceof Error ? `${e.message}` : String(e);
      status = e instanceof BlockedError ? 'BLOCKED' : 'FAIL';
      if (e instanceof HarnessError) status = 'HARNESS';
      log(status, def.id, error);
    }
    const out = {
      id: rid(def.id),
      browser: BROWSER,
      role: def.role,
      journey: def.journey,
      steps: def.steps,
      expected: def.expected,
      status,
      error,
      checks,
      evidence,
      notes,
      ranAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(RESULTS, `${rid(def.id)}.json`), `${JSON.stringify(out, null, 2)}\n`);
    summary.push({ id: rid(def.id), status, failed: checks.filter((x) => !x.ok).map((x) => x.name), error });
    log('=====', def.id, status);
  }
  await closePrisma();
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}


// ───────────────────────── Thao tác UI dùng chung (Mini App thật) ─────────────────────────

/** Mở sheet "Chọn mã giảm giá" ở giỏ ("Chọn mã"/"Thay đổi") hoặc ở thanh toán ("Xem mã"/"Thay đổi"). */
export async function openVoucherSheet(page) {
  const trigger = page.getByText(/^(Chọn mã|Thay đổi|Xem mã)$/).first();
  await trigger.click();
  await page.getByRole('heading', { name: 'Chọn mã giảm giá' }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);
}

/**
 * Áp mã trên UI: gõ vào "Nhập mã giảm giá khác" + "Áp dụng" (mã in trên thẻ, mã công khai), hoặc `fromList` = chữ hiện trên thẻ
 * mã trong ví ("Quà chào mừng thành viên mới", "WELCOME30"…) rồi bấm "Dùng mã" của thẻ đó. Trả HTTP + body POST /cart/coupon và
 * chữ snackbar khách thấy.
 */
export async function applyVoucherUI(page, code, { fromList = null } = {}) {
  await openVoucherSheet(page);
  const sheetNote = (await page.getByText('Mỗi đơn hàng chỉ áp dụng 1 mã giảm giá').count()) > 0;
  // Snackbar của lần áp trước có thể còn trên màn: chờ nó tắt để không đọc nhầm.
  await page.locator('.zaui-snackbar').filter({ hasText: /\S/ }).first().waitFor({ state: 'hidden', timeout: 6000 }).catch(() => undefined);
  const resp = waitApi(page, 'POST', /\/api\/cart\/coupon$/);
  if (fromList) {
    const card = page.locator('div').filter({ hasText: fromList }).filter({ has: page.getByRole('button', { name: 'Dùng mã' }) }).last();
    await card.getByRole('button', { name: 'Dùng mã' }).click();
  } else {
    await page.getByRole('textbox', { name: 'Nhập mã giảm giá khác' }).fill(code);
    await page.getByRole('button', { name: 'Áp dụng', exact: true }).click();
  }
  const r = await resp;
  let body = null;
  try {
    body = await r.json();
  } catch { /* rỗng */ }
  const message = r.status() >= 400 ? body?.message ?? null : null;
  // Chữ khách thấy: snackbar mới (chứa đúng lời API khi lỗi, hoặc "Đã áp dụng"/lời báo giữ mã khi thành công).
  const want = message ?? /Đã áp dụng mã|không giảm|chưa/;
  let snack = null;
  try {
    const sb = page.locator('.zaui-snackbar').filter({ hasText: want }).last();
    await sb.waitFor({ state: 'visible', timeout: 6000 });
    snack = (await sb.innerText()).replace(/^zi_\w+\s*/, '').trim();
  } catch {
    snack = await snackbarText(page, 1000);
  }
  // Lỗi thì sheet còn mở: đóng để bước sau thao tác được.
  const close = page.getByRole('button', { name: 'Đóng' }).last();
  if (r.status() >= 400 && (await close.isVisible().catch(() => false))) await close.click().catch(() => undefined);
  await page.waitForTimeout(400);
  return { status: r.status(), body, snack, message, sheetNote };
}

/** Ghi lại mọi báo giá POST /checkout/quote (request + response) của trang. */
export function quoteFeed(page) {
  const seen = [];
  page.on('response', async (r) => {
    if (r.request().method() !== 'POST' || !r.url().endsWith('/api/checkout/quote')) return;
    try {
      seen.push({ status: r.status(), req: JSON.parse(r.request().postData() ?? '{}'), body: await r.json() });
    } catch { /* bỏ */ }
  });
  return seen;
}

/** Chờ báo giá đứng yên (không có báo giá mới trong `quietMs`) rồi trả báo giá cuối. */
export async function settledQuote(page, feed, { quietMs = 1200, timeout = 20_000 } = {}) {
  const start = Date.now();
  let n = -1;
  let since = Date.now();
  while (Date.now() - start < timeout) {
    if (feed.length !== n) {
      n = feed.length;
      since = Date.now();
    } else if (n > 0 && Date.now() - since >= quietMs) break;
    await page.waitForTimeout(200);
  }
  return feed[feed.length - 1] ?? null;
}

/** Từ giỏ bấm "Thanh toán (n)" → /checkout. */
export async function cartToCheckout(page) {
  const pay = page.getByRole('button', { name: /^Thanh toán \(\d+\)$/ });
  await pay.waitFor({ timeout: 15_000 });
  await pay.click();
  await page.waitForURL(/\/checkout$/, { timeout: 15_000 });
}

/** Form "Thêm địa chỉ mới" ở thanh toán: chọn tỉnh/phường từ danh mục địa giới (giả Pancake), gõ số nhà, Lưu. */
export async function addAddressUI(page, { province = 'Thành phố Hồ Chí Minh', ward = 'Phường Bến Thành', street = '25 Lê Lợi' } = {}) {
  await page.getByRole('button', { name: 'Thêm địa chỉ mới' }).click();
  await page.getByRole('button', { name: /^Tỉnh\/Thành phố:/ }).click();
  await page.getByText(province, { exact: true }).last().click();
  await page.getByRole('button', { name: /^Phường\/Xã:/ }).click();
  await page.getByText(ward, { exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Số nhà, tên đường' }).fill(street);
  const saved = waitApi(page, 'POST', /\/api\/me\/addresses$/);
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  const r = await saved;
  return { status: r.status(), body: await r.json().catch(() => null) };
}

export const PAY = { COD: /Thanh toán khi nhận hàng/, BANK_TRANSFER: /Chuyển khoản ngân hàng/ };

/** Chọn cách trả tiền, bấm "Đặt hàng · <tổng>", trả {status, body, buttonText}. */
export async function placeOrderUI(page, method = 'COD') {
  const radio = page.getByRole('radio', { name: PAY[method] });
  if (!(await radio.isChecked())) await radio.click();
  const place = page.getByRole('button', { name: /^Đặt hàng · / });
  await place.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  const buttonText = (await place.innerText()).replace(/\s+/g, ' ').trim();
  const resp = waitApi(page, 'POST', /\/api\/checkout\/place-order$/, 30_000);
  await place.click();
  const r = await resp;
  const body = await r.json().catch(() => null);
  return { status: r.status(), body, buttonText, code: body?.code ?? body?.orders?.[0]?.code ?? body?.order?.code ?? null };
}

/** Đơn COD nhanh qua API thật (giỏ → báo giá → đặt), để tạo lịch sử đơn cho khách (không phải bước đang kiểm). */
export async function quickOrderApi(userId, sku, qty = 1, { paymentMethod = 'COD', addressId } = {}) {
  await clearCart(userId);
  await addToCart(userId, sku, qty);
  const addr = addressId ?? (await apiOk(L, 'GET', '/me/addresses', { user: userId }))[0]?.id;
  const q = await apiOk(L, 'POST', '/checkout/quote', { user: userId, body: { addressId: addr } });
  const o = await apiOk(L, 'POST', '/checkout/place-order', {
    user: userId,
    body: { addressId: addr, paymentMethod, expectedTotal: q.total },
    headers: { 'idempotency-key': `u1-${userId}-${Date.now()}` },
  });
  return { quote: q, order: o, code: o.code ?? o.orders?.[0]?.code };
}

/** Giao xong một đơn app qua webhook Pancake (shipped → delivered). */
export async function deliver(code) {
  await sendOrderStatus(L, code, 'shipped');
  return sendOrderStatus(L, code, 'delivered');
}

/** Giả Pancake: đơn app theo mã Tubu. */
export async function fakePancakeOrder(code) {
  const r = await fetch(`${L.pancakeUrl}/__uat/find?code=${encodeURIComponent(code)}`);
  const j = await r.json().catch(() => null);
  return j?.kind === 'app' ? j.order : null;
}

/** Chờ đơn có pancakeOrderId (API tự đẩy lúc đặt qua hàng đợi). */
export async function waitPancakePush(code, ms = 20_000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const [o] = await sql(`SELECT "pancakeOrderId" FROM orders WHERE code = $1`, code);
    if (o?.pancakeOrderId) return o.pancakeOrderId;
    await sleep(500);
  }
  return null;
}
