import type { OrderStatus, OrderType, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';

/**
 * Đơn thử của kịch bản Giờ G (docs/launch/pilot-order-playbook.md): chỉ đơn có bằng chứng rõ là đơn thử mới vào danh sách, không đoán.
 * Bằng chứng: ô Ghi chú của đơn có `[PILOT]` (Người thử gõ lúc đặt), hoặc người mua/SĐT khách vãng lai đúng một SĐT người thử mà quản trị
 * viên gõ vào (mục B.2 của kịch bản). Hệ thống chưa có cờ "tài khoản thử" nên không có bằng chứng thứ ba.
 * Người thử dùng SĐT thật của mình, nên SĐT chỉ giúp tìm: đơn không có `[PILOT]` mặc định để làm tay, và đơn CTV đặt hộ khách
 * (`placedForCustomer`, người mua là CTV nhưng hàng của khách thật) không bao giờ khớp theo SĐT. Quản trị viên được tự tay chọn TỪNG đơn chỉ
 * khớp SĐT để dọn cùng lượt (PO A3, 22/11/2026), nhưng chỉ đơn lẻ chưa có tiền, chưa đóng gói; đơn đại lý, đã trả tiền hay đã rời kho vẫn làm tay.
 */
export const PILOT_NOTE_MARKER = '[PILOT]';
/** Câu phải gõ đúng (không dấu, chữ hoa) trước khi dọn thật. */
export const PILOT_CONFIRM_TEXT = 'XOA DON THU';
/** Chỉ xét đơn đặt trong ngần này ngày: buổi thử 1,5 ngày cộng mốc đối soát ngày +7 và thời gian chờ ngân hàng. */
export const PILOT_WINDOW_DAYS = 45;
export const PILOT_LIST_MAX = 200;
export const PILOT_CLEANUP_MAX = 50;
export const PILOT_PHONES_MAX = 5;
export const PILOT_CLEANUP_ACTION = 'GOLIVE_PILOT_CLEANUP';
/** Lý do huỷ ghi vào lịch sử đơn và hiện cho Người thử. */
export const PILOT_CANCEL_NOTE = 'Dọn đơn thử sau buổi thử Giờ G';

export type PilotMatch = 'NOTE_MARKER' | 'TEST_PHONE';
/**
 * CANCEL: huỷ qua đúng đường nút "Huỷ" của admin (trả tồn, đảo điểm, huỷ đơn Pancake/Gomdon). ARCHIVE: đơn đã ở trạng thái cuối, chỉ ghi mã vào
 * sổ dọn đơn thử, không đổi đơn (báo cáo Doanh thu, GMV, Trung tâm tăng trưởng và file kế toán đọc sổ này để loại đơn: admin-revenue.ts). MANUAL: có tiền, đã rời kho hoặc chỉ khớp SĐT, phải làm tay theo kịch bản.
 * DONE: đã dọn ở lượt trước.
 */
export type PilotAction = 'CANCEL' | 'ARCHIVE' | 'MANUAL' | 'DONE';

export const PILOT_ORDER_SELECT = {
  id: true,
  code: true,
  type: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  total: true,
  createdAt: true,
  note: true,
  guestPhone: true,
  placedForCustomer: true,
  pancakePaidReported: true,
  paymentUnlinkedAt: true,
  user: { select: { phone: true } },
} as const satisfies Prisma.OrderSelect;

export interface PilotOrderShape {
  code: string;
  type: OrderType;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  total: number;
  createdAt: Date;
  note: string | null;
  guestPhone: string | null;
  placedForCustomer: boolean;
  pancakePaidReported: number | null;
  paymentUnlinkedAt: Date | null;
  user: { phone: string | null } | null;
}

export interface PilotOrderRow {
  code: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  total: number;
  createdAt: string;
  matchedBy: PilotMatch[];
  /** SĐT người mua đã che (090***4567); null khi đơn không có SĐT. */
  phone: string | null;
  action: PilotAction;
  reason: string;
  /** Đơn chỉ khớp SĐT người thử mà quản trị viên được tự chọn để dọn (huỷ) trong lượt này. */
  optInEligible: boolean;
}

/** SĐT người thử quản trị viên gõ: 0 + 9 số, hoặc 84/+84 + 9 số. Sai dạng thì null (không tự thêm số 0, không đoán). */
export function parseTestPhone(raw: string): string | null {
  const t = raw.trim().replace(/[\s.-]/g, '');
  const m = /^(?:\+?84|0)(\d{9})$/.exec(t);
  return m ? `0${m[1]}` : null;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.length > 7 ? `${phone.slice(0, 3)}***${phone.slice(-4)}` : '***';
}

export function hasPilotMarker(note: string | null | undefined): boolean {
  return Boolean(note && note.toUpperCase().includes(PILOT_NOTE_MARKER));
}

export function buyerPhone(o: Pick<PilotOrderShape, 'user' | 'guestPhone'>): string | null {
  return o.user?.phone ?? o.guestPhone ?? null;
}

export function pilotMatches(o: Pick<PilotOrderShape, 'note' | 'user' | 'guestPhone' | 'placedForCustomer'>, phones: ReadonlySet<string>): PilotMatch[] {
  const out: PilotMatch[] = [];
  if (hasPilotMarker(o.note)) out.push('NOTE_MARKER');
  if (!o.placedForCustomer && ((o.user?.phone && phones.has(o.user.phone)) || (o.guestPhone && phones.has(o.guestPhone)))) out.push('TEST_PHONE');
  return out;
}

/** Điều kiện đọc ứng viên: dấu `[PILOT]` hoặc đúng SĐT người thử, đặt trong cửa sổ thử. Kết quả còn được lọc lại bằng `pilotMatches`. */
export function pilotCandidateWhere(phones: readonly string[], now: Date): Prisma.OrderWhereInput {
  const since = new Date(now.getTime() - PILOT_WINDOW_DAYS * 86_400_000);
  const evidence: Prisma.OrderWhereInput[] = [{ note: { contains: PILOT_NOTE_MARKER, mode: 'insensitive' } }];
  if (phones.length > 0) {
    evidence.push({ placedForCustomer: false, user: { phone: { in: [...phones] } } }, { placedForCustomer: false, guestPhone: { in: [...phones] } });
  }
  return { createdAt: { gte: since }, OR: evidence };
}

const FINAL: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['DELIVERED', 'CANCELLED', 'RETURNED']);
const CANCELLABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['PENDING_PAYMENT', 'CONFIRMED']);

export const PILOT_OPT_IN_REASON = 'Quản trị viên tự chọn dọn đơn chỉ khớp SĐT người thử: huỷ như nút Huỷ của admin (trả tồn, đảo điểm, huỷ bên Pancake/Gomdon).';

/**
 * Đơn chỉ khớp SĐT người thử mà quản trị viên đã tự chọn: chỉ huỷ được khi là đơn lẻ (không đại lý, không CTV đặt hộ), chưa có đồng nào (kể cả
 * tiền chuyển khoản chờ đối soát) và chưa rời kho. Mọi trường hợp khác trả lý do làm tay, kể cả khi đã chọn.
 */
function optInPlan(o: PilotOrderShape): { action: PilotAction; reason: string } {
  if (o.placedForCustomer) return { action: 'MANUAL', reason: 'Đơn CTV đặt hộ khách không bao giờ dọn theo SĐT: xử lý tay ở Đơn hàng.' };
  if (o.type !== 'RETAIL') return { action: 'MANUAL', reason: 'Đơn đại lý: xử lý tay ở mục đơn đại lý.' };
  if (FINAL.has(o.status) || !CANCELLABLE.has(o.status)) return { action: 'MANUAL', reason: 'Đơn chỉ khớp SĐT đã đóng gói, đã giao vận chuyển hoặc đã xong: xử lý tay, không dọn theo SĐT.' };
  if (o.paymentStatus !== 'UNPAID') return { action: 'MANUAL', reason: 'Đơn chỉ khớp SĐT đã có tiền: huỷ tay ở Đơn hàng để chọn cách hoàn.' };
  if ((o.pancakePaidReported ?? 0) > 0 || o.paymentUnlinkedAt) return { action: 'MANUAL', reason: 'Có tiền chuyển khoản chờ đối soát: Kế toán xử lý tay trước.' };
  return { action: 'CANCEL', reason: PILOT_OPT_IN_REASON };
}

/**
 * Việc sẽ làm với một đơn thử. Chỉ đơn có `[PILOT]` mới được dọn tự động, và chỉ huỷ đơn chưa rời kho, chưa có đồng nào: tiền và hàng đã đi thì
 * làm tay theo kịch bản. Đơn chỉ khớp SĐT mà quản trị viên tự chọn (`optIn`) đi theo `optInPlan`.
 */
export function planFor(o: PilotOrderShape, matchedBy: readonly PilotMatch[], alreadyDone: boolean, optIn = false): { action: PilotAction; reason: string } {
  if (alreadyDone) return { action: 'DONE', reason: 'Đã dọn ở lượt trước (có trong sổ dọn đơn thử).' };
  if (!matchedBy.includes('NOTE_MARKER')) {
    if (optIn && matchedBy.includes('TEST_PHONE')) return optInPlan(o);
    return { action: 'MANUAL', reason: `Chỉ khớp SĐT người thử, ghi chú không có ${PILOT_NOTE_MARKER}: có thể là đơn thật của chính người đó. Kiểm rồi xử lý tay ở Đơn hàng.` };
  }
  // Ghi chú do người đặt gõ: CTV đặt hộ khách thật có thể gõ trúng [PILOT], nên đơn đặt hộ không bao giờ tự huỷ hay ghi sổ.
  if (o.placedForCustomer) return { action: 'MANUAL', reason: `Đơn CTV đặt hộ khách có ${PILOT_NOTE_MARKER}: có thể là đơn thật của khách. Kiểm rồi xử lý tay ở Đơn hàng.` };
  if (FINAL.has(o.status)) return { action: 'ARCHIVE', reason: 'Đơn đã xong: chỉ ghi mã vào sổ dọn đơn thử, không đổi đơn. Báo cáo doanh thu và file kế toán tự loại các mã trong sổ.' };
  if (o.type === 'DEALER') return { action: 'MANUAL', reason: 'Đơn đại lý: xử lý tay ở mục đơn đại lý.' };
  if (!CANCELLABLE.has(o.status)) return { action: 'MANUAL', reason: 'Đơn đã đóng gói hoặc đã giao vận chuyển: xử lý tay theo kịch bản (mục 2.6), không tự huỷ.' };
  if (o.paymentStatus !== 'UNPAID') return { action: 'MANUAL', reason: 'Đơn đã có tiền: huỷ tay ở Đơn hàng để chọn hoàn về Ví Tubu hay ngân hàng (Phần 4).' };
  if ((o.pancakePaidReported ?? 0) > 0 || o.paymentUnlinkedAt) return { action: 'MANUAL', reason: 'Có tiền chuyển khoản chờ đối soát: Kế toán xử lý tay trước.' };
  return { action: 'CANCEL', reason: 'Huỷ như nút Huỷ của admin: trả tồn, đảo điểm, huỷ đơn bên Pancake/Gomdon.' };
}

/** Ô "chọn dọn" chỉ hiện cho đơn chỉ khớp SĐT mà nếu chọn thì huỷ được (mọi chặn của `optInPlan` đều qua). */
export function optInEligible(o: PilotOrderShape, matchedBy: readonly PilotMatch[], alreadyDone: boolean): boolean {
  return !alreadyDone && !matchedBy.includes('NOTE_MARKER') && matchedBy.includes('TEST_PHONE') && optInPlan(o).action === 'CANCEL';
}

export function toPilotRow(o: PilotOrderShape, matchedBy: PilotMatch[], alreadyDone: boolean, optIn = false): PilotOrderRow {
  const { action, reason } = planFor(o, matchedBy, alreadyDone, optIn);
  return {
    code: o.code,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    total: o.total,
    createdAt: o.createdAt.toISOString(),
    matchedBy,
    phone: maskPhone(buyerPhone(o)),
    action,
    reason,
    optInEligible: optInEligible(o, matchedBy, alreadyDone),
  };
}
