const REWARD_TYPES = ['POINTS', 'COUPON', 'SEEDS', 'NONE'];

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Lý do một giải của `game.spin_prizes` không dùng được, hoặc null nếu hợp lệ. Dùng chung cho luật ghi cấu hình
 * (SystemConfigService) và cho GameService.spin khi đọc, vì cấu hình đã lưu từ trước luật ghi vẫn có thể hỏng.
 *
 * Thưởng âm là cái hại nhất: giải POINTS value âm đi vào GameService.creditPoints nhánh trừ điểm, trừ điểm của khách
 * ngoài luật điểm đang khoá của đơn còn đổi/trả. Giải SEEDS/COUPON âm cũng trừ hoặc tạo giá trị sai. weight không hữu
 * hạn làm pickWeighted trả NaN. Giải POINTS value 0 là giải không có thưởng nhưng vẫn ghi một dòng sổ điểm 0, nên loại.
 */
export function spinPrizeProblem(prize: unknown): string | null {
  if (typeof prize !== 'object' || prize === null || Array.isArray(prize)) {
    return 'mỗi giải phải là object { id, name, weight, rewardType, value }';
  }
  const p = prize as Record<string, unknown>;
  if (typeof p.id !== 'string' || p.id.trim() === '') return 'id phải là chuỗi không rỗng';
  if (typeof p.name !== 'string' || p.name.trim() === '') return 'name phải là chuỗi không rỗng';
  if (typeof p.rewardType !== 'string' || !REWARD_TYPES.includes(p.rewardType)) {
    return `rewardType chỉ nhận ${REWARD_TYPES.join(', ')}`;
  }
  if (!isFiniteNumber(p.weight) || p.weight < 0) return 'weight phải là số hữu hạn ≥ 0';
  if (p.rewardType === 'POINTS' && !(typeof p.value === 'number' && Number.isSafeInteger(p.value) && p.value >= 1)) {
    return 'giải POINTS cần value là Điểm Xanh nguyên ≥ 1 (số âm sẽ trừ điểm của khách)';
  }
  if (!isFiniteNumber(p.value) || p.value < 0) return 'value phải là số hữu hạn ≥ 0';
  return null;
}
