/* eslint-disable @typescript-eslint/no-explicit-any -- client giả tạo model theo tên bảng lúc chạy nên kiểu dòng/where là động */
import { Prisma } from '@prisma/client';
import { RaceDb, type TableSpec } from './race-db.fake';
import { pgLikeClient } from './race-db-client';

/**
 * RaceDb cho test đua của sự kiện cộng đồng (CommunityFeedService + CommunityRewardService + RewardPointsService THẬT).
 *
 * Client giả (race-db.fake.ts) chưa có ba thứ mà các đường này dùng, nên bọc lại ở đây (không sửa file gốc):
 *  - `where` JSON của bài: `meta: { path: ['eventId'], equals }` và `meta: { equals: Prisma.DbNull }` dịch sang cột phẳng `metaEventId`;
 *    `images: { equals: [...] }` (so mảng) dịch sang `imagesKey` (JSON của mảng). Hai cột này chỉ có ở bản giả, ghi lúc `create`.
 *  - `select` quan hệ `productTags`/`tags` của feedPost.findMany: các test này không gắn sản phẩm/thẻ nên trả mảng rỗng.
 *  - `pointsTransaction.createManyAndReturn` (applyPointsDelta ghi dòng thưởng bằng nó): dựng trên createMany(skipDuplicates) = ON CONFLICT DO NOTHING.
 * Và đúng như Postgres, `create` bỏ khoá có giá trị `undefined` (để cột lấy giá trị mặc định thay vì ghi đè bằng undefined).
 *
 * Khoá advisory khớp CHÍNH XÁC /pg_advisory_xact_lock\(/ (không khớp biến thể _shared). Khoá dòng người nhận thưởng (SELECT ... FROM "users")
 * chỉ áp khi chính chuỗi SQL còn chứa FOR NO KEY UPDATE (cờ `locking`): bỏ đoạn đó khỏi dịch vụ thì khoá biến mất và thưởng đôi lộ ra, thay vì
 * handler không khớp và lỗi bị nuốt. Ràng buộc unique của sổ điểm: partial unique `reason` WHERE refType = 'COMMUNITY' (migration 20261012100000).
 */

export function communityRaceTables(): Record<string, TableSpec> {
  return {
    user: { defaults: { pointsBalance: 0, pointsConvertedBalance: 0 } },
    order: {},
    communityProfile: {},
    communityEvent: { defaults: { status: 'OPEN', rewardXu: 0, rewardPoints: 0, description: null, coverUrl: null, winnerUserId: null } },
    feedPost: { defaults: { images: [], title: null, categoryId: null } },
    pointsTransaction: { defaults: { lot: 'STANDARD' }, unique: [{ fields: ['reason'], when: (r) => r.refType === 'COMMUNITY' }] },
    coinTransaction: {},
  };
}

const isPlain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
const dropUndefined = (data: Record<string, any>) => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

function translateWhere(where: any): any {
  if (!isPlain(where)) return where;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      out[key] = Array.isArray(value) ? value.map(translateWhere) : translateWhere(value);
    } else if (key === 'meta' && isPlain(value)) {
      if (Array.isArray(value.path)) {
        if (value.path.length !== 1 || value.path[0] !== 'eventId') throw new Error('w101a: chỉ hỗ trợ where meta.path = ["eventId"]');
        out.metaEventId = value.equals;
      } else if (value.equals === Prisma.DbNull) out.metaEventId = null;
      else throw new Error('w101a: where meta chưa hỗ trợ');
    } else if (key === 'images' && isPlain(value) && Array.isArray(value.equals)) {
      out.imagesKey = JSON.stringify(value.equals);
    } else out[key] = value;
  }
  return out;
}

function wrap(client: any, counter: { n: number }): any {
  const feedPost = client.feedPost;
  const wrapped: Record<string, any> = {
    ...client,
    feedPost: {
      ...feedPost,
      create: (args: any) => {
        const data = dropUndefined(args.data);
        return feedPost.create({
          ...args,
          data: { ...data, createdAt: data.createdAt ?? new Date(), metaEventId: data.meta?.eventId ?? null, imagesKey: JSON.stringify(data.images ?? []) },
        });
      },
      findMany: async (args: any) => {
        const rows = await feedPost.findMany({ ...args, where: translateWhere(args?.where) });
        return rows.map((r: any) => ({ ...r, ...(args?.select?.productTags ? { productTags: [] } : {}), ...(args?.select?.tags ? { tags: [] } : {}) }));
      },
      findFirst: (args: any) => feedPost.findFirst({ ...args, where: translateWhere(args?.where) }),
      count: (args: any) => feedPost.count({ ...args, where: translateWhere(args?.where) }),
    },
    communityEvent: {
      ...client.communityEvent,
      create: (args: any) => client.communityEvent.create({ ...args, data: { createdAt: new Date(), ...dropUndefined(args.data) } }),
    },
    pointsTransaction: {
      ...client.pointsTransaction,
      createManyAndReturn: async ({ data, skipDuplicates }: { data: Record<string, any>[]; skipDuplicates?: boolean }) => {
        const out: { id: string }[] = [];
        for (const d of data) {
          const id = `pt-${++counter.n}`;
          const { count } = await client.pointsTransaction.createMany({ data: [{ createdAt: new Date(), ...d, id }], skipDuplicates });
          if (count > 0) out.push({ id });
        }
        return out;
      },
    },
  };
  if (typeof client.$transaction === 'function') {
    wrapped.$transaction = (fn: (tx: any) => Promise<unknown>) => client.$transaction((tx: any) => fn(wrap(tx, counter)));
  }
  return wrapped;
}

export function createCommunityRaceDb(): { db: RaceDb; prisma: any } {
  const db = new RaceDb(communityRaceTables());
  db.handlers.push(
    {
      match: /pg_advisory_xact_lock\(/,
      run: (c) => c.lockKey(`${c.sql.replace(/\s+/g, ' ')}|${c.params.join('|')}`).then(() => 1),
    },
    // rewardWithDailyCap khoá dòng người nhận; handler khớp câu SELECT khoá người dùng dù có hay không có FOR NO KEY UPDATE, và chỉ khoá khi còn.
    {
      match: /SELECT 1 FROM "users" WHERE "id" = \?/,
      run: async (c) => {
        if (c.locking) await c.lockRow('user', c.params[0] as string);
        return [{ '?column?': 1 }];
      },
    },
  );
  return { db, prisma: wrap(pgLikeClient(db), { n: 0 }) };
}

/** Bài dự thi đã seed thẳng vào DB giả: ghi luôn hai cột phẳng mà `create` của client bọc sẽ ghi. */
export const eventEntry = (id: string, userId: string, eventId: string | null, over: Record<string, unknown> = {}) => ({
  id,
  userId,
  kind: 'SHOWCASE',
  title: null,
  body: `Bài dự thi ${id}`,
  images: [],
  imagesKey: '[]',
  categoryId: null,
  status: 'PUBLISHED',
  meta: eventId ? { eventId } : null,
  metaEventId: eventId,
  createdAt: new Date(),
  ...over,
});
