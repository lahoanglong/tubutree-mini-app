import type { ExternalClaimAdminErrorCode, ExternalClaimState } from '@tubutree/shared-types';
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

/** Đã cộng điểm mà đơn đã huỷ, hoàn hoặc xoá: lẽ ra phải đảo điểm. */
export const creditedOnClosedOrder = (c: { state: ExternalClaimState; orderStatus: string }) =>
  c.state === 'CREDITED' && CLOSED_ORDER.includes(c.orderStatus);

/** Người đã gắn đơn hoặc đưa claim vào chờ duyệt không được tự duyệt (SAME_INTRODUCER). */
export function isIntroducer(events: readonly { action: string; actorId: string | null }[], meId: string | undefined): boolean {
  return !!meId && events.some((e) => (e.action === 'ATTACH' || e.action === 'TO_REVIEW') && e.actorId === meId);
}

export const EVENT_ACTION_LABEL: Record<string, string> = {
  ATTACH: 'Gắn đơn cho lần gửi mã',
  TO_REVIEW: 'Đưa vào chờ duyệt',
  APPROVE: 'Duyệt',
  VOID: 'Huỷ',
  AUTO_VOID: 'Hệ thống tự huỷ',
  CREDIT: 'Cộng điểm',
  SYNC_RELEASE: 'Đồng bộ mốc cộng',
  FLAG_PARTIAL: 'Gắn cờ đơn hoàn một phần',
  KEEP_POINTS: 'Giữ điểm, gỡ cờ',
  REVERSE: 'Đảo điểm',
  NONE: 'Không đổi',
};

const ADMIN_ERROR_TEXT: Record<ExternalClaimAdminErrorCode, string> = {
  SELF_ACTION: 'Bạn không được xử lý yêu cầu hay lần gửi mã của chính mình. Nhờ người khác xử lý.',
  SAME_INTRODUCER: 'Bạn đã gắn đơn hoặc đưa yêu cầu này vào chờ duyệt nên không tự duyệt được. Nhờ người khác duyệt.',
  ATTACH_ADMIN_ONLY: 'Mã khách gửi không trùng mã trên đơn, hoặc nguồn đơn chưa xác định. Chỉ ADMIN được gắn trường hợp này.',
  NOTE_REQUIRED: 'Trường hợp này cần ghi chú lý do. Bạn nhập ghi chú rồi thử lại.',
  NOT_FLAGGED: 'Yêu cầu này không còn cờ cần xử lý (có thể người khác vừa xử lý). Tải lại danh sách.',
};

/** Câu tiếng Việt cho lỗi của API admin: theo `code` nếu biết, không thì nguyên văn message của API. */
export function adminClaimErrorText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code in ADMIN_ERROR_TEXT) return ADMIN_ERROR_TEXT[code as ExternalClaimAdminErrorCode];
  return e instanceof Error ? e.message : 'Thao tác thất bại.';
}

/** Số nguyên có dấu chấm nghìn: 1250000 → "1.250.000". */
export function groupThousands(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

