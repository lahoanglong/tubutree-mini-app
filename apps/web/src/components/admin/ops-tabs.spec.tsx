// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpsHealthTab } from './ops-health-tab';
import { AttendanceTab } from './attendance-tab';
import { RefillTab } from './refill-tab';
import { answerConfirm, byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
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
    const gomdon = c.querySelector('section[aria-label="Gomdon (thu gom tái chế)"]')!;
    expect(gomdon.textContent).toContain('Lỗi 09:30 14/10/2026');
    expect(gomdon.textContent).toContain('Đơn thu gom chờ vận đơn quá 15 phút1');
    expect(c.querySelector('section[aria-label="Báo động Gomdon chưa đóng"]')!.textContent).toContain('tránh giao trùng');
    expect(c.querySelector('section[aria-label="Đơn thu gom chờ vận đơn Gomdon"]')!.textContent).toContain('TUBU2026101417244');
    click(byText(attention, 'button', 'Mở đơn →'));
    expect(onOpenOrder).toHaveBeenCalledWith('TUBU2026101414013');
    expect(smallTouchTargets(c).filter((x) => !x.includes('min-h-[44px]'))).toEqual([]);
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
