// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_SETTLE_MAX_MS, type HomeKindState } from '@tubutree/app-core/home-layout';
import { renderHook } from '@/test-utils/render-hook';
import { useHomeSettling, useStartedAsNew } from './use-home-settling';

type Props = { kind: HomeKindState; pending: boolean };

describe('useHomeSettling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('máy nhớ loại khách từ đầu: không bao giờ giữ khung chờ', () => {
    const { result, rerender } = renderHook(({ kind, pending }: Props) => useHomeSettling(kind, pending), { initialProps: { kind: 'returning', pending: true } });
    expect(result.current).toBe(false);
    rerender({ kind: 'returning', pending: false });
    expect(result.current).toBe(false);
  });

  it('chưa biết loại khách: giữ tới khi biết loại và dữ liệu về, rồi không giữ lại khi làm mới nền', () => {
    const { result, rerender } = renderHook(({ kind, pending }: Props) => useHomeSettling(kind, pending), { initialProps: { kind: 'unknown', pending: false } as Props });
    expect(result.current).toBe(true);
    rerender({ kind: 'returning', pending: true });
    expect(result.current).toBe(true);
    rerender({ kind: 'returning', pending: false });
    expect(result.current).toBe(false);
    rerender({ kind: 'returning', pending: true });
    expect(result.current).toBe(false);
  });

  it('web: loại "chưa biết" đến sau khung hình đầu (HTML server là khách vãng lai) vẫn giữ khung chờ', () => {
    const { result, rerender } = renderHook(({ kind, pending }: Props) => useHomeSettling(kind, pending), { initialProps: { kind: 'new', pending: true } as Props });
    expect(result.current).toBe(false);
    rerender({ kind: 'unknown', pending: true });
    expect(result.current).toBe(true);
  });

  it('phiên lỗi (mất mạng, API tạm lỗi lúc khôi phục): nhả ngay, không chờ 4,5 giây dù dữ liệu chưa về', () => {
    const { result, rerender } = renderHook(({ kind, pending, failed }: Props & { failed: boolean }) => useHomeSettling(kind, pending, failed), {
      initialProps: { kind: 'unknown', pending: true, failed: false } as Props & { failed: boolean },
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(HOME_SETTLE_MAX_MS - 100);
    });
    expect(result.current).toBe(true);
    rerender({ kind: 'new', pending: true, failed: true });
    expect(result.current).toBe(false);
    // Phiên khôi phục được sau đó (Thử lại) cũng không kéo khung chờ lại.
    rerender({ kind: 'unknown', pending: true, failed: false });
    expect(result.current).toBe(false);
  });

  it('phiên lỗi ngay từ khung hình đầu: không bao giờ giữ khung chờ', () => {
    const { result } = renderHook(() => useHomeSettling('unknown', true, true));
    expect(result.current).toBe(false);
  });

  it('mạng chậm: quá hạn thì nhả dù dữ liệu chưa về', () => {
    const { result } = renderHook(() => useHomeSettling('unknown', true));
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(HOME_SETTLE_MAX_MS + 1);
    });
    expect(result.current).toBe(false);
  });
});

describe('useStartedAsNew', () => {
  it('khung hình đầu là khách mới (HTML server): ghi nhớ cả khi loại khách đổi sau đó', () => {
    const { result, rerender } = renderHook(({ kind }: { kind: HomeKindState }) => useStartedAsNew(kind), { initialProps: { kind: 'new' } as { kind: HomeKindState } });
    expect(result.current).toBe(true);
    rerender({ kind: 'unknown' });
    expect(result.current).toBe(true);
    rerender({ kind: 'returning' });
    expect(result.current).toBe(true);
  });

  it('khung hình đầu chưa biết hoặc là khách cũ: không giữ, kể cả khi sau đó thành khách mới', () => {
    for (const first of ['unknown', 'returning'] as const) {
      const { result, rerender } = renderHook(({ kind }: { kind: HomeKindState }) => useStartedAsNew(kind), { initialProps: { kind: first } as { kind: HomeKindState } });
      expect(result.current).toBe(false);
      rerender({ kind: 'new' });
      expect(result.current).toBe(false);
    }
  });
});
