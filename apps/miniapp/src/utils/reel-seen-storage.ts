type SeenStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Bản trong bộ nhớ của phiên chạy: WebView không có sessionStorage (hoặc ghi lỗi vì đầy, chế độ riêng tư) thì vòng "đã xem" vẫn giữ được khi khách rời Trang chủ rồi quay lại.
const memory = new Map<string, string>();

/**
 * Nơi nhớ vòng Story đã xem trong phiên (khoá do `markReelSeen` ở app-core đặt). Đọc ưu tiên sessionStorage, ghi vào cả bộ nhớ lẫn sessionStorage;
 * truy cập sessionStorage ném lỗi thì chỉ dùng bộ nhớ. Không bao giờ ném.
 */
export function reelSeenStorage(): SeenStorage {
  return {
    getItem(key) {
      try {
        const stored = sessionStorage.getItem(key);
        if (stored !== null) return stored;
      } catch {
        /* chỉ còn bản trong bộ nhớ */
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        sessionStorage.setItem(key, value);
      } catch {
        /* bản trong bộ nhớ đã đủ cho phiên này */
      }
    },
  };
}

/** Chỉ cho spec: xoá bản trong bộ nhớ giữa các ca. */
export function resetReelSeenMemory(): void {
  memory.clear();
}
