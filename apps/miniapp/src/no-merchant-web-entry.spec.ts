import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Q-19 (C-096): cổng web /merchant chỉ xem và trùng gian hàng trên miniapp, nên miniapp không dẫn khách sang đó
 * (không navigate, không openWebview, không chữ mời "Kênh Đối Tác"). Đối tác vào bằng URL trực tiếp.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
const sources = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.spec\./.test(f))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

const offenders = (re: RegExp) => sources.filter((s) => re.test(s.text)).map((s) => s.file);

describe('miniapp không dẫn sang cổng web /merchant (C-096, Q-19)', () => {
  it('quét được mã nguồn miniapp', () => {
    expect(sources.map((s) => s.file)).toContain('pages/settings.tsx');
  });

  it('không có chuỗi đường dẫn "/merchant" (route hay URL web); "/cashback/merchants" là API khác nên không bị tính', () => {
    expect(offenders(/['"`/]merchant(?![\w-])/)).toEqual([]);
  });

  it('không có chữ mời "Kênh Đối Tác" / "Cổng đối tác"', () => {
    expect(offenders(/Kênh Đối Tác|Cổng đối tác/iu)).toEqual([]);
  });
});
