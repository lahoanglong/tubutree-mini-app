// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReviewsTab } from './reviews-tab';
import { SubscriptionsTab } from './subscriptions-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, selectValue, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Reply = { status?: number; body: unknown };
function stub(handler: (url: string, init?: RequestInit) => Reply) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = handler(url, init);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

const REVIEW = {
  id: 'r1',
  rating: 1,
  comment: 'Hàng dở, đừng mua',
  images: ['https://cdn.example.com/a.jpg', 'javascript:alert(1)'],
  videoUrl: 'https://cdn.example.com/v.mp4',
  isVisible: true,
  isVerified: true,
  createdAt: '2026-10-01T03:00:00.000Z',
  user: { id: 'u1', fullName: 'Nguyễn An', phone: '0900000001' },
  product: { id: 'p1', name: 'Nước rửa chén Lá Sả', slug: 'nuoc-rua-chen' },
};
const page = <T,>(data: T[], total = data.length, p = 1) => ({ data, meta: { page: p, limit: 20, total } });

// C-092 (A1-031): API có route ẩn/hiện đánh giá (§6.13) nhưng admin web không có màn nào để dùng.
describe('ReviewsTab', () => {
  it('liệt kê đánh giá: sao, nội dung, sản phẩm, khách, trạng thái; ảnh/video chỉ nhận https', async () => {
    const calls = stub(() => ({ body: page([REVIEW, { ...REVIEW, id: 'r2', rating: 5, isVisible: false, isVerified: false, images: [], videoUrl: null, comment: null }]) }));
    const { container } = mount(<ReviewsTab />);
    await flush();
    expect(calls[0]!.url).toContain('/admin/reviews?page=1&limit=20');
    const t = container.textContent ?? '';
    const stars = container.querySelector('[role="img"][aria-label="1 sao"]')!;
    expect(stars.querySelectorAll('svg')).toHaveLength(5);
    expect(stars.querySelectorAll('svg.fill-current')).toHaveLength(1);
    expect(t).toContain('Hàng dở, đừng mua');
    expect(t).toContain('Nước rửa chén Lá Sả');
    expect(t).toContain('Nguyễn An · 0900000001');
    expect(t).toContain('Đang hiện');
    expect(t).toContain('Đã ẩn');
    expect(t).toContain('Đã mua hàng');
    const imgs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(imgs).toEqual(['https://cdn.example.com/a.jpg']);
    const video = container.querySelector<HTMLAnchorElement>('a[href="https://cdn.example.com/v.mp4"]');
    expect(video?.getAttribute('rel')).toContain('noopener');
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('lọc: chip "Đã ẩn" và số sao gửi đúng tham số, về trang 1', async () => {
    const calls = stub(() => ({ body: page([REVIEW]) }));
    const { container } = mount(<ReviewsTab />);
    await flush();
    click(byText(container, 'button[role="tab"]', 'Đã ẩn'));
    await flush();
    expect(calls.at(-1)!.url).toContain('visibility=hidden');
    selectValue(container.querySelector('select[aria-label="Lọc theo số sao"]'), '1');
    await flush();
    expect(calls.at(-1)!.url).toContain('rating=1');
    expect(calls.at(-1)!.url).toContain('page=1');
  });

  it('ẩn đánh giá: hỏi xác nhận trước, chưa xác nhận thì CHƯA gọi API; xác nhận → POST /reviews/:id/visibility {isVisible:false} rồi tải lại', async () => {
    const calls = stub((url) => (url.includes('/visibility') ? { body: { ok: true, isVisible: false } } : { body: page([REVIEW]) }));
    const { container } = mount(<ReviewsTab />);
    await flush();
    click(byText(container, 'button', 'Ẩn đánh giá'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('Nước rửa chén Lá Sả');
    expect(calls.some((c) => c.url.includes('/visibility'))).toBe(false);
    answerConfirm(true);
    await flush();
    const post = calls.find((c) => c.url.includes('/reviews/r1/visibility'))!;
    expect(post.init?.method).toBe('POST');
    expect(JSON.parse(String(post.init?.body))).toEqual({ isVisible: false });
    expect(calls.filter((c) => c.url.includes('/admin/reviews')).length).toBeGreaterThanOrEqual(2);
  });

  it('huỷ xác nhận → không gọi API', async () => {
    const calls = stub(() => ({ body: page([REVIEW]) }));
    const { container } = mount(<ReviewsTab />);
    await flush();
    click(byText(container, 'button', 'Ẩn đánh giá'));
    await flush();
    answerConfirm(false);
    await flush();
    expect(calls.some((c) => c.url.includes('/visibility'))).toBe(false);
  });

  it('đánh giá đang ẩn → nút "Hiện lại" gửi isVisible:true; lỗi từ API hiện nguyên văn', async () => {
    const calls = stub((url) =>
      url.includes('/visibility') ? { status: 404, body: { message: 'Không tìm thấy đánh giá.' } } : { body: page([{ ...REVIEW, isVisible: false }]) },
    );
    const { container } = mount(<ReviewsTab />);
    await flush();
    click(byText(container, 'button', 'Hiện lại'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(JSON.parse(String(calls.find((c) => c.url.includes('/visibility'))!.init?.body))).toEqual({ isVisible: true });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Không tìm thấy đánh giá.');
  });

  it('phân trang: tổng 45 → "Trang 1/3", bấm Sau gọi page=2', async () => {
    const calls = stub((url) => ({ body: page([REVIEW], 45, url.includes('page=2') ? 2 : 1) }));
    const { container } = mount(<ReviewsTab />);
    await flush();
    expect(container.textContent).toContain('Trang 1/3');
    click(byText(container, 'button', 'Sau'));
    await flush();
    expect(calls.at(-1)!.url).toContain('page=2');
    expect(container.textContent).toContain('Trang 2/3');
  });

  it('danh sách rỗng và lỗi tải', async () => {
    stub(() => ({ body: page([]) }));
    const a = mount(<ReviewsTab />);
    await flush();
    expect(a.container.textContent).toMatch(/không có đánh giá nào/i);

    stub(() => ({ status: 500, body: { message: 'Lỗi máy chủ' } }));
    const b = mount(<ReviewsTab />);
    await flush();
    expect(b.container.querySelector('[role="alert"]')?.textContent).toContain('Lỗi máy chủ');
  });
});

const SUB = {
  id: 's1',
  status: 'ACTIVE',
  quantity: 2,
  intervalWeeks: 4,
  nextRunAt: '2026-11-01T00:00:00.000Z',
  lastOrderId: 'o9',
  createdAt: '2026-09-01T00:00:00.000Z',
  user: { id: 'u1', fullName: 'Nguyễn An', phone: '0900000001' },
  variation: { id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', product: { id: 'p1', name: 'Nước rửa chén Lá Sả' } },
};

describe('ReviewsTab — ảnh theo đường dẫn (L3-03)', () => {
  it('đánh giá đang hiện: ảnh mở thẳng qua đường dẫn công khai của API, không tải qua token', async () => {
    const r = { ...REVIEW, images: ['/reviews/r1/images/0?v=0123456789'], videoUrl: null };
    const calls = stub(() => ({ body: page([r]) }));
    const { container } = mount(<ReviewsTab />);
    await flush();
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/\/reviews\/r1\/images\/0\?v=0123456789$/);
    expect(calls).toHaveLength(1);
  });

  it('đánh giá đã ẩn: ảnh lấy qua route admin bằng fetch có token rồi hiện blob', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:review-hidden');
    URL.revokeObjectURL = vi.fn();
    const hidden = { ...REVIEW, id: 'r2', isVisible: false, images: ['/admin/reviews/r2/images/0?v=0123456789'], videoUrl: null };
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('/admin/reviews/r2/images/0')) return new Response('x', { status: 200, headers: { 'Content-Type': 'image/png' } });
        return new Response(JSON.stringify(page([hidden])), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<ReviewsTab />);
    for (let i = 0; i < 5; i++) await flush();
    expect(calls.some((u) => u.endsWith('/admin/reviews/r2/images/0?v=0123456789'))).toBe(true);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:review-hidden');
  });
});

describe('SubscriptionsTab', () => {
  it('liệt kê gói định kỳ: khách, sản phẩm × số lượng, chu kỳ, lần giao kế tiếp, trạng thái; chỉ xem', async () => {
    const calls = stub(() => ({ body: page([SUB, { ...SUB, id: 's2', status: 'PAUSED' }, { ...SUB, id: 's3', status: 'CANCELLED', lastOrderId: null }]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    expect(calls[0]!.url).toContain('/admin/subscriptions?page=1&limit=20');
    const t = container.textContent ?? '';
    expect(t).toContain('Nguyễn An · 0900000001');
    expect(t).toContain('Nước rửa chén Lá Sả · Chai 500ml (NRC-500) × 2');
    expect(t).toContain('4 tuần/lần');
    expect(t).toContain('Đang chạy');
    expect(t).toContain('Tạm dừng');
    expect(t).toContain('Đã huỷ');
    expect(t).toMatch(/khách tự tạm dừng/i);
    expect(container.querySelectorAll('button:not([role="tab"])').length).toBe(0);
  });

  it('lọc theo trạng thái gửi status=PAUSED', async () => {
    const calls = stub(() => ({ body: page([SUB]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    click(byText(container, 'button[role="tab"]', 'Tạm dừng'));
    await flush();
    expect(calls.at(-1)!.url).toContain('status=PAUSED');
  });

  it('rỗng và lỗi', async () => {
    stub(() => ({ body: page([]) }));
    const a = mount(<SubscriptionsTab />);
    await flush();
    expect(a.container.textContent).toMatch(/chưa có gói định kỳ nào/i);

    stub(() => ({ status: 500, body: { message: 'Lỗi máy chủ' } }));
    const b = mount(<SubscriptionsTab />);
    await flush();
    expect(b.container.querySelector('[role="alert"]')?.textContent).toContain('Lỗi máy chủ');
  });
});

describe('SubscriptionsTab — lý do tạm dừng (W142A)', () => {
  const paused = (id: string, pausedReason?: string | null) => ({ ...SUB, id, status: 'PAUSED', ...(pausedReason === undefined ? {} : { pausedReason }) });
  const rows = (container: HTMLElement) => Array.from(container.querySelectorAll('article'));
  const badgeOf = (row: Element, label: string) => Array.from(row.querySelectorAll('span')).find((s) => s.textContent === label);

  it.each([
    ['customer', 'Khách tự dừng'],
    ['insufficient_wallet', 'Ví không đủ số dư'],
    ['invalid_address', 'Địa chỉ lỗi'],
    ['inactive_product', 'Ngừng bán'],
    ['cod_limit', 'Vượt hạn mức COD'],
    ['partner_goods', 'Hàng đối tác'],
  ])('gói PAUSED lý do %s hiện huy hiệu "%s" cạnh trạng thái', async (code, label) => {
    stub(() => ({ body: page([paused('s2', code)]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    const row = rows(container)[0]!;
    expect(badgeOf(row, 'Tạm dừng')).toBeTruthy();
    expect(badgeOf(row, label)).toBeTruthy();
  });

  it('hệ thống tự dừng thì huy hiệu đỏ kèm chú thích, khách tự dừng thì trung tính', async () => {
    stub(() => ({ body: page([paused('s2', 'insufficient_wallet'), paused('s3', 'customer')]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    const [system, customer] = rows(container);
    const systemBadge = badgeOf(system!, 'Ví không đủ số dư')!;
    expect(systemBadge.className).toContain('bg-danger-bg');
    expect(systemBadge.getAttribute('title')).toBe('Hệ thống tự tạm dừng gói này');
    const customerBadge = badgeOf(customer!, 'Khách tự dừng')!;
    expect(customerBadge.className).toContain('bg-stone-100');
    expect(customerBadge.hasAttribute('title')).toBe(false);
  });

  it.each([[null], [undefined], [''], ['mã_lạ_của_api_mới'], ['constructor']])('lý do %p: "Chưa rõ lý do", không lộ mã thô, không đoán', async (reason) => {
    stub(() => ({ body: page([paused('s2', reason as string | null | undefined)]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    const row = rows(container)[0]!;
    const badge = badgeOf(row, 'Chưa rõ lý do')!;
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('bg-stone-100');
    if (reason) expect(row.textContent).not.toContain(reason);
  });

  it('gói không PAUSED không hiện huy hiệu lý do dù dữ liệu còn sót mã', async () => {
    stub(() => ({
      body: page([
        { ...SUB, id: 's1', status: 'ACTIVE', pausedReason: 'customer' },
        { ...SUB, id: 's3', status: 'CANCELLED', pausedReason: 'cod_limit' },
      ]),
    }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    expect(rows(container)).toHaveLength(2);
    const text = rows(container).map((r) => r.textContent).join(' ');
    for (const label of ['Khách tự dừng', 'Vượt hạn mức COD', 'Chưa rõ lý do']) expect(text).not.toContain(label);
  });

  it('nhãn viết theo giọng nhân viên, không xưng "Bạn" như chữ gửi khách', async () => {
    stub(() => ({ body: page(['customer', 'inactive_product', 'invalid_address', 'partner_goods', 'insufficient_wallet', 'cod_limit'].map((c, i) => paused(`s${i}`, c))) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    expect(rows(container)).toHaveLength(6);
    expect(container.textContent).not.toMatch(/Bạn|Bấm /);
  });
});

describe('SubscriptionsTab — lọc theo lý do tạm dừng (W144)', () => {
  const REASON_ROW = 'div[aria-label="Lọc gói định kỳ theo lý do tạm dừng"]';
  const reasonTab = (container: HTMLElement, label: string) => byText(container, `${REASON_ROW} button[role="tab"]`, label)!;
  const query = (calls: { url: string }[]) => new URL(calls.at(-1)!.url, 'http://localhost').searchParams;
  const pageOf = (url: string) => Number(new URL(url, 'http://localhost').searchParams.get('page') ?? 1);

  it('hiện hàng 8 chip lý do ngay khi vào tab (đang ở Tất cả), "Mọi lý do" được chọn và chưa gửi pausedReason', async () => {
    const calls = stub(() => ({ body: page([SUB]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    const tabs = Array.from(container.querySelectorAll<HTMLElement>(`${REASON_ROW} button[role="tab"]`));
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Mọi lý do',
      'Hệ thống tự dừng',
      'Khách tự dừng',
      'Ngừng bán',
      'Địa chỉ lỗi',
      'Hàng đối tác',
      'Ví không đủ số dư',
      'Vượt hạn mức COD',
    ]);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', ...Array(7).fill('false')]);
    expect(query(calls).has('pausedReason')).toBe(false);
    expect(container.querySelectorAll('button:not([role="tab"])').length).toBe(0);
  });

  it.each([
    ['Ví không đủ số dư', 'insufficient_wallet'],
    ['Địa chỉ lỗi', 'invalid_address'],
    ['Ngừng bán', 'inactive_product'],
    ['Vượt hạn mức COD', 'cod_limit'],
    ['Hàng đối tác', 'partner_goods'],
    ['Khách tự dừng', 'customer'],
    ['Hệ thống tự dừng', 'system'],
  ])('bấm "%s" gửi pausedReason=%s, chip được chọn, không gửi status', async (label, code) => {
    const calls = stub(() => ({ body: page([SUB]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    click(reasonTab(container, label));
    await flush();
    const q = query(calls);
    expect(q.get('pausedReason')).toBe(code);
    expect(q.has('status')).toBe(false);
    expect(q.get('page')).toBe('1');
    expect(reasonTab(container, label).getAttribute('aria-selected')).toBe('true');
    expect(reasonTab(container, 'Mọi lý do').getAttribute('aria-selected')).toBe('false');
  });

  it('"Mọi lý do" bỏ lọc lý do', async () => {
    const calls = stub(() => ({ body: page([SUB]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    click(reasonTab(container, 'Ví không đủ số dư'));
    await flush();
    expect(query(calls).get('pausedReason')).toBe('insufficient_wallet');
    click(reasonTab(container, 'Mọi lý do'));
    await flush();
    expect(query(calls).has('pausedReason')).toBe(false);
  });

  it('đang ở chip Tạm dừng: vẫn có hàng lý do và gửi cả status=PAUSED lẫn pausedReason', async () => {
    const calls = stub(() => ({ body: page([SUB]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    click(byText(container, 'button[role="tab"]', 'Tạm dừng'));
    await flush();
    expect(container.querySelector(REASON_ROW)).not.toBeNull();
    click(reasonTab(container, 'Hệ thống tự dừng'));
    await flush();
    const q = query(calls);
    expect(q.get('status')).toBe('PAUSED');
    expect(q.get('pausedReason')).toBe('system');
  });

  it('sang Đang chạy hoặc Đã huỷ: ẩn hàng lý do và bỏ lọc lý do; về Tất cả không dính lọc cũ', async () => {
    const calls = stub(() => ({ body: page([SUB]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    for (const target of ['Đang chạy', 'Đã huỷ']) {
      click(reasonTab(container, 'Địa chỉ lỗi'));
      await flush();
      expect(query(calls).get('pausedReason')).toBe('invalid_address');
      click(byText(container, 'button[role="tab"]', target));
      await flush();
      expect(container.querySelector(REASON_ROW)).toBeNull();
      const q = query(calls);
      expect(q.get('status')).toBe(target === 'Đang chạy' ? 'ACTIVE' : 'CANCELLED');
      expect(q.has('pausedReason')).toBe(false);
      click(byText(container, 'button[role="tab"]', 'Tất cả'));
      await flush();
      expect(query(calls).has('pausedReason')).toBe(false);
      expect(reasonTab(container, 'Mọi lý do').getAttribute('aria-selected')).toBe('true');
    }
  });

  it('đổi lý do khi đang ở trang 2 thì về trang 1', async () => {
    const calls = stub((url) => ({ body: page([SUB], 45, pageOf(url)) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    click(byText(container, 'button', 'Sau'));
    await flush();
    expect(query(calls).get('page')).toBe('2');
    click(reasonTab(container, 'Hệ thống tự dừng'));
    await flush();
    expect(query(calls).get('page')).toBe('1');
    expect(query(calls).get('pausedReason')).toBe('system');
  });

  it('lọc ra rỗng: báo chưa có gói khớp bộ lọc, hàng lý do vẫn còn để đổi lọc', async () => {
    stub((url) => ({ body: page(url.includes('pausedReason=cod_limit') ? [] : [SUB]) }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    click(reasonTab(container, 'Vượt hạn mức COD'));
    await flush();
    expect(container.textContent).toMatch(/chưa có gói định kỳ nào khớp bộ lọc/i);
    expect(container.querySelector(REASON_ROW)).not.toBeNull();
  });
});

// D7-27: hai tab không có tiêu đề nên người dùng bàn phím/đọc màn hình không biết mình đang ở tab nào.
describe('Tiêu đề tab (D7-27)', () => {
  it('tab Đánh giá có h2 "Đánh giá"', async () => {
    stub(() => ({ body: { data: [], meta: { page: 1, limit: 20, total: 0 } } }));
    const { container } = mount(<ReviewsTab />);
    await flush();
    expect(Array.from(container.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Đánh giá']);
  });

  it('tab Gói định kỳ có h2 "Gói định kỳ"', async () => {
    stub(() => ({ body: { data: [], meta: { page: 1, limit: 20, total: 0 } } }));
    const { container } = mount(<SubscriptionsTab />);
    await flush();
    expect(Array.from(container.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Gói định kỳ']);
  });
});
