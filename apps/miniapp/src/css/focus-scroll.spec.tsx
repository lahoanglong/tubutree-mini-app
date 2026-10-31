import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** Nạp CSS thật vào jsdom và đọc CSSOM: chú thích hỏng hay selector sai sẽ làm rơi luật mà grep không thấy. */
function loadRules(): CSSStyleRule[] {
  const style = document.createElement('style');
  style.textContent = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
  document.head.appendChild(style);
  return Array.from(style.sheet!.cssRules).filter((r): r is CSSStyleRule => 'selectorText' in r);
}

describe('css/tokens.css: vòng focus và scroll-padding (a11y A4, A7)', () => {
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));

  it('nút DS (.zaui-btn) có vòng focus 2px màu --color-border-focus, offset 2px (ZaUI đặt outline:0)', () => {
    const rule = loadRules().find((r) => r.selectorText === '.zaui-btn:focus-visible');
    expect(rule, 'thiếu .zaui-btn:focus-visible').toBeDefined();
    expect(rule!.style.getPropertyValue('outline')).toMatch(/2px solid var\(--color-border-focus\)/);
    expect(rule!.style.getPropertyValue('outline-offset')).toBe('2px');
  });

  it('quy tắc :focus-visible chung cho tim, chip, nút tự vẽ, đứng trước luật riêng của thẻ (.tubu-tile-link)', () => {
    const rules = loadRules();
    const general = rules.findIndex((r) => r.selectorText.startsWith(':focus-visible'));
    const tile = rules.findIndex((r) => r.selectorText === '.tubu-tile-link:focus-visible');
    expect(general, 'thiếu :focus-visible chung').toBeGreaterThanOrEqual(0);
    expect(rules[general]!.style.getPropertyValue('outline')).toMatch(/2px solid var\(--color-border-focus\)/);
    expect(rules[general]!.style.getPropertyValue('outline-offset')).toBe('2px');
    expect(tile).toBeGreaterThan(general);
    expect(rules[tile]!.style.getPropertyValue('outline')).toMatch(/none/);
  });

  it('.zaui-page chừa chỗ cho thanh dính đầu (64px + vùng an toàn) và thanh đáy (72px + vùng an toàn)', () => {
    const rule = loadRules().find((r) => r.selectorText === '.zaui-page');
    expect(rule, 'thiếu .zaui-page').toBeDefined();
    expect(rule!.style.getPropertyValue('scroll-padding-top')).toBe('calc(var(--safe-top) + 64px)');
    expect(rule!.style.getPropertyValue('scroll-padding-bottom')).toBe('calc(72px + var(--safe-bottom))');
  });

  it('trang có StickyActionBar tăng phần chừa đáy lên 96px bằng lớp riêng', () => {
    const rule = loadRules().find((r) => r.selectorText === '.tubu-scroll-pad-sticky-bar');
    expect(rule, 'thiếu .tubu-scroll-pad-sticky-bar').toBeDefined();
    expect(rule!.style.getPropertyValue('scroll-padding-bottom')).toBe('calc(96px + var(--safe-bottom))');
  });

  it('ô nhập ZaUI focus không có vòng outline, nút vẫn có (tránh hai vòng viền)', () => {
    const style = document.createElement('style');
    style.textContent = `.zaui-input{outline:none}` + readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    document.head.appendChild(style);
    const input = document.createElement('input');
    input.className = 'zaui-input';
    const ta = document.createElement('textarea');
    const btn = document.createElement('button');
    document.body.append(input, ta, btn);
    const matchesFocusRing = (el: Element) => {
      const sel = (Array.from(style.sheet!.cssRules) as CSSStyleRule[]).find((r) => r.selectorText?.startsWith(':focus-visible'))!.selectorText;
      return el.matches(sel.replace(':focus-visible', ':scope'));
    };
    expect(matchesFocusRing(input)).toBe(false);
    expect(matchesFocusRing(ta)).toBe(false);
    expect(matchesFocusRing(btn)).toBe(true);
    document.body.replaceChildren();
  });
});
