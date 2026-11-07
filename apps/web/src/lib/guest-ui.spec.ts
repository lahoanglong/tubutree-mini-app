import { describe, expect, it } from 'vitest';
import { ui } from './guest-ui';

describe('guest-ui: vùng chạm của nút chữ', () => {
  it('btnText rộng ít nhất 44px dù chữ ngắn ("Huỷ" đo 43px trên font Linux của CI)', () => {
    expect(ui.btnText).toContain('min-h-11');
    expect(ui.btnText).toContain('min-w-11');
  });
});

describe('guest-ui: phản hồi khi nhấn của nút', () => {
  it.each(['btnPrimary', 'btnSecondary', 'btnText'] as const)('%s co 0,97 khi nhấn, không co khi giảm chuyển động hay khi bị khoá (W41B)', (key) => {
    const cls = ui[key];
    expect(cls).toContain('active:scale-[0.97]');
    expect(cls).toContain('motion-reduce:active:scale-100');
    expect(cls).toContain('disabled:active:scale-100');
    expect(cls).toContain('aria-disabled:active:scale-100');
  });
});
