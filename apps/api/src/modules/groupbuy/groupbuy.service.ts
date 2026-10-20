import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isRealUser, REAL_USER_REQUIRED_MSG } from '../../common/real-user';
import { isPartnerOwnedProduct, partnerGoodsError } from '../cart/partner-goods';
import { isPublicProduct, PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';
import { formatVnDate } from '../../common/vn-time';

/** Số nhóm hết hạn xử lý mỗi lần quét (15 phút/lần): chặn một đợt tồn đọng làm cron chạy quá lâu; phần dư để lần quét sau. */
const EXPIRE_BATCH = 200;

interface GroupRow {
  id: string;
  productId: string;
  initiatorId: string;
  targetSize: number;
  currentSize: number;
  unitPrice: number;
  basePrice: number;
  status: string;
  expiresAt: Date;
}

/** Số ngày mã giảm của nhóm đủ người còn dùng được. */
const COUPON_VALID_DAYS = 30;

/**
 * Nhóm khách còn thấy và tham gia được: sản phẩm đang bán, không phải hàng gian hàng đối tác. Trần số nhóm mở của mỗi khách
 * đếm theo cùng điều kiện, để nhóm trên hàng đã ngừng bán (ẩn, không tham gia được) không giữ chỗ tới khi hết hạn.
 */
const LISTED_GROUP_PRODUCT = { storefrontId: null, ...PUBLIC_PRODUCT_WHERE } satisfies Prisma.ProductWhereInput;

/** Mã giảm TẤT ĐỊNH theo (nhóm, thành viên): cấp lại an toàn và hiện lại được cho đúng người mà không cần tra bảng mã. */
export function groupBuyCouponCode(groupBuyId: string, userId: string): string {
  return `GBUY-${groupBuyId.slice(-8)}-${userId.slice(-8)}`.toUpperCase();
}

/**
 * Mua chung / Group Buy (§6.14.8). User mở nhóm cho 1 sản phẩm với giá nhóm (giảm %);
 * đủ targetSize người trước hạn → SUCCESS, mỗi thành viên nhận coupon = phần giảm để
 * mua với giá nhóm. Không đủ trước expiresAt → FAILED (cron expireGroups).
 */
@Injectable()
export class GroupBuyService {
  private readonly logger = new Logger(GroupBuyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Mua chung chỉ dành cho tài khoản thật (SĐT hoặc Zalo thật): tài khoản khách tạo vô hạn bằng deviceId mới,
   * nên trước đây một người tự mở nhóm rồi lấp đủ bằng 2 tài khoản khách là có 3 mã giảm (MONEY-4, ENGAGE-8).
   */
  private async assertRealUser(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, zaloId: true } });
    if (!isRealUser(u)) throw new BadRequestException(REAL_USER_REQUIRED_MSG);
  }

  async create(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive || product.approvalStatus !== 'APPROVED') {
      throw new NotFoundException('Sản phẩm không khả dụng.');
    }
    // Mã giảm của nhóm là chương trình của Tubu: hàng của gian hàng đối tác (kể cả Tubu giao hộ) chỉ bán giá lẻ (partner-goods.ts).
    if (isPartnerOwnedProduct(product)) throw partnerGoodsError('GROUP_BUY', product.name);
    if (product.fulfilment === 'MERCHANT') {
      throw new BadRequestException('Sản phẩm do gian hàng đối tác tự giao, chưa hỗ trợ mua chung.');
    }
    await this.assertRealUser(userId);

    // Chống spam mở nhóm hàng loạt: rác hoá danh sách mua chung / tốn tài nguyên tạo nhóm vô tội vạ
    // (tài khoản phụ đã bị chặn ở assertRealUser, mã chỉ áp cho đúng sản phẩm — xem grantCoupon()).
    const maxOpenPerUser = await this.config.get<number>('groupbuy.max_open_per_user', 3);
    const [pct, targetSize, windowHours] = await Promise.all([
      this.config.get<number>('groupbuy.discount_pct', 15),
      this.config.get<number>('groupbuy.target_size', 3),
      this.config.get<number>('groupbuy.window_hours', 48),
    ]);
    const basePrice = product.salePrice ?? product.basePrice;
    const unitPrice = Math.round((basePrice * (100 - pct)) / 100);
    const expiresAt = new Date(Date.now() + windowHours * 3600 * 1000);

    // Đếm rồi tạo dưới khoá theo khách: không khoá thì N yêu cầu song song cùng đọc "chưa đủ" và vượt trần.
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`groupbuy-open:${userId}`}))`;
      const openCount = await tx.groupBuy.count({ where: { initiatorId: userId, status: 'OPEN', product: LISTED_GROUP_PRODUCT } });
      if (openCount >= maxOpenPerUser) {
        throw new BadRequestException(`Bạn đang có ${openCount} nhóm mua chung chưa đóng, hãy chờ nhóm cũ hoàn tất.`);
      }
      return (await tx.groupBuy.create({
        data: {
          productId,
          initiatorId: userId,
          targetSize,
          currentSize: 1,
          unitPrice,
          basePrice,
          status: 'OPEN',
          expiresAt,
          members: { create: { userId } },
        },
      })) as unknown as GroupRow;
    });

    // Cạnh biên: targetSize (config) = 1 → nhóm đã đủ người NGAY khi tạo (chỉ có initiator).
    // Không xử lý thì nhóm kẹt OPEN mãi vì join()'s guard `currentSize < targetSize` không bao
    // giờ đúng nữa (không còn ai join được) → initiator không bao giờ nhận coupon.
    let status = created.status;
    if (created.currentSize >= created.targetSize) {
      const flip = await this.prisma.groupBuy.updateMany({ where: { id: created.id, status: 'OPEN' }, data: { status: 'SUCCESS' } });
      if (flip.count === 1) status = (await this.onSuccess({ ...created, status: 'SUCCESS' })) ? 'SUCCESS' : 'FAILED';
    }
    return this.toView(
      { ...created, status },
      { name: product.name, slug: product.slug, thumbnail: product.thumbnail },
      1,
      true,
      userId,
    );
  }

  async join(userId: string, groupBuyId: string) {
    const group = (await this.prisma.groupBuy.findUnique({ where: { id: groupBuyId } })) as GroupRow | null;
    if (!group) throw new NotFoundException('Không tìm thấy nhóm mua chung.');
    if (group.status !== 'OPEN') throw new BadRequestException('Nhóm đã đóng.');
    if (new Date(group.expiresAt).getTime() <= Date.now()) throw new BadRequestException('Nhóm đã hết hạn.');
    const partner = await this.closeIfPartnerGoods(group, 'OPEN');
    if (partner) throw partnerGoodsError('GROUP_BUY', partner.name);
    // Sản phẩm đã ngừng bán (tắt, hoặc chưa/không được duyệt): nhóm đủ người sẽ cấp mã cho hàng không mua được.
    const product = await this.prisma.product.findUnique({ where: { id: group.productId }, select: { isActive: true, approvalStatus: true } });
    if (!product || !isPublicProduct(product)) throw new BadRequestException('Sản phẩm của nhóm đã ngừng bán, không tham gia được nữa.');

    const existing = await this.prisma.groupBuyMember.findUnique({
      where: { groupBuyId_userId: { groupBuyId, userId } },
    });
    if (existing) throw new BadRequestException('Bạn đã tham gia nhóm này rồi.');
    await this.assertRealUser(userId);

    const result = await this.prisma.$transaction(async (tx) => {
      try {
        await tx.groupBuyMember.create({ data: { groupBuyId, userId } });
      } catch (e) {
        // Race: 2 request tham gia đồng thời của CÙNG user (double-click/retry) đều qua được
        // check `existing` phía trên (chưa commit) rồi đụng @@unique([groupBuyId,userId]) ở đây.
        // Trả lại thông báo thân thiện thay vì để lộ lỗi 409 chung của Prisma filter.
        if (this.isAlreadyGranted(e)) throw new BadRequestException('Bạn đã tham gia nhóm này rồi.');
        throw e;
      }
      // Tăng currentSize ATOMIC + guard (OPEN, chưa đủ, chưa hết hạn) — chống vượt target/đóng khi đua.
      const inc = await tx.groupBuy.updateMany({
        where: { id: groupBuyId, status: 'OPEN', currentSize: { lt: group.targetSize }, expiresAt: { gt: new Date() } },
        data: { currentSize: { increment: 1 } },
      });
      if (inc.count === 0) throw new BadRequestException('Nhóm đã đủ người hoặc đã đóng.');

      const updated = (await tx.groupBuy.findUnique({ where: { id: groupBuyId } })) as GroupRow;
      let succeeded = false;
      if (updated.currentSize >= updated.targetSize) {
        // Chỉ MỘT giao dịch lật OPEN→SUCCESS (count=1) → onSuccess chạy đúng 1 lần (idempotent).
        const flip = await tx.groupBuy.updateMany({ where: { id: groupBuyId, status: 'OPEN' }, data: { status: 'SUCCESS' } });
        succeeded = flip.count === 1;
      }
      return { currentSize: updated.currentSize, succeeded };
    });

    const status = result.succeeded ? ((await this.onSuccess(group)) ? 'SUCCESS' : 'FAILED') : 'OPEN';
    return { joined: true, currentSize: result.currentSize, status };
  }

  /**
   * Nhóm đủ người: cấp coupon giảm giá cho từng thành viên + thông báo.
   * Chỉ đánh dấu `couponsGrantedAt` khi TẤT CẢ thành viên đã có coupon — nếu còn sót
   * (lỗi DB tạm thời), để null cho cron `reconcileSuccessfulGroups` thử lại sau.
   * Sản phẩm đã là hàng của gian hàng đối tác (nhóm mở trước khi có luật, hoặc sản phẩm vừa chuyển cho gian hàng): không cấp
   * mã, nhóm FAILED như nhóm không đủ người. Trả false khi nhóm bị đóng như vậy.
   */
  private async onSuccess(group: GroupRow): Promise<boolean> {
    if (await this.closeIfPartnerGoods(group, 'SUCCESS')) return false;
    const allGranted = await this.grantAllMembers(group);
    if (allGranted) await this.markGranted(group.id);
    return true;
  }

  /**
   * Mua chung là chương trình của Tubu, không áp cho hàng của gian hàng đối tác (cart/partner-goods.ts). Nhóm đã mở trên hàng
   * đó thì đóng (FAILED, chỉ khi còn ở trạng thái `from`) và báo thành viên GROUP_BUY_FAILED như nhóm hết hạn; thành viên chưa
   * trả gì khi tham gia nên không có gì phải hoàn. Trả sản phẩm khi nhóm thuộc hàng đối tác, null khi không.
   */
  private async closeIfPartnerGoods(group: Pick<GroupRow, 'id' | 'productId'>, from: 'OPEN' | 'SUCCESS') {
    const product = await this.prisma.product.findUnique({
      where: { id: group.productId },
      select: { name: true, slug: true, storefrontId: true },
    });
    if (!product || !isPartnerOwnedProduct(product)) return null;
    const flip = await this.prisma.groupBuy.updateMany({ where: { id: group.id, status: from }, data: { status: 'FAILED' } });
    if (flip.count === 1) await this.notifyExpired(group.id, product);
    return product;
  }

  /** Cấp coupon (idempotent qua mã tất định + @unique) + thông báo MỚI cho từng thành viên.
   *  Trả true nếu mọi thành viên đều đã có coupon (mới cấp hoặc đã có sẵn — P2002). */
  private async grantAllMembers(group: GroupRow): Promise<boolean> {
    const members = await this.prisma.groupBuyMember.findMany({ where: { groupBuyId: group.id } });
    const terms = await this.couponTerms(group);
    // Tên sản phẩm chỉ để điền tin: tra lỗi không được chặn việc cấp mã.
    const product = await this.prisma.product
      .findUnique({ where: { id: group.productId }, select: { name: true } })
      .catch(() => null);
    let allGranted = true;
    for (const m of members) {
      let granted: { code: string; endAt: Date } | null = null;
      try {
        granted = await this.grantCoupon(group.id, m.userId, terms, group.unitPrice, group.productId);
      } catch (e) {
        // P2002: đã cấp ở lần trước → coi như đã có, KHÔNG thông báo lại.
        if (!this.isAlreadyGranted(e)) {
          allGranted = false;
          this.logger.warn(`grantCoupon lỗi (nhóm ${group.id}, user ${m.userId}): ${(e as Error).message}`);
        }
      }
      // Chỉ thông báo khi coupon vừa được cấp mới (tránh spam khi reconcile chạy lại).
      if (granted && this.notifications) {
        await this.notifications
          .notify(m.userId, 'GROUP_BUY_SUCCESS', {
            // Mã là % có trần: số tiền cố định sẽ hứa nhiều hơn mức giảm thật khi khách mua biến thể rẻ.
            discount: `${terms.pct}%`,
            product: product?.name ?? '',
            code: granted.code,
            expires: formatVnDate(granted.endAt),
          })
          .catch((e) => this.logger.warn(`notify lỗi: ${(e as Error).message}`));
      }
    }
    return allGranted;
  }

  private async markGranted(groupBuyId: string): Promise<void> {
    await this.prisma.groupBuy
      .update({ where: { id: groupBuyId }, data: { couponsGrantedAt: new Date() } })
      .catch((e) => this.logger.warn(`markGranted lỗi (${groupBuyId}): ${(e as Error).message}`));
  }

  /** P2002 (unique violation trên coupon.code tất định) = coupon đã tồn tại → idempotent OK. */
  private isAlreadyGranted(e: unknown): boolean {
    return (e as { code?: string } | null)?.code === 'P2002';
  }

  /**
   * Cron đối soát: nhóm đã SUCCESS nhưng chưa phát đủ coupon (couponsGrantedAt null) → cấp lại.
   * Bù cho trường hợp `onSuccess` lỗi DB tạm thời ở 1 vài thành viên. Mã coupon tất định +
   * @unique đảm bảo cấp lại KHÔNG tạo trùng. Giới hạn quét nhóm gần đây để chặn chi phí.
   */
  async reconcileSuccessfulGroups(maxAgeHours = 72): Promise<number> {
    const since = new Date(Date.now() - maxAgeHours * 3600 * 1000);
    const groups = (await this.prisma.groupBuy.findMany({
      where: { status: 'SUCCESS', couponsGrantedAt: null, createdAt: { gte: since } },
      take: 100,
    })) as unknown as GroupRow[];
    let fixed = 0;
    for (const g of groups) {
      if (await this.closeIfPartnerGoods(g, 'SUCCESS')) continue;
      const allGranted = await this.grantAllMembers(g);
      if (allGranted) {
        await this.markGranted(g.id);
        fixed += 1;
      }
    }
    if (fixed > 0) this.logger.log(`reconcile: đã phát đủ coupon cho ${fixed} nhóm mua chung SUCCESS.`);
    return fixed;
  }

  async getGroup(groupBuyId: string, userId?: string) {
    const group = await this.prisma.groupBuy.findUnique({
      where: { id: groupBuyId },
      include: {
        product: { select: { name: true, slug: true, thumbnail: true } },
        _count: { select: { members: true } },
        members: userId ? { where: { userId }, select: { id: true } } : false,
      },
    });
    if (!group) throw new NotFoundException('Không tìm thấy nhóm mua chung.');
    const joined = Array.isArray((group as { members?: unknown[] }).members)
      ? (group as { members: unknown[] }).members.length > 0
      : false;
    return this.toView(group as unknown as GroupRow, group.product, group._count.members, joined, userId);
  }

  /** `userId` (khi đã đăng nhập) để đánh dấu nhóm mình đã tham gia / tự mở; khách thì joined=false. */
  async listOpen(userId?: string) {
    const groups = await this.prisma.groupBuy.findMany({
      // Nhóm trên hàng của gian hàng đối tác không tham gia được nữa (join đóng nhóm) nên không mời khách vào.
      where: { status: 'OPEN', expiresAt: { gt: new Date() }, product: LISTED_GROUP_PRODUCT },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { product: { select: { name: true, slug: true, thumbnail: true } }, _count: { select: { members: true } } },
    });
    const mine = new Set<string>();
    if (userId && groups.length > 0) {
      const rows = await this.prisma.groupBuyMember.findMany({
        where: { userId, groupBuyId: { in: groups.map((g) => g.id) } },
        select: { groupBuyId: true },
      });
      for (const r of rows) mine.add(r.groupBuyId);
    }
    const open = groups.map((g) => this.toView(g as unknown as GroupRow, g.product, g._count.members, mine.has(g.id), userId));
    if (!userId) return open;
    // Nhóm của mình đã đủ người, mã giảm còn hạn: khách phải tìm lại được mã và mua tiếp ngay từ đây.
    const since = new Date(Date.now() - COUPON_VALID_DAYS * 864e5);
    const done = await this.prisma.groupBuy.findMany({
      // Mã chỉ dùng được cho đúng sản phẩm: sản phẩm ngừng bán thì không mời "mua tiếp" vào trang 404.
      where: { status: 'SUCCESS', members: { some: { userId } }, expiresAt: { gte: since }, product: PUBLIC_PRODUCT_WHERE },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { product: { select: { name: true, slug: true, thumbnail: true } }, _count: { select: { members: true } } },
    });
    return [...open, ...done.map((g) => this.toView(g as unknown as GroupRow, g.product, g._count.members, true, userId))];
  }

  /**
   * Cron: nhóm OPEN quá hạn → FAILED, rồi báo từng thành viên (kể cả người mở nhóm) để khách đang chờ biết kết quả và
   * quay lại mua với giá thường hoặc mở nhóm mới. Mỗi nhóm được "giành" bằng updateMany có guard OPEN nên hai lần quét
   * chạy chồng nhau không báo trùng. Trả số nhóm bị đánh hỏng.
   */
  async expireGroups(): Promise<number> {
    const due = await this.prisma.groupBuy.findMany({
      where: { status: 'OPEN', expiresAt: { lte: new Date() } },
      select: { id: true, product: { select: { name: true, slug: true } } },
      orderBy: { expiresAt: 'asc' },
      take: EXPIRE_BATCH,
    });
    let failed = 0;
    for (const g of due) {
      const flip = await this.prisma.groupBuy.updateMany({
        where: { id: g.id, status: 'OPEN', expiresAt: { lte: new Date() } },
        data: { status: 'FAILED' },
      });
      if (flip.count === 0) continue;
      failed += 1;
      await this.notifyExpired(g.id, g.product);
    }
    return failed;
  }

  private async notifyExpired(groupBuyId: string, product: { name: string; slug: string }): Promise<void> {
    if (!this.notifications) return;
    const members = await this.prisma.groupBuyMember
      .findMany({ where: { groupBuyId } })
      .catch((e: unknown) => {
        this.logger.warn(`Không lấy được thành viên nhóm ${groupBuyId} để báo hết hạn: ${(e as Error).message}`);
        return [];
      });
    for (const m of members) {
      await this.notifications
        .notify(m.userId, 'GROUP_BUY_FAILED', { product: product.name, product_slug: product.slug })
        .catch((e: unknown) => this.logger.warn(`notify hết hạn lỗi (nhóm ${groupBuyId}, user ${m.userId}): ${(e as Error).message}`));
    }
  }

  private toView(
    g: GroupRow,
    product: { name: string; slug: string; thumbnail: string | null },
    memberCount: number,
    joined: boolean,
    viewerId?: string,
  ) {
    return {
      id: g.id,
      product,
      targetSize: g.targetSize,
      currentSize: memberCount,
      unitPrice: g.unitPrice,
      basePrice: g.basePrice,
      discountPct: g.basePrice > 0 ? Math.round(((g.basePrice - g.unitPrice) / g.basePrice) * 100) : 0,
      status: g.status,
      expiresAt: g.expiresAt,
      joined,
      isOwner: viewerId !== undefined && g.initiatorId === viewerId,
      ...(g.status === 'SUCCESS' && joined && viewerId ? { couponCode: groupBuyCouponCode(g.id, viewerId) } : {}),
    };
  }

  /**
   * Giá nhóm tính trên biến thể rẻ nhất (giá sản phẩm), nhưng mã dùng được cho mọi biến thể của sản phẩm. Mã giảm số tiền cố
   * định chỉ giảm 4,2% khi khách mua biến thể 430.000đ trong khi trang nhóm ghi 15%, nên cấp mã theo % kèm trần bằng đúng %
   * đó trên biến thể đắt nhất: không biến thể nào giảm quá % đã công bố. % suy từ giá nhóm đã lưu để nhóm mở trước khi đổi
   * config hay cấp lại qua đối soát vẫn ra cùng mức.
   */
  private async couponTerms(group: GroupRow): Promise<{ pct: number; maxDiscount: number }> {
    const flatDiscount = group.basePrice - group.unitPrice;
    if (group.basePrice <= 0 || flatDiscount <= 0) return { pct: 0, maxDiscount: flatDiscount };
    const pct = Math.round((flatDiscount / group.basePrice) * 100);
    const variations = await this.prisma.variation.findMany({
      where: { productId: group.productId, isActive: true },
      select: { retailPrice: true, salePrice: true },
    });
    const dearest = Math.max(group.basePrice, ...variations.map((v) => v.salePrice ?? v.retailPrice));
    return { pct, maxDiscount: Math.max(flatDiscount, Math.round((dearest * pct) / 100)) };
  }

  /**
   * Mã chỉ áp cho đúng sản phẩm (`applyTo.productIds`) và đơn tối thiểu = giá nhóm tính trên
   * chính dòng sản phẩm đó: "mua với giá nhóm" là giá của sản phẩm này, không phải mã giảm ~15% cho mọi
   * đơn (MONEY-4). Trước đây chỉ có minOrder trên tổng giỏ (P0-2, docs/2026-09-08-review-progress.md).
   */
  private async grantCoupon(
    groupBuyId: string,
    userId: string,
    terms: { pct: number; maxDiscount: number },
    minOrder: number,
    productId: string,
  ): Promise<{ code: string; endAt: Date }> {
    const code = groupBuyCouponCode(groupBuyId, userId);
    const end = new Date();
    end.setDate(end.getDate() + COUPON_VALID_DAYS);
    await this.prisma.coupon.create({
      data: {
        code,
        type: 'PERCENT',
        value: terms.pct,
        maxDiscount: terms.maxDiscount,
        minOrder,
        startAt: new Date(),
        endAt: end,
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId, groupBuyId } as object,
        applyTo: { productIds: [productId] } as object,
      },
    });
    return { code, endAt: end };
  }
}
