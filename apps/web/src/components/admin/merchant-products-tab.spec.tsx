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
  updatedAt: '2026-10-14T01:00:00.000Z',
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
    expect(call?.init?.body).toBe(JSON.stringify({ approve: true, expectedPancakeCode: '', expectedUpdatedAt: '2026-10-14T01:00:00.000Z' }));
  });

  it('dòng không có mã Pancake: Duyệt luôn gửi expectedPancakeCode chuỗi rỗng (không bỏ trống, không null) để API không duyệt mã đối tác thêm sau đó', async () => {
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: { data: [product({ pancakeLinkCode: null })], meta: { page: 1, limit: 100, total: 1 } } },
      '/review': { body: { id: 'p1', approvalStatus: 'APPROVED' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(byText(container, 'button', 'Duyệt xuất bản'));
    await flush();
    const body = JSON.parse(String(api.calls.find((c) => c.url.includes('/review'))?.init?.body));
    expect(body).toHaveProperty('expectedPancakeCode', '');
    expect(body).not.toHaveProperty('expectedTakeoverProductId');
  });

  it('dòng không có mã mà đối tác vừa thêm mã (API 409 PANCAKE_CODE_CHANGED) → danh sách tải lại hiện mã mới, không duyệt', async () => {
    let listCalls = 0;
    const withCode = { data: [product({ pancakeLinkCode: 'seed-NEW-1' })], meta: { page: 1, limit: 100, total: 1 } };
    const api = mockFetch({
      '/admin/merchant-products/pending': () => ({
        body: listCalls++ === 0 ? { data: [product({ pancakeLinkCode: null })], meta: { page: 1, limit: 100, total: 1 } } : withCode,
      }),
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/review': {
        status: 409,
        body: { statusCode: 409, code: 'PANCAKE_CODE_CHANGED', message: 'Đối tác vừa đổi mã Pancake của sản phẩm này sang seed-NEW-1, khác với mã bạn đang xem. Hãy xem lại sản phẩm sẽ bị chuyển rồi mới duyệt.' },
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(byText(container, 'button', 'Duyệt xuất bản'));
    await flush();
    await flush();
    expect(listCalls).toBeGreaterThanOrEqual(2);
    const text = container.textContent ?? '';
    expect(text).toContain('Đối tác vừa đổi mã Pancake');
    expect(text).toContain('Danh sách đã được tải lại — kiểm tra lại rồi mới duyệt');
    expect(text).not.toContain('Tải lại danh sách');
    expect(text).toContain('mã Pancake seed-NEW-1');
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
    expect(call?.init?.body).toBe(
      JSON.stringify({ approve: false, rejectReason: 'Thiếu giấy chứng nhận', expectedPancakeCode: '', expectedUpdatedAt: '2026-10-14T01:00:00.000Z' }),
    );
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
    expect(call?.init?.body).toBe(
      JSON.stringify({
        approve: true,
        confirmTakeover: true,
        expectedPancakeCode: 'seed-BHN-PP-200',
        expectedTakeoverProductId: 'p-bhnong-pepper',
        expectedUpdatedAt: '2026-10-14T01:00:00.000Z',
      }),
    );
  });

  it('đối tác đổi mã sau khi admin tích xác nhận → API 409, danh sách tự tải lại hiện sản phẩm mới, bỏ tích và khoá Duyệt', async () => {
    const swapped = {
      data: [
        product({
          name: 'Tiêu đen Shop A',
          pancakeLinkCode: 'seed-OTHER-200',
          pancakeLink: preview({
            code: 'seed-OTHER-200',
            origin: { ...preview().origin!, id: 'p-other-pepper', name: 'Tiêu sọ Phú Quốc' },
          }),
          storefront: { id: 'sf-a', title: 'Shop A', subdomain: null, ownerUserId: 'u' },
        }),
      ],
      meta: { page: 1, limit: 100, total: 1 },
    };
    let listCalls = 0;
    const api = mockFetch({
      '/admin/merchant-products/pending': () => ({ body: listCalls++ === 0 ? pending(preview()) : swapped }),
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/review': {
        status: 409,
        body: {
          statusCode: 409,
          code: 'PANCAKE_CODE_CHANGED',
          message: 'Đối tác vừa đổi mã Pancake của sản phẩm này sang seed-OTHER-200, khác với mã bạn đang xem. Hãy xem lại sản phẩm sẽ bị chuyển rồi mới duyệt.',
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(container.querySelector('input[type="checkbox"]'));
    await flush();
    click(byText(container, 'button', 'Duyệt xuất bản'));
    await flush();
    await flush();
    const body = JSON.parse(String(api.calls.find((c) => c.url.includes('/review'))?.init?.body));
    expect(body).toMatchObject({ expectedPancakeCode: 'seed-BHN-PP-200', expectedTakeoverProductId: 'p-bhnong-pepper' });
    expect(listCalls).toBeGreaterThanOrEqual(2);
    const text = container.textContent ?? '';
    expect(text).toContain('Đối tác vừa đổi mã Pancake');
    expect(text).toContain('Tiêu sọ Phú Quốc');
    expect(text).toContain('mã Pancake seed-OTHER-200');
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    expect((byText(container, 'button', 'Duyệt xuất bản') as HTMLButtonElement).disabled).toBe(true);
  });

  it('đối tác đổi sang biến thể khác của CÙNG sản phẩm đang bán → bỏ tích xác nhận, phải tích lại cho mã mới', async () => {
    const sameOriginOtherCode = {
      data: [
        product({
          name: 'Tiêu đen Shop A',
          pancakeLinkCode: 'seed-BHN-PP-500',
          pancakeLink: preview({ code: 'seed-BHN-PP-500' }),
          storefront: { id: 'sf-a', title: 'Shop A', subdomain: null, ownerUserId: 'u' },
        }),
      ],
      meta: { page: 1, limit: 100, total: 1 },
    };
    let listCalls = 0;
    const api = mockFetch({
      '/admin/merchant-products/pending': () => ({ body: listCalls++ === 0 ? pending(preview()) : sameOriginOtherCode }),
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/review': { status: 409, body: { statusCode: 409, code: 'PANCAKE_CODE_CHANGED', message: 'Đối tác vừa đổi mã Pancake của sản phẩm này sang seed-BHN-PP-500.' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(container.querySelector('input[type="checkbox"]'));
    await flush();
    click(byText(container, 'button', 'Duyệt xuất bản'));
    await flush();
    await flush();
    expect(listCalls).toBeGreaterThanOrEqual(2);
    expect(container.textContent ?? '').toContain('seed-BHN-PP-500');
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    expect((byText(container, 'button', 'Duyệt xuất bản') as HTMLButtonElement).disabled).toBe(true);
  });

  it('API trả 409 bất kỳ khi duyệt (vd sản phẩm gốc vừa mở bán, cần tích xác nhận) → danh sách tự tải lại', async () => {
    let listCalls = 0;
    const api = mockFetch({
      '/admin/merchant-products/pending': () => ({ body: (listCalls++, pending(preview({ state: 'AVAILABLE' }))) }),
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/review': { status: 409, body: { statusCode: 409, code: 'PANCAKE_TAKEOVER_UNCONFIRMED', message: 'Sản phẩm đang bán, hãy tích xác nhận.' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(byText(container, 'button', 'Duyệt xuất bản'));
    await flush();
    await flush();
    expect(listCalls).toBeGreaterThanOrEqual(2);
  });

  it('API trả 409 PANCAKE_TAKEOVER_CHANGED (biến thể đã sang sản phẩm đang bán khác) → danh sách tự tải lại, bỏ tích xác nhận', async () => {
    let listCalls = 0;
    const moved = pending(preview({ origin: { ...preview().origin!, id: 'p-other-pepper', name: 'Tiêu sọ Phú Quốc' } }));
    const api = mockFetch({
      '/admin/merchant-products/pending': () => ({ body: listCalls++ === 0 ? pending(preview()) : moved }),
      '/admin/merchant-products/linked': { body: { data: [], meta: { page: 1, limit: 100, total: 0 } } },
      '/review': { status: 409, body: { statusCode: 409, code: 'PANCAKE_TAKEOVER_CHANGED', message: 'Mã seed-BHN-PP-200 giờ thuộc sản phẩm đang bán "Tiêu sọ Phú Quốc".' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(container.querySelector('input[type="checkbox"]'));
    await flush();
    click(byText(container, 'button', 'Duyệt xuất bản'));
    await flush();
    await flush();
    expect(listCalls).toBeGreaterThanOrEqual(2);
    expect(container.textContent ?? '').toContain('Tiêu sọ Phú Quốc');
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    expect((byText(container, 'button', 'Duyệt xuất bản') as HTMLButtonElement).disabled).toBe(true);
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

describe('MerchantProductsTab — hai admin cùng duyệt một sản phẩm (R5-PARTNER-1/3/4)', () => {
  const empty = { data: [], meta: { page: 1, limit: 100, total: 0 } };
  const page = (...items: AdminPendingProduct[]) => ({ data: items, meta: { page: 1, limit: 100, total: items.length } });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const alerts = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>('[role="alert"]'));

  it('Từ chối dòng chờ duyệt lần đầu cũng gửi expectedUpdatedAt; dòng bản sửa không gửi (nó có editVersion riêng)', async () => {
    const edit = product({ id: 'pe', isEdit: true, editVersion: '2026-10-14T03:00:00.000Z', approvalStatus: 'APPROVED' });
    const api = mockFetch({
      '/admin/merchant-products/pending': { body: page(product(), edit) },
      '/admin/merchant-products/linked': { body: empty },
      '/review': { body: { id: 'p1', approvalStatus: 'REJECTED' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    const rejects = Array.from(container.querySelectorAll<HTMLElement>('button')).filter((b) => b.textContent?.includes('Từ chối'));
    click(rejects[0]!);
    click(byText(container, 'button', 'Xác nhận từ chối'));
    await flush();
    const first = JSON.parse(String(api.calls.find((c) => c.url.includes('/p1/review'))?.init?.body));
    expect(first).toMatchObject({ approve: false, expectedUpdatedAt: '2026-10-14T01:00:00.000Z' });

    const approveEdit = Array.from(container.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent?.includes('Duyệt bản sửa'));
    click(approveEdit ?? null);
    await flush();
    const second = JSON.parse(String(api.calls.find((c) => c.url.includes('/pe/review'))?.init?.body));
    expect(second).toMatchObject({ approve: true, editVersion: '2026-10-14T03:00:00.000Z' });
    expect(second).not.toHaveProperty('expectedUpdatedAt');
  });

  it('admin khác đã xử lý (409 ALREADY_REVIEWED) → danh sách tải lại, dòng biến mất, lời báo còn lại ở đầu danh sách, đóng được, không nhắc đổi mã Pancake', async () => {
    let listCalls = 0;
    const api = mockFetch({
      '/admin/merchant-products/pending': () => ({ body: listCalls++ === 0 ? page(product()) : empty }),
      '/admin/merchant-products/linked': { body: empty },
      '/review': {
        status: 409,
        body: { statusCode: 409, code: 'MERCHANT_PRODUCT_ALREADY_REVIEWED', message: 'Sản phẩm này đã được admin khác duyệt xuất bản.' },
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(byText(container, 'button', 'Duyệt xuất bản'));
    await flush();
    await flush();
    expect(listCalls).toBeGreaterThanOrEqual(2);
    expect(byText(container, 'button', 'Duyệt xuất bản')).toBeNull();
    const [notice] = alerts(container);
    expect(notice?.textContent).toContain('Tinh dầu sả chanh');
    expect(notice?.textContent).toContain('đã được admin khác xử lý');
    expect(notice?.textContent).toContain('Danh sách đã được tải lại');
    expect(container.textContent).not.toContain('Tải lại danh sách');
    expect(container.textContent).not.toContain('đổi mã Pancake');
    click(byText(notice!, 'button', 'Đóng'));
    expect(alerts(container)).toHaveLength(0);
  });

  it('đối tác sửa sau khi admin mở danh sách (409 CONTENT_CHANGED) → khoá nút trong lúc tải lại, lời báo nằm ngay dưới cụm nút (trước phần mô tả), cuộn tới đó, rồi duyệt lại gửi phiên bản mới', async () => {
    const scroll = vi.fn();
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let listCalls = 0;
      const calls: { url: string; init?: RequestInit }[] = [];
      const before = product({ description: 'Mô tả cũ' });
      const after = product({ name: 'Tinh dầu sả chanh (đã sửa)', description: 'Mô tả mới', updatedAt: '2026-10-14T02:30:00.000Z' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          if (url.includes('/review')) {
            const n = calls.filter((c) => c.url.includes('/review')).length;
            return n === 1
              ? json(409, { statusCode: 409, code: 'MERCHANT_PRODUCT_CONTENT_CHANGED', message: 'Đối tác vừa sửa sản phẩm này.' })
              : json(200, { id: 'p1', approvalStatus: 'APPROVED' });
          }
          if (url.includes('/merchant-products/linked')) return json(200, empty);
          if (url.includes('/merchant-products/pending')) {
            listCalls += 1;
            if (listCalls === 2) await gate;
            return json(200, listCalls === 1 ? page(before) : page(after));
          }
          return json(500, { message: 'no mock' });
        }),
      );
      const { container } = mount(<MerchantProductsTab />);
      await flush();
      click(byText(container, 'button', 'Duyệt xuất bản'));
      await flush();
      expect(listCalls).toBe(2);
      expect((byText(container, 'button', 'Duyệt xuất bản') as HTMLButtonElement).disabled).toBe(true);
      expect((byText(container, 'button', 'Từ chối') as HTMLButtonElement).disabled).toBe(true);

      release();
      await flush();
      const approve = byText(container, 'button', 'Duyệt xuất bản') as HTMLButtonElement;
      expect(approve.disabled).toBe(false);
      expect(container.textContent).toContain('Tinh dầu sả chanh (đã sửa)');
      const [notice] = alerts(container);
      expect(notice?.textContent).toContain('Đối tác vừa sửa sản phẩm này sau lúc bạn mở danh sách');
      expect(notice?.textContent).toContain('Danh sách đã được tải lại');
      expect(container.textContent).not.toContain('Tải lại danh sách');
      expect(approve.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const descr = byText(container, 'p', 'Mô tả mới');
      expect(notice!.compareDocumentPosition(descr!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(scroll).toHaveBeenCalled();

      click(approve);
      await flush();
      const bodies = calls.filter((c) => c.url.includes('/review')).map((c) => JSON.parse(String(c.init?.body)));
      expect(bodies[0]).toMatchObject({ expectedUpdatedAt: '2026-10-14T01:00:00.000Z' });
      expect(bodies[1]).toMatchObject({ expectedUpdatedAt: '2026-10-14T02:30:00.000Z' });
      expect(alerts(container)).toHaveLength(0);
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('R6-ADMIN-3 — mở từ thẻ ký gửi: chỉ cuộn và focus khối liên kết sau khi danh sách chờ duyệt tải xong', async () => {
    const scroll = vi.fn();
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/merchant-products/linked')) return json(200, empty);
          if (url.includes('/merchant-products/pending')) {
            await gate;
            return json(200, page(product()));
          }
          return json(500, { message: 'no mock' });
        }),
      );
      const { container } = mount(<MerchantProductsTab focusConsignment />);
      await flush();
      expect(scroll).not.toHaveBeenCalled();

      release();
      await flush();
      const section = container.querySelector('section[aria-label^="Sản phẩm đối tác đang liên kết"]');
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(section);
      expect(document.activeElement).toBe(section);
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('bản sửa đã được xử lý (409 EDIT_STALE) → báo bằng lời của web, danh sách tải lại', async () => {
    let listCalls = 0;
    const edit = product({ isEdit: true, editVersion: '2026-10-14T03:00:00.000Z', approvalStatus: 'APPROVED' });
    const api = mockFetch({
      '/admin/merchant-products/pending': () => ({ body: listCalls++ === 0 ? page(edit) : empty }),
      '/admin/merchant-products/linked': { body: empty },
      '/review': { status: 409, body: { statusCode: 409, code: 'MERCHANT_PRODUCT_EDIT_STALE', message: 'Bản sửa này vừa được xử lý.' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(byText(container, 'button', 'Duyệt bản sửa'));
    await flush();
    await flush();
    expect(listCalls).toBeGreaterThanOrEqual(2);
    expect(alerts(container)[0]?.textContent).toContain('đã được xử lý hoặc đối tác vừa sửa tiếp');
  });

  it('lỗi không phải 409 → không tải lại danh sách, báo ngay dưới nút bằng thông báo lỗi và nút vẫn bấm lại được', async () => {
    let listCalls = 0;
    const api = mockFetch({
      '/admin/merchant-products/pending': () => ({ body: (listCalls++, page(product())) }),
      '/admin/merchant-products/linked': { body: empty },
      '/review': { status: 400, body: { statusCode: 400, message: 'Mã Pancake không dùng được.' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    click(byText(container, 'button', 'Duyệt xuất bản'));
    await flush();
    await flush();
    expect(listCalls).toBe(1);
    expect(alerts(container)[0]?.textContent).toBe('Mã Pancake không dùng được.');
    expect((byText(container, 'button', 'Duyệt xuất bản') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('MerchantProductsTab — thành phần là cột Json nên dòng cũ có thể mang mọi hình dạng (AUTHZ-3)', () => {
  const ingredientsLine = async (ingredients: unknown) => {
    const api = mockFetch({
      '/admin/merchant-products/pending': {
        body: { data: [product({ ingredients: ingredients as AdminPendingProduct['ingredients'] })], meta: { page: 1, limit: 100, total: 1 } },
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<MerchantProductsTab />);
    await flush();
    expect(container.textContent).toContain('Tinh dầu sả chanh');
    return [...container.querySelectorAll('p')].find((el) => el.textContent?.startsWith('Thành phần:'))?.textContent ?? null;
  };

  it('mảng {name, percentage, benefit} → liệt kê tên kèm tỉ lệ, không vỡ tab', async () => {
    expect(
      await ingredientsLine([
        { name: 'Tinh dầu sả', percentage: '60%', benefit: 'Đuổi muỗi' },
        { name: 'Dầu dừa', percentage: 40 },
        { name: 'Hương liệu' },
      ]),
    ).toBe('Thành phần: Tinh dầu sả (60%), Dầu dừa (40), Hương liệu');
  });

  it('chuỗi cũ và mảng chuỗi vẫn hiện như trước', async () => {
    expect(await ingredientsLine('Sả, chanh, dầu dừa')).toBe('Thành phần: Sả, chanh, dầu dừa');
    expect(await ingredientsLine(['Sả', 'Chanh'])).toBe('Thành phần: Sả, Chanh');
  });

  it('object lạ không có name → hiện dạng JSON ngắn để admin thấy mà từ chối; null/mảng rỗng → ẩn dòng thành phần', async () => {
    expect(await ingredientsLine({ foo: 'bar' })).toBe('Thành phần: {"foo":"bar"}');
    expect(await ingredientsLine(null)).toBeNull();
    expect(await ingredientsLine([])).toBeNull();
  });
});
