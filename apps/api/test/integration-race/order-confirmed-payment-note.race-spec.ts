import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { orderConfirmedData } from '../../src/modules/notifications/order-confirmed-data';
import { createUser, warmPool } from './helpers';

const OLD = 'Đơn {{order_code}} đã được xác nhận. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿';
const NEW = 'Đơn {{order_code}} đã được xác nhận.{{payment_note}} Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿';
const MIGRATION = readFileSync(join(__dirname, '../../prisma/migrations/20261030110000_order_confirmed_payment_note/migration.sql'), 'utf8');

describe('tin ORDER_CONFIRMED: câu đã nhận thanh toán (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: NotificationsService;
  let saved: { id: string; code: string; channel: string; zaloTemplateId: string | null; bodyTemplate: string } | null;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        { provide: AnalyticsEventsService, useValue: { recordBestEffort: jest.fn() } },
        { provide: ZnsClient, useValue: { sendTemplate: jest.fn() } },
        {
          provide: NotificationsService,
          inject: [PrismaService, ZnsClient, AnalyticsEventsService],
          useFactory: (p: PrismaService, z: ZnsClient, a: AnalyticsEventsService) => new NotificationsService(p, z, a),
        },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(NotificationsService);
    saved = await prisma.notificationTemplate.findUnique({ where: { code: 'ORDER_CONFIRMED' } });
  });

  afterAll(async () => {
    if (saved) await prisma.notificationTemplate.update({ where: { code: 'ORDER_CONFIRMED' }, data: { bodyTemplate: saved.bodyTemplate } });
    else await prisma.notificationTemplate.deleteMany({ where: { code: 'ORDER_CONFIRMED' } });
    await moduleRef?.close();
  });

  async function setBody(bodyTemplate: string) {
    await prisma.notificationTemplate.upsert({
      where: { code: 'ORDER_CONFIRMED' },
      create: { id: 'it-order-confirmed', code: 'ORDER_CONFIRMED', channel: 'ZNS', bodyTemplate },
      update: { bodyTemplate },
    });
  }
  const body = async () => (await prisma.notificationTemplate.findUniqueOrThrow({ where: { code: 'ORDER_CONFIRMED' } })).bodyTemplate;

  it('migration chỉ đổi khi thân còn là câu cũ', async () => {
    await setBody(OLD);
    await prisma.$executeRawUnsafe(MIGRATION);
    expect(await body()).toBe(NEW);
    await prisma.$executeRawUnsafe(MIGRATION);
    expect(await body()).toBe(NEW);
  });

  it('migration giữ nguyên chữ admin đã sửa', async () => {
    const custom = 'Đơn {{order_code}} đã xác nhận rồi nhé!';
    await setBody(custom);
    await prisma.$executeRawUnsafe(MIGRATION);
    expect(await body()).toBe(custom);
  });

  it('tin gửi thật: đơn đã trả có câu đã nhận đủ thanh toán, đơn COD giữ chữ cũ', async () => {
    await setBody(NEW);
    const paid = await createUser(prisma);
    const cod = await createUser(prisma);
    await svc.notify(paid.id, 'ORDER_CONFIRMED', orderConfirmedData({ code: 'IT-PAID', paymentStatus: 'PAID' }));
    await svc.notify(cod.id, 'ORDER_CONFIRMED', orderConfirmedData({ code: 'IT-COD', paymentStatus: 'UNPAID' }));
    const text = async (userId: string) => ((await prisma.notificationLog.findFirstOrThrow({ where: { userId, templateCode: 'ORDER_CONFIRMED' } })).payload as { body: string }).body;
    expect(await text(paid.id)).toBe('Đơn IT-PAID đã được xác nhận. Tubu Tree đã nhận đủ thanh toán. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿');
    expect(await text(cod.id)).toBe('Đơn IT-COD đã được xác nhận. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿');
  });
});
