import { test, expect, type MockApi } from './support/mock-api';

/**
 * Admin `/admin/gio-g` — thẻ "Cấu hình bên thứ 3 chờ bàn giao Go-Live" với đúng 15 dòng WARN của PROD sau w24-04 (11 việc, 0 đã cấu hình).
 * Kiểm ở 375px và 1440px: không tràn ngang, dòng gọn (đủ 6 việc trong một màn điện thoại), mở một việc ra tên biến kèm Đã điền / Chờ điền.
 * Mock mọi lệnh gọi /api/ nên KHÔNG cần API/DB. Có VISUAL_DIR thì chụp cả trang để PO xem.
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

const item = (key: string, title: string, owner: string, vars: string[], checks: [id: string, title: string, detail: string][]) => ({
  key,
  title,
  owner,
  guide: `Cách lấy và nơi đặt của việc "${title}" (docs/GO-LIVE-KEYS.md).`,
  configured: false,
  status: 'WARN' as const,
  vars: vars.map((name) => ({ name, configured: false })),
  checks: checks.map(([id, t, detail]) => ({ id, title: t, status: 'WARN' as const, detail })),
});

const HANDOVER = {
  title: 'Cấu hình bên thứ 3 chờ bàn giao Go-Live',
  configured: 0,
  total: 11,
  items: [
    item('zns_templates', 'Mã mẫu ZNS do Zalo duyệt', 'Chủ Zalo OA', [], [['db.zns_templates', 'Mẫu ZNS đã có mã Zalo duyệt', '2/2 mẫu chưa có mã Zalo, nên chỉ gửi trong app: ORDER_CONFIRMED, ORDER_SHIPPING']]),
    item('zalo_oa', 'Zalo OA gửi tin ZNS', 'Chủ Zalo OA', ['ZALO_OA_ID', 'ZALO_OA_ACCESS_TOKEN', 'ZALO_OA_REFRESH_TOKEN'], [['env.zalo.oa', 'Zalo OA cho tin ZNS', 'chưa đặt token và ID của OA']]),
    item('zalo_oa_webhook', 'Khoá webhook OA (tin nhắn CSKH)', 'Chủ Zalo OA', [], [['env.zalo.oa_webhook_secret', 'Token webhook OA Zalo (CSKH)', 'ZALO_OA_WEBHOOK_SECRET chưa đặt']]),
    item('zalo_open_api', 'API Key webhook Mini App (rút đồng ý, xoá dữ liệu)', 'Chủ Mini App Zalo', ['ZALO_OPEN_API_KEY'], [['env.zalo.open_api_key', 'API Key webhook Mini App Zalo', 'ZALO_OPEN_API_KEY chưa đặt']]),
    item('zalopay', 'Merchant ZaloPay', 'Chủ shop (hợp đồng ZaloPay)', ['ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2'], [['env.zalopay', 'Merchant ZaloPay', 'chưa đặt ZALOPAY_APP_ID, ZALOPAY_KEY1, ZALOPAY_KEY2']]),
    item('accesstrade', 'Accesstrade (hoàn tiền mua sàn ngoài)', 'Chủ shop (tài khoản Accesstrade)', ['ACCESSTRADE_TOKEN', 'ACCESSTRADE_PUBLISHER_ID'], [['env.accesstrade.api', 'Khoá API Accesstrade', 'thiếu ACCESSTRADE_TOKEN, ACCESSTRADE_PUBLISHER_ID']]),
    item('phone_hmac', 'Khoá mã băm số điện thoại', 'Kỹ thuật (máy chủ)', ['PHONE_HMAC_SECRET'], [['env.phone_hmac', 'PHONE_HMAC_SECRET cho mã băm số điện thoại', 'chưa đặt']]),
    item('ops_alerts', 'Báo động ra ngoài app', 'Kỹ thuật và người trực', ['OPS_ALERT_WEBHOOK_URL', 'OPS_ALERT_ENV_LABEL'], [
      ['env.ops.webhook', 'Webhook báo động (Slack, Google Chat, n8n)', 'OPS_ALERT_WEBHOOK_URL chưa đặt'],
      ['env.ops.label', 'Nhãn môi trường trong tiêu đề báo động', 'OPS_ALERT_ENV_LABEL chưa đặt'],
    ]),
    item('cloudinary', 'Cloudinary cho ảnh khách tải lên', 'Kỹ thuật (build Mini App)', [], [['env.cloudinary', 'Cloudinary (ảnh tải lên)', 'không kiểm được từ server']]),
    item('backup_offsite', 'Backup hằng đêm ra ngoài máy chủ', 'Kỹ thuật (VPS)', [], [
      ['backup.script', 'Script backup của repo', 'không kiểm được: container không chứa tools/'],
      ['backup.cron', 'Cron backup hằng ngày', 'không kiểm được: không đọc được crontab'],
      ['backup.offsite', 'Bản backup ngoài máy (rclone)', 'không kiểm được: không biết remote nào'],
      ['backup.healthcheck', 'Báo động khi backup lỗi', 'không kiểm được: không đọc được crontab'],
    ]),
    item('demo_coupons', 'Mã giảm giá demo', 'Chủ shop (PO)', [], [['db.demo_coupons', 'Mã giảm giá demo', 'còn dùng được: đã chấp nhận giữ: WELCOME30 (hạn 2026-12-31)']]),
  ],
};

const card = (key: string, title: string, status: 'PASS' | 'WARN') => ({
  key,
  title,
  status,
  counts: { PASS: 3, WARN: status === 'WARN' ? 1 : 0, FAIL: 0 },
  metrics: [],
  rows: [{ id: `cockpit.${key}.ok`, group: 'g', title: 'Mục đạt', status: 'PASS', detail: 'ổn', hint: '' }],
});

const COCKPIT = {
  generatedAt: '2026-11-24T05:30:40.000Z',
  phase: 'post-deploy',
  summary: { pass: 55, warn: 15, fail: 0 },
  cards: [
    card('infra', 'Hạ tầng, DB, Redis và HMAC', 'WARN'),
    card('zalo', 'Zalo Mini App, OA và ZNS', 'WARN'),
    card('pancake', 'Pancake và kho', 'PASS'),
    card('waste', 'Gomdon và Đổi rác', 'PASS'),
    card('catalog', 'Catalog, Refill và câu chuyện', 'WARN'),
    card('legal', 'Pháp lý BCT và tên miền', 'PASS'),
  ],
  handover: HANDOVER,
};

function mockAdmin(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/golive/cockpit', COCKPIT);
  api.get('/admin/golive/pilot-orders', { marker: '[TEST]', confirmText: 'XOA DON THU', windowDays: 14, truncated: false, orders: [], counts: { CANCEL: 0, ARCHIVE: 0, MANUAL: 0, DONE: 0 } });
}

for (const vp of [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]) {
  test(`gio-g ${vp.width}px: thẻ bàn giao 0/11, không tràn ngang, mở ZaloPay thấy tên biến kèm Chờ điền`, async ({ page, api }) => {
    await page.setViewportSize(vp);
    mockAdmin(api);
    await page.goto('/admin/gio-g');
    const board = page.getByTestId('gio-g-handover');
    await expect(board.getByRole('heading', { name: 'Cấu hình bên thứ 3 chờ bàn giao Go-Live' })).toBeVisible();
    await expect(board.locator('header')).toContainText('0/11 đã cấu hình');
    const rows = board.getByTestId('gio-g-handover-item');
    await expect(rows).toHaveCount(11);
    await expect(rows.filter({ hasText: 'Chờ điền' })).toHaveCount(11);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Dòng gọn: mỗi việc đóng cao không quá 1/6 màn điện thoại, để một màn thấy được ít nhất 6 việc.
    const heights = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThanOrEqual(812 / 6);

    const zalopay = board.locator('[data-key="zalopay"]');
    await zalopay.locator('summary').click();
    const vars = zalopay.getByRole('list', { name: 'Biến cần điền' }).getByRole('listitem');
    await expect(vars).toHaveText(['ZALOPAY_APP_IDChờ điền', 'ZALOPAY_KEY1Chờ điền', 'ZALOPAY_KEY2Chờ điền']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    const dir = process.env.VISUAL_DIR;
    if (dir) await page.screenshot({ path: `${dir}/gio-g-handover-${vp.width}.png`, fullPage: true });
  });
}
