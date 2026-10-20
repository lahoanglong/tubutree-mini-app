import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Order, type OrderItem, type ReturnRequest, type ReturnRequestItem } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { notifyAdmins } from '../../common/notify-admins';
import { formatPoints } from '../../common/format-points';
import { SystemConfigService } from '../system-config/system-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isMoneyBackable, OrderReversalService, type RefundOutcome } from './order-reversal.service';
import { sendReferralNotices, type ReferralNotice } from '../wallet/referral-notify';
import { computeReturnShares, type AllocOrder, type ReturnShares } from './refund-allocation';
import {
  canRefundToBank,
  formatVnd,
  maskedBank,
  normalizeBankDetails,
  WALLET_DESTINATION,
  type RefundDestination,
} from './refund-destination';
import { announceBankRefund } from './refund-queue';
import { partialReturnTotals } from './return-ledger';
import { defaultShopFault, RETURN_REASONS, type ReturnReasonCode } from './return-reasons';
import type { ReturnEstimateDto, ReturnRequestDto } from './dto/return-request.dto';
import { notifyMerchantOwner } from './merchant-order-notify';
import { isPartnerStore, storeHasPayouts } from '../merchant/partner-store';
import { MAX_RETURN_IMAGES, matchesReturnImageVersion, returnImageRef } from './return-images';
import { decodeServedImage } from '../../common/served-image';
import { ATTENTION_PARTIAL_RETURN_ACK } from '../integrations/pancake/pancake-attention';

/** Bộ lọc admin "Chờ nhận hàng về": đã duyệt, chưa bấm "Đã nhận hàng về". */
export const RETURNS_TO_RECEIVE = 'TO_RECEIVE';

type OrderWithItems = Order & { items: OrderItem[] };
type RequestWithItems = ReturnRequest & { items: ReturnRequestItem[] };
/** Yêu cầu trả hàng đã bỏ cột images (ảnh base64 nặng) — danh sách chỉ mang đường dẫn ảnh, xem `imageRefsFor`. */
type ReturnRow = Omit<ReturnRequest, 'images'> & { items: ReturnRequestItem[]; images?: string[] };

/**
 * Mọi cột của ReturnRequest trừ `images`, kèm dòng trả. Danh sách (khách, admin, gian hàng) và phản hồi tạo yêu cầu dùng
 * select này thay cho include: ảnh minh chứng base64 tới 1,5 triệu ký tự/ảnh, một trang admin 100 yêu cầu từng nặng hàng
 * chục MB. Một spec đối chiếu với Prisma.ReturnRequestScalarFieldEnum để cột mới không bị bỏ sót.
 */
export const RETURN_LIST_SELECT = {
  id: true,
  orderId: true,
  userId: true,
  reason: true,
  reasonCode: true,
  status: true,
  refundMethod: true,
  bankName: true,
  bankAccountNo: true,
  bankAccountName: true,
  shopFault: true,
  fullReturn: true,
  refundAmount: true,
  shippingRefund: true,
  pointsRefunded: true,
  convertedPointsRefunded: true,
  pointsReversed: true,
  commissionReversed: true,
  adminNote: true,
  reviewedBy: true,
  reviewedAt: true,
  receivedAt: true,
  receivedBy: true,
  createdAt: true,
  items: true,
} satisfies Prisma.ReturnRequestSelect;

const BUYER_HIDDEN_RETURN_FIELDS = ['commissionReversed', 'reviewedBy', 'receivedBy'] as const;

/**
 * Phiếu trả hàng khách tự xem: bỏ hoa hồng CTV bị cắt và id nhân sự/gian hàng duyệt, nhận hàng (chỉ admin và gian hàng cần).
 * `order-returns.images.spec.ts` giữ cho tập này luôn bằng RETURN_LIST_SELECT trừ các cột nội bộ.
 */
export const BUYER_RETURN_SELECT = Object.fromEntries(
  Object.entries(RETURN_LIST_SELECT).filter(([field]) => !(BUYER_HIDDEN_RETURN_FIELDS as readonly string[]).includes(field)),
) as Omit<typeof RETURN_LIST_SELECT, (typeof BUYER_HIDDEN_RETURN_FIELDS)[number]>;

const PANCAKE_ALERT_TEMPLATE = 'OPS_PANCAKE_ALERT';

export interface ReturnPreview {
  requestId: string;
  shopFault: boolean;
  defaultShopFault: boolean;
  isFull: boolean;
  goods: number;
  shipping: number;
  /** Tiền sẽ hoàn (0 khi đơn không có khoản đã thu). */
  refund: number;
  moneyRefundable: boolean;
  destination: { method: 'WALLET' | 'BANK' | 'END_CUSTOMER'; bankName?: string | null; accountNumber?: string | null; accountName?: string | null };
  pointsUsedBack: number;
  pointsEarnedBack: number;
  lines: { orderItemId: string; productName: string; variationName: string; quantity: number; orderedQuantity: number; refundAmount: number }[];
  /** Đơn do Tubu giao qua Pancake: duyệt xong cần xử lý phiếu trả trên Pancake. */
  pancakeTask: boolean;
  /** Hàng trả về đâu: kho Tubu, hay gian hàng đối tác tự giao (D4) — gian hàng xác nhận nhận hàng và tự cộng kho. */
  returnTo: { kind: 'TUBU' | 'MERCHANT'; name: string };
}

/** Số tiền dự kiến hoàn khách thấy trong form đổi/trả, trước khi gửi yêu cầu. */
export interface ReturnEstimate {
  isFull: boolean;
  goods: number;
  shipping: number;
  refund: number;
  moneyRefundable: boolean;
  pointsUsedBack: number;
  lines: { orderItemId: string; quantity: number; refundAmount: number }[];
}

/** Đối tác chỉ thấy phần cần để nhận hàng trả về — không thấy tài khoản ngân hàng nhận hoàn tiền của khách. */
export interface MerchantReturnView {
  id: string;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  receivedAt: Date | null;
  reasonLabel: string | null;
  reason: string;
  fullReturn: boolean;
  shopFault: boolean | null;
  orderCode: string;
  lines: { productName: string; variationName: string | null; quantity: number }[];
  /** Ảnh khách chụp kèm yêu cầu — để gian hàng xem bằng chứng trước khi Tubu duyệt. */
  images: string[];
}

function allocOrder(order: OrderWithItems): AllocOrder {
  return {
    total: order.total,
    shippingFee: order.shippingFee,
    pointsUsed: order.pointsUsed,
    pointsUsedConverted: order.pointsUsedConverted,
    pointsEarned: order.pointsEarned,
    items: order.items.map((i) => ({
      id: i.id,
      total: i.total,
      quantity: i.quantity,
      paidTotal: i.paidTotal,
      pointsDiscount: i.pointsDiscount,
    })),
  };
}

/** Câu "đã hoàn bao nhiêu, về đâu" cho thông báo khách (D2: khách được báo ở mỗi bước). */
export function refundNote(refund: RefundOutcome | null, bank: { bankName?: string | null; bankAccountNo?: string | null } | null, pointsBack = 0): string {
  const parts: string[] = [];
  if (refund && refund.amount > 0) {
    if (refund.to === 'WALLET') parts.push(`Đã hoàn ${formatVnd(refund.amount)} vào Ví Tubu.`);
    else if (refund.to === 'BANK') {
      parts.push(`Tubu sẽ chuyển khoản ${formatVnd(refund.amount)} về ${bank ? maskedBank(bank) : 'tài khoản của bạn'} trong 1-3 ngày làm việc, miễn phí.`);
    } else parts.push(`Khoản hoàn ${formatVnd(refund.amount)} được trả cho người nhận hàng.`);
  }
  if (pointsBack > 0) parts.push(`Đã hoàn ${formatPoints(pointsBack)} Điểm Xanh.`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Người duyệt/nhận hàng không được là người đã gửi yêu cầu: duyệt hoàn tiền vào Ví ngay trước khi hàng về nên tự duyệt đơn
 * của mình là tự rút tiền. Áp cho mọi vai trò (chủ shop thử bằng tài khoản thứ hai).
 */
function assertNotOwnReturn(actorId: string, req: { userId: string }): void {
  if (req.userId === actorId) {
    throw new ForbiddenException('Bạn không thể tự xử lý yêu cầu đổi/trả của chính mình. Vui lòng nhờ người khác trong đội ngũ duyệt.');
  }
}

/**
 * Trả hàng theo dòng và số lượng (D3, BUYERMINI-11/MONEY-7/ADMINOPS-6). Khách chọn dòng + số lượng + lý do + nơi nhận
 * tiền; admin xem số tiền tính sẵn rồi xác nhận; tiền/điểm/hoa hồng đảo theo phần; kho chỉ cộng khi admin bấm
 * "Đã nhận hàng về". Lần trả nốt mọi dòng còn lại chuyển đơn sang RETURNED và đi đường đảo cả đơn (trừ phần đã hoàn).
 */
@Injectable()
export class OrderReturnsService {
  private readonly logger = new Logger(OrderReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly reversal: OrderReversalService,
    private readonly loyalty: LoyaltyService,
    private readonly affiliate: AffiliateService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Khách ──

  async request(userId: string, code: string, dto: ReturnRequestDto) {
    const order = await this.prisma.order.findUnique({ where: { code }, include: { items: true } });
    if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.status !== 'DELIVERED') throw new BadRequestException('Chỉ yêu cầu đổi/trả với đơn đã giao.');
    const windowDays = await this.config.get<number>('returns.window_days', 7);
    // Mốc giao THẬT (OrderStatusService ghi deliveredAt; đơn cũ lấy lần lật DELIVERED trong sổ). updatedAt trôi theo mọi
    // lần ghi sau khi giao (webhook vận chuyển, hoá đơn) nên không dùng được.
    const deliveredAt = order.deliveredAt ?? (await this.lastDeliveredAt(order.id)) ?? order.updatedAt ?? order.createdAt;
    if (Date.now() - new Date(deliveredAt).getTime() > windowDays * 864e5) {
      throw new BadRequestException(`Quá hạn đổi/trả (${windowDays} ngày từ khi nhận hàng).`);
    }
    const existing = await this.prisma.returnRequest.findFirst({ where: { orderId: order.id, status: 'REQUESTED' } });
    if (existing) throw new BadRequestException('Đơn đang có yêu cầu đổi/trả chờ xử lý.');

    const reasonCode = dto.reasonCode ?? null;
    const text = dto.reason?.trim() ?? '';
    if ((!reasonCode || reasonCode === 'OTHER') && text.length < 5) {
      throw new BadRequestException('Vui lòng mô tả lý do đổi/trả (ít nhất 5 ký tự).');
    }
    const reason = text || RETURN_REASONS[reasonCode as ReturnReasonCode].label;

    const prior = await partialReturnTotals(this.prisma, order.id);
    const lines = this.requestedLines(order, prior.approvedQty, dto.items);
    const remainingAll = order.items.every((i) => (lines.get(i.id) ?? 0) + (prior.approvedQty.get(i.id) ?? 0) >= i.quantity);
    // Đơn đại lý có công nợ/đặt trước/thưởng doanh số theo cả đơn — chưa đảo theo phần được, chỉ nhận trả cả đơn.
    if (order.type === 'DEALER' && !remainingAll) {
      throw new BadRequestException('Đơn đại lý chỉ trả được cả đơn. Vui lòng chọn tất cả sản phẩm hoặc liên hệ Tubu.');
    }
    const destination = this.destinationFor(order, dto);

    const images = dto.images ?? [];
    let req: Omit<ReturnRow, 'images' | (typeof BUYER_HIDDEN_RETURN_FIELDS)[number]>;
    try {
      req = await this.prisma.returnRequest.create({
        data: {
          orderId: order.id,
          userId,
          reason,
          reasonCode,
          images,
          refundMethod: destination.method,
          ...(destination.method === 'BANK'
            ? {
                bankName: destination.bank.bankName,
                bankAccountNo: destination.bank.accountNumber,
                bankAccountName: destination.bank.accountName,
              }
            : {}),
          items: { create: [...lines].map(([orderItemId, quantity]) => ({ orderItemId, quantity })) },
        },
        select: BUYER_RETURN_SELECT,
      });
    } catch (err) {
      // Guard thật là unique index partial (orderId WHERE status='REQUESTED'): hai lần gửi song song chỉ một lần tạo.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Đơn đang có yêu cầu đổi/trả chờ xử lý.');
      }
      throw err;
    }
    await this.notifications.notify(userId, 'RETURN_REQUESTED', { order_code: code }).catch(() => undefined);
    const itemName = new Map(order.items.map((i) => [i.id, i.productName]));
    await notifyMerchantOwner(this.prisma, this.notifications, this.logger, order.id, 'MERCHANT_RETURN_REQUESTED', {
      order_code: code,
      items: [...lines].map(([id, qty]) => `${itemName.get(id) ?? ''} ×${qty}`).join(', '),
      reason,
    });
    return { ...req, images: images.map((img, i) => returnImageRef(req.id, i, img)) };
  }

  /**
   * Số tiền dự kiến hoàn cho dòng/số lượng khách đang chọn, cùng cách tính lúc admin duyệt (D3). Chưa chọn lý do thì
   * chưa tính phí ship: phí ship chỉ hoàn khi trả cả đơn hoặc lỗi do shop.
   */
  async estimate(userId: string, code: string, dto: ReturnEstimateDto): Promise<ReturnEstimate> {
    const order = await this.prisma.order.findUnique({ where: { code }, include: { items: true } });
    if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.status !== 'DELIVERED') throw new BadRequestException('Chỉ yêu cầu đổi/trả với đơn đã giao.');
    const prior = await partialReturnTotals(this.prisma, order.id);
    const lines = this.requestedLines(order, prior.approvedQty, dto.items);
    const shopFault = dto.reasonCode ? defaultShopFault(dto.reasonCode) : false;
    const shares = computeReturnShares(allocOrder(order), prior.approvedQty, lines, { shopFault, priorShipping: prior.shipping });
    const moneyRefundable = isMoneyBackable(order);
    return {
      isFull: shares.isFull,
      goods: moneyRefundable ? shares.goods : 0,
      shipping: moneyRefundable ? shares.shipping : 0,
      refund: moneyRefundable ? shares.goods + shares.shipping : 0,
      moneyRefundable,
      pointsUsedBack: shares.pointsUsedBack,
      lines: shares.lines.map((l) => ({ ...l, refundAmount: moneyRefundable ? l.refundAmount : 0 })),
    };
  }

  async listMine(userId: string) {
    const rows = await this.prisma.returnRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: BUYER_RETURN_SELECT,
    });
    const refs = await this.imageRefsFor(rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, images: refs.get(r.id) ?? [] }));
  }

  // ── Admin ──

  async listForAdmin(status: string | undefined, page: number, limit: number, order?: 'asc' | 'desc') {
    if (status === RETURNS_TO_RECEIVE) return this.listToReceive(page, limit, order ?? 'asc');
    const where = status ? { status: status as never } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.returnRequest.findMany({
        where,
        // Hàng chờ duyệt (REQUESTED) web gửi order=asc — yêu cầu cũ nhất lên đầu, không bị chìm.
        orderBy: { createdAt: order ?? 'desc' },
        ...skipTake(page, limit),
        select: RETURN_LIST_SELECT,
      }),
      this.prisma.returnRequest.count({ where }),
    ]);
    return paginated(await this.withContext(rows), page, limit, total);
  }

  /**
   * Cùng tập với thẻ inbox returnsToReceive: hàng trả của đơn gian hàng tự giao về gian hàng, không về kho Tubu. Lọc đơn gian
   * hàng bằng NOT EXISTS trong SQL: đưa id đơn qua danh sách IN/NOT IN thì quá ~32k yêu cầu chờ là vượt giới hạn tham số bind.
   */
  private async listToReceive(page: number, limit: number, order: 'asc' | 'desc') {
    const from = Prisma.sql`
      FROM "return_requests" rr
      WHERE rr."status" = 'APPROVED' AND rr."receivedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "return_request_items" i WHERE i."returnRequestId" = rr."id")
        AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = rr."orderId" AND o."fulfiller" = 'MERCHANT')`;
    const dir = order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const { skip, take } = skipTake(page, limit);
    const [ids, counted] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT rr."id" ${from} ORDER BY rr."createdAt" ${dir}, rr."id" ${dir} OFFSET ${skip} LIMIT ${take}`,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS "n" ${from}`,
    ]);
    const rows = await this.prisma.returnRequest.findMany({ where: { id: { in: ids.map((r) => r.id) } }, select: RETURN_LIST_SELECT });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.flatMap((r) => byId.get(r.id) ?? []);
    return paginated(await this.withContext(ordered), page, limit, counted[0]?.n ?? 0);
  }

  /** Số tiền/điểm sẽ hoàn nếu duyệt ngay bây giờ — bước xác nhận của admin (không ghi gì). */
  async preview(id: string, shopFaultInput?: boolean): Promise<ReturnPreview> {
    const req = await this.prisma.returnRequest.findUnique({ where: { id }, include: { items: true } });
    if (!req) throw new NotFoundException('Không tìm thấy yêu cầu đổi/trả.');
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: req.orderId },
      include: { items: true, fulfillerStorefront: { select: { title: true } } },
    });
    const prior = await partialReturnTotals(this.prisma, order.id, id);
    const lines = this.linesOf(req, order, prior.approvedQty);
    const shopFault = shopFaultInput ?? req.shopFault ?? defaultShopFault(req.reasonCode);
    const shares = computeReturnShares(allocOrder(order), prior.approvedQty, lines, { shopFault, priorShipping: prior.shipping });
    return this.previewOf(req, order, shares, shopFault);
  }

  async review(
    adminId: string,
    id: string,
    input: { approve: boolean; note?: string; shopFault?: boolean; expectedRefund?: number },
  ) {
    const req = await this.prisma.returnRequest.findUnique({ where: { id }, include: { items: true } });
    if (!req) throw new NotFoundException('Không tìm thấy yêu cầu đổi/trả.');
    assertNotOwnReturn(adminId, req);
    const note = input.note?.trim() || undefined;

    if (!input.approve) {
      if (!note || note.length < 3) throw new BadRequestException('Vui lòng ghi lý do từ chối để báo cho khách.');
      const rejected = await this.prisma.returnRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'REJECTED', adminNote: note, reviewedBy: adminId, reviewedAt: new Date() },
      });
      if (rejected.count === 0) throw new BadRequestException('Yêu cầu đã được xử lý.');
      const order = await this.prisma.order.findUnique({ where: { id: req.orderId }, select: { code: true } });
      await this.notifications
        .notify(req.userId, 'RETURN_REJECTED', { order_code: order?.code ?? '', reason: note })
        .catch(() => undefined);
      return this.withContext(await this.prisma.returnRequest.findUniqueOrThrow({ where: { id }, include: { items: true } }));
    }

    const standardPointsExpiresAt = await this.loyalty.pointsExpiresAt(new Date());
    const outcome = await this.prisma.$transaction(async (tx) => {
      const approved = await tx.returnRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'APPROVED', adminNote: note, reviewedBy: adminId, reviewedAt: new Date() },
      });
      if (approved.count === 0) throw new BadRequestException('Yêu cầu đã được xử lý.');
      // Khoá đơn: hai yêu cầu của cùng đơn (lần trước vừa duyệt) hay webhook huỷ/trả xếp hàng sau lần duyệt này.
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${req.orderId} FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({ where: { id: req.orderId }, include: { items: true } });
      if (order.status !== 'DELIVERED') {
        throw new BadRequestException('Đơn không ở trạng thái có thể trả (đã hủy/đã trả).');
      }
      const prior = await partialReturnTotals(tx, order.id, id);
      const lines = this.linesOf(req, order, prior.approvedQty);
      const shopFault = input.shopFault ?? req.shopFault ?? defaultShopFault(req.reasonCode);
      const shares = computeReturnShares(allocOrder(order), prior.approvedQty, lines, { shopFault, priorShipping: prior.shipping });
      const moneyRefundable = isMoneyBackable(order);
      const refund = moneyRefundable ? shares.goods + shares.shipping : 0;
      if (input.expectedRefund !== undefined && input.expectedRefund !== refund) {
        throw new ConflictException(
          `Số tiền hoàn đã đổi thành ${formatVnd(refund)} (đơn vừa có thay đổi). Vui lòng xem lại trước khi duyệt.`,
        );
      }
      const destination = this.storedDestination(req, order);

      let money: RefundOutcome | null;
      let pointsBack = shares.pointsUsedBack;
      let commissionCut = 0;
      let referralNotices: ReferralNotice[];
      if (shares.isFull) {
        const flipped = await tx.order.updateMany({ where: { id: order.id, status: 'DELIVERED' }, data: { status: 'RETURNED' } });
        if (flipped.count === 0) throw new BadRequestException('Đơn không ở trạng thái có thể trả (đã hủy/đã trả).');
        await tx.orderStatusHistory.create({
          data: { orderId: order.id, fromStatus: 'DELIVERED', toStatus: 'RETURNED', actorType: 'ADMIN', actorId: adminId, note: note ?? null },
        });
        const reversed = await this.reversal.reverseFinancials(tx, order, { destination, restock: false, returnRequestId: id, standardPointsExpiresAt });
        money = reversed.refund;
        referralNotices = reversed.referralNotices ?? [];
      } else {
        const partial = await this.reversal.reversePartialReturn(tx, order, {
          requestId: id,
          shares,
          destination,
          prior,
          standardPointsExpiresAt,
        });
        money = partial.refund;
        pointsBack = partial.pointsBack;
        commissionCut = partial.commissionCut;
        referralNotices = partial.referralNotices ?? [];
      }

      await tx.returnRequestItem.deleteMany({ where: { returnRequestId: id } });
      await tx.returnRequestItem.createMany({
        data: shares.lines.map((l) => ({ returnRequestId: id, orderItemId: l.orderItemId, quantity: l.quantity, refundAmount: moneyRefundable ? l.refundAmount : 0 })),
      });
      await tx.returnRequest.update({
        where: { id },
        data: {
          shopFault,
          fullReturn: shares.isFull,
          refundAmount: moneyRefundable ? shares.goods : 0,
          shippingRefund: moneyRefundable ? shares.shipping : 0,
          pointsRefunded: shares.pointsUsedBack,
          convertedPointsRefunded: shares.convertedBack,
          pointsReversed: shares.pointsEarnedBack,
          commissionReversed: commissionCut,
          ...(destination.method === 'WALLET' && req.refundMethod === 'BANK' ? { refundMethod: 'WALLET' } : {}),
        },
      });
      return { order, shares, money, pointsBack, referralNotices };
    });

    const { order, shares, money } = outcome;
    await sendReferralNotices({ prisma: this.prisma, notifications: this.notifications, logger: this.logger }, outcome.referralNotices);
    // Yêu cầu đã APPROVED và đơn đã RETURNED từ lúc commit nên duyệt lại báo "đã xử lý": lỗi đảo ở đây không được làm bỏ các bước sau,
    // chúng chạy hết rồi mới ném lỗi đầu tiên.
    let reversalFailure: unknown = null;
    if (shares.isFull) {
      // Điểm thường/điểm tích và hoa hồng của phần còn lại — idempotent, chạy sau commit như mọi lần đảo cả đơn.
      try {
        await this.loyalty.reverseOrderPoints(order.id);
      } catch (err) {
        reversalFailure ??= err;
        this.logger.error(`Đảo điểm của đơn ${order.code} sau khi duyệt trả cả đơn lỗi: ${err instanceof Error ? err.message : err}`);
      }
      try {
        await this.affiliate.reverseCommissionsForOrder(order.id);
      } catch (err) {
        reversalFailure ??= err;
        this.logger.error(`Thu hồi hoa hồng của đơn ${order.code} sau khi duyệt trả cả đơn lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (money?.to === 'BANK') {
      await announceBankRefund(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        { orderCode: order.code, amount: money.amount, userId: order.userId, bankName: req.bankName, bankAccountNo: req.bankAccountNo },
        { notifyCustomer: false },
      );
    }
    await this.flagPancakeReturn(order, shares);
    // D4: hàng của đơn gian hàng tự giao trả về gian hàng — báo chủ gian hàng chờ nhận và xác nhận trong Cổng người bán.
    await notifyMerchantOwner(this.prisma, this.notifications, this.logger, order.id, 'MERCHANT_RETURN_APPROVED', {
      order_code: order.code,
      items: this.describeLines(order, shares),
    });
    await this.notifications
      .notify(order.userId, 'RETURN_APPROVED_DETAIL', {
        order_code: order.code,
        refund_note: refundNote(money, req, outcome.pointsBack),
      })
      .catch(() => undefined);
    if (reversalFailure !== null) throw reversalFailure;
    return this.withContext(await this.prisma.returnRequest.findUniqueOrThrow({ where: { id }, include: { items: true } }));
  }

  /**
   * Admin xác nhận đã nhận hàng trả về kho Tubu: lúc này mới cộng lại tồn kho các dòng trả (D3). Một lần mỗi yêu cầu. Đơn gian
   * hàng đối tác tự giao (D4) thì hàng về gian hàng, kho Tubu không nhận — gian hàng tự xác nhận (markReceivedByMerchant).
   */
  async markReceived(adminId: string, id: string) {
    await this.receive(id, { kind: 'ADMIN', userId: adminId });
    return this.withContext(await this.prisma.returnRequest.findUniqueOrThrow({ where: { id }, include: { items: true } }));
  }

  /**
   * Chủ gian hàng đối tác xác nhận đã nhận hàng trả về: cộng lại tồn kho sản phẩm của gian hàng. Phản hồi là đúng dạng một dòng của
   * danh sách hàng trả về — không kèm tài khoản người mua hay tài khoản ngân hàng nhận hoàn (R5-PARTNER-6).
   */
  async markReceivedByMerchant(userId: string, id: string): Promise<MerchantReturnView> {
    await this.receive(id, { kind: 'MERCHANT', userId });
    const [view] = await this.merchantViews([id]);
    return view!;
  }

  /** Yêu cầu trả hàng của các đơn gian hàng tự giao (đang chờ duyệt / đã duyệt) — mục "Hàng trả về" ở Cổng người bán. */
  async listForMerchant(userId: string): Promise<MerchantReturnView[]> {
    const owned = await this.prisma.storefront.findFirst({ where: { ownerUserId: userId }, select: { id: true, type: true, isPartner: true } });
    const partner = !!owned && isPartnerStore(owned);
    // Gian hàng đã tắt cờ vào được khi có phiếu bất kỳ (đúng cổng hasPayouts của tab, kể cả chỉ bán hàng giao hộ) nhưng chỉ thấy hàng
    // trả của đơn đã có dòng SALE trên phiếu (cùng quy tắc với `receive`, có thể là danh sách rỗng); chưa từng có phiếu thì 403.
    const paidOnly = !!owned && !partner && (await storeHasPayouts(this.prisma, owned.id));
    if (!owned || (!partner && !paidOnly)) throw new ForbiddenException('Chỉ gian hàng đối tác tự giao hàng mới có hàng trả về.');
    const store = owned;
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT rr."id" FROM "return_requests" rr
        JOIN "orders" o ON o."id" = rr."orderId"
       WHERE o."fulfiller" = 'MERCHANT' AND o."fulfillerStorefrontId" = ${store.id}
         AND rr."status" IN ('REQUESTED', 'APPROVED')
         ${partner ? Prisma.empty : Prisma.sql`AND EXISTS (SELECT 1 FROM "merchant_payout_lines" s WHERE s."orderId" = o."id" AND s."kind" = 'SALE')`}
       ORDER BY (rr."status" = 'APPROVED' AND rr."receivedAt" IS NULL) DESC, rr."createdAt" DESC
       LIMIT 50`;
    return this.merchantViews(ids.map((r) => r.id));
  }

  /** Dòng "Hàng trả về" của gian hàng theo đúng thứ tự `ids`: chỉ phần cần để nhận hàng, không có người mua hay tài khoản nhận hoàn. */
  private async merchantViews(ids: string[]): Promise<MerchantReturnView[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.returnRequest.findMany({ where: { id: { in: ids } }, select: RETURN_LIST_SELECT });
    const refs = await this.imageRefsFor(rows.map((r) => r.id));
    const orders = await this.prisma.order.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.orderId))] } },
      select: { id: true, code: true, items: { select: { id: true, productName: true, variationName: true, quantity: true } } },
    });
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const rank = new Map(ids.map((id, i) => [id, i]));
    return rows
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
      .map((r) => {
        const order = orderMap.get(r.orderId);
        const itemById = new Map((order?.items ?? []).map((i) => [i.id, i]));
        const lines = r.items.length
          ? r.items.map((it) => ({
              productName: itemById.get(it.orderItemId)?.productName ?? '',
              variationName: itemById.get(it.orderItemId)?.variationName ?? null,
              quantity: it.quantity,
            }))
          : (order?.items ?? []).map((i) => ({ productName: i.productName, variationName: i.variationName, quantity: i.quantity }));
        return {
          id: r.id,
          status: r.status,
          createdAt: r.createdAt,
          reviewedAt: r.reviewedAt,
          receivedAt: r.receivedAt,
          reasonLabel: r.reasonCode ? (RETURN_REASONS[r.reasonCode as ReturnReasonCode]?.label ?? r.reasonCode) : null,
          reason: r.reason,
          fullReturn: r.fullReturn,
          shopFault: r.shopFault,
          orderCode: order?.code ?? '',
          lines,
          images: refs.get(r.id) ?? [],
        };
      });
  }

  private async receive(id: string, actor: { kind: 'ADMIN' | 'MERCHANT'; userId: string }): Promise<void> {
    const req = await this.prisma.returnRequest.findUnique({ where: { id }, include: { items: true } });
    if (!req) throw new NotFoundException('Không tìm thấy yêu cầu đổi/trả.');
    const owner = await this.prisma.order.findUnique({
      where: { id: req.orderId },
      select: { fulfiller: true, fulfillerStorefront: { select: { ownerUserId: true, type: true, isPartner: true, title: true } } },
    });
    const merchantOrder = owner?.fulfiller === 'MERCHANT';
    if (actor.kind === 'ADMIN' && merchantOrder) {
      throw new BadRequestException(
        `Hàng của đơn này trả về gian hàng ${owner?.fulfillerStorefront?.title ?? 'đối tác'}, không về kho Tubu — gian hàng xác nhận đã nhận hàng trong Cổng người bán.`,
      );
    }
    if (actor.kind === 'MERCHANT') {
      const store = owner?.fulfillerStorefront;
      // Gian hàng đã tắt cờ đối tác vẫn nhận hàng trả của đơn Tubu đã trả tiền (đơn có dòng SALE đã lưu trên phiếu): cùng quy tắc
      // với khoản đảo tiền còn thu (`openLinesOf`); đơn chưa từng được trả thì không.
      const allowed =
        merchantOrder &&
        !!store &&
        store.ownerUserId === actor.userId &&
        (isPartnerStore(store) || (await this.prisma.merchantPayoutLine.count({ where: { orderId: req.orderId, kind: 'SALE' } })) > 0);
      if (!allowed) throw new NotFoundException('Không tìm thấy yêu cầu trả hàng của gian hàng bạn.');
    }
    if (actor.kind === 'ADMIN') assertNotOwnReturn(actor.userId, req);
    const restocked = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.returnRequest.updateMany({
        where: { id, status: 'APPROVED', receivedAt: null },
        data: { receivedAt: new Date(), receivedBy: actor.userId },
      });
      if (flip.count === 0) throw new BadRequestException('Yêu cầu chưa được duyệt hoặc đã ghi nhận nhận hàng trước đó.');
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${req.orderId} FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({ where: { id: req.orderId }, include: { items: true } });
      const prior = await partialReturnTotals(tx, order.id, id);
      return this.reversal.restockReturnedItems(tx, order, req.items, prior.restockedQty);
    });
    // Pancake đã báo "Hoàn một phần" và chỉ còn chờ nhận hàng: nhận hết rồi thì việc trong "Cần xử lý Pancake" đã xong.
    await this.prisma.$executeRaw`
      UPDATE "orders" SET "pancakeAttention" = NULL, "pancakeAttentionAt" = NULL
      WHERE "id" = ${req.orderId}
        AND starts_with("pancakeAttention", ${ATTENTION_PARTIAL_RETURN_ACK})
        AND NOT EXISTS (SELECT 1 FROM "return_requests" rr WHERE rr."orderId" = ${req.orderId} AND rr."status" = 'APPROVED' AND rr."receivedAt" IS NULL)`.catch(
      (err: unknown) => this.logger.error(`Không gỡ được việc chờ nhận hàng về của đơn ${req.orderId}: ${err instanceof Error ? err.message : err}`),
    );
    const order = await this.prisma.order.findUnique({ where: { id: req.orderId }, select: { code: true } });
    this.logger.log(
      `${actor.kind === 'ADMIN' ? 'Admin' : 'Gian hàng'} ${actor.userId} nhận hàng trả yêu cầu ${id} (đơn ${order?.code}), cộng kho ${restocked} đơn vị.`,
    );
    await this.notifications.notify(req.userId, 'RETURN_RECEIVED', { order_code: order?.code ?? '' }).catch(() => undefined);
  }

  // ── Nội bộ ──

  /** Dòng + số lượng khách xin trả, kiểm không vượt phần chưa trả. Không gửi = mọi phần còn lại. */
  private requestedLines(
    order: OrderWithItems,
    approvedQty: ReadonlyMap<string, number>,
    items: { orderItemId: string; quantity: number }[] | undefined,
  ): Map<string, number> {
    const remaining = new Map(order.items.map((i) => [i.id, i.quantity - (approvedQty.get(i.id) ?? 0)]));
    const out = new Map<string, number>();
    if (!items) {
      for (const [id, q] of remaining) if (q > 0) out.set(id, q);
    } else {
      for (const it of items) {
        if (!remaining.has(it.orderItemId)) throw new BadRequestException('Có dòng hàng không thuộc đơn này.');
        out.set(it.orderItemId, (out.get(it.orderItemId) ?? 0) + it.quantity);
      }
      for (const [id, q] of out) {
        if (q > (remaining.get(id) ?? 0)) {
          const name = order.items.find((i) => i.id === id)?.productName ?? 'sản phẩm';
          throw new BadRequestException(`Số lượng trả của "${name}" vượt số còn lại có thể trả (${Math.max(0, remaining.get(id) ?? 0)}).`);
        }
      }
    }
    // Đơn không có dòng hàng (dữ liệu cũ) chỉ trả được nguyên đơn — computeReturnShares coi là trả cả đơn.
    if (out.size === 0 && order.items.length > 0) throw new BadRequestException('Đơn không còn sản phẩm nào có thể trả.');
    return out;
  }

  /** Dòng của yêu cầu lúc duyệt. Yêu cầu tạo trước khi có dòng = trả mọi phần còn lại; kiểm lại phần còn lại. */
  private linesOf(req: RequestWithItems, order: OrderWithItems, approvedQty: ReadonlyMap<string, number>): Map<string, number> {
    const items = req.items.length ? req.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })) : undefined;
    return this.requestedLines(order, approvedQty, items);
  }

  private destinationFor(order: Pick<Order, 'paymentMethod' | 'placedForCustomer'>, dto: ReturnRequestDto): RefundDestination {
    if (dto.refundMethod !== 'BANK' || order.placedForCustomer) return WALLET_DESTINATION;
    if (!canRefundToBank(order.paymentMethod)) {
      throw new BadRequestException('Đơn thanh toán bằng Ví Tubu được hoàn về Ví Tubu.');
    }
    return { method: 'BANK', bank: normalizeBankDetails(dto) };
  }

  private storedDestination(req: ReturnRequest, order: Pick<Order, 'paymentMethod'>): RefundDestination {
    if (req.refundMethod === 'BANK' && req.bankAccountNo && canRefundToBank(order.paymentMethod)) {
      return {
        method: 'BANK',
        bank: { bankName: req.bankName ?? '', accountNumber: req.bankAccountNo, accountName: req.bankAccountName ?? '' },
      };
    }
    return WALLET_DESTINATION;
  }

  private previewOf(
    req: RequestWithItems,
    order: OrderWithItems & { fulfillerStorefront?: { title: string } | null },
    shares: ReturnShares,
    shopFault: boolean,
  ): ReturnPreview {
    const moneyRefundable = isMoneyBackable(order);
    const dest = this.storedDestination(req, order);
    const byId = new Map(order.items.map((i) => [i.id, i]));
    return {
      requestId: req.id,
      shopFault,
      defaultShopFault: defaultShopFault(req.reasonCode),
      isFull: shares.isFull,
      goods: shares.goods,
      shipping: shares.shipping,
      refund: moneyRefundable ? shares.goods + shares.shipping : 0,
      moneyRefundable,
      destination: order.placedForCustomer
        ? { method: 'END_CUSTOMER' }
        : dest.method === 'BANK'
          ? { method: 'BANK', bankName: dest.bank.bankName, accountNumber: dest.bank.accountNumber, accountName: dest.bank.accountName }
          : { method: 'WALLET' },
      pointsUsedBack: shares.pointsUsedBack,
      pointsEarnedBack: shares.pointsEarnedBack,
      lines: shares.lines.map((l) => ({
        ...l,
        productName: byId.get(l.orderItemId)?.productName ?? '',
        variationName: byId.get(l.orderItemId)?.variationName ?? '',
        orderedQuantity: byId.get(l.orderItemId)?.quantity ?? 0,
        refundAmount: moneyRefundable ? l.refundAmount : 0,
      })),
      pancakeTask: !!order.pancakeOrderId,
      returnTo: returnDestinationOf(order),
    };
  }

  private describeLines(order: { items: OrderItem[] }, shares: ReturnShares): string {
    const byId = new Map(order.items.map((i) => [i.id, i]));
    return shares.lines.map((l) => `${byId.get(l.orderItemId)?.productName ?? l.orderItemId} ×${l.quantity}`).join(', ');
  }

  /**
   * Đơn Tubu giao qua Pancake: Pancake là nguồn sự thật của đơn/kho nên lần trả này phải được xử lý tay trên Pancake
   * (phiếu trả/nhận hàng về). Đưa vào hàng "Cần xử lý Pancake" và báo admin — không tự gọi Pancake.
   */
  private async flagPancakeReturn(order: Pick<Order, 'id' | 'code' | 'pancakeOrderId'> & { items: OrderItem[] }, shares: ReturnShares) {
    if (!order.pancakeOrderId) return;
    const byId = new Map(order.items.map((i) => [i.id, i]));
    const what = shares.lines
      .map((l) => `${byId.get(l.orderItemId)?.productName ?? l.orderItemId} ×${l.quantity}`)
      .join(', ');
    const reason = `${shares.isFull ? 'Khách trả cả đơn' : 'Khách trả một phần đơn'} (đã duyệt hoàn tiền): ${what}. ${shares.isFull ? 'Tạo phiếu trả hàng' : 'Tạo phiếu "Hoàn một phần" (không dùng "Đã hoàn" cả đơn)'} trên Pancake cho đơn #${order.pancakeOrderId} và bấm "Đã nhận hàng về" khi hàng về kho.`;
    try {
      await this.prisma.order.updateMany({
        where: { id: order.id },
        data: { pancakeAttention: reason, pancakeAttentionAt: new Date() },
      });
      await notifyAdmins(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        { template: PANCAKE_ALERT_TEMPLATE, subject: `trả hàng đơn ${order.code} trên Pancake`, data: () => ({ order_code: order.code, message: reason }) },
      );
    } catch (err) {
      this.logger.error(`Không ghi được việc cần xử lý Pancake cho lần trả đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Kèm đơn (cả dòng hàng), khách và tên sản phẩm từng dòng trả: admin cần thấy trả món nào, bao nhiêu trước khi duyệt.
   * ReturnRequest không khai quan hệ tới Order/User nên nạp theo lô rồi ghép (hai truy vấn cho cả trang).
   */
  private async withContext<T extends ReturnRow>(input: T): Promise<unknown>;
  private async withContext<T extends ReturnRow>(input: T[]): Promise<unknown[]>;
  private async withContext<T extends ReturnRow>(input: T | T[]): Promise<unknown> {
    const rows = Array.isArray(input) ? input : [input];
    if (rows.length === 0) return [];
    const [orders, users, refunds, imageRefs] = await Promise.all([
      this.prisma.order.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.orderId))] } },
        select: {
          id: true,
          code: true,
          total: true,
          subtotal: true,
          discount: true,
          shippingFee: true,
          pointsUsed: true,
          status: true,
          paymentMethod: true,
          paymentStatus: true,
          pancakeOrderId: true,
          placedForCustomer: true,
          fulfiller: true,
          fulfillerStorefront: { select: { title: true } },
          items: { select: { id: true, productName: true, variationName: true, quantity: true, unitPrice: true, total: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, fullName: true, phone: true },
      }),
      // Khoản hoàn thật của yêu cầu (khách có thể đã đổi ngân hàng → Ví, admin có thể chưa chuyển): admin thấy đúng
      // trạng thái tiền thay vì nơi nhận lúc khách gửi yêu cầu.
      (this.prisma.orderCustomerRefund?.findMany({
        where: { kind: 'RETURN', refKey: { in: rows.map((r) => r.id) } },
        select: { refKey: true, method: true, status: true, amount: true, bankName: true, bankAccountNo: true, completedAt: true },
      }) ?? Promise.resolve([])),
      this.imageRefsFor(rows.map((r) => r.id)),
    ]);
    const refundMap = new Map(refunds.map((f) => [f.refKey, f]));
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const userMap = new Map(users.map((u) => [u.id, u]));
    const decorated = rows.map((r) => {
      const order = orderMap.get(r.orderId) ?? null;
      const itemById = new Map((order?.items ?? []).map((i) => [i.id, i]));
      return {
        ...r,
        images: imageRefs.get(r.id) ?? [],
        reasonLabel: r.reasonCode ? (RETURN_REASONS[r.reasonCode as ReturnReasonCode]?.label ?? r.reasonCode) : null,
        items: r.items.map((it) => ({
          ...it,
          productName: itemById.get(it.orderItemId)?.productName ?? null,
          variationName: itemById.get(it.orderItemId)?.variationName ?? null,
          orderedQuantity: itemById.get(it.orderItemId)?.quantity ?? null,
        })),
        order,
        user: userMap.get(r.userId) ?? null,
        refund: refundMap.get(r.id) ?? null,
      };
    });
    return Array.isArray(input) ? decorated : decorated[0];
  }

  /**
   * Đường dẫn ảnh minh chứng của từng yêu cầu (đích của `returnImageRef`). Mã phiên bản (md5) và URL https tính ngay trong Postgres
   * nên ảnh base64 không rời DB: danh sách không phải đọc cột images về Node.
   */
  private async imageRefsFor(ids: string[]): Promise<Map<string, string[]>> {
    const refs = new Map<string, string[]>();
    if (ids.length === 0) return refs;
    const rows = await this.prisma.$queryRaw<{ id: string; idx: number; hash: string | null; url: string | null }[]>`
      SELECT rr."id", (t."ord" - 1)::int AS "idx",
             CASE WHEN left(t."img", 5) = 'data:' THEN md5(rr."id" || ':' || (t."ord" - 1)::text || ':' || t."img") END AS "hash",
             CASE WHEN left(t."img", 5) <> 'data:' THEN t."img" END AS "url"
        FROM "return_requests" rr
        CROSS JOIN LATERAL unnest(rr."images") WITH ORDINALITY AS t("img", "ord")
       WHERE rr."id" IN (${Prisma.join(ids)})
       ORDER BY rr."id", t."ord"`;
    for (const r of rows) {
      const list = refs.get(r.id) ?? [];
      list.push(r.hash ? `/returns/${r.id}/images/${r.idx}?v=${r.hash}` : (r.url ?? ''));
      refs.set(r.id, list);
    }
    return refs;
  }

  /** Byte của ảnh base64 thứ `index` (đích của `returnImageRef`); `version` phải khớp mã của ảnh đang lưu. */
  async getImage(id: string, index: number, version: unknown): Promise<{ mime: string; data: Buffer }> {
    const notFound = () => new NotFoundException('Không tìm thấy ảnh.');
    if (!Number.isInteger(index) || index < 0 || index >= MAX_RETURN_IMAGES) throw notFound();
    const rows = await this.prisma.$queryRaw<{ img: string | null }[]>`
      SELECT "images"[${index + 1}::int] AS "img" FROM "return_requests" WHERE "id" = ${id}`;
    const image = rows[0]?.img;
    if (!image || !matchesReturnImageVersion(version, id, index, image)) throw notFound();
    const decoded = decodeServedImage(image);
    if (!decoded) throw notFound();
    return decoded;
  }

  /** Fallback cho đơn chưa có deliveredAt: lần lật DELIVERED cuối trong sổ lịch sử trạng thái. */
  private async lastDeliveredAt(orderId: string): Promise<Date | null> {
    const h = await this.prisma.orderStatusHistory
      ?.findFirst({
        where: { orderId, toStatus: 'DELIVERED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      .catch(() => null);
    return h?.createdAt ?? null;
  }
}

/** Hàng trả về kho Tubu hay về gian hàng đối tác tự giao (D4). */
export function returnDestinationOf(order: {
  fulfiller?: string | null;
  fulfillerStorefront?: { title: string } | null;
}): { kind: 'TUBU' | 'MERCHANT'; name: string } {
  return order.fulfiller === 'MERCHANT'
    ? { kind: 'MERCHANT', name: order.fulfillerStorefront?.title ?? 'Gian hàng đối tác' }
    : { kind: 'TUBU', name: 'Kho Tubu Tree' };
}
