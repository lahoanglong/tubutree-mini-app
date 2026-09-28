// packages/design-tokens/src/tokens.spec.ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf-8');

describe('design-tokens/tokens.css', () => {
  it('defines the forest primitive scale used as the primary action color', () => {
    expect(css).toMatch(/--forest-600:\s*#245E3E/i);
    expect(css).toMatch(/--forest-700:\s*#1B4B31/i);
    expect(css).toMatch(/--forest-800:\s*#143A26/i);
    expect(css).toMatch(/--forest-900:\s*#0D291B/i);
  });

  it('defines semantic color.action.primary tokens pointing at forest-600/700', () => {
    expect(css).toMatch(/--color-action-primary-bg:\s*var\(--forest-600\)/);
    expect(css).toMatch(/--color-action-primary-bg-pressed:\s*var\(--forest-700\)/);
    expect(css).toMatch(/--color-action-primary-fg:\s*var\(--stone-0\)/);
  });

  it('defines the warm stone neutral scale (replaces old cool neutral-*)', () => {
    expect(css).toMatch(/--stone-50:\s*#F6F4EF/i);
    expect(css).toMatch(/--stone-500:\s*#746D61/i);
  });

  it('does not define the old --primary-* (orange) scale as a UI color — only as tubu-orange for logo use', () => {
    expect(css).not.toMatch(/--primary-600/);
    expect(css).toMatch(/--tubu-orange:\s*#E08C1C/i);
  });

  it('keeps a dealer theme override block scoped to [data-theme="dealer"], touching only semantic layer', () => {
    expect(css).toMatch(/\[data-theme=['"]dealer['"]\]\s*\{/);
  });
});
