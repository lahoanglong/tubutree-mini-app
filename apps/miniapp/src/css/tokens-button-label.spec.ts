import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nhãn Button có overflow:hidden (để rút gọn "…") nên cắt ~1,3px đỉnh chữ hoa hai dấu ("Ẩ", "Ấ",
 * "Ổ") — follow-up của dự án 3. Đệm 3px trên/dưới rồi bù margin âm: khung chữ đủ cao cho dấu mà
 * chiều cao nút không đổi.
 */
describe('tokens.css — nhãn .tubu-btn không cắt dấu tiếng Việt', () => {
  const css = readFileSync(join(process.cwd(), 'src/css/tokens.css'), 'utf8');
  const rule = /\.tubu-btn \.zaui-btn-container > span:not\(\.zaui-btn-icon\):not\(\.zaui-btn-loading-container\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('rule nhãn tồn tại', () => {
    expect(rule).toContain('overflow: hidden');
  });
  it('có padding-block: 3px và margin-block: -3px', () => {
    expect(rule).toMatch(/padding-block:\s*3px/);
    expect(rule).toMatch(/margin-block:\s*-3px/);
  });
});
