/** Phần khách nhìn thấy trước tiên ở gian hàng: chủ đổi sau khi admin duyệt thì admin cần thấy dấu "Đổi sau duyệt". */
export const CONTENT_FIELDS = ['title', 'headerNote', 'avatarUrl', 'coverUrl'] as const;

type ContentField = (typeof CONTENT_FIELDS)[number];

/**
 * Dấu đổi nội dung cho một lần lưu gian hàng đã duyệt. So với giá trị đang lưu (không phải với "có gửi lên") vì builder và cổng /merchant
 * gửi lại cả bộ trường mỗi lần bấm Lưu; trường không gửi (undefined) không tính là đổi.
 */
export function contentChangedPatch(
  current: { approvedAt: Date | null } & Partial<Record<ContentField, string | null>>,
  next: Partial<Record<ContentField, unknown>>,
): { contentChangedAt?: Date } {
  if (!current.approvedAt) return {};
  return CONTENT_FIELDS.some((k) => next[k] !== undefined && next[k] !== current[k]) ? { contentChangedAt: new Date() } : {};
}
