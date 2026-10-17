import { BadRequestException } from '@nestjs/common';
import { assertFirstOrderInTx, FIRST_ORDER_LOCK, hasPriorOrder, priorOrderWhere } from './first-order';

describe('first-order: khách mới = chưa có đơn nào ngoài đơn đã huỷ', () => {
  it('đếm mọi trạng thái trừ CANCELLED, theo đúng userId', () => {
    expect(priorOrderWhere('u1')).toEqual({ userId: 'u1', status: { not: 'CANCELLED' } });
  });

  it('loại các đơn của chính lần đặt đang ghi (id và nhóm tách đơn)', () => {
    expect(priorOrderWhere('u1', { orderIds: ['o1', 'o2'], checkoutGroup: 'DH1' })).toEqual({
      userId: 'u1',
      status: { not: 'CANCELLED' },
      id: { notIn: ['o1', 'o2'] },
      // checkoutGroup NULL phải còn được đếm: `<> 'DH1'` trong SQL bỏ qua dòng NULL.
      OR: [{ checkoutGroup: null }, { checkoutGroup: { not: 'DH1' } }],
    });
  });

  it('hasPriorOrder: có một đơn khớp → true; không có → false', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 'o9' }).mockResolvedValueOnce(null);
    const db = { order: { findFirst } };
    await expect(hasPriorOrder(db, 'u1')).resolves.toBe(true);
    await expect(hasPriorOrder(db, 'u1')).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledWith({ where: priorOrderWhere('u1'), select: { id: true } });
  });

  it('assertFirstOrderInTx: khoá theo khách TRƯỚC khi đọc đơn, rồi từ chối khi đã có đơn khác', async () => {
    const calls: string[] = [];
    const tx = {
      $executeRaw: jest.fn().mockImplementation(() => {
        calls.push('lock');
        return Promise.resolve(0);
      }),
      order: {
        findFirst: jest.fn().mockImplementation(() => {
          calls.push('read');
          return Promise.resolve({ id: 'other' });
        }),
      },
    };
    const err = await assertFirstOrderInTx(tx as never, 'u1', { orderIds: ['o1'] }, 'Đã có đơn.').catch((e: Error) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe('Đã có đơn.');
    expect(calls).toEqual(['lock', 'read']);
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([FIRST_ORDER_LOCK, 'u1']);
    expect(tx.order.findFirst.mock.calls[0][0].where).toEqual(priorOrderWhere('u1', { orderIds: ['o1'] }));
  });

  it('assertFirstOrderInTx: chưa có đơn nào khác → qua', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(0), order: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(assertFirstOrderInTx(tx as never, 'u1', { orderIds: ['o1'] }, 'x')).resolves.toBeUndefined();
  });
});
