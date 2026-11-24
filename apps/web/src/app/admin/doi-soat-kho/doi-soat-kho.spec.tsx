// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import StockReconcilePage from './page';
import type { ReconcileReport, ReconcileRow } from './reconcile-api';

const auth = vi.hoisted(() => ({ value: { user: { role: 'ADMIN' } as { role: string } | null, status: 'authenticated', initialized: true } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.value }));
vi.mock('@/components/admin/product-edit-drawer', () => ({
  ProductEditDrawer: ({ id, categories, onClose }: { id: string; categories: { id: string }[]; onClose: () => void }) => (
    <div data-test-drawer={id} data-cats={categories.length}>
      <button type="button" onClick={onClose}>
        đóng ngăn kéo
      </button>
    </div>
  ),
}));

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  auth.value = { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
  window.history.replaceState(null, '', '/');
});

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

const row = (sku: string, over: Partial<ReconcileRow>): ReconcileRow => ({
  variationId: `var-${sku}`,
  productId: `prod-${sku}`,
  productName: `Nước giặt ${sku}`,
  variationName: '1L',
  sku,
  productActive: true,
  linked: true,
  stock: 10,
  reservedStock: 0,
  pancakeStock: 10,
  expectedStock: 10,
  drift: 0,
  flags: [],
  lastSyncedAt: '2026-11-21T03:00:00.000Z',
  ...over,
});

const REPORT: ReconcileReport = {
  generatedAt: '2026-11-21T05:00:00.000Z',
  minDrift: 3,
  lastSyncedAt: '2026-11-21T04:30:00.000Z',
  counts: { scanned: 40, linked: 37, withIssues: 3, NEGATIVE_LOCAL: 1, ZERO_LOCAL_PANCAKE_POSITIVE: 1, DRIFT: 1, UNLINKED: 1, NEVER_SYNCED: 0 },
  rows: [
    row('NEG', { stock: -2, pancakeStock: 5, expectedStock: 5, drift: -7, flags: ['NEGATIVE_LOCAL', 'ZERO_LOCAL_PANCAKE_POSITIVE', 'DRIFT'] }),
    row('UNL', { linked: false, pancakeStock: null, expectedStock: null, drift: null, flags: ['UNLINKED'], lastSyncedAt: null }),
    row('DRF', { stock: 14, flags: ['DRIFT'], drift: 4, productName: 'Nước rửa chén' }),
  ],
  truncated: false,
};

async function mount(access?: string[]) {
  const m = mockFetch({
    '/admin/pancake-reconcile': { body: REPORT },
    '/admin/ops/access': { body: { role: 'STAFF', staffPermissions: access ?? [] } },
    '/admin/categories': { body: { items: [{ id: 'c1', name: 'Giặt giũ', slug: 'giat', parentId: null, sortOrder: 1, productCount: 3, totalCount: 3 }] } },
  });
  vi.stubGlobal('fetch', m.fn);
  const r = render(<StockReconcilePage />);
  mounted.push(r);
  await flush(8);
  return { c: r.container, calls: m.calls };
}

describe('/admin/doi-soat-kho', () => {
  it('ADMIN: tóm tắt, chip theo cờ, mỗi dòng có cờ và số cửa hàng / Pancake / giữ chỗ / lệch dạng tabular-nums', async () => {
    const { c, calls } = await mount();
    expect(calls[0]!.url).toMatch(/\/admin\/pancake-reconcile\?minDrift=3$/);
    expect(c.querySelector('h1')!.textContent).toBe('Đối soát tồn Pancake');
    expect(c.querySelector('[data-reconcile-summary]')!.textContent).toContain('Đã quét 40 biến thể (37 đã gắn Pancake), 3 cần xem.');
    expect(c.querySelector('section')!.className).toContain('tabular-nums');
    const neg = c.querySelector('[data-sku="NEG"]')!;
    for (const t of ['Tồn âm', 'Hết ở cửa hàng, Pancake còn', 'Lệch tồn']) expect(neg.textContent).toContain(t);
    expect(neg.textContent).toContain('Cửa hàng-2');
    expect(neg.textContent).toContain('Lệch-7');
    expect(c.querySelector('[data-sku="UNL"]')!.textContent).toContain('Chưa gắn Pancake');
    expect(c.querySelector('[data-sku="UNL"]')!.textContent).toContain('Pancake—');
    expect(c.querySelector('[data-sku="DRF"]')!.textContent).toContain('Lệch+4');
    const chips = [...c.querySelectorAll('[aria-label="Lọc theo loại lệch"] button')].map((b) => b.textContent);
    expect(chips).toEqual(['Tất cả (3)', 'Tồn âm (1)', 'Hết ở cửa hàng, Pancake còn (1)', 'Lệch tồn (1)', 'Chưa gắn Pancake (1)']);
  });

  it('chip lọc chỉ còn dòng có cờ đó; đổi ngưỡng thì gọi lại API với minDrift mới', async () => {
    const { c, calls } = await mount();
    click(byText(c, 'button', 'Chưa gắn Pancake (1)'));
    await flush();
    expect([...c.querySelectorAll('[data-sku]')].map((e) => e.getAttribute('data-sku'))).toEqual(['UNL']);
    selectValue(c.querySelector('select'), '10');
    await flush(8);
    expect(calls.at(-1)!.url).toMatch(/minDrift=10$/);
  });

  it('ADMIN bấm "Sửa sản phẩm" mở ngăn kéo sửa đúng sản phẩm ngay trên trang (nút đủ 44px), danh mục tải khi mở', async () => {
    const { c, calls } = await mount();
    const btn = c.querySelector<HTMLButtonElement>('[data-sku="DRF"] button')!;
    expect(btn.textContent).toBe('Sửa sản phẩm');
    expect(btn.className).toContain('min-h-[44px]');
    expect(calls.some((x) => x.url.includes('/admin/categories'))).toBe(false);
    click(btn);
    await flush(8);
    const drawer = c.querySelector('[data-test-drawer]')!;
    expect(drawer.getAttribute('data-test-drawer')).toBe('prod-DRF');
    expect(drawer.getAttribute('data-cats')).toBe('1');
  });

  it('nhân viên KHO xem được nhưng không có nút sửa (API sửa sản phẩm chỉ nhận ADMIN)', async () => {
    auth.value = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    const { c, calls } = await mount(['KHO']);
    expect(c.querySelector('[data-sku="NEG"]')).not.toBeNull();
    expect(c.textContent).not.toContain('Sửa sản phẩm');
    expect(calls.some((x) => x.url.includes('/admin/categories'))).toBe(false);
  });

  it('nhân viên không có nhóm KHO và khách: chặn, không gọi API đối soát', async () => {
    auth.value = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    let r = await mount(['CSKH', 'KE_TOAN', 'MARKETING']);
    expect(r.c.textContent).toContain('Chỉ quản trị viên và nhân viên kho xem được trang đối soát tồn.');
    expect(r.calls.some((x) => x.url.includes('/admin/pancake-reconcile'))).toBe(false);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    auth.value = { user: { role: 'CUSTOMER' }, status: 'authenticated', initialized: true };
    r = await mount();
    expect(r.c.textContent).toContain('Chỉ quản trị viên và nhân viên kho');
    expect(r.calls.some((x) => x.url.includes('/admin/pancake-reconcile'))).toBe(false);
  });

  it('trang không in mã Pancake, khoá hay bí mật nào: chỉ hiện các trường đối soát', async () => {
    const { c } = await mount();
    expect(c.innerHTML).not.toMatch(/pancakeId|token|secret|api[_-]?key/i);
  });
  it('bảng bị cắt: lọc theo cờ mà dòng nằm ngoài phần cắt thì báo còn dòng chưa hiện, không báo "khớp Pancake"', async () => {
    const cut: ReconcileReport = { ...REPORT, counts: { ...REPORT.counts, withIssues: 305, NEVER_SYNCED: 5 }, truncated: true };
    vi.stubGlobal('fetch', mockFetch({ '/admin/pancake-reconcile': { body: cut } }).fn);
    const r = render(<StockReconcilePage />);
    mounted.push(r);
    await flush(8);
    expect(r.container.textContent).toContain('Còn 302 dòng chưa hiện');
    click(byText(r.container, 'button', 'Chưa đồng bộ lần nào (5)'));
    await flush();
    expect(r.container.textContent).toContain('Còn 5 dòng «Chưa đồng bộ lần nào» chưa hiện');
    expect(r.container.textContent).not.toContain('Tồn cửa hàng khớp Pancake');
  });

  it('nhân viên: không tải được quyền thì có nút Thử lại, không chặn nhầm', async () => {
    auth.value = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    vi.stubGlobal('fetch', mockFetch({ '/admin/ops/access': { status: 500, body: { message: 'lỗi' } } }).fn);
    const r = render(<StockReconcilePage />);
    mounted.push(r);
    await flush(8);
    expect(r.container.textContent).toContain('Không tải được quyền của bạn.');
    expect(byText(r.container, 'button', 'Thử lại')).not.toBeNull();
    expect(r.container.textContent).not.toContain('Chỉ quản trị viên và nhân viên kho');
  });
});

describe('/admin/doi-soat-kho — tìm SKU/tên và tải CSV (W22-02)', () => {
  it('gõ tìm: chờ ngừng gõ rồi gọi API kèm q (lọc ở API để thấy cả dòng ngoài phần cắt), ghi bộ lọc lên URL', async () => {
    const { c, calls } = await mount();
    const input = c.querySelector<HTMLInputElement>('[data-reconcile-search]')!;
    expect(input.maxLength).toBe(100);
    typeInto(input, '  nuoc rua ');
    await flush();
    expect(calls.filter((x) => x.url.includes('q='))).toHaveLength(0);
    await wait(350);
    await flush(8);
    expect(calls.at(-1)!.url).toMatch(/\/admin\/pancake-reconcile\?minDrift=3&q=nuoc\+rua$/);
    expect(window.location.search).toBe('?q=nuoc+rua');
  });

  it('mở bằng link có ?flag=UNLINKED&q=: chip đã chọn sẵn, API nhận q, bảng chỉ còn dòng chưa gắn', async () => {
    window.history.replaceState(null, '', '/admin/doi-soat-kho?flag=UNLINKED&q=unl');
    const { c, calls } = await mount();
    expect(calls[0]!.url).toMatch(/minDrift=3&q=unl$/);
    expect(c.querySelector<HTMLInputElement>('[data-reconcile-search]')!.value).toBe('unl');
    expect(byText(c, 'button', 'Chưa gắn Pancake (1)')!.getAttribute('aria-pressed')).toBe('true');
    expect([...c.querySelectorAll('[data-sku]')].map((e) => e.getAttribute('data-sku'))).toEqual(['UNL']);
  });

  it('link có ?flag= mà cờ đó đang 0 dòng: chip vẫn hiện để bỏ chọn, câu rỗng nói đúng cờ, không nói "khớp Pancake"', async () => {
    window.history.replaceState(null, '', '/admin/doi-soat-kho?flag=NEVER_SYNCED');
    const { c } = await mount();
    expect(byText(c, 'button', 'Chưa đồng bộ lần nào (0)')!.getAttribute('aria-pressed')).toBe('true');
    expect(c.textContent).toContain('Không có dòng «Chưa đồng bộ lần nào».');
    expect(c.textContent).not.toContain('Tồn cửa hàng khớp Pancake');
  });

  it('cờ lạ trên URL bị bỏ qua', async () => {
    window.history.replaceState(null, '', '/admin/doi-soat-kho?flag=pancakeId');
    const { c } = await mount();
    expect(byText(c, 'button', 'Tất cả (3)')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('"Tải CSV" gọi file xuất với đúng ngưỡng, ô tìm, chip đang chọn; bảng bị cắt thì chỉ người dùng tới nút này', async () => {
    const savedCreate = URL.createObjectURL;
    const savedRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:csv');
    URL.revokeObjectURL = vi.fn();
    try {
      const cut: ReconcileReport = { ...REPORT, counts: { ...REPORT.counts, withIssues: 305, DRIFT: 50 }, truncated: true };
      const m = mockFetch({
        '/admin/pancake-reconcile/export': { body: 'SKU' },
        '/admin/pancake-reconcile': { body: cut },
      });
      vi.stubGlobal('fetch', m.fn);
      window.history.replaceState(null, '', '/admin/doi-soat-kho?flag=DRIFT&q=drf');
      const r = render(<StockReconcilePage />);
      mounted.push(r);
      await flush(8);
      expect(r.container.textContent).toContain('Bấm «Tải CSV» để có đủ mọi dòng');
      const btn = r.container.querySelector<HTMLButtonElement>('[data-reconcile-csv]')!;
      expect(btn.className).toContain('min-h-[44px]');
      click(btn);
      await flush(8);
      const call = m.calls.find((x) => x.url.includes('/export'))!;
      expect(call.url).toMatch(/\/admin\/pancake-reconcile\/export\?minDrift=3&q=drf&flag=DRIFT$/);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      URL.createObjectURL = savedCreate;
      URL.revokeObjectURL = savedRevoke;
    }
  });

  it('bấm tải CSV quá trần của API (429): câu tiếng Việt bảo đợi rồi thử lại, không lộ chữ tiếng Anh của throttler', async () => {
    const m = mockFetch({
      '/admin/pancake-reconcile/export': { status: 429, body: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } },
      '/admin/pancake-reconcile': { body: REPORT },
    });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<StockReconcilePage />);
    mounted.push(r);
    await flush(8);
    click(r.container.querySelector('[data-reconcile-csv]'));
    await flush(8);
    const alert = r.container.querySelector('[role="alert"]')!.textContent ?? '';
    expect(alert).toContain('Không tải được file CSV');
    expect(alert).toContain('đợi vài giây rồi thử lại');
    expect(alert).not.toContain('Throttler');
    expect(r.container.querySelector('[data-sku="NEG"]')).not.toBeNull();
  });

  it('tải CSV lỗi: báo lỗi tiếng Việt, bảng vẫn còn', async () => {
    const m = mockFetch({
      '/admin/pancake-reconcile/export': { status: 403, body: { message: 'Bạn không có quyền.' } },
      '/admin/pancake-reconcile': { body: REPORT },
    });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<StockReconcilePage />);
    mounted.push(r);
    await flush(8);
    click(r.container.querySelector('[data-reconcile-csv]'));
    await flush(8);
    expect(r.container.querySelector('[role="alert"]')!.textContent).toContain('Không tải được file CSV');
    expect(r.container.querySelector('[data-sku="NEG"]')).not.toBeNull();
  });

  it('tìm không ra gì: nói rõ không có SKU nào khớp, không nói "khớp Pancake"', async () => {
    const none: ReconcileReport = {
      ...REPORT,
      q: 'zzz',
      counts: { scanned: 0, linked: 0, withIssues: 0, NEGATIVE_LOCAL: 0, ZERO_LOCAL_PANCAKE_POSITIVE: 0, DRIFT: 0, UNLINKED: 0, NEVER_SYNCED: 0 },
      rows: [],
    };
    vi.stubGlobal('fetch', mockFetch({ '/admin/pancake-reconcile': { body: none } }).fn);
    window.history.replaceState(null, '', '/admin/doi-soat-kho?q=zzz');
    const r = render(<StockReconcilePage />);
    mounted.push(r);
    await flush(8);
    expect(r.container.textContent).toContain('Không có SKU hay sản phẩm kho Tubu nào khớp «zzz».');
    expect(r.container.textContent).not.toContain('Tồn cửa hàng khớp Pancake');
  });
});
