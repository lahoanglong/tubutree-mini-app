import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ATTENTION_COD_RETURN_UNVERIFIED, removeAttentionReason, writePancakeAttention } from '../../src/modules/integrations/pancake/pancake-attention';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
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

  it('dòng không có mã Pancake (flagUnpushableLines) không xoá dòng COD chờ Kế toán', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'RETURNED',
      pancakeOrderId: `pk-${randCode(8)}`,
      pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED,
    });
    const flag = (PancakeOrderService.prototype as unknown as { flagUnpushableLines: (this: unknown, id: string, code: string, n: number, none: boolean) => Promise<void> }).flagUnpushableLines;
    await flag.call({ prisma, logger: { warn: jest.fn() } }, order.id, order.code, 1, false);
    const cell = await attentionOf(order.id);
    expect(cell).toContain(ATTENTION_COD_RETURN_UNVERIFIED);
    expect(cell).toContain('1 dòng không có mã Pancake');
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

  /** Bọc prisma.order: chạy `hook` ngay sau lần gọi `method` thứ nhất (chen một lần ghi khác vào giữa hai bước). */
  const interleave = (method: 'updateMany' | 'findUnique', hook: () => Promise<unknown>) => {
    let calls = 0;
    const order = new Proxy(prisma.order, {
      get(target, key) {
        const v = Reflect.get(target, key) as unknown;
        if (key !== method || typeof v !== 'function') return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        return async (args: unknown) => {
          const r = await (v as (a: unknown) => Promise<unknown>).call(target, args);
          if (++calls === 1) await hook();
          return r;
        };
      },
    });
    return { order } as unknown as Pick<PrismaService, 'order'>;
  };

  it('Kế toán gỡ dòng COD chen giữa lệnh ghi đầu và lần đọc lại: lý do mới vẫn được ghi', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'RETURNED', pancakeOrderId: `pk-${randCode(8)}`, pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED });
    const db = interleave('updateMany', () => prisma.$transaction((tx) => removeAttentionReason(tx, order.id, ATTENTION_COD_RETURN_UNVERIFIED)));
    await expect(writePancakeAttention(db, order.id, 'Vận đơn mới')).resolves.toBe('Vận đơn mới');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pancakeAttention).toBe('Vận đơn mới');
  });

  it('Kế toán gỡ dòng COD trong lúc webhook vừa nối lý do: lý do vừa nối không bị xoá theo', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'RETURNED', pancakeOrderId: `pk-${randCode(8)}`, pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED });
    const tx = interleave('findUnique', () => writePancakeAttention(prisma, order.id, 'Vận đơn mới'));
    await removeAttentionReason(tx, order.id, ATTENTION_COD_RETURN_UNVERIFIED);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pancakeAttention).toBe('Vận đơn mới');
  });

  it('sáu lần ghi đồng thời vào ô có dòng COD: không mất lý do nào, dòng COD còn nguyên', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'RETURNED', pancakeOrderId: `pk-${randCode(8)}`, pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED });
    const reasons = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
    await Promise.all(reasons.map((r) => writePancakeAttention(prisma, order.id, r)));
    const cell = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pancakeAttention ?? '';
    expect(cell.split(' | ')[0]).toBe(ATTENTION_COD_RETURN_UNVERIFIED);
    expect(cell.split(' | ').slice(1).sort()).toEqual(reasons);
  });
});
