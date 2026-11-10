/* eslint-disable @typescript-eslint/no-explicit-any -- client giả tạo model theo tên bảng lúc chạy nên kiểu dòng/where là động */
import { GroupBuyService } from '../../src/modules/groupbuy/groupbuy.service';
import { RaceDb, tick, type TableSpec } from './race-db.fake';
import { pgLikeClient } from './race-db-client';

/**
 * Dựng RaceDb cho test đua của Mua chung (groupbuy) trên GroupBuyService THẬT. Chỉ cơ sở dữ liệu, cấu hình và dịch vụ thông báo được giả.
 *
 * RaceDb chưa có hai thứ mà GroupBuyService dùng, bộ chuyển ở đây bù lại (không sửa race-db.fake.ts):
 *  - `groupBuy.create({ data: { members: { create } } })` (ghi lồng): tách thành hai câu INSERT cùng transaction như Prisma.
 *  - khoá advisory `pg_advisory_xact_lock(hashtext(...))` của `create()` (trần số nhóm mở của một khách): handler khoá theo chuỗi tham số.
 *
 * Mọi câu của model/raw đi qua `hooks.before(tên, args)` TRƯỚC khi chạm DB giả, để test chèn một sự kiện đúng giữa hai câu của service
 * (ví dụ cron đóng nhóm giữa lúc kiểm trước và lúc tăng chỗ của `join`) hoặc bước đồng hồ giả. Đây là chỗ DỰNG LẠI thời điểm; hành vi
 * của service vẫn là mã thật.
 */
export interface Notice {
  userId: string;
  type: string;
  vars: Record<string, unknown>;
}

export interface Flip {
  groupId: string;
  to: string;
  count: number;
}

export interface Hooks {
  before?: (name: string, args: any) => unknown;
}

export const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};

export function groupBuyTables(): Record<string, TableSpec> {
  return {
    user: {},
    product: {},
    variation: {},
    groupBuy: { defaults: { currentSize: 0, status: 'OPEN', couponsGrantedAt: null }, relations: { product: { table: 'product', fk: 'productId' } } },
    groupBuyMember: { unique: [{ fields: ['groupBuyId', 'userId'] }] },
    coupon: { unique: [{ fields: ['code'] }] },
  };
}

function instrument(client: any, hooks: Hooks, flips: Flip[]): any {
  const out: any = { ...client };
  const run = async (name: string, args: any) => {
    const r = hooks.before?.(name, args);
    if (r instanceof Promise) await r;
  };
  for (const [table, model] of Object.entries<any>(client)) {
    if (!model || typeof model.findMany !== 'function') continue;
    const wrapped: any = {};
    for (const [method, fn] of Object.entries<any>(model)) {
      wrapped[method] = async (args: any) => {
        await run(`${table}.${method}`, args);
        // RaceDb chỉ nối quan hệ qua `include`; `select: { product: ... }` của expireGroups cần cùng kết quả.
        const call = table === 'groupBuy' && method === 'findMany' && args?.select?.product ? { ...args, select: undefined, include: { product: true } } : args;
        const result = await fn(call);
        if (table === 'groupBuy' && method === 'updateMany' && args?.data?.status) {
          flips.push({ groupId: args.where?.id, to: args.data.status, count: result.count });
        }
        return result;
      };
    }
    out[table] = wrapped;
  }
  for (const raw of ['$queryRaw', '$executeRaw']) {
    out[raw] = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      await run(raw, { sql: strings.join('?'), values });
      return client[raw](strings, ...values);
    };
  }
  // Prisma ghi lồng `members: { create }` trong cùng một transaction với dòng cha.
  const baseCreate = out.groupBuy.create;
  out.groupBuy.create = async (args: any) => {
    const { members, ...data } = args.data;
    const row = await baseCreate({ ...args, data: { createdAt: new Date(), ...data } });
    if (members?.create) await out.groupBuyMember.create({ data: { groupBuyId: row.id, userId: members.create.userId, joinedAt: new Date() } });
    return row;
  };
  if (typeof client.$transaction === 'function') {
    out.$transaction = (fn: (tx: any) => Promise<unknown>) => client.$transaction((tx: any) => fn(instrument(tx, hooks, flips)));
  }
  return out;
}

export interface GroupBuySetup {
  db: RaceDb;
  svc: GroupBuyService;
  hooks: Hooks;
  notices: Notice[];
  flips: Flip[];
  /** Cấu hình hệ thống giả (`groupbuy.*`); sửa trước khi gọi service. */
  config: Record<string, unknown>;
  seedGroup(over?: SeedGroup): string;
  successNotices(userId: string): Notice[];
  couponsOf(groupId: string): Record<string, any>[];
  membersOf(groupId: string): string[];
}

export interface SeedGroup {
  id?: string;
  targetSize?: number;
  /** Người đầu là người mở nhóm. */
  members?: string[];
  status?: 'OPEN' | 'SUCCESS' | 'FAILED';
  expiresAt?: Date;
  couponsGrantedAt?: Date | null;
  productId?: string;
}

export const USERS = ['owner', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6'];

export function setupGroupBuy(opts: { config?: Record<string, unknown> } = {}): GroupBuySetup {
  const db = new RaceDb(groupBuyTables());
  const hooks: Hooks = {};
  const notices: Notice[] = [];
  const flips: Flip[] = [];
  const config: Record<string, unknown> = { ...opts.config };

  db.seed(
    'user',
    USERS.map((id) => ({ id, phone: `09${id.padEnd(8, '0')}`, zaloId: null })),
  );
  db.seed('product', [
    { id: 'p1', name: 'Nước rửa chén', slug: 'nuoc-rua-chen', thumbnail: null, isActive: true, approvalStatus: 'APPROVED', storefrontId: null, fulfilment: 'TUBU', basePrice: 100_000, salePrice: null },
  ]);
  db.seed('variation', [{ id: 'v1', sku: 'S1', productId: 'p1', isActive: true, retailPrice: 100_000, salePrice: null, stock: 10 }]);

  // Advisory lock: chỉ khoá khi chính câu SQL gọi pg_advisory_xact_lock( (không khớp biến thể _shared).
  db.handlers.push({ match: /pg_advisory_xact_lock\(/, run: (c) => c.lockKey(c.params.join('|')).then(() => 1) });

  const client = instrument(pgLikeClient(db), hooks, flips);
  const configService = { get: async (key: string, fallback: unknown) => (key in config ? config[key] : fallback) };
  const notifications = {
    notify: async (userId: string, type: string, vars: Record<string, unknown>) => {
      notices.push({ userId, type, vars });
    },
  };
  const svc = new GroupBuyService(client as never, configService as never, notifications as never);

  let seq = 0;
  return {
    db,
    svc,
    hooks,
    notices,
    flips,
    config,
    seedGroup(over: SeedGroup = {}) {
      const id = over.id ?? `g${++seq}`;
      const members = over.members ?? ['owner', 'u1'];
      db.seed('groupBuy', [
        {
          id,
          productId: over.productId ?? 'p1',
          initiatorId: members[0],
          targetSize: over.targetSize ?? 3,
          currentSize: members.length,
          unitPrice: 85_000,
          basePrice: 100_000,
          status: over.status ?? 'OPEN',
          expiresAt: over.expiresAt ?? new Date(Date.now() + 24 * 3600e3),
          createdAt: new Date(Date.now() - 3600e3),
          couponsGrantedAt: over.couponsGrantedAt ?? null,
        },
      ]);
      db.seed(
        'groupBuyMember',
        members.map((userId) => ({ groupBuyId: id, userId, joinedAt: new Date() })),
      );
      return id;
    },
    successNotices: (userId) => notices.filter((n) => n.userId === userId && n.type === 'GROUP_BUY_SUCCESS'),
    couponsOf: (groupId) => db.rows('coupon').filter((c) => c.scopeMeta?.groupBuyId === groupId),
    membersOf: (groupId) => db.rows('groupBuyMember').filter((m) => m.groupBuyId === groupId).map((m) => m.userId as string),
  };
}

/**
 * Điều kiện luôn đúng của mọi nhóm sau mọi xen kẽ; trả danh sách vi phạm (rỗng = đúng) để test báo kèm nhãn lần quét.
 *  - số thành viên == currentSize <= targetSize, không thành viên trùng;
 *  - nhóm SUCCESS thì đủ targetSize; nhóm chưa SUCCESS thì không có mã nào;
 *  - mỗi mã thuộc đúng một thành viên của nhóm, mỗi thành viên không quá một mã; couponsGrantedAt chỉ đặt khi mọi thành viên đã có mã;
 *  - mỗi mã được báo GROUP_BUY_SUCCESS không quá một lần.
 */
export function violations(s: GroupBuySetup): string[] {
  const out: string[] = [];
  for (const g of s.db.rows('groupBuy')) {
    const members = s.membersOf(g.id);
    const coupons = s.couponsOf(g.id);
    if (new Set(members).size !== members.length) out.push(`${g.id}: thành viên trùng ${members.join(',')}`);
    if (g.currentSize !== members.length) out.push(`${g.id}: currentSize ${g.currentSize} lệch ${members.length} thành viên`);
    if (g.currentSize > g.targetSize) out.push(`${g.id}: currentSize ${g.currentSize} vượt targetSize ${g.targetSize}`);
    if (g.status === 'SUCCESS' && g.currentSize !== g.targetSize) out.push(`${g.id}: SUCCESS nhưng ${g.currentSize}/${g.targetSize}`);
    if (g.status !== 'SUCCESS' && coupons.length > 0) out.push(`${g.id}: ${g.status} mà đã có ${coupons.length} mã`);
    const owners = coupons.map((c) => c.scopeMeta.userId as string);
    if (new Set(owners).size !== owners.length) out.push(`${g.id}: một thành viên có hai mã`);
    for (const o of owners) if (!members.includes(o)) out.push(`${g.id}: mã cấp cho người ngoài nhóm ${o}`);
    if (g.couponsGrantedAt && owners.length !== members.length) out.push(`${g.id}: đã đánh dấu phát đủ mã nhưng ${owners.length}/${members.length} thành viên có mã`);
  }
  const codes = s.notices.filter((n) => n.type === 'GROUP_BUY_SUCCESS').map((n) => String(n.vars.code));
  if (new Set(codes).size !== codes.length) out.push(`mã báo trùng: ${codes.join(',')}`);
  return out;
}
