const KEY = 'tubu_chunk_reload_at';
/** Trong ngần này sau lần tải lại trước, lỗi chunk lặp lại thì không tải lại nữa (tránh vòng lặp khi chunk thật sự mất). */
export const CHUNK_RELOAD_WINDOW_MS = 2 * 60_000;

/**
 * Sau khi triển khai, tab đang mở xin chunk `next/dynamic` có băm cũ và máy chủ trả 404. React.lazy của Next 15 giữ lời hứa đã bị từ chối nên "Thử lại" luôn
 * lỗi lại; chỉ tải lại cả trang mới lấy được chunk mới.
 */
export function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null | undefined;
  const message = typeof e?.message === 'string' ? e.message : typeof err === 'string' ? err : '';
  return e?.name === 'ChunkLoadError' || /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module/i.test(message);
}

/** Tải lại trang một lần (khoá sessionStorage giữ mốc giờ). Trả true nếu đã gọi tải lại, false nếu vừa tải lại gần đây hoặc không có sessionStorage. */
export function reloadOnceForChunkError(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY));
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // Không có sessionStorage thì không bảo vệ được khỏi vòng lặp: không tải lại.
    return false;
  }
  location.reload();
  return true;
}
