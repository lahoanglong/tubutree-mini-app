import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { DealerRewardClaim, DealerRewardClaimStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import { ApplyDealerDto, DealerOrderDto } from './dto/dealer.dto';
import { reserveAvailableVariationStock } from '../catalog/variation-stock';
import { paginated, skipTake } from '../../common/pagination';

interface BonusTier {
  min: number;
  pct: number;
}

/**
 * Trạng thái đơn đại lý mà đại lý KHÔNG còn tự huỷ được: orders.service.cancel cho huỷ đơn
 * PENDING_PAYMENT/CONFIRMED (đơn đã trả tiền còn được hoàn thẳng về ví). Đơn ở 2 trạng thái đó
 * mà được tính doanh số thì đặt đơn to cuối kỳ → nhận thưởng → tự huỷ là "in" thưởng từ không khí.
 */
const DEALER_SETTLED_STATUSES: readonly string[] = ['PACKED', 'SHIPPING', 'DELIVERED'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nhãn tiếng Việt cho trạng thái yêu cầu nhận thưởng (message trả về đại lý/admin). */
const CLAIM_STATUS_LABEL: Record<DealerRewardClaimStatus, string> = {
  PENDING: 'Đang chờ duyệt',
  APPROVED: 'Đã duyệt, chờ trao thưởng',
  REJECTED: 'Bị từ chối',
  PAID: 'Đã trao thưởng',
};

const CLAIM_STATUSES = Object.keys(CLAIM_STATUS_LABEL) as DealerRewardClaimStatus[];

/** Doanh số đại lý trong 1 khung thời gian: phần ĐÃ CHỐT (tính thưởng) + phần còn chờ. */
interface DealerVolume {
  settled: number;
  settledCount: number;
  pending: number;
  pendingCount: number;
}

/** 1 kỳ thưởng (quý/năm, giờ VN): khoá lưu DB + nhãn hiển thị + mốc UTC [start, end). */
interface RewardPeriod {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

/** Tính phần thưởng cho 1 mức doanh số theo bậc (thuần). */
function bonusForRevenue(revenue: number, sortedTiers: BonusTier[]) {
  const reached = [...sortedTiers].reverse().find((t) => revenue >= t.min) ?? null;
  const next = sortedTiers.find((t) => revenue < t.min) ?? null;
  const bonusPct = reached?.pct ?? 0;
  return { bonusPct, bonusAmount: Math.round((revenue * bonusPct) / 100), reached, next };
}

/**
 * Đại lý B2B (Build Spec §6.x, §15 dealer.*).
 * Giá đại lý = giá lẻ × (1 - chiết khấu bậc), kẹp theo dealer.max_discount_pct.
 * Đơn B2B có thể ghi công nợ (DealerCreditLedger).
 */
@Injectable()
export class DealerService {
  private readonly logger = new Logger(DealerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Optional() private readonly notifications?: NotificationsService,
    // @Optional theo đúng kiểu `notifications` ở trên (18 chỗ test dựng service trực tiếp).
    // Thiếu wiring thì log cảnh báo to, KHÔNG im lặng bỏ qua — chính việc im lặng đã khiến
    // đơn đại lý không bao giờ tới kho mà không ai biết (P1-4).
    @Optional() private readonly pancakeOrder?: PancakeOrderService,
  ) {}

  async apply(userId: string, dto: ApplyDealerDto) {
    const pending = await this.prisma.dealerApplication.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (pending) throw new BadRequestException('Bạn đã có đơn đăng ký đang chờ duyệt.');
    try {
      return await this.prisma.dealerApplication.create({ data: { ...dto, userId } });
    } catch (err) {
      // TOCTOU: findFirst rồi create không transaction — 2 request apply() đồng thời có thể cùng
      // qua check "chưa có đơn PENDING" trước khi request đầu commit. Partial unique index
      // dealer_applications_pending_user_key (userId WHERE status='PENDING') chặn ở DB, request
      // thua ăn P2002 → trả đúng message nghiệp vụ thay vì lộ lỗi DB thô.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Bạn đã có đơn đăng ký đang chờ duyệt.');
      }
      throw err;
    }
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const application = await this.prisma.dealerApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const tier = user.metadata && (user.metadata as { dealerTierId?: string }).dealerTierId
      ? await this.prisma.dealerTier.findUnique({
          where: { id: (user.metadata as { dealerTierId: string }).dealerTierId },
        })
      : null;
    const creditAgg = await this.prisma.dealerCreditLedger.aggregate({
      where: { userId },
      _sum: { delta: true },
    });
    return {
      isDealer: user.role === 'DEALER',
      status: application?.status ?? 'NONE',
      tier: tier ? { id: tier.id, name: tier.name, creditLimit: tier.creditLimit } : null,
      currentDebt: creditAgg._sum.delta ?? 0,
    };
  }

  /** Bảng giá đại lý theo bậc của user. */
  async pricelist(userId: string) {
    const { discountPct, tier } = await this.dealerContext(userId);
    const variations = await this.prisma.variation.findMany({
      where: { isActive: true },
      include: { product: { select: { name: true, brand: true } } },
    });
    return variations.map((v) => {
      const dealerPrice = this.unitPrice(v, tier?.id, discountPct);
      return {
        variationId: v.id,
        sku: v.sku,
        product: v.product.name,
        brand: v.product.brand,
        variation: v.name,
        retailPrice: v.retailPrice,
        dealerPrice,
        discountPct: Math.round(discountPct * 100),
        stock: v.stock,
      };
    });
  }

  async placeOrder(userId: string, dto: DealerOrderDto, idempotencyKey?: string) {
    const { discountPct, tier } = await this.dealerContext(userId);
    // Chuẩn hoá key rỗng/khoảng trắng → undefined (mirror wallet.withdraw / checkout.placeOrder):
    // tránh ghi '' vào Order.idempotencyKey (unique) rồi request tiếp theo cũng '' đụng P2002.
    const key = idempotencyKey?.trim() || undefined;
    // Double-tap/retry cùng key → trả lại đơn đã tạo, KHÔNG tạo đơn/ghi công nợ lần 2.
    if (key) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: key } });
      if (existing && existing.userId === userId) {
        return this.prisma.order.findUniqueOrThrow({ where: { id: existing.id }, include: { items: true } });
      }
      if (existing) throw new BadRequestException('Idempotency-Key đã được sử dụng, vui lòng thử lại.');
    }
    if (dto.items.length === 0) throw new BadRequestException('Đơn trống.');

    const variations = await this.prisma.variation.findMany({
      where: { id: { in: dto.items.map((i) => i.variationId) } },
      include: { product: { select: { name: true, slug: true } } },
    });
    const vmap = new Map(variations.map((v) => [v.id, v]));

    let subtotal = 0;
    // Giá/tổng tiền tính đủ 100% số lượng đặt, KỂ CẢ phần sẽ đặt trước — đại lý trả đúng giá đã
    // chốt lúc đặt, không phải trả thêm khi hàng về (backorderedQty chỉ ảnh hưởng tồn kho).
    const items = dto.items.map((line) => {
      const v = vmap.get(line.variationId);
      if (!v) throw new BadRequestException(`Sản phẩm ${line.variationId} không tồn tại.`);
      const unitPrice = this.unitPrice(v, tier?.id, discountPct);
      const total = unitPrice * line.quantity;
      subtotal += total;
      return {
        variationId: v.id,
        productName: v.product.name,
        productSlug: v.product.slug,
        variationName: v.name,
        unitPrice,
        quantity: line.quantity,
        total,
      };
    });

    const onCredit = dto.paymentMethod === 'CREDIT';
    // Fast-fail thân thiện (không tốn generateCode khi rõ ràng vượt). Check
    // QUYẾT ĐỊNH nằm trong transaction Serializable bên dưới để chống TOCTOU.
    if (onCredit && tier) {
      const pre = await this.prisma.dealerCreditLedger.aggregate({ where: { userId }, _sum: { delta: true } });
      if ((pre._sum.delta ?? 0) + subtotal > tier.creditLimit) {
        throw new BadRequestException('Vượt hạn mức công nợ.');
      }
    }

    const code = await this.generateCode();
    let order: Awaited<ReturnType<typeof this.prisma.order.create>> & { hasBackorder: boolean };
    try {
      order = await this.prisma.$transaction(
        async (tx) => {
          // Kiểm tra hạn mức công nợ TRONG transaction Serializable: 2 đơn CREDIT
          // đồng thời không thể cùng vượt trần (một trong hai sẽ serialization-fail).
          if (onCredit && tier) {
            const agg = await tx.dealerCreditLedger.aggregate({ where: { userId }, _sum: { delta: true } });
            const debt = agg._sum.delta ?? 0;
            if (debt + subtotal > tier.creditLimit) throw new BadRequestException('Vượt hạn mức công nợ.');
          }
          // Giữ chỗ tồn kho như mọi đường tạo đơn khác (checkout, CTV lên đơn hộ, đơn định
          // kỳ) — NHƯNG đại lý được phép đặt trước phần vượt tồn thay vì bị từ chối cả đơn:
          // giữ tối đa có thể, phần còn thiếu ghi vào `backorderedQty` để job đối soát lấp dần
          // khi hàng về (xem DealerBackorderService). Huỷ/trả đơn vẫn phải chỉ hoàn đúng phần
          // ĐÃ giữ (`quantity - backorderedQty`) — xem OrderReversalService.
          let hasBackorder = false;
          const itemsWithBackorder = [];
          for (const line of items) {
            const reserved = await reserveAvailableVariationStock(tx, line.variationId, line.quantity);
            const backorderedQty = line.quantity - reserved;
            if (backorderedQty > 0) hasBackorder = true;
            itemsWithBackorder.push({ ...line, backorderedQty });
          }
          const created = await tx.order.create({
            data: {
              code,
              userId,
              type: 'DEALER',
              status: onCredit ? 'CONFIRMED' : 'PENDING_PAYMENT',
              subtotal,
              discount: 0,
              shippingFee: 0,
              total: subtotal,
              paymentMethod: 'BANK_TRANSFER',
              paymentStatus: 'UNPAID',
              shippingAddress: { note: 'Giao theo hợp đồng đại lý' },
              note: dto.note,
              idempotencyKey: key ?? null,
              items: { create: itemsWithBackorder },
            },
          });
          if (onCredit) {
            await tx.dealerCreditLedger.create({
              data: { userId, delta: subtotal, refType: 'ORDER', refId: created.id, note: `Đơn ${code}` },
            });
          }
          return { ...created, hasBackorder };
        },
        onCredit ? { isolationLevel: 'Serializable' } : undefined,
      );
    } catch (err) {
      // P2034: serialization failure — 2 đơn CREDIT chạm nhau. Báo thử lại thay vì 500.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận xử lý đơn công nợ, vui lòng thử lại.');
      }
      // Race idempotency: 2 request cùng key chạy đồng thời — request thua ăn unique-violation
      // (P2002) trên idempotencyKey. Trả lại đơn mà request thắng đã tạo (mirror checkout.placeOrder).
      if (key && typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: key } });
        if (existing) return this.prisma.order.findUniqueOrThrow({ where: { id: existing.id }, include: { items: true } });
      }
      throw err;
    }
    // Đơn còn thiếu hàng (backorder) KHÔNG được đẩy Pancake ngay — kho vật lý chưa có đủ số
    // lượng để soạn/xuất, đẩy sớm chỉ tạo đơn ảo bên Pancake. DealerBackorderService sẽ tự đẩy
    // khi lấp đủ (xem reconcile()).
    if (order.hasBackorder) {
      this.logger.warn(
        `Đơn đại lý ${order.id} có hàng đặt trước — chưa đẩy Pancake, chờ đối soát tồn kho.`,
      );
    } else if (this.pancakeOrder) {
      // Đẩy sang Pancake như mọi đường tạo đơn khác — thiếu bước này thì kho vật lý KHÔNG BAO
      // GIỜ thấy đơn đại lý, không webhook nào khớp được (P1-4,
      // docs/2026-09-08-review-progress.md). Non-fatal: đơn + ghi công nợ đã commit xong, lỗi
      // xếp hàng không được lật ngược chúng; cron reconcile của Pancake quét lại sau.
      await this.pancakeOrder
        .enqueuePush(order.id)
        .catch((err) =>
          this.logger.error(`Xếp hàng đẩy Pancake lỗi cho đơn đại lý ${order.id}: ${err instanceof Error ? err.message : err}`),
        );
    } else {
      this.logger.warn(`PancakeOrderService chưa wiring — đơn đại lý ${order.id} KHÔNG được đẩy sang kho.`);
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  }

  listOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId, type: 'DEALER' },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
      take: 100,
    });
  }

  async creditLedger(userId: string) {
    const entries = await this.prisma.dealerCreditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const balance = entries.reduce((s, e) => s + e.delta, 0);
    return { balance, entries };
  }

  /**
   * Đại lý tự báo "đã chuyển khoản" để trừ công nợ — KHÔNG có xác nhận ngân hàng thật, nên
   * double-submit/retry mạng (mất kết nối giữa lúc chờ response, double-tap nút) trước đây có
   * thể trừ nợ 2 LẦN cho đúng 1 lần chuyển khoản thật. Idempotency-Key bắt buộc từ FE (mirror
   * wallet.withdraw/convertToXu): dedupe theo (userId, refType='PAYMENT', refId=key) — unique
   * constraint đã sẵn có ở schema (migration 20260902020200_dealer_credit_ledger_ref_unique,
   * @@unique([userId, refType, refId])); NULL không tự đụng nên client cũ không gửi key (hoặc
   * gọi service trực tiếp không qua HTTP, xem test) vẫn tạo dòng PAYMENT bình thường như trước.
   * Key trùng nhưng SỐ TIỀN khác → throw rõ ràng thay vì âm thầm trả kết quả cũ (có thể che giấu
   * nhầm lẫn số tiền báo); giống số tiền → coi là replay, trả lại sổ công nợ hiện tại.
   */
  async creditPayment(userId: string, amount: number, note?: string, idempotencyKey?: string) {
    // Chặn nếu chưa phải đại lý (mirror mọi method công nợ/đơn hàng khác) — thiếu check này
    // trước đây cho phép BẤT KỲ user đã đăng nhập nào tự ghi "đã thanh toán" (delta âm) vào
    // DealerCreditLedger của chính mình, tạo công nợ ảo âm nếu sau này họ được duyệt làm đại lý.
    await this.dealerContext(userId);
    if (amount <= 0) throw new BadRequestException('Số tiền không hợp lệ.');
    // Chuẩn hoá '' / khoảng trắng → undefined (mirror wallet.withdraw/convertToXu, dealer.placeOrder).
    const key = idempotencyKey?.trim() || undefined;

    if (key) {
      const existing = await this.prisma.dealerCreditLedger.findFirst({
        where: { userId, refType: 'PAYMENT', refId: key },
      });
      if (existing) {
        if (existing.delta !== -amount) {
          throw new BadRequestException('Idempotency-Key đã được sử dụng với số tiền khác, vui lòng thử lại.');
        }
        return this.creditLedger(userId);
      }
    }

    try {
      await this.prisma.dealerCreditLedger.create({
        data: {
          userId,
          delta: -amount,
          refType: 'PAYMENT',
          note: note ?? 'Thanh toán công nợ',
          ...(key ? { refId: key } : {}),
        },
      });
    } catch (err) {
      // Race 2 request cùng key: kẻ thua ăn P2002 trên unique (userId,refType,refId) → coi như
      // replay của cùng 1 lần báo, trả kết quả hiện tại thay vì lỗi 500 (mirror
      // wallet.withdraw/convertToXu/payoutQuarterlyBonuses).
      if (key && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.creditLedger(userId);
      }
      throw err;
    }
    return this.creditLedger(userId);
  }

  /** Chênh lệch giờ VN (UTC+7) so với UTC — mốc quý/năm tính theo giờ tường VN, độc lập TZ máy chủ. */
  private static readonly VN_OFFSET = 7 * 60 * 60 * 1000;

  /** Mốc UTC [start, end) của quý `q` (0..3) năm `year`, theo giờ VN. */
  private static vnQuarterRange(year: number, q: number) {
    const VN = DealerService.VN_OFFSET;
    return {
      start: new Date(Date.UTC(year, q * 3, 1) - VN),
      end: new Date(Date.UTC(year, q * 3 + 3, 1) - VN),
    };
  }

  /** Kỳ thưởng quý `q` (0..3) — khoá 'Q3/2026' giống refId QUARTER_BONUS của thưởng quý. */
  private static quarterPeriod(year: number, q: number): RewardPeriod {
    const { start, end } = DealerService.vnQuarterRange(year, q);
    return { key: `Q${q + 1}/${year}`, label: `Quý ${q + 1}/${year}`, start, end };
  }

  /** Kỳ thưởng năm — khoá '2026'. */
  private static yearPeriod(year: number): RewardPeriod {
    const VN = DealerService.VN_OFFSET;
    return {
      key: `${year}`,
      label: `Năm ${year}`,
      start: new Date(Date.UTC(year, 0, 1) - VN),
      end: new Date(Date.UTC(year + 1, 0, 1) - VN),
    };
  }

  /**
   * Parse khoá kỳ theo loại kỳ của phần thưởng (DealerReward.period: 'YEAR' → '2026', còn lại
   * coi là quý → 'Q3/2026', đúng quy ước `r.period === 'YEAR'` ở rewardsProgress). Sai → null.
   */
  private static parsePeriodKey(rewardPeriod: string, key: string): RewardPeriod | null {
    if (rewardPeriod === 'YEAR') {
      const m = /^(\d{4})$/.exec(key);
      return m ? DealerService.yearPeriod(Number(m[1])) : null;
    }
    const m = /^Q([1-4])\/(\d{4})$/.exec(key);
    return m ? DealerService.quarterPeriod(Number(m[2]), Number(m[1]) - 1) : null;
  }

  /** Ngày cuối cùng (giờ VN) còn hiệu lực của hạn chót `deadline` (mốc loại trừ) — dd/mm/yyyy. */
  private static vnLastDayLabel(deadline: Date): string {
    const d = new Date(deadline.getTime() - 1 + DealerService.VN_OFFSET);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  /**
   * Quý/năm HIỆN TẠI theo giờ VN + mốc UTC [start,end) của quý và của năm.
   * Dùng chung cho quarterlyReport / rewardsProgress / payoutQuarterlyBonuses (tránh lệch mốc).
   */
  private vnPeriodBounds(now: Date) {
    const VN = DealerService.VN_OFFSET;
    const vnNow = new Date(now.getTime() + VN); // giờ tường VN, đọc qua các field UTC*
    const q = Math.floor(vnNow.getUTCMonth() / 3); // 0..3
    const year = vnNow.getUTCFullYear();
    const quarter = DealerService.vnQuarterRange(year, q);
    return {
      q,
      year,
      qStart: quarter.start,
      qEnd: quarter.end,
      yStart: new Date(Date.UTC(year, 0, 1) - VN),
      yEnd: new Date(Date.UTC(year + 1, 0, 1) - VN),
    };
  }

  /** Kỳ quý/năm hiện tại + kỳ liền trước (để còn yêu cầu nhận thưởng trong thời gian gia hạn). */
  private rewardPeriods(now: Date) {
    const { q, year } = this.vnPeriodBounds(now);
    return {
      curQuarter: DealerService.quarterPeriod(year, q),
      curYear: DealerService.yearPeriod(year),
      prevQuarter: q === 0 ? DealerService.quarterPeriod(year - 1, 3) : DealerService.quarterPeriod(year, q - 1),
      prevYear: DealerService.yearPeriod(year - 1),
    };
  }

  /**
   * Doanh số đại lý trong [start, end) — nền DUY NHẤT cho báo cáo quý, thưởng quý (tiền thật
   * vào công nợ) và mốc thưởng tour/quà. Một đơn chỉ được tính ("đã chốt") khi:
   *  1. KHÔNG còn tự huỷ được (PACKED/SHIPPING/DELIVERED — xem DEALER_SETTLED_STATUSES), và
   *  2. đã có cam kết tiền: đã thanh toán (paymentStatus=PAID) hoặc là đơn "Ghi công nợ" (có
   *     dòng DealerCreditLedger refType=ORDER — đơn CREDIT không bao giờ lật PAID).
   * Trước đây tính MỌI đơn trừ CANCELLED/RETURNED: đặt đơn chuyển khoản 200tr cuối quý rồi không
   * trả → cron cộng thưởng quý 4% vào công nợ → đại lý tự huỷ đơn, thưởng vẫn giữ nguyên.
   * Đơn chưa đủ điều kiện (chưa trả/chưa đóng gói) cộng vào `pending` để hiển thị, KHÔNG tính thưởng.
   * `db` = transaction của caller khi cần thấy chính thay đổi chưa commit (thu hồi thưởng lúc
   * huỷ/trả đơn — xem clawbackQuarterBonusForOrder); mặc định đọc ngoài transaction.
   */
  private async dealerVolume(
    userId: string,
    start: Date,
    end: Date,
    db: Pick<Prisma.TransactionClient, 'order' | 'dealerCreditLedger'> = this.prisma,
  ): Promise<DealerVolume> {
    const orders = await db.order.findMany({
      where: {
        userId,
        type: 'DEALER',
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        createdAt: { gte: start, lt: end },
      },
      select: { id: true, total: true, status: true, paymentStatus: true },
    });
    const isSettledStatus = (s: string) => DEALER_SETTLED_STATUSES.includes(s);
    const unpaidSettledIds = orders
      .filter((o) => isSettledStatus(o.status) && o.paymentStatus === 'UNPAID')
      .map((o) => o.id);
    const creditOrderIds = new Set<string>();
    if (unpaidSettledIds.length > 0) {
      const debits = await db.dealerCreditLedger.findMany({
        where: { userId, refType: 'ORDER', refId: { in: unpaidSettledIds } },
        select: { refId: true },
      });
      for (const d of debits) if (d.refId) creditOrderIds.add(d.refId);
    }
    const v: DealerVolume = { settled: 0, settledCount: 0, pending: 0, pendingCount: 0 };
    for (const o of orders) {
      // Đã hoàn tiền/thanh toán lỗi thì không còn là doanh số — bỏ khỏi cả 2 phía.
      if (o.paymentStatus === 'REFUNDED' || o.paymentStatus === 'FAILED') continue;
      if (isSettledStatus(o.status) && (o.paymentStatus === 'PAID' || creditOrderIds.has(o.id))) {
        v.settled += o.total;
        v.settledCount += 1;
      } else {
        v.pending += o.total;
        v.pendingCount += 1;
      }
    }
    return v;
  }

  /** Số ngày sau khi kỳ kết thúc vẫn được gửi yêu cầu nhận thưởng (config, mặc định 30, kẹp 0..366). */
  private async claimGraceDays(): Promise<number> {
    const raw = Number(await this.config.get<number>('dealer.reward_claim_grace_days', 30));
    return Number.isFinite(raw) && raw >= 0 ? Math.min(Math.floor(raw), 366) : 30;
  }

  /**
   * Báo cáo quý đại lý (#71): doanh số ĐÃ CHỐT của quý hiện tại (xem dealerVolume) + bậc thưởng
   * đạt được — cùng công thức với cron trả thưởng, nên con số đại lý thấy khớp số được trả.
   * Bậc thưởng lấy từ config dealer.quarterly_bonus_tiers (mặc định 50tr→2%, 100tr→3%, 200tr→4%).
   */
  async quarterlyReport(userId: string, now: Date = new Date()) {
    await this.dealerContext(userId); // chặn nếu chưa phải đại lý
    const { q, year, qStart: start, qEnd: end } = this.vnPeriodBounds(now);

    const vol = await this.dealerVolume(userId, start, end);
    const revenue = vol.settled;

    const sorted = await this.bonusTiers();
    const { bonusPct, bonusAmount, next } = bonusForRevenue(revenue, sorted);

    return {
      quarter: `Q${q + 1}/${year}`,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      revenue,
      orderCount: vol.settledCount,
      // Đơn trong quý chưa thanh toán / chưa đóng gói — CHƯA tính thưởng, hiển thị để đại lý biết.
      pendingRevenue: vol.pending,
      pendingOrderCount: vol.pendingCount,
      bonusPct,
      bonusAmount,
      nextTier: next ? { min: next.min, pct: next.pct, toNext: next.min - revenue } : null,
      tiers: sorted,
    };
  }

  /**
   * Tiến trình đạt mốc DealerReward: doanh số ĐÃ CHỐT của kỳ (quý/năm theo giờ VN) so với điều
   * kiện từng phần thưởng + trạng thái yêu cầu nhận thưởng (claimStatus) của kỳ đó.
   * Ngoài kỳ hiện tại, trả thêm dòng của kỳ LIỀN TRƯỚC khi (a) đã đạt và còn trong thời gian gia
   * hạn `dealer.reward_claim_grace_days` — để đại lý đạt mốc sát cuối quý vẫn yêu cầu được sau
   * khi sang quý mới — hoặc (b) đã có yêu cầu (để còn thấy trạng thái duyệt/trao).
   * `now` truyền vào để test tất định.
   */
  async rewardsProgress(userId: string, now: Date = new Date()) {
    await this.dealerContext(userId); // chặn nếu chưa phải đại lý
    const graceDays = await this.claimGraceDays();
    const graceMs = graceDays * DAY_MS;
    const p = this.rewardPeriods(now);

    const rewards = await this.prisma.dealerReward.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }],
    });
    const hasQuarterRewards = rewards.some((r) => r.period !== 'YEAR');
    const hasYearRewards = rewards.some((r) => r.period === 'YEAR');
    const EMPTY: DealerVolume = { settled: 0, settledCount: 0, pending: 0, pendingCount: 0 };
    const [curQ, curY, prevQ, prevY] = await Promise.all([
      this.dealerVolume(userId, p.curQuarter.start, p.curQuarter.end),
      this.dealerVolume(userId, p.curYear.start, p.curYear.end),
      hasQuarterRewards ? this.dealerVolume(userId, p.prevQuarter.start, p.prevQuarter.end) : EMPTY,
      hasYearRewards ? this.dealerVolume(userId, p.prevYear.start, p.prevYear.end) : EMPTY,
    ]);

    const claims = rewards.length
      ? await this.prisma.dealerRewardClaim.findMany({
          where: {
            userId,
            periodKey: { in: [p.curQuarter.key, p.curYear.key, p.prevQuarter.key, p.prevYear.key] },
          },
        })
      : [];
    const claimOf = new Map(claims.map((c) => [`${c.rewardId}|${c.periodKey}`, c]));

    type Reward = (typeof rewards)[number];
    const row = (r: Reward, period: RewardPeriod, vol: DealerVolume, isCurrentPeriod: boolean) => {
      const claim = claimOf.get(`${r.id}|${period.key}`) ?? null;
      const achieved = vol.settled >= r.threshold;
      const deadline = new Date(period.end.getTime() + graceMs);
      return {
        id: r.id,
        type: r.type,
        title: r.title,
        description: r.description,
        threshold: r.threshold,
        period: r.period,
        periodKey: period.key,
        periodLabel: period.label,
        isCurrentPeriod,
        volume: vol.settled,
        pendingVolume: vol.pending,
        achieved,
        toGo: Math.max(0, r.threshold - vol.settled),
        claimStatus: claim?.status ?? null,
        claimId: claim?.id ?? null,
        rejectionReason: claim?.rejectionReason ?? null,
        claimDeadline: deadline.toISOString(),
        canClaim: achieved && !claim && now.getTime() < deadline.getTime(),
      };
    };

    const current = rewards.map((r) =>
      r.period === 'YEAR' ? row(r, p.curYear, curY, true) : row(r, p.curQuarter, curQ, true),
    );
    const previous = rewards
      .map((r) => (r.period === 'YEAR' ? row(r, p.prevYear, prevY, false) : row(r, p.prevQuarter, prevQ, false)))
      .filter((x) => x.claimStatus !== null || x.canClaim);

    return {
      quarter: p.curQuarter.key,
      year: Number(p.curYear.key),
      quarterVolume: curQ.settled,
      yearVolume: curY.settled,
      quarterPendingVolume: curQ.pending,
      yearPendingVolume: curY.pending,
      claimGraceDays: graceDays,
      rewards: [...current, ...previous],
    };
  }

  /**
   * Đại lý gửi yêu cầu nhận thưởng mốc (tour/quà) cho 1 kỳ. Lưu DealerRewardClaim PENDING và báo
   * admin; admin duyệt/từ chối rồi xác nhận đã trao (approve/reject/markRewardClaimPaid).
   *  - `periodKey` bỏ trống = kỳ hiện tại của phần thưởng; cho phép kỳ liền trước trong thời gian
   *    gia hạn (dealer.reward_claim_grace_days).
   *  - Idempotent: unique (userId, periodKey, rewardId) — bấm lại/2 request đồng thời chỉ tạo đúng
   *    1 yêu cầu, lần sau trả lại yêu cầu cũ (alreadyClaimed) thay vì báo "đã ghi nhận" giả.
   *  - Chỉ tính doanh số ĐÃ CHỐT (dealerVolume) — đơn chưa trả/còn tự huỷ được không đủ điều kiện.
   */
  async claimReward(
    userId: string,
    rewardId: string,
    opts: { periodKey?: string; note?: string } = {},
    now: Date = new Date(),
  ) {
    await this.dealerContext(userId);
    const reward = await this.prisma.dealerReward.findUnique({ where: { id: rewardId } });
    if (!reward || !reward.isActive) {
      throw new NotFoundException('Phần thưởng đại lý không tồn tại hoặc đã ngừng áp dụng.');
    }

    const cur = this.rewardPeriods(now);
    const periodKey = opts.periodKey?.trim();
    const period = periodKey
      ? DealerService.parsePeriodKey(reward.period, periodKey)
      : reward.period === 'YEAR'
        ? cur.curYear
        : cur.curQuarter;
    if (!period) throw new BadRequestException('Kỳ thưởng không hợp lệ cho phần thưởng này.');
    if (now.getTime() < period.start.getTime()) {
      throw new BadRequestException(`${period.label} chưa bắt đầu.`);
    }

    // Đã gửi rồi → trả lại yêu cầu cũ (kể cả khi đã quá hạn gia hạn) — không tạo trùng, không báo admin lại.
    const existing = await this.prisma.dealerRewardClaim.findFirst({
      where: { userId, rewardId: reward.id, periodKey: period.key },
    });
    if (existing) return this.claimResponse(existing, period, true);

    const graceDays = await this.claimGraceDays();
    const deadline = new Date(period.end.getTime() + graceDays * DAY_MS);
    if (now.getTime() >= deadline.getTime()) {
      throw new BadRequestException(
        `Đã hết hạn gửi yêu cầu nhận thưởng ${period.label} (hạn chót ${DealerService.vnLastDayLabel(deadline)}).`,
      );
    }

    const vol = await this.dealerVolume(userId, period.start, period.end);
    if (vol.settled < reward.threshold) {
      throw new BadRequestException(
        `Doanh số đã chốt ${period.label} của bạn (${vnd(vol.settled)}) chưa đạt mốc nhận thưởng (${vnd(reward.threshold)}).` +
          (vol.pending > 0
            ? ` Còn ${vnd(vol.pending)} từ đơn chưa thanh toán hoặc chưa đóng gói — chỉ được tính khi đơn đã thanh toán/ghi công nợ và đã đóng gói.`
            : ''),
      );
    }

    let claim: DealerRewardClaim;
    try {
      claim = await this.prisma.dealerRewardClaim.create({
        data: {
          userId,
          rewardId: reward.id,
          periodKey: period.key,
          rewardTitle: reward.title,
          rewardType: reward.type,
          rewardPeriod: reward.period,
          threshold: reward.threshold,
          volumeAtClaim: vol.settled,
          note: opts.note?.trim() || null,
        },
      });
    } catch (err) {
      // Race 2 request cùng lúc cùng qua pre-check: unique (userId, periodKey, rewardId) chặn ở DB,
      // request thua ăn P2002 → trả yêu cầu của request thắng (mirror apply/creditPayment).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const won = await this.prisma.dealerRewardClaim.findFirst({
          where: { userId, rewardId: reward.id, periodKey: period.key },
        });
        if (won) return this.claimResponse(won, period, true);
      }
      throw err;
    }

    this.logger.log(
      `Đại lý ${userId} yêu cầu nhận thưởng "${reward.title}" ${period.label} (doanh số đã chốt ${vnd(vol.settled)}) — claim ${claim.id}.`,
    );
    // Non-fatal: yêu cầu đã lưu, admin vẫn thấy ở danh sách chờ duyệt dù gửi thông báo lỗi.
    await this.notifyAdminsOfClaim(claim, period).catch((e) =>
      this.logger.warn(`Báo admin yêu cầu nhận thưởng ${claim.id} lỗi: ${(e as Error).message}`),
    );
    return this.claimResponse(claim, period, false);
  }

  private claimResponse(claim: DealerRewardClaim, period: RewardPeriod, alreadyClaimed: boolean) {
    return {
      success: true,
      alreadyClaimed,
      claimStatus: claim.status,
      message: alreadyClaimed
        ? `Bạn đã gửi yêu cầu nhận "${claim.rewardTitle}" (${period.label}) trước đó — trạng thái: ${CLAIM_STATUS_LABEL[claim.status]}.`
        : `Đã gửi yêu cầu nhận "${claim.rewardTitle}" (${period.label}). Tubu Tree sẽ xét duyệt và báo kết quả trong mục Thông báo của app.`,
      claim: {
        id: claim.id,
        status: claim.status,
        periodKey: claim.periodKey,
        volumeAtClaim: claim.volumeAtClaim,
        createdAt: claim.createdAt,
      },
      reward: { id: claim.rewardId, title: claim.rewardTitle, type: claim.rewardType, threshold: claim.threshold },
      periodKey: period.key,
      periodLabel: period.label,
      currentVolume: claim.volumeAtClaim,
    };
  }

  /** Báo mọi tài khoản ADMIN (thông báo in-app/ZNS theo template DEALER_REWARD_CLAIM_NEW). */
  private async notifyAdminsOfClaim(claim: DealerRewardClaim, period: RewardPeriod) {
    if (!this.notifications) {
      this.logger.warn(`NotificationsService chưa wiring — không báo được admin về yêu cầu nhận thưởng ${claim.id}.`);
      return;
    }
    const [admins, dealer] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'ADMIN', isBlocked: false }, select: { id: true }, take: 20 }),
      this.prisma.user.findUnique({ where: { id: claim.userId }, select: { fullName: true, phone: true } }),
    ]);
    if (admins.length === 0) {
      this.logger.warn(`Không có tài khoản ADMIN nào để báo yêu cầu nhận thưởng ${claim.id}.`);
      return;
    }
    const data = {
      dealer: dealer?.fullName || dealer?.phone || claim.userId,
      reward: claim.rewardTitle,
      period: period.label,
      volume: claim.volumeAtClaim.toLocaleString('vi-VN'),
    };
    const results = await Promise.allSettled(
      admins.map((a) => this.notifications!.notify(a.id, 'DEALER_REWARD_CLAIM_NEW', data)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) this.logger.warn(`Báo admin yêu cầu nhận thưởng ${claim.id}: lỗi ${failed}/${admins.length}.`);
  }

  // ── Admin: xử lý yêu cầu nhận thưởng mốc đại lý ──

  /** Danh sách yêu cầu nhận thưởng (mới nhất trước), lọc theo trạng thái, kèm thông tin đại lý. */
  async listRewardClaims(status: string | undefined, page: number, limit: number) {
    if (status && !CLAIM_STATUSES.includes(status as DealerRewardClaimStatus)) {
      throw new BadRequestException('Trạng thái yêu cầu không hợp lệ.');
    }
    const where: Prisma.DealerRewardClaimWhereInput = status ? { status: status as DealerRewardClaimStatus } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dealerRewardClaim.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(page, limit) }),
      this.prisma.dealerRewardClaim.count({ where }),
    ]);
    const userIds = [...new Set(items.map((c) => c.userId))];
    const [users, apps] = userIds.length
      ? await Promise.all([
          this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, phone: true } }),
          this.prisma.dealerApplication.findMany({
            where: { userId: { in: userIds }, status: 'APPROVED' },
            orderBy: { createdAt: 'desc' },
            select: { userId: true, businessName: true },
          }),
        ])
      : [[], []];
    const userOf = new Map(users.map((u) => [u.id, u]));
    const bizOf = new Map<string, string>();
    for (const a of apps) if (!bizOf.has(a.userId)) bizOf.set(a.userId, a.businessName);
    return paginated(
      items.map((c) => ({
        ...c,
        dealer: {
          id: c.userId,
          fullName: userOf.get(c.userId)?.fullName ?? null,
          phone: userOf.get(c.userId)?.phone ?? null,
          businessName: bizOf.get(c.userId) ?? null,
        },
      })),
      page,
      limit,
      total,
    );
  }

  /**
   * Duyệt yêu cầu PENDING → APPROVED. Kiểm lại doanh số ĐÃ CHỐT của kỳ ngay lúc duyệt: đơn có thể
   * bị huỷ/trả SAU khi đại lý gửi yêu cầu — tụt dưới mốc thì chặn duyệt (admin từ chối kèm lý do).
   * Chuyển trạng thái bằng updateMany có guard status → 2 admin bấm cùng lúc chỉ 1 người thắng.
   */
  async approveRewardClaim(adminId: string, id: string, note?: string) {
    const claim = await this.prisma.dealerRewardClaim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Không tìm thấy yêu cầu nhận thưởng.');
    if (claim.status !== 'PENDING') {
      throw new BadRequestException(`Yêu cầu đang ở trạng thái "${CLAIM_STATUS_LABEL[claim.status]}" — không thể duyệt.`);
    }
    const period = DealerService.parsePeriodKey(claim.rewardPeriod, claim.periodKey);
    if (!period) throw new BadRequestException(`Kỳ thưởng "${claim.periodKey}" không hợp lệ.`);
    const vol = await this.dealerVolume(claim.userId, period.start, period.end);
    if (vol.settled < claim.threshold) {
      throw new BadRequestException(
        `Doanh số đã chốt ${period.label} của đại lý hiện chỉ còn ${vnd(vol.settled)} (mốc ${vnd(claim.threshold)}; lúc yêu cầu ${vnd(claim.volumeAtClaim)}) — có đơn đã huỷ/trả sau khi gửi yêu cầu. Hãy kiểm tra lại hoặc từ chối kèm lý do.`,
      );
    }
    const res = await this.prisma.dealerRewardClaim.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date(), ...(note?.trim() ? { adminNote: note.trim() } : {}) },
    });
    if (res.count === 0) throw new BadRequestException('Yêu cầu vừa được xử lý bởi người khác — vui lòng tải lại.');
    this.logger.log(`Admin ${adminId} duyệt yêu cầu nhận thưởng ${id} (${claim.rewardTitle} ${period.label}).`);
    await this.notifyDealerOfClaim(claim, period, 'DEALER_REWARD_CLAIM_APPROVED');
    return this.prisma.dealerRewardClaim.findUniqueOrThrow({ where: { id } });
  }

  /** Từ chối yêu cầu PENDING → REJECTED (bắt buộc lý do, gửi kèm cho đại lý). Trạng thái cuối. */
  async rejectRewardClaim(adminId: string, id: string, reason: string) {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('Vui lòng nhập lý do từ chối.');
    const res = await this.prisma.dealerRewardClaim.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: why },
    });
    const claim = await this.claimAfterTransition(id, res.count, 'từ chối');
    this.logger.log(`Admin ${adminId} từ chối yêu cầu nhận thưởng ${id}: ${why}`);
    await this.notifyDealerOfClaim(claim, null, 'DEALER_REWARD_CLAIM_REJECTED', { reason: why });
    return claim;
  }

  /** Xác nhận đã trao thưởng: chỉ từ APPROVED → PAID. */
  async markRewardClaimPaid(adminId: string, id: string, note?: string) {
    const res = await this.prisma.dealerRewardClaim.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status: 'PAID', paidBy: adminId, paidAt: new Date(), ...(note?.trim() ? { adminNote: note.trim() } : {}) },
    });
    const claim = await this.claimAfterTransition(id, res.count, 'đánh dấu đã trao');
    this.logger.log(`Admin ${adminId} xác nhận đã trao thưởng ${id} (${claim.rewardTitle}).`);
    await this.notifyDealerOfClaim(claim, null, 'DEALER_REWARD_CLAIM_PAID');
    return claim;
  }

  /** Sau updateMany có guard: count=0 → 404 nếu không có, 400 nếu sai trạng thái; ngược lại trả bản mới. */
  private async claimAfterTransition(id: string, count: number, action: string) {
    const claim = await this.prisma.dealerRewardClaim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Không tìm thấy yêu cầu nhận thưởng.');
    if (count === 0) {
      throw new BadRequestException(`Yêu cầu đang ở trạng thái "${CLAIM_STATUS_LABEL[claim.status]}" — không thể ${action}.`);
    }
    return claim;
  }

  /** Báo đại lý kết quả xử lý yêu cầu (non-fatal: trạng thái đã commit, lỗi gửi chỉ log). */
  private async notifyDealerOfClaim(
    claim: DealerRewardClaim,
    period: RewardPeriod | null,
    code: 'DEALER_REWARD_CLAIM_APPROVED' | 'DEALER_REWARD_CLAIM_REJECTED' | 'DEALER_REWARD_CLAIM_PAID',
    extra: Record<string, string> = {},
  ) {
    if (!this.notifications) return;
    const label = period?.label ?? DealerService.parsePeriodKey(claim.rewardPeriod, claim.periodKey)?.label ?? claim.periodKey;
    await this.notifications
      .notify(claim.userId, code, { reward: claim.rewardTitle, period: label, ...extra })
      .catch((e) => this.logger.warn(`notify ${code} lỗi (${claim.userId}): ${(e as Error).message}`));
  }

  private async bonusTiers(): Promise<BonusTier[]> {
    const tiers = await this.config.get<BonusTier[]>('dealer.quarterly_bonus_tiers', [
      { min: 50_000_000, pct: 2 },
      { min: 100_000_000, pct: 3 },
      { min: 200_000_000, pct: 4 },
    ]);
    return [...tiers].sort((a, b) => a.min - b.min);
  }

  /**
   * Cron (ngày 10 tháng đầu mỗi quý — xem DealerCron): trả thưởng doanh số cho quý VỪA KẾT THÚC
   * cho mọi đại lý, CHỈ trên doanh số đã chốt (dealerVolume). Chạy trễ vài ngày để đơn đặt cuối
   * quý kịp thanh toán/đóng gói và được tính (tính theo ngày TẠO đơn, nên vẫn thuộc quý cũ).
   * Thưởng ghi vào DealerCreditLedger delta ÂM (giảm công nợ) — nhất quán với creditPayment.
   * Idempotent theo (userId, refType=QUARTER_BONUS, refId=quý) → cron chạy lại không cộng trùng.
   */
  async payoutQuarterlyBonuses(now: Date = new Date()): Promise<{ paid: number; quarter: string }> {
    const cur = this.vnPeriodBounds(now);
    let q = cur.q - 1; // quý TRƯỚC (vừa kết thúc)
    let year = cur.year;
    if (q < 0) {
      q = 3;
      year -= 1;
    }
    const { start, end } = DealerService.vnQuarterRange(year, q);
    const quarter = `Q${q + 1}/${year}`;

    const sorted = await this.bonusTiers();
    const dealers = await this.prisma.user.findMany({ where: { role: 'DEALER' }, select: { id: true } });

    let paid = 0;
    for (const d of dealers) {
      // CHỈ doanh số đã chốt (đã thanh toán/ghi công nợ + không còn tự huỷ được) — xem dealerVolume.
      const revenue = (await this.dealerVolume(d.id, start, end)).settled;
      const { bonusAmount } = bonusForRevenue(revenue, sorted);
      if (bonusAmount <= 0) continue;

      // Idempotent (pre-check, KHÔNG atomic — vẫn còn race nếu 2 lượt chạy cron/manual chồng
      // nhau đúng lúc): đã trả thưởng quý này cho đại lý này thì bỏ qua, tránh 1 lần create() thừa
      // ở đường thường. Bảo vệ THẬT SỰ nằm ở unique (userId,refType,refId) + catch P2002 bên dưới.
      const existed = await this.prisma.dealerCreditLedger.findFirst({
        where: { userId: d.id, refType: 'QUARTER_BONUS', refId: quarter },
        select: { id: true },
      });
      if (existed) continue;

      try {
        await this.prisma.dealerCreditLedger.create({
          data: { userId: d.id, delta: -bonusAmount, refType: 'QUARTER_BONUS', refId: quarter, note: `Thưởng doanh số ${quarter}` },
        });
      } catch (err) {
        // findFirst rồi create không transaction — 2 lần chạy cron/manual chồng nhau (double-pay)
        // có thể cùng qua check "chưa trả thưởng" ở trên. Unique(userId,refType,refId) chặn ở DB,
        // lượt thua ăn P2002 → coi như ĐÃ trả thưởng (bỏ qua dealer này, KHÔNG throw để không chặn
        // các dealer còn lại trong cùng lượt chạy).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue;
        }
        throw err;
      }
      if (this.notifications) {
        await this.notifications
          .notify(d.id, 'DEALER_BONUS_PAID', {
            quarter,
            amount: bonusAmount.toLocaleString('vi-VN'),
            revenue: revenue.toLocaleString('vi-VN'),
          })
          .catch((e) => this.logger.warn(`notify thưởng quý lỗi (${d.id}): ${(e as Error).message}`));
      }
      paid += 1;
    }
    if (paid > 0) this.logger.log(`Đã trả thưởng quý ${quarter} cho ${paid} đại lý.`);
    return { paid, quarter };
  }

  /**
   * Thu hồi thưởng doanh số quý khi 1 đơn đại lý bị huỷ/trả SAU khi quý của đơn (theo createdAt,
   * giờ VN — đúng cách payoutQuarterlyBonuses gom đơn) đã được trả thưởng. Không có bước này thì
   * đặt đơn to cuối quý (trả tiền + đóng gói) → nhận thưởng ngày 10 → trả hàng/hoàn tiền là giữ
   * nguyên phần thưởng tính trên chính đơn đó.
   *
   * Tính lại thưởng quý từ doanh số ĐÃ CHỐT hiện tại (dealerVolume, đọc qua `tx` nên thấy đơn vừa
   * lật CANCELLED/RETURNED/REFUNDED) bằng CÙNG bậc/công thức với payout (bonusTiers +
   * bonusForRevenue). Thưởng còn giữ = dòng QUARTER_BONUS + mọi dòng QUARTER_BONUS_ADJ của quý đó;
   * nếu thưởng tính lại THẤP hơn → ghi 1 dòng QUARTER_BONUS_ADJ delta DƯƠNG (tăng lại công nợ —
   * ngược dấu đúng cách payout đã ghi delta âm; thưởng chỉ đi vào sổ công nợ, không qua ví nào khác).
   * Không bao giờ điều chỉnh tăng: thiếu thưởng do đơn chốt muộn không được tự bù ở đây.
   *
   * BẮT BUỘC gọi trong transaction của lần lật trạng thái (OrderReversalService.reverseFinancials):
   *  - khoá dòng QUARTER_BONUS (FOR UPDATE) → 2 đơn cùng quý của 1 đại lý huỷ đồng thời phải xếp
   *    hàng; lượt sau đọc lại các dòng ADJ đã commit nên không thu hồi trùng 1 khoản.
   *  - idempotent theo unique (userId, refType, refId=`${quarter}:${orderId}`) qua createMany
   *    skipDuplicates (ON CONFLICT DO NOTHING — KHÔNG ném P2002, vốn làm hỏng cả transaction
   *    Postgres đang dở). Gọi lặp cho cùng đơn còn bị chặn từ trước: thưởng còn giữ đã trừ phần thu hồi.
   */
  async clawbackQuarterBonusForOrder(
    tx: Prisma.TransactionClient,
    order: { id: string; code?: string | null; userId: string; type: string; createdAt: Date },
  ): Promise<{ quarter: string | null; clawedBack: number }> {
    if (order.type !== 'DEALER') return { quarter: null, clawedBack: 0 };
    const { q, year, qStart, qEnd } = this.vnPeriodBounds(new Date(order.createdAt));
    const quarter = `Q${q + 1}/${year}`;

    const bonusRows = await tx.$queryRaw<{ id: string; delta: number }[]>`
      SELECT "id", "delta" FROM "dealer_credit_ledgers"
      WHERE "userId" = ${order.userId} AND "refType" = 'QUARTER_BONUS' AND "refId" = ${quarter}
      FOR UPDATE`;
    const bonusRow = bonusRows[0];
    if (!bonusRow) return { quarter, clawedBack: 0 }; // quý chưa trả thưởng → payout sau tự tính đúng

    const adjustments = await tx.dealerCreditLedger.findMany({
      where: { userId: order.userId, refType: 'QUARTER_BONUS_ADJ', refId: { startsWith: `${quarter}:` } },
      select: { delta: true },
    });
    // Thưởng ghi delta âm, thu hồi ghi delta dương → thưởng còn giữ = -(tổng delta).
    const heldBonus = -(Number(bonusRow.delta) + adjustments.reduce((s, a) => s + a.delta, 0));

    const revenue = (await this.dealerVolume(order.userId, qStart, qEnd, tx)).settled;
    const { bonusAmount } = bonusForRevenue(revenue, await this.bonusTiers());
    const clawback = heldBonus - bonusAmount;
    if (clawback <= 0) return { quarter, clawedBack: 0 };

    const created = await tx.dealerCreditLedger.createMany({
      data: [
        {
          userId: order.userId,
          delta: clawback,
          refType: 'QUARTER_BONUS_ADJ',
          refId: `${quarter}:${order.id}`,
          note: `Điều chỉnh thưởng doanh số ${quarter} (huỷ/trả đơn ${order.code ?? order.id})`,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return { quarter, clawedBack: 0 };
    this.logger.warn(
      `Thu hồi ${vnd(clawback)} thưởng ${quarter} của đại lý ${order.userId} do huỷ/trả đơn ${order.code ?? order.id} ` +
        `(thưởng còn giữ ${vnd(heldBonus)} → ${vnd(bonusAmount)}, doanh số đã chốt ${vnd(revenue)}).`,
    );
    return { quarter, clawedBack: clawback };
  }

  // ── Mẫu đơn lưu sẵn (#64) ──
  async listTemplates(userId: string) {
    await this.dealerContext(userId);
    return this.prisma.dealerOrderTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async saveTemplate(userId: string, name: string, items: { variationId: string; quantity: number }[]) {
    await this.dealerContext(userId);
    const clean = (items ?? [])
      .filter((i) => i?.variationId && Number(i.quantity) > 0)
      .map((i) => ({ variationId: String(i.variationId), quantity: Math.floor(Number(i.quantity)) }));
    if (clean.length === 0) throw new BadRequestException('Mẫu đơn trống.');
    return this.prisma.dealerOrderTemplate.create({
      data: { userId, name: name.trim() || 'Mẫu đơn', items: clean },
    });
  }

  async deleteTemplate(userId: string, id: string) {
    await this.dealerContext(userId);
    // deleteMany theo (id,userId) → chỉ xoá mẫu của chính mình, không lộ mẫu người khác.
    const res = await this.prisma.dealerOrderTemplate.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new BadRequestException('Không tìm thấy mẫu đơn.');
    return { ok: true };
  }

  // ── Helpers ──
  /**
   * Giá đại lý cho 1 variation: ƯU TIÊN giá riêng theo bậc đã nhập (Variation.dealerPrices[tierId]),
   * fallback giá lẻ × (1 - chiết khấu bậc). Cho phép admin đặt giá B2B cố định khác công thức %.
   */
  private unitPrice(
    v: { retailPrice: number; dealerPrices?: unknown },
    tierId: string | undefined,
    discountPct: number,
  ): number {
    const override = tierId ? (v.dealerPrices as Record<string, number> | null)?.[tierId] : undefined;
    if (typeof override === 'number' && override > 0) return override;
    return Math.round(v.retailPrice * (1 - discountPct));
  }

  private async dealerContext(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'DEALER') throw new ForbiddenException('Tài khoản chưa được duyệt làm đại lý.');
    const tierId = (user.metadata as { dealerTierId?: string } | null)?.dealerTierId;
    const tier = tierId ? await this.prisma.dealerTier.findUnique({ where: { id: tierId } }) : null;

    const maxDiscount = await this.config.get<number>('dealer.max_discount_pct', 0.45);
    const rules = (tier?.discountRules as { default?: number } | undefined) ?? {};
    const discountPct = Math.min(rules.default ?? 0.2, maxDiscount);
    return { discountPct, tier };
  }

  private async generateCode(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const code = `DLR${Date.now().toString().slice(-8)}${String(randomInt(0, 1000)).padStart(3, '0')}`;
      const exists = await this.prisma.order.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `DLR${Date.now()}`;
  }
}
