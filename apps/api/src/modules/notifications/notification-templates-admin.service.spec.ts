import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { NotificationTemplatesAdminService } from './notification-templates-admin.service';

const TPL = [
  { id: 'nt-confirmed', code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: null, bodyTemplate: 'Đơn {{order_code}} đã xác nhận.' },
  { id: 'nt-shipping', code: 'ORDER_SHIPPING', channel: 'ZNS', zaloTemplateId: '231570', bodyTemplate: 'Đơn {{order_code}} đang giao.' },
  { id: 'nt-streak', code: 'GAME_STREAK', channel: 'INAPP', zaloTemplateId: null, bodyTemplate: 'Giữ lửa chuỗi nhé' },
];

function setup() {
  const update = jest.fn(async ({ where, data }: { where: { code: string }; data: object }) => ({
    ...TPL.find((t) => t.code === where.code)!,
    ...data,
  }));
  const prisma = {
    notificationTemplate: {
      findMany: jest.fn().mockResolvedValue(TPL),
      findUnique: jest.fn(async ({ where }: { where: { code: string } }) => TPL.find((t) => t.code === where.code) ?? null),
      update,
    },
    notificationLog: {
      groupBy: jest.fn().mockResolvedValue([
        { templateCode: 'ORDER_CONFIRMED', channel: 'INAPP', _count: { _all: 40 } },
        { templateCode: 'ORDER_SHIPPING', channel: 'ZNS', _count: { _all: 12 } },
      ]),
    },
  } as unknown as PrismaService;
  return { svc: new NotificationTemplatesAdminService(prisma), update };
}

describe('NotificationTemplatesAdminService', () => {
  it('liệt kê template kèm trạng thái gửi thật: ZNS thiếu mã mẫu bị đánh dấu, số lượt gửi 30 ngày', async () => {
    const { svc } = setup();
    const rows = await svc.list();
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(byCode.ORDER_CONFIRMED).toMatchObject({ delivery: 'ZNS_MISSING_TEMPLATE_ID', sent30d: { INAPP: 40, ZNS: 0 } });
    expect(byCode.ORDER_SHIPPING).toMatchObject({ delivery: 'ZNS', sent30d: { INAPP: 0, ZNS: 12 } });
    expect(byCode.GAME_STREAK).toMatchObject({ delivery: 'INAPP' });
    expect(rows[0]!.code).toBe('ORDER_CONFIRMED');
  });

  it('điền mã mẫu ZNS (Zalo đã duyệt) → lưu, chuẩn hoá khoảng trắng', async () => {
    const { svc, update } = setup();
    await svc.update('ORDER_CONFIRMED', { zaloTemplateId: ' 231571 ' });
    expect(update).toHaveBeenCalledWith({ where: { code: 'ORDER_CONFIRMED' }, data: { zaloTemplateId: '231571' } });
  });

  it('chuyển INAPP → ZNS mà chưa có mã mẫu → 400 (ZNS không gửi được, admin tưởng đã bật)', async () => {
    const { svc, update } = setup();
    await expect(svc.update('GAME_STREAK', { channel: 'ZNS' })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('chuyển INAPP → ZNS kèm mã mẫu → lưu cả hai', async () => {
    const { svc, update } = setup();
    await svc.update('GAME_STREAK', { channel: 'ZNS', zaloTemplateId: '555001' });
    expect(update).toHaveBeenCalledWith({ where: { code: 'GAME_STREAK' }, data: { channel: 'ZNS', zaloTemplateId: '555001' } });
  });

  it('xoá mã mẫu của template đang ZNS → 400; chuyển về INAPP thì xoá được', async () => {
    const { svc, update } = setup();
    await expect(svc.update('ORDER_SHIPPING', { zaloTemplateId: '' })).rejects.toBeInstanceOf(BadRequestException);
    await svc.update('ORDER_SHIPPING', { channel: 'INAPP', zaloTemplateId: '' });
    expect(update).toHaveBeenCalledWith({ where: { code: 'ORDER_SHIPPING' }, data: { channel: 'INAPP', zaloTemplateId: null } });
  });

  it('mã mẫu không phải dãy số → 400', async () => {
    const { svc } = setup();
    await expect(svc.update('ORDER_CONFIRMED', { zaloTemplateId: 'abc-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nội dung trống → 400; template không tồn tại → 404', async () => {
    const { svc } = setup();
    await expect(svc.update('ORDER_CONFIRMED', { bodyTemplate: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('NOPE', { bodyTemplate: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
