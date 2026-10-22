export const DEALER_BONUS_TIERS_KEY = 'dealer.quarterly_bonus_tiers';

/** Đại lý VIP chiết khấu 45% giá lẻ; thưởng doanh số cộng thêm trên đó nên 10% đã là trần rất rộng so với mặc định 2–4%. */
const BONUS_PCT_MAX = 10;
const BONUS_MIN_MAX = 100_000_000_000;
const BONUS_TIERS_MAX_COUNT = 10;

/**
 * DealerService.bonusTiers sắp xếp rồi đọc thẳng bảng này để trả thưởng bằng tiền: bậc sai hình dạng không bị phía đọc chặn
 * (min lẻ, pct chuỗi, pct 300) mà ra số tiền sai ngay lần trả ngày 10. Rỗng bị từ chối vì tắt thưởng là quyết định kinh doanh
 * riêng và màn tiến độ của đại lý hiện thanh đầy khi không còn bậc nào.
 */
export function dealerBonusTiersProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return 'phải là danh sách ít nhất một bậc, mỗi bậc {"min": doanh số quý (đồng), "pct": phần trăm thưởng}';
  }
  if (value.length > BONUS_TIERS_MAX_COUNT) return `tối đa ${BONUS_TIERS_MAX_COUNT} bậc`;
  let previous = 0;
  for (const [i, tier] of value.entries()) {
    const at = `bậc thứ ${i + 1}`;
    if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return `${at} phải là {"min": ..., "pct": ...}`;
    const keys = Object.keys(tier);
    if (keys.length !== 2 || !keys.includes('min') || !keys.includes('pct')) {
      return `${at} chỉ gồm "min" (doanh số quý, đồng) và "pct" (phần trăm thưởng)`;
    }
    const { min, pct } = tier as { min: unknown; pct: unknown };
    if (typeof min !== 'number' || !Number.isInteger(min) || min < 1 || min > BONUS_MIN_MAX) {
      return `${at}: "min" phải là số nguyên đồng từ 1 đến ${BONUS_MIN_MAX.toLocaleString('vi-VN')}`;
    }
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > BONUS_PCT_MAX) {
      return `${at}: "pct" phải là số lớn hơn 0 và không quá ${BONUS_PCT_MAX} (3 nghĩa là 3%)`;
    }
    if (min <= previous) return `${at}: ngưỡng "min" phải tăng dần, không trùng với bậc trước`;
    previous = min;
  }
  return null;
}
