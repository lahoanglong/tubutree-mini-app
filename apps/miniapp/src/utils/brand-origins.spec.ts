import { describe, expect, it } from 'vitest';
import { BRAND_ORIGINS, pinBoxes, type PinBox } from './brand-origins';

const hit = (a: PinBox, b: PinBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Khung bản đồ hẹp nhất cần đẹp: màn 360px trừ lề 16px hai bên = 328 rộng, tỉ lệ 3 / 4.6 => 503 cao.
// Màn rộng hơn chỉ nở khung ra theo cùng tỉ lệ nên không chật hơn.
const FRAME = { w: 328, h: 503 };

describe('ghim bản đồ /brand-story không chồng nhau', () => {
  const boxes = BRAND_ORIGINS.map((o) => ({ o, ...pinBoxes(o, FRAME) }));

  it('không cặp ghim nào có vòng tròn hoặc nhãn đè lên vòng tròn/nhãn của ghim khác', () => {
    const clashes: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (hit(a.circle, b.circle) || hit(a.circle, b.label) || hit(a.label, b.circle) || hit(a.label, b.label)) {
          clashes.push(`${a.o.brand} x ${b.o.brand}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('mọi ghim và nhãn nằm gọn trong khung bản đồ', () => {
    const out = boxes
      .filter(({ circle, label }) => [circle, label].some((x) => x.left < 0 || x.top < 0 || x.right > FRAME.w || x.bottom > FRAME.h))
      .map(({ o }) => o.brand);
    expect(out).toEqual([]);
  });
});
