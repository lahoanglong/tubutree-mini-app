/** Chữ của gian hàng CTV và sheet chia sẻ. Tách khỏi `vi.ts` vì chỉ màn tải lười dùng: `vi.ts` nằm trong gói đầu của Mini App. Quy tắc chữ như `vi.ts`. */
import { BRAND_BADGE, STOREFRONT_NOT_FOUND, STOREFRONT_PUBLIC_TITLE } from '@tubutree/app-core/client-copy';

export const viStorefront = {
  publicTitle: STOREFRONT_PUBLIC_TITLE,
  notFound: STOREFRONT_NOT_FOUND,
  shareStore: 'Chia sẻ gian hàng',
  viewProducts: 'Xem sản phẩm',
  moreAtTubu: 'Xem thêm ở Tubu Tree',
  emptyHeading: 'Gian hàng chưa có sản phẩm nào để xem',
  emptyBody: 'Chủ gian hàng đang bổ sung sản phẩm. Bạn xem thử các sản phẩm đang bán trên Tubu Tree nhé.',
  emptyOwnerBody: 'Gian hàng của bạn chưa có sản phẩm nào khách xem được. Thêm sản phẩm để khách có gì mà mua.',
  badgePartner: 'Đối tác của Tubu Tree',
  badgeBrand: BRAND_BADGE,
  badgeSelectedCtv: 'CTV tuyển chọn',
  title: 'Gian hàng của tôi',
  addProduct: 'Thêm sản phẩm',
  inStore: 'Đang xem gian hàng',
  backToTubu: '⤺ Về Tubu Tree',
  shareTitle: 'Chia sẻ gian hàng',
  shareZalo: 'Chia sẻ qua Zalo',
  copyLink: 'Sao chép link',
  captionHint: 'Lời đăng gợi ý (chạm để sao chép)',
  copied: 'Đã sao chép',
} as const;

export const viShareFallback = {
  failedCopied: 'Chưa chia sẻ được qua Zalo — đã sao chép liên kết, bạn dán vào tin nhắn để gửi nhé.',
  failedManual: 'Chưa chia sẻ được qua Zalo và cũng không sao chép được — hãy chọn rồi chép liên kết thủ công.',
} as const;
