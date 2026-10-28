import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionStateService } from '../auth/session-state.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { SystemConfigService } from '../system-config/system-config.service';
import { GroupBuyController } from './groupbuy.controller';
import { GroupBuyService } from './groupbuy.service';

const SECRET = 'groupbuy-controller-test-secret';
const MEMBER = 'cmuserowner5678';
const OUTSIDER = 'cmuseroutsider9';

/** Nhóm đã đủ người; MEMBER là thành viên, OUTSIDER và khách thì không. */
function fakePrisma() {
  return {
    groupBuy: {
      findUnique: async ({ include }: { include: { members: false | { where: { userId: string } } } }) => ({
        id: 'cmgroupdone1234',
        productId: 'prod1',
        initiatorId: 'someone',
        targetSize: 3,
        currentSize: 3,
        unitPrice: 85000,
        basePrice: 100000,
        status: 'SUCCESS',
        expiresAt: new Date(Date.now() + 3600_000),
        product: { name: 'Nước rửa chén', slug: 'nuoc-rua-chen', thumbnail: null },
        _count: { members: 3 },
        ...(include.members && include.members.where.userId === MEMBER ? { members: [{ id: 'm1' }] } : include.members ? { members: [] } : {}),
      }),
    },
    variation: { findMany: async () => [] },
  };
}

describe('GET /group-buy/:id (link mời mua chung)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [GroupBuyController],
      providers: [
        GroupBuyService,
        JwtStrategy,
        // Cùng guard mặc định toàn app như app.module: route quên @Public sẽ trả 401 cho khách.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: PrismaService, useValue: fakePrisma() },
        { provide: SystemConfigService, useValue: { get: async (_k: string, fb: unknown) => fb } },
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

  const get = async (authorization?: string) => {
    const res = await fetch(`${base}/group-buy/cmgroupdone1234`, { headers: authorization ? { authorization } : {} });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const bearer = (sub: string) => `Bearer ${jwt.sign({ sub, role: 'CUSTOMER' })}`;

  it('khách chưa đăng nhập xem được nhóm, không có mã giảm', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 'cmgroupdone1234', joined: false, isOwner: false, status: 'SUCCESS' });
    expect(r.body).not.toHaveProperty('couponCode');
  });

  it('token hỏng được coi như khách: vẫn xem được, không có mã', async () => {
    const r = await get('Bearer not-a-jwt');
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('couponCode');
  });

  it('người đã đăng nhập nhưng chưa tham gia không thấy mã', async () => {
    const r = await get(bearer(OUTSIDER));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ joined: false });
    expect(r.body).not.toHaveProperty('couponCode');
  });

  it('thành viên của nhóm đủ người nhận đúng mã của mình', async () => {
    const r = await get(bearer(MEMBER));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ joined: true, couponCode: 'GBUY-DONE1234-WNER5678' });
  });
});
