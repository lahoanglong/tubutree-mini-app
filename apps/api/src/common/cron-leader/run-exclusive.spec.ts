import { Logger } from '@nestjs/common';
import { runExclusive } from './run-exclusive';

function fakePrisma(claims: boolean[]) {
  const queue = [...claims];
  return {
    $queryRaw: jest.fn(async () => (queue.shift() ?? true ? [{ holder: 'h' }] : [])),
    $executeRaw: jest.fn(async () => 1),
  };
}

describe('runExclusive', () => {
  afterEach(() => jest.useRealTimers());

  it('không giành được lease → không chạy fn, không xoá gì', async () => {
    const prisma = fakePrisma([false]);
    const fn = jest.fn();
    await expect(runExclusive(prisma as never, 'k', fn)).resolves.toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('giành được → chạy fn, trả giá trị, nhả lease; tên lease có tiền tố run:', async () => {
    const prisma = fakePrisma([true]);
    await expect(runExclusive(prisma as never, 'cron:x', async () => 7)).resolves.toEqual({ acquired: true, value: 7 });
    const acquire = (prisma.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]);
    expect(acquire[1]).toBe('run:cron:x');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('fn ném lỗi → vẫn nhả lease và ném lại lỗi', async () => {
    const prisma = fakePrisma([true]);
    await expect(runExclusive(prisma as never, 'k', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('gia hạn mỗi ttl/3; gia hạn thấy lease đã mất thì ghi log lỗi đúng một lần mà không dừng fn', async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const prisma = fakePrisma([true, true, false, false]);
    let finish!: () => void;
    const run = runExclusive(prisma as never, 'k', () => new Promise<string>((r) => (finish = () => r('xong'))), { ttlMs: 3000 });
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    expect(error).toHaveBeenCalledTimes(1);
    finish();
    await expect(run).resolves.toEqual({ acquired: true, value: 'xong' });
    error.mockRestore();
  });
});
