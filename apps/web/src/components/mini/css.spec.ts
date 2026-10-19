import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;
const read = (p: string) => readFileSync(p, 'utf8');
const sources = readdirSync(dir).filter((f) => /\.(tsx|ts)$/.test(f) && !/\.spec\./.test(f) && f !== 'harness.ts');
const css = read(join(dir, 'mini.css'));
const tokens = read(join(dir, '../../../../../packages/design-tokens/src/tokens.css'));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const defined = new Set([...strip(css + tokens).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

describe('mini.css', () => {
  it('mọi var(--x) dùng trong components/mini đều có định nghĩa (tokens.css hoặc mini.css)', () => {
    const missing: string[] = [];
    for (const f of sources) {
      for (const m of strip(read(join(dir, f))).matchAll(/var\((--[\w-]+)/g)) {
        // Tên dựng lúc chạy (var(--type-${v}-size), var(--color-brand-${id})) chỉ còn tiền tố cụt; bậc type-* kiểm riêng bên dưới.
        if (m[1]!.endsWith('-')) continue;
        if (!defined.has(m[1]!)) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('biến type-* dựng từ template (--type-${variant}-size) có đủ bậc trong tokens.css', () => {
    for (const v of ['body-lg', 'body-md', 'body-sm', 'caption', 'label', 'price-xl', 'price-lg', 'price-md', 'price-sm', 'display-lg', 'display-md', 'title-lg', 'title-md', 'title-sm']) {
      for (const k of ['size', 'lh', 'weight']) expect(defined.has(`--type-${v}-${k}`), `--type-${v}-${k}`).toBe(true);
    }
  });

  it('mọi class tubu-*/zaui-*/mini-*/scroll-x mà component gắn đều có luật CSS', () => {
    const used = new Set<string>();
    for (const f of sources) {
      for (const m of read(join(dir, f)).matchAll(/['"`]((?:tubu|zaui|mini)-[\w-]+|scroll-x)['"`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    // Lớp trạng thái/biến thể của zmp: chỉ cần luật cho lớp thật sự được tạo ở button.tsx; các lớp ghép tiền tố được kiểm riêng.
    expect(missing.filter((c) => !c.startsWith('zaui-btn-'))).toEqual([]);
  });

  it('các lớp zaui-btn-* mà Button có thể sinh đều có luật', () => {
    for (const c of ['primary', 'secondary', 'tertiary', 'disabled', 'loading', 'prefix-icon', 'full-width', 'loading-container', 'loading-icon', 'icon', 'container']) {
      expect(new RegExp(`\\.zaui-btn-${c}(?![\\w-])`).test(css), c).toBe(true);
    }
  });
});

describe('mini.css không đổi giao diện máy tính', () => {
  it('ẩn nút xoá native của ô tìm chỉ trong SearchField, không phải mọi [role=search]', () => {
    expect(css).not.toMatch(/\[role=['"]search['"]\][^{]*cancel-button/);
    expect(css).toMatch(/\.tubu-search-field input\[type='search'\]::-webkit-search-cancel-button/);
  });
});
