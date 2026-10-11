// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MerchantProductsTab } from './merchant-products-tab';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminPendingProduct } from '@/lib/admin-client';

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

const product = (over: Partial<AdminPendingProduct> = {}): AdminPendingProduct => ({
  id: 'p1',
  name: 'Tinh dầu sả chanh',
  slug: 'tinh-dau-sa-chanh',
  basePrice: 150000,
  salePrice: null,
  thumbnail: null,
  brand: 'Nhà Xanh',
  category: 'Tinh dầu',
  description: null,
  ingredients: null,
  certifications: [],
  ecoBadges: [],
  approvalStatus: 'PENDING_REVIEW',
  createdAt: '2026-09-20T00:00:00.000Z',
  ...over,
});

describe('MerchantProductsTab (P0 A6-07, docs/audit-2026-09/06-web.md)', () => {
  it('API trả ĐÚNG {data, meta} (paginated()) → render danh sách bình thường, KHÔNG crash, tiêu đề hiện đúng tổng', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [product()], meta: { page: 1, limit: 100, total: 1 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    expect(container.textContent).toContain('Sản phẩm đối tác gửi duyệt (1)');
    expect(container.textContent).toContain('Tinh dầu sả chanh');
    expect(byText(container, 'button', 'Duyệt xuất bản')).not.toBeNull();
  });

  it('BE cũ trả MẢNG TRẦN (không {data,meta}) → vẫn render đúng, không crash (asPage tự bọc lại)', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: [product({ id: 'p2', name: 'Xà phòng bồ hòn' })] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    expect(container.textContent).toContain('Sản phẩm đối tác gửi duyệt (1)');
    expect(container.textContent).toContain('Xà phòng bồ hòn');
  });

  it('danh sách rỗng → hiện empty-state, tiêu đề (0), không lỗi', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    expect(container.textContent).toContain('Sản phẩm đối tác gửi duyệt (0)');
    expect(container.textContent).toContain('Không có sản phẩm đối tác nào đang chờ duyệt.');
  });

  it('Duyệt xuất bản → POST /admin/merchant-products/:id/review với approve:true', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [product()], meta: { page: 1, limit: 100, total: 1 } } },
      '/review': { body: { id: 'p1', approvalStatus: 'APPROVED' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(byText(container, 'button', 'Duyệt xuất bản'));
    await flush();
    const call = api.calls.find((c) => c.url.includes('/review'));
    expect(call?.url).toContain('/admin/merchant-products/p1/review');
    expect(call?.init?.body).toBe(JSON.stringify({ approve: true }));
  });

  it('còn trang chưa tải → hiện "Tải thêm", bấm gọi tiếp trang 2', async () => {
    // Phân biệt trang 1/2 theo query string trong URL — mockFetch chỉ khớp theo substring nên tự dựng fetch riêng ở đây.
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const page = url.includes('page=2') ? 2 : 1;
        const body =
          page === 1
            ? { data: [product({ id: 'p1' })], meta: { page: 1, limit: 100, total: 150 } }
            : { data: [product({ id: 'p2', name: 'Trang 2' })], meta: { page: 2, limit: 100, total: 150 } };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    expect(container.textContent).toContain('Sản phẩm đối tác gửi duyệt (150)');
    const more = byText(container, 'button', 'Tải thêm');
    expect(more).not.toBeNull();
    click(more);
    await flush();
    expect(calls.some((u) => u.includes('page=2'))).toBe(true);
    expect(container.textContent).toContain('Trang 2');
  });
});

// C-097 (Q-25/Q-29): ✓/✕/🌿 chuyển sang icon lucide; nút duyệt/từ chối chạm được ở 390px.
describe('MerchantProductsTab — DS v2', () => {
  const page = { data: [product()], meta: { page: 1, limit: 100, total: 1 } };

  it('nút duyệt/từ chối dùng icon lucide (không ký tự ✓ ✕), cao 44px; ô trống ảnh dùng icon Leaf thay emoji 🌿', async () => {
    const api = mockFetch({ '/admin/merchant-products/pending': { body: page } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    const approve = byText(container, 'button', 'Duyệt xuất bản')!;
    const reject = byText(container, 'button', 'Từ chối')!;
    for (const b of [approve, reject]) {
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.textContent).not.toMatch(/[✓✕]/);
      expect(b.className).toContain('min-h-[44px]');
    }
    expect(approve.className).toContain('bg-forest-600');
    expect(reject.className).toContain('border-danger-fg');
    expect(container.textContent).not.toContain('🌿');
    expect(container.querySelector('svg.lucide-leaf')).not.toBeNull();
  });

  it('bấm Từ chối → ô lý do và 2 nút cao 44px; xác nhận gửi approve:false kèm lý do đã trim', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: page },
      '/review': { body: { id: 'p1', approvalStatus: 'REJECTED' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(byText(container, 'button', 'Từ chối'));
    const input = container.querySelector('input[placeholder="Lý do từ chối..."]') as HTMLInputElement;
    expect(input.className).toContain('min-h-[44px]');
    typeInto(input, '  Thiếu giấy chứng nhận ');
    const confirmBtn = byText(container, 'button', 'Xác nhận từ chối')!;
    expect(confirmBtn.className).toContain('min-h-[44px]');
    expect(confirmBtn.className).toContain('bg-danger-fg');
    expect(byText(container, 'button', 'Huỷ')?.className).toContain('min-h-[44px]');
    click(confirmBtn);
    await flush();
    const call = api.calls.find((c) => c.url.includes('/review'));
    expect(call?.init?.body).toBe(JSON.stringify({ approve: false, rejectReason: 'Thiếu giấy chứng nhận' }));
  });
});
