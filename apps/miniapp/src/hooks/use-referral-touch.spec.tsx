import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ touch: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ recordReferralTouch: mocks.touch }));

import { useStorefrontContext } from '../store/storefront-context';
import { useReferralTouch } from './use-referral-touch';

const ctx = () => useStorefrontContext.getState();

describe('useReferralTouch: ghi chạm giới thiệu và nhớ mã có phải của CTV không', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    ctx().clear();
  });

  it('chưa đăng nhập: không gọi máy chủ, chưa biết gì', () => {
    ctx().setContext({ referralCode: 'KHACH01' });
    renderHook(() => useReferralTouch(false));
    expect(mocks.touch).not.toHaveBeenCalled();
    expect(ctx().referralEligible).toBeNull();
  });

  it('máy chủ trả ok:false (mã khách thường) → referralEligible = false', async () => {
    mocks.touch.mockResolvedValue({ ok: false });
    ctx().setContext({ referralCode: 'KHACH01' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(ctx().referralEligible).toBe(false));
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'KHACH01', storefrontSlug: undefined, kind: 'ctv' });
  });

  it('máy chủ trả ok:true (CTV thật) → referralEligible = true', async () => {
    mocks.touch.mockResolvedValue({ ok: true });
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(ctx().referralEligible).toBe(true));
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'AN123', storefrontSlug: 'an', kind: 'ctv' });
  });

  it('lỗi mạng: chưa biết (null), không vỡ', async () => {
    mocks.touch.mockRejectedValue(new Error('offline'));
    ctx().setContext({ referralCode: 'AN123' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalled());
    await Promise.resolve();
    expect(ctx().referralEligible).toBeNull();
  });

  it('chỉ có slug (link ?s=): chạm bằng slug, gian hàng đối tác (brand) không gửi storefrontSlug', async () => {
    mocks.touch.mockResolvedValue({ ok: false });
    ctx().setContext({ slug: 'doi-tac', kind: 'brand' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'doi-tac', storefrontSlug: undefined, kind: 'brand' }));
  });
});
