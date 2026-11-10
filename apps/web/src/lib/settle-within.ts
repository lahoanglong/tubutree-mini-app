/** Hạn tối đa một khoá nút/tấm được giữ để chờ dữ liệu làm mới về: quá hạn thì nhả, kẻo mạng chậm giữ cả màn lâu hơn lệnh vừa thành công. */
export const LOCK_REFRESH_WAIT_MS = 4_000;

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
