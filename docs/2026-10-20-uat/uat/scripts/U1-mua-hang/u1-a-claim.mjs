#!/usr/bin/env node
// U1 nhóm A: khách quét QR thẻ trong hộp hàng sàn (link ?claim=<mã thẻ>&src=shopee) trên Mini App thật.
// Chạy: node u1-a-claim.mjs [U1-01 ...]   (U1_LANE=1 mặc định; U1_BROWSER=webkit để chạy WebKit)
import {
  L, BROWSER, open, sql, freshCustomer, unusedCardCode, couponState, shot, runCases, runJob, realLogin, prisma, api, BlockedError,
} from './u1-lib.mjs';

const NEW_ONLY = 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.';
const SHEET_TITLES = ['Bạn nhận được ưu đãi', 'Ưu đãi đã có trong ví của bạn', 'Đăng nhập Zalo để nhận ưu đãi', 'Chưa nhận được ưu đãi', 'Đang nhận ưu đãi'];

async function claimSheet(page, timeout = 15_000) {
  const body = page.getByTestId('coupon-claim-sheet');
  await body.waitFor({ state: 'visible', timeout });
  // Chờ qua trạng thái "Đang nhận ưu đãi".
  for (let i = 0; i < 30; i++) {
    const t = await body.innerText();
    if (!/Tubu Tree đang thêm ưu đãi/.test(t)) break;
    await page.waitForTimeout(300);
  }
  const titles = await page.getByRole('heading', { level: 2 }).allInnerTexts();
  const title = titles.map((t) => t.trim()).find((t) => SHEET_TITLES.includes(t)) ?? null;
  return { title, text: (await body.innerText()).trim() };
}

/** Giá trị zmp-sdk setStorage lưu ở localStorage ngoài Zalo: base64(encodeURIComponent(JSON)) — giải từng lớp tới khi ra chuỗi thường. */
async function storage(page, key) {
  const raw = await page.evaluate((k) => {
    for (let i = 0; i < localStorage.length; i++) {
      const kk = localStorage.key(i);
      if (kk && kk.includes(k)) return localStorage.getItem(kk);
    }
    return null;
  }, key);
  if (raw == null) return null;
  let v = raw;
  for (let i = 0; i < 4; i++) {
    try {
      const b = Buffer.from(v, 'base64').toString('utf8');
      if (/^[%\w"{\[]/.test(b) && Buffer.from(b, 'utf8').toString('base64').replace(/=+$/, '') === v.replace(/=+$/, '')) v = b;
    } catch { /* không phải base64 */ }
    try { v = decodeURIComponent(v); } catch { /* đã giải */ }
    try {
      const j = JSON.parse(v);
      if (typeof j === 'string') { v = j; continue; }
      return JSON.stringify(j);
    } catch { /* chưa phải JSON */ }
  }
  return v;
}

const claimedBy = {};

const cases = [
  {
    id: 'U1-01',
    role: 'Khách mới (Zalo đăng nhập được, máy chưa từng mở app)',
    journey: 'Quét QR thẻ hộp hàng Shopee → mở Mini App → tự đăng nhập Zalo → nhận mã',
    steps: 'Tạo tài khoản Zalo mới (voucher chào mừng cấp lúc tạo) → mở /?claim=<HOPSAN chưa ai nhận>&src=shopee → chờ sheet',
    expected:
      'Sheet "Bạn nhận được ưu đãi": "Giảm 30.000đ cho đơn từ 199.000đ", mã vào ví, hạn 60 ngày, "Dành cho đơn đầu tiên…"; 1 dòng coupon_claims; chạm đầu (first touch) = shopee; mã hiện trong ví /me/coupons',
    async run(c) {
      const u = await freshCustomer('a01', { welcome: true });
      const code = await unusedCardCode();
      const s = await open(L.n, u.id, { browser: BROWSER, path: `/?claim=${code}&src=shopee` });
      try {
        const sh = await claimSheet(s.page);
        c.evidence('sheet', sh);
        c.evidence('ảnh', await shot(s.page, 'U1-01-claim-ok'));
        c.check('tiêu đề "Bạn nhận được ưu đãi"', sh.title === 'Bạn nhận được ưu đãi', sh.title);
        c.check('dòng ưu đãi "Giảm 30.000đ cho đơn từ 199.000đ"', sh.text.includes('Giảm 30.000đ cho đơn từ 199.000đ'));
        c.check('nêu mã + "chọn ở bước thanh toán"', sh.text.includes(`Mã ${code} đã vào mục Mã giảm giá của tôi`));
        c.check('nêu "Dành cho đơn đầu tiên"', sh.text.includes('Dành cho đơn đầu tiên của bạn tại Tubu Tree.'));
        const claimReq = s.requests.filter((r) => r.path === '/coupons/claim');
        c.check('POST /coupons/claim một lần, 201', claimReq.length === 1 && claimReq[0].status === 201, claimReq);
        const rows = await sql(`SELECT k."claimedAt", c.code, c."endAt" FROM coupon_claims k JOIN coupons c ON c.id=k."couponId" WHERE k."userId"=$1`, u.id);
        c.evidence('SQL coupon_claims của khách', rows);
        c.check('DB: đúng 1 dòng coupon_claims của khách với mã thẻ', rows.length === 1 && rows[0].code === code);
        const days = (new Date(rows[0]?.endAt) - Date.now()) / 864e5;
        c.check('hạn mã còn ~60 ngày kể từ lúc dựng lô (≤60, >50)', days <= 60 && days > 50, { days: days.toFixed(1) });
        const ft = await storage(s.page, 'tubu_first_touch');
        c.evidence('localStorage tubu_first_touch', ft);
        c.check('máy ghi chạm đầu source=shopee (gửi kèm đăng nhập)', ft && JSON.parse(ft).source === 'shopee', ft);
        const pending = await storage(s.page, 'tubu_pending_claim');
        c.check('mã chờ nhận đã xoá khỏi máy sau khi nhận', !pending, pending);
        const wallet = await api(L, 'GET', '/me/coupons', { user: u.id });
        const codes = (wallet.body ?? []).map((x) => x.code);
        c.evidence('GET /me/coupons', codes);
        c.check('ví có mã thẻ và voucher chào mừng WELCOME-…', codes.includes(code) && codes.some((x) => x.startsWith('WELCOME-')));
        claimedBy.a01 = { user: u, code };
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-02',
    role: 'Khách mới chưa đăng nhập Zalo (tài khoản khách theo deviceId)',
    journey: 'Mở link thẻ khi Zalo chưa đăng nhập → sheet mời đăng nhập → đăng nhập Zalo → mã tự vào ví',
    steps:
      'Mở /?claim=<mã>&src=shopee với user guest (app tự gọi /auth/guest thật) → sheet → bấm "Đăng nhập bằng Zalo" (bộ khung giả kết quả Zalo + nâng cấp tại chỗ như ensurePhoneForCurrentUser:295-311)',
    expected:
      'Trước đăng nhập: sheet "Đăng nhập Zalo để nhận ưu đãi", KHÔNG gọi /coupons/claim, mã giữ trên máy; sau đăng nhập: tự gọi claim, sheet "Bạn nhận được ưu đãi", 1 dòng coupon_claims thuộc chính tài khoản đã nâng cấp',
    async run(c) {
      const code = await unusedCardCode(Object.values(claimedBy).map((x) => x.code));
      const startedAt = new Date();
      const s = await open(L.n, 'guest', { browser: BROWSER, path: `/?claim=${code}&src=shopee` });
      try {
        const sh = await claimSheet(s.page);
        c.evidence('sheet khi là khách', sh);
        c.evidence('ảnh', await shot(s.page, 'U1-02-claim-need-login'));
        c.check('tiêu đề "Đăng nhập Zalo để nhận ưu đãi"', sh.title === 'Đăng nhập Zalo để nhận ưu đãi', sh.title);
        c.check('không gọi /coupons/claim khi còn là khách', !s.requests.some((r) => r.path === '/coupons/claim'));
        c.check('mã giữ trên máy (tubu_pending_claim)', (await storage(s.page, 'tubu_pending_claim'))?.includes(code));
        const [guest] = await sql(`SELECT id, "zaloId", phone FROM users WHERE "zaloId" LIKE 'guest_%' AND "createdAt" >= $1 ORDER BY "createdAt" DESC LIMIT 1`, startedAt);
        c.evidence('tài khoản khách vừa tạo bởi /auth/guest thật', guest);
        if (!guest) throw new Error('không thấy user guest vừa tạo');
        const zaloId = `uat-zalo-u1-guest-${Date.now().toString(36)}`;
        const phone = `093${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
        // Giả Zalo phía server: tài khoản Zalo mới chưa có trong DB → nhánh nâng cấp TẠI CHỖ dòng khách (auth.service.ts:295-311).
        await s.context.route(`${new URL(L.apiUrl).origin}/api/auth/ensure-phone`, async (route) => {
          const req = route.request();
          if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
          await prisma().user.updateMany({ where: { id: guest.id, zaloId: guest.zaloId }, data: { zaloId, fullName: 'Khách nâng cấp U1', phone, phoneVerifiedAt: new Date() } });
          runJob('VouchersService.grantWelcomeNow', [guest.id, { becameRealNow: true }]);
          const r = await realLogin(L, guest.id);
          return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true' }, contentType: 'application/json', body: JSON.stringify(r.body) });
        });
        await s.page.evaluate((z) => Object.assign(window.__UAT_ZMP__, { guest: false, zaloId: z }), zaloId);
        const claimResp = s.page.waitForResponse((r) => r.url().endsWith('/api/coupons/claim'), { timeout: 30_000 });
        await s.page.getByRole('button', { name: 'Đăng nhập bằng Zalo' }).click();
        const cr = await claimResp;
        c.check('sau đăng nhập app tự gọi POST /coupons/claim → 201', cr.status() === 201, cr.status());
        const sh2 = await claimSheet(s.page);
        c.evidence('sheet sau đăng nhập', sh2);
        c.evidence('ảnh', await shot(s.page, 'U1-02-claim-after-login'));
        c.check('tiêu đề "Bạn nhận được ưu đãi"', sh2.title === 'Bạn nhận được ưu đãi', sh2.title);
        const rows = await sql(`SELECT k."userId", c.code FROM coupon_claims k JOIN coupons c ON c.id=k."couponId" WHERE c.code=$1`, code);
        c.evidence('SQL coupon_claims của mã', rows);
        c.check('DB: mã thuộc đúng tài khoản đã nâng cấp (cùng id khách)', rows.length === 1 && rows[0].userId === guest.id);
        claimedBy.a02 = { user: { id: guest.id }, code };
        c.note('Phần Zalo phía server (getUserInfo/resolvePhoneNumber) do bộ khung giả; nhánh gộp vào tài khoản Zalo có sẵn không thử được (README giới hạn 1).');
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-03',
    role: 'Khách quay lại (đã có đơn giao xong)',
    journey: 'Khách cũ quét thẻ hộp hàng "chỉ khách mới"',
    steps: 'Mở /?claim=<HOPSAN chưa ai nhận>&src=shopee bằng uat_returning',
    expected: `Sheet "Chưa nhận được ưu đãi" + "${NEW_ONLY}"; không có dòng coupon_claims; mã vẫn còn cho khách mới khác`,
    async run(c) {
      const code = await unusedCardCode(Object.values(claimedBy).map((x) => x.code));
      const s = await open(L.n, 'returning', { browser: BROWSER, path: `/?claim=${code}&src=shopee` });
      try {
        const sh = await claimSheet(s.page);
        c.evidence('sheet', sh);
        c.evidence('ảnh', await shot(s.page, 'U1-03-claim-returning'));
        c.check('tiêu đề "Chưa nhận được ưu đãi"', sh.title === 'Chưa nhận được ưu đãi', sh.title);
        c.check('chữ đúng luật chỉ khách mới', sh.text.includes(NEW_ONLY), sh.text);
        const st = await couponState(code);
        c.evidence('SQL coupons', st);
        c.check('DB: 0 dòng claim, mã còn nguyên', st.claims === 0 && st.redemptions === 0);
        c.check('nút "Đã hiểu" (không có "Thử lại" vì lỗi nghiệp vụ)', await s.page.getByRole('button', { name: 'Đã hiểu' }).isVisible());
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-04',
    role: 'Khách mới thứ hai',
    journey: 'Quét lại thẻ đã có người khác nhận (thẻ chuyền tay)',
    steps: 'Khách mới khác mở /?claim=<mã đã được U1-01 nhận>',
    expected: 'Sheet "Chưa nhận được ưu đãi" + "Mã giảm giá này đã được tài khoản khác nhận."; số dòng claim của mã vẫn = 1',
    async run(c) {
      const prev = claimedBy.a01 ?? claimedBy.a02;
      if (!prev) throw new BlockedError('cần U1-01 hoặc U1-02 chạy trước trong cùng lượt');
      const u = await freshCustomer('a04');
      const s = await open(L.n, u.id, { browser: BROWSER, path: `/?claim=${prev.code}&src=shopee` });
      try {
        const sh = await claimSheet(s.page);
        c.evidence('sheet', sh);
        c.evidence('ảnh', await shot(s.page, 'U1-04-claim-taken'));
        c.check('chữ "Mã giảm giá này đã được tài khoản khác nhận."', sh.text.includes('Mã giảm giá này đã được tài khoản khác nhận.'), sh.text);
        const st = await couponState(prev.code);
        c.evidence('SQL coupons', st);
        c.check('DB: mã vẫn chỉ 1 dòng claim', st.claims === 1);
      } finally {
        await s.close();
      }
    },
  },
  {
    id: 'U1-05',
    role: 'Khách mới',
    journey: 'Mã thẻ sai / hết hạn / quét lại thẻ của chính mình',
    steps:
      '(a) /?claim=HOPSAN-KHONGCO99; (b) lùi endAt một mã thẻ về hôm qua rồi mở link; (c) khách U1-01 mở lại link thẻ của chính mình',
    expected:
      '(a) "Mã giảm giá không tồn tại. Vui lòng kiểm tra lại mã trên thẻ." (b) "Mã giảm giá đã hết hạn." (c) "Ưu đãi đã có trong ví của bạn", không ghi thêm dòng claim',
    async run(c) {
      const u = await freshCustomer('a05');
      let s = await open(L.n, u.id, { browser: BROWSER, path: '/?claim=HOPSAN-KHONGCO99&src=shopee' });
      try {
        const sh = await claimSheet(s.page);
        c.evidence('(a) sheet', sh);
        c.check('(a) mã không tồn tại báo đúng chữ', sh.text.includes('Mã giảm giá không tồn tại. Vui lòng kiểm tra lại mã trên thẻ.'), sh.text);
      } finally {
        await s.close();
      }
      const exp = await unusedCardCode(Object.values(claimedBy).map((x) => x.code));
      await sql(`UPDATE coupons SET "endAt" = now() - interval '1 day' WHERE code = $1 RETURNING code`, exp);
      const u2 = await freshCustomer('a05b');
      s = await open(L.n, u2.id, { browser: BROWSER, path: `/?claim=${exp}&src=shopee` });
      try {
        const sh = await claimSheet(s.page);
        c.evidence('(b) sheet', sh);
        c.evidence('(b) ảnh', await shot(s.page, 'U1-05-claim-expired'));
        c.check('(b) mã hết hạn báo "Mã giảm giá đã hết hạn."', sh.text.includes('Mã giảm giá đã hết hạn.'), sh.text);
      } finally {
        await s.close();
      }
      c.evidence('(b) mã đã lùi hạn (để nguyên, không dùng lại)', exp);
      const prev = claimedBy.a01;
      if (!prev) {
        c.note('(c) bỏ qua: cần U1-01 chạy trước');
        return;
      }
      s = await open(L.n, prev.user.id, { browser: BROWSER, path: `/?claim=${prev.code}&src=shopee` });
      try {
        const sh = await claimSheet(s.page);
        c.evidence('(c) sheet', sh);
        c.check('(c) quét lại thẻ của mình: "Ưu đãi đã có trong ví của bạn"', sh.title === 'Ưu đãi đã có trong ví của bạn', sh.title);
        const st = await couponState(prev.code);
        c.check('(c) DB: vẫn 1 dòng claim', st.claims === 1, st);
      } finally {
        await s.close();
      }
    },
  },
];

await runCases(cases);
