import type { Prisma } from '@prisma/client';
import { GOMDON_CANCEL, GOMDON_STATE } from '../integrations/gomdon/gomdon-status';

/**
 * "Cần xử lý thu gom": trạng thái vận đơn Gomdon mà KHÔNG ai tự xử lý được — tạo vận đơn thất bại /
 * không rõ đã tạo / chưa cấu hình (kho phải tạo tay theo ghi chú Pancake), hoặc mã Gomdon báo huỷ /
 * hoàn / hỏng / lấy-giao thất bại (xem GOMDON_PROBLEM_STATUSES trong gomdon-status.ts).
 */
export const RECYCLING_ATTENTION_GOMDON_STATUSES: readonly string[] = [
  GOMDON_STATE.FAILED,
  GOMDON_STATE.NEEDS_MANUAL_CHECK,
  GOMDON_STATE.NOT_CONFIGURED,
  '2',
  '6',
  '8',
  '9',
  '10',
  '11',
  '12',
];

/** Huỷ vận đơn không được (lỗi hết lượt retry) hoặc quá muộn (bưu tá đã lấy hàng) → CSKH phải huỷ tay. */
export const RECYCLING_ATTENTION_CANCEL_STATUSES: readonly string[] = [GOMDON_CANCEL.FAILED, GOMDON_CANCEL.TOO_LATE];

/**
 * Trạng thái vận đơn chỉ còn là việc cần làm khi ĐƠN còn mở. Đơn đã giao/huỷ/trả thì vận đơn lỗi cũ
 * không còn gì để làm (vd đơn huỷ → Gomdon báo "2 Đơn hủy" là đúng kết quả mong muốn) — để lại trong
 * hàng đợi thì danh sách "cần xử lý" đầy việc đã xong và việc thật bị chìm. Riêng lỗi HUỶ vận đơn
 * (FAILED/TOO_LATE) luôn cần xử lý, vì nó chỉ xảy ra khi đơn đã huỷ.
 */
const CLOSED_ORDER_STATUSES = ['DELIVERED', 'CANCELLED', 'RETURNED'] as const;

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

export interface AdminOrderFilter {
  status?: string;
  search?: string;
  recycling?: RecyclingFilter;
}

export function recyclingAttentionWhere(): Prisma.OrderWhereInput {
  return {
    hasRecyclingPickup: true,
    OR: [
      {
        gomdonStatus: { in: [...RECYCLING_ATTENTION_GOMDON_STATUSES] },
        status: { notIn: [...CLOSED_ORDER_STATUSES] },
      },
      { gomdonCancelStatus: { in: [...RECYCLING_ATTENTION_CANCEL_STATUSES] } },
    ],
  };
}

/** Điều kiện lọc danh sách đơn admin — search và bộ lọc thu gom ghép bằng AND (cả hai đều có OR riêng). */
export function buildAdminOrderWhere(f: AdminOrderFilter): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (f.status) and.push({ status: f.status as never });
  const s = f.search?.trim();
  if (s) {
    and.push({
      OR: [
        { code: { contains: s, mode: 'insensitive' } },
        { gomdonPartnerCode: { contains: s, mode: 'insensitive' } },
        { user: { phone: { contains: s } } },
        { user: { fullName: { contains: s, mode: 'insensitive' } } },
      ],
    });
  }
  if (f.recycling === 'attention') and.push(recyclingAttentionWhere());
  else if (f.recycling === 'all') and.push({ hasRecyclingPickup: true });
  if (and.length === 0) return {};
  return and.length === 1 ? and[0]! : { AND: and };
}
