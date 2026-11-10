/**
 * Chạy `run` với hạn chót: hết `ms` thì huỷ yêu cầu đang chờ, cả lúc chờ phản hồi lẫn lúc đọc thân.
 * Dùng cho lượt tải lên mạng: mạng treo không báo lỗi thì ô ảnh và nút Lưu của form cha chờ mãi.
 */
export async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
