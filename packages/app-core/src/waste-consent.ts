/** Câu hiện khi khách đã tick đồng ý nhưng admin vừa đổi phiên bản thể lệ. */
export const WASTE_RULES_UPDATED_NOTE = 'Thể lệ vừa được cập nhật. Bạn đọc lại Thể lệ rồi tick đồng ý lại nhé';

/**
 * Ô đồng ý còn hiệu lực không. `ack` là phiên bản thể lệ lúc khách tick (có thể đã giữ qua màn Thể lệ), `current` là phiên bản
 * máy chủ đang đặt. Chưa biết `current` (thể lệ chưa tải được) thì tin ô đã tick, máy chủ vẫn kiểm lại. Đã biết `current` mà
 * khách tick từ lúc chưa có phiên bản (`ack` rỗng) thì không chắc khách đã đọc bản này nên phải tick lại.
 */
export function consentStillValid(ack: string | null | undefined, current: string | null | undefined): boolean {
  return !current || (!!ack && ack === current);
}
