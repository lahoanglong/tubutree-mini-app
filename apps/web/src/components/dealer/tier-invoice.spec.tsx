// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatVnd } from '@/lib/format-vnd';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { TierProgress } from './tier-progress';
import { OrdersTab } from './orders-tab';
import { PriceTab } from './price-tab';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  push.mockReset();
  vi.unstubAllGlobals();
});

const CUR = { id: 'DEALER_1', name: 'Đại lý Cấp 1', minOrderVolume: 10_000_000, discountPct: 20 };
const NEXT = { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30 };
const PROGRESS = {
  month: '11/2026',
  monthStart: '2026-10-31T17:00:00.000Z',
  monthEnd: '2026-11-30T17:00:00.000Z',
  volume: 12_000_000,
  pendingVolume: 0,
  currentTier: CUR,
  nextTier: { ...NEXT, toGo: 18_000_000 },
};
const INVOICE = { taxCode: '0312345678', companyName: 'Công ty A', address: '1 Phố Huế, Hà Nội', email: 'ketoan@a.vn' };
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body ?? '{}'));

describe('TierProgress: doanh số tháng tới mốc bậc kế', () => {
  async function show(progress: unknown) {
    vi.stubGlobal('fetch', mockFetch({ '/dealer/tier-progress': { body: progress } }).fn);
    mounted = render(<TierProgress />);
    await flush();
    return mounted.container;
  }

  it('thanh theo phần trăm mốc kế, số đã chốt / mốc, câu còn thiếu', async () => {
    const c = await show(PROGRESS);
    const bar = c.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('40');
    expect(bar?.getAttribute('aria-label')).toBe('Doanh số tháng 11/2026 tới mốc Đại lý Cấp 2');
    expect(c.textContent).toContain(`${formatVnd(12_000_000)} / ${formatVnd(30_000_000)}`);
    expect(c.textContent).toContain(`Còn ${formatVnd(18_000_000)} trong tháng 11/2026 để được xét lên Đại lý Cấp 2 (chiết khấu 30%).`);
  });

  it('bậc cao nhất: không có thanh, chỉ một câu', async () => {
    const c = await show({ ...PROGRESS, nextTier: null });
    expect(c.querySelector('[role="progressbar"]')).toBeNull();
    expect(c.textContent).toBe('Bạn đang ở bậc chiết khấu cao nhất (20%).');
  });

  it('chưa được gán bậc hoặc lỗi tải: không vẽ gì', async () => {
    expect((await show({ ...PROGRESS, currentTier: null, nextTier: null })).innerHTML).toBe('');
    mounted?.unmount();
    vi.stubGlobal('fetch', mockFetch({}).fn);
    mounted = render(<TierProgress />);
    await flush();
    expect(mounted.container.innerHTML).toBe('');
  });
});

describe('OrdersTab: yêu cầu hoá đơn VAT nhiều đơn', () => {
  const now = new Date().toISOString();
  const order = (code: string, over: Record<string, unknown> = {}) => ({
    code,
    status: 'DELIVERED',
    paymentMethod: 'BANK_TRANSFER',
    invoiceStatus: 'NOT_REQUESTED',
    total: 3_000_000,
    createdAt: now,
    items: [{ variationId: 'v1', quantity: 1, backorderedQty: 0 }],
    ...over,
  });
  const ORDERS = [order('DL1'), order('DL2'), order('DL3', { invoiceStatus: 'REQUESTED' }), order('DL4', { status: 'CANCELLED' })];

  function mount(profile: unknown, onRequest = vi.fn((_init?: RequestInit) => ({ body: { requested: ['DL1', 'DL2'], skipped: [], profile: null } }))) {
    const { fn, calls } = mockFetch({
      '/dealer/orders/invoice-request': onRequest,
      '/dealer/orders': { body: ORDERS },
      '/dealer/invoice-profile': { body: profile },
    });
    vi.stubGlobal('fetch', fn);
    mounted = render(<OrdersTab onOrderFirst={() => {}} />);
    return { calls, onRequest };
  }

  it('một nút nêu số đơn đủ điều kiện; dòng đơn đã yêu cầu ghi chú cùng dòng ngày', async () => {
    mount({ ...INVOICE, saved: true });
    await flush();
    const c = mounted!.container;
    expect(byText(c, 'button', 'Yêu cầu hoá đơn VAT')?.textContent).toBe('Yêu cầu hoá đơn VAT (2 đơn)');
    expect(c.textContent).toContain('Đã yêu cầu HĐ VAT');
  });

  it('sheet chọn sẵn mọi đơn, điền sẵn từ hồ sơ; thiếu email thì báo lỗi và không gửi; đủ thì gửi đúng mã đơn và thông tin', async () => {
    const { onRequest } = mount({ taxCode: '0312 345 678', companyName: 'Công ty A', address: '1 Phố Huế, Hà Nội', email: '', saved: false });
    await flush();
    click(byText(mounted!.container, 'button', 'Yêu cầu hoá đơn VAT'));
    await flush();
    const d = dialog()!;
    expect(Array.from(d.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map((i) => i.checked)).toEqual([true, true, true]);
    expect(d.querySelector<HTMLInputElement>('input[autocomplete="organization"]')?.value).toBe('Công ty A');

    click(byText(d, 'button', 'Gửi yêu cầu (2 đơn)'));
    await flush();
    expect(onRequest).not.toHaveBeenCalled();
    expect(d.textContent).toContain('Nhập email nhận hoá đơn.');

    typeInto(d.querySelector('input[type="email"]'), 'ketoan@a.vn');
    click(byText(d, 'button', 'Gửi yêu cầu (2 đơn)'));
    await flush();
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(bodyOf(onRequest.mock.calls[0]![0])).toEqual({ orderCodes: ['DL1', 'DL2'], invoice: { ...INVOICE, taxCode: '0312345678' }, save: true });
    expect(dialog()).toBeNull();
    expect(mounted!.container.textContent).toContain('Đã gửi yêu cầu hoá đơn VAT cho 2 đơn.');
  });

  it('bỏ chọn một đơn và bỏ "Lưu làm mặc định": chỉ gửi đơn còn chọn, save=false', async () => {
    const { onRequest } = mount({ ...INVOICE, saved: true });
    await flush();
    click(byText(mounted!.container, 'button', 'Yêu cầu hoá đơn VAT'));
    await flush();
    const d = dialog()!;
    const boxes = d.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    click(boxes[0]!);
    click(boxes[2]!);
    expect(byText(d, 'button', 'Gửi yêu cầu')?.textContent).toBe('Gửi yêu cầu (1 đơn)');
    click(byText(d, 'button', 'Gửi yêu cầu'));
    await flush();
    expect(bodyOf(onRequest.mock.calls[0]![0])).toMatchObject({ orderCodes: ['DL2'], save: false });
  });
});

describe('PriceTab: lãi bán lẻ, mốc bậc khi cộng đơn, xuất hoá đơn VAT một chạm', () => {
  const ROW = { variationId: 'v1', sku: 'S1', product: 'Phân A', brand: 'Tubu', variation: '1kg', retailPrice: 100_000, dealerPrice: 80_000, discountPct: 20, stock: 9 };
  const ORDER = { code: 'DL9', status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', items: [{ variationId: 'v1', quantity: 1, backorderedQty: 0 }] };

  function mount(profile: unknown, earlierOrder?: Record<string, unknown>) {
    const placed = vi.fn((init?: RequestInit) => ({
      body: earlierOrder ?? { ...ORDER, invoiceStatus: bodyOf(init).invoiceRequest ? 'REQUESTED' : 'NOT_REQUESTED' },
    }));
    const saved = vi.fn((init?: RequestInit) => ({ body: { ...bodyOf(init), saved: true } }));
    const { fn } = mockFetch({
      '/dealer/pricelist': { body: [ROW] },
      '/dealer/templates': { body: [] },
      '/dealer/tier-progress': { body: PROGRESS },
      '/dealer/invoice-profile': (init?: RequestInit) => (init?.method === 'PUT' ? saved(init) : { body: profile }),
      '/dealer/orders': placed,
    });
    vi.stubGlobal('fetch', fn);
    mounted = render(<PriceTab creditLimit={50_000_000} debt={0} />);
    return { placed, saved };
  }
  const addOne = async () => {
    await flush();
    click(mounted!.container.querySelector('[aria-label^="Tăng số lượng"]'));
    await flush();
  };
  const invoiceBox = () => byText(mounted!.container, 'label', 'Xuất hoá đơn VAT')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

  it('dòng thông tin: lãi nếu bán đúng giá lẻ và giỏ còn thiếu bao nhiêu tới mốc bậc kế', async () => {
    mount({ ...INVOICE, saved: true });
    await addOne();
    expect(mounted!.container.querySelector('[data-testid="dealer-basket-insight"]')?.textContent).toBe(
      `Bán đúng giá lẻ lãi ${formatVnd(20_000)} (20%) · Cộng đơn này còn thiếu ${formatVnd(17_920_000)} tới mốc Đại lý Cấp 2.`,
    );
  });

  it('không bật ô: đơn không kèm yêu cầu hoá đơn', async () => {
    const { placed } = mount({ ...INVOICE, saved: true });
    await addOne();
    click(byText(mounted!.container, 'button', 'Ghi công nợ'));
    await flush();
    expect(bodyOf(placed.mock.calls[0]![0])).not.toHaveProperty('invoiceRequest');
  });

  it('đã lưu thông tin: một chạm bật, hiện MST, đơn gửi kèm đúng 4 trường hoá đơn', async () => {
    const { placed } = mount({ ...INVOICE, saved: true });
    await addOne();
    click(invoiceBox());
    await flush();
    expect(dialog()).toBeNull();
    expect(invoiceBox().checked).toBe(true);
    expect(mounted!.container.textContent).toContain('MST 0312345678 · Sửa');
    click(byText(mounted!.container, 'button', 'Ghi công nợ'));
    await flush();
    expect(bodyOf(placed.mock.calls[0]![0]).invoiceRequest).toEqual(INVOICE);
    expect(mounted!.container.textContent).toContain('Đã tạo đơn đại lý!');
  });

  it('bật ô nhưng máy chủ trả đơn của lần đặt trước (cùng khoá) chưa có yêu cầu hoá đơn: báo lỗi, chỉ đường sang tab Đơn hàng', async () => {
    mount({ ...INVOICE, saved: true }, { ...ORDER, invoiceStatus: 'NOT_REQUESTED' });
    await addOne();
    click(invoiceBox());
    await flush();
    click(byText(mounted!.container, 'button', 'Ghi công nợ'));
    await flush();
    const alert = mounted!.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('Đã tạo đơn đại lý! Đơn chưa kèm yêu cầu hoá đơn VAT (đã tạo ở lần đặt trước), bạn gửi yêu cầu ở tab Đơn hàng.');
  });

  it('chưa lưu: bấm ô mở sheet điền sẵn từ hồ sơ, lưu xong ô bật và đơn kèm thông tin vừa lưu', async () => {
    const { placed, saved } = mount({ ...INVOICE, email: '', saved: false });
    await addOne();
    click(invoiceBox());
    await flush();
    const d = dialog()!;
    expect(invoiceBox().checked).toBe(false);
    expect(d.textContent).toContain('Đã điền sẵn từ hồ sơ đại lý');
    typeInto(d.querySelector('input[type="email"]'), 'ketoan@a.vn');
    click(byText(d, 'button', 'Lưu thông tin'));
    await flush();
    expect(bodyOf(saved.mock.calls[0]![0])).toEqual(INVOICE);
    expect(dialog()).toBeNull();
    expect(invoiceBox().checked).toBe(true);
    click(byText(mounted!.container, 'button', 'Ghi công nợ'));
    await flush();
    expect(bodyOf(placed.mock.calls[0]![0]).invoiceRequest).toEqual(INVOICE);
  });
});
