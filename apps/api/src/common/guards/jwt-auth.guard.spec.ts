import { Controller, Get, UseGuards, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { SessionStateService, type SessionState } from '../../modules/auth/session-state.service';
import { JwtStrategy } from '../../modules/auth/strategies/jwt.strategy';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'jwt-guard-test-secret';
const sessions: Record<string, SessionState> = {
  u1: { role: 'CUSTOMER', isBlocked: false },
  'u-blocked': { role: 'CUSTOMER', isBlocked: true },
};

@Controller('probe')
@UseGuards(JwtAuthGuard)
class ProbeController {
  @Get()
  who(@CurrentUser('sub') sub: string) {
    return { sub };
  }

  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }
}

describe('JwtAuthGuard — lỗi 401 bằng tiếng Việt (D8-3)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [ProbeController],
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: { get: () => SECRET } },
        { provide: SessionStateService, useValue: { get: async (id: string) => sessions[id] ?? null } },
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

  const call = async (path: string, authorization?: string) => {
    const res = await fetch(`${base}/probe${path}`, { headers: authorization ? { authorization } : {} });
    return { status: res.status, body: (await res.json()) as { message?: string; code?: string; statusCode?: number; error?: string; sub?: string } };
  };

  it.each([
    ['không có Authorization', undefined],
    ['token rác', 'Bearer not-a-jwt'],
    ['token hết hạn', `Bearer ${new JwtService({ secret: SECRET }).sign({ sub: 'u1' }, { expiresIn: -10 })}`],
  ])('%s → 401, thông điệp tiếng Việt, vẫn giữ statusCode 401', async (_label, auth) => {
    const { status, body } = await call('', auth);
    expect(status).toBe(401);
    expect(body.statusCode).toBe(401);
    expect(body.message).toBe('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
    expect(body.code).toBe('SESSION_EXPIRED');
  });

  it('thông điệp riêng của chiến lược (tài khoản bị khoá) không bị ghi đè', async () => {
    const { status, body } = await call('', `Bearer ${jwt.sign({ sub: 'u-blocked' })}`);
    expect(status).toBe(401);
    expect(body.message).toBe('Tài khoản đã bị khoá.');
    expect(body.code).toBe('ACCOUNT_BLOCKED');
  });

  it('token hợp lệ → 200; route @Public không cần token', async () => {
    expect(await call('', `Bearer ${jwt.sign({ sub: 'u1', role: 'CUSTOMER' })}`)).toEqual({ status: 200, body: { sub: 'u1' } });
    expect(await call('/open')).toEqual({ status: 200, body: { ok: true } });
  });
});
