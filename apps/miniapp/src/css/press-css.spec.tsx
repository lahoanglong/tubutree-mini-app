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

  it('.tubu-press (nút, chip, icon): co 0,97 như .tubu-btn (chip và nút DS cùng một cảm giác nhấn), nhấn nhanh 80ms, thả chậm 180ms', () => {
    expect(rule('.tubu-press')!.style.getPropertyValue('transition')).toContain('var(--p-dur-release)');
    const active = rule('.tubu-press:active')!;
    expect(active.style.getPropertyValue('transform')).toBe('scale(0.97)');
    expect(active.style.getPropertyValue('transition-duration')).toBe('var(--p-dur-press)');
  });

  it('.tubu-press-card (thẻ): co 0,985 cùng nhịp', () => {
    expect(rule('.tubu-press-card')!.style.getPropertyValue('transition')).toContain('var(--p-dur-release)');
    const active = rule('.tubu-press-card:active')!;
    expect(active.style.getPropertyValue('transform')).toBe('scale(0.985)');
    expect(active.style.getPropertyValue('transition-duration')).toBe('var(--p-dur-press)');
  });

  it('.tubu-points-earn (dòng Điểm Xanh PDP): đệm trên bằng đúng phần lề âm dôi lên, chữ xuống hai dòng không đè dòng giá', () => {
    const row = rule('.tubu-points-earn')!;
    expect(row.style.getPropertyValue('margin-top')).toBe('-20px');
    expect(row.style.getPropertyValue('padding-top')).toBe('20px');
    expect(row.style.getPropertyValue('box-sizing')).toBe('border-box');
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

  it('có biến --ease-drawer trỏ token gốc (đường cong tấm đáy dùng chung với web)', () => {
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    expect(css).toMatch(/--ease-drawer:\s*var\(--p-ease-drawer\)/);
  });

  it('giảm chuyển động: nút DS và phần tử bấm được không co khi nhấn (luật * chỉ rút thời gian, nút vẫn co tức thì)', () => {
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    for (const sel of ['.tubu-btn:active', '.tubu-press:active', '.tubu-press-card:active']) {
      expect(reduced, sel).toMatch(new RegExp(`${sel.replace(/[.:]/g, '\\$&')}[^{]*\\{[^}]*transform:\\s*none`));
    }
  });

  it('mọi luật :active co theo scale đều nằm trong 0,97..0,99 (không co sâu hơn nút DS)', () => {
    const scales = loadRules()
      .filter((r) => /:active/.test(r.selectorText) && /scale\(/.test(r.style.getPropertyValue('transform')))
      .map((r) => [r.selectorText, Number(/scale\(([\d.]+)\)/.exec(r.style.getPropertyValue('transform'))![1])] as const);
    expect(scales.length).toBeGreaterThan(0);
    expect(scales.filter(([, v]) => v < 0.97 || v > 0.99)).toEqual([]);
  });
});

describe('css/tokens.css: icon nảy khi chọn tab (polish PL-10)', () => {
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));

  it('có @keyframes tubu-tab-pop từ scale .88 về 1 và lớp .tubu-tab-pop 220ms easing spring', () => {
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    expect(css).toMatch(/@keyframes tubu-tab-pop\s*\{[^}]*0%\s*\{[^}]*scale\(0\.88\)[^}]*\}[^}]*100%\s*\{[^}]*scale\(1\)/);
    const rule = loadRules().find((r) => r.selectorText === '.tubu-tab-pop');
    expect(rule, 'thiếu .tubu-tab-pop').toBeDefined();
    const animation = rule!.style.getPropertyValue('animation');
    expect(animation).toContain('tubu-tab-pop');
    expect(animation).toContain('220ms');
    expect(animation).toContain('var(--p-ease-spring)');
  });

  it('khách bật giảm chuyển động: quy tắc chung đưa animation-duration về 0,01ms (phủ cả .tubu-tab-pop)', () => {
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration:\s*0\.01ms/);
  });

  it('giảm chuyển động: quy tắc chung cũng đưa transition-duration về 0,01ms (phủ nhả nút và thẻ ép)', () => {
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition-duration:\s*0\.01ms/);
  });
});
