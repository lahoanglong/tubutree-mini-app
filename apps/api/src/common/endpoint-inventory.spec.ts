import 'reflect-metadata';
import { AppModule } from '../app.module';
import { collectControllers, routesOf, type Ctor } from './route-graph';

// ConfigModule.forRoot của AppModule chạy validate ngay lúc import; spec này chỉ cần đồ thị module, không cần biến môi trường thật.
jest.mock('../config/env.validation', () => ({ validateEnv: (config: Record<string, unknown>) => config }));

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
  ['POST /admin/payroll/:staffId/recompute', 'công cụ nhân sự, A1-030'],
  ['POST /admin/brands/:id/products', 'admin gán SP vào nhãn, chưa có UI nhưng gọi tay được'],
  ['PATCH /admin/promotions/:id', 'admin sửa khuyến mãi nhãn, chưa có UI'],
  ['PATCH /admin/dealer-rewards/:id', 'admin sửa thưởng đại lý, chưa có UI (ngưỡng BigInt có race spec riêng)'],
  ['DELETE /reviews/:id', 'chưa có nút xoá đánh giá ở FE; xoá hoàn điểm đã thưởng nên xoá rồi viết lại vẫn đúng một lần thưởng (review-edit.race-spec, Q-30)'],
];

// Dựng từ đồ thị AppModule, không phải danh sách controller viết tay: với danh sách tay, một route đã gỡ mà được đăng ký lại
// ở controller nằm ngoài danh sách sẽ không bao giờ làm mục REMOVED đỏ. beta-removed.spec.ts bổ sung bằng lời gọi HTTP thật.
const ROUTES = new Set(collectControllers(AppModule as unknown as Ctor).flatMap(routesOf));

describe('Sổ endpoint C-098', () => {
  it('dựng được bảng route từ metadata của controller', () => {
    expect(ROUTES.size).toBeGreaterThan(100);
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
