import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Mọi `<img>` thô phải có `onError` (dùng `hideBrokenImage` của app-core, hoặc đường lui riêng như ProductImage) để khách không bao giờ thấy icon ảnh gãy
 * của WebView. Chỉ những file dưới đây được miễn, kèm lý do; thêm ảnh mới mà quên `onError` là spec này đỏ. Cùng quy tắc với apps/web/src/img-fallback-guard.spec.ts.
 */
const EXEMPT: Record<string, string> = {
  'components/avatar-crop-modal.tsx': 'xem trước ảnh cục bộ (blob) vừa chọn, không thể lỗi mạng',
  'components/image-upload.tsx': 'xem trước ảnh cục bộ (blob) vừa chọn, không thể lỗi mạng',
  'components/home/home-header.tsx': 'logo đóng gói sẵn trong bundle',
  'components/qr-code.tsx': 'data URL sinh tại chỗ (không có URL để lỗi)',
};

const SRC = fileURLToPath(new URL('..', import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : tsxFiles(p);
    return name.endsWith('.tsx') && !name.includes('.spec.') ? [p] : [];
  });
}

/** Các thẻ `<img ...>` thiếu `onError` trong một file: [dòng, thẻ]. Tìm dấu `>` đóng thẻ ở độ sâu ngoặc nhọn 0 (thuộc tính có thể chứa `=>`). */
function imgWithoutOnError(source: string): Array<[number, string]> {
  const found: Array<[number, string]> = [];
  for (const m of source.matchAll(/<img\b/g)) {
    let depth = 0;
    let i = m.index! + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && source[i - 1] !== '=') break;
    }
    const tag = source.slice(m.index!, i + 1);
    if (!tag.includes('onError')) found.push([source.slice(0, m.index).split('\n').length, tag.replace(/\s+/g, ' ').slice(0, 90)]);
  }
  return found;
}

const offenders = new Map<string, Array<[number, string]>>();
for (const file of tsxFiles(SRC)) {
  const hits = imgWithoutOnError(readFileSync(file, 'utf8'));
  if (hits.length) offenders.set(relative(SRC, file).split(sep).join('/'), hits);
}

describe('<img> thô luôn có onError (không hiện icon ảnh gãy)', () => {
  it('không có <img> nào thiếu onError ngoài danh sách miễn', () => {
    const bad = [...offenders].filter(([file]) => !(file in EXEMPT)).map(([file, hits]) => `${file}:${hits[0]![0]} ${hits[0]![1]}`);
    expect(bad, 'thêm onError={hideBrokenImage} (@tubutree/app-core/image-fallback) hoặc ghi lý do vào EXEMPT').toEqual([]);
  });

  it('danh sách miễn không bị bỏ quên: mỗi file miễn vẫn còn <img> thiếu onError', () => {
    expect(Object.keys(EXEMPT).filter((file) => !offenders.has(file))).toEqual([]);
  });
});
