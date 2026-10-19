import type { AdminExternalClaimAttentionFilter, ExternalClaimAdminErrorCode, ExternalClaimRejectCode, ExternalClaimState } from '@tubutree/shared-types';
import type { Tone } from './recycling';

export const CLAIM_STATE_ORDER: ExternalClaimState[] = ['REVIEW', 'PENDING', 'HELD_NO_MEMBER', 'CREDITED', 'VOIDED', 'REVERSED', 'LAPSED'];

export const CLAIM_STATE_LABEL: Record<ExternalClaimState, string> = {
  REVIEW: 'Cần duyệt',
  PENDING: 'Chờ cộng điểm',
  HELD_NO_MEMBER: 'Chờ khách thành viên',
  CREDITED: 'Đã cộng',
  VOIDED: 'Đã huỷ',
  REVERSED: 'Đã đảo điểm',
  LAPSED: 'Hết hạn',
};

export const CLAIM_STATE_TONE: Record<ExternalClaimState, Tone> = {
  REVIEW: 'warning',
  PENDING: 'info',
  HELD_NO_MEMBER: 'neutral',
  CREDITED: 'success',
  VOIDED: 'danger',
  REVERSED: 'danger',
  LAPSED: 'neutral',
};

export const CLAIM_SOURCE_LABEL = { MARKETPLACE: 'Đơn sàn', CHAT: 'Chat / điện thoại', UNKNOWN: 'Chưa biết nguồn' } as const;

export interface ClaimActions {
  approve: boolean;
  void: boolean;
  voidAndReopen: boolean;
  reverse: boolean;
  keepPoints: boolean;
}

const UNPAID: readonly ExternalClaimState[] = ['REVIEW', 'PENDING', 'HELD_NO_MEMBER'];
const CLOSED_ORDER = ['CANCELLED', 'RETURNED', 'DELETED'];

export interface ClaimActor {
  isAdmin: boolean;
  /** Nhóm CSKH (hoặc ADMIN): duyệt, huỷ, xử lý lần gửi mã. KE_TOAN không có quyền này. */
  canAct: boolean;
  meId?: string;
}

/**
 * Nút hiện theo trạng thái claim và quyền, khớp API: ADMIN và CSKH duyệt/huỷ claim chưa cộng, chỉ ADMIN đảo điểm đã cộng và
 * "giữ điểm, gỡ cờ" (chỉ khi claim đang có cờ), KE_TOAN chỉ đọc. Không ai thao tác được claim của chính mình (SELF_ACTION).
 */
export function claimActions(
  claim: { state: ExternalClaimState; userId: string | null; reviewReason: string | null },
  who: ClaimActor,
): ClaimActions {
  const none = { approve: false, void: false, voidAndReopen: false, reverse: false, keepPoints: false };
  if (who.meId && claim.userId === who.meId) return none;
  const canAct = who.isAdmin || who.canAct;
  const unpaid = UNPAID.includes(claim.state);
  return {
    approve: canAct && claim.state === 'REVIEW',
    void: canAct && unpaid,
    voidAndReopen: canAct && unpaid,
    reverse: who.isAdmin && claim.state === 'CREDITED',
    keepPoints: who.isAdmin && claim.state === 'CREDITED' && claim.reviewReason !== null,
  };
}

/** Nhãn cảnh báo khi mốc xác minh SĐT của thành viên đã cũ (hoặc chưa có). */
export const PHONE_STALE_LABEL = 'SĐT xác minh đã cũ, kiểm người nhận';

/**
 * Claim chat có chủ mà mốc xác minh SĐT vẫn cũ: API bắt ghi chú cách người duyệt đã xác nhận người nhận, bất kể lý do REVIEW (400
 * NOTE_REQUIRED nếu thiếu). Mốc cũ lấy từ `memberPhoneStale` của chính dòng đó.
 */
export const approveNeedsNote = (c: { kind: string; memberPhoneStale?: boolean }): boolean => c.kind === 'PHONE' && c.memberPhoneStale === true;

/** Ký tự vô hình (cùng biểu thức với API `external-claim-note.ts`): không tính vào độ dài ghi chú. */
export const INVISIBLE_CHARS = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180E\u2800\u3164\uFFA0]/gu;

/** Ghi chú duyệt claim SĐT cũ cần ít nhất chừng này ký tự thật; khớp `MIN_NOTE_CHARS` của API. */
export const NOTE_MIN_CHARS = 3;

export const noteContentLength = (note: string): number => note.replace(INVISIBLE_CHARS, '').replace(/\s/g, '').length;

export const NOTE_TOO_SHORT_TEXT = `Ghi chú cần ít nhất ${NOTE_MIN_CHARS} ký tự`;

/** Lỗi cho ô ghi chú duyệt, hoặc null khi đủ dài. Ô trống không báo (nút đã bị khoá vì bắt buộc). */
export const approveNoteError = (note: string): string | null => (note.trim() === '' || noteContentLength(note) >= NOTE_MIN_CHARS ? null : NOTE_TOO_SHORT_TEXT);

export const isNoteRequiredError = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === 'NOTE_REQUIRED';

/** Đã cộng điểm mà đơn đã huỷ, hoàn hoặc xoá: lẽ ra phải đảo điểm. */
export const creditedOnClosedOrder = (c: { state: ExternalClaimState; orderStatus: string }) =>
  c.state === 'CREDITED' && CLOSED_ORDER.includes(c.orderStatus);

const INTRODUCER_ACTIONS = ['ATTACH', 'TO_REVIEW', 'VOID_REOPEN'];

/** Người đã gắn đơn, đưa claim vào chờ duyệt hoặc mở lại mã không được tự duyệt (SAME_INTRODUCER). */
export function isIntroducer(events: readonly { action: string; actorId: string | null }[], meId: string | undefined): boolean {
  return !!meId && events.some((e) => INTRODUCER_ACTIONS.includes(e.action) && e.actorId === meId);
}

export const EVENT_ACTION_LABEL: Record<string, string> = {
  CLAIM_CREATED: 'Khách gửi mã, tạo yêu cầu',
  ATTACH: 'Gắn đơn cho lần gửi mã',
  TO_REVIEW: 'Đưa vào chờ duyệt',
  APPROVE: 'Duyệt',
  VOID: 'Huỷ',
  VOID_REOPEN: 'Huỷ và mở lại mã',
  REOPEN_CLAIM: 'Nhận lại mã đã mở',
  AUTO_VOID: 'Hệ thống tự huỷ',
  CREDIT: 'Cộng điểm',
  FLAG_PARTIAL: 'Gắn cờ đơn hoàn một phần',
  KEEP_POINTS: 'Giữ điểm, gỡ cờ',
  REVERSE: 'Đảo điểm',
  LINK_PHONE: 'Liên kết claim theo SĐT thành viên',
  HOLD_NO_MEMBER: 'Giữ điểm chờ khách thành viên',
  LAPSE: 'Hết hạn giữ điểm',
  PHONE_CHANGED: 'SĐT trên đơn đổi, chuyển chờ duyệt',
  AUTO_REVERSE: 'Hệ thống tự đảo điểm',
};

const ADMIN_ERROR_TEXT: Record<ExternalClaimAdminErrorCode | ExternalClaimRejectCode, string> = {
  SELF_ACTION: 'Bạn không được xử lý yêu cầu hay lần gửi mã của chính mình. Nhờ người khác xử lý.',
  SAME_INTRODUCER: 'Bạn đã gắn đơn, đưa yêu cầu vào chờ duyệt hoặc mở lại mã này nên không tự duyệt được. Nhờ người khác duyệt.',
  ATTACH_ADMIN_ONLY: 'Mã khách gửi không trùng mã trên đơn, hoặc nguồn đơn chưa xác định. Chỉ ADMIN được gắn trường hợp này.',
  NOTE_REQUIRED: 'Trường hợp này cần ghi chú lý do. Bạn nhập ghi chú rồi thử lại.',
  PANCAKE_CREATOR_SELF: 'Bạn là người tạo hoặc phụ trách đơn này trên Pancake nên không tự duyệt điểm của đơn đó. Nhờ người khác duyệt.',
  NOT_FLAGGED: 'Yêu cầu này không còn cờ cần xử lý (có thể người khác vừa xử lý). Tải lại danh sách.',
  DISABLED: 'Tính năng tích điểm đơn sàn đang tắt (cờ loyalty.marketplace_claim_enabled).',
  NOT_ELIGIBLE_USER: 'Khách chưa đủ điều kiện tích điểm: cần tài khoản thật, có số điện thoại và không bị khoá.',
  INVALID_CODE: 'Mã không hợp lệ (cần 8 đến 30 chữ và số).',
  LOCKED: 'Khách đang bị khoá 24 giờ vì nhập mã không tìm thấy quá nhiều lần.',
  DAILY_ATTEMPTS: 'Khách đã hết số lần nhập mã trong ngày.',
  APP_ORDER: 'Đây là đơn đặt trong Mini App, điểm đã được tích theo đơn app.',
  CHAT_ORDER: 'Đây là đơn chat/điện thoại, điểm cộng tự động theo số điện thoại, không tích bằng mã.',
  TOO_OLD: 'Đơn quá cũ, vượt tuổi đơn tối đa được tích điểm.',
  BEFORE_SINCE: 'Đơn đặt trước mốc bắt đầu chương trình tích điểm đơn sàn.',
  CLOSED: 'Đơn đã huỷ hoặc hoàn nên không tích điểm được.',
  ALREADY_CLAIMED: 'Mã này đã có yêu cầu tích điểm khác.',
  DAILY_MAX: 'Khách đã tích đủ số đơn cho phép trong ngày.',
  MONTHLY_CAP: 'Khách đã đạt trần điểm đơn sàn trong tháng này.',
  ZERO_POINTS: 'Giá trị đơn quá nhỏ, quy ra 0 điểm.',
};

/** Câu tiếng Việt cho lỗi của API admin (viết cho nhân viên, không phải câu của khách): theo `code` nếu biết, không thì nguyên văn message của API. */
export function adminClaimErrorText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code in ADMIN_ERROR_TEXT) return ADMIN_ERROR_TEXT[code as keyof typeof ADMIN_ERROR_TEXT];
  return e instanceof Error ? e.message : 'Thao tác thất bại.';
}

/**
 * Lời nhắc trước khi gắn lần gửi mã vào đơn, đúng luật API: gắn vẫn áp tuổi đơn, mốc bắt đầu, trần đơn/ngày và trần điểm/tháng
 * (chỉ khoá 24 giờ và số lần nhập được bỏ qua); claim vẫn có thể vào chờ duyệt; mã không khớp hoặc nguồn chưa xác định thì chỉ ADMIN gắn.
 */
export function attachDialogMessage(maskedCode: string, isAdmin: boolean): string {
  const base =
    `Gắn mã ${maskedCode} của khách vào một đơn Pancake. Vẫn áp tuổi đơn, mốc bắt đầu chương trình, trần số đơn mỗi ngày và trần điểm mỗi tháng. ` +
    'Yêu cầu vẫn có thể vào chờ duyệt (đơn vượt ngưỡng, chưa tính được tiền hàng, 3 số cuối SĐT khác, khách là nhân viên, đơn hoàn một phần, mã vừa được mở lại).';
  return isAdmin
    ? `${base} Mã không khớp đơn hoặc nguồn chưa xác định: cần ghi chú, không cần người khác duyệt, thao tác được ghi vào lịch sử.`
    : `${base} Mã không khớp đơn hoặc nguồn chưa xác định: chỉ ADMIN gắn được.`;
}

/** Số nguyên có dấu chấm nghìn: 1250000 → "1.250.000". */
export function groupThousands(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}


export const ATTENTION_FILTER_LABEL: Record<AdminExternalClaimAttentionFilter, string> = {
  closed_credited: 'Đã cộng mà đơn đã đóng',
  stale: 'Kẹt chờ quá lâu',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Chưa giao xong',
  DELIVERED: 'Đã giao',
  RETURNING: 'Đang hoàn',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã huỷ',
  PARTIAL_RETURN: 'Hoàn một phần',
  DELETED: 'Đã xoá',
};
