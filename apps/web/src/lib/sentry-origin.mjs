/** Origin của máy chủ nhận lỗi, lấy từ DSN, để thêm vào connect-src; DSN rỗng hoặc sai dạng thì không có gì. */
export function sentryOrigin(dsn) {
  if (!dsn) return '';
  try {
    return new URL(dsn).origin;
  } catch {
    return '';
  }
}
