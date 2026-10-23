#!/usr/bin/env node
// U5 ma trận vai trò × tab: (1) web admin thật 1440 — mục menu mỗi vai trò thấy; (2) gọi thẳng API của từng tab bằng token
// vai trò đó → tab không được phép phải 403; (3) vài thao tác ghi nhạy cảm phải 403 với vai trò không được phép.
// Dùng: node u5-matrix.mjs [--no-ui]   (lane 5, cần lane-up.sh 5 --web)
import fs from 'node:fs';
import path from 'node:path';
import { api, brief, done, openWebSession, q, recorder, RESULTS, shot } from './u5lib.mjs';

const rec = recorder('u5-matrix');
const noUi = process.argv.includes('--no-ui');

// Nhãn menu web admin (apps/web/src/app/admin/page.tsx NAV_GROUPS) và API đại diện của tab.
const [anyProduct] = await q(`SELECT id FROM products WHERE "isActive" LIMIT 1`);
const TABS = [
  ['inbox', 'Việc cần xử lý', 'GET /admin/ops/inbox'],
  ['dashboard', 'Tổng quan chỉ số', 'GET /admin/dashboard/stats'],
  ['analytics', 'Giữ chân khách & chỉ số chính', 'GET /admin/analytics/retention-daily'],
  ['reports', 'Báo cáo', null],
  ['orders', 'Đơn hàng', 'GET /admin/orders'],
  ['externalOrders', 'Đơn ngoài app', 'GET /admin/external-orders'],
  ['externalClaims', 'Tích điểm đơn sàn', 'GET /admin/external-claims'],
  ['merchantFulfilment', 'Đơn đối tác & đối soát', 'GET /admin/merchant-fulfilment/overview'],
  ['returns', 'Đổi / Trả', 'GET /admin/return-requests'],
  ['customerRefunds', 'Hoàn tiền khách', 'GET /admin/customer-refunds'],
  ['cashback', 'Hoàn tiền sàn ngoài', 'GET /admin/cashback/transactions'],
  ['dealers', 'Đại lý', 'GET /admin/dealer-applications'],
  ['dealerClaims', 'Thưởng đại lý', 'GET /admin/dealer-reward-claims'],
  ['dealerAccounts', 'Đại lý & công nợ', 'GET /admin/dealers/accounts'],
  ['dealerPrices', 'Lịch sử giá đại lý', 'GET /admin/dealer-prices/history'],
  ['commissionRates', 'Hoa hồng & giá sỉ', 'GET /admin/commission-rates'],
  ['productCategories', 'Danh mục sản phẩm', 'GET /admin/product-categories/products'],
  ['payouts', 'Yêu cầu rút tiền', 'GET /admin/payouts'],
  ['merchantProducts', 'Duyệt SP đối tác', 'GET /admin/merchant-products/pending'],
  ['storefronts', 'Gian hàng', 'GET /admin/storefronts'],
  ['brands', 'Nhãn hàng', 'GET /admin/brands'],
  ['users', 'Người dùng', 'GET /admin/users'],
  ['reviews', 'Đánh giá', 'GET /admin/reviews'],
  ['community', 'Cộng đồng', 'GET /feed/admin/pending'],
  ['subscriptions', 'Gói định kỳ', 'GET /admin/subscriptions'],
  ['posCredits', 'Tích điểm tại quầy', 'GET /admin/loyalty/pos-credits'],
  ['waste', 'Đổi rác', 'GET /admin/waste/requests'],
  ['coupons', 'Mã giảm giá', 'GET /admin/coupons'],
  ['flashSales', 'Giờ vàng', 'GET /admin/flash-sales'],
  ['engagement', 'Nhiệm vụ', 'GET /admin/engagement/missions'],
  ['faqs', 'Câu hỏi thường gặp', 'GET /admin/faqs'],
  ['contentKit', 'Bộ nội dung CTV', `GET /admin/content-kits/${anyProduct?.id ?? 'x'}`],
  ['academy', 'Học viện CTV', 'GET /admin/academy/courses'],
  ['quickReplies', 'CSKH mẫu tin nhanh', 'GET /admin/quick-replies'],
  ['notificationTemplates', 'Mẫu thông báo', 'GET /admin/notification-templates'],
  ['staffRoster', 'Nhân sự & quyền', 'GET /admin/staff'],
  ['shiftApproval', 'Duyệt ca', 'GET /admin/shifts'],
  ['payroll', 'Lương', 'GET /admin/payroll'],
  ['attendance', 'Chấm công', 'GET /admin/attendance/live'],
  ['config', 'Cấu hình', 'GET /admin/config'],
  ['opsHealth', 'Sức khoẻ hệ thống', 'GET /admin/ops/health'],
];
const today = new Date().toISOString().slice(0, 10);
const REPORTS = {
  revenue: `GET /admin/reports/revenue?from=${today}&to=${today}`,
  sources: `GET /admin/reports/sources?from=${today}&to=${today}`,
};

// Kỳ vọng theo luật đã chốt (00-brief.md "Kế toán…", "Trần mã…"; 03-cau-hoi-sang.md B7, B8, B18, "Phân quyền nhân viên").
const BASE = ['waste'];
const EXPECT = {
  admin: 'ALL',
  ketoan: [...BASE, 'inbox', 'orders', 'externalClaims', 'reports', 'merchantFulfilment', 'customerRefunds', 'cashback', 'dealerClaims', 'dealerAccounts', 'payouts'],
  marketing: [...BASE, 'inbox', 'reports', 'community', 'coupons', 'flashSales', 'faqs', 'contentKit', 'academy', 'notificationTemplates'],
  cskh: [...BASE, 'inbox', 'orders', 'externalOrders', 'externalClaims', 'returns', 'users', 'quickReplies', 'community'],
  kho: [...BASE, 'inbox', 'orders', 'returns'],
  staff: [...BASE],
  returning: [],
};
const ROLE_LABEL = { admin: 'ADMIN', ketoan: 'KẾ TOÁN', marketing: 'MARKETING', cskh: 'CSKH', kho: 'NHÂN VIÊN (KHO)', staff: 'NHÂN VIÊN (không nhóm)', returning: 'KHÁCH' };
const REPORT_EXPECT = { admin: ['revenue', 'sources'], ketoan: ['revenue'], marketing: ['sources'] };

const allowedFor = (role, tab) => EXPECT[role] === 'ALL' || EXPECT[role].includes(tab);
const call = async (role, spec) => {
  const [m, p] = spec.split(' ');
  const r = await api(m, p, { user: role, body: m === 'GET' ? undefined : {} });
  return r;
};

const matrix = {};
const caseNo = { admin: 1, ketoan: 2, marketing: 3, cskh: 4, kho: 5, staff: 6, returning: 7 };
for (const role of Object.keys(EXPECT)) {
  const id = `U5-0${caseNo[role]}`;
  const res = { role, api: {}, ui: null };
  const wrongApi = [];
  for (const [k, , spec] of TABS) {
    if (!spec) continue;
    const r = await call(role, spec);
    const exp = allowedFor(role, k);
    const got = r.status !== 403 && r.status !== 401;
    res.api[k] = r.status;
    if (exp !== got) wrongApi.push(`${k} ${spec} → ${r.status} (kỳ vọng ${exp ? 'mở' : '403'})${r.status >= 500 ? ` ${brief(r.body, 80)}` : ''}`);
  }
  for (const [rk, spec] of Object.entries(REPORTS)) {
    const r = await call(role, spec);
    const exp = (REPORT_EXPECT[role] ?? []).includes(rk);
    const got = r.status !== 403 && r.status !== 401;
    res.api[`reports.${rk}`] = r.status;
    if (exp !== got) wrongApi.push(`reports.${rk} ${spec} → ${r.status} (kỳ vọng ${exp ? 'mở' : '403'})`);
  }
  // UI: menu thấy được (nav desktop 1440).
  let uiNote = 'bỏ qua UI (--no-ui)';
  let wrongUi = [];
  let evShot = '';
  if (!noUi) {
    const s = await openWebSession(role, '/admin');
    try {
      const nav = s.page.getByRole('navigation', { name: 'Mục quản trị', exact: true });
      let labels = [];
      if (role === 'returning') {
        await s.page.getByText('Bạn không có quyền truy cập trang quản trị.').waitFor({ timeout: 60_000 });
        uiNote = 'màn "Bạn không có quyền truy cập trang quản trị."';
      } else {
        await nav.waitFor({ timeout: 90_000 });
        labels = (await nav.getByRole('button').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        const expected = TABS.filter(([k]) => allowedFor(role, k)).map(([, l]) => l);
        const missing = expected.filter((l) => !labels.includes(l));
        const extra = labels.filter((l) => !expected.includes(l));
        wrongUi = [...missing.map((l) => `thiếu "${l}"`), ...extra.map((l) => `thừa "${l}"`)];
        uiNote = `menu ${labels.length} mục: ${labels.join(', ')}`;
      }
      evShot = await shot(s.page, `matrix-${role}-1440`);
      res.ui = { labels, url: s.page.url(), requests: s.requests.filter((r) => r.status >= 400) };
    } finally {
      await s.close();
    }
  }
  matrix[role] = res;
  const bad = [...wrongApi, ...wrongUi];
  rec.add({
    id,
    role: ROLE_LABEL[role],
    journey: 'Ma trận tab: menu web admin + gọi thẳng API từng tab',
    steps: `Mở /admin 1440 bằng phiên web thật; đọc menu "Mục quản trị"; mint token ${role}, gọi GET đại diện của ${TABS.filter((t) => t[2]).length} tab + 2 báo cáo`,
    expected: EXPECT[role] === 'ALL' ? 'Thấy mọi tab, mọi API ≠ 403' : `Chỉ thấy/gọi được: ${EXPECT[role].join(', ') || '(không tab nào)'}; còn lại API 403`,
    actual: bad.length ? `Lệch ${bad.length}: ${bad.join('; ')}` : `Khớp. ${uiNote}`,
    evidence: `${evShot} · API: ${Object.entries(res.api).map(([k, v]) => `${k}=${v}`).join(' ')}`,
    verdict: bad.length ? 'FAIL' : 'PASS',
  });
}

// Thao tác ghi nhạy cảm: phải 403 với vai trò không được phép (id giả: guard chạy trước handler).
const WRITES = [
  ['ketoan', 'POST /admin/payouts/x/approve', 'KẾ TOÁN duyệt rút tiền (B7: chỉ ADMIN)'],
  ['ketoan', 'POST /admin/payouts/x/reject', 'KẾ TOÁN từ chối rút tiền'],
  ['ketoan', 'PUT /admin/orders/x/status', 'KẾ TOÁN đổi trạng thái đơn'],
  ['ketoan', 'PUT /admin/config', 'KẾ TOÁN đổi SystemConfig'],
  ['ketoan', 'GET /admin/users/export', 'KẾ TOÁN xuất người dùng'],
  ['ketoan', 'POST /admin/dealer-reward-claims/x/approve', 'KẾ TOÁN duyệt thưởng đại lý (chỉ chi khoản ADMIN đã duyệt)'],
  ['marketing', 'PUT /admin/config', 'MARKETING đổi SystemConfig'],
  ['marketing', 'GET /admin/engagement/missions', 'MARKETING mở nhiệm vụ & quà đổi điểm'],
  ['marketing', 'POST /feed/events', 'MARKETING tạo sự kiện cộng đồng có thưởng'],
  ['marketing', 'GET /admin/brands', 'MARKETING mở nhãn hàng'],
  ['marketing', 'GET /admin/orders/export', 'MARKETING xuất CSV đơn'],
  ['cskh', 'POST /admin/users/x/block', 'CSKH khoá user'],
  ['cskh', 'POST /admin/users/role', 'CSKH đổi vai trò'],
  ['cskh', 'POST /feed/events/x/winner', 'CSKH chọn người thắng (B8: chỉ ADMIN)'],
  ['cskh', 'GET /admin/orders/export', 'CSKH xuất CSV đơn'],
  ['kho', 'POST /admin/orders/x/confirm-payment', 'KHO bấm "Đã nhận tiền"'],
  ['staff', 'GET /admin/orders', 'NHÂN VIÊN không nhóm xem đơn'],
  ['staff', 'POST /admin/staff/grant', 'NHÂN VIÊN cấp quyền'],
  ['returning', 'GET /admin/ops/inbox', 'KHÁCH gọi API quản trị'],
];
const wrong = [];
const ev = [];
for (const [role, spec, label] of WRITES) {
  const [m, p] = spec.split(' ');
  const r = await api(m, p, { user: role, body: m === 'GET' ? undefined : {} });
  ev.push(`${role} ${spec}=${r.status}`);
  if (r.status !== 403) wrong.push(`${label}: ${spec} → ${r.status} ${brief(r.body, 80)}`);
}
rec.add({
  id: 'U5-08',
  role: 'KẾ TOÁN / MARKETING / CSKH / KHO / NHÂN VIÊN / KHÁCH',
  journey: 'Thao tác ghi nhạy cảm bằng token vai trò không được phép',
  steps: `${WRITES.length} lời gọi thẳng API (id giả, guard chạy trước handler)`,
  expected: 'Mọi lời gọi 403 "Bạn không có quyền truy cập tài nguyên này."',
  actual: wrong.length ? `Lệch: ${wrong.join('; ')}` : `Cả ${WRITES.length} lời gọi 403`,
  evidence: ev.join(' · '),
  verdict: wrong.length ? 'FAIL' : 'PASS',
});

fs.writeFileSync(path.join(RESULTS, 'u5-matrix-raw.json'), `${JSON.stringify({ tabs: TABS, matrix }, null, 2)}\n`);
rec.save();
await done();
