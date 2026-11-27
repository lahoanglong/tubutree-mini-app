import { ConflictException } from '@nestjs/common';
import {
  ATTENTION_COD_RETURN_UNVERIFIED,
  ATTENTION_CUSTOMER_EDIT_MONEY_CHECK,
  ATTENTION_CUSTOMER_EDIT_PENDING,
  ATTENTION_PARTIAL_RETURN_ACK,
  ATTENTION_PUSH_FAILED,
  ATTENTION_PUSH_RETRYING,
  clearPancakeAttention,
  flagPancakeAttention,
  keepMoneyCheck,
  overwriteAttentionKeepingMoneyCheck,
  removeAttentionReason,
  removeAttentionReasonsByPrefix,
  stickyMoneyCheckParts,
  writePancakeAttention,
} from './pancake-attention';
import { baseOrder, fakeOrderDb } from '../../../../test/fakes/pancake-order.fake';
import type { PrismaService } from '../../../prisma/prisma.service';

const WAYBILL = 'Pancake báo vận đơn GHN X1 cho đơn đã "Đã trả hàng" (đã hoàn tiền) — KHÔNG ghi lên đơn.';

describe('writePancakeAttention — lời "Chưa đẩy được đơn sang Pancake" chỉ ghi cho đơn CHƯA lên Pancake', () => {
  const failed = `${ATTENTION_PUSH_FAILED} (kho chưa thấy đơn): Pancake trả 422. Thử lại không tự hết lỗi.`;

  it('đơn đã có mã Pancake (đẩy xong chen giữa lúc đọc và lúc gắn): không ghi, không báo admin', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeOrderId: 'pk-1', pancakePushStatus: 'SYNCED' })]);
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    await flagPancakeAttention(prisma as unknown as PrismaService, alerts as never, { id: 'o1', code: 'TUBU1' }, failed);
    expect(row().pancakeAttention ?? null).toBeNull();
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('ô đang có lý do khác mà đơn đã lên Pancake: không ghi, không lặp vòng đọc-ghi, ô giữ nguyên', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeOrderId: 'pk-1', pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED })]);
    expect(await writePancakeAttention(prisma as never, 'o1', failed)).toBeNull();
    expect(row().pancakeAttention).toBe(ATTENTION_COD_RETURN_UNVERIFIED);
    expect(prisma.order.findUnique.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('đơn chưa lên Pancake: ghi như thường', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder()]);
    expect(await writePancakeAttention(prisma as never, 'o1', failed)).toBe(failed);
    expect(row().pancakeAttention).toBe(failed);
  });

  it('lý do loại khác (vận đơn, thanh toán chưa báo...) vẫn ghi cho đơn đã lên Pancake', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeOrderId: 'pk-1' })]);
    expect(await writePancakeAttention(prisma as never, 'o1', WAYBILL)).toBe(WAYBILL);
    expect(row().pancakeAttention).toBe(WAYBILL);
  });
});

describe('writePancakeAttention — lời "hệ thống tự thử lại" không bao giờ nằm trên đơn STALE (B1)', () => {
  const retrying = `${ATTENTION_PUSH_RETRYING}: Pancake trả 503. Hệ thống tự thử lại mỗi 15 phút; sửa nguyên nhân rồi bấm "Đẩy lại Pancake".`;
  const staleReminder = `${ATTENTION_PUSH_FAILED} (quá hạn tự đẩy) — lượt đẩy đang bay vừa lỗi: kiểm tra kho đã giao tay chưa; chưa thì bấm "Đẩy lại Pancake".`;

  it('đơn đã STALE (markOverdue chen giữa lúc đọc và lúc gắn): câu ghi từ chối, không báo admin, không lặp vòng đọc-ghi', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakePushStatus: 'STALE' })]);
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    await flagPancakeAttention(prisma as unknown as PrismaService, alerts as never, { id: 'o1', code: 'TUBU1' }, retrying);
    expect(row().pancakeAttention ?? null).toBeNull();
    expect(alerts.alert).not.toHaveBeenCalled();
    expect(prisma.order.findUnique.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('ô đang có lý do khác mà đơn STALE: lời "tự thử lại" không nối vào, ô giữ nguyên', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakePushStatus: 'STALE', pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED })]);
    expect(await writePancakeAttention(prisma as never, 'o1', retrying)).toBeNull();
    expect(row().pancakeAttention).toBe(ATTENTION_COD_RETURN_UNVERIFIED);
  });

  it('đơn chưa STALE (PENDING, null): ghi như thường', async () => {
    for (const status of [null, 'PENDING', 'FAILED']) {
      const { prisma, row } = fakeOrderDb([baseOrder({ pancakePushStatus: status })]);
      expect(await writePancakeAttention(prisma as never, 'o1', retrying)).toBe(retrying);
      expect(row().pancakeAttention).toBe(retrying);
    }
  });

  it('lời nhắc của đơn STALE ("quá hạn tự đẩy") và lý do loại khác vẫn ghi được lên đơn STALE', async () => {
    const a = fakeOrderDb([baseOrder({ pancakePushStatus: 'STALE' })]);
    expect(await writePancakeAttention(a.prisma as never, 'o1', staleReminder)).toBe(staleReminder);
    const b = fakeOrderDb([baseOrder({ pancakePushStatus: 'STALE' })]);
    expect(await writePancakeAttention(b.prisma as never, 'o1', WAYBILL)).toBe(WAYBILL);
  });

  it('STALE xuất hiện giữa vòng đọc-ghi (ô đang có lý do khác): vòng ghi lại cũng từ chối', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED })]);
    const find = prisma.order.findUnique.getMockImplementation()!;
    prisma.order.findUnique.mockImplementationOnce(async (args: Parameters<typeof find>[0]) => {
      const snapshot = await find(args);
      row().pancakePushStatus = 'STALE';
      return snapshot;
    });
    expect(await writePancakeAttention(prisma as never, 'o1', retrying)).toBeNull();
    expect(row().pancakeAttention).toBe(ATTENTION_COD_RETURN_UNVERIFIED);
  });
});

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
    // 409 chứ không phải 500: Kế toán chỉ cần bấm lại.
    await expect(removeAttentionReason(db as never, 'o1', ATTENTION_COD_RETURN_UNVERIFIED)).rejects.toBeInstanceOf(ConflictException);
    await expect(removeAttentionReason(db as never, 'o1', ATTENTION_COD_RETURN_UNVERIFIED)).rejects.toThrow('Ô Cần xử lý vừa đổi, bạn bấm lại nhé');
    expect(db.order.updateMany).toHaveBeenCalledTimes(20);
  });

  it('removeAttentionReasonsByPrefix (dọn việc best-effort sau khi đóng đơn) chỉ ghi log, không ném', async () => {
    const db = stuckDb();
    await expect(removeAttentionReasonsByPrefix(db as never, 'o1', ['X'])).resolves.toBeUndefined();
  });
});


describe('appendAttentionReason', () => {
  const { appendAttentionReason } = jest.requireActual<typeof import('./pancake-attention')>('./pancake-attention');
  it('ô trống → chính lý do; lý do mới → nối sau; lý do đã có → giữ nguyên cả ô, không bỏ lý do khác', () => {
    expect(appendAttentionReason(null, 'B')).toBe('B');
    expect(appendAttentionReason('A', 'B')).toBe('A | B');
    expect(appendAttentionReason('A | B', 'B')).toBe('A | B');
    expect(appendAttentionReason('B | A', 'B')).toBe('B | A');
  });
});

describe('W44 MINOR 2: phần kiểm tiền sau khi khách sửa địa chỉ không bị đường ghi/xoá nào làm mất', () => {
  const M = `${ATTENTION_CUSTOMER_EDIT_MONEY_CHECK} (#pk-1): cod 230.000đ→0đ. Sửa tay tiền theo đơn Tubu rồi giao.`;
  const M2 = `${ATTENTION_CUSTOMER_EDIT_MONEY_CHECK} (#pk-1): ship 19.000đ→25.000đ. Sửa tay tiền theo đơn Tubu rồi giao.`;
  const PENDING = `${ATTENTION_CUSTOMER_EDIT_PENDING} (#pk-1): còn thông tin cũ.`;
  const AT = new Date('2026-11-27T01:00:00.000Z');

  it('stickyMoneyCheckParts / keepMoneyCheck: giữ đúng các phần kiểm tiền, theo thứ tự, không trùng', () => {
    expect(stickyMoneyCheckParts(null)).toEqual([]);
    expect(stickyMoneyCheckParts(`A | ${M} | B | ${M2}`)).toEqual([M, M2]);
    expect(keepMoneyCheck('R', `A | ${M}`)).toBe(`R | ${M}`);
    expect(keepMoneyCheck(null, `A | ${M}`)).toBe(M);
    expect(keepMoneyCheck(null, 'A')).toBeNull();
    expect(keepMoneyCheck(`R | ${M}`, M)).toBe(`R | ${M}`);
    expect(keepMoneyCheck(M2, `${PENDING} | ${M}`)).toBe(`${M2} | ${M}`);
  });

  it('writePancakeAttention: lý do mới thay phần còn lại, phần kiểm tiền nối sau; ghi lại cùng lý do không đổi gì', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeAttention: M })]);
    expect(await writePancakeAttention(prisma as never, 'o1', 'R')).toBe(`R | ${M}`);
    expect(await writePancakeAttention(prisma as never, 'o1', 'R')).toBeNull();
    expect(await writePancakeAttention(prisma as never, 'o1', 'S')).toBe(`S | ${M}`);
    expect(row().pancakeAttention).toBe(`S | ${M}`);
  });

  it('flagPancakeAttention trên ô "còn thông tin cũ | kiểm tiền": báo ADMIN đúng một lần, phần kiểm tiền còn nguyên', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeAttention: `${PENDING} | ${M}` })]);
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
    const order = { id: 'o1', code: 'TUBU1' };
    await flagPancakeAttention(prisma as unknown as PrismaService, alerts as never, order, WAYBILL);
    await flagPancakeAttention(prisma as unknown as PrismaService, alerts as never, order, WAYBILL);
    expect(row().pancakeAttention).toBe(`${WAYBILL} | ${M}`);
    expect(alerts.alert).toHaveBeenCalledTimes(1);
  });

  it('ô đã là "lý do | kiểm tiền" mà lượt sau gửi đúng chuỗi ghép đó: không ghi, không báo lại', async () => {
    const { prisma } = fakeOrderDb([baseOrder({ pancakeAttention: `${PENDING} | ${M}` })]);
    expect(await writePancakeAttention(prisma as never, 'o1', `${PENDING} | ${M}`)).toBeNull();
    expect(await writePancakeAttention(prisma as never, 'o1', M)).toBeNull();
  });

  it('ô còn dòng COD chờ Kế toán và phần kiểm tiền: lý do mới nối sau, không mất phần nào', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeAttention: `${ATTENTION_COD_RETURN_UNVERIFIED} | ${M}` })]);
    expect(await writePancakeAttention(prisma as never, 'o1', 'R')).toBe(`${ATTENTION_COD_RETURN_UNVERIFIED} | ${M} | R`);
    expect(row().pancakeAttention).toBe(`${ATTENTION_COD_RETURN_UNVERIFIED} | ${M} | R`);
  });

  it('onlyReplacingPrefix: phần kiểm tiền không tính là lý do của job khác; lý do khác đứng đầu thì vẫn không đè', async () => {
    const own = fakeOrderDb([baseOrder({ pancakeAttention: `Tổng tiền lệch: A | ${M}` })]);
    expect(await writePancakeAttention(own.prisma as never, 'o1', 'Tổng tiền lệch: B', 'Tổng tiền lệch')).toBe(`Tổng tiền lệch: B | ${M}`);
    const onlyMoney = fakeOrderDb([baseOrder({ pancakeAttention: M })]);
    expect(await writePancakeAttention(onlyMoney.prisma as never, 'o1', 'Tổng tiền lệch: B', 'Tổng tiền lệch')).toBe(`Tổng tiền lệch: B | ${M}`);
    const other = fakeOrderDb([baseOrder({ pancakeAttention: `Khác | ${M}` })]);
    expect(await writePancakeAttention(other.prisma as never, 'o1', 'Tổng tiền lệch: B', 'Tổng tiền lệch')).toBeNull();
    expect(other.row().pancakeAttention).toBe(`Khác | ${M}`);
  });

  it('clearPancakeAttention: gỡ lý do đầu khớp tiền tố, giữ phần kiểm tiền và mốc giờ; ô không còn gì thì xoá cả mốc', async () => {
    const held = fakeOrderDb([baseOrder({ pancakeAttention: `${PENDING} | ${M}`, pancakeAttentionAt: AT })]);
    await clearPancakeAttention(held.prisma as never, 'o1', ATTENTION_CUSTOMER_EDIT_PENDING);
    expect(held.row()).toMatchObject({ pancakeAttention: M, pancakeAttentionAt: AT });
    await clearPancakeAttention(held.prisma as never, 'o1', ATTENTION_CUSTOMER_EDIT_PENDING);
    expect(held.row()).toMatchObject({ pancakeAttention: M, pancakeAttentionAt: AT });
    const plain = fakeOrderDb([baseOrder({ pancakeAttention: PENDING, pancakeAttentionAt: AT })]);
    await clearPancakeAttention(plain.prisma as never, 'o1', [ATTENTION_PUSH_FAILED, ATTENTION_CUSTOMER_EDIT_PENDING]);
    expect(plain.row()).toMatchObject({ pancakeAttention: null, pancakeAttentionAt: null });
    const other = fakeOrderDb([baseOrder({ pancakeAttention: `Khác | ${M}` })]);
    await clearPancakeAttention(other.prisma as never, 'o1', ATTENTION_CUSTOMER_EDIT_PENDING);
    expect(other.row().pancakeAttention).toBe(`Khác | ${M}`);
  });

  it('clearPancakeAttention: ô không khớp tiền tố thì chỉ đọc, không ghi', async () => {
    const { prisma } = fakeOrderDb([baseOrder({ pancakeAttention: null })]);
    await clearPancakeAttention(prisma as never, 'o1', ATTENTION_CUSTOMER_EDIT_PENDING);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('overwriteAttentionKeepingMoneyCheck (lệch tiền ZaloPay, tiền về muộn): đè phần còn lại, giữ phần kiểm tiền, báo đúng lần đổi', async () => {
    const { prisma, row } = fakeOrderDb([baseOrder({ pancakeAttention: null })]);
    expect(await overwriteAttentionKeepingMoneyCheck(prisma as never, 'o1', 'R')).toBe(true);
    expect(await overwriteAttentionKeepingMoneyCheck(prisma as never, 'o1', 'R')).toBe(false);
    expect(row().pancakeAttention).toBe('R');
    const money = fakeOrderDb([baseOrder({ pancakeAttention: `Cũ | ${M}` })]);
    expect(await overwriteAttentionKeepingMoneyCheck(money.prisma as never, 'o1', 'R')).toBe(true);
    expect(money.row().pancakeAttention).toBe(`R | ${M}`);
    expect(await overwriteAttentionKeepingMoneyCheck(money.prisma as never, 'o1', 'R')).toBe(false);
  });
});
