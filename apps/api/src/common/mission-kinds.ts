/**
 * Loại nhiệm vụ mà GameService biết chấm. Quản trị chỉ chọn trong danh sách này khi thêm nhiệm vụ mới, nên không có nhiệm vụ nào
 * hứa mà không chấm được. Bốn nhiệm vụ seed không có cột `kind`: suy từ `code`.
 */
export const MISSION_KINDS = ['CHECKIN_STREAK', 'ORDER_COUNT', 'REVIEW_COUNT', 'INVITE_COUNT'] as const;
export type MissionKind = (typeof MISSION_KINDS)[number];

export const MISSION_KIND_LABELS: Record<MissionKind, string> = {
  CHECKIN_STREAK: 'Điểm danh liên tiếp (số ngày)',
  ORDER_COUNT: 'Đơn đã giao, hết hạn đổi trả (số đơn)',
  REVIEW_COUNT: 'Đánh giá có ảnh (số sản phẩm khác nhau)',
  INVITE_COUNT: 'Mời bạn mua thành công (số người)',
};

/** Trần mục tiêu theo loại: đủ rộng cho nhiệm vụ dài hơi, đủ chặt để gõ nhầm số 0 thừa không tạo nhiệm vụ không ai làm xong. */
export const MISSION_GOAL_MAX: Record<MissionKind, number> = {
  CHECKIN_STREAK: 365,
  ORDER_COUNT: 100,
  REVIEW_COUNT: 100,
  INVITE_COUNT: 100,
};

const LEGACY_CODE_KIND: Record<string, MissionKind> = {
  CHECKIN_7: 'CHECKIN_STREAK',
  FIRST_ORDER: 'ORDER_COUNT',
  REVIEW_3: 'REVIEW_COUNT',
  INVITE_3: 'INVITE_COUNT',
};

export function isMissionKind(v: unknown): v is MissionKind {
  return typeof v === 'string' && (MISSION_KINDS as readonly string[]).includes(v);
}

export function missionKindOf(m: { code: string; kind?: string | null }): MissionKind | null {
  if (isMissionKind(m.kind)) return m.kind;
  return LEGACY_CODE_KIND[m.code] ?? null;
}
