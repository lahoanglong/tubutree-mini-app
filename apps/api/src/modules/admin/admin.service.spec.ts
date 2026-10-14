import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { OrderReversalService } from '../orders/order-reversal.service';
import { OrderStatusService } from '../orders/order-status.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { FlashSaleService } from '../flash-sale/flash-sale.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { RbacService } from '../staff/rbac/rbac.service';
import type { GomdonOrderService } from '../integrations/gomdon/gomdon-order.service';
import type { GomdonClient } from '../integrations/gomdon/gomdon.client';

// Sổ cái thật (khoá dòng + wallet_transactions) chạy trên Postgres ở
// test/integration-race/wallet-ledger*.race-spec.ts. Ở đây thay bằng đúng tác động số dư của nó
// (increment walletBalance trên tx) để các mock tx sẵn có vẫn đo được tiền vào ví.
jest.mock('../wallet/wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn(
    async (tx: { user: { update: (a: unknown) => Promise<unknown> } }, input: { userId: string; delta: number }) => {
      await tx.user.update({ where: { id: input.userId }, data: { walletBalance: { increment: input.delta } } });
      return { applied: true, balanceAfter: 0, entryId: 'wtx' };
    },
  ),
}));

const config = {} as unknown as SystemConfigService;
const loyalty = {
  creditOrderPoints: jest.fn().mockResolvedValue(undefined),
  reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
} as unknown as LoyaltyService;
const affiliate = {
  lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
  grantReferralReward: jest.fn().mockResolvedValue(undefined),
  reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
} as unknown as AffiliateService;
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
const flash = { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService;
const coupons = { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService;
const rbac = { revokeGrantsAbove: jest.fn().mockResolvedValue(0) } as unknown as RbacService;
// AdminService không còn tự viết khối restock/refund — ủy quyền cho OrderReversalService
// (reviewReturn) và OrderStatusService (updateOrderStatus). Dựng instance THẬT (không mock)
// của cả hai để test vẫn xác minh được hành vi thật qua các spy ở tầng tx bên dưới.
const defaultGomdonOrder = {
  retryPush: jest.fn(),
  cancelWaybill: jest.fn(),
  isRecyclingEnabled: jest.fn().mockResolvedValue(false),
} as unknown as GomdonOrderService;
const defaultGomdonClient = { getConfig: jest.fn() } as unknown as GomdonClient;
const mkAdmin = (
  prisma: PrismaService,
  deps: { gomdonOrder?: GomdonOrderService; gomdonClient?: GomdonClient; config?: SystemConfigService } = {},
) => {
  const reversal = new OrderReversalService(flash, coupons);
  const orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal);
  return new AdminService(
    prisma,
    deps.config ?? config,
    loyalty,
    affiliate,
    notifications,
    reversal,
    orderStatus,
    rbac,
    deps.gomdonOrder ?? defaultGomdonOrder,
    deps.gomdonClient ?? defaultGomdonClient,
  );
};

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    dealerApplication: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    dealerTier: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
    user: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(3), findMany: jest.fn().mockResolvedValue([]) },
    returnRequest: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    order: { findUniqueOrThrow: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { ...base, ...over } as unknown as PrismaService;
}

/** $transaction interactive (callback) cho reviewDealerApplication approve path. */
function makeApproveTx(opts: {
  dealerAppUpdateMany?: jest.Mock;
  userUpdate?: jest.Mock;
}) {
  const dealerAppUpdateMany = opts.dealerAppUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = opts.userUpdate ?? jest.fn().mockResolvedValue({});
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      dealerApplication: { updateMany: dealerAppUpdateMany },
      user: { update: userUpdate },
    }),
  );
  return { $transaction, dealerAppUpdateMany, userUpdate };
}

describe('AdminService.reviewDealerApplication', () => {
  // SELLER-12: người đăng ký nhận kết quả, kèm lý do khi bị từ chối.
  it('duyệt → báo DEALER_APPLICATION_APPROVED kèm tên bậc; từ chối → báo kèm lý do', async () => {
    (notifications.notify as jest.Mock).mockClear();
    const { $transaction } = makeApproveTx({});
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      dealerTier: { findUnique: jest.fn().mockResolvedValue({ id: 't1', name: 'Bạc' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ metadata: null }) },
      $transaction,
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', true, 't1');
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'DEALER_APPLICATION_APPROVED', expect.objectContaining({ tier: 'Bạc' }));

    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', false, undefined, 'Thiếu ảnh CCCD');
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'DEALER_APPLICATION_REJECTED', expect.objectContaining({ reason: 'Thiếu ảnh CCCD' }));
  });

  it('đơn không tồn tại → NotFound', async () => {
    const prisma = makePrisma({ dealerApplication: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(mkAdmin(prisma).reviewDealerApplication('a1', 'x', true, 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('đơn không PENDING → BadRequest', async () => {
    const prisma = makePrisma({
      dealerApplication: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'APPROVED' }) },
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('a1', 'd1', true, 't1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('duyệt nhưng thiếu tierId → BadRequest', async () => {
    const prisma = makePrisma({
      dealerApplication: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }) },
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('a1', 'd1', true)).rejects.toThrow(
      'bậc đại lý',
    );
  });

  it('duyệt với tier không tồn tại → BadRequest', async () => {
    const prisma = makePrisma({
      dealerApplication: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }) },
      dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      mkAdmin(prisma).reviewDealerApplication('a1', 'd1', true, 'bad'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('duyệt hợp lệ → MERGE metadata, KHÔNG xoá segments/onboardedAt (regression)', async () => {
    const { $transaction, dealerAppUpdateMany, userUpdate } = makeApproveTx({});
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
      },
      dealerTier: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
      user: {
        findUnique: jest.fn().mockResolvedValue({ metadata: { segments: ['mom_baby'], onboardedAt: '2026-01-01' } }),
      },
      $transaction,
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', true, 't1');
    // Guard atomic status='PENDING' TRONG transaction (chống race 2 admin duyệt cùng đơn).
    expect(dealerAppUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'd1', status: 'PENDING' }, data: expect.objectContaining({ status: 'APPROVED' }) }),
    );
    const meta = (userUpdate.mock.calls[0][0] as { data: { metadata: Record<string, unknown>; role: string } }).data;
    expect(meta.role).toBe('DEALER');
    expect(meta.metadata).toEqual({ segments: ['mom_baby'], onboardedAt: '2026-01-01', dealerTierId: 't1' });
  });

  it('metadata null → vẫn set dealerTierId', async () => {
    const { $transaction, userUpdate } = makeApproveTx({});
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ metadata: null }) },
      $transaction,
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', true, 't1');
    expect((userUpdate.mock.calls[0][0] as { data: { metadata: unknown } }).data.metadata).toEqual({ dealerTierId: 't1' });
  });

  it('race 2 admin duyệt cùng đơn → bên thua (updateMany count=0) throw, KHÔNG đổi role user', async () => {
    const { $transaction, userUpdate } = makeApproveTx({
      dealerAppUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ metadata: null }) },
      $transaction,
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('admin2', 'd1', true, 't1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('từ chối → REJECTED + lý do, không động vào user', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const userUpdate = jest.fn();
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
        updateMany,
      },
      user: { findUnique: jest.fn(), update: userUpdate },
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', false, undefined, 'thiếu giấy tờ');
    expect(updateMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: { id: 'd1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'thiếu giấy tờ' }),
      }),
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('từ chối race (updateMany count=0) → BadRequest', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
        updateMany,
      },
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('admin2', 'd1', false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('AdminService.importDealerPrices (import bảng giá đại lý theo bậc)', () => {
  function importPrisma(over: Record<string, unknown> = {}) {
    const base = {
      dealerTier: { findUnique: jest.fn().mockResolvedValue({ id: 't1', name: 'Bạc' }) },
      // Bug 1 fix: 1 findMany cho toàn bộ SKU (thay vì findUnique/dòng).
      variation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'v1', sku: 'SKU-1', dealerPrices: { t0: 99000 } }]),
        update: jest.fn().mockResolvedValue({}),
      },
      dealerPriceHistory: { create: jest.fn().mockResolvedValue({}) },
      // Ghi theo lô: mỗi lô 1 $transaction([...]) — mock chỉ cần resolve, vì .update()/.create()
      // đã được gọi (ghi nhận bởi jest.fn) ngay lúc XÂY mảng đối số truyền vào $transaction.
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return { ...base, ...over } as unknown as PrismaService;
  }

  it('bậc đại lý không tồn tại → BadRequest', async () => {
    const prisma = importPrisma({ dealerTier: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(mkAdmin(prisma).importDealerPrices('admin1', 'bad', [{ sku: 'SKU-1', price: 100000 }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('import hợp lệ → MERGE giá vào dealerPrices[tierId] + ghi DealerPriceHistory (old→new)', async () => {
    const prisma = importPrisma();
    const r = await mkAdmin(prisma).importDealerPrices('admin1', 't1', [{ sku: 'SKU-1', price: 180000 }]);
    expect(r).toMatchObject({ tierId: 't1', updated: 1, notFound: [] });
    const upd = (prisma.variation.update as jest.Mock).mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'v1' });
    expect(upd.data.dealerPrices).toEqual({ t0: 99000, t1: 180000 }); // merge, không mất bậc khác
    const hist = (prisma.dealerPriceHistory.create as jest.Mock).mock.calls[0][0].data;
    expect(hist).toMatchObject({ variationId: 'v1', tierId: 't1', oldPrice: null, newPrice: 180000, changedBy: 'admin1' });
  });

  it('SKU không tồn tại → vào notFound, không update', async () => {
    const prisma = importPrisma({
      variation: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    });
    const r = await mkAdmin(prisma).importDealerPrices('admin1', 't1', [{ sku: 'SKU-X', price: 100000 }]);
    expect(r.updated).toBe(0);
    expect(r.notFound).toEqual(['SKU-X']);
    expect(prisma.variation.update).not.toHaveBeenCalled();
  });

  it('giá không đổi → bỏ qua (không update/không ghi history thừa)', async () => {
    const prisma = importPrisma({
      variation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'v1', sku: 'SKU-1', dealerPrices: { t1: 150000 } }]),
        update: jest.fn(),
      },
    });
    const r = await mkAdmin(prisma).importDealerPrices('admin1', 't1', [{ sku: 'SKU-1', price: 150000 }]);
    expect(r.updated).toBe(0);
    expect(prisma.variation.update).not.toHaveBeenCalled();
    expect(prisma.dealerPriceHistory.create).not.toHaveBeenCalled();
  });

  it('giá <= 0 hoặc sku rỗng → bỏ dòng lỗi (không update)', async () => {
    const prisma = importPrisma();
    const r = await mkAdmin(prisma).importDealerPrices('admin1', 't1', [
      { sku: '', price: 100000 },
      { sku: 'SKU-1', price: 0 },
    ]);
    expect(r.updated).toBe(0);
    expect(prisma.variation.update).not.toHaveBeenCalled();
  });
});

describe('AdminService.setUserRole', () => {
  it('SĐT không tồn tại → NotFound (không tự tạo user như script SSH cũ)', async () => {
    const prisma = makePrisma({ user: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0900000000', 'ADMIN')).rejects.toBeInstanceOf(NotFoundException);
    expect((prisma as unknown as { user: { update: jest.Mock } }).user.update).not.toHaveBeenCalled();
  });

  it('cấp role: update đúng user + trả previousRole (audit ai đổi)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'ADMIN', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'CUSTOMER' }), update },
    });
    const out = await mkAdmin(prisma).setUserRole('admin1', ' 0899625240 ', 'ADMIN');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'ADMIN' },
      select: { id: true, phone: true, fullName: true, role: true },
    });
    expect(out.previousRole).toBe('CUSTOMER');
    expect(out.role).toBe('ADMIN');
  });

  // P0-3 (docs/2026-09-08-review-progress.md): hạ role qua đường này trước đây KHÔNG đụng
  // RoleGrant — applyGrants (chỉ nâng, gọi mỗi lần refresh token) đọc thấy grant ADMIN còn
  // hiệu lực rồi tự phục hồi ngay sau khi admin vừa thu hồi quyền. Phải gọi revokeGrantsAbove.
  it('hạ role → gọi rbac.revokeGrantsAbove(phone, role mới) để chặn applyGrants tự phục hồi', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'CUSTOMER', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(3) },
    });
    await mkAdmin(prisma).setUserRole('admin1', '0899625240', 'CUSTOMER');
    expect(rbac.revokeGrantsAbove).toHaveBeenCalledWith('0899625240', 'CUSTOMER');
  });

  // Một cú chạm nhầm không được phép khoá cả tổ chức ra ngoài: khôi phục chỉ còn cách vào
  // thẳng DB bằng SQL.
  it('admin tự hạ quyền CHÍNH MÌNH → từ chối, không đụng tới role', async () => {
    const update = jest.fn();
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin1', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(5) },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'CUSTOMER')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('admin tự đổi role chính mình THÀNH ADMIN (không hạ) → vẫn cho qua', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'admin1', phone: '0899625240', role: 'ADMIN', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin1', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(1) },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'ADMIN')).resolves.toMatchObject({ ok: true });
  });

  it('hạ ADMIN CUỐI CÙNG → từ chối (không còn ai cấp lại quyền cho ai)', async () => {
    const update = jest.fn();
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u2', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(1) },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'STAFF')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('hạ một ADMIN khi còn admin khác → cho qua', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u2', phone: '0899625240', role: 'STAFF', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u2', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(2) },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'STAFF')).resolves.toMatchObject({ ok: true });
  });

  it('rbac.revokeGrantsAbove lỗi → vẫn trả kết quả đổi role thành công (best-effort, không rollback role)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'CUSTOMER', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(3) },
    });
    (rbac.revokeGrantsAbove as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const out = await mkAdmin(prisma).setUserRole('admin1', '0899625240', 'CUSTOMER');
    expect(out.role).toBe('CUSTOMER');
  });

  // C-008 (A5N-03, Q-07): cấp DEALER thẳng qua đây trước đây không gán bậc → dealerContext trả tier null
  // và luồng CREDIT bỏ qua hạn mức công nợ. Gán DEALER bắt buộc kèm bậc tồn tại, ghi metadata.dealerTierId.
  describe('gán DEALER bắt buộc chọn bậc (C-008)', () => {
    const customer = { id: 'u1', phone: '0899625240', role: 'CUSTOMER', metadata: { onboardedAt: '2026-09-01', segments: ['home'] } };

    it('thiếu tierId → 400, không đổi role', async () => {
      const update = jest.fn();
      const prisma = makePrisma({ user: { findUnique: jest.fn().mockResolvedValue(customer), update } });
      await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'DEALER')).rejects.toThrow(/bậc đại lý/);
      await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'DEALER', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('tierId không tồn tại → 400, không đổi role', async () => {
      const update = jest.fn();
      const prisma = makePrisma({
        user: { findUnique: jest.fn().mockResolvedValue(customer), update },
        dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'DEALER', 'ghost')).rejects.toThrow(
        /không tồn tại/,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('tierId hợp lệ → role DEALER + metadata.dealerTierId, giữ nguyên metadata cũ', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'DEALER', fullName: 'X' });
      const tierFind = jest.fn().mockResolvedValue({ id: 'dealer_l3' });
      const prisma = makePrisma({
        user: { findUnique: jest.fn().mockResolvedValue(customer), update },
        dealerTier: { findUnique: tierFind },
      });
      const out = await mkAdmin(prisma).setUserRole('admin1', '0899625240', 'DEALER', ' dealer_l3 ');
      expect(tierFind).toHaveBeenCalledWith({ where: { id: 'dealer_l3' } });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          role: 'DEALER',
          metadata: { onboardedAt: '2026-09-01', segments: ['home'], dealerTierId: 'dealer_l3' },
        },
        select: { id: true, phone: true, fullName: true, role: true },
      });
      expect(out).toMatchObject({ ok: true, role: 'DEALER', previousRole: 'CUSTOMER', dealerTierId: 'dealer_l3' });
    });

    it('role khác DEALER: tierId bị bỏ qua, metadata không đụng', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'AFFILIATE', fullName: 'X' });
      const tierFind = jest.fn();
      const prisma = makePrisma({
        user: { findUnique: jest.fn().mockResolvedValue(customer), update },
        dealerTier: { findUnique: tierFind },
      });
      await mkAdmin(prisma).setUserRole('admin1', '0899625240', 'AFFILIATE', 'dealer_l3');
      expect(tierFind).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'AFFILIATE' } }));
    });
  });
});

// Việc 9 (audit round 2): createCoupon() trước đây KHÔNG ghi scopeMeta → coupon scope TIER/
// USER_GROUP tạo ra fail-closed ở MỌI user (isCouponEligible luôn false), KHÔNG AI DÙNG ĐƯỢC.
// DTO (RequiredScopeMeta) đã bắt buộc đúng field trước khi tới service — test này chỉ xác nhận
// service GHI ĐÚNG scopeMeta vào prisma.coupon.create.
describe('AdminService.createCoupon — ghi scopeMeta (Việc 9)', () => {
  const couponBase = {
    code: 'SALE10',
    type: 'PERCENT' as const,
    value: 10,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
  };

  it('scope=TIER + scopeMeta.tierId → ghi scopeMeta vào coupon.create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'c1' });
    const prisma = makePrisma({ coupon: { create } });
    await mkAdmin(prisma).createCoupon({ ...couponBase, scope: 'TIER', scopeMeta: { tierId: 'GOLD' } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'TIER', scopeMeta: { tierId: 'GOLD' } }) }),
    );
  });

  it('scope=USER_GROUP + scopeMeta.userId → ghi scopeMeta vào coupon.create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'c2' });
    const prisma = makePrisma({ coupon: { create } });
    await mkAdmin(prisma).createCoupon({ ...couponBase, scope: 'USER_GROUP', scopeMeta: { userId: 'u1' } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'USER_GROUP', scopeMeta: { userId: 'u1' } }) }),
    );
  });

  it('scope=PUBLIC, không truyền scopeMeta → coupon.create nhận scopeMeta=undefined (không lỗi)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'c3' });
    const prisma = makePrisma({ coupon: { create } });
    await mkAdmin(prisma).createCoupon({ ...couponBase, scope: 'PUBLIC' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'PUBLIC', scopeMeta: undefined }) }),
    );
  });
});

describe('AdminService coupons — xem, sửa, tắt mã (ADMINOPS-8)', () => {
  const couponBase = {
    code: 'SALE10',
    type: 'PERCENT' as const,
    value: 10,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
    scope: 'PUBLIC' as const,
  };

  it('createCoupon: ngày kết thúc trước/bằng ngày bắt đầu → 400, không ghi', async () => {
    const create = jest.fn();
    const prisma = makePrisma({ coupon: { create } });
    await expect(
      mkAdmin(prisma).createCoupon({ ...couponBase, startAt: '2026-12-31T00:00:00.000Z', endAt: '2026-01-01T00:00:00.000Z' }),
    ).rejects.toThrow('Ngày kết thúc phải sau ngày bắt đầu.');
    expect(create).not.toHaveBeenCalled();
  });

  it('createCoupon: trùng mã (P2002) → 409 "Mã ... đã tồn tại"', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const create = jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }));
    const prisma = makePrisma({ coupon: { create } });
    await expect(mkAdmin(prisma).createCoupon(couponBase)).rejects.toThrow('Mã SALE10 đã tồn tại.');
  });

  it('listCoupons: trả mã kèm số lượt đã dùng (đếm redemption), lọc theo từ khoá đã chuẩn hoá', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'c1', code: 'SALE10', isActive: true }]);
    const count = jest.fn().mockResolvedValue(1);
    const groupBy = jest.fn().mockResolvedValue([{ couponId: 'c1', _count: { _all: 7 } }]);
    const prisma = makePrisma({ coupon: { findMany, count }, couponRedemption: { groupBy } });
    const out = await mkAdmin(prisma).listCoupons({ page: 1, limit: 20, q: ' sale ' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ code: { contains: 'SALE' } }) }));
    expect(out.data[0]).toMatchObject({ code: 'SALE10', redeemedCount: 7 });
    expect(out.meta.total).toBe(1);
  });

  it('updateCoupon: tắt mã (isActive=false) ghi đúng trường', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'c1', code: 'SALE10', startAt: new Date('2026-01-01'), endAt: new Date('2026-12-31'), usedCount: 0 });
    const update = jest.fn().mockResolvedValue({ id: 'c1', isActive: false });
    const prisma = makePrisma({ coupon: { findUnique, update }, couponRedemption: { count: jest.fn().mockResolvedValue(3) } });
    await mkAdmin(prisma).updateCoupon('c1', { isActive: false });
    expect(update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isActive: false } });
  });

  it('updateCoupon: endAt trước startAt → 400; usageLimit nhỏ hơn số lượt đã dùng → 400', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'c1', code: 'SALE10', startAt: new Date('2026-06-01'), endAt: new Date('2026-12-31'), usedCount: 5 });
    const update = jest.fn();
    const prisma = makePrisma({ coupon: { findUnique, update }, couponRedemption: { count: jest.fn().mockResolvedValue(5) } });
    await expect(mkAdmin(prisma).updateCoupon('c1', { endAt: '2026-05-01T00:00:00.000Z' })).rejects.toThrow('Ngày kết thúc phải sau ngày bắt đầu.');
    await expect(mkAdmin(prisma).updateCoupon('c1', { usageLimit: 3 })).rejects.toThrow('đã được dùng 5 lượt');
    expect(update).not.toHaveBeenCalled();
  });

  it('updateCoupon: mã không tồn tại → 404', async () => {
    const prisma = makePrisma({ coupon: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(mkAdmin(prisma).updateCoupon('nope', { isActive: false })).rejects.toThrow('Không tìm thấy mã giảm giá.');
  });
});

describe('AdminService.getDashboardStats', () => {
  it('tổng hợp đúng số lượng đơn, doanh thu và cây trồng', async () => {
    const prisma = makePrisma({
      order: {
        count: jest.fn().mockResolvedValue(15),
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: 1500000 } }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'o1', code: 'TB1', total: 100000, status: 'DELIVERED', paymentMethod: 'COD', createdAt: new Date() },
        ]),
      },
      user: {
        count: jest.fn().mockResolvedValue(50),
      },
      product: {
        count: jest.fn().mockResolvedValue(20),
      },
      plantedTree: {
        count: jest.fn().mockResolvedValue(8),
      },
    });

    const stats = await mkAdmin(prisma).getDashboardStats();
    expect(stats.totalRevenue).toBe(1500000);
    expect(stats.totalOrders).toBe(15);
    expect(stats.totalUsers).toBe(50);
    expect(stats.plantedTreesCount).toBe(8);
    expect(stats.recentOrders).toHaveLength(1);
  });
});

// updateOrderStatus giờ ủy quyền toàn bộ cho OrderStatusService (assertTransition + atomic
// flip qua $transaction interactive) — cần mock $transaction thật sự GỌI callback với 1 tx
// giả lập order.updateMany, khác với `makePrisma` mặc định (chỉ resolve [] không gọi callback).
function makeStatusPrisma(order: Record<string, unknown>, finalOrder: Record<string, unknown>, flipCount = 1) {
  // flipCount=0 mô phỏng thua race (mọi câu ghi đều trượt). flipCount=1: updateMany chỉ count=1 khi
  // `where` khớp dòng trong DB — guard hoàn tiền PAID→REFUNDED không được "thắng" với đơn UNPAID.
  const row: Record<string, unknown> = { ...order };
  const txUpdateMany = jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (flipCount === 0 || !Object.entries(where).every(([k, v]) => row[k] === v)) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  const $transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb({ order: { updateMany: txUpdateMany }, orderStatusHistory: { create: jest.fn().mockResolvedValue({}) } }));
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue(finalOrder),
    },
    $transaction,
  } as unknown as PrismaService;
  return { prisma, txUpdateMany };
}

describe('AdminService.updateOrderStatus', () => {
  // C-024: admin từng đẩy được đơn chuyển khoản chưa ai trả lên DELIVERED → cộng điểm + chốt hoa hồng.
  it.each(['SHIPPING', 'DELIVERED'] as const)(
    'đơn BANK_TRANSFER chưa PAID → %s bị từ chối 400, không cộng điểm/hoa hồng',
    async (to) => {
      const order = {
        id: 'o9', code: 'TB-109', userId: 'u9', status: 'CONFIRMED', total: 250000, note: null, items: [],
        paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID',
      };
      const { prisma, txUpdateMany } = makeStatusPrisma(order, order);
      (prisma as unknown as { dealerCreditLedger: unknown }).dealerCreditLedger = { findFirst: jest.fn().mockResolvedValue(null) };

      const err = await mkAdmin(prisma).updateOrderStatus('admin-1', 'o9', to).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('Đã nhận tiền');
      expect(txUpdateMany).not.toHaveBeenCalled();
      expect(loyalty.creditOrderPoints).not.toHaveBeenCalledWith('o9');
      expect(affiliate.lockCommissionsForOrder).not.toHaveBeenCalledWith('o9');
    },
  );

  it('chuyển DELIVERED → credit điểm và lock hoa hồng', async () => {
    const order = { id: 'o1', code: 'TB-100', userId: 'u1', status: 'SHIPPING', total: 200000, note: null, items: [] };
    const { prisma } = makeStatusPrisma(order, { ...order, status: 'DELIVERED' });

    const res = await mkAdmin(prisma).updateOrderStatus('admin-1', 'o1', 'DELIVERED', 'Giao thành công');
    expect(res.status).toBe('DELIVERED');
    expect(loyalty.creditOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.lockCommissionsForOrder).toHaveBeenCalledWith('o1');
  });

  it('chuyển CANCELLED → reverse điểm và reverse hoa hồng (kèm reversal restock — items rỗng)', async () => {
    const order = { id: 'o2', code: 'TB-101', userId: 'u2', status: 'CONFIRMED', total: 300000, note: null, items: [], paymentMethod: 'COD', paymentStatus: 'UNPAID' };
    const { prisma } = makeStatusPrisma(order, { ...order, status: 'CANCELLED' });

    const res = await mkAdmin(prisma).updateOrderStatus('admin-1', 'o2', 'CANCELLED', 'Khách đổi ý');
    expect(res.status).toBe('CANCELLED');
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o2');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o2');
  });

  it('chuyển DELIVERED → CONFIRMED (regression) → BadRequest, không chạy side-effect', async () => {
    const order = { id: 'o3', code: 'TB-102', userId: 'u3', status: 'DELIVERED', total: 100000, note: null, items: [] };
    const { prisma } = makeStatusPrisma(order, order);

    await expect(mkAdmin(prisma).updateOrderStatus('admin-1', 'o3', 'CONFIRMED')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalledWith('o3');
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalledWith('o3');
  });

  it('đơn không tồn tại → throw NotFoundException', async () => {
    const prisma = makePrisma({
      order: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(mkAdmin(prisma).updateOrderStatus('admin-1', 'non-existent', 'CANCELLED')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('AdminService.listOrders with search', () => {
  it('tìm kiếm theo mã đơn hoặc SĐT truyền OR filter vào Prisma', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = makePrisma({
      order: { findMany, count },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });

    await mkAdmin(prisma).listOrders(1, 20, undefined, '0901234567');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ code: { contains: '0901234567', mode: 'insensitive' } }),
          ]),
        }),
      }),
    );
  });

  // C-027: lọc theo quan hệ `user` sinh LEFT JOIN users + OR xuyên hai bảng → Postgres phải quét cả bảng
  // orders. Tra trước id khách khớp SĐT/tên (index trigram trên users) rồi lọc orders.userId IN (...)
  // để mọi nhánh OR đều đi được index.
  it('tìm ≥ 3 ký tự: tra trước khách khớp SĐT/tên rồi lọc userId IN, không lọc theo quan hệ user', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const userFindMany = jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    const prisma = makePrisma({
      order: { findMany, count },
      user: { findMany: userFindMany },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });

    await mkAdmin(prisma).listOrders(1, 20, undefined, ' 0901 ');
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ phone: { contains: '0901' } }, { fullName: { contains: '0901', mode: 'insensitive' } }],
        },
        select: { id: true },
      }),
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [
        { code: { contains: '0901', mode: 'insensitive' } },
        { gomdonPartnerCode: { contains: '0901', mode: 'insensitive' } },
        { userId: { in: ['u1', 'u2'] } },
      ],
    });
    expect(count.mock.calls[0][0].where).toEqual(where);
  });

  it('không khách nào khớp → chỉ còn nhánh mã đơn / mã Gomdon', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      order: { findMany, count: jest.fn().mockResolvedValue(0) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });
    await mkAdmin(prisma).listOrders(1, 20, undefined, 'TB-123');
    expect(findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { code: { contains: 'TB-123', mode: 'insensitive' } },
        { gomdonPartnerCode: { contains: 'TB-123', mode: 'insensitive' } },
      ],
    });
  });

  it('quá nhiều khách khớp (tìm quá chung) → giữ lọc theo quan hệ user để không cắt bớt kết quả', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const many = Array.from({ length: 1001 }, (_, i) => ({ id: `u${i}` }));
    const prisma = makePrisma({
      order: { findMany, count: jest.fn().mockResolvedValue(0) },
      user: { findMany: jest.fn().mockResolvedValue(many) },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });
    await mkAdmin(prisma).listOrders(1, 20, undefined, 'Nguyễn');
    expect(findMany.mock.calls[0][0].where.OR).toEqual(
      expect.arrayContaining([
        { user: { phone: { contains: 'Nguyễn' } } },
        { user: { fullName: { contains: 'Nguyễn', mode: 'insensitive' } } },
      ]),
    );
  });

  it('chuỗi tìm < 3 ký tự (trigram không dùng được) → không tra trước, giữ lọc theo quan hệ user', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const userFindMany = jest.fn();
    const prisma = makePrisma({
      order: { findMany, count: jest.fn().mockResolvedValue(0) },
      user: { findMany: userFindMany },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });
    await mkAdmin(prisma).listOrders(1, 20, undefined, '09');
    expect(userFindMany).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where.OR).toEqual(
      expect.arrayContaining([{ user: { phone: { contains: '09' } } }]),
    );
  });
});

// C-024 yêu cầu 3: web admin dựng nút trạng thái + nút "Đã nhận tiền" từ API thay vì tự đoán.
describe('AdminService.listOrders — allowedTransitions + canConfirmPayment (C-024)', () => {
  const row = (o: Record<string, unknown>) => ({
    id: String(o.code),
    type: 'RETAIL',
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: 'UNPAID',
    items: [],
    user: null,
    ...o,
  });
  const list = async (items: Record<string, unknown>[], debits: { refId: string }[] = []) => {
    const prisma = makePrisma({
      order: { findMany: jest.fn().mockResolvedValue(items.map(row)), count: jest.fn().mockResolvedValue(items.length) },
      dealerCreditLedger: { findMany: jest.fn().mockResolvedValue(debits) },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });
    const res = (await mkAdmin(prisma).listOrders(1, 20)) as unknown as {
      data: { code: string; allowedTransitions: string[]; canConfirmPayment: boolean }[];
    };
    return Object.fromEntries(res.data.map((o) => [o.code, o])) as Record<
      string,
      { allowedTransitions: string[]; canConfirmPayment: boolean }
    >;
  };

  it('chuyển khoản lẻ chưa trả: không có SHIPPING/DELIVERED, có nút Đã nhận tiền', async () => {
    const by = await list([{ code: 'A', status: 'PENDING_PAYMENT' }, { code: 'B', status: 'PACKED' }]);
    expect(by.A).toMatchObject({ allowedTransitions: ['CANCELLED'], canConfirmPayment: true });
    expect(by.B).toMatchObject({ allowedTransitions: ['CANCELLED'], canConfirmPayment: true });
  });

  it('đã PAID / COD / ZaloPay / đơn huỷ → không có nút Đã nhận tiền; DELIVERED chỉ còn RETURNED', async () => {
    const by = await list([
      { code: 'P', status: 'CONFIRMED', paymentStatus: 'PAID' },
      { code: 'C', status: 'CONFIRMED', paymentMethod: 'COD' },
      { code: 'Z', status: 'PENDING_PAYMENT', paymentMethod: 'ZALOPAY' },
      { code: 'X', status: 'CANCELLED' },
      { code: 'D', status: 'DELIVERED', paymentStatus: 'PAID' },
    ]);
    expect(by.P).toMatchObject({ allowedTransitions: ['PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED'], canConfirmPayment: false });
    expect(by.C).toMatchObject({ allowedTransitions: ['PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED'], canConfirmPayment: false });
    expect(by.Z).toMatchObject({ canConfirmPayment: false });
    expect(by.Z?.allowedTransitions).not.toContain('DELIVERED');
    expect(by.X).toMatchObject({ allowedTransitions: [], canConfirmPayment: false });
    expect(by.D).toMatchObject({ allowedTransitions: ['RETURNED'], canConfirmPayment: false });
  });

  it('đơn đại lý: công nợ giao được; trả trước chưa trả bị khoá giao; nút xác nhận đại lý ở panel riêng', async () => {
    const by = await list(
      [
        { code: 'DC', id: 'dc', type: 'DEALER', status: 'CONFIRMED' },
        { code: 'DP', id: 'dp', type: 'DEALER', status: 'PENDING_PAYMENT' },
      ],
      [{ refId: 'dc' }],
    );
    expect(by.DC?.allowedTransitions).toContain('DELIVERED');
    expect(by.DP?.allowedTransitions).not.toContain('SHIPPING');
    expect(by.DC?.canConfirmPayment).toBe(false);
    expect(by.DP?.canConfirmPayment).toBe(false);
  });
});

describe('AdminService.listPendingMerchantProducts & reviewMerchantProduct', () => {
  it('listPendingMerchantProducts chỉ lấy sản phẩm có approvalStatus=PENDING_REVIEW, có phân trang thật', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'p1', name: 'Nước giặt sinh học', approvalStatus: 'PENDING_REVIEW' },
    ]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = makePrisma({
      product: { findMany, count },
      // listUsers/listOrders pattern: $transaction([findMany, count]) — mock chạy THẬT mảng.
      $transaction: jest.fn((arr) => Promise.all(arr)),
    });
    const res = await mkAdmin(prisma).listPendingMerchantProducts(1, 20);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { approvalStatus: 'PENDING_REVIEW' },
        skip: 0,
        take: 20,
      }),
    );
    expect(res.data).toHaveLength(1);
    expect(res.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  it('reviewMerchantProduct duyệt APPROVED', async () => {
    const product = { id: 'p1', name: 'Nước giặt', approvalStatus: 'PENDING_REVIEW' };
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...product, approvalStatus: 'APPROVED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    const res = await mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true);
    expect(res.approvalStatus).toBe('APPROVED');
  });

  it('D4: duyệt sản phẩm "Tubu giao hộ" → chuyển biến thể Pancake trong cùng transaction, báo đối tác', async () => {
    (notifications.notify as jest.Mock).mockClear();
    const product = {
      id: 'p1',
      name: 'Mật ong',
      approvalStatus: 'PENDING_REVIEW',
      storefrontId: 'sf-a',
      pancakeLinkCode: 'PK-1',
      storefront: { ownerUserId: 'owner-1' },
    };
    const variationUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...product, approvalStatus: 'APPROVED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      variation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'var-pk', pancakeId: 'PK-1', name: 'V', retailPrice: 1, salePrice: null, stock: 1, product: { id: 'shell', name: 'S' },
        }),
        updateMany: variationUpdateMany,
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
    });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    await mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true);
    expect(variationUpdateMany).toHaveBeenCalledWith({ where: { id: 'var-pk', productId: 'shell' }, data: { productId: 'p1' } });
    expect(notifications.notify).toHaveBeenCalledWith('owner-1', 'MERCHANT_PRODUCT_APPROVED', expect.objectContaining({ product_name: 'Mật ong' }));
  });

  it('reviewMerchantProduct từ chối REJECTED kèm lý do', async () => {
    const product = { id: 'p1', name: 'Kem chống nắng', approvalStatus: 'PENDING_REVIEW' };
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...product, approvalStatus: 'REJECTED', rejectReason: 'Chưa đủ chứng nhận' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    const res = await mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', false, 'Chưa đủ chứng nhận');
    expect(res.approvalStatus).toBe('REJECTED');
    expect(res.rejectReason).toBe('Chưa đủ chứng nhận');
  });

  /**
   * Hai admin cùng mở danh sách chờ duyệt: A bấm Duyệt, B bấm Từ chối hai giây sau. Không có CAS
   * thì B ghi đè kết quả của A mà A không hề biết, và không có bản ghi nào cho biết ai làm gì.
   */
  it('sản phẩm vừa được người khác xử lý (CAS count 0) → BadRequest thay vì lặng lẽ ghi đè', async () => {
    const product = { id: 'p1', name: 'Nước giặt', approvalStatus: 'PENDING_REVIEW' };
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    await expect(mkAdmin(prisma).reviewMerchantProduct('admin-2', 'p1', false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});


/**
 * Portal web render `r.order?.code`, `r.user?.fullName`, tổng đơn và phương thức thanh toán,
 * nhưng ReturnRequest chỉ lưu orderId/userId dạng chuỗi (schema không khai quan hệ) nên truy vấn
 * cũ không trả gì. Admin chỉ thấy một dãy cuid và chữ "Khách hàng", rồi bấm Duyệt để hoàn nguyên
 * tổng đơn về ví mà KHÔNG nhìn thấy số tiền mình đang hoàn.
 */
/** Hàng đợi chờ duyệt (PENDING / REQUESTED) cần xem CŨ NHẤT trước — web gửi order=asc. */
describe('AdminService.listDealerApplications — thứ tự createdAt theo tham số order', () => {
  function daPrisma() {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      dealerApplication: { findMany, count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((arr) => Promise.all(arr)),
    });
    return { prisma, findMany };
  }

  it('order=asc → orderBy createdAt asc; bỏ trống → desc như cũ', async () => {
    const c = daPrisma();
    await mkAdmin(c.prisma).listDealerApplications('PENDING', 1, 20, 'asc');
    expect(c.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
    const d = daPrisma();
    await mkAdmin(d.prisma).listDealerApplications(undefined, 1, 20);
    expect(d.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });
});

/**
 * C-024 / Q-06: đơn chuyển khoản lẻ (khách hoặc CTV lên đơn hộ) trước đây không có cách nào ghi nhận
 * "đã nhận tiền" ngoài webhook Pancake — webhook không tới là đơn kẹt PENDING_PAYMENT mãi.
 */
describe('AdminService.confirmOrderPayment', () => {
  function make(order: Record<string, unknown> | null, outcome = 'PAID') {
    const prisma = makePrisma({
      order: {
        findFirst: jest.fn().mockResolvedValue(order),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...order, paymentStatus: 'PAID', status: 'CONFIRMED' }),
      },
    });
    const orderStatus = {
      markPaid: jest.fn().mockResolvedValue({ outcome, order: { ...order, paymentStatus: 'PAID' } }),
    } as unknown as OrderStatusService;
    const svc = new AdminService(
      prisma,
      config,
      loyalty,
      affiliate,
      notifications,
      new OrderReversalService(flash, coupons),
      orderStatus,
      rbac,
      defaultGomdonOrder,
      defaultGomdonClient,
    );
    return { svc, orderStatus: orderStatus as unknown as { markPaid: jest.Mock } };
  }
  const bankOrder = (over: Record<string, unknown> = {}) => ({
    id: 'o1',
    code: 'TB-1',
    type: 'RETAIL',
    status: 'PENDING_PAYMENT',
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: 'UNPAID',
    total: 350000,
    ...over,
  });

  it('đơn lẻ chuyển khoản → gọi hàm PAID dùng chung với actor ADMIN + mã GD vào ghi chú lịch sử', async () => {
    const { svc, orderStatus } = make(bankOrder());
    const res = await svc.confirmOrderPayment('admin-1', 'TB-1', { bankRef: ' FT999 ', note: 'khớp sao kê' });
    expect(orderStatus.markPaid).toHaveBeenCalledWith('o1', {
      actorType: 'ADMIN',
      actorId: 'admin-1',
      note: 'Admin xác nhận · Mã GD FT999 · khớp sao kê',
    });
    expect(res).toMatchObject({ ok: true, alreadyPaid: false });
    expect(res.order).toMatchObject({ id: 'o1', paymentStatus: 'PAID' });
  });

  it('bấm lại / admin khác đã bấm → 200 alreadyPaid, không lỗi', async () => {
    const { svc } = make(bankOrder({ paymentStatus: 'PAID', status: 'CONFIRMED' }), 'ALREADY_PAID');
    await expect(svc.confirmOrderPayment('admin-2', 'o1')).resolves.toMatchObject({ ok: true, alreadyPaid: true });
  });

  it('đơn đã huỷ/trả → 400 nhắc hoàn tiền thủ công', async () => {
    const { svc } = make(bankOrder({ status: 'CANCELLED' }), 'CLOSED');
    const err = await svc.confirmOrderPayment('admin-1', 'o1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('hoàn tiền thủ công');
  });

  it('đơn đã hoàn tiền (REFUNDED) → 400', async () => {
    const { svc } = make(bankOrder({ paymentStatus: 'REFUNDED', status: 'CONFIRMED' }), 'NOT_PAYABLE');
    await expect(svc.confirmOrderPayment('admin-1', 'o1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['COD', 'WALLET', 'ZALOPAY'])('đơn %s → 400, không gọi hàm PAID', async (paymentMethod) => {
    const { svc, orderStatus } = make(bankOrder({ paymentMethod }));
    await expect(svc.confirmOrderPayment('admin-1', 'o1')).rejects.toBeInstanceOf(BadRequestException);
    expect(orderStatus.markPaid).not.toHaveBeenCalled();
  });

  it('đơn đại lý → 400 chỉ đường sang xác nhận đơn đại lý (luật ghi công nợ ở đó)', async () => {
    const { svc, orderStatus } = make(bankOrder({ type: 'DEALER' }));
    const err = await svc.confirmOrderPayment('admin-1', 'o1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('đại lý');
    expect(orderStatus.markPaid).not.toHaveBeenCalled();
  });

  it('không có đơn → 404', async () => {
    const { svc } = make(null);
    await expect(svc.confirmOrderPayment('admin-1', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
