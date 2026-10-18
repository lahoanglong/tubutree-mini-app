// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpsHealthTab } from './ops-health-tab';
import { AttendanceTab } from './attendance-tab';
import { RefillTab } from './refill-tab';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { scrollRegionProblems, smallTouchTargets } from '@/test-utils/a11y';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});
const mount = async (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  await flush();
  return r.container;
};

const HEALTH = {
  generatedAt: '2026-10-14T03:00:00.000Z',
  thresholds: { unsyncedMinutes: 30, stuckOrders: 1, webhookFailed: 1, queueFailed1h: 5, repeatHours: 6, gomdonBacklogMinutes: 15 },
  pancake: {
    configured: true,
    lastPushOkAt: '2026-10-14T02:55:00.000Z',
    lastWebhookAt: '2026-10-14T02:58:00.000Z',
    lastWebhookProcessedAt: '2026-10-14T02:58:00.000Z',
    webhookFailed24h: 2,
    webhookFailedOpen: 0,
    webhookStuck: 0,
    failedEvents: [],
    unsynced: 4,
    stuck: 1,
    stuckOrders: [
      {
        id: 'o1',
        code: 'TB-77',
        status: 'CONFIRMED',
        createdAt: '2026-10-14T01:00:00.000Z',
        pancakePushStatus: 'FAILED',
        pancakePushAttempts: 5,
        pancakeLastAttemptAt: '2026-10-14T01:30:00.000Z',
        pancakeSyncError: 'HTTP 500',
      },
    ],
    attention: 0,
    attentionOrders: [],
    catalog: { lastOkAt: '2026-10-14T02:45:00.000Z', lastErrorAt: null, lastError: null, detail: { count: 120, failed: 0 } },
  },
  gomdon: {
    configured: true,
    connection: { lastOkAt: '2026-10-14T02:00:00.000Z', lastErrorAt: null, lastError: null, credentialsRejected: false },
    credentialsRejected: false,
    lastWebhookAt: null,
    webhookFailed24h: 0,
    webhookFailedOpen: 0,
    failedEvents: [],
    openAlerts: 0,
    alerts: [],
    attention: 0,
    backlog: 0,
    backlogOrders: [],
  },
  queues: {
    ok: true,
    items: [
      { name: 'pancake-push', waiting: 0, active: 0, delayed: 1, failed: 30, failedLastHour: 6 },
      { name: 'notifications', waiting: 2, active: 0, delayed: 0, failed: 3, failedLastHour: 0 },
    ],
  },
  problems: [
    { key: 'pancake.stuck', message: '1 đơn quá 30 phút chưa lên Pancake' },
    { key: 'queue.pancake-push', message: 'Hàng đợi pancake-push: 6 job lỗi trong 1 giờ qua' },
  ],
};

describe('OpsHealthTab (PLATFORM-5, ADMINOPS-17)', () => {
  it('hiện sự cố vượt ngưỡng, mốc Pancake/Gomdon, bảng hàng đợi và đơn kẹt; mở đơn kẹt theo mã', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/ops/health': { body: HEALTH } }).fn));
    const onOpenOrder = vi.fn();
    const c = await mount(<OpsHealthTab onOpenOrder={onOpenOrder} />);
    const alert = c.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('2 sự cố đang vượt ngưỡng');
    expect(alert.textContent).toContain('1 đơn quá 30 phút chưa lên Pancake');
    expect(c.textContent).toContain('Đẩy đơn thành công gần nhất09:55 14/10/2026');
    expect(c.textContent).toContain('OK 09:45 14/10/2026 · 120 SP');
    expect(c.textContent).toContain('Đẩy đơn sang Pancake');
    expect(c.textContent).toContain('HTTP 500');
    expect(c.textContent).toContain('· đẩy lỗi · 5 lần thử');
    expect(c.textContent).not.toContain('FAILED');
    click(byText(c, 'button', 'Mở đơn →'));
    expect(onOpenOrder).toHaveBeenCalledWith('TB-77');
    expect(scrollRegionProblems(c)).toEqual([]);
  });

  it('nút đồng bộ Pancake / ghi đè tồn kho / tính lại số đã bán qua hộp xác nhận rồi gọi đúng API', async () => {
    const api = mockFetch({
      '/admin/ops/health': { body: { ...HEALTH, problems: [] } },
      '/admin/pancake/sync': { body: { synced: 12, stockOverwritten: false } },
      '/admin/products/recompute-sold': { body: { updated: 7 } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const c = await mount(<OpsHealthTab />);
    expect(c.textContent).toContain('Mọi chỉ số trong ngưỡng');

    click(byText(c, 'button', 'Đồng bộ danh mục Pancake'));
    await flush();
    answerConfirm(true);
    await flush();
    const sync = api.calls.find((x) => x.url.includes('/admin/pancake/sync'))!;
    expect(sync.url.endsWith('/admin/pancake/sync')).toBe(true);
    expect(sync.init?.method).toBe('POST');
    expect(c.textContent).toContain('Đã đồng bộ 12 sản phẩm từ Pancake.');

    click(byText(c, 'button', 'Đồng bộ + ghi đè tồn kho'));
    await flush();
    answerConfirm(false);
    await flush();
    expect(api.calls.filter((x) => x.url.includes('withStock=1'))).toHaveLength(0);

    click(byText(c, 'button', 'Tính lại số đã bán'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls.some((x) => x.url.includes('/admin/products/recompute-sold') && x.init?.method === 'POST')).toBe(true);
    expect(c.textContent).toContain('Đã tính lại số đã bán cho 7 sản phẩm.');
    expect(smallTouchTargets(c).filter((x) => !x.includes('min-h-[44px]'))).toEqual([]);
  });

  it('Redis không phản hồi: bảng hàng đợi đổi thành thông báo lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/ops/health': { body: { ...HEALTH, queues: { ok: false, error: 'Redis không phản hồi sau 2000ms' } } } }).fn));
    const c = await mount(<OpsHealthTab />);
    expect(c.textContent).toContain('Không đọc được hàng đợi: Redis không phản hồi sau 2000ms');
  });
});

describe('OpsHealthTab — việc cụ thể cần xử lý (R2-PLATFORM-1, R2-ADMINOPS-5, R2-GOMDON-4)', () => {
  const ISSUES = {
    ...HEALTH,
    pancake: {
      ...HEALTH.pancake,
      webhookFailedOpen: 1,
      failedEvents: [
        {
          id: 'evt1',
          source: 'pancake',
          eventType: 'order.status_updated',
          orderRef: 'TUBU2026101411111',
          status: 'FAILED',
          attempts: 15,
          error: 'Không chuyển được trạng thái',
          receivedAt: '2026-10-13T01:00:00.000Z',
        },
      ],
      attention: 1,
      attentionOrders: [
        { id: 'o9', code: 'TUBU2026101414013', pancakeAttention: 'Sửa tay trên Pancake để shipper không thu tiền lần nữa', pancakeAttentionAt: '2026-10-14T02:00:00.000Z' },
      ],
    },
    gomdon: {
      ...HEALTH.gomdon,
      connection: { lastOkAt: '2026-10-14T02:00:00.000Z', lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'HTTP 503', credentialsRejected: false },
      webhookFailedOpen: 1,
      failedEvents: [
        { id: 'g1', source: 'gomdon', eventType: 'trạng thái 3', orderRef: 'TUBU2026101422222', status: 'FAILED', attempts: 3, error: 'boom', receivedAt: '2026-10-14T01:00:00.000Z' },
      ],
      openAlerts: 1,
      alerts: [{ id: 'al1', message: 'Gomdon CÓ vận đơn — tránh giao trùng', createdAt: '2026-10-14T01:30:00.000Z', orderCode: 'TUBU2026101433333' }],
      backlog: 1,
      backlogOrders: [{ id: 'o7', code: 'TUBU2026101417244', createdAt: '2026-10-14T02:10:00.000Z', gomdonStatus: null, paymentMethod: 'COD' }],
    },
  };

  it('liệt kê webhook lỗi (mã đơn, loại sự kiện, số lần thử, lỗi), đơn cần sửa tay Pancake, báo động Gomdon, đơn thu gom chờ vận đơn', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/ops/health': { body: ISSUES } }).fn));
    const onOpenOrder = vi.fn();
    const c = await mount(<OpsHealthTab onOpenOrder={onOpenOrder} />);
    const hooks = c.querySelector('section[aria-label="Webhook lỗi cần xử lý"]')!;
    expect(hooks.textContent).toContain('TUBU2026101411111');
    expect(hooks.textContent).toContain('order.status_updated');
    expect(hooks.textContent).toContain('15 lần thử');
    expect(hooks.textContent).toContain('Không chuyển được trạng thái');
    expect(hooks.textContent).toContain('TUBU2026101422222');
    const pancake = c.querySelector('section[aria-label="Pancake"]')!;
    expect(pancake.textContent).toContain('Webhook lỗi chưa xử lý1');
    const attention = c.querySelector('section[aria-label="Đơn cần xử lý tay trên Pancake"]')!;
    expect(attention.textContent).toContain('TUBU2026101414013');
    expect(attention.textContent).toContain('shipper không thu tiền lần nữa');
    const gomdon = c.querySelector('section[aria-label="Gomdon (thu kèm rác)"]')!;
    expect(gomdon.textContent).toContain('Lỗi 09:30 14/10/2026');
    expect(gomdon.textContent).toContain('Đơn thu gom chờ vận đơn quá 15 phút1');
    expect(c.querySelector('section[aria-label="Báo động Gomdon chưa đóng"]')!.textContent).toContain('tránh giao trùng');
    expect(c.querySelector('section[aria-label="Đơn thu gom chờ vận đơn Gomdon"]')!.textContent).toContain('TUBU2026101417244');
    click(byText(attention, 'button', 'Mở đơn →'));
    expect(onOpenOrder).toHaveBeenCalledWith('TUBU2026101414013');
    expect(smallTouchTargets(c).filter((x) => !x.includes('min-h-[44px]'))).toEqual([]);
  });

  it('đơn đã giao chưa xong việc sau giao: hiện mã đơn, ngày giao và mở đơn theo mã; API cũ không có orders thì không hiện', async () => {
    const withOrders = {
      ...HEALTH,
      orders: { deliveredEffectsPending: 3, deliveredEffectsStale: 1, deliveredEffectsOrders: [{ id: 'o9', code: 'TUBU2026101399999', deliveredAt: '2026-10-13T02:00:00.000Z' }] },
    };
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/ops/health': { body: withOrders } }).fn));
    const onOpenOrder = vi.fn();
    const c = await mount(<OpsHealthTab onOpenOrder={onOpenOrder} />);
    const sec = c.querySelector('section[aria-label="Đơn đã giao chưa xong việc sau giao (3)"]')!;
    expect(sec.textContent).toContain('TUBU2026101399999');
    expect(sec.textContent).toContain('Chạy lại việc sau giao');
    click(byText(sec, 'button', 'Mở đơn →'));
    expect(onOpenOrder).toHaveBeenCalledWith('TUBU2026101399999');

    mounted.forEach((m) => m.unmount());
    mounted = [];
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/ops/health': { body: HEALTH } }).fn));
    const old = await mount(<OpsHealthTab onOpenOrder={onOpenOrder} />);
    expect(old.textContent).not.toContain('chưa xong việc sau giao');
  });

  it('Chạy lại / Đã xử lý (qua xác nhận) / Đóng báo động gọi đúng API', async () => {
    const api = mockFetch({
      '/admin/ops/health': { body: ISSUES },
      '/admin/ops/webhook-events/pancake/evt1/retry': { body: { ok: true, message: 'Đã đưa sự kiện vào hàng đợi xử lý lại.' } },
      '/admin/ops/webhook-events/gomdon/g1/dismiss': { body: { ok: true, message: 'Đã đánh dấu đã xử lý.' } },
      '/admin/gomdon/alerts/al1/resolve': { body: { ok: true } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const c = await mount(<OpsHealthTab />);
    const hooks = c.querySelector('section[aria-label="Webhook lỗi cần xử lý"]')!;
    click(hooks.querySelectorAll('button')[0]!);
    await flush();
    expect(api.calls.some((x) => x.url.endsWith('/admin/ops/webhook-events/pancake/evt1/retry') && x.init?.method === 'POST')).toBe(true);
    expect(c.textContent).toContain('Đã đưa sự kiện vào hàng đợi xử lý lại.');

    const dismiss = [...hooks.querySelectorAll('button')].filter((b) => b.textContent === 'Đã xử lý')[1]!;
    click(dismiss);
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls.some((x) => x.url.endsWith('/admin/ops/webhook-events/gomdon/g1/dismiss') && x.init?.method === 'POST')).toBe(true);

    click(byText(c.querySelector('section[aria-label="Báo động Gomdon chưa đóng"]')!, 'button', 'Đóng báo động'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.calls.some((x) => x.url.endsWith('/admin/gomdon/alerts/al1/resolve') && x.init?.method === 'POST')).toBe(true);
  });
});

describe('OpsHealthTab — webhook tồn kho Pancake không chạy lại', () => {
  it('sự kiện variation.stock_changed chỉ có Đã xử lý, kèm hướng dẫn Đồng bộ danh mục', async () => {
    const STOCK = {
      ...HEALTH,
      pancake: {
        ...HEALTH.pancake,
        webhookFailedOpen: 1,
        failedEvents: [
          { id: 'st1', source: 'pancake', eventType: 'variation.stock_changed', orderRef: null, status: 'FAILED', attempts: 15, error: 'boom', receivedAt: '2026-10-14T01:00:00.000Z' },
        ],
      },
    };
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/ops/health': { body: STOCK } }).fn));
    const c = await mount(<OpsHealthTab />);
    const hooks = c.querySelector('section[aria-label="Webhook lỗi cần xử lý"]')!;
    const labels = [...hooks.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Đã xử lý');
    expect(labels).not.toContain('Chạy lại');
    expect(hooks.textContent).toContain('Đồng bộ danh mục');
  });
});

describe('OpsHealthTab — kênh email báo động (R8)', () => {
  interface EmailChannel {
    state: string;
    recipients: number;
    issues: string[];
    lastOkAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
  }
  const email = (over: Partial<EmailChannel> = {}): EmailChannel => ({
    state: 'READY',
    recipients: 2,
    issues: [],
    lastOkAt: null,
    lastErrorAt: null,
    lastError: null,
    ...over,
  });
  const card = async (channels: unknown) => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/ops/health': { body: { ...HEALTH, alertChannels: channels } } }).fn));
    const c = await mount(<OpsHealthTab />);
    return { c, section: c.querySelector('section[aria-label="Báo động qua email"]') as HTMLElement | null };
  };

  it('đang bật và gửi được: số người nhận và lần gửi gần nhất, không cảnh báo', async () => {
    const { section } = await card({ email: email({ lastOkAt: '2026-10-14T02:30:00.000Z' }) });
    expect(section?.textContent).toContain('Đang bật');
    expect(section?.textContent).toContain('2 địa chỉ');
    expect(section?.textContent).toContain('OK 09:30 14/10/2026');
    expect(section?.querySelector('.text-danger-fg')).toBeNull();
  });

  it('lần gửi gần nhất lỗi: hiện lỗi (đã che bí mật ở API) và tô cảnh báo', async () => {
    const { section } = await card({
      email: email({ lastOkAt: '2026-10-14T01:00:00.000Z', lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'EAUTH: Invalid login: 535 5.7.8 rejected' }),
    });
    expect(section?.textContent).toContain('Lỗi 09:30 14/10/2026');
    expect(section?.textContent).toContain('sai tài khoản hoặc mật khẩu SMTP');
    expect(section?.querySelector('details')?.textContent).toContain('EAUTH: Invalid login: 535 5.7.8 rejected');
    expect(section?.querySelector('.text-danger-fg')).not.toBeNull();
  });

  it('đã gửi lại được sau lỗi: coi là ổn, không còn dòng lỗi', async () => {
    const { section } = await card({
      email: email({ lastOkAt: '2026-10-14T02:30:00.000Z', lastErrorAt: '2026-10-14T01:00:00.000Z', lastError: 'ETIMEDOUT' }),
    });
    expect(section?.textContent).toContain('OK 09:30 14/10/2026');
    expect(section?.textContent).not.toContain('ETIMEDOUT');
  });

  it('chưa bật: nói rõ và chỉ tới biến cần đặt', async () => {
    const { section } = await card({ email: email({ state: 'DISABLED', recipients: 0 }) });
    expect(section?.textContent).toContain('Chưa bật');
    expect(section?.textContent).toContain('OPS_ALERT_EMAIL_TO');
  });

  it('cấu hình dở dang: liệt kê từng lỗi theo khoá, tô cảnh báo', async () => {
    const { section } = await card({
      email: email({ state: 'MISCONFIGURED', recipients: 0, issues: ['SMTP_HOST còn trống: đã đặt cấu hình email nhưng chưa có máy chủ SMTP.'] }),
    });
    expect(section?.textContent).toContain('Cấu hình chưa đủ');
    expect(section?.textContent).toContain('SMTP_HOST còn trống');
    expect(section?.querySelector('.text-danger-fg')).not.toBeNull();
  });

  it('API cũ chưa có alertChannels: không hiện thẻ, không lỗi', async () => {
    const { c, section } = await card(undefined);
    expect(section).toBeNull();
    expect(c.textContent).toContain('Sức khoẻ hệ thống');
  });

  it('thẻ không thêm nút bấm nhỏ hay vùng cuộn lỗi', async () => {
    const { c } = await card({ email: email({ lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'x' }) });
    expect(scrollRegionProblems(c)).toEqual([]);
    expect(smallTouchTargets(c).filter((x) => !x.includes('min-h-[44px]'))).toEqual([]);
  });
});

describe('OpsHealthTab — kênh webhook báo động (R6-ADMIN-4)', () => {
  const EMAIL = { state: 'DISABLED', recipients: 0, issues: [], lastOkAt: null, lastErrorAt: null, lastError: null };
  const webhook = (over: Record<string, unknown> = {}) => ({
    state: 'READY',
    lastOkAt: null,
    lastErrorAt: null,
    lastError: null,
    lastErrorKind: null,
    lastErrorHint: null,
    ...over,
  });
  const card = async (w: unknown) => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/ops/health': { body: { ...HEALTH, alertChannels: { email: EMAIL, webhook: w } } } }).fn));
    const c = await mount(<OpsHealthTab />);
    return c.querySelector('section[aria-label="Báo động qua webhook"]') as HTMLElement | null;
  };

  it('hook bị từ chối vĩnh viễn (410): thẻ hiện lỗi, gợi ý kiểm tra OPS_ALERT_WEBHOOK_URL và chi tiết kỹ thuật', async () => {
    const section = await card(
      webhook({
        lastErrorAt: '2026-10-14T02:30:00.000Z',
        lastError: 'HTTP 410',
        lastErrorKind: 'PERMANENT',
        lastErrorHint: 'Hook báo động bị từ chối hẳn — kiểm tra OPS_ALERT_WEBHOOK_URL.',
      }),
    );
    expect(section?.textContent).toContain('Đang bật');
    expect(section?.textContent).toContain('Lỗi 09:30 14/10/2026');
    expect(section?.textContent).toContain('kiểm tra OPS_ALERT_WEBHOOK_URL');
    expect(section?.querySelector('details')?.textContent).toContain('HTTP 410');
    expect(section?.querySelector('.text-danger-fg')).not.toBeNull();
  });

  it('lỗi tạm thời: nói hệ thống tự gửi lại; gửi được lại sau lỗi thì coi là ổn', async () => {
    const failing = await card(webhook({ lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'HTTP 503', lastErrorKind: 'TRANSIENT' }));
    expect(failing?.textContent).toContain('tự gửi lại');
    const ok = await card(webhook({ lastOkAt: '2026-10-14T03:00:00.000Z', lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'HTTP 503', lastErrorKind: 'TRANSIENT' }));
    expect(ok?.textContent).toContain('OK 10:00 14/10/2026');
    expect(ok?.textContent).not.toContain('HTTP 503');
  });

  it('chưa bật: nói rõ biến cần đặt; API cũ chưa có webhook thì không hiện thẻ', async () => {
    const off = await card(webhook({ state: 'DISABLED' }));
    expect(off?.textContent).toContain('Chưa bật');
    expect(off?.textContent).toContain('OPS_ALERT_WEBHOOK_URL');
    expect(await card(undefined)).toBeNull();
  });
});

describe('OpsHealthTab — lỗi email vĩnh viễn và nút Gửi email thử (R8)', () => {
  const READY = {
    state: 'READY',
    recipients: 2,
    issues: [] as string[],
    lastOkAt: null as string | null,
    lastErrorAt: null as string | null,
    lastError: null as string | null,
    lastErrorKind: null as string | null,
    lastErrorHint: null as string | null,
  };
  const AUTH_HINT = 'Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS. Hệ thống không tự gửi lại liên tục (tránh khoá tài khoản gửi): sửa cấu hình rồi bấm "Gửi email thử".';
  const health = (email: Record<string, unknown>) => ({ ...HEALTH, alertChannels: { email } });
  const TEST_URL = '/admin/ops/alert-email/test';
  const cardOf = (c: HTMLElement) => c.querySelector('section[aria-label="Báo động qua email"]') as HTMLElement;
  const testButton = (c: HTMLElement) => byText(cardOf(c), 'button', /Gửi email thử|Đang gửi/) as HTMLButtonElement | null;

  afterEach(() => vi.restoreAllMocks());

  describe('hiển thị lỗi', () => {
    it('lỗi xác thực SMTP: nêu rõ "Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS", kèm lỗi kỹ thuật đã che bí mật', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          mockFetch({
            '/admin/ops/health': {
              body: health({
                ...READY,
                lastErrorAt: '2026-10-14T02:30:00.000Z',
                lastError: 'EAUTH: Invalid login: 535 5.7.8 Username and Password not accepted',
                lastErrorKind: 'AUTH',
                lastErrorHint: AUTH_HINT,
              }),
            },
          }).fn,
        ),
      );
      const c = await mount(<OpsHealthTab />);
      const card = cardOf(c);
      expect(card.textContent).toContain('Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS');
      expect(card.textContent).toContain('Hệ thống không tự gửi lại liên tục');
      expect(card.querySelector('details')?.textContent).toContain('EAUTH: Invalid login: 535 5.7.8');
      expect(card.textContent).toContain('Lỗi 09:30 14/10/2026');
      expect(card.querySelector('.text-danger-fg')).not.toBeNull();
    });

    it('R5-ADMIN-3: một lỗi chỉ hiện một lần — lời chỉ tiếng Việt, chi tiết kỹ thuật tiếng Anh nằm trong phần thu gọn', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          mockFetch({
            '/admin/ops/health': {
              body: health({
                ...READY,
                lastErrorAt: '2026-10-14T02:30:00.000Z',
                lastError: 'EAUTH: Invalid login: 535 5.7.8 Username and Password not accepted',
                lastErrorKind: 'AUTH',
                lastErrorHint: AUTH_HINT,
              }),
            },
          }).fn,
        ),
      );
      const c = await mount(<OpsHealthTab />);
      const card = cardOf(c);
      const text = card.textContent ?? '';
      expect(text.split('Lỗi xác thực SMTP').length - 1).toBe(1);
      expect(text.split('EAUTH').length - 1).toBe(1);
      expect(text).not.toContain('Lỗi gần nhất');
      const details = card.querySelector('details')!;
      expect(details.open).toBe(false);
      expect(details.querySelector('summary')?.textContent).toBe('Chi tiết kỹ thuật');
      expect(details.textContent).toContain('Username and Password not accepted');
      expect(card.querySelectorAll('details')).toHaveLength(1);
    });

    it('R5-ADMIN-3: lỗi mạng tiếng Anh được dịch, chuỗi gốc chỉ nằm trong Chi tiết kỹ thuật', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(mockFetch({ '/admin/ops/health': { body: health({ ...READY, lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'ETIMEDOUT: Greeting never received', lastErrorKind: 'TRANSIENT' }) } }).fn),
      );
      const c = await mount(<OpsHealthTab />);
      const card = cardOf(c);
      const detail = card.querySelector('details')!;
      expect(card.textContent).toContain('Hết thời gian chờ máy chủ SMTP');
      expect(detail.textContent).toContain('ETIMEDOUT: Greeting never received');
      const outside = (card.textContent ?? '').replace(detail.textContent ?? '', '');
      expect(outside).not.toContain('Greeting never received');
    });

    it('máy chủ từ chối vĩnh viễn: hiện lời chỉ tới người nhận/địa chỉ gửi', async () => {
      const hint = 'Máy chủ SMTP từ chối vĩnh viễn — kiểm tra OPS_ALERT_EMAIL_TO, SMTP_FROM và quyền gửi của tài khoản.';
      vi.stubGlobal(
        'fetch',
        vi.fn(mockFetch({ '/admin/ops/health': { body: health({ ...READY, lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'EENVELOPE: 550 5.1.1 User unknown', lastErrorKind: 'PERMANENT', lastErrorHint: hint }) } }).fn),
      );
      const c = await mount(<OpsHealthTab />);
      expect(cardOf(c).textContent).toContain('OPS_ALERT_EMAIL_TO, SMTP_FROM');
    });

    it('lỗi tạm thời: chỉ có dòng lỗi gần nhất, không có lời chỉ sửa cấu hình', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(mockFetch({ '/admin/ops/health': { body: health({ ...READY, lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'ETIMEDOUT', lastErrorKind: 'TRANSIENT' }) } }).fn),
      );
      const c = await mount(<OpsHealthTab />);
      expect(cardOf(c).textContent).toContain('Hết thời gian chờ máy chủ SMTP');
      expect(cardOf(c).querySelector('details')?.textContent).toContain('ETIMEDOUT');
      expect(cardOf(c).textContent).not.toContain('SMTP_USER/SMTP_PASS');
    });

    it('đã gửi lại được sau lỗi vĩnh viễn (gửi thử thành công): hết lời chỉ và dòng lỗi', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          mockFetch({
            '/admin/ops/health': {
              body: health({ ...READY, lastOkAt: '2026-10-14T03:00:00.000Z', lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'EAUTH: 535', lastErrorKind: 'AUTH', lastErrorHint: AUTH_HINT }),
            },
          }).fn,
        ),
      );
      const c = await mount(<OpsHealthTab />);
      expect(cardOf(c).textContent).toContain('OK 10:00 14/10/2026');
      expect(cardOf(c).textContent).not.toContain('Lỗi xác thực SMTP');
      expect(cardOf(c).textContent).not.toContain('EAUTH');
    });

    it('API cũ chưa có lastErrorKind/lastErrorHint: vẫn hiện lỗi gần nhất như trước', async () => {
      const { lastErrorKind: _k, lastErrorHint: _h, ...old } = READY;
      vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/ops/health': { body: health({ ...old, lastErrorAt: '2026-10-14T02:30:00.000Z', lastError: 'EAUTH: 535' }) } }).fn));
      const c = await mount(<OpsHealthTab />);
      expect(cardOf(c).textContent).toContain('sai tài khoản hoặc mật khẩu SMTP');
      expect(cardOf(c).querySelector('details')?.textContent).toContain('EAUTH: 535');
    });
  });

  describe('nút Gửi email thử', () => {
    const mountReady = async (extra: Parameters<typeof mockFetch>[0] = {}, props: { isAdmin?: boolean } = {}, email: Record<string, unknown> = READY) => {
      const api = mockFetch({ '/admin/ops/health': { body: health(email) }, ...extra });
      vi.stubGlobal('fetch', vi.fn(api.fn));
      const c = await mount(<OpsHealthTab {...props} />);
      return { api, c };
    };
    const testCalls = (api: ReturnType<typeof mockFetch>) => api.calls.filter((x) => x.url.includes(TEST_URL));

    it('có nút trên thẻ khi kênh đang bật; bấm → hộp xác nhận trong trang (không dùng window.confirm), Huỷ thì không gọi API', async () => {
      const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { api, c } = await mountReady();
      const btn = testButton(c);
      expect(btn?.textContent).toBe('Gửi email thử');
      expect(btn?.disabled).toBe(false);
      click(btn);
      await flush();
      const dialog = confirmDialog();
      expect(dialog?.textContent).toContain('Gửi email thử?');
      expect(dialog?.textContent).toContain('2 địa chỉ nhận báo động');
      answerConfirm(false);
      await flush();
      expect(testCalls(api)).toHaveLength(0);
      expect(confirmDialog()).toBeNull();
      expect(nativeConfirm).not.toHaveBeenCalled();
    });

    it('xác nhận → POST đúng endpoint, hiện lời xác nhận từ API ngay trên thẻ, tải lại sức khoẻ, nút dùng lại được', async () => {
      const { api, c } = await mountReady({ [TEST_URL]: { body: { ok: true, message: 'Đã gửi email thử tới 2 địa chỉ nhận. Kiểm tra hộp thư (cả thư rác) để xác nhận.' } } });
      const healthBefore = api.calls.filter((x) => x.url.includes('/admin/ops/health')).length;
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      const calls = testCalls(api);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.init?.method).toBe('POST');
      expect(calls[0]!.url.endsWith(TEST_URL)).toBe(true);
      const status = cardOf(c).querySelector('[role="status"]');
      expect(status?.textContent).toContain('Đã gửi email thử tới 2 địa chỉ nhận');
      expect(api.calls.filter((x) => x.url.includes('/admin/ops/health')).length).toBeGreaterThan(healthBefore);
      expect(testButton(c)?.disabled).toBe(false);
      expect(testButton(c)?.textContent).toBe('Gửi email thử');
    });

    it('API từ chối (sai xác thực): thông báo ngắn trỏ tới dòng lỗi trên thẻ, không lặp lại lời chỉ hay lỗi tiếng Anh', async () => {
      const message = `Gửi email thử lỗi — ${AUTH_HINT} Chi tiết: EAUTH: Invalid login: 535 5.7.8 Username and Password not accepted`;
      const failed = { ...READY, lastErrorAt: '2026-10-14T03:05:00.000Z', lastError: 'EAUTH: Invalid login: 535 5.7.8 Username and Password not accepted', lastErrorKind: 'AUTH', lastErrorHint: AUTH_HINT };
      let tested = false;
      const { c } = await mountReady({
        '/admin/ops/health': () => ({ body: health(tested ? failed : READY) }),
        [TEST_URL]: () => ((tested = true), { status: 502, body: { message } }),
      });
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      const alert = cardOf(c).querySelector('[role="alert"]')!;
      expect(alert.textContent).toContain('Gửi email thử không thành công');
      expect(alert.textContent).not.toContain('EAUTH');
      expect(alert.textContent).not.toContain('SMTP_USER');
      expect(cardOf(c).querySelector('[role="status"]')).toBeNull();
      const text = cardOf(c).textContent ?? '';
      expect(text.split('Lỗi xác thực SMTP').length - 1).toBe(1);
      expect(text.split('EAUTH').length - 1).toBe(1);
    });

    it('R5-ADMIN-3: gửi thử lỗi vì nguyên nhân khác lỗi cron cũ: thẻ tải lại, chỉ còn nguyên nhân mới (không hai lời chỉ trái nhau)', async () => {
      const before = { ...READY, lastErrorAt: '2026-10-14T02:55:00.000Z', lastError: 'EAUTH: Invalid login: 535 5.7.8 Authentication credentials invalid', lastErrorKind: 'AUTH', lastErrorHint: AUTH_HINT };
      const after = { ...READY, lastErrorAt: '2026-10-14T03:10:00.000Z', lastError: 'ETIMEDOUT: Greeting never received', lastErrorKind: 'TRANSIENT', lastErrorHint: null };
      let tested = false;
      const { api, c } = await mountReady(
        {
          '/admin/ops/health': () => ({ body: health(tested ? after : before) }),
          [TEST_URL]: () => ((tested = true), { status: 502, body: { message: 'Gửi email thử lỗi: ETIMEDOUT: Greeting never received' } }),
        },
        {},
        before,
      );
      expect(cardOf(c).textContent).toContain('Lỗi xác thực SMTP');
      const healthBefore = api.calls.filter((x) => x.url.includes('/admin/ops/health')).length;
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      expect(api.calls.filter((x) => x.url.includes('/admin/ops/health')).length).toBe(healthBefore + 1);
      const text = cardOf(c).textContent ?? '';
      expect(text).toContain('Hết thời gian chờ máy chủ SMTP');
      expect(text).toContain('Lỗi 10:10 14/10/2026');
      expect(text).not.toContain('Lỗi xác thực SMTP');
      expect(text).not.toContain('SMTP_USER/SMTP_PASS');
      expect(text.split('Greeting never received').length - 1).toBe(1);
      expect(cardOf(c).querySelector('[role="alert"]')?.textContent).toContain('Gửi email thử không thành công');
    });

    it('R5-ADMIN-3: gửi thử thành công sau lỗi: thẻ tải lại, hết lời chỉ và dòng lỗi cũ', async () => {
      const before = { ...READY, lastErrorAt: '2026-10-14T02:55:00.000Z', lastError: 'EAUTH: 535', lastErrorKind: 'AUTH', lastErrorHint: AUTH_HINT };
      const after = { ...READY, lastOkAt: '2026-10-14T03:10:00.000Z', lastErrorAt: '2026-10-14T02:55:00.000Z', lastError: 'EAUTH: 535', lastErrorKind: 'AUTH', lastErrorHint: AUTH_HINT };
      let tested = false;
      const { c } = await mountReady(
        {
          '/admin/ops/health': () => ({ body: health(tested ? after : before) }),
          [TEST_URL]: () => ((tested = true), { body: { ok: true, message: 'Đã gửi email thử tới 2 địa chỉ nhận.' } }),
        },
        {},
        before,
      );
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      const text = cardOf(c).textContent ?? '';
      expect(text).toContain('OK 10:10 14/10/2026');
      expect(text).not.toContain('Lỗi xác thực SMTP');
      expect(cardOf(c).querySelector('details')).toBeNull();
      expect(cardOf(c).querySelector('[role="status"]')?.textContent).toContain('Đã gửi email thử');
    });

    it('R5-ADMIN-3: không tải lại được thẻ sau khi gửi thử lỗi: thông báo mang nguyên nhân đã dịch, vẫn không có chữ Anh thô', async () => {
      let tested = false;
      const { c } = await mountReady({
        '/admin/ops/health': () => (tested ? { status: 500, body: { message: 'boom' } } : { body: health(READY) }),
        [TEST_URL]: () => ((tested = true), { status: 502, body: { message: 'Gửi email thử lỗi: ETIMEDOUT: Greeting never received' } }),
      });
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      const alert = cardOf(c).querySelector('[role="alert"]')!;
      expect(alert.textContent).toContain('Gửi email thử không thành công');
      expect(alert.textContent).toContain('Hết thời gian chờ máy chủ SMTP');
      expect(alert.textContent).not.toContain('Greeting never received');
    });

    it('chưa cấu hình/dở dang ở phía API (400): hiện lý do API trả', async () => {
      const { c } = await mountReady({ [TEST_URL]: { status: 400, body: { message: 'Cấu hình email chưa đủ: SMTP_HOST còn trống.' } } });
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      expect(cardOf(c).querySelector('[role="alert"]')?.textContent).toContain('SMTP_HOST còn trống');
    });

    it('bấm quá 5 lần/phút (429): báo bằng tiếng Việt, không in chữ Throttler thô', async () => {
      const { c } = await mountReady({ [TEST_URL]: { status: 429, body: { message: 'ThrottlerException: Too Many Requests' } } });
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      const alert = cardOf(c).querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('quá nhiều lần');
      expect(alert?.textContent).not.toContain('Throttler');
    });

    it('mất mạng: báo lỗi mạng, nút dùng lại được', async () => {
      const api = mockFetch({ '/admin/ops/health': { body: health(READY) } });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url.includes(TEST_URL)) throw new TypeError('Failed to fetch');
          return api.fn(url, init);
        }),
      );
      const c = await mount(<OpsHealthTab />);
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      expect(cardOf(c).querySelector('[role="alert"]')?.textContent).toContain('Mất kết nối');
      expect(testButton(c)?.disabled).toBe(false);
    });

    it('khoá nút và đổi chữ "Đang gửi…" trong lúc gửi; bấm thêm không gửi lần hai', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const api = mockFetch({ '/admin/ops/health': { body: health(READY) } });
      let posts = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url.includes(TEST_URL)) {
            posts += 1;
            await gate;
            return new Response(JSON.stringify({ ok: true, message: 'Đã gửi email thử tới 2 địa chỉ nhận.' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
          }
          return api.fn(url, init);
        }),
      );
      const c = await mount(<OpsHealthTab />);
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      const busy = testButton(c)!;
      expect(busy.textContent).toBe('Đang gửi…');
      expect(busy.disabled).toBe(true);
      expect(busy.getAttribute('aria-busy')).toBe('true');
      click(busy);
      await flush();
      expect(confirmDialog()).toBeNull();
      expect(posts).toBe(1);
      release();
      await flush();
      expect(posts).toBe(1);
      expect(testButton(c)?.textContent).toBe('Gửi email thử');
      expect(testButton(c)?.disabled).toBe(false);
      expect(cardOf(c).querySelector('[role="status"]')?.textContent).toContain('Đã gửi email thử');
    });

    it('chỉ ADMIN: không có nút khi isAdmin=false (cùng luật với endpoint @Roles ADMIN)', async () => {
      const { c } = await mountReady({}, { isAdmin: false });
      expect(testButton(c)).toBeNull();
      expect(cardOf(c).textContent).toContain('Đang bật');
    });

    it.each([
      ['chưa bật', { ...READY, state: 'DISABLED', recipients: 0 }],
      ['cấu hình dở dang', { ...READY, state: 'MISCONFIGURED', recipients: 0, issues: ['SMTP_HOST còn trống: đã đặt cấu hình email nhưng chưa có máy chủ SMTP.'] }],
    ])('không có nút khi kênh %s (chưa có gì để thử)', async (_n, email) => {
      const { c } = await mountReady({}, {}, email);
      expect(testButton(c)).toBeNull();
    });

    it('nút và thông báo không thêm nút nhỏ hay vùng cuộn lỗi', async () => {
      const { c } = await mountReady({ [TEST_URL]: { body: { ok: true, message: 'Đã gửi email thử tới 2 địa chỉ nhận.' } } });
      click(testButton(c));
      await flush();
      answerConfirm(true);
      await flush();
      expect(smallTouchTargets(c).filter((x) => !x.includes('min-h-[44px]'))).toEqual([]);
      expect(scrollRegionProblems(c)).toEqual([]);
    });
  });
});

describe('AttendanceTab — Chốt ra ca (ADMINOPS-17)', () => {
  it('liệt kê người đang trong ca kèm tên; Chốt ra ca qua hộp xác nhận rồi gửi đúng phiên', async () => {
    const live = [
      {
        id: 's1',
        staffId: 'u1',
        checkinAt: '2026-10-14T01:00:00.000Z',
        lastHeartbeatAt: '2026-10-14T02:59:00.000Z',
        outOfRangeCount: 2,
        isLate: true,
        shift: {
          id: 'sh1',
          workDate: '2026-10-14T00:00:00.000Z',
          startAt: '2026-10-14T01:00:00.000Z',
          endAt: '2026-10-14T10:00:00.000Z',
          approvedStart: null,
          approvedEnd: null,
          staff: { id: 'u1', fullName: 'Trần Bình', phone: '0911000111' },
        },
      },
    ];
    const api = mockFetch({
      '/admin/attendance/live': { body: live },
      '/admin/attendance/manual-checkout': { body: { checkedOut: true } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const c = await mount(<AttendanceTab />);
    expect(c.textContent).toContain('Trần Bình');
    expect(c.textContent).toContain('ca 08:00–17:00 ngày 14/10/2026');
    expect(c.textContent).toContain('Đi trễ');
    expect(c.textContent).toContain('Ngoài vùng 2 nhịp');
    click(byText(c, 'button', 'Chốt ra ca'));
    await flush();
    expect(document.body.querySelector('[role="alertdialog"]')!.textContent).toContain('Lương ngày 14/10/2026 được tính lại');
    answerConfirm(true);
    await flush();
    const post = api.calls.find((x) => x.url.includes('/admin/attendance/manual-checkout'))!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ sessionId: 's1' });
    expect(c.textContent).toContain('Đã chốt ra ca và tính lại lương ngày đó.');
  });

  it('API báo tháng đã chốt → hiện lỗi danger', async () => {
    const live = [
      {
        id: 's1',
        staffId: 'u1',
        checkinAt: '2026-09-30T01:00:00.000Z',
        lastHeartbeatAt: '2026-09-30T02:59:00.000Z',
        outOfRangeCount: 0,
        isLate: false,
        shift: { id: 'sh1', workDate: '2026-09-30T00:00:00.000Z', startAt: '2026-09-30T01:00:00.000Z', endAt: '2026-09-30T10:00:00.000Z', approvedStart: null, approvedEnd: null, staff: null },
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        mockFetch({
          '/admin/attendance/live': { body: live },
          '/admin/attendance/manual-checkout': { status: 400, body: { message: 'Tháng lương đã chốt/đã trả — mở lại tháng trước khi sửa.' } },
        }).fn,
      ),
    );
    const c = await mount(<AttendanceTab />);
    click(byText(c, 'button', 'Chốt ra ca'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Tháng lương đã chốt');
  });
});

describe('RefillTab — duyệt đổi vỏ chai trên web admin', () => {
  const PENDING = [
    { id: 'b1', quantity: 5, seedsAwarded: 50, status: 'PENDING', createdAt: '2026-10-14T01:00:00.000Z', user: { id: 'u1', fullName: 'Lê Cúc', phone: '0922000222' } },
  ];

  it('duyệt với số vỏ thực nhận ít hơn khai; số ngoài 1..khai thì khoá nút Duyệt', async () => {
    const api = mockFetch({ '/refill/admin/pending': { body: PENDING }, '/refill/admin/b1/approve': { body: { ok: true } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const c = await mount(<RefillTab />);
    expect(c.textContent).toContain('Lê Cúc');
    expect(c.textContent).toContain('Khai 5 vỏ');
    const input = c.querySelector('input')!;
    typeInto(input, '9');
    await flush();
    const approve = byText(c, 'button', 'Duyệt') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(c.textContent).toContain('Số vỏ thực nhận từ 1 tới 5.');
    typeInto(input, '3');
    await flush();
    click(approve);
    await flush();
    const post = api.calls.find((x) => x.url.includes('/refill/admin/b1/approve'))!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ receivedQuantity: 3 });
  });

  it('từ chối hỏi lý do rồi gửi kèm lý do', async () => {
    const api = mockFetch({ '/refill/admin/pending': { body: PENDING }, '/refill/admin/b1/reject': { body: { ok: true } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const c = await mount(<RefillTab />);
    click(byText(c, 'button', 'Từ chối'));
    await flush();
    typeInto(document.body.querySelector('[role="alertdialog"] textarea'), 'vỏ không đúng loại');
    answerConfirm(true);
    await flush();
    const post = api.calls.find((x) => x.url.includes('/refill/admin/b1/reject'))!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ reason: 'vỏ không đúng loại' });
  });
});
