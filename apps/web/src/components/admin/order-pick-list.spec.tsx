// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import { collectFilterOrderIds, pickPaymentText, type PickListResponse } from '@/lib/admin-pick-list';
import { OrderBulkBar, useOrderBulkSelection, type BulkPick } from './order-bulk-bar';
import { PickListFilterButton, PickListSheet } from './order-pick-list';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const PICK: PickListResponse = {
  generatedAt: '2026-11-24T05:00:00.000Z',
  orderCount: 2,
  totalUnits: 6,
  giftUnits: 1,
  summary: [
    { variationId: 'v1', sku: 'NRC-500', productName: 'Nước rửa chén', variationName: '500ml', quantity: 5, backorderedQty: 0, redeemed: false, isGift: false, orderCount: 2 },
    { variationId: 'v2', sku: 'TUI-LUOI', productName: 'Túi lưới', variationName: 'Túi lưới', quantity: 1, backorderedQty: 0, redeemed: false, isGift: false, orderCount: 1 },
    { variationId: 'v2', sku: 'TUI-LUOI', productName: 'Túi lưới', variationName: 'Túi lưới', quantity: 1, backorderedQty: 0, redeemed: false, isGift: true, orderCount: 1 },
  ],
  orders: [
    {
      id: 'id-1',
      code: 'TB0001',
      status: 'CONFIRMED',
      statusLabel: 'Đã xác nhận',
      type: 'RETAIL',
      createdAt: '2026-11-24T02:00:00.000Z',
      recipient: 'Chị Lan',
      phoneMasked: '091****678',
      address: '12 Lê Lợi, Phường Bến Thành, TP Hồ Chí Minh',
      note: 'Gọi trước khi giao',
      hasRecyclingPickup: false,
      items: [{ variationId: 'v1', sku: 'NRC-500', productName: 'Nước rửa chén', variationName: '500ml', quantity: 2, backorderedQty: 0, redeemed: false }],
      gifts: [{ variationId: 'v2', sku: 'TUI-LUOI', productName: 'Túi lưới', variationName: 'Túi lưới', quantity: 1, backorderedQty: 0, redeemed: false }],
      payment: { method: 'COD', state: 'COD', total: 245_000, collect: 245_000 },
    },
    {
      id: 'id-2',
      code: 'TB0002',
      status: 'CONFIRMED',
      statusLabel: 'Đã xác nhận',
      type: 'RETAIL',
      createdAt: '2026-11-24T03:00:00.000Z',
      recipient: 'Anh Minh',
      phoneMasked: '098****321',
      address: '5 Trần Phú, Hà Nội',
      note: null,
      hasRecyclingPickup: true,
      items: [
        { variationId: 'v1', sku: 'NRC-500', productName: 'Nước rửa chén', variationName: '500ml', quantity: 3, backorderedQty: 0, redeemed: false },
        { variationId: 'v2', sku: 'TUI-LUOI', productName: 'Túi lưới', variationName: 'Túi lưới', quantity: 1, backorderedQty: 0, redeemed: false },
      ],
      gifts: [],
      payment: { method: 'WALLET', state: 'PAID', total: 410_000, collect: 0 },
    },
  ],
  excluded: [{ id: 'id-3', code: 'TB0003', status: 'CANCELLED', reason: 'Đơn TB0003 đã huỷ: không soạn, không đóng gói.' }],
};

const sheet = () => document.querySelector<HTMLElement>('[data-pick-list-root]');
const pickCalls = (m: ReturnType<typeof mockFetch>) => m.calls.filter((c) => c.url.includes('/admin/orders/pick-list'));

describe('pickPaymentText', () => {
  it('COD in đúng số thu; đã trả, công nợ thu 0; chờ tiền ghi CHƯA GIAO', () => {
    expect(pickPaymentText({ method: 'COD', state: 'COD', total: 245_000, collect: 245_000 })).toEqual({ text: `Thu COD ${(245_000).toLocaleString('vi-VN')}đ`, tone: 'collect' });
    expect(pickPaymentText({ method: 'WALLET', state: 'PAID', total: 1, collect: 0 })).toEqual({ text: 'Đã thanh toán (Ví Tubu) · không thu tiền', tone: 'none' });
    expect(pickPaymentText({ method: 'BANK_TRANSFER', state: 'CREDIT', total: 1, collect: 0 }).text).toBe('Đại lý ghi công nợ · không thu tiền');
    expect(pickPaymentText({ method: 'BANK_TRANSFER', state: 'AWAITING_TRANSFER', total: 320_000, collect: 0 })).toEqual({
      text: `Chờ chuyển khoản ${(320_000).toLocaleString('vi-VN')}đ · CHƯA GIAO`,
      tone: 'hold',
    });
    expect(pickPaymentText({ method: 'VNPAY', state: 'AWAITING_GATEWAY', total: 10, collect: 0 }).tone).toBe('hold');
  });
});

describe('PickListSheet', () => {
  async function open(ids: string[], routes: Parameters<typeof mockFetch>[0] = { '/admin/orders/pick-list': { body: PICK } }) {
    const m = mockFetch(routes);
    vi.stubGlobal('fetch', m.fn);
    const onClose = vi.fn();
    mounted.push(render(<PickListSheet ids={ids} onClose={onClose} />));
    await flush();
    return { m, onClose };
  }

  it('gọi API với đúng mã đơn, in Phần 1 gộp biến thể (quà 0đ dòng riêng) và Phần 2 từng đơn với SĐT đã che, số thu COD', async () => {
    const { m } = await open(['id-1', 'id-2', 'id-3']);
    expect(pickCalls(m)).toHaveLength(1);
    expect(pickCalls(m)[0]!.url).toContain('/admin/orders/pick-list?ids=id-1,id-2,id-3');

    const root = sheet()!;
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.textContent).toContain('Phiếu soạn hàng · 2 đơn');
    expect(root.textContent).toContain('6 món bán + 1 quà 0đ');

    const rows = [...root.querySelectorAll<HTMLElement>('[data-pick-summary] tbody tr')];
    expect(rows.map((r) => [r.dataset.pickRow, r.dataset.gift])).toEqual([
      ['NRC-500', 'false'],
      ['TUI-LUOI', 'false'],
      ['TUI-LUOI', 'true'],
    ]);
    expect(rows[0]!.textContent).toContain('Nước rửa chén · 500ml');
    expect(rows[2]!.textContent).toContain('Quà 0đ');
    expect(rows[1]!.textContent).not.toContain('Túi lưới · Túi lưới');

    const slips = [...root.querySelectorAll<HTMLElement>('[data-pick-order]')];
    expect(slips.map((s) => s.dataset.pickOrder)).toEqual(['TB0001', 'TB0002']);
    expect(slips[0]!.textContent).toContain('091****678');
    expect(slips[0]!.textContent).not.toContain('0912345678');
    expect(slips[0]!.querySelector('[data-pick-payment]')!.textContent).toBe(`Thu COD ${(245_000).toLocaleString('vi-VN')}đ`);
    expect(slips[0]!.querySelector('[data-pick-gifts]')!.textContent).toContain('Quà tặng 0đ (không tính tiền)');
    expect(slips[0]!.querySelector('[data-pick-items]')!.textContent).not.toContain('Túi lưới');
    expect(slips[1]!.querySelector('[data-pick-payment]')!.getAttribute('data-pick-payment')).toBe('PAID');
    expect(slips[1]!.textContent).toContain('Kèm thu gom vỏ');
    expect(slips[1]!.querySelector('[data-pick-gifts]')).toBeNull();

    const warn = root.querySelector('[data-pick-excluded]')!;
    expect(warn.textContent).toContain('Không in 1 đơn:');
    expect(warn.textContent).toContain('Đơn TB0003 đã huỷ');
  });

  it('quá 20 đơn bị loại: hiện 20 lý do và gộp phần còn lại một dòng', async () => {
    const excluded = Array.from({ length: 23 }, (_, i) => ({ id: `x${i}`, code: `TB9${i}`, status: 'DELIVERED', reason: `Đơn TB9${i} đã giao: hàng đã rời kho, không soạn lại.` }));
    await open(['id-1'], { '/admin/orders/pick-list': { body: { ...PICK, excluded } } });
    const items = [...sheet()!.querySelectorAll('[data-pick-excluded] li')].map((li) => li.textContent);
    expect(items).toHaveLength(21);
    expect(items[0]).toBe('Đơn TB90 đã giao: hàng đã rời kho, không soạn lại.');
    expect(items[20]).toBe('… và 3 đơn khác (đã huỷ, đã rời kho hoặc chưa trả tiền).');
    expect(sheet()!.textContent).toContain('Không in 23 đơn:');
  });

  it('quà đổi điểm: Phần 1 không in dòng mã SKU, phiếu từng đơn in mã QG', async () => {
    const gift = { variationId: 'redeem|Bình tre', sku: null, productName: 'Bình tre', variationName: 'Quà đổi điểm', quantity: 2, backorderedQty: 0, redeemed: true, isGift: true, orderCount: 2 };
    const slipGift = { variationId: 'redeem:QG123', sku: 'QG123', productName: 'Bình tre', variationName: 'Quà đổi điểm', quantity: 1, backorderedQty: 0, redeemed: true };
    const body = { ...PICK, summary: [...PICK.summary, gift], orders: [{ ...PICK.orders[0]!, gifts: [slipGift] }, PICK.orders[1]!] };
    await open(['id-1', 'id-2'], { '/admin/orders/pick-list': { body } });
    const row = sheet()!.querySelector<HTMLElement>('[data-pick-row="redeem|Bình tre"]')!;
    expect(row.textContent).toContain('Bình tre · Quà đổi điểm');
    expect(row.textContent).not.toContain('Chưa có mã SKU');
    expect(sheet()!.querySelector('[data-pick-order="TB0001"] [data-pick-gifts]')!.textContent).toContain('QG123');
  });

  it('khổ in A4: chỉ in lớp phủ, Phần 2 sang trang mới, phiếu từng đơn không bị cắt', async () => {
    await open(['id-1']);
    const css = sheet()!.querySelector('style')!.textContent!;
    expect(css).toContain('@page { size: A4 portrait');
    expect(css).toContain('body > *:not([data-pick-list-root]) { display: none !important; }');
    expect(css).toContain('[data-pick-part="orders"] { break-before: page;');
    expect(css).toContain('[data-pick-order] { break-inside: avoid;');
    expect(css).toContain('[data-pick-list-toolbar] { display: none !important; }');
    expect(css).toContain('html, body { background: #fff !important; overflow: visible !important;');
  });

  it('nút In gọi window.print khi đã có phiếu; Esc và Đóng gọi onClose', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const { onClose } = await open(['id-1']);
    const printBtn = sheet()!.querySelector<HTMLButtonElement>('[data-pick-print]')!;
    expect(printBtn.disabled).toBe(false);
    click(printBtn);
    expect(print).toHaveBeenCalledTimes(1);

    expect(document.activeElement?.hasAttribute('data-pick-close')).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    click(sheet()!.querySelector('[data-pick-close]'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('mọi đơn bị loại: không có gì để in, nút In khoá, vẫn hiện lý do', async () => {
    await open(['id-3'], { '/admin/orders/pick-list': { body: { ...PICK, orderCount: 0, totalUnits: 0, giftUnits: 0, summary: [], orders: [] } } });
    const root = sheet()!;
    expect(root.querySelector<HTMLButtonElement>('[data-pick-print]')!.disabled).toBe(true);
    expect(root.textContent).toContain('Không còn đơn nào cần soạn trong lượt này.');
    expect(root.querySelector('[data-pick-excluded]')).not.toBeNull();
    expect(root.querySelector('[data-pick-summary]')).toBeNull();
  });

  it('lỗi tải hiện lời báo và Thử lại gọi lại API', async () => {
    let fail = true;
    const { m } = await open(['id-1'], {
      '/admin/orders/pick-list': () => (fail ? { status: 400, body: { message: 'Mỗi lượt in tối đa 200 đơn.' } } : { body: PICK }),
    });
    const root = sheet()!;
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Mỗi lượt in tối đa 200 đơn.');
    expect(root.querySelector<HTMLButtonElement>('[data-pick-print]')!.disabled).toBe(true);
    fail = false;
    click(byText(root, 'button', 'Thử lại'));
    await flush();
    expect(pickCalls(m)).toHaveLength(2);
    expect(root.querySelectorAll('[data-pick-order]')).toHaveLength(2);
  });
});

const listPage = (ids: string[], total: number) => ({ body: { data: ids.map((id) => ({ id, code: id.replace('id-', 'TB') })), meta: { total, page: 1, limit: 100 } } });

describe('collectFilterOrderIds', () => {
  it('gom đủ hai trang 100 đơn theo đúng bộ lọc, bỏ trùng', async () => {
    const first = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    const second = ['id-99', ...Array.from({ length: 50 }, (_, i) => `id-${100 + i}`)];
    const m = mockFetch({ 'page=1&': listPage(first, 150), 'page=2&': listPage(second, 150) });
    vi.stubGlobal('fetch', m.fn);
    const r = await collectFilterOrderIds({ status: 'CONFIRMED', from: '2026-11-24', to: '2026-11-24' });
    expect(r.tooMany).toBe(false);
    expect(r.total).toBe(150);
    expect(r.ids).toHaveLength(150);
    expect(r.ids[0]).toBe('id-0');
    expect(r.ids.at(-1)).toBe('id-149');
    expect(m.calls[0]!.url).toContain('/admin/orders?page=1&limit=100&status=CONFIRMED');
    expect(m.calls[0]!.url).toContain('&from=2026-11-24&to=2026-11-24');
    expect(m.calls).toHaveLength(2);
  });

  it('bộ lọc quá 200 đơn: không trả mã nào, chỉ đọc một trang', async () => {
    const m = mockFetch({ 'page=1&': listPage(['id-1'], 201) });
    vi.stubGlobal('fetch', m.fn);
    expect(await collectFilterOrderIds({})).toEqual({ ids: [], total: 201, tooMany: true, complete: true });
    expect(m.calls).toHaveLength(1);
  });

  const first100 = Array.from({ length: 100 }, (_, i) => `id-${i}`);
  // Đơn id-5 rời bộ lọc giữa hai lần đọc: trang 2 trượt một chỗ, id-100 không bao giờ được đọc; số mã gom (149) vẫn bằng tổng mới.
  const shiftedPage2 = listPage(Array.from({ length: 49 }, (_, i) => `id-${101 + i}`), 149);

  it('danh sách trượt giữa hai trang: gom lại một lần; lần sau đủ thì dùng lần sau', async () => {
    let round = 0;
    const m = mockFetch({
      'page=1&': () => {
        round++;
        return round === 1 ? listPage(first100, 150) : listPage([...first100.filter((id) => id !== 'id-5'), 'id-100'], 149);
      },
      'page=2&': shiftedPage2,
    });
    vi.stubGlobal('fetch', m.fn);
    const r = await collectFilterOrderIds({ status: 'CONFIRMED' });
    expect(m.calls).toHaveLength(4);
    expect(r.complete).toBe(true);
    expect(r.ids).toContain('id-100');
    expect(r.ids).not.toContain('id-5');
    expect(r.ids).toHaveLength(149);
  });

  it('vẫn trượt sau khi gom lại: báo chưa đủ', async () => {
    const m = mockFetch({ 'page=1&': listPage(first100, 150), 'page=2&': shiftedPage2 });
    vi.stubGlobal('fetch', m.fn);
    const r = await collectFilterOrderIds({ status: 'CONFIRMED' });
    expect(m.calls).toHaveLength(4);
    expect(r.complete).toBe(false);
    expect(r.ids).not.toContain('id-100');
  });
});

describe('PickListFilterButton', () => {
  it('in mọi đơn khớp bộ lọc: gom mã rồi mở phiếu với đúng các mã đó', async () => {
    const m = mockFetch({ 'page=1&': listPage(['id-1', 'id-2'], 2), '/admin/orders/pick-list': { body: PICK } });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<PickListFilterButton filter={{ status: 'CONFIRMED' }} total={2} />);
    mounted.push(r);
    const btn = r.container.querySelector<HTMLButtonElement>('[data-pick-filter]')!;
    expect(btn.textContent).toContain('In phiếu soạn (2 đơn)');
    click(btn);
    await flush();
    expect(pickCalls(m)[0]!.url).toContain('ids=id-1,id-2');
    expect(sheet()).not.toBeNull();
    click(sheet()!.querySelector('[data-pick-close]'));
    expect(sheet()).toBeNull();
  });

  it('danh sách vẫn trượt: vẫn mở phiếu nhưng cảnh báo in lại (cả bản in)', async () => {
    const first100 = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    const m = mockFetch({
      'page=1&': listPage(first100, 150),
      'page=2&': listPage(Array.from({ length: 49 }, (_, i) => `id-${101 + i}`), 149),
      '/admin/orders/pick-list': { body: PICK },
    });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<PickListFilterButton filter={{}} total={150} />);
    mounted.push(r);
    click(r.container.querySelector('[data-pick-filter]'));
    await flush();
    expect(sheet()!.querySelector('[data-pick-notice]')!.textContent).toBe(
      'Danh sách đơn đổi ngay lúc gom (có đơn vừa đổi trạng thái hoặc đơn mới vào): phiếu này có thể thiếu đơn. Đóng phiếu rồi bấm in lại để chắc đủ đơn.',
    );
  });

  it('quá 200 đơn: báo lọc hẹp lại, không mở phiếu', async () => {
    const m = mockFetch({ 'page=1&': listPage(['id-1'], 340) });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<PickListFilterButton filter={{}} total={340} />);
    mounted.push(r);
    click(r.container.querySelector('[data-pick-filter]'));
    await flush();
    expect(r.container.querySelector('[data-pick-filter-msg]')!.textContent).toBe(
      'Bộ lọc đang có 340 đơn, mỗi lượt in tối đa 200 đơn. Lọc theo trạng thái hoặc ngày đặt rồi in lại.',
    );
    expect(sheet()).toBeNull();
    expect(pickCalls(m)).toHaveLength(0);
  });

  it('chưa có số đơn hoặc khoảng ngày sai thì khoá nút', () => {
    const a = render(<PickListFilterButton filter={{}} total={undefined} />);
    const b = render(<PickListFilterButton filter={{}} total={3} disabled />);
    mounted.push(a, b);
    expect(a.container.querySelector<HTMLButtonElement>('[data-pick-filter]')!.disabled).toBe(true);
    expect(b.container.querySelector<HTMLButtonElement>('[data-pick-filter]')!.disabled).toBe(true);
  });
});

describe('OrderBulkBar: in phiếu soạn các đơn đang chọn', () => {
  const list: BulkPick[] = [
    { id: 'id-1', code: 'TB0001' },
    { id: 'id-2', code: 'TB0002' },
  ];
  function Harness({ targets }: { targets: ('PACKED' | 'CANCELLED')[] }) {
    const sel = useOrderBulkSelection('a');
    return (
      <div>
        <button type="button" data-pick-all onClick={() => sel.addMany(list)}>
          chọn
        </button>
        <OrderBulkBar selection={sel} targets={targets} pageOrders={list} />
      </div>
    );
  }

  it('KHO/ADMIN (được đóng gói) có nút in; bấm mở phiếu với đúng các đơn đã chọn', async () => {
    const m = mockFetch({ '/admin/orders/pick-list': { body: PICK } });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<Harness targets={['PACKED']} />);
    mounted.push(r);
    click(r.container.querySelector('[data-pick-all]'));
    const btn = r.container.querySelector<HTMLButtonElement>('[data-bulk-print]')!;
    expect(btn.textContent).toBe('In phiếu soạn');
    click(btn);
    await flush();
    expect(pickCalls(m)[0]!.url).toContain('ids=id-1,id-2');
    expect(sheet()!.querySelectorAll('[data-pick-order]')).toHaveLength(2);
  });

  it('CSKH (chỉ được huỷ) không có nút in', () => {
    const r = render(<Harness targets={['CANCELLED']} />);
    mounted.push(r);
    click(r.container.querySelector('[data-pick-all]'));
    expect(r.container.querySelector('[data-bulk-bar]')).not.toBeNull();
    expect(r.container.querySelector('[data-bulk-print]')).toBeNull();
  });
});
