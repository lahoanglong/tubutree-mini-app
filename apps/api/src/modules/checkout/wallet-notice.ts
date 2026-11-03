/**
 * Câu Ví Tubu khách đọc khi đặt đơn. Tách khỏi `checkout.service.ts` để bộ quét chữ cấm (`terminology.spec.ts`, đuôi `*-notice.ts`) tự quét
 * và để app-core ghim câu của client (`walletNegativeCheckoutReason`) bằng đúng câu này.
 */

/** Ví không đủ trả đơn. */
export const WALLET_SHORT_MESSAGE = 'Số dư Ví Tubu không đủ.';

/** Ví đang âm (hoa hồng đơn trả hàng đã thu hồi); `owed` là số âm đã định dạng tiền, vd "50.000đ". */
export const walletNegativeMessage = (owed: string) =>
  `Số dư Ví Tubu đang âm ${owed} do thu hồi hoa hồng đơn trả hàng. Hãy chọn cách thanh toán khác, hoa hồng mới sẽ bù vào số âm.`;
