/**
 * Chữ của dòng meta thẻ ("★ 4,8 · Đã bán 1,2k+"), nằm trên đường nạp của gói đầu Mini App (`formatSold` ở mọi thẻ). Tách khỏi
 * `shop-copy.ts` để `card-meta` không kéo cả bảng chữ vào gói đầu; `SHOP_COPY` lấy lại hai mẫu này nên chỉ có một nơi định nghĩa.
 */
export const META_COPY = { sold: 'Đã bán {n}', rating: '★ {avg}' } as const;
