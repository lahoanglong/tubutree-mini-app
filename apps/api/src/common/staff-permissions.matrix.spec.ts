import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from '../app.module';
import { collectControllers, type Ctor } from './route-graph';
import { ROLES_KEY } from './decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY, type StaffPermission } from './staff-permissions';

jest.mock('../config/env.validation', () => ({ validateEnv: (config: Record<string, unknown>) => config }));

/**
 * ADMINOPS-10 — ma trận quyền tối thiểu: liệt kê ĐÚNG các route /admin mà nhân viên mỗi nhóm việc vào được, để một
 * @AllowStaff gắn nhầm (vd lên cấu hình, lương, rút tiền, phân quyền) làm spec đỏ thay vì lặng lẽ mở quyền.
 */
function reachableAdminRoutes(perms: StaffPermission[]): string[] {
  const out: string[] = [];
  for (const c of collectControllers(AppModule as unknown as Ctor)) {
    const prefix = String(Reflect.getMetadata(PATH_METADATA, c) ?? '');
    const classRoles = Reflect.getMetadata(ROLES_KEY, c) as string[] | undefined;
    const classPerms = Reflect.getMetadata(STAFF_PERMISSIONS_KEY, c) as string[] | undefined;
    const proto = c.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const h = proto[name];
      if (typeof h !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, h) as RequestMethod | undefined;
      if (method === undefined) continue;
      const path = `/${[prefix, String(Reflect.getMetadata(PATH_METADATA, h) ?? '')].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '');
      if (!path.startsWith('/admin')) continue;
      const roles = (Reflect.getMetadata(ROLES_KEY, h) as string[] | undefined) ?? classRoles;
      const allowed = (Reflect.getMetadata(STAFF_PERMISSIONS_KEY, h) as string[] | undefined) ?? classPerms;
      if (!roles || roles.length === 0) continue;
      if (roles.includes('STAFF') || allowed?.some((p) => perms.includes(p as StaffPermission))) {
        out.push(`${RequestMethod[method]} ${path}`);
      }
    }
  }
  return out.sort();
}

const STAFF_BASE = reachableAdminRoutes([]);

describe('Ma trận quyền nhân viên (ADMINOPS-10)', () => {
  it('CSKH: xem/đổi trạng thái đơn, duyệt đổi trả, xem người dùng, mẫu tin nhanh — không gì khác', () => {
    const extra = reachableAdminRoutes(['CSKH']).filter((r) => !STAFF_BASE.includes(r));
    expect(extra).toEqual(
      [
        'GET /admin/orders',
        'GET /admin/orders/:id/status-history',
        'PUT /admin/orders/:id/status',
        'GET /admin/return-requests',
        'GET /admin/return-requests/:id/preview',
        'POST /admin/return-requests/:id/review',
        'GET /admin/users',
        'GET /admin/users/:id/detail',
        'GET /admin/quick-replies',
        'POST /admin/quick-replies',
        'PATCH /admin/quick-replies/:id',
        'DELETE /admin/quick-replies/:id',
        'GET /admin/ops/inbox',
      ].sort(),
    );
  });

  it('KHO: xem/đổi trạng thái đơn, đẩy lại Pancake, vận đơn thu gom, nhận hàng trả — không gì khác', () => {
    const extra = reachableAdminRoutes(['KHO']).filter((r) => !STAFF_BASE.includes(r));
    expect(extra).toEqual(
      [
        'GET /admin/orders',
        'GET /admin/orders/:id/status-history',
        'PUT /admin/orders/:id/status',
        'POST /admin/orders/:id/pancake-attention/resolve',
        'POST /admin/orders/:id/gomdon/retry',
        'POST /admin/orders/:id/gomdon/cancel-waybill',
        'POST /admin/orders/:id/gomdon/mark-handled',
        'POST /admin/gomdon/alerts/:alertId/resolve',
        'POST /admin/pancake/orders/:id/push',
        'GET /admin/return-requests',
        'POST /admin/return-requests/:id/received',
        'GET /admin/ops/inbox',
      ].sort(),
    );
  });

  it('không nhóm nào chạm tới cấu hình, phân quyền, lương, rút tiền, hoàn tiền chuyển khoản, xuất dữ liệu', () => {
    const all = reachableAdminRoutes(['CSKH', 'KHO']);
    const forbidden = /\/admin\/(config|payroll|payouts|customer-refunds|staff\/(grant|revoke)|users\/role|users\/:id\/(block|unblock|staff-permissions)|orders\/export|users\/export|orders\/:id\/confirm-payment|pancake\/sync|products\/recompute-sold)/;
    expect(all.filter((r) => forbidden.test(r))).toEqual([]);
  });
});
