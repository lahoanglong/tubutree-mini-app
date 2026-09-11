import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * zmp-ui Button gọi onClick kể cả khi `loading` đang bật — chỉ `disabled` mới chặn thật
 * (xem node_modules/zmp-ui/cjs/components/button/index.js: onClickHandler không xét loading,
 * còn thuộc tính disabled của <button> thì có). Nút chỉ có `loading` vì vậy vẫn nhận cú chạm
 * thứ hai trong lúc request đầu đang bay: đặt đơn đôi, huỷ hai lần, gửi đánh giá trùng.
 *
 * Quét mã nguồn thay vì render từng nút: rẻ, và bắt được cả những nút thêm mới sau này.
 */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

/** Cắt đúng thẻ mở <Button ...>, bỏ qua dấu ">" nằm trong biểu thức {…}. */
function openTags(src: string): { index: number; tag: string }[] {
  const out: { index: number; tag: string }[] = [];
  let i = src.indexOf('<Button');
  while (i >= 0) {
    let depth = 0;
    let j = i;
    while (j < src.length) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
      j += 1;
    }
    out.push({ index: i, tag: src.slice(i, j + 1) });
    i = src.indexOf('<Button', j + 1);
  }
  return out;
}

describe('mọi <Button loading> đều phải kèm disabled', () => {
  it('không còn nút nào chặn được double-tap chỉ bằng loading', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(process.cwd(), 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const { index, tag } of openTags(src)) {
        if (tag.includes('loading=') && !tag.includes('disabled=')) {
          const line = src.slice(0, index).split('\n').length;
          offenders.push(`${file.replace(process.cwd(), '')}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
