/* eslint-disable @typescript-eslint/no-explicit-any -- client giả tạo model theo tên bảng lúc chạy nên kiểu dòng/client là động */
import { RaceDb, tick, type RawContext } from './race-db.fake';

/**
 * Cơ sở dữ liệu giả cho các test đua của giữ chỗ tồn kho Giờ vàng (FlashSaleService.consumeQuotas/restore, đặt đơn, huỷ đơn).
 * Mỗi handler dưới đây là phần tương đương trong Postgres của ĐÚNG câu SQL thô mà mã thật chạy. Điều kiện nào nằm trong chuỗi SQL (so cột
 * `quota`, khung giờ, `isActive`, FOR UPDATE, ORDER BY) thì handler chỉ áp khi chính chuỗi SQL còn chứa nó, nên sửa mã thật bỏ điều kiện
 * thì cơ sở dữ liệu giả cũng bỏ theo (đột biến không sống oan).
 */

/** Đoạn chữ đứng ngay trước mỗi tham số `?` của câu SQL (đoạn thứ i đứng trước tham số thứ i). */
const segments = (sql: string): string[] => sql.split('?');

/** Vị trí tham số đầu tiên mà đoạn chữ ngay trước nó khớp `re`; -1 nếu câu SQL không còn đoạn đó. */
const paramIndex = (c: RawContext, re: RegExp): number => segments(c.sql).findIndex((t, i) => i < c.params.length && re.test(t));

const cmp = (a: number, op: string, b: number): boolean => (op === '<=' ? a <= b : op === '<' ? a < b : op === '>=' ? a >= b : a > b);

export function flashHandlers(db: RaceDb): void {
  db.handlers.push(
    {
      // Trừ suất: một câu UPDATE có điều kiện (`soldCount + qty <= quota` và khung giờ của đợt) nên Postgres khoá dòng rồi xét lại WHERE trên bản mới nhất.
      match: /UPDATE flash_sale_items AS fsi/,
      run: async (c) => {
        const seg = segments(c.sql);
        const iSet = paramIndex(c, /SET "soldCount" = fsi\."soldCount" \+\s*$/);
        const iId = paramIndex(c, /fsi\.id\s*=\s*$/);
        const iQuota = paramIndex(c, /AND fsi\."soldCount" \+\s*$/);
        const iStart = paramIndex(c, /fs\."startAt"\s*(?:<=|<)\s*$/);
        const iEnd = paramIndex(c, /fs\."endAt"\s*(?:>=|>)\s*$/);
        const itemId = c.params[iId] as string;
        await c.lockRow('flashSaleItem', itemId);
        const item = c.rows('flashSaleItem').find((r) => r.id === itemId);
        if (!item) return 0;
        if (/EXISTS/.test(c.sql)) {
          // Điều kiện nối đợt nằm trong chuỗi SQL: bỏ `fs.id = fsi."flashSaleId"` thì EXISTS đúng với BẤT KỲ đợt nào đang chạy, như Postgres.
          const joined = /fs\.id = fsi\."flashSaleId"/.test(c.sql);
          const sales = c.rows('flashSale').filter((r) => !joined || r.id === item.flashSaleId);
          const live = sales.some((sale) => {
            if (/fs\."isActive" = true/.test(c.sql) && !sale.isActive) return false;
            if (iStart >= 0) {
              const op = /fs\."startAt"\s*(<=|<)\s*$/.exec(seg[iStart]!)![1]!;
              if (!cmp(sale.startAt.getTime(), op, (c.params[iStart] as Date).getTime())) return false;
            }
            if (iEnd >= 0) {
              const op = /fs\."endAt"\s*(>=|>)\s*$/.exec(seg[iEnd]!)![1]!;
              if (!cmp(sale.endAt.getTime(), op, (c.params[iEnd] as Date).getTime())) return false;
            }
            return true;
          });
          if (!live) return 0;
        }
        if (iQuota >= 0) {
          const op = /^\s*(<=|<)\s*fsi\."quota"/.exec(seg[iQuota + 1] ?? '')?.[1] ?? '<=';
          if (!cmp(item.soldCount + (c.params[iQuota] as number), op, item.quota)) return 0;
        }
        await c.client.flashSaleItem.updateMany({ where: { id: itemId }, data: { soldCount: { increment: c.params[iSet] as number } } });
        return 1;
      },
    },
    {
      // Khoá các dòng suất của khách (FOR NO KEY UPDATE), theo thứ tự ORDER BY khi câu còn có nó.
      match: /FROM "flash_sale_purchases"/,
      run: async (c) => {
        const [userId, ...ids] = c.params as string[];
        const mine = c.rows('flashSalePurchase').filter((r) => r.userId === userId && ids.includes(r.flashSaleItemId));
        if (/ORDER BY "flashSaleItemId"/.test(c.sql)) mine.sort((a, b) => (a.flashSaleItemId < b.flashSaleItemId ? -1 : a.flashSaleItemId > b.flashSaleItemId ? 1 : 0));
        if (c.locking) for (const r of mine) await c.lockRow('flashSalePurchase', r.id);
        return mine.map((r) => ({ flashSaleItemId: r.flashSaleItemId }));
      },
    },
    {
      match: /FROM "users" WHERE "id"/,
      run: async (c) => {
        if (c.locking) await c.lockRow('user', c.params[0] as string);
        const u = c.rows('user').find((r) => r.id === c.params[0]);
        return u ? [{ id: u.id, walletBalance: u.walletBalance, metadata: u.metadata ?? null }] : [];
      },
    },
    {
      match: /FROM "carts" WHERE "userId"/,
      run: async (c) => {
        const mine = c.rows('cart').filter((r) => r.userId === c.params[0]);
        if (c.locking) for (const r of mine) await c.lockRow('cart', r.id);
        return mine.map((r) => ({ id: r.id }));
      },
    },
    {
      match: /FROM "orders" WHERE "id"/,
      run: async (c) => {
        if (c.locking) await c.lockRow('order', c.params[0] as string);
        return c.rows('order').filter((o) => o.id === c.params[0]).map((o) => ({ id: o.id }));
      },
    },
    {
      match: /FROM "variations" WHERE "id" IN/,
      run: async (c) => {
        const ids = /ORDER BY "id"/.test(c.sql) ? [...(c.params as string[])].sort() : [...(c.params as string[])];
        for (const id of ids) {
          await c.lockRow('variation', id);
          await tick();
        }
        return ids.map((id) => ({ id }));
      },
    },
    {
      // Giữ kho: `stock >= qty` nằm trong câu UPDATE nên hai đơn tranh đơn vị cuối chỉ một bên sửa được dòng.
      match: /UPDATE "variations"[\s\S]*"stock" = "stock" - /,
      run: async (c) => {
        const iId = paramIndex(c, /WHERE "id" =\s*$/);
        const iQty = paramIndex(c, /"stock" >=\s*$/);
        const variationId = c.params[iId] as string;
        await c.lockRow('variation', variationId);
        const row = c.rows('variation').find((r) => r.id === variationId);
        if (!row) return 0;
        const qty = c.params[0] as number;
        if (iQty >= 0 && row.stock < (c.params[iQty] as number)) return 0;
        await c.client.variation.update({ where: { id: variationId }, data: { stock: { decrement: qty }, reservedStock: { increment: qty } } });
        return 1;
      },
    },
    {
      match: /UPDATE "variations"[\s\S]*"stock" = "stock" \+ /,
      run: async (c) => {
        const [qty, , variationId] = c.params as [number, number, string];
        await c.lockRow('variation', variationId);
        const row = c.rows('variation').find((r) => r.id === variationId);
        if (!row) return 0;
        await c.client.variation.update({ where: { id: variationId }, data: { stock: row.stock + qty, reservedStock: Math.max(0, row.reservedStock - qty) } });
        return 1;
      },
    },
    { match: /pg_advisory_xact_lock/, run: (c) => c.lockKey(c.params.join('|')).then(() => 1) },
  );
}

/** Các bảng mà đặt đơn, huỷ đơn và giữ suất Giờ vàng chạm tới. */
export function flashTables() {
  return {
    user: {},
    cart: {},
    cartItem: { relations: { cart: { table: 'cart', fk: 'cartId' } } },
    product: {},
    variation: { relations: { product: { table: 'product', fk: 'productId' } } },
    flashSale: {},
    flashSaleItem: {},
    flashSalePurchase: { unique: [{ fields: ['flashSaleItemId', 'userId'] }], defaults: { quantity: 0 } },
    order: { unique: [{ fields: ['code'] }], defaults: { placedForCustomer: false, subscriptionId: null, createdAt: new Date() } },
    orderStatusHistory: {},
    orderCustomerRefund: { unique: [{ fields: ['orderId', 'kind', 'refKey'] }] },
    walletTransaction: { unique: [{ fields: ['userId', 'type', 'refId'] }] },
    dealerCreditLedger: {},
    analyticsEvent: {},
    address: {},
    wasteRequest: {},
  };
}

export const T0 = new Date('2026-11-10T10:00:00.000Z');
export const HOUR = 3_600_000;

export interface SaleSeed {
  id?: string;
  startAt?: Date;
  endAt?: Date;
  isActive?: boolean;
}
export interface ItemSeed {
  id?: string;
  variationId?: string;
  quota?: number;
  soldCount?: number;
  perUserLimit?: number;
}

/** Cơ sở dữ liệu giả có sẵn một đợt đang chạy quanh T0 (giờ trước đến giờ sau) và các suất. */
export function flashDb(opts: { sale?: SaleSeed; items?: ItemSeed[]; purchases?: { itemId: string; userId: string; quantity: number }[] } = {}) {
  const db = new RaceDb(flashTables());
  flashHandlers(db);
  const saleId = opts.sale?.id ?? 's1';
  db.seed('flashSale', [
    {
      id: saleId,
      startAt: opts.sale?.startAt ?? new Date(T0.getTime() - HOUR),
      endAt: opts.sale?.endAt ?? new Date(T0.getTime() + HOUR),
      isActive: opts.sale?.isActive ?? true,
    },
  ]);
  db.seed(
    'flashSaleItem',
    (opts.items ?? [{}]).map((it, i) => ({
      id: it.id ?? `fi${i + 1}`,
      flashSaleId: saleId,
      variationId: it.variationId ?? `v${i + 1}`,
      flashPrice: 60_000,
      quota: it.quota ?? 1,
      soldCount: it.soldCount ?? 0,
      perUserLimit: it.perUserLimit ?? 5,
    })),
  );
  db.seed(
    'flashSalePurchase',
    (opts.purchases ?? []).map((p) => ({ flashSaleItemId: p.itemId, userId: p.userId, quantity: p.quantity })),
  );
  return db;
}

/**
 * Client của RaceDb có hai chỗ gần Postgres hơn mà giữ chỗ Giờ vàng đang dựa vào:
 *  - `deleteMany` chạy như `DELETE ... WHERE` (chọn dòng, chờ khoá từng dòng, được khoá thì xét lại WHERE trên bản mới nhất);
 *  - COMMIT là một vòng riêng: sau câu cuối của callback transaction vẫn giữ khoá thêm một nhịp, nên bên kia kịp đọc giữa câu cuối và lúc commit.
 */
export function flashClient(db: RaceDb): any {
  db.handlers.push({
    match: /w97a-delete-row-lock/,
    run: async (c) => {
      await c.lockRow(c.params[0] as string, c.params[1] as string);
      return [];
    },
  });
  const patch = (client: any): any => {
    const out: any = { ...client };
    for (const [table, model] of Object.entries<any>(client)) {
      if (!model || typeof model.findMany !== 'function') continue;
      out[table] = {
        ...model,
        deleteMany: (args?: { where?: Record<string, unknown> }) => {
          const run = async (tx: any) => {
            let count = 0;
            for (const row of await tx[table].findMany({ where: args?.where })) {
              await tx.$queryRaw`SELECT 1 /* w97a-delete-row-lock */ ${table} ${row.id}`;
              if ((await tx[table].findMany({ where: { AND: [args?.where ?? {}, { id: row.id }] } })).length === 0) continue;
              await tx[table].delete({ where: { id: row.id } });
              count += 1;
            }
            return { count };
          };
          // Ngoài transaction, một câu DELETE vẫn giữ khoá dòng từ lúc chọn tới lúc xong: bọc lại để khoá không nhả giữa các bước.
          return typeof client.$transaction === 'function' ? client.$transaction((tx: any) => run(tx)) : run(client);
        },
      };
    }
    if (typeof client.$transaction === 'function') {
      out.$transaction = (fn: (tx: any) => Promise<unknown>) =>
        client.$transaction(async (tx: any) => {
          const result = await fn(patch(tx));
          await tick();
          return result;
        });
    }
    return out;
  };
  return patch(db.client);
}

export const ticks = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i += 1) await tick();
};

/** Chờ `p` tối đa `ms`: vòng chờ khoá (deadlock) trong cơ sở dữ liệu giả không tự thoát, nên biến thành lỗi rõ ràng thay vì treo tới hết thời gian của jest. */
export function withinMs<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const stuck = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: treo quá ${ms}ms (nghi vòng chờ khoá)`)), ms);
  });
  return Promise.race([p, stuck]).finally(() => clearTimeout(timer));
}
