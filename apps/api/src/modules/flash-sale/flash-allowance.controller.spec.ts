import 'reflect-metadata';
import { BadRequestException, type INestApplication } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SessionStateService } from '../auth/session-state.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { FlashAllowanceController } from './flash-allowance.controller';
import { FlashAllowanceService } from './flash-allowance.service';

const handler = FlashAllowanceController.prototype.allowance as unknown as object;

describe('FlashAllowanceController — số theo khách, không cache chung', () => {
  it('không @Public (khách chưa đăng nhập bị JwtAuthGuard toàn app chặn) và private, no-store', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).not.toBe(true);
    const headers = Reflect.getMetadata(HEADERS_METADATA, handler) as { name: string; value: string }[];
    expect(headers.find((h) => h.name.toLowerCase() === 'cache-control')?.value).toBe('private, no-store');
  });

  it('chuyển userId của JWT và danh sách id đã kiểm cho service; id sai thì 400 và không gọi service', async () => {
    const svc = { forUser: jest.fn().mockResolvedValue({ items: {} }) };
    const ctl = new FlashAllowanceController(svc as unknown as FlashAllowanceService);
    await ctl.allowance('u1', 'a,b,a');
    expect(svc.forUser).toHaveBeenCalledWith('u1', ['a', 'b']);
    svc.forUser.mockClear();
    expect(() => ctl.allowance('u1', 'a b')).toThrow(BadRequestException);
    expect(svc.forUser).not.toHaveBeenCalled();
  });
});

const SECRET = 'flash-allowance-controller-test-secret';

describe('GET /flash-sales/me/allowance qua JwtAuthGuard toàn app (HTTP thật)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  const forUser = jest.fn();

  beforeAll(async () => {
    forUser.mockImplementation(async (userId: string) => ({ items: { fi1: { perUserLeft: userId === 'u-spent' ? 0 : 2, allowance: userId === 'u-spent' ? 0 : 2 } } }));
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [FlashAllowanceController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: FlashAllowanceService, useValue: { forUser } },
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
    fetch(`${base}/flash-sales/me/allowance${query}`, { headers: sub ? { authorization: `Bearer ${jwt.sign({ sub, role: 'CUSTOMER' })}` } : {} });

  it('khách chưa đăng nhập → 401, service không bị gọi', async () => {
    forUser.mockClear();
    expect((await get('?items=fi1')).status).toBe(401);
    expect(forUser).not.toHaveBeenCalled();
  });

  it('có token → 200, private no-store, service nhận sub của token', async () => {
    forUser.mockClear();
    const res = await get('?items=fi1', 'u-spent');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ items: { fi1: { perUserLeft: 0, allowance: 0 } } });
    expect(forUser).toHaveBeenCalledWith('u-spent', ['fi1']);
  });

  it('?userId=khác bị bỏ qua: chỉ sub của JWT', async () => {
    forUser.mockClear();
    await get('?items=fi1&userId=u-spent', 'u-other');
    expect(forUser).toHaveBeenCalledWith('u-other', ['fi1']);
  });

  it.each(['', '?items=', '?items=a%20b', '?items=a&items=b'])('items sai (%j) → 400', async (query) => {
    forUser.mockClear();
    expect((await get(query, 'u1')).status).toBe(400);
    expect(forUser).not.toHaveBeenCalled();
  });
});
