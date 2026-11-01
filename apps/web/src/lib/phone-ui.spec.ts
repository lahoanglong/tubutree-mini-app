import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { phoneSecondary } from './phone-ui';

const miniCss = readFileSync(join(__dirname, '../components/mini/mini.css'), 'utf8');
const rule = (selector: string) => {
  const at = miniCss.indexOf(`${selector} {`);
  return at < 0 ? '' : miniCss.slice(miniCss.indexOf('{', at) + 1, miniCss.indexOf('}', at));
};

describe('phoneSecondary (G6 #25)', () => {
  it('mang lớp tubu-phone-secondary để nút phụ đang tắt đổi sang cặp token chung với Mini, không thêm max-md:', () => {
    expect(phoneSecondary.split(' ')).toContain('tubu-phone-secondary');
  });

  it('mini.css: nút phụ đang tắt dùng cặp token secondary-disabled (khoảng ngoặc media điện thoại)', () => {
    const r = rule('  .tubu-phone-secondary.tubu-phone-secondary:disabled');
    expect(r).toContain('var(--color-action-secondary-bg-disabled)');
    expect(r).toContain('var(--color-action-secondary-fg-disabled)');
  });
});

describe('mini.css khớp luật nút của Mini (G6 #25 #26 #27)', () => {
  it('nút chữ không có rộng tối thiểu', () => {
    expect(rule('.tubu-btn.zaui-btn-tertiary')).toMatch(/min-width:\s*0/);
  });
  it('icon trong nút: khung ôm sát icon, cách chữ 8px', () => {
    const r = rule('.tubu-btn .zaui-btn-icon');
    expect(r).toMatch(/width:\s*auto/);
    expect(r).toMatch(/margin-right:\s*8px/);
  });
  it('nút phụ Button đang tắt dùng token secondary-disabled', () => {
    const r = rule('.tubu-btn.zaui-btn.zaui-btn-secondary[disabled]');
    expect(r).toContain('var(--color-action-secondary-bg-disabled)');
  });
});
