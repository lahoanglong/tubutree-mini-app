// packages/design-tokens/src/tailwind-preset.spec.ts
import { describe, it, expect } from 'vitest';
import { tailwindPreset } from './tailwind-preset';

describe('design-tokens/tailwind-preset', () => {
  const ext = (tailwindPreset.theme?.extend ?? {}) as Record<string, unknown>;

  it('does NOT re-key Tailwind spacing (final review C2: p-4 became 12px across apps/web)', () => {
    expect(tailwindPreset.theme).not.toHaveProperty('spacing');
    expect(ext).not.toHaveProperty('spacing');
  });

  it('does not override any stock borderRadius key (sm/md/lg/xl/2xl/3xl/full stay app-controlled)', () => {
    const radius = (ext.borderRadius ?? {}) as Record<string, string>;
    for (const stock of ['none', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl', 'full']) {
      expect(radius).not.toHaveProperty(stock);
    }
    expect(radius).toMatchObject({ control: '12px', card: '16px', media: '12px', sheet: '24px' });
  });

  it('exposes the forest action scale', () => {
    const colors = ext.colors as Record<string, Record<string, string>>;
    expect(colors.forest?.[600]).toBe('#245E3E');
  });
});
