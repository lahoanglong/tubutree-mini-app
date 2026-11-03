import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ATTENTION_COD_RETURN_UNVERIFIED, writePancakeAttention } from '../../src/modules/integrations/pancake/pancake-attention';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Ô "Cần xử lý Pancake" trên Postgres THẬT: NOT (NULL LIKE ..) ra NULL, nên ô trống từng làm mất mọi lần ghi (PNK-02),
 * và 15 tới trễ không được ghim lời "hoàn tay" lên đơn vừa bị huỷ/trả chen giữa lúc đọc và lúc ghi (PNK-01).
 */
describe('writePancakeAttention (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const attentionOf = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).pancakeAttention;

  it('ô trống: ghi được lý do đầu tiên, ghi lại cùng lý do thì không đổi', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'PACKED', pancakeOrderId: `pk-${randCode(8)}` });
    expect(await writePancakeAttention(prisma, order.id, 'A')).toBe('A');
    expect(await attentionOf(order.id)).toBe('A');
    expect(await writePancakeAttention(prisma, order.id, 'A')).toBeNull();
    expect(await writePancakeAttention(prisma, order.id, 'B')).toBe('B');
  });

  it('ô đang giữ dòng COD: lý do mới nối sau, dòng COD còn nguyên', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'RETURNED',
      pancakeOrderId: `pk-${randCode(8)}`,
      pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED,
    });
    expect(await writePancakeAttention(prisma, order.id, 'X')).toBe(`${ATTENTION_COD_RETURN_UNVERIFIED} | X`);
    expect(await writePancakeAttention(prisma, order.id, 'X')).toBeNull();
    expect(await attentionOf(order.id)).toBe(`${ATTENTION_COD_RETURN_UNVERIFIED} | X`);
  });

  it('Pancake báo 15 mà đơn bị huỷ/trả chen vào sau lúc đọc đơn: không ghim lời "hoàn tay"', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'DELIVERED', pancakeOrderId: `pk-${randCode(8)}` });
    const returnRequest = new Proxy(prisma.returnRequest, {
      get(target, key) {
        if (key !== 'findMany') return Reflect.get(target, key) as unknown;
        return async (args: Parameters<typeof prisma.returnRequest.findMany>[0]) => {
          const rows = await target.findMany(args);
          await prisma.order.update({ where: { id: order.id }, data: { status: 'RETURNED' } });
          return rows;
        };
      },
    });
    const racing = new Proxy(prisma, {
      get(target, key) {
        if (key === 'returnRequest') return returnRequest;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const proc = new PancakeProcessor(racing, {} as never, {} as never, alerts as never) as unknown as {
      onStatusUpdated(d: Record<string, unknown>): Promise<void>;
    };
    await proc.onStatusUpdated({ id: order.pancakeOrderId, status: 15 });
    expect(await attentionOf(order.id)).toBeNull();
    expect(alerts.alert).not.toHaveBeenCalled();
  });
});
