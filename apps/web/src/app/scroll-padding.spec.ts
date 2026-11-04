import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('globals.css: scroll-padding cho thanh dính (a11y A7, WCAG 2.4.11)', () => {
  it('máy tính: chỉ chừa dưới thanh đầu (không có thanh đáy)', () => {
    const m = /(?:^|\})\s*html\s*\{([^}]*)\}/.exec(css);
    expect(m, 'thiếu luật html {} ngoài @media').not.toBeNull();
    expect(m![1]).toMatch(/scroll-padding-top:\s*calc\(var\(--header-h\) \+ 16px\)/);
    expect(m![1]).toMatch(/scroll-padding-bottom:\s*16px/);
  });

  it('điện thoại: chừa đầu 64px + chiều cao thanh đầu, đáy 72px + vùng an toàn', () => {
    const m = /@media \(max-width: 767\.98px\)\s*\{\s*html\s*\{([^}]*)\}\s*\}/.exec(css);
    expect(m, 'thiếu @media (max-width: 767.98px) { html {…} }').not.toBeNull();
    expect(m![1]).toMatch(/scroll-padding-top:\s*calc\(var\(--header-h\) \+ 64px\)/);
    expect(m![1]).toMatch(/scroll-padding-bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  });
});

describe('globals.css: scroll-padding theo chiều cao thanh dính đã đo (A11Y-04)', () => {
  it('điện thoại có thanh dính: --sticky-bar-h + 16px', () => {
    const m = /@media \(max-width: 767\.98px\)\s*\{\s*html:has\(body\.has-sticky-bar\)\s*\{([^}]*)\}\s*\}/.exec(css);
    expect(m, 'thiếu html:has(body.has-sticky-bar)').not.toBeNull();
    expect(m![1]).toMatch(/scroll-padding-bottom:\s*calc\(var\(--sticky-bar-h\) \+ 16px\)/);
  });

  it('768–1023 có thanh dính (giỏ, thanh toán): cùng công thức', () => {
    const m = /@media \(min-width: 768px\) and \(max-width: 1023\.98px\)\s*\{\s*html:has\(body\.has-sticky-bar-lg\)\s*\{([^}]*)\}\s*\}/.exec(css);
    expect(m, 'thiếu html:has(body.has-sticky-bar-lg)').not.toBeNull();
    expect(m![1]).toMatch(/scroll-padding-bottom:\s*calc\(var\(--sticky-bar-h\) \+ 16px\)/);
  });

  it('focus trên nền tối đổi sang vòng trắng (A11Y-01)', () => {
    expect(css).toMatch(/\[data-surface='inverse'\] :focus-visible\s*\{\s*outline-color:\s*var\(--color-text-inverse\)/);
  });
});
