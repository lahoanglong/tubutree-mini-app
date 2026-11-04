// U3: hành trình mua hàng QUA GIAO DIỆN THẬT (bấm tay bằng Playwright) trên Mini 375 và web 375 (và web 1280 cho J1), đối chiếu SQL.
//   J1 giỏ: thêm từ PDP, tăng/giảm, xoá, bỏ chọn một dòng (mua một phần), vào thanh toán, đặt COD
//   J2 chuyển khoản: đặt đơn CK, màn QR, webhook ngân hàng đủ tiền, màn chuyển sang đã thanh toán
//   J3 mã giảm giá và điểm: nhập mã sai, mã hợp lệ, gỡ mã, bật/tắt điểm
//   J4 đơn: danh sách, chi tiết, huỷ đơn chờ thanh toán, mua lại
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/U3-journeys.mjs <mini375|web375|web1280> [J1|J2|J3|J4]
import { execFileSync } from 'node:child_process';
import { H, UAT, L, openSurface, shot, sql, sqlExec, api, rec, closePrisma, toneViolations } from './lib.mjs';
import { V, fresh, fillCart, clearCart, reconcileOrder, place } from './kit.mjs';

const surf = process.argv[2] ?? 'mini375';
const only = process.argv[3];
const run = (j) => !only || only === j;
const FILE = 'U3';
const RUN = process.env.U3_RUN ?? 'b';
const tag = `${{ mini375: 'jm', web375: 'jw', web1280: 'jd' }[surf]}${RUN}`;
const isMini = surf === 'mini375';
const P = (mini, web) => (isMini ? mini : web);
const NODE = process.execPath;
const hook = (script, args) => {
  try {
    return JSON.parse(execFileSync(NODE, [`${H}/${script}`, '1', ...args], { cwd: UAT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    return { error: String(e.stdout || '') + String(e.stderr || '') };
  }
};

const cartApi = async (w) => (await api(L, 'GET', '/cart', { token: w.token })).body;
const posOf = async (w, vid) => (await cartApi(w)).items.findIndex((i) => i.variationId === vid);
const ctl = (page, prefix, i) => page.locator(`[aria-label^="${prefix}"]:visible`).nth(i);
const lineQty = async (w, vid) => (await cartApi(w)).items?.find((i) => i.variationId === vid)?.quantity ?? 0;
const txt = (page) => page.evaluate(() => document.body.innerText);
const wait = (page, ms) => page.waitForTimeout(ms);
async function until(fn, ms = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return true;
    } catch {
      /* thử lại */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
const nOf = (s) => Number(String(s).replace(/[^\d]/g, ''));
const sumLine = (t, label) => {
  const m = t.match(new RegExp(`${label}\\s*\\n?\\s*(-?[\\d.]+)đ`));
  return m ? nOf(m[1]) * (m[1].startsWith('-') ? -1 : 1) : null;
};

const idp = (n) => `U3-${surf}-${n}`;
const R = (n, journey, step, expected, actual, ok, evidence) =>
  rec(FILE, { id: idp(n), persona: tag, surface: surf, journey, step, expected, actual, evidence, status: ok ? 'PASS' : 'FAIL' });

// ---------------------------------------------------------------- J1
async function J1() {
  const w = await fresh(tag);
  await clearCart(w);
  await sqlExec(`delete from addresses where "userId" = '${w.userId}' and id <> '${w.addressId}'`);
  const s = await openSurface(surf, tag, P('/product/nuoc-rua-chen-fuwa3e', '/san-pham/nuoc-rua-chen-fuwa3e'));
  const page = s.page;
  try {
    await wait(page, 3500);
    // 1. thêm từ PDP
    await page.getByRole('button', { name: /^Thêm vào giỏ/ }).first().click({ timeout: 8000 });
    await wait(page, 1200);
    // Bấm "Thêm vào giỏ" ở PDP mở bảng "Chọn phân loại" (cả hai nền); nút xác nhận trong bảng ghi kèm giá: "Thêm vào giỏ · 120.000đ".
    const sheetBtn = page.getByRole('button', { name: /^Thêm vào giỏ\s*·/ });
    if (await page.getByText('Chọn phân loại').first().isVisible().catch(() => false)) await sheetBtn.first().click({ timeout: 8000 });
    const added = await until(async () => (await lineQty(w, V.DISH1L)) === 1);
    await wait(page, 800);
    await shot(page, `U3-${surf}-J1-01-pdp-them-gio`);
    R('J1-01', 'giỏ', 'PDP nước rửa chén (biến thể 1L mặc định) bấm "Thêm vào giỏ"', 'giỏ có 1 dòng 1L SL 1 (API /cart)', `SL dòng 1L = ${await lineQty(w, V.DISH1L)}`, added);

    // dựng thêm các dòng bằng API để thao tác tiếp trên màn giỏ
    await fillCart(w, [[V.DISH1L, 1], [V.LAUNDRY, 2], [V.HANDWASH, 1], [V.SERUM30, 1]]);
    await page.goto(page.url().replace(/\/(product|san-pham)\/.*$/, P('/cart', '/gio-hang')));
    await wait(page, 3500);
    let t = await txt(page);
    await shot(page, `U3-${surf}-J1-02-gio`);
    const sub0 = 120000 + 2 * 210000 + 89000 + 289000;
    R('J1-02', 'giỏ', 'mở giỏ 4 dòng (SL 1+2+1+1)', `Thanh toán (5), Tạm tính ${sub0.toLocaleString('vi-VN')}đ`, `${/Thanh toán \((\d+)\)/.exec(t)?.[0]}; tạm tính ${sumLine(t, 'Tạm tính')}`, /Thanh toán \(5\)/.test(t) && sumLine(t, 'Tạm tính') === sub0);

    // 2. tăng SL dòng đầu
    await ctl(page, 'Tăng số lượng', await posOf(w, V.LAUNDRY)).click({ timeout: 8000 });
    const up = await until(async () => (await lineQty(w, V.LAUNDRY)) === 3);
    await wait(page, 1200);
    t = await txt(page);
    await shot(page, `U3-${surf}-J1-03-tang`);
    R('J1-03', 'giỏ', 'tăng SL nước giặt 2 → 3', `API SL 3; Tạm tính ${(sub0 + 210000).toLocaleString('vi-VN')}đ trên màn`, `SL=${await lineQty(w, V.LAUNDRY)}; tạm tính ${sumLine(t, 'Tạm tính')}`, up && sumLine(t, 'Tạm tính') === sub0 + 210000);

    // 3. giảm
    await ctl(page, 'Giảm số lượng', await posOf(w, V.LAUNDRY)).click({ timeout: 8000 });
    const down = await until(async () => (await lineQty(w, V.LAUNDRY)) === 2);
    await wait(page, 1200);
    R('J1-04', 'giỏ', 'giảm SL nước giặt 3 → 2', 'API SL 2', `SL=${await lineQty(w, V.LAUNDRY)}`, down);

    // 4. xoá dòng nước rửa tay (dòng thứ 3 theo thứ tự thêm: DISH1L, LAUNDRY, HANDWASH, SERUM30)
    const before = (await cartApi(w)).items.map((i) => i.variationId);
    const idx = before.indexOf(V.HANDWASH);
    await ctl(page, 'Xoá', idx).click({ timeout: 8000 });
    await wait(page, 600);
    const confirm = page.getByRole('button', { name: /^(Xoá|Vẫn bỏ|Đồng ý)$/ });
    if (await confirm.first().isVisible().catch(() => false)) await confirm.first().click().catch(() => undefined);
    const gone = await until(async () => (await lineQty(w, V.HANDWASH)) === 0);
    await wait(page, 1000);
    await shot(page, `U3-${surf}-J1-04-xoa`);
    R('J1-05', 'giỏ', `xoá dòng nước rửa tay (vị trí ${idx + 1}/${before.length})`, 'dòng biến mất khỏi giỏ; các dòng khác còn nguyên', `SL rửa tay=${await lineQty(w, V.HANDWASH)}; còn ${(await cartApi(w)).items.length} dòng`, gone && (await cartApi(w)).items.length === before.length - 1);

    // 5. bỏ chọn serum và dòng nước rửa chén 1L: mua một phần (chỉ nước giặt x2 = 420.000)
    const boxes = page.getByRole('checkbox', { name: /^Chọn (?!tất cả)/ });
    const items = (await cartApi(w)).items.map((i) => i.variationId);
    for (const vid of [V.DISH1L, V.SERUM30]) {
      const i = items.indexOf(vid);
      await boxes.nth(i).click({ force: true, timeout: 8000 });
      await wait(page, 500);
    }
    await wait(page, 1200);
    t = await txt(page);
    await shot(page, `U3-${surf}-J1-05-bo-chon`);
    R('J1-06', 'giỏ', 'bỏ chọn 2 dòng, chỉ mua nước giặt x2', 'Thanh toán (2), Tạm tính 420.000đ', `${/Thanh toán \((\d+)\)/.exec(t)?.[0]}; tạm tính ${sumLine(t, 'Tạm tính')}`, /Thanh toán \(2\)/.test(t) && sumLine(t, 'Tạm tính') === 420000);

    // 6. sang thanh toán
    await page.locator('button:visible, a:visible').filter({ hasText: /^Thanh toán \(2\)/ }).first().click({ timeout: 8000 });
    await until(async () => /thanh-toan|checkout/.test(page.url()), 8000);
    await wait(page, 4500);
    t = await txt(page);
    await shot(page, `U3-${surf}-J1-06-thanh-toan`);
    const lines = (t.match(/Nước giặt sinh học Fuwa3e/g) ?? []).length;
    const noSerum = !/Serum dưỡng ẩm Visante/.test(t) && !/Nước rửa chén sinh học Fuwa3e/.test(t);
    R('J1-07', 'thanh toán', 'màn thanh toán chỉ có dòng được chọn', 'chỉ nước giặt x2; không serum, không nước rửa chén', `nước giặt xuất hiện ${lines} lần; vắng các dòng còn lại=${noSerum}`, lines >= 1 && noSerum);
    const sub = sumLine(t, 'Tạm tính');
    const ship = /Phí vận chuyển\s*\n?\s*Miễn phí/.test(t) ? 0 : sumLine(t, 'Phí vận chuyển');
    const total = sumLine(t, 'Tổng cộng');
    const cta = nOf((await page.getByRole('button', { name: /^Đặt hàng/ }).first().innerText()).replace(/^.*·/, ''));
    const q = (await api(L, 'POST', '/checkout/quote', { token: w.token, body: { addressId: w.addressId, itemIds: items.filter((v) => v === V.LAUNDRY).length ? (await cartApi(w)).items.filter((i) => i.variationId === V.LAUNDRY).map((i) => i.id) : undefined } })).body;
    R('J1-08', 'thanh toán', 'số tiền trên màn = báo giá API cho đúng phần đã chọn', `Tạm tính 420.000đ; tổng = API quote ${q.total}; nút Đặt hàng = tổng`, `màn: tạm tính ${sub}, ship ${ship}, tổng ${total}, nút ${cta}`, sub === 420000 && total === q.total && cta === q.total, `quote=${JSON.stringify({ subtotal: q.subtotal, discount: q.discount, shippingFee: q.shippingFee, total: q.total })}`);

    // 7. chọn COD và đặt
    const cod = page.getByRole('radio', { name: /Thanh toán khi nhận hàng|COD/ }).first();
    if (await cod.isVisible().catch(() => false)) await cod.click({ force: true });
    await wait(page, 800);
    const stock0 = (await sql(`select stock::int s, "reservedStock"::int r from variations where id = '${V.LAUNDRY}'`))[0];
    await page.getByRole('button', { name: /^Đặt hàng/ }).first().click();
    const placed = await until(async () => (await sql(`select count(*)::int n from orders where "userId" = '${w.userId}'`))[0].n === 1, 15000);
    await wait(page, 3500);
    t = await txt(page);
    await shot(page, `U3-${surf}-J1-07-dat-xong`);
    const o = (await sql(`select code, status, "paymentMethod" pm, total::int total, subtotal::int sub from orders where "userId" = '${w.userId}' order by "createdAt" desc limit 1`))[0];
    R('J1-09', 'thanh toán', 'đặt COD', 'tạo 1 đơn CONFIRMED/COD, tổng = số tiền trên nút', `đơn ${o?.code} ${o?.status} ${o?.pm} tổng ${o?.total}`, placed && o?.pm === 'COD' && o?.total === cta, `URL sau đặt: ${page.url().replace(/^https?:\/\/[^/]+/, '')}`);
    if (o) {
      const rc = await reconcileOrder(o.code);
      const left = (await cartApi(w)).items.map((i) => i.variationId).sort();
      const stock1 = (await sql(`select stock::int s, "reservedStock"::int r from variations where id = '${V.LAUNDRY}'`))[0];
      R('J1-10', 'thanh toán', 'SQL sau đặt: số học đơn khớp; giỏ còn các dòng không mua; tồn kho giảm đúng', 'đơn khớp; giỏ còn DISH1L + SERUM30; reservedStock +2 (hoặc stock −2)', `đơn khớp=${rc.ok} ${rc.problems.join('; ')}; giỏ còn ${left.length} dòng [${left.join(',')}]; kho ${stock0.s}/${stock0.r} → ${stock1.s}/${stock1.r}`, rc.ok && left.length === 2 && left.includes(V.DISH1L) && left.includes(V.SERUM30) && (stock0.s - stock1.s === 2 || stock1.r - stock0.r === 2));
      const succ = /đặt hàng thành công|cảm ơn|Đơn hàng của bạn/i.test(t);
      R('J1-11', 'thanh toán', 'màn sau đặt hàng báo thành công và có mã đơn', 'có chữ xác nhận và mã đơn', `${succ ? 'có chữ xác nhận' : 'KHÔNG có chữ xác nhận'}; mã đơn trên màn=${t.includes(o.code)}`, succ && t.includes(o.code), t.slice(0, 300).replace(/\n/g, ' | '));
    }
  } finally {
    await s.close();
  }
}

// ---------------------------------------------------------------- J2
async function J2() {
  const w = await fresh(`${tag}2`);
  await clearCart(w);
  await fillCart(w, [[V.LAUNDRY, 1]]);
  const s = await openSurface(surf, `${tag}2`, P('/checkout', '/thanh-toan'));
  const page = s.page;
  try {
    await wait(page, 5000);
    const bank = page.getByRole('radio', { name: /^Chuyển khoản ngân hàng/ }).first();
    await bank.click({ force: true });
    await wait(page, 800);
    await shot(page, `U3-${surf}-J2-01-chon-ck`);
    const q = (await api(L, 'POST', '/checkout/quote', { token: w.token, body: { addressId: w.addressId } })).body;
    await page.getByRole('button', { name: /^Đặt hàng/ }).first().click();
    const placed = await until(async () => (await sql(`select count(*)::int n from orders where "userId" = '${w.userId}'`))[0].n === 1, 15000);
    await until(async () => /chuyen-khoan|bank-payment/.test(page.url()), 10000);
    await wait(page, 4000);
    const o = (await sql(`select code, status, "paymentStatus" ps, total::int total from orders where "userId" = '${w.userId}' order by "createdAt" desc limit 1`))[0];
    let t = await txt(page);
    await shot(page, `U3-${surf}-J2-02-man-qr`);
    R('J2-01', 'chuyển khoản', 'đặt đơn CK → sang màn QR', 'đơn PENDING_PAYMENT/UNPAID; màn QR có số tiền, nội dung CK = mã đơn', `đơn ${o?.code} ${o?.status}/${o?.ps}; URL ${page.url().replace(/^https?:\/\/[^/]+/, '')}; số tiền trên màn ${t.includes(o?.total.toLocaleString('vi-VN') + 'đ')}; mã đơn ${t.includes(o?.code)}`, placed && o?.status === 'PENDING_PAYMENT' && t.includes(o.code) && t.includes(o.total.toLocaleString('vi-VN')), `quote total ${q.total}`);
    // webhook đủ tiền
    const r = hook('bank-webhook.mjs', [o.code, String(o.total)]);
    const paid = await until(async () => (await sql(`select "paymentStatus" ps from orders where code='${o.code}'`))[0].ps === 'PAID', 25000);
    await page.reload();
    await wait(page, 4500);
    t = await txt(page);
    await shot(page, `U3-${surf}-J2-03-da-tra`);
    const o2 = (await sql(`select status, "paymentStatus" ps, "paidAt" from orders where code='${o.code}'`))[0];
    R('J2-02', 'chuyển khoản', 'webhook ngân hàng đúng số tiền → đơn đã thanh toán, màn đổi trạng thái', 'DB PAID; màn không còn mã QR chờ, có chữ đã thanh toán/đã nhận', `DB ${o2.status}/${o2.ps}; webhook=${JSON.stringify(r).slice(0, 100)}; màn: ${/đã thanh toán|Đã nhận|thành công/i.test(t)} / còn QR chờ: ${/Quét QR để chuyển khoản/.test(t)}`, paid && o2.ps === 'PAID' && !/Quét QR để chuyển khoản/.test(t), t.slice(0, 260).replace(/\n/g, ' | '));
  } finally {
    await s.close();
  }
}

// ---------------------------------------------------------------- J3
async function J3() {
  const w = await fresh(`${tag}3`);
  await clearCart(w);
  await fillCart(w, [[V.LAUNDRY, 1], [V.HANDWASH, 1]]);
  const s = await openSurface(surf, `${tag}3`, P('/checkout', '/thanh-toan'));
  const page = s.page;
  try {
    await wait(page, 5000);
    let t = await txt(page);
    await shot(page, `U3-${surf}-J3-01-thanh-toan-ma`);
    const applied = (await cartApi(w)).couponCode ?? (await cartApi(w)).coupon?.code ?? null;
    R('J3-01', 'mã giảm giá', 'khách mới vào thanh toán: tự áp mã tốt nhất', 'có mã được áp (nhãn "Tubu đã tự áp mã tốt nhất" ở Mini) và giảm đúng', `mã=${applied}; có nhãn tự áp=${/tự áp mã/.test(t)}; Giảm giá ${sumLine(t, 'Giảm giá')}`, !!applied && sumLine(t, 'Giảm giá') !== 0, t.slice(t.indexOf('Mã giảm giá'), t.indexOf('Mã giảm giá') + 160).replace(/\n/g, ' | '));
    // mở bộ chọn mã
    const change = page.getByRole('button', { name: /Thay đổi|Chọn mã|Nhập mã giảm giá/ }).first();
    await change.click({ timeout: 8000 }).catch(() => undefined);
    await wait(page, 1500);
    t = await txt(page);
    await shot(page, `U3-${surf}-J3-02-chon-ma`);
    R('J3-02', 'mã giảm giá', 'mở bộ chọn mã', 'liệt kê phiếu còn dùng được và phiếu chưa đủ điều kiện kèm lý do', `đã mở: ${/Nhập mã|Mã của bạn|Áp dụng/.test(t)}`, /Nhập mã|Mã của bạn|Áp dụng|Dùng ngay/.test(t), t.slice(0, 400).replace(/\n/g, ' | '));
    // nhập mã sai
    const input = page.getByPlaceholder('Nhập mã').last();
    if (await input.isVisible().catch(() => false)) {
      await input.fill('SAIMA123');
      await page.getByRole('button', { name: /^Áp dụng$/ }).first().click({ timeout: 6000 }).catch(() => undefined);
      await wait(page, 2000);
      t = await txt(page);
      await shot(page, `U3-${surf}-J3-03-ma-sai`);
      const msg = (t.match(/[^\n]*(không tồn tại|không hợp lệ|chưa đúng|không đúng|không tìm thấy)[^\n]*/i) ?? [])[0];
      R('J3-03', 'mã giảm giá', 'nhập mã không tồn tại "SAIMA123"', 'báo lỗi tiếng Việt, đúng giọng (không "Vui lòng")', `báo: ${msg ?? '(không thấy lời báo)'}`, !!msg && toneViolations(msg).length === 0);
    } else {
      R('J3-03', 'mã giảm giá', 'nhập mã không tồn tại', 'có ô nhập mã', 'không thấy ô nhập mã', false);
    }
  } finally {
    await s.close();
  }
}

// ---------------------------------------------------------------- J4
async function J4() {
  const w = await fresh(`${tag}4`);
  await clearCart(w);
  await fillCart(w, [[V.LAUNDRY, 1]]);
  const q = (await api(L, 'POST', '/checkout/quote', { token: w.token, body: { addressId: w.addressId } })).body;
  const p = await place(w, { paymentMethod: 'BANK_TRANSFER', expectedTotal: q.total });
  const code = p.body.code;
  if (!code) throw new Error(`đặt đơn CK qua API lỗi: ${p.status} ${JSON.stringify(p.body).slice(0, 200)}`);
  const s = await openSurface(surf, `${tag}4`, P(`/order/${code}`, `/tai-khoan/don-hang/${code}`));
  const page = s.page;
  try {
    await wait(page, 4500);
    let t = await txt(page);
    await shot(page, `U3-${surf}-J4-01-chi-tiet-cho`);
    R('J4-01', 'đơn', 'chi tiết đơn chờ thanh toán', 'có mã đơn, trạng thái Chờ thanh toán, nút Huỷ đơn', `mã ${t.includes(code)}; trạng thái ${/Chờ thanh toán/.test(t)}; nút huỷ ${/Huỷ đơn/.test(t)}`, t.includes(code) && /Chờ thanh toán/.test(t) && /Huỷ đơn/.test(t));
    await page.getByRole('button', { name: /^Huỷ đơn/ }).first().click({ timeout: 8000 }).catch(() => undefined);
    await wait(page, 1200);
    // Hộp huỷ bắt chọn lý do (chip ở Mini, nút chọn ở web) rồi mới bấm "Huỷ đơn" xác nhận.
    await page.getByText('Đổi ý, không muốn mua nữa').first().click({ timeout: 6000 }).catch(() => undefined);
    await wait(page, 500);
    await shot(page, `U3-${surf}-J4-02-hop-huy`);
    const yes = page.getByRole('button', { name: /^Huỷ đơn$/ });
    const n = await yes.count();
    if (n) await yes.nth(n - 1).click({ timeout: 6000 }).catch(() => undefined);
    const cancelled = await until(async () => (await sql(`select status from orders where code='${code}'`))[0].status === 'CANCELLED', 15000);
    await wait(page, 2500);
    t = await txt(page);
    await shot(page, `U3-${surf}-J4-03-da-huy`);
    const o = (await sql(`select status, "paymentStatus" ps from orders where code='${code}'`))[0];
    R('J4-02', 'đơn', 'huỷ đơn chờ thanh toán qua giao diện', 'DB CANCELLED; màn ghi Đã huỷ', `DB ${o.status}/${o.ps}; màn Đã huỷ=${/Đã huỷ/.test(t)}`, cancelled && /Đã huỷ/.test(t));
    // mua lại
    await clearCart(w);
    const re = page.getByRole('button', { name: /Mua lại/ }).first();
    await re.click({ timeout: 8000 }).catch(() => undefined);
    await wait(page, 1500);
    // "Mua lại đơn này" mở bảng "Mua lại" liệt kê dòng của đơn cũ; bấm "Thêm vào giỏ (n)" mới đưa vào giỏ.
    await page.getByRole('button', { name: /^Thêm vào giỏ \(\d+\)/ }).first().click({ timeout: 8000 }).catch(() => undefined);
    const back = await until(async () => (await lineQty(w, V.LAUNDRY)) === 1, 12000);
    await wait(page, 2500);
    await shot(page, `U3-${surf}-J4-04-mua-lai`);
    R('J4-03', 'đơn', 'bấm "Mua lại" trên đơn đã huỷ', 'giỏ có lại nước giặt SL 1; chuyển sang giỏ', `SL giỏ=${await lineQty(w, V.LAUNDRY)}; URL ${page.url().replace(/^https?:\/\/[^/]+/, '')}`, back);
  } finally {
    await s.close();
  }
}

for (const [k, f] of [['J1', J1], ['J2', J2], ['J3', J3], ['J4', J4]]) {
  if (!run(k)) continue;
  if (surf === 'web1280' && k !== 'J1') continue;
  try {
    await f();
  } catch (e) {
    rec(FILE, { id: idp(`${k}-ERR`), persona: tag, surface: surf, journey: k, step: 'script', expected: 'chạy hết', actual: String(e.message).slice(0, 300), status: 'BLOCKED' });
  }
}
await closePrisma();
