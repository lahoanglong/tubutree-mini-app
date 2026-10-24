import { afterEach, describe, expect, it, vi } from 'vitest';
import { Reconnector, backoffMs } from './reconnect';

describe('backoffMs', () => {
  it('5s, 10s, 20s ... tối đa 5 phút', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  });
});

describe('Reconnector', () => {
  afterEach(() => vi.useRealTimers());

  it('hẹn một lần duy nhất dù gọi schedule nhiều lần, reset đưa về 5s', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const r = new Reconnector(run);
    expect(r.schedule()).toBe(5_000);
    expect(r.schedule()).toBeNull();
    vi.advanceTimersByTime(5_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(r.schedule()).toBe(10_000);
    r.cancel();
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    r.reset();
    expect(r.schedule()).toBe(5_000);
  });
});
