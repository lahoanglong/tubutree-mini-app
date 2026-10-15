import { Controller, Get, UseGuards, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { SessionStateService, type SessionState } from '../../modules/auth/session-state.service';
import { JwtStrategy } from '../../modules/auth/strategies/jwt.strategy';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

const SECRET = 'optional-guard-test-secret';
// JwtStrategy đọc role/trạng thái khoá từ DB qua SessionStateService (ADMINOPS-1); u-blocked là tài khoản đã bị khoá.
const sessions: Record<string, SessionState> = {
  u1: { role: 'CUSTOMER', isBlocked: false },
  'u-blocked': { role: 'CUSTOMER', isBlocked: true },
};

@Controller('probe')
class ProbeController {
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  who(@CurrentUser('sub') sub?: string) {
    return { sub: sub ?? null };
  }
}

describe('OptionalJwtAuthGuard', () => {
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

  const call = async (authorization?: string) => {
    const res = await fetch(`${base}/probe`, { headers: authorization ? { authorization } : {} });
    return { status: res.status, body: (await res.json()) as { sub: string | null } };
  };

  it('có Bearer hợp lệ → controller thấy user', async () => {
    const token = jwt.sign({ sub: 'u1', role: 'CUSTOMER' });
    expect(await call(`Bearer ${token}`)).toEqual({ status: 200, body: { sub: 'u1' } });
  });

  it('không có Authorization → 200 như khách', async () => {
    expect(await call()).toEqual({ status: 200, body: { sub: null } });
  });

  it('token rác → 200 như khách, không 401', async () => {
    expect(await call('Bearer not-a-jwt')).toEqual({ status: 200, body: { sub: null } });
  });

  it('token của tài khoản đã bị khoá → 200 như khách, không lộ user', async () => {
    const token = jwt.sign({ sub: 'u-blocked', role: 'CUSTOMER' });
    expect(await call(`Bearer ${token}`)).toEqual({ status: 200, body: { sub: null } });
  });

  it('token hết hạn → 200 như khách, không 401', async () => {
    const token = jwt.sign({ sub: 'u1' }, { expiresIn: -10 });
    expect(await call(`Bearer ${token}`)).toEqual({ status: 200, body: { sub: null } });
  });
});
