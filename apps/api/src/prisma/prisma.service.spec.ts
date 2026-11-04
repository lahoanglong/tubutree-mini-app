import { PrismaClient } from '@prisma/client';
import { PRISMA_TRANSACTION_OPTIONS, PrismaService } from './prisma.service';

describe('PrismaService transactionOptions', () => {
  it('maxWait chờ kết nối pool 5 giây (mặc định 2 giây làm checkout dính P2028 khi pool đông)', () => {
    expect(PRISMA_TRANSACTION_OPTIONS.maxWait).toBe(5_000);
    expect(PRISMA_TRANSACTION_OPTIONS.timeout).toBe(5_000);
  });

  it('truyền vào PrismaClient, không đè lên maxWait/timeout mà từng chỗ tự đặt', () => {
    const svc = new PrismaService();
    expect(svc).toBeInstanceOf(PrismaClient);
    const cfg = (svc as unknown as { _engineConfig: { transactionOptions?: unknown } })._engineConfig;
    expect(cfg.transactionOptions).toEqual(PRISMA_TRANSACTION_OPTIONS);
  });
});
