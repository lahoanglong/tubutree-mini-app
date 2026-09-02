import { CouponsService } from './coupons.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

const past = new Date(Date.now() - 864e5);
const future = new Date(Date.now() + 864e5);

function coupon(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    code: 'SALE',
    type: 'PERCENT',
    value: 10,
    minOrder: null,
    maxDiscount: null,
    startAt: past,
    endAt: future,
    perUserLimit: 1,
    usageLimit: null,
    ...over,
  };
}

function makeService(c: unknown, counts: number[] = [0, 0]) {
  let i = 0;
  const prisma = {
    coupon: { findUnique: jest.fn().mockResolvedValue(c) },
    couponRedemption: { count: jest.fn().mockImplementation(() => Promise.resolve(counts[i++] ?? 0)) },
  } as unknown as PrismaService;
  return new CouponsService(prisma);
}

describe('CouponsService.validateAndCompute', () => {
  it('mã không tồn tại → lỗi', async () => {
    await expect(makeService(null).validateAndCompute('X', 'u1', 100000)).rejects.toThrow('không tồn tại');
  });

  it('mã hết hạn → lỗi', async () => {
    const svc = makeService(coupon({ endAt: past, startAt: new Date(Date.now() - 2 * 864e5) }));
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('hết hạn');
  });

  it('dưới minOrder → lỗi', async () => {
    const svc = makeService(coupon({ minOrder: 200000 }));
    await expect(svc.validateAndCompute('SALE', 'u1', 150000)).rejects.toThrow('tối thiểu');
  });

  it('PERCENT kẹp theo maxDiscount', async () => {
    const svc = makeService(coupon({ type: 'PERCENT', value: 50, maxDiscount: 30000 }));
    const r = await svc.validateAndCompute('SALE', 'u1', 200000); // 50% = 100k nhưng cap 30k
    expect(r.discount).toBe(30000);
    expect(r.freeship).toBe(false);
  });

  it('AMOUNT không vượt quá subtotal', async () => {
    const svc = makeService(coupon({ type: 'AMOUNT', value: 100000 }));
    const r = await svc.validateAndCompute('SALE', 'u1', 80000);
    expect(r.discount).toBe(80000);
  });

  it('FREESHIP → freeship true, discount 0', async () => {
    const svc = makeService(coupon({ type: 'FREESHIP' }));
    const r = await svc.validateAndCompute('SALE', 'u1', 100000);
    expect(r.freeship).toBe(true);
    expect(r.discount).toBe(0);
  });

  it('hết lượt cá nhân (perUserLimit) → lỗi', async () => {
    const svc = makeService(coupon({ perUserLimit: 1 }), [1]); // đã dùng 1
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('hết lượt');
  });

  it('hết tổng lượt (usageLimit) → lỗi', async () => {
    const svc = makeService(coupon({ usageLimit: 100 }), [0, 100]); // user 0, tổng 100
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('hết lượt sử dụng');
  });
});

function makeServiceScoped(c: unknown, user: unknown = null, counts: number[] = [0, 0]) {
  let i = 0;
  const prisma = {
    coupon: { findUnique: jest.fn().mockResolvedValue(c) },
    couponRedemption: { count: jest.fn().mockImplementation(() => Promise.resolve(counts[i++] ?? 0)) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
  } as unknown as PrismaService;
  return new CouponsService(prisma);
}

describe('CouponsService.validateAndCompute scope ownership', () => {
  it('USER_GROUP đúng owner → trả CouponResult bình thường', async () => {
    const svc = makeServiceScoped(
      coupon({ scope: 'USER_GROUP', scopeMeta: { userId: 'u1' }, type: 'AMOUNT', value: 20000 }),
    );
    const r = await svc.validateAndCompute('SALE', 'u1', 100000);
    expect(r.discount).toBe(20000);
    expect(r.code).toBe('SALE');
  });

  it('USER_GROUP sai owner → lỗi với message Việt', async () => {
    const svc = makeServiceScoped(
      coupon({ scope: 'USER_GROUP', scopeMeta: { userId: 'u-other' } }),
    );
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow(
      'Mã không áp dụng cho tài khoản này.',
    );
  });

  it('TIER khác hạng → lỗi', async () => {
    const svc = makeServiceScoped(
      coupon({ scope: 'TIER', scopeMeta: { tierId: 'GOLD' } }),
      { tierId: 'SILVER' },
    );
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow(
      'Mã chỉ áp dụng cho hạng thành viên khác.',
    );
  });
});

// ─────────────────────────────────────────────────────────────
// B4: redeem atomic — bảo vệ usageLimit khỏi race + idempotency cho retry
// ─────────────────────────────────────────────────────────────

function makeRedeemService(opts: {
  coupon: unknown;
  updateManyCount?: number;
  createImpl?: jest.Mock;
  perUserCount?: number | number[];
}) {
  const updateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.updateManyCount ?? 1 });
  const create = opts.createImpl ?? jest.fn().mockResolvedValue({ id: 'r1' });
  // perUserLimit re-check trong redeem (in-tx) gọi couponRedemption.count. Mặc định 0 → chưa
  // dùng lần nào → pass. Cho phép truyền mảng để mô phỏng giá trị đổi giữa các lần gọi (race).
  const countValues = Array.isArray(opts.perUserCount) ? opts.perUserCount : [opts.perUserCount ?? 0];
  let countCallIdx = 0;
  const count = jest.fn().mockImplementation(() =>
    Promise.resolve(countValues[Math.min(countCallIdx++, countValues.length - 1)]),
  );
  const executeRaw = jest.fn().mockResolvedValue(0);
  const base: Record<string, unknown> = {
    coupon: {
      findUnique: jest.fn().mockResolvedValue(opts.coupon),
      updateMany,
    },
    couponRedemption: { create, count },
    $executeRaw: executeRaw,
  };
  // redeem() không tx → tự mở $transaction(cb) — mock chạy cb với chính client này (mirror
  // refill.service.spec.ts / rbac.service.spec.ts) để logic bên trong dùng CHUNG mock ở trên.
  base.$transaction = jest.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(base));
  const prisma = base as unknown as PrismaService;
  const svc = new CouponsService(prisma);
  return { svc, updateMany, create, count, executeRaw, transaction: base.$transaction as jest.Mock };
}

describe('CouponsService.redeem atomic (B4)', () => {
  it('usageLimit chưa đạt → updateMany count=1, tạo redemption OK', async () => {
    const { svc, updateMany, create } = makeRedeemService({
      coupon: coupon({ usageLimit: 100 }),
      updateManyCount: 1,
    });
    await svc.redeem('SALE', 'u1', 'o1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', usedCount: { lt: 100 } },
      data: { usedCount: { increment: 1 } },
    });
    expect(create).toHaveBeenCalledWith({
      data: { couponId: 'c1', userId: 'u1', orderId: 'o1' },
    });
  });

  it('usageLimit đã đạt (updateMany count=0) → BadRequestException, KHÔNG tạo redemption', async () => {
    const { svc, create } = makeRedeemService({
      coupon: coupon({ usageLimit: 1 }),
      updateManyCount: 0,
    });
    await expect(svc.redeem('SALE', 'u1', 'o1')).rejects.toThrow(
      'hết lượt sử dụng',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('race orderId trùng (P2002) → no-op, không throw', async () => {
    // Mock lỗi Prisma P2002 — instance của PrismaClientKnownRequestError.
    const { Prisma } = jest.requireActual('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const createImpl = jest.fn().mockRejectedValue(p2002);
    const { svc } = makeRedeemService({
      coupon: coupon({ usageLimit: null }),
      createImpl,
    });
    await expect(svc.redeem('SALE', 'u1', 'o1')).resolves.toBeUndefined();
    expect(createImpl).toHaveBeenCalled();
  });

  it('usageLimit null → bỏ qua atomic update, tạo redemption trực tiếp', async () => {
    const { svc, updateMany, create } = makeRedeemService({
      coupon: coupon({ usageLimit: null }),
    });
    await svc.redeem('SALE', 'u1', 'o1');
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Việc 2 (audit round 2): perUserLimit race — count()+create() không atomic trước đây.
// Khoá advisory pg_advisory_xact_lock(couponId,userId) đóng race mà KHÔNG cần nâng isolation
// của cả transaction checkout lên Serializable.
// ─────────────────────────────────────────────────────────────

describe('CouponsService.redeem — perUserLimit race (advisory lock)', () => {
  it('khoá advisory theo (couponId,userId) được gọi TRƯỚC count() và TRƯỚC create() — đúng thứ tự chống race', async () => {
    const order: string[] = [];
    const { svc, executeRaw, count, create } = makeRedeemService({
      coupon: coupon({ usageLimit: null, perUserLimit: 1 }),
      perUserCount: 0,
    });
    executeRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve(0);
    });
    (count as jest.Mock).mockImplementation(() => {
      order.push('count');
      return Promise.resolve(0);
    });
    (create as jest.Mock).mockImplementation(() => {
      order.push('create');
      return Promise.resolve({ id: 'r1' });
    });
    await svc.redeem('SALE', 'u1', 'o1');
    // Nếu count()/create() chạy TRƯỚC khi khoá được giữ, request thứ 2 chạy song song có thể
    // xen giữa (đọc count cũ) — đúng race đã được audit xác nhận. Thứ tự lock→count→create đảm
    // bảo mọi request khác cho CÙNG (couponId,userId) phải đợi tới khi request này commit/rollback.
    expect(order).toEqual(['lock', 'count', 'create']);
    // Tham số truyền vào $executeRaw (sau mảng template strings) đúng là couponId rồi userId —
    // sai thứ tự/tham số sẽ khoá nhầm cặp, không còn chống race đúng chỗ.
    expect(executeRaw.mock.calls[0].slice(1)).toEqual(['c1', 'u1']);
  });

  it('count() đọc được kết quả của request đi trước SAU khi qua khoá → vượt perUserLimit bị chặn, KHÔNG tạo thêm redemption', async () => {
    // Mô phỏng: request A đã redeem xong (đã có 1 CouponRedemption), request B tới sau, xếp hàng
    // ở advisory lock, khi qua được lock thì count() đọc lại thấy đã đủ perUserLimit.
    const { svc, create } = makeRedeemService({
      coupon: coupon({ usageLimit: null, perUserLimit: 1 }),
      perUserCount: 1, // đã dùng đúng 1 lần — hết lượt cho perUserLimit=1
    });
    await expect(svc.redeem('SALE', 'u1', 'o1')).rejects.toThrow('hết lượt cho mã này');
    expect(create).not.toHaveBeenCalled();
  });

  it('perUserLimit <= 0 (không giới hạn) → KHÔNG khoá advisory, KHÔNG check count', async () => {
    const { svc, executeRaw, count, create } = makeRedeemService({
      coupon: coupon({ usageLimit: null, perUserLimit: 0 }),
    });
    await svc.redeem('SALE', 'u1', 'o1');
    expect(executeRaw).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it('KHÔNG truyền tx (gọi standalone) → tự mở $transaction riêng để khoá advisory có phạm vi hợp lệ', async () => {
    const { svc, transaction } = makeRedeemService({
      coupon: coupon({ usageLimit: null, perUserLimit: 1 }),
    });
    await svc.redeem('SALE', 'u1', 'o1');
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('CÓ truyền tx (checkout.service.ts) → dùng thẳng tx đó, KHÔNG mở $transaction lồng mới', async () => {
    const { svc, transaction } = makeRedeemService({
      coupon: coupon({ usageLimit: null, perUserLimit: 1 }),
    });
    // Tái dùng chính prisma mock (đã có coupon/couponRedemption/$executeRaw) làm "tx" giả do
    // checkout truyền vào — chỉ cần đúng shape Prisma.TransactionClient dùng trong redeemInTx.
    const fakeTx = (svc as unknown as { prisma: PrismaService }).prisma as unknown as Prisma.TransactionClient;
    await svc.redeem('SALE', 'u1', 'o1', fakeTx);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('standalone: transaction riêng đụng P2034 (serialization/deadlock hiếm trên advisory lock) → báo thân thiện, không phải lỗi thô', async () => {
    const { svc, transaction } = makeRedeemService({ coupon: coupon({ usageLimit: null }) });
    transaction.mockRejectedValue({ code: 'P2034', message: 'serialization failure' });
    await expect(svc.redeem('SALE', 'u1', 'o1')).rejects.toThrow(
      'Hệ thống đang bận xử lý, vui lòng thử lại.',
    );
  });
});
