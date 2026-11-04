// Cache ISR của Next (FileSystemCache) ghi cả trang 404 của route [slug]: mỗi slug bịa hợp lệ về ký tự là một bộ file ~53 KB trong
// .next/server không bao giờ bị xoá, bot quét vài giờ là đầy đĩa. Lớp này giữ trang 404 của đường dẫn chưa từng có bản lưu trong một LRU
// bộ nhớ có trần và hạn, không ghi đĩa: link chết được hỏi lại (link Zalo cũ, Googlebot thử lại) vẫn trả từ cache, không dựng lại + gọi API.
// Đường dẫn đã có bản (sản phẩm thật vừa bị gỡ) vẫn ghi 404 đè xuống đĩa: bỏ qua thì bản 200 cũ hết hạn nhưng vẫn được phục vụ mãi.
// Bám vào cấu trúc nội bộ của Next 15.5.28 (giá trị { kind: 'APP_PAGE', status }); isr-cache-handler.spec.ts hỏng ngay nếu cấu trúc đổi.
import fileSystemCacheModule from 'next/dist/server/lib/incremental-cache/file-system-cache.js';

// Node đưa nguyên module.exports (lớp nằm ở .default); vitest đã gỡ sẵn __esModule nên nhận thẳng lớp.
const FileSystemCache = fileSystemCacheModule.default ?? fileSystemCacheModule;

export function isDroppable404(data) {
  return data?.kind === 'APP_PAGE' && data.status === 404;
}

// Chuỗi có tiếng Việt V8 lưu 2 byte mỗi ký tự: tính trần theo mức đó cho html/postponed (bảo thủ với chuỗi ASCII), rscData là Buffer.
const charBytes = (str) => 2 * (str?.length ?? 0);
const sizeOf = (data) =>
  charBytes(data.html) + charBytes(data.postponed) + (typeof data.rscData === 'string' ? charBytes(data.rscData) : (data.rscData?.byteLength ?? 0));

/**
 * LRU theo thứ tự của Map (đọc trúng hay ghi đều đưa khoá về cuối, đẩy ra từ đầu). Next tạo một handler cho mỗi request nên kho phải dùng chung cấp module (như memoryCache của FileSystemCache).
 * Trần theo cả số khoá lẫn số byte: trang 404 nặng ~53 KB, 5000 khoá không chặn byte là ~260 MB RAM.
 */
export const notFoundStore = {
  ttlMs: 300_000,
  maxEntries: 5000,
  maxBytes: 32 * 1024 * 1024,
  now: () => Date.now(),
  entries: new Map(),
  bytes: 0,
  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (this.now() - hit.at >= this.ttlMs) {
      this.delete(key);
      return null;
    }
    // Đưa khoá vừa đọc về cuối: link chết còn được hỏi thì ở lại lâu hơn khoá không ai hỏi.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  },
  set(key, value) {
    this.delete(key);
    const size = sizeOf(value);
    if (size > this.maxBytes) return;
    this.entries.set(key, { value, at: this.now(), size });
    this.bytes += size;
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && this.bytes <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.bytes -= entry.size;
    }
  },
  delete(key) {
    const hit = this.entries.get(key);
    if (!hit) return;
    this.entries.delete(key);
    this.bytes -= hit.size;
  },
  clear() {
    this.entries.clear();
    this.bytes = 0;
  },
};

export default class IsrCacheHandler extends FileSystemCache {
  async get(key, ctx) {
    if (ctx?.kind === 'APP_PAGE') {
      const hit = notFoundStore.get(key);
      if (hit) return { lastModified: hit.at, value: hit.value };
    }
    return super.get(key, ctx);
  }

  async set(key, data, ctx) {
    if (isDroppable404(data) && !(await this.#hasEntry(key, ctx))) {
      notFoundStore.set(key, data);
      return;
    }
    notFoundStore.delete(key);
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
