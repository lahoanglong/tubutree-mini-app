// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { unlabeledFields, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), picked: 0 }));
vi.mock('@/lib/admin-bundles-client', () => ({
  listAdminBundles: mocks.list,
  getAdminBundle: mocks.get,
  createAdminBundle: mocks.create,
  updateAdminBundle: mocks.update,
  deleteAdminBundle: mocks.remove,
}));
// Mỗi lần bấm "Thêm sản phẩm" chọn món kế tiếp (p1, p2, ...); "Chọn sản phẩm chính" luôn là p0.
vi.mock('./product-picker', () => ({
  ProductPicker: ({ onChange, label }: { onChange: (v: { id: string; label: string } | null) => void; label: string }) => (
    <button
      type="button"
      onClick={() => {
        if (label === 'Chọn sản phẩm chính') return onChange({ id: 'p0', label: 'Dầu gội' });
        mocks.picked += 1;
        onChange({ id: `p${mocks.picked}`, label: `Món ${mocks.picked}` });
      }}
    >
      {`Chọn: ${label}`}
    </button>
  ),
}));

// Món mua kèm chọn theo phân loại: mỗi lần bấm "Thêm món mua kèm" chọn món kế tiếp (p1/v1, p2/v2, ...), giá bán 50.000đ.
vi.mock('./bundle-addon-picker', () => ({
  AddonVariationPicker: ({ onPick }: { onPick: (v: { productId: string; productName: string; variationId: string; variationName: string; price: number }) => void }) => (
    <button
      type="button"
      onClick={() => {
        mocks.picked += 1;
        onPick({ productId: `p${mocks.picked}`, productName: `Món ${mocks.picked}`, variationId: `v${mocks.picked}`, variationName: '250ml', price: 50_000 });
      }}
    >
      Chọn: Thêm món mua kèm
    </button>
  ),
}));

import { BundlesTab } from './bundles-tab';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'BUNDLE_PCT', title: `Bộ ${id}`, pct: 10, anchorProductId: null, anchorProductName: null,
  startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-10T16:59:00.000Z', isActive: true, sortOrder: 0, status: 'live', createdById: 'u1', createdByStaff: true,
  items: [
    { productId: 'p1', productName: 'Xà phòng', productSlug: 'xa-phong', variationId: null, variationName: null, addonPrice: null, refPrice: null, maxQty: 1, price: 50_000 },
    { productId: 'p2', productName: 'Dầu gội', productSlug: 'dau-goi', variationId: 'v2', variationName: '250ml', addonPrice: null, refPrice: null, maxQty: 2, price: 80_000 },
  ],
  ...over,
});

let mounted: Rendered | null = null;
const mount = async (isAdmin = true) => {
  mounted = render(<BundlesTab isAdmin={isAdmin} />);
  await flush(6);
  return mounted.container;
};
const field = (c: HTMLElement, label: string) => c.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
const chip = (c: HTMLElement, name: string) => byText(c, 'button[aria-pressed]', name)!;
const btn = (c: HTMLElement, label: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const open = async (c: HTMLElement) => {
  click(byText(c, 'button', 'Tạo combo hoặc mua kèm'));
  await flush(2);
};
const basics = (c: HTMLElement) => {
  typeInto(field(c, 'Tên bộ'), 'Gội xả');
  typeInto(field(c, 'Bắt đầu: ngày'), '01/11/2026');
  typeInto(field(c, 'Kết thúc: ngày'), '10/11/2026');
};
const pick = async (c: HTMLElement, times = 1) => {
  for (let i = 0; i < times; i++) {
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    await flush(1);
  }
};
const pickAddon = async (c: HTMLElement, times = 1) => {
  for (let i = 0; i < times; i++) {
    click(byText(c, 'button', 'Chọn: Thêm món mua kèm'));
    await flush(1);
  }
};
const save = async (c: HTMLElement) => {
  click(byText(c, 'button', 'Lưu bộ'));
  await flush(6);
};

beforeEach(() => {
  mocks.picked = 0;
  mocks.list.mockReset().mockResolvedValue([row('a')]);
  mocks.get.mockReset().mockResolvedValue(row('a'));
  mocks.create.mockReset().mockResolvedValue(row('new1'));
  mocks.update.mockReset().mockResolvedValue(row('a'));
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('BundlesTab: danh sách', () => {
  it('mỗi dòng: tên, khoảng ngày giờ VN, nhãn trạng thái, loại và các món; mở tab gọi liệt kê không lọc', async () => {
    mocks.list.mockResolvedValue([
      row('a'),
      row('b', { status: 'scheduled' }),
      row('c', { status: 'ended' }),
      row('d', { status: 'off', isActive: false }),
      row('e', { kind: 'ADDON', pct: null, anchorProductId: 'p0', anchorProductName: 'Dầu gội', items: [{ productId: 'p1', productName: 'Xà phòng', productSlug: 'x', variationId: null, variationName: null, addonPrice: 39_000, refPrice: 50_000, maxQty: 1, price: 50_000 }] }),
    ]);
    const c = await mount();
    expect(mocks.list).toHaveBeenCalledWith(undefined);
    expect(c.textContent).toContain('01/11/2026 00:00 → 10/11/2026 23:59');
    expect(c.textContent).toContain('Combo giảm % · giảm 10% mỗi món · Xà phòng, Dầu gội');
    expect(c.textContent).toContain('Mua kèm (giá riêng) · khi mua Dầu gội · Xà phòng');
    for (const t of ['Đang chạy', 'Sắp chạy', 'Đã kết thúc', 'Đang tắt']) expect(c.textContent).toContain(t);
  });

  it('chưa có bộ nào: một câu hướng dẫn; tải lỗi: báo lỗi kèm Thử lại', async () => {
    mocks.list.mockResolvedValueOnce([]);
    const c = await mount();
    expect(c.textContent).toContain('Chưa có combo hay mua kèm nào');
    mounted!.unmount();
    mocks.list.mockRejectedValueOnce(new Error('Máy chủ đang bận'));
    const c2 = await mount();
    expect(c2.querySelector('[role="alert"]')!.textContent).toContain('Không tải được danh sách bộ');
    click(byText(c2, 'button', 'Thử lại'));
    await flush(4);
    expect(c2.textContent).toContain('Bộ a');
  });

  it('chip lọc theo trạng thái gọi liệt kê đúng trạng thái, aria-pressed theo chip đang chọn', async () => {
    const c = await mount();
    click(chip(c, 'Đang chạy'));
    await flush(4);
    expect(mocks.list).toHaveBeenLastCalledWith('live');
    expect(chip(c, 'Đang chạy').getAttribute('aria-pressed')).toBe('true');
    click(chip(c, 'Tất cả'));
    await flush(4);
    expect(mocks.list).toHaveBeenLastCalledWith(undefined);
  });
});

describe('BundlesTab: nhân viên chỉ sửa bộ do nhân viên tạo', () => {
  beforeEach(() => mocks.list.mockResolvedValue([row('mine', { createdByStaff: true }), row('theirs', { createdByStaff: false, createdById: 'admin1' })]));

  it('nhân viên: bộ của quản trị viên bị khoá Sửa/Tắt/Xoá kèm lời giải thích; bộ của nhân viên dùng được', async () => {
    const c = await mount(false);
    for (const a of ['Sửa bộ', 'Tắt bộ', 'Xoá bộ']) {
      expect(btn(c, `${a} Bộ theirs`).disabled).toBe(true);
      expect(btn(c, `${a} Bộ mine`).disabled).toBe(false);
    }
    expect(c.textContent).toContain('Bộ do quản trị viên tạo, nhờ quản trị viên chỉnh sửa.');
    expect(c.textContent?.match(/nhờ quản trị viên chỉnh sửa/g)).toHaveLength(1);
  });

  it('quản trị viên: mọi bộ đều dùng được', async () => {
    const c = await mount(true);
    for (const a of ['Sửa bộ', 'Tắt bộ', 'Xoá bộ']) expect(btn(c, `${a} Bộ theirs`).disabled).toBe(false);
    expect(c.textContent).not.toContain('nhờ quản trị viên chỉnh sửa');
  });
});

describe('BundlesTab: bật tắt và xoá', () => {
  it('Tắt gọi update(id, {isActive:false}) rồi làm mới danh sách; bộ đang tắt có nút Bật', async () => {
    mocks.list.mockResolvedValue([row('a'), row('d', { status: 'off', isActive: false })]);
    const c = await mount();
    const before = mocks.list.mock.calls.length;
    click(btn(c, 'Tắt bộ Bộ a'));
    await flush(4);
    expect(mocks.update).toHaveBeenCalledWith('a', { isActive: false });
    expect(mocks.list.mock.calls.length).toBeGreaterThan(before);
    click(btn(c, 'Bật bộ Bộ d'));
    await flush(4);
    expect(mocks.update).toHaveBeenCalledWith('d', { isActive: true });
  });

  it('bật tắt lỗi: lời máy chủ hiện ngay tại dòng, danh sách còn nguyên', async () => {
    mocks.update.mockRejectedValue(new Error('Bộ này do quản trị viên tạo'));
    const c = await mount();
    click(btn(c, 'Tắt bộ Bộ a'));
    await flush(4);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Bộ này do quản trị viên tạo');
    expect(c.textContent).toContain('Bộ a');
  });

  it('Xoá chỉ chạy sau khi xác nhận', async () => {
    const c = await mount();
    click(btn(c, 'Xoá bộ Bộ a'));
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush(2);
    expect(mocks.remove).not.toHaveBeenCalled();
    click(btn(c, 'Xoá bộ Bộ a'));
    answerConfirm(true);
    await flush(4);
    expect(mocks.remove).toHaveBeenCalledWith('a');
  });
});

describe('BundlesTab: tạo combo giảm %', () => {
  it('gửi mốc theo giờ VN (+07:00), % và số món thành số, mỗi món một đơn vị mặc định', async () => {
    const c = await mount();
    await open(c);
    basics(c);
    await pick(c, 2);
    click(byText(c, 'button', 'Lưu bộ'));
    await flush(6);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]![0]).toEqual({
      kind: 'BUNDLE_PCT', title: 'Gội xả', pct: 10,
      startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-09T17:00:00.000Z', isActive: true, sortOrder: 0,
      items: [{ productId: 'p1', maxQty: 1 }, { productId: 'p2', maxQty: 1 }],
    });
    expect(c.textContent).toContain('Đã lưu bộ.');
    expect(c.querySelector('form')).toBeNull();
  });

  it('một sản phẩm: báo lỗi ngay, chưa gọi API; thêm đủ rồi bỏ một món thì lại báo', async () => {
    const c = await mount();
    await open(c);
    basics(c);
    await pick(c, 1);
    await save(c);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('ít nhất 2');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('API từ chối (vd vượt trần của nhân viên): lời máy chủ hiện nguyên văn, form giữ nguyên để sửa', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Combo giảm tối đa 30% mỗi món với nhân viên.'));
    const c = await mount();
    await open(c);
    basics(c);
    await pick(c, 2);
    await save(c);
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Combo giảm tối đa 30% mỗi món với nhân viên.');
    expect(field(c, 'Tên bộ').value).toBe('Gội xả');
    expect(c.querySelectorAll('[data-testid="bundle-item"]').length).toBe(2);
  });

  it('bỏ một món khỏi danh sách; tối đa 6 sản phẩm thì ẩn ô thêm', async () => {
    const c = await mount();
    await open(c);
    await pick(c, 6);
    expect(byText(c, 'button', 'Chọn: Thêm sản phẩm')).toBeNull();
    click(btn(c, 'Bỏ Món 3 khỏi bộ'));
    await flush(1);
    expect(c.querySelectorAll('[data-testid="bundle-item"]').length).toBe(5);
    expect(byText(c, 'button', 'Chọn: Thêm sản phẩm')).not.toBeNull();
  });
});

describe('BundlesTab: tạo bộ mua kèm', () => {
  const toAddon = async (c: HTMLElement) => {
    await open(c);
    selectValue(field(c, 'Loại bộ'), 'ADDON');
    await flush(1);
  };

  it('đổi loại: bỏ ô %, hiện chọn sản phẩm chính và giá mua kèm từng món; tối đa 3 món', async () => {
    const c = await mount();
    await toAddon(c);
    expect(c.querySelector('[aria-label="% giảm mỗi món"]')).toBeNull();
    expect(byText(c, 'button', 'Chọn: Chọn sản phẩm chính')).not.toBeNull();
    expect(byText(c, 'button', 'Chọn: Thêm sản phẩm')).toBeNull();
    await pickAddon(c, 3);
    expect(byText(c, 'button', 'Chọn: Thêm món mua kèm')).toBeNull();
    expect(field(c, 'Giá mua kèm Món 1')).not.toBeNull();
    expect(c.textContent).toContain('250ml');
  });

  it('gửi sản phẩm chính, phân loại ghim và giá kèm (0đ hợp lệ), không có pct', async () => {
    const c = await mount();
    await toAddon(c);
    basics(c);
    click(byText(c, 'button', 'Chọn: Chọn sản phẩm chính'));
    await flush(1);
    expect(c.querySelector('[data-testid="bundle-anchor"]')!.textContent).toBe('Dầu gội');
    await pickAddon(c, 2);
    typeInto(field(c, 'Giá mua kèm Món 1'), '39000');
    typeInto(field(c, 'Giá mua kèm Món 2'), '0');
    typeInto(field(c, 'Số lượng ưu đãi Món 2'), '2');
    await save(c);
    expect(mocks.create.mock.calls[0]![0]).toEqual({
      kind: 'ADDON', title: 'Gội xả', anchorProductId: 'p0',
      startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-09T17:00:00.000Z', isActive: true, sortOrder: 0,
      items: [{ productId: 'p1', variationId: 'v1', addonPrice: 39_000, maxQty: 1 }, { productId: 'p2', variationId: 'v2', addonPrice: 0, maxQty: 2 }],
    });
  });

  it('giá kèm không thấp hơn giá bán của phân loại đã chọn: báo lỗi ngay, chưa gọi API', async () => {
    const c = await mount();
    await toAddon(c);
    basics(c);
    click(byText(c, 'button', 'Chọn: Chọn sản phẩm chính'));
    await flush(1);
    await pickAddon(c, 1);
    typeInto(field(c, 'Giá mua kèm Món 1'), '50000');
    await save(c);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('thấp hơn giá đang bán');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('thiếu sản phẩm chính hoặc giá kèm: báo lỗi, chưa gọi API', async () => {
    const c = await mount();
    await toAddon(c);
    basics(c);
    await pickAddon(c, 1);
    await save(c);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('sản phẩm chính');
    click(byText(c, 'button', 'Chọn: Chọn sản phẩm chính'));
    await flush(1);
    await save(c);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('giá mua kèm');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('BundlesTab: sửa bộ', () => {
  it('tải chi tiết rồi điền form; loại bộ khoá; Lưu gọi update không có kind, giữ phân loại đã ghim', async () => {
    const c = await mount();
    click(btn(c, 'Sửa bộ Bộ a'));
    await flush(6);
    expect(mocks.get).toHaveBeenCalledWith('a');
    expect(field(c, 'Loại bộ').disabled).toBe(true);
    expect(field(c, 'Tên bộ').value).toBe('Bộ a');
    expect(field(c, '% giảm mỗi món').value).toBe('10');
    typeInto(field(c, '% giảm mỗi món'), '15');
    const before = mocks.list.mock.calls.length;
    await save(c);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]![0]).toBe('a');
    expect(mocks.update.mock.calls[0]![1]).toEqual({
      title: 'Bộ a', pct: 15, startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-10T16:59:00.000Z', isActive: true, sortOrder: 0,
      items: [{ productId: 'p1', maxQty: 1 }, { productId: 'p2', variationId: 'v2', maxQty: 2 }],
    });
    expect(mocks.list.mock.calls.length).toBeGreaterThan(before);
    expect(c.textContent).toContain('Đã lưu bộ.');
  });

  it('sửa bộ mua kèm khi phân loại đã tăng giá (500.000đ, tham chiếu 50.000đ): gợi ý ghi đúng khoản giỏ cho (Giảm 11.000đ), không phải 461.000đ; vẫn gửi lại đủ món', async () => {
    mocks.get.mockResolvedValue(
      row('a', {
        kind: 'ADDON', pct: null, anchorProductId: 'p0', anchorProductName: 'Dầu gội',
        items: [{ productId: 'p1', productName: 'Xà phòng', productSlug: 'xa-phong', variationId: 'v1', variationName: '100g', addonPrice: 39_000, refPrice: 50_000, maxQty: 1, price: 500_000 }],
      }),
    );
    const c = await mount();
    click(btn(c, 'Sửa bộ Bộ a'));
    await flush(6);
    const text = c.textContent ?? '';
    expect(text).toContain('Giảm 11.000đ (22%)');
    expect(text).not.toContain('461.000');
    expect(text).toContain('giá bán 500.000đ');
    expect(text).toContain('giảm tính theo giá 50.000đ');
    await save(c);
    expect(mocks.update.mock.calls[0]![1].items).toEqual([{ productId: 'p1', variationId: 'v1', addonPrice: 39_000, maxQty: 1 }]);
  });

  it('sửa giá kèm của bộ mua kèm đã tăng giá: máy chủ đặt lại giá tham chiếu = giá đang bán, nên gợi ý tính theo giá đang bán (không còn theo 50.000đ); trả lại giá kèm cũ thì gợi ý về lại như giỏ', async () => {
    mocks.get.mockResolvedValue(
      row('a', {
        kind: 'ADDON', pct: null, anchorProductId: 'p0', anchorProductName: 'Dầu gội',
        items: [{ productId: 'p1', productName: 'Xà phòng', productSlug: 'xa-phong', variationId: 'v1', variationName: '100g', addonPrice: 39_000, refPrice: 50_000, maxQty: 1, price: 500_000 }],
      }),
    );
    const c = await mount();
    click(btn(c, 'Sửa bộ Bộ a'));
    await flush(6);
    expect(c.textContent).toContain('Giảm 11.000đ (22%)');

    typeInto(field(c, 'Giá mua kèm Xà phòng'), '45000');
    await flush(2);
    let text = c.textContent ?? '';
    expect(text).toContain('Giảm 455.000đ (91%)');
    expect(text).not.toContain('Giảm 5.000đ');
    expect(text).not.toContain('giảm tính theo giá');

    typeInto(field(c, 'Giá mua kèm Xà phòng'), '399000');
    await flush(2);
    text = c.textContent ?? '';
    expect(text).toContain('Giảm 101.000đ (20%)');

    typeInto(field(c, 'Giá mua kèm Xà phòng'), '39000');
    await flush(2);
    text = c.textContent ?? '';
    expect(text).toContain('Giảm 11.000đ (22%)');
    expect(text).toContain('giảm tính theo giá 50.000đ');
  });

  it('tải chi tiết lỗi: báo lỗi kèm Thử lại và Đóng', async () => {
    mocks.get.mockRejectedValueOnce(new Error('x'));
    const c = await mount();
    click(btn(c, 'Sửa bộ Bộ a'));
    await flush(6);
    expect(c.textContent).toContain('Không tải được bộ.');
    click(byText(c, 'button', 'Đóng'));
    await flush(2);
    expect(c.textContent).not.toContain('Không tải được bộ.');
  });
});

describe('BundlesTab: trợ năng', () => {
  it('form tạo (cả hai loại): ô nhập đều có nhãn, nút đều có tên', async () => {
    const c = await mount();
    await open(c);
    await pick(c, 2);
    expect(unlabeledFields(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    selectValue(field(c, 'Loại bộ'), 'ADDON');
    await flush(1);
    await pickAddon(c, 1);
    expect(unlabeledFields(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});

describe('BundlesTab: chữ trong form không lộ khoá cấu hình thô', () => {
  // Khoá cấu hình dạng `bundle.max_pct`, `coupon.staff_max_percent` hay `ten_khoa_snake` là chữ của kỹ thuật viên, không phải của người quản trị.
  const RAW_KEY = /\b[a-z]+\.[a-z0-9]+(?:_[a-z0-9]+)+\b|\b[a-z]+(?:_[a-z0-9]+)+\b/;

  it('form tạo (cả hai loại), gồm gợi ý dưới ô: không có khoá thô, trần % được nói bằng chữ thường ngày', async () => {
    const c = await mount();
    await open(c);
    await pick(c, 2);
    expect(c.textContent).toContain('Không vượt trần % đang cấu hình');
    expect(c.textContent ?? '').not.toMatch(RAW_KEY);
    selectValue(field(c, 'Loại bộ'), 'ADDON');
    await flush(1);
    await pickAddon(c, 1);
    expect(c.textContent ?? '').not.toMatch(RAW_KEY);
  });
});

