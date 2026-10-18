// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { expectNoBannedCopy, wasteGift } from '@/test-utils/fixtures/waste-admin';
import { WasteGiftsSection } from './waste-gifts-section';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const GIFTS = [
  wasteGift(),
  wasteGift({ id: 'gift-tree', kind: 'TREE', name: 'Góp quỹ trồng cây', pointsCost: 0, stock: null, claimInstructions: null, redemptionCount: 12, fundTreeTotal: 37, sortOrder: 1 }),
  wasteGift({ id: 'gift-seed', kind: 'SEED_PACK', name: 'Gói hạt rau mầm', pointsCost: 30_000, stock: 0, sortOrder: 2 }),
];

type Route = { status?: number; body: unknown } | ((init?: RequestInit) => { status?: number; body: unknown });
async function mount(opts: { gifts?: Route; isAdmin?: boolean } = {}) {
  const api = mockFetch({
    '/admin/waste/gifts/order': { body: GIFTS },
    '/admin/waste/gifts/': { body: GIFTS[0] },
    '/admin/waste/gifts': opts.gifts ?? { body: GIFTS },
    '/admin/waste/gift-redemptions': { body: [] },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<WasteGiftsSection isAdmin={opts.isAdmin ?? true} />);
  mounted.push(r);
  await flush();
  return { api, c: r.container };
}

const row = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-gift="${id}"]`)!;
const field = (c: HTMLElement, name: string) => c.querySelector<HTMLInputElement>(`[name="${name}"]`);
const btn = (c: HTMLElement | ParentNode, text: string) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)!;
const calls = (api: { calls: { url: string; init?: RequestInit }[] }, part: string, method: string) =>
  api.calls.filter((x) => x.url.includes(part) && (x.init?.method ?? 'GET') === method);
const body = (call: { init?: RequestInit }) => JSON.parse(String(call.init!.body));

describe('WasteGiftsSection', () => {
  it('bảng quà: loại, giá điểm, tồn kho, lượt đổi', async () => {
    const { c } = await mount();
    expect(c.textContent).toContain('Danh mục quà');
    const bottle = row(c, 'gift-bottle').textContent!;
    ['Quà tặng', '120.000 điểm', 'Còn 30', '4 lượt đổi'].forEach((t) => expect(bottle).toContain(t));
    const tree = row(c, 'gift-tree').textContent!;
    ['Góp quỹ trồng cây', 'Giá theo cấu hình game.tree_points_price', 'Không giới hạn', '12 lượt đổi', 'Tổng lượt góp quỹ: 37'].forEach((t) => expect(tree).toContain(t));
    expect(tree).not.toContain('0 điểm');
    expect(row(c, 'gift-seed').textContent).toContain('Hết hàng');
  });

  it('thêm quà vật lý: tồn kho, hướng dẫn nhận', async () => {
    const { c, api } = await mount();
    click(btn(c, 'Thêm quà'));
    expect(Array.from(field(c, 'kind')!.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Mã giảm giá', 'Gói hạt giống', 'Quà tặng']);
    selectValue(field(c, 'kind'), 'GIFT');
    typeInto(field(c, 'name'), 'Bình nước Tubu');
    typeInto(field(c, 'pointsCost'), '120000');
    typeInto(field(c, 'stock'), '30');
    typeInto(field(c, 'claimInstructions'), 'Nhận tại kho Tubu HCM');
    click(btn(c, 'Lưu'));
    await flush();
    const posts = calls(api, '/admin/waste/gifts', 'POST');
    expect(posts).toHaveLength(1);
    expect(body(posts[0]!)).toEqual({ kind: 'GIFT', name: 'Bình nước Tubu', description: null, label: null, pointsCost: 120_000, status: 'HIDDEN', imageUrl: null, stock: 30, claimInstructions: 'Nhận tại kho Tubu HCM' });
  });

  it('thêm mã giảm giá: thông số mã, không dùng chữ voucher', async () => {
    const { c, api } = await mount();
    click(btn(c, 'Thêm quà'));
    selectValue(field(c, 'kind'), 'VOUCHER');
    typeInto(field(c, 'name'), 'Giảm 20.000đ');
    typeInto(field(c, 'pointsCost'), '20000');
    expect(Array.from(field(c, 'voucherType')!.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Giảm theo %', 'Giảm số tiền', 'Miễn phí vận chuyển']);
    selectValue(field(c, 'voucherType'), 'AMOUNT');
    typeInto(field(c, 'voucherValue'), '20000');
    typeInto(field(c, 'voucherMinOrder'), '150000');
    typeInto(field(c, 'voucherValidDays'), '30');
    expectNoBannedCopy(c.textContent);
    click(btn(c, 'Lưu'));
    await flush();
    const posts = calls(api, '/admin/waste/gifts', 'POST');
    expect(posts).toHaveLength(1);
    expect(body(posts[0]!)).toEqual({
      kind: 'VOUCHER', name: 'Giảm 20.000đ', description: null, label: null, pointsCost: 20_000, status: 'HIDDEN', imageUrl: null, stock: null, claimInstructions: null,
      voucher: { type: 'AMOUNT', value: 20000, minOrder: 150000, maxDiscount: null, validDays: 30 },
    });
  });

  it('thẻ góp quỹ trồng cây: chỉ sửa tên, ảnh, ẩn/hiện (8)', async () => {
    const { c, api } = await mount();
    click(btn(row(c, 'gift-tree'), 'Sửa'));
    ['name', 'imageUrl', 'status'].forEach((n) => expect(field(c, n)).not.toBeNull());
    ['pointsCost', 'stock', 'claimInstructions', 'voucherType'].forEach((n) => expect(field(c, n)).toBeNull());
    expect(c.textContent).toContain('Thẻ góp quỹ trồng cây: chỉ sửa tên, ảnh, thứ tự và ẩn/hiện.');
    selectValue(field(c, 'status'), 'HIDDEN');
    click(btn(c, 'Lưu'));
    await flush();
    const patches = calls(api, '/admin/waste/gifts/gift-tree', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(body(patches[0]!)).toEqual({ status: 'HIDDEN' });
  });

  it('sửa quà: chỉ gửi ô đã đổi', async () => {
    const { c, api } = await mount();
    click(btn(row(c, 'gift-bottle'), 'Sửa'));
    typeInto(field(c, 'name'), 'Bình nước Tubu 500ml');
    click(btn(c, 'Lưu'));
    await flush();
    const patches = calls(api, '/admin/waste/gifts/gift-bottle', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(body(patches[0]!)).toEqual({ name: 'Bình nước Tubu 500ml' });
    click(btn(row(c, 'gift-bottle'), 'Sửa'));
    click(btn(c, 'Lưu'));
    await flush();
    expect(calls(api, '/admin/waste/gifts/gift-bottle', 'PATCH')).toHaveLength(1);
  });

  it('lỗi API khi lưu mã giảm giá hiện nguyên văn', async () => {
    const message = 'Mã giảm từ 50% phải đặt Giảm tối đa (đ) để một đơn lớn không được giảm gần hết.';
    const { c } = await mount({ gifts: (init) => (init?.method === 'POST' ? { status: 400, body: { message } } : { body: GIFTS }) });
    click(btn(c, 'Thêm quà'));
    selectValue(field(c, 'kind'), 'VOUCHER');
    typeInto(field(c, 'name'), 'Giảm 50%');
    typeInto(field(c, 'pointsCost'), '50000');
    selectValue(field(c, 'voucherType'), 'PERCENT');
    typeInto(field(c, 'voucherValue'), '50');
    typeInto(field(c, 'voucherValidDays'), '30');
    click(btn(c, 'Lưu'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain(message);
  });

  it('giá điểm ngoài 1..2000000 bị chặn', async () => {
    const { c } = await mount();
    click(btn(c, 'Thêm quà'));
    typeInto(field(c, 'name'), 'Bình');
    for (const v of ['2000001', '0']) {
      typeInto(field(c, 'pointsCost'), v);
      expect(c.textContent).toContain('Giá điểm từ 1 tới 2.000.000');
      expect(btn(c, 'Lưu').disabled).toBe(true);
    }
  });

  it('tồn kho trống là không giới hạn, số âm bị chặn', async () => {
    const { c } = await mount();
    click(btn(c, 'Thêm quà'));
    typeInto(field(c, 'stock'), '-1');
    expect(c.textContent).toContain('Tồn kho là số nguyên không âm (để trống nếu không giới hạn)');
  });

  it('đổi thứ tự quà', async () => {
    const { c, api } = await mount();
    click(c.querySelector('button[aria-label="Đưa Góp quỹ trồng cây lên"]'));
    await flush();
    const puts = calls(api, '/admin/waste/gifts/order', 'PUT');
    expect(puts).toHaveLength(1);
    expect(body(puts[0]!)).toEqual({ ids: ['gift-tree', 'gift-bottle', 'gift-seed'] });
  });

  it('nhân viên không thấy danh mục và không gọi /admin/waste/gifts', async () => {
    const { c, api } = await mount({ isAdmin: false });
    expect(c.textContent).not.toContain('Danh mục quà');
    expect(api.calls.filter((x) => x.url.endsWith('/admin/waste/gifts'))).toEqual([]);
  });
});
