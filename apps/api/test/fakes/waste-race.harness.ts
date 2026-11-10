/* eslint-disable @typescript-eslint/no-explicit-any -- client giả tạo model theo tên bảng lúc chạy nên kiểu dòng/where là động */
import { RaceDb, type RawContext, type TableSpec } from './race-db.fake';

/**
 * Dựng RaceDb cho test đua của Đổi rác lấy quà (waste-exchange) trên dịch vụ THẬT: bảng + ràng buộc unique khớp migration 20261020000000_waste_exchange,
 * các câu SQL thô mà dịch vụ dùng (khoá dòng yêu cầu, khoá advisory, số dư, tồn quà), và bộ chuyển cho hai chỗ client giả chưa có:
 * `pointsTransaction.createManyAndReturn` (applyPointsDelta ghi dòng thưởng bằng nó) và `include: { lines }` của wasteRequest (quan hệ một-nhiều).
 *
 * Hai công tắc để chứng minh TỪNG tầng bảo vệ chứ không để tầng này gánh cho tầng kia:
 *  - `selectForUpdate: false` bỏ khoá `SELECT ... FOR UPDATE` (câu UPDATE vẫn giữ khoá dòng và xét lại WHERE như Postgres) ⇒ chỉ còn CAS có điều kiện.
 *  - `ledgerUnique: false` bỏ các partial unique của sổ điểm (RECYCLE / RECYCLE_REVERSED / GIFT_REFUND) ⇒ unique không gánh thay CAS.
 *  - `advisoryLocks: false` bỏ `pg_advisory_xact_lock` (khoá khách / vận đơn / trần nhân viên) ⇒ khoá advisory không xếp hàng thay CAS.
 */
export interface WasteRaceOptions {
  selectForUpdate?: boolean;
  ledgerUnique?: boolean;
  advisoryLocks?: boolean;
}

const CREATED = new Date('2026-11-10T00:00:00Z');
const ledgerKey = (refType: string) => ({ fields: ['refId'], when: (r: Record<string, any>) => r.refType === refType });

export function wasteRaceTables(ledgerUnique = true): Record<string, TableSpec> {
  return {
    user: {},
    order: {},
    wasteRequest: {
      unique: [{ fields: ['code'] }, { fields: ['userId', 'idempotencyKey'] }, { fields: ['orderId'] }],
      relations: { user: { table: 'user', fk: 'userId' }, order: { table: 'order', fk: 'orderId' } },
    },
    wasteRequestLine: {},
    wasteEvent: { defaults: { createdAt: new Date() } },
    wasteUnmatchedParcel: { defaults: { status: 'OPEN' } },
    wasteUserFlags: {},
    wastePoint: {},
    pointsTransaction: {
      defaults: { lot: 'STANDARD', createdAt: CREATED },
      unique: ledgerUnique ? [ledgerKey('RECYCLE'), ledgerKey('RECYCLE_REVERSED'), ledgerKey('GIFT_REFUND')] : [],
    },
    coinTransaction: {},
    wasteGift: {},
    wasteGiftRedemption: { unique: [{ fields: ['code'] }, { fields: ['userId', 'idempotencyKey'] }] },
  };
}

function installHandlers(db: RaceDb, selectForUpdate: boolean, advisoryLocks: boolean): void {
  const lockIf = (c: RawContext, table: string, id: string) => (c.locking && selectForUpdate ? c.lockRow(table, id) : Promise.resolve());

  db.handlers.push(
    {
      // lockPickupRequestForCheckout: điều kiện WHERE xét lại trên bản mới nhất sau khi giành được khoá (EvalPlanQual).
      match: /FROM "waste_requests"\s+WHERE "id" = \? AND "userId" = \? AND "method" = 'PICKUP'/,
      run: async (c) => {
        const [id, userId] = c.params as string[];
        const fits = (r: Record<string, any>) => r.id === id && r.userId === userId && r.method === 'PICKUP' && r.status === 'OPEN' && r.orderId == null;
        const out: Record<string, any>[] = [];
        for (const cand of c.rows('wasteRequest').filter(fits)) {
          await lockIf(c, 'wasteRequest', cand.id);
          const fresh = c.rows('wasteRequest').find((r) => r.id === cand.id);
          if (fresh && fits(fresh)) out.push({ id: fresh.id, code: fresh.code });
        }
        return out;
      },
    },
    {
      // Yêu cầu của khách khoá theo (id, userId): huỷ, sửa, nhập mã vận đơn.
      match: /FROM waste_requests WHERE id = \? AND "userId" = \?/,
      run: async (c) => {
        const [id, userId] = c.params as string[];
        await lockIf(c, 'wasteRequest', id!);
        const r = c.rows('wasteRequest').find((x) => x.id === id && x.userId === userId);
        return r
          ? [
              {
                id: r.id,
                method: r.method,
                status: r.status,
                orderId: r.orderId ?? null,
                closeReason: r.closeReason ?? null,
                carrier: r.carrier ?? null,
                trackingCode: r.trackingCode ?? null,
                trackingNorm: r.trackingNorm ?? null,
                pointId: r.pointId ?? null,
                capDayKey: r.capDayKey ?? null,
                capMonthKey: r.capMonthKey ?? null,
              },
            ]
          : [];
      },
    },
    {
      match: /SELECT "id" FROM "waste_requests" WHERE "id" = \?/,
      run: async (c) => {
        await lockIf(c, 'wasteRequest', c.params[0] as string);
        return c.rows('wasteRequest').filter((r) => r.id === c.params[0]).map((r) => ({ id: r.id }));
      },
    },
    {
      match: /SELECT "pointsBalance" FROM "users" WHERE "id" = \?/,
      run: async (c) => {
        await lockIf(c, 'user', c.params[0] as string);
        return [{ pointsBalance: c.rows('user').find((u) => u.id === c.params[0])?.pointsBalance ?? 0 }];
      },
    },
    // Đánh dấu trùng mã vận đơn giữa hai khách: các test này không có yêu cầu của khách khác nên không dòng nào bị đổi.
    { match: /UPDATE waste_requests r SET "trackingConflict"/, run: () => 0 },
    { match: /pg_advisory_xact_lock/, run: (c) => (advisoryLocks ? c.lockKey(`${c.sql.replace(/\s+/g, ' ')}|${c.params.join('|')}`) : Promise.resolve()).then(() => 1) },
    {
      match: /UPDATE "waste_gifts" SET "stock" = "stock" \+ 1/,
      run: async (c) => (await c.client.wasteGift.updateMany({ where: { id: c.params[0], stock: { not: null } }, data: { stock: { increment: 1 } } })).count,
    },
  );
}

const linesOf = (client: any, row: any, args: any) =>
  client.wasteRequestLine.findMany({ where: { requestId: row.id }, ...(args.include.lines?.orderBy ? { orderBy: args.include.lines.orderBy } : {}) });

/** `applyPointsDelta` ghi dòng thưởng bằng createManyAndReturn; dựng lại trên createMany(skipDuplicates) = ON CONFLICT DO NOTHING của client giả. */
export function adaptClient(client: any, counter = { n: 0 }): any {
  const adapted: Record<string, any> = {
    ...client,
    pointsTransaction: {
      ...client.pointsTransaction,
      createManyAndReturn: async ({ data, skipDuplicates }: { data: Record<string, any>[]; skipDuplicates?: boolean }) => {
        const out: { id: string }[] = [];
        for (const d of data) {
          const id = `pt-${++counter.n}`;
          const { count } = await client.pointsTransaction.createMany({ data: [{ ...d, id }], skipDuplicates });
          if (count > 0) out.push({ id });
        }
        return out;
      },
    },
    // WasteRequestsService.editInTx xoá dòng cũ bằng deleteMany; client giả chỉ có delete theo khoá, nên dựng từ findMany + delete từng dòng.
    wasteRequestLine: {
      ...client.wasteRequestLine,
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const rows: { id: string }[] = await client.wasteRequestLine.findMany({ where });
        for (const r of rows) await client.wasteRequestLine.delete({ where: { id: r.id } });
        return { count: rows.length };
      },
    },
    wasteRequest: {
      ...client.wasteRequest,
      findUnique: async (args: any) => {
        const row = await client.wasteRequest.findUnique(args);
        if (row && args?.include?.lines) {
          row.lines = (await linesOf(client, row, args)).map((l: any) => ({ ...l, item: { warehouseOnly: false, hazardous: false } }));
        }
        return row;
      },
    },
  };
  if (client.$transaction) adapted.$transaction = (arg: any) => (typeof arg === 'function' ? client.$transaction((tx: any) => arg(adaptClient(tx, counter))) : client.$transaction(arg));
  return adapted;
}

export function createWasteRaceDb(opts: WasteRaceOptions = {}): { db: RaceDb; prisma: any } {
  const db = new RaceDb(wasteRaceTables(opts.ledgerUnique ?? true));
  installHandlers(db, opts.selectForUpdate ?? true, opts.advisoryLocks ?? true);
  return { db, prisma: adaptClient(db.client) };
}

export const user = (id: string, phone: string, over: Record<string, unknown> = {}) => ({
  id,
  role: 'CUSTOMER',
  phone,
  isBlocked: false,
  mergedIntoId: null,
  pointsBalance: 0,
  metadata: null,
  ...over,
});

export const warehouse = { id: 'wh', kind: 'WAREHOUSE', name: 'Kho Tubu', status: 'ACTIVE', giftHandoverEnabled: true, monthlyQuotaPoints: null };

/** Yêu cầu mang rác tới kho: 10 thùng carton, mỗi thùng 1.000 điểm = 10.000 điểm. */
export const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  code: 'TR-ABCDE',
  userId: 'u1',
  method: 'DROP_OFF',
  status: 'OPEN',
  pointId: 'wh',
  orderId: null,
  carrier: null,
  trackingCode: null,
  trackingNorm: null,
  estimatedPoints: 10_000,
  confirmedByUserId: null,
  pointsAwarded: null,
  dropsAwarded: null,
  closeReason: null,
  rejectionReason: null,
  expiresAt: null,
  completedAt: null,
  ...over,
});

export const cartonLine = (requestId = 'r1', over: Record<string, unknown> = {}) => ({
  id: `${requestId}-l1`,
  requestId,
  itemId: 'wi-carton',
  declaredQty: 10,
  receivedQty: null,
  shortfallReason: null,
  unitsPerPoint: 1,
  pointsPerGroup: 1000,
  dropsPerUnit: 0,
  gramsPerUnit: null,
  ...over,
});
