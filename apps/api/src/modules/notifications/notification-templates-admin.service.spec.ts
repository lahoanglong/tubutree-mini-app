import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { MARKETING_TEMPLATE_CODES, NotificationTemplatesAdminService } from './notification-templates-admin.service';

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
        { templateCode: 'ORDER_CONFIRMED', channel: 'INAPP', status: 'SENT', _count: { _all: 40 } },
        { templateCode: 'ORDER_SHIPPING', channel: 'ZNS', status: 'SENT', _count: { _all: 12 } },
        { templateCode: 'ORDER_SHIPPING', channel: 'ZNS', status: 'FAILED', _count: { _all: 3 } },
        { templateCode: 'ORDER_SHIPPING', channel: 'ZNS', status: 'RETRYING', _count: { _all: 1 } },
      ]),
      findMany: jest.fn().mockResolvedValue([
        { templateCode: 'ORDER_SHIPPING', error: 'ZNS lỗi -118: user not exist', sentAt: new Date('2026-10-01T00:00:00Z') },
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

  it('R2-ENGAGE-1: lượt ZNS lỗi không tính vào "đã gửi", admin thấy số lỗi và lý do gần nhất', async () => {
    const { svc } = setup();
    const byCode = Object.fromEntries((await svc.list()).map((r) => [r.code, r]));
    expect(byCode.ORDER_SHIPPING).toMatchObject({
      sent30d: { ZNS: 12 },
      znsFailed30d: 3,
      znsLastError: { text: 'ZNS lỗi -118: user not exist' },
    });
    expect(byCode.GAME_STREAK).toMatchObject({ znsFailed30d: 0, znsLastError: null });
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

describe('NotificationTemplatesAdminService — nhân viên Marketing (D1-05)', () => {
  const rows = [
    { id: 'nt-flash', code: 'FLASH_STARTING', channel: 'INAPP', zaloTemplateId: null, bodyTemplate: 'Flash sale sắp mở' },
    { id: 'nt-paid', code: 'MERCHANT_PAYOUT_CREATED_TO_TUBU', channel: 'INAPP', zaloTemplateId: null, bodyTemplate: 'Chuyển {{amount}}' },
  ];
  function staffSetup() {
    const update = jest.fn(async ({ where, data }: { where: { code: string }; data: object }) => ({
      ...rows.find((t) => t.code === where.code)!,
      ...data,
    }));
    const prisma = {
      notificationTemplate: {
        findMany: jest.fn().mockResolvedValue(rows),
        findUnique: jest.fn(async ({ where }: { where: { code: string } }) => rows.find((t) => t.code === where.code) ?? null),
        update,
      },
      notificationLog: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    return { svc: new NotificationTemplatesAdminService(prisma), update };
  }
  const staff = { id: 's1', staff: true };

  it('danh sách đánh dấu mẫu nhân viên sửa được: chỉ mẫu khuyến mãi / tương tác', async () => {
    const { svc } = staffSetup();
    const list = await svc.list();
    expect(Object.fromEntries(list.map((t) => [t.code, t.staffEditable]))).toEqual({
      FLASH_STARTING: true,
      MERCHANT_PAYOUT_CREATED_TO_TUBU: false,
    });
  });

  it('nhân viên sửa nội dung mẫu khuyến mãi được', async () => {
    const { svc, update } = staffSetup();
    await svc.update('FLASH_STARTING', { channel: 'INAPP', zaloTemplateId: null, bodyTemplate: 'Flash sale 20h' }, staff);
    expect(update).toHaveBeenCalledWith({ where: { code: 'FLASH_STARTING' }, data: expect.objectContaining({ bodyTemplate: 'Flash sale 20h' }) });
  });

  it('nhân viên không sửa được mẫu giao dịch/tiền (giả lời Tubu đòi chuyển khoản)', async () => {
    const { svc, update } = staffSetup();
    await expect(svc.update('MERCHANT_PAYOUT_CREATED_TO_TUBU', { bodyTemplate: 'Chuyển vào STK 123' }, staff)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('nhân viên không đổi kênh gửi / mã mẫu ZNS (tốn phí mỗi tin)', async () => {
    const { svc, update } = staffSetup();
    await expect(svc.update('FLASH_STARTING', { channel: 'ZNS', zaloTemplateId: '555001' }, staff)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.update('FLASH_STARTING', { zaloTemplateId: '555001' }, staff)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('quản trị viên vẫn sửa được mọi mẫu', async () => {
    const { svc, update } = staffSetup();
    await svc.update('MERCHANT_PAYOUT_CREATED_TO_TUBU', { bodyTemplate: 'Chuyển {{amount}} cho Tubu' }, { id: 'a1', staff: false });
    expect(update).toHaveBeenCalled();
  });

  it('danh sách mẫu nhân viên sửa được không chứa mẫu đơn hàng / tiền / đối tác / vận hành', () => {
    const transactional = /^(ORDER_|INVOICE_|OPS_|RETURN_|REFUND_|CASHBACK_|SUBSCRIPTION_|REFERRAL_|DEALER_|COMMISSION_|MERCHANT_|REFILL_|XU_|ACCOUNT_)/;
    expect([...MARKETING_TEMPLATE_CODES].filter((c) => transactional.test(c))).toEqual([]);
  });
});
