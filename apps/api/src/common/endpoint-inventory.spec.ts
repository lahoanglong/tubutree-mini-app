import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../modules/auth/auth.controller';
import { AdminController } from '../modules/admin/admin.controller';
import { BrandAdminController } from '../modules/brand/brand-admin.controller';
import { BrandController } from '../modules/brand/brand.controller';
import { CommunityFeedController } from '../modules/feed/community-feed.controller';
import { HealthController } from '../modules/health/health.controller';
import { PancakeController } from '../modules/integrations/pancake/pancake.controller';
import { PaymentController } from '../modules/integrations/payment/payment.controller';
import { LoyaltyController } from '../modules/loyalty/loyalty.controller';
import { OrdersController } from '../modules/orders/orders.controller';
import { ReviewsController } from '../modules/reviews/reviews.controller';
import { AdminAttendanceController } from '../modules/staff/attendance/admin-attendance.controller';
import { AdminPayrollController } from '../modules/staff/payroll/admin-payroll.controller';
import { StorefrontController } from '../modules/storefront/storefront.controller';

/**
 * Sổ endpoint của C-098 (gỡ endpoint không FE nào gọi). Hai bảng:
 * - REMOVED: đã gỡ vì không có lời gọi nào ở apps/miniapp, apps/web (HEAD và commit PROD cb92dc8), không
 *   phải callback/cron ngoài, không có e2e/loadtest/script/ops gọi. Đừng thêm lại mà không có FE đi kèm.
 * - KEPT_WITHOUT_FE: cũng không có lời gọi FE nhưng cố ý GIỮ; mỗi dòng nói vì sao. Gỡ một dòng ở đây
 *   nghĩa là có người quyết định bỏ hẳn tính năng đó (bảng bằng chứng ở docs/2026-10-review/impl/PD-2.md).
 */
const REMOVED = [
  'POST /me/redeem-points',
  'GET /feed/events/:id',
  'GET /brand/owner/me/promotions',
  'POST /orders/:code/issue-invoice',
  'POST /orders/:code/track',
  'GET /beta/me',
  'POST /beta/join',
  'POST /beta/leave',
  'POST /beta/feedback',
] as const;

const KEPT_WITHOUT_FE: ReadonlyArray<readonly [route: string, why: string]> = [
  ['GET /auth/me', 'scripts/loadtest gọi (scenarios.cjs, page-weight.cjs)'],
  ['GET /storefront/by-host', 'tra gian hàng theo tên miền riêng, audit A5-53 đề xuất middleware dùng'],
  ['GET /health', 'healthcheck hạ tầng'],
  ['POST /payments/zalopay/create', 'ZaloPay đang ẩn nhưng có runbook go-live (docs/ZALOPAY-SETUP.md)'],
  ['POST /admin/pancake/sync', 'công cụ vận hành, A1-030 ghi "chỉ làm được bằng gọi API tay"'],
  ['POST /admin/products/recompute-sold', 'công cụ vận hành, A1-030'],
  ['GET /admin/dealer-prices/history', 'sổ lịch sử giá đại lý vẫn được ghi, đây là đường đọc duy nhất, A1-030'],
  ['GET /admin/attendance/live', 'công cụ nhân sự, A1-030'],
  ['POST /admin/attendance/manual-checkout', 'công cụ nhân sự, A1-030'],
  ['POST /admin/payroll/:staffId/recompute', 'công cụ nhân sự, A1-030'],
  ['POST /admin/brands/:id/products', 'admin gán SP vào nhãn, chưa có UI nhưng gọi tay được'],
  ['PATCH /admin/promotions/:id', 'admin sửa khuyến mãi nhãn, chưa có UI'],
  ['PATCH /admin/dealer-rewards/:id', 'admin sửa thưởng đại lý, chưa có UI (ngưỡng BigInt có race spec riêng)'],
  ['DELETE /reviews/:id', 'chưa có nút xoá đánh giá ở FE; xoá hoàn điểm đã thưởng nên xoá rồi viết lại vẫn đúng một lần thưởng (review-edit.race-spec, Q-30)'],
];

function joinPath(...parts: string[]): string {
  const joined = parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  return `/${joined}`;
}

function routesOf(controller: new (...args: never[]) => unknown): string[] {
  const prefix = (Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined) ?? '';
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  const proto = controller.prototype as Record<string, unknown>;
  const out: string[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[];
    for (const pre of prefixes) {
      for (const p of Array.isArray(path) ? path : [path]) out.push(`${RequestMethod[method]} ${joinPath(pre, p)}`);
    }
  }
  return out;
}

const ROUTES = new Set(
  [
    AdminController,
    AdminAttendanceController,
    AdminPayrollController,
    AuthController,
    BrandAdminController,
    BrandController,
    CommunityFeedController,
    HealthController,
    LoyaltyController,
    OrdersController,
    PancakeController,
    PaymentController,
    ReviewsController,
    StorefrontController,
  ].flatMap((c) => routesOf(c as never)),
);

describe('Sổ endpoint C-098', () => {
  it('dựng được bảng route từ metadata của controller', () => {
    expect(ROUTES.has('GET /orders')).toBe(true);
    expect(ROUTES.has('POST /orders/:code/cancel')).toBe(true);
    expect(ROUTES.has('POST /admin/orders/:id/issue-invoice')).toBe(true);
    expect(ROUTES.has('GET /admin/orders/:id/status-history')).toBe(true);
    expect(ROUTES.has('POST /brand/owner/me/promotions')).toBe(true);
    expect(ROUTES.has('PATCH /brand/owner/me/promotions/:id')).toBe(true);
  });

  it.each(REMOVED)('%s đã gỡ, không còn handler', (route) => {
    expect(ROUTES.has(route)).toBe(false);
  });

  it.each(KEPT_WITHOUT_FE)('%s vẫn còn (%s)', (route) => {
    expect(ROUTES.has(route)).toBe(true);
  });
});
