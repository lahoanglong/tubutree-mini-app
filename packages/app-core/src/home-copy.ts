/**
 * Chữ của Trang chủ mới, Ưu đãi và trang Cá nhân mới. Một nguồn cho Mini App và web khổ điện thoại. Chữ cũ của Trang chủ
 * (Giờ vàng, Mua lại, Quà khách mới) vẫn ở `vi.ts` của Mini App và `home-text.ts` của web.
 */
export const homeCopy = {
  member: {
    greeting: (name: string) => `Chào ${name}`,
    greetingFallback: 'bạn',
    cardLabel: 'Thẻ thành viên',
    openLabel: 'Xem Điểm Xanh và ưu đãi',
    checkIn: 'Điểm danh',
    checkedIn: 'Đã điểm danh',
    checkInLoading: 'Điểm danh',
    rewards: 'Đổi quà',
    topTier: 'Bạn đang ở hạng cao nhất',
    tierFailed: 'Chưa tải được hạng và điểm',
    /** Mất kết nối lúc khôi phục phiên của khách cũ (web): giữ khung thẻ, báo rõ và cho thử lại. */
    offline: 'Chưa tải được điểm của bạn',
    retry: 'Thử lại',
    /** Chữ vô hình giữ đúng chiều cao dòng tiến độ lúc dữ liệu hạng chưa về. */
    progressSpacer: 'Còn 000 điểm lên hạng kế',
  },
  todo: {
    title: 'Việc cần làm',
    payTitle: (amount: string) => `Chờ chuyển khoản ${amount}`,
    payOverdue: 'Đã quá hạn chuyển khoản',
    payNow: 'Thanh toán',
    payNowLabel: (code: string) => `Thanh toán ngay đơn ${code}`,
    openOrder: (code: string) => `Mở đơn ${code}`,
    shipping: (code: string) => `Đơn ${code} đang giao`,
    shippingMany: (n: number) => `${n} đơn đang giao`,
    shippingHint: 'Chạm để theo dõi đơn',
    preparing: (code: string) => `Đơn ${code} đang chuẩn bị`,
    preparingMany: (n: number) => `${n} đơn đang chuẩn bị`,
    preparingHint: 'Chạm để xem đơn',
  },
  /**
   * `more`/`moreAria`: ô cuối lưới lối tắt mở sheet các lối tắt còn lại (nhãn ≤ 6 ký tự, một dòng); `moreAria` cũng là tên hộp thoại của sheet. Khác ô
   * "Tất cả" của hàng Danh mục (đi tới tab Danh mục): hai ô không được cùng nhãn. Tên đọc bắt đầu bằng chữ nhìn thấy (WCAG 2.5.3).
   */
  shortcuts: { title: 'Lối tắt', more: 'Thêm', moreAria: 'Thêm lối tắt' },
  reorder: { buy: 'Mua lại', subscribe: (pct: number) => `Định kỳ -${pct}%`, seeAll: 'Xem đơn hàng' },
  categories: { title: 'Danh mục', all: 'Tất cả', allAria: 'Tất cả danh mục', brands: 'Thương hiệu' },
  journey: {
    title: 'Hành trình nguyên liệu',
    body: (brands: number) => (brands > 0 ? `${brands} thương hiệu Việt, từ nhiều vùng đất` : 'Sản phẩm Tubu từ nhiều vùng đất Việt Nam'),
    cta: 'Xem bản đồ',
  },
  /** Khối giới thiệu đầu Trang chủ web từ md khi không có banner chiến dịch (`HomeEditorialHero`); điện thoại và Mini App không có. Chỉ nêu điều có thật: trang Hành trình nguyên liệu và danh mục sản phẩm. */
  hero: {
    label: 'Giới thiệu Tubu Tree',
    eyebrow: 'Tubu Tree',
    title: 'Sản phẩm Việt từ nhiều vùng đất, giao đến nhà bạn',
    body: 'Tìm hiểu thương hiệu và vùng đất của nguyên liệu, rồi chọn món bạn cần.',
    ctaShop: 'Khám phá sản phẩm',
    ctaStory: 'Xem hành trình nguyên liệu',
  },
  community: {
    title: 'Cộng đồng hỏi đáp',
    seeAll: 'Xem tất cả',
    comments: (n: number) => `${n} bình luận`,
    noComments: 'Chưa có bình luận',
  },
  /** Lưới "Gợi ý cho bạn" (block `suggest`, W47): tiêu đề, nút tải thêm, câu cuối lưới và lối vào Danh mục. */
  suggest: {
    title: 'Gợi ý cho bạn',
    more: 'Xem thêm',
    end: 'Bạn đã xem hết gợi ý hôm nay',
    enter: 'Vào Danh mục',
  },
  guestGift: {
    cta: 'Nhận quà bằng Zalo',
    ctaShort: 'Nhận quà',
    ctaHint: 'Liên kết Zalo để nhận mã và giữ điểm',
    /** Bản web: khách chưa đăng nhập nhận mã sau khi đăng nhập. */
    webCtaHint: 'Đăng nhập để nhận mã và giữ điểm',
    linking: 'Đang liên kết…',
    failed: 'Chưa liên kết được Zalo. Bạn thử lại sau nhé.',
  },
  earn: {
    title: 'Kiếm tiền cùng Tubu',
    sheetBody: 'Chọn cách bạn muốn cùng Tubu',
    affiliate: { label: 'Cộng tác viên', hint: 'Chia sẻ, nhận hoa hồng' },
    academy: { label: 'Học viện Tubu', hint: 'Học cách bán hàng, nhận chứng chỉ' },
    dealer: { label: 'Đại lý', hint: 'Bảng giá sỉ, công nợ' },
  },
  offers: {
    title: 'Ưu đãi',
    pointsTitle: 'Điểm Xanh của bạn',
    pointsDetail: 'Hạng và lịch sử điểm',
    rewardsTitle: 'Đổi quà',
    rewardsHint: 'Đổi Điểm Xanh lấy mã giảm giá và quà',
    myRewards: 'Quà của tôi',
    myRewardsHint: 'Quà đã đổi và mã nhận quà',
    recycleHint: 'Đổi bao bì lấy Điểm Xanh',
    recyclePausedHint: 'Chương trình đang tạm dừng, xem yêu cầu còn mở',
    groupBuyHint: 'Rủ bạn mua chung, đủ nhóm nhận mã giảm giá',
    couponsTitle: 'Mã giảm giá của tôi',
    couponsCount: (n: number) => `${n} mã`,
    couponsEmptyHeading: 'Chưa có mã giảm giá khả dụng',
    couponsEmptyBody: 'Đổi Điểm Xanh ở mục Đổi quà để nhận mã.',
    couponExpiring: 'Sắp hết hạn',
    guestTitle: 'Liên kết Zalo để giữ điểm và nhận quà',
    guestBody: 'Điểm, mã giảm giá và quà chỉ lưu khi tài khoản đã liên kết Zalo.',
    loginTitle: 'Đăng nhập để xem ưu đãi',
    loginBody: 'Điểm Xanh, mã giảm giá và quà của bạn nằm ở đây.',
  },
  profile: {
    ordersTitle: 'Đơn của tôi',
    ordersAll: 'Xem tất cả',
    ordersAllLabel: 'Xem tất cả đơn hàng',
    orderStatusLabel: (label: string, n: number) => (n > 0 ? `${label}, ${n} đơn` : label),
    statPoints: 'Điểm Xanh',
    statWallet: 'Ví Tubu',
    referralMilestone: (remaining: number, bonus: string) => `Mời thêm ${remaining} bạn để nhận ${bonus}`,
    guestTitle: 'Liên kết Zalo để giữ điểm và nhận quà',
    guestBody: 'Bạn đang dùng tài khoản khách. Liên kết Zalo để giữ điểm, đơn hàng và nhận quà.',
    guestCta: 'Liên kết Zalo',
  },
} as const;
