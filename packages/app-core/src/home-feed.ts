import type { HomeMeDTO, HomePublicDTO } from './api/home';
import { HOME_PURCHASED_LIMIT } from './api/home';
import type { Query } from './http';

/**
 * Request gộp của Trang chủ (C-037), dùng chung Mini App và web. Khi Trang chủ đang mở ("armed"), lần gọi ĐẦU TIÊN của mỗi khối
 * (danh mục, Giờ vàng, Mua lại...) được trả từ hai request `GET /home` + `GET /home/me` thay vì một request riêng; component và
 * query key giữ nguyên. Mọi đường lỗi lùi về request lẻ (API cũ 404, lỗi mạng, khối null phía server). Mỗi khối chỉ dùng MỘT
 * lần mỗi phiên mở Trang chủ: refetch định kỳ và invalidate sau đó luôn đi request lẻ để lấy dữ liệu mới.
 */
export interface HomeFeedDeps {
  fetchPublic: () => Promise<HomePublicDTO | null | undefined>;
  fetchMe: () => Promise<HomeMeDTO | null | undefined>;
  /** Định danh phiên lúc gọi (id tài khoản, ổn định khi token làm mới): khối cá nhân chỉ trao cho đúng phiên đã xin nó. */
  identity: () => string | null | undefined;
}

type MeKey = Exclude<keyof HomeMeDTO, 'purchasedLimit'>;

interface Feed<T> {
  promise: Promise<T | null>;
  taken: Set<string>;
  identity?: string | null;
}

export function createHomeFeed(deps: HomeFeedDeps) {
  let session: { pub: Feed<HomePublicDTO> | null; me: Feed<HomeMeDTO> | null } | null = null;

  function start<T extends object>(call: () => Promise<T | null | undefined>, personal: boolean): Feed<T> {
    const feed: Feed<T> = { promise: Promise.resolve(null), taken: new Set() };
    // Chụp định danh lúc GỬI: đổi tài khoản khi request còn chạy thì khối về sau không còn khớp người xin.
    const sentAs = personal ? deps.identity() : undefined;
    const request = call().then(
      (data) => {
        if (personal) feed.identity = sentAs;
        return data && typeof data === 'object' ? data : null;
      },
      () => null,
    );
    feed.promise = request;
    return feed;
  }

  async function take<T extends object, K extends keyof T>(feed: Feed<T> | null, key: K, personal: boolean): Promise<NonNullable<T[K]> | null> {
    if (!feed) return null;
    const data = await feed.promise;
    // Đăng xuất/đăng nhập tài khoản khác khi Trang chủ còn mở: không trao dữ liệu cá nhân của người trước.
    if (personal && feed.identity !== deps.identity()) return null;
    const value = data?.[key];
    if (value == null || feed.taken.has(String(key))) return null;
    feed.taken.add(String(key));
    return value as NonNullable<T[K]>;
  }

  return {
    /** Gọi khi Trang chủ mount (trước khi các query con chạy). Idempotent. */
    arm(): void {
      session ??= { pub: null, me: null };
    },
    isArmed: (): boolean => session !== null,
    disarm(): void {
      session = null;
    },
    /** Kéo để làm mới: bỏ khối đã dùng, request gộp kế tiếp sẽ tải lại. */
    reset(): void {
      if (session) session = { pub: null, me: null };
    },
    takePublic<K extends keyof HomePublicDTO>(key: K) {
      if (!session) return Promise.resolve(null);
      return take((session.pub ??= start(deps.fetchPublic, false)), key, false);
    },
    takeMe<K extends MeKey>(key: K) {
      if (!session) return Promise.resolve(null);
      return take((session.me ??= start(deps.fetchMe, true)), key, true);
    },
  };
}

export type HomeFeed = ReturnType<typeof createHomeFeed>;

/** Kệ Mua lại chỉ dùng khối gộp khi hỏi đúng trang đầu với limit mà /home/me đã lấy. */
export const isHomePurchasedRequest = (params: { cursor?: unknown; limit?: unknown; variationId?: unknown }): boolean =>
  !params.cursor && !params.variationId && params.limit === HOME_PURCHASED_LIMIT;

/**
 * Với web: request GET (đường dẫn + query) nào của Trang chủ đã có sẵn trong request gộp. Trả về cách lấy khối đó (đã đổi về đúng dạng
 * phản hồi của endpoint lẻ), hoặc null nếu không phải request của Trang chủ.
 */
export function takeHomeRequest(feed: HomeFeed, path: string, query: Query | undefined): Promise<unknown | null> | null {
  const q = query ?? {};
  const keys = Object.keys(q).filter((k) => q[k] != null);
  const only = (...expect: string[]) => keys.length === expect.length && expect.every((k) => keys.includes(k));
  switch (path) {
    case '/config/public':
      return keys.length === 0 ? feed.takePublic('publicConfig') : null;
    case '/flash-sales/active':
      return keys.length === 0 ? feed.takePublic('flashActive') : null;
    case '/campaigns':
      // Khối gộp chỉ là banner đầu Trang chủ, chưa lọc đối tượng: OFFERS_TOP hay request có `audience` phải đi request lẻ.
      return only('placement') && q.placement === 'HOME_TOP' ? feed.takePublic('campaigns') : null;
    case '/flash-sales/upcoming':
      return keys.length === 0 ? feed.takeMe('flashUpcoming') : null;
    case '/products/for-you':
      // `seed` (ngày VN) là tham số xoay thứ tự của khách khi gọi lẻ; khối gộp đã dựng sẵn nên lần đầu vẫn dùng nó, giống Mini App.
      return keys.length === 0 || only('seed') ? feed.takeMe('forYou') : null;
    case '/orders/active-count':
      return keys.length === 0 ? feed.takeMe('activeOrderCount') : null;
    case '/me/new-customer-offer':
      return keys.length === 0 ? feed.takeMe('newCustomerOffer') : null;
    case '/me/purchased-items':
      return only('limit') && isHomePurchasedRequest(q) ? feed.takeMe('purchasedItems') : null;
    case '/waste/me/open-count':
      return keys.length === 0
        ? feed.takeMe('wasteOpenRequestCount').then((n) => (typeof n === 'number' ? { count: n } : null))
        : null;
    default:
      return null;
  }
}
