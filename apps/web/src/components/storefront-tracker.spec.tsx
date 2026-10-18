// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: 'authenticated', touch: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: mocks.status }) }));
vi.mock('@/lib/shop-client', () => ({ recordReferralTouch: mocks.touch }));

import { clearStorefrontContext, getStorefrontContext } from '@/lib/storefront-context';
import { ReferralCapture } from './storefront-tracker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ReferralCapture />));
  await act(async () => root.unmount());
  host.remove();
}

describe('ReferralCapture ghi nguồn gian hàng ?s= như Mini App', () => {
  beforeEach(() => {
    mocks.status = 'authenticated';
    mocks.touch.mockReset().mockResolvedValue({ ok: true });
    clearStorefrontContext();
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    clearStorefrontContext();
  });

  it('?s=slug: nhớ gian hàng CTV và ghi chạm lấy slug làm mã giới thiệu', async () => {
    window.history.replaceState({}, '', '/san-pham/a?s=an-shop');
    await mount();
    expect(getStorefrontContext()).toMatchObject({ slug: 'an-shop', kind: 'CTV' });
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'an-shop', storefrontSlug: 'an-shop', kind: 'ctv' });
  });

  it('?s=slug&ref=CODE: mã giới thiệu là ref, vẫn gắn slug CTV', async () => {
    window.history.replaceState({}, '', '/?s=an-shop&ref=abc123');
    await mount();
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'ABC123', storefrontSlug: 'an-shop', kind: 'ctv' });
  });

  it('chỉ ?ref=: không có storefrontSlug, kind mặc định ctv như Mini App', async () => {
    window.history.replaceState({}, '', '/?ref=abc123');
    await mount();
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'ABC123', kind: 'ctv' });
  });

  it('?ref= sau khi đã ở gian hàng khác: xoá slug cũ, không gán nhầm storefrontSlug', async () => {
    window.history.replaceState({}, '', '/?s=cu');
    await mount();
    mocks.touch.mockClear();
    window.history.replaceState({}, '', '/?ref=moi');
    await mount();
    expect(getStorefrontContext().slug).toBeNull();
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'MOI', kind: 'ctv' });
  });

  it('chưa đăng nhập: chỉ nhớ, không gọi server', async () => {
    mocks.status = 'anonymous';
    window.history.replaceState({}, '', '/?s=an-shop');
    await mount();
    expect(getStorefrontContext().slug).toBe('an-shop');
    expect(mocks.touch).not.toHaveBeenCalled();
  });

  it('không có s hay ref: không làm gì', async () => {
    await mount();
    expect(mocks.touch).not.toHaveBeenCalled();
  });
});
