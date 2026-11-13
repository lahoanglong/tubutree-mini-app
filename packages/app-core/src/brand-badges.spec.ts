import { describe, expect, it } from 'vitest';
import { BADGE_VIEWBOX, BRAND_BADGES, badgeBackground, badgeColor, drawBadge } from './brand-badges';
import { BRAND_ORIGINS } from './brand-origins';

describe('huy hiệu minh hoạ riêng cho 8 nhãn', () => {
  it('đủ 8 nhãn, mỗi nhãn một bộ hình khác nhau, khung 48 x 48', () => {
    expect(BADGE_VIEWBOX).toBe('0 0 48 48');
    expect(Object.keys(BRAND_BADGES).sort()).toEqual(BRAND_ORIGINS.map((o) => o.id).sort());
    const signatures = new Set<string>();
    for (const o of BRAND_ORIGINS) {
      const shapes = BRAND_BADGES[o.id]!;
      expect(shapes.length, o.id).toBeGreaterThanOrEqual(4);
      signatures.add(shapes.map((s) => s.d).join('|'));
    }
    expect(signatures.size).toBe(8);
  });

  it('đường vẽ chỉ gồm lệnh SVG hợp lệ và số', () => {
    for (const o of BRAND_ORIGINS) for (const s of BRAND_BADGES[o.id]!) expect(s.d, o.id).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/);
  });

  it('màu chỉ qua token nhãn --color-brand-<id> và color-mix với nền thẻ hoặc chữ, không hex, không primitive', () => {
    for (const o of BRAND_ORIGINS) {
      const colors = [badgeBackground(o.id), ...drawBadge(o.id).flatMap((s) => [s.fill, s.stroke])].filter((c) => c !== 'none');
      expect(colors.length).toBeGreaterThan(4);
      for (const c of colors) {
        expect(c, `${o.id}: ${c}`).not.toMatch(/#[0-9a-f]{3,8}|\brgba?\(|\bhsla?\(|--stone-|--forest-|--sage-/i);
        expect(c, `${o.id}: ${c}`).toContain(`--color-brand-${o.id}`);
        if (c.startsWith('color-mix')) expect(c).toMatch(/var\(--color-bg-surface\)|var\(--color-text-primary\)/);
      }
    }
  });

  it('bốn tông: tông gốc là chính token nhãn, các tông khác pha từ nó', () => {
    expect(badgeColor('polang', 'base')).toBe('var(--color-brand-polang)');
    expect(badgeColor('polang', 'wash')).toContain('color-mix(in srgb, var(--color-brand-polang) 16%');
    expect(badgeColor('polang', 'deep')).toContain('var(--color-text-primary)');
  });

  it('drawBadge: hình có nét thì có bề rộng nét; nhãn không có huy hiệu thì rỗng', () => {
    const shapes = drawBadge('visante');
    expect(shapes.some((s) => s.stroke !== 'none' && s.strokeWidth > 0)).toBe(true);
    expect(shapes.every((s) => s.fill !== 'none' || s.stroke !== 'none')).toBe(true);
    expect(drawBadge('khong-co')).toEqual([]);
  });
});
