import type { AddressInfo } from 'node:net';
import { Body, Controller, Get, Injectable, Module, Post, type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Cron, ScheduleModule } from '@nestjs/schedule';
import { bootstrap } from './bootstrap';
import { CRON_LEADER_OPTIONS, CronLeaderService } from './common/cron-leader/cron-leader.service';
import { HTTP_HEADERS_TIMEOUT_MS, HTTP_KEEP_ALIVE_TIMEOUT_MS } from './config/http-timeouts';
import { PrismaService } from './prisma/prisma.service';

/** Bảng cron_leases giả dùng chung cho mọi instance trong test: một holder, ghi lại ai đã giành/gia hạn. */
function leaseTable() {
  let holder: string | null = null;
  const writes: string[] = [];
  const prisma = () => ({
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      const id = values[1] as string;
      if (sql.includes('INSERT INTO cron_leases')) {
        writes.push(id);
        if (holder !== null && holder !== id) return 0;
        holder = id;
        return 1;
      }
      if (sql.includes('UPDATE cron_leases') && holder === id) holder = null;
      return 1;
    }),
  });
  return { prisma, writes, holder: () => holder };
}

/** Module gốc tối giản: một @Cron chạy mỗi giây đếm số lượt, CronLeaderService thật trên bảng lease giả. */
function rootModule(prisma: object, ticks: { n: number }, controllers: Type<unknown>[] = []): Type<unknown> {
  @Injectable()
  class Ticker {
    @Cron('* * * * * *')
    tick(): void {
      ticks.n += 1;
    }
  }
  @Module({
    imports: [ScheduleModule.forRoot()],
    controllers,
    providers: [
      Ticker,
      CronLeaderService,
      { provide: PrismaService, useValue: prisma },
      { provide: CRON_LEADER_OPTIONS, useValue: { leaseName: 'cron', ttlMs: 90_000, renewMs: 60_000 } },
    ],
  })
  class Root {}
  return Root;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('bootstrap — khởi động API (R5-SYNC-2)', () => {
  const opened: INestApplication[] = [];
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((a) => a.close().catch(() => undefined)));
  });

  it('hai instance cùng một cổng: instance sau thoát mã 1, không giành lease, không chạy cron lượt nào; instance đầu vẫn là leader', async () => {
    const lease = leaseTable();
    const ticksA = { n: 0 };
    const ticksB = { n: 0 };
    const exitA = jest.fn();
    const exitB = jest.fn();

    const a = await bootstrap(rootModule(lease.prisma(), ticksA), { port: 0, exit: exitA, logger: false });
    expect(a).toBeDefined();
    opened.push(a!);
    const port = (a!.getHttpServer().address() as AddressInfo).port;
    const leaderId = a!.get(CronLeaderService).instanceId;
    await sleep(50);
    expect(lease.holder()).toBe(leaderId);

    const b = await bootstrap(rootModule(lease.prisma(), ticksB), { port, exit: exitB, logger: false });
    expect(b).toBeUndefined();
    expect(exitB).toHaveBeenCalledTimes(1);
    expect(exitB).toHaveBeenCalledWith(1);

    await sleep(2_200);
    expect(ticksB.n).toBe(0);
    expect(ticksA.n).toBeGreaterThan(0);
    expect(lease.writes.every((id) => id === leaderId)).toBe(true);
    expect(lease.holder()).toBe(leaderId);
    expect(exitA).not.toHaveBeenCalled();
  }, 15_000);

  it('server HTTP đã mở cổng giữ kết nối rảnh lâu hơn proxy phía trước (A3-010)', async () => {
    const app = await bootstrap(rootModule(leaseTable().prisma(), { n: 0 }), { port: 0, exit: jest.fn(), logger: false });
    expect(app).toBeDefined();
    opened.push(app!);
    const server = app!.getHttpServer() as { keepAliveTimeout: number; headersTimeout: number };
    expect(server.keepAliveTimeout).toBe(HTTP_KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HTTP_HEADERS_TIMEOUT_MS);
  });

  it('app đã init nhưng chưa giành lease (chưa listen xong) → cron không chạy lượt nào', async () => {
    const ticks = { n: 0 };
    const app = await NestFactory.create(rootModule(leaseTable().prisma(), ticks), { logger: false });
    opened.push(app);
    await app.init();
    await sleep(1_500);
    expect(ticks.n).toBe(0);
  }, 10_000);

  it('thân request bị chặn trước ValidationPipe: trần theo route, quá nhiều khoá, NUL, Cache-Control (BAOMAT-01/03/08)', async () => {
    @Controller()
    class Echo {
      @Post('auth/guest') guest(@Body() b: object) { return { n: Object.keys(b).length }; }
      @Post('feed') feed(@Body() b: object) { return { n: Object.keys(b).length }; }
      @Get('products') list() { return []; }
    }
    const app = await bootstrap(rootModule(leaseTable().prisma(), { n: 0 }, [Echo]), { port: 0, exit: jest.fn(), logger: false });
    opened.push(app!);
    const base = `http://127.0.0.1:${(app!.getHttpServer().address() as AddressInfo).port}/api`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const big = { note: 'x'.repeat(300_000) };

    expect((await post('/auth/guest', big)).status).toBe(413);
    expect((await post('/feed', big)).status).toBe(201);
    const manyKeys = await post('/auth/guest', Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, 1])));
    expect(manyKeys.status).toBe(400);
    expect((await fetch(`${base}/products?q=a%00`)).status).toBe(400);
    expect((await fetch(`${base}/products`, { headers: { authorization: 'Bearer x' } })).headers.get('cache-control')).toBe('private, no-store');
  });
});
