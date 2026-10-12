import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Số/ngày hiển thị cho khách đi qua utils/format (formatNumber/formatVnd/formatPoints/
 * formatDrops/formatDate/formatDateTime). Gọi toLocaleString trực tiếp trong pages/i18n là cách số
 * "1250000" và "1.250.000" cùng xuất hiện trên một màn (C-083); ngày thì đổi dáng theo ICU của webview.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
const files = (sub: string) =>
  walk(join(SRC, sub))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.spec\./.test(f))
    .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

describe('không gọi toLocaleString trực tiếp ở pages / i18n', () => {
  it('pages và i18n dùng helper chung', () => {
    const bad = [...files('pages'), ...files('i18n')].filter((s) => /\.toLocaleString\(/.test(s.text)).map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it('các trang Điểm Xanh / Game / Chi tiết đơn không gọi toLocaleDateString', () => {
    const bad = files('pages')
      .filter((s) => /^pages\/(loyalty|game|order-detail|not-found)/.test(s.file))
      .filter((s) => /\.toLocale(Date|Time)?String\(/.test(s.text))
      .map((s) => s.file);
    expect(bad).toEqual([]);
  });
});

// toLocale*String('vi-VN') phụ thuộc ICU của webview: Node 24 / WebView mới in "15-10" thay vì "15/10", nên cùng một ngày
// hiện hai dáng. Ngày đi qua formatDate/formatDateTime, số qua formatNumber (utils/format.ts là nơi duy nhất gọi toLocale*).
describe('không gọi toLocale(Date|Time)String / toLocaleString trực tiếp ở bất kỳ đâu trong src', () => {
  it('chỉ utils/format.ts (formatNumber) được gọi toLocaleString; mọi chỗ khác dùng helper', () => {
    const bad = files('')
      .filter((s) => s.file !== 'utils/format.ts')
      .filter((s) => /\.toLocale(Date|Time)?String\(/.test(s.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
      .map((s) => s.file);
    expect(bad).toEqual([]);
  });
});
