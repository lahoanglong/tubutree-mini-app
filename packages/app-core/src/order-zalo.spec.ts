import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from './http';
import { fetchOrderZaloStatus, orderZaloConsentView, saveOrderZaloChoice, showOrderZaloFriend, tubuZaloUrl, type OrderZaloStatus } from './order-zalo';

const status = (over: Partial<OrderZaloStatus> = {}): OrderZaloStatus => ({
  enabled: true,
  prechecked: false,
  choice: null,
  phoneMasked: '090•••4567',
  tubuZaloPhone: '0899149229',
  ...over,
});

describe('orderZaloConsentView', () => {
  it('cờ tắt, chưa tải hoặc không có số đã xác minh: không hiện ô', () => {
    expect(orderZaloConsentView(undefined)).toBeNull();
    expect(orderZaloConsentView(null)).toBeNull();
    expect(orderZaloConsentView(status({ enabled: false }))).toBeNull();
    expect(orderZaloConsentView(status({ phoneMasked: null }))).toBeNull();
  });

  it('lần đầu không tick sẵn (mss.order_consent_prechecked=false), hiện số đã che', () => {
    expect(orderZaloConsentView(status())).toEqual({ checked: false, phone: '090•••4567' });
  });

  it('lần sau nhớ lựa chọn của khách, kể cả khi cấu hình tick sẵn', () => {
    expect(orderZaloConsentView(status({ choice: true }))?.checked).toBe(true);
    expect(orderZaloConsentView(status({ choice: false, prechecked: true }))?.checked).toBe(false);
    expect(orderZaloConsentView(status({ prechecked: true }))?.checked).toBe(true);
  });
});

describe('tubuZaloUrl', () => {
  it('mở đúng số Zalo Tubu Tree, số lạ rơi về mặc định', () => {
    expect(tubuZaloUrl('0899149229')).toBe('https://zalo.me/0899149229');
    expect(tubuZaloUrl('0912345678')).toBe('https://zalo.me/0912345678');
    expect(tubuZaloUrl(undefined)).toBe('https://zalo.me/0899149229');
    expect(tubuZaloUrl('javascript:alert(1)')).toBe('https://zalo.me/0899149229');
  });
});

describe('showOrderZaloFriend', () => {
  it('chỉ khi cờ bật, đơn có đồng ý và hành trình còn mở', () => {
    expect(showOrderZaloFriend(true, { status: 'CONFIRMED', orderZaloConsent: true })).toBe(true);
    expect(showOrderZaloFriend(true, { status: 'SHIPPING', orderZaloConsent: true })).toBe(true);
    expect(showOrderZaloFriend(undefined, { status: 'CONFIRMED', orderZaloConsent: true })).toBe(false);
    expect(showOrderZaloFriend(true, { status: 'CONFIRMED', orderZaloConsent: false })).toBe(false);
    expect(showOrderZaloFriend(true, { status: 'CONFIRMED' })).toBe(false);
    for (const s of ['DELIVERED', 'COMPLETED', 'CANCELLED', 'RETURNED']) {
      expect(showOrderZaloFriend(true, { status: s, orderZaloConsent: true })).toBe(false);
    }
  });
});

describe('gọi API', () => {
  it('đọc trạng thái ở /config/order-zalo, lưu ở PATCH /me/order-zalo-updates', async () => {
    const http = { get: vi.fn(async () => status()), patch: vi.fn(async () => ({ enabled: true })) } as unknown as HttpClient;
    await fetchOrderZaloStatus(http);
    await saveOrderZaloChoice(http, true);
    expect(http.get).toHaveBeenCalledWith('/config/order-zalo');
    expect(http.patch).toHaveBeenCalledWith('/me/order-zalo-updates', { enabled: true });
  });
});
