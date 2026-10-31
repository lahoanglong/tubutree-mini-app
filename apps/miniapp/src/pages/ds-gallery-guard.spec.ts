import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../components/app.tsx'), 'utf8');

describe('ds-gallery chỉ có ở bản dev (app.tsx)', () => {
  it('mọi import() tới pages/ds-gallery nằm sau điều kiện import.meta.env.DEV', () => {
    const lines = src.split('\n');
    const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => /import\([^)]*pages\/ds-gallery/.test(l));
    expect(hits.length).toBeGreaterThan(0);
    for (const { l } of hits) expect(l).toMatch(/import\.meta\.env\.DEV\s*\?/);
  });

  it('Route /ds-gallery nằm ngay sau import.meta.env.DEV &&', () => {
    const m = src.match(/(.{0,60})<Route path="\/ds-gallery"/s);
    expect(m, 'không thấy Route /ds-gallery').not.toBeNull();
    expect(m![1]).toMatch(/import\.meta\.env\.DEV\s*&&\s*$/);
  });

  it('không có import tĩnh tới pages/ds-gallery (sẽ vào bundle entry)', () => {
    expect(src).not.toMatch(/^import .* from '..\/pages\/ds-gallery'/m);
  });
});
