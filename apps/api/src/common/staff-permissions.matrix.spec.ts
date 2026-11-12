import 'reflect-metadata';
import { Controller, ForbiddenException, Get, Post, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AppModule } from '../app.module';
import { collectControllers, type Ctor } from './route-graph';
import { ROLES_KEY, Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';
import { STAFF_PERMISSIONS, STAFF_PERMISSIONS_KEY, type StaffPermission } from './staff-permissions';

jest.mock('../config/env.validation', () => ({ validateEnv: (config: Record<string, unknown>) => config }));

/**
 * Bảng quyền nhân viên (ADMINOPS-10, D1-05): MỌI route quản trị (@Roles chỉ ADMIN, route mở cho STAFF, có @AllowStaff, hoặc có
 * đoạn `/admin` ở bất kỳ đâu trong đường dẫn) đọc từ metadata decorator thật của đồ thị module, so với bảng duyệt dưới đây. Route mới chưa khai vào bảng, hay một @AllowStaff
 * gắn thêm/bớt, làm spec đỏ thay vì lặng lẽ mở hoặc đóng quyền.
 *
 * Giá trị: `ADMIN_ONLY` = chỉ ADMIN; `[nhóm…]` = ADMIN và nhân viên có một trong các nhóm đó; `STAFF` = mọi nhân viên kể cả chưa
 * có nhóm (route @Roles có STAFF).
 */
type Access = 'STAFF' | readonly StaffPermission[];
const ADMIN_ONLY: readonly StaffPermission[] = [];
const STAFF = 'STAFF' as const;
const CSKH = 'CSKH' as const;
const KHO = 'KHO' as const;
const MARKETING = 'MARKETING' as const;
const KE_TOAN = 'KE_TOAN' as const;

const EXPECTED: Record<string, Access> = {
  'GET /academy/courses': STAFF,
  'GET /academy/courses/:id': STAFF,
  'POST /academy/lessons/:id/complete': STAFF,
  'GET /admin/academy/courses': [MARKETING],
  'POST /admin/academy/courses': [MARKETING],
  'DELETE /admin/academy/courses/:id': [MARKETING],
  'PATCH /admin/academy/courses/:id': [MARKETING],
  'POST /admin/academy/courses/:id/lessons': [MARKETING],
  'DELETE /admin/academy/lessons/:id': [MARKETING],
  'PATCH /admin/academy/lessons/:id': [MARKETING],
  'GET /admin/account-deletion-requests': ADMIN_ONLY,
  'POST /admin/account-deletion-requests/:id/process': ADMIN_ONLY,
  'GET /admin/analytics/retention-daily': ADMIN_ONLY,
  'GET /admin/attendance/live': ADMIN_ONLY,
  'POST /admin/attendance/manual-checkout': ADMIN_ONLY,
  'POST /admin/attendance/session': ADMIN_ONLY,
  'POST /admin/attendance/session/:id/edit': ADMIN_ONLY,
  'GET /admin/brands': ADMIN_ONLY,
  'POST /admin/brands': ADMIN_ONLY,
  'PATCH /admin/brands/:id': ADMIN_ONLY,
  'POST /admin/brands/:id/link-by-name': ADMIN_ONLY,
  'DELETE /admin/brands/:id/products': ADMIN_ONLY,
  'GET /admin/brands/:id/products': ADMIN_ONLY,
  'POST /admin/brands/:id/products': ADMIN_ONLY,
  'GET /admin/brands/:id/promotions': ADMIN_ONLY,
  'POST /admin/brands/:id/promotions': ADMIN_ONLY,
  'PATCH /admin/brands/:id/verify': ADMIN_ONLY,
  'GET /admin/bundles': [MARKETING],
  'POST /admin/bundles': [MARKETING],
  'GET /admin/bundles/:id': [MARKETING],
  'PATCH /admin/bundles/:id': [MARKETING],
  'DELETE /admin/bundles/:id': [MARKETING],
  'GET /admin/campaigns': [MARKETING],
  'POST /admin/campaigns': [MARKETING],
  'POST /admin/campaigns/check': [MARKETING],
  'GET /admin/campaigns/:id': [MARKETING],
  'DELETE /admin/campaigns/:id': [MARKETING],
  'PATCH /admin/campaigns/:id': [MARKETING],
  'PUT /admin/campaigns/:id/coupons': [MARKETING],
  'PUT /admin/campaigns/:id/products': [MARKETING],
  'GET /admin/cashback/transactions': [KE_TOAN],
  'POST /admin/cashback/transactions/:id/review': [KE_TOAN],
  'GET /admin/commission-rates': ADMIN_ONLY,
  'POST /admin/commission-rates/fill-missing': ADMIN_ONLY,
  'POST /admin/commission-rates/import/apply': ADMIN_ONLY,
  'POST /admin/commission-rates/import/preview': ADMIN_ONLY,
  'PUT /admin/commission-rates/products/:id': ADMIN_ONLY,
  'PUT /admin/commission-rates/variations/:id': ADMIN_ONLY,
  'GET /admin/config': ADMIN_ONLY,
  'PUT /admin/config': ADMIN_ONLY,
  'GET /admin/content-kits/:productId': [MARKETING],
  'PUT /admin/content-kits/:productId': [MARKETING],
  'GET /admin/coupon-batches': [MARKETING],
  'POST /admin/coupon-batches': [MARKETING],
  'PATCH /admin/coupon-batches/:batch': [MARKETING],
  'GET /admin/coupon-batches/:batch/codes': [MARKETING],
  'GET /admin/coupon-batches/claim-url-base': [MARKETING],
  'GET /admin/coupons': [MARKETING],
  'POST /admin/coupons': [MARKETING],
  'PATCH /admin/coupons/:id': [MARKETING],
  'GET /admin/customer-refunds': [KE_TOAN],
  'POST /admin/customer-refunds/:id/claim': [KE_TOAN],
  'POST /admin/customer-refunds/:id/dismiss': [KE_TOAN],
  'POST /admin/customer-refunds/:id/mark-paid': [KE_TOAN],
  'POST /admin/customer-refunds/:id/release': [KE_TOAN],
  'POST /admin/customer-refunds/:id/verify': [KE_TOAN],
  'GET /admin/dashboard/stats': ADMIN_ONLY,
  'GET /admin/dashboard/today': ADMIN_ONLY,
  'GET /admin/dealer-applications': ADMIN_ONLY,
  'GET /admin/dealer-applications/:id/images/:field': ADMIN_ONLY,
  'POST /admin/dealer-applications/:id/review': ADMIN_ONLY,
  'POST /admin/dealer-orders/:id/confirm-payment': [KE_TOAN],
  'GET /admin/dealer-prices/history': ADMIN_ONLY,
  'POST /admin/dealer-prices/import': ADMIN_ONLY,
  'POST /admin/dealer-prices/import/preview': ADMIN_ONLY,
  'GET /admin/dealer-credit-reports': [KE_TOAN],
  'POST /admin/dealer-credit-reports/:id/dismiss': [KE_TOAN],
  'GET /admin/dealer-reward-claims': [KE_TOAN],
  'POST /admin/dealer-reward-claims/:id/approve': ADMIN_ONLY,
  'POST /admin/dealer-reward-claims/:id/mark-paid': [KE_TOAN],
  'POST /admin/dealer-reward-claims/:id/reject': ADMIN_ONLY,
  'POST /admin/dealer-reward-claims/:id/reopen': ADMIN_ONLY,
  'GET /admin/dealer-rewards': ADMIN_ONLY,
  'POST /admin/dealer-rewards': ADMIN_ONLY,
  'DELETE /admin/dealer-rewards/:id': ADMIN_ONLY,
  'PATCH /admin/dealer-rewards/:id': ADMIN_ONLY,
  'GET /admin/dealer-tiers': ADMIN_ONLY,
  'POST /admin/dealer-tiers': ADMIN_ONLY,
  'PUT /admin/dealer-tiers/:id': ADMIN_ONLY,
  'GET /admin/dealer-tiers/history': ADMIN_ONLY,
  'GET /admin/dealer-tiers/manage': ADMIN_ONLY,
  'GET /admin/dealers/:userId/credit-ledger': [KE_TOAN],
  'GET /admin/dealers/accounts': [KE_TOAN],
  'POST /admin/dealers/:userId/credit-payment': [KE_TOAN],
  'GET /admin/engagement/missions': ADMIN_ONLY,
  'POST /admin/engagement/missions': ADMIN_ONLY,
  'PATCH /admin/engagement/missions/:id': ADMIN_ONLY,
  'GET /admin/engagement/seasons': ADMIN_ONLY,
  'POST /admin/engagement/seasons': ADMIN_ONLY,
  'PATCH /admin/engagement/seasons/:id': ADMIN_ONLY,
  'DELETE /admin/engagement/seasons/:id': ADMIN_ONLY,
  'GET /admin/engagement/quiz': ADMIN_ONLY,
  'POST /admin/engagement/quiz': ADMIN_ONLY,
  'PATCH /admin/engagement/quiz/:id': ADMIN_ONLY,
  'GET /admin/external-claims': [CSKH, KE_TOAN],
  'GET /admin/external-claims/attempts': [CSKH, KE_TOAN],
  'POST /admin/external-claims/attempts/:id/attach': [CSKH],
  'POST /admin/external-claims/attempts/:id/reject': [CSKH],
  'GET /admin/external-claims/:id': [CSKH, KE_TOAN],
  'POST /admin/external-claims/:id/approve': [CSKH],
  'POST /admin/external-claims/:id/void': [CSKH],
  'POST /admin/external-claims/:id/void-and-reopen': [CSKH],
  'POST /admin/external-claims/:id/keep-points': ADMIN_ONLY,
  'POST /admin/external-claims/:id/reverse': ADMIN_ONLY,
  'GET /admin/external-orders': [CSKH],
  'GET /admin/external-orders/:id': [CSKH],
  'GET /admin/external-orders/sources': [CSKH],
  'GET /admin/faqs': [MARKETING],
  'POST /admin/faqs': [MARKETING],
  'DELETE /admin/faqs/:id': [MARKETING],
  'PATCH /admin/faqs/:id': [MARKETING],
  'GET /admin/flash-sales': [MARKETING],
  'GET /admin/flash-sales/:id': [MARKETING],
  'POST /admin/flash-sales': [MARKETING],
  'POST /admin/flash-sales/generate-slots': [MARKETING],
  'DELETE /admin/flash-sales/:id': [MARKETING],
  'PATCH /admin/flash-sales/:id': [MARKETING],
  'PATCH /admin/flash-sales/items/:itemId': [MARKETING],
  'POST /admin/flash-sales/:id/items': [MARKETING],
  'DELETE /admin/flash-sales/items/:itemId': [MARKETING],
  'POST /admin/gomdon/alerts/:alertId/resolve': [KHO],
  'POST /admin/gomdon/check-connection': ADMIN_ONLY,
  'GET /admin/gomdon/status': ADMIN_ONLY,
  'GET /admin/loyalty/pos-credits': ADMIN_ONLY,
  'POST /admin/merchant-fulfilment/links/:id/confirm-consignment': ADMIN_ONLY,
  'GET /admin/merchant-fulfilment/overview': [KE_TOAN],
  'GET /admin/merchant-fulfilment/payouts': [KE_TOAN],
  'POST /admin/merchant-fulfilment/payouts': [KE_TOAN],
  'POST /admin/merchant-fulfilment/payouts/:id/cancel': [KE_TOAN],
  'POST /admin/merchant-fulfilment/payouts/:id/paid': [KE_TOAN],
  'GET /admin/merchant-fulfilment/statements/:storefrontId': [KE_TOAN],
  'PATCH /admin/merchant-fulfilment/stores/:storefrontId/terms': ADMIN_ONLY,
  'POST /admin/merchant-products/:id/review': ADMIN_ONLY,
  'POST /admin/merchant-products/:id/unlink': ADMIN_ONLY,
  'GET /admin/merchant-products/linked': ADMIN_ONLY,
  'GET /admin/merchant-products/pending': ADMIN_ONLY,
  'GET /admin/merchant-products/:id/images/:source/:slot': ADMIN_ONLY,
  'GET /admin/notification-templates': [MARKETING],
  'PATCH /admin/notification-templates/:code': [MARKETING],
  'GET /admin/ops/access': STAFF,
  'POST /admin/ops/alert-email/test': ADMIN_ONLY,
  'GET /admin/ops/health': ADMIN_ONLY,
  'GET /admin/ops/inbox': [CSKH, KHO, MARKETING, KE_TOAN],
  'POST /admin/ops/webhook-events/:source/:id/dismiss': ADMIN_ONLY,
  'POST /admin/ops/webhook-events/:source/:id/retry': ADMIN_ONLY,
  'GET /admin/orders': [CSKH, KHO, KE_TOAN],
  'GET /admin/orders/status-counts': [CSKH, KHO, KE_TOAN],
  'POST /admin/orders/:id/confirm-payment': [KE_TOAN],
  'POST /admin/orders/:id/gomdon/cancel-waybill': [KHO],
  'POST /admin/orders/:id/gomdon/mark-handled': [KHO],
  'POST /admin/orders/:id/gomdon/retry': [KHO],
  'POST /admin/orders/:id/issue-invoice': [KE_TOAN],
  'POST /admin/orders/:id/pancake-attention/resolve': [KHO],
  'POST /admin/orders/:id/payment-unlinked/resolve': ADMIN_ONLY,
  'GET /admin/orders/:id/referral': ADMIN_ONLY,
  'POST /admin/orders/:id/resync-delivered-effects': ADMIN_ONLY,
  'PUT /admin/orders/:id/status': [CSKH, KHO],
  'GET /admin/orders/:id/status-history': [CSKH, KHO, KE_TOAN],
  'GET /admin/orders/export': [KE_TOAN],
  'POST /admin/pancake/orders/:id/push': [KHO],
  'GET /admin/pancake/categories': ADMIN_ONLY,
  'POST /admin/pancake/sync': ADMIN_ONLY,
  'GET /admin/payouts': [KE_TOAN],
  'POST /admin/payouts/:id/approve': ADMIN_ONLY,
  'POST /admin/payouts/:id/mark-paid': [KE_TOAN],
  'POST /admin/payouts/:id/reject': ADMIN_ONLY,
  'GET /admin/payouts/pit-report': [KE_TOAN],
  'GET /admin/payroll': ADMIN_ONLY,
  'GET /admin/payroll/:staffId/detail': ADMIN_ONLY,
  'POST /admin/payroll/:staffId/finalize': ADMIN_ONLY,
  'POST /admin/payroll/:staffId/mark-paid': ADMIN_ONLY,
  'POST /admin/payroll/:staffId/recompute': ADMIN_ONLY,
  'POST /admin/payroll/:staffId/reopen': ADMIN_ONLY,
  'POST /admin/payroll/adjust': ADMIN_ONLY,
  'GET /admin/catalog-products/:id': ADMIN_ONLY,
  'PATCH /admin/catalog-products/:id': ADMIN_ONLY,
  'POST /admin/products/:id/story-assets/extract': ADMIN_ONLY,
  'POST /admin/products/:id/story-config/generate': ADMIN_ONLY,
  'GET /admin/ai-advisor/stats': ADMIN_ONLY,
  'GET /admin/catalog-quality/audit': ADMIN_ONLY,
  'GET /admin/catalog-quality/pancake-zero-price': ADMIN_ONLY,
  'POST /admin/catalog-quality/copy-drafts': ADMIN_ONLY,
  'POST /admin/catalog-quality/copy-approve': ADMIN_ONLY,
  'POST /admin/product-categories/assign': ADMIN_ONLY,
  'GET /admin/categories': ADMIN_ONLY,
  'POST /admin/categories': ADMIN_ONLY,
  'PATCH /admin/categories/:id': ADMIN_ONLY,
  'DELETE /admin/categories/:id': ADMIN_ONLY,
  'PUT /admin/categories/order': ADMIN_ONLY,
  'GET /admin/product-categories/products': ADMIN_ONLY,
  'POST /admin/products/recompute-sold': ADMIN_ONLY,
  'GET /admin/products/search': [MARKETING],
  'POST /admin/products/sold-external': ADMIN_ONLY,
  'DELETE /admin/promotions/:id': ADMIN_ONLY,
  'PATCH /admin/promotions/:id': ADMIN_ONLY,
  'GET /admin/support-chat/bridge': [CSKH],
  'POST /admin/support-chat/bridge/qr': ADMIN_ONLY,
  'GET /admin/support-chat/bridge/qr': ADMIN_ONLY,
  'POST /admin/support-chat/bridge/logout': ADMIN_ONLY,
  'POST /admin/support-chat/bridge/reconnect': ADMIN_ONLY,
  'GET /admin/support-chat/bridge/groups': ADMIN_ONLY,
  'POST /admin/support-chat/bridge/test': ADMIN_ONLY,
  'PUT /admin/support-chat/settings': ADMIN_ONLY,
  'GET /admin/support-chat/conversations': [CSKH],
  'GET /admin/support-chat/conversations/:id': [CSKH],
  'POST /admin/support-chat/conversations/:id/reply': [CSKH],
  'POST /admin/support-chat/conversations/:id/block': [CSKH],
  'DELETE /admin/support-chat/conversations/:id/block': [CSKH],
  'POST /admin/support-chat/forwards/:id/resend': [CSKH],
  'GET /admin/quick-replies': [CSKH],
  'POST /admin/quick-replies': [CSKH],
  'DELETE /admin/quick-replies/:id': [CSKH],
  'PATCH /admin/quick-replies/:id': [CSKH],
  'GET /admin/reports/exports/payouts': [KE_TOAN],
  'GET /admin/reports/exports/refunds': [KE_TOAN],
  'GET /admin/reports/exports/tax': [KE_TOAN],
  'GET /admin/reports/order-items/export': [KE_TOAN],
  'GET /admin/reports/revenue': [KE_TOAN],
  'GET /admin/reports/sources': [MARKETING],
  'GET /admin/return-requests': [CSKH, KHO],
  'GET /admin/return-requests/:id/preview': [CSKH],
  'POST /admin/return-requests/:id/received': [KHO],
  'POST /admin/return-requests/:id/review': [CSKH],
  'GET /admin/reviews': ADMIN_ONLY,
  'GET /admin/reviews/:id/images/:index': ADMIN_ONLY,
  'GET /admin/shift-templates': ADMIN_ONLY,
  'POST /admin/shift-templates': ADMIN_ONLY,
  'DELETE /admin/shift-templates/:id': ADMIN_ONLY,
  'PATCH /admin/shift-templates/:id': ADMIN_ONLY,
  'GET /admin/shifts': ADMIN_ONLY,
  'POST /admin/shifts/:id/approve': ADMIN_ONLY,
  'POST /admin/shifts/:id/reject': ADMIN_ONLY,
  'POST /admin/shifts/bulk-approve': ADMIN_ONLY,
  'GET /admin/staff': ADMIN_ONLY,
  'PUT /admin/staff/:userId/rate': ADMIN_ONLY,
  'POST /admin/staff/grant': ADMIN_ONLY,
  'POST /admin/staff/revoke': ADMIN_ONLY,
  'GET /admin/storefronts': ADMIN_ONLY,
  'GET /admin/storefronts/:id': ADMIN_ONLY,
  'POST /admin/storefronts/:id/approval': ADMIN_ONLY,
  'POST /admin/storefronts/:id/content-seen': ADMIN_ONLY,
  'POST /admin/storefronts/:id/partner': ADMIN_ONLY,
  'POST /admin/storefronts/:id/reinstate': ADMIN_ONLY,
  'POST /admin/storefronts/:id/take-down': ADMIN_ONLY,
  'GET /admin/subscriptions': ADMIN_ONLY,
  'GET /admin/users': [CSKH],
  'POST /admin/users/:id/block': ADMIN_ONLY,
  'POST /admin/users/:id/forfeit-commissions': ADMIN_ONLY,
  'POST /admin/users/:id/revoke-sessions': ADMIN_ONLY,
  'GET /admin/users/:id/detail': [CSKH],
  'PUT /admin/users/:id/staff-permissions': ADMIN_ONLY,
  'POST /admin/users/:id/unblock': ADMIN_ONLY,
  'GET /admin/users/export': ADMIN_ONLY,
  'POST /admin/users/role': ADMIN_ONLY,
  'GET /admin/variations/lookup': [MARKETING],
  'GET /admin/waste/gift-redemptions': STAFF,
  'POST /admin/waste/gift-redemptions/:id/cancel': ADMIN_ONLY,
  'POST /admin/waste/gift-redemptions/:id/fulfil': STAFF,
  'GET /admin/waste/gifts': ADMIN_ONLY,
  'PATCH /admin/waste/gifts/:id': ADMIN_ONLY,
  'POST /admin/waste/gifts': ADMIN_ONLY,
  'PUT /admin/waste/gifts/order': ADMIN_ONLY,
  'GET /admin/waste/items': ADMIN_ONLY,
  'PATCH /admin/waste/items/:id': ADMIN_ONLY,
  'POST /admin/waste/items': ADMIN_ONLY,
  'PUT /admin/waste/items/order': ADMIN_ONLY,
  'GET /admin/waste/overview': ADMIN_ONLY,
  'GET /admin/waste/reports/monthly': ADMIN_ONLY,
  'GET /admin/waste/points/:id/report': ADMIN_ONLY,
  'GET /admin/waste/points': ADMIN_ONLY,
  'POST /admin/waste/points': ADMIN_ONLY,
  'PATCH /admin/waste/points/:id': ADMIN_ONLY,
  'PUT /admin/waste/points/order': ADMIN_ONLY,
  'POST /admin/waste/points/:id/staff': ADMIN_ONLY,
  'DELETE /admin/waste/points/:id/staff/:userId': ADMIN_ONLY,
  'POST /admin/waste/points/:id/perk/approve': ADMIN_ONLY,
  'POST /admin/waste/points/:id/perk/reject': ADMIN_ONLY,
  'POST /admin/waste/points/:id/perk/clear': ADMIN_ONLY,
  'GET /admin/waste/requests': STAFF,
  'GET /admin/waste/requests/lookup': STAFF,
  'GET /admin/waste/requests/:id': STAFF,
  'POST /admin/waste/requests/:id/receive': STAFF,
  'POST /admin/waste/requests/:id/confirm': STAFF,
  'POST /admin/waste/requests/:id/reject': STAFF,
  'POST /admin/waste/requests/:id/reverse': ADMIN_ONLY,
  'PATCH /admin/waste/requests/:id/cost': ADMIN_ONLY,
  'POST /admin/waste/requests/:id/close-lost': ADMIN_ONLY,
  'POST /admin/waste/requests/:id/reopen': ADMIN_ONLY,
  'GET /admin/waste/unmatched': STAFF,
  'POST /admin/waste/unmatched': STAFF,
  'POST /admin/waste/unmatched/:id/resolve': STAFF,
  'GET /admin/waste/users/:userId/flags': ADMIN_ONLY,
  'PUT /admin/waste/users/:userId/flags': ADMIN_ONLY,
  'GET /affiliate/content-kit/:slug': STAFF,
  'POST /feed/admin/:id/approve': [CSKH, MARKETING],
  'POST /feed/admin/:id/hide': [CSKH, MARKETING],
  'POST /feed/admin/:id/pin': ADMIN_ONLY,
  'POST /feed/admin/:id/reject': [CSKH, MARKETING],
  'GET /feed/admin/events': ADMIN_ONLY,
  'GET /feed/admin/events/:id/participants': ADMIN_ONLY,
  'GET /feed/admin/pending': [CSKH, MARKETING],
  'GET /feed/admin/published': [CSKH, MARKETING],
  'GET /feed/admin/reports': [CSKH, MARKETING],
  'POST /feed/admin/reports/:id/resolve': [CSKH, MARKETING],
  'GET /feed/admin/unanswered': [CSKH, MARKETING],
  'POST /feed/events': ADMIN_ONLY,
  'POST /feed/events/:id/close': ADMIN_ONLY,
  'POST /feed/events/:id/winner': ADMIN_ONLY,
  'POST /loyalty/staff/pos-credit': STAFF,
  'POST /loyalty/staff/scan-member': STAFF,
  'POST /reviews/:id/visibility': ADMIN_ONLY,
  'POST /staff/attendance/checkin': STAFF,
  'POST /staff/attendance/checkout': STAFF,
  'POST /staff/attendance/heartbeat': STAFF,
  'GET /staff/attendance/history': STAFF,
  'GET /staff/attendance/status': STAFF,
  'PUT /staff/bank': STAFF,
  'GET /staff/payroll': STAFF,
  'GET /staff/shift-templates': STAFF,
  'GET /staff/shifts': STAFF,
  'POST /staff/shifts': STAFF,
  'DELETE /staff/shifts/:id': STAFF,
  'PATCH /staff/shifts/:id': STAFF,
  'POST /staff/shifts/:id/cancel': STAFF,
  'POST /staff/shifts/copy-week': STAFF,
};

interface AdminRoute {
  key: string;
  controller: Ctor;
  handler: object;
  access: Access;
}

/** Mọi handler của lớp, kể cả kế thừa từ lớp cha: Nest đăng ký cả route khai ở lớp cha. */
function handlersOf(c: Ctor): object[] {
  const seen = new Set<string>();
  const out: object[] = [];
  for (let p = c.prototype as object | null; p && p !== Object.prototype; p = Object.getPrototypeOf(p) as object | null) {
    for (const name of Object.getOwnPropertyNames(p)) {
      if (name === 'constructor' || seen.has(name)) continue;
      seen.add(name);
      const h: unknown = Object.getOwnPropertyDescriptor(p, name)?.value;
      if (typeof h === 'function') out.push(h);
    }
  }
  return out;
}

/** @Controller / @Get nhận cả mảng đường dẫn: mỗi đường dẫn là một route riêng phải có trong bảng. */
const pathsOf = (meta: unknown): string[] => (Array.isArray(meta) ? meta.map(String) : [String(meta ?? '')]);

interface AnyRoute extends AdminRoute {
  roles: string[];
  allowed: string[];
}

function routesFor(controllers: Ctor[]): AnyRoute[] {
  const out: AnyRoute[] = [];
  for (const c of controllers) {
    for (const h of handlersOf(c)) {
      const method = Reflect.getMetadata(METHOD_METADATA, h) as RequestMethod | undefined;
      if (method === undefined) continue;
      // Cùng thứ tự đọc với RolesGuard (getAllAndOverride: handler trước, lớp sau).
      const roles = (Reflect.getMetadata(ROLES_KEY, h) as string[] | undefined) ?? (Reflect.getMetadata(ROLES_KEY, c) as string[] | undefined) ?? [];
      const allowed =
        (Reflect.getMetadata(STAFF_PERMISSIONS_KEY, h) as string[] | undefined) ?? (Reflect.getMetadata(STAFF_PERMISSIONS_KEY, c) as string[] | undefined) ?? [];
      const access: Access = roles.includes('STAFF') ? STAFF : STAFF_PERMISSIONS.filter((p) => allowed.includes(p));
      for (const prefix of pathsOf(Reflect.getMetadata(PATH_METADATA, c))) {
        for (const sub of pathsOf(Reflect.getMetadata(PATH_METADATA, h))) {
          const path = `/${[prefix, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '');
          out.push({ key: `${RequestMethod[method]} ${path}`, controller: c, handler: h, access, roles, allowed });
        }
      }
    }
  }
  return out;
}

const allRoutes = () => routesFor(collectControllers(AppModule as unknown as Ctor));

/** Có đoạn `/admin` ở bất kỳ vị trí nào trong đường dẫn (`/admin/…`, `/feed/admin/…`, `/refill/admin/…`). */
const isAdminPath = (r: { key: string }) => /^\S+ \S*\/admin(\/|$)/.test(r.key);

/** Route quản trị: chỉ ADMIN, mở cho STAFF, có @AllowStaff, hoặc nằm dưới một đoạn `/admin` dù khai vai trò gì. */
const inScope = (r: AnyRoute) =>
  (r.roles.length === 1 && r.roles[0] === 'ADMIN') || r.roles.includes('STAFF') || r.allowed.length > 0 || isAdminPath(r);

/** Route có `/admin` chỉ được khai vai trò thuộc tập này: `@Roles('ADMIN', 'CUSTOMER')` biến route quản trị thành route của khách. */
const ADMIN_PATH_ROLES: readonly string[] = ['ADMIN', 'STAFF'];
const adminPathRoleViolations = (routes: AnyRoute[]) =>
  routes.filter((r) => isAdminPath(r) && r.roles.some((role) => !ADMIN_PATH_ROLES.includes(role))).map((r) => `${r.key} [${r.roles.join('|')}]`);

/**
 * Tiền tố ngoài `/admin` nhưng ghi dữ liệu nhạy cảm (tiền, hàng, nhân sự, trạng thái đơn): route bắt buộc có @Roles, hoặc nằm trong
 * NO_ROLES_ALLOWLIST kèm lý do. Route mới dưới các tiền tố này mà quên @Roles làm spec đỏ.
 * `/ops` và `/pos` hiện không khớp controller nào: giữ làm chốt cho route tương lai, chưa có route thật nào ở đó được kiểm (chỉ ca
 * tự kiểm bằng controller giả chạy trên chúng).
 */
const SENSITIVE_PREFIXES = ['/ops', '/pos', '/staff', '/waste/desk', '/merchant', '/loyalty/staff', '/brand/owner', '/internal', '/webhooks', '/dealer', '/affiliate'] as const;
const isSensitivePath = (r: { key: string }) => {
  const path = r.key.slice(r.key.indexOf(' ') + 1);
  return SENSITIVE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
};
const sensitiveRoutesWithoutRoles = (routes: AnyRoute[], allowlist: Record<string, string>) =>
  routes.filter((r) => isSensitivePath(r) && r.roles.length === 0 && !(r.key in allowlist)).map((r) => r.key);

/**
 * Dưới tiền tố nhạy cảm vai trò CUSTOMER không được khai trong @Roles (khách thường không bao giờ là chủ thể của route nhân sự, tiền,
 * kho): `@Roles('CUSTOMER')` trên route mới vẫn qua kiểm `roles.length > 0` nên cần chốt riêng. Ngoại lệ phải kèm lý do.
 */
const MERCHANT_PAYOUT_OWNER =
  'chủ gian hàng đã mất tư cách đối tác nhưng còn phiếu đối soát; MerchantPayoutOwnerGuard (merchant-payout-owner.guard.ts) chặn CUSTOMER không có gian hàng còn phiếu, dịch vụ phía sau tự kiểm chủ sở hữu';
const CUSTOMER_ROLE_ALLOWLIST: Record<string, string> = {
  'GET /merchant/store': MERCHANT_PAYOUT_OWNER,
  'GET /merchant/settlement': MERCHANT_PAYOUT_OWNER,
  'GET /merchant/returns': MERCHANT_PAYOUT_OWNER,
  'POST /merchant/returns/:id/received': MERCHANT_PAYOUT_OWNER,
};
const sensitiveCustomerRoleViolations = (routes: AnyRoute[], allowlist: Record<string, string>): string[] =>
  routes.filter((r) => isSensitivePath(r) && r.roles.includes('CUSTOMER') && !(r.key in allowlist)).map((r) => `${r.key} [${r.roles.join('|')}]`);

const WASTE_POINT_ACCESS = 'quyền theo điểm nhận kiểm trong service (WasteAccessService.listOperablePoints/assertPointAccess: người dùng phải gắn với điểm)';
const BRAND_OWNER = 'quyền chủ nhãn kiểm trong BrandService (Brand.ownerUserId === người gọi)';
const WEBHOOK_SECRET = 'webhook công khai nhưng bắt buộc chữ ký hoặc token bí mật trong controller (fail-closed ở production)';
const dealerOnly = (fn: string, line: number) =>
  `chỉ đại lý: DealerService.${fn} gọi dealerContext (dealer.service.ts:${line}), nó ném 403 khi User.role !== DEALER (dealer.service.ts:2071); dữ liệu theo userId của người gọi`;
const dealerOwnRows = (fn: string, line: number) =>
  `chỉ đọc dữ liệu của chính người gọi: DealerService.${fn} (dealer.service.ts:${line}) lọc theo userId từ token, không kiểm vai trò DEALER nên người chưa/không còn là đại lý nhận danh sách rỗng`;
const ctvOwnRows = (fn: string, line: number) =>
  `chỉ đọc dữ liệu của chính người gọi: AffiliateService.${fn} (affiliate.service.ts:${line}) lọc theo userId từ token, không kiểm vai trò CTV nên người ngoài chương trình nhận số 0/danh sách rỗng`;
const CTV_ORDER_FOR_CUSTOMER =
  'chỉ CTV hoặc ADMIN: AffiliateService.customerOrderPlacer (affiliate.service.ts:782) từ chối 400 khi !canPlaceOrderForCustomer(role) (affiliate-access.ts:13)';
const NO_ROLES_ALLOWLIST: Record<string, string> = {
  'GET /waste/desk/points': WASTE_POINT_ACCESS,
  'POST /waste/desk/lookup': WASTE_POINT_ACCESS,
  'POST /waste/desk/requests/:id/confirm': WASTE_POINT_ACCESS,
  'POST /waste/desk/requests/:id/reject': WASTE_POINT_ACCESS,
  'PUT /waste/desk/points/:pointId/perk': 'chỉ chủ điểm đối tác (WasteDeskService.submitPerk: access.myRole === OWNER)',
  'POST /waste/desk/gifts/fulfil': WASTE_POINT_ACCESS,
  'GET /waste/desk/points/:pointId/report': WASTE_POINT_ACCESS,
  'POST /dealer/apply':
    'đăng ký chính mình, khách thường phải vào được: DealerService.apply (dealer.service.ts:165) chỉ nhận tài khoản thật (isRealUser :167), ghi hồ sơ PENDING gắn userId của người gọi (một hồ sơ chờ duyệt mỗi người, :169); vai trò chỉ đổi khi admin duyệt',
  'GET /dealer/me': 'chỉ đọc hồ sơ của chính người gọi: DealerService.getMe (dealer.service.ts:195) theo userId từ token; khách thường nhận isDealer=false, status NONE',
  'GET /dealer/pricelist': dealerOnly('pricelist', 236),
  'POST /dealer/orders': dealerOnly('placeOrder', 263),
  'GET /dealer/orders': dealerOwnRows('listOrders', 525),
  'GET /dealer/credit-ledger': dealerOwnRows('creditLedger', 535),
  'POST /dealer/credit-payment': `${dealerOnly('reportCreditPayment', 554)}; chỉ ghi lời báo, không đụng sổ công nợ (giảm nợ chỉ qua admin xác nhận)`,
  'GET /dealer/quarterly-report': dealerOnly('quarterlyReport', 979),
  'GET /dealer/rewards': dealerOnly('rewardsProgress', 1016),
  'POST /dealer/rewards/:id/claim': dealerOnly('claimReward', 1117),
  'GET /dealer/templates': dealerOnly('listTemplates', 2027),
  'POST /dealer/templates': dealerOnly('saveTemplate', 2036),
  'DELETE /dealer/templates/:id': `${dealerOnly('deleteTemplate', 2047)}; xoá theo (id, userId) nên không chạm mẫu của người khác (dealer.service.ts:2049)`,
  'POST /affiliate/register':
    'cửa đăng ký CTV một chạm, khách thường phải vào được: AffiliateService.register (affiliate.service.ts:175) chỉ nhận CUSTOMER/AFFILIATE (canRegisterAsAffiliate :177), chặn tài khoản bị thu hồi (:180) và tài khoản không thật (isRealUser :182); chỉ đổi vai trò của chính người gọi',
  'POST /affiliate/touch':
    'khách ghi lượt chạm giới thiệu của chính mình: AffiliateService.recordTouch (affiliate.service.ts:233) ghi ReferralTouch theo userId từ token; người giới thiệu phải qua findEligibleReferrer (:315: khác người gọi, không bị khoá/thu hồi, vai trò hưởng hoa hồng); không đụng tiền',
  'GET /affiliate/me': ctvOwnRows('getMe', 209),
  'POST /affiliate/click':
    'công khai có chủ đích (khách mở link CTV chưa có phiên): @Throttle 30 lượt/phút theo IP (affiliate.controller.ts:88); AffiliateService.recordLinkClick (affiliate.service.ts:404) chỉ tăng bộ đếm click theo IP băm HMAC, mỗi ngày một lần, không đụng tiền',
  'POST /affiliate/links': 'chỉ CTV còn quyền: AffiliateService.createLink gọi assertAffiliateAccess (affiliate.service.ts:371), nó ném 403 khi bị thu hồi hoặc không còn quyền CTV (:355)',
  'GET /affiliate/links': ctvOwnRows('listLinks', 379),
  'GET /affiliate/dashboard': ctvOwnRows('dashboard', 415),
  'GET /affiliate/commissions': ctvOwnRows('listCommissions', 503),
  'GET /affiliate/payouts': ctvOwnRows('listMyPayouts', 524),
  'POST /affiliate/payouts':
    'rút hoa hồng của chính mình: AffiliateService.requestPayout (affiliate.service.ts:1409) chặn tài khoản bị thu hồi và khách ngoài vai trò hưởng hoa hồng (assertNotRevoked :1418, lặp trong giao dịch :1498), chỉ gom hoa hồng APPROVED có affiliateUserId = userId (:1452) và chỉ cộng vào Ví của người gọi',
  'GET /affiliate/tax-statement': ctvOwnRows('taxStatement', 622),
  'POST /affiliate/orders/quote': CTV_ORDER_FOR_CUSTOMER,
  'POST /affiliate/orders': CTV_ORDER_FOR_CUSTOMER,
  'GET /affiliate/analytics/storefronts': ctvOwnRows('storefrontAnalytics', 1873),
  'GET /affiliate/analytics/products': ctvOwnRows('productCommissionBreakdown', 1896),
  'GET /affiliate/tiers': ctvOwnRows('getCtvTiers', 2023),
  'GET /affiliate/milestones': ctvOwnRows('getMilestones', 2037),
  'POST /affiliate/milestones/:id/claim':
    'nhận thưởng mốc của chính mình: AffiliateService.claimMilestone (affiliate.service.ts:2102) chặn tài khoản bị thu hồi và khách ngoài vai trò hưởng hoa hồng (assertNotRevoked trong giao dịch :2122), chỉ cấp khi doanh số đã chốt của người gọi đạt ngưỡng (:2123)',
  'GET /brand/owner/me': BRAND_OWNER,
  'PATCH /brand/owner/me': BRAND_OWNER,
  'GET /brand/owner/me/sales': BRAND_OWNER,
  'POST /brand/owner/me/promotions': BRAND_OWNER,
  'PATCH /brand/owner/me/promotions/:id': BRAND_OWNER,
  'DELETE /brand/owner/me/promotions/:id': BRAND_OWNER,
  'POST /internal/zalo-bridge/events': 'cầu nối Zalo cá nhân: bearer bí mật chung (BridgeEventsController.authorized)',
  'POST /webhooks/zalo-miniapp': WEBHOOK_SECRET,
  'POST /webhooks/zalo-oa': WEBHOOK_SECRET,
  'POST /webhooks/pancake': WEBHOOK_SECRET,
  'POST /webhooks/gomdon': WEBHOOK_SECRET,
  'POST /webhooks/gomdon/:token': WEBHOOK_SECRET,
  'POST /webhooks/zalopay': WEBHOOK_SECRET,
  'POST /webhooks/accesstrade': WEBHOOK_SECRET,
  'POST /webhooks/cashback/:provider': WEBHOOK_SECRET,
};

const ALL_ROUTES = allRoutes();
const ROUTES: AdminRoute[] = ALL_ROUTES.filter(inScope);
const byKey = new Map(ROUTES.map((r) => [r.key, r]));

function guardAllows(route: AdminRoute, user: object): boolean {
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => route.handler,
    getClass: () => route.controller,
  } as unknown as ExecutionContext;
  try {
    return new RolesGuard(new Reflector()).canActivate(ctx);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('Bảng quyền nhân viên theo nhóm việc (ADMINOPS-10, D1-05)', () => {
  it('mọi route quản trị khớp đúng bảng duyệt — route mới chưa khai báo làm spec đỏ', () => {
    expect(ROUTES.length).toBeGreaterThan(150);
    expect(new Set(ROUTES.map((r) => r.key)).size).toBe(ROUTES.length);
    expect(Object.fromEntries(ROUTES.map((r) => [r.key, r.access]))).toEqual(EXPECTED);
  });

  it('route có /admin ở bất kỳ vị trí nào luôn khai vai trò: quên @Roles là route công khai, lọt khỏi bảng này', () => {
    expect(ALL_ROUTES.filter((r) => isAdminPath(r) && r.roles.length === 0).map((r) => r.key)).toEqual([]);
  });

  it('route có /admin chỉ khai vai trò ADMIN hoặc STAFF: @Roles có CUSTOMER/DEALER/... trên route quản trị làm spec đỏ', () => {
    expect(adminPathRoleViolations(ALL_ROUTES)).toEqual([]);
  });

  it('tự kiểm: spec bắt được @Roles(ADMIN, CUSTOMER) và @Roles(DEALER) dưới /admin, và không bắt vai trò hợp lệ', () => {
    @Controller('admin/probe')
    class ProbeAdminController {
      @Roles('ADMIN', 'CUSTOMER')
      @Get('mixed')
      mixed() {
        return 1;
      }

      @Roles('DEALER')
      @Get('dealer')
      dealer() {
        return 1;
      }

      @Roles('ADMIN', 'STAFF')
      @Get('ok')
      ok() {
        return 1;
      }
    }
    @Controller('feed/admin')
    @Roles('AFFILIATE')
    class ProbeNestedAdminController {
      @Get('x')
      x() {
        return 1;
      }
    }
    expect(adminPathRoleViolations(routesFor([ProbeAdminController, ProbeNestedAdminController]))).toEqual([
      'GET /admin/probe/mixed [ADMIN|CUSTOMER]',
      'GET /admin/probe/dealer [DEALER]',
      'GET /feed/admin/x [AFFILIATE]',
    ]);
  });

  it('route dưới tiền tố nhạy cảm ngoài /admin (/staff, /waste/desk, /merchant, /dealer, /affiliate, ...) có @Roles hoặc nằm trong allowlist kèm lý do', () => {
    expect(sensitiveRoutesWithoutRoles(ALL_ROUTES, NO_ROLES_ALLOWLIST)).toEqual([]);
    expect(ALL_ROUTES.filter(isSensitivePath).length).toBeGreaterThan(60);
  });

  it('allowlist không có mục thừa: mỗi mục là một route thật, nằm dưới tiền tố nhạy cảm, chưa khai @Roles, có lý do', () => {
    const byRouteKey = new Map(ALL_ROUTES.map((r) => [r.key, r]));
    const stale = Object.entries(NO_ROLES_ALLOWLIST)
      .filter(([key, reason]) => {
        const r = byRouteKey.get(key);
        return !r || !isSensitivePath(r) || r.roles.length > 0 || reason.trim() === '';
      })
      .map(([key]) => key);
    expect(stale).toEqual([]);
  });

  it('route dưới tiền tố nhạy cảm không khai vai trò CUSTOMER, trừ ngoại lệ kèm lý do', () => {
    expect(sensitiveCustomerRoleViolations(ALL_ROUTES, CUSTOMER_ROLE_ALLOWLIST)).toEqual([]);
  });

  it('ngoại lệ CUSTOMER không có mục thừa: mỗi mục là một route thật dưới tiền tố nhạy cảm, đang khai CUSTOMER, có lý do', () => {
    const byRouteKey = new Map(ALL_ROUTES.map((r) => [r.key, r]));
    const stale = Object.entries(CUSTOMER_ROLE_ALLOWLIST)
      .filter(([key, reason]) => {
        const r = byRouteKey.get(key);
        return !r || !isSensitivePath(r) || !r.roles.includes('CUSTOMER') || reason.trim() === '';
      })
      .map(([key]) => key);
    expect(stale).toEqual([]);
  });

  it('tự kiểm: spec bắt @Roles(CUSTOMER) dưới /staff, /loyalty/staff, /waste/desk; ngoại lệ có lý do, vai trò khác và tiền tố khác thì qua', () => {
    @Controller('staff')
    class ProbeStaffController {
      @Roles('CUSTOMER')
      @Post('payroll/approve')
      approve() {
        return 1;
      }

      @Roles('STAFF', 'ADMIN')
      @Post('payroll/view')
      view() {
        return 1;
      }
    }
    @Controller('loyalty/staff')
    @Roles('DEALER', 'CUSTOMER')
    class ProbeLoyaltyStaffController {
      @Post('pos-credit')
      credit() {
        return 1;
      }
    }
    @Controller('waste/desk')
    class ProbeDeskController {
      @Roles('CUSTOMER', 'STAFF')
      @Get('points')
      points() {
        return 1;
      }

      @Roles('CUSTOMER')
      @Get('lookup')
      lookup() {
        return 1;
      }
    }
    @Controller('shop')
    class ProbeShopController {
      @Roles('CUSTOMER')
      @Get('mine')
      mine() {
        return 1;
      }
    }
    const routes = routesFor([ProbeStaffController, ProbeLoyaltyStaffController, ProbeDeskController, ProbeShopController]);
    expect(sensitiveCustomerRoleViolations(routes, { 'GET /waste/desk/lookup': 'có guard riêng' })).toEqual([
      'POST /staff/payroll/approve [CUSTOMER]',
      'POST /loyalty/staff/pos-credit [DEALER|CUSTOMER]',
      'GET /waste/desk/points [CUSTOMER|STAFF]',
    ]);
  });

  it('tự kiểm: spec bắt route thiếu @Roles dưới /ops, /pos, /staff, /merchant, /waste/desk, /dealer, /affiliate; @Roles hoặc allowlist thì qua', () => {
    @Controller('ops')
    class ProbeOpsController {
      @Get('refund')
      refund() {
        return 1;
      }
    }
    @Controller('pos')
    class ProbePosController {
      @Get('credit')
      credit() {
        return 1;
      }
    }
    @Controller('staff')
    class ProbeStaffController {
      @Get('payroll')
      payroll() {
        return 1;
      }

      @Roles('STAFF', 'ADMIN')
      @Get('shifts')
      shifts() {
        return 1;
      }
    }
    @Controller('merchant/orders')
    class ProbeMerchantController {
      @Get()
      list() {
        return 1;
      }
    }
    @Controller('waste/desk')
    class ProbeDeskController {
      @Get('points')
      points() {
        return 1;
      }

      @Get('lookup')
      lookup() {
        return 1;
      }
    }
    @Controller('dealer')
    class ProbeDealerController {
      @Post('orders')
      orders() {
        return 1;
      }
    }
    @Controller('affiliate')
    class ProbeAffiliateController {
      @Post('payouts')
      payouts() {
        return 1;
      }
    }
    @Controller('shop')
    class ProbeOtherController {
      @Get('open')
      open() {
        return 1;
      }
    }
    const routes = routesFor([
      ProbeOpsController,
      ProbePosController,
      ProbeStaffController,
      ProbeMerchantController,
      ProbeDeskController,
      ProbeDealerController,
      ProbeAffiliateController,
      ProbeOtherController,
    ]);
    expect(sensitiveRoutesWithoutRoles(routes, { 'GET /waste/desk/points': 'kiểm trong service' })).toEqual([
      'GET /ops/refund',
      'GET /pos/credit',
      'GET /staff/payroll',
      'GET /merchant/orders',
      'GET /waste/desk/lookup',
      'POST /dealer/orders',
      'POST /affiliate/payouts',
    ]);
  });

  it('route có /admin ở bất kỳ vị trí nào (kể cả /feed/admin/*, /refill/admin/*) đều có trong bảng duyệt', () => {
    const admin = ALL_ROUTES.filter(isAdminPath).map((r) => r.key);
    expect(admin.filter((k) => !/^\S+ \/admin(\/|$)/.test(k)).length).toBeGreaterThan(0);
    expect(admin.filter((k) => !(k in EXPECTED))).toEqual([]);
  });

  it('@AllowStaff chỉ dùng nhóm việc có thật (chuỗi gõ sai không bao giờ khớp nhân viên nào)', () => {
    for (const c of collectControllers(AppModule as unknown as Ctor)) {
      const proto = c.prototype as Record<string, unknown>;
      const targets = [c, ...Object.getOwnPropertyNames(proto).map((n) => proto[n]).filter((h): h is object => typeof h === 'function')];
      for (const t of targets) {
        const perms = (Reflect.getMetadata(STAFF_PERMISSIONS_KEY, t) as string[] | undefined) ?? [];
        expect(perms.filter((p) => !(STAFF_PERMISSIONS as readonly string[]).includes(p))).toEqual([]);
      }
    }
  });

  it('không nhóm nào chạm tới cấu hình, phân quyền, khoá tài khoản, % hoa hồng/giá sỉ, lương/ca, duyệt rút tiền, xuất người dùng', () => {
    const forbidden =
      /^(GET|POST|PUT|PATCH|DELETE) \/admin\/(config|staff($|\/)|users\/role|users\/export|users\/:id\/(block|unblock|revoke-sessions|staff-permissions|forfeit-commissions)|commission-rates|dealer-prices\/import|payroll|shifts|shift-templates|attendance|payouts\/:id\/(approve|reject)|pancake\/sync|products\/(recompute-sold|sold-external)|merchant-fulfilment\/stores|storefronts|account-deletion-requests|engagement|dealer-applications)/;
    const leaked = ROUTES.filter((r) => r.access !== STAFF && r.access.length > 0 && forbidden.test(r.key)).map((r) => r.key);
    expect(leaked).toEqual([]);
  });

  /**
   * Route ghi tiền (hoàn tiền, "Đã chi", ghi nhận/chi tiền, cộng điểm/ví): RolesGuard thật với từng nhóm việc. Nhóm không có trong
   * danh sách phải bị 403 — kể cả nhân viên có MỌI nhóm còn lại cùng lúc.
   */
  const MONEY_WRITES: Record<string, readonly StaffPermission[]> = {
    'POST /admin/customer-refunds/:id/claim': [KE_TOAN],
    'POST /admin/customer-refunds/:id/release': [KE_TOAN],
    'POST /admin/customer-refunds/:id/verify': [KE_TOAN],
    'POST /admin/customer-refunds/:id/dismiss': [KE_TOAN],
    'POST /admin/customer-refunds/:id/mark-paid': [KE_TOAN],
    'POST /admin/users/:id/forfeit-commissions': ADMIN_ONLY,
    'POST /admin/payouts/:id/approve': ADMIN_ONLY,
    'POST /admin/payouts/:id/reject': ADMIN_ONLY,
    'POST /admin/payouts/:id/mark-paid': [KE_TOAN],
    'POST /admin/merchant-fulfilment/payouts': [KE_TOAN],
    'POST /admin/merchant-fulfilment/payouts/:id/paid': [KE_TOAN],
    'POST /admin/merchant-fulfilment/payouts/:id/cancel': [KE_TOAN],
    'POST /admin/dealer-reward-claims/:id/approve': ADMIN_ONLY,
    'POST /admin/dealer-reward-claims/:id/reject': ADMIN_ONLY,
    'POST /admin/dealer-reward-claims/:id/mark-paid': [KE_TOAN],
    'POST /admin/dealer-reward-claims/:id/reopen': ADMIN_ONLY,
    'POST /admin/dealers/:userId/credit-payment': [KE_TOAN],
    'POST /admin/orders/:id/confirm-payment': [KE_TOAN],
    'POST /admin/dealer-orders/:id/confirm-payment': [KE_TOAN],
    'POST /admin/orders/:id/resync-delivered-effects': ADMIN_ONLY,
    'POST /admin/external-claims/:id/reverse': ADMIN_ONLY,
    'POST /admin/external-claims/:id/keep-points': ADMIN_ONLY,
    'POST /admin/external-claims/:id/approve': [CSKH],
    'POST /admin/external-claims/:id/void': [CSKH],
    'POST /admin/external-claims/:id/void-and-reopen': [CSKH],
    'PUT /admin/orders/:id/status': [CSKH, KHO],
    'POST /admin/return-requests/:id/review': [CSKH],
    'POST /admin/cashback/transactions/:id/review': [KE_TOAN],
    'POST /admin/orders/:id/issue-invoice': [KE_TOAN],
    'POST /admin/payroll/:staffId/finalize': ADMIN_ONLY,
    'POST /admin/payroll/:staffId/reopen': ADMIN_ONLY,
    'POST /admin/payroll/:staffId/recompute': ADMIN_ONLY,
    'POST /admin/payroll/:staffId/mark-paid': ADMIN_ONLY,
    'POST /admin/payroll/adjust': ADMIN_ONLY,
    'PUT /admin/staff/:userId/rate': ADMIN_ONLY,
    'POST /admin/account-deletion-requests/:id/process': ADMIN_ONLY,
    'POST /admin/engagement/missions': ADMIN_ONLY,
    'PATCH /admin/engagement/missions/:id': ADMIN_ONLY,
    'POST /feed/events/:id/winner': ADMIN_ONLY,
    'PUT /admin/commission-rates/variations/:id': ADMIN_ONLY,
    'PUT /admin/commission-rates/products/:id': ADMIN_ONLY,
    'POST /admin/commission-rates/fill-missing': ADMIN_ONLY,
    'POST /admin/commission-rates/import/apply': ADMIN_ONLY,
    'POST /admin/dealer-prices/import': ADMIN_ONLY,
    'POST /admin/dealer-tiers': ADMIN_ONLY,
    'PUT /admin/dealer-tiers/:id': ADMIN_ONLY,
  };

  it.each(Object.entries(MONEY_WRITES))('route ghi tiền %s: chỉ ADMIN và nhóm %j vào được, mọi nhóm khác 403', (key, allowed) => {
    const route = byKey.get(key);
    expect(route).toBeDefined();
    expect(guardAllows(route!, { role: 'ADMIN' })).toBe(true);
    for (const role of ['CUSTOMER', 'AFFILIATE', 'DEALER', 'MERCHANT']) expect(guardAllows(route!, { role, staffPermissions: [...STAFF_PERMISSIONS] })).toBe(false);
    expect(guardAllows(route!, { role: 'STAFF', staffPermissions: [] })).toBe(false);
    for (const p of STAFF_PERMISSIONS) {
      expect({ group: p, allowed: guardAllows(route!, { role: 'STAFF', staffPermissions: [p] }) }).toEqual({ group: p, allowed: allowed.includes(p) });
    }
    const others = STAFF_PERMISSIONS.filter((p) => !allowed.includes(p));
    expect(guardAllows(route!, { role: 'STAFF', staffPermissions: others })).toBe(false);
  });
});
