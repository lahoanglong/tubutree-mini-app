// Cache ISR của Next (FileSystemCache) ghi cả trang 404 của route [slug]: mỗi slug bịa hợp lệ về ký tự là một bộ file ~53 KB trong
// .next/server không bao giờ bị xoá, bot quét vài giờ là đầy đĩa. Lớp này bỏ qua lần ghi 404 cho đường dẫn chưa từng có bản lưu.
// Đường dẫn đã có bản (sản phẩm thật vừa bị gỡ) vẫn ghi 404 đè lên: bỏ qua thì bản 200 cũ hết hạn nhưng vẫn được phục vụ mãi.
// Bám vào cấu trúc nội bộ của Next 15.5.28 (giá trị { kind: 'APP_PAGE', status }); isr-cache-handler.spec.ts hỏng ngay nếu cấu trúc đổi.
import fileSystemCacheModule from 'next/dist/server/lib/incremental-cache/file-system-cache.js';

// Node đưa nguyên module.exports (lớp nằm ở .default); vitest đã gỡ sẵn __esModule nên nhận thẳng lớp.
const FileSystemCache = fileSystemCacheModule.default ?? fileSystemCacheModule;

export function isDroppable404(data) {
  return data?.kind === 'APP_PAGE' && data.status === 404;
}

export default class IsrCacheHandler extends FileSystemCache {
  async set(key, data, ctx) {
    if (isDroppable404(data) && !(await this.#hasEntry(key, ctx))) return;
    return super.set(key, data, ctx);
  }

  async #hasEntry(key, ctx) {
    try {
      return (await super.get(key, { kind: 'APP_PAGE', isRoutePPREnabled: ctx?.isRoutePPREnabled, isFallback: false })) != null;
    } catch {
      return false;
    }
  }
}
