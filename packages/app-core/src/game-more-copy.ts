const n = (v: number) => v.toLocaleString('vi-VN');
const drops = (v: number) => `${n(v)}💧`;

/**
 * Chữ riêng của trang Vườn Xanh, tách khỏi `gameNewbieCopy` vì Mini App nạp cả `gameNewbieCopy` vào gói đầu (qua i18n/vi.ts);
 * thêm vào đó thì mọi trang đều tải chữ mà chỉ Vườn dùng. Phải ở file riêng: rollup giữ cả module trong gói đầu nếu một export của nó còn được dùng ở đó.
 */
export const gameMoreCopy = {
  claimPoints: 'Nhận Điểm Xanh hôm nay',
  /** Nút vé giữ lửa khi chưa đủ nước: nói rõ thiếu để làm gì. */
  freezeShort: (missing: number) => `Giữ chuỗi (cần thêm ${drops(missing)})`,
  freezeHint: (dew: number | null) =>
    `Vé giữ lửa giúp chuỗi không đứt khi bạn lỡ 1 ngày. Giọt sương sáng tặng ${dew == null ? '💧' : drops(dew)} mỗi ngày.`,
  /** Thẻ câu đố có ba trạng thái khác nhau: đã làm xong, chưa có câu, tải lỗi. */
  quiz: {
    done: 'Bạn đã hoàn thành câu đố hôm nay 🎉',
    empty: 'Câu đố mới vào ngày mai',
    loading: 'Đang tải câu đố…',
    loadErrorTitle: 'Chưa tải được câu đố',
    loadErrorBody: 'Kiểm tra mạng rồi thử lại.',
  },
  missionsShowAll: (total: number) => `Xem tất cả (${total})`,
  missionsShowLess: 'Thu gọn',
};

/** Số nhiệm vụ chưa xong hiện sẵn ở tab Hôm nay; phần còn lại nằm sau "Xem tất cả". */
export const MISSIONS_COLLAPSED = 3;

/**
 * Thu gọn thẻ nhiệm vụ: chỉ các việc chưa nhận thưởng, tối đa `MISSIONS_COLLAPSED`. Chưa có việc nào dang dở
 * thì giữ nguyên cả danh sách (không có gì để giấu). `collapsible` = có phần bị giấu, cần nút "Xem tất cả".
 */
export function collapseMissions<T extends { claimed?: boolean }>(missions: T[], showAll: boolean): { items: T[]; collapsible: boolean } {
  const open = missions.filter((m) => !m.claimed);
  if (open.length === 0) return { items: missions, collapsible: false };
  const compact = open.slice(0, MISSIONS_COLLAPSED);
  return { items: showAll ? missions : compact, collapsible: compact.length < missions.length };
}
