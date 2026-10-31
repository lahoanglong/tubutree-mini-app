/**
 * Một nguồn chữ cho gian hàng (Mini App và web). Chữ của màn mua sắm chỉ thêm ở đây, kèm số ký tự tối đa để vừa 375px.
 * Mẫu có chỗ trống `{tên}`; điền bằng `fillCopy`. Nguồn chữ: docs/2026-10-31-shop-redesign/review/ux-copy.md mục B,
 * chữ Giờ vàng theo kế hoạch (Vừa mở bán / Đã bán n% / Sắp hết / Đã bán hết) vì kế hoạch chốt sau báo cáo.
 */

/** `[chữ, số ký tự tối đa khi điền giá trị xấu nhất]`; max null = câu dài, không giới hạn. */
type Entry = readonly [text: string, max: number | null];

const ENTRIES: Record<string, Entry> = {
  // Giờ vàng
  'flash.title': ['Giờ vàng', 12],
  'flash.seeAll': ['Xem tất cả', 10],
  'flash.slotLive': ['Đang diễn ra', 12],
  'flash.slotNext': ['Sắp diễn ra', 12],
  'flash.slotTomorrow': ['Ngày mai', 12],
  'flash.slotEnded': ['Đã kết thúc', 12],
  'flash.endsIn': ['Kết thúc sau {t}', 22],
  'flash.startsIn': ['Bắt đầu sau {t}', 22],
  'flash.startsAt': ['Mở lúc {time}', 22],
  'flash.startsAtDay': ['Mở lúc {time} ngày {day}', 23],
  'flash.badge': ['Giờ vàng -{pct}%', 14],
  'flash.justOpened': ['Vừa mở bán', 16],
  'flash.soldPct': ['Đã bán {n}%', 16],
  'flash.almostGone': ['Sắp hết', 16],
  'flash.left': ['Còn {n} suất', 16],
  'flash.soldOut': ['Đã bán hết', 16],
  'flash.limit': ['Mỗi khách tối đa {n}', 20],
  'flash.buy': ['Mua ngay', 12],
  'flash.remind': ['Nhắc tôi', 12],
  'flash.reminded': ['Đã đặt nhắc', 12],
  'flash.remindedToast': ['Tubu sẽ nhắc bạn lúc {time}', null],
  'flash.unremindToast': ['Đã bỏ nhắc', null],
  'flash.emptyTitle': ['Chưa có Giờ vàng lúc này', null],
  'flash.emptyBody': ['Khung giờ tiếp theo sẽ hiện ở đây.', null],
  'flash.emptyCta': ['Xem sản phẩm khác', 18],
  'flash.endedTitle': ['Khung giờ này đã kết thúc', null],
  'flash.endedCta': ['Xem khung giờ tiếp theo', 23],
  'flash.priceChangedBody': ['Vài sản phẩm Giờ vàng vừa hết suất hoặc hết giờ. Bạn xem lại giỏ trước khi đặt nhé.', null],
  'flash.overLimitError': ['Giá Giờ vàng chỉ áp cho {n} sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.', null],
  'flash.soldOutError': ['Suất Giờ vàng vừa hết, sản phẩm về giá thường. Bạn xem lại giỏ nhé.', null],
  'flash.notifyStart': ['{name} đang có giá Giờ vàng tới {time}.', null],

  // Bán chạy nhất
  'rank.title': ['Bán chạy nhất', 16],
  'rank.basis': ['Theo lượt bán 30 ngày qua', 28],
  'rank.basisAll': ['Theo tổng lượt bán', 28],
  'rank.tabAll': ['Tất cả', 12],
  'rank.spoken': ['Hạng {n} bán chạy', null],
  'rank.seeAll': ['Xem tất cả', 10],
  'rank.emptyTitle': ['Chưa đủ lượt bán để xếp hạng', null],
  'rank.emptyCta': ['Xem sản phẩm trong danh mục', 27],

  // Nhãn, tồn kho, giá đọc, dòng meta, số liệu shop
  'badge.discount': ['-{pct}%', 5],
  'badge.new': ['Mới', 4],
  'badge.featured': ['Tubu chọn', 10],
  'badge.loved': ['Được yêu thích', 14],
  'badge.freeship': ['Miễn phí giao hàng', 18],
  'badge.flashSpoken': ['Giờ vàng giảm {pct}%', null],
  'badge.discountSpoken': ['Giảm {pct}%', null],
  'stock.out': ['Tạm hết hàng', 12],
  'stock.discontinued': ['Ngừng bán', 12],
  'price.spoken': ['Giá {price}', null],
  'price.flashSpoken': ['Giá Giờ vàng {price}', null],
  'price.compareSpoken': [', giá gốc {price}', null],
  'meta.rating': ['★ {avg}', 8],
  'meta.sold': ['Đã bán {n}', 16],
  'stats.products': ['Sản phẩm', 12],
  'stats.rating': ['Đánh giá', 12],
  'stats.sold': ['Đã bán', 12],
  'stats.productsSpoken': ['{n} sản phẩm', null],
  'stats.ratingSpoken': ['{avg} sao', null],
  'stats.soldSpoken': ['Đã bán hơn {n}', null],
  'brand.title': ['Thương hiệu', 12],

  // Đồng hồ (countdown.ts)
  'time.days': ['{d} ngày', 16],
  'time.daysHours': ['{d} ngày {h} giờ', 16],
  'time.hoursMinutes': ['{h} giờ {m} phút', 16],
  'time.hours': ['{h} giờ', 16],
  'time.minutes': ['{m} phút', 16],
  'time.underMinute': ['dưới 1 phút', 16],
  'time.daysClock': ['{d} ngày {clock}', 16],

  // Gợi ý hôm nay
  'suggest.title': ['Gợi ý hôm nay', 16],
  'suggest.tabForYou': ['Dành cho bạn', 14],
  'suggest.tabBest': ['Bán chạy', 10],
  'suggest.tabNew': ['Mới nhất', 10],
  'suggest.guestHint': ['Đăng nhập để có gợi ý hợp với bạn', null],
  'suggest.loadingMore': ['Đang tải thêm…', null],
  'suggest.loadMoreFailed': ['Chưa tải thêm được.', null],
  'suggest.more': ['Xem thêm', 10],
  'suggest.end': ['Bạn đã xem hết gợi ý hôm nay', null],

  // Banner và chiến dịch
  'campaign.carouselLabel': ['Chương trình nổi bật', null],
  'campaign.slideLabel': ['{title}, {i} trên {n}', null],
  'campaign.dot': ['Xem chương trình {i}', null],
  'campaign.pause': ['Dừng tự chuyển', null],
  'campaign.play': ['Tự chuyển tiếp', null],
  'campaign.dateRange': ['Từ {a} đến {b}', null],
  'campaign.statusLive': ['Đang diễn ra', 12],
  'campaign.statusNext': ['Sắp diễn ra', 12],
  'campaign.statusEnded': ['Đã kết thúc', 12],
  'campaign.sectionCoupons': ['Mã giảm giá của chương trình', null],
  'campaign.sectionFlash': ['Giờ vàng trong chương trình', null],
  'campaign.sectionProducts': ['Sản phẩm trong chương trình', null],
  'campaign.notStarted': ['Chương trình mở lúc {when}', null],
  'campaign.endedTitle': ['Chương trình đã kết thúc', null],
  'campaign.endedBody': ['Cảm ơn bạn đã ghé. Xem các ưu đãi đang có nhé.', null],
  'campaign.notFound': ['Không tìm thấy chương trình này', null],
  'campaign.share': ['Chia sẻ chương trình', null],

  // Mã giảm giá
  'coupon.title': ['Mã giảm giá', 14],
  'coupon.tabClaim': ['Nhận mã', 12],
  'coupon.tabMine': ['Mã của tôi', 12],
  'coupon.tabHistory': ['Đã dùng/hết hạn', 18],
  'coupon.freeship': ['Miễn phí giao hàng', 18],
  'coupon.amount': ['Giảm {amount}', 20],
  'coupon.percent': ['Giảm {pct}%', 12],
  'coupon.percentMax': ['Giảm {pct}% (tối đa {max})', 30],
  'coupon.minOrder': ['Đơn từ {min}', 16],
  'coupon.scopeAll': ['Mọi sản phẩm', 16],
  'coupon.scopeBrand': ['Cho sản phẩm {name}', null],
  'coupon.scopeCount': ['Cho {n} sản phẩm', 20],
  'coupon.expires': ['Dùng đến {date}', 16],
  'coupon.expiresToday': ['Hết hạn hôm nay', 16],
  'coupon.expiresInDays': ['Còn {n} ngày', 16],
  'coupon.usesLeft': ['Còn {n} lượt', 16],
  'coupon.save': ['Lưu mã', 12],
  'coupon.saved': ['Đã lưu', 12],
  'coupon.use': ['Dùng ngay', 12],
  'coupon.copy': ['Sao chép', 12],
  'coupon.needMore': ['Mua thêm {x} để dùng', 26],
  'coupon.outOfQuota': ['Đã hết lượt', 16],
  'coupon.expired': ['Đã hết hạn', 16],
  'coupon.used': ['Đã dùng', 16],
  'coupon.savedToast': ['Đã lưu vào Mã của tôi', null],
  'coupon.loginToSave': ['Đăng nhập để lưu mã nhé', null],
  'coupon.detailTitle': ['Điều kiện dùng mã', null],
  'coupon.emptyMineTitle': ['Bạn chưa có mã nào dùng được', null],
  'coupon.emptyMineBody': ['Lưu mã ở mục Nhận mã, hoặc đổi Điểm Xanh lấy mã ở Đổi quà.', null],
  'coupon.emptyClaimTitle': ['Hôm nay chưa có mã mới', null],
  'coupon.oneCodeHint': ['Mỗi đơn dùng 1 mã', null],

  // Combo và mua kèm
  'combo.title': ['Combo tiết kiệm', null],
  'combo.rule': ['Mua {n} giảm {pct}%', 20],
  'combo.total': ['Tổng {price} · Tiết kiệm {save}', null],
  'combo.add': ['Thêm combo vào giỏ', null],
  'combo.tileTag': ['Có combo', 9],
  'combo.cartHint': ['Thêm {n} sản phẩm nữa để giảm combo {pct}%', null],
  'combo.cartReached': ['Đã đủ combo, giảm {x}', null],
  'combo.cartLost': ['Combo chưa đủ món nên chưa giảm', null],
  'combo.cartLine': ['Giảm giá combo', null],
  'addon.title': ['Mua kèm giá ưu đãi', null],
  'addon.price': ['Giá mua kèm {price}', null],
  'addon.condition': ['Chỉ khi mua cùng {name}', null],
  'addon.add': ['Thêm', 8],
  'addon.added': ['Đã thêm', 8],
  'addon.cartLine': ['Ưu đãi mua kèm', null],
  'addon.lost': ['Đã bỏ giá mua kèm vì {name} không còn trong giỏ', null],
  'pdp.boughtTogether': ['Khách thường mua cùng', null],
};

export const SHOP_COPY: Record<string, string> = Object.fromEntries(Object.entries(ENTRIES).map(([k, [text]]) => [k, text]));

/** Số ký tự tối đa của từng khoá (cùng tập khoá với `SHOP_COPY`); spec điền giá trị xấu nhất rồi so. */
export const SHOP_COPY_MAX: Record<string, number | null> = Object.fromEntries(Object.entries(ENTRIES).map(([k, [, max]]) => [k, max]));

/** Thuật ngữ không được xuất hiện trong chữ hiển thị cho khách; `use` là chữ thay thế. Bảng gốc: ux-copy mục D2 và thiết kế §4 Q5. */
export const FORBIDDEN_TERMS: readonly { pattern: RegExp; use: string }[] = [
  { pattern: /Nhãn hàng|theo dõi nhãn|nhãn này|Cùng nhà/i, use: 'Thương hiệu' },
  { pattern: /\bTop\b/, use: 'Bán chạy nhất' },
  { pattern: /Freeship/i, use: 'Miễn phí giao hàng' },
  { pattern: /voucher/i, use: 'Mã giảm giá' },
  { pattern: /Flash sale/i, use: 'Giờ vàng' },
  { pattern: /giờ vàng/, use: 'Giờ vàng (hoa chữ G)' },
  { pattern: /\bHSD\b/, use: 'Hạn dùng hoặc Dùng đến' },
  { pattern: /Chỉ còn/i, use: 'Còn {n} sản phẩm' },
  { pattern: /Vui lòng|chúng tôi/i, use: 'Bạn hoặc Tubu' },
  { pattern: /cửa hàng/i, use: 'Gian hàng' },
  { pattern: /\.{3}/, use: '… (một ký tự)' },
  { pattern: /\b\d+h \d{2}m\b/, use: 'countdownText, ví dụ "2 giờ 05 phút"' },
  { pattern: /\bHOT\b|SỐC|Nhanh tay/, use: 'bỏ chữ giục mua' },
];

/** Điền mẫu `SHOP_COPY[key]`. Khoá lạ hoặc thiếu biến thì ném lỗi: lỗi của người viết mã, bắt ở test chứ không để "{t}" tới tay khách. */
export function fillCopy(key: string, vars: Record<string, string | number> = {}): string {
  if (!Object.prototype.hasOwnProperty.call(SHOP_COPY, key)) throw new Error(`shop-copy: không có khoá "${key}"`);
  return SHOP_COPY[key]!.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`shop-copy: khoá "${key}" thiếu biến {${name}}`);
    return String(v);
  });
}
