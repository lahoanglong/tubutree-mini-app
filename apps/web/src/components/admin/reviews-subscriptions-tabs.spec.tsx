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
