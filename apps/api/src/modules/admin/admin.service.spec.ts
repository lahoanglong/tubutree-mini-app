import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { OrderReversalService } from '../orders/order-reversal.service';
import { OrderStatusService } from '../orders/order-status.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CONSIGNMENT_PENDING_LINK_WHERE, PANCAKE_CODE_CHANGED } from '../merchant/merchant-pancake-link';
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
    userAdminEvent: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  const prisma: Record<string, unknown> = { ...base, ...over };
  // Mảng thao tác (ghi kèm sổ user_admin_events) và callback (setUserRole khoá danh sách admin) chạy thật trên mock.
  prisma.$transaction ??= jest.fn((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  );
  return prisma as unknown as PrismaService;
}

/** $transaction interactive (callback) cho reviewDealerApplication approve path. */
function makeApproveTx(opts: {
  dealerAppUpdateMany?: jest.Mock;
  userUpdate?: jest.Mock;
  applicantRole?: string;
  otherActiveAdmins?: number;
}) {
  const dealerAppUpdateMany = opts.dealerAppUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = opts.userUpdate ?? jest.fn().mockResolvedValue({});
  const executeRaw = jest.fn().mockResolvedValue(0);
  const userCount = jest.fn().mockResolvedValue(opts.otherActiveAdmins ?? 1);
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      $executeRaw: executeRaw,
      dealerApplication: { updateMany: dealerAppUpdateMany },
      user: {
        update: userUpdate,
        findUnique: jest.fn().mockResolvedValue({ role: opts.applicantRole ?? 'CUSTOMER' }),
        count: userCount,
      },
    }),
  );
  return { $transaction, dealerAppUpdateMany, userUpdate, executeRaw, userCount };
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

  // R4-ADMIN-6: duyệt đổi vai trò người nộp sang DEALER — người nộp là admin thì đây là một lần hạ quyền admin.
  it('người nộp là admin cuối cùng còn hoạt động → từ chối, không duyệt, không đổi vai trò', async () => {
    const { $transaction, dealerAppUpdateMany, userUpdate, executeRaw } = makeApproveTx({ applicantRole: 'ADMIN', otherActiveAdmins: 0 });
    const prisma = makePrisma({
      dealerApplication: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ metadata: null }) },
      $transaction,
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', true, 't1')).rejects.toThrow(/quản trị viên cuối cùng/);
    expect(executeRaw).toHaveBeenCalled();
    expect(dealerAppUpdateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('admin tự duyệt hồ sơ đại lý của chính mình → từ chối (tự hạ quyền)', async () => {
    const { $transaction, userUpdate } = makeApproveTx({ applicantRole: 'ADMIN', otherActiveAdmins: 3 });
    const prisma = makePrisma({
      dealerApplication: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'admin1' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ metadata: null }) },
      $transaction,
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', true, 't1')).rejects.toThrow(/chính mình/);
    expect(userUpdate).not.toHaveBeenCalled();
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

  // R4-ADMIN-10: admin dán SĐT từ Zalo (+84…/84…, có khoảng trắng) — User.phone lưu 0xxxxxxxxx nên tra đúng chuỗi gõ
  // vào báo nhầm "chưa mở Mini App".
  it.each(['+84899625240', '84899625240', '0899 625 240', ' +84 899.625.240 '])(
    'SĐT dạng %p → tra theo dạng lưu 0899625240 và thu hồi grant theo đúng SĐT đó',
    async (typed) => {
      const findUnique = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'ADMIN' });
      const update = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'STAFF', fullName: 'X' });
      const prisma = makePrisma({ user: { findUnique, update, count: jest.fn().mockResolvedValue(1) } });
      (rbac.revokeGrantsAbove as jest.Mock).mockClear();
      await mkAdmin(prisma).setUserRole('admin1', typed, 'STAFF');
      expect(findUnique).toHaveBeenCalledWith({ where: { phone: '0899625240' } });
      expect(rbac.revokeGrantsAbove).toHaveBeenCalledWith('0899625240', 'STAFF');
    },
  );

  it('không thấy user → thông báo kèm SĐT đã chuẩn hoá để admin đối chiếu', async () => {
    const prisma = makePrisma({ user: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(mkAdmin(prisma).setUserRole('admin1', '+84944555666', 'STAFF')).rejects.toThrow(
      'Không tìm thấy người dùng có SĐT 0944555666',
    );
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
    const count = jest.fn().mockResolvedValue(0);
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u2', phone: '0899625240', role: 'ADMIN' }), update, count },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'STAFF')).rejects.toThrow(/quản trị viên cuối cùng/);
    expect(update).not.toHaveBeenCalled();
    // Admin bị khoá không tính: không vào được trang quản trị để cấp lại quyền cho ai.
    expect(count).toHaveBeenCalledWith({ where: { role: 'ADMIN', isBlocked: false, id: { not: 'u2' } } });
  });

  it('hạ một ADMIN khi còn admin khác → cho qua', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u2', phone: '0899625240', role: 'STAFF', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u2', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(1) },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'STAFF')).resolves.toMatchObject({ ok: true });
  });

  // R4-ADMIN-6: đếm admin rồi mới ghi, không khoá → hai admin cuối cùng hạ nhau cùng lúc đều qua.
  it('đọc vai trò và đếm admin SAU khoá advisory chung, trong cùng transaction với lần ghi', async () => {
    const order: string[] = [];
    const update = jest.fn(async () => {
      order.push('update');
      return { id: 'u2', phone: '0899625240', role: 'STAFF', fullName: 'X' };
    });
    const prisma = makePrisma({
      $executeRaw: jest.fn(async () => {
        order.push('lock');
        return 0;
      }),
      user: {
        findUnique: jest.fn(async () => {
          order.push('read');
          return { id: 'u2', phone: '0899625240', role: 'ADMIN' };
        }),
        update,
        count: jest.fn(async () => {
          order.push('count');
          return 1;
        }),
      },
    });
    await mkAdmin(prisma).setUserRole('admin1', '0899625240', 'STAFF');
    expect(order).toEqual(['lock', 'read', 'count', 'update']);
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
    const prisma = makePrisma({ coupon: { create }, membershipTier: { findUnique: jest.fn().mockResolvedValue({ id: 'GOLD' }) } });
    await mkAdmin(prisma).createCoupon({ ...couponBase, scope: 'TIER', scopeMeta: { tierId: 'GOLD' } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'TIER', scopeMeta: { tierId: 'GOLD' } }) }),
    );
  });

  it('scope=USER_GROUP + scopeMeta.userId → ghi scopeMeta vào coupon.create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'c2' });
    const prisma = makePrisma({ coupon: { create }, user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) } });
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

describe('AdminService.createCoupon — chặn giá trị gõ nhầm (ADMINOPS-8 vòng 2)', () => {
  const base = { code: 'SALE10', type: 'PERCENT' as const, value: 10, startAt: '2026-01-01T00:00:00.000Z', endAt: '2099-12-31T00:00:00.000Z', scope: 'PUBLIC' as const };
  const run = (over: Record<string, unknown>) => {
    const create = jest.fn().mockResolvedValue({ id: 'c1' });
    return { create, p: mkAdmin(makePrisma({ coupon: { create } })).createCoupon({ ...base, ...over } as never) };
  };

  it('giảm 0% / 0đ → 400 (mã hiện "Đang chạy" mà không giảm gì)', async () => {
    for (const over of [{ value: 0 }, { type: 'AMOUNT', value: 0 }]) {
      const { create, p } = run(over);
      await expect(p).rejects.toThrow('Mức giảm phải lớn hơn 0');
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('mã freeship giá trị 0 vẫn hợp lệ', async () => {
    const { create, p } = run({ type: 'FREESHIP', value: 0 });
    await p;
    expect(create).toHaveBeenCalled();
  });

  it('ngày kết thúc đã qua → 400', async () => {
    const { p } = run({ startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-02-01T00:00:00.000Z' });
    await expect(p).rejects.toThrow('Ngày kết thúc đã qua');
  });

  // R4-ADMIN-11: mã trỏ tới hạng / người dùng không có thật thì không ai dùng được (isCouponEligible so đúng id) mà
  // admin vẫn thấy "Đã tạo voucher".
  it('scope=TIER với hạng không tồn tại → 400, không tạo', async () => {
    const create = jest.fn();
    const findTier = jest.fn().mockResolvedValue(null);
    const p = mkAdmin(makePrisma({ coupon: { create }, membershipTier: { findUnique: findTier } })).createCoupon({
      ...base,
      scope: 'TIER',
      scopeMeta: { tierId: 'nope' },
    });
    await expect(p).rejects.toThrow('Hạng thành viên "nope" không tồn tại');
    expect(findTier).toHaveBeenCalledWith({ where: { id: 'nope' }, select: { id: true } });
    expect(create).not.toHaveBeenCalled();
  });

  it('scope=USER_GROUP với người dùng không tồn tại → 400, không tạo', async () => {
    const create = jest.fn();
    const p = mkAdmin(makePrisma({ coupon: { create }, user: { findUnique: jest.fn().mockResolvedValue(null) } })).createCoupon({
      ...base,
      scope: 'USER_GROUP',
      scopeMeta: { userId: 'nope' },
    });
    await expect(p).rejects.toThrow('Không tìm thấy người dùng "nope"');
    expect(create).not.toHaveBeenCalled();
  });

  // R4-ADMIN-11: AMOUNT 200.000đ cho đơn tối thiểu 50.000đ — đơn ở mức tối thiểu được giảm hết tiền hàng.
  it('mã giảm tiền không nhỏ hơn đơn tối thiểu → 400; nhỏ hơn, hoặc không đặt đơn tối thiểu, thì được', async () => {
    await expect(run({ type: 'AMOUNT', value: 200_000, minOrder: 50_000 }).p).rejects.toThrow('nhỏ hơn đơn tối thiểu');
    await expect(run({ type: 'AMOUNT', value: 50_000, minOrder: 50_000 }).p).rejects.toThrow('nhỏ hơn đơn tối thiểu');
    for (const over of [
      { type: 'AMOUNT', value: 20_000, minOrder: 99_000 },
      { type: 'AMOUNT', value: 20_000 },
      { type: 'AMOUNT', value: 20_000, minOrder: 0 },
      { type: 'PERCENT', value: 10, minOrder: 5 },
    ]) {
      const ok = run(over);
      await ok.p;
      expect(ok.create).toHaveBeenCalled();
    }
  });

  it('giảm từ 50% mà không đặt Giảm tối đa → 400; có Giảm tối đa thì được', async () => {
    await expect(run({ value: 100 }).p).rejects.toThrow('Giảm tối đa');
    const ok = run({ value: 100, maxDiscount: 50_000 });
    await ok.p;
    expect(ok.create).toHaveBeenCalled();
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
      returnRequest: { count: jest.fn().mockResolvedValue(2) },
      $queryRaw: jest.fn().mockResolvedValue([{ all_refunds: 300000n, on_collected: 200000n }]),
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
    expect(stats.totalRevenue).toBe(1300000);
    expect(stats.returnRefundTotal).toBe(300000);
    expect(stats.pendingReturns).toBe(2);
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

const ADMIN_ACTOR = { id: 'admin-1', role: 'ADMIN' };

describe('AdminService.updateOrderStatus', () => {
  // C-024: admin từng đẩy được đơn chuyển khoản chưa ai trả lên DELIVERED → cộng điểm + chốt hoa hồng.
  it.each(['SHIPPING', 'DELIVERED'] as const)(
    'đơn BANK_TRANSFER chưa PAID → %s bị từ chối 400, không cộng điểm/hoa hồng',
    async (to) => {
      const order = {
        id: 'o9', code: 'TB-109', userId: 'u9', status: 'CONFIRMED', total: 250000, note: null, items: [],
        paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', fulfiller: 'TUBU', pancakeOrderId: 'pk9',
      };
      const { prisma, txUpdateMany } = makeStatusPrisma(order, order);
      (prisma as unknown as { dealerCreditLedger: unknown }).dealerCreditLedger = { findFirst: jest.fn().mockResolvedValue(null) };

      const err = await mkAdmin(prisma).updateOrderStatus(ADMIN_ACTOR, 'o9', to).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('Đã nhận tiền');
      expect(txUpdateMany).not.toHaveBeenCalled();
      expect(loyalty.creditOrderPoints).not.toHaveBeenCalledWith('o9');
      expect(affiliate.lockCommissionsForOrder).not.toHaveBeenCalledWith('o9');
    },
  );

  it('chuyển DELIVERED → credit điểm và lock hoa hồng', async () => {
    const order = { id: 'o1', code: 'TB-100', userId: 'u1', status: 'SHIPPING', total: 200000, note: null, items: [], fulfiller: 'TUBU', pancakeOrderId: 'pk1' };
    const { prisma } = makeStatusPrisma(order, { ...order, status: 'DELIVERED' });

    const res = await mkAdmin(prisma).updateOrderStatus(ADMIN_ACTOR, 'o1', 'DELIVERED', 'Giao thành công');
    expect(res.status).toBe('DELIVERED');
    expect(loyalty.creditOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.lockCommissionsForOrder).toHaveBeenCalledWith('o1');
  });

  it('chuyển CANCELLED → reverse điểm và reverse hoa hồng (kèm reversal restock — items rỗng)', async () => {
    const order = { id: 'o2', code: 'TB-101', userId: 'u2', status: 'CONFIRMED', total: 300000, note: null, items: [], paymentMethod: 'COD', paymentStatus: 'UNPAID' };
    const { prisma } = makeStatusPrisma(order, { ...order, status: 'CANCELLED' });

    const res = await mkAdmin(prisma).updateOrderStatus(ADMIN_ACTOR, 'o2', 'CANCELLED', 'Khách đổi ý');
    expect(res.status).toBe('CANCELLED');
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o2');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o2');
  });

  it('chuyển DELIVERED → CONFIRMED (regression) → BadRequest, không chạy side-effect', async () => {
    const order = { id: 'o3', code: 'TB-102', userId: 'u3', status: 'DELIVERED', total: 100000, note: null, items: [] };
    const { prisma } = makeStatusPrisma(order, order);

    await expect(mkAdmin(prisma).updateOrderStatus(ADMIN_ACTOR, 'o3', 'CONFIRMED')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalledWith('o3');
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalledWith('o3');
  });

  describe('theo nhóm việc và Pancake (R2-ADMINOPS-2)', () => {
    const cod = {
      id: 'o7', code: 'TB-107', userId: 'u7', status: 'CONFIRMED', total: 200000, note: null, items: [],
      paymentMethod: 'COD', paymentStatus: 'UNPAID', fulfiller: 'TUBU', pancakeOrderId: 'pk7',
    };
    it.each([
      [['CSKH'], 'DELIVERED'],
      [['CSKH'], 'PACKED'],
      [['KHO'], 'CANCELLED'],
      [['KHO'], 'DELIVERED'],
      [['CSKH', 'KHO'], 'SHIPPING'],
    ] as const)('STAFF %j → %s bị 403, không lật trạng thái', async (perms, to) => {
      const { prisma, txUpdateMany } = makeStatusPrisma(cod, cod);
      const err = await mkAdmin(prisma)
        .updateOrderStatus({ id: 'staff-1', role: 'STAFF', staffPermissions: [...perms] }, 'o7', to)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(txUpdateMany).not.toHaveBeenCalled();
    });

    it('CSKH huỷ được, KHO đóng gói được', async () => {
      const { prisma } = makeStatusPrisma(cod, { ...cod, status: 'CANCELLED' });
      await expect(
        mkAdmin(prisma).updateOrderStatus({ id: 's1', role: 'STAFF', staffPermissions: ['CSKH'] }, 'o7', 'CANCELLED'),
      ).resolves.toMatchObject({ status: 'CANCELLED' });
      const k = makeStatusPrisma(cod, { ...cod, status: 'PACKED' });
      await expect(
        mkAdmin(k.prisma).updateOrderStatus({ id: 's2', role: 'STAFF', staffPermissions: ['KHO'] }, 'o7', 'PACKED'),
      ).resolves.toMatchObject({ status: 'PACKED' });
    });

    it('ADMIN đánh dấu Đã giao tay cho đơn Tubu chưa lên Pancake → 400, không cộng điểm/hoa hồng', async () => {
      const order = { ...cod, id: 'o8', pancakeOrderId: null };
      const { prisma, txUpdateMany } = makeStatusPrisma(order, order);
      const err = await mkAdmin(prisma).updateOrderStatus(ADMIN_ACTOR, 'o8', 'DELIVERED').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('chưa lên Pancake');
      expect(txUpdateMany).not.toHaveBeenCalled();
      expect(loyalty.creditOrderPoints).not.toHaveBeenCalledWith('o8');
    });
  });

  it('đơn không tồn tại → throw NotFoundException', async () => {
    const prisma = makePrisma({
      order: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(mkAdmin(prisma).updateOrderStatus(ADMIN_ACTOR, 'non-existent', 'CANCELLED')).rejects.toThrow(
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

    await mkAdmin({ ...prisma, $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as PrismaService).listOrders(
      1,
      20,
      undefined,
      '0901234567',
    );
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
          OR: [
            { phone: { contains: '0901' } },
            { fullName: { contains: '0901', mode: 'insensitive' } },
            { fullNameSearch: { contains: '0901' } },
          ],
        },
        select: { id: true },
      }),
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [
        { code: { contains: '0901', mode: 'insensitive' } },
        { gomdonPartnerCode: { contains: '0901', mode: 'insensitive' } },
        { shippingCode: { contains: '0901', mode: 'insensitive' } },
        { pancakeOrderId: '0901' },
        { recipientSearch: { contains: '0901' } },
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
        { shippingCode: { contains: 'TB-123', mode: 'insensitive' } },
        { pancakeOrderId: 'TB-123' },
        { recipientSearch: { contains: 'tb-123' } },
      ],
    });
  });

  // R4-ADMIN-5: Prisma `contains` dựng LIKE không escape — "%" hay "_" khớp mọi đơn và CSV xuất cả bảng.
  it('% _ \\ trong chuỗi tìm được escape ở mọi nhánh LIKE (đơn, tên/SĐT khách, tên người nhận); mã Pancake so nguyên văn', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const userFindMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      order: { findMany, count: jest.fn().mockResolvedValue(0) },
      user: { findMany: userFindMany },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });
    const raw = String.raw`A%_\b`;
    const esc = String.raw`A\%\_\\b`;
    await mkAdmin(prisma).listOrders(1, 20, undefined, raw);
    expect(userFindMany.mock.calls[0][0].where.OR).toEqual([
      { phone: { contains: esc } },
      { fullName: { contains: esc, mode: 'insensitive' } },
      { fullNameSearch: { contains: esc.toLowerCase() } },
    ]);
    expect(findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { code: { contains: esc, mode: 'insensitive' } },
        { gomdonPartnerCode: { contains: esc, mode: 'insensitive' } },
        { shippingCode: { contains: esc, mode: 'insensitive' } },
        { pancakeOrderId: raw },
        { recipientSearch: { contains: esc.toLowerCase() } },
      ],
    });
  });

  // R4-ADMIN-4: Sức khoẻ hệ thống và Pancake POS hiện mã đơn Pancake dạng "#900033"; admin dán nguyên vào ô tìm.
  it('bỏ "#" đứng trước chuỗi tìm (mã Pancake / mã đơn chép kèm #)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      order: { findMany, count: jest.fn().mockResolvedValue(0) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });
    await mkAdmin({ ...prisma, $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as PrismaService).listOrders(
      1,
      20,
      undefined,
      ' # 900033 ',
    );
    const or = findMany.mock.calls[0][0].where.OR;
    expect(or).toEqual(expect.arrayContaining([{ pancakeOrderId: '900033' }, { code: { contains: '900033', mode: 'insensitive' } }]));
  });

  // R4-ADMIN-4: SĐT người nhận chép từ Excel mất số 0 đầu ("911222333") vẫn tra được index SĐT người nhận.
  it('SĐT người nhận thiếu số 0 đầu → tra trước theo đủ dạng 0… / +84… / 84…', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ id: 'o9' }]);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      order: { findMany, count: jest.fn().mockResolvedValue(0) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });
    await mkAdmin({ ...prisma, $queryRaw } as unknown as PrismaService).listOrders(1, 20, undefined, '911222333');
    expect($queryRaw.mock.calls[0]).toContainEqual(['0911222333', '+84911222333', '84911222333']);
    expect(findMany.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([{ id: { in: ['o9'] } }]));
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
    fulfiller: 'TUBU',
    pancakeOrderId: `pk-${String(o.code)}`,
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: 'UNPAID',
    items: [],
    user: null,
    ...o,
  });
  const list = async (
    items: Record<string, unknown>[],
    debits: { refId: string }[] = [],
    viewer?: { role: string; staffPermissions?: string[] },
    lateRefunds: { orderId: string }[] = [],
  ) => {
    const prisma = makePrisma({
      order: { findMany: jest.fn().mockResolvedValue(items.map(row)), count: jest.fn().mockResolvedValue(items.length) },
      dealerCreditLedger: { findMany: jest.fn().mockResolvedValue(debits) },
      orderCustomerRefund: { findMany: jest.fn().mockResolvedValue(lateRefunds) },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });
    const res = (await mkAdmin(prisma).listOrders(
      1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, viewer,
    )) as unknown as {
      data: { code: string; allowedTransitions: string[]; canConfirmPayment: boolean; canRecordLatePayment: boolean }[];
    };
    return Object.fromEntries(res.data.map((o) => [o.code, o])) as Record<
      string,
      { allowedTransitions: string[]; canConfirmPayment: boolean; canRecordLatePayment: boolean }
    >;
  };

  it('nút theo người xem: CSKH chỉ Huỷ, KHO chỉ Đóng gói; đơn Tubu chưa lên Pancake không có Giao vận/Đã giao (R2-ADMINOPS-2)', async () => {
    const orders = [
      { code: 'C', status: 'CONFIRMED', paymentMethod: 'COD' },
      { code: 'N', status: 'CONFIRMED', paymentMethod: 'COD', pancakeOrderId: null },
    ];
    const cskh = await list(orders, [], { role: 'STAFF', staffPermissions: ['CSKH'] });
    expect(cskh.C!.allowedTransitions).toEqual(['CANCELLED']);
    const kho = await list(orders, [], { role: 'STAFF', staffPermissions: ['KHO'] });
    expect(kho.C!.allowedTransitions).toEqual(['PACKED']);
    const admin = await list(orders, [], { role: 'ADMIN' });
    expect(admin.C!.allowedTransitions).toEqual(['PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED']);
    expect(admin.N!.allowedTransitions).toEqual(['PACKED', 'CANCELLED']);
  });

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

  it('nút "Ghi nhận tiền về muộn" tắt khi đơn đã có khoản tiền về muộn (webhook hay admin khác đã ghi) — R2-ADMINOPS-3', async () => {
    const orders = [
      { code: 'X1', status: 'CANCELLED' },
      { code: 'X2', status: 'CANCELLED' },
    ];
    const by = await list(orders, [], undefined, [{ orderId: 'X2' }]);
    expect(by.X1).toMatchObject({ canRecordLatePayment: true });
    expect(by.X2).toMatchObject({ canRecordLatePayment: false });
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
  it('listPendingMerchantProducts lấy sản phẩm chờ duyệt và sản phẩm đang bán có bản sửa chờ duyệt, có phân trang thật', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'p1', name: 'Nước giặt sinh học', approvalStatus: 'PENDING_REVIEW', editDraft: null },
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
        where: { OR: [{ approvalStatus: 'PENDING_REVIEW' }, { editDraft: { isNot: null } }] },
        skip: 0,
        take: 20,
      }),
    );
    expect(res.data).toHaveLength(1);
    expect(res.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  it('R3-MERCHANT-4: dòng có bản sửa hiện nội dung MỚI để admin duyệt, kèm nội dung đang bán để đối chiếu', async () => {
    const live = {
      id: 'p1', name: 'Nến thơm', description: 'Mô tả cũ', shortDesc: 'cũ', images: ['a.jpg'], thumbnail: 'a.jpg',
      approvalStatus: 'APPROVED', pancakeLinkCode: null,
    };
    const editDraft = { id: 'd1', productId: 'p1', name: 'Nến thơm sả', description: 'Mô tả mới', shortDesc: 'mới', images: ['b.jpg'], thumbnail: 'b.jpg', updatedAt: new Date() };
    const findMany = jest.fn().mockResolvedValue([{ ...live, editDraft }, { id: 'p2', name: 'Mới', approvalStatus: 'PENDING_REVIEW', editDraft: null }]);
    const prisma = makePrisma({
      product: { findMany, count: jest.fn().mockResolvedValue(2) },
      $transaction: jest.fn((arr) => Promise.all(arr)),
    });
    const res = await mkAdmin(prisma).listPendingMerchantProducts(1, 20);
    const [edit, fresh] = res.data as unknown as Record<string, unknown>[];
    expect(edit).toMatchObject({
      id: 'p1', name: 'Nến thơm sả', description: 'Mô tả mới', thumbnail: 'b.jpg', isEdit: true,
      live: { name: 'Nến thơm', description: 'Mô tả cũ', shortDesc: 'cũ', thumbnail: 'a.jpg' },
    });
    expect(edit).not.toHaveProperty('editDraft');
    expect((edit as { editVersion: string }).editVersion).toBe(editDraft.updatedAt.toISOString());
    expect(fresh).toMatchObject({ id: 'p2', name: 'Mới', isEdit: false, live: null, editVersion: null });
  });

  describe('R3-MERCHANT-4: duyệt hoặc từ chối bản sửa của sản phẩm đang bán', () => {
    const updatedAt = new Date('2026-10-14T03:00:00Z');
    const draft = { id: 'd1', productId: 'p1', name: 'Nến thơm sả', description: 'Mô tả mới', shortDesc: 'mới', images: ['b.jpg'], thumbnail: 'b.jpg', updatedAt };
    const product = { id: 'p1', name: 'Nến thơm', approvalStatus: 'APPROVED', storefront: { ownerUserId: 'owner-1' }, editDraft: draft };

    function setup(over: { taken?: number } = {}) {
      (notifications.notify as jest.Mock).mockClear();
      const productUpdate = jest.fn().mockResolvedValue({});
      const productUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const draftDeleteMany = jest.fn().mockResolvedValue({ count: over.taken ?? 1 });
      const prisma = makePrisma({
        product: {
          findUnique: jest.fn().mockResolvedValue(product),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ ...product, approvalStatus: 'APPROVED' }),
          update: productUpdate,
          updateMany: productUpdateMany,
        },
        productEditDraft: { deleteMany: draftDeleteMany },
        variation: { findFirst: jest.fn() },
        merchantPancakeLink: { findFirst: jest.fn() },
      });
      (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
      return { prisma, productUpdate, productUpdateMany, draftDeleteMany };
    }

    it('duyệt → nội dung mới ghi đè sản phẩm, bản chờ bị xoá, sản phẩm vẫn APPROVED và không đụng liên kết Pancake', async () => {
      const { prisma, productUpdate, productUpdateMany, draftDeleteMany } = setup();
      await mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true, undefined, false, updatedAt.toISOString());
      expect(draftDeleteMany).toHaveBeenCalledWith({ where: { id: 'd1', updatedAt } });
      expect(productUpdate).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Nến thơm sả', description: 'Mô tả mới', shortDesc: 'mới', images: ['b.jpg'], thumbnail: 'b.jpg', rejectReason: null },
      });
      expect(productUpdateMany).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith('owner-1', 'MERCHANT_PRODUCT_EDIT_APPROVED', expect.objectContaining({ product_name: 'Nến thơm sả' }));
    });

    it('từ chối → nội dung đang bán giữ nguyên, bản chờ bị xoá, lý do lưu ở rejectReason, đối tác được báo', async () => {
      const { prisma, productUpdate, productUpdateMany } = setup();
      await mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', false, 'Ảnh vi phạm bản quyền', false, updatedAt.toISOString());
      expect(productUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { rejectReason: 'Ảnh vi phạm bản quyền' } });
      expect(productUpdateMany).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith(
        'owner-1',
        'MERCHANT_PRODUCT_EDIT_REJECTED',
        expect.objectContaining({ product_name: 'Nến thơm', reason: 'Ảnh vi phạm bản quyền' }),
      );
    });

    it('bản chờ vừa được admin khác xử lý hoặc đối tác vừa sửa tiếp (xoá có điều kiện trượt) → BadRequest, không ghi gì', async () => {
      const { prisma, productUpdate } = setup({ taken: 0 });
      await expect(
        mkAdmin(prisma).reviewMerchantProduct('admin-2', 'p1', true, undefined, false, updatedAt.toISOString()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(productUpdate).not.toHaveBeenCalled();
    });

    it('bấm trên dòng đã cũ: bản chờ đã đổi (đối tác sửa tiếp) hoặc không còn → BadRequest, không đụng sản phẩm, không rơi sang đường duyệt cả sản phẩm', async () => {
      const { prisma, productUpdate, productUpdateMany, draftDeleteMany } = setup();
      const stale = new Date('2026-10-14T02:00:00Z').toISOString();
      await expect(mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true, undefined, false, stale)).rejects.toBeInstanceOf(BadRequestException);
      await expect(mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', false, 'x', false, stale)).rejects.toBeInstanceOf(BadRequestException);
      expect(draftDeleteMany).not.toHaveBeenCalled();
      expect(productUpdate).not.toHaveBeenCalled();
      expect(productUpdateMany).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('dòng mang phiên bản bản sửa nhưng sản phẩm không còn bản chờ → BadRequest, KHÔNG từ chối cả sản phẩm đang bán', async () => {
      const { prisma, productUpdate, productUpdateMany } = setup();
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({ ...product, editDraft: null });
      await expect(
        mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', false, 'x', false, updatedAt.toISOString()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(productUpdateMany).not.toHaveBeenCalled();
      expect(productUpdate).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('dòng không mang phiên bản (không phải bản sửa) mà sản phẩm đã APPROVED → CAS chỉ nhận PENDING_REVIEW nên BadRequest, không đổi trạng thái hay gỡ liên kết', async () => {
      const { prisma, productUpdate, productUpdateMany } = setup();
      productUpdateMany.mockImplementation(async ({ where }: { where: { approvalStatus: string } }) => ({
        count: where.approvalStatus === 'PENDING_REVIEW' ? 0 : 1,
      }));
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({ ...product, editDraft: null });
      await expect(mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', false, 'x')).rejects.toBeInstanceOf(BadRequestException);
      await expect(mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true)).rejects.toBeInstanceOf(BadRequestException);
      expect(productUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', approvalStatus: 'PENDING_REVIEW' } }));
      expect(productUpdate).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('dòng không mang phiên bản mà sản phẩm có bản chờ (client cũ) → BadRequest, không duyệt/từ chối cả sản phẩm', async () => {
      const { prisma, productUpdate, productUpdateMany, draftDeleteMany } = setup();
      productUpdateMany.mockResolvedValue({ count: 0 });
      await expect(mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', false, 'x')).rejects.toBeInstanceOf(BadRequestException);
      expect(draftDeleteMany).not.toHaveBeenCalled();
      expect(productUpdate).not.toHaveBeenCalled();
    });
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
      merchantPancakeLink: { create: jest.fn().mockResolvedValue({}) },
    });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    await mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true, undefined, false, undefined, { pancakeCode: 'PK-1' });
    expect(variationUpdateMany).toHaveBeenCalledWith({ where: { id: 'var-pk', productId: 'shell' }, data: { productId: 'p1' } });
    // R4-PARTNER-6: CAS gồm cả mã đang xin liên kết, đối tác đổi mã giữa lúc admin xem và bấm thì duyệt trượt.
    const casWhere = (prisma.product.updateMany as jest.Mock).mock.calls[0][0].where;
    expect(casWhere).toEqual({ id: 'p1', approvalStatus: 'PENDING_REVIEW', pancakeLinkCode: product.pancakeLinkCode });
    expect(notifications.notify).toHaveBeenCalledWith('owner-1', 'MERCHANT_PRODUCT_APPROVED', expect.objectContaining({ product_name: 'Mật ong' }));
  });

  describe('mã Pancake admin đã xem trên màn duyệt', () => {
    function setup(read: { approvalStatus?: string; pancakeLinkCode: string | null }, casCount = 1, now = read) {
      const product = { id: 'p1', name: 'Mật ong', storefrontId: 'sf-a', storefront: { ownerUserId: 'owner-1' }, approvalStatus: 'PENDING_REVIEW', ...read };
      const updateMany = jest.fn().mockResolvedValue({ count: casCount });
      const findUnique = jest.fn().mockResolvedValueOnce(product).mockResolvedValueOnce({ approvalStatus: 'PENDING_REVIEW', ...now });
      const prisma = makePrisma({
        product: { findUnique, findUniqueOrThrow: jest.fn().mockResolvedValue(product), updateMany, update: jest.fn() },
        variation: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
        merchantPancakeLink: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
      return { prisma, updateMany, variationUpdateMany: prisma.variation.updateMany as jest.Mock };
    }

    it('đối tác đã đổi sang mã khác trước khi admin bấm Duyệt → 409 PANCAKE_CODE_CHANGED, không lật trạng thái, không chuyển biến thể', async () => {
      const { prisma, updateMany, variationUpdateMany } = setup({ pancakeLinkCode: 'PK-B' });
      const res = mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true, undefined, true, undefined, { pancakeCode: 'PK-A', takeoverProductId: 'tubu-x' });
      await expect(res).rejects.toBeInstanceOf(ConflictException);
      await expect(res).rejects.toMatchObject({
        response: expect.objectContaining({ code: PANCAKE_CODE_CHANGED, message: expect.stringContaining('Tải lại danh sách') }),
      });
      expect(updateMany).not.toHaveBeenCalled();
      expect(variationUpdateMany).not.toHaveBeenCalled();
    });

    it('client không gửi mã đã xem mà sản phẩm có mã → 409, không duyệt mã nào', async () => {
      const { prisma, updateMany } = setup({ pancakeLinkCode: 'PK-B' });
      await expect(mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true, undefined, true)).rejects.toMatchObject({
        response: expect.objectContaining({ code: PANCAKE_CODE_CHANGED }),
      });
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('đối tác đổi mã giữa lúc đọc và lúc lật trạng thái (CAS trượt, sản phẩm vẫn chờ duyệt) → 409 PANCAKE_CODE_CHANGED', async () => {
      const { prisma, updateMany } = setup({ pancakeLinkCode: 'PK-A' }, 0, { pancakeLinkCode: 'PK-B' });
      await expect(
        mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true, undefined, true, undefined, { pancakeCode: 'PK-A', takeoverProductId: 'tubu-x' }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: PANCAKE_CODE_CHANGED }) });
      expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'p1', approvalStatus: 'PENDING_REVIEW', pancakeLinkCode: 'PK-A' });
    });

    it('từ chối kèm mã đã xem khác mã hiện tại → 409; từ chối không kèm mã vẫn được', async () => {
      const stale = setup({ pancakeLinkCode: 'PK-B' });
      await expect(
        mkAdmin(stale.prisma).reviewMerchantProduct('admin-1', 'p1', false, 'x', false, undefined, { pancakeCode: 'PK-A' }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: PANCAKE_CODE_CHANGED }) });
      const plain = setup({ pancakeLinkCode: 'PK-B' });
      await mkAdmin(plain.prisma).reviewMerchantProduct('admin-1', 'p1', false, 'x');
      expect(plain.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  it('reviewMerchantProduct từ chối REJECTED kèm lý do', async () => {
    const product = { id: 'p1', name: 'Kem chống nắng', approvalStatus: 'PENDING_REVIEW' };
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...product, approvalStatus: 'REJECTED', rejectReason: 'Chưa đủ chứng nhận' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      merchantPancakeLink: { findFirst: jest.fn().mockResolvedValue(null) },
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

describe('AdminService.listLinkedMerchantProducts — lọc liên kết ký gửi chờ xác nhận (R4-ADMIN-7)', () => {
  const linkedPrisma = () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = makePrisma({
      merchantPancakeLink: { findMany, count },
      $transaction: jest.fn((arr) => Promise.all(arr)),
    });
    return { prisma, findMany, count };
  };

  it('không lọc: mọi liên kết còn hiệu lực', async () => {
    const { prisma, findMany, count } = linkedPrisma();
    await mkAdmin(prisma).listLinkedMerchantProducts(1, 20);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { unlinkedAt: null } }));
    expect(count).toHaveBeenCalledWith({ where: { unlinkedAt: null } });
  });

  it('consignment=PENDING: đúng điều kiện số "Việc cần xử lý" đếm', async () => {
    const { prisma, findMany, count } = linkedPrisma();
    await mkAdmin(prisma).listLinkedMerchantProducts(1, 20, 'PENDING');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: CONSIGNMENT_PENDING_LINK_WHERE }));
    expect(count).toHaveBeenCalledWith({ where: CONSIGNMENT_PENDING_LINK_WHERE });
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
      orderCustomerRefund: { createMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    const orderStatus = {
      markPaid: jest.fn().mockResolvedValue({ outcome, order: outcome === 'CLOSED' ? order : { ...order, paymentStatus: 'PAID' } }),
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
    return { svc, prisma, orderStatus: orderStatus as unknown as { markPaid: jest.Mock } };
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

  it('tiền chuyển khoản về muộn cho đơn đã huỷ → ghi khoản hoàn LATE_PAYMENT vào hàng đợi Hoàn tiền khách (D2, R2-ADMINOPS-3)', async () => {
    const { svc, prisma } = make(bankOrder({ status: 'CANCELLED', userId: 'u9' }), 'CLOSED');
    const res = await svc.confirmOrderPayment('admin-1', 'TB-1', { bankRef: ' FT2627001 ' });
    expect(res).toMatchObject({ ok: true, latePayment: true });
    expect(res.message).toContain('Hoàn tiền khách');
    const createMany = (prisma as unknown as { orderCustomerRefund: { createMany: jest.Mock } }).orderCustomerRefund.createMany;
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({
      orderId: 'o1',
      kind: 'LATE_PAYMENT',
      refKey: 'ADMIN:manual',
      amount: 350000,
      method: 'MANUAL_TRANSFER',
      status: 'PENDING',
      adminNote: 'Admin ghi nhận tiền về muộn · Mã GD FT2627001',
    });
  });

  it('R3-MONEY-3: khách chỉ chuyển 50.000 cho đơn đã huỷ → khoản hoàn ghi đúng số tiền thực nhận, không phải tổng đơn', async () => {
    const { svc, prisma } = make(bankOrder({ status: 'CANCELLED', userId: 'u9' }), 'CLOSED');
    const res = await svc.confirmOrderPayment('admin-1', 'TB-1', { bankRef: 'FT50', amount: 50000 });
    expect(res.message).toContain('50.000đ');
    const createMany = (prisma as unknown as { orderCustomerRefund: { createMany: jest.Mock } }).orderCustomerRefund.createMany;
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({ kind: 'LATE_PAYMENT', amount: 50000 });
  });

  it.each([
    ['0đ', 0],
    ['vượt tổng đơn', 350001],
    ['số lẻ', 1000.5],
  ])('R3-MONEY-3: số tiền thực nhận %s → 400, không ghi gì', async (_l, amount) => {
    const { svc, orderStatus } = make(bankOrder({ status: 'CANCELLED', userId: 'u9' }), 'CLOSED');
    await expect(svc.confirmOrderPayment('admin-1', 'TB-1', { amount })).rejects.toThrow('Số tiền thực nhận');
    expect(orderStatus.markPaid).not.toHaveBeenCalled();
  });

  it('R3-MONEY-3: đơn còn sống mà số thực nhận thiếu → 400, không lật "đã thanh toán"', async () => {
    const { svc, orderStatus } = make(bankOrder());
    await expect(svc.confirmOrderPayment('admin-1', 'TB-1', { amount: 200000 })).rejects.toThrow('chưa xác nhận thanh toán được');
    expect(orderStatus.markPaid).not.toHaveBeenCalled();
  });

  it('đơn đã có khoản tiền về muộn (webhook Pancake ghi trước) → admin bấm không tạo khoản thứ hai (R2-ADMINOPS-3)', async () => {
    const { svc, prisma } = make(bankOrder({ status: 'CANCELLED', userId: 'u9' }), 'CLOSED');
    const refunds = (prisma as unknown as { orderCustomerRefund: { createMany: jest.Mock; findFirst: jest.Mock } }).orderCustomerRefund;
    refunds.findFirst.mockResolvedValue({ id: 'r-pancake' });
    const res = await svc.confirmOrderPayment('admin-1', 'TB-1', { bankRef: 'FT-KHAC' });
    expect(res).toMatchObject({ ok: true, latePayment: true });
    expect(res.message).toContain('đã được ghi trước đó');
    expect(refunds.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 'o1', kind: 'LATE_PAYMENT', refKey: undefined } }));
    expect(refunds.createMany).not.toHaveBeenCalled();
  });

  it('bấm lại cùng mã GD (khoản hoàn đã ghi) → báo đã ghi trước đó, không tạo khoản thứ hai', async () => {
    const { svc, prisma } = make(bankOrder({ status: 'CANCELLED', userId: 'u9' }), 'CLOSED');
    (prisma as unknown as { orderCustomerRefund: { createMany: jest.Mock } }).orderCustomerRefund.createMany.mockResolvedValue({ count: 0 });
    const res = await svc.confirmOrderPayment('admin-1', 'TB-1', { bankRef: 'FT1' });
    expect(res).toMatchObject({ ok: true, latePayment: true });
    expect(res.message).toContain('đã được ghi trước đó');
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

describe('AdminService.getDealerPriceHistory — sổ lịch sử giá đại lý cho màn admin (ADMINOPS-17)', () => {
  it('kèm tên sản phẩm/biến thể, tên bậc và người đổi; lọc theo SKU', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'h1',
        variationId: 'v1',
        sku: 'SKU-1',
        tierId: 'tier_gold',
        oldPrice: 200000,
        newPrice: 190000,
        changedBy: 'a1',
        createdAt: new Date('2026-10-10T00:00:00Z'),
        variation: { name: 'Chai 500ml', product: { name: 'Nước rửa chén' } },
      },
    ]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = makePrisma({
      dealerPriceHistory: { findMany, count },
      dealerTier: { findMany: jest.fn().mockResolvedValue([{ id: 'tier_gold', name: 'Vàng' }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'a1', fullName: 'Chủ shop' }]) },
    });
    const res = await mkAdmin(prisma).getDealerPriceHistory({ sku: ' sku-1 ' }, 1, 20);
    expect(findMany.mock.calls[0][0].where).toEqual({ sku: { contains: 'sku-1', mode: 'insensitive' } });
    expect(res.data[0]).toMatchObject({
      sku: 'SKU-1',
      productName: 'Nước rửa chén',
      variationName: 'Chai 500ml',
      tierName: 'Vàng',
      changedByName: 'Chủ shop',
      oldPrice: 200000,
      newPrice: 190000,
    });
    expect(res.meta.total).toBe(1);
  });
});
