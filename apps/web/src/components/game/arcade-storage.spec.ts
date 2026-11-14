// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readGuestBest, writeGuestBest } from './arcade-storage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('arcade-storage (kỷ lục của khách)', () => {
  it('chưa chơi thì 0; ghi rồi đọc lại đúng, mỗi game một khoá riêng', () => {
    expect(readGuestBest('dew_catcher')).toBe(0);
    writeGuestBest('dew_catcher', 420);
    writeGuestBest('refill_rush', 150);
    expect(readGuestBest('dew_catcher')).toBe(420);
    expect(readGuestBest('refill_rush')).toBe(150);
    expect(localStorage.getItem('tubu.arcade.best.dew_catcher')).toBe('420');
  });

  it('chỉ ghi khi cao hơn; điểm thấp hơn hoặc bằng không hạ kỷ lục', () => {
    writeGuestBest('dew_catcher', 420);
    writeGuestBest('dew_catcher', 300);
    writeGuestBest('dew_catcher', 420);
    expect(readGuestBest('dew_catcher')).toBe(420);
    writeGuestBest('dew_catcher', 421);
    expect(readGuestBest('dew_catcher')).toBe(421);
  });

  it('giá trị lạ trong storage đọc ra 0, điểm lẻ được làm tròn xuống', () => {
    for (const bad of ['abc', '-5', 'NaN', '']) {
      localStorage.setItem('tubu.arcade.best.dew_catcher', bad);
      expect(readGuestBest('dew_catcher')).toBe(0);
    }
    localStorage.clear();
    writeGuestBest('dew_catcher', 99.9);
    expect(readGuestBest('dew_catcher')).toBe(99);
  });

  it('storage bị chặn hoặc đầy: đọc ra 0, ghi không ném lỗi', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('chặn');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('đầy');
    });
    expect(readGuestBest('dew_catcher')).toBe(0);
    expect(() => writeGuestBest('dew_catcher', 100)).not.toThrow();
  });
});
