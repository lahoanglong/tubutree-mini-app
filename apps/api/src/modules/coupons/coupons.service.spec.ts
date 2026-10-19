import { CouponMinOrderError, CouponsService, NEW_CUSTOMER_ONLY_MSG } from './coupons.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import { FIRST_ORDER_LOCK, priorOrderWhere } from '../../common/first-order';
import { REAL_USER_REQUIRED_MSG } from '../../common/real-user';

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

const REAL_USER = { id: 'u1', tierId: null, phone: '0912345678', zaloId: 'z1' };

/** `claimed`: khách đã nhận mã CLAIM; `priorOrder`: khách đã có đơn (không còn là khách mới). */
type Extra = { claimed?: boolean; priorOrder?: boolean };

function extraModels(extra: Extra) {
  return {
    couponClaim: {
      findUnique: jest.fn().mockResolvedValue(extra.claimed ? { id: 'cl1' } : null),
      findMany: jest.fn().mockResolvedValue(extra.claimed ? [{ couponId: 'c1' }] : []),
    },
    order: { findFirst: jest.fn().mockResolvedValue(extra.priorOrder ? { id: 'o0' } : null) },
  };
}

function makeService(c: unknown, counts: number[] = [0, 0], user: unknown = REAL_USER, extra: Extra = {}) {
  let i = 0;
  const prisma = {
    coupon: { findUnique: jest.fn().mockResolvedValue(c) },
    couponRedemption: { count: jest.fn().mockImplementation(() => Promise.resolve(counts[i++] ?? 0)) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    ...extraModels(extra),
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

describe('CouponsService.validateAndCompute — chống lạm dụng mã (UAT p6)', () => {
  it('ADMINOPS-7: mã khách gõ có khoảng trắng/chữ thường vẫn tra theo mã chuẩn hoá (HOA, bỏ khoảng trắng)', async () => {
    const findUnique = jest.fn().mockResolvedValue(coupon({ code: 'SUMMER10' }));
    const prisma = {
      coupon: { findUnique },
      couponRedemption: { count: jest.fn().mockResolvedValue(0) },
      user: { findUnique: jest.fn().mockResolvedValue(REAL_USER) },
    } as unknown as PrismaService;
    const r = await new CouponsService(prisma).validateAndCompute('  summer10 ', 'u1', 100000);
    expect(findUnique).toHaveBeenCalledWith({ where: { code: 'SUMMER10' } });
    expect(r.code).toBe('SUMMER10');
  });

  it('ADMINOPS-8: mã đã bị admin tắt (isActive=false) → báo ngừng áp dụng', async () => {
    const svc = makeService(coupon({ isActive: false }));
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('Mã giảm giá đã ngừng áp dụng.');
  });

  it('MONEY-16: mã công khai giới hạn theo người + tài khoản khách (guest_, chưa SĐT) → yêu cầu đăng nhập Zalo', async () => {
    const svc = makeService(coupon({ scope: 'PUBLIC', perUserLimit: 1 }), [0, 0], {
      id: 'u1', tierId: null, phone: null, zaloId: 'guest_dev1',
    });
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('đăng nhập Zalo');
  });

  it('MONEY-16: mã công khai KHÔNG giới hạn theo người (perUserLimit 0) → khách vẫn dùng được', async () => {
    const svc = makeService(coupon({ scope: 'PUBLIC', perUserLimit: 0 }), [0, 0], {
      id: 'u1', tierId: null, phone: null, zaloId: 'guest_dev1',
    });
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).resolves.toMatchObject({ discount: 10000 });
  });

  it('MONEY-4: mã gắn sản phẩm (applyTo.productIds) + giỏ không có sản phẩm đó → từ chối', async () => {
    const svc = makeService(coupon({ type: 'AMOUNT', value: 49350, applyTo: { productIds: ['pG'] } }));
    await expect(
      svc.validateAndCompute('SALE', 'u1', 395000, [{ productId: 'pX', total: 395000 }]),
    ).rejects.toThrow('chỉ áp dụng');
  });

  it('MONEY-4: mã gắn sản phẩm mà caller không đưa dòng giỏ → từ chối (không tính trên tổng giỏ)', async () => {
    const svc = makeService(coupon({ type: 'AMOUNT', value: 49350, applyTo: { productIds: ['pG'] } }));
    await expect(svc.validateAndCompute('SALE', 'u1', 395000)).rejects.toThrow('chỉ áp dụng');
  });

  it('MONEY-4: mã gắn sản phẩm → minOrder và mức giảm tính trên đúng dòng sản phẩm đó', async () => {
    const svc = makeService(
      coupon({ type: 'AMOUNT', value: 49350, minOrder: 279650, applyTo: { productIds: ['pG'] } }),
    );
    await expect(
      svc.validateAndCompute('SALE', 'u1', 600000, [
        { productId: 'pX', total: 400000 },
        { productId: 'pG', total: 200000 },
      ]),
    ).rejects.toThrow('tối thiểu');
    const r = await svc.validateAndCompute('SALE', 'u1', 729000, [
      { productId: 'pX', total: 400000 },
      { productId: 'pG', total: 329000 },
    ]);
    expect(r.discount).toBe(49350);
  });

  it('lỗi đơn tối thiểu mang mã lỗi riêng kèm mức tối thiểu và phần hàng đã dùng để xét (mã gắn sản phẩm: chỉ dòng sản phẩm đó)', async () => {
    const plain = makeService(coupon({ minOrder: 200000 }));
    const e1 = await plain.validateAndCompute('SALE', 'u1', 150000).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(CouponMinOrderError);
    expect(e1).toMatchObject({ minOrder: 200000, base: 150000, message: 'Đơn tối thiểu 200.000đ để dùng mã này.' });

    const scoped = makeService(coupon({ type: 'AMOUNT', value: 49350, minOrder: 279650, applyTo: { productIds: ['pG'] } }));
    const e2 = await scoped
      .validateAndCompute('SALE', 'u1', 600000, [
        { productId: 'pX', total: 400000 },
        { productId: 'pG', total: 200000 },
      ])
      .catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(CouponMinOrderError);
    expect(e2).toMatchObject({ minOrder: 279650, base: 200000 });
  });

  it('lỗi khác (không tồn tại, hết hạn) không phải lỗi đơn tối thiểu', async () => {
    const e = await makeService(null).validateAndCompute('X', 'u1', 100000).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(CouponMinOrderError);
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

describe('CouponsService — nhân viên không dùng mã do chính mình tạo (D1-05)', () => {
  it('mã công khai do nhân viên tạo: chính người tạo áp mã → từ chối, nói rõ lý do', async () => {
    const svc = makeServiceScoped(coupon({ scope: 'PUBLIC', createdById: 'u1' }), { ...REAL_USER, role: 'STAFF' });
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('Mã do chính bạn tạo');
  });

  it('quản trị viên áp mã mình tạo, khách áp mã nhân viên tạo → bình thường', async () => {
    const own = makeServiceScoped(coupon({ scope: 'PUBLIC', createdById: 'u1', type: 'AMOUNT', value: 20000 }), { ...REAL_USER, role: 'ADMIN' });
    expect((await own.validateAndCompute('SALE', 'u1', 100000)).discount).toBe(20000);
    const other = makeServiceScoped(coupon({ scope: 'PUBLIC', createdById: 's9', type: 'AMOUNT', value: 20000 }), { ...REAL_USER, role: 'CUSTOMER' });
    expect((await other.validateAndCompute('SALE', 'u1', 100000)).discount).toBe(20000);
  });
});

describe('CouponsService.validateAndCompute — mã ẩn CLAIM và mã chỉ khách mới (D2-03)', () => {
  const GUEST = { id: 'u1', tierId: null, phone: null, zaloId: 'guest_abc' };

  it('CLAIM: khách đã nhận mã → áp được', async () => {
    const svc = makeService(coupon({ scope: 'CLAIM', type: 'AMOUNT', value: 20000 }), [0, 0], REAL_USER, { claimed: true });
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).resolves.toMatchObject({ discount: 20000 });
  });

  it('CLAIM: khách chưa nhận mã → từ chối như mã của người khác', async () => {
    const svc = makeService(coupon({ scope: 'CLAIM' }), [0, 0], REAL_USER, { claimed: false });
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow('Mã không áp dụng cho tài khoản này.');
  });

  it('chỉ khách mới + khách đã có đơn chưa huỷ → từ chối với câu riêng', async () => {
    const svc = makeService(coupon({ newCustomerOnly: true }), [0, 0], REAL_USER, { priorOrder: true });
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow(NEW_CUSTOMER_ONLY_MSG);
  });

  it('chỉ khách mới + khách chưa có đơn nào → áp được; đếm đơn theo đúng luật khách mới', async () => {
    const svc = makeService(coupon({ newCustomerOnly: true, type: 'AMOUNT', value: 15000 }), [0, 0], REAL_USER, { priorOrder: false });
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).resolves.toMatchObject({ discount: 15000 });
    const findFirst = (svc as unknown as { prisma: { order: { findFirst: jest.Mock } } }).prisma.order.findFirst;
    expect(findFirst).toHaveBeenCalledWith({ where: priorOrderWhere('u1'), select: { id: true } });
  });

  it('chỉ khách mới + tài khoản khách vãng lai chưa SĐT → đòi đăng nhập Zalo (tài khoản khách luôn "mới")', async () => {
    const svc = makeService(coupon({ newCustomerOnly: true, perUserLimit: 0 }), [0, 0], GUEST, { priorOrder: false });
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).rejects.toThrow(REAL_USER_REQUIRED_MSG);
  });

  it('mã thường (không cờ khách mới) không đọc đơn của khách', async () => {
    const svc = makeService(coupon(), [0, 0], REAL_USER, { priorOrder: true });
    await expect(svc.validateAndCompute('SALE', 'u1', 100000)).resolves.toBeDefined();
    const findFirst = (svc as unknown as { prisma: { order: { findFirst: jest.Mock } } }).prisma.order.findFirst;
    expect(findFirst).not.toHaveBeenCalled();
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
  existingRedemption?: unknown;
  claimed?: boolean;
  priorOrder?: boolean;
  checkoutGroup?: string | null;
}) {
  const updateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.updateManyCount ?? 1 });
  // createMany(skipDuplicates) = INSERT ... ON CONFLICT DO NOTHING; count 0 = đơn đã có redemption.
  const create = opts.createImpl ?? jest.fn().mockResolvedValue({ count: 1 });
  const findRedemption = jest.fn().mockResolvedValue(opts.existingRedemption ?? null);
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
    couponRedemption: { createMany: create, count, findUnique: findRedemption },
    couponClaim: { findUnique: jest.fn().mockResolvedValue(opts.claimed ? { id: 'cl1' } : null) },
    order: {
      findUnique: jest.fn().mockResolvedValue({ checkoutGroup: opts.checkoutGroup ?? null }),
      findFirst: jest.fn().mockResolvedValue(opts.priorOrder ? { id: 'o0' } : null),
    },
    $executeRaw: executeRaw,
  };
  // redeem() không tx → tự mở $transaction(cb) — mock chạy cb với chính client này (mirror
  // rbac.service.spec.ts) để logic bên trong dùng CHUNG mock ở trên.
  base.$transaction = jest.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(base));
  const prisma = base as unknown as PrismaService;
  const svc = new CouponsService(prisma);
  const order = base.order as { findUnique: jest.Mock; findFirst: jest.Mock };
  return { svc, updateMany, create, count, findRedemption, executeRaw, order, transaction: base.$transaction as jest.Mock };
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
      data: [{ couponId: 'c1', userId: 'u1', orderId: 'o1' }],
      skipDuplicates: true,
    });
  });

  it('usageLimit đã đạt (updateMany count=0) → BadRequestException (throw rollback cả redemption vừa ghi)', async () => {
    const { svc } = makeRedeemService({
      coupon: coupon({ usageLimit: 1 }),
      updateManyCount: 0,
    });
    await expect(svc.redeem('SALE', 'u1', 'o1')).rejects.toThrow(
      'hết lượt sử dụng',
    );
  });

  it('đơn đã có redemption (retry) → no-op, KHÔNG ghi thêm, KHÔNG tăng usedCount', async () => {
    const { svc, create, updateMany } = makeRedeemService({
      coupon: coupon({ usageLimit: 100 }),
      existingRedemption: { id: 'r0' },
    });
    await expect(svc.redeem('SALE', 'u1', 'o1')).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('race cùng đơn: INSERT bị ON CONFLICT bỏ qua (count=0) → no-op, KHÔNG tăng usedCount, không throw', async () => {
    const { svc, updateMany } = makeRedeemService({
      coupon: coupon({ usageLimit: 100 }),
      createImpl: jest.fn().mockResolvedValue({ count: 0 }),
    });
    await expect(svc.redeem('SALE', 'u1', 'o1')).resolves.toBeUndefined();
    expect(updateMany).not.toHaveBeenCalled();
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
      return Promise.resolve({ count: 1 });
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

describe('CouponsService.redeem — mã chỉ khách mới và mã CLAIM (D2-03)', () => {
  it('chỉ khách mới: khoá đơn đầu theo khách TRƯỚC khoá (mã, khách), rồi đọc đơn trừ chính lần đặt này', async () => {
    const calls: string[] = [];
    const { svc, executeRaw, order, create } = makeRedeemService({
      coupon: coupon({ newCustomerOnly: true, perUserLimit: 1 }),
      checkoutGroup: 'DH1',
    });
    executeRaw.mockImplementation((_s: TemplateStringsArray, a: string) => {
      calls.push(a === FIRST_ORDER_LOCK ? 'lock-first' : 'lock-coupon');
      return Promise.resolve(0);
    });
    order.findFirst.mockImplementation(() => {
      calls.push('read-orders');
      return Promise.resolve(null);
    });
    await svc.redeem('SALE', 'u1', 'o1');
    expect(calls).toEqual(['lock-first', 'read-orders', 'lock-coupon']);
    expect(executeRaw.mock.calls[0].slice(1)).toEqual([FIRST_ORDER_LOCK, 'u1']);
    expect(order.findFirst.mock.calls[0][0].where).toEqual(priorOrderWhere('u1', { orderIds: ['o1'], checkoutGroup: 'DH1' }));
    expect(create).toHaveBeenCalled();
  });

  it('chỉ khách mới: đã có đơn khác (lần đặt song song đi trước đã ghi) → từ chối, KHÔNG ghi lượt dùng', async () => {
    const { svc, create } = makeRedeemService({ coupon: coupon({ newCustomerOnly: true }), priorOrder: true });
    await expect(svc.redeem('SALE', 'u1', 'o1')).rejects.toThrow(NEW_CUSTOMER_ONLY_MSG);
    expect(create).not.toHaveBeenCalled();
  });

  it('mã thường: không khoá đơn đầu, không đọc đơn', async () => {
    const { svc, executeRaw, order } = makeRedeemService({ coupon: coupon({ perUserLimit: 1 }) });
    await svc.redeem('SALE', 'u1', 'o1');
    expect(executeRaw.mock.calls.map((c) => c[1])).toEqual(['c1']);
    expect(order.findFirst).not.toHaveBeenCalled();
  });

  it('CLAIM: khách chưa nhận mã → từ chối trong transaction, KHÔNG ghi lượt dùng', async () => {
    const { svc, create } = makeRedeemService({ coupon: coupon({ scope: 'CLAIM' }), claimed: false });
    await expect(svc.redeem('SALE', 'u1', 'o1')).rejects.toThrow('Mã không áp dụng cho tài khoản này.');
    expect(create).not.toHaveBeenCalled();
  });

  it('CLAIM: khách đã nhận mã → ghi lượt dùng', async () => {
    const { svc, create } = makeRedeemService({ coupon: coupon({ scope: 'CLAIM' }), claimed: true });
    await svc.redeem('SALE', 'u1', 'o1');
    expect(create).toHaveBeenCalled();
  });
});

describe('CouponsService.release', () => {
  // P1 (docs/2026-09-08-review-progress.md): hủy/trả đơn hoàn ví/xu/điểm/hoa hồng/stock đủ cả
  // nhưng KHÔNG hoàn coupon — voucher usageLimit=1 (birthday/welcome/referral...) bị "đốt"
  // vĩnh viễn cho một đơn chưa từng thực sự hoàn tất. release() đối xứng với redeem().
  function makeReleaseService(over: Record<string, unknown> = {}) {
    const findUnique = jest.fn().mockResolvedValue(coupon({ usageLimit: 1, usedCount: 1 }));
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      coupon: { findUnique, updateMany },
      couponRedemption: { deleteMany },
      ...over,
    } as unknown as PrismaService;
    return { svc: new CouponsService(prisma), prisma, findUnique, deleteMany, updateMany };
  }

  it('không có code (đơn không dùng coupon) → không làm gì, không query DB', async () => {
    const { svc, findUnique } = makeReleaseService();
    await svc.release(null, 'o1');
    expect(findUnique).not.toHaveBeenCalled();
    await svc.release(undefined, 'o1');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('coupon không còn tồn tại → không throw, no-op', async () => {
    const { svc, findUnique, deleteMany } = makeReleaseService();
    findUnique.mockResolvedValue(null);
    await expect(svc.release('GONE', 'o1')).resolves.toBeUndefined();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('xóa CouponRedemption của đúng đơn + giảm usedCount (coupon có usageLimit)', async () => {
    const { svc, deleteMany, updateMany } = makeReleaseService();
    await svc.release('SALE', 'o1');
    expect(deleteMany).toHaveBeenCalledWith({ where: { couponId: 'c1', orderId: 'o1' } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  });

  it('coupon KHÔNG có usageLimit (unlimited) → chỉ xóa redemption, KHÔNG đụng usedCount', async () => {
    const { svc, findUnique, deleteMany, updateMany } = makeReleaseService();
    findUnique.mockResolvedValue(coupon({ usageLimit: null }));
    await svc.release('SALE', 'o1');
    expect(deleteMany).toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('idempotent: đơn KHÔNG có redemption nào để xóa (đã release trước đó / chưa từng redeem thật) → KHÔNG giảm usedCount', async () => {
    const { svc, deleteMany, updateMany } = makeReleaseService();
    deleteMany.mockResolvedValue({ count: 0 });
    await svc.release('SALE', 'o1');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('gọi trong transaction (tx truyền vào) → dùng tx đó thay vì this.prisma', async () => {
    const { svc } = makeReleaseService();
    const txDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txFindUnique = jest.fn().mockResolvedValue(coupon({ usageLimit: 1 }));
    const tx = {
      coupon: { findUnique: txFindUnique, updateMany: txUpdateMany },
      couponRedemption: { deleteMany: txDeleteMany },
    } as unknown as Prisma.TransactionClient;
    await svc.release('SALE', 'o1', tx);
    expect(txFindUnique).toHaveBeenCalled();
    expect(txDeleteMany).toHaveBeenCalled();
    expect(txUpdateMany).toHaveBeenCalled();
  });
});

describe('CouponsService.previewMany', () => {
  const GUEST = { id: 'u1', tierId: null, phone: null, zaloId: null };
  const cases: { name: string; c: Record<string, unknown>; used?: number; total?: number; user?: unknown; extra?: Extra }[] = [
    { name: 'PERCENT có trần', c: { code: 'A', type: 'PERCENT', value: 50, maxDiscount: 30000 } },
    { name: 'PERCENT > 100%', c: { code: 'B', type: 'PERCENT', value: 150 } },
    { name: 'AMOUNT > tiền hàng', c: { code: 'C', type: 'AMOUNT', value: 900000 } },
    { name: 'FREESHIP', c: { code: 'D', type: 'FREESHIP', value: 10000 } },
    { name: 'dưới đơn tối thiểu', c: { code: 'E', minOrder: 300000 } },
    { name: 'đã tắt', c: { code: 'F', isActive: false } },
    { name: 'hết hạn', c: { code: 'G', endAt: past, startAt: new Date(Date.now() - 2 * 864e5) } },
    { name: 'hết lượt cá nhân', c: { code: 'H' }, used: 1 },
    { name: 'hết tổng lượt', c: { code: 'I', usageLimit: 5 }, total: 5 },
    { name: 'gắn sản phẩm không có trong giỏ', c: { code: 'J', applyTo: { productIds: ['px'] } } },
    { name: 'gắn sản phẩm có trong giỏ', c: { code: 'K', type: 'AMOUNT', value: 50000, applyTo: { productIds: ['p1'] } } },
    { name: 'mã người khác', c: { code: 'L', scope: 'USER_GROUP', scopeMeta: { userId: 'other' } } },
    { name: 'mã công khai giới hạn người + khách chưa đăng nhập', c: { code: 'M', scope: 'PUBLIC' }, user: GUEST },
    { name: 'CLAIM đã nhận', c: { code: 'N', scope: 'CLAIM', type: 'AMOUNT', value: 20000 }, extra: { claimed: true } },
    { name: 'CLAIM chưa nhận', c: { code: 'O', scope: 'CLAIM' }, extra: { claimed: false } },
    { name: 'chỉ khách mới + chưa có đơn', c: { code: 'P', newCustomerOnly: true }, extra: { priorOrder: false } },
    { name: 'chỉ khách mới + đã có đơn', c: { code: 'Q', newCustomerOnly: true }, extra: { priorOrder: true } },
    { name: 'chỉ khách mới + khách vãng lai', c: { code: 'R', newCustomerOnly: true, perUserLimit: 0 }, user: GUEST },
    { name: 'mã nhân viên tự tạo', c: { code: 'S', createdById: 'u1' }, user: { ...REAL_USER, role: 'STAFF' } },
    { name: 'mã quản trị viên tự tạo', c: { code: 'T', createdById: 'u1' }, user: { ...REAL_USER, role: 'ADMIN' } },
  ];
  const lines = [
    { productId: 'p1', total: 30000 },
    { productId: 'p2', total: 170000 },
  ];

  it.each(cases)('$name: cùng kết quả/lỗi với validateAndCompute', async ({ c, used = 0, total = 0, user = REAL_USER, extra = {} }) => {
    const row = coupon({ isActive: true, scope: 'PUBLIC', applyTo: null, ...c });
    const single = makeService(row, [used, total], user, extra);
    const expected = await single.validateAndCompute(row.code as string, 'u1', 200000, lines).catch((e: Error) => e);

    const prisma = {
      coupon: { findMany: jest.fn().mockResolvedValue([row]) },
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      couponRedemption: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce(used ? [{ couponId: 'c1', _count: { _all: used } }] : [])
          .mockResolvedValueOnce(total ? [{ couponId: 'c1', _count: { _all: total } }] : []),
      },
      ...extraModels(extra),
    } as unknown as PrismaService;
    const got = (await new CouponsService(prisma).previewMany([row.code as string], 'u1', 200000, lines)).get(row.code as string);
    if (expected instanceof Error) {
      expect(got).toBeInstanceOf(expected.constructor);
      expect((got as Error).message).toBe(expected.message);
    } else {
      expect(got).toEqual(expected);
    }
  });

  it('cả ví: một lần đọc mã, một lần đọc người dùng, tối đa hai lần đếm lượt; kết quả theo đúng thứ tự ví', async () => {
    const rows = [
      coupon({ id: 'c2', code: 'X2', isActive: true, scope: 'PUBLIC' }),
      coupon({ id: 'c1', code: 'X1', isActive: true, scope: 'PUBLIC', usageLimit: 3 }),
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const groupBy = jest.fn().mockResolvedValue([]);
    const findUnique = jest.fn().mockResolvedValue(REAL_USER);
    const prisma = { coupon: { findMany }, user: { findUnique }, couponRedemption: { groupBy } } as unknown as PrismaService;
    const out = await new CouponsService(prisma).previewMany(['x1', ' X2 ', 'GONE'], 'u1', 100000);
    expect([...out.keys()]).toEqual(['X1', 'X2', 'GONE']);
    expect((out.get('GONE') as Error).message).toBe('Mã giảm giá không tồn tại.');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toEqual({ where: { code: { in: ['X1', 'X2', 'GONE'] } } });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(2);
  });

  it('ví hơn 50 mã: xét đúng 50 mã ĐẦU theo thứ tự ví (thẻ khách thấy trước), không theo id', async () => {
    const codes = Array.from({ length: 55 }, (_, i) => `M${String(i).padStart(2, '0')}`);
    // id ngược thứ tự ví: nếu còn chọn theo id thì 5 mã cuối ví sẽ chiếm chỗ.
    const rows = codes.map((code, i) => coupon({ id: `c${99 - i}`, code, isActive: true, scope: 'PUBLIC' }));
    const findMany = jest.fn().mockImplementation(({ where }: { where: { code: { in: string[] } } }) =>
      Promise.resolve(rows.filter((r) => where.code.in.includes(r.code as string))),
    );
    const prisma = {
      coupon: { findMany },
      user: { findUnique: jest.fn().mockResolvedValue(REAL_USER) },
      couponRedemption: { groupBy: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const out = await new CouponsService(prisma).previewMany(codes, 'u1', 100000);
    expect([...out.keys()]).toEqual(codes.slice(0, 50));
  });
});
