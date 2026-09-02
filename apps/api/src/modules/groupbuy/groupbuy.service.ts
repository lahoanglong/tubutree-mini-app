import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';

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

  async create(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) throw new NotFoundException('Sản phẩm không khả dụng.');

    const [pct, targetSize, windowHours] = await Promise.all([
      this.config.get<number>('groupbuy.discount_pct', 15),
      this.config.get<number>('groupbuy.target_size', 3),
      this.config.get<number>('groupbuy.window_hours', 48),
    ]);
    const basePrice = product.salePrice ?? product.basePrice;
    const unitPrice = Math.round((basePrice * (100 - pct)) / 100);
    const expiresAt = new Date(Date.now() + windowHours * 3600 * 1000);

    const created = (await this.prisma.groupBuy.create({
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

    // Cạnh biên: targetSize (config) = 1 → nhóm đã đủ người NGAY khi tạo (chỉ có initiator).
    // Không xử lý thì nhóm kẹt OPEN mãi vì join()'s guard `currentSize < targetSize` không bao
    // giờ đúng nữa (không còn ai join được) → initiator không bao giờ nhận coupon.
    let status = created.status;
    if (created.currentSize >= created.targetSize) {
      const flip = await this.prisma.groupBuy.updateMany({ where: { id: created.id, status: 'OPEN' }, data: { status: 'SUCCESS' } });
      if (flip.count === 1) {
        status = 'SUCCESS';
        await this.onSuccess({ ...created, status: 'SUCCESS' });
      }
    }
    return this.toView(
      { ...created, status },
      { name: product.name, slug: product.slug, thumbnail: product.thumbnail },
      1,
      true,
    );
  }

  async join(userId: string, groupBuyId: string) {
    const group = (await this.prisma.groupBuy.findUnique({ where: { id: groupBuyId } })) as GroupRow | null;
    if (!group) throw new NotFoundException('Không tìm thấy nhóm mua chung.');
    if (group.status !== 'OPEN') throw new BadRequestException('Nhóm đã đóng.');
    if (new Date(group.expiresAt).getTime() <= Date.now()) throw new BadRequestException('Nhóm đã hết hạn.');

    const existing = await this.prisma.groupBuyMember.findUnique({
      where: { groupBuyId_userId: { groupBuyId, userId } },
    });
    if (existing) throw new BadRequestException('Bạn đã tham gia nhóm này rồi.');

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

    if (result.succeeded) await this.onSuccess(group);
    return { joined: true, currentSize: result.currentSize, status: result.succeeded ? 'SUCCESS' : 'OPEN' };
  }

  /**
   * Nhóm đủ người: cấp coupon giảm giá cho từng thành viên + thông báo.
   * Chỉ đánh dấu `couponsGrantedAt` khi TẤT CẢ thành viên đã có coupon — nếu còn sót
   * (lỗi DB tạm thời), để null cho cron `reconcileSuccessfulGroups` thử lại sau.
   */
  private async onSuccess(group: GroupRow) {
    const allGranted = await this.grantAllMembers(group);
    if (allGranted) await this.markGranted(group.id);
  }

  /** Cấp coupon (idempotent qua mã tất định + @unique) + thông báo MỚI cho từng thành viên.
   *  Trả true nếu mọi thành viên đều đã có coupon (mới cấp hoặc đã có sẵn — P2002). */
  private async grantAllMembers(group: GroupRow): Promise<boolean> {
    const members = await this.prisma.groupBuyMember.findMany({ where: { groupBuyId: group.id } });
    const discount = group.basePrice - group.unitPrice;
    let allGranted = true;
    for (const m of members) {
      let newlyGranted = false;
      try {
        await this.grantCoupon(group.id, m.userId, discount);
        newlyGranted = true;
      } catch (e) {
        if (this.isAlreadyGranted(e)) {
          newlyGranted = false; // đã cấp ở lần trước → coi như đã có, KHÔNG thông báo lại
        } else {
          allGranted = false;
          this.logger.warn(`grantCoupon lỗi (nhóm ${group.id}, user ${m.userId}): ${(e as Error).message}`);
        }
      }
      // Chỉ thông báo khi coupon vừa được cấp mới (tránh spam khi reconcile chạy lại).
      if (newlyGranted && this.notifications) {
        await this.notifications
          .notify(m.userId, 'GROUP_BUY_SUCCESS', { discount: discount.toLocaleString('vi-VN') })
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
    return this.toView(group as unknown as GroupRow, group.product, group._count.members, joined);
  }

  async listOpen() {
    const groups = await this.prisma.groupBuy.findMany({
      where: { status: 'OPEN', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { product: { select: { name: true, slug: true, thumbnail: true } }, _count: { select: { members: true } } },
    });
    return groups.map((g) => this.toView(g as unknown as GroupRow, g.product, g._count.members, false));
  }

  /** Cron: nhóm OPEN quá hạn → FAILED. Trả số nhóm bị đánh hỏng. */
  async expireGroups(): Promise<number> {
    const res = await this.prisma.groupBuy.updateMany({
      where: { status: 'OPEN', expiresAt: { lte: new Date() } },
      data: { status: 'FAILED' },
    });
    return res.count;
  }

  private toView(
    g: GroupRow,
    product: { name: string; slug: string; thumbnail: string | null },
    memberCount: number,
    joined: boolean,
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
    };
  }

  /** Mã TẤT ĐỊNH theo (nhóm, user) → cấp lại an toàn: coupon.code @unique chặn trùng (P2002). */
  private async grantCoupon(groupBuyId: string, userId: string, amount: number): Promise<string> {
    const code = `GBUY-${groupBuyId.slice(-8)}-${userId.slice(-8)}`.toUpperCase();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    await this.prisma.coupon.create({
      data: {
        code,
        type: 'AMOUNT',
        value: amount,
        startAt: new Date(),
        endAt: end,
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId, groupBuyId } as object,
      },
    });
    return code;
  }
}
