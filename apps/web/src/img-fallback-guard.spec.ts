import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Mọi `<img>` thô hướng khách phải có `onError` (dùng `hideBrokenImage` của app-core, hoặc đường lui riêng như ProductImage) để không hiện icon ảnh gãy
 * của trình duyệt. File hoặc thư mục dưới đây được miễn kèm lý do; thêm ảnh mới mà quên `onError` là spec này đỏ.
 * Cùng quy tắc với apps/miniapp/src/components/img-fallback-guard.spec.ts. Nhớ: `onError` chỉ dùng được trong file `'use client'`.
 */
const EXEMPT: Record<string, string> = {
  'app/s/[slug]/og-card.tsx': 'ảnh OG dựng bằng ImageResponse, không có DOM để gắn sự kiện',
  'components/ui/qr-code.tsx': 'data URL sinh tại chỗ (không có URL để lỗi)',
  'components/account/avatar-crop-sheet.tsx': 'xem trước ảnh cục bộ (blob) vừa chọn',
  'components/community/image-upload.tsx': 'xem trước ảnh cục bộ (blob) vừa chọn',
  'components/affiliate/storefront-image-upload.tsx': 'xem trước ảnh cục bộ (blob) vừa chọn',
  'components/brand-owner/brand-image-field.tsx': 'xem trước ảnh chủ thương hiệu vừa dán/chọn trong form',
  'components/evidence-upload.tsx': 'xem trước ảnh minh chứng cục bộ trong form',
  'components/admin/': 'công cụ nội bộ Admin, chưa phải ảnh hướng khách (việc sau)',
  'app/merchant/': 'công cụ nội bộ Gian hàng, chưa phải ảnh hướng khách (việc sau)',
  'components/staff/': 'công cụ nội bộ Nhân viên, chưa phải ảnh hướng khách (việc sau)',
};

const SRC = fileURLToPath(new URL('.', import.meta.url));

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

const exempt = (file: string) => Object.keys(EXEMPT).some((e) => (e.endsWith('/') ? file.startsWith(e) : file === e));

const offenders = new Map<string, Array<[number, string]>>();
for (const file of tsxFiles(SRC)) {
  const hits = imgWithoutOnError(readFileSync(file, 'utf8'));
  if (hits.length) offenders.set(relative(SRC, file).split(sep).join('/'), hits);
}

describe('<img> thô luôn có onError (không hiện icon ảnh gãy)', () => {
  it('không có <img> nào thiếu onError ngoài danh sách miễn', () => {
    const bad = [...offenders].filter(([file]) => !exempt(file)).map(([file, hits]) => `${file}:${hits[0]![0]} ${hits[0]![1]}`);
    expect(bad, "thêm onError={hideBrokenImage} (@tubutree/app-core/image-fallback, file phải 'use client') hoặc ghi lý do vào EXEMPT").toEqual([]);
  });

  it('danh sách miễn không bị bỏ quên: mỗi mục miễn vẫn còn <img> thiếu onError', () => {
    const files = [...offenders.keys()];
    const stale = Object.keys(EXEMPT).filter((e) => !files.some((f) => (e.endsWith('/') ? f.startsWith(e) : f === e)));
    expect(stale).toEqual([]);
  });
});
