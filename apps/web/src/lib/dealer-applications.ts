/** Nhãn trạng thái hồ sơ đăng ký đại lý (DealerStatus ở API; bộ lọc /admin/dealer-applications nhận cả bốn giá trị). */
const DEALER_APP_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  SUSPENDED: 'Tạm ngưng',
};

/** Trạng thái API thêm sau mà web chưa biết vẫn hiện được, không in mã thô ra màn hình. */
export function dealerAppStatusLabel(status: string): string {
  return DEALER_APP_STATUS_LABEL[status] ?? 'Trạng thái khác';
}

/** Ô lọc hồ sơ đại lý: `value` là chuỗi gửi lên API ('' = không lọc), `label` là chữ hiển thị. */
export const DEALER_APP_FILTERS: { value: string; label: string }[] = [
  ...['PENDING', 'APPROVED', 'REJECTED'].map((value) => ({ value, label: dealerAppStatusLabel(value) })),
  { value: '', label: 'Tất cả trạng thái' },
];
