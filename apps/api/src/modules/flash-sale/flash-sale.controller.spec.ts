import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { SessionStateService } from '../auth/session-state.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { FlashSaleController } from './flash-sale.controller';
import { FlashSaleService } from './flash-sale.service';

const handler = (name: keyof FlashSaleController) => FlashSaleController.prototype[name] as unknown as object;
const isPublic = (name: keyof FlashSaleController) => Reflect.getMetadata(IS_PUBLIC_KEY, handler(name)) === true;

describe('FlashSaleController — /upcoming công khai (khách chưa đăng nhập xem được khung sắp tới)', () => {
  it('upcoming: @Public + OptionalJwtAuthGuard (có phiên thì biết khách, token hỏng/hết hạn thành khách chứ không 401) + private, no-store', () => {
    expect(isPublic('upcoming')).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler('upcoming'))).toContain(OptionalJwtAuthGuard);
    const headers = Reflect.getMetadata(HEADERS_METADATA, handler('upcoming')) as { name: string; value: string }[];
    expect(headers.find((h) => h.name.toLowerCase() === 'cache-control')?.value).toBe('private, no-store');
  });

  it('nhắc / huỷ nhắc vẫn cần đăng nhập (không @Public)', () => {
    expect(isPublic('remind')).toBe(false);
    expect(isPublic('cancelRemind')).toBe(false);
  });

  it('upcoming chuyển userId (hoặc undefined khi khách) cho listUpcoming', async () => {
    const svc = { listUpcoming: jest.fn().mockResolvedValue([]) };
    const ctl = new FlashSaleController(svc as unknown as FlashSaleService);
    await ctl.upcoming('u1');
    await ctl.upcoming(undefined);
    expect(svc.listUpcoming.mock.calls).toEqual([['u1'], [undefined]]);
  });
});

const SECRET = 'flash-sale-controller-test-secret';

describe('GET /flash-sales/upcoming qua JwtAuthGuard toàn app + OptionalJwtAuthGuard (HTTP thật)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  const findMany = jest.fn();

  const row = (reminders: { id: string }[]) => ({
    id: 'fi1', variationId: 'v1', flashPrice: 80000,
    flashSale: { startAt: new Date('2026-07-05T12:00:00Z') },
    variation: { productId: 'p1', retailPrice: 100000, salePrice: null, product: { slug: 'a', name: 'A', thumbnail: null } },
    reminders,
  });

  beforeAll(async () => {
    // Giả lập DB đúng như Prisma: chỉ khi truy vấn xin `reminders` (tức có userId) mới có nhắc, và nhắc của 'u-reminded' là có thật.
    findMany.mockImplementation(async (args: { include: { reminders?: { where: { userId: string } } } }) => [
      row(args.include.reminders?.where.userId === 'u-reminded' ? [{ id: 'r1' }] : []),
    ]);
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    const service = new FlashSaleService(prisma, {} as never, {} as never, {} as never);
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [FlashSaleController],
      providers: [
        JwtStrategy,
        // Cùng guard mặc định toàn app như app.module: route quên @Public sẽ trả 401 cho khách.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: FlashSaleService, useValue: service },
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

  const upcoming = async (authorization?: string) => {
    const res = await fetch(`${base}/flash-sales/upcoming`, { headers: authorization ? { authorization } : {} });
    return { status: res.status, cache: res.headers.get('cache-control'), body: (await res.json()) as { itemId: string; reminded: boolean }[] };
  };

  it('không có Authorization → 200, reminded=false, private no-store, truy vấn không xin nhắc', async () => {
    findMany.mockClear();
    const r = await upcoming();
    expect(r.status).toBe(200);
    expect(r.cache).toBe('private, no-store');
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ itemId: 'fi1', reminded: false });
    expect(findMany.mock.calls[0]![0].include).not.toHaveProperty('reminders');
  });

  it.each(['Bearer not-a-jwt', 'Bearer ', 'Basic abc'])('Authorization hỏng (%s) → coi như khách: 200, reminded=false', async (header) => {
    const r = await upcoming(header);
    expect(r.status).toBe(200);
    expect(r.cache).toBe('private, no-store');
    expect(r.body[0]).toMatchObject({ reminded: false });
  });

  it('token hết hạn → coi như khách, không 401', async () => {
    const expired = jwt.sign({ sub: 'u-reminded', role: 'CUSTOMER' }, { expiresIn: '-10s' });
    const r = await upcoming(`Bearer ${expired}`);
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ reminded: false });
  });

  it('token hợp lệ → biết khách: reminded phản ánh nhắc của đúng khách đó', async () => {
    const token = (sub: string) => `Bearer ${jwt.sign({ sub, role: 'CUSTOMER' })}`;
    expect((await upcoming(token('u-reminded'))).body[0]).toMatchObject({ reminded: true });
    expect((await upcoming(token('u-other'))).body[0]).toMatchObject({ reminded: false });
  });

  it('đặt nhắc vẫn cần đăng nhập: không token → 401', async () => {
    const res = await fetch(`${base}/flash-sales/items/fi1/remind`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
