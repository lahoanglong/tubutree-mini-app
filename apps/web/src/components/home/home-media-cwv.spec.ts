import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Rào CWV cho ảnh của Trang chủ web (LCP và CLS). Quét mã nguồn, không dựng trang: mọi thẻ `<img>` của các khối Trang chủ, của băng chuyền banner và
 * của ảnh sản phẩm dùng chung phải
 *   - khai `width` và `height` (khung có cỡ trước khi ảnh và CSS về, CLS ≈ 0);
 *   - `decoding="async"` (giải mã ảnh không chặn luồng chính lúc cuộn qua các kệ dưới màn đầu);
 *   - có `loading`, và `fetchPriority` chỉ đi cùng nhánh tải ngay (ảnh LCP), không bao giờ đứng một mình trên ảnh lười.
 * Khối dưới màn đầu (dải Câu chuyện, lưới Gợi ý) dựng qua `DeferUntilNear` để HTML `/` không phình (trần 215.000 B ở scripts/ci/web-budget.json).
 */
const HERE = __dirname;
const MINI = join(HERE, '../mini');

const sources = [
  ...readdirSync(HERE)
    .filter((f) => f.endsWith('.tsx') && !f.includes('.spec.'))
    .map((f) => join(HERE, f)),
  join(MINI, 'banner-carousel.tsx'),
  join(MINI, 'product-image.tsx'),
];

/** Cắt từng phần tử JSX `<img ... />` (đếm ngoặc nhọn để không dừng ở `/>` hay `>` nằm trong biểu thức). */
function imgTags(src: string): string[] {
  const out: string[] = [];
  const re = /<img[\s\n]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + 4;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (depth === 0 && ch === '/' && src[i + 1] === '>') break;
    }
    out.push(src.slice(m.index, i + 2));
  }
  return out;
}

const tags = sources.flatMap((file) => imgTags(readFileSync(file, 'utf8')).map((tag) => ({ file: file.split('/components/')[1]!, tag })));

describe('Trang chủ web: ảnh không gây nhảy trang và không giành băng thông của ảnh LCP', () => {
  it('quét được ảnh của các khối (không xanh vì không tìm thấy gì)', () => {
    expect(tags.length).toBeGreaterThanOrEqual(4);
    expect(tags.some((t) => t.file.endsWith('banner-carousel.tsx'))).toBe(true);
    expect(tags.some((t) => t.file.endsWith('category-row.tsx'))).toBe(true);
  });

  it.each(tags.map((t) => [t.file, t.tag] as const))('%s: có width, height, decoding="async" và loading', (_file, tag) => {
    expect(tag).toMatch(/\swidth=\{/);
    expect(tag).toMatch(/\sheight=\{/);
    expect(tag).toMatch(/\sdecoding="async"/);
    expect(tag).toMatch(/\sloading=/);
  });

  it.each(tags.map((t) => [t.file, t.tag] as const))('%s: fetchPriority chỉ đi cùng nhánh tải ngay', (_file, tag) => {
    const fp = /\sfetchPriority=\{([^}]*)\}/.exec(tag);
    if (!fp) return;
    const lazy = /\sloading=\{([^}]*)\}/.exec(tag);
    expect(lazy, 'fetchPriority mà loading cố định "lazy"').not.toBeNull();
    // Cùng một điều kiện quyết cả hai: `eager ? 'eager' : 'lazy'` đi với `eager ? 'high' : undefined`.
    const cond = (expr: string) => expr.split('?')[0]!.trim();
    expect(cond(fp[1]!)).toBe(cond(lazy![1]!));
    expect(fp[1]).toMatch(/'high'/);
  });

  it('không thẻ ảnh nào của Trang chủ để loading="eager" cố định (chỉ ảnh LCP được tải ngay, quyết bằng điều kiện)', () => {
    for (const { tag } of tags) expect(tag).not.toMatch(/\sloading="eager"/);
  });

  it('khối dưới màn đầu (dải Câu chuyện, lưới Gợi ý) dựng qua DeferUntilNear, không vào HTML đầu', () => {
    const view = readFileSync(join(HERE, 'home-view-client.tsx'), 'utf8');
    const block = (name: string) => {
      const start = view.indexOf(`    ${name}:`);
      expect(start, `khối ${name}`).toBeGreaterThan(-1);
      const next = view.slice(start + 1).search(/\n {4}[a-zA-Z]+:/);
      return view.slice(start, next === -1 ? undefined : start + 1 + next);
    };
    expect(block('suggest')).toContain('<DeferUntilNear');
    expect(block('stories')).toContain('<DeferUntilNear');
  });
});
