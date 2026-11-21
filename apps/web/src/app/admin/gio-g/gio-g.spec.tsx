// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { CockpitBoard } from './cockpit-board';
import { PilotOrdersPanel } from './pilot-orders-panel';
import { rowFixLink, splitPhones, type CockpitCard, type GoLiveCockpit, type PilotCleanupResult, type PilotOrderRow, type PilotOrdersView } from './golive-api';

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
    expect(href('cockpit.catalog.inci', 'catalog')).toBe('/admin?tab=catalogQuality');
    expect(href('db.demo_coupons', 'catalog')).toBe('/admin?tab=coupons');
    expect(href('db.admin_user', 'infra')).toBe('/admin?tab=users');
    expect(href('db.zns_templates', 'zalo')).toBe('/admin?tab=notificationTemplates');
    expect(href('cockpit.zns.required', 'zalo')).toBe('/admin?tab=notificationTemplates');
    expect(href('db.legal_policies', 'legal')).toBe('/admin?tab=config');
    expect(href('db.ops_thresholds', 'infra')).toBe('/admin?tab=config');
    expect(href('cockpit.pancake.recent_sync', 'pancake')).toBe('/admin?tab=opsHealth');
    expect(href('cockpit.waste.lane_mailin', 'waste')).toBe('/admin?tab=waste');
  });

  it('ô SĐT tách theo phẩy/chấm phẩy/xuống dòng, bỏ trùng và khoảng trắng', () => {
    expect(splitPhones(' 0901 234 567, 0912345678;0901234567\n')).toEqual(['0901234567', '0912345678']);
    expect(splitPhones('')).toEqual([]);
  });
});

describe('CockpitBoard', () => {
  const mount = async () => {
    const m = mockFetch({ '/admin/golive/cockpit': { body: COCKPIT } });
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
