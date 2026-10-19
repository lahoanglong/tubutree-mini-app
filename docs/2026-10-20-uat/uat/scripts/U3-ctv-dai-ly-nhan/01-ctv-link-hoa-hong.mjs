#!/usr/bin/env node
// U3-01..U3-07: CTV mở trang CTV trên Mini App, tạo link, chia sẻ; khách mới mở link, mua COD trên Mini App;
// hoa hồng 8% PENDING → giao (webhook Pancake) LOCKED → job duyệt sau đủ 10 ngày (lùi lockedAt) APPROVED → CTV thấy "Có thể rút".
// Dùng: node 01-ctv-link-hoa-hong.mjs   (lane 3 đã bật bằng lane-up.sh 3 --web). Chạy lại được: mỗi lần dùng khách mới riêng.
import {
  L, api, apiOk, closeDb, commissionsOf, deliver, ensureAddress, ensureUser, exec, itemsOf, log, openMini, orderRow, recorder, runJob, short, shot, sql,
  variationBySku,
} from './u3lib.mjs';

const R = recorder('01-ctv-link-hoa-hong');
const CTV = 'uat_ctv';
const RUN = Date.now().toString(36).slice(-5);
const BUYER = `uat_u3buy${RUN}`;
const BUYER_PHONE = `0903${String(Date.now()).slice(-6)}`;
const SKU = 'FUWA-DW-5L';

let mini;
try {
  // ---------- U3-01 trang CTV ----------
  mini = await openMini(CTV, { path: '/affiliate' });
  let p = mini.page;
  await p.getByText('Mã giới thiệu của bạn').waitFor({ timeout: 20_000 });
  const text = await p.evaluate(() => document.body.innerText);
  const s1 = await shot(p, 'U3-01-ctv-trang');
  const bad = mini.requests.filter((r) => !r.mocked && !(r.status >= 200 && r.status < 400));
  R.add({
    id: 'U3-01', role: 'CTV', journey: 'Trang CTV (Mini App)', title: 'CTV mở /affiliate thấy mã giới thiệu, hoa hồng, nút rút',
    steps: 'Mini App uat_ctv → /affiliate',
    expected: 'Thấy mã UATCTV, "Hoa hồng tháng này", "Có thể rút", mục Link chia sẻ; mọi API 2xx',
    actual: { hasCode: text.includes('UATCTV'), hasMonth: text.includes('Hoa hồng tháng này'), hasWithdraw: text.includes('Có thể rút'), bad, api: mini.requests.map((r) => `${r.method} ${r.path} ${r.status}`) },
    evidence: `${s1}; ${mini.requests.filter((r) => /affiliate/.test(r.path)).map((r) => `${r.method} ${r.path}→${r.status}`).join(', ')}`,
    status: text.includes('UATCTV') && text.includes('Hoa hồng tháng này') && text.includes('Có thể rút') && bad.length === 0 ? 'PASS' : 'FAIL',
  });

  // ---------- U3-02 tạo link + chia sẻ ----------
  const linksBefore = (await sql(`SELECT count(*)::int n FROM affiliate_links WHERE "userId" = $1`, CTV))[0].n;
  const linkResp = p.waitForResponse((r) => r.url().endsWith('/api/affiliate/links') && r.request().method() === 'POST', { timeout: 15_000 });
  await p.getByRole('button', { name: '+ Tạo link' }).click();
  const lr = await linkResp;
  const link = await lr.json();
  await p.getByRole('button', { name: 'Chia sẻ', exact: true }).last().click();
  await p.waitForTimeout(1200);
  const zmp = await mini.zmpCalls();
  const share = zmp.filter((c) => /share/i.test(c.name));
  const linksAfter = (await sql(`SELECT count(*)::int n FROM affiliate_links WHERE "userId" = $1`, CTV))[0].n;
  const s2 = await shot(p, 'U3-02-ctv-tao-link-chia-se');
  const sharePath = JSON.stringify(share);
  R.add({
    id: 'U3-02', role: 'CTV', journey: 'Mã/link giới thiệu, chia sẻ', title: 'Tạo link chia sẻ và bấm Chia sẻ',
    steps: '/affiliate → "+ Tạo link" → "Chia sẻ" (mục Mã giới thiệu)',
    expected: 'POST /affiliate/links 201, thêm 1 dòng affiliate_links; Chia sẻ gọi openShareSheet với đường dẫn chứa ref=UATCTV',
    actual: { linkStatus: lr.status(), shortCode: link.shortCode, linksBefore, linksAfter, share },
    evidence: `${s2}; SQL count(affiliate_links uat_ctv) ${linksBefore}→${linksAfter}; zmp ${short(share, 300)}`,
    status: lr.status() === 201 && linksAfter === linksBefore + 1 && share.length > 0 && sharePath.includes('ref=UATCTV') ? 'PASS' : 'FAIL',
  });
  await mini.close();
  mini = null;

  // ---------- U3-03 khách mới mở link ----------
  await ensureUser(BUYER, { phone: BUYER_PHONE, name: `Khách mới U3 ${RUN}` });
  await ensureAddress(BUYER, BUYER_PHONE);
  mini = await openMini(BUYER, { path: '/?ref=UATCTV' });
  p = mini.page;
  const touchReq = mini.requests.find((r) => r.path === '/affiliate/touch');
  const touch = await sql(`SELECT "referrerUserId", "storefrontSlug", kind, "expiresAt" FROM referral_touches WHERE "userId" = $1`, BUYER);
  const s3 = await shot(p, 'U3-03-khach-moi-mo-link');
  R.add({
    id: 'U3-03', role: 'Khách mới (qua link CTV)', journey: 'Khách mới mở link CTV', title: 'Mở /?ref=UATCTV ghi chạm giới thiệu 7 ngày',
    steps: `Mini App ${BUYER} (khách mới, chưa đơn) mở /?ref=UATCTV`,
    expected: 'POST /affiliate/touch 2xx; referral_touches: referrer uat_ctv, hạn = now + affiliate.attribution_days (7)',
    actual: { touchReq, touch },
    evidence: `${s3}; SQL referral_touches ${short(touch)}`,
    status: touchReq?.status === 201 && touch[0]?.referrerUserId === CTV ? 'PASS' : 'FAIL',
  });

  // ---------- U3-04 khách mới mua qua link → hoa hồng 8% ----------
  const v = await variationBySku(SKU);
  await mini.goto(`/product/${v.product.slug}`);
  const buyNow = p.getByRole('button', { name: /^Mua ngay/ });
  await buyNow.waitFor({ timeout: 20_000 });
  const quoteResp = p.waitForResponse((r) => r.url().endsWith('/api/checkout/quote') && r.request().method() === 'POST', { timeout: 30_000 });
  await buyNow.click();
  await p.waitForURL(/\/checkout/, { timeout: 20_000 });
  const quote = await (await quoteResp).json();
  const place = p.getByRole('button', { name: /^Đặt hàng · / });
  await place.waitFor({ timeout: 20_000 });
  const codRadio = p.getByRole('radio', { name: /Thanh toán khi nhận hàng/ });
  if (!(await codRadio.isChecked())) await codRadio.check({ force: true });
  const s4a = await shot(p, 'U3-04-khach-moi-checkout');
  const placedResp = p.waitForResponse((r) => r.url().endsWith('/api/checkout/place-order') && r.request().method() === 'POST', { timeout: 30_000 });
  await place.click();
  const pr = await placedResp;
  const placeReqBody = JSON.parse(pr.request().postData() ?? '{}');
  const placed = await pr.json();
  const code = placed.code ?? placed.order?.code ?? placed.orders?.[0]?.code;
  await p.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  const s4b = await shot(p, 'U3-04-khach-moi-dat-xong');
  await mini.close();
  mini = null;
  const order = await orderRow(code);
  const items = await itemsOf(code);
  const comm = await commissionsOf(code);
  const expectAmount = items.reduce((s, i) => s + Math.floor(((i.paidTotal ?? i.total) * 8) / 100), 0);
  log('đơn qua link', { code, order, items, comm, quote: { subtotal: quote.subtotal, discount: quote.discount, total: quote.total, shippingFee: quote.shippingFee } });
  R.add({
    id: 'U3-04', role: 'Khách mới (qua link CTV)', journey: 'Khách mới mua qua link → hoa hồng 8%', title: 'Đơn COD qua link tạo hoa hồng PENDING 8% tiền hàng thực trả',
    steps: `PDP ${SKU} → "Mua ngay" → /checkout COD → "Đặt hàng"`,
    expected: 'orders.referrerUserId = uat_ctv; 1 dòng commissions PENDING, amount = floor(8% × paidTotal từng dòng) (không tính phí giao)',
    actual: { code, httpStatus: pr.status(), sentReferral: placeReqBody.referralCode ?? null, order, items, comm, expectAmount },
    evidence: `${s4a}, ${s4b}; SQL orders ${short({ referrer: order?.referrerUserId, total: order?.total, ship: order?.shippingFee, discount: order?.discount })}; commissions ${short(comm.map((c) => ({ s: c.status, amt: c.amount, base: c.commissionableTotal })))}`,
    status: pr.status() < 300 && order?.referrerUserId === CTV && comm.length === 1 && comm[0].status === 'PENDING' && comm[0].amount === expectAmount ? 'PASS' : 'FAIL',
    data: { code },
  });

  // ---------- U3-05 giao xong → LOCKED ----------
  const dv = await deliver(code);
  const commL = await commissionsOf(code);
  R.add({
    id: 'U3-05', role: 'CTV / hệ thống', journey: 'Giữ hoa hồng sau giao', title: 'Đơn DELIVERED khoá hoa hồng (LOCKED, lockedAt)',
    steps: `Webhook Pancake shipped → delivered cho ${code}`,
    expected: 'Đơn DELIVERED; commission LOCKED, lockedAt ≈ lúc giao, chưa rút được',
    actual: { dv, comm: commL },
    evidence: `webhook ${short(dv)}; SQL commissions ${short(commL.map((c) => ({ s: c.status, lockedAt: c.lockedAt })))}`,
    status: dv.delivered === 'DELIVERED' && commL[0]?.status === 'LOCKED' && commL[0]?.lockedAt ? 'PASS' : 'FAIL',
  });

  // ---------- U3-06 giữ 10 ngày (job) ----------
  const cid = commL[0].id;
  await exec(`UPDATE commissions SET "lockedAt" = now() - interval '9 days 23 hours' WHERE id = $1`, cid);
  const j1 = runJob('commissions.approve-due');
  const after9 = (await sql(`SELECT status::text s FROM commissions WHERE id = $1`, cid))[0].s;
  await exec(`UPDATE commissions SET "lockedAt" = now() - interval '10 days 1 minute' WHERE id = $1`, cid);
  const j2 = runJob('commissions.approve-due');
  const after10 = (await sql(`SELECT status::text s, "approvedAt" FROM commissions WHERE id = $1`, cid))[0];
  R.add({
    id: 'U3-06', role: 'Hệ thống (job)', journey: 'Giữ hoa hồng 10 ngày sau giao', title: 'Job commissions.approve-due chỉ duyệt khi đủ 10 ngày',
    steps: 'Lùi lockedAt 9 ngày 23 giờ → run-job commissions.approve-due; lùi 10 ngày 1 phút → chạy lại',
    expected: 'Sau 9n23g vẫn LOCKED; sau 10 ngày APPROVED (hold = max(affiliate.hold_days 10, returns.window_days 7))',
    actual: { after9, after10, j1: j1.ms, j2: j2.ms },
    evidence: `SQL status sau 9n23g: ${after9}; sau 10n: ${after10.s} approvedAt ${after10.approvedAt}`,
    status: after9 === 'LOCKED' && after10.s === 'APPROVED' ? 'PASS' : 'FAIL',
  });

  // ---------- U3-07 CTV thấy Có thể rút ----------
  const dash = await apiOk(L, 'GET', '/affiliate/dashboard', { user: CTV });
  const approvedSum = (await sql(`SELECT COALESCE(SUM(amount),0)::int s FROM commissions WHERE "affiliateUserId" = $1 AND status = 'APPROVED' AND "payoutBatchId" IS NULL`, CTV))[0].s;
  mini = await openMini(CTV, { path: '/affiliate' });
  p = mini.page;
  await p.getByText('Có thể rút').first().waitFor({ timeout: 20_000 });
  const s7 = await shot(p, 'U3-07-ctv-co-the-rut');
  const t7 = await p.evaluate(() => document.body.innerText);
  const shown = t7.includes(approvedSum.toLocaleString('vi-VN'));
  await mini.close();
  mini = null;
  R.add({
    id: 'U3-07', role: 'CTV', journey: 'Hoa hồng hết hạn giữ', title: '"Có thể rút" trên Mini App = SUM(commissions APPROVED chưa rút)',
    steps: 'Mini App uat_ctv → /affiliate',
    expected: 'dashboard.withdrawableCommission = SUM(amount) APPROVED, payoutBatchId null; số hiện trên thẻ "Có thể rút"',
    actual: { withdrawable: dash.withdrawableCommission, approvedSum, shownOnScreen: shown },
    evidence: `${s7}; GET /affiliate/dashboard withdrawable=${dash.withdrawableCommission}; SQL SUM APPROVED=${approvedSum}`,
    status: dash.withdrawableCommission === approvedSum && shown ? 'PASS' : 'FAIL',
  });
} catch (e) {
  console.error(e);
  if (mini) await shot(mini.page, 'U3-01-07-loi');
  R.add({ id: 'U3-01..07', title: 'script lỗi', status: 'BLOCKED', actual: e instanceof Error ? e.message : String(e) });
} finally {
  await mini?.close().catch(() => undefined);
  R.save();
  await closeDb();
}
