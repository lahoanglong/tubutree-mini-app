/**
 * Bắt đầu một lượt đọc ngay để nó chạy song song với việc khác, còn kết quả vẫn được `await` ở đúng chỗ cũ trong hàm.
 *
 * Gắn sẵn một bộ bắt lỗi rỗng: hàm ném lỗi khác và thoát trước khi tới chỗ `await` thì lỗi của lượt đọc không thành "unhandledRejection"
 * (main.ts ghi log và báo Sentry). Chỗ `await` vẫn nhận đúng lỗi đó.
 */
export function prefetch<T>(work: Promise<T>): Promise<T> {
  work.catch(() => undefined);
  return work;
}
