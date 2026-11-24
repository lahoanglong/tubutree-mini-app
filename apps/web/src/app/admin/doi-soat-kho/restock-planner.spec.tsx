// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import StockReconcilePage from './page';
import type { RestockPlanReport, RestockPlanRow } from './restock-plan-api';
import type { ReconcileReport } from './reconcile-api';

const auth = vi.hoisted(() => ({ value: { user: { role: 'ADMIN' } as { role: string } | null, status: 'authenticated', initialized: true } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.value }));

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

const row = (sku: string, over: Partial<RestockPlanRow>): RestockPlanRow => ({
  variationId: `var-${sku}`,
  productId: `prod-${sku}`,
  productName: `Nước giặt ${sku}`,
  variationName: '1L',
  sku,
  supplier: 'Tubu Tree',
  stock: 0,
  sold: 0,
  waiting: 0,
  backordered: 0,
  perDay: 0,
  coverDays: 0,
  urgency: 'OUT',
  suggestedQty: 1,
  ...over,
});

const PLAN: RestockPlanReport = {
  generatedAt: '2026-11-24T05:00:00.000Z',
  windowDays: 14,
  targetDays: 30,
  q: '',
  supplier: null,
  counts: { scanned: 40, needReorder: 3, outOfStock: 1, waiting: 5, units: 61 },
  suppliers: [
    { name: 'Kokomi', rows: 1, units: 32 },
    { name: 'Tubu Tree', rows: 2, units: 29 },
  ],
  rows: [
    row('OUT', { waiting: 5, sold: 0, suggestedQty: 5, productName: 'Nước rửa chén' }),
    row('LOW', { stock: 10, sold: 28, perDay: 2, coverDays: 5, urgency: 'LOW', suggestedQty: 50, backordered: 2, supplier: 'Kokomi' }),
    row('SLOW', { stock: 1, sold: 0, coverDays: null, urgency: 'OK', suggestedQty: 6 }),
  ],
  truncated: false,
};

const RECONCILE: ReconcileReport = {
  generatedAt: '2026-11-21T05:00:00.000Z',
  minDrift: 3,
  lastSyncedAt: null,
  counts: { scanned: 0, linked: 0, withIssues: 0, NEGATIVE_LOCAL: 0, ZERO_LOCAL_PANCAKE_POSITIVE: 0, DRIFT: 0, UNLINKED: 0, NEVER_SYNCED: 0 },
  rows: [],
  truncated: false,
};

type Route = { status?: number; body: unknown };
async function mount(opts: { url?: string; plan?: RestockPlanReport; access?: string[]; exportRes?: Route; extra?: Record<string, Route> } = {}) {
  const m = mockFetch({
    ...opts.extra,
    '/admin/restock-planner/export': opts.exportRes ?? { body: 'Nhà cung cấp' },
    '/admin/restock-planner': { body: opts.plan ?? PLAN },
    '/admin/pancake-reconcile': { body: RECONCILE },
    '/admin/ops/access': { body: { role: 'STAFF', staffPermissions: opts.access ?? [] } },
  });
  vi.stubGlobal('fetch', m.fn);
  window.history.replaceState(null, '', opts.url ?? '/admin/doi-soat-kho?tab=nhap-hang');
  const r = render(<StockReconcilePage />);
  mounted.push(r);
  await flush(8);
  return { c: r.container, calls: m.calls };
}

const planCalls = (calls: { url: string }[]) => calls.filter((x) => x.url.includes('/admin/restock-planner?')).map((x) => x.url.split('?')[1]);

describe('/admin/doi-soat-kho?tab=nhap-hang: Kế hoạch nhập hàng', () => {
  it('mở thẳng tab qua URL: tiêu đề, tóm tắt, dòng gấp trước với số đề xuất, nhãn đủ bán, khách chờ, đại lý chờ; không gọi API đối soát', async () => {
    const { c, calls } = await mount();
    expect(c.querySelector('h1')!.textContent).toBe('Kế hoạch nhập hàng');
    expect(byText(c, 'button', 'Kế hoạch nhập hàng')!.getAttribute('aria-pressed')).toBe('true');
    expect(planCalls(calls)).toEqual(['days=30']);
    expect(calls.some((x) => x.url.includes('/admin/pancake-reconcile'))).toBe(false);
    expect(c.querySelector('[data-restock-summary]')!.textContent).toBe('3 biến thể cần nhập, tổng 61 đơn vị (1 đang hết hàng). 5 khách đang chờ báo hàng về.');
    expect(c.querySelector('[data-restock-plan]')!.className).toContain('tabular-nums');
    expect([...c.querySelectorAll('[data-restock-rows] li')].map((li) => li.getAttribute('data-sku'))).toEqual(['OUT', 'LOW', 'SLOW']);
    const out = c.querySelector('[data-sku="OUT"]')!;
    expect(out.textContent).toContain('Nước rửa chén · 1L');
    expect(out.textContent).toContain('Hết hàng');
    expect(out.querySelector('[data-restock-qty]')!.textContent).toBe('Nhập 5');
    expect(out.querySelector('[data-restock-waiting]')!.textContent).toBe('5 khách chờ');
    const low = c.querySelector('[data-sku="LOW"]')!;
    expect(low.textContent).toContain('SKU LOW · Kokomi');
    expect(low.textContent).toContain('Đủ bán 5 ngày');
    expect(low.textContent).toContain('Bán 14 ngày 28');
    expect(low.textContent).toContain('Đại lý chờ 2');
    expect(low.querySelector('[data-restock-waiting]')).toBeNull();
    expect(c.querySelector('[data-sku="SLOW"]')!.textContent).toContain('Chưa bán trong 14 ngày');
    expect(c.querySelector('[data-restock-formula]')!.textContent).toContain('khách chờ báo hàng về + đại lý đặt trước chưa có hàng − tồn bán được');
  });

  it('đổi tab: URL chỉ còn tab đang xem, mỗi bảng gọi đúng API của nó', async () => {
    const { c, calls } = await mount({ url: '/admin/doi-soat-kho?flag=DRIFT' });
    expect(c.querySelector('h1')!.textContent).toBe('Đối soát tồn Pancake');
    expect(planCalls(calls)).toEqual([]);
    click(byText(c, 'button', 'Kế hoạch nhập hàng'));
    await flush(8);
    expect(window.location.search).toBe('?tab=nhap-hang');
    expect(c.querySelector('h1')!.textContent).toBe('Kế hoạch nhập hàng');
    expect(planCalls(calls)).toEqual(['days=30']);
    click(byText(c, 'button', 'Đối soát tồn'));
    await flush(8);
    expect(window.location.search).toBe('');
    expect(c.querySelector('h1')!.textContent).toBe('Đối soát tồn Pancake');
    expect(c.querySelector('[data-restock-plan]')).toBeNull();
  });

  it('số ngày, nhà cung cấp và ô tìm (chờ gõ xong) chuyển xuống API; danh sách nhà cung cấp kèm số dòng', async () => {
    const { c, calls } = await mount();
    const sup = c.querySelector<HTMLSelectElement>('[data-restock-supplier]')!;
    expect([...sup.options].map((o) => o.textContent)).toEqual(['Tất cả', 'Kokomi (1)', 'Tubu Tree (2)']);
    selectValue(c.querySelector('[data-restock-days]'), '45');
    await flush(8);
    selectValue(sup, 'Kokomi');
    await flush(8);
    typeInto(c.querySelector('[data-restock-search]'), ' nuoc ');
    await wait(350);
    await flush(8);
    expect(planCalls(calls)).toEqual(['days=30', 'days=45', 'days=45&brand=Kokomi', 'days=45&q=nuoc&brand=Kokomi']);
    expect(c.querySelector<HTMLInputElement>('[data-restock-search]')!.maxLength).toBe(100);
  });

  it('nhà cung cấp đang chọn không còn trong danh sách (đổi ô tìm) thì ô chọn vẫn giữ giá trị', async () => {
    const narrowed: RestockPlanReport = {
      ...PLAN,
      supplier: 'Kokomi',
      counts: { scanned: 1, needReorder: 0, outOfStock: 0, waiting: 0, units: 0 },
      suppliers: [{ name: 'Tubu Tree', rows: 2, units: 29 }],
      rows: [],
    };
    const { c } = await mount({ extra: { 'brand=Kokomi': { body: narrowed } } });
    const sup = c.querySelector<HTMLSelectElement>('[data-restock-supplier]')!;
    selectValue(sup, 'Kokomi');
    await flush(8);
    expect(sup.value).toBe('Kokomi');
    expect([...sup.options].map((o) => o.textContent)).toEqual(['Tất cả', 'Tubu Tree (2)', 'Kokomi (0)']);
    expect(c.querySelector('[data-restock-empty]')!.textContent).toContain('Chưa có biến thể nào cần nhập của Kokomi');
  });

  it('"Tải file đặt hàng": một nút, đủ 44px, gọi file xuất với đúng bộ lọc; lỗi thì báo tiếng Việt, bảng vẫn còn', async () => {
    const savedCreate = URL.createObjectURL;
    const savedRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:csv');
    URL.revokeObjectURL = vi.fn();
    try {
      const { c, calls } = await mount();
      selectValue(c.querySelector('[data-restock-supplier]'), 'Tubu Tree');
      await flush(8);
      const btn = c.querySelector<HTMLButtonElement>('[data-restock-csv]')!;
      expect(btn.className).toContain('min-h-[44px]');
      expect(btn.textContent).toBe('Tải file đặt hàng');
      click(btn);
      await flush(8);
      expect(calls.find((x) => x.url.includes('/export'))!.url).toMatch(/\/admin\/restock-planner\/export\?days=30&brand=Tubu\+Tree$/);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      URL.createObjectURL = savedCreate;
      URL.revokeObjectURL = savedRevoke;
    }
    mounted.forEach((m) => m.unmount());
    mounted = [];
    const bad = await mount({ exportRes: { status: 429, body: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } } });
    click(bad.c.querySelector('[data-restock-csv]'));
    await flush(8);
    const alert = bad.c.querySelector('[role="alert"]')!.textContent ?? '';
    expect(alert).toContain('Không tải được file đặt hàng');
    expect(alert).not.toContain('Throttler');
    expect(bad.c.querySelector('[data-sku="OUT"]')).not.toBeNull();
  });

  it('không có gì cần nhập: câu rõ ràng, nút tải file tắt; tìm không ra thì nói không khớp', async () => {
    const none: RestockPlanReport = { ...PLAN, counts: { scanned: 40, needReorder: 0, outOfStock: 0, waiting: 0, units: 0 }, suppliers: [], rows: [] };
    let r = await mount({ plan: none });
    expect(r.c.querySelector('[data-restock-empty]')!.textContent).toBe(
      'Chưa có biến thể nào cần nhập: tồn hiện có đủ bán 30 ngày và không có khách chờ hàng về.',
    );
    expect(r.c.querySelector<HTMLButtonElement>('[data-restock-csv]')!.disabled).toBe(true);
    expect(r.c.querySelector('[data-restock-summary]')!.textContent).not.toContain('khách đang chờ');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    r = await mount({ plan: { ...none, q: 'zzz', counts: { ...none.counts, scanned: 0 } } });
    expect(r.c.querySelector('[data-restock-empty]')!.textContent).toBe('Không có SKU, sản phẩm hay nhà cung cấp nào khớp «zzz».');
  });

  it('bảng bị cắt ở trần dòng: chỉ người dùng tới file đặt hàng', async () => {
    const { c } = await mount({ plan: { ...PLAN, counts: { ...PLAN.counts, needReorder: 305 }, truncated: true } });
    expect(c.textContent).toContain('Còn 302 dòng chưa hiện');
    expect(c.textContent).toContain('Tải file đặt hàng để có đủ mọi dòng');
  });

  it('nhân viên KHO xem được; nhân viên nhóm khác bị chặn, không gọi API kế hoạch', async () => {
    auth.value = { user: { role: 'STAFF' }, status: 'authenticated', initialized: true };
    let r = await mount({ access: ['KHO'] });
    expect(r.c.querySelector('[data-sku="OUT"]')).not.toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    r = await mount({ access: ['CSKH', 'MARKETING'] });
    expect(r.c.textContent).toContain('Chỉ quản trị viên và nhân viên kho');
    expect(planCalls(r.calls)).toEqual([]);
  });

  it('trang không in mã Pancake, khoá hay bí mật nào', async () => {
    const { c } = await mount();
    expect(c.innerHTML).not.toMatch(/pancakeId|token|secret|api[_-]?key/i);
  });
});
