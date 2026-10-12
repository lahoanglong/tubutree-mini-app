import { Controller, Get, type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from '../../modules/auth/auth.controller';
import { AuthService } from '../../modules/auth/auth.service';
import { JwtStrategy } from '../../modules/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AppThrottlerGuard } from './app-throttler.guard';
import { throttlerOptions } from './throttle.config';

/**
 * Chính sách Q-22 (C-005, C-033), chạy qua HTTP thật với đúng thứ tự guard toàn cục của
 * app.module (JwtAuthGuard trước, throttle sau) và đúng decorator trên AuthController.
 */

const SECRET = 'test-access-secret-0123456789';
const BYPASS = 'ssr-bypass-token-0123456789abcdef0123456789';
const DEFAULT_LIMIT = 300;

@Controller('probe')
class ProbeController {
  @Public()
  @Get('public')
  pub() {
    return { ok: true };
  }

  @Get('private')
  priv() {
    return { ok: true };
  }
}

const loginResult = { accessToken: 'a', refreshToken: 'r', user: { id: 'u' } };

// ConfigService đọc process.env trước giá trị `load`, mà jest đã nạp .env của máy dev.
const savedEnv = { JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET, THROTTLE_BYPASS_TOKEN: process.env.THROTTLE_BYPASS_TOKEN };
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function bootApp(bypassToken: string): Promise<{ app: INestApplication; base: string }> {
  process.env.JWT_ACCESS_SECRET = SECRET;
  process.env.THROTTLE_BYPASS_TOKEN = bypassToken;
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ JWT_REFRESH_TTL_DAYS: 30 })] }),
      PassportModule,
      ThrottlerModule.forRoot(throttlerOptions),
    ],
    controllers: [AuthController, ProbeController],
    providers: [
      JwtStrategy,
      {
        provide: AuthService,
        useValue: {
          loginAsGuest: jest.fn().mockResolvedValue(loginResult),
          refresh: jest.fn().mockResolvedValue(loginResult),
          loginWithZaloMiniApp: jest.fn().mockResolvedValue(loginResult),
          loginWithZaloOAuth: jest.fn().mockResolvedValue(loginResult),
        },
      },
      { provide: PrismaService, useValue: {} },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: AppThrottlerGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address() as { port: number };
  return { app, base: `http://127.0.0.1:${addr.port}` };
}

const jwt = new JwtService();
const tokenFor = (sub: string) => jwt.sign({ sub, role: 'CUSTOMER' }, { secret: SECRET, expiresIn: '15m' });

type Call = { path: string; method?: 'GET' | 'POST'; ip: string; headers?: Record<string, string>; body?: unknown };

async function hit(base: string, c: Call): Promise<number> {
  const res = await fetch(base + c.path, {
    method: c.method ?? 'GET',
    headers: {
      'x-forwarded-for': c.ip,
      ...(c.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...c.headers,
    },
    body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
  });
  await res.arrayBuffer();
  return res.status;
}

/** Lô 25 request song song: chỉ so tổng số 429, không so vị trí, vì thứ tự trong lô không cố định. */
async function hitMany(base: string, n: number, make: (i: number) => Call): Promise<number[]> {
  const out: number[] = [];
  for (let start = 0; start < n; start += 25) {
    const batch = Array.from({ length: Math.min(25, n - start) }, (_, k) => hit(base, make(start + k)));
    out.push(...(await Promise.all(batch)));
  }
  return out;
}

const count429 = (codes: number[]) => codes.filter((c) => c === 429).length;

describe('AppThrottlerGuard (Q-22)', () => {
  let app: INestApplication;
  let base: string;

  beforeEach(async () => {
    ({ app, base } = await bootApp(BYPASS));
  });
  afterEach(async () => {
    await app.close();
  });

  describe('đếm theo userId khi có JWT hợp lệ, theo IP khi chưa', () => {
    it('hai tài khoản chung một IP không ăn chung một suất (route cần đăng nhập)', async () => {
      const a = tokenFor('user-a');
      const b = tokenFor('user-b');
      const codes = await hitMany(base, 140, (i) => ({
        path: '/probe/private',
        ip: '203.0.113.7',
        headers: { authorization: `Bearer ${i % 2 ? a : b}` },
      }));
      expect(count429(codes)).toBe(0);
    });

    it('route @Public cũng đếm theo userId khi request mang JWT hợp lệ', async () => {
      const a = tokenFor('user-a');
      const b = tokenFor('user-b');
      const codes = await hitMany(base, 140, (i) => ({
        path: '/probe/public',
        ip: '203.0.113.8',
        headers: { authorization: `Bearer ${i % 2 ? a : b}` },
      }));
      expect(count429(codes)).toBe(0);
    });

    it('một tài khoản vượt giới hạn chung thì bị 429 dù đổi IP liên tục', async () => {
      const a = tokenFor('user-a');
      const codes = await hitMany(base, DEFAULT_LIMIT + 5, (i) => ({
        path: '/probe/private',
        ip: `198.51.100.${i % 250}`,
        headers: { authorization: `Bearer ${a}` },
      }));
      expect(count429(codes)).toBe(5);
    });

    it('JWT sai chữ ký thì đếm theo IP như khách vô danh', async () => {
      const forged = new JwtService().sign({ sub: 'user-a' }, { secret: 'wrong-secret-0123456789' });
      const codes = await hitMany(base, DEFAULT_LIMIT + 3, (i) => ({
        path: '/probe/public',
        ip: '203.0.113.9',
        headers: { authorization: `Bearer ${i % 2 ? forged : 'garbage'}` },
      }));
      expect(count429(codes)).toBe(3);
    });
  });

  describe('route đăng nhập: đếm theo thiết bị/tài khoản, IP chỉ là trần nới rộng', () => {
    it('12 máy khác nhau chung một IP đều đăng nhập khách được', async () => {
      const codes = await hitMany(base, 12, (i) => ({
        path: '/auth/guest',
        method: 'POST',
        ip: '203.0.113.20',
        body: { deviceId: `d_device_${i}_0123456789abcdef` },
      }));
      expect(codes).toEqual(Array(12).fill(200));
    });

    it('một deviceId gọi dồn thì bị chặn dù đổi IP', async () => {
      const codes = await hitMany(base, 13, (i) => ({
        path: '/auth/guest',
        method: 'POST',
        ip: `198.51.100.${i + 1}`,
        body: { deviceId: 'd_same_device_0123456789abcdef' },
      }));
      expect(count429(codes)).toBe(3);
    });

    it('một IP vẫn có trần 30 lượt/phút cho mỗi route đăng nhập', async () => {
      const codes = await hitMany(base, 33, (i) => ({
        path: '/auth/guest',
        method: 'POST',
        ip: '203.0.113.21',
        body: { deviceId: `d_spray_${i}_0123456789abcdef` },
      }));
      expect(count429(codes)).toBe(3);
    });

    it('refresh: nhiều máy chung IP (token khác nhau) không bị 429 ở lần thứ 6', async () => {
      const codes = await hitMany(base, 12, (i) => ({
        path: '/auth/refresh',
        method: 'POST',
        ip: '203.0.113.22',
        body: { refreshToken: `refresh-token-${i}` },
      }));
      expect(count429(codes)).toBe(0);
    });

    it('refresh qua cookie web cũng đếm theo token chứ không theo IP', async () => {
      const codes = await hitMany(base, 12, (i) => ({
        path: '/auth/refresh',
        method: 'POST',
        ip: '203.0.113.23',
        headers: { 'x-client': 'web', cookie: `tubu_rt=cookie-token-${i}` },
        body: {},
      }));
      expect(count429(codes)).toBe(0);
    });

    it('đăng nhập Zalo Mini App: nhiều máy chung IP không bị chặn ở lần thứ 6', async () => {
      const codes = await hitMany(base, 12, (i) => ({
        path: '/auth/zalo-mini-app',
        method: 'POST',
        ip: '203.0.113.24',
        body: { code: `code-${i}`, accessToken: `zalo-at-${i}` },
      }));
      expect(count429(codes)).toBe(0);
    });
  });

  describe('SSR web được miễn bằng THROTTLE_BYPASS_TOKEN', () => {
    it('header đúng token thì không bao giờ bị 429', async () => {
      const codes = await hitMany(base, DEFAULT_LIMIT + 20, () => ({
        path: '/probe/public',
        ip: '10.0.0.5',
        headers: { 'x-throttle-bypass': BYPASS },
      }));
      expect(count429(codes)).toBe(0);
    });

    it('header sai token thì vẫn bị đếm như thường', async () => {
      const codes = await hitMany(base, DEFAULT_LIMIT + 2, () => ({
        path: '/probe/public',
        ip: '10.0.0.6',
        headers: { 'x-throttle-bypass': `${BYPASS}x` },
      }));
      expect(count429(codes)).toBe(2);
    });

    it('biến môi trường rỗng thì tắt hẳn đường miễn, kể cả header rỗng', async () => {
      await app.close();
      ({ app, base } = await bootApp(''));
      const codes = await hitMany(base, DEFAULT_LIMIT + 2, () => ({
        path: '/probe/public',
        ip: '10.0.0.7',
        headers: { 'x-throttle-bypass': '' },
      }));
      expect(count429(codes)).toBe(2);
    });
  });
});
