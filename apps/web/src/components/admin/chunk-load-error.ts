const CHUNK_MESSAGE = /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i;
const RELOAD_GUARD_MS = 60_000;

/** Tab tải lười (next/dynamic) xin tệp JS mà bản deploy mới đã xoá: trang mở từ trước nên còn trỏ mã băm cũ. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_MESSAGE.test(error.message);
}

/** Mất mạng cũng làm tải chunk thất bại: tải lại trang lúc đó chỉ ra màn "Không có kết nối" của trình duyệt. */
export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * True nếu được phép tự tải lại trang lúc này. Mỗi đường dẫn một lần mỗi 60 giây để bản vẫn hỏng không kẹt vòng tải lại;
 * không ghi được sessionStorage thì không tự tải (không có cách chặn vòng lặp), người dùng vẫn có nút.
 */
export function claimAutoReload(now = Date.now()): boolean {
  try {
    const key = `admin-chunk-reload:${window.location.pathname}`;
    const last = Number(window.sessionStorage.getItem(key));
    if (last && now - last < RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(key, String(now));
    return true;
  } catch {
    return false;
  }
}

export function reloadPage() {
  window.location.reload();
}
