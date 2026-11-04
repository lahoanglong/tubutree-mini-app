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

describe('PrismaService hạn chờ Postgres qua DB_SESSION_OPTIONS', () => {
  const saved = { url: process.env.DATABASE_URL, opts: process.env.DB_SESSION_OPTIONS };
  afterEach(() => {
    for (const [k, v] of [['DATABASE_URL', saved.url], ['DB_SESSION_OPTIONS', saved.opts]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const resolvedUrl = (svc: PrismaService): string | undefined => {
    const cfg = (svc as unknown as { _engineConfig: { overrideDatasources?: { db?: { url?: string } } } })._engineConfig;
    return cfg.overrideDatasources?.db?.url;
  };

  it('có env → datasource db nhận URL kèm options; process.env.DATABASE_URL giữ nguyên', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@db:5432/x?schema=public';
    process.env.DB_SESSION_OPTIONS = '-c lock_timeout=10s';
    const svc = new PrismaService();
    expect(resolvedUrl(svc)).toBe('postgresql://u:p@db:5432/x?schema=public&options=-c%20lock_timeout%3D10s');
    expect(process.env.DATABASE_URL).toBe('postgresql://u:p@db:5432/x?schema=public');
  });

  it('không có env → không đè datasource', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@db:5432/x';
    delete process.env.DB_SESSION_OPTIONS;
    expect(resolvedUrl(new PrismaService())).toBeUndefined();
  });

  it('env sai → dựng PrismaService ném lỗi', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@db:5432/x';
    process.env.DB_SESSION_OPTIONS = '-c work_mem=1MB';
    expect(() => new PrismaService()).toThrow(/work_mem/);
  });
});
