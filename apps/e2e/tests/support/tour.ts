import { readFileSync } from 'fs';
import path from 'path';
import type { UserRole } from '@tubutree/shared-types';
import type { MockApi } from './mock-api';
import { SETUPS } from './tour-setups';
import { ORDER_DELIVERED, TOUR_PRODUCT_SLUG } from './tour-world';

export interface TourEntry {
  /** Route Mini App trong route-map.json — cũng là khoá cặp ảnh. */
  key: string;
  name: string;
  miniapp: string;
  web: string;
  role: UserRole;
  setup?: (api: MockApi) => void;
}

interface RouteItem {
  miniapp: string;
  web?: string;
  skip?: string;
}

export function routeMapItems(): RouteItem[] {
  const file = path.resolve(__dirname, '../../../../packages/app-core/src/route-map.json');
  const map = JSON.parse(readFileSync(file, 'utf8')) as { routes: { items: RouteItem[] }[] };
  return map.routes.flatMap((l) => l.items).filter((i) => !i.skip);
}

const BANK_CODE = 'TUBU20261019003';

/** Tên màn tiếng Việt, đường dẫn cụ thể cho từng bên và vai trò khách. Thiếu mục nào là spec tham quan tự đỏ. */
export const TOUR: Record<string, Omit<TourEntry, 'key'>> = {
  '/': { name: 'Trang chủ', miniapp: '/', web: '/', role: 'CUSTOMER' },
  '/browse': { name: 'Danh mục và tìm kiếm', miniapp: '/browse', web: '/san-pham', role: 'CUSTOMER' },
  '/product/:slug': { name: 'Chi tiết sản phẩm', miniapp: `/product/${TOUR_PRODUCT_SLUG}`, web: `/san-pham/${TOUR_PRODUCT_SLUG}`, role: 'CUSTOMER' },
  '/wishlist': { name: 'Yêu thích', miniapp: '/wishlist', web: '/tai-khoan/yeu-thich', role: 'CUSTOMER' },
  '/group-buy': { name: 'Mua chung', miniapp: '/group-buy', web: '/mua-chung', role: 'CUSTOMER' },
  '/group-buy/:id': { name: 'Chi tiết nhóm mua chung', miniapp: '/group-buy/g1', web: '/mua-chung/g1', role: 'CUSTOMER' },
  '/brand/:slug': { name: 'Thương hiệu', miniapp: '/brand/visante', web: '/brand/visante', role: 'CUSTOMER' },
  '/brand-story': { name: 'Câu chuyện thương hiệu', miniapp: '/brand-story', web: '/cau-chuyen', role: 'CUSTOMER' },
  '/cart': { name: 'Giỏ hàng', miniapp: '/cart', web: '/gio-hang', role: 'CUSTOMER' },
  '/checkout': { name: 'Thanh toán', miniapp: '/checkout', web: '/thanh-toan', role: 'CUSTOMER' },
  '/bank-payment/:code': { name: 'Chuyển khoản', miniapp: `/bank-payment/${BANK_CODE}`, web: `/thanh-toan/chuyen-khoan/${BANK_CODE}`, role: 'CUSTOMER' },
  '/orders': { name: 'Đơn hàng', miniapp: '/orders', web: '/tai-khoan/don-hang', role: 'CUSTOMER' },
  '/subscriptions': { name: 'Đơn định kỳ', miniapp: '/subscriptions', web: '/tai-khoan/don-hang?tab=subscriptions', role: 'CUSTOMER' },
  '/order/:code': { name: 'Chi tiết đơn', miniapp: `/order/${ORDER_DELIVERED}`, web: `/tai-khoan/don-hang/${ORDER_DELIVERED}`, role: 'CUSTOMER' },
  '/addresses': { name: 'Sổ địa chỉ', miniapp: '/addresses', web: '/tai-khoan/dia-chi', role: 'CUSTOMER' },
  '/about': { name: 'Giới thiệu', miniapp: '/about', web: '/gioi-thieu', role: 'CUSTOMER' },
  '/profile': { name: 'Tài khoản', miniapp: '/profile', web: '/tai-khoan', role: 'CUSTOMER' },
  '/edit-profile': { name: 'Sửa hồ sơ', miniapp: '/edit-profile', web: '/tai-khoan/ho-so', role: 'CUSTOMER' },
  '/settings': { name: 'Cài đặt', miniapp: '/settings', web: '/tai-khoan/cai-dat', role: 'CUSTOMER' },
  '/notifications': { name: 'Thông báo', miniapp: '/notifications', web: '/tai-khoan/thong-bao', role: 'CUSTOMER' },
  '/loyalty': { name: 'Điểm Xanh và hạng', miniapp: '/loyalty', web: '/tai-khoan/diem-xanh', role: 'CUSTOMER' },
  '/wallet': { name: 'Ví Tubu', miniapp: '/wallet', web: '/tai-khoan/vi-tubu', role: 'CUSTOMER' },
  '/rewards': { name: 'Kho quà', miniapp: '/rewards', web: '/kho-qua', role: 'CUSTOMER' },
  '/rewards/mine': { name: 'Quà của tôi', miniapp: '/rewards/mine', web: '/kho-qua/cua-toi', role: 'CUSTOMER' },
  '/cashback': { name: 'Hoàn tiền', miniapp: '/cashback', web: '/hoan-tien', role: 'CUSTOMER' },
  '/game': { name: 'Vườn Xanh', miniapp: '/game', web: '/vuon-xanh', role: 'CUSTOMER' },
  '/ai-advisor': { name: 'Trợ lý AI', miniapp: '/ai-advisor', web: '/tu-van', role: 'CUSTOMER' },
  '/feed': { name: 'Cộng đồng', miniapp: '/feed', web: '/cong-dong', role: 'CUSTOMER' },
  '/feed/leaderboard': { name: 'Bảng xếp hạng', miniapp: '/feed/leaderboard', web: '/cong-dong/xep-hang', role: 'CUSTOMER' },
  '/feed/events': { name: 'Sự kiện cộng đồng', miniapp: '/feed/events', web: '/cong-dong/su-kien', role: 'CUSTOMER' },
  '/feed/:id': { name: 'Bài viết', miniapp: '/feed/p1', web: '/cong-dong/p1', role: 'CUSTOMER' },
  '/academy': { name: 'Học viện', miniapp: '/academy', web: '/hoc-vien', role: 'CUSTOMER' },
  '/academy/:courseId': { name: 'Khoá học', miniapp: '/academy/c1', web: '/hoc-vien/c1', role: 'CUSTOMER' },
  '/s/:slug': { name: 'Gian hàng CTV (công khai)', miniapp: '/s/ctv-pilot', web: '/s/ctv-pilot', role: 'CUSTOMER' },
  '/affiliate': { name: 'Cộng tác viên', miniapp: '/affiliate', web: '/ctv', role: 'AFFILIATE' },
  '/storefront': { name: 'Gian hàng của tôi', miniapp: '/storefront', web: '/ctv/gian-hang', role: 'AFFILIATE' },
  '/dealer': { name: 'Đại lý', miniapp: '/dealer', web: '/dai-ly', role: 'DEALER' },
  '/staff': { name: 'Ca làm nhân viên', miniapp: '/staff', web: '/nhan-vien', role: 'STAFF' },
  '/my-payroll': { name: 'Bảng lương', miniapp: '/my-payroll', web: '/nhan-vien/bang-luong', role: 'STAFF' },
  '/brand-owner': { name: 'Chủ thương hiệu', miniapp: '/brand-owner', web: '/chu-thuong-hieu', role: 'CUSTOMER' },
  '/admin': { name: 'Quản trị', miniapp: '/admin', web: '/admin', role: 'ADMIN' },
  '/admin/community': { name: 'Quản trị cộng đồng', miniapp: '/admin/community', web: '/admin?tab=community', role: 'ADMIN' },
  '/recycle': { name: 'Đổi rác lấy quà', miniapp: '/recycle', web: '/doi-rac', role: 'CUSTOMER' },
  '/recycle/rules': { name: 'Thể lệ đổi rác', miniapp: '/recycle/rules', web: '/doi-rac/quy-dinh', role: 'CUSTOMER' },
  '/recycle/new': { name: 'Tạo yêu cầu đổi rác', miniapp: '/recycle/new', web: '/doi-rac/tao', role: 'CUSTOMER' },
  '/recycle/points': { name: 'Điểm nhận rác', miniapp: '/recycle/points', web: '/doi-rac/diem-nhan', role: 'CUSTOMER' },
  '/recycle/r/:id': { name: 'Chi tiết yêu cầu đổi rác', miniapp: '/recycle/r/wr-1', web: '/doi-rac/yeu-cau/wr-1', role: 'CUSTOMER' },
  '/recycle/r/:id/edit': { name: 'Sửa yêu cầu đổi rác', miniapp: '/recycle/r/wr-1/edit', web: '/doi-rac/yeu-cau/wr-1/sua', role: 'CUSTOMER' },
  '/recycle/requests': { name: 'Yêu cầu đổi rác của tôi', miniapp: '/recycle/requests', web: '/doi-rac/yeu-cau', role: 'CUSTOMER' },
  '/recycle/done/:id': { name: 'Đổi rác hoàn tất', miniapp: '/recycle/done/wr-done-1', web: '/doi-rac/xong/wr-done-1', role: 'CUSTOMER' },
  '/recycle/desk': { name: 'Quầy nhận rác', miniapp: '/recycle/desk', web: '/doi-rac/quay', role: 'STAFF' },
};

export function tourEntries(): TourEntry[] {
  return routeMapItems().map((i) => {
    const e = TOUR[i.miniapp];
    if (!e) throw new Error(`visual-tour thiếu cấu hình cho route ${i.miniapp}`);
    return { key: i.miniapp, ...e, setup: SETUPS[i.miniapp] };
  });
}
