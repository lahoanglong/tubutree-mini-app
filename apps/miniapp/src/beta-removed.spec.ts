import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Q-19 (C-118): chương trình Beta Tester không có tác dụng và góp ý không ai đọc, nên trang /beta bị xoá khỏi miniapp
 * và 4 route `/beta/*` của API cũng đã gỡ (PD-2). Miniapp không được có lại client, route hay lối vào nào.
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

describe('miniapp không còn trang Beta Tester (C-118, Q-19)', () => {
  it('đã xoá trang và client API của /beta', () => {
    expect(existsSync(join(SRC, 'pages/beta.tsx'))).toBe(false);
    expect(existsSync(join(SRC, 'services/beta-api.ts'))).toBe(false);
  });

  it('không route nào đăng ký /beta và không file nào import trang hay client beta', () => {
    expect(offenders(/path=["']\/beta["']|pages\/beta['"]|\bbeta-api['"]/)).toEqual([]);
  });

  it('không nơi nào điều hướng tới /beta hay gọi endpoint /beta/*', () => {
    expect(offenders(/['"`]\/beta(?![\w-])/)).toEqual([]);
  });

  it('không còn chữ hướng khách "Beta Tester"', () => {
    expect(offenders(/Beta Tester/i)).toEqual([]);
  });
});
