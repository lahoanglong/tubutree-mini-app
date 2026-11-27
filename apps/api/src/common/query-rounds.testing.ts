/**
 * Đo độ sâu tuần tự của một hàm đọc DB trong unit test, không phụ thuộc đồng hồ.
 *
 * Mỗi lời gọi DB giả (bọc bằng `db(...)`) trả một promise chỉ xong khi `run` xả "vòng". Mỗi vòng xả hết các lời gọi đang chờ cùng lúc,
 * nên số vòng = số lần hàm phải chờ DB nối tiếp (trên mạng thật mỗi vòng tốn một RTT), còn cỡ vòng lớn nhất = số lời gọi chạy song song.
 */
export function queryRounds() {
  const pending: Array<() => void> = [];
  let calls = 0;

  /** Lời gọi DB giả: trả về `impl(...args)` sau khi vòng hiện tại được xả. */
  const db =
    <A extends unknown[], T>(impl: (...args: A) => T | Promise<T>) =>
    (...args: A): Promise<T> => {
      calls++;
      return new Promise<T>((resolve, reject) => {
        pending.push(() => {
          Promise.resolve()
            .then(() => impl(...args))
            .then(resolve, reject);
        });
      });
    };

  async function run<T>(work: () => Promise<T>): Promise<{ value: T; rounds: number; maxParallel: number; calls: number }> {
    calls = 0;
    let settled = false;
    let value: T | undefined;
    let error: unknown;
    let failed = false;
    work().then(
      (v) => {
        settled = true;
        value = v;
      },
      (e) => {
        settled = true;
        failed = true;
        error = e;
      },
    );
    let rounds = 0;
    let maxParallel = 0;
    for (;;) {
      // setImmediate chạy sau khi mọi microtask đã xong: các lời gọi DB kế tiếp của hàm đã kịp xếp hàng.
      await new Promise((r) => setImmediate(r));
      if (settled) break;
      const batch = pending.splice(0);
      if (batch.length === 0) throw new Error('Hàm chưa xong mà không còn lời gọi DB giả nào chờ: nó đang chờ thứ khác ngoài DB giả.');
      rounds++;
      maxParallel = Math.max(maxParallel, batch.length);
      for (const release of batch) release();
    }
    if (failed) throw error;
    return { value: value as T, rounds, maxParallel, calls };
  }

  return { db, run };
}
