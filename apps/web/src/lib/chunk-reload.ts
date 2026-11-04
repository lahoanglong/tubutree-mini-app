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

/** Chờ báo lỗi tối đa ngần này trước khi tải lại: mạng chậm không được giữ khách ở màn hình trống. */
export const CHUNK_REPORT_WAIT_MS = 500;

/**
 * Tải lại trang một lần (khoá sessionStorage giữ mốc giờ). Trả true nếu đã hẹn tải lại, false nếu vừa tải lại gần đây hoặc không có sessionStorage.
 * `beforeReload` (báo lỗi, bất đồng bộ) được chờ tối đa `CHUNK_REPORT_WAIT_MS` rồi mới tải lại, để báo lỗi không bị cắt ngang; chỉ chạy một lần mỗi cửa sổ vì lần sau bị khoá chặn.
 */
export function reloadOnceForChunkError(now: number = Date.now(), beforeReload?: () => Promise<unknown> | void): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY));
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // Không có sessionStorage thì không bảo vệ được khỏi vòng lặp: không tải lại.
    return false;
  }
  let reported: Promise<unknown> = Promise.resolve();
  try {
    reported = Promise.resolve(beforeReload?.()).catch(() => undefined);
  } catch {
    // Báo lỗi hỏng không được chặn việc tải lại.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CHUNK_REPORT_WAIT_MS);
  });
  void Promise.race([reported, cap]).then(() => {
    clearTimeout(timer);
    location.reload();
  });
  return true;
}
