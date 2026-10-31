import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

function loadRules(): CSSStyleRule[] {
  const style = document.createElement('style');
  style.textContent = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
  document.head.appendChild(style);
  return Array.from(style.sheet!.cssRules).filter((r): r is CSSStyleRule => 'selectorText' in r);
}

describe('css/tokens.css: phản hồi nhấn (polish PL-11)', () => {
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));
  const rule = (sel: string) => loadRules().find((r) => r.selectorText === sel);

  it('.tubu-press (nút, chip, icon): co 0,96, nhấn nhanh 80ms, thả chậm 180ms', () => {
    expect(rule('.tubu-press')!.style.getPropertyValue('transition')).toContain('var(--p-dur-release)');
    const active = rule('.tubu-press:active')!;
    expect(active.style.getPropertyValue('transform')).toBe('scale(0.96)');
    expect(active.style.getPropertyValue('transition-duration')).toBe('var(--p-dur-press)');
  });

  it('.tubu-press-card (thẻ): co 0,985 cùng nhịp', () => {
    expect(rule('.tubu-press-card')!.style.getPropertyValue('transition')).toContain('var(--p-dur-release)');
    const active = rule('.tubu-press-card:active')!;
    expect(active.style.getPropertyValue('transform')).toBe('scale(0.985)');
    expect(active.style.getPropertyValue('transition-duration')).toBe('var(--p-dur-press)');
  });

  it('.tubu-btn:active (nút DS): co 0,97', () => {
    expect(rule('.tubu-btn:active')!.style.getPropertyValue('transform')).toBe('scale(0.97)');
  });

  it('không luật :active nào đổi opacity (ảnh mờ 10% làm thẻ nhũn)', () => {
    const offenders = loadRules().filter((r) => /:active/.test(r.selectorText) && r.style.getPropertyValue('opacity') !== '');
    expect(offenders.map((r) => r.selectorText)).toEqual([]);
  });

  it('có biến tên ngắn --dur-press/--dur-release/--ease-spring trỏ token gốc', () => {
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    expect(css).toMatch(/--dur-press:\s*var\(--p-dur-press\)/);
    expect(css).toMatch(/--dur-release:\s*var\(--p-dur-release\)/);
    expect(css).toMatch(/--ease-spring:\s*var\(--p-ease-spring\)/);
  });
});
