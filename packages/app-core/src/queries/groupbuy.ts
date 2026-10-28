import type { HttpClient } from '../http';
import { getGroupBuy, listGroupBuys } from '../api/groupbuy';

/** Mỗi nhóm mang `joined`/`isOwner` theo người xem, nên khoá gắn với người xem: đăng nhập xong không dùng lại danh sách của khách. */
export const groupBuyListQuery = (http: HttpClient, viewer: string = 'guest') => ({
  queryKey: ['group-buy', 'list', viewer] as const,
  queryFn: () => listGroupBuys(http),
});
/** Chi tiết nhóm mở được khi chưa đăng nhập (link mời), nhưng `joined`/`isOwner`/`couponCode` theo người xem: khoá gắn với người xem như danh sách. */
export const groupBuyOneQuery = (http: HttpClient, id: string, viewer: string = 'guest') => ({
  queryKey: ['group-buy', 'one', id, viewer] as const,
  queryFn: () => getGroupBuy(http, id),
});
