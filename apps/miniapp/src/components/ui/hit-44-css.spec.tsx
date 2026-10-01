import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * `.tubu-hit-44` sống trong tokens.css. Dấu đóng chú thích CSS lạc trong một chú thích sẽ đóng
 * chú thích sớm và âm thầm làm rơi quy tắc kế tiếp — nên nạp CSS thật vào jsdom và đọc CSSOM
 * chứ không chỉ grep chuỗi.
 */
function loadRules(): CSSStyleRule[] {
  const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const rules: CSSStyleRule[] = [];
  for (const sheetRule of Array.from(style.sheet!.cssRules)) {
    if ('selectorText' in sheetRule) rules.push(sheetRule as CSSStyleRule);
  }
  return rules;
}

describe('tokens.css .tubu-hit-44', () => {
  afterEach(() => {
    document.head.querySelectorAll('style').forEach((s) => s.remove());
  });

  it('có quy tắc gốc position:relative và ::after cao 44px, căn giữa dọc', () => {
    const rules = loadRules();
    const base = rules.find((r) => r.selectorText === '.tubu-hit-44');
    const after = rules.find((r) => r.selectorText === '.tubu-hit-44::after');
    expect(base?.style.position).toBe('relative');
    expect(after).toBeDefined();
    expect(after!.style.position).toBe('absolute');
    expect(after!.style.height).toBe('44px');
    expect(after!.style.top).toBe('50%');
    expect(after!.style.transform).toBe('translateY(-50%)');
    expect(after!.style.left).toBe('0px');
    expect(after!.style.right).toBe('0px');
  });

  it('quy tắc .touch-target đứng ngay trước vẫn còn nguyên (không bị chú thích nuốt)', () => {
    const rules = loadRules();
    const touch = rules.find((r) => r.selectorText === '.touch-target');
    expect(touch?.style.minHeight).toBe('44px');
  });
});
