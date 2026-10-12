import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * C-069: `components/ui/primitives.tsx` (Txt, Stack, Row, Btn) không còn file nào import, chỉ có spec của chính nó,
 * và dùng toàn alias legacy `--neutral-*`/`--primary-*`. Đã xoá; component dùng chung nằm ở các file DS v2 cùng thư mục.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
const sources = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

describe('components/ui/primitives đã xoá (C-069)', () => {
  it('không còn file primitives.tsx và spec của nó', () => {
    expect(existsSync(join(SRC, 'components/ui/primitives.tsx'))).toBe(false);
    expect(existsSync(join(SRC, 'components/ui/primitives.spec.tsx'))).toBe(false);
  });

  it('không file nào import từ ".../primitives" (kể cả import động và vi.mock)', () => {
    const importers = sources
      .filter((s) => s.file !== 'components/ui/primitives-removed.spec.ts' && /(?:from|import\(|mock\()\s*['"][^'"]*\/primitives['"]/.test(s.text))
      .map((s) => s.file);
    expect(importers).toEqual([]);
  });
});
