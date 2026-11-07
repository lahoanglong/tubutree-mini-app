import { describe, it, expect } from 'vitest';
import { CART_BUMP_MS, FLY_ARC_MAX, flyDelta, flyKeyframes, isMeasurable } from './cart-feedback';

describe('flyDelta', () => {
  it('quãng dịch giữa hai tâm', () => {
    expect(flyDelta({ left: 100, top: 500, width: 40, height: 40 }, { left: 300, top: 10, width: 44, height: 44 })).toEqual({ dx: 202, dy: -488 });
  });
  it('đích ở bên trái và bên dưới cho số dương/âm đúng chiều', () => {
    expect(flyDelta({ left: 200, top: 0, width: 20, height: 20 }, { left: 0, top: 100, width: 20, height: 20 })).toEqual({ dx: -200, dy: 100 });
  });
});

describe('flyKeyframes', () => {
  it('đầu ở gốc, cuối ở đích và nhỏ dần', () => {
    const f = flyKeyframes({ dx: 100, dy: -200 });
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ offset: 0, opacity: 1 });
    expect(f[0]!.transform).toContain('translate3d(0, 0, 0)');
    expect(f[2]).toMatchObject({ offset: 1 });
    expect(f[2]!.transform).toContain('translate3d(100px, -200px, 0)');
    expect(f[2]!.transform).toContain('scale(0.3)');
  });
  it('giữa đường nâng lên tối đa FLY_ARC_MAX', () => {
    const far = flyKeyframes({ dx: 0, dy: -1000 })[1]!.transform;
    expect(far).toContain(`${-1000 * 0.55 - FLY_ARC_MAX}px`);
    const near = flyKeyframes({ dx: 0, dy: -40 })[1]!.transform;
    expect(near).toContain(`${-40 * 0.55 - 10}px`);
  });
});

describe('isMeasurable', () => {
  it('hộp 0×0 hoặc thiếu không dùng làm đích', () => {
    expect(isMeasurable({ left: 0, top: 0, width: 0, height: 0 })).toBe(false);
    expect(isMeasurable(null)).toBe(false);
    expect(isMeasurable({ left: 1, top: 1, width: 44, height: 44 })).toBe(true);
  });
});

describe('thời lượng nảy huy hiệu', () => {
  it('220ms', () => expect(CART_BUMP_MS).toBe(220));
});
