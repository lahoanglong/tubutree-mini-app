// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGuestClaimPending,
  existingGuestDeviceId,
  guestBankHref,
  guestClaimPending,
  guestDeviceId,
  guestTrackHref,
  hashTrackingKey,
  newTrackingKey,
  rememberGuestOrder,
  savedGuestOrderKey,
} from './keys';
import { guestCheckoutOn, welcomeAmountOf } from './flag';

beforeEach(() => localStorage.clear());

describe('khoá theo dõi và deviceId của khách đặt không đăng nhập', () => {
  it('khoá theo dõi: 43 ký tự base64url (256 bit), mỗi lần một khoá khác', () => {
    const a = newTrackingKey();
    const b = newTrackingKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('deviceId: tạo một lần, giữ trong localStorage, đúng khuôn x-guest-device của máy chủ', () => {
    expect(existingGuestDeviceId()).toBeNull();
    const d = guestDeviceId();
    expect(d).toMatch(/^w_[A-Za-z0-9_-]{32}$/);
    expect(guestDeviceId()).toBe(d);
    expect(existingGuestDeviceId()).toBe(d);
  });

  it('nhớ khoá cho mọi mã của lần đặt (đơn tách kiện) và bật dấu chờ đưa đơn về tài khoản', () => {
    const k = newTrackingKey();
    rememberGuestOrder(['TB1', 'TB2'], k);
    expect(savedGuestOrderKey('TB1')).toBe(k);
    expect(savedGuestOrderKey('TB2')).toBe(k);
    expect(savedGuestOrderKey('TB3')).toBeNull();
    expect(guestClaimPending()).toBe(true);
    clearGuestClaimPending();
    expect(guestClaimPending()).toBe(false);
    expect(savedGuestOrderKey('TB1')).toBe(k);
  });

  it('bỏ khoá quá 180 ngày, giữ tối đa 20 đơn gần nhất', () => {
    const now = Date.now();
    rememberGuestOrder(['OLD'], newTrackingKey(), now - 200 * 86_400_000);
    for (let i = 0; i < 22; i++) rememberGuestOrder([`N${i}`], newTrackingKey(), now + i);
    expect(savedGuestOrderKey('OLD')).toBeNull();
    expect(savedGuestOrderKey('N0')).toBeNull();
    expect(savedGuestOrderKey('N21')).not.toBeNull();
  });

  it('đọc khoá ở phần #k=; sai khuôn thì null', () => {
    const k = newTrackingKey();
    expect(hashTrackingKey(`#k=${k}`)).toBe(k);
    expect(hashTrackingKey('#k=ngan')).toBeNull();
    expect(hashTrackingKey('')).toBeNull();
  });

  it('đường dẫn theo dõi và chuyển khoản mang khoá sau dấu #, không vào query', () => {
    expect(guestTrackHref('TB 1', 'K')).toBe('/don/TB%201#k=K');
    expect(guestBankHref('TB1', 'K')).toBe('/thanh-toan/chuyen-khoan/TB1#k=K');
  });
});

describe('cờ và số tiền quà đơn đầu từ /config/public', () => {
  it('chỉ boolean true mới bật', () => {
    expect(guestCheckoutOn({ webGuestCheckoutEnabled: true })).toBe(true);
    expect(guestCheckoutOn({ webGuestCheckoutEnabled: 'true' })).toBe(false);
    expect(guestCheckoutOn({})).toBe(false);
    expect(guestCheckoutOn(undefined)).toBe(false);
  });

  it('quà đơn đầu: số dương mới hiện', () => {
    expect(welcomeAmountOf({ newCustomer: { welcomeVoucher: { amount: 30_000 } } })).toBe(30_000);
    expect(welcomeAmountOf({ newCustomer: { welcomeVoucher: null } })).toBeNull();
    expect(welcomeAmountOf({ newCustomer: { welcomeVoucher: { amount: 0 } } })).toBeNull();
    expect(welcomeAmountOf({})).toBeNull();
  });
});
