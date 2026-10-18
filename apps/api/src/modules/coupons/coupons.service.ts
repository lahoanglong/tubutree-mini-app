import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type Coupon } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OWN_COUPON_MSG, isCouponEligible, isOwnStaffCoupon, requiresRealUser } from './coupon-scope';
import { isRealUser, REAL_USER_REQUIRED_MSG } from '../../common/real-user';
import { assertFirstOrderInTx, hasPriorOrder } from '../../common/first-order';

export const NEW_CUSTOMER_ONLY_MSG = 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.';

export interface CouponResult {
  code: string;
  discount: number;
  freeship: boolean;
  /** Sản phẩm mã gắn vào (null = mọi sản phẩm) — checkout chia phần giảm chỉ vào các dòng đó. */
  productIds: string[] | null;
}

/** Một dòng hàng (đã loại flash) dùng để xét mã gắn sản phẩm (`Coupon.applyTo.productIds`). */
export interface CouponLine {
  productId: string;
  total: number;
}

/**
 * Mã luôn lưu và tra ở dạng HOA, không khoảng trắng: miniapp/web gửi `code.trim().toUpperCase()`, nên
 * mã lưu chữ thường hay có khoảng trắng thì không khách nào áp được (ADMINOPS-7).
 */
export function normalizeCouponCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

/**
 * Mã bị từ chối vì chưa đạt đơn tối thiểu. `base` = phần hàng đã dùng để xét (đã loại flash; mã gắn sản phẩm thì chỉ
 * các dòng sản phẩm đó), để caller giải thích đúng phần được tính thay vì đoán từ thông điệp lỗi.
 */
export class CouponMinOrderError extends BadRequestException {
  constructor(
    readonly minOrder: number,
    readonly base: number,
  ) {
    super(`Đơn tối thiểu ${minOrder.toLocaleString('vi-VN')}đ để dùng mã này.`);
  }
}

/**
 * Mã gắn sản phẩm mà các dòng được xét (đã loại flash) không có sản phẩm đó. `productIds` để caller nhận ra trường hợp sản phẩm
 * vẫn nằm trong giỏ nhưng ở giá giờ vàng và nói đúng lý do (coupon-notice.ts couponRejectReason).
 */
export class CouponProductScopeError extends BadRequestException {
  constructor(readonly productIds: string[]) {
    super('Mã này chỉ áp dụng khi mua đúng sản phẩm của chương trình. Giỏ hàng chưa có sản phẩm đó.');
  }
}

/** Sản phẩm mà mã bị giới hạn (null = áp cho mọi sản phẩm). */
export function couponProductIds(applyTo: unknown): string[] | null {
  if (!applyTo || typeof applyTo !== 'object') return null;
  const ids = (applyTo as { productIds?: unknown }).productIds;
  if (!Array.isArray(ids)) return null;
  const clean = ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return clean.length > 0 ? clean : null;
}

/*
 * Các bước xét mã không đụng DB, theo đúng thứ tự validateAndCompute: áp mã (giỏ, báo giá, đặt đơn) và xem trước mức giảm
 * của cả ví (`previewMany`) đi qua cùng các bước này, chỉ khác cách đọc dữ liệu (từng mã hay gộp một lần cho cả ví).
 */
function assertCouponLive(coupon: Coupon | null): asserts coupon is Coupon {
  if (!coupon) throw new BadRequestException('Mã giảm giá không tồn tại.');
  if (coupon.isActive === false) throw new BadRequestException('Mã giảm giá đã ngừng áp dụng.');
}

function scopeOwnershipError(coupon: { scope?: string | null }): BadRequestException {
  return new BadRequestException(
    coupon.scope === 'TIER' ? 'Mã chỉ áp dụng cho hạng thành viên khác.' : 'Mã không áp dụng cho tài khoản này.',
  );
}

function assertCouponWindow(coupon: Coupon, now: Date): void {
  if (now < coupon.startAt || now > coupon.endAt) {
    throw new BadRequestException('Mã giảm giá đã hết hạn hoặc chưa hiệu lực.');
  }
}

/** Phần hàng mã được tính trên (mã gắn sản phẩm: chỉ các dòng sản phẩm đó) sau khi kiểm sản phẩm và đơn tối thiểu. */
function couponScopedSubtotal(coupon: Coupon, subtotal: number, lines: CouponLine[] | undefined) {
  const productIds = couponProductIds(coupon.applyTo);
  if (productIds) {
    const matched = (lines ?? []).filter((l) => productIds.includes(l.productId));
    if (matched.length === 0) throw new CouponProductScopeError(productIds);
    subtotal = Math.min(subtotal, matched.reduce((s, l) => s + l.total, 0));
  }
  if (coupon.minOrder && subtotal < coupon.minOrder) throw new CouponMinOrderError(coupon.minOrder, subtotal);
  return { subtotal, productIds };
}

function assertPerUserLimit(coupon: Coupon, usedByUser: number): void {
  // perUserLimit <= 0 = không giới hạn (nhất quán với guard trong redeem() bên dưới).
  // Trước đây thiếu guard này → coupon perUserLimit=0 bị validateAndCompute từ chối
  // NGAY LẦN ĐẦU (0 >= 0), dù redeem() coi 0 là "không giới hạn" → không ai dùng được mã.
  if (coupon.perUserLimit > 0 && usedByUser >= coupon.perUserLimit) {
    throw new BadRequestException('Bạn đã dùng hết lượt cho mã này.');
  }
}

function assertUsageLimit(coupon: Coupon, totalUsed: number): void {
  if (coupon.usageLimit != null && totalUsed >= coupon.usageLimit) {
    throw new BadRequestException('Mã giảm giá đã hết lượt sử dụng.');
  }
}

function couponAmount(coupon: Coupon, subtotal: number): { discount: number; freeship: boolean } {
  let discount = 0;
  let freeship = false;
  switch (coupon.type) {
    case 'PERCENT':
      // value có thể >100 nếu admin nhập sai và không set maxDiscount (DTO chỉ @Min(0), không
      // @Max) — clamp về subtotal như nhánh AMOUNT bên dưới để discount không bao giờ vượt
      // giá trị đơn hàng, bất kể caller nào gọi hàm này (cart preview, checkout...).
      discount = Math.min(Math.floor((subtotal * coupon.value) / 100), subtotal);
      if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
      break;
    case 'AMOUNT':
      discount = Math.min(coupon.value, subtotal);
      break;
    case 'FREESHIP':
      freeship = true;
      break;
  }
  return { discount, freeship };
}

/** Số mã tối đa xem trước trong một lần (các mã đầu ví): ví khách thật có vài mã, trần này chỉ chặn ví bất thường. */
export const COUPON_PREVIEW_LIMIT = 50;

/**
 * Validate coupon + tính mức giảm (Build Spec §6.3, §6.6).
 * Phase 1: scope PUBLIC. TIER/BIRTHDAY/INVITE mở rộng ở Phase 2.
 */
@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `subtotal` = giá trị hàng được tính cho mã (caller đã loại flash/trừ combo). `lines` = các dòng tạo
   * nên `subtotal`; bắt buộc để áp mã gắn sản phẩm (mã mua chung) — thiếu thì mã đó bị từ chối, không
   * bao giờ rơi về tính trên cả giỏ.
   */
  async validateAndCompute(code: string, userId: string, subtotal: number, lines?: CouponLine[]): Promise<CouponResult> {
    const coupon = await this.prisma.coupon.findUnique({ where: { code: normalizeCouponCode(code) } });
    assertCouponLive(coupon);

    await this.assertScopeOwnership(coupon, userId, this.prisma);
    if (requiresRealUser(coupon)) {
      const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, zaloId: true } });
      if (!isRealUser(u)) throw new BadRequestException(REAL_USER_REQUIRED_MSG);
    }
    // Chỉ để báo sớm; chốt cuối nằm trong transaction đặt đơn (redeemInTx).
    if (coupon.newCustomerOnly && (await hasPriorOrder(this.prisma, userId))) {
      throw new BadRequestException(NEW_CUSTOMER_ONLY_MSG);
    }

    assertCouponWindow(coupon, new Date());
    const scoped = couponScopedSubtotal(coupon, subtotal, lines);

    const usedByUser = await this.prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId },
    });
    assertPerUserLimit(coupon, usedByUser);
    if (coupon.usageLimit != null) {
      // Chỉ check pre-flight để UX tốt; kiểm cuối ATOMIC ở redeem() (updateMany guard usedCount<usageLimit).
      const totalUsed = await this.prisma.couponRedemption.count({ where: { couponId: coupon.id } });
      assertUsageLimit(coupon, totalUsed);
    }

    return { code: coupon.code, ...couponAmount(coupon, scoped.subtotal), productIds: scoped.productIds };
  }

  /**
   * Kết quả validateAndCompute của nhiều mã trên cùng một phần hàng, đọc gộp (mã, người dùng, số lượt) thay vì vài truy vấn
   * mỗi mã. Mã bị từ chối trả đúng lỗi validateAndCompute sẽ ném. Chỉ đọc: không ghi lượt dùng, không khoá. Xét
   * COUPON_PREVIEW_LIMIT mã ĐẦU TIÊN theo đúng thứ tự `codes` (thứ tự ví khách thấy), kết quả cũng theo thứ tự đó; mã ngoài trần
   * không có trong kết quả.
   */
  async previewMany(
    codes: string[],
    userId: string,
    subtotal: number,
    lines?: CouponLine[],
  ): Promise<Map<string, CouponResult | BadRequestException>> {
    const out = new Map<string, CouponResult | BadRequestException>();
    const wanted = [...new Set(codes.map(normalizeCouponCode))].slice(0, COUPON_PREVIEW_LIMIT);
    if (wanted.length === 0) return out;
    const rows = await this.prisma.coupon.findMany({ where: { code: { in: wanted } } });
    const byCode = new Map(rows.map((c) => [c.code, c]));
    const ids = rows.map((c) => c.id);
    const limitedIds = rows.filter((c) => c.usageLimit != null).map((c) => c.id);
    const claimIds = rows.filter((c) => c.scope === 'CLAIM').map((c) => c.id);
    const [user, mine, all, claims, priorOrder] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { tierId: true, phone: true, zaloId: true, role: true } }),
      ids.length
        ? this.prisma.couponRedemption.groupBy({ by: ['couponId'], where: { userId, couponId: { in: ids } }, _count: { _all: true } })
        : [],
      limitedIds.length
        ? this.prisma.couponRedemption.groupBy({ by: ['couponId'], where: { couponId: { in: limitedIds } }, _count: { _all: true } })
        : [],
      claimIds.length
        ? this.prisma.couponClaim.findMany({ where: { userId, couponId: { in: claimIds } }, select: { couponId: true } })
        : [],
      rows.some((c) => c.newCustomerOnly) ? hasPriorOrder(this.prisma, userId) : false,
    ]);
    const usedByUser = new Map(mine.map((g) => [g.couponId, g._count._all]));
    const totalUsed = new Map(all.map((g) => [g.couponId, g._count._all]));
    const claimedCouponIds = new Set(claims.map((c) => c.couponId));
    const now = new Date();
    for (const code of wanted) {
      const coupon = byCode.get(code) ?? null;
      try {
        assertCouponLive(coupon);
        if (isOwnStaffCoupon(coupon, { id: userId, role: user?.role })) throw new BadRequestException(OWN_COUPON_MSG);
        if (!isCouponEligible(coupon, { id: userId, role: user?.role, tierId: user?.tierId, claimedCouponIds })) throw scopeOwnershipError(coupon);
        if (requiresRealUser(coupon) && !isRealUser(user)) throw new BadRequestException(REAL_USER_REQUIRED_MSG);
        if (coupon.newCustomerOnly && priorOrder) throw new BadRequestException(NEW_CUSTOMER_ONLY_MSG);
        assertCouponWindow(coupon, now);
        const scoped = couponScopedSubtotal(coupon, subtotal, lines);
        assertPerUserLimit(coupon, usedByUser.get(coupon.id) ?? 0);
        assertUsageLimit(coupon, totalUsed.get(coupon.id) ?? 0);
        out.set(coupon.code, { code: coupon.code, ...couponAmount(coupon, scoped.subtotal), productIds: scoped.productIds });
      } catch (err) {
        if (!(err instanceof BadRequestException)) throw err;
        out.set(code, err);
      }
    }
    return out;
  }

  /**
   * Ghi nhận đã dùng (gọi sau khi đặt đơn thành công).
   * B4: nhận tx? để chạy ATOMIC cùng transaction đặt đơn — chống race usageLimit.
   *  - updateMany với guard `usedCount < usageLimit` → bộ đếm atomic, count=0 nghĩa là hết lượt.
   *  - đơn đã có redemption cho mã này (retry/double-submit) → no-op, KHÔNG đụng usedCount.
   *    Không dựa vào bắt P2002: lỗi unique làm Postgres huỷ cả transaction checkout (C-061).
   *
   * Nếu KHÔNG được gọi trong 1 transaction có sẵn (tx=undefined — checkout.service.ts luôn
   * truyền tx, nhưng hàm này vẫn hỗ trợ gọi standalone), tự mở transaction riêng: advisory lock
   * bên dưới chỉ tồn tại trong phạm vi 1 transaction, KHÔNG có tx bao ngoài thì lock nhả ngay sau
   * câu lệnh raw đầu tiên (Postgres tự nhả pg_advisory_xact_lock khi transaction đó kết thúc) và
   * không bảo vệ được count()+create() phía sau.
   */
  async redeem(
    code: string,
    userId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (tx) return this.redeemInTx(tx, code, userId, orderId);
    try {
      return await this.prisma.$transaction((innerTx) => this.redeemInTx(innerTx, code, userId, orderId));
    } catch (err) {
      // P2034: chỉ có thể xảy ra nếu Postgres tự nâng cấp deadlock-detection trên advisory lock
      // (hiếm) — vẫn map thân thiện thay vì 500, nhất quán với các nơi khác dùng $transaction.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận xử lý, vui lòng thử lại.');
      }
      throw err;
    }
  }

  private async redeemInTx(
    db: Prisma.TransactionClient,
    code: string,
    userId: string,
    orderId: string,
  ): Promise<void> {
    const coupon = await db.coupon.findUnique({ where: { code: normalizeCouponCode(code) } });
    if (!coupon) return;
    await this.assertScopeOwnership(coupon, userId, db);

    if (coupon.newCustomerOnly) {
      // Đơn (và các đơn tách cùng lần đặt) đã được ghi trong chính tx này nên không tính. Khoá đơn đầu lấy trước khoá
      // (mã, khách) bên dưới, cùng thứ tự với khoá miễn phí giao đơn đầu của checkout.
      const own = await db.order.findUnique({ where: { id: orderId }, select: { checkoutGroup: true } });
      await assertFirstOrderInTx(db, userId, { orderIds: [orderId], checkoutGroup: own?.checkoutGroup }, NEW_CUSTOMER_ONLY_MSG);
    }

    const limitPerUser = coupon.perUserLimit != null && coupon.perUserLimit > 0;
    if (limitPerUser) {
      // Race cũ: validateAndCompute() check pre-flight KHÔNG atomic, và count()+create() ở đây
      // cũng không atomic với nhau → 2 checkout song song cùng user (2 đơn khác nhau) cùng đọc
      // usedByUser < limit rồi cùng tạo CouponRedemption với orderId khác nhau → UNIQUE(couponId,
      // orderId) KHÔNG chặn (thiếu userId trong constraint) → vượt perUserLimit.
      // Khoá advisory theo (couponId, userId), giữ tới khi TRANSACTION HIỆN TẠI (tx checkout hoặc
      // tx riêng ở redeem() phía trên) commit/rollback → 2 redeem() đồng thời cho CÙNG cặp
      // coupon+user bị serialize hoá (chờ nhau) tại đúng điểm này, count() sau lock luôn đọc được
      // kết quả create() của giao dịch đã đi trước. Chọn advisory lock thay vì nâng isolationLevel
      // của CẢ transaction lên Serializable: transaction checkout còn làm nhiều việc khác (trừ
      // stock, ví, điểm...) — nâng Serializable toàn bộ sẽ mở rộng rủi ro serialization-failure ra
      // ngoài phạm vi coupon, trong khi advisory lock chỉ khoá đúng cặp (couponId,userId) liên quan.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${coupon.id}), hashtext(${userId}))`;
    }

    // Đọc SAU advisory lock: request cùng đơn đi trước đã commit thì ở đây thấy redemption của nó.
    const existing = await db.couponRedemption.findUnique({
      where: { couponId_orderId: { couponId: coupon.id, orderId } },
      select: { id: true },
    });
    if (existing) return;

    if (limitPerUser) {
      const usedByUser = await db.couponRedemption.count({
        where: { couponId: coupon.id, userId },
      });
      if (usedByUser >= coupon.perUserLimit) {
        throw new BadRequestException('Bạn đã dùng hết lượt cho mã này.');
      }
    }

    // ON CONFLICT DO NOTHING: request cùng đơn chạy song song (không có perUserLimit để xếp hàng)
    // chờ dòng của kẻ thắng rồi không ghi gì, thay vì ném P2002 làm hỏng transaction.
    const inserted = await db.couponRedemption.createMany({
      data: [{ couponId: coupon.id, userId, orderId }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return;

    if (coupon.usageLimit != null) {
      const hit = await db.coupon.updateMany({
        where: { id: coupon.id, usedCount: { lt: coupon.usageLimit } },
        data: { usedCount: { increment: 1 } },
      });
      if (hit.count === 0) {
        throw new BadRequestException('Mã giảm giá đã hết lượt sử dụng.');
      }
    }
  }

  /**
   * Hoàn coupon khi đơn bị hủy/hoàn trước khi hoàn tất — đối xứng với redeem(). Trước đây
   * không có hàm này: hủy/trả đơn hoàn ví/điểm/hoa hồng/stock đầy đủ nhưng CouponRedemption
   * + usedCount vẫn còn nguyên → voucher usageLimit=1 (birthday/welcome/referral...) bị đốt
   * vĩnh viễn cho một đơn chưa từng thực sự hoàn tất (P1, docs/2026-09-08-review-progress.md).
   * Idempotent: không có redemption nào bị xóa (đã release trước đó, hoặc đơn không thực sự
   * redeem — vd race thua ở redeemInTx) → không đụng usedCount. Không throw nếu thiếu code
   * hoặc coupon không còn tồn tại — đây là bước reversal best-effort, không được chặn luồng
   * hủy/trả chính.
   */
  async release(
    code: string | null | undefined,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!code) return;
    const db = tx ?? this.prisma;
    const coupon = await db.coupon.findUnique({ where: { code: normalizeCouponCode(code) } });
    if (!coupon) return;
    const released = await db.couponRedemption.deleteMany({ where: { couponId: coupon.id, orderId } });
    if (released.count > 0 && coupon.usageLimit != null) {
      await db.coupon.updateMany({
        where: { id: coupon.id, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
    }
  }

  /**
   * Đảm bảo user được phép dùng coupon theo scope (chặn validate/redeem nếu không).
   * Quy tắc eligible nằm ở isCouponEligible (coupon-scope.ts) — dùng CHUNG với
   * LoyaltyService.getAvailableCoupons để list & apply không lệch nhau.
   * Nhận `db` (PrismaClient hoặc TransactionClient) để query user trong cùng tx
   * khi được gọi từ redeem(tx) — đọc tier nhất quán với phần còn lại của tx.
   */
  private async assertScopeOwnership(
    coupon: { id: string; scope?: string | null; scopeMeta?: unknown; createdById?: string | null },
    userId: string,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<void> {
    let role: string | null | undefined;
    if (coupon.createdById && coupon.createdById === userId) {
      role = (await db.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role;
      if (isOwnStaffCoupon(coupon, { id: userId, role })) throw new BadRequestException(OWN_COUPON_MSG);
    }
    // Chỉ TIER cần tierId — lazy-load trong cùng db/tx để đọc hạng nhất quán với
    // phần còn lại của tx (PUBLIC/USER_GROUP không tốn query thừa).
    let tierId: string | null | undefined;
    if (coupon.scope === 'TIER') {
      const user = await db.user.findUnique({ where: { id: userId }, select: { tierId: true } });
      tierId = user?.tierId;
    }
    let claimedCouponIds: Set<string> | undefined;
    if (coupon.scope === 'CLAIM') {
      const claim = await db.couponClaim.findUnique({
        where: { couponId_userId: { couponId: coupon.id, userId } },
        select: { id: true },
      });
      claimedCouponIds = new Set(claim ? [coupon.id] : []);
    }
    // Quyết định eligible dùng CHUNG isCouponEligible với LoyaltyService.getAvailableCoupons
    // (list) → list & apply không lệch. Message giữ riêng theo scope cho rõ với user.
    if (isCouponEligible(coupon, { id: userId, role, tierId, claimedCouponIds })) return;
    throw scopeOwnershipError(coupon);
  }
}
