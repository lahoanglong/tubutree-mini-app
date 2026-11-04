import { allowLongStatements } from '../../src/common/long-statement';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Hạn chờ Postgres qua DB_SESSION_OPTIONS: API nhận hạn chờ, kết nối trơn (kiểu prisma CLI) thì không. */
describe('PrismaService + DB_SESSION_OPTIONS (real Postgres)', () => {
  const saved = process.env.DB_SESSION_OPTIONS;
  const OPTS = '-c statement_timeout=30s -c lock_timeout=10s -c idle_in_transaction_session_timeout=30s';
  const clients: PrismaService[] = [];

  afterEach(async () => {
    if (saved === undefined) delete process.env.DB_SESSION_OPTIONS;
    else process.env.DB_SESSION_OPTIONS = saved;
    await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
  });

  const settings = async (svc: PrismaService) => {
    clients.push(svc);
    const rows = await svc.$queryRaw<{ s: string; l: string; i: string }[]>`
      SELECT current_setting('statement_timeout') AS s, current_setting('lock_timeout') AS l, current_setting('idle_in_transaction_session_timeout') AS i`;
    return rows[0];
  };

  it('có DB_SESSION_OPTIONS → 30s / 10s / 30s', async () => {
    process.env.DB_SESSION_OPTIONS = OPTS;
    expect(await settings(new PrismaService())).toEqual({ s: '30s', l: '10s', i: '30s' });
  });

  it('không có → 0 (không hạn chờ)', async () => {
    delete process.env.DB_SESSION_OPTIONS;
    expect(await settings(new PrismaService())).toEqual({ s: '0', l: '0', i: '0' });
  });

  it('allowLongStatements vẫn nâng statement_timeout lên 120s trong transaction, ra ngoài về 30s', async () => {
    process.env.DB_SESSION_OPTIONS = OPTS;
    const svc = new PrismaService();
    clients.push(svc);
    const inTx = await svc.$transaction(async (tx) => {
      await allowLongStatements(tx);
      const r = await tx.$queryRaw<{ s: string }[]>`SELECT current_setting('statement_timeout') AS s`;
      return r[0].s;
    });
    expect(inTx).toBe('2min');
    expect((await settings(svc)).s).toBe('30s');
  });
});
