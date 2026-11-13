import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, firstDecl, lerp, parseColor, ratio, readText, tokenRgb } from '@/test-utils/contrast';

const BRAND = readText(path.join(SRC, 'app/cau-chuyen/brand-theme.css'));
const MAP = readText(path.join(SRC, 'app/cau-chuyen/brand-map.css'));
const ids = [...BRAND.matchAll(/--color-brand-([a-z0-9]+):/g)].map((m) => m[1]!);
const CATALOG_IDS = ['fuwa3e', 'bhnong', 'polang', 'visante', 'hector', 'leplateau', 'cobote', 'sokfram'];

// Nhãn trên bản đồ và thẻ là chữ đậm/thường trên nền thẻ, không còn chữ trắng đặt lên gradient. Ngưỡng 4,5:1 (WCAG 1.4.3).
describe('chữ nhãn ở Hành trình nguyên liệu đạt 4,5:1 (D8-1)', () => {
  const surface = tokenRgb('--color-bg-surface');
  const primary = tokenRgb('--color-text-primary');
  const secondary = tokenRgb('--color-text-secondary');

  it('có token màu nhận diện cho đủ 8 nhãn', () => {
    for (const id of CATALOG_IDS) expect(ids, id).toContain(id);
  });

  it('tên nhãn và tỉnh trên nền thẻ', () => {
    expect(ratio(primary, surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(secondary, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('nhãn đang chọn pha 10% màu nhãn vào nền thẻ: chữ vẫn đạt 4,5:1 với mọi nhãn', () => {
    expect(MAP).toContain('color-mix(in srgb, var(--pin) 10%, var(--color-bg-surface))');
    const low: string[] = [];
    for (const id of CATALOG_IDS) {
      const brand = parseColor(firstDecl(BRAND, `--color-brand-${id}`)!).rgb;
      const bg = lerp(surface, brand, 0.1);
      for (const [name, fg] of [['tên', primary], ['tỉnh', secondary]] as const) {
        const r = ratio(fg, bg);
        if (r < 4.5) low.push(`${id} ${name} ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('không còn gradient hay lớp phủ tối của ô nhãn cũ trong token', () => {
    expect(BRAND).not.toMatch(/-from:|-to:|brand-tile-scrim/);
    expect(MAP).not.toMatch(/gradient|brand-tile-scrim/);
  });
});
