import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('.', import.meta.url));

function importsOf(file: string): string[] {
  const src = readFileSync(join(DIR, file), 'utf8');
  return [...src.matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]!);
}

// Mini App nạp thẳng Trang chủ và i18n/vi.ts, nên home-layout.ts và game-newbie.ts nằm trong gói đầu. Module chỉ trang con dùng
// mà bị hai file này import sẽ kéo cả khối theo vào gói đầu (entry đã từng tăng 1 KB vì lỗi này).
describe('module của gói đầu Mini App không kéo module của trang con', () => {
  const LAZY_ONLY = ['./loyalty-tier-copy', './member-card-grace', './game-mission-paths', './profile-sections'];
  for (const file of ['home-layout.ts', 'game-newbie.ts', 'features.ts']) {
    it(`${file} không import ${LAZY_ONLY.join(', ')}`, () => {
      const imports = importsOf(file);
      for (const lazy of LAZY_ONLY) expect(imports).not.toContain(lazy);
    });
  }
  // Thẻ thành viên Trang chủ không vẽ dòng giữ hạng; logic giữ hạng ở `member-card-grace` (chỉ trang Ưu đãi nạp lazy dùng).
  it('home-layout.ts không chứa logic giữ hạng', () => {
    expect(readFileSync(join(DIR, 'home-layout.ts'), 'utf8')).not.toMatch(/tierGrace/);
  });
  it('bộ lọc đọc đúng import (home-layout có import loyalty-copy)', () => {
    expect(importsOf('home-layout.ts')).toContain('./loyalty-copy');
  });
});
