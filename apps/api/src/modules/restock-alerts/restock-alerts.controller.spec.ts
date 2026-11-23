import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { SessionStateService } from '../auth/session-state.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { RestockAlertsController } from './restock-alerts.controller';
import { RESTOCK_ALERT_ENABLED_KEY, RestockAlertsService } from './restock-alerts.service';

const mineHandler = RestockAlertsController.prototype.mine as unknown as object;

describe('RestockAlertsController.mine — danh sách theo khách, không cache chung', () => {
  it('không @Public (JwtAuthGuard toàn app chặn khách chưa đăng nhập) và private, no-store', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, mineHandler)).not.toBe(true);
    const headers = Reflect.getMetadata(HEADERS_METADATA, mineHandler) as { name: string; value: string }[];
    expect(headers.find((h) => h.name.toLowerCase() === 'cache-control')?.value).toBe('private, no-store');
  });
});

describe('RestockAlertsService.mine', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    variationId: 'v1',
    productId: 'p1',
    productSlug: 'nuoc-rua-chen',
    productName: 'Nước rửa chén',
    variationName: '500ml',
    stock: 0,
    createdAt: new Date('2026-11-20T03:00:00.000Z'),
    ...over,
  });
  const make = (enabled: unknown, rows: unknown[] = []) => {
    const queryRaw = jest.fn().mockResolvedValue(rows);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const config = { get: jest.fn(async (k: string, fb: unknown) => (k === RESTOCK_ALERT_ENABLED_KEY ? enabled : fb)) } as unknown as SystemConfigService;
    return { svc: new RestockAlertsService(prisma, config), queryRaw };
  };

  it('cờ tắt: trả rỗng, không chạm DB', async () => {
    const { svc, queryRaw } = make(false);
    expect(await svc.mine('u1')).toEqual({ enabled: false, items: [] });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('cờ bật: một câu SQL nối ba bảng, chỉ lọc theo userId của phiên và chỉ dòng đang chờ', async () => {
    const { svc, queryRaw } = make(true, [row(), row({ variationId: 'v2', productId: 'p2', stock: 3n })]);
    const out = await svc.mine('u-me');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = queryRaw.mock.calls[0]![0] as Prisma.Sql | TemplateStringsArray;
    const text = Array.isArray(sql) ? sql.join('?') : (sql as Prisma.Sql).sql;
    expect(text).toMatch(/FROM "restock_alerts" ra\s+JOIN "variations" v ON v\."id" = ra\."variationId"\s+JOIN "products" p ON p\."id" = v\."productId"/);
    expect(text).toMatch(/WHERE ra\."userId" = \?\S* AND ra\."notifiedAt" IS NULL/);
    // Tham số duy nhất mang danh tính là userId của phiên; tham số còn lại là trần dòng.
    expect(queryRaw.mock.calls[0]!.slice(1)).toEqual(['u-me', 40]);
    expect(out).toEqual({
      enabled: true,
      items: [
        { variationId: 'v1', productId: 'p1', productSlug: 'nuoc-rua-chen', productName: 'Nước rửa chén', variationName: '500ml', stock: 0, createdAt: '2026-11-20T03:00:00.000Z' },
        { variationId: 'v2', productId: 'p2', productSlug: 'nuoc-rua-chen', productName: 'Nước rửa chén', variationName: '500ml', stock: 3, createdAt: '2026-11-20T03:00:00.000Z' },
      ],
    });
  });

  it('cờ không phải đúng true (chuỗi "true", 1) coi như tắt', async () => {
    for (const v of ['true', 1, null]) {
      const { svc, queryRaw } = make(v);
      expect((await svc.mine('u1')).enabled).toBe(false);
      expect(queryRaw).not.toHaveBeenCalled();
    }
  });
});

const SECRET = 'restock-alerts-controller-test-secret';

describe('GET /me/restock-alerts qua JwtAuthGuard toàn app (HTTP thật)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  const mine = jest.fn();

  beforeAll(async () => {
    mine.mockImplementation(async (userId: string) => ({ enabled: true, items: [{ variationId: `v-${userId}`, productId: 'p1' }] }));
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [RestockAlertsController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: RestockAlertsService, useValue: { mine } },
        { provide: ConfigService, useValue: { get: () => SECRET } },
        { provide: SessionStateService, useValue: { get: async () => ({ role: 'CUSTOMER', isBlocked: false }) } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (query: string, sub?: string) =>
    fetch(`${base}/me/restock-alerts${query}`, { headers: sub ? { authorization: `Bearer ${jwt.sign({ sub, role: 'CUSTOMER' })}` } : {} });

  it('khách chưa đăng nhập → 401, service không bị gọi', async () => {
    mine.mockClear();
    expect((await get('')).status).toBe(401);
    expect(mine).not.toHaveBeenCalled();
  });

  it('có token → 200, private no-store, service nhận sub của token', async () => {
    mine.mockClear();
    const res = await get('', 'u1');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ enabled: true, items: [{ variationId: 'v-u1', productId: 'p1' }] });
    expect(mine).toHaveBeenCalledWith('u1');
  });

  it('?userId=khác bị bỏ qua: chỉ đọc đăng ký của sub trong JWT', async () => {
    mine.mockClear();
    await get('?userId=u-victim', 'u-other');
    expect(mine).toHaveBeenCalledTimes(1);
    expect(mine).toHaveBeenCalledWith('u-other');
  });
});
