// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseGeo, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets } from '@/test-utils/a11y';
import OrderEditSheet, { type OrderEditOutcome } from './order-edit-sheet';

const ADDRESS = {
  recipient: 'Nguyễn An',
  phone: '0912345678',
  province: 'Hà Nội',
  district: '',
  ward: 'Phường Cầu Giấy',
  street: '1 Xuân Thuỷ',
  provinceCode: '84_VN01',
  districtCode: '',
  wardCode: '84_VN0100166',
};
const COMMUNES = [
  { code: '84_VN0100166', name: 'Phường Cầu Giấy' },
  { code: '84_VN0100004', name: 'Phường Ba Đình' },
];

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

type Reply = { status?: number; body: unknown };
async function setup(opts: { address?: typeof ADDRESS; note?: string | null; split?: boolean; reply?: Reply } = {}) {
  const api = mockFetch({
    '/geo/communes': { body: COMMUNES },
    '/orders/TB-9/delivery': opts.reply ?? { body: { code: 'TB-9', shippingAddress: ADDRESS, note: null, notifyRecipientZalo: false, editsLeft: 2 } },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const settled: OrderEditOutcome[] = [];
  const onClose = vi.fn();
  const r = render(
    <OrderEditSheet
      code="TB-9"
      address={opts.address ?? ADDRESS}
      note={opts.note === undefined ? 'Gọi trước' : opts.note}
      split={opts.split ?? false}
      onClose={onClose}
      onSettled={(o) => settled.push(o)}
    />,
  );
  mounted.push(r);
  await flush();
  const sheet = () => document.querySelector<HTMLFormElement>('[data-testid="order-edit-sheet"]')!;
  const input = (label: string) =>
    Array.from(sheet().querySelectorAll('label')).find((l) => l.firstElementChild?.textContent === label)!.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  const save = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Lưu thay đổi')!;
  const patches = () => api.calls.filter((c) => c.url.includes('/orders/TB-9/delivery'));
  return { api, settled, onClose, sheet, input, save, patches };
}

describe('OrderEditSheet (web)', () => {
  it('tỉnh khoá theo đơn: không có ô chọn tỉnh, không tải danh sách tỉnh; ô điền sẵn theo đơn', async () => {
    const t = await setup();
    expect(t.sheet().textContent).toContain('Tỉnh/thành: Hà Nội (không đổi được)');
    expect(t.sheet().textContent).toContain('Muốn giao tỉnh khác, bạn huỷ đơn rồi đặt lại nhé.');
    expect(Array.from(document.querySelectorAll('label')).some((l) => l.textContent?.trim() === 'Tỉnh/Thành phố')).toBe(false);
    expect(t.api.calls.some((c) => c.url.includes('/geo/provinces'))).toBe(false);
    expect(t.input('Người nhận')!.value).toBe('Nguyễn An');
    expect(t.input('Số điện thoại')!.value).toBe('0912345678');
    expect(t.input('Số nhà, tên đường')!.value).toBe('1 Xuân Thuỷ');
    expect(t.input('Ghi chú cho đơn')!.value).toBe('Gọi trước');
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Sửa địa chỉ và ghi chú');
    expect(smallTouchTargets(document.body)).toEqual([]);
  });

  it('đổi phường, số nhà và ghi chú: PATCH đủ 7 trường địa chỉ (tỉnh của đơn) và ghi chú mới; lưu xong báo lượt còn', async () => {
    const t = await setup();
    chooseGeo(document.body, 'Phường/Xã', 'Phường Ba Đình');
    typeInto(t.input('Số nhà, tên đường'), '5 Điện Biên Phủ');
    typeInto(t.input('Ghi chú cho đơn'), 'Giao giờ hành chính');
    click(t.save());
    await flush();
    expect(t.patches()).toHaveLength(1);
    expect(t.patches()[0]!.init?.method).toBe('PATCH');
    expect(JSON.parse(String(t.patches()[0]!.init?.body))).toEqual({
      address: {
        recipient: 'Nguyễn An',
        phone: '0912345678',
        ward: 'Phường Ba Đình',
        street: '5 Điện Biên Phủ',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '84_VN0100004',
      },
      note: 'Giao giờ hành chính',
    });
    expect(t.settled).toEqual([{ kind: 'saved', editsLeft: 2 }]);
  });

  it('chỉ đổi ghi chú: không gửi địa chỉ; SĐT gõ kiểu +84 được chuẩn hoá nên không tính là đổi', async () => {
    const t = await setup();
    typeInto(t.input('Số điện thoại'), '+84 912 345 678');
    typeInto(t.input('Ghi chú cho đơn'), '');
    click(t.save());
    await flush();
    expect(JSON.parse(String(t.patches()[0]!.init?.body))).toEqual({ note: null });
  });

  it('không đổi gì: báo tại chỗ, không gọi máy chủ', async () => {
    const t = await setup();
    click(t.save());
    await flush();
    expect(t.patches()).toHaveLength(0);
    expect(document.querySelector('[data-testid="order-edit-error"]')!.textContent).toBe('Bạn chưa đổi gì.');
  });

  it('409 ORDER_EDIT_REFUSED: chuyển câu máy chủ ra trang (trang đóng tấm và tải lại đơn)', async () => {
    const message = 'Kho đã đóng gói đơn này nên không sửa được. Nhắn Zalo OA hoặc gọi hotline Tubu nhé.';
    const t = await setup({ reply: { status: 409, body: { code: 'ORDER_EDIT_REFUSED', reason: 'PACKING_ON_PANCAKE', message } } });
    typeInto(t.input('Ghi chú cho đơn'), 'mới');
    click(t.save());
    await flush();
    expect(t.settled).toEqual([{ kind: 'refused', message }]);
  });

  it('400 nhập sai (SĐT): ở lại trong tấm, hiện câu máy chủ, không báo trang', async () => {
    const t = await setup({ reply: { status: 400, body: { message: 'Số điện thoại không hợp lệ' } } });
    typeInto(t.input('Số điện thoại'), '123');
    click(t.save());
    await flush();
    expect(t.settled).toEqual([]);
    expect(document.querySelector('[data-testid="order-edit-error"]')!.textContent).toBe('Số điện thoại không hợp lệ');
  });

  it('đơn địa giới cũ: chỉ có ô ghi chú kèm lời giải thích; đơn tách: nói rõ chỉ áp cho đơn này', async () => {
    const t = await setup({ address: { ...ADDRESS, provinceCode: '' }, split: true });
    expect(t.sheet().textContent).toContain('Địa chỉ chưa theo địa giới mới nên chỉ sửa được ghi chú.');
    expect(t.sheet().textContent).toContain('Thay đổi chỉ áp dụng cho đơn TB-9.');
    expect(t.sheet().querySelectorAll('input')).toHaveLength(0);
    typeInto(t.input('Ghi chú cho đơn'), 'x');
    click(t.save());
    await flush();
    expect(JSON.parse(String(t.patches()[0]!.init?.body))).toEqual({ note: 'x' });
  });
});
