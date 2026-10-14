export interface GroupBuyConfig {
  discountPct: number;
  targetSize: number;
}

/**
 * Mua chung thật sự: đủ người thì mỗi thành viên nhận MÃ GIẢM (groupbuy.discount_pct, mặc định 15%) dùng cho đơn từ
 * giá nhóm, không phải giảm thẳng giá. Con số lấy từ /config/public để admin đổi config không làm copy nói sai.
 */
export function groupBuyPitch(cfg?: GroupBuyConfig | null): string {
  if (cfg && cfg.discountPct > 0 && cfg.targetSize > 0) {
    return `Rủ đủ ${cfg.targetSize} người, mỗi người nhận mã giảm ${cfg.discountPct}% khi nhóm đủ`;
  }
  return 'Rủ bạn bè cho đủ nhóm, mỗi người nhận mã giảm giá';
}

/** Menu Cá nhân là danh sách tĩnh nên không đưa con số vào. */
export const GROUP_BUY_MENU_HINT = 'Rủ bạn mua chung, đủ nhóm nhận mã giảm';
