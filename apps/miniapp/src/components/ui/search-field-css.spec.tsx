import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Hai quy tắc của SearchField sống trong tokens.css (không thể viết bằng style nội tuyến):
 * ẩn nút "x" gốc của WebKit/Blink (trùng nút xoá của DS) và vòng focus của khung. Cùng kỹ thuật với
 * hit-44-css.spec: nạp CSS thật vào jsdom và đọc CSSOM — một chú thích CSS lạc sẽ âm thầm làm rơi quy tắc.
 */
function loadRules(): CSSStyleRule[] {
  const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return Array.from(style.sheet!.cssRules).filter((r): r is CSSStyleRule => 'selectorText' in r);
}

describe('tokens.css — ô tìm kiếm', () => {
  afterEach(() => {
    document.head.querySelectorAll('style').forEach((s) => s.remove());
  });

  it('ẩn nút xoá gốc của WebKit/Blink trong form tìm kiếm', () => {
    const rule = loadRules().find((r) => r.selectorText.includes('::-webkit-search-cancel-button'));
    expect(rule).toBeDefined();
    expect(rule!.selectorText).toContain('[role="search"]');
    expect(rule!.style.display).toBe('none');
    expect(rule!.style.getPropertyValue('-webkit-appearance')).toBe('none');
  });

  it('khung ô tìm có vòng focus khi ô nhập đang focus, dùng token màu', () => {
    const rule = loadRules().find((r) => r.selectorText === '.tubu-search-field:focus-within');
    expect(rule).toBeDefined();
    expect(rule!.style.boxShadow).toContain('var(--color-border-focus)');
  });
});
