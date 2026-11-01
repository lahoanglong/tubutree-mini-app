import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * G6 (P2 #25, #26, #27): ba chỗ nút Mini lệch web. Nút chữ (ghost → ZaUI tertiary) không còn rộng tối thiểu 120px của `.zaui-btn`;
 * icon trong nút căn giữa dọc và cách chữ 8px; nút phụ đang tắt dùng cặp token đọc được thay cặp của nút chính.
 */
describe('tokens.css: nút Mini', () => {
  const css = readFileSync(join(process.cwd(), 'src/css/tokens.css'), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  it('nút chữ không có rộng tối thiểu', () => {
    expect(rule('.tubu-btn.zaui-btn-tertiary')).toMatch(/min-width:\s*0/);
  });
  it('icon căn giữa dọc, cách chữ 8px', () => {
    const r = rule('.tubu-btn .zaui-btn-icon');
    expect(r).toMatch(/align-items:\s*center/);
    expect(r).toMatch(/margin-right:\s*8px/);
  });
  it('nút phụ đang tắt dùng token secondary-disabled', () => {
    const r = rule('.tubu-btn.zaui-btn.zaui-btn-secondary[disabled]');
    expect(r).toContain('var(--color-action-secondary-bg-disabled)');
    expect(r).toContain('var(--color-action-secondary-fg-disabled)');
  });
  it('có lớp chiều cao 44', () => {
    expect(rule('.tubu-btn.tubu-btn-44')).toMatch(/height:\s*44px/);
  });
});
