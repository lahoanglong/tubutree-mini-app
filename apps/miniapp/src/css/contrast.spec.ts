import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, firstDecl, lerp, over, parseColor, ratio, readText, resolveColor, tokenRgb } from '../test-support/contrast';

const BRIDGE = readText(path.join(SRC, 'css/zaui-bridge.css'));
const BRAND = readText(path.join(SRC, 'css/brand-theme.css'));

describe('viền ô nhập, checkbox, radio và nền công tắc tắt đạt 3:1 (D8-2, WCAG 1.4.11)', () => {
  const surface = tokenRgb('--color-bg-surface');
  const canvas = tokenRgb('--color-bg-canvas');

  it.each([
    '--zaui-light-input-border-color',
    '--zaui-light-checkbox-border-color',
    '--zaui-light-radio-border-color',
    '--zaui-light-switch-off-bg-color',
  ])('%s ≥ 3:1 so với nền thẻ trắng và nền canvas', (name) => {
    const raw = firstDecl(BRIDGE, name);
    expect(raw, `thiếu ${name}`).not.toBeNull();
    const rgb = parseColor(resolveColor(raw!)).rgb;
    expect(ratio(rgb, surface)).toBeGreaterThanOrEqual(3);
    expect(ratio(rgb, canvas)).toBeGreaterThanOrEqual(3);
  });
});

describe('chữ trắng trên ô gradient nhãn ở Hành trình nguyên liệu đạt 4,5:1 (D8-1)', () => {
  const ids = [...BRAND.matchAll(/--color-brand-([a-z0-9]+)-from:/g)].map((m) => m[1]!);
  const scrimRaw = firstDecl(BRAND, '--color-brand-tile-scrim');
  const scrim = scrimRaw ? parseColor(scrimRaw) : { rgb: [0, 0, 0] as [number, number, number], alpha: 0 };
  const white: [number, number, number] = [255, 255, 255];

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
