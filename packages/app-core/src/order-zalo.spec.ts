import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from './http';
import {
  enableOrderZaloForOrder,
  fetchOrderZaloStatus,
  orderZaloConsentView,
  orderZaloDetailView,
  saveOrderZaloChoice,
  showOrderZaloFriend,
  tubuZaloUrl,
  type OrderZaloStatus,
} from './order-zalo';

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

describe('orderZaloDetailView (nút bật Zalo ở chi tiết đơn)', () => {
  const active = { status: 'SHIPPING', orderZaloConsent: null, orderZaloAvailable: true };

  it('đủ điều kiện: cờ chung bật, có số đã xác minh, đơn đang đi, chưa đồng ý, máy chủ báo nhắn được', () => {
    expect(orderZaloDetailView(status(), active)).toEqual({ kind: 'offer', phone: '090•••4567' });
    for (const s of ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING']) expect(orderZaloDetailView(status(), { ...active, status: s })).toEqual({ kind: 'offer', phone: '090•••4567' });
  });

  it('thiếu một điều kiện thì không có nút', () => {
    expect(orderZaloDetailView(undefined, active)).toBeNull();
    expect(orderZaloDetailView(status({ enabled: false }), active)).toBeNull();
    expect(orderZaloDetailView(status({ phoneMasked: null }), active)).toBeNull();
    for (const s of ['DELIVERED', 'CANCELLED', 'RETURNED']) expect(orderZaloDetailView(status(), { ...active, status: s })).toBeNull();
    expect(orderZaloDetailView(status(), { ...active, orderZaloAvailable: false })).toBeNull();
    expect(orderZaloDetailView(status(), { status: 'SHIPPING' })).toBeNull();
  });

  it('máy chủ báo tin đang được gửi: một dòng "Sẽ báo qua Zalo số …", không còn nút', () => {
    expect(orderZaloDetailView(status(), { ...active, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true })).toEqual({ kind: 'on', phone: '090•••4567' });
    expect(orderZaloDetailView(status(), { status: 'DELIVERED', orderZaloConsent: true, orderZaloOn: true })).toBeNull();
  });

  it('đơn có đồng ý nhưng máy chủ không gửi (khách đã tắt, nhắn dừng, đơn tặng) hoặc API cũ: không hứa, không có nút', () => {
    expect(orderZaloDetailView(status(), { status: 'SHIPPING', orderZaloConsent: true, orderZaloOn: false })).toBeNull();
    expect(orderZaloDetailView(status(), { status: 'SHIPPING', orderZaloConsent: true })).toBeNull();
    expect(orderZaloDetailView(status(), { status: 'SHIPPING', orderZaloConsent: true, orderZaloAvailable: true })).toBeNull();
  });

  it('gọi POST /orders/:code/order-zalo-consent, mã đơn được mã hoá', async () => {
    const post = vi.fn(async () => ({ orderZaloConsent: true }));
    await enableOrderZaloForOrder({ post } as unknown as HttpClient, 'TB 1/2');
    expect(post).toHaveBeenCalledWith('/orders/TB%201%2F2/order-zalo-consent');
  });
});
