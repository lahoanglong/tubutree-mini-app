/**
 * Độ cuộn cần bù (≤ 0, cuộn ngược lên) để đầu danh sách trở lại sát thanh dính. `sentinelTop` là mép trên của điểm đánh dấu đặt ngay
 * trước thanh sắp xếp (vị trí TỰ NHIÊN của thanh, không dính), `stuckLine` là mép dưới của vùng dính phía trên nó (hàng ô tìm /
 * thanh đầu), cùng toạ độ khung nhìn. Bằng 0 khi khách chưa cuộn qua đầu danh sách: không kéo ai xuống.
 *
 * Đổi sắp xếp hoặc bộ lọc giữa lưới sâu thay lưới bằng khung chờ ngắn hơn: không về đầu danh sách thì trình duyệt kẹp vị trí về
 * giữa trang và hai hàng đầu (món rẻ nhất, bán chạy nhất) nằm khuất dưới thanh dính.
 */
export function scrollDeltaToListTop(sentinelTop: number, stuckLine: number): number {
  const delta = sentinelTop - stuckLine;
  return Number.isFinite(delta) && delta < 0 ? delta : 0;
}
