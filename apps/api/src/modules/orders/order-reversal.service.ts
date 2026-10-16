import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma, type Order, type OrderItem } from '@prisma/client';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { CouponsService } from '../coupons/coupons.service';
import { DealerService } from '../dealer/dealer.service';
import { releaseVariationStock } from '../catalog/variation-stock';
import { revokeReferralRewardForOrder, revokeReferralRewardPartially } from '../wallet/referral-reward';
import type { ReferralNotice } from '../wallet/referral-notify';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { loadPointExpiryTxns, lotRecoverable, orderLotKey } from '../loyalty/loyalty-expiry.service';
import { canRefundToBank, WALLET_DESTINATION, type RefundDestination } from './refund-destination';
import { createBankRefund, endCustomerPayee, recordWalletRefund } from './refund-queue';
import { NO_PARTIAL_RETURNS, partialReturnTotals, type PartialReturnTotals } from './return-ledger';
import { distributeByWeight, remainingPointsBack, returnedGoods, shareOf, type ReturnShares } from './refund-allocation';
import { maskPhone } from '../../common/mask-pii';
import { paidLineTotals } from '../affiliate/commission-base';
import { hasDealerCreditDebit } from './dealer-credit-debit';

type OrderWithItems = Order & { items: OrderItem[] };

export interface ReversalOptions {
  /** Nơi khách chọn nhận tiền hoàn (D2). Mặc định Ví; chỉ đơn chuyển khoản/ZaloPay/VNPAY/COD đã thu mới về ngân hàng được. */
  destination?: RefundDestination;
  /** false = không cộng lại kho lúc này (trả hàng: chỉ cộng khi admin bấm "Đã nhận hàng về", D3). */
  restock?: boolean;
  /** Yêu cầu trả hàng đang duyệt (lần trả nốt cả đơn) — khoá chống trùng của khoản hoàn ngân hàng. */
  returnRequestId?: string;
}

/** Tiền lần đảo này trả khách và trả về đâu (để báo khách đúng số tiền, đúng nơi nhận). */
export interface RefundOutcome {
  amount: number;
  to: 'WALLET' | 'BANK' | 'END_CUSTOMER';
  /** Khoản chờ chuyển khoản vừa ghi (to = BANK). */
  refundId?: string;
}

export interface ReversalResult {
  moneyRefunded: boolean;
  pointsRefunded: number;
  refund: RefundOutcome | null;
  /** Tin báo người mời bị thu hồi thưởng giới thiệu: caller gửi SAU khi tx commit (sendReferralNotices). */
  referralNotices?: ReferralNotice[];
}

export interface PartialReversalResult {
  refund: RefundOutcome | null;
  /** Điểm Xanh đã dùng trả lại khách / điểm tích bị thu hồi thật (có thể ít hơn phần tính nếu số dư không đủ). */
  pointsBack: number;
  pointsTaken: number;
  commissionCut: number;
  /** Như ReversalResult.referralNotices. */
  referralNotices?: ReferralNotice[];
}

/** Q-03a: 1.000 xu = 1 Điểm Xanh, làm tròn lên (cùng tỉ lệ migration B quy đổi số dư). */
const XU_PER_POINT = 1000;

/**
 * Đơn đã giao có tiền thật để hoàn khi trả hàng: trả trước đã PAID (Ví/chuyển khoản/ZaloPay/VNPAY), hoặc COD (tài xế đã
 * thu lúc giao — paymentStatus COD luôn UNPAID, xem reverseFinancials). Đơn XU cũ hoàn bằng điểm ở lần đảo cả đơn.
 */
export function isMoneyBackable(order: Pick<Order, 'paymentMethod' | 'paymentStatus' | 'status'>): boolean {
  if (order.paymentMethod === 'COD') return order.status === 'DELIVERED' && order.paymentStatus === 'UNPAID';
  if (order.paymentMethod === 'XU') return false;
  return order.paymentStatus === 'PAID';
}

/**
 * Đảo ngược tác động tài chính + tồn kho của một đơn hàng khi CANCELLED/RETURNED.
 *
 * Trước đây khối "hoàn ví/điểm + restock + release flash quota" bị chép tay 2 lần
 * (orders.service.cancel, admin.service.reviewReturn) và HOÀN TOÀN THIẾU ở 3 nơi
 * khác cũng có thể đưa đơn về CANCELLED/RETURNED: admin.updateOrderStatus (generic),
 * merchant.updateMerchantOrderStatus, và pancake.processor (webhook hủy đơn từ POS).
 * Kết quả: đơn bị POS hủy → điểm/hoa hồng được đảo nhưng KHÔNG hoàn tiền, KHÔNG restock
 * (xem docs/2026-09-08-review-progress.md P0-4). Class này là nơi DUY NHẤT thực hiện
 * khối này — mọi caller (kể cả cái cũ) phải gọi qua đây.
 *
 * BẮT BUỘC gọi trong transaction, SAU KHI đã atomic-flip status thành công (updateMany
 * guard count===1) — method này không tự flip status, không tự guard race; caller chịu
 * trách nhiệm đó (xem OrderStatusService.setStatus và orders.service.cancel).
 */
@Injectable()
export class OrderReversalService {
  private readonly logger = new Logger(OrderReversalService.name);
  private dealer?: DealerService;

  constructor(
    private readonly flashSale: FlashSaleService,
    private readonly coupons: CouponsService,
    // DealerService (thu hồi thưởng quý) nằm ở DealerModule, mà DealerModule → PancakeModule →
    // OrdersModule: import thẳng DealerModule vào OrdersModule thành vòng module. Lấy lười qua
    // ModuleRef (strict:false) lúc chạy. @Optional để các test dựng tay `new OrderReversalService(
    // flash, coupons)` vẫn chạy — khi đó thiếu DealerService sẽ log lỗi to (xem resolveDealer).
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async reverseFinancials(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    opts: ReversalOptions = {},
  ): Promise<ReversalResult> {
    // Đơn đã giao có thể đã được trả một phần (D3): lần đảo cả đơn chỉ hoàn phần còn lại — tiền, điểm lô quy đổi,
    // quota flash sale, kho đã nhận về. Đơn chưa giao thì không thể có lần trả nào.
    const prior = order.status === 'DELIVERED' ? await partialReturnTotals(tx, order.id, opts.returnRequestId) : NO_PARTIAL_RETURNS;
    const refundable = Math.max(0, order.total - prior.money);
    const destination = opts.destination ?? WALLET_DESTINATION;

    // Kho và suất flash TRƯỚC mọi ghi lên dòng users (hoàn Ví/điểm): mọi đường tạo đơn (đặt đơn, CTV lên hộ, định kỳ, đại lý)
    // khoá variation → suất flash → users. Ghi users trước rồi mới cộng kho thì một lần đặt đơn tiêu điểm/trả Ví của cùng khách
    // đang giữ đúng variation/suất đó và chờ dòng users ⇒ 40P01 (checkout-reversal-lock-order.race-spec).
    await this.restoreStockAndFlash(tx, order, prior, opts);

    let refund: RefundOutcome | null = null;
    // Hoàn tiền — guard bằng updateMany, count=1 mới thực sự chi tiền, tránh hoàn 2 lần nếu bị
    // gọi lại (dù caller đã guard status, phòng thủ 2 lớp cho tiền).
    //
    // KHÔNG xét ảnh chụp `order.paymentStatus`: mọi caller đọc đơn NGOÀI tx (orders.cancel/detail,
    // OrderStatusService.setStatus, admin.reviewReturn), và giữa lần đọc đó với tx huỷ, admin xác nhận
    // chuyển khoản (POST /admin/dealer-orders/:id/confirm-payment) hoặc webhook Pancake/ZaloPay có thể
    // đã lật UNPAID → PAID. Bản cũ chỉ thử hoàn khi ảnh chụp là PAID → đơn bị huỷ mà tiền khách đã trả
    // KHÔNG được hoàn. Giờ LUÔN thử guard PAID→REFUNDED trong tx: DB (không phải ảnh chụp) quyết định có
    // hoàn hay không; đơn thật sự UNPAID thì count=0, không chi gì.
    const isPrepaidRefundable =
      order.paymentMethod === 'WALLET' ||
      order.paymentMethod === 'ZALOPAY' ||
      order.paymentMethod === 'BANK_TRANSFER' ||
      order.paymentMethod === 'VNPAY' ||
      order.paymentMethod === 'XU';

    // COD (A6-06, docs/audit-2026-09/06-web.md): đọc TOÀN BỘ hệ thống xác nhận KHÔNG có đường code
    // nào từng lật paymentStatus của đơn COD sang 'PAID' — OrderStatusService.setStatus cố ý BỎ
    // việc force-PAID khi DELIVERED (xem comment "P2-3" ở admin.service.updateOrderStatus: "Cũng bỏ
    // luôn việc tự ý force paymentStatus:'PAID' khi DELIVERED"), và PancakeProcessor.onPaymentReconcile
    // chỉ xử lý paymentMethod==='BANK_TRANSFER'. paymentStatus của đơn COD vì vậy LUÔN LÀ 'UNPAID',
    // kể cả sau khi tài xế đã thu đủ tiền mặt lúc giao — dùng nó làm điều kiện hoàn tiền (như bản cũ
    // ở trên) nghĩa là đơn COD KHÔNG BAO GIỜ được hoàn khi trả hàng, dù khách đã trả tiền thật.
    //
    // Tín hiệu ĐÚNG cho "tiền COD đã thực sự về tay Tubu" là chính `order.status` NGAY TRƯỚC lần
    // đảo này — không phải paymentStatus. Tham số `order` ở đây LUÔN là ảnh chụp state-trước-
    // transition: cả OrderStatusService.setStatus và admin.reviewReturn đều đọc đơn rồi atomic-flip
    // status bằng updateMany có guard (where status = giá trị vừa đọc), và CHỈ gọi reverseFinancials
    // SAU KHI lần flip đó thắng — nên `order.status` ở đây chắc chắn đúng bằng trạng thái thật ngay
    // trước lần đảo (không thể bị một request khác tráo giữa chừng, vì chính guard đó đã chặn).
    // Theo bảng chuyển trạng thái (order-transition.ts), DELIVERED chỉ có 1 đường tiếp là RETURNED —
    // nên order.status==='DELIVERED' ở đây tương đương "tài xế đã thu tiền COD". Huỷ đơn COD từ bất
    // kỳ mốc nào TRƯỚC DELIVERED (PENDING_PAYMENT..SHIPPING) thì tiền chưa từng thu — đúng là không
    // có gì để hoàn.
    const isCodCollected = order.paymentMethod === 'COD' && order.status === 'DELIVERED';
    const isRefundableChannel = isPrepaidRefundable || isCodCollected;

    // Đơn có THỰC SỰ đang PAID ngay trước lần đảo không — guard thắng (count=1) là bằng chứng
    // trong CÙNG tx; ảnh chụp `order.paymentStatus` đọc trước đó có thể đã cũ. Dùng cho thu hồi
    // thưởng quý đại lý (đơn trả trước chỉ được tính doanh số khi đã PAID) — đơn đại lý luôn
    // BANK_TRANSFER, không bao giờ COD, nên nhánh COD dưới đây không ảnh hưởng gì tới nó. Phương
    // thức lạ (ngoài danh sách hoàn tự động) chỉ còn ảnh chụp để dựa vào.
    let paidBeforeReversal = !isRefundableChannel && order.paymentStatus === 'PAID';
    // true khi lần đảo NÀY thực sự cộng tiền (> 0đ) vào Ví của khách — caller (vd admin.reviewReturn) dùng
    // để quyết định có được báo khách "đã hoàn tiền vào Ví" hay không (A6-06 phần thông báo): không được
    // báo nếu guard dưới đây thua, hay đơn 0đ (guard vẫn thắng nhưng refundToWallet không có gì để cộng).
    let moneyRefunded = false;
    // Điểm Xanh lần đảo NÀY hoàn trong tx (lô CONVERTED + đơn XU cũ) để caller báo "đã hoàn N Điểm Xanh".
    // Phần STANDARD hoàn ở LoyaltyService.reverseOrderPoints (ngoài tx) nên không tính ở đây.
    let pointsRefunded = 0;
    if (isRefundableChannel) {
      // Đơn đại lý ghi công nợ: khách không trả đồng nào qua Ví/chuyển khoản — "hoàn" chính là dòng đảo công nợ ở
      // reverseDealerCredit. Cộng thêm Ví (đơn lỡ bị lật PAID) là trả đại lý hai lần.
      const onDealerCredit = await hasDealerCreditDebit(tx, order);
      const refunded = await tx.order.updateMany({
        where: isCodCollected
          ? // COD không có "PAID" thật để guard theo — dùng chính paymentStatus='UNPAID' (trạng
            // thái COD luôn giữ cho tới đây) làm điều kiện một-lần: gọi lại sau khi đã REFUNDED sẽ
            // count=0, không hoàn 2 lần. paymentMethod='COD' thêm vào cho chắc (phòng thủ 2 lớp).
            { id: order.id, paymentMethod: 'COD', paymentStatus: 'UNPAID' }
          : { id: order.id, paymentStatus: 'PAID' },
        data: { paymentStatus: 'REFUNDED' },
      });
      paidBeforeReversal = refunded.count === 1;
      if (refunded.count === 1 && order.paymentMethod === 'XU') {
        // Đơn XU tạo trước PD-3. Xu không ra tiền (Q-03a) nên không hoàn Ví, kể cả nhánh lên hộ (lên hộ
        // chưa từng nhận XU, place-order-for-customer.dto.ts).
        if (order.placedForCustomer) {
          this.logger.error(`Đơn lên hộ ${order.code} trả bằng XU (không được phép): hoàn Điểm Xanh cho chủ đơn, kiểm tra tay.`);
        }
        pointsRefunded += await this.refundLegacyXuAsPoints(tx, order);
      } else if (refunded.count === 1 && onDealerCredit) {
        this.logger.warn(
          `Đơn đại lý ghi công nợ ${order.code} đang ${order.paymentStatus}: không hoàn Ví, chỉ đảo công nợ. Nếu đại lý đã chuyển khoản thật cho đơn này, đối soát tay.`,
        );
      } else if (refunded.count === 1 && order.placedForCustomer) {
        // Đơn CTV lên hộ: người trả tiền là khách cuối, không phải CTV (C-001). Caller báo "đã hoàn
        // vào Ví" cho order.userId, nên chỉ để true khi chính người đó là ví vừa được cộng.
        const creditedUserId = await this.refundEndCustomer(tx, order, refundable);
        moneyRefunded = creditedUserId === order.userId && refundable > 0;
        if (refundable > 0) refund = { amount: refundable, to: 'END_CUSTOMER' };
      } else if (refunded.count === 1 && destination.method === 'BANK' && canRefundToBank(order.paymentMethod) && refundable > 0) {
        // D2: khách chọn nhận về tài khoản ngân hàng — ghi khoản chờ admin chuyển tay (miễn phí, không tối thiểu).
        const row = await createBankRefund(tx, {
          order,
          kind: order.status === 'DELIVERED' ? 'RETURN' : 'CANCEL',
          refKey: opts.returnRequestId,
          amount: refundable,
          bank: destination.bank,
          reason: order.status === 'DELIVERED' ? 'RETURNED' : 'CANCELLED',
        });
        refund = { amount: refundable, to: 'BANK', refundId: row.id };
      } else if (refunded.count === 1) {
        // Mặc định và mọi đơn trả bằng Ví: hoàn về Ví Tubu ngay.
        moneyRefunded = await this.refundToWallet(tx, order.userId, order, refundable);
        if (moneyRefunded) {
          refund = { amount: refundable, to: 'WALLET' };
          const returned = order.status === 'DELIVERED';
          await recordWalletRefund(tx, {
            order,
            kind: returned ? 'RETURN' : 'CANCEL',
            refKey: opts.returnRequestId,
            amount: refundable,
            reason: returned ? 'RETURNED' : 'CANCELLED',
          });
        }
      }
    }

    // Điểm Xanh lô quy đổi đã tiêu cho đơn này là TIỀN TRẢ TRƯỚC (Q-03a) nên hoàn trong CÙNG tx với lần lật trạng
    // thái, như xu/Ví trước PD-3. Để ở LoyaltyService.reverseOrderPoints (chạy sau commit) thì nó ném lỗi
    // (đứt DB, SIGTERM lúc deploy) là đơn đã CANCELLED mà khách mất điểm vĩnh viễn: không có đường thử lại.
    pointsRefunded += await this.refundConvertedPoints(tx, order, prior);

    // Hoàn coupon — trước đây thiếu bước này: voucher usageLimit=1 (birthday/welcome/referral)
    // bị đốt vĩnh viễn cho một đơn đã hủy/trả (P1, docs/2026-09-08-review-progress.md).
    await this.releaseCoupon(tx, order);

    // Đảo công nợ đại lý. Đơn đại lý "Ghi công nợ" tạo dòng DealerCreditLedger dương lúc đặt;
    // huỷ/trả đơn mà không đảo thì đại lý vẫn NỢ tiền một đơn không còn tồn tại, và khoản nợ ảo
    // đó tiếp tục ăn vào hạn mức nên chặn luôn các đơn sau. Không dùng delete để giữ vết sổ sách.
    await this.reverseDealerCredit(tx, order);

    // Thu hồi thưởng doanh số quý nếu quý của đơn đã được trả thưởng (cron ngày 10 quý sau) — chạy
    // SAU CÙNG để dealerVolume (đọc qua tx) thấy đơn đã lật trạng thái/REFUNDED. `order` là ảnh chụp
    // TRƯỚC lần lật (status cũ) — DealerService dùng nó + paidBeforeReversal để biết đơn có đang được
    // tính vào doanh số đã chốt không (chỉ thu phần biên của đơn đó). Lỗi DB ở đây phải ném ra:
    // transaction Postgres đã hỏng thì cả lần huỷ đơn rollback, không để tiền lệch.
    if (order.type === 'DEALER') {
      const dealer = this.resolveDealer();
      if (dealer) {
        await dealer.clawbackQuarterBonusForOrder(tx, order, { paidBeforeReversal });
      } else {
        this.logger.error(
          `DealerService chưa wiring — KHÔNG thu hồi được thưởng quý cho đơn đại lý ${order.code} bị huỷ/trả. Cần đối soát tay.`,
        );
      }
    }

    // Thưởng giới thiệu chỉ cấp từ đơn đã giao (đơn lẻ, không phải lên hộ), nên chỉ đơn trả hàng
    // (ảnh chụp trước lần lật = DELIVERED) mới có thể là đơn đã dùng để thưởng. Thu hồi trong cùng tx
    // để lần trả hàng và việc trừ điểm người mời commit/rollback cùng nhau.
    let referralNotices: ReferralNotice[] = [];
    if (order.status === 'DELIVERED' && order.type === 'RETAIL' && !order.placedForCustomer) {
      const revoked = await revokeReferralRewardForOrder(tx, order);
      if (revoked?.shortfall) {
        this.logger.warn(
          `Thu hồi thưởng giới thiệu đơn ${order.code}: người mời chỉ còn ${revoked.revoked} điểm, thiếu ${revoked.shortfall} điểm (đã ghi REFERRAL_DEBT).`,
        );
      }
      referralNotices = revoked?.notices ?? [];
    }
    return { moneyRefunded, pointsRefunded, refund, referralNotices };
  }

  /**
   * Hoàn stock + release quota flash-sale — không có guard idempotency riêng ở đây vì caller (status flip atomic) đảm bảo
   * reverseFinancials chỉ chạy đúng 1 lần cho mỗi đơn.
   */
  private async restoreStockAndFlash(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    prior: PartialReturnTotals,
    opts: ReversalOptions,
  ): Promise<void> {
    // Dòng đặt trước: ĐỌC LẠI backorderedQty dưới khoá dòng. Ảnh chụp `order.items` của caller có
    // thể cũ — cron DealerBackorderService.reconcile vừa lấp hàng (giữ kho + giảm backorderedQty)
    // sau lúc caller đọc đơn; dùng số cũ thì phần vừa giữ không bao giờ được hoàn → kẹt kho. Khoá
    // FOR UPDATE còn làm guard `backorderedQty = <đã đọc>` của cron chờ rồi trượt (tự trả phần giữ).
    const boIds = order.items.filter((i) => i.backorderedQty > 0).map((i) => i.id);
    const freshBackorder = new Map<string, number>();
    if (boIds.length > 0) {
      const rows = await tx.$queryRaw<{ id: string; backorderedQty: number }[]>`
        SELECT "id", "backorderedQty" FROM "order_items" WHERE "id" IN (${Prisma.join(boIds)}) FOR UPDATE`;
      for (const r of rows) freshBackorder.set(r.id, Number(r.backorderedQty));
    }

    for (const item of order.items) {
      // Đơn đại lý đặt trước (backorder) có thể còn `backorderedQty` > 0 — phần đó CHƯA BAO
      // GIỜ được giữ từ kho thật (xem DealerService.placeOrder), nên chỉ hoàn đúng phần đã
      // giữ (`quantity - backorderedQty`). Hoàn nguyên `quantity` sẽ CỘNG KHỐNG phần chưa từng
      // trừ — tồn kho tăng ảo đúng bằng số đặt trước của đơn bị huỷ.
      // Đơn vị của lần trả một phần đã duyệt không cộng ở đây dù đã nhận về hay chưa: đã nhận thì markReceived cộng
      // rồi, chưa nhận thì markReceived sẽ cộng khi hàng về.
      const backordered = freshBackorder.get(item.id) ?? item.backorderedQty;
      const reserved = item.quantity - backordered - (prior.approvedQty.get(item.id) ?? 0);
      if (opts.restock !== false && reserved > 0) await releaseVariationStock(tx, item.variationId, reserved);
      // Đơn đã chết thì không còn nhu cầu backorder nữa — xoá cờ để DealerBackorderService
      // (quét theo `backorderedQty > 0`) không tốn công lấp hàng cho một đơn không tồn tại nữa.
      if (backordered > 0) {
        await tx.orderItem.update({ where: { id: item.id }, data: { backorderedQty: 0 } });
      }
      const flashQty = item.quantity - (prior.approvedQty.get(item.id) ?? 0);
      if (item.flashSaleItemId && flashQty > 0) {
        await this.flashSale.restore(tx, item.flashSaleItemId, order.userId, flashQty);
      }
    }
  }

  /**
   * Trả MỘT PHẦN đơn đã giao (D3): hoàn tiền phần của các dòng trả (sau phân bổ giảm giá/điểm, cộng phí ship nếu lỗi do
   * shop) về nơi khách chọn, trả lại Điểm Xanh đã dùng theo phần, thu hồi Điểm Xanh tích và giảm hoa hồng CTV cùng tỉ
   * lệ, hoàn quota flash sale của số đơn vị trả, thu hồi thưởng giới thiệu theo tỷ lệ nếu đơn đã dùng để thưởng. KHÔNG cộng kho (chỉ khi admin bấm "Đã nhận hàng về") và KHÔNG đổi
   * trạng thái đơn (vẫn DELIVERED).
   *
   * Gọi trong tx, SAU KHI caller đã lật yêu cầu REQUESTED → APPROVED bằng guard atomic và khoá dòng đơn — guard đó là
   * điều kiện một-lần; sổ Ví (userId, type, refId=yêu cầu) và points_transactions_return_request_unique là lớp hai.
   */
  async reversePartialReturn(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    input: {
      requestId: string;
      shares: ReturnShares;
      destination: RefundDestination;
      prior: PartialReturnTotals;
      /** Hạn của điểm thường trả lại (đọc cấu hình ngoài tx). */
      standardPointsExpiresAt: Date | null;
    },
  ): Promise<PartialReversalResult> {
    const { shares, requestId } = input;
    const result: PartialReversalResult = { refund: null, pointsBack: 0, pointsTaken: 0, commissionCut: 0 };

    // Suất flash trước mọi ghi lên dòng users, cùng thứ tự với đường tạo đơn (xem reverseFinancials).
    const byId = new Map(order.items.map((i) => [i.id, i]));
    for (const line of shares.lines) {
      const item = byId.get(line.orderItemId);
      if (item?.flashSaleItemId && line.quantity > 0) {
        await this.flashSale.restore(tx, item.flashSaleItemId, order.userId, line.quantity);
      }
    }

    const amount = shares.goods + shares.shipping;
    if (amount > 0 && isMoneyBackable(order)) {
      if (order.placedForCustomer) {
        await this.refundEndCustomer(tx, order, amount, { kind: 'RETURN', refKey: requestId });
        result.refund = { amount, to: 'END_CUSTOMER' };
      } else if (input.destination.method === 'BANK' && canRefundToBank(order.paymentMethod)) {
        const row = await createBankRefund(tx, {
          order,
          kind: 'RETURN',
          refKey: requestId,
          amount,
          bank: input.destination.bank,
          reason: 'RETURNED',
        });
        result.refund = { amount, to: 'BANK', refundId: row.id };
      } else {
        await this.creditReturnToWallet(tx, order.userId, order, amount, requestId);
        await recordWalletRefund(tx, { order, kind: 'RETURN', refKey: requestId, amount, reason: 'RETURNED' });
        result.refund = { amount, to: 'WALLET' };
      }
    } else if (amount > 0) {
      this.logger.warn(`Trả một phần đơn ${order.code} (${order.paymentMethod}/${order.paymentStatus}): không có khoản đã thu để hoàn ${amount}đ.`);
    }

    const converted = Math.min(shares.convertedBack, shares.pointsUsedBack);
    if (converted > 0) {
      const res = await applyPointsDelta(tx, {
        userId: order.userId,
        delta: converted,
        lot: 'CONVERTED',
        reason: `RETURN_REFUND_CONVERTED:${order.code}`,
        refType: 'RETURN_REQUEST',
        refId: requestId,
        skipDuplicates: true,
      });
      if (res.applied) result.pointsBack += converted;
    }
    const standard = shares.pointsUsedBack - converted;
    if (standard > 0) {
      const res = await applyPointsDelta(tx, {
        userId: order.userId,
        delta: standard,
        lot: 'STANDARD',
        reason: `RETURN_REFUND_POINTS:${order.code}`,
        refType: 'RETURN_REQUEST',
        refId: requestId,
        expiresAt: input.standardPointsExpiresAt,
        skipDuplicates: true,
      });
      if (res.applied) result.pointsBack += standard;
    }

    // Điểm tích chỉ có sau khi đơn được cộng điểm lúc giao; thu hồi tối đa bằng số dư (như lần đảo cả đơn).
    if (shares.pointsEarnedBack > 0) {
      const credited = await tx.pointsTransaction.findFirst({
        where: { userId: order.userId, reason: `ORDER_DELIVERED:${order.code}` },
        select: { id: true },
      });
      if (credited) {
        // NO KEY UPDATE, không phải UPDATE: tx này đã UPDATE users (hoàn Ví/Điểm Xanh ở trên) nên đang giữ NO KEY UPDATE, và mọi
        // đường ghi số dư cũng lấy NO KEY UPDATE qua UPDATE nên đọc ở mức này vẫn xếp hàng sau chúng. FOR UPDATE nâng khoá đang
        // giữ lên mức mạnh hơn nên phải xếp hàng sau tx khác đang chờ khoá dòng này (huỷ đơn trả bằng Ví chờ NO KEY UPDATE của
        // ta), còn tx đó chờ ta xong ⇒ 40P01; nó còn đụng KEY SHARE của FK dòng sổ điểm/ví của tx cùng khách (creditOrderPoints
        // lúc giao đơn khác) đang chờ NO KEY UPDATE của ta.
        const [u] = await tx.$queryRaw<{ pointsBalance: number }[]>`
          SELECT "pointsBalance" FROM "users" WHERE "id" = ${order.userId} FOR NO KEY UPDATE`;
        // Như reverseOrderPoints: không quá phần lô điểm của đơn còn thu hồi được (trừ phần cron đã trừ vì hết hạn và phần các
        // lần trả trước đã lấy), nếu không lô đơn đã hết hạn thì phần trả ăn sang điểm của lô khác. Đọc sổ sau khoá user ở trên.
        // Cột pointsReversed của yêu cầu vẫn ghi phần chia chưa kẹp (caller), chỉ số thực trừ bị kẹp.
        const recoverable = lotRecoverable(await loadPointExpiryTxns(tx, order.userId), orderLotKey(order.id));
        const take = Math.min(shares.pointsEarnedBack, recoverable ?? shares.pointsEarnedBack, Math.max(0, u?.pointsBalance ?? 0));
        if (take > 0) {
          const res = await applyPointsDelta(tx, {
            userId: order.userId,
            delta: -take,
            lot: 'STANDARD',
            reason: `RETURN_REVERSED:${order.code}`,
            refType: 'RETURN_REQUEST',
            refId: requestId,
          });
          if (res.applied) result.pointsTaken = take;
        }
      }
    }

    // Hoa hồng CTV còn chờ (PENDING/LOCKED) giảm đúng phần của các dòng trả, theo mức % của chính dòng đó (R2-MONEY-1):
    // trả món 10% thì cắt hoa hồng món đó, trả món 0% thì không cắt gì. Mỗi dòng tính luỹ kế sau trừ luỹ kế trước nên trả
    // nốt một dòng cắt đúng bằng hoa hồng của dòng. Đã duyệt/đã chi thì không đụng — giống lần đảo cả đơn
    // (reverseCommissionsForOrder chỉ huỷ PENDING/LOCKED).
    // Nền doanh số bậc/mốc (commissionableTotal) giảm cùng lúc, đúng phần tiền khách thực trả của các đơn vị trả trên những
    // dòng có hoa hồng — cùng nền createCommissionForOrder cộng lúc đặt; nếu không, đơn 80tr chỉ còn một món rẻ sau khi trả
    // vẫn tính đủ 80tr vào mốc thưởng tháng khi hoa hồng được duyệt.
    const rows = await tx.commission.findMany({
      where: { orderId: order.id, status: { in: ['PENDING', 'LOCKED'] } },
      select: { id: true, amount: true, commissionableTotal: true, lineAmounts: true },
    });
    const itemById = new Map(order.items.map((i) => [i.id, i]));
    const paid = paidLineTotals(order, order.items);
    const paidById = new Map(order.items.map((it, idx) => [it.id, paid[idx] ?? 0]));
    for (const row of rows) {
      const perLine = await this.commissionByLine(tx, order, row, input.prior.commissionReversed);
      const commissionable = this.commissionableLineIds(row, perLine);
      let cut = 0;
      let baseCut = 0;
      for (const line of shares.lines) {
        const item = itemById.get(line.orderItemId);
        if (!item || item.quantity <= 0 || line.quantity <= 0 || !commissionable.has(item.id)) continue;
        const approvedQty = Math.min(item.quantity, input.prior.approvedQty.get(item.id) ?? 0);
        const before = approvedQty / item.quantity;
        const after = Math.min(item.quantity, approvedQty + line.quantity) / item.quantity;
        const lineCommission = perLine.get(item.id) ?? 0;
        cut += Math.max(0, shareOf(lineCommission, after) - shareOf(lineCommission, before));
        const base = paidById.get(item.id) ?? 0;
        baseCut += Math.max(0, shareOf(base, after) - shareOf(base, before));
      }
      cut = Math.min(row.amount, cut);
      baseCut = Math.min(row.commissionableTotal, baseCut);
      if (cut <= 0 && baseCut <= 0) continue;
      const res = await tx.commission.updateMany({
        where: {
          id: row.id,
          amount: row.amount,
          commissionableTotal: row.commissionableTotal,
          status: { in: ['PENDING', 'LOCKED'] },
        },
        data: { amount: { decrement: cut }, commissionableTotal: { decrement: baseCut } },
      });
      if (res.count === 1) result.commissionCut += cut;
    }

    // Thưởng giới thiệu thu hồi theo tỷ lệ tiền hàng đã trả luỹ kế của đơn (gồm yêu cầu này), cùng điều kiện với nhánh trả cả
    // đơn ở reverseFinancials.
    if (order.status === 'DELIVERED' && order.type === 'RETAIL' && !order.placedForCustomer) {
      const returnedQty = new Map(input.prior.approvedQty);
      for (const line of shares.lines) returnedQty.set(line.orderItemId, (returnedQty.get(line.orderItemId) ?? 0) + line.quantity);
      const goods = returnedGoods(order, returnedQty);
      const revoked = await revokeReferralRewardPartially(tx, order, {
        requestId,
        returnedGoods: goods.returned,
        orderGoods: goods.goods,
      });
      if (revoked?.shortfall) {
        this.logger.warn(
          `Thu hồi một phần thưởng giới thiệu đơn ${order.code}: người mời chỉ còn ${revoked.revoked} điểm, thiếu ${revoked.shortfall} điểm (đã ghi REFERRAL_DEBT).`,
        );
      }
      result.referralNotices = revoked?.notices ?? [];
    }
    return result;
  }

  /**
   * Các dòng có hoa hồng (mức % > 0 lúc đặt) — tập dòng mà nền doanh số commissionableTotal cộng lúc tạo. Hoa hồng tạo từ khi
   * lineAmounts ghi mọi dòng có mức % > 0 (kể cả dòng hoa hồng làm tròn về 0) thì lấy đúng tập đó; hoa hồng cũ chỉ có các dòng
   * hoa hồng > 0 nên lấy theo phần chia đã tính.
   */
  private commissionableLineIds(row: { lineAmounts: Prisma.JsonValue | null }, perLine: Map<string, number>): Set<string> {
    const stored = row.lineAmounts;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) return new Set(Object.keys(stored));
    return new Set([...perLine].filter(([, amount]) => amount > 0).map(([id]) => id));
  }

  /**
   * Hoa hồng ban đầu của từng dòng. Hoa hồng tạo từ khi có cột lineAmounts lưu sẵn (mức % lúc đặt). Hoa hồng cũ thì chia
   * số ban đầu (còn lại + đã cắt ở các lần trả trước) theo hoa hồng tính lại bằng mức % hiện tại của biến thể; không dòng
   * nào còn mức % thì chia theo giá trị dòng như trước.
   */
  private async commissionByLine(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    row: { amount: number; lineAmounts: Prisma.JsonValue | null },
    priorReversed: number,
  ): Promise<Map<string, number>> {
    const stored = row.lineAmounts;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const out = new Map<string, number>();
      for (const [id, v] of Object.entries(stored)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) out.set(id, Math.floor(n));
      }
      return out;
    }
    const original = row.amount + priorReversed;
    const variations = await tx.variation.findMany({
      where: { id: { in: order.items.map((i) => i.variationId) } },
      select: { id: true, affiliateRate: true, product: { select: { affiliateBlocked: true } } },
    });
    const rate = new Map(variations.map((v) => [v.id, v.product?.affiliateBlocked ? 0 : v.affiliateRate ? Number(v.affiliateRate) : 0]));
    const paid = paidLineTotals(order, order.items);
    let weights = order.items.map((it, idx) => Math.floor(((paid[idx] ?? 0) * (rate.get(it.variationId) ?? 0)) / 100));
    if (weights.every((w) => w <= 0)) weights = paid;
    const split = distributeByWeight(original, weights);
    return new Map(order.items.map((it, idx) => [it.id, split[idx] ?? 0]));
  }

  /**
   * Cộng lại kho các dòng của một yêu cầu trả khi admin xác nhận đã nhận hàng về (D3). Không vượt số đã thực trừ kho
   * của dòng (trừ phần đặt trước chưa từng giữ và phần đã cộng lại ở lần nhận trước).
   */
  async restockReturnedItems(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    lines: { orderItemId: string; quantity: number }[],
    alreadyRestocked: ReadonlyMap<string, number>,
  ): Promise<number> {
    const byId = new Map(order.items.map((i) => [i.id, i]));
    let restocked = 0;
    for (const line of lines) {
      const item = byId.get(line.orderItemId);
      if (!item) continue;
      const cap = item.quantity - item.backorderedQty - (alreadyRestocked.get(item.id) ?? 0);
      const qty = Math.min(line.quantity, cap);
      if (qty > 0) {
        await releaseVariationStock(tx, item.variationId, qty);
        restocked += qty;
      }
    }
    return restocked;
  }

  /** Mỗi yêu cầu trả một dòng sổ Ví riêng (refId = yêu cầu): trả nhiều lần cùng đơn không đụng khoá (userId, type, refId). */
  private async creditReturnToWallet(
    tx: Prisma.TransactionClient,
    userId: string,
    order: OrderWithItems,
    amount: number,
    requestId: string,
  ): Promise<void> {
    if (amount <= 0) return;
    await applyWalletDelta(tx, {
      userId,
      delta: amount,
      type: 'ORDER_REFUND',
      refType: 'RETURN_REQUEST',
      refId: requestId,
      reason: `Hoàn tiền trả hàng đơn ${order.code}`,
    });
  }

  /**
   * Lần đặt bị tách theo nơi giao chia phần giảm của mã cho mọi đơn con nhưng lượt dùng mã chỉ gắn đơn đầu. Trả lượt khi đơn
   * đầu bị huỷ mà đơn gian hàng còn sống thì mã dùng lại được trong khi đơn kia vẫn giữ phần giảm, nên chỉ trả khi mọi đơn của
   * nhóm đã huỷ/trả. Khoá theo nhóm: hai đơn con huỷ cùng lúc thì lần sau thấy lần trước đã commit, đúng một lần trả.
   */
  private async releaseCoupon(tx: Prisma.TransactionClient, order: OrderWithItems): Promise<void> {
    if (!order.checkoutGroup) {
      await this.coupons.release(order.couponCode, order.id, tx);
      return;
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout-group-coupon:${order.checkoutGroup}`}))`;
    const group = await tx.order.findMany({
      where: { checkoutGroup: order.checkoutGroup },
      select: { id: true, status: true, couponCode: true },
    });
    const live = group.some((o) => o.id !== order.id && o.status !== 'CANCELLED' && o.status !== 'RETURNED');
    if (live) return;
    const holder = group.find((o) => o.couponCode);
    if (holder) await this.coupons.release(holder.couponCode, holder.id, tx);
  }

  /**
   * PD-3 (spec 6.2): hoàn đơn XU cũ bằng ceil(total/1000) Điểm Xanh lô CONVERTED (không hết hạn).
   * Guard một lần là PAID→REFUNDED của caller; khoá `points_transactions_converted_refund_unique`
   * là lớp hai (dòng đã có → không cộng, không làm hỏng tx).
   */
  private async refundLegacyXuAsPoints(tx: Prisma.TransactionClient, order: OrderWithItems): Promise<number> {
    const points = Math.ceil(order.total / XU_PER_POINT);
    if (points <= 0) return 0;
    const res = await applyPointsDelta(tx, {
      userId: order.userId,
      delta: points,
      lot: 'CONVERTED',
      reason: `ORDER_REFUND_XU:${order.code}`,
      refType: 'ORDER',
      refId: order.id,
      skipDuplicates: true,
    });
    if (!res.applied) {
      this.logger.warn(`Đơn XU ${order.code} đã có dòng ORDER_REFUND_XU, bỏ qua hoàn lần 2.`);
      return 0;
    }
    return points;
  }

  /**
   * Hoàn phần Điểm Xanh lô CONVERTED mà đơn đã tiêu (`orders.pointsUsedConverted`) về đúng lô, không hết hạn.
   * Một lần: caller đã lật trạng thái đơn bằng guard atomic; `points_transactions_converted_refund_unique`
   * (reason `ORDER_REFUND_CONVERTED:<code>`) là lớp hai, dòng đã có thì skipDuplicates không cộng.
   * Sau các lần trả một phần chỉ hoàn phần còn lại, không quá phần điểm đã dùng chưa trả (remainingPointsBack).
   */
  private async refundConvertedPoints(tx: Prisma.TransactionClient, order: OrderWithItems, prior: PartialReturnTotals): Promise<number> {
    const points = remainingPointsBack(order, prior).converted;
    if (!(points > 0)) return 0;
    const res = await applyPointsDelta(tx, {
      userId: order.userId,
      delta: points,
      lot: 'CONVERTED',
      reason: `ORDER_REFUND_CONVERTED:${order.code}`,
      refType: 'ORDER',
      refId: order.id,
      skipDuplicates: true,
    });
    if (!res.applied) {
      this.logger.warn(`Đơn ${order.code} đã có dòng ORDER_REFUND_CONVERTED, bỏ qua hoàn lô quy đổi lần 2.`);
      return 0;
    }
    return points;
  }

  /** true khi thực sự cộng tiền vào Ví (đơn 0đ không có gì để hoàn). */
  private async refundToWallet(
    tx: Prisma.TransactionClient,
    userId: string,
    order: OrderWithItems,
    amount: number = order.total,
  ): Promise<boolean> {
    if (amount <= 0) return false;
    await applyWalletDelta(tx, {
      userId,
      delta: amount,
      type: 'ORDER_REFUND',
      refType: 'ORDER',
      refId: order.id,
      reason: `Hoàn tiền đơn ${order.code}`,
    });
    return true;
  }

  /**
   * Đích hoàn tiền của đơn CTV lên hộ. Khách cuối có tài khoản (đơn đã ghi userId = khách, hoặc
   * SĐT người nhận khớp User.phone) → cộng ví khách đó; không thì để lại yêu cầu chuyển khoản tay cho
   * admin. Tài khoản trùng CTV/người giới thiệu (CTV gõ SĐT của chính mình) hoặc bị khoá không bao
   * giờ nhận — tiền đi đường thủ công để admin xác minh người trả thật.
   * orderId unique trên order_customer_refunds: lần gọi thứ hai cho cùng đơn ném P2002 → tx rollback,
   * không thể hoàn 2 lần dù guard PAID→REFUNDED phía trên bị lách.
   */
  private async refundEndCustomer(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    amount: number = order.total,
    ref: { kind: 'END_CUSTOMER' | 'RETURN'; refKey: string } = { kind: 'END_CUSTOMER', refKey: '' },
  ): Promise<string | null> {
    const { phone, recipientName } = endCustomerPayee(order);
    const ctvId = order.referrerUserId ?? order.userId;

    let customerUserId: string | null = null;
    if (order.userId !== ctvId) {
      customerUserId = order.userId;
    } else if (phone) {
      const match = await tx.user.findUnique({ where: { phone }, select: { id: true } });
      customerUserId = match?.id ?? null;
    }
    if (customerUserId) {
      const customer = await tx.user.findUnique({ where: { id: customerUserId }, select: { isBlocked: true } });
      if (!customer || customer.isBlocked || customerUserId === ctvId) customerUserId = null;
    }

    const reason = order.status === 'DELIVERED' ? 'RETURNED' : 'CANCELLED';
    if (customerUserId) {
      if (ref.kind === 'RETURN') await this.creditReturnToWallet(tx, customerUserId, order, amount, ref.refKey);
      else await this.refundToWallet(tx, customerUserId, order, amount);
    }
    await tx.orderCustomerRefund.create({
      data: {
        orderId: order.id,
        orderCode: order.code,
        kind: ref.kind,
        refKey: ref.refKey,
        amount,
        phone,
        recipientName,
        customerUserId,
        method: customerUserId ? 'WALLET' : 'MANUAL_TRANSFER',
        status: customerUserId ? 'COMPLETED' : 'PENDING',
        completedAt: customerUserId ? new Date() : null,
        reason,
      },
    });
    if (!customerUserId) {
      this.logger.warn(`Đơn hộ ${order.code} cần admin chuyển khoản hoàn ${amount}đ cho khách ${maskPhone(phone)}.`);
    }
    return customerUserId;
  }

  private resolveDealer(): DealerService | undefined {
    if (this.dealer) return this.dealer;
    try {
      this.dealer = this.moduleRef?.get(DealerService, { strict: false });
    } catch {
      this.dealer = undefined; // provider không có trong app (test dựng module thiếu) → caller log lỗi
    }
    return this.dealer;
  }

  /**
   * Idempotent nhờ unique (userId, refType, refId) trên DealerCreditLedger: dòng đối ứng dùng
   * refType='ORDER_CANCEL' + refId=order.id nên gọi lại không thể tạo dòng thứ hai.
   * Đơn "Trả trước" không có dòng ghi nợ nào → không đụng sổ.
   */
  private async reverseDealerCredit(tx: Prisma.TransactionClient, order: OrderWithItems): Promise<void> {
    if (order.type !== 'DEALER') return;
    const already = await tx.dealerCreditLedger.findFirst({
      where: { userId: order.userId, refType: 'ORDER_CANCEL', refId: order.id },
    });
    if (already) return;
    const debit = await tx.dealerCreditLedger.findFirst({
      where: { userId: order.userId, refType: 'ORDER', refId: order.id },
    });
    if (!debit || debit.delta === 0) return;
    await tx.dealerCreditLedger.create({
      data: {
        userId: order.userId,
        delta: -debit.delta,
        refType: 'ORDER_CANCEL',
        refId: order.id,
        note: `Huỷ đơn ${order.code}`,
      },
    });
  }
}
