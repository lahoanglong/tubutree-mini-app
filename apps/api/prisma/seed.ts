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

// Catalog mẫu (đại diện ~brands tubutree.com). Khi có Pancake key thật, sync sẽ ghi đè giá/tồn theo pancakeId.
const PRODUCTS: SeedProduct[] = [
  {
    id: 'p-polang-shampoo', brand: 'Pơ Lang', slug: 'dau-goi-buoi-po-lang', name: 'Dầu gội bưởi Pơ Lang',
    shortDesc: 'Dầu gội thảo dược tinh dầu bưởi, giảm rụng tóc.', basePrice: 165000, categoryIds: ['cat-skincare'],
    forSegment: ['sensitive_skin'], certifications: ['Vegan'], isFeatured: true,
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
    id: 'p-fuwa-dishwash', brand: 'Fuwa3e', slug: 'nuoc-rua-chen-fuwa3e', name: 'Nước rửa chén sinh học Fuwa3e',
    shortDesc: 'Lên men enzyme dứa, an toàn cho da tay.', basePrice: 120000, categoryIds: ['cat-cleaning'],
    forSegment: [], certifications: ['Eco'], isFeatured: true,
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
    id: 'p-visante-serum', brand: 'Visante', slug: 'serum-duong-am-visante', name: 'Serum dưỡng ẩm Visante',
    shortDesc: 'Cấp ẩm chuyên sâu chiết xuất rau má.', basePrice: 320000, salePrice: 289000, categoryIds: ['cat-skincare'],
    forSegment: ['sensitive_skin', 'mom_baby'], certifications: ['USDA Organic', 'Vegan'], isFeatured: true,
    ingredients: [
      { name: 'Chiết xuất rau má', percentage: '5%', benefit: 'Phục hồi, làm dịu da nhạy cảm' },
      { name: 'Hyaluronic Acid', percentage: '2%', benefit: 'Cấp ẩm sâu, căng mịn' },
      { name: 'Chiết xuất lô hội', benefit: 'Làm dịu, chống kích ứng' },
    ],
    variations: [
      { sku: 'VIS-SR-30', name: '30ml', attributes: { size: '30ml' }, retailPrice: 320000, salePrice: 289000, stock: 60, weight: 90 },
    ],
  },
  {
    id: 'p-fuwa-laundry', brand: 'Fuwa3e', slug: 'nuoc-giat-fuwa3e', name: 'Nước giặt sinh học Fuwa3e',
    shortDesc: 'Sạch sâu, dịu nhẹ cho đồ em bé.', basePrice: 210000, categoryIds: ['cat-cleaning', 'cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Eco'],
    variations: [
      { sku: 'FUWA-LD-2L', name: '2L', attributes: { size: '2L' }, retailPrice: 210000, stock: 150, weight: 2100 },
    ],
  },
  {
    id: 'p-polang-bodywash', brand: 'Pơ Lang', slug: 'sua-tam-sa-po-lang', name: 'Sữa tắm sả chanh Pơ Lang',
    shortDesc: 'Hương sả chanh thư giãn, dưỡng ẩm.', basePrice: 175000, categoryIds: ['cat-skincare'],
    forSegment: [], certifications: ['Vegan'],
    variations: [
      { sku: 'POLANG-BW-500', name: '500ml', attributes: { size: '500ml', scent: 'sả chanh' }, retailPrice: 175000, stock: 90, weight: 560 },
    ],
  },
  {
    id: 'p-visante-cream', brand: 'Visante', slug: 'kem-duong-ba-bau-visante', name: 'Kem dưỡng cho mẹ bầu Visante',
    shortDesc: 'Ngừa rạn da, lành tính cho thai kỳ.', basePrice: 290000, categoryIds: ['cat-mom'],
    forSegment: ['mom_baby'], certifications: ['USDA Organic'],
    variations: [
      { sku: 'VIS-CR-100', name: '100ml', attributes: { size: '100ml' }, retailPrice: 290000, stock: 45, weight: 160 },
    ],
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
  { id: 'nt-reorder', code: 'REORDER_REMINDER', channel: 'INAPP', bodyTemplate: '{{product}} của bạn dự kiến sắp hết. Đặt lại ngay để không gián đoạn nhé! 🛒' },
  { id: 'nt-pricedrop', code: 'PRICE_DROP_ALERT', channel: 'INAPP', bodyTemplate: '{{product}} bạn yêu thích đang giảm giá! Xem ngay 💚' },
  { id: 'nt-sub-order', code: 'SUBSCRIPTION_ORDER', channel: 'INAPP', bodyTemplate: 'Đơn định kỳ {{order_code}} đã được tạo tự động. Cảm ơn bạn đã đồng hành 🌿' },
  { id: 'nt-sub-pause', code: 'SUBSCRIPTION_PAUSED', channel: 'INAPP', bodyTemplate: 'Lịch đặt định kỳ tạm dừng (sản phẩm hết hàng hoặc địa chỉ không hợp lệ). Vui lòng kiểm tra lại.' },
  { id: 'nt-welcome', code: 'WELCOME_VOUCHER', channel: 'INAPP', bodyTemplate: 'Chào mừng bạn đến Tubu Tree! Tặng voucher {{code}} giảm {{value}}đ, dùng trước {{expires}} 🎁' },
  { id: 'nt-birthday', code: 'BIRTHDAY_VOUCHER', channel: 'INAPP', bodyTemplate: 'Chúc mừng sinh nhật! 🎂 Tặng bạn voucher {{code}} giảm {{value}}đ, dùng trước {{expires}}.' },
  { id: 'nt-winback', code: 'WINBACK_VOUCHER', channel: 'INAPP', bodyTemplate: 'Tubu nhớ bạn! Quay lại với voucher {{code}} giảm {{value}}đ, dùng trước {{expires}} 💚' },
  { id: 'nt-milestone', code: 'MILESTONE_VOUCHER', channel: 'INAPP', bodyTemplate: 'Cảm ơn bạn đã tin dùng Tubu! Tặng voucher tri ân {{code}} giảm {{value}}đ, dùng trước {{expires}} 🌿' },
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
  { id: 'cb-shopee', slug: 'shopee', name: 'Shopee', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.035), fullRate: new Prisma.Decimal(0.05), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/shopee?utm_content={{clickId}}' },
  { id: 'cb-lazada', slug: 'lazada', name: 'Lazada', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.042), fullRate: new Prisma.Decimal(0.06), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/lazada?utm_content={{clickId}}' },
  { id: 'cb-tiktok', slug: 'tiktokshop', name: 'TikTok Shop', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.049), fullRate: new Prisma.Decimal(0.07), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/tiktok?utm_content={{clickId}}' },
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

  console.log('🌱 Seeding sample Coupon (WELCOME30)...');
  await prisma.coupon.upsert({
    where: { code: 'WELCOME30' },
    update: {},
    create: {
      code: 'WELCOME30', type: 'AMOUNT', value: 30000, minOrder: 199000,
      startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'),
      perUserLimit: 1, scope: 'PUBLIC',
    },
  });

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

  console.log('✅ Seed done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
