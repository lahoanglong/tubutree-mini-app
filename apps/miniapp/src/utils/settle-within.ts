/** Hạn tối đa một khoá nút/tấm được giữ để chờ dữ liệu làm mới về: quá hạn thì nhả, kẻo mạng chậm giữ cả màn lâu hơn lệnh vừa thành công. */
export const LOCK_REFRESH_WAIT_MS = 4_000;

/**
 * Thứ tự thống nhất khi máy chủ từ chối một lệnh: dữ liệu mới về (hoặc quá hạn chờ) → đóng hộp/tấm → nhả khoá. Trả kết quả này từ `onError`:
 * TanStack đợi Promise đó trước `onSettled` nên khoá chỉ nhả sau khi tấm đã đóng. `held` là `settleWithin(...)` của lần tải lại, hoặc undefined
 * khi lỗi không kéo theo tải lại (vd 422): không có gì để chờ thì đóng ngay.
 */
export function closeAfterFresh(held: Promise<void> | undefined, close: () => void): Promise<void> | undefined {
  if (!held) {
    close();
    return undefined;
  }
  return held.then(close);
}

/** Chờ `work` xong nhưng không quá `ms`. Không bao giờ ném: `work` lỗi cũng coi là đã xong (lỗi tải lại đã có chỗ hiện riêng). */
export function settleWithin(work: PromiseLike<unknown> | unknown, ms: number = LOCK_REFRESH_WAIT_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    Promise.resolve(work).then(done, done);
  });
}
