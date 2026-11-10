/* eslint-disable @typescript-eslint/no-explicit-any -- DB giả trả dòng động theo tên bảng */
import { RaceDb, tick } from './race-db.fake';
import { AdminService } from '../../src/modules/admin/admin.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { DealerAccountsAdminService } from '../../src/modules/dealer/dealer-accounts-admin.service';
import { RbacService } from '../../src/modules/staff/rbac/rbac.service';

/**
 * Dựng RaceDb + dịch vụ THẬT cho luồng nộp hồ sơ đại lý, duyệt/từ chối, cấp bậc và sửa bậc (Wave 103A).
 * Chỉ giả: các câu SQL thô (handler bên dưới), thông báo, RbacService.revokeGrantsAbove, MerchantFulfilmentService (chỉ chạm khi hạ vai trò).
 *
 * Handler khớp ĐÚNG câu SQL của mã thật và chỉ khoá dòng khi chuỗi SQL còn chứa `FOR (NO KEY )?UPDATE` (cờ `locking`), đọc SAU khi được khoá để
 * thấy bản mới nhất (như Postgres READ COMMITTED). Không mô phỏng: KEY SHARE của khoá ngoại, deadlock 40P01, timeout, pool kết nối.
 */
export const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};

export const ROSTER_LOCK = 'admin-roster';

export interface SetupOptions {
  users?: Record<string, unknown>[];
  tiers?: Record<string, unknown>[];
  applications?: Record<string, unknown>[];
  storefronts?: Record<string, unknown>[];
  admins?: string[];
  grants?: Record<string, unknown>[];
  /** Bỏ chỉ mục duy nhất một phần của hồ sơ PENDING (mô phỏng migration chưa chạy) để thử riêng bước kiểm findFirst. */
  noPendingIndex?: boolean;
  /** RbacService THẬT (revokeGrantsAbove, applyGrants) thay cho bản giả. */
  realRbac?: boolean;
}

export function dealerRaceSetup(opts: SetupOptions = {}) {
  const db = new RaceDb({
    user: {},
    dealerApplication: {
      // Chỉ mục duy nhất một phần dealer_applications_pending_user_key (migration 20260902020000): mỗi người nộp tối đa một hồ sơ PENDING.
      unique: opts.noPendingIndex ? [] : [{ fields: ['userId'], when: (r) => r.status === 'PENDING' }],
      defaults: { status: 'PENDING', reviewedBy: null, reviewedAt: null, rejectionReason: null },
    },
    // khoá chính id: createTier dựa vào P2002 của khoá chính để chặn tạo trùng mã bậc
    dealerTier: { unique: [{ fields: ['id'] }] },
    dealerTierHistory: {},
    storefront: {},
    userAdminEvent: {},
    commission: {},
    roleGrant: {},
  });
  db.seed('user', [
    { id: 'u1', role: 'CUSTOMER', phone: '0911111111', zaloId: 'z1', isBlocked: false, metadata: null, staffPermissions: [], affiliateRevokedAt: null },
    ...(opts.users ?? []),
  ]);
  for (const id of opts.admins ?? ['admin1', 'admin2']) {
    db.seed('user', [{ id, role: 'ADMIN', phone: null, zaloId: `z-${id}`, isBlocked: false, metadata: null, staffPermissions: [], affiliateRevokedAt: null }]);
  }
  db.seed('dealerTier', opts.tiers ?? [
    { id: 'SILVER', name: 'Bạc', minOrderVolume: 0, discountRules: { default: 0.1 }, creditLimit: 10_000_000, paymentTerms: 'PREPAID' },
    { id: 'GOLD', name: 'Vàng', minOrderVolume: 50_000_000, discountRules: { default: 0.2 }, creditLimit: 50_000_000, paymentTerms: 'NET 30' },
  ]);
  db.seed('dealerApplication', opts.applications ?? []);
  db.seed('storefront', opts.storefronts ?? []);
  db.seed('roleGrant', opts.grants ?? []);

  const sortedById = (rows: Record<string, any>[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  db.handlers.push(
    // khớp `pg_advisory_xact_lock(` chứ không phải `pg_advisory_xact_lock_shared`
    { match: /pg_advisory_xact_lock\(/, run: (c) => c.lockKey(`advisory:${c.params.map(String).join('|')}`).then(() => 1) },
    {
      match: /FROM "storefronts" WHERE "ownerUserId" = \?/,
      run: async (c) => {
        const mine = sortedById(c.rows('storefront').filter((s) => s.ownerUserId === c.params[0]));
        if (c.locking) for (const s of mine) await c.lockRow('storefront', s.id);
        return sortedById(c.rows('storefront').filter((s) => s.ownerUserId === c.params[0])).map((s) => ({ id: s.id, type: s.type, isPartner: s.isPartner === true }));
      },
    },
    {
      // duyệt hồ sơ (role, isBlocked, metadata, phone, staffPermissions) và setUserRole (metadata): cùng khoá dòng users
      match: /FROM "users" WHERE "id" = \?/,
      run: async (c) => {
        const id = c.params[0] as string;
        if (c.locking) await c.lockRow('user', id);
        const u = c.rows('user').find((r) => r.id === id);
        return u ? [{ role: u.role, isBlocked: u.isBlocked, metadata: u.metadata ?? null, phone: u.phone ?? null, staffPermissions: u.staffPermissions ?? [] }] : [];
      },
    },
    {
      match: /FROM "role_grants" WHERE "phone" = \?/,
      run: async (c) => {
        const phone = c.params[0] as string;
        if (c.locking) for (const g of sortedById(c.rows('roleGrant').filter((r) => r.phone === phone))) await c.lockRow('roleGrant', g.id);
        return sortedById(c.rows('roleGrant').filter((r) => r.phone === phone)).map((g) => ({ id: g.id }));
      },
    },
    {
      match: /FROM "dealer_tiers" WHERE "id" = \?/,
      run: async (c) => {
        const id = c.params[0] as string;
        if (c.locking) await c.lockRow('dealerTier', id);
        const t = c.rows('dealerTier').find((r) => r.id === id);
        return t ? [t] : [];
      },
    },
  );

  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify };
  const rbac = opts.realRbac ? new RbacService(db.client) : { revokeGrantsAbove: jest.fn().mockResolvedValue(0) };
  const fulfilment = { settlementConfig: jest.fn().mockResolvedValue({}), clearPartnerOnRoleLoss: jest.fn().mockResolvedValue(undefined) };
  const config = { get: async (_key: string, fallback: unknown) => fallback };
  const none = {} as never;
  const admin = new AdminService(db.client, config as never, none, none, notifications as never, none, none, rbac as never, none, none, fulfilment as never, undefined);
  const dealer = new DealerService(db.client, config as never, notifications as never);
  const accounts = new DealerAccountsAdminService(db.client, config as never);
  return { db, admin, dealer, accounts, notify, rbac };
}

export const applyDto = (over: Record<string, unknown> = {}) => ({
  businessName: 'Cửa hàng An Phát',
  ownerName: 'Nguyễn Văn An',
  phone: '0911111111',
  address: '12 Lê Lợi, Quận 1',
  cccdFrontUrl: 'data:image/jpeg;base64,AA',
  cccdBackUrl: 'data:image/jpeg;base64,BB',
  ...over,
});

export const pendingApp = (id: string, userId = 'u1', over: Record<string, unknown> = {}) => ({
  id,
  userId,
  businessName: 'Cửa hàng An Phát',
  ownerName: 'Nguyễn Văn An',
  phone: '0911111111',
  address: '12 Lê Lợi, Quận 1',
  cccdFrontUrl: 'x',
  cccdBackUrl: 'y',
  status: 'PENDING',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  createdAt: new Date('2026-11-09T03:00:00Z'),
  ...over,
});

export const httpStatus = (r: PromiseSettledResult<unknown>): number | null =>
  r.status === 'rejected' && typeof (r.reason as any)?.getStatus === 'function' ? (r.reason as any).getStatus() : null;

export const messageOf = (r: PromiseSettledResult<unknown>): string => {
  if (r.status !== 'rejected') return '';
  const resp = (r.reason as any)?.getResponse?.();
  if (typeof resp === 'string') return resp;
  return resp?.message ?? (r.reason as Error)?.message ?? '';
};
