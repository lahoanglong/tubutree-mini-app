import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Mọi `<img>` thô trong cổng nội bộ (Admin và Gian hàng) phải có `onError` (`hideBrokenImage` của app-core, hoặc đường lui riêng như ProductThumb/ImageUrlField)
 * để không hiện icon ảnh gãy của trình duyệt. File dưới đây được miễn kèm lý do; thêm ảnh mới mà quên `onError` là spec này đỏ.
 * Ảnh đổi `src` trong cùng một phần tử thì thêm `key={src}`: `hideBrokenImage` ẩn bằng style trực tiếp, React không tự gỡ khi `src` đổi.
 * Cùng cách quét với img-fallback-guard.spec.ts của phần hướng khách (W139). `onError` chỉ dùng được trong file `'use client'`.
 */
const EXEMPT: Record<string, string> = {
  'components/admin/story-roi-cutout.tsx': 'xem trước data URL do máy chủ trả để khoanh vùng, không có URL ngoài để lỗi',
  'components/admin/dealer-app-image.tsx': 'blob URL do trình duyệt tạo sau khi tải ảnh hồ sơ có xác thực; lỗi tải đã báo bằng chữ',
  'components/admin/admin-image.tsx': 'nhánh blob URL ảnh có xác thực (lỗi tải đã báo "Không tải được ảnh"); nhánh URL trực tiếp đã có onError',
  'components/admin/payroll-admin-tab.tsx': 'mã QR chuyển khoản: ẩn đi là mất mã để quét, để trình duyệt báo ảnh gãy cho kế toán thấy',
  'components/admin/support-chat/qr-modal.tsx': 'mã QR đăng nhập Zalo: ẩn đi là mất mã để quét',
};

const SRC = fileURLToPath(new URL('.', import.meta.url));
const ROOTS = ['components/admin', 'app/merchant'];

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
for (const root of ROOTS) {
  for (const file of tsxFiles(join(SRC, root))) {
    const hits = imgWithoutOnError(readFileSync(file, 'utf8'));
    if (hits.length) offenders.set(relative(SRC, file).split(sep).join('/'), hits);
  }
}

describe('<img> thô ở Admin và Gian hàng luôn có onError (không hiện icon ảnh gãy)', () => {
  it('không có <img> nào thiếu onError ngoài danh sách miễn', () => {
    const bad = [...offenders].filter(([file]) => !(file in EXEMPT)).map(([file, hits]) => `${file}:${hits[0]![0]} ${hits[0]![1]}`);
    expect(bad, "thêm onError={hideBrokenImage} (@tubutree/app-core/image-fallback, file phải 'use client') hoặc ghi lý do vào EXEMPT").toEqual([]);
  });

  it('danh sách miễn không bị bỏ quên: mỗi mục miễn vẫn còn <img> thiếu onError', () => {
    const stale = Object.keys(EXEMPT).filter((e) => !offenders.has(e));
    expect(stale).toEqual([]);
  });
});
