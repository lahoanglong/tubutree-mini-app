const QR_POLL_MS = 5_000;
const OPEN_POLL_MS = 15_000;

/**
 * Nhịp hỏi lại trang một yêu cầu đổi rác: nhanh khi khách đang mở mã QR ở quầy, chậm hơn khi yêu cầu còn chờ để thấy quầy đã
 * xác nhận mà không cần tải lại. TanStack tự bỏ nhịp khi tab ẩn. Hết chờ (xong, huỷ, quá hạn) thì dừng.
 */
export function wasteRequestRefetchMs(status: string | undefined, qrOpen: boolean): number | false {
  if (status !== 'OPEN') return false;
  return qrOpen ? QR_POLL_MS : OPEN_POLL_MS;
}
