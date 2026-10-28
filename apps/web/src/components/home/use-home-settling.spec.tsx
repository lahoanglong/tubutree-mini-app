// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_SETTLE_MAX_MS, type HomeKindState } from '@tubutree/app-core/home-layout';
import { renderHook } from '@/test-utils/render-hook';
import { useHomeSettling } from './use-home-settling';

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

  it('mạng chậm: quá hạn thì nhả dù dữ liệu chưa về', () => {
    const { result } = renderHook(() => useHomeSettling('unknown', true));
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(HOME_SETTLE_MAX_MS + 1);
    });
    expect(result.current).toBe(false);
  });
});
