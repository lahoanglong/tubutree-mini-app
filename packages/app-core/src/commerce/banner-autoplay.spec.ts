import { describe, expect, it } from 'vitest';
import { BANNER_MIN_INTERVAL_MS, bannerInterval, bannerNextIndex, bannerShouldAutoplay, type BannerAutoplayState } from './banner-autoplay';

const ok: BannerAutoplayState = { slideCount: 3, userPaused: false, reducedMotion: false, hidden: false, held: false };

describe('bannerInterval', () => {
  it('thiếu, rác hoặc dưới 5 giây thì lấy 5 giây (WCAG 2.2.2: mỗi slide hiện ít nhất 5 giây)', () => {
    expect(BANNER_MIN_INTERVAL_MS).toBe(5000);
    for (const v of [undefined, Number.NaN, 1000, 0, -3000, Number.POSITIVE_INFINITY]) expect(bannerInterval(v), String(v)).toBe(5000);
  });

  it('từ 5 giây trở lên giữ nguyên', () => {
    expect(bannerInterval(7000)).toBe(7000);
    expect(bannerInterval(5000)).toBe(5000);
  });
});

describe('bannerShouldAutoplay', () => {
  it('đủ điều kiện thì chạy', () => {
    expect(bannerShouldAutoplay(ok)).toBe(true);
  });

  it.each([
    ['một slide', { slideCount: 1 }],
    ['không slide', { slideCount: 0 }],
    ['khách đã dừng', { userPaused: true }],
    ['tab đang ẩn', { hidden: true }],
    ['focus hoặc ngón tay đang trong banner', { held: true }],
    ['khách bật giảm chuyển động', { reducedMotion: true }],
    ['chưa biết khách có bật giảm chuyển động không', { reducedMotion: null }],
  ] as [string, Partial<BannerAutoplayState>][])('không chạy khi %s', (_name, patch) => {
    expect(bannerShouldAutoplay({ ...ok, ...patch })).toBe(false);
  });
});

describe('bannerNextIndex', () => {
  it('đi tiếp và vòng về đầu', () => {
    expect(bannerNextIndex(0, 3)).toBe(1);
    expect(bannerNextIndex(2, 3)).toBe(0);
  });

  it('không slide thì 0; chỉ số ngoài biên về 0', () => {
    expect(bannerNextIndex(0, 0)).toBe(0);
    expect(bannerNextIndex(9, 3)).toBe(0);
    expect(bannerNextIndex(-1, 3)).toBe(0);
  });
});
