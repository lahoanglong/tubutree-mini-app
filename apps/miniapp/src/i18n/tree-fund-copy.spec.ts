import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * C-010 (Q-16): Tubu góp vào quỹ trồng cây, KHÔNG hứa trồng một cây thật cụ thể và không nêu đối tác
 * (PanNature) như cam kết đã có hợp đồng. Quét mã nguồn để câu chữ cũ không quay lại ở màn nào.
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

describe('quỹ trồng cây (C-010, Q-16) — không hứa cây thật', () => {
  it('không còn "cây thật" (kể cả "Mua cây thật", "cây THẬT", "🌳 thật")', () => {
    expect(offenders(/cây\s+thật|🌳\s*thật/iu)).toEqual([]);
  });

  it('không nêu PanNature hay chương trình "Rừng Xanh Lên"', () => {
    expect(offenders(/PanNature|Rừng Xanh Lên/iu)).toEqual([]);
  });

  it('không còn nói "mua cây" (cây được góp vào quỹ, không phải hàng để mua)', () => {
    expect(offenders(/\bmua (1 )?cây\b(?! (?:cảnh|giống))/iu)).toEqual([]);
  });

  it('không hứa "chứng nhận" cho từng cây', () => {
    expect(offenders(/Mã chứng nhận|Khu rừng của tôi — chứng nhận/u)).toEqual([]);
  });
});
