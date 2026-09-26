import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { REDACTED } from './config-redaction';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OrderReversalService } from '../orders/order-reversal.service';
import type { OrderStatusService } from '../orders/order-status.service';
import type { RbacService } from '../staff/rbac/rbac.service';
import type { GomdonOrderService } from '../integrations/gomdon/gomdon-order.service';
import type { GomdonClient } from '../integrations/gomdon/gomdon.client';

/**
 * AdminService — phần thu gom tái chế (Gomdon) + cấu hình có che bí mật. Các dependency không liên quan
 * (loyalty/affiliate/orderStatus…) để rỗng: những hàm dưới đây không chạm tới chúng.
 */
function mkAdmin(
  prisma: Record<string, unknown>,
  deps: { gomdonOrder?: Partial<GomdonOrderService>; gomdonClient?: Partial<GomdonClient>; config?: Partial<SystemConfigService> } = {},
) {
  return new AdminService(
    prisma as unknown as PrismaService,
    (deps.config ?? {}) as SystemConfigService,
    {} as LoyaltyService,
    {} as AffiliateService,
    {} as NotificationsService,
    {} as OrderReversalService,
    {} as OrderStatusService,
    {} as RbacService,
    (deps.gomdonOrder ?? {}) as GomdonOrderService,
    (deps.gomdonClient ?? {}) as GomdonClient,
  );
}

function listOrdersPrisma() {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    order: { findMany, count },
    $transaction: jest.fn().mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr)),
  };
  return { prisma, findMany, count };
}

describe('AdminService.listOrders — bộ lọc "Cần xử lý thu gom"', () => {
  it('recycling=attention → chỉ đơn có thu gom VÀ (vận đơn lỗi khi đơn còn mở HOẶC huỷ vận đơn lỗi)', async () => {
    const { prisma, findMany, count } = listOrdersPrisma();
    await mkAdmin(prisma).listOrders(1, 20, undefined, undefined, 'attention');
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      hasRecyclingPickup: true,
      OR: [
        {
          gomdonStatus: { in: ['FAILED', 'NEEDS_MANUAL_CHECK', 'NOT_CONFIGURED', '2', '6', '8', '9', '10', '11', '12'] },
          status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] },
        },
        { gomdonCancelStatus: { in: ['FAILED', 'TOO_LATE'] } },
      ],
    });
    // count dùng CÙNG điều kiện — số trên badge khớp danh sách.
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('recycling=all → mọi đơn có chọn thu gom', async () => {
    const { prisma, findMany } = listOrdersPrisma();
    await mkAdmin(prisma).listOrders(1, 20, undefined, undefined, 'all');
    expect(findMany.mock.calls[0][0].where).toEqual({ hasRecyclingPickup: true });
  });

  it('kết hợp status + search + recycling bằng AND (OR của search không đè OR của bộ lọc)', async () => {
    const { prisma, findMany } = listOrdersPrisma();
    await mkAdmin(prisma).listOrders(1, 20, 'CONFIRMED', 'TB-1', 'attention');
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(3);
    expect(where.AND[0]).toEqual({ status: 'CONFIRMED' });
    expect(where.AND[1].OR).toEqual(
      expect.arrayContaining([{ gomdonPartnerCode: { contains: 'TB-1', mode: 'insensitive' } }]),
    );
    expect(where.AND[2].hasRecyclingPickup).toBe(true);
  });

  it('dùng include (không select) → trả đủ cột thu gom (hasRecyclingPickup, gomdonStatus, deliveredAt…)', async () => {
    const { prisma, findMany } = listOrdersPrisma();
    await mkAdmin(prisma).listOrders(1, 20);
    const args = findMany.mock.calls[0][0];
    expect(args.select).toBeUndefined();
    expect(args.include).toEqual(expect.objectContaining({ items: true }));
    expect(args.where).toEqual({});
  });
});

describe('AdminService.retryGomdonPush / cancelGomdonWaybill — gọi thẳng GomdonOrderService, lỗi đi nguyên văn', () => {
  const order = { id: 'o1', code: 'TB-9', gomdonStatus: 'NEEDS_MANUAL_CHECK', gomdonPartnerCode: null };

  function gomdonDeps() {
    const retryPush = jest.fn().mockResolvedValue({ queued: true, message: 'Đã xếp hàng tạo vận đơn Gomdon.' });
    const cancelWaybill = jest.fn().mockResolvedValue({ result: 'CANCELLED', message: 'Đã huỷ vận đơn X.' });
    return { gomdonOrder: { retryPush, cancelWaybill } as Partial<GomdonOrderService>, retryPush, cancelWaybill };
  }

  it('tìm đơn theo id HOẶC mã, truyền confirmedNoWaybill=true xuống service và trả kết quả của service', async () => {
    const findFirst = jest.fn().mockResolvedValue(order);
    const { gomdonOrder, retryPush } = gomdonDeps();
    const res = await mkAdmin({ order: { findFirst } }, { gomdonOrder }).retryGomdonPush('admin-1', 'TB-9', true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ id: 'TB-9' }, { code: 'TB-9' }] } }));
    expect(retryPush).toHaveBeenCalledWith('o1', { confirmedNoWaybill: true });
    expect(res).toEqual({ queued: true, message: 'Đã xếp hàng tạo vận đơn Gomdon.' });
  });

  it('không gửi xác nhận → confirmedNoWaybill=false (service tự từ chối NEEDS_MANUAL_CHECK)', async () => {
    const { gomdonOrder, retryPush } = gomdonDeps();
    await mkAdmin({ order: { findFirst: jest.fn().mockResolvedValue(order) } }, { gomdonOrder }).retryGomdonPush('admin-1', 'o1');
    expect(retryPush).toHaveBeenCalledWith('o1', { confirmedNoWaybill: false });
  });

  it('lỗi của service (BadRequest kèm lý do) được ném lại NGUYÊN VẸN', async () => {
    const { gomdonOrder, retryPush } = gomdonDeps();
    const err = new BadRequestException('Chưa rõ Gomdon đã tạo vận đơn chưa — tra Gomdon theo mã đơn TB-9 và xác nhận KHÔNG có vận đơn trước khi tạo lại.');
    retryPush.mockRejectedValueOnce(err);
    await expect(
      mkAdmin({ order: { findFirst: jest.fn().mockResolvedValue(order) } }, { gomdonOrder }).retryGomdonPush('admin-1', 'o1'),
    ).rejects.toBe(err);
  });

  it('đơn không tồn tại → NotFound, KHÔNG gọi Gomdon', async () => {
    const { gomdonOrder, retryPush, cancelWaybill } = gomdonDeps();
    const admin = mkAdmin({ order: { findFirst: jest.fn().mockResolvedValue(null) } }, { gomdonOrder });
    await expect(admin.retryGomdonPush('admin-1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(admin.cancelGomdonWaybill('admin-1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(retryPush).not.toHaveBeenCalled();
    expect(cancelWaybill).not.toHaveBeenCalled();
  });

  it('cancelGomdonWaybill gọi service theo id thật và trả kết quả; lỗi đi nguyên văn', async () => {
    const { gomdonOrder, cancelWaybill } = gomdonDeps();
    const admin = mkAdmin(
      { order: { findFirst: jest.fn().mockResolvedValue({ ...order, gomdonPartnerCode: 'BE1' }) } },
      { gomdonOrder },
    );
    await expect(admin.cancelGomdonWaybill('admin-1', 'TB-9')).resolves.toEqual({ result: 'CANCELLED', message: 'Đã huỷ vận đơn X.' });
    expect(cancelWaybill).toHaveBeenCalledWith('o1');
    const err = new BadRequestException('Bưu tá đã lấy hàng (Đã lấy hàng) — không huỷ qua API được, liên hệ Gomdon/BestExpress.');
    cancelWaybill.mockRejectedValueOnce(err);
    await expect(admin.cancelGomdonWaybill('admin-1', 'TB-9')).rejects.toBe(err);
  });
});

describe('AdminService.gomdonStatus — chỉ trả boolean, không lộ tài khoản', () => {
  it('đủ base URL + tài khoản + công tắc bật → configured/recyclingEnabled true; kết quả không chứa phone/password', async () => {
    const res = await mkAdmin(
      {},
      {
        gomdonClient: {
          getConfig: jest.fn().mockResolvedValue({
            baseUrl: 'https://g',
            phone: '0900111222',
            password: 'pw-secret',
            defaultWarehouse: {},
            defaultWeightFallback: 500,
          }),
        },
        gomdonOrder: { isRecyclingEnabled: jest.fn().mockResolvedValue(true) },
        config: { get: jest.fn().mockResolvedValue(true) as SystemConfigService['get'] },
      },
    ).gomdonStatus();
    expect(res).toEqual(
      expect.objectContaining({ baseUrlSet: true, credentialsSet: true, configured: true, recyclingToggle: true, recyclingEnabled: true }),
    );
    expect(JSON.stringify(res)).not.toContain('pw-secret');
    expect(JSON.stringify(res)).not.toContain('0900111222');
  });

  it('công tắc bật nhưng thiếu tài khoản env → recyclingToggle true, configured false', async () => {
    const res = await mkAdmin(
      {},
      {
        gomdonClient: { getConfig: jest.fn().mockResolvedValue({ baseUrl: '', phone: '', password: '' }) },
        gomdonOrder: { isRecyclingEnabled: jest.fn().mockResolvedValue(false) },
        config: { get: jest.fn().mockResolvedValue(true) as SystemConfigService['get'] },
      },
    ).gomdonStatus();
    expect(res).toEqual(expect.objectContaining({ configured: false, credentialsSet: false, recyclingToggle: true, recyclingEnabled: false }));
  });
});

describe('AdminService.getConfig / setConfig — che bí mật khi đọc, không ghi đè bí mật bằng chuỗi che', () => {
  it('GET không category: che password/secret/token đệ quy trong value và cả khoá bí mật', async () => {
    const prisma = {
      systemConfig: {
        findMany: jest.fn().mockResolvedValue([
          {
            key: 'shipping.gomdon.config',
            value: { phone: '0900', password: 'real-pw', defaultWarehouse: { name: 'Kho', apiToken: 'tok-1' }, defaultWeightFallback: 500 },
            category: 'shipping',
            description: null,
          },
          { key: 'zalo.oa_secret', value: 'shh', category: 'zalo', description: null },
          { key: 'shipping.free_threshold', value: 200000, category: 'shipping', description: null },
        ]),
      },
    };
    const rows = (await mkAdmin(prisma).getConfig()) as { key: string; value: unknown }[];
    const json = JSON.stringify(rows);
    expect(json).not.toContain('real-pw');
    expect(json).not.toContain('tok-1');
    expect(json).not.toContain('shh');
    expect(rows[0]!.value).toEqual({
      phone: '0900',
      password: REDACTED,
      defaultWarehouse: { name: 'Kho', apiToken: REDACTED },
      defaultWeightFallback: 500,
    });
    expect(rows[2]!.value).toBe(200000);
  });

  it('GET theo category cũng che', async () => {
    const out = await mkAdmin(
      {},
      { config: { getByCategory: jest.fn().mockResolvedValue({ 'shipping.gomdon.config': { password: 'real-pw' } }) } },
    ).getConfig('shipping');
    expect(out).toEqual({ 'shipping.gomdon.config': { password: REDACTED } });
  });

  it('PUT gửi lại chuỗi che → ghi GIÁ TRỊ THẬT từ DB; phản hồi vẫn che', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: { password: 'real-pw', defaultWeightFallback: 500 } }) },
    };
    const res = await mkAdmin(prisma, { config: { set } }).setConfig('admin-1', 'shipping.gomdon.config', {
      password: REDACTED,
      defaultWeightFallback: 800,
    });
    expect(set).toHaveBeenCalledWith('shipping.gomdon.config', { password: 'real-pw', defaultWeightFallback: 800 }, 'admin-1');
    expect(res.value).toEqual({ password: REDACTED, defaultWeightFallback: 800 });
  });

  it('PUT sai luật khoá có form riêng (checkin_points 6 số) → 400, KHÔNG ghi', async () => {
    const set = jest.fn();
    const prisma = { systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: [1, 1, 1, 1, 1, 1, 2] }) } };
    await expect(
      mkAdmin(prisma, { config: { set } }).setConfig('admin-1', 'loyalty.checkin_points', [1, 1, 1, 1, 1, 1]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(set).not.toHaveBeenCalled();
  });
});
