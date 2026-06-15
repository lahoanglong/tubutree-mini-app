/** Định dạng VND: 289000 → "289.000đ". */
export function formatVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')}đ`;
}

/** Ghép dòng địa chỉ, bỏ phần rỗng (hệ 2 cấp không còn quận/huyện → tránh ", ,"). */
export function addressLine(a: {
  street?: string | null;
  ward?: string | null;
  district?: string | null;
  province?: string | null;
}): string {
  return [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ');
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã hủy',
};
