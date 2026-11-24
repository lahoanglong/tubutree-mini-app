import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import express from 'express';
import { OpsModule } from './ops.module';
import { SERVER_ERROR_KEY_PREFIX, ServerErrorCounterService, ServerErrorCountMiddleware, serverErrorStateKey } from './server-error-counter.service';

function fakePrisma(stored: Record<string, number> = {}) {
  const sql: Array<{ text: string; values: unknown[] }> = [];
  const executeRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    sql.push({ text: strings.join('?'), values });
    return 1;
  });
  const findUnique = jest.fn(async ({ where }: { where: { key: string } }) =>
    where.key in stored ? { detail: { count: stored[where.key] } } : null,
  );
  return { prisma: { $executeRaw: executeRaw, opsHealthState: { findUnique } }, sql, executeRaw };
}

describe('ServerErrorCounterService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('đếm theo ngày VN (23:59 và 00:01 giờ VN là hai ngày), ghi dồn cộng vào dòng có sẵn', async () => {
    const { prisma, sql } = fakePrisma();
    const svc = new ServerErrorCounterService(prisma as never);
    svc.record(new Date('2026-11-23T16:59:00.000Z'));
    svc.record(new Date('2026-11-23T16:59:30.000Z'));
    svc.record(new Date('2026-11-23T17:01:00.000Z'));
    await svc.flush();
    expect(sql).toHaveLength(2);
    expect(sql[0]!.text).toContain('ON CONFLICT ("key") DO UPDATE');
    expect(sql[0]!.text).toContain(`COALESCE(("ops_health_states"."detail"->>'count')::int, 0) +`);
    expect(sql.map((s) => [s.values[0], s.values[1]])).toEqual([
      [serverErrorStateKey('2026-11-23'), 2],
      [serverErrorStateKey('2026-11-24'), 1],
    ]);
    await svc.flush();
    expect(sql).toHaveLength(2);
  });

  it('ghi DB lỗi: giữ số đếm trong bộ nhớ, lần sau ghi lại; không ném', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { prisma, executeRaw, sql } = fakePrisma();
    executeRaw.mockRejectedValueOnce(new Error('db down'));
    const svc = new ServerErrorCounterService(prisma as never);
    svc.record(new Date('2026-11-23T03:00:00.000Z'));
    await expect(svc.flush()).resolves.toBeUndefined();
    expect(await svc.countForDay('2026-11-23')).toBe(1);
    await svc.flush();
    expect(sql.at(-1)!.values.slice(0, 2)).toEqual([serverErrorStateKey('2026-11-23'), 1]);
  });

  it('countForDay = số đã ghi DB + phần còn trong bộ nhớ; dòng hỏng hay không có thì 0', async () => {
    const { prisma } = fakePrisma({ [serverErrorStateKey('2026-11-23')]: 4, [serverErrorStateKey('2026-11-22')]: Number.NaN });
    const svc = new ServerErrorCounterService(prisma as never);
    svc.record(new Date('2026-11-23T03:00:00.000Z'));
    expect(await svc.countForDay('2026-11-23')).toBe(5);
    expect(await svc.countForDay('2026-11-22')).toBe(0);
    expect(await svc.countForDay('2026-11-21')).toBe(0);
  });

  it('record không bao giờ ném, kể cả với ngày hỏng', () => {
    const { prisma } = fakePrisma();
    const svc = new ServerErrorCounterService(prisma as never);
    expect(() => svc.record(new Date(Number.NaN))).not.toThrow();
  });

  it('tắt API: ghi nốt phần còn giữ; dọn dòng quá 14 ngày chỉ đụng khoá http.5xx:', async () => {
    const { prisma, sql } = fakePrisma();
    const svc = new ServerErrorCounterService(prisma as never);
    svc.onModuleInit();
    svc.record(new Date('2026-11-23T03:00:00.000Z'));
    await svc.onModuleDestroy();
    expect(sql).toHaveLength(1);
    await (svc as unknown as { purgeIfDue(now: Date): Promise<void> }).purgeIfDue(new Date('2026-11-24T01:00:00.000Z'));
    const del = sql.at(-1)!;
    expect(del.text).toContain('DELETE FROM "ops_health_states"');
    expect(del.values).toEqual([`${SERVER_ERROR_KEY_PREFIX}%`, serverErrorStateKey('2026-11-10')]);
  });
});

describe('ServerErrorCountMiddleware', () => {
  async function serve(status: number, path = '/x') {
    const record = jest.fn();
    const app = express();
    app.use((req, res, next) => new ServerErrorCountMiddleware({ record } as never).use(req, res, next));
    app.get(/.*/, (_req, res) => {
      res.status(status).send('ok');
    });
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as AddressInfo;
    await fetch(`http://127.0.0.1:${port}${path}`).then((r) => r.text());
    await new Promise((r) => setImmediate(r));
    await new Promise<void>((r) => server.close(() => r()));
    return record;
  }

  it('đếm phản hồi 500 và 503, không đếm 200/404/429', async () => {
    expect(await serve(500)).toHaveBeenCalledTimes(1);
    expect(await serve(503)).toHaveBeenCalledTimes(1);
    for (const s of [200, 404, 429]) expect(await serve(s)).not.toHaveBeenCalled();
  });

  it('503 của /api/health (healthcheck khi DB chập chờn) không đếm; route khác tên gần giống vẫn đếm', async () => {
    expect(await serve(503, '/api/health')).not.toHaveBeenCalled();
    expect(await serve(503, '/api/health?probe=1')).not.toHaveBeenCalled();
    expect(await serve(500, '/api/healthy-tips')).toHaveBeenCalledTimes(1);
    expect(await serve(500, '/api/orders/health')).toHaveBeenCalledTimes(1);
  });

  it('OpsModule gắn middleware cho mọi route', () => {
    const forRoutes = jest.fn();
    const apply = jest.fn(() => ({ forRoutes }));
    new OpsModule().configure({ apply } as never);
    expect(apply).toHaveBeenCalledWith(ServerErrorCountMiddleware);
    expect(forRoutes).toHaveBeenCalledWith(expect.objectContaining({ path: '*' }));
  });
});
