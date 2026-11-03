import {
  ATTENTION_COD_RETURN_UNVERIFIED,
  ATTENTION_PARTIAL_RETURN_ACK,
  flagPancakeAttention,
  removeAttentionReason,
  removeAttentionReasonsByPrefix,
  writePancakeAttention,
} from './pancake-attention';
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

  it('onlyReplacingPrefix: ô đã nối dòng COD sau tiền tố thì không bị ghi đè', async () => {
    const mixed = `Tổng tiền lệch: A | ${ATTENTION_COD_RETURN_UNVERIFIED}`;
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeAttention: mixed })]);
    expect(await writePancakeAttention(prisma as never, 'o1', 'Tổng tiền lệch: B', 'Tổng tiền lệch')).toBeNull();
    expect(row().pancakeAttention).toBe(mixed);
    const plain = fakeOrderDb([baseOrder({ pancakeAttention: 'Tổng tiền lệch: A' })]);
    expect(await writePancakeAttention(plain.prisma as never, 'o1', 'Tổng tiền lệch: B', 'Tổng tiền lệch')).toBe('Tổng tiền lệch: B');
  });

  it('onlyOpenOrder: đơn đã huỷ/trả thì không ghi, đơn còn mở thì ghi', async () => {
    const closed = fakeOrderDb([baseOrder({ status: 'RETURNED', pancakeAttention: null })]);
    expect(await writePancakeAttention(closed.prisma as never, 'o1', 'A', undefined, true)).toBeNull();
    expect(closed.row().pancakeAttention).toBeNull();
    const open = fakeOrderDb([baseOrder({ status: 'DELIVERED', pancakeAttention: null })]);
    expect(await writePancakeAttention(open.prisma as never, 'o1', 'A', undefined, true)).toBe('A');
  });
});

describe('gỡ lý do khi ô đổi liên tục (mọi lần ghi có điều kiện đều thua)', () => {
  const stuckDb = () => ({
    order: {
      findUnique: jest.fn().mockResolvedValue({ pancakeAttention: `${ATTENTION_COD_RETURN_UNVERIFIED} | X` }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  });

  it('removeAttentionReason (tx của Kế toán) ném lỗi để tx rollback, không để dòng COD kẹt lại sau khi đã chốt khoản', async () => {
    const db = stuckDb();
    await expect(removeAttentionReason(db as never, 'o1', ATTENTION_COD_RETURN_UNVERIFIED)).rejects.toThrow('Cần xử lý Pancake');
    expect(db.order.updateMany).toHaveBeenCalledTimes(10);
  });

  it('removeAttentionReasonsByPrefix (dọn việc best-effort sau khi đóng đơn) chỉ ghi log, không ném', async () => {
    const db = stuckDb();
    await expect(removeAttentionReasonsByPrefix(db as never, 'o1', ['X'])).resolves.toBeUndefined();
  });
});

