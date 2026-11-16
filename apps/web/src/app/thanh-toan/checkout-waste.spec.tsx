// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 20000, total: 120000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const GATE = { gateOpen: true, eligible: false, reason: null, mode: null, estimatedPoints: 0, minPoints: 3000, freeShip: false, shippingFeeWaived: 0, orderWeightGrams: 3000, maxReturnWeightGrams: 3000, returnWeightGrams: null };
const BOTTLE = { id: 'it-b', code: 'BOTTLE', name: 'Vỏ chai', unitLabel: 'chai', unitsPerPoint: 1, pointsPerGroup: 1000, hazardous: false, blockedReason: null, prepInstructions: null };
const BATTERY = { id: 'it-p', code: 'BATTERY', name: 'Pin cũ', unitLabel: 'viên', unitsPerPoint: 1, pointsPerGroup: 500, hazardous: true, blockedReason: 'BATTERY_OUT_OF_HCM', prepInstructions: null };
const OPTIONS = { gateOpen: true, minPoints: 3000, orderWeightGrams: 3000, maxReturnWeightGrams: 3000, items: [BATTERY, BOTTLE], existingRequest: null };
const EXISTING = { id: 'req-p', code: 'TR-PICK1', estimatedPoints: 12000, lines: [{ itemId: 'it-b', itemName: 'Vỏ chai', unitLabel: 'chai', declaredQty: 12 }] };
const gift = (id: string, over: Record<string, unknown> = {}) => ({ id, code: `QG-${id}`, giftName: `Hạt giống ${id}`, kind: 'SEED_PACK', pointsCost: 500, included: true, ...over });

const m = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn(), cart: vi.fn(), options: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: (...args: unknown[]) => m.cart(...args),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getPublicConfig: async () => ({ waste: { enabled: true, dropoff: true, mailin: true, pickup: true } }),
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
}));
vi.mock('@tubutree/app-core/api/checkout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/api/checkout')>()),
  getCheckoutPickupOptions: (...args: unknown[]) => m.options(...args),
}));

import CheckoutPage from './page';

/** Báo giá giả theo lựa chọn gửi lên: chọn đủ (phiếu có sẵn hoặc món tại chỗ) thì miễn phí giao 20.000đ. */
function quoteFor(fields: Record<string, unknown> | undefined, gifts: unknown[] = [], pickup: unknown = GATE) {
  const chosen = !!(fields?.inlinePickup || fields?.wasteRequestId);
  return {
    ...QUOTE,
    shippingFee: chosen ? 0 : 20000,
    total: chosen ? 100000 : 120000,
    shippingFeeWaived: chosen ? 20000 : 0,
    shippingFeeWaivedReason: chosen ? 'RECYCLE_PICKUP' : null,
    pickup: chosen
      ? { ...GATE, mode: fields?.wasteRequestId ? 'REQUEST' : 'INLINE', eligible: true, freeShip: true, shippingFeeWaived: 20000, estimatedPoints: 3000, returnWeightGrams: fields?.returnWeightGrams ?? 500 }
      : pickup,
    pendingGiftRedemptions: gifts,
  };
}

const card = (r: Rendered) => r.container.querySelector('[data-testid="checkout-pickup"]') as HTMLElement | null;
const sheet = () => document.body.querySelector('[data-testid="checkout-pickup-sheet"]') as HTMLElement | null;
const bodyBtn = (name: string | RegExp) =>
  Array.from(document.body.querySelectorAll<HTMLElement>('button')).find((b) => {
    const label = b.getAttribute('aria-label') ?? b.textContent ?? '';
    return typeof name === 'string' ? label === name : name.test(label);
  }) ?? null;
const lastQuoteFields = () => (m.quote.mock.calls.at(-1) as unknown[])[4] as Record<string, unknown> | undefined;
const placedBody = () => m.placeOrder.mock.calls.at(-1)![0] as Record<string, unknown>;

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const placeButton = (r: Rendered) => byText(r.container, 'button', /^(Đặt hàng|Thử lại ·)/) as HTMLButtonElement;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockImplementation(async (...a: unknown[]) => quoteFor(a[4] as Record<string, unknown> | undefined));
  m.placeOrder.mockReset().mockReturnValue(new Promise(() => undefined));
  m.options.mockReset().mockResolvedValue(OPTIONS);
  m.cart.mockReset().mockResolvedValue({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  });
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

async function openSheet(r: Rendered) {
  click(card(r)!.querySelector('button')!);
  await flush(4);
  return sheet()!;
}
async function chooseBottles(n: number) {
  const plus = bodyBtn('Tăng số lượng Vỏ chai')!;
  for (let i = 0; i < n; i++) click(plus);
  await flush(1);
}

describe('/thanh-toan — Đổi rác kèm đơn (W168)', () => {
  it('cổng đóng hoặc báo giá không có phần thu rác → không có thẻ; thân đặt đơn không có trường thu rác', async () => {
    m.quote.mockResolvedValue({ ...QUOTE, pickup: { ...GATE, gateOpen: false } });
    const r = await mount();
    expect(card(r)).toBeNull();
    click(placeButton(r));
    await flush(4);
    for (const k of ['wasteRequestId', 'inlinePickup', 'returnWeightGrams', 'excludeGiftRedemptionIds']) expect(placedBody()).not.toHaveProperty(k);
    expect(m.options).not.toHaveBeenCalled();
  });

  it('thẻ đóng: một hàng gồm tiêu đề, lợi ích, huy hiệu theo phí giao, công tắc; không còn mục Thu kèm rác cũ; chưa tải danh sách món', async () => {
    const r = await mount();
    const c = card(r)!;
    expect(c.textContent).toContain('♻️ Đổi rác kèm đơn');
    expect(c.textContent).toContain('Miễn 100% phí vận chuyển');
    expect(c.textContent).toContain('-20.000đ phí giao');
    expect(c.querySelectorAll('button')).toHaveLength(2);
    expect(c.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(r.container.querySelector('#checkout-waste-pickup')).toBeNull();
    expect(r.container.textContent).not.toContain('Thu kèm rác');
    expect(m.options).not.toHaveBeenCalled();
    expect(lastQuoteFields()).toEqual({});
  });

  it('tấm chọn món: Pin cũ mờ kèm đúng một câu, Xong khoá với một lý do, tiến độ theo ngưỡng máy chủ, chip kg tới trần theo kiện', async () => {
    const r = await mount();
    const s = await openSheet(r);
    expect(s.textContent).toContain('1 chai = 1.000 điểm');
    const note = 'Pin cũ cần xử lý an toàn riêng nên hiện chỉ nhận tại điểm thu gom hoặc lấy tận nơi khu vực TP.HCM';
    expect(s.textContent!.split(note)).toHaveLength(2);
    expect(s.querySelector('[data-blocked]')).not.toBeNull();
    expect(s.querySelector('[role="progressbar"]')!.getAttribute('aria-label')).toBe('Dự kiến 0 / 3.000 điểm');
    expect((bodyBtn('Xong') as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent!.split('Chọn ít nhất một món rác')).toHaveLength(2);
    expect(bodyBtn('3 kg')).not.toBeNull();
    expect(bodyBtn('5 kg')).toBeNull();
    expect(s.textContent).toContain('tối đa 3 kg theo kiện mua');
    await chooseBottles(3);
    expect(s.querySelector('[role="progressbar"]')!.getAttribute('aria-label')).toBe('Dự kiến 3.000 / 3.000 điểm');
    expect((bodyBtn('Xong') as HTMLButtonElement).disabled).toBe(false);
    expect(document.body.textContent).not.toContain('Chọn ít nhất một món rác');
  });

  it('chọn món + kg rồi Xong → báo giá gọi lại với inlinePickup + returnWeightGrams, phí giao gạch kèm câu miễn phí, đặt đơn gửi đúng thân', async () => {
    const r = await mount();
    await openSheet(r);
    await chooseBottles(3);
    click(bodyBtn('2 kg'));
    click(bodyBtn('Xong'));
    await flush(8);
    expect(lastQuoteFields()).toEqual({ inlinePickup: { lines: [{ itemId: 'it-b', qty: 3 }] }, returnWeightGrams: 2000 });
    expect(card(r)!.textContent).toContain('Gửi lại ~2 kg · +3.000 điểm sau khi kho nhận');
    expect(card(r)!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    expect(sheet()).toBeNull();
    const waived = r.container.querySelector('[data-testid="ship-waived"]')!;
    expect(waived.textContent).toContain('Miễn phí vận chuyển (đổi rác kèm đơn)');
    expect(waived.querySelector('[style*="line-through"]')!.textContent).toBe('20.000đ');
    click(placeButton(r));
    await flush(6);
    expect(placedBody().inlinePickup).toEqual({ lines: [{ itemId: 'it-b', qty: 3 }] });
    expect(placedBody().returnWeightGrams).toBe(2000);
    expect(placedBody()).not.toHaveProperty('wasteRequestId');
    expect(placedBody().expectedTotal).toBe(100000);
  });

  it('có phiếu OPEN: tấm chọn sẵn phiếu (một dòng tóm tắt + Đổi món); Xong gửi wasteRequestId, không gửi inlinePickup', async () => {
    m.options.mockResolvedValue({ ...OPTIONS, existingRequest: EXISTING });
    const r = await mount();
    const s = await openSheet(r);
    expect(s.textContent).toContain('TR-PICK1');
    expect(bodyBtn('Đổi món')).not.toBeNull();
    expect(s.textContent).not.toContain('Pin cũ');
    click(bodyBtn('Xong'));
    await flush(8);
    expect(lastQuoteFields()).toMatchObject({ wasteRequestId: 'req-p' });
    expect(lastQuoteFields()).not.toHaveProperty('inlinePickup');
    click(placeButton(r));
    await flush(6);
    expect(placedBody()).toMatchObject({ wasteRequestId: 'req-p' });
    expect(placedBody()).not.toHaveProperty('inlinePickup');
  });

  it('"Đổi món" mở danh sách món điền sẵn số lượng cũ và bỏ phiếu: Xong gửi inlinePickup', async () => {
    m.options.mockResolvedValue({ ...OPTIONS, existingRequest: EXISTING });
    const r = await mount();
    await openSheet(r);
    click(bodyBtn('Đổi món'));
    await flush(2);
    expect(sheet()!.textContent).toContain('Pin cũ');
    click(bodyBtn('Xong'));
    await flush(8);
    expect(lastQuoteFields()).toMatchObject({ inlinePickup: { lines: [{ itemId: 'it-b', qty: 12 }] } });
    expect(lastQuoteFields()).not.toHaveProperty('wasteRequestId');
  });

  it('tắt công tắc khi đã áp → bỏ lựa chọn, báo giá và thân đặt đơn trở lại không có trường thu rác', async () => {
    const r = await mount();
    await openSheet(r);
    await chooseBottles(3);
    click(bodyBtn('Xong'));
    await flush(8);
    click(card(r)!.querySelector('[role="switch"]')!);
    await flush(6);
    expect(lastQuoteFields()).toEqual({});
    click(placeButton(r));
    await flush(6);
    for (const k of ['wasteRequestId', 'inlinePickup', 'returnWeightGrams']) expect(placedBody()).not.toHaveProperty(k);
  });

  it('đóng tấm không bấm Xong → không áp, báo giá không đổi', async () => {
    const r = await mount();
    await openSheet(r);
    await chooseBottles(3);
    click(document.body.querySelector('[aria-modal="true"] button[aria-label]') as HTMLElement);
    await flush(4);
    expect(lastQuoteFields()).toEqual({});
    expect(card(r)!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('báo giá 400 khi áp → hiện đúng câu máy chủ, thẻ vẫn còn để tắt', async () => {
    const message = 'Số kg gửi lại vượt mức cho phép theo kiện hàng';
    m.quote.mockImplementation(async (...a: unknown[]) => {
      const f = a[4] as Record<string, unknown> | undefined;
      if (f?.inlinePickup) throw new ApiError(message, 400);
      return quoteFor(f);
    });
    const r = await mount();
    await openSheet(r);
    await chooseBottles(3);
    click(bodyBtn('Xong'));
    await flush(8);
    expect(r.container.textContent).toContain(message);
    expect(card(r)).not.toBeNull();
  });

  it('409 phiếu thu rác vừa đổi → tải lại báo giá và danh sách món, báo bằng câu của màn, không đặt lại tự động', async () => {
    m.placeOrder.mockRejectedValue(new ApiError('Phiếu thu rác vừa thay đổi, vui lòng chọn lại.', 409));
    const r = await mount();
    await openSheet(r);
    await chooseBottles(3);
    click(bodyBtn('Xong'));
    await flush(8);
    const quotes = m.quote.mock.calls.length;
    const optionCalls = m.options.mock.calls.length;
    click(placeButton(r));
    await flush(8);
    expect(r.container.querySelector('[data-testid="checkout-pickup-notice"]')?.textContent).toContain('Phần đổi rác kèm đơn vừa thay đổi, Tubu đã cập nhật lại giá');
    expect(m.quote.mock.calls.length).toBeGreaterThan(quotes);
    expect(m.options.mock.calls.length).toBeGreaterThan(optionCalls);
    expect(m.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('mất mạng khi đã áp → không tải lại, bấm lại gửi cùng body và cùng Idempotency-Key', async () => {
    m.placeOrder.mockRejectedValue(new NetworkError(false));
    const r = await mount();
    await openSheet(r);
    await chooseBottles(3);
    click(bodyBtn('Xong'));
    await flush(8);
    click(placeButton(r));
    await flush(6);
    click(placeButton(r));
    await flush(6);
    expect(m.placeOrder.mock.calls[1]).toEqual(m.placeOrder.mock.calls[0]);
  });
});

describe('/thanh-toan — Quà đổi điểm tặng kèm 0đ (W168)', () => {
  const giftQuote = (gifts: unknown[]) => async (...a: unknown[]) => quoteFor(a[4] as Record<string, unknown> | undefined, gifts);
  const rows = (r: Rendered) => Array.from(r.container.querySelectorAll<HTMLElement>('[data-testid="checkout-gift-row"]'));
  const checkbox = (row: HTMLElement) => row.querySelector('input[type="checkbox"]') as HTMLInputElement;

  it('một quà: một dòng "Quà đổi điểm tặng kèm · 0đ" cao tối thiểu 44px, mặc định nhận (không tích Để đơn sau), không gửi excludeGiftRedemptionIds', async () => {
    m.quote.mockImplementation(giftQuote([gift('g1')]));
    const r = await mount();
    expect(rows(r)).toHaveLength(1);
    expect(rows(r)[0]!.textContent).toContain('🎁 Quà đổi điểm tặng kèm: Hạt giống g1 · 0đ');
    expect(rows(r)[0]!.textContent).toContain('Để đơn sau');
    expect(rows(r)[0]!.className).toContain('min-h-11');
    expect(checkbox(rows(r)[0]!).checked).toBe(false);
    click(placeButton(r));
    await flush(4);
    expect(placedBody()).not.toHaveProperty('excludeGiftRedemptionIds');
  });

  it('tích "Để đơn sau" → báo giá gọi lại và đặt đơn gửi excludeGiftRedemptionIds; bỏ tích thì quà trở lại', async () => {
    m.quote.mockImplementation(giftQuote([gift('g1'), gift('g2')]));
    const r = await mount();
    click(checkbox(rows(r)[1]!));
    await flush(6);
    expect(lastQuoteFields()).toEqual({ excludeGiftRedemptionIds: ['g2'] });
    click(placeButton(r));
    await flush(6);
    expect(placedBody().excludeGiftRedemptionIds).toEqual(['g2']);
  });

  it('quà để đơn sau bị máy chủ báo included=false vẫn còn dòng để bật lại; bật lại thì bỏ khỏi danh sách loại', async () => {
    m.quote.mockImplementation(async (...a: unknown[]) => {
      const f = a[4] as Record<string, unknown> | undefined;
      const ex = (f?.excludeGiftRedemptionIds as string[] | undefined) ?? [];
      return quoteFor(f, [gift('g1', { included: !ex.includes('g1') })]);
    });
    const r = await mount();
    click(checkbox(rows(r)[0]!));
    await flush(6);
    expect(rows(r)).toHaveLength(1);
    expect(checkbox(rows(r)[0]!).checked).toBe(true);
    click(checkbox(rows(r)[0]!));
    await flush(6);
    expect(lastQuoteFields()).toEqual({});
  });

  it('từ 3 quà trở lên gộp một dòng "3 quà đổi điểm tặng kèm · 0đ", bấm mở tấm nhỏ có từng quà', async () => {
    m.quote.mockImplementation(giftQuote([gift('g1'), gift('g2'), gift('g3')]));
    const r = await mount();
    expect(rows(r)).toHaveLength(0);
    const merged = byText(r.container, 'button', '3 quà đổi điểm tặng kèm · 0đ')!;
    expect(merged).not.toBeNull();
    click(merged);
    await flush(2);
    expect(document.body.querySelectorAll('[data-testid="checkout-gift-row"]')).toHaveLength(3);
  });

  it('quà không đi cùng đơn này (không có kiện Tubu: included=false) → không hiện dòng', async () => {
    m.quote.mockImplementation(giftQuote([gift('g1', { included: false })]));
    const r = await mount();
    expect(rows(r)).toHaveLength(0);
  });

  it('W179-C: quà dưới ngưỡng 99.000đ (MIN_ORDER) hiện mờ kèm "Mua thêm Xđ để nhận quà này" và không có ô chọn; ONE_PER_ORDER đổi quà theo hành vi radio', async () => {
    m.quote.mockImplementation(async (...a: unknown[]) => ({
      ...(await quoteFor(a[4] as Record<string, unknown> | undefined, [gift('g1', { included: false, blockedReason: 'MIN_ORDER' })])),
      giftShortfallVnd: 24_000,
    }));
    let r = await mount();
    expect(rows(r)).toHaveLength(1);
    expect(rows(r)[0]!.textContent).toContain('Mua thêm 24.000đ để nhận quà này');
    expect(checkbox(rows(r)[0]!)).toBeNull();
    r.unmount();

    m.quote.mockImplementation(async (...a: unknown[]) => {
      const f = a[4] as Record<string, unknown> | undefined;
      const ex = (f?.excludeGiftRedemptionIds as string[] | undefined) ?? [];
      const g1In = !ex.includes('g1');
      const g2In = !g1In && !ex.includes('g2');
      return quoteFor(f, [
        gift('g1', { included: g1In, blockedReason: null }),
        gift('g2', { included: g2In, blockedReason: g1In ? 'ONE_PER_ORDER' : null }),
      ]);
    });
    r = await mount();
    expect(rows(r)).toHaveLength(2);
    expect(rows(r)[1]!.textContent).toContain('Mỗi đơn nhận 1 quà, quà này giữ cho đơn sau');
    click(checkbox(rows(r)[1]!));
    await flush(6);
    expect(lastQuoteFields()).toEqual({ excludeGiftRedemptionIds: ['g1'] });
  });
});

describe('/thanh-toan — dòng phí giao khi được miễn (W168)', () => {
  it('không đổi rác: phí giao hiện số thường, không có câu miễn phí', async () => {
    const r = await mount();
    expect(r.container.querySelector('[data-testid="ship-waived"]')).toBeNull();
    expect(r.container.textContent).not.toContain('Miễn phí vận chuyển (đổi rác kèm đơn)');
  });
});
