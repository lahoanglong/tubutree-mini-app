/**
 * Cột `orders.notifyRecipientZalo` lúc đặt (PO A1): khách bật công tắc người nhận VÀ cùng lần đặt có đồng ý nhận tin Zalo. Công tắc chỉ hiện
 * khi ô đồng ý được tick; client cũ hay request tự dựng gửi công tắc mà không có đồng ý thì không ghi. Đơn tách nhiều kiện mang cùng giá trị.
 */
export function notifyRecipientZaloOf(dto: { notifyRecipientZalo?: boolean; orderZaloConsent?: boolean }): boolean {
  return dto.notifyRecipientZalo === true && dto.orderZaloConsent === true;
}
