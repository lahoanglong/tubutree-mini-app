import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { buildAdminOrderWhere, recyclingAttentionWhere } from './admin-order-filter';
import type { PrismaService } from '../../prisma/prisma.service';
import { ATTENTION_COD_RETURN_UNVERIFIED } from '../integrations/pancake/pancake-attention';

const noOpenCod = { findFirst: jest.fn().mockResolvedValue(null) };

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

  it('"Đã xử lý" → xoá lý do + mốc (rời hàng đợi), chỉ khi đơn đang trong hàng đợi; ghi một dòng lịch sử đơn cùng trạng thái', async () => {
    const order = { id: 'o1', code: 'TUBU1', status: 'SHIPPING', pancakeAttention: 'Pancake báo ĐANG HOÀN', pancakeAttentionAt: new Date() };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const history = jest.fn().mockResolvedValue({});
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany }, orderCustomerRefund: noOpenCod, orderStatusHistory: { create: history } };
    const res = await mkAdmin(prisma).resolvePancakeAttention('admin1', 'TUBU1', '  đã gọi khách  ');
    expect(history).toHaveBeenCalledWith({
      data: {
        orderId: 'o1',
        fromStatus: 'SHIPPING',
        toStatus: 'SHIPPING',
        actorType: 'ADMIN',
        actorId: 'admin1',
        note: 'Đã xử lý việc Pancake: Pancake báo ĐANG HOÀN — đã gọi khách',
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', pancakeAttentionAt: { not: null }, pancakeAttention: 'Pancake báo ĐANG HOÀN' },
      data: { pancakeAttention: null, pancakeAttentionAt: null },
    });
    expect(res).toEqual({ ok: true, message: expect.stringContaining('TUBU1') });
  });

  it('"Đã xử lý" không ghi chú thì dòng lịch sử chỉ có lý do cũ; ghi lịch sử lỗi không làm hỏng việc đã đóng', async () => {
    const order = { id: 'o1', code: 'TUBU1', status: 'CONFIRMED', pancakeAttention: 'Pancake báo đơn bị xoá', pancakeAttentionAt: new Date() };
    const history = jest.fn().mockRejectedValue(new Error('db down'));
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, orderCustomerRefund: noOpenCod, orderStatusHistory: { create: history } };
    const admin = mkAdmin(prisma);
    jest.spyOn((admin as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
    await expect(admin.resolvePancakeAttention('admin1', 'TUBU1')).resolves.toMatchObject({ ok: true });
    expect(history.mock.calls[0][0].data.note).toBe('Đã xử lý việc Pancake: Pancake báo đơn bị xoá');
  });

  it.each(['CANCELLED', 'RETURNED'])(
    'đơn %s chưa có mốc đảo sau huỷ/trả: vẫn đóng việc và vẫn ghi dòng lịch sử cùng trạng thái (resync bỏ qua dòng fromStatus = toStatus)',
    async (status) => {
      const order = { id: 'o1', code: 'TUBU1', status, reversalEffectsAt: null, pancakeAttention: 'Pancake báo ĐANG HOÀN', pancakeAttentionAt: new Date() };
      const history = jest.fn().mockResolvedValue({});
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany }, orderCustomerRefund: noOpenCod, orderStatusHistory: { create: history } };
      const admin = mkAdmin(prisma);
      jest.spyOn((admin as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
      await expect(admin.resolvePancakeAttention('admin1', 'TUBU1', 'đã gọi khách')).resolves.toMatchObject({ ok: true });
      expect(updateMany).toHaveBeenCalled();
      expect(history).toHaveBeenCalledTimes(1);
    },
  );

  it('đơn CANCELLED đã có mốc đảo sau huỷ/trả thì vẫn ghi dòng lịch sử như thường', async () => {
    const order = { id: 'o1', code: 'TUBU1', status: 'CANCELLED', reversalEffectsAt: new Date(), pancakeAttention: 'Pancake báo đơn bị xoá', pancakeAttentionAt: new Date() };
    const history = jest.fn().mockResolvedValue({});
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, orderCustomerRefund: noOpenCod, orderStatusHistory: { create: history } };
    await mkAdmin(prisma).resolvePancakeAttention('admin1', 'TUBU1');
    expect(history).toHaveBeenCalledTimes(1);
    expect(history.mock.calls[0][0].data).toMatchObject({ fromStatus: 'CANCELLED', toStatus: 'CANCELLED', actorType: 'ADMIN' });
  });

  it('đơn không còn trong hàng đợi (updateMany 0) thì không ghi lịch sử', async () => {
    const order = { id: 'o1', code: 'TUBU1', status: 'CONFIRMED', pancakeAttention: 'x', pancakeAttentionAt: new Date() };
    const history = jest.fn();
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, orderCustomerRefund: noOpenCod, orderStatusHistory: { create: history } };
    await expect(mkAdmin(prisma).resolvePancakeAttention('a', 'TUBU1')).rejects.toBeInstanceOf(BadRequestException);
    expect(history).not.toHaveBeenCalled();
  });

  it('lý do COD trả hàng chưa thu: còn khoản chờ kế toán đối soát thì "Đã xử lý" bị chặn (nhân viên kho không đóng được việc hoàn tiền)', async () => {
    const order = { id: 'o1', code: 'TUBU1', pancakeAttention: ATTENTION_COD_RETURN_UNVERIFIED, pancakeAttentionAt: new Date() };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue({ id: 'r1' });
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany }, orderCustomerRefund: { findFirst }, orderStatusHistory: { create: jest.fn().mockResolvedValue({}) } };
    await expect(mkAdmin(prisma).resolvePancakeAttention('kho1', 'TUBU1')).rejects.toThrow('Hoàn tiền khách');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 'o1', kind: 'RETURN', refKey: { in: ['cod-return-unverified', 'pancake-partial-return-held'] }, status: 'UNVERIFIED' } }));
    expect(updateMany).not.toHaveBeenCalled();

    findFirst.mockResolvedValue(null);
    await expect(mkAdmin(prisma).resolvePancakeAttention('kho1', 'TUBU1')).resolves.toMatchObject({ ok: true });
    expect(updateMany).toHaveBeenCalled();
  });

  it('khoản COD chờ Kế toán còn mở mà ô Cần xử lý không còn chữ COD (bị ghi đè): vẫn chặn "Đã xử lý"', async () => {
    const order = { id: 'o1', code: 'TUBU1', pancakeAttention: 'Pancake báo ĐANG HOÀN', pancakeAttentionAt: new Date() };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue({ id: 'r1' });
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany }, orderCustomerRefund: { findFirst }, orderStatusHistory: { create: jest.fn() } };
    await expect(mkAdmin(prisma).resolvePancakeAttention('kho1', 'TUBU1')).rejects.toThrow('Hoàn tiền khách');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('ô đã đổi giữa lúc đọc và lúc xoá (webhook nối dòng COD): lệnh xoá khớp theo giá trị đã đọc nên không xoá dòng mới', async () => {
    const order = { id: 'o1', code: 'TUBU1', status: 'SHIPPING', pancakeAttention: 'Pancake báo ĐANG HOÀN', pancakeAttentionAt: new Date() };
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(order), updateMany }, orderCustomerRefund: noOpenCod, orderStatusHistory: { create: jest.fn() } };
    await expect(mkAdmin(prisma).resolvePancakeAttention('kho1', 'TUBU1')).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ pancakeAttention: 'Pancake báo ĐANG HOÀN' });
  });

  it('ô đổi giữa lúc đọc và lúc xoá mà đơn vẫn còn trong hàng đợi: báo "vừa thay đổi", không nói đã rời hàng đợi', async () => {
    const before = { id: 'o1', code: 'TUBU1', status: 'SHIPPING', pancakeAttention: 'Pancake báo ĐANG HOÀN', pancakeAttentionAt: new Date() };
    const after = { pancakeAttentionAt: new Date() };
    const findFirst = jest.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const prisma = { order: { findFirst, updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, orderCustomerRefund: noOpenCod, orderStatusHistory: { create: jest.fn() } };
    await expect(mkAdmin(prisma).resolvePancakeAttention('kho1', 'TUBU1')).rejects.toThrow(/vừa thay đổi/);
    const gone = jest.fn().mockResolvedValueOnce(before).mockResolvedValueOnce({ pancakeAttentionAt: null });
    const prisma2 = { order: { findFirst: gone, updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, orderCustomerRefund: noOpenCod, orderStatusHistory: { create: jest.fn() } };
    await expect(mkAdmin(prisma2).resolvePancakeAttention('kho1', 'TUBU1')).rejects.toThrow(/không còn trong hàng đợi/);
  });

  it('đơn không còn trong hàng đợi → 400; đơn không tồn tại → 404', async () => {
    const free = { id: 'o1', code: 'TUBU1', pancakeAttention: null, pancakeAttentionAt: null };
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(free), updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, orderCustomerRefund: noOpenCod };
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
