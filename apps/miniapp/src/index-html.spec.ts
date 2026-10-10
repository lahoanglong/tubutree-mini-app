import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1] ?? '';

// C-075 (A4-004, Q-28): WCAG 1.4.4 needs pinch-zoom; older and low-vision customers rely on it.
describe('index.html viewport', () => {
  it('has a viewport meta', () => {
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1.0');
  });

  it('keeps edge-to-edge layout under the notch', () => {
    expect(viewport).toContain('viewport-fit=cover');
  });

  it('does not block pinch-zoom (no user-scalable=no, no maximum-scale cap)', () => {
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
    expect(viewport).not.toMatch(/maximum-scale/i);
  });

  it('still suppresses the double-tap zoom delay so rapid taps (watering, quantity steppers) do not zoom', () => {
    expect(html).toMatch(/touch-action:\s*manipulation/);
  });

  // iOS WKWebView phóng to trang khi focus ô nhập có chữ < 16px và giữ nguyên mức phóng sau khi blur;
  // bỏ maximum-scale (ở trên) làm hiện tượng này lộ ra, nên phải bù bằng cỡ chữ 16px cho ô nhập trên iOS.
  it('ô nhập trên iOS có cỡ chữ >= 16px để focus không tự phóng to (inline style nên cần !important)', () => {
    const block = /@supports\s*\(\s*-webkit-touch-callout:\s*none\s*\)\s*\{([\s\S]*?\})\s*\}/.exec(html);
    expect(block).not.toBeNull();
    const rule = /([^{}]*)\{([^}]*)\}/.exec(block![1]);
    expect(rule![1]).toMatch(/input/);
    expect(rule![1]).toMatch(/textarea/);
    expect(rule![1]).toMatch(/select/);
    expect(rule![2]).toMatch(/font-size:\s*16px\s*!important/);
  });
});
