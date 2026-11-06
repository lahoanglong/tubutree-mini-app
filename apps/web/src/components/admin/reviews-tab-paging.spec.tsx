// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReviewsTab } from './reviews-tab';
import { answerConfirm, byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// W30: duyệt xong đánh giá cuối của một trang làm danh sách co lại; trang đang xem rỗng nhưng vẫn còn đánh giá ở các trang trước.
// Tab phải về trang cuối còn dữ liệu, không báo "không có đánh giá nào khớp" trong khi bộ đếm ghi còn hàng chục đánh giá.

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

const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `r${n}`,
  rating: 5,
  comment: `Nhận xét số ${n}`,
  images: [],
  videoUrl: null,
  isVisible: true,
  isVerified: true,
  createdAt: '2026-10-01T03:00:00.000Z',
  user: { id: 'u1', fullName: 'Nguyễn An', phone: '0900000001' },
  product: { id: 'p1', name: 'Nước rửa chén Lá Sả', slug: 'nuoc-rua-chen' },
  ...over,
});
const LIMIT = 20;
const pageOf = (data: unknown[], total: number, p: number) => ({ data, meta: { page: p, limit: LIMIT, total } });

type Call = { url: string; init?: RequestInit };

/** Máy chủ giả có `total` đánh giá (r1..rN, mỗi trang 20): `total` giảm đi khi có lệnh ẩn. Ghi lại mọi lệnh gọi. */
function server(initialTotal: number, hideShrinksVisibleTo?: number) {
  const calls: Call[] = [];
  let total = initialTotal;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      let body: unknown;
      if (url.includes('/visibility')) {
        if (hideShrinksVisibleTo !== undefined) total = hideShrinksVisibleTo;
        body = { ok: true, isVisible: false };
      } else {
        const p = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
        const from = (p - 1) * LIMIT;
        const data = Array.from({ length: Math.max(0, Math.min(LIMIT, total - from)) }, (_, i) => row(from + i + 1));
        body = pageOf(data, total, p);
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}
const adminPages = (calls: Call[]) => calls.filter((c) => c.url.includes('/admin/reviews')).map((c) => Number(new URL(c.url, 'http://x').searchParams.get('page')));

async function goToPage2(container: HTMLElement) {
  click(byText(container, 'button', 'Sau'));
  await flush();
}

describe('ReviewsTab: trang rỗng sau khi duyệt làm danh sách co lại', () => {
  it('ẩn đánh giá duy nhất của trang cuối (21 → 20): về trang 1 và vẫn thấy đánh giá, không báo rỗng', async () => {
    const calls = server(21, 20);
    const { container } = mount(<ReviewsTab />);
    await flush();
    await goToPage2(container);
    expect(container.textContent).toContain('Trang 2/2');
    expect(container.textContent).toContain('Nhận xét số 21');

    click(byText(container, 'button', 'Ẩn đánh giá'));
    await flush();
    answerConfirm(true);
    await flush();

    expect(container.textContent).not.toMatch(/không có đánh giá nào/i);
    expect(container.textContent).toContain('Nhận xét số 1');
    expect(container.textContent).toContain('20 đánh giá');
    expect(adminPages(calls).at(-1)).toBe(1);
  });

  it('co từ ba trang xuống hai trang khi đang ở trang 3: về trang 2 (trang cuối còn dữ liệu), không về trang 1', async () => {
    const calls = server(41, 40);
    const { container } = mount(<ReviewsTab />);
    await flush();
    await goToPage2(container);
    await goToPage2(container);
    expect(container.textContent).toContain('Trang 3/3');

    click(byText(container, 'button', 'Ẩn đánh giá'));
    await flush();
    answerConfirm(true);
    await flush();

    expect(container.textContent).toContain('Trang 2/2');
    expect(container.textContent).toContain('Nhận xét số 21');
    expect(container.textContent).not.toMatch(/không có đánh giá nào/i);
  });

  it('danh sách thật sự rỗng sau khi ẩn hết (1 → 0) vẫn báo không có đánh giá khớp, không lặp tải trang', async () => {
    const calls = server(1, 0);
    const { container } = mount(<ReviewsTab />);
    await flush();
    click(byText(container, 'button', 'Ẩn đánh giá'));
    await flush();
    answerConfirm(true);
    await flush();
    await flush(8);
    expect(container.textContent).toMatch(/không có đánh giá nào/i);
    // Tải đầu + tải lại sau khi ẩn; một vòng tải lại sẽ vượt mốc này sau các lần flush.
    expect(adminPages(calls)).toEqual([1, 1]);
  });

  it('trang giữa còn đủ dòng thì giữ nguyên trang đang xem', async () => {
    const calls = server(45, 44);
    const { container } = mount(<ReviewsTab />);
    await flush();
    await goToPage2(container);
    click(byText(container, 'button', 'Ẩn đánh giá'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.textContent).toContain('Trang 2/3');
    expect(adminPages(calls).at(-1)).toBe(2);
  });
});
