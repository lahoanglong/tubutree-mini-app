// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MerchantProductsTab } from './merchant-products-tab';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminLinkedMerchantProduct, AdminPendingProduct, PancakeLinkPreview } from '@/lib/admin-client';

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
        if (url.includes('/linked')) {
          return new Response(JSON.stringify({ data: [], meta: { page: 1, limit: 100, total: 0 } }), { status: 200 });
        }
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

// R2-MERCHANT-1: admin phải thấy sản phẩm đang bán nào sẽ bị chuyển, xác nhận rõ, và gỡ liên kết được.
describe('MerchantProductsTab — "Tubu giao hộ" lấy mã của sản phẩm đang bán', () => {
  const preview = (over: Partial<PancakeLinkPreview> = {}): PancakeLinkPreview => ({
    code: 'seed-BHN-PP-200',
    state: 'TAKEOVER',
    reason: null,
    variation: { name: '200g', stock: 150, retailPrice: 120000, salePrice: null },
    origin: {
      id: 'p-bhnong-pepper',
      name: 'Tiêu đen Chư Sê',
      slug: 'tieu-den-chu-se-bh-nong',
      brand: 'BH.Nong',
      brandName: 'BH.Nong',
      isActive: true,
      onSale: true,
      sold: 42,
      reviewCount: 5,
      otherVariations: 0,
      storefrontTitle: null,
    },
    brandMatchesStore: false,
    ...over,
  });
  const linked: AdminLinkedMerchantProduct = {
    id: 'l1',
    linkedAt: '2026-10-14T03:00:00.000Z',
    takeover: true,
    stockAtLink: 37,
    consignmentConfirmedAt: null,
    originProductId: 'p-bhnong-pepper',
    product: {
      id: 'pm1',
      name: 'Tiêu đen Shop A',
      slug: 'tieu-den-shop-a',
      thumbnail: null,
      isActive: true,
      approvalStatus: 'APPROVED',
      storefront: { id: 'sf-a', title: 'Shop A', subdomain: 'shopa' },
    },
    variation: { pancakeId: 'seed-BHN-PP-200', name: '200g', stock: 150 },
    originProduct: { id: 'p-bhnong-pepper', name: 'Tiêu đen Chư Sê', slug: 'tieu-den-chu-se-bh-nong', brand: 'BH.Nong', isActive: false },
  };
  const pending = (p: PancakeLinkPreview | null) => ({
    data: [product({ name: 'Tiêu đen Shop A', pancakeLinkCode: 'seed-BHN-PP-200', pancakeLink: p, storefront: { id: 'sf-a', title: 'Shop A', subdomain: null, ownerUserId: 'u' } })],
    meta: { page: 1, limit: 100, total: 1 },
  });

  it('nêu sản phẩm sẽ bị chuyển (tên, thương hiệu, tồn, lượt bán, sẽ tắt), cảnh báo không phải chủ thương hiệu; chưa tích xác nhận thì không duyệt được', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: pending(preview()) },
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/review': { body: { id: 'p1', approvalStatus: 'APPROVED' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Tiêu đen Chư Sê');
    expect(text).toContain('BH.Nong');
    expect(text).toContain('150');
    expect(text).toContain('42');
    expect(text).toContain('tắt bán');
    expect(text).toContain('không phải chủ thương hiệu');
    const approve = byText(container, 'button', 'Duyệt xuất bản') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    click(box);
    await flush();
    expect(approve.disabled).toBe(false);
    click(approve);
    await flush();
    const call = api.calls.find((c) => c.url.includes('/review'));
    expect(call?.init?.body).toBe(JSON.stringify({ approve: true, confirmTakeover: true }));
  });

  it('mã không liên kết được → nêu lý do, khoá Duyệt (chỉ còn Từ chối)', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': {
        body: pending(preview({ state: 'UNAVAILABLE', reason: 'Mã đang thuộc sản phẩm của gian hàng Shop B.' })),
      },
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    expect(container.textContent).toContain('Mã đang thuộc sản phẩm của gian hàng Shop B.');
    expect((byText(container, 'button', 'Duyệt xuất bản') as HTMLButtonElement).disabled).toBe(true);
  });

  it('danh sách đang liên kết: "Gỡ liên kết" bắt nhập lý do rồi POST /unlink', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/admin/merchant-products/linked': { body: { data: [linked], meta: { page: 1, limit: 100, total: 1 } } },
      '/unlink': { body: { ok: true, originProductId: 'p-bhnong-pepper' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    expect(container.textContent).toContain('Đang liên kết mã Pancake (1)');
    expect(container.textContent).toContain('Tiêu đen Shop A');
    expect(container.textContent).toContain('Tiêu đen Chư Sê');
    click(byText(container, 'button', 'Gỡ liên kết'));
    const confirmBtn = byText(container, 'button', 'Xác nhận gỡ') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    typeInto(container.querySelector('input[placeholder="Lý do gỡ (gửi đối tác)..."]'), ' Sai thương hiệu ');
    expect(confirmBtn.disabled).toBe(false);
    click(confirmBtn);
    await flush();
    const call = api.calls.find((c) => c.url.includes('/unlink'));
    expect(call?.url).toContain('/admin/merchant-products/pm1/unlink');
    expect(call?.init?.body).toBe(JSON.stringify({ reason: 'Sai thương hiệu' }));
  });

  it('liên kết nhận lại hàng Tubu đang bán: hiện tồn lúc liên kết, chưa đối soát; "Xác nhận hàng ký gửi" hỏi lại rồi POST confirm-consignment', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/admin/merchant-products/linked': { body: { data: [linked], meta: { page: 1, limit: 100, total: 1 } } },
      '/confirm-consignment': { body: { id: 'l1', consignmentConfirmedAt: '2026-10-14T05:00:00.000Z' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Tồn lúc liên kết: 37 sp');
    expect(text).toContain('Chưa đối soát tự động');
    click(byText(container, 'button', 'Xác nhận hàng ký gửi'));
    expect(container.textContent).toContain('Đơn đặt từ lúc xác nhận sẽ vào đối soát của Shop A');
    expect(api.calls.some((c) => c.url.includes('/confirm-consignment'))).toBe(false);
    click(byText(container, 'button', 'Xác nhận ký gửi'));
    await flush();
    const call = api.calls.find((c) => c.url.includes('/confirm-consignment'));
    expect(call?.url).toContain('/admin/merchant-fulfilment/links/l1/confirm-consignment');
    expect(call?.init?.method).toBe('POST');
  });

  it('đã xác nhận hàng ký gửi → nêu mốc, không còn nút; liên kết thường không có phần ký gửi', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/admin/merchant-products/linked': {
        body: {
          data: [
            { ...linked, consignmentConfirmedAt: '2026-10-14T05:00:00.000Z' },
            { ...linked, id: 'l2', takeover: false, stockAtLink: 12, product: { ...linked.product, id: 'pm2', name: 'Mật ong Shop B' } },
          ],
          meta: { page: 1, limit: 100, total: 2 },
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Đã xác nhận hàng ký gửi');
    expect(byText(container, 'button', 'Xác nhận hàng ký gửi')).toBeNull();
    expect(text.match(/Tồn lúc liên kết/g)).toHaveLength(1);
  });
});

describe('MerchantProductsTab — bản sửa của sản phẩm đang bán (R3-MERCHANT-4)', () => {
  const edit = product({
    name: 'Nến thơm sả (tên mới)',
    description: 'Mô tả mới của đối tác',
    thumbnail: 'https://cdn.example/new.jpg',
    isEdit: true,
    editVersion: '2026-10-14T03:00:00.000Z',
    live: { name: 'Nến thơm sả', description: 'Mô tả đang bán', shortDesc: null, thumbnail: 'https://cdn.example/old.jpg' },
    approvalStatus: 'APPROVED',
  });

  it('dòng bản sửa ghi rõ "Bản sửa chờ duyệt", đặt nội dung đang bán cạnh nội dung mới, nút duyệt gọi đúng là "Duyệt bản sửa"', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [edit], meta: { page: 1, limit: 100, total: 1 } } },
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/review': { body: { id: 'p1', approvalStatus: 'APPROVED' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Bản sửa chờ duyệt');
    expect(text).toContain('Đang bán');
    expect(text).toContain('Nến thơm sả');
    expect(text).toContain('Mô tả đang bán');
    expect(text).toContain('Nến thơm sả (tên mới)');
    expect(text).toContain('Mô tả mới của đối tác');
    expect(byText(container, 'button', 'Duyệt xuất bản')).toBeNull();
    click(byText(container, 'button', 'Duyệt bản sửa'));
    await flush();
    const call = api.calls.find((c) => c.url.includes('/review'));
    expect(call?.init?.body).toBe(JSON.stringify({ approve: true, editVersion: '2026-10-14T03:00:00.000Z' }));
  });

  it('từ chối bản sửa cũng gửi đúng phiên bản bản sửa admin đang xem, để bấm trên dòng cũ không từ chối nhầm cả sản phẩm đang bán', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [edit], meta: { page: 1, limit: 100, total: 1 } } },
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/review': { body: { id: 'p1', approvalStatus: 'APPROVED' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(byText(container, 'button', 'Từ chối'));
    typeInto(container.querySelector('input[placeholder="Lý do từ chối..."]') as HTMLInputElement, 'Ảnh mờ');
    click(byText(container, 'button', 'Xác nhận từ chối'));
    await flush();
    const call = api.calls.find((c) => c.url.includes('/review'));
    expect(call?.init?.body).toBe(
      JSON.stringify({ approve: false, rejectReason: 'Ảnh mờ', editVersion: '2026-10-14T03:00:00.000Z' }),
    );
  });

  it('sản phẩm mới đăng không có khối so sánh "Đang bán"', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [product()], meta: { page: 1, limit: 100, total: 1 } } },
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    expect(container.textContent).not.toContain('Đang bán');
    expect(container.textContent).not.toContain('Bản sửa chờ duyệt');
  });
});

describe('MerchantProductsTab — 390px (R3-MERCHANT-7)', () => {
  it('huy hiệu mã Pancake dài được xuống dòng và cột thông tin co được, không đẩy trang tràn ngang', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': {
        body: { data: [product({ pancakeLinkCode: 'seed-BHN-PP-200-RẤT-DÀI-KHÔNG-CÓ-KHOẢNG-TRẮNG' })], meta: { page: 1, limit: 100, total: 1 } },
      },
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    const badge = byText(container, 'span', 'Tubu giao hộ · mã Pancake')!;
    expect(badge.className).toContain('whitespace-normal');
    expect(badge.className).toContain('break-all');
    expect(badge.className).not.toContain('whitespace-nowrap');
    expect(badge.parentElement?.parentElement?.className).toContain('min-w-0');
  });

  it('tên gian hàng mặc định đã có chữ "Gian hàng": không ghép thêm chữ "Gian hàng" cố định trong lời cảnh báo', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': {
        body: {
          data: [
            product({
              pancakeLinkCode: 'X',
              storefront: { id: 's', title: 'Gian hàng của Nguyễn Văn Shop A', subdomain: null, ownerUserId: 'u' },
              pancakeLink: {
                code: 'X',
                state: 'TAKEOVER',
                reason: null,
                variation: { name: '200g', stock: 1, retailPrice: 1000, salePrice: null },
                origin: { id: 'o', name: 'Tiêu đen', slug: 't', brand: 'BH', brandName: 'BH', isActive: true, onSale: true, sold: 1, reviewCount: 0, otherVariations: 0, storefrontTitle: null },
                brandMatchesStore: false,
              },
            }),
          ],
          meta: { page: 1, limit: 100, total: 1 },
        },
      },
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    expect(container.textContent).not.toContain('Gian hàng Gian hàng');
    expect(container.textContent).not.toContain('gian hàng Gian hàng');
  });
});
