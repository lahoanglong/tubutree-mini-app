import { act, renderHook, waitFor } from '@testing-library/react';
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
  it('đã chạm xong mã CTV rồi mở gian hàng đối tác (cùng mã): không chạm lại kiểu brand, kẻo máy chủ xoá slug gian hàng CTV khỏi chạm', async () => {
    mocks.touch.mockResolvedValue({ ok: true });
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(ctx().referralEligible).toBe(true));
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    act(() => ctx().setContext({ slug: 'doi-tac', kind: 'partner' }));
    await Promise.resolve();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
  });

  it('gian hàng đối tác nhưng mã khác mã CTV đã chạm: vẫn chạm', async () => {
    mocks.touch.mockResolvedValue({ ok: true });
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(ctx().referralEligible).toBe(true));
    act(() => ctx().setContext({ slug: 'doi-tac', referralCode: 'KHAC99', kind: 'partner' }));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(2));
    expect(mocks.touch).toHaveBeenLastCalledWith({ referralCode: 'KHAC99', storefrontSlug: undefined, kind: 'brand' });
  });

  it('chạm CTV chưa tới máy chủ (lỗi mạng) thì mở gian hàng đối tác vẫn chạm như thường', async () => {
    mocks.touch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true });
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    act(() => ctx().setContext({ slug: 'doi-tac', kind: 'partner' }));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(2));
  });
});
