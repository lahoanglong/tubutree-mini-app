import type { Order, Prisma } from '@prisma/client';
import type { OrderEditAddressInput, OrderEditRefusalReason, ShippingAddressSnapshot } from '@tubutree/shared-types';
import { isNewGeoCode } from '../integrations/pancake/geo-code';
import { composeSubscriptionNote, subscriptionCustomerPart } from '../subscriptions/subscription-note';
import { cancelHandover } from './order-transition';

/**
 * Khách đăng nhập tự sửa người nhận, SĐT, phường/xã, số nhà (cùng tỉnh) và ghi chú của đơn chưa đóng gói. File không import service: service sửa,
 * bản xem chi tiết đơn (`canEdit`) và job Pancake cùng đọc luật ở đây.
 */

/** Cờ bật lối sửa (mặc định tắt, PO bật ở thẻ "Bật/tắt tính năng"). */
export const ORDER_CUSTOMER_SELF_EDIT_KEY = 'orders.customer_self_edit_enabled';

/** Số lần sửa tối đa mỗi đơn (PO 25/11). */
export const ORDER_EDIT_MAX = 3;

/**
 * Mở đầu ghi chú của dòng lịch sử cùng trạng thái (`fromStatus = toStatus`, `actorType = CUSTOMER`) ghi mỗi lần sửa: vừa là vết, vừa là bộ đếm lượt.
 * Chỉ ghi tên trường đã đổi, không bao giờ ghi SĐT hay địa chỉ.
 */
export const ORDER_EDIT_HISTORY_NOTE = 'Khách tự sửa đơn';

/** `code` trong body 409/400 của PATCH /orders/:code/delivery; `reason` cho biết vì sao. */
export const ORDER_EDIT_REFUSED = 'ORDER_EDIT_REFUSED';

export const ORDER_EDITABLE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED'] as const;

export type OrderEditRefusal = OrderEditRefusalReason;

export type OrderEditFacts = Pick<
  Order,
  | 'type'
  | 'status'
  | 'fulfiller'
  | 'placedForCustomer'
  | 'guestTokenHash'
  | 'hasRecyclingPickup'
  | 'gomdonOrderId'
  | 'gomdonPartnerCode'
  | 'gomdonStatus'
  | 'autoCancelBlockedAt'
  | 'shippingCode'
  | 'shippingPartner'
  | 'shippedAt'
  | 'pancakeOrderId'
  | 'pancakePushStatus'
  | 'pancakePushClaimedAt'
>;

/**
 * Lý do chủ đơn không sửa được đơn này (null = sửa được). Người gọi tự kiểm chủ đơn trước (đơn của người khác: 404 như không có). Thứ tự:
 * cờ, loại đơn, trạng thái, mốc bàn giao, lệnh tạo đơn Pancake đang bay, lượt sửa.
 */
export function customerEditBlock(o: OrderEditFacts, ctx: { flagOn: boolean; editsUsed: number }): OrderEditRefusal | null {
  if (!ctx.flagOn) return 'DISABLED';
  // Đơn vãng lai (kể cả đơn vãng lai đã gộp vào tài khoản): khoá `#k=` là quyền đọc dài hạn có thể đã chuyển tiếp, không đủ làm bằng chứng quyền đổi địa chỉ.
  if (o.guestTokenHash !== null) return 'NOT_ELIGIBLE';
  // Đại lý, CTV lên hộ người nhận, gian hàng tự giao, đơn thu gom tái chế (vận đơn Gomdon chép địa chỉ lúc tạo): không phải đường giao của kho Tubu.
  if (o.type !== 'RETAIL' || o.placedForCustomer || o.fulfiller !== 'TUBU') return 'NOT_ELIGIBLE';
  if (o.hasRecyclingPickup || o.gomdonOrderId !== null || o.gomdonStatus !== null) return 'NOT_ELIGIBLE';
  if (!(ORDER_EDITABLE_STATUSES as readonly string[]).includes(o.status)) return 'NOT_EDITABLE_STATUS';
  if (o.autoCancelBlockedAt !== null || cancelHandover(o) !== null) return 'HANDED_OVER';
  // Quá cửa sổ tự đẩy (STALE): kho có thể đã lên đơn tay trên Pancake mà Tubu không giữ mã đơn, nên lần sửa ở đây không tới được kho.
  if (o.pancakePushStatus === 'STALE') return 'NOT_ELIGIBLE';
  // Thân đơn Pancake dựng trước lúc giữ quyền đẩy: sửa trong lúc lệnh tạo đang bay có thể lên kho bằng địa chỉ cũ.
  if (o.pancakePushStatus === 'PUSHING' || (o.pancakeOrderId === null && o.pancakePushClaimedAt !== null)) return 'SYNCING';
  if (ctx.editsUsed >= ORDER_EDIT_MAX) return 'EDIT_LIMIT';
  return null;
}

/** Câu cho khách theo lý do (máy khách hiện nguyên văn rồi tải lại đơn). `province` là tên tỉnh của đơn cho PROVINCE_CHANGED. */
export function orderEditRefusalMessage(reason: OrderEditRefusal, province?: string): string {
  switch (reason) {
    case 'DISABLED':
      return 'Sửa đơn đang tạm tắt. Nhắn Zalo OA hoặc gọi hotline Tubu để đổi địa chỉ nhé.';
    case 'NOT_ELIGIBLE':
      return 'Đơn này không tự sửa được. Nhắn Zalo OA hoặc gọi hotline Tubu nhé.';
    case 'NOT_EDITABLE_STATUS':
      return 'Đơn đã vào khâu đóng gói nên không sửa được. Nhắn Zalo OA hoặc gọi hotline Tubu nhé.';
    case 'HANDED_OVER':
      return 'Đơn đã giao cho đơn vị vận chuyển nên không sửa được. Nhắn Zalo OA hoặc gọi hotline Tubu nhé.';
    case 'PACKING_ON_PANCAKE':
      return 'Kho đã đóng gói đơn này nên không sửa được. Nhắn Zalo OA hoặc gọi hotline Tubu nhé.';
    case 'PANCAKE_UNREACHABLE':
      return 'Kho chưa phản hồi, bạn thử lại sau ít phút nhé.';
    case 'SYNCING':
      return 'Đơn đang được chuyển sang kho, bạn thử lại sau ít phút nhé.';
    case 'EDIT_LIMIT':
      return `Đơn đã sửa đủ ${ORDER_EDIT_MAX} lần. Nhắn Zalo OA hoặc gọi hotline Tubu nếu cần đổi thêm nhé.`;
    case 'PROVINCE_CHANGED':
      return `Chỉ đổi được địa chỉ trong ${province?.trim() || 'tỉnh/thành của đơn'}. Muốn giao tỉnh khác, bạn huỷ đơn rồi đặt lại nhé.`;
    case 'PROVINCE_LOCKED':
      return 'Địa chỉ chưa theo địa giới mới nên chỉ sửa được ghi chú. Nhắn Zalo OA hoặc gọi hotline Tubu để đổi địa chỉ nhé.';
  }
}

export interface OrderEditInput {
  address?: OrderEditAddressInput;
  /** undefined = không đổi ghi chú; '' hoặc null = xoá ghi chú. */
  note?: string | null;
}

/** Tên trường đổi, đúng thứ tự, cho dòng lịch sử và log (không chứa giá trị). */
export type OrderEditField = 'người nhận' | 'SĐT' | 'phường/xã' | 'số nhà' | 'ghi chú';

export type OrderEditPlan =
  | { kind: 'NOOP' }
  | { kind: 'REFUSED'; reason: 'PROVINCE_CHANGED' | 'PROVINCE_LOCKED' }
  | {
      kind: 'WRITE';
      shippingAddress: ShippingAddressSnapshot;
      note: string | null;
      /** Đổi SĐT người nhận khi đơn đang bật báo Zalo cho người nhận: đồng ý của người nhận cũ không chuyển sang người mới. */
      disableRecipientZalo: boolean;
      changed: OrderEditField[];
      addressChanged: boolean;
    };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** +84xxxxxxxxx và 0xxxxxxxxx là cùng một số. */
const phoneKey = (v: string): string => (v.startsWith('+84') ? `0${v.slice(3)}` : v);
const noteOf = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

/** Ảnh chụp địa chỉ của đơn đọc từ cột Json (thiếu trường thì chuỗi rỗng). */
export function snapshotOf(raw: Prisma.JsonValue): ShippingAddressSnapshot {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    recipient: text(s.recipient),
    phone: text(s.phone),
    province: text(s.province),
    district: text(s.district),
    ward: text(s.ward),
    street: text(s.street),
    provinceCode: text(s.provinceCode),
    districtCode: text(s.districtCode),
    wardCode: text(s.wardCode),
  };
}

/** Địa chỉ của đơn đổi được không: tỉnh của đơn phải theo địa giới mới (máy chủ ép cùng tỉnh, tên tỉnh lấy từ đơn). */
export function addressEditable(snapshot: Pick<ShippingAddressSnapshot, 'provinceCode'>): boolean {
  return isNewGeoCode(snapshot.provinceCode);
}

/**
 * Dựng câu ghi từ đơn hiện tại và thân yêu cầu. Cùng tỉnh do máy chủ ép (so `provinceCode` sau trim); tên tỉnh, mã tỉnh và quận (hệ 2 cấp không
 * có quận) giữ của đơn, không tin client. Tên phường người gọi đã thay bằng tên trong danh mục địa giới khi có. Không có gì đổi (so sau chuẩn hoá):
 * NOOP, không ghi, không tính lượt. Không bao giờ chạm cột tiền hay trạng thái.
 *
 * Đơn định kỳ: ghi chú lưu là dấu của hệ thống (kho đọc) nối phần của khách. Khách chỉ thấy và sửa phần của mình (chi tiết đơn trả
 * `customerFacingNote`), nên so và ghi trên phần đó rồi ghép lại dấu: khách xoá trắng thì còn đúng dấu.
 */
export function planCustomerEdit(
  current: { shippingAddress: Prisma.JsonValue; note: string | null; notifyRecipientZalo: boolean; source: string | null },
  input: OrderEditInput,
): OrderEditPlan {
  const old = snapshotOf(current.shippingAddress);
  let next: ShippingAddressSnapshot = { ...old };
  const changed: OrderEditField[] = [];
  let phoneChanged = false;
  if (input.address) {
    const a = input.address;
    if (!addressEditable(old)) return { kind: 'REFUSED', reason: 'PROVINCE_LOCKED' };
    if (text(a.provinceCode) !== old.provinceCode) return { kind: 'REFUSED', reason: 'PROVINCE_CHANGED' };
    next = {
      ...old,
      recipient: text(a.recipient),
      phone: text(a.phone),
      ward: text(a.ward),
      street: text(a.street),
      wardCode: text(a.wardCode),
    };
    if (next.recipient !== old.recipient) changed.push('người nhận');
    if (phoneKey(next.phone) !== phoneKey(old.phone)) {
      changed.push('SĐT');
      phoneChanged = true;
    }
    // Đơn có mã phường thì mã quyết phường đổi hay không: người gọi đã thay tên bằng tên trong danh mục, nên đơn lưu tên viết khác ("P. Bến Nghé")
    // cùng mã không được tính là sửa (khách mất một lượt, Pancake nhận một lần PUT). Mã không đổi thì giữ tên đang lưu. Đơn cũ không có mã: so cả hai.
    const wardChanged = old.wardCode ? next.wardCode !== old.wardCode : next.wardCode !== old.wardCode || next.ward !== old.ward;
    if (old.wardCode && !wardChanged) next.ward = old.ward;
    if (wardChanged) changed.push('phường/xã');
    if (next.street !== old.street) changed.push('số nhà');
    // Chỉ đổi cách viết SĐT (+84 ↔ 0): không tính là sửa, giữ ảnh chụp cũ.
    if (changed.length === 0) next = { ...old };
  }
  const addressChanged = changed.length > 0;
  const subscription = current.source === 'subscription';
  // Đơn định kỳ: bỏ dấu ở đầu cả hai phía (khách dán lại nguyên ghi chú có dấu thì vẫn là không đổi).
  const customerNote = subscription ? subscriptionCustomerPart : noteOf;
  const oldNote = customerNote(current.note);
  const newNote = input.note === undefined ? oldNote : customerNote(input.note);
  const noteChanged = newNote !== oldNote;
  if (noteChanged) changed.push('ghi chú');
  if (changed.length === 0) return { kind: 'NOOP' };
  return {
    kind: 'WRITE',
    shippingAddress: next,
    // Đơn định kỳ không đổi ghi chú: giữ nguyên chữ đang lưu (kể cả ghi chú cũ không mở đầu bằng dấu).
    note: subscription ? (noteChanged ? composeSubscriptionNote(newNote) : current.note) : newNote,
    disableRecipientZalo: phoneChanged && current.notifyRecipientZalo,
    changed,
    addressChanged,
  };
}

/** Ghi chú dòng lịch sử của một lần sửa: chỉ tên trường, không có giá trị. */
export const orderEditHistoryNote = (changed: readonly OrderEditField[]): string => `${ORDER_EDIT_HISTORY_NOTE}: ${changed.join(', ')}`;

/** Điều kiện của dòng lịch sử đếm là một lần khách sửa (người làm là khách, ghi chú mở đầu bằng dấu sửa; cùng trạng thái lọc ở bộ nhớ). */
export const orderEditHistoryWhere = (orderId: string): Prisma.OrderStatusHistoryWhereInput => ({
  orderId,
  actorType: 'CUSTOMER',
  note: { startsWith: ORDER_EDIT_HISTORY_NOTE },
});

/** Dòng lịch sử của lần khách tự sửa có đổi SĐT người nhận (dòng ghi tên trường, không ghi số). */
export const orderPhoneEditHistoryWhere = (orderId: string): Prisma.OrderStatusHistoryWhereInput => ({
  ...orderEditHistoryWhere(orderId),
  note: { startsWith: ORDER_EDIT_HISTORY_NOTE, contains: 'SĐT' satisfies OrderEditField },
});

/** Số lần khách đã sửa đơn. Dòng `from = to` lọc ở bộ nhớ: Prisma không so hai cột trong `where`. */
export async function countCustomerEdits(
  prisma: { orderStatusHistory: Pick<Prisma.OrderStatusHistoryDelegate, 'findMany'> },
  orderId: string,
): Promise<number> {
  const rows = await prisma.orderStatusHistory.findMany({ where: orderEditHistoryWhere(orderId), select: { fromStatus: true, toStatus: true } });
  return rows.filter((r) => r.fromStatus === r.toStatus).length;
}
