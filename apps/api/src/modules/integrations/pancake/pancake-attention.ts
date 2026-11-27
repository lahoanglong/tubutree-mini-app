import { ConflictException, Logger } from '@nestjs/common';
import type { OrderStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PANCAKE_ALERT_TEMPLATE, type GomdonAlertService } from '../gomdon/gomdon-alert.service';

/** Mở đầu lý do "Cần xử lý Pancake" do chiều Tubu → Pancake ghi — để tự gỡ khi lần thử sau thành công. */
export const ATTENTION_PUSH_FAILED = 'Chưa đẩy được đơn sang Pancake';
/** Mở đầu lời nhắc của đơn thường ("hệ thống tự thử lại"/"sửa rồi bấm Đẩy lại"): đơn STALE không bao giờ nhận lời này (xem writePancakeAttention). */
export const ATTENTION_PUSH_RETRYING = `${ATTENTION_PUSH_FAILED} (kho chưa thấy đơn)`;
export const ATTENTION_CANCEL_PENDING = 'Đã huỷ ở Tubu nhưng CHƯA huỷ được trên Pancake';
export const ATTENTION_PAYMENT_PENDING = 'Chưa báo được "đã thanh toán, không thu COD" sang Pancake';
/** Khách đã đổi đơn chuyển khoản sang COD mà đơn Pancake còn ghi "chờ chuyển khoản, chưa giao": kho không giao tới khi sửa tay. */
export const ATTENTION_COD_SWITCH_PENDING = 'Khách đã đổi sang COD nhưng đơn Pancake còn ghi "chờ chuyển khoản"';
/** Khách đã tự sửa địa chỉ/ghi chú mà đơn Pancake còn thông tin cũ (PUT lỗi hoặc đọc lại thấy lệch): kho sửa tay trước khi giao. */
export const ATTENTION_CUSTOMER_EDIT_PENDING = 'Khách đã sửa địa chỉ/ghi chú nhưng đơn Pancake còn thông tin cũ';
/**
 * Sau lần PUT địa chỉ khách tự sửa, tiền trên đơn Pancake đổi (Pancake tự tính lại COD/phí ship) hoặc không đọc lại được để so. Tiền tố riêng,
 * khác ATTENTION_CUSTOMER_EDIT_PENDING: lượt sửa sau thành công không tự gỡ, vì lượt đó lấy tiền đã đổi làm mốc nên không còn thấy lệch. Chỉ người
 * sửa tay bấm "Đã xử lý".
 */
export const ATTENTION_CUSTOMER_EDIT_MONEY_CHECK = 'Kiểm tiền trên Pancake sau khi khách sửa địa chỉ';
/** Đơn đã đổi sang COD, hàng đã rời kho, rồi Pancake ghi nhận tiền chuyển khoản: có thể khách trả hai lần (chuyển khoản + COD). */
export const ATTENTION_COD_SWITCH_PAID_AFTER_HANDOVER = 'Đơn đã đổi sang COD và đã giao vận chuyển nhưng khách vẫn chuyển khoản';
/**
 * Dấu bền trong lịch sử đơn cho lời nhắc trên, mỗi số tiền một lần: Pancake gửi lại cờ "đã trả" ở mọi webhook sau đó, mà ô "Cần xử lý" bị bấm "Đã xử lý"
 * xoá thì không còn gì chặn nhắc lại.
 */
export const PANCAKE_COD_SWITCH_PAID_NOTE = 'Pancake báo đã trả sau bàn giao cho đơn đã đổi sang COD';
/**
 * Đơn đã đổi sang COD, đã lên kho Pancake (ghi chú "THU COD"), rồi tiền chuyển khoản về trước bàn giao: đơn trở lại trả trước, nhưng vận đơn hãng tạo
 * trong lúc còn COD có thể vẫn thu hộ đủ tiền (cập nhật "đã trả" trên Pancake không chắc sửa được vận đơn đã in).
 */
export const ATTENTION_COD_SWITCH_REVERTED_CHECK_WAYBILL = 'Khách đổi sang COD rồi vẫn chuyển khoản đủ: kiểm vận đơn, sửa thu hộ về 0đ hoặc huỷ vận đơn tạo lúc còn COD';
/** Pancake báo "Hoàn một phần" (15) cho đơn đã duyệt trả + hoàn tiền trên Tubu — chỉ còn chờ bấm "Đã nhận hàng về". */
export const ATTENTION_PARTIAL_RETURN_ACK = 'Pancake đã nhận phiếu hoàn một phần — đã hoàn trên Tubu';
/** Lệnh huỷ đã tới Pancake nhưng lần huỷ ở Tubu trượt/lỗi — kho không còn đơn, Tubu còn hiệu lực; xong việc khi đơn huỷ/trả. */
export const ATTENTION_CANCELLED_ON_PANCAKE_ONLY = 'Pancake đã huỷ nhưng đơn Tubu còn hiệu lực';
/** Pancake báo huỷ đơn đã bàn giao (processor) — xong việc khi đơn đã huỷ/trả theo luồng hoàn. */
export const ATTENTION_CANCEL_AFTER_HANDOVER = 'Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển';
/**
 * Pancake báo "Đã hoàn" cho đơn COD đã giao mà Tubu chưa có bằng chứng thu COD (DELIVERED có thể do kho bấm "Đã nhận" nhầm):
 * đơn đã sang RETURNED nhưng tiền chưa hoàn Ví. Cùng lúc có một khoản hoàn RETURN chờ đối soát (UNVERIFIED) ở mục "Hoàn tiền
 * khách" của Kế toán — đó là nơi quyết định hoàn hay không, dòng này chỉ để kho/CSKH biết đơn đang chờ.
 */
export const ATTENTION_COD_RETURN_UNVERIFIED =
  'Pancake báo "Đã hoàn" cho đơn COD đã giao — đơn đã chuyển "Đã trả hàng", điểm/hoa hồng đã đảo, nhưng hệ thống KHÔNG tự hoàn tiền vào Ví vì chưa có bằng chứng hãng đã thu COD. ' +
  'Kế toán đối chiếu với hãng vận chuyển rồi xử lý ở mục "Hoàn tiền khách" (khoản "Trả hàng" chờ đối soát của đơn này): hãng đã thu COD thì xác nhận để hoàn cho khách, chưa thu thì bỏ qua kèm lý do.';
/**
 * Pancake báo "Hoàn một phần" (15) khi Tubu không có yêu cầu trả, rồi báo "Đã hoàn" (5): đơn đã sang "Đã trả hàng" nhưng tiền KHÔNG tự
 * hoàn vì nhân viên có thể đã hoàn tay phần bị trả. Khoản hoàn chờ Kế toán đối soát nằm ở mục "Hoàn tiền khách". Không mở đầu bằng
 * PANCAKE_PARTIAL_RETURN_PREFIX nên việc đóng đơn không thay nó bằng lời "đã xử lý".
 */
const heldReasonFor = (closed: string, queueName: string) =>
  `Pancake đã báo hoàn một phần rồi hoàn cả đơn, mà Tubu không có yêu cầu trả hàng nào: nhân viên có thể đã hoàn tay phần bị trả. Đơn đã chuyển "${closed}", điểm/hoa hồng/kho đã đảo, nhưng hệ thống KHÔNG tự hoàn tiền cho khách. ` +
  `Kế toán trừ phần đã hoàn tay, rồi xác nhận phần còn lại ở mục "Hoàn tiền khách" (khoản "${queueName}" chờ đối soát của đơn này).`;
export const ATTENTION_PARTIAL_RETURN_HELD = heldReasonFor('Đã trả hàng', 'Trả hàng, có thể đã hoàn tay');
/** Cùng việc cho đơn CHƯA giao: Pancake "Đã hoàn" huỷ đơn (CANCELLED), khoản mang lý do huỷ chứ không phải trả hàng. */
export const ATTENTION_PARTIAL_RETURN_HELD_CANCELLED = heldReasonFor('Đã huỷ', 'Huỷ đơn, có thể đã hoàn tay');
export const ATTENTION_PARTIAL_RETURN_HELD_REASONS = [ATTENTION_PARTIAL_RETURN_HELD, ATTENTION_PARTIAL_RETURN_HELD_CANCELLED];
/** Lý do chờ Kế toán theo trạng thái đích của lần lật. */
export const partialReturnHeldReason = (target: 'CANCELLED' | 'RETURNED'): string =>
  target === 'CANCELLED' ? ATTENTION_PARTIAL_RETURN_HELD_CANCELLED : ATTENTION_PARTIAL_RETURN_HELD;
/** Dấu vết bền trong lịch sử đơn: Pancake báo 15 lúc Tubu không có yêu cầu trả (ô "Cần xử lý" có thể bị bấm "Đã xử lý" xoá). */
export const PANCAKE_PARTIAL_RETURN_MANUAL_NOTE = 'Pancake báo hoàn một phần, Tubu không có yêu cầu trả';
/**
 * Thay lời "Pancake báo HOÀN MỘT PHẦN … hoàn tay" (15) khi đơn đã huỷ/trả theo đường tự hoàn tiền (admin, huỷ chưa giao, duyệt trả cả
 * đơn): lần đóng đơn đã xử lý tiền/điểm theo cả đơn, hoàn tay thêm là hoàn hai lần. Giữ lại dấu vết thay vì xoá, vì nhân viên có thể đã
 * hoàn tay phần bị trả trước khi đơn đóng. Đường Pancake "Đã hoàn" giữ tiền chờ Kế toán dùng ATTENTION_PARTIAL_RETURN_HELD.
 * Không mở đầu bằng PANCAKE_PARTIAL_RETURN_PREFIX nên lần đóng/cron sau không thay lại.
 */
export const ATTENTION_PARTIAL_RETURN_SETTLED =
  'Đơn đã huỷ/trả sau khi Pancake báo HOÀN MỘT PHẦN: hệ thống đã xử lý tiền/điểm theo cả đơn (đơn đã thu tiền thì đã hoàn đủ cho khách, đơn COD chưa thu thì không có tiền để hoàn), KHÔNG hoàn tay phần bị trả nữa. ' +
  'Nếu trước đó đã hoàn tay thì báo Kế toán đối chiếu để thu lại phần hoàn trùng.';
/** Admin duyệt trả MỘT PHẦN trên Tubu khi ô còn lời "hoàn tay" của Pancake 15: tiền đã hoàn lúc duyệt nên hoàn tay là hoàn hai lần. */
export const ATTENTION_PARTIAL_RETURN_APPROVED_ON_TUBU =
  'Phần khách trả đã được duyệt và hoàn tiền trên Tubu: KHÔNG hoàn tay phần bị trả (Pancake đã báo hoàn một phần). ' +
  'Nếu trước đó đã hoàn tay thì báo Kế toán đối chiếu để thu lại phần hoàn trùng.';
/** Lời nhắc tạo phiếu trả trên Pancake lúc duyệt trả (OrderReturnsService.flagPancakeReturn). */
export const ATTENTION_RETURN_APPROVED = ['Khách trả một phần đơn', 'Khách trả cả đơn'];
/** Pancake báo khách mới chuyển một phần tiền — tự gỡ khi đơn đủ tiền hoặc số đã nhận đã thành khoản hoàn. */
export const ATTENTION_UNDERPAID = 'Khách chuyển thiếu';
/** Tổng tiền đơn trên Pancake khác `order.total` (đơn bị sửa trên Pancake) — tự gỡ khi tổng trùng lại. */
export const ATTENTION_TOTAL_MISMATCH = 'Tổng tiền Pancake lệch với Tubu';

/**
 * Hàng đợi "Cần xử lý Pancake": ghi lý do lên đơn + báo ADMIN in-app (cùng cơ chế PancakeProcessor.flagAttention).
 * Cùng lý do đang chờ thì không ghi/báo lại. Lỗi gửi báo động tự nuốt trong alert().
 */
export async function flagPancakeAttention(
  prisma: PrismaService,
  alerts: GomdonAlertService | undefined,
  order: { id: string; code: string },
  reason: string,
  logger?: Logger,
): Promise<void> {
  const written = await writePancakeAttention(prisma, order.id, reason);
  if (!written) return;
  logger?.warn(`Đơn ${order.code} cần xử lý (Pancake): ${written}`);
  if (alerts) await alerts.alert(order.code, reason, PANCAKE_ALERT_TEMPLATE);
}

const attentionLogger = new Logger('PancakeAttention');
/** Hai dòng chỉ gỡ khi Kế toán quyết khoản chờ đối soát: lý do khác được nối sau, không đè. */
const ACCOUNTANT_OWNED_REASONS = [ATTENTION_COD_RETURN_UNVERIFIED, ...ATTENTION_PARTIAL_RETURN_HELD_REASONS];
/** Số lượt đọc-rồi-ghi có điều kiện khi ô bị ghi chen: đủ cho vài instance/job cùng ghi một đơn. */
const ATTENTION_WRITE_ATTEMPTS = 10;

/**
 * Phần "kiểm tiền sau khi khách sửa địa chỉ" của ô: dính như dòng chờ Kế toán. Lượt sửa sau lấy tiền đã đổi làm mốc nên không còn thấy lệch,
 * vì vậy mọi đường ghi đè hay xoá ô (lý do mới, việc tự xong) đều giữ lại phần này; chỉ người sửa tay bấm "Đã xử lý" mới gỡ.
 */
export const stickyMoneyCheckParts = (cell: string | null | undefined): string[] =>
  (cell ?? '').split(ATTENTION_SEPARATOR).filter((part) => part.startsWith(ATTENTION_CUSTOMER_EDIT_MONEY_CHECK));

/** Lý do mới `next` (null = xoá ô) ghép với phần kiểm tiền của ô hiện tại, bỏ trùng. null khi không còn gì. */
export function keepMoneyCheck(next: string | null, current: string | null | undefined): string | null {
  const parts = next ? next.split(ATTENTION_SEPARATOR) : [];
  const held = stickyMoneyCheckParts(current).filter((part) => !parts.includes(part));
  return [...parts, ...held].join(ATTENTION_SEPARATOR) || null;
}

/** Lý do đầu của ô khi bỏ qua phần kiểm tiền (phần đó luôn đứng sau): null khi ô trống hay chỉ có phần kiểm tiền. */
export function attentionHeadIgnoringMoneyCheck(cell: string | null | undefined): string | null {
  return (cell ?? '').split(ATTENTION_SEPARATOR).find((part) => part !== '' && !part.startsWith(ATTENTION_CUSTOMER_EDIT_MONEY_CHECK)) ?? null;
}

/** Tiền tố các phần không bị gỡ khi một việc khác tự xong: phần kiểm tiền sau khi khách sửa địa chỉ và các dòng chờ Kế toán quyết. */
export const STICKY_ATTENTION_PREFIXES: readonly string[] = [ATTENTION_CUSTOMER_EDIT_MONEY_CHECK, ...ACCOUNTANT_OWNED_REASONS];
const isStickyPart = (part: string): boolean => STICKY_ATTENTION_PREFIXES.some((p) => part.startsWith(p));

/** Ô không chứa phần kiểm tiền: lệnh ghi một câu chỉ chạy khi điều kiện này đúng, ô có phần đó đi đường đọc-ghi có điều kiện. */
const NO_MONEY_CHECK: Prisma.OrderWhereInput = {
  // NOT (NULL LIKE ..) ra NULL trong SQL: ô trống phải được nêu riêng, không thì dòng không khớp.
  OR: [{ pancakeAttention: null }, { NOT: { pancakeAttention: { contains: ATTENTION_CUSTOMER_EDIT_MONEY_CHECK } } }],
};

/**
 * Ghi lý do lên ô "Cần xử lý Pancake" (một ô cho mọi lý do). Dòng "COD chờ Kế toán" và dòng "hoàn tay chờ Kế toán" không bị ghi đè: nó chỉ gỡ khi Kế toán quyết,
 * nên lý do mới được nối sau nó. Đọc rồi ghi có điều kiện theo giá trị đã đọc (lý do vừa chen giữa không bị đè; thua thì đọc lại).
 * Lý do mở đầu bằng ATTENTION_PUSH_FAILED chỉ ghi khi đơn CHƯA có mã Pancake, ngay trong câu ghi: lượt đẩy xong chen giữa lúc đọc và lúc
 * gắn đã gỡ nhắc này (saveCreated), ghi sau đó sẽ để lại lời "chưa đẩy được" trên đơn đã lên kho. Lời nhắc đơn thường (ATTENTION_PUSH_RETRYING)
 * còn cần đơn chưa STALE, cũng ngay trong câu ghi. Lý do loại khác ghi như cũ.
 * Trả chuỗi vừa ghi, hoặc null khi không đổi gì.
 */
export async function writePancakeAttention(
  db: Pick<Prisma.TransactionClient, 'order'>,
  orderId: string,
  reason: string,
  onlyReplacingPrefix?: string,
  /** Chỉ ghi khi đơn còn mở: lệnh ghi không được thắng một lần huỷ/trả vừa commit sau lúc đọc trạng thái. */
  onlyOpenOrder = false,
): Promise<string | null> {
  const open = onlyOpenOrder ? { status: { notIn: ['CANCELLED', 'RETURNED'] as OrderStatus[] } } : {};
  const unsynced = reason.startsWith(ATTENTION_PUSH_FAILED) ? { pancakeOrderId: null } : null;
  // Lời nhắc của đơn thường ("hệ thống tự thử lại") không được nằm trên đơn STALE: markOverdue chen giữa lúc đọc trạng thái và lúc ghi, và không đường
  // tự động nào đẩy đơn STALE nên câu đó thành sai và không ai sửa. Cùng điều kiện với NOT_STALE_WHERE (pancake-order.service), viết lại vì file kia nhập file này.
  const notStale: Prisma.OrderWhereInput[] = reason.startsWith(ATTENTION_PUSH_RETRYING)
    ? [{ OR: [{ pancakePushStatus: null }, { pancakePushStatus: { not: 'STALE' } }] }]
    : [];
  const changed = { OR: [{ pancakeAttention: null }, { pancakeAttention: { not: reason } }] };
  // NOT (NULL LIKE ..) ra NULL trong SQL: ô trống phải được nêu riêng, không thì dòng không khớp.
  const notCod = { OR: [{ pancakeAttention: null }, { NOT: { pancakeAttention: { contains: ATTENTION_COD_RETURN_UNVERIFIED } } }] };
  const notHeld = {
    OR: [{ pancakeAttention: null }, { NOT: { OR: ATTENTION_PARTIAL_RETURN_HELD_REASONS.map((held) => ({ pancakeAttention: { contains: held } })) } }],
  };
  const first = await db.order.updateMany({
    where: onlyReplacingPrefix
      ? {
          id: orderId,
          ...open,
          ...unsynced,
          AND: [changed, notCod, notHeld, NO_MONEY_CHECK, ...notStale, { OR: [{ pancakeAttention: null }, { pancakeAttention: { startsWith: onlyReplacingPrefix } }] }],
        }
      : { id: orderId, ...open, ...unsynced, AND: [changed, notCod, notHeld, NO_MONEY_CHECK, ...notStale] },
    data: { pancakeAttention: reason, pancakeAttentionAt: new Date() },
  });
  if (first.count === 1) return reason;
  // Không khớp: cùng lý do đang chờ, đơn đã đóng (onlyOpenOrder), ô đang giữ dòng chờ Kế toán (nối lý do mới sau dòng đó), hoặc ô có phần
  // kiểm tiền (lý do mới thay phần còn lại, giữ phần kiểm tiền). Ô có thể đổi tiếp giữa các bước (Kế toán gỡ COD, instance khác nối), nên
  // mỗi lượt ghi theo đúng giá trị vừa đọc. Có `onlyReplacingPrefix` thì chỉ đi tiếp khi ô có phần kiểm tiền và phần còn lại trống hoặc khớp tiền tố.
  for (let attempt = 0; attempt < ATTENTION_WRITE_ATTEMPTS; attempt += 1) {
    const row = await db.order.findUnique({ where: { id: orderId }, select: { pancakeAttention: true, status: true, pancakeOrderId: true, pancakePushStatus: true } });
    if (!row) return null;
    if (unsynced && row.pancakeOrderId) return null;
    if (notStale.length > 0 && row.pancakePushStatus === 'STALE') return null;
    if (onlyOpenOrder && (row.status === 'CANCELLED' || row.status === 'RETURNED')) return null;
    const current = row.pancakeAttention ?? null;
    const currentParts = current ? current.split(ATTENTION_SEPARATOR) : [];
    // Mọi phần của lý do đã nằm trong ô (ở bất kỳ vị trí nào, vd 'X | COD' do order-status nối, hay 'X | kiểm tiền') thì không đổi và không báo lại.
    if (reason.split(ATTENTION_SEPARATOR).every((part) => currentParts.includes(part))) return null;
    const accountantOwned = current !== null && ACCOUNTANT_OWNED_REASONS.some((r) => current.includes(r));
    if (onlyReplacingPrefix) {
      // Phần kiểm tiền không tính là lý do của job khác: so tiền tố trên phần còn lại của ô.
      const head = attentionHeadIgnoringMoneyCheck(current);
      if (accountantOwned || stickyMoneyCheckParts(current).length === 0 || (head !== null && !head.startsWith(onlyReplacingPrefix))) return null;
    }
    // Cùng phép thử với notCod/notHeld của lệnh ghi đầu: còn dòng chờ Kế toán thì nối sau nó; vừa được Kế toán gỡ thì ghi như lệnh đầu.
    const next = accountantOwned
      ? [...currentParts, ...reason.split(ATTENTION_SEPARATOR).filter((part) => !currentParts.includes(part))].join(ATTENTION_SEPARATOR)
      : keepMoneyCheck(reason, current)!;
    if (next === current) return null;
    const r = await db.order.updateMany({
      where: { id: orderId, ...open, ...unsynced, ...(notStale.length > 0 ? { AND: notStale } : {}), pancakeAttention: current },
      data: { pancakeAttention: next, pancakeAttentionAt: new Date() },
    });
    if (r.count === 1) return next;
  }
  attentionLogger.error(`Không ghi được lý do "Cần xử lý Pancake" cho đơn ${orderId} sau ${ATTENTION_WRITE_ATTEMPTS} lượt (ô đổi liên tục): ${reason}`);
  return null;
}

/** Đơn đã huỷ xong trên Pancake (hoặc chưa từng lên): việc đẩy/huỷ/báo thanh toán còn treo không còn ý nghĩa. */
export const ATTENTION_SETTLED_BY_CANCEL = [ATTENTION_PUSH_FAILED, ATTENTION_CANCEL_PENDING, ATTENTION_PAYMENT_PENDING];

/**
 * Gỡ lý do do chính chiều outbound ghi (việc đã tự xong) — không đụng lý do khác (webhook, admin): xoá ô khi lý do ĐẦU khớp tiền tố. Các
 * phần STICKY_ATTENTION_PREFIXES (kiểm tiền sau khi khách sửa địa chỉ, dòng chờ Kế toán nối sau lý do đầu) vẫn ở lại. Đọc trước rồi mới ghi
 * có điều kiện theo giá trị đã đọc: ô thường không khớp tiền tố nên đa số lần gọi chỉ tốn một câu đọc, không câu ghi nào.
 */
export async function clearPancakeAttention(prisma: Pick<Prisma.TransactionClient, 'order'>, orderId: string, prefix: string | string[]): Promise<void> {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  for (let attempt = 0; attempt < ATTENTION_WRITE_ATTEMPTS; attempt += 1) {
    const row = await prisma.order.findUnique({ where: { id: orderId }, select: { pancakeAttention: true } });
    const cell = row?.pancakeAttention;
    if (!cell || !prefixes.some((p) => cell.startsWith(p))) return;
    const next = cell.split(ATTENTION_SEPARATOR).filter(isStickyPart).join(ATTENTION_SEPARATOR) || null;
    if (next === cell) return;
    const r = await prisma.order.updateMany({
      where: { id: orderId, pancakeAttention: cell },
      data: next ? { pancakeAttention: next } : { pancakeAttention: null, pancakeAttentionAt: null },
    });
    if (r.count === 1) return;
  }
  attentionLogger.error(`Không gỡ được lý do "Cần xử lý Pancake" (${prefixes.join(', ')}) của đơn ${orderId} sau ${ATTENTION_WRITE_ATTEMPTS} lượt (ô đổi liên tục).`);
}

/**
 * Ghi đè cả ô bằng `reason` như các đường ghi thẳng (lệch tiền ZaloPay, tiền về muộn), trừ phần kiểm tiền sau khi khách sửa địa chỉ: phần đó
 * được nối lại sau lý do mới. Ô đã có đủ (lý do + phần kiểm tiền) thì không ghi. Trả true khi ô đổi (người gọi báo admin lần đầu).
 */
export async function overwriteAttentionKeepingMoneyCheck(db: Pick<Prisma.TransactionClient, 'order'>, orderId: string, reason: string): Promise<boolean> {
  const first = await db.order.updateMany({
    where: { id: orderId, AND: [{ OR: [{ pancakeAttention: null }, { pancakeAttention: { not: reason } }] }, NO_MONEY_CHECK] },
    data: { pancakeAttention: reason, pancakeAttentionAt: new Date() },
  });
  if (first.count === 1) return true;
  for (let attempt = 0; attempt < ATTENTION_WRITE_ATTEMPTS; attempt += 1) {
    const row = await db.order.findUnique({ where: { id: orderId }, select: { pancakeAttention: true } });
    if (!row) return false;
    const current = row.pancakeAttention ?? null;
    const next = keepMoneyCheck(reason, current)!;
    if (next === current) return false;
    const r = await db.order.updateMany({ where: { id: orderId, pancakeAttention: current }, data: { pancakeAttention: next, pancakeAttentionAt: new Date() } });
    if (r.count === 1) return true;
  }
  attentionLogger.error(`Không ghi được lý do "Cần xử lý Pancake" cho đơn ${orderId} sau ${ATTENTION_WRITE_ATTEMPTS} lượt (ô đổi liên tục): ${reason}`);
  return false;
}

export const ATTENTION_SEPARATOR = ' | ';

/** Nối một lý do vào hàng cần xử lý mà không làm mất lý do đang có (cùng dấu nối với việc ghi dấu trạng thái bị chặn). */
export const appendAttentionReason = (current: string | null | undefined, reason: string): string =>
  !current ? reason : current.split(ATTENTION_SEPARATOR).includes(reason) ? current : `${current}${ATTENTION_SEPARATOR}${reason}`;

/**
 * Gỡ đúng một lý do khỏi hàng cần xử lý (khi việc đó đã có người quyết); hết lý do thì đơn rời hàng đợi. Ghi có điều kiện theo giá trị
 * đã đọc như removeAttentionReasonsByPrefix: lý do webhook vừa nối chen giữa không bị xoá theo.
 */
export async function removeAttentionReason(tx: Pick<Prisma.TransactionClient, 'order'>, orderId: string, reason: string): Promise<void> {
  // Gọi trong tx quyết định của Kế toán: không gỡ được thì ném (409) để tx rollback và Kế toán bấm lại, không để dòng chờ Kế toán kẹt
  // mãi trên đơn không còn khoản UNVERIFIED nào để xử lý.
  await rewriteAttentionReasons(tx, orderId, (parts) => parts.filter((part) => part !== reason), true);
}

/**
 * Gỡ mọi lý do bắt đầu bằng một trong các tiền tố khỏi hàng cần xử lý, giữ lý do khác (clearPancakeAttention xoá cả hàng khi lý do
 * ĐẦU khớp). Đọc rồi ghi có điều kiện theo đúng giá trị đã đọc, nên lý do vừa được ghi chen giữa không bị ghi đè; thua thì đọc lại.
 */
export async function removeAttentionReasonsByPrefix(
  db: Pick<Prisma.TransactionClient, 'order'>,
  orderId: string,
  prefixes: string[],
): Promise<void> {
  await rewriteAttentionReasons(db, orderId, (parts) => parts.filter((part) => !prefixes.some((prefix) => part.startsWith(prefix))));
}

/** Thay mọi lý do mở đầu bằng `prefix` bằng một dòng `replacement` (giữ vị trí lý do đầu tiên khớp, không lặp), giữ lý do khác. */
export async function replaceAttentionReasonsByPrefix(
  db: Pick<Prisma.TransactionClient, 'order'>,
  orderId: string,
  prefix: string,
  replacement: string,
): Promise<void> {
  await rewriteAttentionReasons(db, orderId, (parts) => {
    const out: string[] = [];
    for (const part of parts) {
      const next = part.startsWith(prefix) ? replacement : part;
      if (!out.includes(next)) out.push(next);
    }
    return out;
  });
}

/**
 * Nối một lý do vào ô (đặt ở cuối) và đẩy `pancakeAttentionAt` lên mới, giữ các lý do khác; lý do mở đầu bằng một trong
 * `supersededPrefixes` bị thay (lời cũ cùng loại). Khác writePancakeAttention: không bao giờ đè cả ô.
 */
export async function appendPancakeAttention(
  db: Pick<Prisma.TransactionClient, 'order'>,
  orderId: string,
  reason: string,
  supersededPrefixes: string[] = [],
  opts: { onlyUnpaid?: boolean } = {},
): Promise<void> {
  for (let attempt = 0; attempt < ATTENTION_WRITE_ATTEMPTS; attempt += 1) {
    const row = await db.order.findUnique({ where: { id: orderId }, select: { pancakeAttention: true, paymentStatus: true } });
    if (!row) return;
    if (opts.onlyUnpaid && row.paymentStatus !== 'UNPAID') return;
    const kept = (row.pancakeAttention ? row.pancakeAttention.split(ATTENTION_SEPARATOR) : []).filter(
      (part) => !supersededPrefixes.some((prefix) => part.startsWith(prefix)),
    );
    const next = appendAttentionReason(kept.join(ATTENTION_SEPARATOR) || null, reason);
    const r = await db.order.updateMany({
      where: { id: orderId, pancakeAttention: row.pancakeAttention, ...(opts.onlyUnpaid ? { paymentStatus: 'UNPAID' as const } : {}) },
      data: { pancakeAttention: next, pancakeAttentionAt: new Date() },
    });
    if (r.count === 1) return;
  }
  throw new Error(`Không nối được lý do "Cần xử lý Pancake" của đơn ${orderId} sau ${ATTENTION_WRITE_ATTEMPTS} lượt (ô đổi liên tục).`);
}

/** Đọc ô, tính lại danh sách lý do, ghi có điều kiện theo đúng giá trị đã đọc; thua thì đọc lại. Không đổi gì thì không ghi. */
async function rewriteAttentionReasons(
  db: Pick<Prisma.TransactionClient, 'order'>,
  orderId: string,
  rewrite: (parts: string[]) => string[],
  throwWhenStuck = false,
): Promise<void> {
  for (let attempt = 0; attempt < ATTENTION_WRITE_ATTEMPTS; attempt += 1) {
    const row = await db.order.findUnique({ where: { id: orderId }, select: { pancakeAttention: true } });
    if (!row?.pancakeAttention) return;
    const next = rewrite(row.pancakeAttention.split(ATTENTION_SEPARATOR)).join(ATTENTION_SEPARATOR);
    if (next === row.pancakeAttention) return;
    const r = await db.order.updateMany({
      where: { id: orderId, pancakeAttention: row.pancakeAttention },
      data: next ? { pancakeAttention: next } : { pancakeAttention: null, pancakeAttentionAt: null },
    });
    if (r.count === 1) return;
  }
  const message = `Không cập nhật được lý do "Cần xử lý Pancake" của đơn ${orderId} sau ${ATTENTION_WRITE_ATTEMPTS} lượt (ô đổi liên tục).`;
  if (throwWhenStuck) throw new ConflictException('Ô Cần xử lý vừa đổi, bạn bấm lại nhé.');
  attentionLogger.error(message);
}
