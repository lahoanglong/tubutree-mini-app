import { BRAND_OWNER_TITLE } from '@tubutree/app-core/client-copy';
import { viStorefront } from '../i18n/vi-storefront';
import { viCommunity } from '../i18n/vi-community';
import { safePortalParams } from './web-portal-query';

/** Cổng web nhận các màn quản trị, đối tác và nhân sự đã rời khỏi gói Mini App (W177). */
export const WEB_PORTAL_BASE_URL = 'https://tubutree.com';

export interface WebPortalScreen {
  title: string;
  /** Ai dùng màn này: câu giải thích nói rõ nhóm đó thao tác đầy đủ trên website. */
  audience: string;
  /** Đường dẫn trên website, khớp dòng `miniapp → web` của `packages/app-core/src/route-map.json`. */
  webPath: string;
  /**
   * Trang web này có thanh toán (đơn sỉ đại lý trả bằng chuyển khoản trên web): Mini App không mở nó trong webview Zalo, chỉ cho chép link
   * sang trình duyệt, để hồ sơ duyệt Zalo không có lối dẫn tới trang trả tiền ngoài Mini App (PO A3). `zmp-bridge.ts` cũng chặn đường dẫn
   * này (`BROWSER_ONLY_WEB_PATHS`), `scripts/zalo-review/check-submission.mjs` kiểm cả hai chỗ.
   */
  browserOnly?: true;
}

/**
 * Khoá là đường dẫn Mini App (đúng như `<Route path>` ở `components/app.tsx`). `web-portal-screens.spec.ts`
 * đối chiếu `webPath` với route-map.json nên đổi route web ở đó thì spec đỏ, không lệch lặng lẽ.
 */
export const WEB_PORTAL_SCREENS = {
  '/admin': { title: 'Quản trị Tubu Tree', audience: 'Quản trị viên', webPath: '/admin' },
  '/admin/community': { title: viCommunity.moderation, audience: 'Quản trị viên', webPath: '/admin?tab=community' },
  '/storefront': { title: viStorefront.title, audience: 'Cộng tác viên', webPath: '/ctv/gian-hang' },
  '/dealer': { title: 'Kênh đại lý', audience: 'Đại lý và người muốn đăng ký đại lý', webPath: '/dai-ly', browserOnly: true },
  '/recycle/desk': { title: 'Nhận hàng tại điểm', audience: 'Nhân sự điểm nhận', webPath: '/doi-rac/quay' },
  '/staff': { title: 'Ca làm của tôi', audience: 'Nhân sự', webPath: '/nhan-vien' },
  '/brand-owner': { title: BRAND_OWNER_TITLE, audience: 'Chủ thương hiệu', webPath: '/chu-thuong-hieu' },
  '/my-payroll': { title: 'Lương của tôi', audience: 'Nhân sự', webPath: '/nhan-vien/bang-luong' },
} as const satisfies Record<string, WebPortalScreen>;

export type WebPortalScreenKey = keyof typeof WEB_PORTAL_SCREENS;

/**
 * Khách từ Mini App sang web là đã chọn bản web: `?stay=web` báo web không tự mở lại Mini App trong 24 giờ (cờ
 * `app.mobile_miniapp_redirect_enabled`, `apps/web/src/lib/mini-app-auto-open.ts`), kể cả khi link được chép sang trình duyệt điện thoại.
 */
export const STAY_WEB_QUERY = { key: 'stay', value: 'web' } as const;

/**
 * Link web của một màn. `search` là `location.search` của màn Mini App; chỉ phần query vô hại đi theo (xem `safePortalParams`).
 * Query cố định của trang đích (`/admin?tab=community`) giữ nguyên và đứng trước, `stay=web` luôn đứng cuối.
 */
export function webPortalUrl(screen: WebPortalScreenKey, search = ''): string {
  const [path = '', fixedQuery = ''] = WEB_PORTAL_SCREENS[screen].webPath.split('?');
  const params = new URLSearchParams(fixedQuery);
  for (const [key, value] of safePortalParams(search, params)) if (key !== STAY_WEB_QUERY.key) params.append(key, value);
  params.set(STAY_WEB_QUERY.key, STAY_WEB_QUERY.value);
  const query = params.toString();
  return `${WEB_PORTAL_BASE_URL}${path}${query ? `?${query}` : ''}`;
}
