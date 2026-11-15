// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLocalBest, saveLocalBest } from './arcade-best';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('kỷ lục chơi thử của khách (localStorage)', () => {
  it('chưa chơi thì kỷ lục 0; khoá đúng tubu.arcade.best.<gameId>', () => {
    expect(readLocalBest('dew_catcher')).toBe(0);
    saveLocalBest('dew_catcher', 120);
    expect(window.localStorage.getItem('tubu.arcade.best.dew_catcher')).toBe('120');
    expect(window.localStorage.getItem('tubu.arcade.best.refill_rush')).toBeNull();
  });

  it('chỉ ghi khi vượt kỷ lục cũ và báo kỷ lục mới đúng lúc', () => {
    expect(saveLocalBest('refill_rush', 200)).toEqual({ best: 200, isNewBest: true });
    expect(saveLocalBest('refill_rush', 150)).toEqual({ best: 200, isNewBest: false });
    expect(saveLocalBest('refill_rush', 200)).toEqual({ best: 200, isNewBest: false });
    expect(saveLocalBest('refill_rush', 260)).toEqual({ best: 260, isNewBest: true });
    expect(readLocalBest('refill_rush')).toBe(260);
  });

  it('điểm 0 không phải kỷ lục', () => {
    expect(saveLocalBest('dew_catcher', 0)).toEqual({ best: 0, isNewBest: false });
    expect(window.localStorage.getItem('tubu.arcade.best.dew_catcher')).toBeNull();
  });

  it('giá trị hỏng trong bộ nhớ coi như chưa có kỷ lục', () => {
    window.localStorage.setItem('tubu.arcade.best.dew_catcher', 'không phải số');
    expect(readLocalBest('dew_catcher')).toBe(0);
    window.localStorage.setItem('tubu.arcade.best.dew_catcher', '-40');
    expect(readLocalBest('dew_catcher')).toBe(0);
  });

  it('bộ nhớ ném lỗi khi đọc: không ném ra ngoài, kỷ lục 0', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bị chặn');
    });
    expect(readLocalBest('dew_catcher')).toBe(0);
    expect(saveLocalBest('dew_catcher', 90)).toEqual({ best: 90, isNewBest: true });
  });

  it('bộ nhớ ném lỗi khi ghi: bảng điểm của ván vẫn có kỷ lục mới', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('đầy bộ nhớ');
    });
    expect(saveLocalBest('refill_rush', 310)).toEqual({ best: 310, isNewBest: true });
    expect(readLocalBest('refill_rush')).toBe(0);
  });
});
