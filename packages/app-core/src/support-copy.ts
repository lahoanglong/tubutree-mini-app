/**
 * Chữ của màn Chat hỗ trợ khi chat tắt, lời chào + câu hỏi nhanh khi chat bật mà chưa có tin, và màn "Trợ lý AI đang tạm nghỉ".
 * Một nguồn cho Mini App và web khổ điện thoại.
 */
export const supportCopy = {
  closed: {
    title: 'Chat đang tạm đóng',
    lead: 'Cần hỗ trợ, bạn gọi hotline nhé.',
    /** Mô tả nhỏ dưới số: chạm vào số là sao chép. */
    tapToCopy: 'Chạm vào số để sao chép',
    call: (display: string) => `Gọi ${display}`,
    copied: 'Đã sao chép số hotline',
    copyFailed: 'Chưa sao chép được, bạn hãy chọn số và chép tay nhé.',
    oa: 'Nhắn OA',
    oaName: (name: string) => `Zalo OA: ${name}`,
    hours: (hours: string) => `Giờ trực: ${hours}`,
  },
  greeting: (hours: string | null) => (hours ? `Tubu Tree hỗ trợ ${hours}. Bạn cần hỏi gì ạ?` : 'Tubu Tree sẵn sàng hỗ trợ bạn. Bạn cần hỏi gì ạ?'),
  quickTitle: 'Hỏi nhanh',
  quick: [
    { label: 'Đơn của tôi đang ở đâu?', body: 'Đơn của tôi đang ở đâu?' },
    { label: 'Đổi trả hàng', body: 'Mình muốn hỏi về đổi trả hàng.' },
    { label: 'Cách dùng sản phẩm', body: 'Mình muốn hỏi cách dùng sản phẩm.' },
  ],
  orderQuick: (code: string) => ({ label: `Hỏi về đơn ${code}`, body: `Mình muốn hỏi về đơn ${code}.` }),
  advisorPaused: {
    title: 'Trợ lý AI đang tạm nghỉ',
    body: 'Bạn quay lại sau nhé. Cần hỏi gấp thì bạn liên hệ Tubu Tree nhé.',
    chat: 'Chat với Tubu',
    call: (display: string) => `Gọi ${display}`,
    home: 'Về Trang chủ',
  },
} as const;

export type QuickReply = { label: string; body: string };

/** Câu hỏi nhanh: ba câu cố định, có đơn đang giao thì thêm câu hỏi về đơn đó lên đầu. */
export function quickReplies(shippingOrderCode: string | null | undefined): QuickReply[] {
  const code = shippingOrderCode?.trim();
  return code ? [supportCopy.orderQuick(code), ...supportCopy.quick] : [...supportCopy.quick];
}
