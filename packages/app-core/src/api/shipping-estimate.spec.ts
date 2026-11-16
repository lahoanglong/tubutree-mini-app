import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../http';
import { cartShippingView, getShippingEstimate, SHIPPING_ESTIMATE_PATH, type ShippingEstimate } from './shipping-estimate';

const est = (over: Partial<ShippingEstimate> = {}): ShippingEstimate => ({
  fee: 19_000,
  feeMin: 19_000,
  feeMax: 19_000,
  freeshipThreshold: 199_000,
  missingForFreeship: 99_000,
  isEstimate: true,
  provinceCode: null,
  provinceName: null,
  ...over,
});

describe('getShippingEstimate', () => {
  it('gửi tiền hàng làm tròn, không âm; tỉnh chỉ khi có', async () => {
    const get = vi.fn().mockResolvedValue(est());
    const http = { get } as unknown as HttpClient;
    await getShippingEstimate(http, { subtotal: 120_000.4 });
    await getShippingEstimate(http, { subtotal: -5, provinceCode: '84_VN79' });
    await getShippingEstimate(http, { subtotal: 10, provinceCode: '' });
    expect(get).toHaveBeenNthCalledWith(1, SHIPPING_ESTIMATE_PATH, { query: { subtotal: 120_000 } });
    expect(get).toHaveBeenNthCalledWith(2, SHIPPING_ESTIMATE_PATH, { query: { subtotal: 0, provinceCode: '84_VN79' } });
    expect(get).toHaveBeenNthCalledWith(3, SHIPPING_ESTIMATE_PATH, { query: { subtotal: 10 } });
  });

  it('giỏ chưa đăng nhập gọi không kèm phiên', async () => {
    const get = vi.fn().mockResolvedValue(est());
    await getShippingEstimate({ get } as unknown as HttpClient, { subtotal: 1 }, { anonymous: true });
    expect(get).toHaveBeenCalledWith(SHIPPING_ESTIMATE_PATH, { query: { subtotal: 1 }, anonymous: true });
  });
});

describe('cartShippingView', () => {
  it('chưa có ước tính: không dòng nào, giỏ giữ cách cũ', () => {
    expect(cartShippingView(null, { goodsNet: 100_000, freeshipReached: false })).toBeNull();
    expect(cartShippingView(undefined, { goodsNet: 100_000, freeshipReached: false })).toBeNull();
  });

  it('dưới ngưỡng: phí có số, tổng tạm tính cộng phí', () => {
    expect(cartShippingView(est(), { goodsNet: 100_000, freeshipReached: false })).toEqual({
      feeLabel: 'Phí giao (ước tính)',
      feeText: '19.000đ',
      free: false,
      totalLabel: 'Tổng tạm tính',
      total: 119_000,
    });
  });

  it('máy chủ nói 0đ: Miễn phí, tổng bằng tiền hàng', () => {
    const v = cartShippingView(est({ fee: 0, feeMin: 0, feeMax: 0 }), { goodsNet: 250_000, freeshipReached: false })!;
    expect(v.feeText).toBe('Miễn phí');
    expect(v.free).toBe(true);
    expect(v.total).toBe(250_000);
  });

  it('thanh Miễn phí giao hàng đã đạt (vd mã miễn phí giao trong giỏ): dòng phí không nói khác thanh', () => {
    const v = cartShippingView(est(), { goodsNet: 150_000, freeshipReached: true })!;
    expect(v.free).toBe(true);
    expect(v.feeText).toBe('Miễn phí');
    expect(v.total).toBe(150_000);
  });

  it('phí còn là khoảng (chưa biết tỉnh): nêu khoảng, không cộng ra tổng', () => {
    const v = cartShippingView(est({ fee: 15_000, feeMin: 15_000, feeMax: 30_000 }), { goodsNet: 100_000, freeshipReached: false })!;
    expect(v.feeText).toBe('15.000đ–30.000đ');
    expect(v.totalLabel).toBeNull();
    expect(v.total).toBeNull();
  });

  it('tiền hàng âm (giảm vượt) không làm tổng âm', () => {
    expect(cartShippingView(est(), { goodsNet: -5, freeshipReached: false })!.total).toBe(19_000);
  });
});
