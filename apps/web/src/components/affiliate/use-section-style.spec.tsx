// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as mount } from '@/test-utils/dom';
import { useSectionStyle, type SectionStyleDeps } from './use-section-style';

let api!: ReturnType<typeof useSectionStyle>;
function Host({ deps }: { deps: SectionStyleDeps }) {
  api = useSectionStyle(deps);
  return null;
}

/** `send` giả như `mutate`; `finish` là lúc mutation xong (`onSettled` gọi `settled`, kể cả sau khi rời màn). */
function setup(current: 'GRID' | 'CAROUSEL' | 'STACK' = 'GRID') {
  const send = vi.fn();
  const deps: SectionStyleDeps = { send, currentOf: () => current };
  const r = mount(<Host deps={deps} />);
  const finish = (id: string, layout: 'GRID' | 'CAROUSEL' | 'STACK') => {
    act(() => api.settled(id, layout));
  };
  return { send, finish, unmount: r.unmount };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useSectionStyle', () => {
  it('chỉ gửi ô cuối sau một nhịp, không gửi chồng khi lần trước chưa xong', () => {
    const { send, finish } = setup();
    act(() => api.choose('c1', 'STACK'));
    act(() => vi.advanceTimersByTime(300));
    expect(send).toHaveBeenCalledTimes(1);
    act(() => api.choose('c1', 'CAROUSEL'));
    act(() => vi.advanceTimersByTime(1000));
    expect(send).toHaveBeenCalledTimes(1);
    finish('c1', 'STACK');
    act(() => vi.advanceTimersByTime(300));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ id: 'c1', layout: 'CAROUSEL' });
  });

  it('rời màn lúc lần ghi trước còn chạy: lựa chọn đang chờ được gửi nốt khi lần trước xong, đúng một lần', () => {
    const { send, finish, unmount } = setup();
    act(() => api.choose('c1', 'STACK'));
    act(() => vi.advanceTimersByTime(300));
    expect(send).toHaveBeenCalledTimes(1);
    act(() => api.choose('c1', 'CAROUSEL'));
    unmount();
    expect(send).toHaveBeenCalledTimes(1);
    finish('c1', 'STACK');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ id: 'c1', layout: 'CAROUSEL' });
    act(() => vi.advanceTimersByTime(5000));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rời màn khi không có lần ghi nào đang chạy: gửi ngay lựa chọn đang chờ', () => {
    const { send, unmount } = setup();
    act(() => api.choose('c1', 'STACK'));
    unmount();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ id: 'c1', layout: 'STACK' });
  });

  it('rời màn mà lựa chọn đã trùng kiểu đang lưu: không gửi', () => {
    const { send, unmount } = setup('STACK');
    act(() => api.choose('c1', 'STACK'));
    unmount();
    expect(send).not.toHaveBeenCalled();
  });
});
