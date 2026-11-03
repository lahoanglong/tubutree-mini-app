import { ATTENTION_COD_RETURN_UNVERIFIED, ATTENTION_PARTIAL_RETURN_ACK, flagPancakeAttention, writePancakeAttention } from './pancake-attention';
import { baseOrder, fakeOrderDb } from '../../../../test/fakes/pancake-order.fake';
import type { PrismaService } from '../../../prisma/prisma.service';

const WAYBILL = 'Pancake báo vận đơn GHN X1 cho đơn đã "Đã trả hàng" (đã hoàn tiền) — KHÔNG ghi lên đơn.';

describe('writePancakeAttention — một ô nhiều lý do (PNK-02)', () => {
  it('ô trống hoặc lý do thường: ghi đè như cũ', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeAttention: null })]);
    expect(await writePancakeAttention(prisma as never, 'o1', 'A')).toBe('A');
    expect(await writePancakeAttention(prisma as never, 'o1', 'B')).toBe('B');
    expect(row().pancakeAttention).toBe('B');
    expect(await writePancakeAttention(prisma as never, 'o1', 'B')).toBeNull();
  });

  it('ô đang giữ dòng COD chờ Kế toán: lý do mới nối sau, không làm mất dòng COD', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ status: 'RETURNED', pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED })]);
    expect(await writePancakeAttention(prisma as never, 'o1', WAYBILL)).toBe(`${ATTENTION_COD_RETURN_UNVERIFIED} | ${WAYBILL}`);
    expect(row().pancakeAttention).toBe(`${ATTENTION_COD_RETURN_UNVERIFIED} | ${WAYBILL}`);
    expect(await writePancakeAttention(prisma as never, 'o1', WAYBILL)).toBeNull();
    expect(await writePancakeAttention(prisma as never, 'o1', ATTENTION_PARTIAL_RETURN_ACK)).toBe(`${ATTENTION_COD_RETURN_UNVERIFIED} | ${WAYBILL} | ${ATTENTION_PARTIAL_RETURN_ACK}`);
  });

  it('flagPancakeAttention cũng giữ dòng COD và chỉ báo ADMIN khi có thay đổi', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED })]);
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    const order = { id: 'o1', code: 'TUBU1' };
    await flagPancakeAttention(prisma as unknown as PrismaService, alerts as never, order, WAYBILL);
    await flagPancakeAttention(prisma as unknown as PrismaService, alerts as never, order, WAYBILL);
    expect(row().pancakeAttention).toContain(ATTENTION_COD_RETURN_UNVERIFIED);
    expect(alerts.alert).toHaveBeenCalledTimes(1);
  });

  it('lý do đã nằm sau dòng COD ở vị trí khác (X | COD do order-status nối): ghi lại không đổi, không báo lại', async () => {
    const mixed = `${WAYBILL} | ${ATTENTION_COD_RETURN_UNVERIFIED}`;
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeAttention: mixed })]);
    expect(await writePancakeAttention(prisma as never, 'o1', WAYBILL)).toBeNull();
    expect(row().pancakeAttention).toBe(mixed);
  });

  it('onlyOpenOrder: đơn đã huỷ/trả thì không ghi, đơn còn mở thì ghi', async () => {
    const closed = fakeOrderDb([baseOrder({ status: 'RETURNED', pancakeAttention: null })]);
    expect(await writePancakeAttention(closed.prisma as never, 'o1', 'A', undefined, true)).toBeNull();
    expect(closed.row().pancakeAttention).toBeNull();
    const open = fakeOrderDb([baseOrder({ status: 'DELIVERED', pancakeAttention: null })]);
    expect(await writePancakeAttention(open.prisma as never, 'o1', 'A', undefined, true)).toBe('A');
  });
});
