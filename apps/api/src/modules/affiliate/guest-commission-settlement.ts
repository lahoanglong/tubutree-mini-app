import type { PaymentMethod, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Cổng chốt hoa hồng của đơn khách vãng lai web (PO A3, phương án B, 24/11/2026). Đơn khách ghi công CTV qua `?ref=` / `?l=` mà người mua
 * không qua xác minh danh tính, nên CTV có thể tự đặt đơn COD giả bằng SĐT khác rồi huỷ hay bom hàng. Hoa hồng của đơn này chỉ được chốt
 * (LOCKED → APPROVED, từ đó mới vào Ví, tính bậc và mốc thưởng) khi đủ ba điều kiện:
 *  - đơn DELIVERED (cron duyệt đã đòi, mọi đơn);
 *  - đã hết cửa sổ đổi/trả và không còn yêu cầu đổi/trả chờ duyệt (cron duyệt đã đòi, mọi đơn: hold thực ≥ `returns.window_days` tính
 *    từ lúc khoá, tức lúc đơn giao);
 *  - đơn ĐÃ THU TIỀN: trả trước đã PAID, hoặc COD còn UNPAID của đơn đã giao (bên giao thu tiền mặt lúc giao; Tubu không lật COD sang PAID).
 *    Đơn đã hoàn tiền (REFUNDED), thanh toán lỗi (FAILED), hay trả trước mà vẫn UNPAID dù đã giao thì giữ LOCKED; tiền về sau thì lượt
 *    cron kế tiếp chốt.
 * Đơn đăng nhập (`guestPhone` null) giữ luật cũ. Chặn tự giới thiệu theo SĐT của đơn khách vẫn ở checkout (`guestReferrer`).
 */
const GUEST_ORDER_PAID: Prisma.OrderWhereInput[] = [{ paymentStatus: 'PAID' }, { paymentMethod: 'COD', paymentStatus: 'UNPAID' }];

/** Điều kiện đơn của dòng hoa hồng được chốt APPROVED (`approveDueCommissions`). */
export const SETTLEABLE_ORDER_WHERE: Prisma.OrderWhereInput = {
  // Đơn phải CÒN DELIVERED ngay trong câu UPDATE chốt: duyệt trả hàng lật đơn sang RETURNED trước, phần đảo hoa hồng chạy sau.
  status: 'DELIVERED',
  OR: [{ guestPhone: null }, ...GUEST_ORDER_PAID],
};

/**
 * Đơn khách vãng lai chưa thu được tiền (phủ định `GUEST_ORDER_PAID`). Dòng hoa hồng LOCKED của đơn này không chốt theo ngày được: màn mốc
 * thưởng không tính nó vào "Đang chờ chốt", cron đêm báo admin khi nó đã quá hạn giữ.
 */
export const GUEST_ORDER_AWAITING_PAYMENT_WHERE: Prisma.OrderWhereInput = {
  guestPhone: { not: null },
  NOT: { OR: GUEST_ORDER_PAID },
};

export interface SettlementOrderFields {
  guestPhone: string | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
}

/** Đơn khách vãng lai chưa thu được tiền: khoản LOCKED của nó chưa chốt được dù đã hết hold (cùng luật `SETTLEABLE_ORDER_WHERE`). */
export function guestOrderAwaitingPayment(o: SettlementOrderFields): boolean {
  if (!o.guestPhone) return false;
  const paid = o.paymentStatus === 'PAID' || (o.paymentMethod === 'COD' && o.paymentStatus === 'UNPAID');
  return !paid;
}

/**
 * Số ngày giữ THỰC trước khi chốt hoa hồng = max(`affiliate.hold_days`, `returns.window_days`): không chốt khi khách còn trong cửa sổ gửi
 * đổi/trả, dù admin cấu hình hold ngắn hơn (khoá và mặc định giống `OrdersService.requestReturn`).
 */
export async function commissionHoldDays(config?: Pick<SystemConfigService, 'get'>): Promise<number> {
  const [holdDays, returnWindowDays] = config
    ? await Promise.all([config.get<number>('affiliate.hold_days', 10), config.get<number>('returns.window_days', 7)])
    : [10, 7];
  return Math.max(Number(holdDays) || 0, Number(returnWindowDays) || 0);
}

/**
 * Số khoản hoa hồng của đơn khách đã giao, khoá từ trước `lockedBefore` (đã quá hạn giữ) mà đơn vẫn chưa thu tiền. Các khoản này nằm LOCKED
 * mãi tới khi admin đối soát tiền đơn (xác nhận đã nhận chuyển khoản) hay huỷ hoa hồng, nên cron đêm báo số khoản cho admin.
 */
export function countGuestCommissionsAwaitingPayment(db: Pick<PrismaClient, 'commission'>, lockedBefore: Date): Promise<number> {
  return db.commission.count({
    where: { status: 'LOCKED', lockedAt: { lte: lockedBefore }, order: { status: 'DELIVERED', ...GUEST_ORDER_AWAITING_PAYMENT_WHERE } },
  });
}
