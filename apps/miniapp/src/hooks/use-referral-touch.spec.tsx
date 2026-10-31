import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ touch: vi.fn(), clicks: [] as Array<number | undefined> }));
// clickedAgoMs tách riêng để các ca cũ vẫn so nguyên dto; ca về lúc bấm đọc mocks.clicks.
vi.mock('../services/affiliate-api', () => ({
  recordReferralTouch: ({ clickedAgoMs, ...dto }: { clickedAgoMs?: number }) => {
    mocks.clicks.push(clickedAgoMs);
    return mocks.touch(dto);
  },
}));

import { useAuthStore } from '../store/auth';
import type { AuthUser } from '@tubutree/shared-types';
import { updateCtvTouchMark, useStorefrontContext, wasCtvTouched } from '../store/storefront-context';
import { useReferralTouch } from './use-referral-touch';

const ctx = () => useStorefrontContext.getState();

describe('useReferralTouch: ghi chạm giới thiệu và nhớ mã có phải của CTV không', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clicks.length = 0;
    sessionStorage.clear();
    ctx().clear();
    useAuthStore.setState({ user: { id: 'u1' } as AuthUser, status: 'authenticated' });
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

  it('WebView tải lại (module nạp lại, ngữ cảnh còn trong sessionStorage) sau khi đã chạm CTV: mở gian hàng đối tác vẫn không chạm kiểu brand', async () => {
    mocks.touch.mockResolvedValue({ ok: true });
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv' });
    const first = renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(ctx().referralEligible).toBe(true));
    first.unmount();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(wasCtvTouched('u1', 'AN123')).toBe(true);

    // Tải lại thật làm mất mọi biến trong bộ nhớ: nạp lại store và hook từ đầu, chỉ còn sessionStorage.
    vi.resetModules();
    const store = await import('../store/storefront-context');
    const { useReferralTouch: useReloaded } = await import('./use-referral-touch');
    act(() => store.useStorefrontContext.getState().setContext({ slug: 'doi-tac', kind: 'partner' }));
    expect(store.useStorefrontContext.getState().referralCode).toBe('AN123');
    renderHook(() => useReloaded(true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mocks.touch).toHaveBeenCalledTimes(1);
  });

  it('sang gian hàng đối tác khi chạm CTV còn đang chạy: chạm brand đợi chạm CTV xong rồi mới quyết, nên không xoá slug gian hàng CTV', async () => {
    let finishCtv!: (v: { ok: boolean }) => void;
    mocks.touch.mockReturnValueOnce(new Promise((r) => (finishCtv = r))).mockResolvedValue({ ok: true });
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(1));
    act(() => ctx().setContext({ slug: 'doi-tac', kind: 'partner' }));
    await Promise.resolve();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    await act(async () => finishCtv({ ok: true }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mocks.touch).toHaveBeenCalledTimes(1);
  });

  it('chạm CTV đang chạy rồi thất bại (lỗi mạng): chạm brand đang đợi vẫn được gửi', async () => {
    let failCtv!: (e: Error) => void;
    mocks.touch.mockReturnValueOnce(new Promise((_, rej) => (failCtv = rej))).mockResolvedValue({ ok: true });
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(1));
    act(() => ctx().setContext({ slug: 'doi-tac', kind: 'partner' }));
    await act(async () => failCtv(new Error('offline')));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(2));
  });

  it('chạm gửi kèm lúc bấm link, không phải lúc gửi (đăng nhập muộn)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const clicked = new Date('2026-10-31T10:00:00Z');
      vi.setSystemTime(clicked);
      ctx().setContext({ referralCode: 'AN123', kind: 'ctv' });
      vi.setSystemTime(new Date(clicked.getTime() + 5 * 3600_000));
      mocks.touch.mockResolvedValue({ ok: true });
      renderHook(() => useReferralTouch(true));
      await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(1));
      expect(mocks.clicks).toEqual([5 * 3600_000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('người đăng nhập sau trong cùng WebView không thừa hưởng dấu của người trước: vẫn chạm brand', async () => {
    mocks.touch.mockResolvedValue({ ok: true });
    updateCtvTouchMark('u0', 'AN123', 'ctv', true);
    ctx().setContext({ slug: 'doi-tac', referralCode: 'AN123', kind: 'partner' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(1));
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'AN123', storefrontSlug: undefined, kind: 'brand' });
  });

  it('AN123 (ctv), gian hàng đối tác, ?ref=BINH9 (brand, máy chủ ghi BINH9), ?ref=AN123 (brand): lần cuối gửi được', async () => {
    mocks.touch.mockResolvedValue({ ok: true });
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv' });
    renderHook(() => useReferralTouch(true));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(1));
    act(() => ctx().setContext({ slug: 'doi-tac', kind: 'partner' }));
    await Promise.resolve();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    act(() => ctx().setContext({ slug: null, referralCode: 'BINH9' }));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(2));
    expect(mocks.touch).toHaveBeenLastCalledWith({ referralCode: 'BINH9', storefrontSlug: undefined, kind: 'brand' });
    act(() => ctx().setContext({ referralCode: 'AN123' }));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(3));
    expect(mocks.touch).toHaveBeenLastCalledWith({ referralCode: 'AN123', storefrontSlug: undefined, kind: 'brand' });
  });
});
