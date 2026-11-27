import { prefetch } from './prefetch';

describe('prefetch', () => {
  it('lượt đọc lỗi mà hàm không chờ tới: không phát unhandledRejection', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      prefetch(Promise.reject(new Error('DB lỗi')));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(seen).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('chỗ await vẫn nhận đúng giá trị hoặc lỗi', async () => {
    await expect(prefetch(Promise.resolve(42))).resolves.toBe(42);
    const failing = prefetch(Promise.reject(new Error('DB lỗi')));
    await new Promise((r) => setImmediate(r));
    await expect(failing).rejects.toThrow('DB lỗi');
  });
});
