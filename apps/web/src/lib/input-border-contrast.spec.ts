import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { miniCheckbox, miniRadio } from '@/components/order-mobile/mobile-ui';
import { ui } from '@/lib/guest-ui';
import { firstDecl, parseColor, ratio, readText, resolveColor, tokenRgb } from '@/test-utils/contrast';

// D8-2 (zaui-bridge.css của Mini App): viền ô nhập, checkbox, radio và nền công tắc tắt phải đạt 3:1 (WCAG 1.4.11) với nền thẻ và canvas.
// Web không dùng zaui-bridge: ô nhập lấy viền từ `ui.field`, checkbox/radio từ mobile-ui, công tắc từ lớp `bg-stone-450`.
const TOKENS = readText(path.resolve(process.cwd(), '../../packages/design-tokens/src/tokens.css'));

describe('viền ô nhập, checkbox, radio và công tắc tắt dùng màu đủ 3:1', () => {
  const surface = tokenRgb('--color-bg-surface');
  const canvas = tokenRgb('--color-bg-canvas');

  it('--color-border-strong là stone-450 và đạt 3:1 trên nền thẻ lẫn canvas', () => {
    expect(firstDecl(TOKENS, '--color-border-strong')).toBe('var(--stone-450)');
    const rgb = parseColor(resolveColor('var(--color-border-strong)')).rgb;
    expect(ratio(rgb, surface)).toBeGreaterThanOrEqual(3);
    expect(ratio(rgb, canvas)).toBeGreaterThanOrEqual(3);
  });

  it('ô nhập, ô chọn, nút radio trỏ vào màu viền đậm đó, không dùng border-stone-200/300', () => {
    for (const cls of [ui.field, ui.btnSecondary]) expect(cls).toContain('border-stone-450');
    for (const cls of [miniCheckbox, miniRadio]) {
      expect(cls).toContain('max-md:border-[var(--color-border-strong)]');
      expect(cls).not.toMatch(/border-stone-(200|300)/);
    }
  });
});
