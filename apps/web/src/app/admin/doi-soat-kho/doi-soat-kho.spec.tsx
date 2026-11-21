// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, mockFetch, render, selectValue, type Rendered } from '@/test-utils/dom';
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
});

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
