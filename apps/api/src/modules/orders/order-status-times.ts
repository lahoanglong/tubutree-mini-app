/**
 * Lúc đơn chạm từng trạng thái lần đầu, cho dòng giờ dưới mỗi bước hành trình (chi tiết đơn của khách, trang theo dõi đơn vãng lai). Chỉ trạng
 * thái + giờ: không trả ghi chú hay người thao tác của sổ lịch sử. `rows` xếp theo `createdAt` tăng dần, không cắt số dòng.
 *
 * Bỏ dòng chuyển về chính nó (`from = to`: khách tự sửa đơn, admin chạy lại việc sau giao) TRƯỚC khi lấy dòng đầu của mỗi trạng thái. Đặt đơn
 * không ghi dòng lịch sử, nên dòng tự sửa có thể là dòng đầu của trạng thái X; lấy dòng đầu theo `toStatus` rồi mới bỏ (kiểu `distinct`) thì
 * lần vào X thật về sau (ví dụ kho lùi PACKED → CONFIRMED) mất giờ.
 */
export function firstStatusTimes(rows: readonly { fromStatus: string; toStatus: string; createdAt: Date }[]): Record<string, string> {
  const times: Record<string, string> = {};
  for (const r of rows) {
    if (r.fromStatus === r.toStatus || r.toStatus in times) continue;
    times[r.toStatus] = r.createdAt.toISOString();
  }
  return times;
}
