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
import { AnalyticsEventsService } from '../analytics/analytics-events.service';

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
    // @Optional cùng lý do notifications/pancakeOrder ở trên — AnalyticsModule là @Global() nên
    // app thật luôn wiring được.
    @Optional() private readonly analytics?: AnalyticsEventsService,
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
   * A5-09 (docs/audit-2026-09/05-ctv-dealer-staff.md): trước đây đại lý tự bấm "Báo đã CK" là TRỪ
   * NỢ NGAY LẬP TỨC (creditPayment cũ) — KHÔNG có xác nhận ngân hàng thật, và không chặn số tiền
   * báo vượt dư nợ hiện tại. Một đại lý có thể tự xoá nợ vô hạn lần bằng chính lời tự khai của
   * mình. Hành động này giờ CHỈ CÒN LÀ THÔNG BÁO cho admin — không đụng DealerCreditLedger ở đâu
   * cả. Sổ công nợ CHỈ giảm qua adminRecordCreditPayment (admin tự kiểm tra sao kê ngân hàng rồi
   * xác nhận, có trần theo dư nợ TẠI LÚC DUYỆT — xem method đó).
   */
  async reportCreditPayment(userId: string, amount: number, note?: string) {
    // Chặn nếu chưa phải đại lý (mirror mọi method công nợ/đơn hàng khác).
    await this.dealerContext(userId);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Số tiền không hợp lệ.');
    // Chặn sớm cho UX (đại lý biết ngay số báo có hợp lý không) — đây KHÔNG phải trần thật: trần
    // thật được admin re-check tại lúc duyệt (adminRecordCreditPayment), vì dư nợ có thể đổi giữa
    // lúc báo và lúc admin xử lý (đại lý vừa đặt đơn ghi nợ mới, hoặc một khoản báo khác vừa được
    // admin duyệt trước).
    const { balance } = await this.creditLedger(userId);
    if (amount > balance) {
      throw new BadRequestException(`Số tiền báo (${vnd(amount)}) vượt dư nợ hiện tại của bạn (${vnd(balance)}).`);
    }
    await this.notifyAdminsOfCreditReport(userId, amount, note).catch((e) =>
      this.logger.warn(`Báo admin đại lý ${userId} đã chuyển khoản lỗi: ${(e as Error).message}`),
    );
    return {
      ok: true,
      message: `Đã báo cho quản trị viên là bạn đã chuyển khoản ${vnd(amount)}. Sổ công nợ sẽ CHỈ cập nhật sau khi admin xác nhận đã nhận được tiền.`,
    };
  }

  /** Báo mọi tài khoản ADMIN đại lý vừa báo đã chuyển khoản (thông báo in-app/ZNS theo template
   * DEALER_CREDIT_PAYMENT_REPORTED) — mirror notifyAdminsOfClaim. */
  private async notifyAdminsOfCreditReport(userId: string, amount: number, note?: string) {
    if (!this.notifications) {
      this.logger.warn(`NotificationsService chưa wiring — không báo được admin đại lý ${userId} báo đã chuyển khoản.`);
      return;
    }
    const [admins, dealer] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'ADMIN', isBlocked: false }, select: { id: true }, take: 20 }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, phone: true } }),
    ]);
    if (admins.length === 0) {
      this.logger.warn(`Không có tài khoản ADMIN nào để báo đại lý ${userId} đã chuyển khoản.`);
      return;
    }
    const data = {
      dealer: dealer?.fullName || dealer?.phone || userId,
      amount: amount.toLocaleString('vi-VN'),
      note: note?.trim() ?? '',
    };
    const results = await Promise.allSettled(
      admins.map((a) => this.notifications!.notify(a.id, 'DEALER_CREDIT_PAYMENT_REPORTED', data)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) this.logger.warn(`Báo admin đại lý ${userId} đã chuyển khoản: lỗi ${failed}/${admins.length}.`);
  }

  /**
   * ADMIN xác nhận đã nhận chuyển khoản trả nợ của đại lý — nguồn DUY NHẤT được phép GIẢM
   * DealerCreditLedger ngoài các luồng hệ thống (ORDER_CANCEL, QUARTER_BONUS...). Thay cho
   * DealerService.creditPayment cũ (đại lý tự trừ nợ không cần ai xác nhận — A5-09). Admin tự
   * kiểm tra sao kê ngân hàng rồi gọi endpoint này (thường sau khi nhận DEALER_CREDIT_PAYMENT_REPORTED).
   *  - Trần: `amount` không được vượt dư nợ HIỆN TẠI — kiểm tra lại NGAY TRONG transaction
   *    Serializable (mirror DealerService.placeOrder nhánh onCredit) vì dư nợ có thể đã đổi giữa
   *    lúc admin xem màn hình và lúc bấm duyệt (đại lý vừa đặt đơn ghi nợ mới, hoặc một admin khác
   *    vừa duyệt một khoản khác cho CÙNG đại lý này).
   *  - Chống double-processing: Idempotency-Key optional → refId; unique (userId,refType,refId) đã
   *    có sẵn ở schema (@@unique([userId, refType, refId])) chặn tạo trùng — bấm đúp/retry mạng trả
   *    lại sổ công nợ hiện tại thay vì trừ 2 lần (mirror creditPayment cũ / wallet.withdraw).
   */
  async adminRecordCreditPayment(
    adminId: string,
    dealerUserId: string,
    amount: number,
    opts: { note?: string; bankRef?: string; idempotencyKey?: string } = {},
  ) {
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Số tiền không hợp lệ.');
    const dealer = await this.prisma.user.findUnique({
      where: { id: dealerUserId },
      select: { id: true, role: true, fullName: true, phone: true },
    });
    if (!dealer || dealer.role !== 'DEALER') throw new NotFoundException('Không tìm thấy đại lý.');

    const key = opts.idempotencyKey?.trim() || undefined;
    if (key) {
      const existing = await this.prisma.dealerCreditLedger.findFirst({
        where: { userId: dealerUserId, refType: 'PAYMENT', refId: key },
      });
      if (existing) {
        if (existing.delta !== -amount) {
          throw new BadRequestException('Idempotency-Key đã được sử dụng với số tiền khác, vui lòng thử lại.');
        }
        return this.creditLedger(dealerUserId);
      }
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Re-check TRONG transaction Serializable — dư nợ có thể đã đổi kể từ lúc admin xem màn
          // hình (đơn CREDIT mới / khoản báo khác vừa được duyệt). 2 admin duyệt đồng thời cho
          // cùng đại lý sẽ khiến 1 bên serialization-fail (P2034) thay vì cùng qua check.
          const agg = await tx.dealerCreditLedger.aggregate({ where: { userId: dealerUserId }, _sum: { delta: true } });
          const debt = agg._sum.delta ?? 0;
          if (amount > debt) {
            throw new BadRequestException(
              `Số tiền (${vnd(amount)}) vượt dư nợ hiện tại của đại lý (${vnd(debt)}).`,
            );
          }
          await tx.dealerCreditLedger.create({
            data: {
              userId: dealerUserId,
              delta: -amount,
              refType: 'PAYMENT',
              note: [
                `Admin ${adminId} xác nhận đã nhận chuyển khoản`,
                opts.bankRef?.trim() ? `Mã GD ${opts.bankRef.trim()}` : null,
                opts.note?.trim() || null,
              ]
                .filter(Boolean)
                .join(' · '),
              ...(key ? { refId: key } : {}),
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      // P2034: serialization failure — 2 lần duyệt công nợ của CÙNG đại lý chạm nhau.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận xử lý công nợ đại lý này, vui lòng thử lại.');
      }
      // Race 2 request cùng key: kẻ thua ăn P2002 trên unique (userId,refType,refId) → coi như
      // replay của cùng 1 lần xác nhận, trả kết quả hiện tại thay vì lỗi 500.
      if (key && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.creditLedger(dealerUserId);
      }
      throw err;
    }

    this.logger.warn(
      `Admin ${adminId} xác nhận đại lý ${dealerUserId} đã trả nợ ${vnd(amount)}` +
        (opts.bankRef ? ` (mã GD ${opts.bankRef})` : '') +
        '.',
    );
    if (this.notifications) {
      await this.notifications
        .notify(dealerUserId, 'DEALER_CREDIT_PAYMENT_CONFIRMED', { amount: amount.toLocaleString('vi-VN') })
        .catch((e) => this.logger.warn(`notify DEALER_CREDIT_PAYMENT_CONFIRMED lỗi (${dealerUserId}): ${(e as Error).message}`));
    }
    return this.creditLedger(dealerUserId);
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

  /**
   * Phần thưởng còn "mở" cho kỳ `period` không: đang áp dụng, HOẶC đã tắt nhưng bị tắt SAU khi kỳ
   * kết thúc. Không có cột deactivatedAt → dùng `updatedAt` làm mốc tắt: tắt xong thì updatedAt ≥
   * lúc tắt, nên "tắt sau khi kỳ kết thúc" luôn được nhận ra (không bao giờ từ chối nhầm). Ngược
   * lại, reward tắt GIỮA kỳ rồi được SỬA thêm sau khi kỳ kết thúc sẽ bị coi là tắt sau kỳ — chấp
   * nhận được vì mọi yêu cầu vẫn phải qua admin duyệt (approveRewardClaim), không tự trao thưởng.
   */
  private static rewardOpenForPeriod(r: { isActive?: boolean; updatedAt?: Date | null }, period: RewardPeriod): boolean {
    if (r.isActive !== false) return true;
    return !!r.updatedAt && new Date(r.updatedAt).getTime() >= period.end.getTime();
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
   * `excludeOrderId` = bỏ hẳn 1 đơn (doanh số "các đơn khác" khi tính phần biên của đơn bị huỷ).
   */
  private async dealerVolume(
    userId: string,
    start: Date,
    end: Date,
    db: Pick<Prisma.TransactionClient, 'order' | 'dealerCreditLedger'> = this.prisma,
    excludeOrderId?: string,
  ): Promise<DealerVolume> {
    const orders = await db.order.findMany({
      where: {
        userId,
        type: 'DEALER',
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        createdAt: { gte: start, lt: end },
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
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
   * Kỳ hiện tại chỉ gồm phần thưởng ĐANG áp dụng; kỳ liền trước gồm cả phần thưởng đã bị TẮT SAU khi
   * kỳ đó kết thúc (xem rewardOpenForPeriod) — admin tắt chương trình đầu quý mới không được xoá
   * quyền của đại lý đã đạt mốc quý cũ.
   * `now` truyền vào để test tất định.
   */
  async rewardsProgress(userId: string, now: Date = new Date()) {
    await this.dealerContext(userId); // chặn nếu chưa phải đại lý
    const graceDays = await this.claimGraceDays();
    const graceMs = graceDays * DAY_MS;
    const p = this.rewardPeriods(now);

    // Reward inactive chỉ có thể liên quan tới kỳ trước nếu bị tắt (updatedAt) từ khi kỳ liền trước
    // SỚM NHẤT kết thúc — prevYear.end (= đầu năm nay) ≤ prevQuarter.end.
    const rewards = await this.prisma.dealerReward.findMany({
      where: { OR: [{ isActive: true }, { isActive: false, updatedAt: { gte: p.prevYear.end } }] },
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
      // Mốc = threshold HIỆN TẠI của phần thưởng (DealerReward không lưu snapshot theo kỳ; claim
      // chụp lại threshold lúc gửi và admin duyệt theo bản chụp đó).
      const achieved = vol.settled >= r.threshold;
      const open = DealerService.rewardOpenForPeriod(r, period);
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
        canClaim: achieved && open && !claim && now.getTime() < deadline.getTime(),
      };
    };

    const current = rewards
      .filter((r) => r.isActive !== false)
      .map((r) => (r.period === 'YEAR' ? row(r, p.curYear, curY, true) : row(r, p.curQuarter, curQ, true)));
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
   *  - Phần thưởng đã TẮT: kỳ hiện tại không yêu cầu được nữa; kỳ ĐÃ KẾT THÚC vẫn yêu cầu được trong
   *    gia hạn nếu phần thưởng bị tắt SAU khi kỳ đó kết thúc (rewardOpenForPeriod).
   *  - Mốc xét = threshold HIỆN TẠI của phần thưởng (không có snapshot theo kỳ); claim lưu lại
   *    threshold lúc gửi để admin duyệt theo đúng con số đó.
   */
  async claimReward(
    userId: string,
    rewardId: string,
    opts: { periodKey?: string; note?: string } = {},
    now: Date = new Date(),
  ) {
    await this.dealerContext(userId);
    const reward = await this.prisma.dealerReward.findUnique({ where: { id: rewardId } });
    const STOPPED = 'Phần thưởng đại lý không tồn tại hoặc đã ngừng áp dụng.';
    if (!reward) throw new NotFoundException(STOPPED);

    const cur = this.rewardPeriods(now);
    const periodKey = opts.periodKey?.trim();
    const period = periodKey
      ? DealerService.parsePeriodKey(reward.period, periodKey)
      : reward.period === 'YEAR'
        ? cur.curYear
        : cur.curQuarter;
    if (!reward.isActive && (!period || now.getTime() < period.end.getTime() || !DealerService.rewardOpenForPeriod(reward, period))) {
      throw new NotFoundException(STOPPED);
    }
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

  // ── Admin: xác nhận đã nhận chuyển khoản cho đơn đại lý trả trước ──

  /**
   * Admin xác nhận đã nhận tiền chuyển khoản cho đơn đại lý TRẢ TRƯỚC: paymentStatus UNPAID → PAID
   * (PENDING_PAYMENT thì chuyển luôn CONFIRMED — y hệt webhook đối soát Pancake onPaymentReconcile).
   * Trước đây chỉ webhook Pancake lật được PAID, nên Pancake chưa cấu hình/đối soát trượt là đơn
   * kẹt UNPAID vĩnh viễn — không bao giờ vào doanh số đã chốt (thưởng quý, mốc thưởng).
   *  - CHỈ đơn DEALER; không nhận đơn "Ghi công nợ" (thanh toán công nợ đi qua sổ công nợ —
   *    creditPayment — đơn CREDIT không bao giờ lật PAID); không nhận đơn đã huỷ/trả (P1-3: tiền về
   *    sau khi huỷ phải hoàn thủ công, không lật PAID).
   *  - Guard atomic: updateMany where paymentStatus=UNPAID + status đúng như vừa đọc → webhook /
   *    huỷ đơn / admin khác chen giữa thì count=0, không ghi gì.
   *  - Ghi vết ai/lúc nào: 1 dòng order_status_history (actorType ADMIN, actorId, createdAt, note kèm
   *    mã giao dịch ngân hàng) trong CÙNG transaction + log. Cũng set `paidAt` (cột đã có từ Task 1
   *    analytics-foundation) + ghi event `order_paid` ATOMIC trong cùng transaction (Task 5).
   */
  async confirmDealerOrderPayment(adminId: string, id: string, dto: { bankRef?: string; note?: string } = {}) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id }, { code: id }] },
      select: { id: true, code: true, userId: true, type: true, status: true, paymentStatus: true, total: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.type !== 'DEALER') throw new BadRequestException('Chỉ xác nhận thanh toán thủ công cho đơn đại lý.');
    const summary = () => ({ id: order.id, code: order.code, status: order.status, paymentStatus: order.paymentStatus });
    if (order.paymentStatus === 'PAID') {
      return { ok: true, alreadyPaid: true, message: `Đơn ${order.code} đã được ghi nhận thanh toán trước đó.`, order: summary() };
    }
    if (order.status === 'CANCELLED' || order.status === 'RETURNED') {
      throw new BadRequestException(
        `Đơn ${order.code} đã huỷ/trả — nếu đã nhận tiền, cần hoàn tiền thủ công cho đại lý, không xác nhận thanh toán.`,
      );
    }
    if (order.paymentStatus !== 'UNPAID') {
      throw new BadRequestException(`Đơn ${order.code} đang ở trạng thái thanh toán ${order.paymentStatus} — không thể xác nhận.`);
    }
    const debit = await this.prisma.dealerCreditLedger.findFirst({
      where: { userId: order.userId, refType: 'ORDER', refId: order.id },
      select: { id: true },
    });
    if (debit) {
      throw new BadRequestException(
        `Đơn ${order.code} là đơn "Ghi công nợ" — ghi nhận thanh toán qua sổ công nợ đại lý, không xác nhận ở đây.`,
      );
    }

    const bankRef = dto.bankRef?.trim() || null;
    const adminNote = dto.note?.trim() || null;
    const toStatus = order.status === 'PENDING_PAYMENT' ? 'CONFIRMED' : order.status;
    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.order.updateMany({
        where: { id: order.id, type: 'DEALER', paymentStatus: 'UNPAID', status: order.status },
        data: {
          paymentStatus: 'PAID',
          paidAt: new Date(),
          ...(toStatus !== order.status ? { status: 'CONFIRMED' as const } : {}),
        },
      });
      if (flip.count === 0) {
        throw new BadRequestException('Đơn vừa thay đổi trạng thái (thanh toán/huỷ) — vui lòng tải lại rồi thử lại.');
      }
      if (this.analytics) {
        await this.analytics.record(tx, {
          eventName: 'order_paid',
          userId: order.userId,
          platform: 'web',
          props: { orderId: order.id, method: 'BANK_TRANSFER', amount: order.total, orderSource: 'dealer' },
        });
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus,
          actorType: 'ADMIN',
          actorId: adminId,
          note: [
            'Admin xác nhận đã nhận chuyển khoản (UNPAID → PAID)',
            bankRef ? `Mã GD ${bankRef}` : null,
            adminNote,
          ]
            .filter(Boolean)
            .join(' · '),
        },
      });
    });
    this.logger.warn(
      `Admin ${adminId} xác nhận thanh toán đơn đại lý ${order.code} (${vnd(order.total)}): UNPAID → PAID, ${order.status} → ${toStatus}` +
        (bankRef ? `, mã GD ${bankRef}` : ''),
    );
    if (this.notifications) {
      await this.notifications
        .notify(order.userId, 'ORDER_CONFIRMED', { order_code: order.code })
        .catch((e) => this.logger.warn(`notify ORDER_CONFIRMED lỗi (${order.userId}): ${(e as Error).message}`));
    }
    return {
      ok: true,
      alreadyPaid: false,
      message: `Đã xác nhận thanh toán đơn ${order.code}.`,
      order: { id: order.id, code: order.code, status: toStatus, paymentStatus: 'PAID' as const },
    };
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
      // Đọc doanh số + ghi thưởng trong CÙNG 1 transaction, dưới khoá advisory (đại lý, quý) dùng
      // chung với clawbackQuarterBonusForOrder: trước đây payout đọc doanh số (còn gồm đơn X) trong
      // lúc X đang bị huỷ — lần huỷ chưa thấy dòng QUARTER_BONUS (payout chưa commit) nên không thu
      // hồi, payout ghi thưởng tính cả X → giữ thưởng trên đơn đã huỷ. Có khoá thì 2 bên tuần tự:
      // payout chạy sau thấy X đã huỷ; lần huỷ chạy sau thấy dòng thưởng và thu hồi phần biên.
      let outcome: { bonusAmount: number; revenue: number } | null;
      try {
        outcome = await this.prisma.$transaction(async (tx) => {
          await DealerService.lockDealerQuarter(tx, d.id, quarter);
          // Idempotent: đã trả thưởng quý này cho đại lý này thì bỏ qua (dưới khoá → không race giữa
          // 2 lượt cron/manual chồng nhau). Unique (userId,refType,refId) + catch P2002 là lưới cuối.
          const existed = await tx.dealerCreditLedger.findFirst({
            where: { userId: d.id, refType: 'QUARTER_BONUS', refId: quarter },
            select: { id: true },
          });
          if (existed) return null;
          // CHỈ doanh số đã chốt (đã thanh toán/ghi công nợ + không còn tự huỷ được) — xem dealerVolume.
          const revenue = (await this.dealerVolume(d.id, start, end, tx)).settled;
          const { bonusAmount } = bonusForRevenue(revenue, sorted);
          if (bonusAmount <= 0) return null;
          await tx.dealerCreditLedger.create({
            data: { userId: d.id, delta: -bonusAmount, refType: 'QUARTER_BONUS', refId: quarter, note: `Thưởng doanh số ${quarter}` },
          });
          return { bonusAmount, revenue };
        });
      } catch (err) {
        // Lưới an toàn nếu khoá advisory không có tác dụng (vd pgbouncer transaction pooling): lượt
        // thua ăn P2002 trên unique(userId,refType,refId) → coi như ĐÃ trả thưởng (bỏ qua dealer này,
        // KHÔNG throw để không chặn các dealer còn lại trong cùng lượt chạy).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue;
        }
        throw err;
      }
      if (!outcome) continue;
      const { bonusAmount, revenue } = outcome;
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
   * Khoá advisory theo (đại lý, quý) — tự nhả khi transaction kết thúc. Dùng chung cho
   * payoutQuarterlyBonuses và clawbackQuarterBonusForOrder để trả thưởng và thu hồi của CÙNG 1 quý
   * không bao giờ đọc doanh số chéo nhau.
   */
  private static async lockDealerQuarter(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, userId: string, quarter: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${quarter}`}))`;
  }

  /**
   * Thu hồi thưởng doanh số quý khi 1 đơn đại lý bị huỷ/trả SAU khi quý của đơn (theo createdAt,
   * giờ VN — đúng cách payoutQuarterlyBonuses gom đơn) đã được trả thưởng. Không có bước này thì
   * đặt đơn to cuối quý (trả tiền + đóng gói) → nhận thưởng ngày 10 → trả hàng/hoàn tiền là giữ
   * nguyên phần thưởng tính trên chính đơn đó.
   *
   * Thu hồi theo PHẦN BIÊN của chính đơn này, KHÔNG tính lại cả quý:
   *   clawback = min(thưởng còn giữ, bonus(Vtrước) − bonus(Vtrước − đơn))
   * với Vtrước = doanh số ĐÃ CHỐT ngay trước lần huỷ = doanh số các đơn khác (dealerVolume qua `tx`,
   * loại hẳn đơn này theo id) + tổng tiền đơn này. Tính lại cả quý (bản trước) phạt nhầm quý trả
   * thưởng theo quy tắc CŨ (mọi đơn chưa huỷ đều tính): lần huỷ đầu tiên thu luôn cả phần chênh giữa
   * 2 quy tắc. CHỈ thu khi đơn ĐANG được tính vào doanh số đã chốt ngay trước lần huỷ: trạng thái cũ
   * (ảnh chụp `order.status` trước lần lật) ∈ PACKED/SHIPPING/DELIVERED và (đã PAID — theo
   * `opts.paidBeforeReversal` của guard hoàn tiền, mặc định ảnh chụp paymentStatus — hoặc là đơn ghi
   * công nợ có dòng ledger ORDER). Cùng bậc/công thức với payout (bonusTiers + bonusForRevenue).
   * Thưởng còn giữ = dòng QUARTER_BONUS + mọi dòng QUARTER_BONUS_ADJ của quý; thu hồi ghi 1 dòng
   * QUARTER_BONUS_ADJ delta DƯƠNG (tăng lại công nợ). Không bao giờ điều chỉnh tăng.
   *
   * BẮT BUỘC gọi trong transaction của lần lật trạng thái (OrderReversalService.reverseFinancials):
   *  - khoá advisory (đại lý, quý) TRƯỚC mọi lần đọc — xếp hàng với payout của quý đó và với lần
   *    huỷ khác cùng quý; rồi khoá dòng QUARTER_BONUS (FOR UPDATE). Lượt sau đọc lại (READ COMMITTED,
   *    câu lệnh mới) đơn đã huỷ + dòng ADJ đã commit của lượt trước → tổng các phần biên telescoping
   *    = bonus(V) − bonus(V − các đơn đã huỷ), không thu trùng.
   *  - idempotent theo unique (userId, refType, refId=`${quarter}:${orderId}`) qua createMany
   *    skipDuplicates (ON CONFLICT DO NOTHING — KHÔNG ném P2002, vốn làm hỏng cả transaction
   *    Postgres đang dở).
   * Báo đại lý (DEALER_BONUS_ADJUSTED) chỉ SAU KHI transaction đã commit — xem notifyBonusAdjustedAfterCommit.
   */
  async clawbackQuarterBonusForOrder(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      code?: string | null;
      userId: string;
      type: string;
      createdAt: Date;
      total: number;
      status: string;
      paymentStatus: string;
    },
    opts: { paidBeforeReversal?: boolean } = {},
  ): Promise<{ quarter: string | null; clawedBack: number }> {
    if (order.type !== 'DEALER') return { quarter: null, clawedBack: 0 };
    const { q, year, qStart, qEnd } = this.vnPeriodBounds(new Date(order.createdAt));
    const quarter = `Q${q + 1}/${year}`;

    await DealerService.lockDealerQuarter(tx, order.userId, quarter);
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
    if (heldBonus <= 0) return { quarter, clawedBack: 0 };

    if (!(await this.wasCountedBeforeReversal(tx, order, opts.paidBeforeReversal))) {
      return { quarter, clawedBack: 0 }; // đơn không nằm trong doanh số đã chốt → thưởng không tính trên nó
    }

    const others = (await this.dealerVolume(order.userId, qStart, qEnd, tx, order.id)).settled;
    const before = others + order.total;
    const tiers = await this.bonusTiers();
    const marginal = bonusForRevenue(before, tiers).bonusAmount - bonusForRevenue(others, tiers).bonusAmount;
    const clawback = Math.min(heldBonus, marginal);
    if (clawback <= 0) return { quarter, clawedBack: 0 };

    const refId = `${quarter}:${order.id}`;
    const created = await tx.dealerCreditLedger.createMany({
      data: [
        {
          userId: order.userId,
          delta: clawback,
          refType: 'QUARTER_BONUS_ADJ',
          refId,
          note: `Điều chỉnh thưởng doanh số ${quarter} (huỷ/trả đơn ${order.code ?? order.id})`,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return { quarter, clawedBack: 0 };
    this.logger.warn(
      `Thu hồi ${vnd(clawback)} thưởng ${quarter} của đại lý ${order.userId} do huỷ/trả đơn ${order.code ?? order.id} ` +
        `(phần biên ${vnd(marginal)}: doanh số đã chốt ${vnd(before)} → ${vnd(others)}; thưởng còn giữ ${vnd(heldBonus)} → ${vnd(heldBonus - clawback)}).`,
    );
    this.notifyBonusAdjustedAfterCommit(order.userId, refId, {
      quarter,
      amount: clawback.toLocaleString('vi-VN'),
      order_code: order.code ?? order.id,
      remaining: (heldBonus - clawback).toLocaleString('vi-VN'),
    });
    return { quarter, clawedBack: clawback };
  }

  /**
   * Đơn có nằm trong doanh số ĐÃ CHỐT ngay trước lần huỷ không (cùng định nghĩa dealerVolume):
   * trạng thái cũ PACKED/SHIPPING/DELIVERED, chưa REFUNDED/FAILED, và (đã PAID hoặc ghi công nợ).
   */
  private async wasCountedBeforeReversal(
    tx: Pick<Prisma.TransactionClient, 'dealerCreditLedger'>,
    order: { id: string; userId: string; status: string; paymentStatus: string },
    paidBeforeReversal?: boolean,
  ): Promise<boolean> {
    if (!DEALER_SETTLED_STATUSES.includes(order.status)) return false;
    if (order.paymentStatus === 'REFUNDED' || order.paymentStatus === 'FAILED') return false;
    if (paidBeforeReversal ?? order.paymentStatus === 'PAID') return true;
    const debit = await tx.dealerCreditLedger.findFirst({
      where: { userId: order.userId, refType: 'ORDER', refId: order.id },
      select: { id: true },
    });
    return !!debit;
  }

  /** Lịch kiểm tra (ms) trước khi báo điều chỉnh thưởng — xem notifyBonusAdjustedAfterCommit. */
  private static readonly ADJ_NOTIFY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000];

  /**
   * Báo đại lý khoản thưởng quý bị thu hồi — CHỈ khi transaction huỷ/trả đơn đã commit. Thu hồi chạy
   * giữa transaction của caller (OrderReversalService) nên không gửi ngay được: gửi rồi transaction
   * rollback là báo một khoản thu hồi không có thật. Lên lịch kiểm tra NGOÀI tx: dòng
   * QUARTER_BONUS_ADJ (unique theo refId) chỉ đọc được sau commit → thấy thì báo đúng 1 lần; sau vài
   * lần vẫn không thấy (đã rollback) thì bỏ. Best-effort: tiến trình tắt giữa chừng thì mất thông báo,
   * nhưng khoản điều chỉnh vẫn hiện trong sổ công nợ (ghi chú kèm mã đơn).
   */
  private notifyBonusAdjustedAfterCommit(userId: string, refId: string, data: Record<string, string>) {
    if (!this.notifications) {
      this.logger.warn(`NotificationsService chưa wiring — không báo được đại lý ${userId} về điều chỉnh thưởng ${refId}.`);
      return;
    }
    const delays = DealerService.ADJ_NOTIFY_DELAYS_MS;
    const attempt = (i: number) => {
      const t = setTimeout(() => {
        void (async () => {
          let committed = false;
          try {
            committed = !!(await this.prisma.dealerCreditLedger.findFirst({
              where: { userId, refType: 'QUARTER_BONUS_ADJ', refId },
              select: { id: true },
            }));
          } catch (e) {
            this.logger.warn(`Kiểm tra điều chỉnh thưởng ${refId} lỗi: ${(e as Error).message}`);
          }
          if (committed) {
            await this.notifications!
              .notify(userId, 'DEALER_BONUS_ADJUSTED', data)
              .catch((e) => this.logger.warn(`notify DEALER_BONUS_ADJUSTED lỗi (${userId}): ${(e as Error).message}`));
            return;
          }
          if (i + 1 < delays.length) attempt(i + 1);
          else this.logger.warn(`Không thấy dòng điều chỉnh thưởng ${refId} sau ${delays.length} lần — coi như đã rollback, không báo.`);
        })();
      }, delays[i]);
      t.unref?.();
    };
    attempt(0);
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
