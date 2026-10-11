/**
 * Khoá SystemConfig còn nằm trong seed/DB nhưng KHÔNG code nào đọc: sửa ở tab Cấu hình không có tác dụng
 * (admin tưởng đã tắt COD, đặt trần COD hay đổi mã giảm giá chào mừng mà hệ thống vẫn chạy như cũ).
 * Admin bị chặn ghi các khoá này (admin-config-rules.ts), GET /admin/config gắn `deprecated` để UI hiện
 * nhãn "Không dùng". Dòng trong DB chưa bị xoá: gỡ hẳn là việc dọn code chết riêng.
 *
 * Khi một khoá được nối vào code thật thì xoá nó khỏi danh sách này; dead-config-keys.spec.ts quét mã nguồn
 * và fail nếu danh sách lệch thực tế (khoá còn trong danh sách mà đã có code đọc, hoặc khoá seed không ai đọc
 * mà chưa được liệt kê).
 */
export const DEAD_CONFIG_KEYS: Readonly<Record<string, string>> = {
  'loyalty.welcome_voucher_amount': 'Mã giảm giá chào mừng đọc từ "voucher.welcome_amount".',
  'loyalty.welcome_voucher_min_order': 'Đơn tối thiểu của mã giảm giá chào mừng đọc từ "voucher.welcome_min_order".',
  'affiliate.product_rate_source': 'Tỉ lệ hoa hồng đọc từ từng biến thể sản phẩm, không có công tắc chọn nguồn.',
  'affiliate.monthly_tier_thresholds': 'Ngưỡng bậc CTV nằm cố định trong code (ctv-milestones.ts).',
  'affiliate.monthly_tier_bonuses': 'Thưởng bậc CTV nằm cố định trong code (ctv-milestones.ts).',
  'affiliate.last_click_window_days': 'Cửa sổ ghi nhận giới thiệu là "affiliate.attribution_days".',
  'affiliate.kyc_required_above': 'Chưa có luồng xác minh KYC đọc khoá này.',
  'affiliate.tubu_wallet_multiplier': 'Rút hoa hồng về Ví Tubu quy đổi 1:1.',
  'cashback.merchant_tubu_share': 'Phần Tubu giữ là phần còn lại của hoa hồng sau "cashback.merchant_user_share" (mặc định 70%), không có khoá riêng.',
  'cashback.min_withdraw_bank': 'Rút Ví về ngân hàng dùng "wallet.withdraw_min".',
  'cashback.tubu_wallet_multiplier': 'Hoàn tiền sàn ngoài vào Ví Tubu quy đổi 1:1.',
  'coins.referee_reward': 'Người được mời chỉ nhận mã giảm giá chào mừng; chỉ người mời được thưởng ("referral.referrer_reward_points").',
  // PD-3: xu gộp vào Điểm Xanh (1.000 xu = 1 điểm). Khoá mới tên khác (*_points) để không bao giờ đọc giá trị
  // xu dưới tên điểm; migration 20261012120000_pd3_points_config_keys chép giá trị DB bằng CEIL(n/1000).
  'coins.referrer_reward': 'Đã gộp vào Điểm Xanh: thưởng người giới thiệu đọc "referral.referrer_reward_points" (điểm, không phải xu).',
  'coins.referral_milestones': 'Đã gộp vào Điểm Xanh: mốc giới thiệu đọc "referral.milestones_points" ({count, bonusPoints}).',
  'community.post_reward': 'Đã gộp vào Điểm Xanh: thưởng đăng bài đọc "community.post_reward_points".',
  'community.answer_reward': 'Đã gộp vào Điểm Xanh: thưởng trả lời đọc "community.answer_reward_points".',
  'community.best_answer_reward': 'Đã gộp vào Điểm Xanh: thưởng câu trả lời hay nhất đọc "community.best_answer_reward_points".',
  'game.tree_xu_price': 'Đã gộp vào Điểm Xanh: góp quỹ trồng cây đọc "game.tree_points_price" (điểm, không phải xu).',
  'game.plot_unlock_xu_base': 'Mở lô đất bằng xu đã ngừng (PD-3), chỉ còn giọt nước ("game.plot_unlock_seed_base").',
  'game.xu_per_seed': 'Mua giọt nước bằng xu đã ngừng (C-009).',
  'wallet.xu_convert_multiplier': 'Đổi Ví sang xu đã ngừng (PD-3, Q-03): tiền Ví chỉ rút hoặc trả đơn.',
  'dealer.kyc_required': 'Chưa có luồng xác minh KYC đại lý đọc khoá này.',
  'game.daily_checkin_seeds': 'Giọt nước khi mở app/điểm danh dùng "game.daily_login_seeds".',
  'game.daily_checkin_points': 'Điểm Xanh điểm danh dùng "loyalty.checkin_points".',
  'game.quiz_correct_points': 'Chưa có luồng quiz đọc khoá này.',
  'return.allow_manufacturer_defect_only': 'Chính sách đổi/trả hiện nằm trong code và quy trình duyệt, không có công tắc cấu hình.',
  'return.shipping_paid_by_tubu_if_defect': 'Chính sách đổi/trả hiện nằm trong code và quy trình duyệt, không có công tắc cấu hình.',
  'return.affiliate_commission_reverse_window_days': 'Thu hồi hoa hồng khi trả hàng không đọc khoá này; hạn đổi/trả đọc từ "returns.window_days".',
  'payment.enabled_methods': 'Phương thức thanh toán nằm trong code checkout, chưa có công tắc bật/tắt.',
  'payment.cod_max_amount': 'Chưa có trần giá trị đơn COD ở checkout.',
  'eco.real_tree_partner': 'Chưa có luồng trồng cây thật đọc khoá này.',
  'eco.real_tree_cost_each': 'Chưa có luồng trồng cây thật đọc khoá này.',
  'eco.real_tree_monthly_budget': 'Chưa có luồng trồng cây thật đọc khoá này.',
  'rbac.admin_phones': 'Quyền admin cấp ở bảng role_grants (tab Nhân sự), không đọc khoá này.',
};

export function isDeadConfigKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEAD_CONFIG_KEYS, key);
}

/** Lời giải thích vì sao khoá vô tác dụng; null nếu khoá còn dùng. */
export function deadConfigKeyReason(key: string): string | null {
  return isDeadConfigKey(key) ? DEAD_CONFIG_KEYS[key]! : null;
}
