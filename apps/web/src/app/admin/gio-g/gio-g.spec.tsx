// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerAsk, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { CockpitBoard } from './cockpit-board';
import { PilotOrdersPanel } from './pilot-orders-panel';
import { cardFixLinks, rowFixLink, splitPhones, type CockpitCard, type GoLiveCockpit, type HandoverBoard, type PilotCleanupResult, type PilotOrderRow, type PilotOrdersView } from './golive-api';

const auth = vi.hoisted(() => ({ value: { user: { role: 'ADMIN' } as { role: string } | null, status: 'authenticated', initialized: true } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.value }));

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  auth.value = { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
});

const card = (key: CockpitCard['key'], over: Partial<CockpitCard> = {}): CockpitCard => ({
  key,
  title: `Thẻ ${key}`,
  status: 'PASS',
  counts: { PASS: 1, WARN: 0, FAIL: 0 },
  metrics: [],
  rows: [{ id: `cockpit.${key}.ok`, group: 'g', title: 'Mục đạt', status: 'PASS', detail: 'ổn', hint: '' }],
  ...over,
});

const COCKPIT: GoLiveCockpit = {
  generatedAt: '2026-11-21T05:00:00.000Z',
  phase: 'post-deploy',
  summary: { pass: 20, warn: 1, fail: 2 },
  cards: [
    card('infra', {
      status: 'FAIL',
      counts: { PASS: 3, WARN: 0, FAIL: 1 },
      rows: [{ id: 'env.phone_hmac', group: 'env', title: 'Khoá HMAC SĐT', status: 'FAIL', detail: 'chưa đặt', hint: 'Đặt PHONE_HMAC_KEY trong .env' }],
    }),
    card('zalo'),
    card('pancake'),
    card('waste', { metrics: [{ label: 'Gửi rác qua bưu điện', value: 'TẮT' }] }),
    card('catalog', {
      status: 'FAIL',
      counts: { PASS: 2, WARN: 1, FAIL: 1 },
      metrics: [{ label: 'Cặp Refill', value: '12/16' }],
      rows: [
        { id: 'cockpit.catalog.active_skus', group: 'cockpit', title: 'SKU đang bán', status: 'FAIL', detail: '0 sản phẩm', hint: '' },
        { id: 'cockpit.catalog.refill_pairs', group: 'cockpit', title: 'Cặp Refill', status: 'WARN', detail: '12/16, còn 3 gần đúng', hint: 'Ghép tay' },
      ],
    }),
    card('legal'),
  ],
};

describe('golive-api: link sửa', () => {
  it('dòng đạt và dòng chỉ sửa trên máy chủ không có link; dòng còn lại tới đúng tab', () => {
    expect(rowFixLink({ id: 'cockpit.catalog.refill_pairs', status: 'PASS' }, 'catalog')).toBeNull();
    for (const id of ['env.phone_hmac', 'redis.reachable', 'backup.recent', 'db.migrations_pending', 'db.required_migrations']) {
      expect(rowFixLink({ id, status: 'FAIL' }, 'infra')).toBeNull();
    }
    const href = (id: string, c: CockpitCard['key']) => rowFixLink({ id, status: 'WARN' }, c)?.href;
    expect(href('cockpit.catalog.refill_pairs', 'catalog')).toBe('/admin?tab=refillPairs');
    expect(href('cockpit.catalog.inci', 'catalog')).toBe('/admin?tab=catalogQuality&filter=missing_ingredients');
    expect(rowFixLink({ id: 'cockpit.catalog.inci', status: 'PASS' }, 'catalog')).toBeNull();
    expect(href('cockpit.catalog.story', 'catalog')).toBe('/admin?tab=productCategories');
    expect(href('db.demo_coupons', 'catalog')).toBe('/admin?tab=coupons');
    expect(href('db.admin_user', 'infra')).toBe('/admin?tab=users');
    expect(href('db.zns_templates', 'zalo')).toBe('/admin?tab=notificationTemplates');
    expect(href('cockpit.zns.required', 'zalo')).toBe('/admin?tab=notificationTemplates');
    expect(href('db.legal_policies', 'legal')).toBe('/admin?tab=config');
    expect(href('db.ops_thresholds', 'infra')).toBe('/admin?tab=config');
    expect(href('cockpit.pancake.recent_sync', 'pancake')).toBe('/admin?tab=opsHealth');
    expect(href('cockpit.waste.lane_mailin', 'waste')).toBe('/admin?tab=waste');
    // Biến thể chưa gắn Pancake: mở thẳng chip "Chưa gắn Pancake" ở bàn đối soát tồn, không phải trang Sức khoẻ chung.
    expect(href('cockpit.pancake.unlinked_variants', 'pancake')).toBe('/admin/doi-soat-kho?flag=UNLINKED');
  });

  it('thẻ "Pancake và kho" có thêm link Đối soát tồn kho; thẻ catalog mở Kiểm tra catalog; thẻ khác một link', () => {
    expect(cardFixLinks('pancake').map((l) => l.href)).toEqual(['/admin?tab=opsHealth', '/admin/doi-soat-kho']);
    expect(cardFixLinks('catalog').map((l) => l.href)).toEqual(['/admin?tab=catalogQuality']);
    expect(cardFixLinks('legal')).toHaveLength(1);
  });

  it('ô SĐT tách theo phẩy/chấm phẩy/xuống dòng, bỏ trùng và khoảng trắng', () => {
    expect(splitPhones(' 0901 234 567, 0912345678;0901234567\n')).toEqual(['0901234567', '0912345678']);
    expect(splitPhones('')).toEqual([]);
  });
});

const HANDOVER: HandoverBoard = {
  title: 'Cấu hình bên thứ 3 chờ bàn giao Go-Live',
  configured: 3,
  total: 4,
  items: [
    {
      key: 'zalopay',
      title: 'Merchant ZaloPay',
      owner: 'Chủ shop (hợp đồng ZaloPay)',
      guide: 'Lấy App ID, Key1, Key2 bản production.',
      state: 'pending',
      required: true,
      configured: false,
      status: 'FAIL',
      vars: [
        { name: 'ZALOPAY_APP_ID', configured: true, optional: false },
        { name: 'ZALOPAY_KEY1', configured: false, optional: false },
        { name: 'ZALOPAY_KEY2', configured: false, optional: false },
      ],
      checks: [{ id: 'env.zalopay', title: 'Merchant ZaloPay', status: 'FAIL', detail: 'chỉ có ZALOPAY_APP_ID' }],
    },
    {
      key: 'phone_hmac',
      title: 'Khoá mã băm số điện thoại',
      owner: 'Kỹ thuật (máy chủ)',
      guide: 'Sinh bằng openssl rand -hex 32.',
      state: 'configured',
      required: true,
      configured: true,
      status: 'PASS',
      vars: [{ name: 'PHONE_HMAC_SECRET', configured: true, optional: false }],
      checks: [{ id: 'env.phone_hmac', title: 'PHONE_HMAC_SECRET cho mã băm số điện thoại', status: 'PASS', detail: 'đã đặt, 64 ký tự' }],
    },
    {
      key: 'ops_alerts',
      title: 'Báo động ra ngoài app',
      owner: 'Kỹ thuật và người trực',
      guide: 'OPS_ALERT_ENV_LABEL tuỳ chọn: PROD để trống.',
      state: 'configured',
      required: true,
      configured: true,
      status: 'PASS',
      vars: [
        { name: 'OPS_ALERT_WEBHOOK_URL', configured: true, optional: false },
        { name: 'OPS_ALERT_ENV_LABEL', configured: false, optional: true },
      ],
      checks: [
        { id: 'env.ops.webhook', title: 'Webhook báo động', status: 'PASS', detail: 'host hooks.slack.com' },
        { id: 'env.ops.label', title: 'Nhãn môi trường trong tiêu đề báo động', status: 'WARN', detail: 'OPS_ALERT_ENV_LABEL chưa đặt' },
      ],
    },
    {
      key: 'demo_coupons',
      title: 'Mã giảm giá demo',
      owner: 'Chủ shop (PO)',
      guide: 'Chốt tắt hay giữ từng mã demo.',
      state: 'configured',
      required: true,
      configured: true,
      status: 'WARN',
      vars: [],
      checks: [{ id: 'db.demo_coupons', title: 'Mã giảm giá demo', status: 'WARN', detail: 'còn dùng được: đã chấp nhận giữ: WELCOME30' }],
    },
    {
      key: 'backup_offsite',
      title: 'Backup hằng đêm ra ngoài máy chủ',
      owner: 'Kỹ thuật (VPS)',
      guide: 'RCLONE_REMOTE phải là remote rclone kiểu crypt.',
      state: 'host',
      required: false,
      configured: false,
      status: 'WARN',
      vars: [],
      checks: [{ id: 'backup.cron', title: 'Cron backup hằng ngày', status: 'WARN', detail: 'không kiểm được: không đọc được crontab' }],
    },
    {
      key: 'zns_templates',
      title: 'Mã mẫu ZNS do Zalo duyệt',
      owner: 'Chủ shop (quyết) và chủ Zalo OA',
      guide: 'Đợt này không nộp mẫu ORDER_CONFIRMED và ORDER_SHIPPING.',
      state: 'optional',
      required: false,
      configured: false,
      status: 'WARN',
      vars: [],
      checks: [{ id: 'db.zns_templates', title: 'Mẫu ZNS đã có mã Zalo duyệt', status: 'WARN', detail: '2/2 mẫu chưa có mã Zalo' }],
    },
  ],
};

describe('CockpitBoard', () => {
  const mount = async (body: GoLiveCockpit = COCKPIT) => {
    const m = mockFetch({ '/admin/golive/cockpit': { body } });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<CockpitBoard />);
    mounted.push(r);
    await flush(8);
    return { c: r.container, calls: m.calls };
  };

  it('6 thẻ xanh/vàng/đỏ, số dạng tabular-nums, banner đỏ khi còn mục chặn', async () => {
    const { c } = await mount();
    const cards = c.querySelectorAll('[data-testid^="gio-g-card-"]');
    expect([...cards].map((e) => e.getAttribute('data-status'))).toEqual(['FAIL', 'PASS', 'PASS', 'PASS', 'FAIL', 'PASS']);
    expect(c.querySelector('section')?.className).toContain('tabular-nums');
    expect(c.querySelector('[data-testid="gio-g-summary"]')?.textContent).toContain('Chưa mở bán được: còn 2 mục đỏ');
    expect(c.querySelector('[data-testid="gio-g-card-catalog"]')?.textContent).toContain('12/16');
  });

  it('mục chưa đạt có link tới đúng trang sửa; mục .env ghi sửa trên máy chủ', async () => {
    const { c } = await mount();
    const refill = c.querySelector('[data-check="cockpit.catalog.refill_pairs"]')!;
    expect(refill.querySelector('a')?.getAttribute('href')).toBe('/admin?tab=refillPairs');
    const skus = c.querySelector('[data-check="cockpit.catalog.active_skus"]')!;
    expect(skus.querySelector('a')?.getAttribute('href')).toBe('/admin?tab=productCategories');
    const hmac = c.querySelector('[data-check="env.phone_hmac"]')!;
    expect(hmac.querySelector('a')).toBeNull();
    expect(hmac.textContent).toContain('Sửa trên máy chủ');
    const cardLink = c.querySelector('[data-testid="gio-g-card-legal"] a:last-of-type');
    expect(cardLink?.getAttribute('href')).toBe('/admin?tab=config');
    const pancakeLinks = [...c.querySelectorAll('[data-testid="gio-g-card-pancake"] a')].map((a) => [a.getAttribute('href'), a.textContent]);
    expect(pancakeLinks).toEqual([
      ['/admin?tab=opsHealth', 'Mở Sức khoẻ hệ thống'],
      ['/admin/doi-soat-kho', 'Mở Đối soát tồn kho'],
    ]);
  });

  it('API chưa trả khối bàn giao (bản trước w25-03): không vẽ thẻ bàn giao, 6 thẻ vẫn đủ', async () => {
    const { c } = await mount();
    expect(c.querySelector('[data-testid="gio-g-handover"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid^="gio-g-card-"]')).toHaveLength(6);
  });

  it('thẻ "Cấu hình bên thứ 3 chờ bàn giao Go-Live": đếm việc bắt buộc, mỗi việc một trạng thái kèm người phụ trách, nằm trên 6 thẻ', async () => {
    const { c } = await mount({ ...COCKPIT, handover: HANDOVER });
    const card = c.querySelector('[data-testid="gio-g-handover"]')!;
    expect(card.querySelector('h3')?.textContent).toBe('Cấu hình bên thứ 3 chờ bàn giao Go-Live');
    expect(card.querySelector('header')?.textContent).toContain('3/4 việc bắt buộc đã cấu hình');
    expect(card.textContent).toContain('1 việc kiểm tay trên máy chủ, 1 việc tuỳ chọn chủ quyết, không tính vào bộ đếm.');
    // Còn việc đặt dở dang (đỏ) thì viền và nhãn đếm tô đỏ, không vàng.
    expect(card.className).toContain('border-danger-fg');
    expect(card.querySelector('header > span:last-child')?.className).toContain('bg-danger-bg');
    expect(card.compareDocumentPosition(c.querySelector('[data-testid="gio-g-card-infra"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = [...card.querySelectorAll('[data-testid="gio-g-handover-item"]')];
    expect(rows.map((r) => [r.getAttribute('data-key'), r.getAttribute('data-state'), r.querySelector('summary')?.textContent])).toEqual([
      ['zalopay', 'pending', 'Merchant ZaloPayChủ shop (hợp đồng ZaloPay)Chờ điền'],
      ['phone_hmac', 'configured', 'Khoá mã băm số điện thoạiKỹ thuật (máy chủ)Đã cấu hình'],
      ['ops_alerts', 'configured', 'Báo động ra ngoài appKỹ thuật và người trựcĐã cấu hình'],
      ['demo_coupons', 'configured', 'Mã giảm giá demoChủ shop (PO)Đã cấu hình'],
      ['backup_offsite', 'host', 'Backup hằng đêm ra ngoài máy chủKỹ thuật (VPS)Kiểm tay'],
      ['zns_templates', 'optional', 'Mã mẫu ZNS do Zalo duyệtChủ shop (quyết) và chủ Zalo OATuỳ chọn'],
    ]);
    expect(rows.map((r) => r.querySelector('summary > span:last-of-type')?.className.match(/bg-(success|warning|danger|info)-bg|bg-stone-100/)?.[0])).toEqual([
      'bg-danger-bg',
      'bg-success-bg',
      'bg-success-bg',
      'bg-success-bg',
      'bg-info-bg',
      'bg-stone-100',
    ]);
    // Summary dạng flex mất tam giác mặc định: mũi tên lật khi mở cho biết bấm được.
    for (const r of rows) expect(r.querySelector('summary > svg[aria-hidden="true"]')?.getAttribute('class')).toContain('group-open:rotate-180');
  });

  it('chỉ còn việc thiếu (không đỏ) thì viền vàng; đủ việc bắt buộc thì xanh dù còn việc kiểm tay và tuỳ chọn', async () => {
    const zalopayDone = { ...HANDOVER.items[0]!, state: 'configured' as const, configured: true, status: 'PASS' as const };
    const zalopayMissing = { ...HANDOVER.items[0]!, status: 'WARN' as const };
    const withItems = (first: (typeof HANDOVER.items)[number], configured: number) => ({ ...HANDOVER, configured, items: [first, ...HANDOVER.items.slice(1)] });
    const warn = await mount({ ...COCKPIT, handover: withItems(zalopayMissing, 3) });
    expect(warn.c.querySelector('[data-testid="gio-g-handover"]')?.className).toContain('border-warning-fg');
    const done = await mount({ ...COCKPIT, handover: withItems(zalopayDone, 4) });
    const card = done.c.querySelector('[data-testid="gio-g-handover"]')!;
    expect(card.className).toContain('border-success-fg');
    expect(card.querySelector('header')?.textContent).toContain('4/4 việc bắt buộc đã cấu hình');
  });

  it('mở một việc: biến chỉ có tên và Đã điền / Chờ điền / Tuỳ chọn, cách lấy, lời bộ kiểm; việc sửa được trong quản trị có link', async () => {
    const { c } = await mount({ ...COCKPIT, handover: HANDOVER });
    const row = (key: string) => c.querySelector(`[data-testid="gio-g-handover-item"][data-key="${key}"]`)!;
    const vars = (key: string) => [...row(key).querySelectorAll('[aria-label="Biến cần điền"] li')].map((li) => li.textContent);
    expect(vars('zalopay')).toEqual(['ZALOPAY_APP_IDĐã điền', 'ZALOPAY_KEY1Chờ điền', 'ZALOPAY_KEY2Chờ điền']);
    expect(vars('ops_alerts')).toEqual(['OPS_ALERT_WEBHOOK_URLĐã điền', 'OPS_ALERT_ENV_LABELTuỳ chọn']);
    expect(row('ops_alerts').querySelector('[data-check="env.ops.label"]')?.textContent).toBe('Nhãn môi trường trong tiêu đề báo động: OPS_ALERT_ENV_LABEL chưa đặt');
    expect(row('zalopay').textContent).toContain('Lấy App ID, Key1, Key2 bản production.');
    expect(row('zalopay').querySelector('[data-check="env.zalopay"]')?.textContent).toBe('Merchant ZaloPay: chỉ có ZALOPAY_APP_ID');
    expect(row('zalopay').querySelector('a')).toBeNull();
    expect(row('zns_templates').querySelector('a')?.getAttribute('href')).toBe('/admin?tab=notificationTemplates');
    expect(row('demo_coupons').querySelector('a')?.getAttribute('href')).toBe('/admin?tab=coupons');
    expect(row('phone_hmac').querySelector('[data-check]')).toBeNull();
    expect(row('zns_templates').querySelector('[aria-label="Biến cần điền"]')).toBeNull();
  });

  it('"Kiểm lại" gọi lại với fresh=1', async () => {
    const { c, calls } = await mount();
    expect(calls[0]!.url).toMatch(/\/admin\/golive\/cockpit$/);
    click(byText(c, 'button', 'Kiểm lại'));
    await flush(8);
    expect(calls.some((x) => x.url.endsWith('/admin/golive/cockpit?fresh=1'))).toBe(true);
  });
});

const prow = (code: string, action: PilotOrderRow['action'], over: Partial<PilotOrderRow> = {}): PilotOrderRow => ({
  code,
  status: 'CONFIRMED',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  total: 64_000,
  createdAt: '2026-11-20T03:00:00.000Z',
  matchedBy: ['NOTE_MARKER'],
  phone: '090***4567',
  action,
  reason: `lý do ${code}`,
  optInEligible: false,
  ...over,
});

describe('PilotOrdersPanel', () => {
  const VIEW: PilotOrdersView = {
    marker: '[PILOT]',
    confirmText: 'XOA DON THU',
    windowDays: 45,
    truncated: false,
    orders: [prow('TB1', 'CANCEL'), prow('TB2', 'MANUAL', { paymentStatus: 'PAID' }), prow('TB3', 'ARCHIVE', { status: 'DELIVERED' })],
    counts: { CANCEL: 1, ARCHIVE: 1, MANUAL: 1, DONE: 0 },
  };
  const result = (dryRun: boolean): PilotCleanupResult => ({
    dryRun,
    orders: [VIEW.orders[0]!, VIEW.orders[2]!],
    affected: { ordersCancelled: 1, statusHistoryRows: 1, ordersArchived: 1, auditLogRows: 1 },
    cancelled: ['TB1'],
    archived: ['TB3'],
    skipped: [],
    failed: [],
    auditLogId: dryRun ? null : 'log_1',
    auditError: null,
  });

  const mount = async () => {
    const m = mockFetch({
      '/admin/golive/pilot-orders/cleanup': (init) => ({ body: result(JSON.parse(String(init?.body)).dryRun) }),
      '/admin/golive/pilot-orders': { body: VIEW },
    });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<PilotOrdersPanel />);
    mounted.push(r);
    await flush(8);
    const posts = () => m.calls.filter((x) => x.url.includes('/cleanup')).map((x) => JSON.parse(String(x.init?.body)));
    return { c: r.container, calls: m.calls, posts };
  };

  it('tìm theo SĐT người thử gửi ?phones=; danh sách hiện việc sẽ làm của từng đơn', async () => {
    const { c, calls } = await mount();
    expect(c.querySelectorAll('[data-testid="pilot-row"]')).toHaveLength(3);
    expect(c.querySelector('[data-code="TB2"]')?.textContent).toContain('Làm tay');
    typeInto(c.querySelector('input'), '0901 234 567, 0912345678');
    click(byText(c, 'button', 'Tìm đơn thử'));
    await flush(8);
    expect(calls.at(-1)!.url).toContain('/admin/golive/pilot-orders?phones=0901234567%2C0912345678');
  });

  it('Xem trước chỉ gửi đơn Sẽ huỷ + Ghi sổ (không gửi đơn Làm tay), dryRun true, không câu xác nhận', async () => {
    const { c, posts } = await mount();
    click(byText(c, 'button', 'Xem trước dọn 2 đơn'));
    await flush(8);
    expect(posts()).toEqual([{ dryRun: true, codes: ['TB1', 'TB3'], phones: [] }]);
    expect(c.querySelector('[data-testid="pilot-preview"]')?.textContent).toContain('Huỷ 1 đơn');
  });

  it('đơn chỉ khớp SĐT đủ điều kiện có ô "Chọn dọn" 44px; tick thì đơn vào lượt xem trước kèm optInCodes, lượt thật gửi lại đúng mã đã tick', async () => {
    const view: PilotOrdersView = {
      ...VIEW,
      orders: [
        prow('TB1', 'CANCEL'),
        prow('TB4', 'MANUAL', { matchedBy: ['TEST_PHONE'], optInEligible: true }),
        prow('TB5', 'MANUAL', { matchedBy: ['TEST_PHONE'], paymentStatus: 'PAID' }),
      ],
    };
    const res = (dryRun: boolean, codes: string[]): PilotCleanupResult => ({
      ...result(dryRun),
      cancelled: codes,
      archived: [],
      affected: { ordersCancelled: codes.length, statusHistoryRows: codes.length, ordersArchived: 0, auditLogRows: 1 },
    });
    const m = mockFetch({
      '/admin/golive/pilot-orders/cleanup': (init) => {
        const b = JSON.parse(String(init?.body));
        return { body: res(b.dryRun, b.codes) };
      },
      '/admin/golive/pilot-orders': { body: view },
    });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<PilotOrdersPanel />);
    mounted.push(r);
    await flush(8);
    const c = r.container;
    const posts = () => m.calls.filter((x) => x.url.includes('/cleanup')).map((x) => JSON.parse(String(x.init?.body)));
    expect(c.querySelector('[data-code="TB5"] [data-testid="pilot-optin"]')).toBeNull();
    const opt = c.querySelector<HTMLElement>('[data-code="TB4"] [data-testid="pilot-optin"]')!;
    expect(opt.className).toContain('min-h-[44px]');
    click(opt.querySelector('input'));
    await flush();
    expect(c.querySelector('[data-code="TB4"]')!.textContent).toContain('Sẽ huỷ');
    click(byText(c, 'button', 'Xem trước dọn 2 đơn'));
    await flush(8);
    expect(posts()).toEqual([{ dryRun: true, codes: ['TB1', 'TB4'], phones: [], optInCodes: ['TB4'] }]);
    expect(c.querySelector('[data-testid="pilot-preview-optin"]')!.textContent).toContain('1/1 đơn chỉ khớp SĐT');
    click(byText(c, 'button', 'Dọn thật…'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('TB4');
    answerAsk('XOA DON THU');
    await flush(8);
    expect(posts()[1]).toEqual({ dryRun: false, codes: ['TB1', 'TB4'], phones: [], optInCodes: ['TB4'], confirmText: 'XOA DON THU' });
  });

  it('bỏ tick sau khi xem trước thì xoá bản xem trước (phải xem lại)', async () => {
    const view: PilotOrdersView = { ...VIEW, orders: [prow('TB1', 'CANCEL'), prow('TB4', 'MANUAL', { matchedBy: ['TEST_PHONE'], optInEligible: true })] };
    const m = mockFetch({ '/admin/golive/pilot-orders/cleanup': () => ({ body: result(true) }), '/admin/golive/pilot-orders': { body: view } });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<PilotOrdersPanel />);
    mounted.push(r);
    await flush(8);
    click(byText(r.container, 'button', 'Xem trước dọn 1 đơn'));
    await flush(8);
    expect(r.container.querySelector('[data-testid="pilot-preview"]')).not.toBeNull();
    click(r.container.querySelector('[data-code="TB4"] [data-testid="pilot-optin"] input'));
    await flush();
    expect(r.container.querySelector('[data-testid="pilot-preview"]')).toBeNull();
  });

  it('hơn 50 đơn dọn được: Xem trước chỉ gửi 50 mã đầu (trần mỗi lượt của API), phần còn lại để lượt sau', async () => {
    const many = Array.from({ length: 60 }, (_, i) => prow(`TB${100 + i}`, 'CANCEL'));
    const m = mockFetch({
      '/admin/golive/pilot-orders/cleanup': () => ({ body: { ...result(true), orders: many.slice(0, 50) } }),
      '/admin/golive/pilot-orders': { body: { ...VIEW, orders: many, counts: { CANCEL: 60, ARCHIVE: 0, MANUAL: 0, DONE: 0 } } },
    });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<PilotOrdersPanel />);
    mounted.push(r);
    await flush(8);
    click(byText(r.container, 'button', 'Xem trước dọn 50 đơn'));
    await flush(8);
    const posts = m.calls.filter((x) => x.url.includes('/cleanup')).map((x) => JSON.parse(String(x.init?.body)));
    expect(posts).toHaveLength(1);
    expect(posts[0].codes).toEqual(many.slice(0, 50).map((o) => o.code));
    expect(r.container.textContent).toContain('còn 10 đơn');
  });

  it('Dọn thật: hộp xác nhận khoá nút tới khi gõ đúng XOA DON THU, rồi gửi dryRun false đúng mã đã xem trước', async () => {
    const { c, posts } = await mount();
    click(byText(c, 'button', 'Xem trước dọn 2 đơn'));
    await flush(8);
    click(byText(c, 'button', 'Dọn thật…'));
    await flush(2);
    const d = confirmDialog()!;
    expect(d).not.toBeNull();
    const accept = d.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;
    typeInto(d.querySelector('textarea'), 'xoa don thu');
    await flush(2);
    expect(accept.disabled).toBe(true);
    expect(posts()).toHaveLength(1);
    typeInto(d.querySelector('textarea'), 'XOA DON THU');
    await flush(2);
    expect(accept.disabled).toBe(false);
    click(accept);
    await flush(10);
    expect(posts().at(-1)).toEqual({ dryRun: false, codes: ['TB1', 'TB3'], phones: [], confirmText: 'XOA DON THU' });
    expect(c.querySelector('[data-testid="pilot-done"]')?.textContent).toContain('log_1');
  });

  it('đã huỷ nhưng ghi sổ lỗi: báo vàng, nói rõ đơn đã huỷ và chưa ghi sổ, không báo "Chưa dọn"', async () => {
    const m = mockFetch({
      '/admin/golive/pilot-orders/cleanup': (init) => {
        const dryRun = JSON.parse(String(init?.body)).dryRun as boolean;
        return { body: dryRun ? result(true) : { ...result(false), auditLogId: null, auditError: 'Chưa ghi được sổ thao tác quản trị (P1001).' } };
      },
      '/admin/golive/pilot-orders': { body: VIEW },
    });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<PilotOrdersPanel />);
    mounted.push(r);
    await flush(8);
    click(byText(r.container, 'button', 'Xem trước dọn 2 đơn'));
    await flush(8);
    click(byText(r.container, 'button', 'Dọn thật…'));
    await flush(2);
    const d = confirmDialog()!;
    typeInto(d.querySelector('textarea'), 'XOA DON THU');
    await flush(2);
    click(d.querySelector('[data-confirm="accept"]'));
    await flush(10);
    const done = r.container.querySelector('[data-testid="pilot-done"]')!.textContent!;
    expect(done).toContain('Đã huỷ 1 đơn');
    expect(done).toContain('Chưa ghi được sổ thao tác quản trị (P1001).');
    expect(r.container.textContent).not.toContain('Chưa dọn');
  });

  it('huỷ hộp xác nhận thì không gửi lệnh dọn thật', async () => {
    const { c, posts } = await mount();
    click(byText(c, 'button', 'Xem trước dọn 2 đơn'));
    await flush(8);
    click(byText(c, 'button', 'Dọn thật…'));
    await flush(2);
    click(confirmDialog()!.querySelector('[data-confirm="cancel"]'));
    await flush(6);
    expect(posts().filter((p) => p.dryRun === false)).toHaveLength(0);
  });
});

describe('/admin/gio-g: chỉ ADMIN', () => {
  it('nhân viên thấy lời từ chối, trang không gọi API nào', async () => {
    const { default: Page } = await import('./page');
    auth.value = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    const m = mockFetch({});
    vi.stubGlobal('fetch', m.fn);
    const r = render(<Page />);
    mounted.push(r);
    await flush(4);
    expect(r.container.textContent).toContain('Chỉ quản trị viên mới xem được Bảng kiểm Giờ G.');
    expect(m.calls).toHaveLength(0);
  });

  it('ADMIN thấy tiêu đề và cả hai khối', async () => {
    const { default: Page } = await import('./page');
    const m = mockFetch({ '/admin/golive/cockpit': { body: COCKPIT }, '/admin/golive/pilot-orders': { body: { ...COCKPIT_EMPTY_PILOT } } });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<Page />);
    mounted.push(r);
    await flush(8);
    expect(r.container.querySelector('h1')?.textContent).toBe('Bảng kiểm Giờ G');
    expect(r.container.querySelectorAll('[data-testid^="gio-g-card-"]')).toHaveLength(6);
    expect(r.container.textContent).toContain('Không có đơn thử nào.');
  });
});

const COCKPIT_EMPTY_PILOT: PilotOrdersView = {
  marker: '[PILOT]',
  confirmText: 'XOA DON THU',
  windowDays: 45,
  truncated: false,
  orders: [],
  counts: { CANCEL: 0, ARCHIVE: 0, MANUAL: 0, DONE: 0 },
};
