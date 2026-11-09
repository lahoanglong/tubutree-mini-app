// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// D7 việc 4: thanh toán trên điện thoại có thanh dính đáy (một nút "Đặt hàng · số tiền" như Mini App), radio/checkbox ≥ 24px.

const state = vi.hoisted(() => ({
  placed: [] as Record<string, unknown>[],
  placeGate: null as Promise<void> | null,
  placeError: null as Error | null,
  quoteError: null as Error | null,
  noAddress: false,
  addrError: false,
  /** Số dư Điểm Xanh trong báo giá. */
  points: 0,
  /** Phần dùng được trong báo giá; null = bằng `points`. */
  redeemable: null as number | null,
  /** Số dư trong hồ sơ đăng nhập (có ngay từ lúc vào trang, trước cả báo giá). */
  userPoints: 0,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u', walletBalance: 0, pointsBalance: state.userPoints }, status: 'authenticated', initialized: true }),
}));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [
      { id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 150000, quantity: 2, stock: 5, total: 300000 },
    ],
    couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2,
  }),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getAddresses: async () => {
    if (state.addrError) throw new Error('boom');
    return state.noAddress
      ? []
      : [
          { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: 'p', districtCode: '', wardCode: 'w', isDefault: true },
        ];
  },
  checkoutQuote: async () => {
    if (state.quoteError) throw state.quoteError;
    return {
      subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0,
      pointsBalance: state.points, redeemablePoints: state.redeemable ?? state.points,
    };
  },
  placeOrder: async (body: Record<string, unknown>) => {
    state.placed.push(body);
    await state.placeGate;
    if (state.placeError) throw state.placeError;
    return { code: 'TT0001', total: 330000 };
  },
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]');
const barButton = (c: HTMLElement) => bar(c)!.querySelector<HTMLButtonElement>('button')!;

beforeEach(() => {
  sessionStorage.clear();
  state.placed = [];
  state.placeGate = null;
  state.placeError = null;
  state.quoteError = null;
  state.noAddress = false;
  state.addrError = false;
  state.points = 0;
  state.redeemable = null;
  state.userPoints = 0;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — nút Đặt hàng ở khung tóm tắt (từ lg) ghi số tiền như Mini (K2)', () => {
  const lgButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-mini-part="place-order"] button')!;

  it('có báo giá: "Đặt hàng · 330.000đ", cùng chữ với nút trên thanh dính', async () => {
    const c = await mount();
    expect(lgButton(c).textContent).toBe('Đặt hàng · 330.000đ');
    expect(lgButton(c).textContent).toBe(barButton(c).textContent);
  });

  it('chưa có địa chỉ: chỉ "Đặt hàng", bấm được để chỉ ra chỗ thiếu, không có số tiền nào', async () => {
    state.noAddress = true;
    const c = await mount();
    expect(lgButton(c).textContent).toBe('Đặt hàng');
    expect(lgButton(c).disabled).toBe(false);
  });

  it('báo giá lỗi: chỉ "Đặt hàng", không giữ số tiền cũ', async () => {
    state.quoteError = new Error('boom');
    const c = await mount();
    expect(lgButton(c).textContent).toBe('Đặt hàng');
  });
});

describe('/thanh-toan — lý do khoá nút theo Mini (K2)', () => {
  const region = (c: HTMLElement) => bar(c)!.querySelector<HTMLElement>('[role="status"]')!;

  it('thiếu địa chỉ: lý do là chữ phụ (không đỏ) trong vùng báo, nút bấm được để chỉ ra chỗ thiếu', async () => {
    state.noAddress = true;
    const c = await mount();
    expect(region(c).textContent).toBe('Chọn địa chỉ giao hàng để đặt hàng.');
    expect(region(c).className).toContain('--color-text-secondary');
    expect(region(c).className).not.toContain('danger');
    expect(bar(c)!.querySelector('[aria-hidden="true"].text-danger-fg')).toBeNull();
    expect(barButton(c).disabled).toBe(false);
  });

  it('báo giá lỗi: cũng chữ phụ, khác câu thiếu địa chỉ', async () => {
    state.quoteError = new Error('boom');
    const c = await mount();
    expect(region(c).textContent).toContain('Chưa tính được tổng tiền.');
    expect(region(c).className).not.toContain('danger');
  });

  it('vùng báo có mặt từ đầu (rỗng, ẩn thị giác) và giữ nguyên phần tử khi lỗi đặt hàng hiện ra; lỗi thật mới đỏ', async () => {
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    const before = region(c);
    expect(before.textContent).toBe('');
    expect(before.className).toContain('sr-only');
    click(barButton(c));
    await flush(6);
    expect(region(c)).toBe(before);
    expect(region(c).textContent).toBe('');
    const red = bar(c)!.querySelector('.text-danger-fg');
    expect(red?.textContent).toBe('Địa chỉ giao không hợp lệ.');
  });

  it('khối địa chỉ trống ghi "Bạn chưa thêm địa chỉ" như Mini; có địa chỉ hoặc tải lỗi thì không', async () => {
    state.noAddress = true;
    const empty = await mount();
    expect(empty.querySelector('[data-testid="address-empty"]')!.textContent).toBe('Bạn chưa thêm địa chỉ');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.noAddress = false;
    const filled = await mount();
    expect(filled.querySelector('[data-testid="address-empty"]')).toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.addrError = true;
    const failed = await mount();
    expect(failed.querySelector('[data-testid="address-empty"]')).toBeNull();
  });
});

describe('/thanh-toan — thanh dính đáy', () => {
  it('chỉ có nút "Đặt hàng · số tiền" đúng báo giá, không có khối Tổng cộng', async () => {
    const c = await mount();
    expect(bar(c)!.textContent).not.toContain('Tổng cộng');
    expect(barButton(c).textContent).toBe('Đặt hàng · 330.000đ');
    expect(barButton(c).disabled).toBe(false);
  });

  it('bấm nút trên thanh dính đặt đúng đơn như nút trong khung tóm tắt', async () => {
    const c = await mount();
    click(barButton(c));
    await flush(6);
    expect(state.placed).toHaveLength(1);
    expect(c.textContent).toContain('Cảm ơn bạn đã chọn Tubu');
    expect(bar(c)).toBeNull();
  });

  it('chưa có địa chỉ: tổng trong khung tóm tắt ghi "Chưa tính", nút bấm được và không kèm số tiền', async () => {
    state.noAddress = true;
    const c = await mount();
    expect(c.querySelector('[data-mini-part="summary-total"]')!.textContent).toContain('Chưa tính');
    expect(barButton(c).disabled).toBe(false);
    expect(barButton(c).textContent).toBe('Đặt hàng');
  });

  it('báo giá lỗi: không hiện số tiền cũ trên nút, nút khoá', async () => {
    state.quoteError = new Error('boom');
    const c = await mount();
    expect(barButton(c).disabled).toBe(true);
    expect(barButton(c).textContent).toBe('Đặt hàng');
  });

  it('đang đặt hàng: nút trên thanh dính đổi chữ và khoá (không đặt đôi), aria-busy + aria-disabled để giữ focus', async () => {
    let release!: () => void;
    state.placeGate = new Promise<void>((r) => (release = r));
    const c = await mount();
    click(barButton(c));
    await flush(3);
    expect(barButton(c).textContent).toBe('Đang đặt hàng…');
    expect(barButton(c).getAttribute('aria-busy')).toBe('true');
    expect(barButton(c).getAttribute('aria-disabled')).toBe('true');
    expect(barButton(c).disabled).toBe(false);
    click(barButton(c));
    await flush(2);
    expect(state.placed).toHaveLength(1);
    release();
    await flush(6);
  });

  it('đặt hàng lỗi: lời báo hiện luôn trên thanh dính, khách không phải cuộn xuống cuối trang mới thấy', async () => {
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    click(barButton(c));
    await flush(6);
    expect(bar(c)!.textContent).toContain('Địa chỉ giao không hợp lệ.');
    expect(barButton(c).disabled).toBe(false);
  });

  it('trang vẫn còn nút "Đặt hàng" trong khung tóm tắt cho màn rộng', async () => {
    const c = await mount();
    const inCard = Array.from(c.querySelectorAll('button')).find((b) => /^Đặt hàng/.test(b.textContent ?? ''));
    expect(inCard).toBeDefined();
    expect(inCard!.className).toMatch(/\bhidden\b/);
    expect(inCard!.className).toMatch(/\blg:inline-flex\b/);
  });

  it('dòng đồng ý điều khoản nằm ngay trên nút Đặt hàng ở thanh dính và ở khung tóm tắt, có link tới Điều khoản và Chính sách đổi trả, không có ô tick', async () => {
    const c = await mount();
    const lines = Array.from(c.querySelectorAll<HTMLElement>('[data-testid="order-consent"]'));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.textContent).toBe('Bằng việc đặt hàng, bạn đồng ý với Điều khoản và Chính sách đổi trả.');
      expect(Array.from(line.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
        ['Điều khoản', '/chinh-sach/dieu-khoan'],
        ['Chính sách đổi trả', '/chinh-sach/doi-tra'],
      ]);
    }
    const desk = lines.find((l) => /\blg:block\b/.test(l.className))!;
    expect(desk.nextElementSibling?.tagName).toBe('BUTTON');
    expect(c.querySelector('[data-mini-part="place-order"]')!.contains(desk)).toBe(true);
    expect(bar(c)!.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('vùng chạm 44px và mọi nút có tên', async () => {
    const c = await mount();
    expect(smallTouchTargets(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});

describe('/thanh-toan — radio/checkbox đủ lớn (≥ 24px)', () => {
  it('radio địa chỉ, radio thanh toán và ô dùng Điểm Xanh đều h-6 w-6', async () => {
    state.points = 50;
    const c = await mount();
    const controls = Array.from(c.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]'));
    expect(controls.length).toBeGreaterThanOrEqual(5);
    const small = controls.filter((el) => !/\bh-6\b/.test(el.className) || !/\bw-6\b/.test(el.className));
    expect(small.map((el) => el.outerHTML.slice(0, 100))).toEqual([]);
  });
});

describe('/thanh-toan — 375px theo số đo Mini (K2)', () => {
  it('dòng đồng ý điều khoản ở điện thoại nằm cuối nội dung, sau khối tóm tắt, không trong thanh dính', async () => {
    const c = await mount();
    const lines = Array.from(c.querySelectorAll<HTMLElement>('[data-testid="order-consent"]'));
    const phone = lines.find((l) => /\blg:hidden\b/.test(l.className))!;
    expect(phone).toBeDefined();
    expect(bar(c)!.contains(phone)).toBe(false);
    expect(lines.filter((l) => bar(c)!.contains(l))).toHaveLength(0);
    const total = c.querySelector('[data-ds="checkout-summary-total"]')!;
    expect(total.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(phone.compareDocumentPosition(bar(c)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('khách chưa có điểm: khối Điểm Xanh ở điện thoại vẫn hiện như Mini với lời mời tích điểm, ô tick khoá', async () => {
    state.points = 0;
    const c = await mount();
    const none = c.querySelector<HTMLElement>('[data-testid="points-none"]')!;
    expect(none).not.toBeNull();
    expect(none.className).toMatch(/\bmd:hidden\b/);
    expect(none.closest('[data-mini-block="points"]')).not.toBeNull();
    expect(none.textContent).toContain('Điểm Xanh');
    expect(none.textContent).toContain('Tích điểm từ đơn đầu tiên nhé');
    expect(none.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
  });

  it('khách có điểm dùng được: không có khối lời mời tích điểm', async () => {
    state.points = 50;
    state.userPoints = 50;
    const c = await mount();
    expect(c.querySelector('[data-testid="points-none"]')).toBeNull();
  });

  it('khách có điểm nhưng chưa chọn địa chỉ (chưa có báo giá): ghi số dư như Mini, không mời tích điểm', async () => {
    state.noAddress = true;
    state.userPoints = 50;
    const c = await mount();
    const idle = c.querySelector<HTMLElement>('[data-testid="points-none"]')!;
    expect(idle.textContent).toContain('Bạn đang có 50 điểm');
    expect(c.textContent).not.toContain('Tích điểm từ đơn đầu tiên');
    expect(idle.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
  });

  it('toàn bộ điểm đang giữ (dùng được 0): ghi số dư, không mời tích điểm cạnh dòng "chưa dùng được"', async () => {
    state.points = 50;
    state.redeemable = 0;
    state.userPoints = 50;
    const c = await mount();
    const idle = c.querySelector<HTMLElement>('[data-testid="points-none"]')!;
    expect(idle.textContent).toContain('Bạn đang có 50 điểm');
    expect(c.textContent).toContain('chưa dùng được');
    expect(c.textContent).not.toContain('Tích điểm từ đơn đầu tiên');
  });

  it('dòng tóm tắt: đệm 6px dưới md rồi trả về dòng cũ từ md, không thêm max-md', async () => {
    const c = await mount();
    const row = c.querySelector<HTMLElement>('[data-ds="checkout-summary-row"]')!;
    expect(row.className).toMatch(/\bpy-1\.5\b/);
    expect(row.className).toMatch(/\bmd:py-0\b/);
    expect(row.className).toMatch(/\bmd:mt-1\b/);
    expect(row.className).not.toMatch(/max-md:/);
  });

  it('"Tổng cộng" dưới md: nhãn 14/400 màu phụ, số 16/700; từ md vẫn đậm cả hai', async () => {
    const c = await mount();
    const total = c.querySelector<HTMLElement>('[data-ds="checkout-summary-total"]')!;
    const label = total.firstElementChild as HTMLElement;
    const value = total.lastElementChild as HTMLElement;
    expect(label.textContent).toBe('Tổng cộng');
    expect(label.className).toMatch(/\bfont-normal\b/);
    expect(label.className).toMatch(/\bmd:font-bold\b/);
    expect(value.className).toMatch(/\btext-base\b/);
    expect(value.className).toMatch(/\bfont-bold\b/);
    expect(total.className).not.toMatch(/max-md:/);
  });

  it('ghi chú: ô cao một dòng như Input của Mini dưới md, nhiều dòng từ md; khối có móc đo', async () => {
    const c = await mount();
    const note = c.querySelector<HTMLTextAreaElement>('[data-ds="checkout-note"] textarea')!;
    expect(note.className).toMatch(/\bh-12\b/);
    expect(note.className).toMatch(/\bmd:h-auto\b/);
  });

  it('thẻ địa chỉ: huy hiệu Mặc định không xuống dòng, tên dài cắt một dòng; có móc đo', async () => {
    const c = await mount();
    const card = c.querySelector<HTMLElement>('[data-ds="checkout-address-card"]')!;
    expect(card).not.toBeNull();
    const badge = Array.from(card.querySelectorAll('span')).find((s) => s.textContent === 'Mặc định')!;
    expect(badge.className).toMatch(/\bshrink-0\b/);
    const name = Array.from(card.querySelectorAll('span')).find((s) => s.textContent === 'An · 0912345678')!;
    expect(name.className).toMatch(/\btruncate\b/);
    expect(c.querySelector('[data-ds="checkout-block-title"]')!.textContent).toBe('Địa chỉ giao hàng');
  });
});
