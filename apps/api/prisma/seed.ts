/**
 * Seed dev DB:
 *  - SystemConfig: toàn bộ key từ Build Spec Section 15.2 (single source of truth).
 *  - MembershipTier: 4 hạng loyalty (Mầm Xanh → Cổ Thụ).
 *  - DealerTier: 4 bậc đại lý.
 * Catalog (~50 sản phẩm) sẽ seed từ Pancake ở Phase 1, không nằm ở đây.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { seedGameQuiz } from './seed-game-quiz';

const prisma = new PrismaClient();

type ConfigSeed = {
  key: string;
  value: Prisma.InputJsonValue;
  category: string;
  description: string;
};

const SYSTEM_CONFIGS: ConfigSeed[] = [
  // Loyalty
  { key: 'loyalty.vnd_per_point', value: 10000, category: 'loyalty', description: '10.000đ chi tiêu = 1 điểm' },
  { key: 'loyalty.vnd_per_point_redeem', value: 1000, category: 'loyalty', description: '1 điểm = 1.000đ khi áp' },
  { key: 'loyalty.max_redeem_pct', value: 0.2, category: 'loyalty', description: 'Tối đa 20% giá trị đơn được trừ điểm' },
  { key: 'loyalty.point_expire_months', value: 12, category: 'loyalty', description: 'Điểm hết hạn sau 12 tháng' },
  { key: 'loyalty.tier_grace_days', value: 30, category: 'loyalty', description: 'Grace period giữ hạng khi rớt' },
  { key: 'loyalty.welcome_voucher_amount', value: 30000, category: 'loyalty', description: 'Voucher đơn đầu' },
  { key: 'loyalty.welcome_voucher_min_order', value: 199000, category: 'loyalty', description: 'Min order để dùng welcome voucher' },

  // Affiliate
  { key: 'affiliate.product_rate_source', value: 'variation.affiliateRate', category: 'affiliate', description: 'Rate đọc từ từng variation (import Excel)' },
  { key: 'affiliate.monthly_tier_thresholds', value: [3000000, 10000000, 30000000, 80000000], category: 'affiliate', description: 'Ngưỡng VND để lên bậc' },
  { key: 'affiliate.monthly_tier_bonuses', value: [0, 0.01, 0.025, 0.04, 0.06], category: 'affiliate', description: 'Bonus rate tương ứng' },
  { key: 'affiliate.hold_days', value: 20, category: 'affiliate', description: 'Hold ngày sau DELIVERED trước khi APPROVED' },
  { key: 'affiliate.last_click_window_days', value: 30, category: 'affiliate', description: 'Cookie/tracking window' },
  { key: 'affiliate.min_withdraw_bank', value: 50000, category: 'affiliate', description: 'Min rút STK' },
  { key: 'affiliate.tubu_wallet_multiplier', value: 1.5, category: 'affiliate', description: 'Hệ số chuyển sang Ví Tubu' },
  { key: 'affiliate.kyc_required_above', value: 2000000, category: 'affiliate', description: 'KYC khi rút > X/tháng' },

  // Cashback
  { key: 'cashback.merchant_user_share', value: 0.7, category: 'cashback', description: 'User nhận 70% commission' },
  { key: 'cashback.merchant_tubu_share', value: 0.3, category: 'cashback', description: 'Tubu giữ 30%' },
  { key: 'cashback.hold_days', value: 30, category: 'cashback', description: 'Hold sau khi AT confirm' },
  { key: 'cashback.min_withdraw_bank', value: 50000, category: 'cashback', description: 'Min rút STK (chung wallet với CTV)' },
  { key: 'cashback.tubu_wallet_multiplier', value: 1.5, category: 'cashback', description: 'x1.5 khi chuyển Ví Tubu' },
  { key: 'cashback.click_rate_limit_seconds', value: 30, category: 'cashback', description: '1 click/merchant/user/30s' },
  { key: 'cashback.reconcile_lookback_days', value: 45, category: 'cashback', description: 'Reconcile cron kéo giao dịch từ provider trong N ngày gần nhất (phủ hold window + biên)' },

  // TubuXu (tiền tệ tiêu trong app) — Ví đổi sang xu ×1.2; rút Ví min 100k, phí 3k.
  { key: 'wallet.xu_convert_multiplier', value: 1.2, category: 'wallet', description: 'Đổi Ví → TubuXu nhận thêm 20%' },
  { key: 'wallet.withdraw_min', value: 100000, category: 'wallet', description: 'Rút Ví về ngân hàng tối thiểu' },
  { key: 'wallet.withdraw_fee', value: 3000, category: 'wallet', description: 'Phí chuyển khoản ngân hàng/lần' },
  { key: 'coins.referrer_reward', value: 5000, category: 'coins', description: 'Xu thưởng người giới thiệu (mỗi bạn có cashback đầu)' },
  { key: 'coins.referee_reward', value: 5000, category: 'coins', description: 'Xu thưởng người được mời' },
  {
    key: 'coins.referral_milestones',
    value: [
      { count: 3, bonus: 20000 },
      { count: 5, bonus: 40000 },
      { count: 10, bonus: 100000 },
    ],
    category: 'coins',
    description: 'Mốc số bạn giới thiệu thành công → thưởng thêm xu (1 lần/mốc)',
  },
  { key: 'game.xu_per_seed', value: 1, category: 'game', description: 'Giá mua nước: xu / 1 giọt' },
  { key: 'game.tree_xu_price', value: 50000, category: 'game', description: 'Giá mua 1 cây thật bằng xu' },

  // Flash Sale
  { key: 'flashsale.default_per_user_limit', value: 5, category: 'flashsale', description: 'Giới hạn mua mặc định/user/item flash' },
  { key: 'flashsale.min_discount_pct', value: 0, category: 'flashsale', description: 'Mức giảm tối thiểu để tạo item flash (0 = tắt validate)' },

  // Dealer
  { key: 'dealer.max_discount_pct', value: 0.45, category: 'dealer', description: 'Chiết khấu tối đa hard cap' },
  { key: 'dealer.kyc_required', value: true, category: 'dealer', description: 'Bắt buộc CCCD khi đăng ký' },

  // Game
  { key: 'game.daily_checkin_seeds', value: 1, category: 'game', description: 'Hạt giống/ngày' },
  { key: 'game.daily_checkin_points', value: 2, category: 'game', description: 'Điểm Xanh/ngày' },
  { key: 'game.streak_7_bonus', value: { seeds: 10, free_spins: 1 }, category: 'game', description: 'Bonus chuỗi 7 ngày' },
  { key: 'game.spin_buy_cost_points', value: 10, category: 'game', description: 'Điểm Xanh đổi 1 lượt quay' },
  { key: 'game.spin_buy_daily_limit', value: 5, category: 'game', description: 'Max mua lượt/ngày' },
  { key: 'game.quiz_daily_count', value: 5, category: 'game', description: 'Số quiz/ngày' },
  { key: 'game.quiz_correct_points', value: 3, category: 'game', description: 'Điểm/câu đúng' },
  { key: 'game.daily_login_seeds', value: 10, category: 'game', description: '💧 khi mở app/check-in' },
  { key: 'game.tank_capacity', value: 500, category: 'game', description: 'Sức chứa bình nước (💧)' },
  { key: 'game.tree_default_target', value: 600, category: 'game', description: '💧 cần để thu hoạch cây mặc định' },
  { key: 'game.dew_seeds', value: 15, category: 'game', description: '💧 giọt sương sáng/ngày' },
  { key: 'game.streak_freeze_cost', value: 80, category: 'game', description: '💧 mua 1 vé giữ lửa (streak-freeze)' },
  { key: 'game.streak_repair_cost', value: 150, category: 'game', description: 'Giá 💧 hồi sinh chuỗi đã mất' },
  { key: 'game.streak_repair_window_hours', value: 48, category: 'game', description: 'Cửa sổ (giờ) được hồi sinh sau khi mất chuỗi' },
  { key: 'game.streak_repair_cooldown_days', value: 30, category: 'game', description: 'Số ngày giữa 2 lần hồi sinh chuỗi' },
  { key: 'game.max_plots', value: 5, category: 'game', description: 'Số lô đất tối đa/user (gồm lô nhà)' },
  { key: 'game.plot_unlock_seed_base', value: 100, category: 'game', description: '💧 mở lô đất (giá = base × số thứ tự lô)' },
  { key: 'game.plot_unlock_xu_base', value: 200, category: 'game', description: 'Xu mở lô đất (giá = base × số thứ tự lô)' },
  { key: 'game.plot_target', value: 600, category: 'game', description: '💧 cần để thu hoạch 1 cây ở lô phụ' },
  { key: 'groupbuy.discount_pct', value: 15, category: 'groupbuy', description: '% giảm giá khi mua chung đủ người' },
  { key: 'groupbuy.target_size', value: 3, category: 'groupbuy', description: 'Số người cần để nhóm mua chung thành công' },
  { key: 'groupbuy.window_hours', value: 48, category: 'groupbuy', description: 'Số giờ nhóm mua chung mở trước khi hết hạn' },
  { key: 'refill.seeds_per_bottle', value: 50, category: 'refill', description: '💧 thưởng cho mỗi vỏ chai đổi' },
  { key: 'refill.monthly_cap_bottles', value: 20, category: 'refill', description: 'Trần số vỏ chai đổi được mỗi tháng/user (chống lạm dụng)' },
  { key: 'beta.features', value: [], category: 'beta', description: 'Danh sách tính năng beta hiển thị cho người tham gia (mảng {key,title,desc})' },
  { key: 'payment.bank_bin', value: '970407', category: 'payment', description: 'Mã ngân hàng Napas (BIN) nhận chuyển khoản — 970407 = Techcombank' },
  { key: 'payment.bank_account_no', value: '9984606774', category: 'payment', description: 'Số tài khoản nhận chuyển khoản (VietQR)' },
  { key: 'payment.bank_account_name', value: 'CONG TY TUBU TREE', category: 'payment', description: 'Tên chủ tài khoản (hiển thị; in hoa không dấu)' },
  { key: 'payment.bank_name', value: 'Techcombank', category: 'payment', description: 'Tên ngân hàng (hiển thị)' },
  {
    key: 'game.spin_prizes',
    value: [
      { id: 'p1', name: '5 điểm Xanh', weight: 30, rewardType: 'POINTS', value: 5 },
      { id: 'p2', name: '10 điểm Xanh', weight: 22, rewardType: 'POINTS', value: 10 },
      { id: 'p3', name: '20 điểm Xanh', weight: 12, rewardType: 'POINTS', value: 20 },
      { id: 'p4', name: 'Voucher 20k', weight: 10, rewardType: 'COUPON', value: 20000 },
      { id: 'p5', name: '30 💧', weight: 15, rewardType: 'SEEDS', value: 30 },
      { id: 'p6', name: 'Voucher 50k', weight: 4, rewardType: 'COUPON', value: 50000 },
      { id: 'p7', name: '50 điểm Xanh', weight: 5, rewardType: 'POINTS', value: 50 },
      { id: 'p8', name: 'Chúc may mắn lần sau', weight: 2, rewardType: 'NONE', value: 0 },
    ],
    category: 'game',
    description: 'Bảng giải vòng quay + trọng số xác suất',
  },

  // Shipping
  { key: 'shipping.free_threshold', value: 200000, category: 'shipping', description: 'Đơn ≥ 200k được freeship' },
  { key: 'shipping.flat_fee_below_threshold', value: 19000, category: 'shipping', description: 'Phí cố định khi đơn < 200k' },
  { key: 'shipping.tier_freeship_overrides', value: { LOC_BIEC: 99000, DAI_THU: 0, CO_THU: 0 }, category: 'shipping', description: 'Hạng được freeship trước ngưỡng' },

  // Return
  { key: 'return.allow_manufacturer_defect_only', value: true, category: 'return', description: 'Chỉ đổi khi lỗi NSX' },
  { key: 'return.window_days', value: 15, category: 'return', description: 'Số ngày từ DELIVERED được yêu cầu đổi/trả' },
  { key: 'return.shipping_paid_by_tubu_if_defect', value: true, category: 'return', description: 'Tubu trả phí ship hoàn nếu lỗi NSX' },
  { key: 'return.affiliate_commission_reverse_window_days', value: 20, category: 'return', description: 'Trừ ngược hoa hồng nếu hoàn trong X ngày' },

  // Payment
  { key: 'payment.enabled_methods', value: ['COD', 'ZALOPAY', 'BANK_TRANSFER', 'VNPAY'], category: 'payment', description: 'Phương thức bật' },
  { key: 'payment.cod_max_amount', value: 5000000, category: 'payment', description: 'Max đơn cho COD' },

  // Eco / Tree planting
  { key: 'eco.real_tree_partner', value: 'PanNature - Rừng Xanh Lên', category: 'eco', description: 'Đối tác trồng cây — nature.org.vn' },
  { key: 'eco.real_tree_cost_each', value: 50000, category: 'eco', description: 'Chi phí 1 cây thật (VND)' },
  { key: 'eco.real_tree_monthly_budget', value: 5000000, category: 'eco', description: 'Trần ngân sách trồng cây/tháng' },

  // RBAC nhân sự (Phase A) — SĐT admin thật cấp qua hub/DB; giữ rỗng để không cấp nhầm.
  { key: 'rbac.admin_phones', value: [], category: 'rbac', description: 'Danh sách SĐT admin gán sẵn (tham chiếu; grant thực nằm ở role_grants)' },

  // Chấm công (Phase C) — nhập IP/toạ độ công ty thật qua hub/DB trước khi dùng.
  { key: 'attendance.office_ips', value: [], category: 'attendance', description: 'Danh sách IP/CIDR nội bộ được phép checkin' },
  // office_lat / office_lng: KHÔNG seed (để null mặc định) — admin nhập toạ độ thật qua config.
  { key: 'attendance.radius_m', value: 150, category: 'attendance', description: 'Bán kính GPS cho phép (m)' },
  { key: 'attendance.late_grace_min', value: 30, category: 'attendance', description: 'Trễ quá X phút thì phạt' },
  { key: 'attendance.late_fine', value: 10000, category: 'attendance', description: 'Tiền phạt đi trễ (VND)' },
  { key: 'attendance.cancel_notice_days', value: 3, category: 'attendance', description: 'Huỷ ca báo trước X ngày' },
  { key: 'attendance.emergency_cap_month', value: 3, category: 'attendance', description: 'Số lần huỷ đột xuất miễn phạt/tháng' },
  { key: 'attendance.heartbeat_stale_min', value: 10, category: 'attendance', description: 'Không heartbeat quá X phút → auto checkout' },
  { key: 'attendance.enforce_ip', value: true, category: 'attendance', description: 'Bật kiểm IP (tắt nếu chưa có IP tĩnh)' },
];

const TIERS = [
  {
    id: 'MAM_XANH',
    name: 'Mầm Xanh',
    minPoints: 0,
    minSpending: null,
    pointMultiplier: new Prisma.Decimal(1),
    discountPct: new Prisma.Decimal(0),
    perks: ['Tích điểm 1x'],
    sortOrder: 0,
  },
  {
    id: 'LOC_BIEC',
    name: 'Lộc Biếc',
    minPoints: 500,
    minSpending: 5000000,
    pointMultiplier: new Prisma.Decimal(1.2),
    discountPct: new Prisma.Decimal(0),
    perks: ['Tích điểm 1.2x', 'Freeship đơn ≥ 99k', 'Voucher sinh nhật 50k'],
    sortOrder: 1,
  },
  {
    id: 'DAI_THU',
    name: 'Đại Thụ',
    minPoints: 2000,
    minSpending: 20000000,
    pointMultiplier: new Prisma.Decimal(1.5),
    discountPct: new Prisma.Decimal(0),
    perks: ['Tích điểm 1.5x', 'Freeship toàn shop', 'Ưu tiên hotline', 'Beta tester', 'Voucher sinh nhật 150k + 1 sample'],
    sortOrder: 2,
  },
  {
    id: 'CO_THU',
    name: 'Cổ Thụ',
    minPoints: 5000,
    minSpending: 50000000,
    pointMultiplier: new Prisma.Decimal(2),
    discountPct: new Prisma.Decimal(0.05),
    perks: ['Tích điểm 2x', 'Freeship + giảm 5% mọi đơn', 'Quà sinh nhật cá nhân hóa', 'Voucher sinh nhật 300k + hộp quà'],
    sortOrder: 3,
  },
];

const DEALER_TIERS = [
  { id: 'DEALER_1', name: 'Đại lý Cấp 1', minOrderVolume: 10000000, discountRules: { default: 0.2 }, creditLimit: 0, paymentTerms: 'PREPAID' },
  { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30000000, discountRules: { default: 0.3 }, creditLimit: 20000000, paymentTerms: 'NET 15' },
  { id: 'DEALER_3', name: 'Đại lý Cấp 3', minOrderVolume: 80000000, discountRules: { default: 0.38 }, creditLimit: 50000000, paymentTerms: 'NET 30' },
  { id: 'DEALER_VIP', name: 'Đại lý VIP', minOrderVolume: 200000000, discountRules: { default: 0.45 }, creditLimit: 150000000, paymentTerms: 'NET 30' },
];

const CATEGORIES = [
  { id: 'cat-skincare', name: 'Mỹ phẩm thiên nhiên', slug: 'my-pham-thien-nhien', sortOrder: 1 },
  { id: 'cat-cleaning', name: 'Tẩy rửa sinh học', slug: 'tay-rua-sinh-hoc', sortOrder: 2 },
  { id: 'cat-baby', name: 'Cho bé', slug: 'cho-be', sortOrder: 3 },
  { id: 'cat-mom', name: 'Cho mẹ bầu', slug: 'cho-me-bau', sortOrder: 4 },
  { id: 'cat-personal', name: 'Chăm sóc cá nhân', slug: 'cham-soc-ca-nhan', sortOrder: 5 },
  { id: 'cat-coffee', name: 'Cà phê & Đồ uống', slug: 'ca-phe-do-uong', sortOrder: 6 },
  { id: 'cat-food', name: 'Nông sản & Thực phẩm', slug: 'nong-san-thuc-pham', sortOrder: 7 },
];

type SeedProduct = {
  id: string;
  brand: string;
  slug: string;
  name: string;
  shortDesc: string;
  basePrice: number;
  salePrice?: number;
  categoryIds: string[];
  forSegment: string[];
  certifications: string[];
  isFeatured?: boolean;
  ingredients?: { name: string; percentage?: string; benefit: string }[];
  variations: { sku: string; name: string; attributes: Record<string, string>; retailPrice: number; salePrice?: number; stock: number; weight: number }[];
};

// Catalog mẫu đa thương hiệu (8 brand đại diện hệ sinh thái tubutree.com): Visante, Pơ Lang,
// Fuwa3e, Cobote, Le Plateau Coffee, BH.Nong, Sokfram, Hector. KHÔNG dùng ảnh demo picsum
// (trông giả/rẻ tiền) — để rỗng cho FE hiện placeholder lá; Pancake sync ghi đè ảnh THẬT khi có.
// ≥40 SP để demo "đa thương hiệu".
const PRODUCTS: SeedProduct[] = [
  // ── Visante — mỹ phẩm thiên nhiên ─────────────────────────────
  {
    id: 'p-visante-serum', brand: 'Visante', slug: 'serum-duong-am-visante', name: 'Serum dưỡng ẩm Visante',
    shortDesc: 'Cấp ẩm chuyên sâu chiết xuất rau má.', basePrice: 320000, salePrice: 289000, categoryIds: ['cat-skincare'],
    forSegment: ['sensitive_skin', 'skincare'], certifications: ['USDA Organic', 'Vegan'], isFeatured: true,
    ingredients: [
      { name: 'Chiết xuất rau má', percentage: '5%', benefit: 'Phục hồi, làm dịu da nhạy cảm' },
      { name: 'Hyaluronic Acid', percentage: '2%', benefit: 'Cấp ẩm sâu, căng mịn' },
      { name: 'Chiết xuất lô hội', benefit: 'Làm dịu, chống kích ứng' },
    ],
    variations: [
      { sku: 'VIS-SR-30', name: '30ml', attributes: { size: '30ml' }, retailPrice: 320000, salePrice: 289000, stock: 60, weight: 90 },
      { sku: 'VIS-SR-50', name: '50ml', attributes: { size: '50ml' }, retailPrice: 460000, stock: 30, weight: 130 },
    ],
  },
  {
    id: 'p-visante-cream', brand: 'Visante', slug: 'kem-duong-ba-bau-visante', name: 'Kem dưỡng cho mẹ bầu Visante',
    shortDesc: 'Ngừa rạn da, lành tính cho thai kỳ.', basePrice: 290000, categoryIds: ['cat-mom'],
    forSegment: ['mom_baby'], certifications: ['USDA Organic'],
    ingredients: [
      { name: 'Bơ hạt mỡ (Shea)', percentage: '8%', benefit: 'Tăng đàn hồi, ngừa rạn da' },
      { name: 'Dầu jojoba', benefit: 'Dưỡng ẩm sâu, thẩm thấu nhanh' },
    ],
    variations: [
      { sku: 'VIS-CR-100', name: '100ml', attributes: { size: '100ml' }, retailPrice: 290000, stock: 45, weight: 160 },
    ],
  },
  {
    id: 'p-visante-cleanser', brand: 'Visante', slug: 'nuoc-tay-trang-rau-ma-visante', name: 'Nước tẩy trang rau má Visante',
    shortDesc: 'Làm sạch dịu nhẹ, không lưu cồn.', basePrice: 180000, salePrice: 155000, categoryIds: ['cat-skincare'],
    forSegment: ['sensitive_skin', 'skincare'], certifications: ['Vegan'], isFeatured: true,
    variations: [{ sku: 'VIS-CL-300', name: '300ml', attributes: { size: '300ml' }, retailPrice: 180000, salePrice: 155000, stock: 110, weight: 330 }],
  },
  {
    id: 'p-visante-sunscreen', brand: 'Visante', slug: 'kem-chong-nang-khoang-visante', name: 'Kem chống nắng khoáng Visante SPF50',
    shortDesc: 'Chống nắng vật lý, không gây bí da.', basePrice: 345000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Reef-safe'],
    variations: [{ sku: 'VIS-SUN-50', name: '50ml', attributes: { size: '50ml', spf: 'SPF50+' }, retailPrice: 345000, stock: 70, weight: 95 }],
  },
  {
    id: 'p-visante-mask', brand: 'Visante', slug: 'mat-na-rau-ma-visante', name: 'Mặt nạ rau má phục hồi Visante',
    shortDesc: 'Làm dịu da sau nắng, cấp ẩm tức thì.', basePrice: 25000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'VIS-MASK-1', name: '1 miếng', attributes: { type: 'sheet' }, retailPrice: 25000, stock: 400, weight: 30 }],
  },
  {
    id: 'p-visante-lipbalm', brand: 'Visante', slug: 'son-duong-gac-visante', name: 'Son dưỡng gấc Visante',
    shortDesc: 'Dưỡng môi mềm mịn từ tinh dầu gấc.', basePrice: 95000, salePrice: 79000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'VIS-LIP-4', name: '4g', attributes: { size: '4g' }, retailPrice: 95000, salePrice: 79000, stock: 180, weight: 20 }],
  },

  // ── Pơ Lang — dược liệu Tây Nguyên ───────────────────────────
  {
    id: 'p-polang-shampoo', brand: 'Pơ Lang', slug: 'dau-goi-buoi-po-lang', name: 'Dầu gội bưởi Pơ Lang',
    shortDesc: 'Dầu gội thảo dược tinh dầu bưởi, giảm rụng tóc.', basePrice: 165000, categoryIds: ['cat-skincare', 'cat-personal'],
    forSegment: ['sensitive_skin', 'skincare'], certifications: ['Vegan'], isFeatured: true,
    ingredients: [
      { name: 'Tinh dầu bưởi', percentage: '2%', benefit: 'Kích thích mọc tóc, giảm gãy rụng' },
      { name: 'Bồ kết', benefit: 'Làm sạch dịu nhẹ, sạch gàu tự nhiên' },
      { name: 'Hương nhu', benefit: 'Thư giãn da đầu, mượt tóc' },
    ],
    variations: [
      { sku: 'POLANG-SP-300', name: '300ml', attributes: { size: '300ml' }, retailPrice: 165000, stock: 120, weight: 350 },
      { sku: 'POLANG-SP-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 245000, salePrice: 219000, stock: 80, weight: 560 },
    ],
  },
  {
    id: 'p-polang-bodywash', brand: 'Pơ Lang', slug: 'sua-tam-sa-po-lang', name: 'Sữa tắm sả chanh Pơ Lang',
    shortDesc: 'Hương sả chanh thư giãn, dưỡng ẩm.', basePrice: 175000, categoryIds: ['cat-skincare', 'cat-personal'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'POLANG-BW-500', name: '500ml', attributes: { size: '500ml', scent: 'sả chanh' }, retailPrice: 175000, stock: 90, weight: 560 }],
  },
  {
    id: 'p-polang-ginger', brand: 'Pơ Lang', slug: 'dau-gung-po-lang', name: 'Dầu gừng massage Pơ Lang',
    shortDesc: 'Làm ấm, thư giãn cơ sau ngày dài.', basePrice: 135000, salePrice: 115000, categoryIds: ['cat-personal'],
    forSegment: ['eco'], certifications: ['Handmade'], isFeatured: true,
    variations: [{ sku: 'POLANG-GG-100', name: '100ml', attributes: { size: '100ml' }, retailPrice: 135000, salePrice: 115000, stock: 140, weight: 150 }],
  },
  {
    id: 'p-polang-lemongrass', brand: 'Pơ Lang', slug: 'tinh-dau-sa-chanh-po-lang', name: 'Tinh dầu sả chanh Pơ Lang',
    shortDesc: 'Đuổi muỗi, khử mùi, thư giãn không gian.', basePrice: 110000, categoryIds: ['cat-personal'],
    forSegment: ['eco', 'home_clean'], certifications: ['Nguyên chất 100%'],
    variations: [{ sku: 'POLANG-LG-10', name: '10ml', attributes: { size: '10ml' }, retailPrice: 110000, stock: 220, weight: 40 }],
  },
  {
    id: 'p-polang-facemist', brand: 'Pơ Lang', slug: 'xit-khoang-hoa-hong-po-lang', name: 'Xịt khoáng hoa hồng Pơ Lang',
    shortDesc: 'Cấp ẩm tức thì, làm dịu da căng thẳng.', basePrice: 145000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'POLANG-FM-150', name: '150ml', attributes: { size: '150ml' }, retailPrice: 145000, stock: 95, weight: 200 }],
  },

  // ── Fuwa3e — tẩy rửa sinh học ────────────────────────────────
  {
    id: 'p-fuwa-dishwash', brand: 'Fuwa3e', slug: 'nuoc-rua-chen-fuwa3e', name: 'Nước rửa chén sinh học Fuwa3e',
    shortDesc: 'Lên men enzyme dứa, an toàn cho da tay.', basePrice: 120000, categoryIds: ['cat-cleaning'],
    forSegment: ['home_clean'], certifications: ['Eco'], isFeatured: true,
    ingredients: [
      { name: 'Enzyme dứa lên men', percentage: '15%', benefit: 'Phân giải dầu mỡ, không hại da tay' },
      { name: 'Tinh dầu sả', benefit: 'Khử mùi tanh, kháng khuẩn tự nhiên' },
      { name: 'Nước cất', benefit: 'Dung môi an toàn, phân huỷ sinh học' },
    ],
    variations: [
      { sku: 'FUWA-DW-1L', name: '1L', attributes: { size: '1L' }, retailPrice: 120000, stock: 200, weight: 1050 },
      { sku: 'FUWA-DW-5L', name: 'Can 5L', attributes: { size: '5L' }, retailPrice: 480000, salePrice: 430000, stock: 40, weight: 5200 },
    ],
  },
  {
    id: 'p-fuwa-laundry', brand: 'Fuwa3e', slug: 'nuoc-giat-fuwa3e', name: 'Nước giặt sinh học Fuwa3e',
    shortDesc: 'Sạch sâu, dịu nhẹ cho đồ em bé.', basePrice: 210000, categoryIds: ['cat-cleaning', 'cat-baby'],
    forSegment: ['mom_baby', 'home_clean'], certifications: ['Eco'], isFeatured: true,
    variations: [{ sku: 'FUWA-LD-2L', name: '2L', attributes: { size: '2L' }, retailPrice: 210000, stock: 150, weight: 2100 }],
  },
  {
    id: 'p-fuwa-floor', brand: 'Fuwa3e', slug: 'nuoc-lau-san-fuwa3e', name: 'Nước lau sàn enzyme Fuwa3e',
    shortDesc: 'Sàn sạch bóng, hương thảo mộc dịu.', basePrice: 165000, salePrice: 139000, categoryIds: ['cat-cleaning'],
    forSegment: ['home_clean'], certifications: ['Eco'],
    variations: [{ sku: 'FUWA-FL-2L', name: '2L', attributes: { size: '2L' }, retailPrice: 165000, salePrice: 139000, stock: 120, weight: 2100 }],
  },
  {
    id: 'p-fuwa-handwash', brand: 'Fuwa3e', slug: 'nuoc-rua-tay-fuwa3e', name: 'Nước rửa tay sinh học Fuwa3e',
    shortDesc: 'Sạch khuẩn dịu nhẹ, dưỡng ẩm da tay.', basePrice: 89000, categoryIds: ['cat-cleaning'],
    forSegment: ['home_clean', 'mom_baby'], certifications: ['Eco'],
    variations: [{ sku: 'FUWA-HW-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 89000, stock: 260, weight: 540 }],
  },
  {
    id: 'p-fuwa-bottle', brand: 'Fuwa3e', slug: 'nuoc-rua-binh-sua-fuwa3e', name: 'Nước rửa bình sữa Fuwa3e',
    shortDesc: 'An toàn cho bé, sạch cặn sữa, không mùi.', basePrice: 135000, categoryIds: ['cat-cleaning', 'cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Eco', 'Food-grade'],
    variations: [{ sku: 'FUWA-BT-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 135000, stock: 130, weight: 540 }],
  },

  // ── Cobote — chăm sóc cho bé ─────────────────────────────────
  {
    id: 'p-cobote-tram', brand: 'Cobote', slug: 'dau-tram-be-cobote', name: 'Dầu tràm cho bé Cobote',
    shortDesc: 'Giữ ấm, phòng ho cảm cho bé sơ sinh.', basePrice: 89000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Nguyên chất 100%'], isFeatured: true,
    ingredients: [{ name: 'Tinh dầu tràm Huế', percentage: '100%', benefit: 'Giữ ấm, kháng khuẩn đường hô hấp' }],
    variations: [{ sku: 'COBOTE-TR-50', name: '50ml', attributes: { size: '50ml' }, retailPrice: 89000, stock: 300, weight: 80 }],
  },
  {
    id: 'p-cobote-wash', brand: 'Cobote', slug: 'nuoc-tam-goi-be-cobote', name: 'Nước tắm gội thảo dược cho bé Cobote',
    shortDesc: 'Tắm gội 2 trong 1, không cay mắt bé.', basePrice: 155000, salePrice: 132000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Vegan'],
    variations: [{ sku: 'COBOTE-WS-250', name: '250ml', attributes: { size: '250ml' }, retailPrice: 155000, salePrice: 132000, stock: 110, weight: 290 }],
  },
  {
    id: 'p-cobote-powder', brand: 'Cobote', slug: 'phan-rom-thao-duoc-cobote', name: 'Phấn rôm thảo dược Cobote',
    shortDesc: 'Hút ẩm, ngừa hăm, không bột talc.', basePrice: 79000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Talc-free'],
    variations: [{ sku: 'COBOTE-PW-100', name: '100g', attributes: { size: '100g' }, retailPrice: 79000, stock: 160, weight: 130 }],
  },
  {
    id: 'p-cobote-diapercream', brand: 'Cobote', slug: 'kem-chong-ham-cobote', name: 'Kem chống hăm Cobote',
    shortDesc: 'Làm dịu, phục hồi vùng da hăm của bé.', basePrice: 119000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Vegan'],
    variations: [{ sku: 'COBOTE-DC-50', name: '50g', attributes: { size: '50g' }, retailPrice: 119000, stock: 140, weight: 70 }],
  },

  // ── Le Plateau Coffee — cà phê đặc sản ───────────────────────
  {
    id: 'p-leplateau-arabica', brand: 'Le Plateau Coffee', slug: 'arabica-cau-dat-le-plateau', name: 'Cà phê Arabica Cầu Đất Le Plateau',
    shortDesc: 'Hạt rang specialty, hậu vị trái cây, chua thanh.', basePrice: 185000, categoryIds: ['cat-coffee', 'cat-food'],
    forSegment: ['eco'], certifications: ['Specialty', 'Rainforest Alliance'], isFeatured: true,
    ingredients: [{ name: 'Arabica Cầu Đất 1.650m', percentage: '100%', benefit: 'Hương hoa, hậu vị cam quýt' }],
    variations: [
      { sku: 'LP-ARA-250', name: '250g · nguyên hạt', attributes: { weight: '250g', grind: 'nguyên hạt' }, retailPrice: 185000, stock: 90, weight: 270 },
      { sku: 'LP-ARA-250-F', name: '250g · xay pha phin', attributes: { weight: '250g', grind: 'pha phin' }, retailPrice: 185000, stock: 70, weight: 270 },
    ],
  },
  {
    id: 'p-leplateau-robusta', brand: 'Le Plateau Coffee', slug: 'robusta-honey-le-plateau', name: 'Cà phê Robusta Honey Le Plateau',
    shortDesc: 'Sơ chế honey, đậm vị, ít đắng gắt.', basePrice: 145000, salePrice: 125000, categoryIds: ['cat-coffee', 'cat-food'],
    forSegment: ['eco'], certifications: ['Honey process'], isFeatured: true,
    variations: [{ sku: 'LP-ROB-250', name: '250g', attributes: { weight: '250g' }, retailPrice: 145000, salePrice: 125000, stock: 120, weight: 270 }],
  },
  {
    id: 'p-leplateau-drip', brand: 'Le Plateau Coffee', slug: 'ca-phe-phin-giay-le-plateau', name: 'Cà phê phin giấy Le Plateau (hộp 10)',
    shortDesc: 'Pha nhanh tại bàn, tiện mang đi.', basePrice: 95000, categoryIds: ['cat-coffee'],
    forSegment: ['eco'], certifications: [],
    variations: [{ sku: 'LP-DRIP-10', name: 'Hộp 10 gói', attributes: { count: '10' }, retailPrice: 95000, stock: 200, weight: 130 }],
  },
  {
    id: 'p-leplateau-coldbrew', brand: 'Le Plateau Coffee', slug: 'cold-brew-tui-loc-le-plateau', name: 'Cold Brew túi lọc Le Plateau',
    shortDesc: 'Ủ lạnh 12h, ngọt dịu, ít axit.', basePrice: 120000, categoryIds: ['cat-coffee'],
    forSegment: ['eco'], certifications: [],
    variations: [{ sku: 'LP-CB-5', name: 'Hộp 5 túi', attributes: { count: '5' }, retailPrice: 120000, stock: 85, weight: 180 }],
  },

  // ── BH.Nong — nông sản & thực phẩm sạch ──────────────────────
  {
    id: 'p-bhnong-honey', brand: 'BH.Nong', slug: 'mat-ong-rung-bhnong', name: 'Mật ong rừng nguyên chất BH.Nong',
    shortDesc: 'Mật ong rừng tự nhiên, không pha đường.', basePrice: 260000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Nguyên chất 100%'], isFeatured: true,
    variations: [{ sku: 'BHN-HN-500', name: 'Chai 500ml', attributes: { size: '500ml' }, retailPrice: 260000, stock: 80, weight: 720 }],
  },
  {
    id: 'p-bhnong-cashew', brand: 'BH.Nong', slug: 'hat-dieu-rang-moc-bhnong', name: 'Hạt điều rang mộc BH.Nong',
    shortDesc: 'Điều Bình Phước rang mộc, giòn bùi.', basePrice: 180000, salePrice: 159000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['OCOP'],
    variations: [{ sku: 'BHN-CW-500', name: '500g', attributes: { weight: '500g' }, retailPrice: 180000, salePrice: 159000, stock: 150, weight: 540 }],
  },
  {
    id: 'p-bhnong-pepper', brand: 'BH.Nong', slug: 'tieu-den-bhnong', name: 'Tiêu đen Chư Sê BH.Nong',
    shortDesc: 'Tiêu Tây Nguyên thơm nồng, hạt chắc.', basePrice: 95000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['OCOP'],
    variations: [{ sku: 'BHN-PP-200', name: '200g', attributes: { weight: '200g' }, retailPrice: 95000, stock: 200, weight: 230 }],
  },
  {
    id: 'p-bhnong-tea', brand: 'BH.Nong', slug: 'tra-thao-moc-bhnong', name: 'Trà thảo mộc thanh nhiệt BH.Nong',
    shortDesc: 'Atiso, cúc, cam thảo — thanh mát mỗi ngày.', basePrice: 85000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Vegan'],
    variations: [{ sku: 'BHN-TEA-20', name: 'Hộp 20 túi', attributes: { count: '20' }, retailPrice: 85000, stock: 180, weight: 80 }],
  },

  // ── Sokfram — thực phẩm organic ──────────────────────────────
  {
    id: 'p-sokfram-rice', brand: 'Sokfram', slug: 'gao-lut-huyet-rong-sokfram', name: 'Gạo lứt huyết rồng Sokfram',
    shortDesc: 'Gạo lứt đỏ giàu chất xơ, dẻo thơm.', basePrice: 75000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Organic'], isFeatured: true,
    variations: [{ sku: 'SOK-RC-1KG', name: '1kg', attributes: { weight: '1kg' }, retailPrice: 75000, stock: 220, weight: 1050 }],
  },
  {
    id: 'p-sokfram-coconut', brand: 'Sokfram', slug: 'dau-dua-ep-lanh-sokfram', name: 'Dầu dừa ép lạnh Sokfram',
    shortDesc: 'Ép lạnh nguyên chất, dùng ăn & dưỡng.', basePrice: 130000, salePrice: 110000, categoryIds: ['cat-food', 'cat-skincare'],
    forSegment: ['eco', 'skincare'], certifications: ['Organic', 'Ép lạnh'],
    variations: [{ sku: 'SOK-CO-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 130000, salePrice: 110000, stock: 140, weight: 560 }],
  },
  {
    id: 'p-sokfram-centella', brand: 'Sokfram', slug: 'bot-rau-ma-sokfram', name: 'Bột rau má nguyên chất Sokfram',
    shortDesc: 'Sấy lạnh giữ dưỡng chất, pha uống tiện lợi.', basePrice: 99000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Organic'],
    variations: [{ sku: 'SOK-CT-150', name: '150g', attributes: { weight: '150g' }, retailPrice: 99000, stock: 160, weight: 180 }],
  },
  {
    id: 'p-sokfram-granola', brand: 'Sokfram', slug: 'granola-hat-sokfram', name: 'Granola ngũ cốc hạt Sokfram',
    shortDesc: 'Ăn sáng healthy, ngọt nhẹ từ mật ong.', basePrice: 140000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Không đường tinh luyện'],
    variations: [{ sku: 'SOK-GR-400', name: '400g', attributes: { weight: '400g' }, retailPrice: 140000, stock: 120, weight: 440 }],
  },

  // ── Hector — chăm sóc cá nhân cho nam ────────────────────────
  {
    id: 'p-hector-clay', brand: 'Hector', slug: 'sap-vuot-toc-hector', name: 'Sáp vuốt tóc Hector Matte',
    shortDesc: 'Giữ nếp tự nhiên cả ngày, không bóng nhờn.', basePrice: 160000, categoryIds: ['cat-personal'],
    forSegment: ['skincare'], certifications: [], isFeatured: true,
    variations: [{ sku: 'HEC-CL-80', name: '80g', attributes: { size: '80g' }, retailPrice: 160000, stock: 130, weight: 110 }],
  },
  {
    id: 'p-hector-facewash', brand: 'Hector', slug: 'sua-rua-mat-than-tre-hector', name: 'Sữa rửa mặt than tre Hector',
    shortDesc: 'Sạch nhờn, sạch bụi mịn cho da nam.', basePrice: 145000, salePrice: 119000, categoryIds: ['cat-personal', 'cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'HEC-FW-120', name: '120ml', attributes: { size: '120ml' }, retailPrice: 145000, salePrice: 119000, stock: 150, weight: 150 }],
  },
  {
    id: 'p-hector-shampoo', brand: 'Hector', slug: 'dau-goi-bac-ha-hector', name: 'Dầu gội bạc hà mát lạnh Hector',
    shortDesc: 'Sảng khoái, sạch gàu, mát da đầu.', basePrice: 135000, categoryIds: ['cat-personal'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'HEC-SH-300', name: '300ml', attributes: { size: '300ml' }, retailPrice: 135000, stock: 140, weight: 330 }],
  },
  {
    id: 'p-hector-deo', brand: 'Hector', slug: 'lan-khu-mui-hector', name: 'Lăn khử mùi thiên nhiên Hector',
    shortDesc: 'Khử mùi 24h, không cồn, không nhôm.', basePrice: 99000, categoryIds: ['cat-personal'],
    forSegment: ['skincare'], certifications: ['Aluminum-free'],
    variations: [{ sku: 'HEC-DEO-50', name: '50ml', attributes: { size: '50ml' }, retailPrice: 99000, stock: 200, weight: 70 }],
  },

  // ── Bổ sung đợt 2 (làm dày catalog đa thương hiệu) ───────────
  {
    id: 'p-visante-vitc', brand: 'Visante', slug: 'tinh-chat-vitamin-c-visante', name: 'Tinh chất Vitamin C Visante',
    shortDesc: 'Làm sáng, mờ thâm từ Vitamin C tự nhiên.', basePrice: 380000, salePrice: 329000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'], isFeatured: true,
    variations: [{ sku: 'VIS-VITC-20', name: '20ml', attributes: { size: '20ml' }, retailPrice: 380000, salePrice: 329000, stock: 55, weight: 70 }],
  },
  {
    id: 'p-visante-eye', brand: 'Visante', slug: 'kem-mat-rau-ma-visante', name: 'Kem mắt rau má Visante',
    shortDesc: 'Giảm bọng, mờ quầng thâm vùng mắt.', basePrice: 295000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'VIS-EYE-15', name: '15ml', attributes: { size: '15ml' }, retailPrice: 295000, stock: 60, weight: 50 }],
  },
  {
    id: 'p-polang-hairoil', brand: 'Pơ Lang', slug: 'dau-duong-toc-bo-ket-po-lang', name: 'Dầu dưỡng tóc bồ kết Pơ Lang',
    shortDesc: 'Phục hồi tóc khô xơ, vào nếp mượt.', basePrice: 125000, categoryIds: ['cat-personal'],
    forSegment: ['skincare'], certifications: ['Handmade'],
    variations: [{ sku: 'POLANG-HO-50', name: '50ml', attributes: { size: '50ml' }, retailPrice: 125000, stock: 110, weight: 80 }],
  },
  {
    id: 'p-fuwa-glass', brand: 'Fuwa3e', slug: 'nuoc-lau-kinh-fuwa3e', name: 'Nước lau kính enzyme Fuwa3e',
    shortDesc: 'Sáng bóng không vệt, không amoniac.', basePrice: 79000, categoryIds: ['cat-cleaning'],
    forSegment: ['home_clean'], certifications: ['Eco'],
    variations: [{ sku: 'FUWA-GL-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 79000, stock: 170, weight: 540 }],
  },
  {
    id: 'p-cobote-massage', brand: 'Cobote', slug: 'dau-massage-be-cobote', name: 'Dầu massage cho bé Cobote',
    shortDesc: 'Dưỡng da bé mềm mại, hỗ trợ giấc ngủ.', basePrice: 109000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Vegan'],
    variations: [{ sku: 'COBOTE-MS-100', name: '100ml', attributes: { size: '100ml' }, retailPrice: 109000, stock: 120, weight: 130 }],
  },
  {
    id: 'p-leplateau-instant', brand: 'Le Plateau Coffee', slug: 'ca-phe-sua-hoa-tan-le-plateau', name: 'Cà phê sữa hoà tan Le Plateau (hộp 12)',
    shortDesc: 'Cà phê sữa 3in1 từ hạt thật, tiện lợi.', basePrice: 89000, salePrice: 75000, categoryIds: ['cat-coffee'],
    forSegment: ['eco'], certifications: [],
    variations: [{ sku: 'LP-INS-12', name: 'Hộp 12 gói', attributes: { count: '12' }, retailPrice: 89000, salePrice: 75000, stock: 190, weight: 320 }],
  },
  {
    id: 'p-bhnong-cagaileo', brand: 'BH.Nong', slug: 'cao-ca-gai-leo-bhnong', name: 'Cao cà gai leo BH.Nong',
    shortDesc: 'Hỗ trợ mát gan, giải độc tự nhiên.', basePrice: 220000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['OCOP'],
    variations: [{ sku: 'BHN-CGL-100', name: 'Hũ 100g', attributes: { size: '100g' }, retailPrice: 220000, stock: 70, weight: 160 }],
  },
  {
    id: 'p-sokfram-chia', brand: 'Sokfram', slug: 'hat-chia-uc-sokfram', name: 'Hạt chia Úc Sokfram',
    shortDesc: 'Giàu Omega-3 & chất xơ, pha uống tiện.', basePrice: 115000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Organic'],
    variations: [{ sku: 'SOK-CH-500', name: '500g', attributes: { weight: '500g' }, retailPrice: 115000, stock: 150, weight: 540 }],
  },
];

const NOTIFICATION_TEMPLATES = [
  { id: 'nt-confirmed', code: 'ORDER_CONFIRMED', channel: 'ZNS', bodyTemplate: 'Đơn {{order_code}} đã được xác nhận. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿' },
  { id: 'nt-shipping', code: 'ORDER_SHIPPING', channel: 'ZNS', bodyTemplate: 'Đơn {{order_code}} đang được giao đến bạn.' },
  { id: 'nt-delivered', code: 'ORDER_DELIVERED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã giao thành công. Điểm Xanh đã được cộng!' },
  { id: 'nt-cancelled', code: 'ORDER_CANCELLED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã bị hủy.' },
  { id: 'nt-invoice', code: 'INVOICE_ISSUED', channel: 'INAPP', bodyTemplate: 'Hóa đơn VAT cho đơn {{order_code}} đã được phát hành.' },
  { id: 'nt-packed', code: 'ORDER_PACKED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã được đóng gói, chuẩn bị giao.' },
  { id: 'nt-returned', code: 'ORDER_RETURNED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã được hoàn trả.' },
  { id: 'nt-return-req', code: 'RETURN_REQUESTED', channel: 'INAPP', bodyTemplate: 'Đã nhận yêu cầu đổi/trả đơn {{order_code}}. Tubu sẽ phản hồi trong 24h.' },
  { id: 'nt-return-ok', code: 'RETURN_APPROVED', channel: 'INAPP', bodyTemplate: 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt. Tiền đã hoàn vào Ví Tubu 🌿' },
  { id: 'nt-cashback-paid', code: 'CASHBACK_PAID', channel: 'INAPP', bodyTemplate: 'Hoàn tiền {{amount}}đ từ mua sắm sàn ngoài đã vào Ví Tubu 🌿 Đổi sang TubuXu để nhận thêm 20% nhé!' },
  { id: 'nt-reorder', code: 'REORDER_REMINDER', channel: 'INAPP', bodyTemplate: '{{product}} của bạn dự kiến sắp hết. Đặt lại ngay để không gián đoạn nhé! 🛒' },
  { id: 'nt-pricedrop', code: 'PRICE_DROP_ALERT', channel: 'INAPP', bodyTemplate: '{{product}} bạn yêu thích đang giảm giá! Xem ngay 💚' },
  { id: 'nt-sub-order', code: 'SUBSCRIPTION_ORDER', channel: 'INAPP', bodyTemplate: 'Đơn định kỳ {{order_code}} đã được tạo tự động. Cảm ơn bạn đã đồng hành 🌿' },
  { id: 'nt-sub-pause', code: 'SUBSCRIPTION_PAUSED', channel: 'INAPP', bodyTemplate: 'Lịch đặt định kỳ tạm dừng (sản phẩm hết hàng hoặc địa chỉ không hợp lệ). Vui lòng kiểm tra lại.' },
  { id: 'nt-welcome', code: 'WELCOME_VOUCHER', channel: 'INAPP', bodyTemplate: 'Chào mừng bạn đến Tubu Tree! Tặng voucher {{code}} giảm {{value}}đ, dùng trước {{expires}} 🎁' },
  { id: 'nt-birthday', code: 'BIRTHDAY_VOUCHER', channel: 'INAPP', bodyTemplate: 'Chúc mừng sinh nhật! 🎂 Tặng bạn voucher {{code}} giảm {{value}}đ, dùng trước {{expires}}.' },
  { id: 'nt-winback', code: 'WINBACK_VOUCHER', channel: 'INAPP', bodyTemplate: 'Tubu nhớ bạn! Quay lại với voucher {{code}} giảm {{value}}đ, dùng trước {{expires}} 💚' },
  { id: 'nt-milestone', code: 'MILESTONE_VOUCHER', channel: 'INAPP', bodyTemplate: 'Cảm ơn bạn đã tin dùng Tubu! Tặng voucher tri ân {{code}} giảm {{value}}đ, dùng trước {{expires}} 🌿' },
  { id: 'nt-game-checkin', code: 'GAME_CHECKIN_REMINDER', channel: 'INAPP', bodyTemplate: '🔥 Chuỗi {{streak}} ngày của bạn sắp lỡ! Điểm danh Vườn Xanh hôm nay để giữ lửa nhé 🌿' },
  { id: 'nt-game-thirsty', code: 'GAME_TREE_THIRSTY', channel: 'INAPP', bodyTemplate: '🥀 Cây của bạn đang khát! Tưới nước hôm nay để cây không héo và mất tiến trình nhé 💧' },
  { id: 'nt-game-gift', code: 'GAME_WATER_GIFT', channel: 'INAPP', bodyTemplate: '🎁 Một người bạn vừa tặng bạn {{amount}}💧 cho Vườn Xanh! Vào tưới cây ngay nhé 🌿' },
  { id: 'nt-groupbuy-ok', code: 'GROUP_BUY_SUCCESS', channel: 'INAPP', bodyTemplate: '🎉 Nhóm mua chung đã đủ người! Bạn nhận mã giảm {{discount}}đ để mua với giá nhóm. Đặt hàng ngay nhé 🛒' },
  { id: 'nt-dealer-bonus', code: 'DEALER_BONUS_PAID', channel: 'INAPP', bodyTemplate: '🎁 Thưởng doanh số {{quarter}}: bạn được cộng {{amount}}đ vào công nợ đại lý (doanh số {{revenue}}đ). Cảm ơn bạn đã đồng hành cùng Tubu Tree 🌿' },
  { id: 'nt-comm-answer', code: 'COMMUNITY_NEW_ANSWER', channel: 'INAPP', bodyTemplate: '💬 {{author}} vừa trả lời câu hỏi "{{title}}" của bạn.' },
  { id: 'nt-comm-expert', code: 'COMMUNITY_EXPERT_REPLIED', channel: 'INAPP', bodyTemplate: '🌿 Chuyên gia Tubu vừa trả lời câu hỏi "{{title}}" của bạn.' },
  { id: 'nt-comm-best', code: 'COMMUNITY_BEST_ANSWER', channel: 'INAPP', bodyTemplate: 'Câu trả lời của bạn được chọn là hay nhất! 🌿 Bạn nhận thêm TubuXu thưởng.' },
  { id: 'nt-comm-approved', code: 'COMMUNITY_POST_APPROVED', channel: 'INAPP', bodyTemplate: '🌱 Bài viết của bạn đã được duyệt và hiển thị trong cộng đồng.' },
];

const QUIZZES = [
  { id: 'q1', question: 'Sản phẩm Fuwa3e được lên men từ nguyên liệu nào?', options: ['Dứa', 'Táo', 'Nho', 'Cam'], correct: 0, rewardPts: 3, brand: 'Fuwa3e' },
  { id: 'q2', question: 'Bao bì xanh nên được xử lý thế nào?', options: ['Vứt chung', 'Tái chế', 'Đốt', 'Chôn'], correct: 1, rewardPts: 3 },
  { id: 'q3', question: 'Vùng nguyên liệu của Pơ Lang ở đâu?', options: ['Đắk Lắk', 'Hà Nội', 'Cà Mau', 'Huế'], correct: 0, rewardPts: 3, brand: 'Pơ Lang' },
  { id: 'q4', question: 'Chứng nhận hữu cơ quốc tế phổ biến là?', options: ['ISO', 'USDA Organic', 'CE', 'FDA'], correct: 1, rewardPts: 3 },
  { id: 'q5', question: '"Sống xanh An Lành" là slogan của?', options: ['Tubu Tree', 'Shopee', 'Lazada', 'Tiki'], correct: 0, rewardPts: 3 },
  { id: 'q6', question: 'Cây thật được trồng qua đối tác nào?', options: ['PanNature', 'WWF', 'GreenID', 'IUCN'], correct: 0, rewardPts: 3 },
];

const MISSIONS = [
  { id: 'm1', code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', description: 'Hoàn tất đơn hàng đầu tiên', rewardPoints: 20, isRepeatable: false },
  { id: 'm2', code: 'CHECKIN_7', title: 'Chăm chỉ 7 ngày', description: 'Check-in 7 ngày liên tiếp', rewardPoints: 30, isRepeatable: true },
  { id: 'm3', code: 'REVIEW_3', title: 'Nhà phê bình', description: 'Viết 3 đánh giá có ảnh', rewardPoints: 15, isRepeatable: false },
  { id: 'm4', code: 'INVITE_3', title: 'Lan tỏa sống xanh', description: 'Mời 3 bạn đăng ký', rewardPoints: 50, isRepeatable: false },
];

const CASHBACK_MERCHANTS = [
  { id: 'cb-shopee', slug: 'shopee', provider: 'accesstrade', name: 'Shopee', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.035), fullRate: new Prisma.Decimal(0.05), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/shopee?utm_content={{clickId}}' },
  { id: 'cb-lazada', slug: 'lazada', provider: 'accesstrade', name: 'Lazada', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.042), fullRate: new Prisma.Decimal(0.06), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/lazada?utm_content={{clickId}}' },
  { id: 'cb-tiktok', slug: 'tiktokshop', provider: 'accesstrade', name: 'TikTok Shop', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.049), fullRate: new Prisma.Decimal(0.07), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/tiktok?utm_content={{clickId}}' },
];

async function main() {
  console.log('🌱 Seeding SystemConfig...');
  for (const cfg of SYSTEM_CONFIGS) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: { value: cfg.value, category: cfg.category, description: cfg.description },
      create: cfg,
    });
  }
  console.log(`   → ${SYSTEM_CONFIGS.length} config keys.`);

  // 🌱 RBAC — grant admin gán sẵn từ env SEED_ADMIN_PHONES (CSV). Idempotent.
  const seedAdminPhones = (process.env.SEED_ADMIN_PHONES ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const phone of seedAdminPhones) {
    const has = await prisma.roleGrant.findFirst({
      where: { phone, role: 'ADMIN', revokedAt: null },
    });
    if (!has) {
      await prisma.roleGrant.create({ data: { phone, role: 'ADMIN', grantedBy: 'seed' } });
    }
  }
  if (seedAdminPhones.length > 0) {
    console.log(`🌱 RoleGrant ADMIN cho ${seedAdminPhones.length} SĐT (SEED_ADMIN_PHONES).`);
  }

  console.log('🌱 Seeding MembershipTier...');
  for (const tier of TIERS) {
    await prisma.membershipTier.upsert({
      where: { id: tier.id },
      update: tier,
      create: tier,
    });
  }
  console.log(`   → ${TIERS.length} tiers.`);

  console.log('🌱 Seeding DealerTier...');
  for (const dt of DEALER_TIERS) {
    await prisma.dealerTier.upsert({
      where: { id: dt.id },
      update: dt,
      create: dt,
    });
  }
  console.log(`   → ${DEALER_TIERS.length} dealer tiers.`);

  console.log('🌱 Seeding Categories...');
  for (const c of CATEGORIES) {
    await prisma.category.upsert({ where: { id: c.id }, update: c, create: c });
  }
  console.log(`   → ${CATEGORIES.length} categories.`);

  console.log('🌱 Seeding Products (sample catalog)...');
  let variationCount = 0;
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {
        name: p.name, shortDesc: p.shortDesc, basePrice: p.basePrice, salePrice: p.salePrice ?? null,
        brand: p.brand, categoryIds: p.categoryIds, forSegment: p.forSegment,
        certifications: p.certifications, isFeatured: p.isFeatured ?? false,
        ingredients: p.ingredients ?? undefined,
        // KHÔNG đụng images/thumbnail ở update → giữ ảnh THẬT nếu Pancake sync đã ghi.
      },
      create: {
        id: p.id,
        pancakeId: `seed-${p.id}`, // placeholder; sync thật sẽ map theo pancakeId riêng
        brand: p.brand, slug: p.slug, name: p.name, shortDesc: p.shortDesc,
        description: p.shortDesc, images: [], thumbnail: null,
        categoryIds: p.categoryIds, tags: [p.brand.toLowerCase()],
        basePrice: p.basePrice, salePrice: p.salePrice ?? null,
        forSegment: p.forSegment, certifications: p.certifications, isFeatured: p.isFeatured ?? false,
        ingredients: p.ingredients ?? undefined,
      },
    });
    for (const v of p.variations) {
      await prisma.variation.upsert({
        where: { sku: v.sku },
        update: { retailPrice: v.retailPrice, salePrice: v.salePrice ?? null, stock: v.stock },
        create: {
          pancakeId: `seed-${v.sku}`, productId: p.id, sku: v.sku, name: v.name,
          attributes: v.attributes, retailPrice: v.retailPrice, salePrice: v.salePrice ?? null,
          stock: v.stock, weight: v.weight,
        },
      });
      variationCount++;
    }
  }
  console.log(`   → ${PRODUCTS.length} products, ${variationCount} variations.`);

  console.log('🌱 Seeding NotificationTemplates...');
  for (const t of NOTIFICATION_TEMPLATES) {
    await prisma.notificationTemplate.upsert({ where: { id: t.id }, update: t, create: t });
  }
  console.log(`   → ${NOTIFICATION_TEMPLATES.length} templates.`);

  console.log('🌱 Seeding sample Coupons...');
  const COUPONS: Prisma.CouponCreateInput[] = [
    { code: 'WELCOME30', type: 'AMOUNT', value: 30000, minOrder: 199000, startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), perUserLimit: 1, scope: 'PUBLIC' },
    { code: 'FREESHIP', type: 'FREESHIP', value: 0, minOrder: 99000, startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), perUserLimit: 3, scope: 'PUBLIC' },
    { code: 'XANH10', type: 'PERCENT', value: 10, minOrder: 250000, maxDiscount: 50000, startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), perUserLimit: 2, scope: 'PUBLIC' },
  ];
  for (const c of COUPONS) {
    await prisma.coupon.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  console.log('🌱 Seeding Quizzes & Missions...');
  for (const q of QUIZZES) {
    await prisma.gameQuiz.upsert({ where: { id: q.id }, update: q, create: q });
  }
  for (const m of MISSIONS) {
    await prisma.mission.upsert({ where: { id: m.id }, update: m, create: m });
  }
  console.log(`   → ${QUIZZES.length} quizzes, ${MISSIONS.length} missions.`);

  console.log('🌱 Seeding CashbackMerchants...');
  for (const m of CASHBACK_MERCHANTS) {
    await prisma.cashbackMerchant.upsert({ where: { id: m.id }, update: m, create: m });
  }
  console.log(`   → ${CASHBACK_MERCHANTS.length} merchants.`);

  console.log('🌱 Seeding Nature Quiz questions...');
  await seedGameQuiz(prisma);

  // Vườn Xanh 2.0 Phase 2 — mốc cộng đồng cây thật đang mở.
  console.log('🌳 Seeding Community Goal...');
  await prisma.communityGoal.upsert({
    where: { id: 'cg-cangio-2026' },
    update: {},
    create: {
      id: 'cg-cangio-2026',
      title: 'Cùng Tubu phủ xanh Cần Giờ',
      region: 'Rừng ngập mặn Cần Giờ, TP.HCM',
      targetDrops: 100000,
      currentDrops: 0,
      treesToPlant: 200,
      status: 'ACTIVE',
    },
  });

  // Vườn Xanh 2.0 Phase 3 — sổ tay loài cây Việt Nam.
  console.log('🌿 Seeding Plant Species...');
  for (const sp of PLANT_SPECIES) {
    await prisma.plantSpecies.upsert({ where: { id: sp.id }, update: sp, create: sp });
  }

  // Vườn Xanh 2.0 Phase 4 — mùa đang diễn ra.
  console.log('🍃 Seeding Season...');
  await prisma.season.upsert({
    where: { id: 'se-2026-he-cangio' },
    update: {},
    create: {
      id: 'se-2026-he-cangio',
      name: 'Mùa Hè Xanh — Phủ xanh Cần Giờ',
      theme: 'Rừng ngập mặn miền Nam',
      region: 'Cần Giờ, TP.HCM',
      featuredSpeciesIds: ['sp-duoc', 'sp-tram', 'sp-sao'],
      startAt: new Date('2026-06-01T00:00:00+07:00'),
      endAt: new Date('2026-08-31T23:59:59+07:00'),
    },
  });

  // Cộng đồng Vườn Tubu Pha 1a — 6 danh mục Q&A cố định.
  console.log('🌱 Seeding Community Categories...');
  const COMMUNITY_CATEGORIES = [
    { slug: 'cham-soc', name: 'Chăm sóc cây', icon: '🌱', order: 1 },
    { slug: 'sau-benh', name: 'Sâu bệnh', icon: '🐛', order: 2 },
    { slug: 'phoi-canh', name: 'Phối cảnh / décor', icon: '🪴', order: 3 },
    { slug: 'khoe-vuon', name: 'Khoe vườn', icon: '🌿', order: 4 },
    { slug: 'hoi-mua-gi', name: 'Hỏi mua gì', icon: '🛒', order: 5 },
    { slug: 'meo-hay', name: 'Mẹo hay', icon: '💡', order: 6 },
  ];
  for (const c of COMMUNITY_CATEGORIES) {
    await prisma.communityCategory.upsert({ where: { slug: c.slug }, update: { name: c.name, icon: c.icon, order: c.order }, create: c });
  }
  console.log(`Seeded ${COMMUNITY_CATEGORIES.length} community categories`);

  console.log('✅ Seed done.');
}

const PLANT_SPECIES = [
  { id: 'sp-tram', name: 'Cây Tràm', scientificName: 'Melaleuca cajuputi', region: 'Đồng bằng sông Cửu Long', rarity: 'COMMON', emoji: '🌿',
    story: 'Tràm phủ xanh vùng đất phèn miền Tây, cho mật ong tràm và tinh dầu kháng khuẩn.', ecoFact: 'Rừng tràm U Minh là "lá phổi" lọc nước và giữ đa dạng sinh học bậc nhất Nam Bộ.' },
  { id: 'sp-duoc', name: 'Cây Đước', scientificName: 'Rhizophora apiculata', region: 'Cần Giờ, Cà Mau', rarity: 'COMMON', emoji: '🌱',
    story: 'Đước với bộ rễ chống đỡ đặc trưng là loài chủ lực của rừng ngập mặn Việt Nam.', ecoFact: 'Rễ đước chắn sóng, giữ phù sa và lưu trữ carbon gấp ~4 lần rừng trên cạn.' },
  { id: 'sp-ban', name: 'Cây Bàng', scientificName: 'Terminalia catappa', region: 'Ven biển cả nước', rarity: 'COMMON', emoji: '🌳',
    story: 'Bàng cho bóng mát sân trường, lá đỏ rực khi sang đông.', ecoFact: 'Tán bàng rộng giúp hạ nhiệt đô thị và là nơi trú ngụ của nhiều loài chim.' },
  { id: 'sp-phuong', name: 'Phượng Vĩ', scientificName: 'Delonix regia', region: 'Hải Phòng & đô thị', rarity: 'RARE', emoji: '🌺',
    story: 'Phượng vĩ nở đỏ báo hiệu mùa hè và mùa chia tay tuổi học trò.', ecoFact: 'Hoa phượng là nguồn mật quan trọng cho ong và côn trùng thụ phấn đầu hè.' },
  { id: 'sp-lim', name: 'Cây Lim Xanh', scientificName: 'Erythrophleum fordii', region: 'Rừng Bắc & Trung Bộ', rarity: 'RARE', emoji: '🌳',
    story: 'Lim là một trong "tứ thiết" gỗ quý, sống hàng trăm năm.', ecoFact: 'Cây gỗ lớn như lim giữ đất chống xói mòn và tích trữ carbon dài hạn.' },
  { id: 'sp-sao', name: 'Cây Sao Đen', scientificName: 'Hopea odorata', region: 'Đông Nam Bộ', rarity: 'RARE', emoji: '🌲',
    story: 'Sao đen cao vút thường được trồng làm hàng cây di sản trên phố.', ecoFact: 'Tán sao đen tạo hành lang xanh, giảm bụi mịn và tiếng ồn đô thị.' },
  { id: 'sp-po-mu', name: 'Cây Pơ Mu', scientificName: 'Fokienia hodginsii', region: 'Núi cao Tây Bắc', rarity: 'LEGENDARY', emoji: '🌲',
    story: 'Pơ mu là cây gỗ quý vùng núi cao, gắn với văn hoá người Mông, Dao.', ecoFact: 'Pơ mu thuộc nhóm nguy cấp — bảo tồn giúp giữ rừng đầu nguồn và nguồn nước.' },
  { id: 'sp-bach-xanh', name: 'Bách Xanh', scientificName: 'Calocedrus macrolepis', region: 'Cao nguyên Đà Lạt', rarity: 'LEGENDARY', emoji: '🌲',
    story: 'Bách xanh cổ thụ ở Hòn Bà, Bidoup có cây hàng nghìn năm tuổi.', ecoFact: 'Là loài quý hiếm, bách xanh chỉ tin tưởng ở rừng nguyên sinh ít bị tác động.' },
  { id: 'sp-thong', name: 'Thông Ba Lá', scientificName: 'Pinus kesiya', region: 'Lâm Đồng', rarity: 'COMMON', emoji: '🌲',
    story: 'Rừng thông Đà Lạt tạo nên khí hậu mát lành và cảnh quan thơ mộng.', ecoFact: 'Thông giữ đất dốc, lá kim phân huỷ chậm nuôi tầng mùn cho rừng.' },
  { id: 'sp-gao', name: 'Cây Gạo', scientificName: 'Bombax ceiba', region: 'Đồng bằng Bắc Bộ', rarity: 'RARE', emoji: '🌺',
    story: '"Tháng ba hoa gạo" đỏ rực bến nước, đình làng Bắc Bộ.', ecoFact: 'Hoa gạo nhiều mật, là "nhà hàng" cho chào mào, sáo và nhiều loài chim mùa xuân.' },
] as const;

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
