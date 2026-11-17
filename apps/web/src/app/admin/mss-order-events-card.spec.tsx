// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MssOrderEventsCard as Card } from '@/lib/admin-client';
import { MssOrderEventsCard } from './mss-order-events-card';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const mount = () => {
  const r = render(<MssOrderEventsCard />);
  mounted.push(r);
  return r;
};

const URL_PART = '/admin/mss/order-events';
const offCard = (): Card => ({
  enabled: false,
  open: false,
  rolloutPct: 0,
  circuit: { state: 'closed', consecutiveFailures: 0, openUntil: null, lastFailureKind: null },
  waiting: 0,
  awaitingResult: 0,
  sent24h: 0,
  failed24h: 0,
  fallbackZns24h: 0,
  recent: [],
});
let seq = 0;
const row = (over: Partial<Card['recent'][number]> = {}): Card['recent'][number] => ({
  eventId: `01JCX9Z7Q4M8T2K5V6W3Y0AB${String(seq++).padStart(2, '0')}`,
  orderCode: 'TB2611170001',
  eventType: 'order.shipping',
  status: 'RESULT_SENT',
  reason: null,
  attempts: 1,
  phone: '0912***678',
  fallbackChannel: null,
  createdAt: '2026-11-17T01:00:00.000Z',
  updatedAt: '2026-11-17T01:02:00.000Z',
  ...over,
});
const stub = (card: Card | null, cancel?: () => { status?: number; body: unknown }) => {
  const m = mockFetch({
    [`${URL_PART}/cancel-pending`]: cancel ?? (() => ({ body: { cancelled: 0 } })),
    [URL_PART]: card ? { body: card } : { status: 500, body: { message: 'boom' } },
  });
  vi.stubGlobal('fetch', m.fn);
  return m;
};
const stats = (r: Rendered) => Array.from(r.container.querySelectorAll('dl[aria-label="Số tin đơn qua MSS"] > div')).map((d) => d.textContent);

describe('MssOrderEventsCard', () => {
  it('mặc định PROD (cờ tắt, chưa có tin): nhãn Tắt, nói rõ tin đi ZNS như cũ, 5 ô số 0, không danh sách, không nút dừng', async () => {
    stub(offCard());
    const r = mount();
    await flush(10);
    const text = r.container.textContent!;
    expect(text).toContain('Tin đơn hàng qua MSS');
    expect(text).toContain('Tắt');
    expect(text).toContain('tin đơn gửi ZNS như cũ');
    expect(stats(r)).toEqual(['Chờ gửi0', 'MSS đang xử lý0', 'Tới Zalo (24 giờ)0', 'Hỏng (24 giờ)0', 'Lui về ZNS (24 giờ)0']);
    expect(r.container.querySelector('ul[aria-label="Tin đơn gần nhất"]')).toBeNull();
    expect(byText(r.container, 'button', 'Dừng tin chờ gửi')).toBeNull();
  });

  it('cờ bật, có hiệu lực: tỉ lệ, số đếm, 10 tin gần nhất với SĐT đã che, nhãn trạng thái và lui về ZNS', async () => {
    const card = offCard();
    Object.assign(card, { enabled: true, open: true, rolloutPct: 25, waiting: 2, awaitingResult: 3, sent24h: 40, failed24h: 1, fallbackZns24h: 1 });
    card.recent = [
      row({ status: 'EXPIRED', reason: 'mss_unavailable', fallbackChannel: 'ZNS', attempts: 6, eventType: 'order.created' }),
      ...Array.from({ length: 14 }, () => row()),
    ];
    stub(card);
    const r = mount();
    await flush(10);
    const text = r.container.textContent!;
    expect(text).toContain('Đang chạy');
    expect(text).toContain('tỉ lệ 25%');
    expect(stats(r)).toEqual(['Chờ gửi2', 'MSS đang xử lý3', 'Tới Zalo (24 giờ)40', 'Hỏng (24 giờ)1', 'Lui về ZNS (24 giờ)1']);
    const items = Array.from(r.container.querySelectorAll('ul[aria-label="Tin đơn gần nhất"] > li'));
    expect(items).toHaveLength(10);
    expect(items[0]!.textContent).toContain('TB2611170001 · Đặt đơn');
    expect(items[0]!.textContent).toContain('Quá hạn');
    expect(items[0]!.textContent).toContain('Đã gửi ZNS');
    expect(items[0]!.textContent).toContain('mss_unavailable');
    expect(items[0]!.textContent).toContain('6 lần gửi');
    expect(items[1]!.textContent).toContain('Đã tới Zalo');
    expect(text).toContain('0912***678');
    expect(text).not.toMatch(/0912\d{6}/);
  });

  it('cờ bật mà MSS chưa công bố năng lực: Chưa có hiệu lực; cầu dao ngắt: nhãn riêng', async () => {
    stub({ ...offCard(), enabled: true });
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toContain('Chưa có hiệu lực');
    r.unmount();
    mounted = [];
    stub({ ...offCard(), enabled: true, open: true, circuit: { state: 'open', consecutiveFailures: 10, openUntil: null, lastFailureKind: 'timeout' } });
    const r2 = mount();
    await flush(10);
    expect(r2.container.textContent).toContain('Cầu dao ngắt');
  });

  it('dừng tin chờ: hỏi xác nhận trước; huỷ hộp thoại thì không gọi API; đồng ý thì POST và báo số tin đã dừng', async () => {
    const m = stub({ ...offCard(), enabled: true, open: true, waiting: 3 }, () => ({ body: { cancelled: 3 } }));
    const r = mount();
    await flush(10);
    const btn = byText(r.container, 'button', 'Dừng tin chờ gửi');
    expect(btn).not.toBeNull();
    click(btn);
    await flush(5);
    expect(confirmDialog()!.textContent).toContain('3 tin chưa gửi');
    answerConfirm(false);
    await flush(5);
    expect(m.calls.filter((c) => c.url.includes('cancel-pending'))).toHaveLength(0);
    click(byText(r.container, 'button', 'Dừng tin chờ gửi'));
    await flush(5);
    answerConfirm(true);
    await flush(10);
    const posts = m.calls.filter((c) => c.url.includes('cancel-pending'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.init?.method).toBe('POST');
    expect(r.container.querySelector('[role="status"]')!.textContent).toContain('Đã dừng 3 tin chờ gửi');
  });

  it('API lỗi: báo riêng trong thẻ, không ném', async () => {
    stub(null);
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toContain('Không đọc được tin đơn hàng qua MSS');
  });

  it('mã đơn và lý do dài không tràn ngang ở 360px: cột chữ min-w-0, mã và lý do break-all', async () => {
    stub({ ...offCard(), enabled: true, open: true, recent: [row({ reason: 'a_very_long_reason_code_from_mss_that_has_no_spaces_at_all' })] });
    const r = mount();
    await flush(10);
    const li = r.container.querySelector('ul[aria-label="Tin đơn gần nhất"] > li')!;
    expect(li.querySelector('.min-w-0')).not.toBeNull();
    expect(li.querySelectorAll('.break-all')).toHaveLength(2);
  });
});
