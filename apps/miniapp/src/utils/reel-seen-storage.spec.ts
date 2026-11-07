// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REEL_SEEN_KEY, markReelSeen, readReelSeen } from '@tubutree/app-core/commerce/story-reel';
import { reelSeenStorage, resetReelSeenMemory } from './reel-seen-storage';

describe('reelSeenStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetReelSeenMemory();
  });
  afterEach(() => vi.restoreAllMocks());

  it('ghi vào sessionStorage và đọc lại qua cùng cổng', () => {
    const s = reelSeenStorage();
    s.setItem('k', 'v');
    expect(sessionStorage.getItem('k')).toBe('v');
    expect(s.getItem('k')).toBe('v');
  });

  it('khoá chưa có: null', () => {
    expect(reelSeenStorage().getItem('chua-co')).toBeNull();
  });

  it('sessionStorage ném lỗi khi ghi (đầy, chế độ riêng tư): vẫn nhớ trong bộ nhớ, không ném', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const s = reelSeenStorage();
    expect(() => s.setItem('k', 'v')).not.toThrow();
    expect(s.getItem('k')).toBe('v');
  });

  it('sessionStorage ném lỗi khi đọc (WebView chặn): rơi về bản trong bộ nhớ, không ném', () => {
    const s = reelSeenStorage();
    s.setItem('k', 'v');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => s.getItem('k')).not.toThrow();
    expect(s.getItem('k')).toBe('v');
    expect(s.getItem('khac')).toBeNull();
  });

  it('bản trong bộ nhớ sống qua lần dựng cổng mới (khách rời Trang chủ rồi quay lại trong khi sessionStorage hỏng)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('x');
    });
    reelSeenStorage().setItem('k', 'v');
    expect(reelSeenStorage().getItem('k')).toBe('v');
  });

  it('chạy cùng markReelSeen/readReelSeen của app-core: đã xem được nhớ qua lần đọc lại', () => {
    const store = reelSeenStorage();
    const seen = markReelSeen(store, readReelSeen(store), 'rau-cu');
    expect(seen.has('rau-cu')).toBe(true);
    expect(sessionStorage.getItem(REEL_SEEN_KEY)).toContain('rau-cu');
    expect(readReelSeen(reelSeenStorage()).has('rau-cu')).toBe(true);
  });

  it('sessionStorage hỏng hẳn: markReelSeen vẫn trả bộ mới và lần đọc sau vẫn thấy', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('x');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('x');
    });
    const store = reelSeenStorage();
    const seen = markReelSeen(store, readReelSeen(store), 'a');
    expect(seen.has('a')).toBe(true);
    expect(readReelSeen(reelSeenStorage()).has('a')).toBe(true);
  });

  it('resetReelSeenMemory xoá bản trong bộ nhớ', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('x');
    });
    reelSeenStorage().setItem('k', 'v');
    resetReelSeenMemory();
    expect(reelSeenStorage().getItem('k')).toBeNull();
  });
});
