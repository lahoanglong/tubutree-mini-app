/**
 * Chạy `run` và gom mọi `unhandledRejection` của tiến trình vào mảng trả về, để ca kiểm "lỗi vẫn lên tới trình duyệt/Sentry" không làm vitest đỏ vì Unhandled Rejection.
 * Gỡ tạm các listener có sẵn (kể cả của vitest) trong lúc chạy và trả lại đúng như cũ khi xong. Cùng hành vi với `apps/web/src/test-utils/unhandled.ts`.
 */
export async function captureUnhandledRejections(run: () => Promise<void>): Promise<unknown[]> {
  const saved = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  const seen: unknown[] = [];
  const onRejection = (reason: unknown) => {
    seen.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  try {
    await run();
    // unhandledRejection bắn sau khi hàng đợi microtask cạn: nhường một lượt macrotask.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  } finally {
    process.removeListener('unhandledRejection', onRejection);
    for (const l of saved) process.on('unhandledRejection', l as NodeJS.UnhandledRejectionListener);
  }
  return seen;
}
