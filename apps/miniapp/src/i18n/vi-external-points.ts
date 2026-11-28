/** Chữ của trang Tích điểm đơn sàn và dòng điểm sàn ở trang sản phẩm. Tách khỏi `vi.ts` vì chỉ màn tải lười dùng: `vi.ts` nằm trong gói đầu của Mini App. Quy tắc chữ như `vi.ts`. */
import { MARKETPLACE_CLAIM_COPY } from '@tubutree/app-core/marketplace-claim-copy';

export const viExternalPoints = {
  // Chữ gửi mã, kết quả, lịch sử và câu từ chối dùng chung với web `/quet-ma` (W44).
  ...MARKETPLACE_CLAIM_COPY,
  title: 'Tích điểm đơn sàn',
  closedTitle: 'Chưa mở',
  closedBody: 'Tính năng tích điểm đơn sàn chưa mở. Bạn quay lại sau nhé.',
  soonTitle: 'Tích điểm đơn sàn sắp mở',
  soonBody: (days?: number | null) =>
    `Bạn cứ giữ lại thẻ trong hộp. Khi tính năng mở, hãy quét lại thẻ${days ? ` trong vòng ${days} ngày kể từ ngày đặt đơn` : ''} để tích điểm cho đơn này.`,
  soonShop: 'Xem sản phẩm',
  soonHome: 'Về trang chủ',
  greeting: (channel: string | null) => `Cảm ơn bạn đã mua Tubu Tree${channel ? ` trên ${channel}` : ''}`,
  scanMain: 'Quét mã trên nhãn',
  phoneWhy: 'Tubu dùng số điện thoại Zalo để ghép đơn và báo khi cộng điểm.',
  phoneDeclined: 'Chưa có SĐT nên chưa ghép được đơn. Mã vẫn được giữ.',
  giftNewOnly: 'Quà thẻ dành cho tài khoản chưa có đơn. Đơn này vẫn tích điểm được.',
  chatSupport: 'Nhắn Tubu Tree',
  chatSupportMessage: (maskedCode: string) => `Mình cần hỗ trợ tích điểm cho mã ${maskedCode}`,
  oaInviteTitle: 'Theo dõi Tubu Tree trên Zalo',
  oaInviteBody: 'Nhận mẹo dùng sản phẩm và ưu đãi thành viên từ Tubu Tree.',
  oaFollow: 'Theo dõi',
  oaLater: 'Để sau',
  oaFollowed: 'Đã theo dõi Tubu Tree trên Zalo.',
  oaDeclined: 'Chưa theo dõi được lúc này. Bạn có thể thử lại trong Cài đặt.',
  boostTitleDouble: 'Mua trong Mini App: tích gấp đôi',
  boostTitleMore: 'Mua trong Mini App tích nhiều hơn',
  boostSub: (marketplacePct: string, appPct: string) =>
    `Đơn sàn ${marketplacePct} · Mua trong Mini App từ ${appPct}, nhân theo hạng`,
  boostPlain: (appPct: string) => `Tích ${appPct} tiền hàng thành Điểm Xanh khi mua trong Mini App`,
  scanFailed: 'Chưa đọc được mã. Bạn nhập mã bằng tay giúp Tubu nhé.',
  sharePhone: 'Chia sẻ số điện thoại',
} as const;
