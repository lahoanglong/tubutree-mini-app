/* eslint-disable @typescript-eslint/no-explicit-any -- bọc client Prisma giả tạo model theo tên bảng lúc chạy nên kiểu client/dòng là động */
import { RaceDb, tick, type RawContext } from './race-db.fake';

/**
 * Phụ trợ cho test đua thưởng giới thiệu / thưởng mốc CTV trên DB giả (race-db.fake.ts).
 * - `withCreateManyAndReturn`: applyPointsDelta chèn dòng điểm bằng createManyAndReturn (ON CONFLICT DO NOTHING) mà DB giả chỉ có createMany.
 *   Cũng đổi toán tử `endsWith` (DB giả chưa hỗ trợ) thành `contains` ở findMany/findFirst: findOrderGrants (referral-reward.ts) tìm dòng thưởng theo
 *   refId "<đơn đầu>:<đơn hai>" rồi lọc lại đúng từng id nên `contains` chỉ lấy rộng hơn, không đổi kết quả với id đơn không là hậu tố của nhau.
 * - `addUserLockHandlers`: ba câu SQL thô khoá dòng users (người được mời, người mời, CTV). Handler chỉ khoá khi chuỗi SQL còn FOR UPDATE /
 *   FOR NO KEY UPDATE (cờ `locking`), nên bỏ khoá ở mã thật thì DB giả cũng bỏ theo.
 * - `addReferralRewardedOrdersHandler`: câu JOIN thô của findReferralRewardedOrders.
 */
export const delay = async (n: number): Promise<void> => {
  for (let i = 0; i < Math.max(0, n); i++) await tick();
};

/** Chạy hai việc xen kẽ: skew > 0 thì `b` bắt đầu trễ skew nhịp, skew < 0 thì `a` trễ. */
export function raceWithSkew<A, B>(skew: number, a: () => Promise<A>, b: () => Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  return Promise.allSettled([
    (async () => {
      await delay(-skew);
      return a();
    })(),
    (async () => {
      await delay(skew);
      return b();
    })(),
  ]);
}

export const range = (from: number, to: number, step = 1): number[] => {
  const out: number[] = [];
  for (let i = from; i <= to; i += step) out.push(i);
  return out;
};

let idSeq = 0;

type AnyClient = Record<string, any>;

const endsWithAsContains = (where: unknown): unknown => {
  if (Array.isArray(where)) return where.map(endsWithAsContains);
  if (!where || typeof where !== 'object' || where instanceof Date) return where;
  return Object.fromEntries(Object.entries(where).map(([k, v]) => (k === 'endsWith' ? ['contains', v] : [k, endsWithAsContains(v)])));
};

export function withCreateManyAndReturn<T extends AnyClient>(client: T): T {
  const wrap = (c: AnyClient): AnyClient => {
    const out: AnyClient = { ...c };
    for (const [key, model] of Object.entries(c)) {
      if (model && typeof model === 'object' && typeof (model as AnyClient).createMany === 'function') {
        const m = model as AnyClient;
        out[key] = {
          ...m,
          findMany: (args?: AnyClient) => m.findMany(args?.where ? { ...args, where: endsWithAsContains(args.where) } : args),
          findFirst: (args?: AnyClient) => m.findFirst(args?.where ? { ...args, where: endsWithAsContains(args.where) } : args),
          createManyAndReturn: async (args: { data: AnyClient | AnyClient[]; skipDuplicates?: boolean }) => {
            const rows: { id: string }[] = [];
            for (const d of Array.isArray(args.data) ? args.data : [args.data]) {
              const row = { ...d, id: d.id ?? `w96a-${String(++idSeq).padStart(6, '0')}` };
              const res = await m.createMany({ data: [row], skipDuplicates: args.skipDuplicates });
              if (res.count > 0) rows.push({ id: row.id });
            }
            return rows;
          },
        };
      }
    }
    if (typeof c.$transaction === 'function') {
      out.$transaction = (arg: unknown, ...rest: unknown[]) =>
        typeof arg === 'function' ? c.$transaction((tx: AnyClient) => (arg as (t: AnyClient) => unknown)(wrap(tx)), ...rest) : c.$transaction(arg, ...rest);
    }
    return out;
  };
  return wrap(client) as T;
}

type UserRow = Record<string, any>;
const userOf = (c: RawContext): UserRow | undefined => c.rows('user').find((r) => r.id === c.params[0]);

/**
 * `locks: false` bỏ khoá hàng của cả ba câu: dựng lại tình huống "khoá dòng users không có" để chứng minh lớp phòng thủ thứ hai
 * (unique index, CAS `updateMany`, ON CONFLICT DO NOTHING) tự đứng được, không dựa vào khoá.
 */
export function addUserLockHandlers(db: RaceDb, { locks = true }: { locks?: boolean } = {}): void {
  db.handlers.push(
    {
      // lockReferrer (FOR UPDATE): trả hai lô số dư SAU khi có khoá, tới lượt mình thì đọc bản mới nhất của người trước.
      match: /SELECT "pointsBalance", "pointsConvertedBalance" FROM "users" WHERE "id" = \?/,
      run: async (c) => {
        if (locks && c.locking) await c.lockRow('user', c.params[0] as string);
        const u = userOf(c);
        return u ? [{ pointsBalance: u.pointsBalance ?? 0, pointsConvertedBalance: u.pointsConvertedBalance ?? 0 }] : [];
      },
    },
    {
      // lockCtvForMilestones (FOR NO KEY UPDATE)
      match: /SELECT "pointsBalance" FROM "users" WHERE "id" = \?/,
      run: async (c) => {
        if (locks && c.locking) await c.lockRow('user', c.params[0] as string);
        const u = userOf(c);
        return u ? [{ pointsBalance: u.pointsBalance ?? 0 }] : [];
      },
    },
    {
      // lockReferee (FOR NO KEY UPDATE) và khoá dòng users của lần gộp
      match: /SELECT "id" FROM "users" WHERE "id" = \?/,
      run: async (c) => {
        if (locks && c.locking) await c.lockRow('user', c.params[0] as string);
        return userOf(c) ? [{ id: c.params[0] }] : [];
      },
    },
  );
}

export function addReferralRewardedOrdersHandler(db: RaceDb): void {
  db.handlers.push({
    match: /FROM "coin_transactions" WHERE "refType" = 'REFERRAL'/,
    run: (c) => {
      const [prefix, refereeId] = c.params as [string, string];
      const grants = [...c.rows('coinTransaction'), ...c.rows('pointsTransaction')].filter(
        (g) => g.refType === 'REFERRAL' && typeof g.reason === 'string' && g.reason.startsWith(prefix),
      );
      const orders = c.rows('order').filter((o) => o.userId === refereeId);
      const out: { orderId: string; referrerId: string }[] = [];
      for (const g of grants) {
        const ids = String(g.refId ?? '').split(':').slice(0, 2);
        for (const o of orders) if (ids.includes(o.id)) out.push({ orderId: o.id, referrerId: g.userId });
      }
      return out;
    },
  });
}
