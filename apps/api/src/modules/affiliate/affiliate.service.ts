import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CommissionStatus, type PayoutStatus, type Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PricingService } from '../pricing/pricing.service';
import { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import { PlaceOrderForCustomerDto } from './dto/place-order-for-customer.dto';
import { reserveVariationStock } from '../catalog/variation-stock';
import { assertVariationsSellable, isSellableVariation, productDiscontinuedError } from '../cart/sellable';
import { RewardPointsService } from '../wallet/reward-points.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CTV_NOTIFICATION } from './ctv-notification-codes';
import { generateUniqueOrderCode } from '../../common/order-code';
import { paginated, skipTake } from '../../common/pagination';
import { toLocalPhone } from '../../common/phone';
import {
  CONFIRMED_COMMISSION_STATUSES,
  CTV_MONTHLY_MILESTONES,
  PENDING_COMMISSION_STATUSES,
  milestoneProgressPct,
  tierForRevenue,
  tiersWithRewards,
  vnDayStart,
  vnMonthBounds,
  type VnMonth,
} from './ctv-milestones';
import { CRON_TZ } from '../../common/cron-tz';

export { CTV_MONTHLY_MILESTONES, type CtvMilestone } from './ctv-milestones';

type Db = PrismaService | Prisma.TransactionClient;

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

/**
 * CTV nội bộ (Build Spec §6.x, §15 affiliate.*).
 * Commission: rate theo từng variation (variation.affiliateRate). Vòng đời:
 * PENDING (đặt) → LOCKED (DELIVERED) → APPROVED (sau hold_days) → PAID (payout).
 */
@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly pricing: PricingService,
    private readonly pancakeOrder: PancakeOrderService,
    private readonly rewards: RewardPointsService,
    private readonly analytics: AnalyticsEventsService,
    // @Optional: test dựng service trực tiếp không truyền; AppModule luôn wiring (NotificationsModule là @Global).
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async register(userId: string, termsVersion?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role === 'DEALER' || user.role === 'ADMIN' || user.role === 'STAFF') {
      throw new BadRequestException('Tài khoản này không thể đăng ký CTV.');
    }
    const data: Prisma.UserUpdateInput = {};
    if (user.role !== 'AFFILIATE') data.role = 'AFFILIATE';
    // Bằng chứng người dùng đã đồng ý điều khoản hoa hồng/thuế: ghi vào User.metadata (đã dùng cho
    // segments/dealerTierId, không cần migration). Chỉ ghi khi phiên bản đổi để giữ thời điểm đồng
    // ý đầu tiên của từng phiên bản; merge để không mất khoá metadata khác.
    const version = termsVersion?.trim();
    if (version) {
      const meta = (user.metadata as Record<string, unknown> | null) ?? {};
      const prev = meta.affiliateTerms as { version?: string } | undefined;
      if (prev?.version !== version) {
        data.metadata = {
          ...meta,
          affiliateTerms: { version, acceptedAt: new Date().toISOString() },
        } as Prisma.InputJsonValue;
      }
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: userId }, data });
    }
    return { ok: true, referralCode: user.referralCode };
  }

  async getMe(userId: string, now: Date = new Date()) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const monthRevenue = await this.confirmedRevenue(this.prisma, userId, vnMonthBounds(now));

    return {
      isAffiliate: user.role === 'AFFILIATE' || user.role === 'ADMIN',
      referralCode: user.referralCode,
      walletBalance: user.walletBalance,
      monthRevenue,
      tier: this.monthlyTier(monthRevenue),
    };
  }

  /**
   * Ghi "chạm" giới thiệu (attribution last-touch persistent §quyết-định). Khi khách (đã đăng nhập)
   * mở link CTV/nhãn → lưu referrerUserId + slug, hạn = now + config(attribution_days, mặc định 7 — Q-31).
   * Mỗi lần mở làm mới hạn. Bỏ qua nếu thiếu code / code không tồn tại / trỏ chính mình.
   */
  async recordTouch(
    userId: string,
    dto: { referralCode?: string; storefrontSlug?: string; kind?: string },
    now: Date = new Date(),
  ): Promise<{ ok: boolean }> {
    if (!dto.referralCode) return { ok: false };
    // P0 FIX (audit A5-01, 2026-09-27): User.referralCode LUÔN lưu chữ HOA (auth.service.ts sinh
    // bằng toUpperCase — mirror resolveReferrerId ở đó). Gian hàng CTV mở TRONG ZALO dùng slug làm
    // referralCode (storefront.service.ts sinh slug = referralCode.toLowerCase(); miniapp
    // storefront-view.tsx/app.tsx forward thẳng slug đó, KHÔNG hoa hoá lại) → so khớp CHÍNH XÁC
    // trước đây luôn trượt (Postgres phân biệt hoa/thường), referrer luôn null, CTV bán qua gian
    // hàng trong Zalo không bao giờ được ghi hoa hồng. Chuẩn hoá NGAY TẠI LỚP SO KHỚP này — không
    // dựa vào việc mọi nơi gọi (kể cả các luồng tương lai) tự nhớ hoa hoá trước khi gửi lên.
    const ref = await this.prisma.user.findUnique({
      where: { referralCode: dto.referralCode.toUpperCase() },
      select: { id: true },
    });
    if (!ref || ref.id === userId) return { ok: false };
    const days = await this.config.get<number>('affiliate.attribution_days', 7);
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const data = {
      referrerUserId: ref.id,
      storefrontSlug: dto.storefrontSlug ?? null,
      kind: dto.kind ?? 'ctv',
      expiresAt,
    };
    await this.prisma.referralTouch.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    // Best-effort (không tx nào đang chạy ở đây) — mất 1 event referral_touched không đáng để
    // chặn/hủy việc ghi "chạm" giới thiệu thật (đường tiền).
    await this.analytics.recordBestEffort({
      eventName: 'referral_touched',
      userId,
      platform: 'miniapp',
      // Không cần `?? null`: guard `if (!dto.referralCode) return` ở đầu hàm đã đảm bảo non-empty
      // string tới đây.
      refCode: dto.referralCode,
      storefrontSlug: dto.storefrontSlug ?? null,
      props: { kind: dto.kind ?? 'ctv' },
    });
    return { ok: true };
  }

  /** Lấy "chạm" còn hạn của khách (fallback attribution khi phiên đã mất). */
  async getActiveTouch(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ referrerUserId: string; storefrontSlug: string | null; kind: string } | null> {
    const t = await this.prisma.referralTouch.findUnique({ where: { userId } });
    if (!t || t.expiresAt <= now) return null;
    return { referrerUserId: t.referrerUserId, storefrontSlug: t.storefrontSlug, kind: t.kind };
  }

  async createLink(userId: string, targetType: string, targetId?: string) {
    const shortCode = randomBytes(5).toString('base64url');
    return this.prisma.affiliateLink.create({
      data: { userId, shortCode, targetType, targetId },
    });
  }

  /** Mới nhất trước; mặc định 100 (tối đa 200) — CTV tạo link vô hạn nên không thể trả hết một lần. */
  listLinks(userId: string, opts: { take?: number; cursor?: string } = {}) {
    return this.prisma.affiliateLink.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(opts.take ?? 100, 1), 200),
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
  }

  /** Track click (web redirect /r/:shortCode). Trả target để redirect. */
  async trackClick(shortCode: string, visitorId: string, ipHash: string) {
    const link = await this.prisma.affiliateLink.findUnique({ where: { shortCode } });
    if (!link) return null;
    await this.prisma.$transaction([
      this.prisma.affiliateLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 } } }),
      this.prisma.affiliateClick.create({ data: { shortCode, visitorId, ipHash } }),
    ]);
    return { targetType: link.targetType, targetId: link.targetId };
  }

  async dashboard(userId: string, now: Date = new Date()) {
    // Mốc ngày/tháng theo giờ VN (máy chủ Docker chạy UTC → new Date(y, m, 1) lệch 7 tiếng).
    const month = vnMonthBounds(now);
    const startOfMonth = month.start;
    const startOfDay = vnDayStart(now);

    const [today, monthCommission, pending, approved, links, monthRevenue] = await Promise.all([
      this.sumCommission(userId, startOfDay),
      this.sumCommission(userId, startOfMonth),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: { in: ['PENDING', 'LOCKED'] } },
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
        _sum: { amount: true },
      }),
      this.prisma.affiliateLink.aggregate({
        where: { userId },
        _sum: { clicks: true, conversions: true },
      }),
      // Doanh số tháng = doanh số ĐÃ CHỐT (cùng định nghĩa với bậc/mốc — xem ctv-milestones.ts).
      // Trước đây: orderTotal mọi commission khác REJECTED tạo trong tháng → gồm cả đơn còn huỷ
      // được, hàng bị chặn affiliate và phí ship.
      this.confirmedRevenue(this.prisma, userId, month),
    ]);

    return {
      todayCommission: today,
      monthCommission,
      pendingCommission: pending._sum.amount ?? 0,
      withdrawableCommission: approved._sum.amount ?? 0,
      totalClicks: links._sum.clicks ?? 0,
      totalConversions: links._sum.conversions ?? 0,
      monthRevenue,
      // bonusPct: 0 CHỈ để tương thích bản miniapp cũ còn trên Zalo (render "Bonus +{bonusPct}%" —
      // thiếu field sẽ hiện "+undefined%"). Luôn 0 vì không có luồng nào trả khoản này; bản mới không đọc.
      tier: { ...this.monthlyTier(monthRevenue), bonusPct: 0 },
    };
  }

  /**
   * Bậc CTV theo doanh số đã chốt tháng (Build Spec §6.8.2). Chỉ là danh hiệu — KHÔNG kèm
   * "+X% bonus": chưa có luồng nào trả khoản đó (xem ctv-milestones.ts).
   */
  private monthlyTier(revenue: number) {
    return tierForRevenue(revenue);
  }

  /**
   * Doanh số CTV ĐÃ CHỐT trong tháng VN `month`: commissionableTotal của commission APPROVED/PAID
   * có approvedAt trong tháng. Định nghĩa DUY NHẤT cho dashboard/getMe/bậc/mốc/claim — UI không
   * bao giờ hiện "nhận được" mà claim lại từ chối (hoặc ngược lại). Nhận `db` để claim đọc CÙNG tx.
   */
  private async confirmedRevenue(db: Db, userId: string, month: VnMonth): Promise<number> {
    const agg = await db.commission.aggregate({
      where: {
        affiliateUserId: userId,
        status: { in: [...CONFIRMED_COMMISSION_STATUSES] },
        approvedAt: { gte: month.start, lt: month.end },
      },
      _sum: { commissionableTotal: true },
    });
    return agg._sum.commissionableTotal ?? 0;
  }

  /**
   * Bậc CTV để hiện công khai trên trang gian hàng (storefront.service.ts getPublicBySlug) —
   * CHỈ trả tên+icon, KHÔNG trả doanh thu/bonusPct thật để tránh lộ doanh số CTV cho khách xem
   * gian hàng của họ.
   */
  async getPublicTier(userId: string, now: Date = new Date()): Promise<{ name: string; emoji: string }> {
    // Cùng định nghĩa doanh số ĐÃ CHỐT (tháng VN) với dashboard/bậc của chính CTV — huy hiệu công
    // khai không được "cao hơn" bậc CTV tự thấy.
    const revenue = await this.confirmedRevenue(this.prisma, userId, vnMonthBounds(now));
    const tier = this.monthlyTier(revenue);
    return { name: tier.name, emoji: tier.emoji };
  }

  listCommissions(userId: string) {
    return this.prisma.commission.findMany({
      where: { affiliateUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * CTV "lên đơn hộ khách": CTV đặt đơn giao cho khách cuối, CTV hưởng hoa hồng.
   * MONEY-CRITICAL — trừ stock ATOMIC (mirror checkout.placeOrder) + tạo hoa hồng cho CTV.
   * KHÔNG coupon/điểm, chỉ COD/chuyển khoản. Đơn đánh dấu placedForCustomer=true để
   * createCommissionForOrder cho phép self-referral (userId==referrerUserId==CTV).
   */
  async placeOrderForCustomer(ctvId: string, dto: PlaceOrderForCustomerDto, idempotencyKey?: string) {
    // Chuẩn hoá key rỗng/khoảng trắng → undefined (mirror wallet.withdraw / checkout.placeOrder):
    // tránh ghi '' vào Order.idempotencyKey (unique) rồi lần đặt hộ tiếp theo cũng '' đụng P2002.
    const key = idempotencyKey?.trim() || undefined;
    // Double-tap/retry cùng key → trả lại đơn đã tạo, KHÔNG trừ kho / tạo commission lần 2
    // (trước đây endpoint này — khác placeOrder thường — không có bảo vệ double-submit).
    if (key) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: key } });
      if (existing && existing.userId === ctvId) {
        return this.prisma.order.findUniqueOrThrow({ where: { id: existing.id }, include: { items: true } });
      }
      if (existing) throw new BadRequestException('Idempotency-Key đã được sử dụng, vui lòng thử lại.');
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Chưa chọn sản phẩm để lên đơn.');
    }
    // Chống tự-giao-dịch: chỉ CTV (AFFILIATE) hoặc ADMIN mới được lên đơn hộ hưởng hoa hồng.
    const ctv = await this.prisma.user.findUniqueOrThrow({ where: { id: ctvId } });
    if (ctv.role !== 'AFFILIATE' && ctv.role !== 'ADMIN') {
      throw new BadRequestException('Chỉ CTV mới có thể lên đơn hộ khách.');
    }
    // Đơn hộ được phép tự-giới-thiệu (referrer == userId) vì người nhận là khách khác; nếu người
    // nhận chính là CTV thì đó là mua cho mình mà vẫn ăn hoa hồng, và tiền hoàn (theo SĐT người
    // nhận) cũng chảy về CTV.
    const ctvPhone = ctv.phone ? toLocalPhone(ctv.phone) : null;
    if (ctvPhone && ctvPhone === toLocalPhone(dto.customer.phone)) {
      throw new BadRequestException(
        'Không thể lên đơn hộ với SĐT của chính bạn. Hãy đặt hàng như khách thường cho đơn của mình.',
      );
    }

    const variationIds = [...new Set(dto.items.map((i) => i.variationId))];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds } },
      include: { product: { select: { name: true, slug: true, isActive: true, approvalStatus: true } } },
    });
    const vmap = new Map(variations.map((v) => [v.id, v]));

    // Dựng line + validate (variation tồn tại + đang bán + SP cha đang bán và đã duyệt).
    // unitPrice = salePrice ?? retailPrice.
    const lines = dto.items.map((i) => {
      const v = vmap.get(i.variationId);
      if (!v) throw new BadRequestException('Sản phẩm không còn khả dụng.');
      if (!isSellableVariation(v)) throw productDiscontinuedError(v.product.name);
      const unitPrice = v.salePrice ?? v.retailPrice;
      return {
        variationId: v.id,
        productName: v.product.name,
        productSlug: v.product.slug,
        variationName: v.name,
        unitPrice,
        quantity: i.quantity,
        total: unitPrice * i.quantity,
      };
    });

    const goods = lines.reduce((s, l) => s + l.total, 0);
    const shippingFee = await this.pricing.calcShippingFee({ subtotal: goods, tierId: null });
    const total = goods + shippingFee;

    // Gian hàng của CTV (nếu có) → gắn slug để analytics theo gian hàng.
    const store = await this.prisma.storefront.findFirst({
      where: { ownerUserId: ctvId },
      select: { slug: true },
    });
    const storefrontSlug = store?.slug ?? null;

    const status = dto.paymentMethod === 'COD' ? 'CONFIRMED' : 'PENDING_PAYMENT';
    const code = await generateUniqueOrderCode(this.prisma, 'RETAIL');
    const shippingAddress = this.customerSnapshot(dto.customer);

    let order: { id: string };
    try {
      order = await this.prisma.$transaction(async (tx) => {
        // SP có thể bị gỡ giữa lúc dựng giá và lúc ghi đơn — kiểm lại trong tx.
        await assertVariationsSellable(tx, lines);
        // Giữ chỗ tồn kho ATOMIC từng line — chống oversell; 0 dòng bị sửa → throw rollback.
        for (const line of lines) {
          const hit = await reserveVariationStock(tx, line.variationId, line.quantity);
          if (!hit) {
            throw new BadRequestException(`Sản phẩm "${line.productName}" không đủ tồn kho.`);
          }
        }
        const created = await tx.order.create({
          data: {
            code,
            userId: ctvId,
            type: 'RETAIL',
            status,
            subtotal: goods,
            discount: 0,
            shippingFee,
            total,
            pointsEarned: 0,
            pointsUsed: 0,
            paymentMethod: dto.paymentMethod,
            paymentStatus: 'UNPAID',
            shippingAddress,
            referrerUserId: ctvId,
            storefrontSlug,
            placedForCustomer: true,
            source: 'ctv_assisted',
            platform: 'miniapp',
            // KHÔNG PHẢI hash mật mã — SĐT người nhận chuẩn hoá về DẠNG NỘI ĐỊA 0xxxxxxxxx (xem
            // toLocalPhone ở common/phone.ts), CÙNG dạng User.phone luôn lưu, để 2 giá trị so khớp
            // trực tiếp được nếu người nhận sau này cũng là 1 tài khoản thật. Đơn CTV lên hộ tạo
            // Order qua nhánh RIÊNG này (không qua checkout.service.ts) nên đây là nơi DUY NHẤT
            // set 3 cột này cho loại đơn "lên đơn hộ" — thiếu bước này (hoặc chuẩn hoá sai dạng)
            // thì quyết định "tính doanh số cho khách nhận hàng qua endCustomerKey" lặng lẽ không
            // có hiệu lực / gộp sai người.
            endCustomerKey: toLocalPhone(dto.customer.phone),
            note: dto.note,
            idempotencyKey: key ?? null,
            items: {
              create: lines.map((l) => ({
                variationId: l.variationId,
                productName: l.productName,
                productSlug: l.productSlug,
                variationName: l.variationName,
                unitPrice: l.unitPrice,
                quantity: l.quantity,
                total: l.total,
              })),
            },
          },
        });
        // order_placed atomic với đơn (cùng tx) — mirror checkout.service.ts (Task 4), nhưng bắt
        // buộc phát RIÊNG ở đây vì placeOrderForCustomer tạo Order qua nhánh hoàn toàn khác, không
        // đi qua checkout.service.ts. Không phát order_paid: đơn CTV chỉ COD (không PAID lúc tạo)
        // hoặc chuyển khoản (phủ bởi Pancake reconcile chung cho mọi đơn, Task 5).
        await this.analytics.record(tx, {
          eventName: 'order_placed',
          userId: ctvId,
          platform: 'miniapp',
          storefrontSlug,
          props: {
            orderId: created.id,
            total,
            subtotal: goods,
            discount: 0,
            shippingFee,
            itemCount: lines.length,
            paymentMethod: dto.paymentMethod,
            orderSource: 'ctv_assisted',
          },
        });
        await this.createCommissionForOrder(created.id, tx);
        return created;
      });
    } catch (err) {
      // Race idempotency: 2 request cùng key chạy đồng thời — request thua ăn unique-violation
      // (P2002) trên idempotencyKey. Trả lại đơn mà request thắng đã tạo (mirror checkout.placeOrder).
      if (key && typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: key } });
        if (existing) return this.prisma.order.findUniqueOrThrow({ where: { id: existing.id }, include: { items: true } });
      }
      throw err;
    }

    // Ngoài tx: xếp hàng đẩy Pancake (retry+backoff qua PancakePushProcessor, mirror
    // checkout.placeOrder — xem P0-2 trong docs/2026-09-08-review-progress.md). Non-fatal —
    // Pancake lỗi/chưa cấu hình không được chặn đơn CTV đã tạo; cron reconcile quét lại sau.
    try {
      await this.pancakeOrder.enqueuePush(order.id);
    } catch (err) {
      this.logger.error(`Xếp hàng đẩy Pancake lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`);
    }
    return this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
  }

  /** Snapshot địa chỉ người nhận (khách của CTV) → lưu Order.shippingAddress. */
  private customerSnapshot(c: PlaceOrderForCustomerDto['customer']): Prisma.InputJsonValue {
    return {
      recipient: c.recipient,
      phone: c.phone,
      province: c.province,
      district: c.district ?? '',
      ward: c.ward,
      street: c.street,
      provinceCode: c.provinceCode,
      districtCode: c.districtCode ?? '',
      wardCode: c.wardCode,
    };
  }

  /**
   * Tạo commission PENDING cho đơn có người giới thiệu. Caller tạo đơn truyền `tx` của chính
   * transaction tạo đơn: hoa hồng commit/rollback cùng đơn, lỗi nổi lên thay vì đơn tồn tại mà CTV
   * mất hoa hồng vĩnh viễn (C-002). Gọi lại / gọi song song an toàn: unique (orderId,
   * affiliateUserId) + ON CONFLICT DO NOTHING — không dùng create rồi bắt P2002 vì trong tx của
   * caller lỗi đó làm abort cả transaction đơn.
   */
  async createCommissionForOrder(orderId: string, db: Prisma.TransactionClient = this.prisma): Promise<void> {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    // Chặn tự-giới-thiệu (referrer == buyer) TRỪ đơn CTV "lên đơn hộ khách"
    // (placedForCustomer=true) — đó là nghiệp vụ hợp lệ: CTV hưởng hoa hồng cho đơn hộ.
    if (!order.referrerUserId || (order.referrerUserId === order.userId && !order.placedForCustomer)) return;

    const variationIds = order.items.map((i) => i.variationId);
    const variations = await db.variation.findMany({
      where: { id: { in: variationIds } },
      select: { id: true, affiliateRate: true, product: { select: { affiliateBlocked: true } } },
    });
    // Sản phẩm bị chặn affiliate (product.affiliateBlocked) → rate=0, KHÔNG tính hoa hồng cho
    // dòng hàng đó, dù link/CTV nào đã trót chia sẻ trước khi bị chặn (mirror storefront/brand
    // đã lọc affiliateBlocked ở bước hiển thị — chỗ này chặn ở chính điểm phát sinh tiền thật).
    const rateMap = new Map(
      variations.map((v) => [v.id, v.product?.affiliateBlocked ? 0 : v.affiliateRate ? Number(v.affiliateRate) : 0]),
    );

    let amount = 0;
    let weightedRate = 0;
    // Nền doanh số bậc/mốc: chỉ dòng CÓ hưởng hoa hồng (loại hàng bị chặn/rate 0 + phí ship).
    let commissionableTotal = 0;
    for (const item of order.items) {
      const rate = rateMap.get(item.variationId) ?? 0;
      amount += Math.floor((item.total * rate) / 100);
      weightedRate += rate;
      if (rate > 0) commissionableTotal += item.total;
    }
    if (amount <= 0) return;

    await db.commission.createMany({
      skipDuplicates: true,
      data: {
        affiliateUserId: order.referrerUserId,
        orderId: order.id,
        orderTotal: order.total,
        commissionableTotal,
        rate: weightedRate / order.items.length,
        amount,
        status: 'PENDING',
      },
    });
  }

  /** Đơn DELIVERED → khóa commission, bắt đầu đếm hold. */
  async lockCommissionsForOrder(orderId: string): Promise<void> {
    await this.prisma.commission.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'LOCKED', lockedAt: new Date() },
    });
  }

  /**
   * Đơn DELIVERED → xét thưởng giới thiệu cho người mời của chủ đơn (Q-05: một chương trình duy
   * nhất, thưởng Điểm Xanh khi người được mời có đơn thứ 2 trong cửa sổ). Không còn voucher REFER/REFERRED
   * 50k+50k: voucher đó cộng thêm cho CTV ngoài hoa hồng và không bị thu hồi khi đơn bị trả. Voucher
   * đã cấp trước đây giữ nguyên.
   */
  async grantReferralReward(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { userId: true, type: true, placedForCustomer: true },
    });
    if (order.type !== 'RETAIL' || order.placedForCustomer) return;
    await this.rewards.grantReferralOrderReward(order.userId);
  }

  /** Đơn hoàn/hủy trong cửa sổ → reject commission. */
  async reverseCommissionsForOrder(orderId: string): Promise<void> {
    // Guard ĐỐI XỨNG với createCommissionForOrder: chỉ đảo khi đơn CÓ hoa hồng hợp lệ.
    // Tự-giới-thiệu organic (referrer==buyer, placedForCustomer=false) không sinh hoa hồng
    // → bỏ qua; đơn CTV lên-đơn-hộ (placedForCustomer=true) VẪN đảo bình thường.
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { referrerUserId: true, userId: true, placedForCustomer: true },
    });
    if (!order.referrerUserId || (order.referrerUserId === order.userId && !order.placedForCustomer)) return;

    await this.prisma.commission.updateMany({
      where: { orderId, status: { in: ['PENDING', 'LOCKED'] } },
      data: { status: 'REJECTED' },
    });
  }

  async requestPayout(
    userId: string,
    amount: number,
    method: string,
    bankInfo?: object,
    idempotencyKey?: string,
  ) {
    const minWithdraw = await this.config.get<number>('affiliate.min_withdraw_bank', 50000);
    // P0 FIX (audit A5-07, 2026-09-27): KHÔNG đọc `affiliate.tubu_wallet_multiplier` ở đây nữa —
    // walletBalance là tiền VND rút được 1:1 ra ngân hàng thật (wallet.service.ts:withdraw, trừ phí
    // cố định), nên nhân hệ số ở đường quy đổi hoa hồng→Ví là in tiền thật (1.000.000đ hoa hồng →
    // 1.497.000đ rút được ở hệ số mặc định cũ 1.5). Rút về Ví giờ LUÔN là quy đổi 1:1 (credited =
    // total), bất kể SystemConfig còn seed giá trị gì cho key này. Key này vẫn tồn tại/được đọc bởi
    // `system-config` (public config — ngoài phạm vi sửa của bản vá này) và miniapp đã ngừng hiển
    // thị "×hệ số" (affiliate.tsx); nếu tương lai thật sự cần một khoản "bonus" khi đổi hoa hồng
    // sang Ví, khoản đó PHẢI trả bằng Điểm Xanh (không rút được), KHÔNG BAO GIỜ cộng thẳng vào
    // walletBalance bằng hệ số nhân > 1.

    // Chuẩn hoá '' / khoảng trắng → undefined (mirror wallet.withdraw / checkout.placeOrder /
    // placeOrderForCustomer ở trên) — tránh ghi '' vào payouts.idempotencyKey (unique) rồi lần
    // rút tiếp theo cũng '' đụng P2002.
    const key = idempotencyKey?.trim() || undefined;
    // Double-tap/retry cùng key → trả lại Payout đã tạo, KHÔNG rút/cộng tiền lần 2. Payout đã có
    // sẵn cột idempotencyKey (unique) trong schema (payouts.idempotencyKey) — dùng lại, KHÔNG
    // cần thêm cột mới.
    if (key) {
      const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
      if (existing && existing.userId === userId) {
        return existing.method === 'WALLET_BALANCE'
          ? {
              ok: true,
              method: existing.method,
              credited: existing.amount,
              note: `Đã cộng ${existing.amount}đ vào Ví Tubu.`,
            }
          : { ok: true, payoutId: existing.id, status: existing.status };
      }
      // idempotencyKey unique toàn cục (không compound theo userId) — nếu key trùng nhưng thuộc
      // user khác thì KHÔNG trả payout của người khác ra ngoài; bắt buộc client thử lại key mới.
      if (existing) throw new BadRequestException('Idempotency-Key đã được sử dụng, vui lòng thử lại.');
    }

    // "Khả dụng" = APPROVED và CHƯA thuộc batch payout nào (payoutBatchId null).
    const approved = await this.prisma.commission.aggregate({
      where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
      _sum: { amount: true },
    });
    const available = approved._sum.amount ?? 0;
    if (available <= 0) throw new BadRequestException('Không có hoa hồng khả dụng để rút.');
    if (amount > available) throw new BadRequestException('Số dư hoa hồng khả dụng không đủ.');
    // Bug đã sửa: trước đây 'amount' chỉ được VALIDATE (amount > available → throw ở trên) nhưng
    // KHÔNG ĐƯỢC DÙNG để giới hạn số tiền rút thực — code luôn rút/cộng HẾT toàn bộ available bất
    // kể amount truyền vào là bao nhiêu. Phương án sửa ĐÃ CHỌN: BẮT BUỘC rút toàn bộ (amount phải
    // === available), throw rõ ràng nếu ít hơn — KHÔNG chọn phương án "chọn subset commission row
    // sao cho tổng khớp đúng amount tuỳ ý", vì đó là bài toán subset-sum trên các bản ghi rời rạc:
    // phức tạp hơn nhiều và rủi ro chọn sai/không tìm được tổ hợp khớp cao hơn hẳn so với việc yêu
    // cầu client xác nhận rút đúng số dư khả dụng (đã trả về sẵn ở GET /affiliate/dashboard qua
    // withdrawableCommission). Với tiền thật, throw rõ ràng an toàn hơn cả 2: rút "hết bất kể
    // amount" (bug cũ) lẫn 1 thuật toán chọn row phức tạp khó review.
    if (amount < available) {
      throw new BadRequestException(
        `Chỉ hỗ trợ rút toàn bộ số dư hoa hồng khả dụng (${available.toLocaleString('vi-VN')}đ), không hỗ trợ rút một phần.`,
      );
    }

    // Rút = cash-out TOÀN BỘ hoa hồng khả dụng (commission là bản ghi rời rạc, không
    // tách lẻ theo số tiền tùy ý). credited tính theo tổng THỰC trong transaction →
    // không mất tiền; gate theo updateMany.count → không double-spend khi chạy đồng thời.
    if (method === 'WALLET_BALANCE') {
      let result: { credited: number };
      try {
        result = await this.prisma.$transaction(async (tx) => {
          const rows = await tx.commission.findMany({
            where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
            select: { id: true, amount: true },
          });
          const total = rows.reduce((s, c) => s + c.amount, 0);
          const marked = await tx.commission.updateMany({
            where: { id: { in: rows.map((r) => r.id) }, status: 'APPROVED', payoutBatchId: null },
            data: { status: 'PAID', paidAt: new Date() },
          });
          if (marked.count === 0 || total <= 0) throw new BadRequestException('Hoa hồng đã được xử lý.');
          // marked.count !== rows.length nghĩa là 1 phần row đã bị thay đổi (status/payoutBatchId)
          // GIỮA lúc đọc (rows/total) và lúc updateMany — total tính từ rows cũ không còn khớp với
          // số row thực sự vừa bị đánh dấu PAID. Trước đây chỉ check marked.count===0 nên vẫn coi
          // là thành công với total có thể SAI (thừa/thiếu tiền cộng vào ví) — throw rõ ràng để
          // client thử lại thay vì tiếp tục với số liệu không nhất quán.
          if (marked.count !== rows.length) {
            throw new ConflictException('Dữ liệu hoa hồng đã thay đổi, vui lòng thử lại.');
          }
          // P0 FIX (A5-07): quy đổi 1:1, KHÔNG nhân hệ số — xem giải thích ở đầu hàm.
          const credited = total;
          const payout = await tx.payout.create({
            data: { userId, amount: credited, method, status: 'PAID', paidAt: new Date(), idempotencyKey: key },
          });
          await applyWalletDelta(tx, {
            userId,
            delta: credited,
            type: 'COMMISSION_PAYOUT',
            refType: 'PAYOUT',
            refId: payout.id,
            reason: `Rút ${rows.length} khoản hoa hồng về Ví`,
          });
          return { credited };
        });
      } catch (err) {
        // Race idempotency: 2 request cùng key chạy đồng thời — request thua ăn P2002 trên
        // idempotencyKey khi payout.create (toàn bộ transaction rollback, KHÔNG double-credit).
        // Trả lại kết quả của request thắng (mirror wallet.withdraw).
        if (key && typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
          const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
          if (existing && existing.userId === userId) {
            return {
              ok: true,
              method: existing.method,
              credited: existing.amount,
              note: `Đã cộng ${existing.amount}đ vào Ví Tubu.`,
            };
          }
        }
        throw err;
      }
      return {
        ok: true,
        method,
        credited: result.credited,
        note: `Đã cộng ${result.credited}đ vào Ví Tubu.`,
      };
    }

    // Rút về STK ngân hàng.
    if (amount < minWithdraw) {
      throw new BadRequestException(`Số tiền rút tối thiểu ${minWithdraw.toLocaleString('vi-VN')}đ.`);
    }
    let payout: { id: string; status: string };
    try {
      payout = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.commission.findMany({
          where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
          select: { id: true, amount: true },
        });
        const total = rows.reduce((s, c) => s + c.amount, 0);
        if (total <= 0) throw new BadRequestException('Không có hoa hồng khả dụng để rút.');
        const p = await tx.payout.create({
          data: { userId, amount: total, method: 'BANK', bankInfo: bankInfo ?? {}, status: 'REQUESTED', idempotencyKey: key },
        });
        // Gán batch + set PAID để loại khỏi "khả dụng" → chống rút trùng (gate theo count).
        const marked = await tx.commission.updateMany({
          where: { id: { in: rows.map((r) => r.id) }, status: 'APPROVED', payoutBatchId: null },
          data: { payoutBatchId: p.id, status: 'PAID', paidAt: new Date() },
        });
        if (marked.count === 0) throw new BadRequestException('Hoa hồng đã được xử lý.');
        // Xem giải thích ở nhánh WALLET_BALANCE phía trên — cùng 1 kiểu race hiếm cần chặn.
        if (marked.count !== rows.length) {
          throw new ConflictException('Dữ liệu hoa hồng đã thay đổi, vui lòng thử lại.');
        }
        return p;
      });
    } catch (err) {
      if (key && typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
        if (existing && existing.userId === userId) {
          return { ok: true, payoutId: existing.id, status: existing.status };
        }
      }
      throw err;
    }
    return { ok: true, payoutId: payout.id, status: 'REQUESTED' };
  }

  /**
   * Cron mỗi giờ: LOCKED quá hold_days → APPROVED.
   * try/catch BẮT BUỘC: đây là job Nest @Cron chạy NGAY TRONG process API chính, không ai await
   * Promise nó trả về — một lỗi Prisma tạm thời (mất kết nối DB, timeout pool, deadlock...) văng
   * ra ngoài sẽ thành unhandledRejection; Node 20 mặc định (--unhandled-rejections=throw) CRASH
   * toàn bộ process mỗi khi cron này lỗi, tức sập API cho MỌI user mỗi giờ vì một lỗi có thể chỉ
   * là nhất thời. Bắt lỗi + log để cron thử lại giờ sau thay vì sập process.
   */
  @Cron('0 0 * * * *', { timeZone: CRON_TZ })
  async approveDueCommissions(): Promise<void> {
    try {
      const holdDays = await this.effectiveHoldDays();
      const threshold = new Date(Date.now() - holdDays * 24 * 3600 * 1000);
      // Đơn còn yêu cầu đổi/trả CHỜ DUYỆT (khách gửi trong cửa sổ, admin chưa xử lý) → chưa chốt:
      // APPROVED là điểm không-đảo-được (reverseCommissionsForOrder chỉ đảo PENDING/LOCKED) và là
      // nền doanh số mốc thưởng. Chốt sớm thì admin duyệt trả hàng sau đó không đảo được nữa.
      // Yêu cầu mới không lọt giữa 2 câu lệnh: hold hiệu lực ≥ cửa sổ đổi/trả (effectiveHoldDays)
      // nên lúc đủ hold khách đã hết hạn gửi; bị từ chối thì lượt cron sau chốt tiếp.
      const openReturns = await this.prisma.returnRequest.findMany({
        where: { status: 'REQUESTED' },
        select: { orderId: true },
      });
      const heldOrderIds = [...new Set(openReturns.map((r) => r.orderId))];
      const approvedAt = new Date();
      const res = await this.prisma.commission.updateMany({
        where: {
          status: 'LOCKED',
          lockedAt: { lte: threshold },
          // Đơn phải CÒN DELIVERED ngay trong câu UPDATE: duyệt trả hàng lật đơn → RETURNED trước,
          // reverseCommissionsForOrder chạy sau (ngoài tx) — lượt cron rơi vào khe đó mà không có
          // điều kiện này sẽ chốt APPROVED (không-đảo-được) hoa hồng của đơn đã trả hàng.
          order: { status: 'DELIVERED' },
          ...(heldOrderIds.length > 0 ? { orderId: { notIn: heldOrderIds } } : {}),
        },
        data: { status: 'APPROVED', approvedAt },
      });
      if (res.count > 0) {
        this.logger.log(`Duyệt ${res.count} commission hết hold.`);
        await this.notifyCommissionsApproved(approvedAt);
      }
    } catch (err) {
      this.logger.error(`approveDueCommissions lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Báo CTV hoa hồng vừa được duyệt (có thể rút), gộp theo người: một lượt cron có thể chốt nhiều
   * khoản của cùng CTV, mỗi khoản một tin là spam. Lọc đúng lượt này bằng `approvedAt` trùng
   * mốc đã ghi ở câu UPDATE (không cần thêm cột/đổi câu UPDATE đang có test). Mọi lỗi chỉ log: tiền
   * đã chốt xong, thông báo hỏng không được làm cron báo thất bại.
   */
  private async notifyCommissionsApproved(approvedAt: Date): Promise<void> {
    if (!this.notifications) return;
    try {
      const rows = await this.prisma.commission.findMany({
        where: { status: 'APPROVED', approvedAt },
        select: { affiliateUserId: true, amount: true },
      });
      const perUser = new Map<string, { count: number; amount: number }>();
      for (const r of rows) {
        const cur = perUser.get(r.affiliateUserId) ?? { count: 0, amount: 0 };
        perUser.set(r.affiliateUserId, { count: cur.count + 1, amount: cur.amount + r.amount });
      }
      for (const [userId, sum] of perUser) {
        try {
          await this.notifications.notify(userId, CTV_NOTIFICATION.APPROVED, {
            count: String(sum.count),
            amount: vnd(sum.amount),
          });
        } catch (err) {
          this.logger.error(`Gửi thông báo hoa hồng được duyệt cho ${userId} lỗi: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      this.logger.error(`notifyCommissionsApproved lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Báo CTV có đơn mới từ link/mã của mình kèm hoa hồng dự kiến. Gọi SAU KHI đơn đã commit (hoa
   * hồng được tạo trong transaction của đơn nên không báo từ trong đó: tx rollback thì CTV nhận tin
   * về khoản không tồn tại). Không báo đơn CTV tự lên hộ (chính họ vừa tạo) và không kèm mã đơn:
   * đó là đơn của KHÁCH, app sẽ hiện nút "Xem đơn" dẫn tới trang CTV không có quyền xem. Không bao
   * giờ ném lỗi — thông báo hỏng không được làm hỏng đơn vừa đặt.
   */
  async notifyCommissionCreated(orderId: string): Promise<void> {
    if (!this.notifications) return;
    try {
      const commission = await this.prisma.commission.findFirst({
        where: { orderId },
        select: { affiliateUserId: true, amount: true, order: { select: { placedForCustomer: true } } },
      });
      if (!commission || commission.order.placedForCustomer) return;
      await this.notifications.notify(commission.affiliateUserId, CTV_NOTIFICATION.NEW, {
        amount: vnd(commission.amount),
      });
    } catch (err) {
      this.logger.error(`Gửi thông báo hoa hồng mới cho đơn ${orderId} lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Số ngày giữ THỰC trước khi chốt commission = max(affiliate.hold_days, returns.window_days).
   * Chốt (APPROVED) là điểm không-đảo-được → không được chốt khi khách còn trong cửa sổ gửi đổi/trả
   * (key + mặc định mirror OrdersService.requestReturn), dù admin cấu hình hold ngắn hơn cửa sổ.
   */
  private async effectiveHoldDays(): Promise<number> {
    const [holdDays, returnWindowDays] = await Promise.all([
      this.config.get<number>('affiliate.hold_days', 20),
      this.config.get<number>('returns.window_days', 7),
    ]);
    return Math.max(Number(holdDays) || 0, Number(returnWindowDays) || 0);
  }

  /** Thống kê theo từng gian hàng của CTV (đơn có storefrontSlug thuộc tôi + referrer là tôi). */
  async storefrontAnalytics(userId: string) {
    const myStores = await this.prisma.storefront.findMany({
      where: { ownerUserId: userId }, select: { slug: true, title: true },
    });
    const out = [] as Array<{ slug: string; title?: string; orders: number; revenue: number; commission: number }>;
    for (const s of myStores) {
      const [orderAgg, commAgg] = await Promise.all([
        this.prisma.order.aggregate({
          where: { storefrontSlug: s.slug, referrerUserId: userId },
          _count: { _all: true }, _sum: { total: true },
        }),
        // P0 A5-11 (cùng họ lỗi với dashboard()): loại commission đã REJECTED (đơn huỷ/trả) —
        // trước đây cộng cả REJECTED nên hoa hồng theo gian hàng không giảm khi đơn bị huỷ.
        this.prisma.commission.aggregate({
          where: { affiliateUserId: userId, order: { storefrontSlug: s.slug }, status: { not: CommissionStatus.REJECTED } },
          _sum: { amount: true },
        }),
      ]);
      out.push({
        slug: s.slug, title: s.title,
        orders: orderAgg._count._all, revenue: orderAgg._sum.total ?? 0,
        commission: commAgg._sum.amount ?? 0,
      });
    }
    return { storefronts: out };
  }

  /** Phân rã hoa hồng theo sản phẩm (join Commission→Order.items, tính theo affiliateRate). */
  async productCommissionBreakdown(userId: string) {
    const commissions = await this.prisma.commission.findMany({
      where: { affiliateUserId: userId, status: { not: CommissionStatus.REJECTED } },
      include: { order: { include: { items: true } } },
      orderBy: { createdAt: 'desc' }, // cửa sổ 500 commission gần nhất (deterministic)
      take: 500,
    });
    const variationIds = [
      ...new Set(commissions.flatMap((c) => c.order?.items.map((i) => i.variationId) ?? [])),
    ];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds } }, select: { id: true, affiliateRate: true },
    });
    const rate = new Map(variations.map((v) => [v.id, v.affiliateRate ? Number(v.affiliateRate) : 0]));
    // Đếm đơn theo orderId riêng biệt (Set) — 1 đơn có 2 item cùng SP vẫn tính 1 đơn.
    const acc = new Map<string, { productName: string; commission: number; orderIds: Set<string> }>();
    for (const c of commissions) {
      for (const it of c.order?.items ?? []) {
        const r = rate.get(it.variationId) ?? 0;
        if (r <= 0) continue;
        const amount = Math.floor((it.total * r) / 100);
        const cur =
          acc.get(it.productName) ?? { productName: it.productName, commission: 0, orderIds: new Set<string>() };
        cur.commission += amount;
        cur.orderIds.add(c.orderId);
        acc.set(it.productName, cur);
      }
    }
    return [...acc.values()]
      .map((x) => ({ productName: x.productName, commission: x.commission, orders: x.orderIds.size }))
      .sort((a, b) => b.commission - a.commission);
  }

  // ── Helpers ──
  /**
   * A5-11 (audit 2026-09): "Hoa hồng tháng này/Hôm nay" trên dashboard CTV — trước đây cộng CẢ
   * commission đã REJECTED (đơn huỷ/trả), nên con số lớn nhất màn hình không bao giờ giảm khi đơn
   * bị huỷ dù "Đang chờ"/"Có thể rút" vẫn giảm đúng, gây lệch không giải thích được. Loại REJECTED
   * — nhưng KHÔNG chỉ còn APPROVED/PAID như confirmedRevenue() (đó là "đã chốt" dùng cho bậc/mốc):
   * ở đây PENDING/LOCKED vẫn phải cộng như cũ, vì CTV cần thấy hoa hồng mới phát sinh ngay cả khi
   * đơn chưa giao xong. Mirror filter đã dùng ở productCommissionBreakdown() — định nghĩa DUY NHẤT
   * cho "còn sống" (đối lập REJECTED) trong file này.
   */
  private async sumCommission(userId: string, since: Date): Promise<number> {
    const agg = await this.prisma.commission.aggregate({
      where: { affiliateUserId: userId, createdAt: { gte: since }, status: { not: CommissionStatus.REJECTED } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  /** Chi tiết cấp bậc CTV và tiến độ doanh số (đã chốt) tháng VN. */
  async getCtvTiers(userId: string, now: Date = new Date()) {
    const revenue = await this.confirmedRevenue(this.prisma, userId, vnMonthBounds(now));
    return {
      revenue,
      tier: this.monthlyTier(revenue),
      // Mỗi bậc kèm thưởng mốc Điểm Xanh cùng ngưỡng — phần thưởng THẬT của bậc.
      allTiers: tiersWithRewards(),
    };
  }

  /**
   * Mốc thưởng doanh số tháng của CTV (tháng VN hiện tại) + mốc tháng trước còn nhận được.
   * Doanh số = doanh số ĐÃ CHỐT (confirmedRevenue); pendingRevenue chỉ để hiển thị "đang chờ chốt".
   */
  async getMilestones(userId: string, now: Date = new Date()) {
    const cur = vnMonthBounds(now);
    const prev = vnMonthBounds(now, -1);

    const [currentRevenue, previousRevenue, pendingAgg, claims, holdDays] = await Promise.all([
      this.confirmedRevenue(this.prisma, userId, cur),
      this.confirmedRevenue(this.prisma, userId, prev),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: { in: [...PENDING_COMMISSION_STATUSES] } },
        _sum: { commissionableTotal: true },
      }),
      this.prisma.ctvMilestoneClaim.findMany({
        where: { userId, monthKey: { in: [cur.key, prev.key] } },
        select: { milestoneId: true, monthKey: true },
      }),
      this.effectiveHoldDays(),
    ]);

    const claimed = new Set(claims.map((c) => `${c.milestoneId}:${c.monthKey}`));
    const build = (monthKey: string, revenue: number) =>
      CTV_MONTHLY_MILESTONES.map((m) => {
        const achieved = revenue >= m.threshold;
        const isClaimed = claimed.has(`${m.id}:${monthKey}`);
        return {
          ...m,
          achieved,
          claimed: isClaimed,
          canClaim: achieved && !isClaimed,
          progressPct: milestoneProgressPct(revenue, m.threshold),
        };
      });

    // Tháng trước: chỉ trả khi còn mốc đạt mà chưa nhận (commission chốt sát cuối tháng — cron
    // duyệt chạy mỗi giờ — không làm CTV mất thưởng chỉ vì chưa mở app trước 00:00 ngày 1).
    const previousClaimable = build(prev.key, previousRevenue).filter((m) => m.canClaim);

    return {
      monthKey: cur.key,
      currentRevenue,
      pendingRevenue: pendingAgg._sum.commissionableTotal ?? 0,
      holdDays,
      milestones: build(cur.key, currentRevenue),
      previousMonth:
        previousClaimable.length > 0
          ? { monthKey: prev.key, revenue: previousRevenue, milestones: previousClaimable }
          : null,
    };
  }

  /**
   * Nhận thưởng mốc doanh số tháng → cộng Điểm Xanh lô STANDARD (KHÔNG rút được, PD-3).
   * MONEY-CRITICAL:
   *  - Điều kiện đọc doanh số ĐÃ CHỐT trong CÙNG tx (không đếm đơn còn huỷ/trả được).
   *  - Idempotent dưới đồng thời: insert ctv_milestone_claims (unique userId+milestoneId+monthKey)
   *    TRƯỚC khi cấp điểm; request thua ăn P2002 → rollback cả tx → không cộng 2 lần.
   *  - Cấp qua RewardPointsService.grant(tx) — dòng sổ điểm + pointsBalance cùng tx (giữ bất biến
   *    pointsBalance == SUM(delta) lô STANDARD). Không bao giờ cộng walletBalance (tiền rút được).
   *  - `monthKey` chỉ nhận tháng này hoặc tháng trước (VN).
   */
  async claimMilestone(userId: string, milestoneId: string, monthKey?: string, now: Date = new Date()) {
    const milestone = CTV_MONTHLY_MILESTONES.find((m) => m.id === milestoneId);
    if (!milestone) {
      throw new NotFoundException(`Mốc thưởng "${milestoneId}" không tồn tại.`);
    }

    const cur = vnMonthBounds(now);
    const prev = vnMonthBounds(now, -1);
    const month = !monthKey || monthKey === cur.key ? cur : monthKey === prev.key ? prev : null;
    if (!month) {
      throw new BadRequestException('Chỉ nhận được thưởng mốc của tháng này hoặc tháng trước.');
    }
    const reason = `CTV_MILESTONE:${milestone.id}:${month.key}`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const revenue = await this.confirmedRevenue(tx, userId, month);
        if (revenue < milestone.threshold) {
          throw new BadRequestException(
            `Doanh số đã chốt tháng ${month.key} (${revenue.toLocaleString('vi-VN')}đ) chưa đạt ngưỡng ${milestone.threshold.toLocaleString('vi-VN')}đ.`,
          );
        }

        // Insert claim TRƯỚC khi cấp điểm: grant nuốt trùng khoá của chính nó (trả false) nên không
        // thể làm khoá idempotency ở đây — khoá thật là unique của ctv_milestone_claims.
        const claim = await tx.ctvMilestoneClaim.create({
          data: {
            userId,
            milestoneId: milestone.id,
            monthKey: month.key,
            rewardXu: 0,
            rewardPoints: milestone.rewardPoints,
            revenue,
          },
        });
        await this.rewards.grant(userId, milestone.rewardPoints, reason, 'AFFILIATE_MILESTONE', claim.id, tx);

        return {
          success: true,
          message: `Chúc mừng bạn đã nhận ${milestone.rewardPoints.toLocaleString('vi-VN')} Điểm Xanh từ ${milestone.title}!`,
          rewardPoints: milestone.rewardPoints,
          monthKey: month.key,
        };
      });
    } catch (err) {
      // Unique (userId, milestoneId, monthKey): đã nhận trước đó HOẶC thua race double-tap —
      // tx đã rollback, điểm KHÔNG bị cộng lần 2.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Bạn đã nhận thưởng mốc này rồi.');
      }
      throw err;
    }
  }

  // ── Admin: hàng đợi Payout (P0 A5-08 = A6-05) ──
  //
  // Payout method=BANK REQUESTED có 2 NGUỒN khác nhau, hoàn tiền phải xử lý đúng nguồn:
  //  1) wallet.service.ts:withdraw() — trừ THẲNG user.walletBalance (gross = amount + fee, vì
  //     Payout.amount lưu NET đã trừ phí). KHÔNG đụng gì tới Commission.
  //  2) requestPayout() nhánh BANK ở trên — KHÔNG đụng walletBalance; thay vào đó đánh dấu các
  //     dòng Commission APPROVED liên quan là PAID + gán payoutBatchId = payout.id.
  // Phân biệt 2 nguồn dựa trên DỮ LIỆU THẬT (có Commission nào đang payoutBatchId=payout.id
  // không) — KHÔNG thêm cột "nguồn" mới, để không phải sửa wallet.service.ts (ngoài phạm vi).

  private static readonly PAYOUT_STATUSES: readonly PayoutStatus[] = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'];

  /** Danh sách Payout cho admin xử lý, lọc theo trạng thái + phân trang (mirror dealer-admin). */
  async listPayouts(status: string | undefined, page: number, limit: number) {
    if (status && !AffiliateService.PAYOUT_STATUSES.includes(status as PayoutStatus)) {
      throw new BadRequestException('Trạng thái lệnh rút không hợp lệ.');
    }
    const where: Prisma.PayoutWhereInput = status ? { status: status as PayoutStatus } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payout.findMany({ where, orderBy: { requestedAt: 'desc' }, ...skipTake(page, limit) }),
      this.prisma.payout.count({ where }),
    ]);
    const userIds = [...new Set(items.map((p) => p.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true, phone: true, referralCode: true },
        })
      : [];
    const userOf = new Map(users.map((u) => [u.id, u]));
    return paginated(
      items.map((p) => ({ ...p, user: userOf.get(p.userId) ?? null })),
      page,
      limit,
      total,
    );
  }

  /** Duyệt lệnh rút NH: REQUESTED → APPROVED. Chưa chuyển tiền — chỉ xác nhận sẽ xử lý thủ công. */
  async approvePayout(adminId: string, id: string, note?: string) {
    const res = await this.prisma.payout.updateMany({
      where: { id, status: 'REQUESTED' },
      data: {
        status: 'APPROVED',
        reviewedBy: adminId,
        reviewedAt: new Date(),
        ...(note?.trim() ? { adminNote: note.trim() } : {}),
      },
    });
    if (res.count === 0) {
      throw new BadRequestException(
        'Lệnh rút không ở trạng thái "Yêu cầu" hoặc vừa được xử lý bởi người khác — vui lòng tải lại.',
      );
    }
    this.logger.log(`Admin ${adminId} duyệt lệnh rút ${id}.`);
    return this.prisma.payout.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Từ chối lệnh rút NH: REQUESTED → REJECTED (bắt buộc lý do) + HOÀN tiền/commission đã bị khoá.
   * MONEY-CRITICAL: atomic updateMany(status-guard) TRƯỚC, rồi đọc lại + hoàn tiền TRONG CÙNG
   * transaction — count=0 (đã được admin khác xử lý) thì throw ngay, không hoàn gì cả.
   */
  async rejectPayout(adminId: string, id: string, reason: string) {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('Vui lòng nhập lý do từ chối.');

    return this.prisma.$transaction(async (tx) => {
      const marked = await tx.payout.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'REJECTED', reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: why },
      });
      if (marked.count === 0) {
        throw new BadRequestException(
          'Lệnh rút không ở trạng thái "Yêu cầu" hoặc vừa được xử lý bởi người khác — vui lòng tải lại.',
        );
      }
      const payout = await tx.payout.findUniqueOrThrow({ where: { id } });

      const linkedCommissions = await tx.commission.findMany({
        where: { payoutBatchId: id, status: 'PAID' },
        select: { id: true },
      });
      if (linkedCommissions.length > 0) {
        // Nguồn 2 (requestPayout nhánh BANK): trả các commission liên quan về APPROVED, gỡ batch
        // → CTV rút lại được. KHÔNG đụng walletBalance (chưa từng cộng/trừ gì ở đó cho payout này).
        await tx.commission.updateMany({
          where: { id: { in: linkedCommissions.map((c) => c.id) }, payoutBatchId: id, status: 'PAID' },
          data: { status: 'APPROVED', payoutBatchId: null, paidAt: null },
        });
      } else {
        // Nguồn 1 (wallet.service.ts:withdraw): hoàn GROSS đã bị trừ — Payout.amount lưu NET
        // (amount = gross - fee), nên gross = amount + fee (xem wallet.service.ts:withdraw).
        await applyWalletDelta(tx, {
          userId: payout.userId,
          delta: payout.amount + payout.fee,
          type: 'WITHDRAW_REFUND',
          refType: 'PAYOUT',
          refId: payout.id,
          reason: `Hoàn lệnh rút bị từ chối: ${why}`,
        });
      }
      this.logger.log(`Admin ${adminId} từ chối lệnh rút ${id}: ${why}`);
      return tx.payout.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Xác nhận đã chuyển khoản: APPROVED → PAID (ghi mã giao dịch NH / ghi chú). */
  async markPayoutPaid(adminId: string, id: string, opts: { bankRef?: string; note?: string } = {}) {
    const res = await this.prisma.payout.updateMany({
      where: { id, status: 'APPROVED' },
      data: {
        status: 'PAID',
        paidBy: adminId,
        paidAt: new Date(),
        ...(opts.bankRef?.trim() ? { bankRef: opts.bankRef.trim() } : {}),
        ...(opts.note?.trim() ? { adminNote: opts.note.trim() } : {}),
      },
    });
    if (res.count === 0) {
      throw new BadRequestException(
        'Lệnh rút không ở trạng thái "Đã duyệt" hoặc vừa được xử lý bởi người khác — vui lòng tải lại.',
      );
    }
    this.logger.log(`Admin ${adminId} xác nhận đã chuyển khoản lệnh rút ${id}.`);
    const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id } });
    if (this.notifications) {
      try {
        // Payout.amount là số tiền THỰC chuyển (đã trừ phí), đúng con số CTV sẽ thấy trong tài khoản.
        await this.notifications.notify(payout.userId, CTV_NOTIFICATION.PAYOUT_PAID, {
          amount: vnd(payout.amount),
          ref: payout.bankRef ? ` (mã giao dịch ${payout.bankRef})` : '',
        });
      } catch (err) {
        this.logger.error(`Gửi thông báo đã chuyển khoản lệnh rút ${id} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    return payout;
  }
}
