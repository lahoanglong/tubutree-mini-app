#!/usr/bin/env node
// U3-16..U3-23: gian hàng CTV /s/<slug>. Chờ duyệt lần đầu (storefront.require_approval) thì ẩn trên API, Mini App, web SSR;
// ADMIN duyệt trên web admin → hiện; khách mới đăng ký CTV + tạo/sửa/đăng gian hàng trên Mini App; khách mua trong gian hàng →
// hoa hồng; CTV bị hạ vai trò → gian hàng ẩn, hoa hồng đơn cũ vẫn giữ (tới APPROVED, rút được), mã của họ không ghi công đơn mới.
// Dùng: node 03-gian-hang.mjs
import {
  L, api, apiOk, closeDb, commissionsOf, deliver, ensureAddress, ensureUser, log, matureCommissions, openMini, openWeb, orderRow, placeOrderApi,
  recorder, short, shot, sleep, sql, variationBySku,
} from './u3lib.mjs';

const R = recorder('03-gian-hang');
const RUN = Date.now().toString(36).slice(-5);
const PENDING_SLUG = 'uatctvpending';
const pub = (slug) => api(L, 'GET', `/storefront/public/${slug}`, { bypass: true });
async function ssr(slug, needle) {
  const r = await fetch(`${L.webUrl}/s/${slug}`, { redirect: 'manual' });
  const html = await r.text();
  return { status: r.status, has: needle ? html.includes(needle) : null, len: html.length };
}
// /s/[slug] dùng fetch revalidate 300 (Next data cache, có cả ở next dev): bản đã render được phục vụ tiếp tới khi hết 300 giây,
// lượt đầu sau đó vẫn trả bản cũ và làm mới nền. Hỏi lại mỗi 15 giây, ghi số giây tới khi web trả wantStatus.
async function ssrUntil(slug, wantStatus, needle, maxMs = 420_000) {
  const t0 = Date.now();
  const first = await ssr(slug, needle);
  let last = first;
  while (last.status !== wantStatus && Date.now() - t0 < maxMs) {
    await sleep(15_000);
    last = await ssr(slug, needle);
  }
  return { ...last, first: { status: first.status, has: first.has }, waitedSec: Math.round((Date.now() - t0) / 1000) };
}
const sfRow = async (slug) =>
  (await sql(`SELECT s.id, s.slug, s.title, s."isPublished", s."approvedAt", s."takenDownAt", u.role::text AS "ownerRole" FROM storefronts s LEFT JOIN users u ON u.id = s."ownerUserId" WHERE s.slug = $1`, slug))[0];

let mini;
let web;
try {
  // Chạy lại được: đưa gian hàng chờ duyệt về "chưa duyệt" bằng chính nút "Bỏ duyệt" của admin (API).
  const pend0 = await sfRow(PENDING_SLUG);
  if (pend0.approvedAt) await apiOk(L, 'POST', `/admin/storefronts/${pend0.id}/approval`, { user: 'uat_admin', body: { approved: false } });
  await sleep(16_000); // Cache-Control CATALOG max-age 15s chỉ ở trình duyệt; API không cache phía máy chủ. Chờ cho chắc lượt trước hết hạn.

  // ---------- U3-16 gian hàng chờ duyệt bị ẩn ----------
  const api16 = await pub(PENDING_SLUG);
  const web16 = await ssrUntil(PENDING_SLUG, 404, 'Gian hàng UAT');
  mini = await openMini('returning', { path: `/s/${PENDING_SLUG}` });
  await mini.page.getByText('Gian hàng này không tồn tại hoặc đã ngừng hoạt động.').waitFor({ timeout: 20_000 }).catch(() => undefined);
  const miniText16 = await mini.page.evaluate(() => document.body.innerText);
  const s16a = await shot(mini.page, 'U3-16-mini-gian-hang-cho-duyet-an');
  await mini.close();
  mini = await openMini('ctv_pending', { path: '/storefront' });
  await mini.page.getByTestId('hidden-reason').waitFor({ timeout: 20_000 }).catch(() => undefined);
  const ownerReason = await mini.page.getByTestId('hidden-reason').innerText().catch(() => null);
  const s16b = await shot(mini.page, 'U3-16-chu-gian-hang-thay-ly-do');
  await mini.close();
  mini = null;
  R.add({
    id: 'U3-16', role: 'CTV / khách', journey: 'Gian hàng chờ duyệt lần đầu', title: 'Gian hàng đã đăng nhưng chưa duyệt không hiện với khách',
    steps: `GET /storefront/public/${PENDING_SLUG}; web SSR /s/${PENDING_SLUG}; Mini App khách mở /s/${PENDING_SLUG}; chủ mở /storefront`,
    expected: 'API 404; web 404 (lượt chạy lại: trong cửa sổ revalidate 300 giây); Mini App "Gian hàng này không tồn tại…"; chủ thấy "Gian hàng đang chờ Tubu Tree duyệt lần đầu…"',
    actual: { api: api16.status, web: web16, miniNotFound: miniText16.includes('không tồn tại'), ownerReason, db: await sfRow(PENDING_SLUG) },
    evidence: `${s16a}, ${s16b}; HTTP API ${api16.status}, web lượt đầu ${web16.first.status} rồi ${web16.status} sau ${web16.waitedSec}s; SQL storefronts ${short(pend0)}`,
    status: api16.status === 404 && web16.status === 404 && miniText16.includes('không tồn tại') && /chờ Tubu Tree duyệt/.test(ownerReason ?? '') ? 'PASS' : 'FAIL',
  });

  // ---------- U3-17 ADMIN duyệt trên web admin → hiện ----------
  web = await openWeb('admin', { width: 1440, path: '/admin?tab=storefronts' });
  const w = web.page;
  const art = w.locator('article').filter({ hasText: PENDING_SLUG }).first();
  await art.waitFor({ timeout: 90_000 });
  await art.getByRole('button', { name: 'Xem', exact: true }).click();
  const ok = w.waitForResponse((r) => /\/api\/admin\/storefronts\/[^/]+\/approval$/.test(new URL(r.url()).pathname), { timeout: 20_000 });
  await w.getByRole('button', { name: 'Duyệt gian hàng' }).click();
  const okr = await ok;
  await w.waitForTimeout(800);
  const s17a = await shot(w, 'U3-17-admin-duyet-gian-hang');
  await web.close();
  web = null;
  const api17 = await pub(PENDING_SLUG);
  const web17 = await ssr(PENDING_SLUG, api17.body?.title ?? 'Gian hàng');
  mini = await openMini('returning', { path: `/s/${PENDING_SLUG}` });
  await mini.page.waitForTimeout(1500);
  const miniText17 = await mini.page.evaluate(() => document.body.innerText);
  const s17b = await shot(mini.page, 'U3-17-mini-gian-hang-sau-duyet');
  await mini.close();
  mini = null;
  const db17 = await sfRow(PENDING_SLUG);
  R.add({
    id: 'U3-17', role: 'ADMIN', journey: 'Duyệt gian hàng lần đầu → hiện công khai', title: 'ADMIN bấm "Duyệt gian hàng" → hiện trên Mini App và web SSR',
    steps: 'web admin 1440 /admin?tab=storefronts → "Xem" gian hàng uatctvpending → "Duyệt gian hàng"; mở lại API/web/Mini App',
    expected: 'approval 2xx, approvedAt ghi; API 200; web SSR 200 có tên gian hàng; Mini App hiện tên gian hàng',
    actual: { approval: okr.status(), api: api17.status, title: api17.body?.title, web: web17, mini: miniText17.includes(api17.body?.title ?? '§'), db: db17 },
    evidence: `${s17a}, ${s17b}; HTTP approval ${okr.status()}, API ${api17.status}, web ${web17.status} có tên=${web17.has}; SQL approvedAt ${db17.approvedAt}`,
    status: okr.status() < 300 && db17.approvedAt && api17.status === 200 && web17.status === 200 && web17.has && miniText17.includes(api17.body?.title ?? '§') ? 'PASS' : 'FAIL',
  });

  // ---------- U3-18 khách đăng ký CTV + tạo gian hàng + đăng (Mini App) ----------
  const CTV2 = `uat_u3ctv${RUN}`;
  const ctv2Phone = `0907${String(Date.now()).slice(-6)}`;
  await ensureUser(CTV2, { phone: ctv2Phone, name: `CTV Mới ${RUN}` });
  mini = await openMini(CTV2, { path: '/affiliate' });
  let p = mini.page;
  await p.getByRole('button', { name: 'Đăng ký miễn phí ngay' }).waitFor({ timeout: 20_000 });
  await p.getByRole('checkbox').first().check({ force: true }).catch(async () => p.getByRole('checkbox').first().click({ force: true }));
  const regResp = p.waitForResponse((r) => r.url().endsWith('/api/affiliate/register'), { timeout: 15_000 });
  await p.getByRole('button', { name: 'Đăng ký miễn phí ngay' }).click();
  const reg = await regResp;
  await p.getByText('Mã giới thiệu của bạn').waitFor({ timeout: 20_000 });
  const role18 = (await sql(`SELECT role::text r, metadata->'affiliateTerms' t FROM users WHERE id = $1`, CTV2))[0];
  await mini.goto('/storefront');
  await p.getByRole('button', { name: 'Tạo gian hàng' }).click();
  await p.getByRole('button', { name: 'Bỏ qua, tự tạo gian hàng trống' }).click();
  // Gian hàng trống chưa có bộ sưu tập: phải tạo một bộ trước khi có nút "Thêm sản phẩm".
  await p.getByPlaceholder('Tên bộ sưu tập (khách sẽ thấy)').fill('Sản phẩm mình dùng');
  await p.getByRole('button', { name: 'Tạo bộ sưu tập' }).click();
  await p.getByRole('button', { name: 'Thêm sản phẩm' }).first().waitFor({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Thêm sản phẩm' }).first().click();
  const add = p.waitForResponse((r) => /\/api\/storefront\/me\/collections\/[^/]+\/items$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 20_000 });
  await p.getByRole('button', { name: 'Thêm', exact: true }).first().click();
  const addr = await add;
  await p.getByRole('button', { name: 'Xong' }).click();
  const pubResp = p.waitForResponse((r) => r.url().endsWith('/api/storefront/me/publish'), { timeout: 20_000 });
  await p.getByRole('button', { name: 'Lưu & Đăng' }).click();
  const pubr = await pubResp;
  await p.waitForTimeout(1200);
  const reason18 = await p.getByTestId('hidden-reason').innerText().catch(() => null);
  const s18 = await shot(p, 'U3-18-ctv-moi-dang-gian-hang');
  await mini.close();
  mini = null;
  const sf2 = (await sql(`SELECT id, slug, title, "isPublished", "approvedAt" FROM storefronts WHERE "ownerUserId" = $1`, CTV2))[0];
  const api18 = await pub(sf2.slug);
  R.add({
    id: 'U3-18', role: 'Khách → CTV', journey: 'Tạo gian hàng /s/<slug>, chờ duyệt lần đầu', title: 'Đăng ký CTV, tạo gian hàng trống, thêm 1 SP, "Lưu & Đăng"',
    steps: `Mini App ${CTV2} → /affiliate → tick điều khoản → "Đăng ký miễn phí ngay" → /storefront → "Tạo gian hàng" → "Bỏ qua…" → nhập tên bộ sưu tập → "Tạo bộ sưu tập" → "Thêm sản phẩm" → "Thêm" → "Xong" → "Lưu & Đăng"`,
    expected: 'role AFFILIATE + affiliateTerms; storefront isPublished=true, approvedAt null; API công khai 404; chủ thấy lý do "chờ Tubu Tree duyệt lần đầu"',
    actual: { reg: reg.status(), role18, addItem: addr.status(), publish: pubr.status(), sf2, api: api18.status, reason18 },
    evidence: `${s18}; SQL users.role=${role18?.r}; storefronts ${short(sf2)}; GET public ${api18.status}`,
    status: role18?.r === 'AFFILIATE' && role18?.t && sf2?.isPublished && !sf2.approvedAt && api18.status === 404 && /chờ Tubu Tree duyệt/.test(reason18 ?? '') ? 'PASS' : 'FAIL',
  });

  // ---------- U3-19 sửa gian hàng ----------
  const newTitle = `Gian hàng xanh ${RUN}`;
  mini = await openMini(CTV2, { path: '/storefront' });
  p = mini.page;
  await p.getByRole('button', { name: 'Cấu hình' }).click();
  const titleInput = p.getByLabel('Tên gian hàng', { exact: true });
  await titleInput.fill(newTitle);
  const save = p.waitForResponse((r) => r.url().endsWith('/api/storefront/me') && r.request().method() === 'PATCH', { timeout: 15_000 });
  await p.getByRole('button', { name: 'Lưu cấu hình gian hàng' }).click();
  const saver = await save;
  await p.waitForTimeout(800);
  const s19a = await shot(p, 'U3-19-ctv-sua-ten-gian-hang');
  await mini.close();
  mini = null;
  await apiOk(L, 'POST', `/admin/storefronts/${sf2.id}/approval`, { user: 'uat_admin', body: { approved: true } });
  const api19 = await pub(sf2.slug);
  const web19 = await ssr(sf2.slug, newTitle);
  mini = await openMini('returning', { path: `/s/${sf2.slug}` });
  await mini.page.getByText(newTitle).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  const mini19 = (await mini.page.evaluate(() => document.body.innerText)).includes(newTitle);
  const s19b = await shot(mini.page, 'U3-19-mini-gian-hang-ten-moi');
  await mini.close();
  mini = null;
  const db19 = await sfRow(sf2.slug);
  R.add({
    id: 'U3-19', role: 'CTV', journey: 'Sửa gian hàng, sau duyệt hiện trên Mini App + web', title: 'Đổi "Tên gian hàng", admin duyệt, khách thấy tên mới',
    steps: `/storefront → "Cấu hình" → Tên gian hàng = "${newTitle}" → "Lưu cấu hình gian hàng"; ADMIN POST /admin/storefronts/:id/approval; mở /s/${sf2.slug}`,
    expected: 'PATCH /storefront/me 2xx, storefronts.title đổi; API 200 title mới; web SSR 200 có tên mới; Mini App có tên mới',
    actual: { patch: saver.status(), db19, api: [api19.status, api19.body?.title], web: web19, mini19 },
    evidence: `${s19a}, ${s19b}; SQL title "${db19.title}"; API ${api19.status}; web ${web19.status} có tên=${web19.has}`,
    status: saver.status() < 300 && db19.title === newTitle && api19.status === 200 && api19.body?.title === newTitle && web19.status === 200 && web19.has && mini19 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-20 khách mua trong gian hàng ----------
  const BUY = `uat_u3sfb${RUN}`;
  const buyPhone = `0908${String(Date.now()).slice(-6)}`;
  await ensureUser(BUY, { phone: buyPhone });
  await ensureAddress(BUY, buyPhone);
  mini = await openMini(BUY, { path: `/s/${sf2.slug}` });
  p = mini.page;
  const prodName = api19.body?.collections?.[0]?.items?.[0]?.product?.name;
  await p.getByText(prodName).first().click();
  const buyNow = p.getByRole('button', { name: /^Mua ngay/ });
  await buyNow.waitFor({ timeout: 20_000 });
  await buyNow.click();
  await p.waitForURL(/\/checkout/, { timeout: 20_000 });
  const place = p.getByRole('button', { name: /^Đặt hàng · / });
  await place.waitFor({ timeout: 20_000 });
  const cod = p.getByRole('radio', { name: /Thanh toán khi nhận hàng/ });
  if (!(await cod.isChecked())) await cod.check({ force: true });
  const pr = p.waitForResponse((r) => r.url().endsWith('/api/checkout/place-order') && r.request().method() === 'POST', { timeout: 30_000 });
  await place.click();
  const prr = await pr;
  const pb = await prr.json();
  const code20 = pb.code ?? pb.order?.code ?? pb.orders?.[0]?.code;
  const s20 = await shot(p, 'U3-20-khach-mua-trong-gian-hang');
  await mini.close();
  mini = null;
  const o20 = await orderRow(code20);
  const c20 = await commissionsOf(code20);
  R.add({
    id: 'U3-20', role: 'Khách mới', journey: 'Mua trong gian hàng CTV', title: 'Đơn đặt từ /s/<slug> ghi công chủ gian hàng',
    steps: `Mini App ${BUY} mở /s/${sf2.slug} → chạm "${prodName}" → "Mua ngay" → COD → "Đặt hàng"`,
    expected: `orders.storefrontSlug = ${sf2.slug}, referrerUserId = ${CTV2}; commissions PENDING 8%`,
    actual: { http: prr.status(), sent: JSON.parse(prr.request().postData() ?? '{}'), o20, c20 },
    evidence: `${s20}; SQL orders ${short({ slug: o20?.storefrontSlug, ref: o20?.referrerUserId, total: o20?.total })}; commissions ${short(c20.map((c) => [c.status, c.amount, c.commissionableTotal]))}`,
    status: prr.status() < 300 && o20?.storefrontSlug === sf2.slug && o20?.referrerUserId === CTV2 && c20[0]?.status === 'PENDING' &&
      c20[0]?.amount === Math.floor(c20[0].commissionableTotal * 0.08) ? 'PASS' : 'FAIL',
  });

  // ---------- U3-21 hạ vai trò CTV → gian hàng ẩn ----------
  const demote = await api(L, 'POST', '/admin/users/role', { user: 'uat_admin', body: { phone: ctv2Phone, role: 'CUSTOMER' } });
  await sleep(6_000); // SessionStateService cache vai trò 5 giây
  const api21 = await pub(sf2.slug);
  const web21 = await ssrUntil(sf2.slug, 404, newTitle);
  mini = await openMini('returning', { path: `/s/${sf2.slug}` });
  await mini.page.waitForTimeout(1500);
  const mini21 = (await mini.page.evaluate(() => document.body.innerText)).includes('không tồn tại');
  const s21a = await shot(mini.page, 'U3-21-gian-hang-an-sau-ha-vai-tro');
  await mini.close();
  mini = await openMini(CTV2, { path: '/affiliate' });
  await mini.page.waitForTimeout(1500);
  const ctvView = await mini.page.evaluate(() => document.body.innerText);
  const s21b = await shot(mini.page, 'U3-21-ctv-bi-ha-mo-trang-ctv');
  await mini.close();
  mini = null;
  R.add({
    id: 'U3-21', role: 'ADMIN / khách', journey: 'Ẩn gian hàng khi CTV bị hạ vai trò', title: 'ADMIN hạ CTV về CUSTOMER → gian hàng ẩn ở API, web, Mini App',
    steps: `POST /admin/users/role {phone ${ctv2Phone}, role CUSTOMER}; chờ 6s; GET public, web SSR, Mini App /s/${sf2.slug}`,
    expected: 'role đổi 2xx; API 404; web 404 (chậm tối đa cửa sổ revalidate 300 giây); Mini App "không tồn tại"',
    actual: { demote: demote.status, api: api21.status, web: web21, mini21, db: await sfRow(sf2.slug), ctvPageHead: ctvView.slice(0, 160) },
    evidence: `${s21a}, ${s21b}; HTTP role ${demote.status}, API ${api21.status}, web lượt đầu ${web21.first.status} (còn tên=${web21.first.has}) rồi ${web21.status} sau ${web21.waitedSec}s`,
    status: demote.status < 300 && api21.status === 404 && web21.status === 404 && mini21 ? 'PASS' : 'FAIL',
    data: { ctvPageShowsDashboard: ctvView.includes('Có thể rút'), ctvPageShowsRegister: ctvView.includes('Đăng ký miễn phí ngay') },
  });

  // ---------- U3-22 hoa hồng đơn cũ vẫn giữ ----------
  const dv = await deliver(code20);
  await matureCommissions(code20);
  const c22 = await commissionsOf(code20);
  const avail = (await sql(`SELECT COALESCE(SUM(amount),0)::int s FROM commissions WHERE "affiliateUserId" = $1 AND status = 'APPROVED' AND "payoutBatchId" IS NULL`, CTV2))[0].s;
  const w0 = (await sql(`SELECT "walletBalance"::int b FROM users WHERE id = $1`, CTV2))[0].b;
  const pay = await api(L, 'POST', '/affiliate/payouts', { user: CTV2, headers: { 'idempotency-key': `u3-22-${RUN}` }, body: { amount: avail, method: 'WALLET_BALANCE' } });
  const w1 = (await sql(`SELECT "walletBalance"::int b, (SELECT COALESCE(SUM(delta),0)::int FROM wallet_transactions WHERE "userId" = $1) led FROM users WHERE id = $1`, CTV2))[0];
  const c22b = await commissionsOf(code20);
  R.add({
    id: 'U3-22', role: 'CTV bị hạ vai trò', journey: 'Hoa hồng đơn cũ vẫn giữ', title: 'Đơn đặt trước khi hạ vai trò: giao → LOCKED → 10 ngày → APPROVED → rút được',
    steps: `Webhook giao ${code20} (sau khi hạ vai trò) → lùi lockedAt 10 ngày → commissions.approve-due → POST /affiliate/payouts WALLET_BALANCE (user đang CUSTOMER)`,
    expected: 'commission không bị huỷ: LOCKED rồi APPROVED; rút về Ví 2xx; walletBalance += hoa hồng = SUM(wallet_transactions)',
    actual: { dv, beforePayout: c22.map((c) => ({ s: c.status, amt: c.amount })), afterPayout: c22b.map((c) => c.status), avail, pay: [pay.status, pay.body], w0, w1 },
    evidence: `SQL commissions ${short(c22.map((c) => [c.status, c.amount]))}; HTTP payout ${pay.status}; SQL walletBalance ${w0}→${w1.b}, SUM ledger ${w1.led}`,
    status: c22[0]?.status === 'APPROVED' && c22b[0]?.status === 'PAID' && pay.status < 300 && w1.b === w0 + avail && w1.b === w1.led && avail === c22[0]?.amount ? 'PASS' : 'FAIL',
  });

  // ---------- U3-23 mã CTV bị hạ không ghi công đơn mới ----------
  const BUY2 = `uat_u3sfc${RUN}`;
  await ensureUser(BUY2, { phone: `0909${String(Date.now()).slice(-6)}` });
  const v = await variationBySku('FUWA-DW-1L');
  const ref2 = (await sql(`SELECT "referralCode" FROM users WHERE id = $1`, CTV2))[0].referralCode;
  const o23 = await placeOrderApi(BUY2, [{ variationId: v.id, quantity: 1 }], { referralCode: ref2, storefrontSlug: sf2.slug });
  const r23 = await orderRow(o23.code);
  const c23 = await commissionsOf(o23.code);
  R.add({
    id: 'U3-23', role: 'Khách mới', journey: 'CTV bị hạ: link cũ', title: 'Đơn mới qua mã + slug của CTV đã bị hạ không ghi công, không hoa hồng',
    steps: `POST /checkout/place-order referralCode=${ref2}, storefrontSlug=${sf2.slug} (khách mới ${BUY2})`,
    expected: 'Đơn tạo được; referrerUserId null, storefrontSlug null; không có commissions',
    actual: { r23, c23 },
    evidence: `SQL orders ${short({ ref: r23.referrerUserId, slug: r23.storefrontSlug })}; commissions ${c23.length} dòng`,
    status: r23 && r23.referrerUserId === null && r23.storefrontSlug === null && c23.length === 0 ? 'PASS' : 'FAIL',
  });
  log('ctv2', { CTV2, slug: sf2.slug, ctv2Phone });
} catch (e) {
  console.error(e);
  if (mini) await shot(mini.page, 'U3-16-23-loi-mini');
  if (web) await shot(web.page, 'U3-16-23-loi-web');
  R.add({ id: 'U3-16..23', title: 'script lỗi', status: 'BLOCKED', actual: e instanceof Error ? e.message : String(e) });
} finally {
  await mini?.close().catch(() => undefined);
  await web?.close().catch(() => undefined);
  R.save();
  await closeDb();
}
