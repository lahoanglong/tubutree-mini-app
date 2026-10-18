import type { ExternalClaimState } from '@tubutree/shared-types';
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
}

const UNPAID: readonly ExternalClaimState[] = ['REVIEW', 'PENDING', 'HELD_NO_MEMBER'];

/**
 * Nút hiện theo trạng thái claim và quyền, khớp API: ADMIN và CSKH duyệt/huỷ claim chưa cộng, chỉ ADMIN đảo điểm đã cộng,
 * KE_TOAN chỉ đọc (không có nút nào).
 */
export function claimActions(state: ExternalClaimState, who: { isAdmin: boolean; canAct: boolean }): ClaimActions {
  const canAct = who.isAdmin || who.canAct;
  const unpaid = UNPAID.includes(state);
  return {
    approve: canAct && state === 'REVIEW',
    void: canAct && unpaid,
    voidAndReopen: canAct && unpaid,
    reverse: who.isAdmin && state === 'CREDITED',
  };
}

/** Số nguyên có dấu chấm nghìn: 1250000 → "1.250.000". */
export function groupThousands(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

