import type { Prisma } from '@prisma/client';
import { GOMDON_CANCEL, GOMDON_CARRIER, GOMDON_STATE } from '../integrations/gomdon/gomdon-status';
import { DEALER_AWAITING_STOCK_WHERE } from '../dealer/dealer-awaiting-stock';
import { TUBU_FULFILLED_ORDER_WHERE } from '../integrations/pancake/pancake-fulfilment';

// "Cần xử lý thu gom": trạng thái vận đơn Gomdon mà KHÔNG ai tự xử lý được — tạo vận đơn thất bại /
// không rõ đã tạo / chưa cấu hình (kho phải tạo tay theo ghi chú Pancake), hoặc mã Gomdon báo huỷ /
// hoàn / hỏng / lấy-giao thất bại (xem GOMDON_PROBLEM_STATUSES trong gomdon-status.ts).
// MANUAL_HANDLED (admin bấm "Đã xử lý tay") không bao giờ nằm trong hàng đợi.

/** Chưa có vận đơn tự động — kho tạo vận đơn tay / kiểm tra tay. */
export const RECYCLING_ATTENTION_NO_WAYBILL_STATUSES: readonly string[] = [
  GOMDON_STATE.FAILED,
  GOMDON_STATE.NEEDS_MANUAL_CHECK,
  GOMDON_STATE.NOT_CONFIGURED,
];

/** Mã Gomdon báo huỷ / hoàn / hỏng / lấy-giao thất bại. */
export const RECYCLING_ATTENTION_PROBLEM_CODES: readonly string[] = ['2', '6', '8', '9', '10', '11', '12'];

/**
 * Hàng quay về / mất SAU khi lấy: đang chuyển hoàn (6), đã hoàn (8), hỏng/mất (9), hoàn thất bại (12). Vẫn là việc
 * cần làm khi đơn đã chốt "Đã giao" (chốt sớm bằng tay/Pancake rồi hàng bị hoàn: điểm đã cộng, hoa hồng đã khoá).
 */
const RECYCLING_ATTENTION_RETURN_CODES: readonly string[] = ['6', '8', '9', '12'];
const RECYCLING_ATTENTION_OPEN_ONLY_CODES: readonly string[] = RECYCLING_ATTENTION_PROBLEM_CODES.filter(
  (c) => !RECYCLING_ATTENTION_RETURN_CODES.includes(c),
);

export const RECYCLING_ATTENTION_GOMDON_STATUSES: readonly string[] = [
  ...RECYCLING_ATTENTION_NO_WAYBILL_STATUSES,
  ...RECYCLING_ATTENTION_PROBLEM_CODES,
];

/** Huỷ vận đơn không được (lỗi hết lượt retry) hoặc quá muộn (bưu tá đã lấy hàng) → CSKH phải huỷ tay. */
export const RECYCLING_ATTENTION_CANCEL_STATUSES: readonly string[] = [GOMDON_CANCEL.FAILED, GOMDON_CANCEL.TOO_LATE];

/**
 * Trạng thái vận đơn chỉ còn là việc cần làm khi ĐƠN còn mở. Đơn đã giao/huỷ/trả thì vận đơn lỗi cũ
 * không còn gì để làm (vd đơn huỷ → Gomdon báo "2 Đơn hủy" là đúng kết quả mong muốn) — để lại trong
 * hàng đợi thì danh sách "cần xử lý" đầy việc đã xong và việc thật bị chìm. Riêng lỗi HUỶ vận đơn
 * (FAILED/TOO_LATE) luôn cần xử lý, vì nó chỉ xảy ra khi đơn đã huỷ; hàng hoàn/mất (RECYCLING_ATTENTION_RETURN_CODES)
 * thì chỉ hết việc khi đơn đã huỷ/trả.
 */
const CLOSED_ORDER_STATUSES = ['DELIVERED', 'CANCELLED', 'RETURNED'] as const;
const ENDED_ORDER_STATUSES = ['CANCELLED', 'RETURNED'] as const;

/**
 * Chưa có vận đơn tự động mà hàng ĐÃ RỜI KHO (đang giao / đã giao) → kho đã tạo vận đơn tay rồi, không
 * còn "tạo vận đơn tay" để làm.
 */
const SHIPPED_OR_CLOSED_ORDER_STATUSES = ['SHIPPING', ...CLOSED_ORDER_STATUSES] as const;

export const ADMIN_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PACKED',
  'SHIPPING',
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
] as const;

export type RecyclingFilter = 'attention' | 'all';
/**
 * attention = hàng đợi "Cần xử lý Pancake" (Order.pancakeAttention — xem PancakeProcessor.flagAttention).
 * unsynced = đơn còn trong kho mà chưa lên Pancake: đang lỗi / hết lượt / quá hạn tự đẩy / chưa cấu hình, hoặc đơn
 * cũ chưa có trạng thái đồng bộ mà đã quá 15 phút. Trừ đơn đại lý còn hàng đặt trước: chưa được phép lên kho.
 */
export type PancakeFilter = 'attention' | 'unsynced';
export const PANCAKE_FILTERS: readonly PancakeFilter[] = ['attention', 'unsynced'];

const PANCAKE_UNSYNCED_STATUSES = ['PENDING', 'PUSHING', 'FAILED', 'STALE', 'NOT_CONFIGURED'];
const PANCAKE_UNSYNCED_GRACE_MS = 15 * 60_000;

export function pancakeUnsyncedWhere(now: Date = new Date()): Prisma.OrderWhereInput {
  return {
    pancakeOrderId: null,
    // D4: đơn gian hàng đối tác tự giao không bao giờ lên Pancake — không phải "chưa đồng bộ".
    ...TUBU_FULFILLED_ORDER_WHERE,
    status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'] },
    NOT: DEALER_AWAITING_STOCK_WHERE,
    OR: [
      { pancakePushStatus: { in: PANCAKE_UNSYNCED_STATUSES } },
      { pancakePushStatus: null, createdAt: { lt: new Date(now.getTime() - PANCAKE_UNSYNCED_GRACE_MS) } },
    ],
  };
}

/**
 * Đơn có yêu cầu hoá đơn VAT: pending = chưa xuất xong (REQUESTED, FAILED) mà đơn còn sống; issued = đã phát hành;
 * all = cả hai. Đơn HUỶ/TRẢ không bao giờ vào hàng chờ xuất — không code nào đổi `invoiceStatus` khi huỷ/trả, nên
 * nếu không loại ở đây chúng nằm đó mãi và CSKH không làm rỗng được hàng đợi (UI cũng không cho xuất cho các đơn này).
 * Hoá đơn ĐÃ phát hành của đơn huỷ/trả vẫn tra được ở issued/all vì kế toán còn phải điều chỉnh/huỷ hoá đơn.
 * Mọi nhánh đều có vị từ `invoiceStatus IN (...)` nên khớp partial index `orders_invoice_open_idx`.
 */
export type InvoiceFilter = 'pending' | 'issued' | 'all';
const INVOICE_OPEN_WHERE: Prisma.OrderWhereInput = {
  invoiceStatus: { in: ['REQUESTED', 'FAILED'] },
  status: { notIn: ['CANCELLED', 'RETURNED'] },
};
const INVOICE_ISSUED_WHERE: Prisma.OrderWhereInput = { invoiceStatus: 'ISSUED' };
const INVOICE_STATUS_WHERE: Record<InvoiceFilter, Prisma.OrderWhereInput> = {
  pending: INVOICE_OPEN_WHERE,
  issued: INVOICE_ISSUED_WHERE,
  all: { OR: [INVOICE_OPEN_WHERE, INVOICE_ISSUED_WHERE] },
};

export interface AdminOrderFilter {
  status?: string;
  search?: string;
  recycling?: RecyclingFilter;
  invoice?: InvoiceFilter;
  pancake?: PancakeFilter;
  /**
   * Id khách khớp `search` theo SĐT/tên, tra trước bằng index trigram trên users. Có thì lọc
   * `userId IN (...)` thay cho lọc theo quan hệ `user` — Prisma dựng quan hệ thành LEFT JOIN users và
   * OR xuyên hai bảng không dùng được index nào, Postgres phải quét toàn bảng orders.
   */
  searchUserIds?: string[];
}

/** Trigram cần ≥ 3 ký tự mới dùng được index; ngắn hơn thì tra trước chỉ tốn thêm một lượt quét users. */
export const ADMIN_SEARCH_MIN_TRGM_LENGTH = 3;
/** Khớp nhiều khách hơn mức này (tìm quá chung) thì giữ lọc theo quan hệ để không cắt bớt kết quả. */
export const ADMIN_SEARCH_USER_CAP = 1000;

export function recyclingAttentionWhere(): Prisma.OrderWhereInput {
  return {
    hasRecyclingPickup: true,
    OR: [
      {
        gomdonStatus: { in: [...RECYCLING_ATTENTION_NO_WAYBILL_STATUSES] },
        status: { notIn: [...SHIPPED_OR_CLOSED_ORDER_STATUSES] },
        // Kho đã giao bằng hãng khác (Pancake ghi mã vận đơn của hãng đó) → việc tạo vận đơn tay đã xong.
        // Mã do Gomdon ghi luôn kèm shippingPartner = BestExpress.
        OR: [{ shippingCode: null }, { shippingPartner: GOMDON_CARRIER }],
      },
      {
        gomdonStatus: { in: [...RECYCLING_ATTENTION_RETURN_CODES] },
        status: { notIn: [...ENDED_ORDER_STATUSES] },
      },
      {
        gomdonStatus: { in: [...RECYCLING_ATTENTION_OPEN_ONLY_CODES] },
        status: { notIn: [...CLOSED_ORDER_STATUSES] },
      },
      {
        gomdonCancelStatus: { in: [...RECYCLING_ATTENTION_CANCEL_STATUSES] },
        // Admin đã bấm "Đã xử lý tay" → rời hàng đợi. (`not` của Prisma loại cả NULL → ghi rõ nhánh null.)
        OR: [{ gomdonStatus: null }, { gomdonStatus: { not: GOMDON_STATE.MANUAL_HANDLED } }],
      },
      // Báo động Gomdon chưa ai xử lý (gomdon-alert.service.ts) — gồm các ca trạng thái vận đơn trông bình
      // thường nhưng nguy hiểm: Gomdon tự gắn vận đơn cho đơn đã báo "tạo tay", Pancake gắn vận đơn hãng khác.
      { gomdonAlerts: { some: { resolvedAt: null } } },
    ],
  };
}

/** Điều kiện lọc danh sách đơn admin — search và bộ lọc thu gom ghép bằng AND (cả hai đều có OR riêng). */
export function buildAdminOrderWhere(f: AdminOrderFilter): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (f.status) and.push({ status: f.status as never });
  const s = f.search?.trim();
  if (s) {
    const byUser: Prisma.OrderWhereInput[] = f.searchUserIds
      ? f.searchUserIds.length > 0
        ? [{ userId: { in: f.searchUserIds } }]
        : []
      : [{ user: { phone: { contains: s } } }, { user: { fullName: { contains: s, mode: 'insensitive' } } }];
    and.push({
      OR: [
        { code: { contains: s, mode: 'insensitive' } },
        { gomdonPartnerCode: { contains: s, mode: 'insensitive' } },
        ...byUser,
      ],
    });
  }
  if (f.recycling === 'attention') and.push(recyclingAttentionWhere());
  else if (f.recycling === 'all') and.push({ hasRecyclingPickup: true });
  if (f.invoice) and.push(INVOICE_STATUS_WHERE[f.invoice]);
  if (f.pancake === 'attention') and.push({ pancakeAttentionAt: { not: null } });
  else if (f.pancake === 'unsynced') and.push(pancakeUnsyncedWhere());
  if (and.length === 0) return {};
  return and.length === 1 ? and[0]! : { AND: and };
}
