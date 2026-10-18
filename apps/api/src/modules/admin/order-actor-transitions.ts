import type { OrderStatus } from '@prisma/client';
import { isStaffPermission, type StaffPermission } from '../../common/staff-permissions';

export interface OrderActor {
  role?: string;
  staffPermissions?: readonly string[];
}

/**
 * Nút trạng thái tay theo nhóm việc: CSKH huỷ theo yêu cầu khách (luật D1 bàn giao vẫn áp ở OrderStatusService),
 * KHO đánh dấu đã đóng gói. Giao vận/Đã giao do Pancake báo về; tay chỉ ADMIN — một cú bấm DELIVERED nhầm kích hoạt
 * điểm, hoa hồng, doanh thu và mở đường "trả hàng" lấy tiền ví cho đơn COD chưa thu đồng nào.
 */
const STAFF_TRANSITIONS: Record<StaffPermission, readonly OrderStatus[]> = {
  CSKH: ['CANCELLED'],
  KHO: ['PACKED'],
  MARKETING: [],
  KE_TOAN: [],
};

const CARRIER_STATUSES: readonly string[] = ['SHIPPING', 'DELIVERED'];

/**
 * Người xem danh sách/lịch sử đơn thấy SĐT đầy đủ: ADMIN, hoặc nhân viên CSKH/KHO (cần gọi khách, giao hàng). Nhân viên
 * chỉ có Kế toán/Marketing đối soát tiền theo mã đơn nên chỉ thấy 3 số cuối (cùng quy ước CSV xuất đơn).
 */
export function seesFullOrderPhones(actor: OrderActor): boolean {
  if (actor.role === 'ADMIN') return true;
  if (actor.role !== 'STAFF') return false;
  return (actor.staffPermissions ?? []).some((p) => p === 'CSKH' || p === 'KHO');
}

export type ActorTransitionBlock = { kind: 'FORBIDDEN' | 'BAD_REQUEST'; message: string };

export function actorTransitionBlock(
  actor: OrderActor,
  order: { fulfiller?: string | null; pancakeOrderId?: string | null },
  to: OrderStatus,
): ActorTransitionBlock | null {
  if (actor.role === 'STAFF') {
    const perms = (actor.staffPermissions ?? []).filter(isStaffPermission);
    if (!perms.some((p) => STAFF_TRANSITIONS[p].includes(to))) {
      return {
        kind: 'FORBIDDEN',
        message:
          'Nhóm việc của bạn không đổi được đơn sang trạng thái này: CSKH chỉ huỷ đơn (trước khi bàn giao vận chuyển), ' +
          'KHO chỉ đánh dấu Đã đóng gói. Giao vận/Đã giao do Pancake báo về hoặc admin xử lý.',
      };
    }
  } else if (actor.role !== 'ADMIN') {
    return { kind: 'FORBIDDEN', message: 'Bạn không có quyền đổi trạng thái đơn.' };
  }
  if (CARRIER_STATUSES.includes(to) && order.fulfiller !== 'MERCHANT' && !order.pancakeOrderId) {
    return {
      kind: 'BAD_REQUEST',
      message:
        'Đơn chưa lên Pancake (kho chưa nhận đơn) — không đánh dấu Giao vận/Đã giao tay được. Đẩy lại Pancake trước, ' +
        'trạng thái giao sẽ do Pancake báo về.',
    };
  }
  return null;
}

export function actorAllowedTransitions(
  actor: OrderActor,
  order: { fulfiller?: string | null; pancakeOrderId?: string | null },
  next: OrderStatus[],
): OrderStatus[] {
  return next.filter((s) => actorTransitionBlock(actor, order, s) === null);
}
