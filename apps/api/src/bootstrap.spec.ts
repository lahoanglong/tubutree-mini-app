import type { AddressInfo } from 'node:net';
import { Body, Controller, Get, Injectable, Module, Post, type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
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
  const SHELL_JWT_SECRET = process.env.JWT_ACCESS_SECRET;
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'bootstrap-spec-access-secret-0123456789';
  });
  afterAll(() => {
    if (SHELL_JWT_SECRET === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = SHELL_JWT_SECRET;
  });
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

  it('CORS expose Content-Disposition để web (khác origin) đọc được tên file CSV (QTDON-04)', async () => {
    const app = await bootstrap(rootModule(leaseTable().prisma(), { n: 0 }), { port: 0, exit: jest.fn(), logger: false });
    opened.push(app!);
    const { port } = app!.getHttpServer().address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { Origin: 'https://tubutree.com' } });
    const exposed = (res.headers.get('access-control-expose-headers') ?? '').toLowerCase();
    expect(exposed).toContain('content-disposition');
    expect(exposed).toContain('retry-after');
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

    const tooBig = await fetch(`${base}/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://h5.zdn.vn' }, body: JSON.stringify(big) });
    expect(tooBig.status).toBe(413);
    expect(tooBig.headers.get('access-control-allow-origin')).toBe('https://h5.zdn.vn');
    expect((await post('/feed', big)).status).toBe(413);
    const bearer = new JwtService().sign({ sub: 'u1' }, { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '5m' });
    const authed = await fetch(`${base}/feed`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify(big) });
    expect(authed.status).toBe(201);
    const manyKeys = await post('/auth/guest', Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, 1])));
    expect(manyKeys.status).toBe(400);
    expect((await fetch(`${base}/products?q=a%00`)).status).toBe(400);
    expect((await fetch(`${base}/products`, { headers: { authorization: 'Bearer x' } })).headers.get('cache-control')).toBe('private, no-store');
  });

  describe('CORS và refresh cookie (A1/W2/F1)', () => {
    const ENV_KEYS = ['NODE_ENV', 'CORS_ORIGINS'] as const;
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const k of ENV_KEYS) saved[k] = process.env[k];
    });
    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    @Controller()
    class AuthStub {
      @Post('auth/refresh') refresh() { return { ok: true }; }
      @Post('auth/logout') logout() { return { ok: true }; }
      @Post('auth/guest') guest() { return { ok: true }; }
      @Post('auth/zalo-oauth') zaloOauth() { return { ok: true }; }
      @Post('auth/zalo-mini-app') zaloMini() { return { ok: true }; }
      @Post('auth/ensure-phone') ensurePhone() { return { ok: true }; }
    }
    async function start(env: 'production' | 'test') {
      process.env.NODE_ENV = env;
      process.env.CORS_ORIGINS = 'https://app.tubutree.com';
      const app = await bootstrap(rootModule(leaseTable().prisma(), { n: 0 }, [AuthStub]), { port: 0, exit: jest.fn(), logger: false });
      opened.push(app!);
      process.env.NODE_ENV = 'test';
      return `http://127.0.0.1:${(app!.getHttpServer().address() as AddressInfo).port}`;
    }
    const acao = (base: string, origin: string) => fetch(`${base}/`, { headers: { Origin: origin } }).then((r) => r.headers.get('access-control-allow-origin'));

    it('production: http, cổng lạ và subdomain http không được phản chiếu; https subdomain thì có', async () => {
      const base = await start('production');
      expect(await acao(base, 'http://evil.tubutree.com')).toBeNull();
      expect(await acao(base, 'http://app.tubutree.com')).toBeNull();
      expect(await acao(base, 'https://evil.tubutree.com:8443')).toBeNull();
      expect(await acao(base, 'https://app.tubutree.com')).toBe('https://app.tubutree.com');
      expect(await acao(base, 'https://shop.tubutree.com')).toBe('https://shop.tubutree.com');
      expect(await acao(base, 'https://h5.zdn.vn')).toBe('https://h5.zdn.vn');
    });

    it('non-production vẫn nhận http://localhost', async () => {
      const base = await start('test');
      expect(await acao(base, 'http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('preflight trả access-control-max-age 7200', async () => {
      const base = await start('production');
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.tubutree.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-client' },
      });
      expect(res.headers.get('access-control-max-age')).toBe('7200');
    });

    it.each(['refresh', 'logout'])('%s chế độ cookie: Origin Zalo, lạ hoặc thiếu → 403 tiếng Việt', async (route) => {
      const base = await start('production');
      for (const origin of ['https://h5.zdn.vn', 'https://evil.example', undefined]) {
        const res = await fetch(`${base}/api/auth/${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-client': 'web', cookie: 'tubu_rt=abc', ...(origin ? { Origin: origin } : {}) },
          body: '{}',
        });
        expect(res.status).toBe(403);
        expect(((await res.json()) as { message: string }).message).toMatch(/Tubu Tree/);
      }
    });

    const cookieCall = (base: string, route: string, origin?: string) =>
      fetch(`${base}/api/auth/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client': 'web', ...(origin ? { Origin: origin } : {}) },
        body: '{}',
      }).then((r) => r.status);

    it.each(['refresh', 'logout'])('%s chế độ cookie: gian hàng https://<slug>.tubutree.com hợp lệ được nhận', async (route) => {
      const base = await start('production');
      expect(await cookieCall(base, route, 'https://abc.tubutree.com')).not.toBe(403);
      expect(await cookieCall(base, route, 'https://my-shop-01.tubutree.com')).not.toBe(403);
    });

    it.each(['refresh', 'logout'])('%s chế độ cookie: nhãn dành riêng, nhiều cấp, cổng, http bị 403 ở production', async (route) => {
      const base = await start('production');
      for (const origin of ['https://api.tubutree.com', 'https://www.tubutree.com', 'https://hello.tubutree.com', 'https://admin.tubutree.com', 'https://mail.tubutree.com', 'https://a.b.tubutree.com', 'https://abc.tubutree.com:8443', 'http://abc.tubutree.com', 'https://ab.tubutree.com', 'https://-abc.tubutree.com', 'https://abc.tubutree.com.evil.com']) {
        expect(await cookieCall(base, route, origin)).toBe(403);
      }
    });

    it('non-production nhận http://<nhãn>.localhost:<cổng> và http://localhost', async () => {
      const base = await start('test');
      expect(await cookieCall(base, 'refresh', 'http://abc.localhost:3000')).not.toBe(403);
      expect(await cookieCall(base, 'refresh', 'http://localhost:3000')).not.toBe(403);
    });

    it.each(['guest', 'zalo-oauth', 'zalo-mini-app', 'ensure-phone'])('%s chế độ cookie (đặt cookie phiên): Origin Zalo, lạ hoặc thiếu → 403; Origin web → chạy', async (route) => {
      const base = await start('production');
      for (const origin of ['https://h5.zdn.vn', 'https://evil.example', undefined]) expect(await cookieCall(base, route, origin)).toBe(403);
      expect(await cookieCall(base, route, 'https://app.tubutree.com')).toBe(201);
      expect(await cookieCall(base, route, 'https://abc.tubutree.com')).toBe(201);
    });

    it.each(['guest', 'zalo-oauth', 'zalo-mini-app', 'ensure-phone'])('%s chế độ thân (Mini App, không x-client) không cần Origin', async (route) => {
      const base = await start('production');
      const res = await fetch(`${base}/api/auth/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://h5.zdn.vn' }, body: '{}' });
      expect(res.status).toBe(201);
    });

    it('refresh chế độ cookie với Origin web đúng danh sách → chạy', async () => {
      const base = await start('production');
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client': 'web', Origin: 'https://app.tubutree.com' },
        body: '{}',
      });
      expect(res.status).toBe(201);
    });

    it('refresh chế độ thân (Mini App, không x-client, không Origin) vẫn chạy', async () => {
      const base = await start('production');
      const miniApp = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: 'x' }) });
      expect(miniApp.status).toBe(201);
      const zalo = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://h5.zdn.vn' }, body: JSON.stringify({ refreshToken: 'x' }) });
      expect(zalo.status).toBe(201);
    });
  });
});
