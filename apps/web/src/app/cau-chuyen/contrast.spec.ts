import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, firstDecl, lerp, over, parseColor, ratio, readText } from '@/test-utils/contrast';

// Chép phần chữ-trên-ô-nhãn của css/contrast.spec.ts (Mini App): cùng ngưỡng 4,5:1 (WCAG 1.4.3), cùng điểm đo trên gradient.
const BRAND = readText(path.join(SRC, 'app/cau-chuyen/brand-theme.css'));

describe('chữ trắng trên ô gradient nhãn ở Hành trình nguyên liệu đạt 4,5:1 (D8-1)', () => {
  const ids = [...BRAND.matchAll(/--color-brand-([a-z0-9]+)-from:/g)].map((m) => m[1]!);
  const scrimRaw = firstDecl(BRAND, '--color-brand-tile-scrim');
  const scrim = scrimRaw ? parseColor(scrimRaw) : { rgb: [0, 0, 0] as [number, number, number], alpha: 0 };
  const white: [number, number, number] = [255, 255, 255];

  it('khai báo cùng tên token và cùng độ đậm như Mini App', () => {
    expect(scrimRaw).toBe('rgba(0, 0, 0, 0.45)');
  });

  it('có đủ 8 nhãn', () => {
    expect(ids).toHaveLength(8);
  });

  it.each([0.4, 0.5, 0.6, 0.75, 0.85])('mọi nhãn ở %s đường gradient (vị trí chữ) sau lớp phủ tối', (t) => {
    const low: string[] = [];
    for (const id of ids) {
      const from = parseColor(firstDecl(BRAND, `--color-brand-${id}-from`)!).rgb;
      const to = parseColor(firstDecl(BRAND, `--color-brand-${id}-to`)!).rgb;
      const bg = over(scrim, lerp(from, to, t));
      const r = ratio(white, bg);
      if (r < 4.5) low.push(`${id} ${r.toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });
});
