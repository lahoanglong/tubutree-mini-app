import 'reflect-metadata';
import { ForbiddenException, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AppModule } from '../app.module';
import { collectControllers, type Ctor } from './route-graph';
import { ROLES_KEY } from './decorators/roles.decorator';
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
  'GET /admin/dealer-applications': ADMIN_ONLY,
  'POST /admin/dealer-applications/:id/review': ADMIN_ONLY,
  'POST /admin/dealer-orders/:id/confirm-payment': [KE_TOAN],
  'GET /admin/dealer-prices/history': ADMIN_ONLY,
  'POST /admin/dealer-prices/import': ADMIN_ONLY,
  'POST /admin/dealer-prices/import/preview': ADMIN_ONLY,
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
  'POST /admin/flash-sales': [MARKETING],
  'DELETE /admin/flash-sales/:id': [MARKETING],
  'PATCH /admin/flash-sales/:id': [MARKETING],
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
  'GET /admin/notification-templates': [MARKETING],
  'PATCH /admin/notification-templates/:code': [MARKETING],
  'GET /admin/ops/access': STAFF,
  'POST /admin/ops/alert-email/test': ADMIN_ONLY,
  'GET /admin/ops/health': ADMIN_ONLY,
  'GET /admin/ops/inbox': [CSKH, KHO, MARKETING, KE_TOAN],
  'POST /admin/ops/webhook-events/:source/:id/dismiss': ADMIN_ONLY,
  'POST /admin/ops/webhook-events/:source/:id/retry': ADMIN_ONLY,
  'GET /admin/orders': [CSKH, KHO, KE_TOAN],
  'POST /admin/orders/:id/confirm-payment': [KE_TOAN],
  'POST /admin/orders/:id/gomdon/cancel-waybill': [KHO],
  'POST /admin/orders/:id/gomdon/mark-handled': [KHO],
  'POST /admin/orders/:id/gomdon/retry': [KHO],
  'POST /admin/orders/:id/issue-invoice': [KE_TOAN],
  'POST /admin/orders/:id/pancake-attention/resolve': [KHO],
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
  'POST /admin/product-categories/assign': ADMIN_ONLY,
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
  'POST /admin/storefronts/:id/partner': ADMIN_ONLY,
  'POST /admin/storefronts/:id/reinstate': ADMIN_ONLY,
  'POST /admin/storefronts/:id/take-down': ADMIN_ONLY,
  'GET /admin/subscriptions': ADMIN_ONLY,
  'GET /admin/users': [CSKH],
  'POST /admin/users/:id/block': ADMIN_ONLY,
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

function allRoutes(): AnyRoute[] {
  const out: AnyRoute[] = [];
  for (const c of collectControllers(AppModule as unknown as Ctor)) {
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

/** Có đoạn `/admin` ở bất kỳ vị trí nào trong đường dẫn (`/admin/…`, `/feed/admin/…`, `/refill/admin/…`). */
const isAdminPath = (r: { key: string }) => /^\S+ \S*\/admin(\/|$)/.test(r.key);

/** Route quản trị: chỉ ADMIN, mở cho STAFF, có @AllowStaff, hoặc nằm dưới một đoạn `/admin` dù khai vai trò gì. */
const inScope = (r: AnyRoute) =>
  (r.roles.length === 1 && r.roles[0] === 'ADMIN') || r.roles.includes('STAFF') || r.allowed.length > 0 || isAdminPath(r);

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
      /^(GET|POST|PUT|PATCH|DELETE) \/admin\/(config|staff($|\/)|users\/role|users\/export|users\/:id\/(block|unblock|staff-permissions)|commission-rates|dealer-prices\/import|payroll|shifts|shift-templates|attendance|payouts\/:id\/(approve|reject)|pancake\/sync|products\/(recompute-sold|sold-external)|merchant-fulfilment\/stores|storefronts|account-deletion-requests|engagement|dealer-applications)/;
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
