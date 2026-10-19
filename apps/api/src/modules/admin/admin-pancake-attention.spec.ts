import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { buildAdminOrderWhere, recyclingAttentionWhere } from './admin-order-filter';
import type { PrismaService } from '../../prisma/prisma.service';
import { ATTENTION_COD_RETURN_UNVERIFIED } from '../integrations/pancake/pancake-attention';

function mkAdmin(prisma: Record<string, unknown>) {
  const none = {} as never;
  return new AdminService(prisma as unknown as PrismaService, none, none, none, none, none, none, none, none, none);
}

describe('Hàng đợi "Cần xử lý Pancake" (admin)', () => {
  it('pancake=attention → đơn đang có lý do cần xử lý; ghép AND với status/search', () => {
    expect(buildAdminOrderWhere({ pancake: 'attention' })).toEqual({ pancakeAttentionAt: { not: null } });
    const where = buildAdminOrderWhere({ status: 'SHIPPING', pancake: 'attention' }) as { AND: unknown[] };
    expect(where.AND).toEqual([{ status: 'SHIPPING' }, { pancakeAttentionAt: { not: null } }]);
  });

  it('listOrders truyền bộ lọc pancake xuống where; count dùng cùng điều kiện (badge khớp danh sách)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      order: { findMany, count },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr)),
    };
    await mkAdmin(prisma).listOrders(1, 20, undefined, undefined, undefined, undefined, 'attention');
    expect(findMany.mock.calls[0][0].where).toEqual({ pancakeAttentionAt: { not: null } });
    expect(count).toHaveBeenCalledWith({ where: { pancakeAttentionAt: { not: null } } });
  });

  it('"Đã xử lý" → xoá lý do + mốc (rời hàng đợi), chỉ khi đơn đang trong hàng đợi', async () => {
    const order = { id: 'o1', code: 'TUBU1', pancakeAttention: 'Pancake báo ĐANG HOÀN', pancakeAttentionAt: new Date() };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany } };
    const res = await mkAdmin(prisma).resolvePancakeAttention('admin1', 'TUBU1', '  đã gọi khách  ');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', pancakeAttentionAt: { not: null } },
      data: { pancakeAttention: null, pancakeAttentionAt: null },
    });
    expect(res).toEqual({ ok: true, message: expect.stringContaining('TUBU1') });
  });

  it('lý do COD trả hàng chưa thu: còn khoản chờ kế toán đối soát thì "Đã xử lý" bị chặn (nhân viên kho không đóng được việc hoàn tiền)', async () => {
    const order = { id: 'o1', code: 'TUBU1', pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED, pancakeAttentionAt: new Date() };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue({ id: 'r1' });
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany }, orderCustomerRefund: { findFirst } };
    await expect(mkAdmin(prisma).resolvePancakeAttention('kho1', 'TUBU1')).rejects.toThrow('Hoàn tiền khách');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 'o1', kind: 'RETURN', refKey: 'cod-return-unverified', status: 'UNVERIFIED' } }));
    expect(updateMany).not.toHaveBeenCalled();

    findFirst.mockResolvedValue(null);
    await expect(mkAdmin(prisma).resolvePancakeAttention('kho1', 'TUBU1')).resolves.toMatchObject({ ok: true });
    expect(updateMany).toHaveBeenCalled();
  });

  it('đơn không còn trong hàng đợi → 400; đơn không tồn tại → 404', async () => {
    const free = { id: 'o1', code: 'TUBU1', pancakeAttention: null, pancakeAttentionAt: null };
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(free), updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    await expect(mkAdmin(prisma).resolvePancakeAttention('a', 'TUBU1')).rejects.toBeInstanceOf(BadRequestException);
    const missing = { order: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() } };
    await expect(mkAdmin(missing).resolvePancakeAttention('a', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('"Cần xử lý thu gom": Gomdon báo hoàn/hỏng SAU khi đơn đã chốt giao vẫn phải vào hàng đợi', () => {
  it('mã 6/8/9/12 (đang hoàn, đã hoàn, hỏng/mất, hoàn thất bại) giữ cả đơn DELIVERED; mã 2/10/11 chỉ khi đơn còn mở', () => {
    const or = (recyclingAttentionWhere().OR ?? []) as Record<string, unknown>[];
    expect(or).toContainEqual({ gomdonStatus: { in: ['6', '8', '9', '12'] }, status: { notIn: ['CANCELLED', 'RETURNED'] } });
    expect(or).toContainEqual({ gomdonStatus: { in: ['2', '10', '11'] }, status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } });
  });
});
