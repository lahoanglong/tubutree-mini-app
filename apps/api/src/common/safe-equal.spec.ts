import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { safeEqualStrings } from './safe-equal';

describe('safeEqualStrings', () => {
  it('đúng khi hai chuỗi giống nhau', () => expect(safeEqualStrings('abc-123', 'abc-123')).toBe(true));
  it('sai khi cùng độ dài nhưng khác nội dung', () => expect(safeEqualStrings('abc-123', 'abc-124')).toBe(false));
  it('sai khi khác độ dài, không ném', () => {
    expect(safeEqualStrings('abc', 'abcdef')).toBe(false);
    expect(safeEqualStrings('abcdef', 'abc')).toBe(false);
  });
  it('rỗng: không bao giờ khớp, kể cả hai chuỗi rỗng', () => {
    expect(safeEqualStrings('', 'abc')).toBe(false);
    expect(safeEqualStrings('abc', '')).toBe(false);
    expect(safeEqualStrings('', '')).toBe(false);
  });
});

describe('so token hằng thời gian', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
    }
    return out;
  }

  it('src/ không còn mẫu length === ... && timingSafeEqual (lộ độ dài secret)', () => {
    const bad = walk(join(__dirname, '..')).filter((f) => /length\s*===\s*[^\n]*&&\s*timingSafeEqual/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
