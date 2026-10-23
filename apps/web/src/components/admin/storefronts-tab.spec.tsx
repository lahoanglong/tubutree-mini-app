// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StorefrontsTab } from './storefronts-tab';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminStorefrontDetail, AdminStorefrontRow } from '@/lib/admin-storefronts-client';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const row = (over: Partial<AdminStorefrontRow> = {}): AdminStorefrontRow => ({
  id: 's1', slug: 'linh123', title: 'Shop của Linh', type: 'CTV', isPartner: false, isPublished: true, publishedAt: '2026-10-01T00:00:00.000Z',
  approved: false, approvedAt: null, takenDownAt: null, takenDownReason: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
  ownerUserId: 'u1', owner: { id: 'u1', fullName: 'Linh', phone: '0900000001', role: 'AFFILIATE', isBlocked: false },
  itemCount: 3, publicVisible: true, hiddenReason: null,
  ...over,
});
const detail = (over: Partial<AdminStorefrontDetail> = {}): AdminStorefrontDetail => ({
  ...row({ itemCount: 1 }), headerNote: 'Hàng sống xanh', avatarUrl: null, coverUrl: null, subdomain: null,
  collections: [{ id: 'c1', title: 'Nổi bật', items: [{ id: 'i1', productId: 'p1', productName: 'Bình nước inox', productSlug: 'binh-nuoc', note: 'Dùng tốt', isHidden: false, isPinned: false }] }],
  ...over,
});
const page = (rows: AdminStorefrontRow[]) => ({ body: { data: rows, meta: { page: 1, limit: 50, total: rows.length } } });

describe('StorefrontsTab (D3-02)', () => {
  it('liệt kê gian hàng với trạng thái, chủ và số sản phẩm; tiêu đề có tổng', async () => {
    const api = mockFetch({ '/admin/storefronts?': page([row(), row({ id: 's2', title: 'Shop nháp', isPublished: false, publicVisible: false })]) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<StorefrontsTab />);
    await flush();
    expect(container.textContent).toContain('Gian hàng (2)');
    const first = container.querySelector('article[aria-label="Shop của Linh"]')!;
    expect(first.textContent).toContain('Đang hiện với khách');
    expect(first.textContent).toContain('Chưa duyệt');
    expect(first.textContent).toContain('Chủ: Linh · 0900000001');
    expect(first.textContent).toContain('3 sản phẩm');
    expect(container.querySelector('article[aria-label="Shop nháp"]')!.textContent).toContain('Nháp');
  });

  it('gian hàng đã đăng nhưng đang ẩn thì nói vì sao; gian hàng bị gỡ hiện lý do của admin', async () => {
    const api = mockFetch({
      '/admin/storefronts?': page([
        row({ publicVisible: false, hiddenReason: 'Tài khoản của bạn đang bị khoá nên gian hàng không hiện với khách.' }),
        row({ id: 's2', title: 'Shop bị gỡ', isPublished: false, publicVisible: false, takenDownAt: '2026-10-05T00:00:00.000Z', takenDownReason: 'Ảnh bìa vi phạm' }),
      ]),
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<StorefrontsTab />);
    await flush();
    const a = container.querySelector('article[aria-label="Shop của Linh"]')!;
    expect(a.textContent).toContain('Đã đăng nhưng đang ẩn');
    expect(a.textContent).toContain('đang bị khoá');
    const b = container.querySelector('article[aria-label="Shop bị gỡ"]')!;
    expect(b.textContent).toContain('Đã gỡ đăng');
    expect(b.textContent).toContain('Lý do gỡ: Ảnh bìa vi phạm');
  });

  it('danh sách rỗng: nói rõ không có gian hàng khớp', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/storefronts?': page([]) }).fn));
    const { container } = mount(<StorefrontsTab />);
    await flush();
    expect(container.textContent).toContain('Không có gian hàng nào khớp bộ lọc.');
  });

  it('lỗi tải: báo lỗi, không vỡ trang', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/storefronts?': { status: 500, body: { message: 'x' } } }).fn));
    const { container } = mount(<StorefrontsTab />);
    await flush();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Không tải được danh sách gian hàng.');
  });

  it('chip trạng thái, ô loại và tìm kiếm đổi tham số gọi API', async () => {
    const api = mockFetch({ '/admin/storefronts?': page([row()]) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<StorefrontsTab />);
    await flush();
    click(byText(container, 'button', 'Chờ duyệt'));
    await flush();
    expect(api.calls.at(-1)!.url).toContain('status=PENDING_APPROVAL');
    const select = container.querySelector('select[aria-label="Loại gian hàng"]') as HTMLSelectElement;
    const { selectValue } = await import('@/test-utils/dom');
    selectValue(select, 'MERCHANT');
    await flush();
    expect(api.calls.at(-1)!.url).toContain('type=MERCHANT');
    typeInto(container.querySelector('input[aria-label="Tìm gian hàng"]'), ' 0900000001 ');
    click(byText(container, 'button', 'Tìm'));
    await flush();
    expect(api.calls.at(-1)!.url).toContain('q=0900000001');
  });

  describe('chi tiết và thao tác', () => {
    const open = async (list: AdminStorefrontRow[], d: AdminStorefrontDetail, extra: Parameters<typeof mockFetch>[0] = {}) => {
      const api = mockFetch({ '/admin/storefronts/s1/take-down': { body: row() }, '/admin/storefronts/s1/reinstate': { body: row() }, '/admin/storefronts/s1/approval': { body: row() }, ...extra, '/admin/storefronts/s1': { body: d }, '/admin/storefronts?': page(list) });
      vi.stubGlobal('fetch', vi.fn(api.fn));
      const view = mount(<StorefrontsTab />);
      await flush();
      click(byText(view.container, 'button', 'Xem'));
      await flush();
      return { api, ...view };
    };
    const dialog = () => document.body.querySelector('[role="alertdialog"]');

    it('mở chi tiết: hồ sơ, lời giới thiệu, sản phẩm trong bộ sưu tập', async () => {
      await open([row()], detail());
      const drawer = document.body.querySelector('[role="dialog"]')!;
      expect(drawer.textContent).toContain('Hàng sống xanh');
      expect(drawer.textContent).toContain('Bình nước inox');
      expect(drawer.textContent).toContain('Sản phẩm (1)');
      expect(byText(drawer as HTMLElement, 'a', 'Xem trang công khai')?.getAttribute('href')).toBe('/s/linh123');
    });

    it('D7-11: dòng "Chủ" trong hồ sơ ghi vai trò tiếng Việt (CTV), không lộ AFFILIATE', async () => {
      await open([row()], detail());
      const drawer = document.body.querySelector('[role="dialog"]')!;
      expect(drawer.textContent).toContain('Linh · 0900000001 · CTV');
      expect(drawer.textContent).not.toContain('AFFILIATE');
    });

    it('Gỡ đăng cần lý do: ô trống thì nút xác nhận bị khoá; có lý do thì gửi POST take-down và làm mới', async () => {
      const { api } = await open([row()], detail());
      const drawer = document.body.querySelector('[role="dialog"]') as HTMLElement;
      click(byText(drawer, 'button', 'Gỡ đăng'));
      await flush();
      expect(dialog()).not.toBeNull();
      const accept = byText(dialog() as HTMLElement, 'button', 'Gỡ đăng') as HTMLButtonElement;
      expect(accept.disabled).toBe(true);
      typeInto(dialog()!.querySelector('textarea'), '  Dùng ảnh của nhãn khác  ');
      expect(accept.disabled).toBe(false);
      click(accept);
      await flush();
      const call = api.calls.find((c) => c.url.includes('/take-down'))!;
      expect(call.init?.method).toBe('POST');
      expect(call.init?.body).toBe(JSON.stringify({ reason: 'Dùng ảnh của nhãn khác' }));
    });

    it('gian hàng đang bị gỡ: hiện lý do và nút Đăng lại (không còn nút Gỡ đăng); Đăng lại hỏi xác nhận rồi POST reinstate', async () => {
      const d = detail({ isPublished: false, publicVisible: false, takenDownAt: '2026-10-05T00:00:00.000Z', takenDownReason: 'Ảnh bìa vi phạm' });
      const { api } = await open([row()], d);
      const drawer = document.body.querySelector('[role="dialog"]') as HTMLElement;
      expect(drawer.textContent).toContain('Lý do: Ảnh bìa vi phạm');
      expect(byText(drawer, 'button', 'Gỡ đăng')).toBeNull();
      click(byText(drawer, 'button', 'Đăng lại'));
      await flush();
      click(byText(dialog() as HTMLElement, 'button', 'Đăng lại'));
      await flush();
      expect(api.calls.some((c) => c.url.endsWith('/admin/storefronts/s1/reinstate') && c.init?.method === 'POST')).toBe(true);
    });

    it('gian hàng CTV chưa duyệt: nút Duyệt gửi approved true; đã duyệt: nút Bỏ duyệt gửi approved false', async () => {
      const first = await open([row()], detail());
      click(byText(document.body.querySelector('[role="dialog"]') as HTMLElement, 'button', 'Duyệt gian hàng'));
      await flush();
      expect(first.api.calls.find((c) => c.url.includes('/approval'))!.init?.body).toBe(JSON.stringify({ approved: true }));
      first.unmount();
      mounted = [];
      document.body.innerHTML = '';

      const second = await open([row()], detail({ approved: true, approvedAt: '2026-10-03T00:00:00.000Z' }));
      click(byText(document.body.querySelector('[role="dialog"]') as HTMLElement, 'button', 'Bỏ duyệt'));
      await flush();
      expect(second.api.calls.find((c) => c.url.includes('/approval'))!.init?.body).toBe(JSON.stringify({ approved: false }));
    });

    it('gian hàng đối tác không có nút duyệt (luôn tính là đã duyệt)', async () => {
      await open([row()], detail({ type: 'MERCHANT', isPartner: true, approved: true }));
      const drawer = document.body.querySelector('[role="dialog"]') as HTMLElement;
      expect(byText(drawer, 'button', 'Duyệt gian hàng')).toBeNull();
      expect(byText(drawer, 'button', 'Bỏ duyệt')).toBeNull();
    });

    it('thao tác lỗi (API từ chối): hiện thông báo lỗi trong ngăn chi tiết', async () => {
      await open([row()], detail(), { '/admin/storefronts/s1/approval': { status: 403, body: { message: 'Không đủ quyền.' } } });
      const drawer = document.body.querySelector('[role="dialog"]') as HTMLElement;
      click(byText(drawer, 'button', 'Duyệt gian hàng'));
      await flush();
      expect(drawer.querySelector('[role="alert"]')!.textContent).toContain('Không đủ quyền.');
    });
  });
});
